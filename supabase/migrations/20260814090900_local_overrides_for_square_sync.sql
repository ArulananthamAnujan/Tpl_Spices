/*
# Protect local edits from being overwritten by the Square sync

Square is the source of truth for the raw catalogue, but the shop manages
things Square doesn't know about: renamed categories, subcategories (Square
has no such concept), and its own retail pricing.

Without these flags, every "Sync from Square" would silently undo that work —
category names reset, products yanked back out of their subcategory, and
retail prices overwritten.

  * categories.name_overridden        — the name was edited here; sync leaves it
  * products.category_overridden      — the category/subcategory was chosen
                                        here; sync won't move the product
  * product_variations.price_overridden — retail price set here; sync won't
                                        overwrite it

Anything not flagged still follows Square, so new items and price changes from
Square keep flowing in as before.
*/

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS name_overridden boolean NOT NULL DEFAULT false;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_overridden boolean NOT NULL DEFAULT false;

ALTER TABLE product_variations
  ADD COLUMN IF NOT EXISTS price_overridden boolean NOT NULL DEFAULT false;

-- Staff and super admins both curate the catalogue, so both may reassign a
-- product's category. (Super admin already had full product update rights.)
DROP POLICY IF EXISTS "products_staff_update" ON products;
CREATE POLICY "products_staff_update" ON products FOR UPDATE TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');
