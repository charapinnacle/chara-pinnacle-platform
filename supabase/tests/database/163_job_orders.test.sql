begin;
select plan(185);

\ir jobs_fixture.inc

-- The job order marketplace, data (V39, FR-N1 AC1 to AC6, AC8, AC12; SOP P2-19 steps Publish, Eligibility, Filter,
-- Anonymity, Order; controls eligibility in the database, anonymity in every view, audit of reveals; decisions 3.1,
-- 3.2, 3.6; NFR-S8, NFR-S11, NFR-C8, NFR-O5): list_job_orders, get_job_order, private.requirement_reveals,
-- private.record_requirement_reveal and stats.job_order_partner_weeks. Acme (t.a: owner own1, admin adm, member mem)
-- and Beta (t.b: owner own2, admin adm2) are employers of the fixture and wkr is a candidate; the suspended employer
-- Zeta, a Platform Administrator and the partners, each with an owner of its own, are made below.

\set sadm '00000000-0000-0000-0000-0000000f3900'
\set zown '00000000-0000-0000-0000-0000000f3901'
\set zeta '00000000-0000-0000-0000-0000000f3911'
\set u1 '00000000-0000-0000-0000-0000000f3921'
\set u2 '00000000-0000-0000-0000-0000000f3922'
\set u3 '00000000-0000-0000-0000-0000000f3923'
\set u4 '00000000-0000-0000-0000-0000000f3924'
\set u5 '00000000-0000-0000-0000-0000000f3925'
\set u6 '00000000-0000-0000-0000-0000000f3926'
\set u7 '00000000-0000-0000-0000-0000000f3927'
\set u8 '00000000-0000-0000-0000-0000000f3928'
\set un '00000000-0000-0000-0000-0000000f3929'
\set us '00000000-0000-0000-0000-0000000f3930'
\set uh '00000000-0000-0000-0000-0000000f3931'
\set ud '00000000-0000-0000-0000-0000000f3932'
\set uf '00000000-0000-0000-0000-0000000f3933'

select pg_temp.new_user(:'sadm');
select pg_temp.new_user(:'zown');
update public.profiles set account_kind = intended_account_kind where id in (:'sadm', :'zown');
insert into public.platform_staff (user_id, role) values (:'sadm', 'admin');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, status)
values (:'zeta', 'employer', 'zeta-v39', 'Zeta V39 GmbH', 'Zeta V39', 'DE', 'suspended');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'zeta', :'zown', 'owner', now());
update public.organizations set website = 'https://www.acme-bau.de/jobs', public_page_enabled = true
where id = current_setting('t.a')::uuid;
update private.settings set value = 'true' where key = 'release_job_orders';
select set_config('t.notifications', (select count(*) from public.notifications)::text, false) as setup_notifications \gset

-- A listed partner of p_type owned by p_owner, serving p_serves and listing p_occupations, with an active subscription
-- to p_plan (none when null).
create function pg_temp.partner(
  p_slug text, p_owner uuid, p_serves text[], p_occupations text[], p_plan text default 'recruitment_partner',
  p_type text default 'recruitment_company'
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  select v_id, 'serves_market'::public.geography_scope, c from unnest(p_serves) c;
  insert into public.organization_occupations (organization_id, occupation_id) select v_id, o from unnest(p_occupations) o;
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  end if;
  return v_id;
end;
$$;

-- A requirement of p_org written as the lifecycle functions leave it, with the occupations of p_occupations
-- ({"7212": 80, ...}) and the destination p_country.
create function pg_temp.req(
  p_org uuid, p_title text, p_status text, p_visibility text, p_occupations jsonb, p_country text default 'DE',
  p_industry text default 'C', p_start date default '2027-01-15', p_recruitment text default 'both',
  p_show boolean default false, p_published timestamptz default now() - interval '10 days', p_city text default 'Hamburg',
  p_skills text default null, p_id uuid default gen_random_uuid()
) returns uuid
language plpgsql as $$
declare
  v_published boolean := p_status <> 'draft';
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, skills, start_date,
    duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, recruitment_preference,
    partner_need, status, visibility, show_identity, published_at, closes_on, close_reason
  ) values (
    p_id, p_org, p_title, (select sum(value::integer) from jsonb_each_text(p_occupations)), p_country, p_city, p_industry,
    p_skills, p_start, 12, 'full_time', 2500, 3000, 'EUR', 'month', p_recruitment::public.recruitment_preference, 'both',
    p_status::public.requirement_status, case when v_published then p_visibility::public.requirement_visibility end,
    v_published and p_show, case when v_published then p_published end, case when v_published then p_start + 30 end,
    case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select p_id, key, value::integer from jsonb_each_text(p_occupations);
  insert into public.requirement_countries (requirement_id, country_code) values (p_id, p_country);
  return p_id;
end;
$$;

-- list_job_orders as p_user (anonymous when null) for p_org with further arguments p_args: 'ok' with the rows in order
-- as a JSON array in t.result, or 'sqlstate|message|detail'. Each call starts with a fresh rate-limit window.
create function pg_temp.jo(p_user uuid, p_org uuid, p_args text default '') returns text
language sql as $$
  delete from private.rate_limit_hits;
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', coalesce((select jsonb_agg(to_jsonb(r) order by r.n)
       from (select s.*, row_number() over () as n from public.list_job_orders(%L%s) s) r)::text, '[]'), true)$f$,
    p_org, p_args), 'aal1')
$$;

-- get_job_order as p_user for p_org and p_req: 'ok' with the row as JSON in t.result, or 'sqlstate|message|detail'.
create function pg_temp.one(p_user uuid, p_org uuid, p_req uuid) returns text
language sql as $$
  delete from private.rate_limit_hits;
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', coalesce((select to_jsonb(s) from public.get_job_order(%L, %L) s)::text, 'null'), true)$f$,
    p_org, p_req), 'aal1')
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

create function pg_temp.row_of(p_id uuid) returns jsonb
language sql as $$ select e from jsonb_array_elements(pg_temp.result()) e where e ->> 'id' = p_id::text $$;

-- The employers' own titles (from the table, whatever title the row shows) of the rows in order, only those starting
-- with p_prefix.
create function pg_temp.titles(p_prefix text default '') returns text
language sql as $$
  select coalesce(string_agg(w.title, ',' order by n), '')
  from jsonb_array_elements(pg_temp.result()) with ordinality r (e, n)
  join public.workforce_requirements w on w.id = (e ->> 'id')::uuid
  where w.title like p_prefix || '%'
$$;

create function pg_temp.sorted_titles(p_prefix text) returns text
language sql as $$
  select coalesce(string_agg(w.title, ',' order by w.title), '')
  from jsonb_array_elements(pg_temp.result()) e
  join public.workforce_requirements w on w.id = (e ->> 'id')::uuid
  where w.title like p_prefix || '%'
$$;

create function pg_temp.ids() returns text
language sql as $$
  select coalesce(string_agg(e ->> 'id', ',' order by n), '') from jsonb_array_elements(pg_temp.result()) with ordinality r (e, n)
$$;

create function pg_temp.reveal_audits(p_req uuid) returns integer
language sql as $$
  select count(*)::integer from audit.log where action = 'requirement.employer_revealed' and entity_id = p_req::text
$$;

-- Partners -------------------------------------------------------------------------------------------------------------

