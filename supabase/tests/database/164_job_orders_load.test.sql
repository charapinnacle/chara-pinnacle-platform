begin;
select plan(7);

-- The job order list at 2,000 open requirements (V39, FR-N1 AC12; NFR-P3: the job order board renders within 500 ms
-- server time at 2,000 open requirements and 5,000 partners; the board's own load test with the page is V79). Seeded
-- here: 200 employers with 2,000 open marketplace requirements and 6,000 more that the list must skip (private, paused,
-- closed, filled, drafts, a suspended employer's), one to three occupations and one destination each. The caller is an
-- eligible partner serving DE and PL; the number of partners does not enter the list, which reads the caller's own
-- profile once. One warm-up and five timed runs of each call: the median must stay under 100 ms and no run may take
-- 500 ms, as in the Find Partners load test (155).

\ir organizations_fixture.inc

update private.settings set value = 'true' where key = 'release_job_orders';
select setseed(0.39);

\set pown '00000000-0000-0000-0000-0000000f3990'
select pg_temp.new_user(:'pown');
update public.profiles set account_kind = intended_account_kind where id = :'pown';
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
values ('00000000-0000-0000-0000-0000000f3991', 'recruitment_company', 'load-v39-partner', 'Load V39 Partner Ltd', 'Load V39 Partner', 'PH');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values ('00000000-0000-0000-0000-0000000f3991', :'pown', 'owner', now());
insert into public.organization_geographies (organization_id, scope, country_code)
values ('00000000-0000-0000-0000-0000000f3991', 'serves_market', 'DE'), ('00000000-0000-0000-0000-0000000f3991', 'serves_market', 'PL');
insert into public.organization_occupations (organization_id, occupation_id)
values ('00000000-0000-0000-0000-0000000f3991', '7212'), ('00000000-0000-0000-0000-0000000f3991', '5322');
update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days', submitted_at = now() - interval '31 days'
where id = '00000000-0000-0000-0000-0000000f3991';
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values ('00000000-0000-0000-0000-0000000f3991', 'recruitment_professional', 'active', 'null');

create temp table load_employers as
select gen_random_uuid() as id, n from generate_series(1, 200) n;
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, status)
select id, 'employer', 'load-v39-employer-' || n, 'Load V39 Employer ' || n || ' GmbH', 'Load V39 Employer ' || n, 'DE',
  case when n = 200 then 'suspended' else 'active' end::public.organization_status
from load_employers;

create temp table load_requirements as
select
  gen_random_uuid() as id,
  n,
  (select e.id from load_employers e where e.n = 1 + (g.n % 200)) as organization_id,
  (array['DE', 'DE', 'DE', 'PL', 'NL', 'AE', 'SA', 'GB', 'AT', 'CA'])[1 + floor(random() * 10)::integer] as country,
  (array['7212', '7212', '5322', '7126', '8322', '7112', '9313', '5120', '7411', '2221'])[1 + floor(random() * 10)::integer] as occ1,
  (array['7214', '5131', '9112', '8332', '7231'])[1 + floor(random() * 5)::integer] as occ2,
  case
    when n <= 2000 then 'open'
    when n <= 3500 then 'closed'
    when n <= 4500 then 'filled'
    when n <= 5500 then 'paused'
    when n <= 6500 then 'draft'
    else 'open'
  end as status,
  case when n > 6500 and n <= 7700 then 'private' else 'job_order_marketplace' end as visibility,
  now() - make_interval(mins => n) as published_at,
  random() < 0.3 as show_identity,
  date '2027-01-01' + floor(random() * 300)::integer as start_date,
  (array['local', 'international', 'both'])[1 + floor(random() * 3)::integer]::public.recruitment_preference as recruitment
from generate_series(1, 8000) g (n);

insert into public.workforce_requirements (
  id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
  recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on, close_reason
)
select id, organization_id, 'Load requirement ' || n, 30, country, 'City ' || (n % 50), 'C', start_date, 'full_time', recruitment,
  'both', status::public.requirement_status,
  case when status <> 'draft' then visibility::public.requirement_visibility end,
  status <> 'draft' and show_identity,
  case when status <> 'draft' then published_at end,
  case when status <> 'draft' then start_date + 30 end,
  case status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason
from load_requirements;
insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
select id, occ1, 20 from load_requirements
union all select id, occ2, 10 from load_requirements where occ2 <> occ1;
insert into public.requirement_countries (requirement_id, country_code) select id, country from load_requirements;
analyze public.workforce_requirements, public.requirement_occupations, public.requirement_countries, public.organizations;

create temp table load_runs (call text, n integer, ms numeric, row_count integer);
grant all on load_runs to authenticated;

create function pg_temp.time_call(p_user uuid, p_call text, p_sql text, p_runs integer) returns void
language plpgsql as $$
declare
  v_start timestamptz;
  v_rows integer;
begin
  for i in 0 .. p_runs loop
    delete from private.rate_limit_hits;
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
    v_start := clock_timestamp();
    execute 'select count(*) from (' || p_sql || ') q' into v_rows;
    if i > 0 then
      insert into load_runs values (p_call, i, extract(epoch from clock_timestamp() - v_start) * 1000, v_rows);
    end if;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  end loop;
end;
$$;

select pg_temp.time_call(:'pown', 'first page',
  $$select * from public.list_job_orders('00000000-0000-0000-0000-0000000f3991')$$, 5);
select pg_temp.time_call(:'pown', 'filtered',
  $$select * from public.list_job_orders('00000000-0000-0000-0000-0000000f3991', p_destination => 'DE', p_occupation => '7212', p_limit => 50)$$, 5);
select pg_temp.time_call(:'pown', 'deep page',
  format($$select * from public.list_job_orders('00000000-0000-0000-0000-0000000f3991', p_cursor => %L, p_limit => 50)$$,
    (select id from load_requirements where n = 1900)), 5);
select pg_temp.time_call(:'pown', 'job order',
  format($$select * from public.get_job_order('00000000-0000-0000-0000-0000000f3991', %L)$$,
    (select id from load_requirements where n = 1000)), 5);

select diag(c.call || ': median ' || round(percentile_cont(0.5) within group (order by c.ms)::numeric, 1) || ' ms, max '
  || round(max(c.ms), 1) || ' ms, rows ' || min(c.row_count))
from load_runs c group by c.call order by c.call;

select ok(
  (select bool_and(m.median < 100 and m.max < 500)
   from (select percentile_cont(0.5) within group (order by ms) as median, max(ms) as max from load_runs group by call) m),
  'NFR-P3: each job order call answers within 100 ms at the median and never takes 500 ms at 2,000 open requirements');
select is(
  (select array_agg(call || '=' || row_count order by call) from (select distinct call, row_count from load_runs) r),
  array['deep page=50', 'filtered=50', 'first page=20', 'job order=1'],
  'NFR-P3: every timed run answers full pages (no run is timed on an empty answer)');

create temp table load_page (id uuid, eligible boolean);
grant all on load_page to authenticated;
delete from private.rate_limit_hits;
select set_config('request.jwt.claims', json_build_object('sub', :'pown', 'role', 'authenticated', 'aal', 'aal1')::text, true) as claims \gset
set local role authenticated;
insert into load_page select j.id, j.eligible from public.list_job_orders('00000000-0000-0000-0000-0000000f3991', p_limit => 50) j;
reset role;
select set_config('request.jwt.claims', '', true) as claims \gset
select is(
  (select count(*)::integer from load_page p join load_requirements r on r.id = p.id
   where r.status <> 'open' or r.visibility <> 'job_order_marketplace' or r.organization_id = (select id from load_employers where n = 200)),
  0, 'AC1 at volume: no requirement that is not an open marketplace job order of an active employer is listed');
select is(
  (select string_agg(p.id::text, ',') from load_page p),
  (select string_agg(id::text, ',') from (
     select r.id from load_requirements r where r.status = 'open' and r.visibility = 'job_order_marketplace'
       and r.organization_id <> (select id from load_employers where n = 200)
     order by r.published_at desc, r.id limit 50) x),
  'AC8 at volume: the first page is the 50 newest job orders, eligible or not');
select ok((select bool_or(eligible) and bool_or(not eligible) from load_page), 'the page mixes full and reduced rows');

-- The plan shape, independent of the speed of the machine: the open marketplace requirements are read in their order
-- through the partial index, never by scanning the table.
create function pg_temp.plan_of(p_sql text) returns text
language plpgsql as $$
declare
  v_line text;
  v_plan text := '';
begin
  for v_line in execute 'explain ' || p_sql loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  return v_plan;
end;
$$;
select pg_temp.plan_of($$select r.id from public.workforce_requirements r join public.organizations e on e.id = r.organization_id
  where r.status = 'open' and r.visibility = 'job_order_marketplace' and e.status = 'active'
  order by r.published_at desc, r.id limit 21$$) as list_plan \gset
select ok(
  :'list_plan' ~ 'Index[A-Za-z ]* Scan[^\n]* using workforce_requirements_job_orders_idx'
  and :'list_plan' !~ 'Seq Scan on workforce_requirements',
  'NFR-P3, AC12: the list reads the open marketplace requirements through workforce_requirements_job_orders_idx in order');
select ok(
  position($p$where r.status = 'open' and r.visibility = 'job_order_marketplace' and e.status = 'active'$p$
    in regexp_replace(pg_get_functiondef('public.list_job_orders(uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer)'::regprocedure), '\s+', ' ', 'g')) > 0
  and position($p$order by r.published_at desc, r.id limit v_limit + 1$p$
    in regexp_replace(pg_get_functiondef('public.list_job_orders(uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer)'::regprocedure), '\s+', ' ', 'g')) > 0,
  'NFR-P3: the plan checked above is that of the predicates and order of list_job_orders as defined');

select * from finish();
rollback;
