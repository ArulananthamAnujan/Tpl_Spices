ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_brand boolean NOT NULL DEFAULT false;