select pg_temp.partner('v39-p1', :'u1', '{DE}', '{7212}') as p1 \gset
select pg_temp.partner('v39-p2', :'u2', '{PL}', '{7212}') as p2 \gset
select pg_temp.partner('v39-p3', :'u3', '{DE}', '{5120}') as p3 \gset
select pg_temp.partner('v39-p4', :'u4', '{DE}', '{7212}') as p4 \gset
update billing.subscriptions set status = 'canceled' where organization_id = :'p4';
select pg_temp.partner('v39-p5', :'u5', '{DE}', '{7212}') as p5 \gset
update public.organizations set review_status = 'pending_review', listed_at = null where id = :'p5';
select pg_temp.partner('v39-p6', :'u6', '{DE}', '{7212}') as p6 \gset
update public.organizations set status = 'suspended' where id = :'p6';
select pg_temp.partner('v39-p7', :'u7', '{DE}', '{7212}') as p7 \gset
select pg_temp.partner('v39-p8', :'u8', '{DE}', '{7214}') as p8 \gset
select pg_temp.partner('v39-never', :'un', '{DE}', '{7212}', null) as pn \gset
select pg_temp.partner('v39-staffing', :'us', '{DE}', '{7214}', 'staffing_partner', 'staffing_company') as ps \gset
select pg_temp.partner('v39-hidden', :'uh', '{DE}', '{7212}') as ph \gset
update public.organizations set moderation_state = 'hidden' where id = :'ph';
select pg_temp.partner('v39-declined', :'ud', '{DE}', '{7212}') as pd \gset
update public.organizations set review_status = 'declined' where id = :'pd';
select pg_temp.partner('v39-filters', :'uf', '{DE,NL}', '{7212,7214,5120}') as pf \gset

-- Requirements of Acme ---------------------------------------------------------------------------------------------------

select pg_temp.req(current_setting('t.a')::uuid, 'Germany, 100 welders', 'open', 'job_order_marketplace',
  '{"7212": 80, "7214": 20}', p_skills => 'MIG and TIG welding') as r \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Named welders', 'open', 'job_order_marketplace', '{"7212": 10}',
  p_show => true, p_published => now() - interval '9 days') as s \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Draft welders', 'draft', null, '{"7212": 10}') as rdraft \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Private open', 'open', 'private', '{"7212": 10}') as rpriv \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Private paused', 'paused', 'private', '{"7212": 10}') as rprivp \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Market paused', 'paused', 'job_order_marketplace', '{"7212": 10}') as rpaused \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Market closed', 'closed', 'job_order_marketplace', '{"7212": 10}') as rclosed \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Market filled', 'filled', 'job_order_marketplace', '{"7212": 10}') as rfilled \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Private closed', 'closed', 'private', '{"7212": 10}') as rprivc \gset
select pg_temp.req(:'zeta', 'Zeta welders', 'open', 'job_order_marketplace', '{"7212": 10}') as rzeta \gset

-- The functions, their grants and their columns ------------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.list_job_orders(uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer)', 'execute')
  and not has_function_privilege('service_role', 'public.list_job_orders(uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.list_job_orders(uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.get_job_order(uuid, uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.get_job_order(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.get_job_order(uuid, uuid)', 'execute'),
  'AC4: list_job_orders and get_job_order are executable by authenticated only');
select is(
  (select array_agg(proname::text order by proname) from pg_proc
   where proname in ('list_job_orders', 'get_job_order') and pronamespace = 'public'::regnamespace
     and prosecdef and proconfig @> array['search_path=""']),
  array['get_job_order', 'list_job_orders'], 'both are security definer with an empty search_path');
select is(
  (select count(*)::integer from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('record_requirement_reveal', 'city_names_organization', 'organization_name_keys', 'job_order_neutral_title', 'name_key',
       'requirement_response_count', 'job_order_partner_facts', 'job_order_reasons', 'assert_job_order_partner', 'mark_reveals_seen')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'no API role executes the private helpers');
select is(
  (select array_agg(n order by o) from pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) with ordinality a (n, m, o)
   where p.oid = 'public.list_job_orders(uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer)'::regprocedure
     and m = 't'),
  array['id', 'eligible', 'reasons', 'title', 'country_code', 'workers_needed', 'countries', 'city_region', 'industry_code',
        'occupations', 'start_date', 'employment_type', 'recruitment_preference', 'published_on', 'response_count',
        'responses_fewer_than', 'employer_name', 'employer_company_slug', 'next_cursor']::text[],
  'AC2: the list columns');
select is(
  (select count(*)::integer from pg_proc p, unnest(p.proargnames) n
   where p.oid in ('public.list_job_orders(uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer)'::regprocedure,
                   'public.get_job_order(uuid, uuid)'::regprocedure)
     and n ~* '(organization|legal|website|logo|created_by|member|email|verif|score|rank|plan)'),
  0, 'AC2, NFR-S11: no column names the employer organisation, its legal name, website, logo, members, a score or a plan');
select ok(
  (select prosrc ~ 'order by r\.published_at desc, r\.id' and prosrc !~* 'order by[^;]*(billing|plan_code|has_feature)'
   from pg_proc where oid = 'public.list_job_orders(uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer)'::regprocedure),
  'NFR-C8: the order is published_at descending then id, and no order by reads a plan');
