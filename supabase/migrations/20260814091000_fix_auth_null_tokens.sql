/*
# Fix "Database error querying schema" on sign-in

The demo accounts were inserted straight into auth.users without GoTrue's
token columns, so those columns are NULL. GoTrue reads them into plain Go
strings, and a NULL there aborts the query with:

    Database error querying schema

which blocks sign-in for every user, not just the demo ones. The fix is to
store empty strings instead of NULL — that is what GoTrue writes itself.

Columns are patched only if they exist, since the set differs between Auth
versions. Safe to re-run.
*/

DO $$
DECLARE
  col text;
  token_cols text[] := ARRAY[
    'confirmation_token',
    'recovery_token',
    'email_change',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change',
    'phone_change_token',
    'reauthentication_token'
  ];
BEGIN
  FOREACH col IN ARRAY token_cols LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = col
    ) THEN
      EXECUTE format('UPDATE auth.users SET %I = %L WHERE %I IS NULL', col, '', col);
    END IF;
  END LOOP;
END $$;
