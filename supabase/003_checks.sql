-- Run manually in Supabase SQL Editor after setup; requires database administrator.
-- Expected: profiles contain 1 admin, 1-4 workers. Do NOT post user emails or tokens publicly.
select role,count(*) from public.profiles group by role order by role;
select count(*) as products from public.products; -- 24 on clean seed
select count(*) as bundles from public.bundles; -- 3 on clean seed
select b.name,p.name as component,bc.quantity
from public.bundles b join public.bundle_components bc on bc.bundle_id=b.id
join public.products p on p.id=bc.product_id
order by b.name,p.display_order;
select schemaname,tablename,policyname,roles,cmd from pg_policies
where schemaname='public' and tablename in ('products','product_aliases','alias_requests','order_batches','order_lines','profiles')
order by tablename,policyname;
-- The following two checks should return FALSE / FALSE when invoked as anon without a JWT.
-- Check least-privilege access using real worker/admin logins from cloud.html.
