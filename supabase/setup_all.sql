-- ============================================================
-- Tpl Spices — full database setup (all migrations, in order)
-- HOW TO USE: open your Supabase project → SQL Editor → New query
-- → paste this entire file → Run. Safe to re-run (idempotent).
-- ============================================================

-- >>>>>>>>>> 20260611104048_tpl_schema_part1_base_tables.sql <<<<<<<<<<

/*
# TPL Spices – Schema Part 1: Enums, Stores, Categories, Products, Variations, Inventory

Creates all tables except profiles (which depends on stores), and helper infrastructure.
*/

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('super_admin', 'staff', 'customer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fulfillment_type AS ENUM ('PICKUP', 'DELIVERY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('new', 'in_progress', 'ready', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- STORES
CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  square_location_id text NOT NULL,
  name text NOT NULL,
  address text NOT NULL,
  lat numeric(10,7),
  lng numeric(10,7),
  pickup_enabled boolean NOT NULL DEFAULT true,
  delivery_enabled boolean NOT NULL DEFAULT false,
  delivery_radius_km numeric(5,2) NOT NULL DEFAULT 10,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

-- CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  square_id text UNIQUE NOT NULL,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  square_item_id text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  image_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- PRODUCT VARIATIONS
CREATE TABLE IF NOT EXISTS product_variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  square_variation_id text UNIQUE NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_cents int NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'AUD',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_variations_product ON product_variations(product_id);
ALTER TABLE product_variations ENABLE ROW LEVEL SECURITY;

-- STORE INVENTORY
CREATE TABLE IF NOT EXISTS store_inventory (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variation_id uuid NOT NULL REFERENCES product_variations(id) ON DELETE CASCADE,
  quantity int NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, variation_id)
);

ALTER TABLE store_inventory ENABLE ROW LEVEL SECURITY;


-- >>>>>>>>>> 20260611104124_tpl_schema_part2_profiles_orders_rls.sql <<<<<<<<<<

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


-- >>>>>>>>>> 20260611112243_add_is_brand_to_categories.sql <<<<<<<<<<

ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_brand boolean NOT NULL DEFAULT false;


-- >>>>>>>>>> 20260611112258_create_promo_slides_table.sql <<<<<<<<<<

CREATE TABLE IF NOT EXISTS promo_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  subtitle text,
  image_url text,
  discount_label text,
  cta_text text,
  cta_link text,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  start_date date,
  end_date date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE promo_slides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_active_slides" ON promo_slides FOR SELECT
  TO anon, authenticated USING (active = true);

CREATE POLICY "super_admin_insert_slides" ON promo_slides FOR INSERT
  TO authenticated WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'super_admin'
  );

CREATE POLICY "super_admin_update_slides" ON promo_slides FOR UPDATE
  TO authenticated USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'super_admin'
  ) WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'super_admin'
  );

CREATE POLICY "super_admin_delete_slides" ON promo_slides FOR DELETE
  TO authenticated USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'super_admin'
  );


-- >>>>>>>>>> 20260611112327_create_promo_flyers_bucket_and_policies.sql <<<<<<<<<<

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('promo-flyers', 'promo-flyers', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'promo_flyers_public_read'
  ) THEN
    CREATE POLICY "promo_flyers_public_read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'promo-flyers');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'promo_flyers_admin_insert'
  ) THEN
    CREATE POLICY "promo_flyers_admin_insert"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'promo-flyers' AND
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'promo_flyers_admin_delete'
  ) THEN
    CREATE POLICY "promo_flyers_admin_delete"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'promo-flyers' AND
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
      );
  END IF;
END $$;


-- >>>>>>>>>> 20260611112411_seed_demo_accounts.sql <<<<<<<<<<

-- Create demo users in auth.users
DO $$
DECLARE
  admin_id uuid := '00000001-0000-0000-0000-000000000001';
  staff_id uuid := '00000001-0000-0000-0000-000000000002';
  customer_id uuid := '00000001-0000-0000-0000-000000000003';
