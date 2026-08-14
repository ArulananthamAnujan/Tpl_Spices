-- Create demo users in auth.users
DO $$
DECLARE
  admin_id uuid := '00000001-0000-0000-0000-000000000001';
  staff_id uuid := '00000001-0000-0000-0000-000000000002';
  customer_id uuid := '00000001-0000-0000-0000-000000000003';
BEGIN
  -- Super Admin
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud)
  VALUES (
    admin_id,
    'admin@tplspices.com',
    crypt('Admin@123', gen_salt('bf')),
    now(),
    'authenticated',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"TPL Admin"}',
    now(),
    now(),
    'authenticated'
  ) ON CONFLICT (id) DO NOTHING;

  -- Staff
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud)
  VALUES (
    staff_id,
    'staff@tplspices.com',
    crypt('Staff@123', gen_salt('bf')),
    now(),
    'authenticated',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"TPL Staff"}',
    now(),
    now(),
    'authenticated'
  ) ON CONFLICT (id) DO NOTHING;

  -- Customer
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud)
  VALUES (
    customer_id,
    'customer@tplspices.com',
    crypt('Customer@123', gen_salt('bf')),
    now(),
    'authenticated',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Demo Customer"}',
    now(),
    now(),
    'authenticated'
  ) ON CONFLICT (id) DO NOTHING;

  -- Identities
  INSERT INTO auth.identities (id, user_id, provider, identity_data, created_at, updated_at, provider_id, last_sign_in_at)
  VALUES
    (admin_id, admin_id, 'email', jsonb_build_object('sub', admin_id::text, 'email', 'admin@tplspices.com'), now(), now(), 'admin@tplspices.com', now()),
    (staff_id, staff_id, 'email', jsonb_build_object('sub', staff_id::text, 'email', 'staff@tplspices.com'), now(), now(), 'staff@tplspices.com', now()),
    (customer_id, customer_id, 'email', jsonb_build_object('sub', customer_id::text, 'email', 'customer@tplspices.com'), now(), now(), 'customer@tplspices.com', now())
  ON CONFLICT (id) DO NOTHING;

  -- Profiles
  INSERT INTO profiles (id, role, full_name, phone, assigned_store_id)
  VALUES
    (admin_id, 'super_admin', 'TPL Admin', NULL, NULL),
    (staff_id, 'staff', 'TPL Staff', NULL, NULL),
    (customer_id, 'customer', 'Demo Customer', NULL, NULL)
  ON CONFLICT (id) DO NOTHING;
END $$;
