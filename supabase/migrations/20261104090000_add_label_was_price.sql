-- Admin → Barcode Labels: optional "was" (original) price, printed struck
-- through next to the current price. Null means no discount is shown.

alter table label_products
  add column if not exists was_price_cents integer check (was_price_cents is null or was_price_cents >= 0);