BEGIN
  -- Super Admin
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud)
  VALUES (
    admin_id,
    'admin@tplspices.com',
    crypt('Admin@123', gen_salt('bf')),
    now(),
    'authenticated',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"TPL Admin"}',
    now(),
    now(),
    'authenticated'
  ) ON CONFLICT (id) DO NOTHING;

  -- Staff
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud)
  VALUES (
    staff_id,
    'staff@tplspices.com',
    crypt('Staff@123', gen_salt('bf')),
    now(),
    'authenticated',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"TPL Staff"}',
    now(),
    now(),
    'authenticated'
  ) ON CONFLICT (id) DO NOTHING;

  -- Customer
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud)
  VALUES (
    customer_id,
    'customer@tplspices.com',
    crypt('Customer@123', gen_salt('bf')),
    now(),
    'authenticated',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Demo Customer"}',
    now(),
    now(),
    'authenticated'
  ) ON CONFLICT (id) DO NOTHING;

  -- Identities
  INSERT INTO auth.identities (id, user_id, provider, identity_data, created_at, updated_at, provider_id, last_sign_in_at)
  VALUES
    (admin_id, admin_id, 'email', jsonb_build_object('sub', admin_id::text, 'email', 'admin@tplspices.com'), now(), now(), 'admin@tplspices.com', now()),
    (staff_id, staff_id, 'email', jsonb_build_object('sub', staff_id::text, 'email', 'staff@tplspices.com'), now(), now(), 'staff@tplspices.com', now()),
    (customer_id, customer_id, 'email', jsonb_build_object('sub', customer_id::text, 'email', 'customer@tplspices.com'), now(), now(), 'customer@tplspices.com', now())
  ON CONFLICT (id) DO NOTHING;

  -- Profiles
  INSERT INTO profiles (id, role, full_name, phone, assigned_store_id)
  VALUES
    (admin_id, 'super_admin', 'TPL Admin', NULL, NULL),
    (staff_id, 'staff', 'TPL Staff', NULL, NULL),
    (customer_id, 'customer', 'Demo Customer', NULL, NULL)
  ON CONFLICT (id) DO NOTHING;
END $$;


-- >>>>>>>>>> 20260611113736_fix_demo_account_passwords.sql <<<<<<<<<<

-- Fix passwords: use bcrypt cost factor 10 (required by Supabase Auth)
UPDATE auth.users
SET encrypted_password = crypt('Admin@123', gen_salt('bf', 10))
WHERE email = 'admin@tplspices.com';

UPDATE auth.users
SET encrypted_password = crypt('Staff@123', gen_salt('bf', 10))
WHERE email = 'staff@tplspices.com';

UPDATE auth.users
SET encrypted_password = crypt('Customer@123', gen_salt('bf', 10))
WHERE email = 'customer@tplspices.com';


-- >>>>>>>>>> 20260611114138_fix_demo_account_instance_id.sql <<<<<<<<<<

-- Fix instance_id required by Supabase GoTrue for password auth
UPDATE auth.users
SET instance_id = '00000000-0000-0000-0000-000000000000'
WHERE email IN ('admin@tplspices.com', 'staff@tplspices.com', 'customer@tplspices.com');

-- Also ensure encrypted_password is fresh with cost 10
UPDATE auth.users SET encrypted_password = crypt('Admin@123', gen_salt('bf', 10)) WHERE email = 'admin@tplspices.com';
UPDATE auth.users SET encrypted_password = crypt('Staff@123', gen_salt('bf', 10)) WHERE email = 'staff@tplspices.com';
UPDATE auth.users SET encrypted_password = crypt('Customer@123', gen_salt('bf', 10)) WHERE email = 'customer@tplspices.com';


-- >>>>>>>>>> 20260611115020_fix_rls_circular_dependency.sql <<<<<<<<<<

-- Fix 1: Rebuild helper functions with explicit search_path (prevents schema resolution errors)
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;

CREATE OR REPLACE FUNCTION get_staff_store_id()
RETURNS uuid AS $$
  SELECT assigned_store_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;

