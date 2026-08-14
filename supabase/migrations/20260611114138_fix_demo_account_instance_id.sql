-- Fix instance_id required by Supabase GoTrue for password auth
UPDATE auth.users
SET instance_id = '00000000-0000-0000-0000-000000000000'
WHERE email IN ('admin@tplspices.com', 'staff@tplspices.com', 'customer@tplspices.com');

-- Also ensure encrypted_password is fresh with cost 10
UPDATE auth.users SET encrypted_password = crypt('Admin@123', gen_salt('bf', 10)) WHERE email = 'admin@tplspices.com';
UPDATE auth.users SET encrypted_password = crypt('Staff@123', gen_salt('bf', 10)) WHERE email = 'staff@tplspices.com';
UPDATE auth.users SET encrypted_password = crypt('Customer@123', gen_salt('bf', 10)) WHERE email = 'customer@tplspices.com';
