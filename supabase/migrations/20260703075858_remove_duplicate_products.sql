-- Deactivate the duplicate/inferior copy of each repeated product.
-- For each pair, we keep the product with the better image or cleaner name.

UPDATE products SET active = false WHERE id IN (
  'b3213b5d-e12f-40d3-9764-bfcd9338d3a4', -- "Araliya  Keeri Samba Rice 5kg" (double-space name) — keep b745de5a
  '0796b1d5-d496-4c33-bf69-e55f085bfcc5', -- "Athavan Kiribath Rice 5kg" no image — keep 2f727110 (AI image)
  'eb5dd298-a99a-4dad-84fc-a4f8d19f1947', -- "Athavan Muthu Samba Rice 5kg" duplicate — keep d65dc238
  '532c1591-efcf-42bb-a6c4-0e9e078f852e', -- "Athavan Red Nadu Rice 5kg" duplicate — keep 99a2c8d9
  '88467439-2117-4935-8ca9-95c08c126987', -- "Athavan Red Rice Lite 5kg" duplicate — keep 303955fe
  '6c05b95a-4d12-41fc-a7bd-b1ec60051c60'  -- "Leela Red Raw Rice 5kg" openfoodfacts placeholder — keep 66c4ec1a (AI image)
);