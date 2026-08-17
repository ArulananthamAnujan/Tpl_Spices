/*
# Restore product photos cleared by an earlier sync

The Square sync used to write image_url on every product, sending null for any
item Square had no picture for. Square holds no photos for this catalogue, so
each sync cleared the pictures added through the dashboard.

The sync no longer does this. This restores what it cleared:

  * Rice products shipped with photos in /public/images, so their paths are
    known and are put back here.
  * Photos uploaded or generated in the dashboard live in Supabase Storage
    under product-images/products/<product id> and product-images/ai/<product
    id>. Those are relinked from Admin -> Product Photos -> "Restore photos
    from storage", which can read the bucket listing.

Only products with no photo are touched, so nothing already set is overwritten.
*/

DO $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
    ('LOCAL-RICE-01', '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(1).jpeg'),
    ('LOCAL-RICE-02', '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(2).jpeg'),
    ('LOCAL-RICE-03', '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(3).jpeg'),
    ('LOCAL-RICE-04', '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(4).jpeg'),
    ('LOCAL-RICE-05', '/images/WhatsApp_Image_2026-06-16_at_6.24.46_PM_(5).jpeg'),
    ('LOCAL-RICE-06', '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(1).jpeg'),
    ('LOCAL-RICE-07', '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(2).jpeg'),
    ('LOCAL-RICE-08', '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(3).jpeg'),
    ('LOCAL-RICE-09', '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM_(4).jpeg'),
    ('LOCAL-RICE-10', '/images/WhatsApp_Image_2026-06-16_at_6.24.47_PM.jpeg'),
    ('LOCAL-RICE-11', '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(1).jpeg'),
    ('LOCAL-RICE-12', '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(2).jpeg'),
    ('LOCAL-RICE-13', '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(3).jpeg'),
    ('LOCAL-RICE-14', '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM_(4).jpeg'),
    ('LOCAL-RICE-15', '/images/WhatsApp_Image_2026-06-16_at_6.24.48_PM.jpeg'),
    ('LOCAL-RICE-16', '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM_(1).jpeg'),
    ('LOCAL-RICE-17', '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM_(2).jpeg'),
    ('LOCAL-RICE-18', '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM_(3).jpeg'),
    ('LOCAL-RICE-19', '/images/WhatsApp_Image_2026-06-16_at_6.24.49_PM.jpeg'),
    ('LOCAL-RICE-20', '/images/WhatsApp_Image_2026-06-16_at_6.24.50_PM_(1).jpeg')
    ) AS t(square_item_id, image_path)
  LOOP
    UPDATE products
    SET image_url = pair.image_path
    WHERE square_item_id = pair.square_item_id
      AND (image_url IS NULL OR image_url = '');
  END LOOP;
END $$;
