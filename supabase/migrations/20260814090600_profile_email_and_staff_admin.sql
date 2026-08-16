/*
# Show emails on profiles + let admins manage staff

The admin Staff screen could only show a truncated user id, because emails live
in auth.users which the browser client can't read. Mirror the email onto
profiles so staff can be identified properly.

  * profiles.email — filled on sign-up by the trigger, and backfilled here for
    accounts that already exist.
  * Super admins may update any profile (role / assigned store); this already
    worked via the existing policy, but admins also need to DELETE profiles
    when removing a team member.

Account creation itself is handled by the `manage-staff` edge function, which
holds the service-role key and verifies the caller is a super_admin.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;

-- Backfill emails for accounts created before this migration.
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id
  AND p.email IS DISTINCT FROM u.email;

-- Capture the email for every future sign-up.
--
-- IMPORTANT: this trigger is fired by the Auth service (GoTrue), which runs
-- with its own search_path — not public. It must therefore keep
-- `SET search_path = public` and schema-qualify the table, exactly as the
-- earlier search_path fix established. Without that, every sign-in and
-- sign-up fails with "Database error querying schema".
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, email)
  VALUES (
    new.id,
    'customer',
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    new.email
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Super admins can remove a profile (used when deleting a team member).
DROP POLICY IF EXISTS "profiles_admin_delete" ON profiles;
CREATE POLICY "profiles_admin_delete" ON profiles FOR DELETE TO authenticated
  USING (get_user_role() = 'super_admin');
