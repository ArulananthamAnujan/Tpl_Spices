-- Kitchenware and pooja/religious items were lumped under the general
-- "Grocery & Spices" section just because the section column only allowed
-- grocery/clothing. Give them their own nav sections instead.
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_section_check;
ALTER TABLE categories
  ADD CONSTRAINT categories_section_check
  CHECK (section IN ('grocery', 'clothing', 'kitchen', 'pooja'));

UPDATE categories SET section = 'kitchen' WHERE name ILIKE '%kitchen%';
UPDATE categories SET section = 'pooja' WHERE name ILIKE '%pooja%';
