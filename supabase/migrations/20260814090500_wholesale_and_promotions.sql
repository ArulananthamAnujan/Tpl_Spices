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
