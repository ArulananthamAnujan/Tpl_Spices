CREATE TABLE IF NOT EXISTS promo_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  subtitle text,
  image_url text,
  discount_label text,
  cta_text text,
  cta_link text,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  start_date date,
  end_date date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE promo_slides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_active_slides" ON promo_slides FOR SELECT
  TO anon, authenticated USING (active = true);

CREATE POLICY "super_admin_insert_slides" ON promo_slides FOR INSERT
  TO authenticated WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'super_admin'
  );

CREATE POLICY "super_admin_update_slides" ON promo_slides FOR UPDATE
  TO authenticated USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'super_admin'
  ) WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'super_admin'
  );

CREATE POLICY "super_admin_delete_slides" ON promo_slides FOR DELETE
  TO authenticated USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'super_admin'
  );
