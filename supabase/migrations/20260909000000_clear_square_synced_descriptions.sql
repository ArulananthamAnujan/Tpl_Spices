-- Square item descriptions contained unrelated internal info and are no
-- longer synced (see supabase/functions/sync-catalog). Clear out values
-- that were previously pulled in from Square.
update products set description = null;