select is(
  (select value #>> '{}' from private.settings where key = 'job_order_response_count_min'), '5',
  'NFR-O5: the response count is shown from job_order_response_count_min, 5');
select ok(
  exists (select 1 from private.setting_rules where key = 'job_order_response_count_min' and editable and min = 1 and max = 20),
  'NFR-O5: an administrator changes it in the settings editor (1 to 20)');
select ok(
  (select value #>> '{}' from private.settings where key = 'rate_limit_job_orders_max') = '60'
  and (select value #>> '{}' from private.settings where key = 'rate_limit_job_orders_seconds') = '60',
  'the job order allowance is 60 calls in 60 seconds per user, as the partner searches');

-- AC12: indexes
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'workforce_requirements_job_orders_idx'
    and indexdef like '%(published_at DESC, id)%' and indexdef like '%status = ''open''%'
    and indexdef like '%visibility = ''job_order_marketplace''%'),
  'AC12: the open marketplace requirements are indexed on published_at, id');
select ok(
  exists (select 1 from pg_indexes where indexname = 'organization_geographies_scope_country_idx'
    and indexdef like '%(scope, country_code, organization_id)%')
  and exists (select 1 from pg_indexes where indexname = 'requirement_occupations_occupation_idx' and indexdef like '%(occupation_id)%')
  and exists (select 1 from pg_indexes where indexname = 'organization_occupations_occupation_idx'
    and indexdef like '%(occupation_id, organization_id)%')
  and exists (select 1 from pg_indexes where indexname = 'requirement_countries_country_idx'),
  'AC12: geographies (scope, country, organisation), requirement occupations, partner occupations and destinations are indexed');

-- The new tables: RLS forced, no grants (NFR-S8)
select is(
  (select count(*)::integer from pg_class c
   where c.oid in ('private.requirement_reveals'::regclass, 'stats.job_order_partner_weeks'::regclass)
     and c.relrowsecurity and c.relforcerowsecurity),
  2, 'NFR-S8: both tables have row level security enabled and forced');
select is(
  (select count(*)::integer from information_schema.role_table_grants
   where table_schema || '.' || table_name in ('private.requirement_reveals', 'stats.job_order_partner_weeks')
     and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  0, 'NFR-S8: no API role has a grant on them');

-- AC1: only open marketplace requirements of active employers ------------------------------------------------------------------

select is(pg_temp.jo(:'u1', :'p1'), 'ok', 'AC1: an eligible partner lists job orders');
select is(pg_temp.titles(), 'Named welders,Germany, 100 welders',
  'AC1: only the open marketplace requirements of the active employer, newest first; no draft, private, paused, closed, filled or suspended employer''s');
select is(pg_temp.one(:'u1', :'p1', :'rpaused'), 'ok', 'AC1: get_job_order answers for a paused marketplace requirement');
select is(pg_temp.result(), jsonb_build_object('id', :'rpaused')
    || (select jsonb_object_agg(k, null) from jsonb_object_keys(pg_temp.result()) k where k not in ('id', 'open'))
    || '{"open": false}',
  'AC1, AC9: a paused job order is no longer open and carries no field but its id');
select is(pg_temp.one(:'u1', :'p1', :'rclosed') || pg_temp.one(:'u1', :'p1', :'rfilled') || pg_temp.one(:'u1', :'p1', :'rzeta'),
  'okokok', 'closed, filled and suspended-employer job orders answer');
select is((pg_temp.result() ->> 'open')::boolean, false, 'AC1: a job order of a suspended employer is no longer open');
select is(pg_temp.one(:'u1', :'p1', :'rdraft'), 'P0002|CHARA_NOT_FOUND|', 'a draft is not found');
select is(pg_temp.one(:'u1', :'p1', :'rpriv'), 'P0002|CHARA_NOT_FOUND|', 'decision 3.1: a private requirement is not found');
select is(pg_temp.one(:'u1', :'p1', :'rprivc'), 'P0002|CHARA_NOT_FOUND|', 'a closed private requirement is not found');
select is(pg_temp.one(:'u1', :'p1', gen_random_uuid()), 'P0002|CHARA_NOT_FOUND|', 'an unknown id is not found');

-- The owner pauses R: it leaves the list at once and comes back when reopened.
select pg_temp.call_as(:'own1', 'authenticated', format('select public.set_requirement_status(%L, %L, %L, %L)',
  current_setting('t.a'), :'r', 'paused', (select updated_at from public.workforce_requirements where id = :'r')), 'aal2') as paused \gset
select is(:'paused'::text, 'ok', 'the owner pauses R');
select is(pg_temp.jo(:'u1', :'p1') || pg_temp.titles(), 'okNamed welders', 'AC1, step Publish: a paused job order leaves the list at once');
select is(pg_temp.one(:'u1', :'p1', :'r') || (pg_temp.result() ->> 'open'), 'okfalse', 'AC9: its page says it is no longer open');
select is(pg_temp.result() ->> 'title', null, 'AC9: with no requirement field');
select pg_temp.call_as(:'own1', 'authenticated', format('select public.set_requirement_status(%L, %L, %L, %L)',
  current_setting('t.a'), :'r', 'open', (select updated_at from public.workforce_requirements where id = :'r')), 'aal2') as reopened \gset
select is(pg_temp.jo(:'u1', :'p1') || pg_temp.titles(), 'okNamed welders,Germany, 100 welders', 'reopened, R is listed again');

-- AC2: eligible partners receive full job orders --------------------------------------------------------------------------------

select is(pg_temp.jo(:'u1', :'p1'), 'ok', 'P1 lists');
select is(pg_temp.row_of(:'r') - 'published_on',
  jsonb_build_object('id', :'r', 'eligible', true, 'reasons', '[]'::jsonb, 'title', 'Germany, 80 Welders and flame cutters, 20 Structural-metal preparers and erectors', 'country_code', 'DE',
    'workers_needed', 100, 'countries', '["DE"]'::jsonb, 'city_region', 'Hamburg', 'industry_code', 'C',
    'occupations', '[{"code": "7212", "name": "Welders and flame cutters", "quantity": 80}, {"code": "7214", "name": "Structural-metal preparers and erectors", "quantity": 20}]'::jsonb,
    'start_date', '2027-01-15', 'employment_type', 'full_time', 'recruitment_preference', 'both', 'response_count', null,
    'responses_fewer_than', 5, 'employer_name', null, 'employer_company_slug', null, 'next_cursor', null, 'n', 2),
  'AC2: the full job order: the generated title, destination and city, industry, occupations with quantities, workers, start date, employment type, recruitment preference, response count; no employer name (anonymous)');
select is(pg_temp.row_of(:'r') ->> 'published_on', ((now() - interval '10 days') at time zone 'utc')::date::text,
  'AC2, NFR-S11: the publication is a date, not a time');
select is(pg_temp.one(:'u1', :'p1', :'r'), 'ok', 'P1 opens R');
select is(pg_temp.result() - 'published_on',
  jsonb_build_object('id', :'r', 'open', true, 'eligible', true, 'reasons', '[]'::jsonb, 'title', 'Germany, 80 Welders and flame cutters, 20 Structural-metal preparers and erectors',
    'country_code', 'DE', 'workers_needed', 100, 'countries', '["DE"]'::jsonb, 'city_region', 'Hamburg', 'industry_code', 'C',
    'occupations', '[{"code": "7212", "name": "Welders and flame cutters", "quantity": 80}, {"code": "7214", "name": "Structural-metal preparers and erectors", "quantity": 20}]'::jsonb,
    'skills', null, 'experience_years', null, 'start_date', '2027-01-15', 'duration_months', 12,
    'employment_type', 'full_time', 'salary_min', 2500.00, 'salary_max', 3000.00, 'salary_currency', 'EUR',
    'salary_period', 'month', 'accommodation', false, 'work_permit_support', false, 'visa_support', false,
    'recruitment_preference', 'both', 'partner_need', 'both', 'closes_on', '2027-02-14', 'response_count', null,
    'responses_fewer_than', 5, 'employer_name', null, 'employer_company_slug', null),
  'AC2: the job order page carries the terms as well; anonymous: the generated title, no skills text, no employer name');
select is(pg_temp.jo(:'us', :'ps') || (pg_temp.row_of(:'r') ->> 'eligible'), 'oktrue',
  'a staffing company sees job orders on the same rules');

-- AC3: partners that are not eligible see titles only, with the reason -------------------------------------------------------

select is(pg_temp.jo(:'u2', :'p2'), 'ok', 'P2 (serves PL only) lists');
select is(pg_temp.row_of(:'r'),
  jsonb_build_object('id', :'r', 'eligible', false, 'reasons', '["served_country_missing"]'::jsonb, 'title', 'Germany, 80 Welders and flame cutters, 20 Structural-metal preparers and erectors',
    'country_code', 'DE', 'workers_needed', 100, 'countries', null, 'city_region', null, 'industry_code', null, 'occupations', null,
    'start_date', null, 'employment_type', null, 'recruitment_preference', null, 'published_on', null, 'response_count', null,
    'responses_fewer_than', null, 'employer_name', null, 'employer_company_slug', null, 'next_cursor', null, 'n', 2),
  'AC3: P2 gets id, title, destination and workers with served_country_missing, nothing else');
select is(pg_temp.row_of(:'s') ->> 'employer_name', null, 'AC3: a reduced row carries no employer name, even when the employer shows it');
select is(pg_temp.jo(:'u3', :'p3') || (pg_temp.row_of(:'r') ->> 'reasons'), 'ok["occupation_missing"]', 'AC3: P3 occupation_missing');
select is(pg_temp.jo(:'u4', :'p4') || (pg_temp.row_of(:'r') ->> 'reasons'), 'ok["plan_required"]',
  'AC3, decision 3.6: P4 (subscription cancelled) plan_required');
select is(pg_temp.row_of(:'r') ->> 'city_region', null, 'AC3: P4 gets no city');
select is(pg_temp.jo(:'un', :'pn') || (pg_temp.row_of(:'r') ->> 'reasons'), 'ok["plan_required"]',
  'decision 3.6: a partner that never subscribed sees titles only while entitlements_enforced is off');
select is(pg_temp.one(:'u4', :'p4', :'r'), 'ok', 'P4 opens R');
select is(pg_temp.result() - 'id' - 'title' - 'country_code' - 'workers_needed' - 'open' - 'eligible' - 'reasons',
  (select jsonb_object_agg(k, null) from jsonb_object_keys(pg_temp.result() - 'id' - 'title' - 'country_code' - 'workers_needed' - 'open' - 'eligible' - 'reasons') k),
  'AC3: the reduced job order page carries nothing but id, title, destination and workers');
select is(pg_temp.result() ->> 'reasons', '["plan_required"]', 'AC3: with the reason');
select is(pg_temp.jo(:'u5', :'p5'), '42501|CHARA_FORBIDDEN|not_listed', 'AC3: P5 (review not decided) is refused not_listed');
select is(pg_temp.jo(:'u6', :'p6'), '42501|CHARA_FORBIDDEN|organization_suspended', 'AC3: P6 (suspended) is refused');
select is(pg_temp.jo(:'ud', :'pd'), '42501|CHARA_FORBIDDEN|not_listed', 'a declined partner is refused not_listed');
select is(pg_temp.jo(:'uh', :'ph'), '42501|CHARA_FORBIDDEN|profile_hidden', 'a partner hidden by moderation is refused');
select is(pg_temp.one(:'u5', :'p5', :'r'), '42501|CHARA_FORBIDDEN|not_listed', 'get_job_order refuses P5 the same way');
select is(pg_temp.one(:'u6', :'p6', :'r'), '42501|CHARA_FORBIDDEN|organization_suspended', 'get_job_order refuses P6 the same way');

-- Several reasons at once, in a fixed order.
select pg_temp.req(current_setting('t.b')::uuid, 'Poland masons', 'open', 'job_order_marketplace', '{"7112": 20}', 'PL') as rpl \gset
select is(pg_temp.jo(:'u4', :'p4') || (pg_temp.row_of(:'rpl') ->> 'reasons'), 'ok["plan_required"]',
  'without a paid plan only plan_required is named, though country and occupation are missing too');
select is(pg_temp.jo(:'u3', :'p3') || (pg_temp.row_of(:'rpl') ->> 'reasons'), 'ok["served_country_missing", "occupation_missing"]',
  'with a paid plan every missing condition is named, in a fixed order');
select is(pg_temp.jo(:'u2', :'p2') || (pg_temp.row_of(:'rpl') ->> 'reasons'), 'ok["occupation_missing"]',
  'P2 serves PL: only the occupation is missing');
-- A free partner that changes its occupations one at a time learns nothing about the job order's occupations.
select is(pg_temp.jo(:'u4', :'p4') || (pg_temp.row_of(:'r') ->> 'reasons'), 'ok["plan_required"]', 'P4 listing 7212: plan_required');
update public.organization_occupations set occupation_id = '5120' where organization_id = :'p4';
select is(pg_temp.jo(:'u4', :'p4') || (pg_temp.row_of(:'r') ->> 'reasons'), 'ok["plan_required"]',
  'P4 listing 5120 instead: still plan_required only (no occupation probe)');
update public.organization_occupations set occupation_id = '7212' where organization_id = :'p4';

-- Trialing and past due keep access; the feature decides while entitlements_enforced is on.
update billing.subscriptions set status = 'trialing' where organization_id = :'p1' and status = 'active';
select is(pg_temp.jo(:'u1', :'p1') || (pg_temp.row_of(:'r') ->> 'eligible'), 'oktrue', 'a trialing partner is eligible');
update billing.subscriptions set status = 'past_due', past_due_since = now() where organization_id = :'p1' and status = 'trialing';
select is(pg_temp.jo(:'u1', :'p1') || (pg_temp.row_of(:'r') ->> 'eligible'), 'oktrue', 'a past-due partner is eligible');
update billing.subscriptions set status = 'active', past_due_since = null where organization_id = :'p1' and status = 'past_due';
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.jo(:'u1', :'p1') || (pg_temp.row_of(:'r') ->> 'eligible'), 'oktrue',
  'entitlements_enforced on: a paid plan with job_order_access is eligible');
select is(pg_temp.jo(:'un', :'pn') || (pg_temp.row_of(:'r') ->> 'reasons'), 'ok["plan_required"]',
  'entitlements_enforced on: a partner that never subscribed sees titles only');
select is(pg_temp.jo(:'u4', :'p4') || (pg_temp.row_of(:'r') ->> 'reasons'), 'ok["plan_required"]',
  'entitlements_enforced on: a lapsed partner sees titles only');
delete from billing.plan_features where plan_code = 'recruitment_partner' and feature_key = 'job_order_access';
select is(pg_temp.jo(:'u1', :'p1') || (pg_temp.row_of(:'r') ->> 'reasons'), 'ok["plan_required"]',
  'entitlements_enforced on: a paid plan without job_order_access sees titles only');
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(pg_temp.jo(:'u1', :'p1') || (pg_temp.row_of(:'r') ->> 'eligible'), 'oktrue',
  'entitlements_enforced off: the plan code decides, a paid plan is eligible');
insert into billing.plan_features (plan_code, feature_key) values ('recruitment_partner', 'job_order_access');

-- get_job_order and list_job_orders judge every partner alike.
create function pg_temp.same_judgement(p_owner uuid, p_org uuid, p_req uuid) returns boolean
language plpgsql as $$
declare
  v_list text;
begin
  if pg_temp.jo(p_owner, p_org) <> 'ok' then return false; end if;
  v_list := (pg_temp.row_of(p_req) ->> 'eligible') || (pg_temp.row_of(p_req) ->> 'reasons');
  if pg_temp.one(p_owner, p_org, p_req) <> 'ok' then return false; end if;
  return v_list = (pg_temp.result() ->> 'eligible') || (pg_temp.result() ->> 'reasons');
end;
$$;
select is(
  (select count(*)::integer from (values (:'p1'::uuid, :'u1'::uuid), (:'p2', :'u2'), (:'p3', :'u3'), (:'p4', :'u4'), (:'pn', :'un'),
     (:'ps', :'us'), (:'p8', :'u8')) j (org, owner)
   where pg_temp.same_judgement(j.owner, j.org, :'r')),
  7, 'the list and the job order page give every partner the same eligibility and reasons');

-- AC4: callers outside the partner side are refused ------------------------------------------------------------------------------

select is(pg_temp.jo(null, :'p1'), '42501|permission denied for function list_job_orders|', 'AC4: anon has no execute on the list');
select is(pg_temp.one(null, :'p1', :'r'), '42501|permission denied for function get_job_order|', 'AC4: anon has no execute on the page');
select is(pg_temp.call_as(null, 'anon', 'select count(*) from public.workforce_requirements'),
  '42501|permission denied for table workforce_requirements|', 'AC4: anon has no table grant');
select is(pg_temp.jo(:'own2', current_setting('t.b')::uuid), '42501|CHARA_FORBIDDEN|partner_only', 'AC4: an employer owner is refused for its own organisation');
select is(pg_temp.jo(:'own1', current_setting('t.a')::uuid), '42501|CHARA_FORBIDDEN|partner_only', 'AC4: the Acme owner is refused the list too');
select is(pg_temp.jo(:'own2', :'p1'), '42501|CHARA_FORBIDDEN|', 'AC4: an employer owner cannot name a partner');
select is(pg_temp.jo(:'wkr', :'p1'), '42501|CHARA_FORBIDDEN|', 'AC4, decision 3.1: a candidate is refused');
select is(pg_temp.jo(:'sadm', :'p1'), '42501|CHARA_FORBIDDEN|', 'AC4: a Platform Administrator is refused');
select is(pg_temp.one(:'wkr', :'p1', :'r'), '42501|CHARA_FORBIDDEN|', 'AC4: a candidate is refused the page');
select is(pg_temp.jo(:'u2', :'p1'), '42501|CHARA_FORBIDDEN|', 'NFR-S8: a member of another partner cannot list for P1');
select is(pg_temp.one(:'u7', :'p1', :'r'), '42501|CHARA_FORBIDDEN|', 'NFR-S8: nor open a job order for P1');
select is(
  pg_temp.val_as(:'own2', 'aal1', format('select count(*) from public.workforce_requirements where organization_id = %L', current_setting('t.a')))
  || pg_temp.val_as(:'wkr', 'aal1', 'select count(*) from public.workforce_requirements')
  || pg_temp.val_as(:'sadm', 'aal1', 'select count(*) from public.workforce_requirements')
  || pg_temp.val_as(:'u1', 'aal1', 'select count(*) from public.workforce_requirements')
  || pg_temp.val_as(:'u1', 'aal1', 'select count(*) from public.requirement_occupations'),
  '00000', 'AC4: the Beta owner, the candidate, the administrator and a partner read no requirement from the tables');
select is(pg_temp.val_as(:'own1', 'aal1', format('select count(*) from public.workforce_requirements where id = %L', :'r')), '1',
  'AC4: the Acme owner reads R through the member policy');
select is(pg_temp.call_as(:'u1', 'authenticated', 'select count(*) from private.requirement_reveals', 'aal1'),
  '42501|permission denied for table requirement_reveals|', 'NFR-S8: a partner cannot read the reveals');
select is(pg_temp.call_as(:'own1', 'authenticated', 'select count(*) from stats.job_order_partner_weeks', 'aal1'),
  '42501|permission denied for schema stats|', 'NFR-S8: an employer cannot read who used the marketplace');

-- AC5: anonymous job orders hide the employer ----------------------------------------------------------------------------------

select is(private.record_requirement_reveal(:'r', :'p7', 'invitation'), true, 'P7 is invited to R (first reveal)');
select is(private.record_requirement_reveal(:'r', :'p7', 'shortlist'), false, 'a second cause for P7 records nothing new');
select is((select cause from private.requirement_reveals where requirement_id = :'r' and organization_id = :'p7'), 'invitation',
  'the first cause is kept');
select is(private.record_requirement_reveal(:'r', :'p8', 'shortlist'), true, 'P8 is shortlisted on R');
select is(private.record_requirement_reveal(:'r', :'p2', 'invitation'), true, 'P2 (not eligible) is invited to R');
select is(pg_temp.reveal_audits(:'r'), 0, 'recording a reveal writes no audit row by itself');

select is(pg_temp.jo(:'u1', :'p1'), 'ok', 'P1 lists');
select is(pg_temp.row_of(:'r') ->> 'employer_name', null, 'AC5: P1 (not invited) gets no employer name for R');
select is(pg_temp.row_of(:'r') ->> 'employer_company_slug', null, 'AC5: nor the company page slug');
select is(pg_temp.row_of(:'s') ->> 'employer_name', 'Acme Bau', 'AC5: S, shown by the employer, carries the display name');
select is(pg_temp.row_of(:'s') ->> 'employer_company_slug', (select slug from public.organizations where id = current_setting('t.a')::uuid),
  'AC5: and the company page slug while the page is on');
select is(pg_temp.reveal_audits(:'r'), 0, 'AC5: P1''s read writes no reveal audit');

select is(pg_temp.jo(:'u7', :'p7') || (pg_temp.row_of(:'r') ->> 'employer_name'), 'okAcme Bau', 'AC5: invited P7 sees the name of R in the list');
select is(pg_temp.reveal_audits(:'r'), 1, 'AC5: the first time P7 sees it, one audit row');
select is(pg_temp.row_of(:'r') ->> 'title', 'Germany, 100 welders', 'a named row shows the employer''s own title');
select ok(
  exists (select 1 from audit.log where action = 'requirement.employer_revealed' and entity_id = :'r'
    and actor_id = :'u7' and metadata = jsonb_build_object('organization_id', :'p7', 'cause', 'invitation')),
  'AC5: the row names the partner organisation and the cause, with the member as actor');
select is(pg_temp.jo(:'u7', :'p7') || pg_temp.one(:'u7', :'p7', :'r') || (pg_temp.result() ->> 'employer_name'),
  'okokAcme Bau', 'AC5: P7 sees the name on the job order page too');
select is(pg_temp.reveal_audits(:'r'), 1, 'AC5: repeated reads write no further row');
select is(pg_temp.one(:'u8', :'p8', :'r') || (pg_temp.result() ->> 'employer_name'), 'okAcme Bau',
  'AC5: shortlisted P8 sees the name on the job order page');
select is(pg_temp.reveal_audits(:'r'), 2, 'AC5: P8''s first sight is audited once (cause shortlist)');
select ok(
  (select seen_at is not null from private.requirement_reveals where requirement_id = :'r' and organization_id = :'p8'),
  'the reveal of P8 is marked seen');
select is(pg_temp.jo(:'u2', :'p2') || (pg_temp.row_of(:'r') ->> 'employer_name'), 'okAcme Bau',
  'AC5: a revealed partner that is not eligible sees the name on its reduced row');
select is((pg_temp.row_of(:'r') ->> 'title') || ' / ' || coalesce(pg_temp.row_of(:'r') ->> 'city_region', 'no city'),
  'Germany, 100 welders / no city', 'AC5: with the employer''s own title, still without the details of a full row');
select is(pg_temp.reveal_audits(:'r'), 3, 'AC5: its first sight is audited once');
select is(pg_temp.one(:'u2', :'p2', :'r') || (pg_temp.result() ->> 'employer_name'), 'okAcme Bau', 'AC5: the page names the employer too');
select is(pg_temp.reveal_audits(:'r'), 3, 'AC5: no further row');
select is(pg_temp.jo(:'u1', :'p1') || coalesce(pg_temp.row_of(:'r') ->> 'employer_name', 'none'), 'oknone',
  'AC5: the reveals to P7 and P8 change nothing for P1');

-- NFR-S11: no free text on an unnamed row; a city naming the employer is left out
select pg_temp.req(current_setting('t.a')::uuid, 'ACME-BAU welders wanted', 'open', 'job_order_marketplace', '{"7212": 30}',
  p_city => 'Hamburg, Acme Bau yard', p_skills => 'Experience with the acme-bau.de site rules',
  p_published => now() - interval '20 days') as rt \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Acme Bau welders, named', 'open', 'job_order_marketplace', '{"7212": 30}',
  p_show => true, p_city => 'Hamburg, Acme Bau yard', p_skills => 'Acme Bau site rules', p_published => now() - interval '21 days') as rtn \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Welders for Hamburg harbour', 'open', 'job_order_marketplace', '{"7212": 30}',
  p_skills => 'Plain welding', p_city => 'Hamburg Altona', p_published => now() - interval '22 days') as rtc \gset
