-- Runs the Square catalogue sync automatically three times a day:
-- 7am, 1pm and 8pm Sydney time during daylight saving (AEDT, UTC+11).
-- pg_cron runs in UTC, so outside daylight saving (AEST, UTC+10) these
-- land an hour earlier: 6am, 12pm and 7pm.
--
-- Before running this, store the project's anon key in Vault once:
--   select vault.create_secret('<anon key>', 'sync_catalog_key');
-- (Project Settings → API → "anon public" key.)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running this file replaces the jobs instead of duplicating them.
select cron.unschedule(jobname) from cron.job
where jobname in ('square-sync-morning', 'square-sync-afternoon', 'square-sync-night');

create or replace function public.run_square_catalog_sync()
returns void
language sql
security definer
set search_path = public
as $$
  select net.http_post(
    url := 'https://mzsodhucpwqmtajkvnol.supabase.co/functions/v1/sync-catalog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'sync_catalog_key'
      )
    ),
    body := jsonb_build_object('square_env', 'production'),
    timeout_milliseconds := 150000
  );
$$;

revoke all on function public.run_square_catalog_sync() from public, anon, authenticated;

select cron.schedule('square-sync-morning',   '0 20 * * *', 'select public.run_square_catalog_sync()');
select cron.schedule('square-sync-afternoon', '0 2 * * *',  'select public.run_square_catalog_sync()');
select cron.schedule('square-sync-night',     '0 9 * * *',  'select public.run_square_catalog_sync()');
