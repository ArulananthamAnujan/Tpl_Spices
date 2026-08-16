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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
