-- Fix passwords: use bcrypt cost factor 10 (required by Supabase Auth)
UPDATE auth.users
SET encrypted_password = crypt('Admin@123', gen_salt('bf', 10))
WHERE email = 'admin@tplspices.com';

UPDATE auth.users
SET encrypted_password = crypt('Staff@123', gen_salt('bf', 10))
WHERE email = 'staff@tplspices.com';

UPDATE auth.users
SET encrypted_password = crypt('Customer@123', gen_salt('bf', 10))
WHERE email = 'customer@tplspices.com';
