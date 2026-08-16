-- ============================================================
-- Tpl Spices — verify the database setup
--
-- Run this in the Supabase SQL Editor AFTER running setup_all.sql.
-- Every row should say OK. Any MISSING row means setup_all.sql did not
-- finish — scroll up in the editor to find the first red error.
-- ============================================================

SELECT check_name, status FROM (
  -- Core inventory ledger
  SELECT 1 AS ord, 'inventory_movements table' AS check_name,
    CASE WHEN to_regclass('public.inventory_movements') IS NOT NULL
         THEN 'OK' ELSE 'MISSING' END AS status
  UNION ALL
  SELECT 2, 'record_inventory_movement() function',
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_inventory_movement')
         THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  -- Subcategories
  SELECT 3, 'categories.parent_id (subcategories)',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'categories' AND column_name = 'parent_id')
         THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  -- Wholesale + promotions
  SELECT 4, 'product_variations.wholesale_price_cents',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'product_variations' AND column_name = 'wholesale_price_cents')
         THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  SELECT 5, 'product_variations.promo_type',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'product_variations' AND column_name = 'promo_type')
         THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  -- Staff management
  SELECT 6, 'profiles.email (staff list)',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'profiles' AND column_name = 'email')
         THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  -- Square sync protection
  SELECT 7, 'products.category_overridden (sync safety)',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'products' AND column_name = 'category_overridden')
         THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  SELECT 8, 'product_variations.price_overridden (sync safety)',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'product_variations' AND column_name = 'price_overridden')
         THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  SELECT 9, 'newsletter_subscribers table',
    CASE WHEN to_regclass('public.newsletter_subscribers') IS NOT NULL
         THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  -- Login health: these two are what break sign-in with
  -- "Database error querying schema".
  SELECT 10, 'auth.users has no NULL tokens (login works)',
    CASE WHEN NOT EXISTS (
           SELECT 1 FROM auth.users
           WHERE confirmation_token IS NULL OR recovery_token IS NULL
              OR email_change IS NULL OR email_change_token_new IS NULL
         ) THEN 'OK' ELSE 'MISSING' END
  UNION ALL
  SELECT 11, 'handle_new_user() has search_path set',
    CASE WHEN EXISTS (
           SELECT 1 FROM pg_proc
           WHERE proname = 'handle_new_user'
             AND array_to_string(proconfig, ',') LIKE '%search_path%'
         ) THEN 'OK' ELSE 'MISSING' END
) checks
ORDER BY ord;

-- Ask PostgREST to pick up any brand-new tables, columns and functions
-- immediately, instead of waiting for its cache to refresh on its own.
-- (This is what fixes "Could not find ... in the schema cache".)
NOTIFY pgrst, 'reload schema';