-- Fix 2: Break the circular RLS on profiles.
-- The old policy called get_user_role() which queries profiles → infinite recursion.
-- Solution: let all authenticated users read all profiles (roles aren't secret in this system),
-- and keep write policies as-is using get_user_role() which is now safe (SECURITY DEFINER bypasses RLS).
DROP POLICY IF EXISTS "profiles_own_select" ON profiles;
CREATE POLICY "profiles_select_authenticated" ON profiles
  FOR SELECT TO authenticated USING (true);

-- Fix 3: Rebuild handle_new_user trigger with explicit search_path
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    new.id,
    'customer',
    COALESCE(new.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- >>>>>>>>>> 20260611115042_fix_demo_account_roles.sql <<<<<<<<<<

UPDATE profiles SET role = 'super_admin' WHERE id = '00000001-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'staff'       WHERE id = '00000001-0000-0000-0000-000000000002';
UPDATE profiles SET role = 'customer'    WHERE id = '00000001-0000-0000-0000-000000000003';


-- >>>>>>>>>> 20260611120815_add_section_to_categories.sql <<<<<<<<<<

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'grocery'
  CHECK (section IN ('grocery', 'clothing'));


-- >>>>>>>>>> 20260611122836_create_product_images_bucket.sql <<<<<<<<<<

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "product_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY "product_images_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product_images_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'product-images');

CREATE POLICY "product_images_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-images');


-- >>>>>>>>>> 20260612030355_assign_clothing_categories.sql <<<<<<<<<<

UPDATE categories
SET section = 'clothing'
WHERE name IN ('Frocks', 'Salwars', 'Saree Skirts', 'Sarees', 'Shirts', 'Tops', 'Vesti');


-- >>>>>>>>>> 20260703030603_seed_rice_products_with_photos.sql <<<<<<<<<<

DO $$
DECLARE
  rice_cat_id uuid := 'add341b2-0f40-490a-897e-1480fe04626f';
  p1  uuid := gen_random_uuid(); p2  uuid := gen_random_uuid(); p3  uuid := gen_random_uuid();
  p4  uuid := gen_random_uuid(); p5  uuid := gen_random_uuid(); p6  uuid := gen_random_uuid();
  p7  uuid := gen_random_uuid(); p8  uuid := gen_random_uuid(); p9  uuid := gen_random_uuid();
  p10 uuid := gen_random_uuid(); p11 uuid := gen_random_uuid(); p12 uuid := gen_random_uuid();
  p13 uuid := gen_random_uuid(); p14 uuid := gen_random_uuid(); p15 uuid := gen_random_uuid();
  p16 uuid := gen_random_uuid(); p17 uuid := gen_random_uuid(); p18 uuid := gen_random_uuid();
  p19 uuid := gen_random_uuid(); p20 uuid := gen_random_uuid();
BEGIN
  -- Ensure the Rice category exists (originally expected from a Square sync).
  -- Idempotent so re-running the setup is safe.
  INSERT INTO categories (id, square_id, name, sort_order)
  VALUES (rice_cat_id, 'LOCAL-CAT-RICE', 'Rice', 10)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO products (id, square_item_id, category_id, name, image_url, active) VALUES
    (p1,  'LOCAL-RICE-01', rice_cat_id, 'Derana Red Raw Keeri Samba Rice 5kg',          '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(1).jpeg', true),
    (p2,  'LOCAL-RICE-02', rice_cat_id, 'Araliya Keeri Samba Rice 5kg',                  '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(2).jpeg', true),
    (p3,  'LOCAL-RICE-03', rice_cat_id, 'Athavan Keeri Samba Rice 5kg',                  '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(3).jpeg', true),
    (p4,  'LOCAL-RICE-04', rice_cat_id, 'Sri Ayyappa Jaffna Special Parboiled Rice 5kg', '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(4).jpeg', true),
    (p5,  'LOCAL-RICE-05', rice_cat_id, 'Derana Red Raw Rice 5kg',                       '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(5).jpeg', true),
    (p6,  'LOCAL-RICE-06', rice_cat_id, 'Derana White Raw Rice 5kg',                     '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(1).jpeg', true),
    (p7,  'LOCAL-RICE-07', rice_cat_id, 'Leela Red Raw Rice 5kg',                        '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(2).jpeg', true),
    (p8,  'LOCAL-RICE-08', rice_cat_id, 'Athavan Red Rice Lite 5kg',                     '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(3).jpeg', true),
    (p9,  'LOCAL-RICE-09', rice_cat_id, 'Derana Muthu Samba Rice 5kg',                   '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(4).jpeg', true),
    (p10, 'LOCAL-RICE-10', rice_cat_id, 'Athavan Muthu Samba Rice 5kg',                  '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM.jpeg',    true),
    (p11, 'LOCAL-RICE-11', rice_cat_id, 'Athavan Supiri Keeri Samba Rice 5kg',           '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(1).jpeg', true),
    (p12, 'LOCAL-RICE-12', rice_cat_id, 'Athavan Red Nadu Rice 5kg',                     '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(2).jpeg', true),
    (p13, 'LOCAL-RICE-13', rice_cat_id, 'Derana Wholegrain Red Rice 5kg',                '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(3).jpeg', true),
    (p14, 'LOCAL-RICE-14', rice_cat_id, 'Athavan Red Raw Rice Jaffna Special 5kg',       '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(4).jpeg', true),
    (p15, 'LOCAL-RICE-15', rice_cat_id, 'Athavan Kiribath Rice 5kg',                     '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM.jpeg',    true),
    (p16, 'LOCAL-RICE-16', rice_cat_id, 'Derana White Keeri Samba Rice 5kg',             '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM_(1).jpeg', true),
    (p17, 'LOCAL-RICE-17', rice_cat_id, 'Derana Suduru Samba Rice 5kg',                  '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM_(2).jpeg', true),
    (p18, 'LOCAL-RICE-18', rice_cat_id, 'Derana Nadu Rice 5kg',                          '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM_(3).jpeg', true),
    (p19, 'LOCAL-RICE-19', rice_cat_id, 'Sri Ayyappa Mottaikaruppan Parboiled Rice 5kg', '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM.jpeg',    true),
    (p20, 'LOCAL-RICE-20', rice_cat_id, 'Golden Crop Wholesome Red Rice 5kg',            '/images/WhatsApp_Image_2026-06-16_at_6.24.50_PM_(1).jpeg', true)
  ON CONFLICT (square_item_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 1000, 'AUD'
  FROM products
  WHERE square_item_id LIKE 'LOCAL-RICE-%'
  ON CONFLICT (square_variation_id) DO NOTHING;
END $$;


-- >>>>>>>>>> 20260703075858_remove_duplicate_products.sql <<<<<<<<<<

-- Deactivate the duplicate/inferior copy of each repeated product.
-- For each pair, we keep the product with the better image or cleaner name.

UPDATE products SET active = false WHERE id IN (
  'b3213b5d-e12f-40d3-9764-bfcd9338d3a4', -- "Araliya  Keeri Samba Rice 5kg" (double-space name) — keep b745de5a
  '0796b1d5-d496-4c33-bf69-e55f085bfcc5', -- "Athavan Kiribath Rice 5kg" no image — keep 2f727110 (AI image)
  'eb5dd298-a99a-4dad-84fc-a4f8d19f1947', -- "Athavan Muthu Samba Rice 5kg" duplicate — keep d65dc238
  '532c1591-efcf-42bb-a6c4-0e9e078f852e', -- "Athavan Red Nadu Rice 5kg" duplicate — keep 99a2c8d9
  '88467439-2117-4935-8ca9-95c08c126987', -- "Athavan Red Rice Lite 5kg" duplicate — keep 303955fe
  '6c05b95a-4d12-41fc-a7bd-b1ec60051c60'  -- "Leela Red Raw Rice 5kg" openfoodfacts placeholder — keep 66c4ec1a (AI image)
);

-- >>>>>>>>>> 20260703080651_add_brand_to_products.sql <<<<<<<<<<

ALTER TABLE products ADD COLUMN IF NOT EXISTS brand text;

UPDATE products SET brand = CASE
  WHEN name ILIKE 'Athavan%'       THEN 'Athavan'
  WHEN name ILIKE 'Araliya%'       THEN 'Araliya'
  WHEN name ILIKE 'Sri Ayyappa%'   THEN 'Sri Ayyappa'
  WHEN name ILIKE 'Ayyappa%'       THEN 'Ayyappa'
  WHEN name ILIKE 'Derana%'        THEN 'Derana'
  WHEN name ILIKE 'India Gate%'    THEN 'India Gate'
  WHEN name ILIKE 'Golden Crop%'   THEN 'Golden Crop'
  WHEN name ILIKE 'Malabar Treat%' THEN 'Malabar Treats'
  WHEN name ILIKE 'Grandma%'       THEN 'Grandma''s'
  WHEN name ILIKE 'Harischandra%'  THEN 'Harischandra'
  WHEN name ILIKE 'Katoomba%'      THEN 'Katoomba'
  WHEN name ILIKE 'KBT%'           THEN 'KBT'
  WHEN name ILIKE 'PATTU%'         THEN 'PATTU'
  WHEN name ILIKE 'Pattu%'         THEN 'PATTU'
  WHEN name ILIKE 'Shan%'          THEN 'Shan'
  WHEN name ILIKE 'Sjhan%'         THEN 'Shan'
  WHEN name ILIKE 'Leela%'         THEN 'Leela'
  WHEN name ILIKE 'KARA%'          THEN 'KARA'
  WHEN name ILIKE 'GRB%'           THEN 'GRB'
  WHEN name ILIKE 'TATA%'          THEN 'TATA'
  WHEN name ILIKE 'Viswas%'        THEN 'Viswas'
  WHEN name ILIKE 'Chakra%'        THEN 'Chakra'
  WHEN name ILIKE 'Fortune%'       THEN 'Fortune'
  WHEN name ILIKE 'PRAN%'          THEN 'PRAN'
  WHEN name ILIKE 'Kushi%'         THEN 'Kushi'
  WHEN name ILIKE 'Hamdard%'       THEN 'Hamdard'
  WHEN name ILIKE 'Sabrini%'       THEN 'Sabrini'
  WHEN name ILIKE 'Swetha%'        THEN 'Swetha'
  WHEN name ILIKE 'Uswalle%'       THEN 'Uswalle'
  WHEN name ILIKE 'Darena%'        THEN 'Darena'
  WHEN name ILIKE 'Delmege%'       THEN 'Delmege'
  WHEN name ILIKE 'Village%'       THEN 'Village'
  WHEN name ILIKE 'SIS%'           THEN 'SIS'
  WHEN name ILIKE 'MDK%'           THEN 'MDK'
  WHEN name ILIKE 'ICS%'           THEN 'ICS'
  WHEN name ILIKE 'Devaaya%'       THEN 'Devaaya'
  WHEN name ILIKE 'EuroFresh%'     THEN 'EuroFresh'
  WHEN name ILIKE 'Brahmins%'      THEN 'Brahmins'
  WHEN name ILIKE 'AMMAAS%'        THEN 'AMMAAS'
  WHEN name ILIKE 'Ammas%'         THEN 'AMMAAS'
  WHEN name ILIKE 'Ammaas%'        THEN 'AMMAAS'
  ELSE NULL
END;

-- >>>>>>>>>> 20260814090000_add_delivery_fee_to_stores.sql <<<<<<<<<<

/*
# Add delivery fee to stores

Adds an admin-editable flat delivery fee per store, defaulting to 0 (free)
until an admin sets a real amount. Charged as a separate Square line item
by the create-order function when fulfillment_type = DELIVERY.
*/

ALTER TABLE stores ADD COLUMN IF NOT EXISTS delivery_fee_cents int NOT NULL DEFAULT 0;


-- >>>>>>>>>> 20260814090100_add_decrement_inventory_function.sql <<<<<<<<<<

/*
# Atomic inventory decrement

Used by the create-order edge function after a successful payment to reduce
tracked stock for a store+variation. Only decrements if enough stock remains,
so concurrent orders can't drive a row negative.
*/

CREATE OR REPLACE FUNCTION decrement_store_inventory(
  p_store_id uuid,
  p_variation_id uuid,
  p_qty int
)
RETURNS void AS $$
BEGIN
  UPDATE store_inventory
  SET quantity = quantity - p_qty
  WHERE store_id = p_store_id
    AND variation_id = p_variation_id
    AND quantity >= p_qty;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- >>>>>>>>>> 20260814090200_create_newsletter_subscribers.sql <<<<<<<<<<

/*
# Newsletter signup

Simple email capture for the footer signup form. Public can insert their own
email; only super admins can read the list back out.
*/

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "newsletter_public_insert" ON newsletter_subscribers;
CREATE POLICY "newsletter_public_insert" ON newsletter_subscribers FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "newsletter_admin_select" ON newsletter_subscribers;
CREATE POLICY "newsletter_admin_select" ON newsletter_subscribers FOR SELECT TO authenticated
  USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "newsletter_admin_delete" ON newsletter_subscribers;
CREATE POLICY "newsletter_admin_delete" ON newsletter_subscribers FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');


-- >>>>>>>>>> 20260814090300_seed_clothing_products.sql <<<<<<<<<<

/*
# Seed modern clothing products under Women, Men, Kids categories

Adds everyday Western-style clothing (t-shirts, dresses, jeans, hoodies, etc.)
with variations and store inventory for both stores.
*/

DO $$
DECLARE
  women_cat uuid := 'f07bde41-dc47-4cfc-8b74-6b0724aff436';
  men_cat   uuid := '7af743d8-7c3d-4a30-bcac-c0f5b31a5bf2';
  kids_cat  uuid := 'e8d2d3bf-3fd3-45fc-9483-f4e1d01d5aca';
  dandenong uuid := '21a397e3-d2a4-4840-9ee8-2ece6df096ba';
  clayton   uuid := 'a8ca5782-f01f-470a-b213-b324b08ff4bf';

  wp1 uuid := gen_random_uuid(); wp2 uuid := gen_random_uuid();
  wp3 uuid := gen_random_uuid(); wp4 uuid := gen_random_uuid();
  wp5 uuid := gen_random_uuid(); wp6 uuid := gen_random_uuid();

  mp1 uuid := gen_random_uuid(); mp2 uuid := gen_random_uuid();
  mp3 uuid := gen_random_uuid(); mp4 uuid := gen_random_uuid();
  mp5 uuid := gen_random_uuid(); mp6 uuid := gen_random_uuid();

  kp1 uuid := gen_random_uuid(); kp2 uuid := gen_random_uuid();
  kp3 uuid := gen_random_uuid(); kp4 uuid := gen_random_uuid();
  kp5 uuid := gen_random_uuid(); kp6 uuid := gen_random_uuid();
BEGIN
  -- Ensure the clothing categories exist (originally expected from a Square
  -- sync). Idempotent so re-running the setup is safe.
  INSERT INTO categories (id, square_id, name, sort_order, section) VALUES
    (women_cat, 'LOCAL-CAT-WOMEN', 'Women', 20, 'clothing'),
    (men_cat,   'LOCAL-CAT-MEN',   'Men',   21, 'clothing'),
    (kids_cat,  'LOCAL-CAT-KIDS',  'Kids',  22, 'clothing')
  ON CONFLICT (id) DO NOTHING;

  -- Ensure the demo stores exist so inventory can attach. These are placeholder
  -- stores you can rename or delete in Admin → Stores.
  INSERT INTO stores (id, square_location_id, name, address, pickup_enabled, delivery_enabled) VALUES
    (dandenong, 'LOCAL-LOC-DANDENONG', 'TPL Spices Dandenong', 'Dandenong VIC 3175', true, true),
    (clayton,   'LOCAL-LOC-CLAYTON',   'TPL Spices Clayton',   'Clayton VIC 3168',   true, false)
  ON CONFLICT (id) DO NOTHING;

  -- WOMEN
  INSERT INTO products (id, square_item_id, category_id, name, description, image_url, active) VALUES
    (wp1, 'LOCAL-CLO-W-01', women_cat, 'Casual Cotton T-Shirt',
     'Soft breathable cotton tee in a relaxed fit. Perfect for everyday wear.',
     'https://images.pexels.com/photos/8146450/pexels-photo-8146450.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (wp2, 'LOCAL-CLO-W-02', women_cat, 'Summer Floral Dress',
     'Lightweight floral print dress ideal for warm days and casual outings.',
     'https://images.pexels.com/photos/4428388/pexels-photo-4428388.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (wp3, 'LOCAL-CLO-W-03', women_cat, 'Cotton Blend Blouse',
     'Elegant everyday blouse with a comfortable cotton blend. Easy to dress up or down.',
     'https://images.pexels.com/photos/3750640/pexels-photo-3750640.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (wp4, 'LOCAL-CLO-W-04', women_cat, 'Slim Fit Denim Jeans',
     'Classic five-pocket denim jeans with a flattering slim fit and stretch comfort.',
     'https://images.pexels.com/photos/18533668/pexels-photo-18533668.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (wp5, 'LOCAL-CLO-W-05', women_cat, 'Fleece Pullover Hoodie',
     'Cozy fleece-lined hoodie with kangaroo pocket. Great for layering in cooler weather.',
     'https://images.pexels.com/photos/8743972/pexels-photo-8743972.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (wp6, 'LOCAL-CLO-W-06', women_cat, 'High-Waist Leggings',
     'Stretchy high-waist leggings with a smooth waistband for all-day comfort.',
     'https://images.pexels.com/photos/28666282/pexels-photo-28666282.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true)
  ON CONFLICT (square_item_id) DO NOTHING;

  -- MEN
  INSERT INTO products (id, square_item_id, category_id, name, description, image_url, active) VALUES
    (mp1, 'LOCAL-CLO-M-01', men_cat, 'Crew Neck T-Shirt',
     'Classic crew neck tee in soft combed cotton. A versatile wardrobe essential.',
     'https://images.pexels.com/photos/10493094/pexels-photo-10493094.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (mp2, 'LOCAL-CLO-M-02', men_cat, 'Pique Polo Shirt',
     'Breathable pique-knit polo with ribbed collar. Smart-casual for any occasion.',
     'https://images.pexels.com/photos/928364/pexels-photo-928364.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (mp3, 'LOCAL-CLO-M-03', men_cat, 'Straight Leg Denim Jeans',
     'Durable straight-leg denim with a classic wash and reinforced stitching.',
     'https://images.pexels.com/photos/13094233/pexels-photo-13094233.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (mp4, 'LOCAL-CLO-M-04', men_cat, 'Drawstring Hoodie',
     'Mid-weight hoodie with adjustable drawstring hood and front pouch pocket.',
     'https://images.pexels.com/photos/6342786/pexels-photo-6342786.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (mp5, 'LOCAL-CLO-M-05', men_cat, 'Casual Button-Up Shirt',
     'Relaxed-fit button-up shirt in a lightweight weave. Great worn open or tucked.',
     'https://images.pexels.com/photos/966067/pexels-photo-966067.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (mp6, 'LOCAL-CLO-M-06', men_cat, 'Lightweight Bomber Jacket',
     'Slim-cut bomber jacket with ribbed cuffs and a smooth zip front. Layering made easy.',
     'https://images.pexels.com/photos/13094233/pexels-photo-13094233.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true)
  ON CONFLICT (square_item_id) DO NOTHING;

  -- KIDS
  INSERT INTO products (id, square_item_id, category_id, name, description, image_url, active) VALUES
    (kp1, 'LOCAL-CLO-K-01', kids_cat, 'Kids Graphic T-Shirt',
     'Fun printed graphic tee in soft cotton. Machine washable and kid-tough.',
     'https://images.pexels.com/photos/5693888/pexels-photo-5693888.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (kp2, 'LOCAL-CLO-K-02', kids_cat, 'Kids Denim Shorts',
     'Sturdy denim shorts with an elastic waistband for growing kids.',
     'https://images.pexels.com/photos/5693891/pexels-photo-5693891.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (kp3, 'LOCAL-CLO-K-03', kids_cat, 'Kids Summer Dress',
     'Cheerful polka-dot dress with a comfy cotton lining for warm-weather play.',
     'https://images.pexels.com/photos/13526559/pexels-photo-13526559.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (kp4, 'LOCAL-CLO-K-04', kids_cat, 'Kids Fleece Hoodie',
     'Warm fleece hoodie with a front pocket. Keeps little ones cozy on cool days.',
     'https://images.pexels.com/photos/21967197/pexels-photo-21967197.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (kp5, 'LOCAL-CLO-K-05', kids_cat, 'Kids Casual Top',
     'Soft everyday top that pairs easily with jeans or shorts for school or play.',
     'https://images.pexels.com/photos/9322333/pexels-photo-9322333.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (kp6, 'LOCAL-CLO-K-06', kids_cat, 'Kids Printed T-Shirt',
     'Brightly printed character tee in breathable cotton jersey.',
     'https://images.pexels.com/photos/15304383/pexels-photo-15304383.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true)
  ON CONFLICT (square_item_id) DO NOTHING;

  -- VARIATIONS (one per product, "Regular" size)
  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 2500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-01')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 4500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-02')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 3500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-03')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 5500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-04')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 4000, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-05')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 3000, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-06')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 2500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-01')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 3500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-02')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 5500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-03')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 4500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-04')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 3000, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-05')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 6500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-06')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 1500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-K-01','LOCAL-CLO-K-06')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 2000, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-K-02')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 2500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-K-03','LOCAL-CLO-K-04')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 1800, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-K-05')
  ON CONFLICT (square_variation_id) DO NOTHING;

  -- INVENTORY for both stores (50 units each)
  INSERT INTO store_inventory (store_id, variation_id, quantity)
  SELECT s.store_id, v.id, 50
  FROM (VALUES (dandenong), (clayton)) AS s(store_id)
  CROSS JOIN product_variations v
  WHERE v.square_variation_id LIKE 'LOCAL-VAR-LOCAL-CLO-%'
  ON CONFLICT (store_id, variation_id) DO NOTHING;