select is(pg_temp.jo(:'u1', :'p1'), 'ok', 'P1 lists');
select is(pg_temp.row_of(:'rt') ->> 'title', 'Germany, 30 Welders and flame cutters', 'NFR-S11: an unnamed row shows the generated title');
select is(pg_temp.row_of(:'rtc') ->> 'title', 'Germany, 30 Welders and flame cutters',
  'NFR-S11: even when the employer''s own title does not name it (the AC: the title is generated)');
select is(pg_temp.row_of(:'rt') ->> 'city_region', null, 'NFR-S11: a city naming the hidden employer is left out');
select is(pg_temp.row_of(:'rtc') ->> 'city_region', 'Hamburg Altona', 'a city that does not name the employer stays');
select is(pg_temp.one(:'u1', :'p1', :'rtc') || coalesce(pg_temp.result() ->> 'skills', 'none'), 'oknone',
  'NFR-S11: an unnamed job order page carries no skills text at all');
select is(pg_temp.result() ->> 'title', 'Germany, 30 Welders and flame cutters', 'NFR-S11: the page shows the generated title as well');
select is(pg_temp.one(:'u1', :'p1', :'rtn') || (pg_temp.result() ->> 'title') || ' / ' || (pg_temp.result() ->> 'city_region')
  || ' / ' || (pg_temp.result() ->> 'skills'),
  'okAcme Bau welders, named / Hamburg, Acme Bau yard / Acme Bau site rules', 'with the name shown, the employer''s own words stay');
