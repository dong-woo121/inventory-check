-- 재고확인 · Supabase Postgres schema (run once using SQL Editor as project owner)
-- No public signup is required: invite users through Supabase Auth dashboard.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'worker' check (role in ('admin','worker')),
  created_at timestamptz not null default now()
);
create or replace function public.create_profile_for_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id,email,display_name)
  values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'name',new.email))
  on conflict (user_id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created_inventory on auth.users;
create trigger on_auth_user_created_inventory after insert on auth.users
for each row execute function public.create_profile_for_user();
insert into public.profiles(user_id,email,display_name)
select id,coalesce(email,''),coalesce(raw_user_meta_data->>'name',email)
from auth.users on conflict (user_id) do nothing;

-- SECURITY DEFINER avoids recursive profiles RLS lookups. Never make it callable by anon.
create or replace function public.is_inventory_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = (select auth.uid()) and role='admin');
$$;
revoke all on function public.is_inventory_admin() from public, anon;
grant execute on function public.is_inventory_admin() to authenticated;

create table if not exists public.products (
 id text primary key, name text not null unique, display_order int not null unique,
 active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.product_aliases (
 id uuid primary key default gen_random_uuid(), product_id text not null references public.products(id) on delete cascade,
 label text not null, norm_key text generated always as (lower(regexp_replace(label,'[[:space:]_.·()\[\]]+','','g'))) stored,
 created_at timestamptz not null default now(), unique(norm_key)
);
create table if not exists public.bundles (
 id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.bundle_aliases (
 id uuid primary key default gen_random_uuid(), bundle_id uuid not null references public.bundles(id) on delete cascade,
 label text not null, norm_key text generated always as (lower(regexp_replace(label,'[[:space:]_.·()\[\]]+','','g'))) stored,
 unique(norm_key)
);
create table if not exists public.bundle_components (
 bundle_id uuid not null references public.bundles(id) on delete cascade,
 product_id text not null references public.products(id), quantity integer not null check (quantity>0),
 primary key(bundle_id,product_id)
);
create table if not exists public.gift_rules (
 id uuid primary key default gen_random_uuid(), label text not null,
 norm_key text generated always as (lower(regexp_replace(label,'[[:space:]_.·()\[\]]+','','g'))) stored,
 unique(norm_key)
);
create table if not exists public.alias_requests (
 id uuid primary key default gen_random_uuid(), proposed_label text not null,
 norm_key text generated always as (lower(regexp_replace(proposed_label,'[[:space:]_.·()\[\]]+','','g'))) stored,
 suggested_product_id text references public.products(id),
 requested_by uuid not null default auth.uid() references public.profiles(user_id),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reviewed_by uuid references public.profiles(user_id), reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 constraint alias_requests_review_consistency check ((status='pending' and reviewed_by is null and reviewed_at is null) or (status<>'pending' and reviewed_by is not null and reviewed_at is not null)),
 unique(requested_by,norm_key)
);
create table if not exists public.order_batches (
 id uuid primary key default gen_random_uuid(), batch_date date not null default current_date,
 title text not null default '주문 취합', created_by uuid not null references public.profiles(user_id),
 created_at timestamptz not null default now(), status text not null check(status in ('validated','needs_review')),
 raw_text text not null, result_snapshot jsonb not null,
 row_count integer not null check(row_count>=0), error_count integer not null check(error_count>=0),
 total_quantity bigint not null check(total_quantity>=0)
);
create table if not exists public.order_lines (
 id bigint generated always as identity primary key,
 batch_id uuid not null references public.order_batches(id) on delete cascade,
 line_number integer not null check(line_number>0), raw_text text not null,
 status text not null check(status in ('ok','gift','error')),
 calculated_items jsonb not null default '[]'::jsonb,
 detail text, unique(batch_id,line_number)
);
create index if not exists order_batches_created_at_idx on public.order_batches(created_at desc);
create index if not exists order_lines_batch_id_idx on public.order_lines(batch_id);
create table if not exists public.audit_logs (
 id bigint generated always as identity primary key, actor_id uuid references public.profiles(user_id),
 action text not null, entity text not null, entity_id text, detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

-- RLS: read catalog as signed-in employee, only admins mutate approved catalog.
-- History is append-only: changes to aliases never silently rewrite past batches.
do $$ declare t text; begin
 foreach t in array array['profiles','products','product_aliases','bundles','bundle_aliases','bundle_components','gift_rules','alias_requests','order_batches','order_lines','audit_logs'] loop
   execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy products_read on public.products for select to authenticated using (true);
create policy aliases_read on public.product_aliases for select to authenticated using (true);
create policy bundles_read on public.bundles for select to authenticated using (true);
create policy bundle_aliases_read on public.bundle_aliases for select to authenticated using (true);
create policy components_read on public.bundle_components for select to authenticated using (true);
create policy gifts_read on public.gift_rules for select to authenticated using (true);
create policy requests_read on public.alias_requests for select to authenticated using (requested_by=(select auth.uid()) or (select public.is_inventory_admin()));
create policy requests_insert on public.alias_requests for insert to authenticated with check (requested_by=(select auth.uid()) and status='pending' and reviewed_by is null);
create policy batches_read on public.order_batches for select to authenticated using (true);
create policy lines_read on public.order_lines for select to authenticated using (true);
create policy audit_read on public.audit_logs for select to authenticated using ((select public.is_inventory_admin()));
-- Catalog mutations use admin-only RLS; only approved catalog data is visible to employees.
create policy products_admin on public.products for all to authenticated using ((select public.is_inventory_admin())) with check ((select public.is_inventory_admin()));
create policy aliases_admin on public.product_aliases for all to authenticated using ((select public.is_inventory_admin())) with check ((select public.is_inventory_admin()));
create policy bundles_admin on public.bundles for all to authenticated using ((select public.is_inventory_admin())) with check ((select public.is_inventory_admin()));
create policy bundle_aliases_admin on public.bundle_aliases for all to authenticated using ((select public.is_inventory_admin())) with check ((select public.is_inventory_admin()));
create policy components_admin on public.bundle_components for all to authenticated using ((select public.is_inventory_admin())) with check ((select public.is_inventory_admin()));
create policy gifts_admin on public.gift_rules for all to authenticated using ((select public.is_inventory_admin())) with check ((select public.is_inventory_admin()));
-- Profiles roles are NOT client-editable. Promote administrator in SQL Editor only.

-- Admin approval is transactional, role-checked and collision-safe.
create or replace function public.review_inventory_alias(p_request_id uuid, p_product_id text, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare req public.alias_requests%rowtype; who uuid := auth.uid();
begin
 if who is null or not public.is_inventory_admin() then raise exception 'Admin only' using errcode='42501'; end if;
 select * into req from public.alias_requests where id=p_request_id for update;
 if not found or req.status<>'pending' then raise exception 'Request already processed or not found'; end if;
 if p_approve then
   if p_product_id is null or not exists(select 1 from public.products where id=p_product_id and active) then raise exception 'Unknown product'; end if;
   if exists(select 1 from public.bundle_aliases where norm_key=req.norm_key) or exists(select 1 from public.gift_rules where norm_key=req.norm_key) then
     raise exception 'Alias conflicts with bundle/gift';
   end if;
   insert into public.product_aliases(product_id,label) values (p_product_id,req.proposed_label)
   on conflict(norm_key) do nothing;
   if not exists(select 1 from public.product_aliases where norm_key=req.norm_key and product_id=p_product_id) then
     raise exception 'Alias already mapped to a different product';
   end if;
 end if;
 update public.alias_requests set status=case when p_approve then 'approved' else 'rejected' end,
   reviewed_by=who,reviewed_at=now(),suggested_product_id=case when p_approve then p_product_id else suggested_product_id end where id=req.id;
 insert into public.audit_logs(actor_id,action,entity,entity_id,detail)
 values(who,case when p_approve then 'approve' else 'reject' end,'alias_request',req.id::text,
 jsonb_build_object('alias',req.proposed_label,'product_id',p_product_id));
end $$;
revoke all on function public.review_inventory_alias(uuid,text,boolean) from public,anon;
grant execute on function public.review_inventory_alias(uuid,text,boolean) to authenticated;

-- Atomic append-only capture of an entire validation run with every original input line.
create or replace function public.save_inventory_batch(
 p_title text,p_batch_date date,p_raw_text text,p_snapshot jsonb,p_lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare who uuid:=auth.uid(); new_id uuid; row_item jsonb; errs int; cnt int; total bigint;
begin
 if who is null or not exists(select 1 from public.profiles where user_id=who) then raise exception 'Login required' using errcode='42501'; end if;
 if p_raw_text is null or length(p_raw_text)>500000 or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)>5000 then raise exception 'Invalid payload'; end if;
 if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' then raise exception 'Invalid snapshot'; end if;
 cnt:=jsonb_array_length(p_lines);
 select count(*) into errs from jsonb_array_elements(p_lines) x where x->>'status'='error';
 if exists(select 1 from jsonb_array_elements(p_lines) x where x->>'status' not in ('ok','gift','error') or x->>'status' is null) then raise exception 'Invalid line status'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x where (x->>'line') !~ '^[1-9][0-9]*$' or x->>'original' is null) then raise exception 'Invalid line'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x where jsonb_typeof(x->'items') <> 'array' or x->'items' is null) then raise exception 'Invalid items array'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x
   cross join lateral jsonb_array_elements(x->'items') item
   where (item->>'quantity') !~ '^[1-9][0-9]*$') then raise exception 'Invalid item quantity'; end if;
 total:=coalesce((p_snapshot->>'total_quantity')::bigint,0);
 if total<0 then raise exception 'Invalid total'; end if;
 if total <> (select coalesce(sum((item->>'quantity')::bigint),0)
              from jsonb_array_elements(p_lines) x
              cross join lateral jsonb_array_elements(x->'items') item)
   then raise exception 'Result total differs from recognized rows'; end if;
 insert into public.order_batches(title,batch_date,created_by,status,raw_text,result_snapshot,row_count,error_count,total_quantity)
 values(left(coalesce(nullif(trim(p_title),''),'주문 취합'),150),coalesce(p_batch_date,current_date),who,
 case when errs=0 then 'validated' else 'needs_review' end,p_raw_text,p_snapshot,cnt,errs,total)
 returning id into new_id;
 for row_item in select value from jsonb_array_elements(p_lines) loop
   insert into public.order_lines(batch_id,line_number,raw_text,status,calculated_items,detail)
   values(new_id,(row_item->>'line')::int,row_item->>'original',row_item->>'status',
    coalesce(row_item->'items','[]'::jsonb),left(coalesce(row_item->>'message',''),5000));
 end loop;
 insert into public.audit_logs(actor_id,action,entity,entity_id,detail)
 values(who,'create','order_batch',new_id::text,jsonb_build_object('line_count',cnt,'error_count',errs));
 return new_id;
end $$;
revoke all on function public.save_inventory_batch(text,date,text,jsonb,jsonb) from public,anon;
grant execute on function public.save_inventory_batch(text,date,text,jsonb,jsonb) to authenticated;

-- Explicit table-level permissions; RLS still controls each permitted action.
revoke all on public.profiles,public.products,public.product_aliases,public.bundles,
 public.bundle_aliases,public.bundle_components,public.gift_rules,public.alias_requests,
 public.order_batches,public.order_lines,public.audit_logs from anon;
grant select on public.profiles,public.products,public.product_aliases,public.bundles,
 public.bundle_aliases,public.bundle_components,public.gift_rules,public.alias_requests,
 public.order_batches,public.order_lines,public.audit_logs to authenticated;
grant insert on public.alias_requests to authenticated;
grant insert,update,delete on public.products,public.product_aliases,public.bundles,
 public.bundle_aliases,public.bundle_components,public.gift_rules to authenticated;

-- Audit all approved catalog changes, including direct admin edits.
create or replace function public.audit_inventory_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(actor_id,action,entity,entity_id,detail)
  values(auth.uid(),lower(TG_OP),TG_TABLE_NAME,
    coalesce((case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end)->>'id',
      (case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end)->>'product_id',
      (case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end)->>'bundle_id'),
    jsonb_build_object('before',case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end,
                       'after',case when TG_OP in ('UPDATE','INSERT') then to_jsonb(NEW) else null end));
  return coalesce(NEW,OLD);
end; $$;
do $$ declare table_name text; begin
 foreach table_name in array array['products','product_aliases','bundles','bundle_aliases','bundle_components','gift_rules'] loop
   execute format('drop trigger if exists inventory_audit on public.%I',table_name);
   execute format('create trigger inventory_audit after insert or update or delete on public.%I for each row execute function public.audit_inventory_catalog()',table_name);
 end loop;
end $$;

-- INITIAL ADMIN: after creating/inviting your own user via Supabase Auth dashboard run separately:
-- update public.profiles set role='admin' where email='YOUR_ADMIN_EMAIL';
-- Never run this with an unverified address.