END $$;


-- >>>>>>>>>> 20260814090400_inventory_movements_ledger.sql <<<<<<<<<<

/*
# Inventory movement ledger (full inventory management)

Upgrades stock tracking from a single "current quantity" into a complete,
auditable inventory system:

  * inventory_movements  — append-only ledger. Every stock change is a row:
      delta       +ve = stock received / added, -ve = sold / removed
      reason      'received' | 'sale' | 'adjustment' | 'initial'
      received_at when a received batch physically arrived (basis for aging)
      created_by  which admin/staff user made the change (accountability)
  * store_inventory.quantity stays the fast "available now" number and is kept
    in sync automatically by a trigger, so the storefront and checkout keep
    working unchanged.
  * record_inventory_movement() — admin-only RPC the dashboard calls to add /
    adjust / remove stock, stamping the acting user and guarding against
    negative stock.
  * decrement_store_inventory() is rewritten to log a 'sale' movement (instead
    of silently updating the number), so sales appear in the history too.

Aging (how much stock is 0-1 / 1-3 / 3+ months old) is derived from the
received_at dates of the movements — no schema change needed for that.
*/

-- ------------------------------------------------------------
-- LEDGER TABLE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variation_id uuid NOT NULL REFERENCES product_variations(id) ON DELETE CASCADE,
  delta int NOT NULL,
  reason text NOT NULL DEFAULT 'adjustment',
  received_at timestamptz,
  note text,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_moves_store_var ON inventory_movements(store_id, variation_id);
