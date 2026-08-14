ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'grocery'
  CHECK (section IN ('grocery', 'clothing'));
