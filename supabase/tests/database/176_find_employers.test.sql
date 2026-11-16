begin;
select plan(105);

\ir jobs_fixture.inc

-- Find employers for partners (V53, FR-L3 AC1 to AC6, AC10 and the data of AC9; SOP P2-12 steps Search, Show, Limit;
-- controls anonymity in every view, rate limits; decisions 2.2, 3.2, 3.6; NFR-S8, NFR-S11, NFR-C8, NFR-M3):
-- search_employers, save_employer_search, delete_saved_search, public.saved_searches and the employers kind of the search
-- log. Acme (t.a: owner own1, admin adm, member mem; Construction, based in DE) and Beta (t.b: owner own2, admin adm2)
-- are employers of the fixture and wkr is a candidate; the other employers, a second candidate and the partners, each
-- with an owner of its own, are made below.

\set w2 '00000000-0000-0000-0000-0000000f5300'
\set gown '00000000-0000-0000-0000-0000000f5301'
\set gamma '00000000-0000-0000-0000-0000000f5311'
\set delta '00000000-0000-0000-0000-0000000f5312'
\set epsilon '00000000-0000-0000-0000-0000000f5313'
\set zeta '00000000-0000-0000-0000-0000000f5314'
\set eta '00000000-0000-0000-0000-0000000f5315'
\set omega '00000000-0000-0000-0000-0000000f5316'
\set ub '00000000-0000-0000-0000-0000000f5321'
\set up '00000000-0000-0000-0000-0000000f5322'
\set upm '00000000-0000-0000-0000-0000000f5323'
\set uf '00000000-0000-0000-0000-0000000f5324'
\set us '00000000-0000-0000-0000-0000000f5325'
\set un '00000000-0000-0000-0000-0000000f5326'
\set ux '00000000-0000-0000-0000-0000000f5327'
\set uh '00000000-0000-0000-0000-0000000f5328'

select pg_temp.new_user(:'w2', 'worker');
select pg_temp.new_user(:'gown');
update public.profiles set account_kind = intended_account_kind where id in (:'w2', :'gown');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, industry_code, status) values
  (:'gamma', 'employer', 'gamma-v53', 'Gamma Stahl GmbH', 'Gamma Stahl', 'DE', 'C', 'active'),
  (:'delta', 'employer', 'delta-v53', 'Delta Private GmbH', 'Delta Private', 'DE', 'C', 'active'),
  (:'epsilon', 'employer', 'epsilon-v53', 'Epsilon Suspended GmbH', 'Epsilon Suspended', 'DE', 'C', 'suspended'),
  (:'zeta', 'employer', 'zeta-v53', 'Zeta Paused GmbH', 'Zeta Paused', 'DE', 'C', 'active'),
  (:'eta', 'employer', 'eta-v53', 'Eta France SARL', 'Eta France', 'FR', 'C', 'active'),
  (:'omega', 'employer', 'omega-v53', 'Omega Sizes GmbH', 'Omega Sizes', 'DE', 'C', 'active');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
select o, :'gown', 'owner', now() from unnest(array[:'gamma', :'delta', :'epsilon', :'zeta', :'eta', :'omega']::uuid[]) o;
update public.organizations set public_page_enabled = true where id in (current_setting('t.a')::uuid, :'epsilon');
update private.settings set value = 'true' where key in ('release_job_orders', 'release_partner_directories', 'entitlements_enforced');

-- A listed partner of p_type owned by p_owner, serving p_serves and listing p_occupations, with an active subscription
-- to p_plan (none when null, so the free plan code).
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

-- An open requirement of p_org with the visibility p_visibility (or the status p_status), the occupations p_occupations
-- ({"7212": 80, ...}), the destination p_country and the industry p_industry, published p_days ago.
create function pg_temp.req(
  p_org uuid, p_title text, p_occupations jsonb, p_show boolean default false, p_days integer default 10,
  p_country text default 'DE', p_industry text default 'C', p_visibility text default 'job_order_marketplace',
  p_status text default 'open'
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, duration_months,
    employment_type, recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on
  ) values (
    v_id, p_org, p_title, (select sum(value::integer) from jsonb_each_text(p_occupations)), p_country, 'Hamburg', p_industry,
    '2027-03-01', 12, 'full_time', 'both', 'both', p_status::public.requirement_status,
    p_visibility::public.requirement_visibility, p_show, now() - make_interval(days => p_days), '2027-04-01'
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select v_id, key, value::integer from jsonb_each_text(p_occupations);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, p_country);
  return v_id;
