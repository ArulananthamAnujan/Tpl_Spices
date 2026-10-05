-- Tables for Admin → Barcode Labels. These are the label tool's own products,
-- kept separate from the shop catalogue (products / product_variations) that
-- is synced from Square.

create table if not exists label_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_cents integer not null default 0 check (price_cents >= 0),
  category text,
  barcode text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists label_products_name_idx on label_products (lower(name));

-- Single row (id = 1) holding the business details printed on every label.
create table if not exists label_settings (
  id integer primary key default 1 check (id = 1),
  business_name text not null default 'TPL Spices & Groceries',
  address text not null default '',
  phone text not null default '',
  updated_at timestamptz not null default now()
);

insert into label_settings (id) values (1) on conflict (id) do nothing;

alter table label_products enable row level security;
alter table label_settings enable row level security;

drop policy if exists "label_products_admin_all" on label_products;
create policy "label_products_admin_all" on label_products for all to authenticated
  using (get_user_role() = 'super_admin') with check (get_user_role() = 'super_admin');

drop policy if exists "label_settings_admin_all" on label_settings;
create policy "label_settings_admin_all" on label_settings for all to authenticated
  using (get_user_role() = 'super_admin') with check (get_user_role() = 'super_admin');