select is(pg_temp.jo(:'u2', :'p2') || (pg_temp.row_of(:'rtn') ->> 'title'), 'okGermany, 30 Welders and flame cutters',
  'NFR-S11: a reduced row of a named job order is unnamed, so it shows the generated title');
select is(pg_temp.jo(:'u7', :'p7') || (pg_temp.row_of(:'rt') ->> 'title'), 'okGermany, 30 Welders and flame cutters',
  'NFR-S11: a partner revealed on another job order of the employer gets the generated title of this one');

-- The city matcher against an employer "Müller Bau GmbH & Co. KG" (display name Müller Bau) with its site at
-- mueller-bau.de: every spelling of its name in a city is found; ordinary places and legal-form words are not.
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, website)
values ('00000000-0000-0000-0000-0000000f39b1', 'employer', 'mueller-bau-v39', 'Müller Bau GmbH & Co. KG', 'Müller Bau', 'DE',
  'https://jobs.mueller-bau.de/karriere');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values ('00000000-0000-0000-0000-0000000f39b1', :'zown', 'owner', now());
select is(
  (select string_agg(c.city || '=' || private.city_names_organization(c.city, '00000000-0000-0000-0000-0000000f39b1'), '; ' order by c.n)
   from unnest(array['Müller-Bau Werk Hamburg', 'Mueller Bau site', 'MUELLERBAU yard', 'Werk Müller, Hamburg', 'Muller Hamburg',
     'Hamburg (mueller-bau.de)', 'Gelände der Mueller-Bau GmbH', 'Hamburg, MüllerBau-Halle']) with ordinality c (city, n)),
  'Müller-Bau Werk Hamburg=true; Mueller Bau site=true; MUELLERBAU yard=true; Werk Müller, Hamburg=true; Muller Hamburg=true; '
  || 'Hamburg (mueller-bau.de)=true; Gelände der Mueller-Bau GmbH=true; Hamburg, MüllerBau-Halle=true',
  'NFR-S11: Müller Bau with and without accents, ue for ü, hyphens, spaces or none, its domain: all found');