CREATE INDEX IF NOT EXISTS idx_inv_moves_created ON inventory_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_inv_moves_received ON inventory_movements(received_at);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- Super admin sees everything; staff see movements for their assigned store.
DROP POLICY IF EXISTS "inv_moves_select" ON inventory_movements;
CREATE POLICY "inv_moves_select" ON inventory_movements FOR SELECT TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'staff' AND store_id = get_staff_store_id())
  );

-- Writes go through record_inventory_movement() (SECURITY DEFINER). This direct
-- INSERT policy is a safety net that still limits any direct insert to admins.
DROP POLICY IF EXISTS "inv_moves_admin_insert" ON inventory_movements;
CREATE POLICY "inv_moves_admin_insert" ON inventory_movements FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

-- ------------------------------------------------------------
-- BACKFILL: seed an 'initial' movement for existing tracked stock.
-- Done BEFORE the sync trigger exists, so it doesn't double-apply to quantity.
-- ------------------------------------------------------------
INSERT INTO inventory_movements (store_id, variation_id, delta, reason, received_at, note)
SELECT store_id, variation_id, quantity, 'initial', now(), 'Opening balance'
FROM store_inventory
WHERE quantity <> 0
  AND NOT EXISTS (
    SELECT 1 FROM inventory_movements m
    WHERE m.store_id = store_inventory.store_id
      AND m.variation_id = store_inventory.variation_id
  );

