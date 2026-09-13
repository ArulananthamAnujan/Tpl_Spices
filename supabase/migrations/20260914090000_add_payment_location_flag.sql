-- All payments are processed under one Square location for now (rather than
-- each store's own, some of which aren't configured correctly in Square yet).
-- This flag says which store's square_location_id to use for that, separate
-- from which store the customer actually picked for pickup/delivery.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_payment_location boolean NOT NULL DEFAULT false;

UPDATE stores SET is_payment_location = true WHERE name ILIKE '%doveton%';

-- Guarantee at least one store is flagged so checkout never has nothing to
-- fall back to — pick the first store alphabetically if Doveton wasn't found.
UPDATE stores SET is_payment_location = true
WHERE id = (SELECT id FROM stores ORDER BY name LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM stores WHERE is_payment_location = true);
