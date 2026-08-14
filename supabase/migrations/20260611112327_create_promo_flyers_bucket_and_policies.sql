INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('promo-flyers', 'promo-flyers', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'promo_flyers_public_read'
  ) THEN
    CREATE POLICY "promo_flyers_public_read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'promo-flyers');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'promo_flyers_admin_insert'
  ) THEN
    CREATE POLICY "promo_flyers_admin_insert"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'promo-flyers' AND
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'promo_flyers_admin_delete'
  ) THEN
    CREATE POLICY "promo_flyers_admin_delete"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'promo-flyers' AND
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
      );
  END IF;
END $$;
