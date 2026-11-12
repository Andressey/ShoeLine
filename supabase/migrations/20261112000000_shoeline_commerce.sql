create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  slug text not null unique,
  name text not null,
  brand text not null,
  category text not null,
  audience text not null default 'Unisex',
  description text not null default '',
  price integer not null check (price > 0),
  compare_at integer not null default 0 check (compare_at >= 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  inventory integer not null default 0 check (inventory >= 0),
  image_url text,
  icon text not null default '👟',
  color text not null default '#e5e3ee',
  badge text not null default '',
  is_new boolean not null default false,
  is_featured boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  alt_text text not null default '',
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, display_order)
);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Home',
  recipient_name text not null,
  phone text not null,
  line1 text not null,
  line2 text,
  city text not null,
  region text not null,
  postal_code text not null,
  country text not null default 'PH',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cart_items (
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cart_id, product_id)
);

create table if not exists public.wishlist_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('SL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  payment_method text not null default 'cash_on_delivery',
  currency text not null default 'PHP' check (currency = 'PHP'),
  subtotal integer not null check (subtotal >= 0),
  shipping_total integer not null default 0 check (shipping_total >= 0),
  total integer not null check (total >= 0),
  shipping_address jsonb not null,
  customer_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku text not null,
  product_name text not null,
  brand text not null,
  unit_price integer not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 20),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  provider_reference text unique,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  amount integer not null check (amount >= 0),
  currency text not null default 'PHP',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  changed_by uuid references public.profiles(id) on delete set null,
  change_amount integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  details text not null default '',
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'received', 'refunded', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  title text not null default '',
  body text not null default '',
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, user_id)
);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null default '',
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value integer not null check (discount_value > 0),
  minimum_subtotal integer not null default 0 check (minimum_subtotal >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  usage_count integer not null default 0 check (usage_count >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_account_members (
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'buyer' check (member_role in ('owner', 'buyer', 'approver')),
  created_at timestamptz not null default now(),
  primary key (business_account_id, user_id)
);

create table if not exists public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  business_account_id uuid references public.business_accounts(id) on delete set null,
  organization text not null,
  email text not null,
  quantity integer not null check (quantity > 0),
  notes text not null default '',
  status text not null default 'new' check (status in ('new', 'reviewing', 'quoted', 'accepted', 'declined', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  quoted_unit_price integer check (quoted_unit_price is null or quoted_unit_price >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.requisition_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  business_account_id uuid references public.business_accounts(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_list_id uuid not null references public.requisition_lists(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  quantity integer not null check (quantity between 1 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_activity_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists products_active_category_idx on public.products (is_active, category);
create index if not exists products_brand_idx on public.products (brand);
create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);
create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists returns_user_created_idx on public.return_requests (user_id, created_at desc);
create index if not exists quotes_status_created_idx on public.quote_requests (status, created_at desc);
create index if not exists reviews_product_approved_idx on public.product_reviews (product_id, is_approved);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Shoeline member'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.profiles (id, full_name)
select u.id, coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Shoeline member')
from auth.users u
on conflict (id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();

do $$
declare
  table_name text;
begin
  foreach table_name in array array['products', 'addresses', 'carts', 'cart_items', 'orders', 'payments', 'return_requests', 'promotions', 'business_accounts', 'quote_requests', 'requisition_lists']
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', table_name, table_name);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute procedure public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.addresses enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.return_requests enable row level security;
alter table public.product_reviews enable row level security;
alter table public.promotions enable row level security;
alter table public.business_accounts enable row level security;
alter table public.business_account_members enable row level security;
alter table public.quote_requests enable row level security;
alter table public.quote_items enable row level security;
alter table public.requisition_lists enable row level security;
alter table public.requisition_items enable row level security;
alter table public.admin_activity_logs enable row level security;

drop policy if exists "Profiles are visible to their owner and admins" on public.profiles;
create policy "Profiles are visible to their owner and admins" on public.profiles for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "Customers can create their own profile" on public.profiles;
create policy "Customers can create their own profile" on public.profiles for insert to authenticated with check (id = (select auth.uid()) and role = 'customer');
drop policy if exists "Customers can update their own name" on public.profiles;
create policy "Customers can update their own name" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()) and role = 'customer');
drop policy if exists "Admins can manage profiles" on public.profiles;
create policy "Admins can manage profiles" on public.profiles for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Active products are public" on public.products;
create policy "Active products are public" on public.products for select to anon, authenticated using (is_active or (select public.is_admin()));
drop policy if exists "Admins manage products" on public.products;
create policy "Admins manage products" on public.products for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Product images follow product visibility" on public.product_images;
create policy "Product images follow product visibility" on public.product_images for select to anon, authenticated using (
  exists (select 1 from public.products p where p.id = product_id and (p.is_active or (select public.is_admin())))
);
drop policy if exists "Admins manage product images" on public.product_images;
create policy "Admins manage product images" on public.product_images for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Users manage their addresses" on public.addresses;
create policy "Users manage their addresses" on public.addresses for all to authenticated using (user_id = (select auth.uid()) or (select public.is_admin())) with check (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "Users manage their carts" on public.carts;
create policy "Users manage their carts" on public.carts for all to authenticated using (user_id = (select auth.uid()) or (select public.is_admin())) with check (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "Users manage their cart items" on public.cart_items;
create policy "Users manage their cart items" on public.cart_items for all to authenticated using (
  exists (select 1 from public.carts c where c.id = cart_id and (c.user_id = (select auth.uid()) or (select public.is_admin())))
) with check (
  exists (select 1 from public.carts c where c.id = cart_id and (c.user_id = (select auth.uid()) or (select public.is_admin())))
);
drop policy if exists "Users manage their wishlist" on public.wishlist_items;
create policy "Users manage their wishlist" on public.wishlist_items for all to authenticated using (user_id = (select auth.uid()) or (select public.is_admin())) with check (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Users and admins can view orders" on public.orders;
create policy "Users and admins can view orders" on public.orders for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "Admins can update orders" on public.orders;
create policy "Admins can update orders" on public.orders for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Users and admins can view order items" on public.order_items;
create policy "Users and admins can view order items" on public.order_items for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or (select public.is_admin())))
);
drop policy if exists "Admins can manage payments" on public.payments;
create policy "Admins can manage payments" on public.payments for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Admins can view inventory movements" on public.inventory_movements;
create policy "Admins can view inventory movements" on public.inventory_movements for select to authenticated using ((select public.is_admin()));

drop policy if exists "Users view their return requests" on public.return_requests;
create policy "Users view their return requests" on public.return_requests for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "Users request returns on their orders" on public.return_requests;
create policy "Users request returns on their orders" on public.return_requests for insert to authenticated with check (
  user_id = (select auth.uid()) and status = 'requested'
  and exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid()))
);
drop policy if exists "Admins manage return requests" on public.return_requests;
create policy "Admins manage return requests" on public.return_requests for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Approved product reviews are public" on public.product_reviews;
create policy "Approved product reviews are public" on public.product_reviews for select to anon, authenticated using (is_approved or user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "Customers can write reviews" on public.product_reviews;
create policy "Customers can write reviews" on public.product_reviews for insert to authenticated with check (
  user_id = (select auth.uid()) and not is_approved
  and (order_id is null or exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())))
);
drop policy if exists "Admins manage reviews" on public.product_reviews;
create policy "Admins manage reviews" on public.product_reviews for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Active promotions are public" on public.promotions;
create policy "Active promotions are public" on public.promotions for select to anon, authenticated using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) or (select public.is_admin()));
drop policy if exists "Admins manage promotions" on public.promotions;
create policy "Admins manage promotions" on public.promotions for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Business members and admins view accounts" on public.business_accounts;
create policy "Business members and admins view accounts" on public.business_accounts for select to authenticated using (
  (select public.is_admin()) or exists (select 1 from public.business_account_members m where m.business_account_id = id and m.user_id = (select auth.uid()))
);
drop policy if exists "Admins manage business accounts" on public.business_accounts;
create policy "Admins manage business accounts" on public.business_accounts for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Business members and admins view members" on public.business_account_members;
create policy "Business members and admins view members" on public.business_account_members for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "Admins manage business members" on public.business_account_members;
create policy "Admins manage business members" on public.business_account_members for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Anyone can submit a quote request" on public.quote_requests;
create policy "Anyone can submit a quote request" on public.quote_requests for insert to anon, authenticated with check (
  (user_id is null or user_id = (select auth.uid())) and quantity > 0
);
drop policy if exists "Admins manage quote requests" on public.quote_requests;
create policy "Admins manage quote requests" on public.quote_requests for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Admins manage quote items" on public.quote_items;
create policy "Admins manage quote items" on public.quote_items for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Users manage their requisition lists" on public.requisition_lists;
create policy "Users manage their requisition lists" on public.requisition_lists for all to authenticated using (user_id = (select auth.uid()) or (select public.is_admin())) with check (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "Users manage their requisition items" on public.requisition_items;
create policy "Users manage their requisition items" on public.requisition_items for all to authenticated using (
  exists (select 1 from public.requisition_lists r where r.id = requisition_list_id and (r.user_id = (select auth.uid()) or (select public.is_admin())))
) with check (
  exists (select 1 from public.requisition_lists r where r.id = requisition_list_id and (r.user_id = (select auth.uid()) or (select public.is_admin())))
);
drop policy if exists "Admins view admin activity" on public.admin_activity_logs;
create policy "Admins view admin activity" on public.admin_activity_logs for select to authenticated using ((select public.is_admin()));
drop policy if exists "Admins write admin activity" on public.admin_activity_logs;
create policy "Admins write admin activity" on public.admin_activity_logs for insert to authenticated with check (admin_id = (select auth.uid()) and (select public.is_admin()));

grant select on public.products, public.product_images, public.promotions, public.product_reviews to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.addresses, public.carts, public.cart_items, public.wishlist_items, public.orders, public.order_items, public.payments, public.inventory_movements, public.return_requests, public.product_reviews, public.promotions, public.business_accounts, public.business_account_members, public.quote_requests, public.quote_items, public.requisition_lists, public.requisition_items, public.admin_activity_logs to authenticated;
grant insert on public.quote_requests to anon;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.create_order(
  p_items jsonb,
  p_shipping_address jsonb,
  p_customer_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal integer := 0;
  v_shipping integer;
begin
  if v_user_id is null then
    raise exception 'Sign in is required to place an order.';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'The cart is empty or contains too many products.';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception 'The cart is empty or contains too many products.';
  end if;
  if p_shipping_address is null or jsonb_typeof(p_shipping_address) <> 'object'
     or coalesce(trim(p_shipping_address ->> 'recipient_name'), '') = ''
     or coalesce(trim(p_shipping_address ->> 'phone'), '') = ''
     or coalesce(trim(p_shipping_address ->> 'line1'), '') = ''
     or coalesce(trim(p_shipping_address ->> 'city'), '') = ''
     or coalesce(trim(p_shipping_address ->> 'region'), '') = ''
     or coalesce(trim(p_shipping_address ->> 'postal_code'), '') = '' then
    raise exception 'Complete the required delivery address fields.';
  end if;

  insert into public.orders (user_id, status, payment_status, payment_method, subtotal, shipping_total, total, shipping_address, customer_note)
  values (v_user_id, 'pending', 'pending', 'cash_on_delivery', 0, 0, 0, p_shipping_address, left(coalesce(p_customer_note, ''), 1000))
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'A cart quantity is invalid.';
    end;
    if v_quantity is null or v_quantity < 1 or v_quantity > 20 then
      raise exception 'A cart quantity is outside the allowed range.';
    end if;

    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid and is_active
    for update;
    if not found then
      raise exception 'A product in your cart is no longer available.';
    end if;
    if v_product.inventory < v_quantity then
      raise exception 'Not enough stock for %.', v_product.name;
    end if;

    v_subtotal := v_subtotal + (v_product.price * v_quantity);
    insert into public.order_items (order_id, product_id, sku, product_name, brand, unit_price, quantity)
    values (v_order_id, v_product.id, v_product.sku, v_product.name, v_product.brand, v_product.price, v_quantity);
    update public.products set inventory = inventory - v_quantity where id = v_product.id;
    insert into public.inventory_movements (product_id, order_id, changed_by, change_amount, reason)
    values (v_product.id, v_order_id, v_user_id, -v_quantity, 'order placed');
  end loop;

  v_shipping := case when v_subtotal >= 250000 then 0 else 15000 end;
  update public.orders
  set subtotal = v_subtotal, shipping_total = v_shipping, total = v_subtotal + v_shipping
  where id = v_order_id;
  return v_order_id;
end;
$$;

grant execute on function public.create_order(jsonb, jsonb, text) to authenticated;

insert into public.products (sku, slug, name, brand, category, audience, description, price, compare_at, inventory, icon, color, badge, is_new, is_featured)
values
  ('SL-NK-001', 'air-pulse-runner', 'Air Pulse Runner', 'Nike', 'Running', 'Men', 'A responsive everyday runner with a soft ride and clean street-ready lines.', 389000, 459000, 50, '👟', '#d9d7e8', 'BESTSELLER', false, true),
  ('SL-AD-002', 'cloudfoam-street', 'Cloudfoam Street', 'Adidas', 'Lifestyle', 'Women', 'Lightweight cushioning meets a versatile silhouette for daily wear.', 329000, 0, 50, '👟', '#e5e8dd', 'NEW', true, true),
  ('SL-NB-003', 'retro-court-80', 'Retro Court 80', 'New Balance', 'Lifestyle', 'Men', 'A court-inspired classic with a premium feel and all-day comfort.', 419000, 499000, 50, '👟', '#e7d9ce', '-16%', false, true),
  ('SL-CV-004', 'everyday-canvas', 'Everyday Canvas', 'Converse', 'Lifestyle', 'Kids', 'An easy canvas staple made for everyday adventures.', 189000, 0, 50, '👟', '#d9e4ef', 'EASY DAY', false, false),
  ('SL-PM-005', 'velocity-pro', 'Velocity Pro', 'Puma', 'Running', 'Men', 'A lightweight trainer built for quick moves and everyday miles.', 299000, 359000, 50, '👟', '#e9d9e1', 'SALE', false, true),
  ('SL-AS-006', 'softstep-knit', 'SoftStep Knit', 'Asics', 'Running', 'Women', 'A breathable knit upper and cushioned platform for a smooth daily stride.', 349000, 0, 50, '👟', '#e3dfef', 'COMFORT', false, false),
  ('SL-NK-007', 'mini-motion', 'Mini Motion', 'Nike', 'Lifestyle', 'Kids', 'Easy-on comfort and a playful profile for little movers.', 219000, 259000, 50, '👟', '#e6e3d4', 'NEW', true, false),
  ('SL-AD-008', 'studio-classic', 'Studio Classic', 'Adidas', 'Lifestyle', 'Women', 'A simple, versatile classic that moves from studio days to city nights.', 279000, 329000, 50, '👟', '#d8e4e6', '-15%', false, false)
on conflict (sku) do nothing;
