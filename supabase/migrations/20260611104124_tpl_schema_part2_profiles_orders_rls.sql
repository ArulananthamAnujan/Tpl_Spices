/*
# TPL Spices – Schema Part 2: Profiles, Orders, Order Items, RLS, Triggers

Creates profiles (FK to stores), orders, order_items, all RLS policies, and the
auto-create-profile trigger on auth.users.
*/

-- PROFILES
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'customer',
  full_name text,
  phone text,
  assigned_store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ORDERS
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  square_order_id text,
  square_payment_id text,
  fulfillment_type fulfillment_type NOT NULL,
  status order_status NOT NULL DEFAULT 'new',
  subtotal_cents int NOT NULL DEFAULT 0,
  total_cents int NOT NULL DEFAULT 0,
  delivery_address jsonb,
  scheduled_time timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- ORDER ITEMS
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variation_id uuid REFERENCES product_variations(id) ON DELETE SET NULL,
  name_snapshot text NOT NULL,
  qty int NOT NULL DEFAULT 1,
  unit_price_cents int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
  SELECT role::text FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_staff_store_id()
RETURNS uuid AS $$
  SELECT assigned_store_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGN-UP
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, role, full_name)
  VALUES (
    new.id,
    'customer',
    COALESCE(new.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- RLS POLICIES: STORES
-- ============================================================
DROP POLICY IF EXISTS "stores_public_select" ON stores;
CREATE POLICY "stores_public_select" ON stores FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "stores_admin_insert" ON stores;
CREATE POLICY "stores_admin_insert" ON stores FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "stores_admin_update" ON stores;
CREATE POLICY "stores_admin_update" ON stores FOR UPDATE TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "stores_admin_delete" ON stores;
CREATE POLICY "stores_admin_delete" ON stores FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');

-- ============================================================
-- RLS POLICIES: PROFILES
-- ============================================================
DROP POLICY IF EXISTS "profiles_own_select" ON profiles;
CREATE POLICY "profiles_own_select" ON profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "profiles_own_insert" ON profiles;
CREATE POLICY "profiles_own_insert" ON profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_own_update" ON profiles;
CREATE POLICY "profiles_own_update" ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR get_user_role() = 'super_admin')
  WITH CHECK (auth.uid() = id OR get_user_role() = 'super_admin');

-- ============================================================
-- RLS POLICIES: CATEGORIES, PRODUCTS, VARIATIONS, INVENTORY
-- ============================================================
DROP POLICY IF EXISTS "categories_public_select" ON categories;
CREATE POLICY "categories_public_select" ON categories FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "categories_admin_write" ON categories;
CREATE POLICY "categories_admin_write" ON categories FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "categories_admin_update" ON categories;
CREATE POLICY "categories_admin_update" ON categories FOR UPDATE TO authenticated
  USING (get_user_role() = 'super_admin') WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "categories_admin_delete" ON categories;
CREATE POLICY "categories_admin_delete" ON categories FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "products_public_select" ON products;
CREATE POLICY "products_public_select" ON products FOR SELECT TO anon, authenticated
  USING (active = true OR get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "products_admin_insert" ON products;
CREATE POLICY "products_admin_insert" ON products FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "products_admin_update" ON products;
CREATE POLICY "products_admin_update" ON products FOR UPDATE TO authenticated
  USING (get_user_role() = 'super_admin') WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "products_admin_delete" ON products;
CREATE POLICY "products_admin_delete" ON products FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "variations_public_select" ON product_variations;
CREATE POLICY "variations_public_select" ON product_variations FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "variations_admin_insert" ON product_variations;
CREATE POLICY "variations_admin_insert" ON product_variations FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "variations_admin_update" ON product_variations;
CREATE POLICY "variations_admin_update" ON product_variations FOR UPDATE TO authenticated
  USING (get_user_role() = 'super_admin') WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "variations_admin_delete" ON product_variations;
CREATE POLICY "variations_admin_delete" ON product_variations FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "inventory_public_select" ON store_inventory;
CREATE POLICY "inventory_public_select" ON store_inventory FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "inventory_admin_insert" ON store_inventory;
CREATE POLICY "inventory_admin_insert" ON store_inventory FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "inventory_admin_update" ON store_inventory;
CREATE POLICY "inventory_admin_update" ON store_inventory FOR UPDATE TO authenticated
  USING (get_user_role() = 'super_admin') WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "inventory_admin_delete" ON store_inventory;
CREATE POLICY "inventory_admin_delete" ON store_inventory FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');

-- ============================================================
-- RLS POLICIES: ORDERS
-- ============================================================
DROP POLICY IF EXISTS "orders_select" ON orders;
CREATE POLICY "orders_select" ON orders FOR SELECT TO authenticated
  USING (
    auth.uid() = customer_id
    OR get_user_role() = 'super_admin'
    OR (get_user_role() = 'staff' AND store_id = get_staff_store_id())
  );

DROP POLICY IF EXISTS "orders_insert" ON orders;
CREATE POLICY "orders_insert" ON orders FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_id);

DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY "orders_update" ON orders FOR UPDATE TO authenticated
  USING (
    auth.uid() = customer_id
    OR get_user_role() = 'super_admin'
    OR (get_user_role() = 'staff' AND store_id = get_staff_store_id())
  )
  WITH CHECK (
    auth.uid() = customer_id
    OR get_user_role() = 'super_admin'
    OR (get_user_role() = 'staff' AND store_id = get_staff_store_id())
  );

DROP POLICY IF EXISTS "orders_admin_delete" ON orders;
CREATE POLICY "orders_admin_delete" ON orders FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');

-- ============================================================
-- RLS POLICIES: ORDER ITEMS
-- ============================================================
DROP POLICY IF EXISTS "order_items_select" ON order_items;
CREATE POLICY "order_items_select" ON order_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_id AND (
        o.customer_id = auth.uid()
        OR get_user_role() = 'super_admin'
        OR (get_user_role() = 'staff' AND o.store_id = get_staff_store_id())
      )
    )
  );

DROP POLICY IF EXISTS "order_items_insert" ON order_items;
CREATE POLICY "order_items_insert" ON order_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_id AND o.customer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "order_items_admin_delete" ON order_items;
CREATE POLICY "order_items_admin_delete" ON order_items FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');