select is(
  (select string_agg(c.city || '=' || private.city_names_organization(c.city, '00000000-0000-0000-0000-0000000f39b1'), '; ' order by c.n)
   from unnest(array['Hamburg Altona', 'GmbH-Park Bremen', 'Bauhaus-Viertel', 'Jobs Center Kiel', 'Karriere-Allee 4']) with ordinality c (city, n)),
  'Hamburg Altona=false; GmbH-Park Bremen=false; Bauhaus-Viertel=false; Jobs Center Kiel=false; Karriere-Allee 4=false',
  'NFR-S11: ordinary places, legal forms, the three-letter "Bau", and generic words of the address (jobs, karriere) are not names');
select is(private.organization_name_keys('00000000-0000-0000-0000-0000000f39b1'),
  array['muller bau', 'muller bau', 'muller bau v39', 'muller bau'],
  'the names: display name, legal name without GmbH & Co. KG, slug, and the registrable label of the site (not "jobs")');
update public.organizations set website = 'https://www.linkedin.com/company/acme-bauwerke' where id = '00000000-0000-0000-0000-0000000f39b1';
select ok(private.city_names_organization('Hamburg, Acme Bauwerke Halle', '00000000-0000-0000-0000-0000000f39b1'),
  'on a social site the name is the first path segment that is not generic');
update public.organizations set website = 'https://muellerhaus.wixsite.com/home' where id = '00000000-0000-0000-0000-0000000f39b1';
select ok(private.city_names_organization('Muellerhaus Halle', '00000000-0000-0000-0000-0000000f39b1'),
  'on a hosting site the subdomain is a name');
update public.organizations set website = 'https://www.mueller.co.uk' where id = '00000000-0000-0000-0000-0000000f39b1';
select is((private.organization_name_keys('00000000-0000-0000-0000-0000000f39b1'))[4], 'muller',
  'a two-part public suffix (co.uk) gives the label before it');
select is(private.job_order_neutral_title(:'r'), 'Germany, 80 Welders and flame cutters, 20 Structural-metal preparers and erectors', 'the generated title');
delete from public.requirement_occupations where requirement_id = :'rtc';
select is(private.job_order_neutral_title(:'rtc'), 'Germany, 30', 'without an occupation the title has no trailing space');
insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (:'rtc', '7411', 10);
select is(private.job_order_neutral_title(:'rtc'), 'Germany, 10 Building and related electricians',
  'one occupation is named with its own quantity, not all the workers');
insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (:'rtc', '7212', 20);
select is(private.job_order_neutral_title(:'rtc'), 'Germany, 20 Welders and flame cutters, 10 Building and related electricians',
  'several occupations are each named with their quantity, the largest first');
delete from public.requirement_occupations where requirement_id = :'rtc';
insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (:'rtc', '7212', 30);

-- Several destinations: the full row names them all; the reduced row only the main one -------------------------------------

select pg_temp.req(current_setting('t.b')::uuid, 'Netherlands and Germany welders', 'open', 'job_order_marketplace', '{"7212": 10}', 'NL',
  p_published => now() - interval '30 days') as rm \gset
insert into public.requirement_countries (requirement_id, country_code) values (:'rm', 'DE');
select is(pg_temp.jo(:'u1', :'p1') || (pg_temp.row_of(:'rm') ->> 'countries'), 'ok["NL", "DE"]',
  'P1 serves DE, one of the destinations: eligible, every destination named, the main one first');
select is(pg_temp.jo(:'u2', :'p2', ', p_destination => ''DE''') || coalesce(pg_temp.row_of(:'rm') ->> 'id', 'none'), 'oknone',
  'a reduced row is filtered on its main destination only, so its further destinations stay hidden');
select is(pg_temp.jo(:'u1', :'p1', ', p_destination => ''DE''') || (pg_temp.row_of(:'rm') ->> 'eligible'), 'oktrue',
  'an eligible partner finds it under any of its destinations');
-- P3 (paid, 5120) serving DE, a further destination of rm, and P2-like partners serving nothing of it get the same reasons.
select is(pg_temp.jo(:'u3', :'p3') || (pg_temp.row_of(:'rm') ->> 'reasons'), 'ok["served_country_missing", "occupation_missing"]',
  'a partner serving only a further destination is told the main one is missing, so the further one is not revealed');
update public.organization_geographies set country_code = 'FR' where organization_id = :'p3';
select is(pg_temp.jo(:'u3', :'p3') || (pg_temp.row_of(:'rm') ->> 'reasons'), 'ok["served_country_missing", "occupation_missing"]',
  'the same reasons when it serves no destination of the job order at all');
update public.organization_geographies set country_code = 'DE' where organization_id = :'p3';

-- AC6: filters narrow the list and combine with AND -------------------------------------------------------------------------

select pg_temp.req(current_setting('t.b')::uuid, 'F01', 'open', 'job_order_marketplace', '{"7212": 5}', 'DE', 'C', '2026-12-01', 'local');
select pg_temp.req(current_setting('t.b')::uuid, 'F02', 'open', 'job_order_marketplace', '{"7212": 50}', 'DE', 'C', '2027-01-01', 'international');
select pg_temp.req(current_setting('t.b')::uuid, 'F03', 'open', 'job_order_marketplace', '{"7214": 100}', 'DE', 'F', '2027-03-31', 'both');
select pg_temp.req(current_setting('t.b')::uuid, 'F04', 'open', 'job_order_marketplace', '{"7212": 500}', 'NL', 'C', '2027-06-01', 'local');
select pg_temp.req(current_setting('t.b')::uuid, 'F05', 'open', 'job_order_marketplace', '{"5120": 50}', 'NL', 'F', '2027-02-15', 'international');
select pg_temp.req(current_setting('t.b')::uuid, 'F06', 'open', 'job_order_marketplace', '{"7212": 60, "7214": 40}', 'DE', 'C', '2027-04-01', 'both');
select pg_temp.req(current_setting('t.b')::uuid, 'F07', 'open', 'job_order_marketplace', '{"7214": 51}', 'NL', 'C', '2027-01-10', 'both');
select pg_temp.req(current_setting('t.b')::uuid, 'F08', 'open', 'job_order_marketplace', '{"5120": 99}', 'DE', 'F', '2026-12-15', 'local');
-- Equal publication times, so the order is by id and the sorted titles are compared.
update public.workforce_requirements set published_at = now() - interval '5 days' where title like 'F0_';

