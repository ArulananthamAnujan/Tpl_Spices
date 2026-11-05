-- Security hardening. Run this whole file once in Supabase → SQL Editor.
-- Safe to re-run.
--
-- What it fixes:
--  1. Demo accounts with public passwords (admin@tplspices.com / Admin@123,
--     staff@…/Staff@123, customer@…/Customer@123 — published in this public
--     repo). Any of them still on that password gets a random one, so nobody
--     can log in with it. If you use one of these accounts yourself, set a new
--     password afterwards in Supabase → Authentication → Users.
--  2. Any signed-in customer could make themselves admin by editing the role
--     on their own profile.
--  3. Any signed-in user could read every profile (names and phone numbers).
--  4. Customers could create unpaid orders directly and edit their orders
--     (status, totals, store). Orders are now created only by the checkout
--     function after payment; staff can change only an order's status.
--  5. Any signed-in user could upload, replace or delete product images.
--  6. Anyone, even without logging in, could change stock through the
--     inventory functions.

-- ------------------------------------------------------------
-- 1. Lock demo accounts that still use the published passwords
-- ------------------------------------------------------------
update auth.users
set encrypted_password = crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf', 10))
where (email = 'admin@tplspices.com'    and encrypted_password = crypt('Admin@123',    encrypted_password))
   or (email = 'staff@tplspices.com'    and encrypted_password = crypt('Staff@123',    encrypted_password))
   or (email = 'customer@tplspices.com' and encrypted_password = crypt('Customer@123', encrypted_password));

-- ------------------------------------------------------------
-- 2 & 3. Profiles
-- ------------------------------------------------------------
drop policy if exists "profiles_select_authenticated" on profiles;
drop policy if exists "profiles_own_select" on profiles;
create policy "profiles_own_select" on profiles for select to authenticated
  using (auth.uid() = id or get_user_role() = 'super_admin');

-- Only a super admin may set role or assigned store. Requests made with the
-- service role or from the SQL editor (no signed-in user) are not limited.
create or replace function protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or get_user_role() is not distinct from 'super_admin' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.role := 'customer';
    new.assigned_store_id := null;
  elsif new.role is distinct from old.role
     or new.assigned_store_id is distinct from old.assigned_store_id then
    raise exception 'Not allowed to change role or assigned store';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privileges on profiles;
create trigger trg_protect_profile_privileges
  before insert or update on profiles
  for each row execute function protect_profile_privileges();

-- ------------------------------------------------------------
-- 4. Orders
-- ------------------------------------------------------------
drop policy if exists "orders_insert" on orders;
drop policy if exists "order_items_insert" on order_items;

drop policy if exists "orders_update" on orders;
create policy "orders_update" on orders for update to authenticated
  using (
    get_user_role() = 'super_admin'
    or (get_user_role() = 'staff' and store_id = get_staff_store_id())
  )
  with check (
    get_user_role() = 'super_admin'
    or (get_user_role() = 'staff' and store_id = get_staff_store_id())
  );

-- Staff may change only the status of an order.
create or replace function protect_order_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or get_user_role() is not distinct from 'super_admin' then
    return new;
  end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Only the order status can be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_order_fields on orders;
create trigger trg_protect_order_fields
  before update on orders
  for each row execute function protect_order_fields();

-- ------------------------------------------------------------
-- 5. Product images: only super admins may write
-- ------------------------------------------------------------
drop policy if exists "product_images_admin_insert" on storage.objects;
drop policy if exists "product_images_admin_update" on storage.objects;
drop policy if exists "product_images_admin_delete" on storage.objects;

create policy "product_images_admin_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.get_user_role() = 'super_admin');
create policy "product_images_admin_update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.get_user_role() = 'super_admin')
  with check (bucket_id = 'product-images' and public.get_user_role() = 'super_admin');
create policy "product_images_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.get_user_role() = 'super_admin');

-- ------------------------------------------------------------
-- 6. Inventory functions
-- ------------------------------------------------------------
-- The old check `get_user_role() <> 'super_admin'` let through callers with
-- no profile (not logged in), because NULL <> 'x' is not true.
create or replace function record_inventory_movement(
  p_store_id uuid,
  p_variation_id uuid,
  p_delta int,
  p_reason text default 'adjustment',
  p_received_at timestamptz default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cur int;
  new_id uuid;
begin
  if get_user_role() is distinct from 'super_admin' then
    raise exception 'Not authorized';
  end if;
  if p_delta = 0 then
    raise exception 'Change must be a non-zero amount';
  end if;
  if p_reason not in ('received', 'adjustment', 'initial') then
    raise exception 'Invalid reason';
  end if;

  select quantity into cur from store_inventory
    where store_id = p_store_id and variation_id = p_variation_id;
  cur := coalesce(cur, 0);

  if cur + p_delta < 0 then
    raise exception 'Insufficient stock: have %, requested change %', cur, p_delta;
  end if;

  insert into inventory_movements (store_id, variation_id, delta, reason, received_at, note, created_by)
  values (
    p_store_id, p_variation_id, p_delta, p_reason,
    case when p_delta > 0 then coalesce(p_received_at, now()) else null end,
    left(p_note, 500),
    auth.uid()
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function record_inventory_movement(uuid, uuid, int, text, timestamptz, text) from public, anon;
grant execute on function record_inventory_movement(uuid, uuid, int, text, timestamptz, text) to authenticated;

-- Only the checkout function (service role) records sales.
alter function decrement_store_inventory(uuid, uuid, int, uuid) set search_path = public;
revoke all on function decrement_store_inventory(uuid, uuid, int, uuid) from public, anon, authenticated;
grant execute on function decrement_store_inventory(uuid, uuid, int, uuid) to service_role;

alter function apply_inventory_movement() set search_path = public;
revoke all on function apply_inventory_movement() from public, anon, authenticated;
alter function handle_new_user() set search_path = public;
revoke all on function handle_new_user() from public, anon, authenticated;
revoke all on function protect_profile_privileges() from public, anon, authenticated;
revoke all on function protect_order_fields() from public, anon, authenticated;

-- ------------------------------------------------------------
-- Newsletter: reject junk sign-ups
-- ------------------------------------------------------------
do $$ begin
  alter table newsletter_subscribers
    add constraint newsletter_email_format
    check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') not valid;
exception when duplicate_object then null; end $$;