end;
$$;

-- search_employers as p_user (anonymous when null) for p_org with further arguments p_args: 'ok' with the rows in order
-- as a JSON array in t.result, or 'sqlstate|message|detail'. Each call starts with a fresh rate-limit window unless
-- p_keep_limit.
create function pg_temp.se(p_user uuid, p_org uuid, p_args text default '', p_keep_limit boolean default false) returns text
language plpgsql as $$
begin
  if not p_keep_limit then
    delete from private.rate_limit_hits;
  end if;
  return pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', coalesce((select jsonb_agg(to_jsonb(r) order by r.n)
       from (select s.*, row_number() over () as n from public.search_employers(%L%s) s) r)::text, '[]'), true)$f$,
    p_org, p_args), 'aal1');
end;
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

-- The rows in order: a company by its display name, a job order row by the employer's own title in the table.
create function pg_temp.labels() returns text
language sql as $$
  select coalesce(string_agg(case when e ->> 'kind' = 'company' then e ->> 'display_name' else 'jo:' || w.title end, ',' order by n), '')
  from jsonb_array_elements(pg_temp.result()) with ordinality r (e, n)
  left join public.workforce_requirements w on e ->> 'kind' = 'job_order' and w.id = (e -> 'job_orders' -> 0 ->> 'id')::uuid
$$;

create function pg_temp.company(p_name text) returns jsonb
language sql as $$
  select e from jsonb_array_elements(pg_temp.result()) e where e ->> 'kind' = 'company' and e ->> 'display_name' = p_name
$$;

create function pg_temp.job_order_row(p_req uuid) returns jsonb
language sql as $$
  select e from jsonb_array_elements(pg_temp.result()) e
  where e ->> 'kind' = 'job_order' and e -> 'job_orders' -> 0 ->> 'id' = p_req::text
$$;

-- Whether p_req appears anywhere in the result, as a row or inside a company's job orders.
create function pg_temp.listed(p_req uuid) returns boolean
language sql as $$
  select exists (
    select 1 from jsonb_array_elements(pg_temp.result()) e, jsonb_array_elements(e -> 'job_orders') j where j ->> 'id' = p_req::text)
$$;

-- Partners --------------------------------------------------------------------------------------------------------------------

select pg_temp.partner('v53-basic', :'ub', '{DE}', '{7212}') as pb \gset
select pg_temp.partner('v53-pro', :'up', '{DE}', '{7212,7214}', 'recruitment_professional') as pp \gset
select pg_temp.new_user(:'upm');
update public.profiles set account_kind = intended_account_kind where id = :'upm';
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'pp', :'upm', 'member', now());
select pg_temp.partner('v53-free', :'uf', '{DE}', '{7212}', null) as pf \gset
select pg_temp.partner('v53-staffing', :'us', '{DE}', '{7212}', 'staffing_partner', 'staffing_company') as ps \gset
select pg_temp.partner('v53-pending', :'un', '{DE}', '{7212}') as pn \gset
update public.organizations set review_status = 'pending_review', listed_at = null where id = :'pn';
select pg_temp.partner('v53-suspended', :'ux', '{DE}', '{7212}') as px \gset
update public.organizations set status = 'suspended' where id = :'px';
select pg_temp.partner('v53-hidden', :'uh', '{DE}', '{7212}') as ph \gset
update public.organizations set moderation_state = 'hidden' where id = :'ph';