-- ------------------------------------------------------------
-- SYNC TRIGGER: keep store_inventory.quantity = running sum of movements.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_inventory_movement()
RETURNS trigger AS $$
BEGIN
  INSERT INTO store_inventory (store_id, variation_id, quantity)
  VALUES (NEW.store_id, NEW.variation_id, NEW.delta)
  ON CONFLICT (store_id, variation_id)
  DO UPDATE SET quantity = store_inventory.quantity + NEW.delta;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_apply_inventory_movement ON inventory_movements;
CREATE TRIGGER trg_apply_inventory_movement
  AFTER INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION apply_inventory_movement();

-- ------------------------------------------------------------
-- ADMIN RPC: add / adjust / remove stock through the ledger.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_inventory_movement(
  p_store_id uuid,
  p_variation_id uuid,
  p_delta int,
  p_reason text DEFAULT 'adjustment',
  p_received_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  cur int;
  new_id uuid;
BEGIN
  IF get_user_role() <> 'super_admin' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'Change must be a non-zero amount';
  END IF;

  SELECT quantity INTO cur FROM store_inventory
    WHERE store_id = p_store_id AND variation_id = p_variation_id;
  cur := COALESCE(cur, 0);

  IF cur + p_delta < 0 THEN
    RAISE EXCEPTION 'Insufficient stock: have %, requested change %', cur, p_delta;
  END IF;

  INSERT INTO inventory_movements (store_id, variation_id, delta, reason, received_at, note, created_by)
  VALUES (
    p_store_id,
    p_variation_id,
    p_delta,
    p_reason,
    CASE WHEN p_delta > 0 THEN COALESCE(p_received_at, now()) ELSE NULL END,
    p_note,
    auth.uid()
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION record_inventory_movement(uuid, uuid, int, text, timestamptz, text) TO authenticated;

-- ------------------------------------------------------------
-- SALES: log a 'sale' movement instead of a bare quantity update.
-- Keeps the "only if enough stock" guard and the old 3-arg call signature
-- (p_order_id defaults to NULL) working for the create-order function.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS decrement_store_inventory(uuid, uuid, int);
CREATE OR REPLACE FUNCTION decrement_store_inventory(
  p_store_id uuid,
  p_variation_id uuid,
  p_qty int,
  p_order_id uuid DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  cur int;
BEGIN
  SELECT quantity INTO cur FROM store_inventory
    WHERE store_id = p_store_id AND variation_id = p_variation_id
    FOR UPDATE;

  IF cur IS NULL OR cur < p_qty THEN
    RETURN; -- untracked or insufficient: best-effort, same as before
  END IF;

  INSERT INTO inventory_movements (store_id, variation_id, delta, reason, order_id)
  VALUES (p_store_id, p_variation_id, -p_qty, 'sale', p_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- >>>>>>>>>> 20260814090500_wholesale_and_promotions.sql <<<<<<<<<<

/*
# Wholesale (bulk) pricing + item promotions

Adds a second price tier and per-item promotions to product variations.

  * wholesale_price_cents / wholesale_min_qty
      When a customer's quantity of an item reaches wholesale_min_qty, that item
      is charged wholesale_price_cents instead of the retail price_cents.
  * promo_type / promo_value / promo_start / promo_end
      An optional promotion on the item. promo_type is one of:
        'percent' — promo_value % off the retail price
        'fixed'   — promo_value cents off the retail price
        'price'   — promo_value is the exact sale price in cents
      Active only within the optional start/end window.

Effective unit price (must match src/lib/pricing.ts and the create-order
function): start from retail, apply the promo if active, then if the wholesale
tier qualifies use whichever of the two is cheaper.

Staff as well as super_admins may edit these fields (pricing + promotions).
*/

ALTER TABLE product_variations
  ADD COLUMN IF NOT EXISTS wholesale_price_cents int,
  ADD COLUMN IF NOT EXISTS wholesale_min_qty int,
  ADD COLUMN IF NOT EXISTS promo_type text,
  ADD COLUMN IF NOT EXISTS promo_value int,
  ADD COLUMN IF NOT EXISTS promo_start timestamptz,
  ADD COLUMN IF NOT EXISTS promo_end timestamptz;

-- Guard against invalid promo types at the database level.
DO $$ BEGIN
  ALTER TABLE product_variations
    ADD CONSTRAINT product_variations_promo_type_chk
    CHECK (promo_type IS NULL OR promo_type IN ('percent', 'fixed', 'price'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow staff (not just super_admin) to update variations, so they can edit
-- prices and run promotions. The existing super_admin policies remain.
DROP POLICY IF EXISTS "variations_staff_update" ON product_variations;
CREATE POLICY "variations_staff_update" ON product_variations FOR UPDATE TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');


-- >>>>>>>>>> 20260814090600_profile_email_and_staff_admin.sql <<<<<<<<<<

/*
# Show emails on profiles + let admins manage staff

The admin Staff screen could only show a truncated user id, because emails live
in auth.users which the browser client can't read. Mirror the email onto
profiles so staff can be identified properly.

  * profiles.email — filled on sign-up by the trigger, and backfilled here for
    accounts that already exist.
  * Super admins may update any profile (role / assigned store); this already
    worked via the existing policy, but admins also need to DELETE profiles
    when removing a team member.

Account creation itself is handled by the `manage-staff` edge function, which
holds the service-role key and verifies the caller is a super_admin.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;

-- Backfill emails for accounts created before this migration.
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id
  AND p.email IS DISTINCT FROM u.email;

-- Capture the email for every future sign-up.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, role, full_name, email)
  VALUES (
    new.id,
    'customer',
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    new.email
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Super admins can remove a profile (used when deleting a team member).
DROP POLICY IF EXISTS "profiles_admin_delete" ON profiles;
CREATE POLICY "profiles_admin_delete" ON profiles FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');

