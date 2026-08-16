/*
# Let staff manage stock

  1. record_inventory_movement() rejected anyone who wasn't a super_admin, so
     staff could not update stock even though the Staff dashboard now has an
     Inventory tab. Staff may now record movements for their assigned store
     (super admins keep access to every store).
  2. The inventory_movements INSERT policy was likewise super_admin only.

The in/out reporting screen aggregates the ledger the dashboard already loads,
so it needs no extra database objects.
*/

-- 1. Recording a movement: allow staff (scoped to their store).
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
  caller_role text;
BEGIN
  caller_role := get_user_role();

  IF caller_role = 'staff' THEN
    IF get_staff_store_id() IS DISTINCT FROM p_store_id THEN
      RAISE EXCEPTION 'You can only update stock for your assigned store.';
    END IF;
  ELSIF caller_role <> 'super_admin' THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION record_inventory_movement(uuid, uuid, int, text, timestamptz, text) TO authenticated;

-- 2. Direct-insert policy: staff may write movements for their own store.
DROP POLICY IF EXISTS "inv_moves_staff_insert" ON inventory_movements;
CREATE POLICY "inv_moves_staff_insert" ON inventory_movements FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'staff' AND store_id = get_staff_store_id());

