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