-- Requirements (AC2): Beta named, Gamma anonymous, Delta private, Zeta paused, Eta named but in a country Basic does not
-- serve, Epsilon suspended.
select pg_temp.req(current_setting('t.b')::uuid, 'Beta named welders', '{"7212": 40}', p_show => true, p_days => 3) as rbeta \gset
select pg_temp.req(:'gamma', 'Gamma secret welders', '{"7212": 100}', p_days => 2) as rgamma \gset
select pg_temp.req(:'delta', 'Delta private welders', '{"7212": 10}', p_visibility => 'private') as rdelta \gset
select pg_temp.req(:'zeta', 'Zeta paused welders', '{"7212": 10}', p_status => 'paused') as rzeta \gset
select pg_temp.req(:'eta', 'Eta named welders', '{"7212": 20}', p_show => true, p_days => 4, p_country => 'FR') as reta \gset
select pg_temp.req(:'epsilon', 'Epsilon welders', '{"7212": 10}', p_show => true) as reps \gset

-- The functions, their grants and their columns ----------------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.search_employers(uuid, text, text, text, integer, uuid, integer)', 'execute')
  and not has_function_privilege('service_role', 'public.search_employers(uuid, text, text, text, integer, uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.search_employers(uuid, text, text, text, integer, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.save_employer_search(uuid, text, text, text, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.save_employer_search(uuid, text, text, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.delete_saved_search(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_saved_search(uuid, uuid)', 'execute'),
  'AC1: search_employers, save_employer_search and delete_saved_search are executable by authenticated only');
select is(
  (select count(*)::integer from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('assert_employer_search_partner', 'employer_search_job_orders', 'employer_search_job_order')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'no API role executes the private helpers');
select is(
  (select array_agg(n order by o) from pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) with ordinality a (n, m, o)
   where p.oid = 'public.search_employers(uuid, text, text, text, integer, uuid, integer)'::regprocedure and m = 't'),
  array['kind', 'employer_id', 'display_name', 'slug', 'website', 'based_in_country', 'industry_code', 'open_vacancy_count',
        'job_order_count', 'job_orders', 'next_cursor']::text[],
  'AC10: the result columns: no email, phone, member, legal name or plan');
select ok(
  (select prosrc ~ 'order by r\.sort_at desc nulls last, r\.id' and prosrc !~* 'order by[^;]*(billing|plan_code|has_feature)'
   from pg_proc where oid = 'public.search_employers(uuid, text, text, text, integer, uuid, integer)'::regprocedure),
  'NFR-C8, AC6: the order is the latest activity then id, and no order by reads a plan');
