/*
# Seed a real category taxonomy for both storefront sections

These are starting points, not fixed — once this migration runs, admins can
rename, reassign, or delete any of them from Admin → Categories (new CRUD UI).
Uses a `local:` square_id prefix so these never collide with real category
IDs pulled in from a Square catalogue sync.

Clothing: adds Men / Women / Kids as top-level categories, alongside whatever
garment-type categories (Sarees, Shirts, etc.) already exist from Square.

Grocery: adds a category set typical of a Sri Lankan / Indian grocery store,
since the existing catalogue only has ad-hoc categories from whatever was
synced from Square so far.
*/

INSERT INTO categories (square_id, name, section, is_brand, sort_order)
VALUES
  ('local:clothing:women', 'Women', 'clothing', false, 100),
  ('local:clothing:men', 'Men', 'clothing', false, 101),
  ('local:clothing:kids', 'Kids', 'clothing', false, 102)
ON CONFLICT (square_id) DO NOTHING;

INSERT INTO categories (square_id, name, section, is_brand, sort_order)
VALUES
  ('local:grocery:spices-seasonings', 'Spices & Seasonings', 'grocery', false, 200),
  ('local:grocery:rice-grains', 'Rice & Grains', 'grocery', false, 201),
  ('local:grocery:lentils-pulses', 'Lentils & Pulses', 'grocery', false, 202),
  ('local:grocery:flours-baking', 'Flours & Baking', 'grocery', false, 203),
  ('local:grocery:cooking-oil-ghee', 'Cooking Oil & Ghee', 'grocery', false, 204),
  ('local:grocery:sauces-chutneys-pickles', 'Sauces, Chutneys & Pickles', 'grocery', false, 205),
  ('local:grocery:noodles-pasta', 'Noodles & Pasta', 'grocery', false, 206),
  ('local:grocery:snacks-namkeen', 'Snacks & Namkeen', 'grocery', false, 207),
  ('local:grocery:frozen-foods', 'Frozen Foods', 'grocery', false, 208),
  ('local:grocery:fresh-chilled', 'Fresh & Chilled', 'grocery', false, 209),
  ('local:grocery:tinned-packaged', 'Tinned & Packaged Foods', 'grocery', false, 210),
  ('local:grocery:tea-coffee', 'Tea & Coffee', 'grocery', false, 211),
  ('local:grocery:beverages-drinks', 'Beverages & Drinks', 'grocery', false, 212),
  ('local:grocery:sweets-desserts', 'Sweets & Desserts', 'grocery', false, 213),
  ('local:grocery:household-personal-care', 'Household & Personal Care', 'grocery', false, 214)
ON CONFLICT (square_id) DO NOTHING;
