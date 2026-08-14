/*
# Subcategories

Categories become a two-level tree so each section (Grocery & Spices,
Clothing) can hold top-level categories with subcategories underneath —
e.g. Grocery → Rice → Basmati.

  * categories.parent_id — NULL for a top-level category, otherwise the
    category it sits under.
  * A subcategory always belongs to the same section as its parent; the
    trigger below keeps that true even if a parent is moved between sections.
  * Deleting a parent promotes its children to top level (ON DELETE SET NULL)
    rather than silently destroying them.

Staff can manage categories too (they help run the catalogue), matching the
pricing permissions.
*/

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- A category may not be its own parent.
DO $$ BEGIN
  ALTER TABLE categories
    ADD CONSTRAINT categories_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Keep a subcategory in the same section as its parent, and stop a
-- subcategory from itself becoming a parent (two levels only).
CREATE OR REPLACE FUNCTION enforce_category_tree()
RETURNS trigger AS $$
DECLARE
  parent_section text;
  parent_parent uuid;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT section, parent_id INTO parent_section, parent_parent
    FROM categories WHERE id = NEW.parent_id;

    IF parent_section IS NULL THEN
      RAISE EXCEPTION 'Parent category not found';
    END IF;
    IF parent_parent IS NOT NULL THEN
      RAISE EXCEPTION 'Categories can only be nested one level deep';
    END IF;

    NEW.section := parent_section;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_category_tree ON categories;
CREATE TRIGGER trg_enforce_category_tree
  BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION enforce_category_tree();

-- When a parent moves section, move its children with it.
CREATE OR REPLACE FUNCTION sync_child_category_sections()
RETURNS trigger AS $$
BEGIN
  IF NEW.parent_id IS NULL AND NEW.section IS DISTINCT FROM OLD.section THEN
    UPDATE categories SET section = NEW.section
    WHERE parent_id = NEW.id AND section IS DISTINCT FROM NEW.section;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_child_category_sections ON categories;
CREATE TRIGGER trg_sync_child_category_sections
  AFTER UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION sync_child_category_sections();

-- Staff may manage categories as well as super admins.
DROP POLICY IF EXISTS "categories_staff_insert" ON categories;
CREATE POLICY "categories_staff_insert" ON categories FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'staff');

DROP POLICY IF EXISTS "categories_staff_update" ON categories;
CREATE POLICY "categories_staff_update" ON categories FOR UPDATE TO authenticated
  USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');

DROP POLICY IF EXISTS "categories_staff_delete" ON categories;
CREATE POLICY "categories_staff_delete" ON categories FOR DELETE TO authenticated
  USING (get_user_role() = 'staff');
