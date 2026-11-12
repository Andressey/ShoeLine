update public.products
set image_url = 'https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=1200&q=85'
where sku = 'SL-NK-001' and nullif(image_url, '') is null;

update public.products
set image_url = 'https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?auto=format&fit=crop&w=1200&q=85'
where sku = 'SL-AD-002' and nullif(image_url, '') is null;

update public.products
set image_url = 'https://images.unsplash.com/photo-1608231387042-66d1773070a5?auto=format&fit=crop&w=1200&q=85'
where sku = 'SL-NB-003' and nullif(image_url, '') is null;

update public.products
set image_url = 'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?auto=format&fit=crop&w=1200&q=85'
where sku = 'SL-CV-004' and nullif(image_url, '') is null;

update public.products
set image_url = 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=85'
where sku = 'SL-PM-005' and nullif(image_url, '') is null;

update public.products
set image_url = 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?auto=format&fit=crop&w=1200&q=85'
where sku = 'SL-AS-006' and nullif(image_url, '') is null;

update public.products
set image_url = 'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?auto=format&fit=crop&w=1200&q=85'
where sku = 'SL-NK-007' and nullif(image_url, '') is null;

update public.products
set image_url = 'https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=1200&q=85'
where sku = 'SL-AD-008' and nullif(image_url, '') is null;

update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('georgeandreiguiang@gmail.com')
  and u.email_confirmed_at is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shoeline-product-images',
  'shoeline-product-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Shoeline product images are public" on storage.objects;
create policy "Shoeline product images are public"
on storage.objects for select to anon, authenticated
using (bucket_id = 'shoeline-product-images');

drop policy if exists "Admins upload Shoeline product images" on storage.objects;
create policy "Admins upload Shoeline product images"
on storage.objects for insert to authenticated
with check (bucket_id = 'shoeline-product-images' and (select public.is_admin()));

drop policy if exists "Admins update Shoeline product images" on storage.objects;
create policy "Admins update Shoeline product images"
on storage.objects for update to authenticated
using (bucket_id = 'shoeline-product-images' and (select public.is_admin()))
with check (bucket_id = 'shoeline-product-images' and (select public.is_admin()));

drop policy if exists "Admins delete Shoeline product images" on storage.objects;
create policy "Admins delete Shoeline product images"
on storage.objects for delete to authenticated
using (bucket_id = 'shoeline-product-images' and (select public.is_admin()));

drop policy if exists "Customers can write reviews" on public.product_reviews;
create policy "Customers can write verified-purchase reviews"
on public.product_reviews for insert to authenticated
with check (
  user_id = (select auth.uid())
  and not is_approved
  and order_id is not null
  and exists (
    select 1
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.id = product_reviews.order_id
      and o.user_id = (select auth.uid())
      and o.status = 'delivered'
      and oi.product_id = product_reviews.product_id
  )
);

create or replace function public.admin_grant_user_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Owner access is required.';
  end if;
  if nullif(trim(p_email), '') is null then
    raise exception 'Enter the account email address.';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = lower(trim(p_email))
    and email_confirmed_at is not null;
  if not found then
    raise exception 'No verified account was found for that email.';
  end if;

  update public.profiles
  set role = 'admin'
  where id = v_user_id;
  if not found then
    raise exception 'The account profile is not ready.';
  end if;

  insert into public.admin_activity_logs (admin_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'granted admin access', 'profile', v_user_id, jsonb_build_object('email', lower(trim(p_email))));
  return v_user_id;
end;
$$;

create or replace function public.admin_update_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Owner access is required.';
  end if;
  if p_status is null or p_status not in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded') then
    raise exception 'Choose a valid order status.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.status = p_status then
    return;
  end if;
  if v_order.status in ('delivered', 'cancelled', 'refunded') then
    raise exception 'Delivered, cancelled, and refunded orders cannot be reopened.';
  end if;

  if p_status = 'cancelled' then
    for v_item in
      select product_id, quantity
      from public.order_items
      where order_id = p_order_id and product_id is not null
    loop
      update public.products
      set inventory = inventory + v_item.quantity
      where id = v_item.product_id;

      insert into public.inventory_movements (product_id, order_id, changed_by, change_amount, reason)
      values (v_item.product_id, p_order_id, auth.uid(), v_item.quantity, 'order cancelled; stock restored');
    end loop;
  end if;

  update public.orders
  set status = p_status
  where id = p_order_id;

  insert into public.admin_activity_logs (admin_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'changed order status', 'order', p_order_id, jsonb_build_object('status', p_status));
end;
$$;

create or replace function public.admin_delete_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Owner access is required.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.status not in ('delivered', 'cancelled') then
    raise exception 'Only delivered or cancelled orders can be deleted.';
  end if;

  insert into public.admin_activity_logs (admin_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'deleted order',
    'order',
    p_order_id,
    jsonb_build_object('order_number', v_order.order_number, 'status', v_order.status)
  );
  delete from public.orders where id = p_order_id;
end;
$$;

grant execute on function public.admin_update_order_status(uuid, text) to authenticated;
grant execute on function public.admin_delete_order(uuid) to authenticated;
grant execute on function public.admin_grant_user_admin(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
     ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end;
$$;