create function pg_temp.filtered(p_args text) returns text
language plpgsql as $$
declare
  v_state text := pg_temp.jo(current_setting('t.uf')::uuid, current_setting('t.pf')::uuid, p_args || ', p_limit => 50');
begin
  if v_state <> 'ok' then return v_state; end if;
  return pg_temp.sorted_titles('F0');
end;
$$;
select set_config('t.uf', :'uf', false) as setup_uf \gset
select set_config('t.pf', :'pf', false) as setup_pf \gset

select is(pg_temp.filtered(''), 'F01,F02,F03,F04,F05,F06,F07,F08', 'AC6: without filters every job order');
select is(pg_temp.filtered(', p_destination => ''DE'''), 'F01,F02,F03,F06,F08', 'AC6: destination DE');
select is(pg_temp.filtered(', p_destination => ''de'''), 'F01,F02,F03,F06,F08', 'AC6: a lower-case destination is the same');
select is(pg_temp.filtered(', p_occupation => ''7212'''), 'F01,F02,F04,F06', 'AC6: occupation 7212');
select is(pg_temp.filtered(', p_industry => ''C'''), 'F01,F02,F04,F06,F07', 'AC6: industry C');
select is(pg_temp.filtered(', p_workers_min => 50, p_workers_max => 100'), 'F02,F03,F05,F06,F07,F08',
  'AC6: workers from 50 to 100 include 50 and 100 and exclude 5 and 500');
select is(pg_temp.filtered(', p_start_from => ''2027-01-01'', p_start_to => ''2027-03-31'''), 'F02,F03,F05,F07',
  'AC6: start date from 2027-01-01 to 2027-03-31, both ends included');
select is(pg_temp.filtered(', p_recruitment => ''local'''), 'F01,F03,F04,F06,F07,F08', 'AC6: local returns local and both');
select is(pg_temp.filtered(', p_recruitment => ''international'''), 'F02,F03,F05,F06,F07', 'AC6: international returns international and both');
select is(pg_temp.filtered(', p_source => ''PH'''), 'F02,F03,F05,F06,F07', 'AC6: source PH returns international and both');
select is(pg_temp.filtered(', p_source => ''DE'''), 'F01,F02,F03,F05,F06,F07,F08',
  'AC6: source DE adds the local job orders whose destination is DE');
select is(pg_temp.filtered(', p_destination => ''DE'', p_occupation => ''7212'', p_workers_min => 50'), 'F02,F06',
  'AC6: combined filters return the intersection');
select is(pg_temp.filtered(', p_destination => ''XX'''), '', 'an unknown country answers no rows');
select is(
  (select count(*)::integer from pg_proc p, unnest(p.proargnames) n
   where p.oid = 'public.list_job_orders(uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer)'::regprocedure
     and n ~* 'verif'),
  0, 'AC6: no filter offers a verification value');

-- A partner that sees titles only is filtered on what it sees.
select is(pg_temp.jo(:'u2', :'p2', ', p_destination => ''DE'', p_limit => 50') || pg_temp.sorted_titles('F0'), 'okF01,F02,F03,F06,F08',
  'P2 filters its reduced rows by destination');
select is(pg_temp.jo(:'u2', :'p2', ', p_workers_min => 100, p_limit => 50') || pg_temp.sorted_titles('F0'), 'okF03,F04,F06',
  'P2 filters its reduced rows by the number of workers');
select is(pg_temp.jo(:'u2', :'p2', ', p_occupation => ''7212'', p_limit => 50') || pg_temp.ids(), 'ok',
  'a filter on a field P2 cannot see returns only eligible job orders (none for P2)');
select is(pg_temp.jo(:'u2', :'p2', ', p_industry => ''C'', p_limit => 50') || pg_temp.ids(), 'ok', 'the same for the industry');
select is(pg_temp.jo(:'u1', :'p1', ', p_industry => ''F'', p_limit => 50') || pg_temp.titles('F0'), 'ok',
  'P1 (DE, 7212) filtering industry F gets no reduced rows: F03 (7214), F05 (NL) and F08 (5120) do not fit it');

-- Input -------------------------------------------------------------------------------------------------------------------

select is(pg_temp.jo(:'u1', :'p1', ', p_destination => ''DEU'''), 'P0001|CHARA_INVALID_INPUT|p_destination', 'a three-letter destination is refused');
select is(pg_temp.jo(:'u1', :'p1', ', p_source => ''P'''), 'P0001|CHARA_INVALID_INPUT|p_source', 'a malformed source country is refused');
select is(pg_temp.jo(:'u1', :'p1', ', p_occupation => ''72'''), 'P0001|CHARA_INVALID_INPUT|p_occupation', 'a malformed occupation is refused');
select is(pg_temp.jo(:'u1', :'p1', ', p_industry => ''CC'''), 'P0001|CHARA_INVALID_INPUT|p_industry', 'a malformed industry is refused');
select is(pg_temp.jo(:'u1', :'p1', ', p_workers_min => 0'), 'P0001|CHARA_INVALID_INPUT|p_workers_min', 'workers from 0 is refused');
select is(pg_temp.jo(:'u1', :'p1', ', p_workers_max => 100001'), 'P0001|CHARA_INVALID_INPUT|p_workers_max', 'workers to 100,001 is refused');
select is(pg_temp.jo(:'u1', :'p1', ', p_workers_min => 1, p_workers_max => 100000'), 'ok', '1 and 100,000 are accepted');
select is(pg_temp.jo(:'u1', :'p1', ', p_workers_min => 200, p_workers_max => 100'), 'P0001|CHARA_INVALID_INPUT|p_workers_min',
  'a minimum above the maximum names the minimum');
select is(pg_temp.jo(:'u1', :'p1', ', p_workers_min => 200, p_workers_max => 0'), 'P0001|CHARA_INVALID_INPUT|p_workers_max',
  'each range is checked before the two are compared: a maximum of 0 is named, not the minimum');
select is(pg_temp.jo(:'u1', :'p1', ', p_start_from => ''2027-03-01'', p_start_to => ''2027-02-01'''),
  'P0001|CHARA_INVALID_INPUT|p_start_from', 'a start from after the start to names start from');
select is(pg_temp.jo(:'u1', :'p1', ', p_recruitment => ''both'''), 'P0001|CHARA_INVALID_INPUT|p_recruitment', 'recruitment both is refused');
select is(pg_temp.jo(:'u1', :'p1', format(', p_cursor => %L', gen_random_uuid())), 'P0001|CHARA_INVALID_INPUT|p_cursor', 'an unknown cursor is refused');
select is(pg_temp.jo(:'u1', :'p1', format(', p_cursor => %L', :'rpriv')), 'P0001|CHARA_INVALID_INPUT|p_cursor',
  'a private requirement is no cursor, so its publication time cannot be probed');
select is(pg_temp.jo(:'u1', :'p1', ', p_limit => 0') || jsonb_array_length(pg_temp.result()), 'ok1', 'a limit of 0 gives one row');
select is(pg_temp.jo(:'uf', :'pf', ', p_limit => 99') || (jsonb_array_length(pg_temp.result()) <= 50)::text, 'oktrue', 'a limit of 99 gives at most 50');
select is(pg_temp.jo(:'uf', :'pf') || jsonb_array_length(pg_temp.result()),
  'ok' || (select count(*) from public.workforce_requirements r join public.organizations e on e.id = r.organization_id
           where r.status = 'open' and r.visibility = 'job_order_marketplace' and e.status = 'active'),
  'without a limit every open job order of an active employer fits the default page of 20 here');

