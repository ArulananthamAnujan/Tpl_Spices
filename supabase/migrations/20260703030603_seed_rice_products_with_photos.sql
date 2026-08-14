DO $$
DECLARE
  rice_cat_id uuid := 'add341b2-0f40-490a-897e-1480fe04626f';
  p1  uuid := gen_random_uuid(); p2  uuid := gen_random_uuid(); p3  uuid := gen_random_uuid();
  p4  uuid := gen_random_uuid(); p5  uuid := gen_random_uuid(); p6  uuid := gen_random_uuid();
  p7  uuid := gen_random_uuid(); p8  uuid := gen_random_uuid(); p9  uuid := gen_random_uuid();
  p10 uuid := gen_random_uuid(); p11 uuid := gen_random_uuid(); p12 uuid := gen_random_uuid();
  p13 uuid := gen_random_uuid(); p14 uuid := gen_random_uuid(); p15 uuid := gen_random_uuid();
  p16 uuid := gen_random_uuid(); p17 uuid := gen_random_uuid(); p18 uuid := gen_random_uuid();
  p19 uuid := gen_random_uuid(); p20 uuid := gen_random_uuid();
BEGIN
  -- Ensure the Rice category exists (originally expected from a Square sync).
  -- Idempotent so re-running the setup is safe.
  INSERT INTO categories (id, square_id, name, sort_order)
  VALUES (rice_cat_id, 'LOCAL-CAT-RICE', 'Rice', 10)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO products (id, square_item_id, category_id, name, image_url, active) VALUES
    (p1,  'LOCAL-RICE-01', rice_cat_id, 'Derana Red Raw Keeri Samba Rice 5kg',          '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(1).jpeg', true),
    (p2,  'LOCAL-RICE-02', rice_cat_id, 'Araliya Keeri Samba Rice 5kg',                  '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(2).jpeg', true),
    (p3,  'LOCAL-RICE-03', rice_cat_id, 'Athavan Keeri Samba Rice 5kg',                  '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(3).jpeg', true),
    (p4,  'LOCAL-RICE-04', rice_cat_id, 'Sri Ayyappa Jaffna Special Parboiled Rice 5kg', '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(4).jpeg', true),
    (p5,  'LOCAL-RICE-05', rice_cat_id, 'Derana Red Raw Rice 5kg',                       '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(5).jpeg', true),
    (p6,  'LOCAL-RICE-06', rice_cat_id, 'Derana White Raw Rice 5kg',                     '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(1).jpeg', true),
    (p7,  'LOCAL-RICE-07', rice_cat_id, 'Leela Red Raw Rice 5kg',                        '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(2).jpeg', true),
    (p8,  'LOCAL-RICE-08', rice_cat_id, 'Athavan Red Rice Lite 5kg',                     '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(3).jpeg', true),
    (p9,  'LOCAL-RICE-09', rice_cat_id, 'Derana Muthu Samba Rice 5kg',                   '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(4).jpeg', true),
    (p10, 'LOCAL-RICE-10', rice_cat_id, 'Athavan Muthu Samba Rice 5kg',                  '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM.jpeg',    true),
    (p11, 'LOCAL-RICE-11', rice_cat_id, 'Athavan Supiri Keeri Samba Rice 5kg',           '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(1).jpeg', true),
    (p12, 'LOCAL-RICE-12', rice_cat_id, 'Athavan Red Nadu Rice 5kg',                     '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(2).jpeg', true),
    (p13, 'LOCAL-RICE-13', rice_cat_id, 'Derana Wholegrain Red Rice 5kg',                '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(3).jpeg', true),
    (p14, 'LOCAL-RICE-14', rice_cat_id, 'Athavan Red Raw Rice Jaffna Special 5kg',       '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(4).jpeg', true),
    (p15, 'LOCAL-RICE-15', rice_cat_id, 'Athavan Kiribath Rice 5kg',                     '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM.jpeg',    true),
    (p16, 'LOCAL-RICE-16', rice_cat_id, 'Derana White Keeri Samba Rice 5kg',             '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM_(1).jpeg', true),
    (p17, 'LOCAL-RICE-17', rice_cat_id, 'Derana Suduru Samba Rice 5kg',                  '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM_(2).jpeg', true),
    (p18, 'LOCAL-RICE-18', rice_cat_id, 'Derana Nadu Rice 5kg',                          '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM_(3).jpeg', true),
    (p19, 'LOCAL-RICE-19', rice_cat_id, 'Sri Ayyappa Mottaikaruppan Parboiled Rice 5kg', '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM.jpeg',    true),
    (p20, 'LOCAL-RICE-20', rice_cat_id, 'Golden Crop Wholesome Red Rice 5kg',            '/images/WhatsApp_Image_2026-06-16_at_6.24.50_PM_(1).jpeg', true)
  ON CONFLICT (square_item_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 1000, 'AUD'
  FROM products
  WHERE square_item_id LIKE 'LOCAL-RICE-%'
  ON CONFLICT (square_variation_id) DO NOTHING;
END $$;
