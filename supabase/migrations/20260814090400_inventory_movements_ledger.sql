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