select ok(
  (select value #>> '{}' from private.settings where key = 'rate_limit_employer_search_max') = '60'
  and (select value #>> '{}' from private.settings where key = 'rate_limit_employer_search_seconds') = '60',
  'AC10: the allowance is 60 searches in 60 seconds');

-- AC1: who may search --------------------------------------------------------------------------------------------------------------

select is(pg_temp.se(:'ub', :'pb'), 'ok', 'AC1: a listed recruitment company on Basic searches');
select is(pg_temp.se(:'up', :'pp'), 'ok', 'AC1: a listed recruitment company on Professional searches');
select is(pg_temp.se(:'us', :'ps'), 'ok', 'AC1: a listed staffing company on Basic searches');
select is(pg_temp.se(:'upm', :'pp'), 'ok', 'AC1: a member of the company searches too');
select is(pg_temp.se(:'uf', :'pf'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|employer_discovery', 'AC1: a partner on the free plan is refused');
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(pg_temp.se(:'uf', :'pf'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|employer_discovery',
  'AC1, decision 3.6: the free plan is refused while entitlements_enforced is off too');
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.se(:'un', :'pn'), '42501|CHARA_FORBIDDEN|not_listed', 'AC1: a partner in review is refused, not listed');
select is(pg_temp.se(:'ux', :'px'), '42501|CHARA_FORBIDDEN|organization_suspended', 'a suspended partner is refused');
select is(pg_temp.se(:'uh', :'ph'), '42501|CHARA_FORBIDDEN|profile_hidden', 'a partner hidden by moderation is refused');
select is(pg_temp.se(:'adm', current_setting('t.a')::uuid), '42501|CHARA_FORBIDDEN|partner_only', 'AC1: an employer admin is refused');
select is(pg_temp.se(:'adm2', current_setting('t.b')::uuid), '42501|CHARA_FORBIDDEN|partner_only', 'AC1: the second employer too');
select is(pg_temp.se(:'adm', :'pb'), '42501|CHARA_FORBIDDEN|', 'AC1: an employer admin naming a partner it does not belong to is refused');
select is(pg_temp.se(:'wkr', :'pb'), '42501|CHARA_FORBIDDEN|', 'AC1: a candidate is refused');
select is(pg_temp.se(:'w2', :'pp'), '42501|CHARA_FORBIDDEN|', 'AC1: a second candidate is refused');
select is(pg_temp.se(:'ub', :'pp'), '42501|CHARA_FORBIDDEN|', 'a partner naming another partner is refused');
select matches(pg_temp.se(null, :'pb'), '^42501\|permission denied', 'AC1: an anonymous caller has no execute grant');

-- AC2: which employers are returned ----------------------------------------------------------------------------------------------

select is(pg_temp.se(:'ub', :'pb'), 'ok', 'AC2: the Basic partner searches without filters');
select is(pg_temp.labels(), 'jo:Gamma secret welders,Beta Works,jo:Eta named welders,Acme Bau',
  'AC2, AC6: Gamma''s job order, Beta, Eta''s reduced job order and Acme, newest activity first; Acme has no activity and is last');
select is(
  (select jsonb_build_object('slug', e -> 'slug', 'count', e -> 'job_order_count', 'orders', e -> 'job_orders', 'vacancies', e -> 'open_vacancy_count',
     'industry', e -> 'industry_code', 'country', e -> 'based_in_country') from pg_temp.company('Acme Bau') e),
  jsonb_build_object('slug', (select slug from public.organizations where id = current_setting('t.a')::uuid), 'count', 0,
    'orders', '[]'::jsonb, 'vacancies', 0, 'industry', 'F', 'country', 'DE'),
  'AC2: Acme is returned as a company with its page, no job order and its number of public vacancies');
select is(
  (select jsonb_build_object('slug', e -> 'slug', 'website', e -> 'website', 'count', e -> 'job_order_count',
     'title', e -> 'job_orders' -> 0 ->> 'title', 'id', e -> 'job_orders' -> 0 ->> 'id') from pg_temp.company('Beta Works') e),
  jsonb_build_object('slug', null, 'website', null, 'count', 1, 'title', 'Beta named welders', 'id', :'rbeta'),
  'AC2: Beta is returned with its name and its job order, without a link to a company page');
select is(
  (select jsonb_build_object('employer', e -> 'employer_id', 'name', e -> 'display_name', 'slug', e -> 'slug', 'website', e -> 'website',
     'title', e -> 'job_orders' -> 0 ->> 'title', 'eligible', e -> 'job_orders' -> 0 -> 'eligible', 'industry', e -> 'job_orders' -> 0 ->> 'industry_code')
   from pg_temp.job_order_row(:'rgamma') e),
  jsonb_build_object('employer', null, 'name', null, 'slug', null, 'website', null,
    'title', 'Germany, 100 Welders and flame cutters', 'eligible', true, 'industry', 'C'),
  'AC2, NFR-S11: Gamma''s job order is its own row, with the neutral title and no employer');
select ok(
  not pg_temp.listed(:'rdelta') and not pg_temp.listed(:'rzeta') and not pg_temp.listed(:'reps')
  and pg_temp.company('Delta Private') is null and pg_temp.company('Zeta Paused') is null and pg_temp.company('Epsilon Suspended') is null,
  'AC2: Delta (private), Zeta (paused) and Epsilon (suspended, page on) are not returned');
select is(
  (select jsonb_build_object('kind', e ->> 'kind', 'name', e -> 'display_name', 'eligible', j -> 'eligible', 'reasons', j -> 'reasons',
     'title', j ->> 'title', 'country', j ->> 'country_code', 'workers', j -> 'workers_needed', 'industry', j -> 'industry_code',
     'published', j -> 'published_on')
   from pg_temp.job_order_row(:'reta') e, jsonb_extract_path(e, 'job_orders', '0') j),
  jsonb_build_object('kind', 'job_order', 'name', null, 'eligible', false, 'reasons', '["served_country_missing"]'::jsonb,
    'title', 'France, 20 Welders and flame cutters', 'country', 'FR', 'workers', 20, 'industry', null, 'published', null),
  'AC2: a job order in a country the partner does not serve shows its title, destination and size only, and no employer');
select is(pg_temp.se(:'ub', :'pb', ', p_destination => ''de'''), 'ok', 'a destination is read in any case');
select is(pg_temp.labels(), 'jo:Gamma secret welders,Beta Works,Acme Bau',
  'the destination keeps the job orders going there and the public page of a company based there');
select is(pg_temp.se(:'ub', :'pb', ', p_destination => ''FR'''), 'ok', 'a search for France');
select is(pg_temp.labels(), 'jo:Eta named welders', 'the reduced job order is matched on the destination it shows');
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.se(:'ub', :'pb'), 'ok', 'a search while release 2a is off');
select is(pg_temp.labels(), 'jo:Gamma secret welders,Beta Works,jo:Eta named welders',
  'company pages are not public while release 2a is off, so Acme''s page-only row is left out');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC3: anonymous job orders never reveal the employer -------------------------------------------------------------------------------

select pg_temp.req(current_setting('t.a')::uuid, 'Acme named fitters', '{"7212": 15}', p_show => true, p_days => 6, p_industry => 'F') as racme \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Acme secret pipefitters', '{"7214": 25}', p_days => 5, p_industry => 'C') as ranon \gset
select is(pg_temp.se(:'up', :'pp'), 'ok', 'AC3: the Professional partner searches');
select is(
  (select jsonb_build_object('count', e -> 'job_order_count', 'ids', (select jsonb_agg(j ->> 'id') from jsonb_array_elements(e -> 'job_orders') j))
   from pg_temp.company('Acme Bau') e),
  jsonb_build_object('count', 1, 'ids', jsonb_build_array(:'racme')),
  'AC3: Acme''s row lists exactly one job order and counts 1');
select is(
  (select jsonb_build_object('employer', e -> 'employer_id', 'name', e -> 'display_name', 'slug', e -> 'slug', 'website', e -> 'website',
     'title', e -> 'job_orders' -> 0 ->> 'title') from pg_temp.job_order_row(:'ranon') e),
  jsonb_build_object('employer', null, 'name', null, 'slug', null, 'website', null, 'title', 'Germany, 25 Structural-metal preparers and erectors'),
  'AC3: the anonymous job order is its own row with employer id, name, slug and website null');
select ok(
  (select bool_and(e::text !~* 'acme' and e::text !~ current_setting('t.a') and e::text !~* 'www\.')
   from jsonb_array_elements(pg_temp.result()) e where e ->> 'kind' = 'job_order'),
  'AC3, NFR-S11: no column of a job order row holds Acme''s name, id or website');
select is(pg_temp.se(:'up', :'pp', ', p_industry => ''F'''), 'ok', 'AC3: a search by Acme''s industry');
select is(pg_temp.labels(), 'Acme Bau', 'AC3: only Acme with its named job order; the anonymous job order of industry C is not grouped with it');
select is(pg_temp.se(:'up', :'pp', ', p_occupation => ''7214'''), 'ok', 'AC3: a search by the anonymous job order''s occupation');
select is(pg_temp.labels(), 'jo:Acme secret pipefitters', 'AC3: only the anonymous job order, with no company row beside it');
select is(
  (select e -> 'job_orders' -> 0 ->> 'industry_code' from pg_temp.job_order_row(:'ranon') e), 'C',
  'AC7 data: the anonymous job order carries its industry and destination for "Company not named"');
select is(private.record_requirement_reveal(:'ranon', :'pp', 'invitation'), true, 'decision 3.2: Acme invites the Professional partner');
select is(pg_temp.se(:'up', :'pp'), 'ok', 'the invited partner searches');
select is(
  (select jsonb_build_object('count', e -> 'job_order_count', 'titles', (select jsonb_agg(j ->> 'title') from jsonb_array_elements(e -> 'job_orders') j))
   from pg_temp.company('Acme Bau') e),
  jsonb_build_object('count', 2, 'titles', jsonb_build_array('Acme secret pipefitters', 'Acme named fitters')),
  'AC3, decision 3.2: after the invitation the job order is named, under Acme, to that partner');
select ok(pg_temp.job_order_row(:'ranon') is null, 'it is no longer an anonymous row for the invited partner');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.employer_revealed' and entity_id = :'ranon'),
  1, 'the first sight of the name writes one requirement.employer_revealed audit row');
select is(pg_temp.se(:'up', :'pp'), 'ok', 'the invited partner searches again');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.employer_revealed' and entity_id = :'ranon'),
  1, 'a second sight writes none');
select is(pg_temp.se(:'us', :'ps'), 'ok', 'a partner that was not invited searches');
select ok(
  pg_temp.job_order_row(:'ranon') is not null
  and (select bool_and(j ->> 'id' <> :'ranon') from jsonb_array_elements(pg_temp.company('Acme Bau') -> 'job_orders') j),
  'decision 3.2: the job order stays anonymous to every other partner');

-- AC4: depth follows employer_discovery ---------------------------------------------------------------------------------------------

select is(pg_temp.se(:'ub', :'pb', ', p_destination => ''DE'''), 'ok', 'AC4: Basic searches by destination');
select is(pg_temp.se(:'ub', :'pb', ', p_destination => ''DE'', p_industry => ''C'''), 'ok', 'AC4: Basic searches by destination and industry');
select is(pg_temp.se(:'ub', :'pb', ', p_occupation => ''7212'''), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_employer_discovery',
  'AC4: Basic cannot search by occupation');
select is(pg_temp.se(:'ub', :'pb', ', p_min_workers => 50'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_employer_discovery',
  'AC4: Basic cannot search by size');
select is(pg_temp.se(:'up', :'pp', ', p_occupation => ''7212'''), 'ok', 'AC4: Professional searches by occupation');
select is(pg_temp.se(:'up', :'pp', ', p_min_workers => 50'), 'ok', 'AC4: Professional searches by size');

-- AC5: size and occupation -----------------------------------------------------------------------------------------------------------

select pg_temp.req(:'omega', 'size 30', '{"7212": 30}', p_days => 20) as r30 \gset
select pg_temp.req(:'omega', 'size 50', '{"7212": 50}', p_days => 21) as r50 \gset
select pg_temp.req(:'omega', 'size 120', '{"7212": 100, "7214": 20}', p_days => 22) as r120 \gset
select is(pg_temp.se(:'up', :'pp', ', p_min_workers => 50'), 'ok', 'AC5: minimum size 50');
select is((select string_agg(x, ',') from regexp_split_to_table(pg_temp.labels(), ',') x where x like 'jo:size%'), 'jo:size 50,jo:size 120',
  'AC5: size 50 returns the 50 and 120 job orders');
select is(pg_temp.se(:'up', :'pp', ', p_occupation => ''7214'''), 'ok', 'AC5: occupation 7214');
select is((select string_agg(x, ',') from regexp_split_to_table(pg_temp.labels(), ',') x where x like 'jo:size%'), 'jo:size 120',
  'AC5: occupation 7214 returns the 120 job order');
select is(pg_temp.se(:'up', :'pp', ', p_min_workers => 0'), 'P0001|CHARA_INVALID_INPUT|p_min_workers', 'AC5: size 0 is refused');
select is(pg_temp.se(:'up', :'pp', ', p_min_workers => 100001'), 'P0001|CHARA_INVALID_INPUT|p_min_workers', 'AC5: size 100,001 is refused');
select is(pg_temp.se(:'up', :'pp', ', p_destination => ''DEU'''), 'P0001|CHARA_INVALID_INPUT|p_destination', 'a destination of another shape is refused');
select is(pg_temp.se(:'up', :'pp', ', p_industry => ''CC'''), 'P0001|CHARA_INVALID_INPUT|p_industry', 'an industry of another shape is refused');
select is(pg_temp.se(:'up', :'pp', ', p_occupation => ''72'''), 'P0001|CHARA_INVALID_INPUT|p_occupation', 'an occupation of another shape is refused');

-- AC6: order and paging ---------------------------------------------------------------------------------------------------------------

insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (current_setting('t.b')::uuid, 'employer_starter', 'active', 'null'), (:'gamma', 'employer_enterprise', 'active', 'null');
select is(pg_temp.se(:'up', :'pp'), 'ok', 'AC6: a search with Beta on Starter and Gamma on Enterprise');
select set_config('t.order', pg_temp.labels(), true) as first_order \gset
update billing.subscriptions set plan_code = case plan_code when 'employer_starter' then 'employer_enterprise' else 'employer_starter' end
where organization_id in (current_setting('t.b')::uuid, :'gamma');
select is(pg_temp.se(:'up', :'pp'), 'ok', 'AC6: the same search after the plans are swapped');
select is(pg_temp.labels(), current_setting('t.order'), 'AC6, NFR-C8: the order is the same whatever plan the employers are on');
select is(pg_temp.se(:'up', :'pp', ', p_limit => 2'), 'ok', 'a first page of two');
select ok(
  jsonb_array_length(pg_temp.result()) = 2 and pg_temp.result() -> 0 -> 'next_cursor' = 'null'::jsonb
  and pg_temp.result() -> 1 ->> 'next_cursor' is not null,
  'the last row of a page with a next one carries the cursor');
select set_config('t.cursor', pg_temp.result() -> 1 ->> 'next_cursor', true) as cursor \gset
select set_config('t.page1', pg_temp.labels(), true) as page1 \gset
select is(pg_temp.se(:'up', :'pp', format(', p_cursor => %L, p_limit => 50', current_setting('t.cursor'))), 'ok', 'the next page');
select is(current_setting('t.page1') || ',' || pg_temp.labels(), current_setting('t.order'), 'the pages continue the order without a gap or repeat');
select is(pg_temp.se(:'up', :'pp', format(', p_cursor => %L', gen_random_uuid())), 'P0001|CHARA_INVALID_INPUT|p_cursor',
  'a cursor that is not a result is refused');

-- AC10: rate limit; the search log ---------------------------------------------------------------------------------------------------

select is(
  (select count(*)::integer from stats.partner_searches where kind = 'employers' and filter_names = '{occupation}'
     and destination_country is null),
  3, 'each first page is logged with the names of its filters and nothing personal (AC3, AC4, AC5 occupation searches)');
select is(
  (select count(*)::integer from stats.partner_searches where kind = 'employers' and destination_country = 'DE' and filter_names = '{destination,industry}'),
  1, 'a destination that is a country is logged');
select is(
  (select count(*)::integer from stats.partner_searches where kind = 'employers' and result_count > 50), 0, 'the result count is that of a page');
delete from private.rate_limit_hits;
select is(
  (select count(*)::integer from generate_series(1, 60) i
   where pg_temp.se(case when i % 2 = 0 then :'up' else :'upm' end::uuid, :'pp', '', true) = 'ok'),
  60, 'AC10: 60 searches of one company in 60 seconds, by two of its members, are answered');
select is(pg_temp.se(:'up', :'pp', '', true), 'P0001|CHARA_RATE_LIMITED|', 'AC10: the 61st search of the company is refused');
select is(pg_temp.se(:'ub', :'pb', '', true), 'ok', 'AC10: another company keeps its own allowance');
select ok(
  pg_temp.result()::text !~* '(gmbh|ltd|sarl|@|\+[0-9])',
  'AC10: no result holds a legal name, an email address or a phone number');

-- AC9 data: saved searches ------------------------------------------------------------------------------------------------------------

select set_config('t.pp_id', :'pp', false) as pp_id \gset
select is(
  pg_temp.call_as(:'up', 'authenticated',
    $$select set_config('t.saved', public.save_employer_search(current_setting('t.pp_id')::uuid, 'de', null, '7212')::text, true)$$, 'aal1'),
  'ok', 'AC9: the Professional partner saves destination DE and occupation 7212');
select is(
  (select jsonb_build_object('dest', destination_country, 'occ', occupation_id, 'by', created_by) from public.saved_searches
   where id = current_setting('t.saved')::uuid),
  jsonb_build_object('dest', 'DE', 'occ', '7212', 'by', :'up'), 'AC9: the saved search holds its filters and who saved it');
select is(
  pg_temp.val_as(:'upm', 'aal1', $$select public.save_employer_search(current_setting('t.pp_id')::uuid, 'DE', null, '7212')::text$$),
  current_setting('t.saved'), 'saving the same filters again answers the saved search');
select is(
  (select count(*)::integer from audit.log where action = 'saved_search.added' and entity_id = :'pp'), 1,
  'one audit row saved_search.added for the one search saved');
select is(
  pg_temp.call_as(:'ub', 'authenticated', format($$select public.save_employer_search(%L, 'DE')$$, :'pb'), 'aal1'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_employer_discovery', 'AC9: the Basic partner cannot save a search');
select is(
  pg_temp.call_as(:'up', 'authenticated', format($$select public.save_employer_search(%L)$$, :'pp'), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|filters', 'a search without a filter is not saved');
select is(
  pg_temp.call_as(:'up', 'authenticated', format($$select public.save_employer_search(%L, 'XX')$$, :'pp'), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|p_destination', 'NFR-M3: a country that is not in the code list is refused');
select is(
  pg_temp.call_as(:'up', 'authenticated', format($$select public.save_employer_search(%L, null, 'C', '9999')$$, :'pp'), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|p_occupation', 'NFR-M3: an occupation that is not in the code list is refused');
select is(
  pg_temp.call_as(:'wkr', 'authenticated', format($$select public.save_employer_search(%L, 'DE')$$, :'pp'), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'a candidate cannot save for a partner');

-- NFR-S8: who reads saved searches
select is(pg_temp.val_as(:'upm', 'aal1', 'select count(*)::text from public.saved_searches'), '1', 'NFR-S8: a member of the partner reads its saved search');
select is(pg_temp.val_as(:'ub', 'aal1', 'select count(*)::text from public.saved_searches'), '0', 'NFR-S8: the second partner reads none');
select is(pg_temp.val_as(:'adm', 'aal1', 'select count(*)::text from public.saved_searches'), '0', 'NFR-S8: the first employer reads none');
select is(pg_temp.val_as(:'adm2', 'aal1', 'select count(*)::text from public.saved_searches'), '0', 'NFR-S8: the second employer reads none');
select is(pg_temp.val_as(:'wkr', 'aal1', 'select count(*)::text from public.saved_searches'), '0', 'NFR-S8: a candidate reads none');
select is(pg_temp.val_as(:'w2', 'aal1', 'select count(*)::text from public.saved_searches'), '0', 'NFR-S8: the second candidate reads none');
select matches(pg_temp.call_as(null, 'anon', 'select count(*) from public.saved_searches'), '^42501\|permission denied',
  'NFR-S8: an anonymous caller has no grant');
select matches(
  pg_temp.call_as(:'up', 'authenticated', format($$insert into public.saved_searches (organization_id, destination_country) values (%L, 'FR')$$, :'pp'), 'aal1'),
  '^42501\|permission denied', 'NFR-S8: a member cannot write the table directly');
select is(
  pg_temp.call_as(:'ub', 'authenticated', format($$select public.delete_saved_search(%L, %L)$$, :'pb', current_setting('t.saved')), 'aal1'),
  'P0002|CHARA_NOT_FOUND|', 'another partner cannot delete it through its own organisation');
select is(
  pg_temp.call_as(:'ub', 'authenticated', format($$select public.delete_saved_search(%L, %L)$$, :'pp', current_setting('t.saved')), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'nor through the partner it does not belong to');
select is(
  pg_temp.call_as(:'upm', 'authenticated', format($$select public.delete_saved_search(%L, %L)$$, :'pp', current_setting('t.saved')), 'aal1'),
  'ok', 'a member deletes the saved search');
select ok(
  not exists (select 1 from public.saved_searches where organization_id = :'pp')
  and (select count(*)::integer from audit.log where action = 'saved_search.removed' and entity_id = :'pp') = 1,
  'it is gone, with one audit row saved_search.removed');

-- Release switch ---------------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.se(:'up', :'pp'), 'P0002|CHARA_NOT_FOUND|', 'release_job_orders off: the search is not found');
select is(
  pg_temp.call_as(:'up', 'authenticated', format($$select public.save_employer_search(%L, 'DE')$$, :'pp'), 'aal1'),
  'P0002|CHARA_NOT_FOUND|', 'release_job_orders off: saving is not found');

select * from finish();
rollback;
