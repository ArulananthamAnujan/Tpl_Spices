/*
# Add delivery fee to stores

Adds an admin-editable flat delivery fee per store, defaulting to 0 (free)
until an admin sets a real amount. Charged as a separate Square line item
by the create-order function when fulfillment_type = DELIVERY.
*/

ALTER TABLE stores ADD COLUMN IF NOT EXISTS delivery_fee_cents int NOT NULL DEFAULT 0;
