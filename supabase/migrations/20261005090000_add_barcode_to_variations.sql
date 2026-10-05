-- Barcode printed on shop shelf/pack labels (Admin → Barcode Labels).
-- Either a pack's own EAN/UPC, one imported from Square's UPC/SKU field during
-- the catalogue sync, or a generated in-store EAN-13 (200 prefix).
alter table product_variations add column if not exists barcode text;

create unique index if not exists product_variations_barcode_key
  on product_variations (barcode) where barcode is not null;