-- AC8: order and response counts ------------------------------------------------------------------------------------------

select pg_temp.req(current_setting('t.b')::uuid, 'O1', 'open', 'job_order_marketplace', '{"7212": 10}', p_industry => 'Q',
  p_published => '2026-10-20 10:00+00', p_id => '00000000-0000-0000-0000-0000000f39a1');
select pg_temp.req(current_setting('t.b')::uuid, 'O2', 'open', 'job_order_marketplace', '{"7212": 10}', p_industry => 'Q',
  p_published => '2026-10-20 10:00+00', p_id => '00000000-0000-0000-0000-0000000f39a2');
select pg_temp.req(current_setting('t.b')::uuid, 'O3', 'open', 'job_order_marketplace', '{"7212": 10}', p_industry => 'Q',
  p_published => '2026-10-20 11:00+00', p_id => '00000000-0000-0000-0000-0000000f39a3');
select pg_temp.req(current_setting('t.b')::uuid, 'O4', 'open', 'job_order_marketplace', '{"7212": 10}', p_industry => 'Q',
  p_published => '2026-10-20 12:00+00', p_id => '00000000-0000-0000-0000-0000000f39a4');

select is(pg_temp.jo(:'u1', :'p1', ', p_industry => ''Q''') || pg_temp.titles(), 'okO4,O3,O1,O2',
  'AC8: published_at descending, then id');
select is(pg_temp.jo(:'u1', :'p1', ', p_industry => ''Q''') || pg_temp.titles(), 'okO4,O3,O1,O2', 'AC8: the same order on every call');
select is(pg_temp.jo(:'u4', :'p4', ', p_destination => ''DE'', p_workers_max => 10, p_limit => 50') || pg_temp.titles('O'), 'okO4,O3,O1,O2',
  'NFR-C8: a partner that sees titles only gets the same order');
select is(pg_temp.jo(:'u1', :'p1', ', p_industry => ''Q'', p_limit => 2'), 'ok', 'a page of two');
select is(pg_temp.titles() || ' ' || coalesce(pg_temp.result() -> 0 ->> 'next_cursor', '-') || ' ' || (pg_temp.result() -> 1 ->> 'next_cursor'),
  'O4,O3 - 00000000-0000-0000-0000-0000000f39a3', 'the last row of a page with more carries the cursor');
select is(pg_temp.jo(:'u1', :'p1', ', p_industry => ''Q'', p_limit => 2, p_cursor => ''00000000-0000-0000-0000-0000000f39a3''')
  || pg_temp.titles() || coalesce(pg_temp.result() -> 1 ->> 'next_cursor', '-'), 'okO1,O2-', 'the next page continues after the cursor and is the last');
select is(pg_temp.jo(:'u1', :'p1', ', p_industry => ''Q'', p_limit => 3, p_cursor => ''00000000-0000-0000-0000-0000000f39a4''')
  || pg_temp.titles(), 'okO3,O1,O2', 'within equal times the cursor continues by id');

-- Response counts: private.requirement_response_count counts nothing before V44; it is replaced here by fixed counts.
create table pg_temp.response_counts (requirement_id uuid primary key, n integer);
insert into pg_temp.response_counts values
  ('00000000-0000-0000-0000-0000000f39a1', 0), ('00000000-0000-0000-0000-0000000f39a2', 4),
  ('00000000-0000-0000-0000-0000000f39a3', 5), ('00000000-0000-0000-0000-0000000f39a4', 12);
grant select on pg_temp.response_counts to authenticated;
create or replace function private.requirement_response_count(p_requirement uuid) returns integer
language sql stable set search_path = '' as $$
  select coalesce((select c.n from pg_temp.response_counts c where c.requirement_id = p_requirement), 0)
$$;
select is(pg_temp.jo(:'u1', :'p1', ', p_industry => ''Q'''), 'ok', 'P1 lists with responses');
select is(
  (select string_agg(coalesce(e ->> 'response_count', 'fewer than ' || (e ->> 'responses_fewer_than')), ',' order by n)
   from jsonb_array_elements(pg_temp.result()) with ordinality r (e, n)),
  '12,5,fewer than 5,fewer than 5', 'AC8: 12 and 5 are counted, 0 and 4 are fewer than 5');
select is(pg_temp.one(:'u1', :'p1', '00000000-0000-0000-0000-0000000f39a4') || (pg_temp.result() ->> 'response_count'), 'ok12',
  'AC8: the page gives the count');
update private.settings set value = '3' where key = 'job_order_response_count_min';
select is(pg_temp.jo(:'u1', :'p1', ', p_industry => ''Q''')
  || (select string_agg(coalesce(e ->> 'response_count', 'fewer than ' || (e ->> 'responses_fewer_than')), ',' order by n)
      from jsonb_array_elements(pg_temp.result()) with ordinality r (e, n)),
  'ok12,5,fewer than 3,4', 'NFR-O5: the threshold is the setting');
update private.settings set value = '5' where key = 'job_order_response_count_min';
select is(pg_temp.jo(:'u4', :'p4', ', p_destination => ''DE'', p_workers_max => 10, p_limit => 50')
  || (select count(*) from jsonb_array_elements(pg_temp.result()) e
      join public.workforce_requirements w on w.id = (e ->> 'id')::uuid
      where w.title like 'O_' and (e ->> 'response_count' is not null or e ->> 'responses_fewer_than' is not null)),
  'ok0', 'AC3: a reduced row carries no response count');

-- KPI, rate limit, release switch ---------------------------------------------------------------------------------------------

select ok(
  exists (select 1 from stats.job_order_partner_weeks
    where organization_id = :'p1' and week_start = date_trunc('week', now() at time zone 'utc')::date),
  'KPI weekly active partners: P1 is recorded for this week');
select is(
  (select count(*)::integer from stats.job_order_partner_weeks where organization_id in (:'p5', :'p6', :'ph', :'pd')),
  0, 'KPI: refused partners are not recorded');
select is((select count(*)::integer from stats.job_order_partner_weeks where organization_id = :'p1'), 1,
  'KPI: one row per partner and week, however many calls');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'stats' and table_name = 'job_order_partner_weeks'),
  array['week_start', 'organization_id', 'first_seen_at', 'last_seen_at'], 'KPI: no user and no job order is recorded');
select is((select count(*) from public.notifications)::text, current_setting('t.notifications'), 'reading job orders notifies nobody');

update private.settings set value = '2' where key = 'rate_limit_job_orders_max';
delete from private.rate_limit_hits;
select is(
  pg_temp.call_as(:'u1', 'authenticated', format('select count(*) from public.list_job_orders(%L)', :'p1'), 'aal1') || ','
  || pg_temp.call_as(:'u1', 'authenticated', format('select count(*) from public.get_job_order(%L, %L)', :'p1', :'r'), 'aal1') || ','
  || pg_temp.call_as(:'u1', 'authenticated', format('select count(*) from public.list_job_orders(%L)', :'p1'), 'aal1'),
  'ok,ok,P0001|CHARA_RATE_LIMITED|', 'the list and the page share the per-user allowance');
update private.settings set value = '60' where key = 'rate_limit_job_orders_max';

update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.jo(:'u1', :'p1'), '42501|CHARA_FORBIDDEN|release_off', 'release_job_orders off: the list is refused');
select is(pg_temp.one(:'u1', :'p1', :'r'), '42501|CHARA_FORBIDDEN|release_off', 'release_job_orders off: the page is refused');

select * from finish();
rollback;
