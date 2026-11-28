begin;
select plan(70);

\ir jobs_fixture.inc

-- CHARA Match v1 (ARCHITECTURE.md section 9.3, ADR-0005; OPEN_QUESTIONS.md C2, R21): public.match_rules, match_runs,
-- match_results, chara_match, chara_match_results and the retention of the runs. Acme (t.a: owner own1, admin adm,
-- member mem) is on Starter; Beta (t.b: owner own2) has no subscription, so the free plan; wkr is a candidate. The
-- partners (owned by padm) and the listed workers are made below; the partners and workers of earlier test data are
-- hidden for this transaction. Every run asks for 20 workers of 7212 in DE, industry F, starting in 60 days, so a
-- partner's listings count for availability from 2 workers (10 %).

\set padm '00000000-0000-0000-0000-0000000f2321'

select pg_temp.new_user(:'padm');
update public.profiles set account_kind = intended_account_kind where id = :'padm';
select set_config('t.padm', :'padm', true);
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (current_setting('t.a')::uuid, 'employer_starter', 'active', 'null');

update public.organizations set moderation_state = 'hidden' where type <> 'employer';
update public.worker_profiles set searchable = false;

-- A listed partner of p_type with its recruitment type, the countries it serves and sources from, its occupations and
-- industries, and the staffing service of a recruitment company when p_staffing.
create function pg_temp.partner(
  p_slug text, p_type text, p_recruitment text, p_serves text[], p_occupations text[], p_sources text[],
  p_industries text[] default '{}', p_staffing boolean default false
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug, initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (v_id, current_setting('t.padm')::uuid, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  select v_id, 'serves_market'::public.geography_scope, c from unnest(p_serves) c
  union all select v_id, 'sources_from'::public.geography_scope, c from unnest(p_sources) c;
  insert into public.organization_occupations (organization_id, occupation_id) select v_id, o from unnest(p_occupations) o;
  insert into public.organization_industries (organization_id, industry_code) select v_id, i from unnest(p_industries) i;
  if p_staffing then
    insert into public.organization_service_types (organization_id, service) values (v_id, 'staffing');
  end if;
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days', recruitment_type = p_recruitment::public.recruitment_preference
  where id = v_id;
  return v_id;
end;
$$;

create function pg_temp.listing(p_org uuid, p_source text, p_available integer) returns void
language sql as $$
  insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
    available_from, confirmed_at)
  values (p_org, '7212', p_source, p_available, 10, current_date, now())
$$;

create temp table tags (user_id uuid primary key, tag text unique not null);

-- A worker named p_tag, written as the database owner as set_worker_visibility (V68) leaves a listed one.
create function pg_temp.worker(
  p_tag text, p_country text, p_occupation text, p_prefs text[], p_auth text[] default '{}', p_availability text default 'now',
  p_searchable boolean default true
) returns void
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(v_id, 'worker');
  update public.profiles set account_kind = 'worker' where id = v_id;
  insert into public.worker_profiles (user_id, first_name, last_name, current_country, occupation_id, headline,
    years_experience, availability, available_from, searchable)
  values (v_id, 'Zebulon', 'Quixote', p_country, p_occupation, 'Card ' || p_tag, 3, p_availability::public.worker_availability,
    case when p_availability = 'from_date' then current_date + 30 end, p_searchable);
  insert into public.worker_preferred_countries (worker_user_id, country_code) select v_id, c from unnest(p_prefs) c;
  insert into public.worker_work_authorizations (worker_user_id, country_code) select v_id, c from unnest(p_auth) c;
  insert into tags values (v_id, p_tag);
end;
$$;

create function pg_temp.card(p_tag text) returns uuid
language sql as $$ select w.card_id from public.worker_profiles w join tags t on t.user_id = w.user_id where t.tag = p_tag $$;

-- chara_match as p_user (anonymous when null) for p_org: 'ok' with the run as JSON in t.run, or 'sqlstate|message|detail'.
-- Each call starts a fresh rate-limit window.
create function pg_temp.run(
  p_user uuid, p_org uuid, p_recruitment text default 'international', p_destination text default 'DE',
  p_industry text default 'F', p_occupation text default '7212', p_workers integer default 20,
  p_start date default current_date + 60
) returns text
language sql as $$
  delete from private.rate_limit_hits;
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.run', (select to_jsonb(m) from public.chara_match(%L, %L, %L, %L, %L, %L, %L) m)::text, true)$f$,
    p_org, p_destination, p_industry, p_occupation, p_workers, p_start, p_recruitment), 'aal1')
$$;

create function pg_temp.summary() returns jsonb
language sql as $$ select current_setting('t.run')::jsonb -> 'summary' $$;
create function pg_temp.run_id() returns uuid
language sql as $$ select (current_setting('t.run')::jsonb ->> 'run_id')::uuid $$;

-- chara_match_results as p_user: 'ok' with the rows in order as JSON in t.rows, or 'sqlstate|message|detail'.
create function pg_temp.results(p_user uuid, p_run uuid, p_type text, p_cursor text default null, p_limit integer default null)
returns text
language sql as $$
  delete from private.rate_limit_hits;
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.n)
       from (select x.*, row_number() over () as n from public.chara_match_results(%L, %L, %L, %s) x) r)::text, '[]'), true)$f$,
    p_run, p_type, p_cursor, coalesce(p_limit::text, 'null')), 'aal1')
$$;

create function pg_temp.rows() returns jsonb language sql as $$ select current_setting('t.rows')::jsonb $$;
create function pg_temp.slugs() returns text
language sql as $$
  select coalesce(string_agg(e ->> 'slug', ',' order by n), '') from jsonb_array_elements(pg_temp.rows()) with ordinality r (e, n)
$$;
create function pg_temp.worker_tags() returns text
language sql as $$
  select coalesce(string_agg(t.tag, ',' order by r.n), '')
  from jsonb_array_elements(pg_temp.rows()) with ordinality r (e, n)
  join public.worker_profiles w on w.card_id = (r.e ->> 'entity_id')::uuid
  join tags t on t.user_id = w.user_id
$$;

-- The fixtures -------------------------------------------------------------------------------------------------------------

select set_config('t.p1', pg_temp.partner('m-rec-intl', 'recruitment_company', 'international', '{DE}', '{7212}', '{PH}', '{F}')::text, true);
select set_config('t.p2', pg_temp.partner('m-rec-staff', 'recruitment_company', 'both', '{DE}', '{7212}', '{DE,PH}', '{}', true)::text, true);
select set_config('t.p3', pg_temp.partner('m-staff-local', 'staffing_company', 'local', '{DE}', '{7212}', '{DE}')::text, true);
select pg_temp.partner('m-rec-other-occupation', 'recruitment_company', 'both', '{DE}', '{7211}', '{PH}', '{F}');
select pg_temp.partner('m-rec-austria', 'recruitment_company', 'both', '{AT}', '{7212}', '{PH}', '{F}');
select set_config('t.p6', pg_temp.partner('m-rec-hidden', 'recruitment_company', 'both', '{DE}', '{7212}', '{PH}', '{F}')::text, true);
update public.organizations set moderation_state = 'hidden' where id = current_setting('t.p6')::uuid;
select set_config('t.p7', pg_temp.partner('m-rec-pending', 'recruitment_company', 'both', '{DE}', '{7212}', '{PH}', '{F}')::text, true);
update public.organizations set listed_at = null, review_status = 'pending_review' where id = current_setting('t.p7')::uuid;
select pg_temp.listing(current_setting('t.p1')::uuid, 'PH', 30);
select pg_temp.listing(current_setting('t.p3')::uuid, 'DE', 5);
select pg_temp.listing(current_setting('t.p6')::uuid, 'PH', 100);

select pg_temp.worker('w1', 'PL', '7212', '{}', '{DE}');
select pg_temp.worker('w2', 'PL', '7212', '{DE}', '{}', 'from_date');
select pg_temp.worker('w3', 'RO', '7212', '{DE}', '{}', 'unavailable');
select pg_temp.worker('w4', 'PH', '7212', '{DE}');
select pg_temp.worker('w5', 'PH', '7212', '{AT}');
select pg_temp.worker('w6', 'PL', '7211', '{DE}');
select pg_temp.worker('w7', 'PL', '7212', '{DE}', '{}', 'now', false);
select pg_temp.worker('w8', 'DE', '7212', '{DE}');
-- w4's authorisation for DE expired yesterday, which the passport no longer accepts as new.
alter table public.worker_work_authorizations disable trigger worker_authorizations_check_expiry;
insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on)
select t.user_id, 'DE', current_date - 1 from tags t where t.tag = 'w4';
alter table public.worker_work_authorizations enable always trigger worker_authorizations_check_expiry;

-- Shape --------------------------------------------------------------------------------------------------------------------

select results_eq(
  $$select entity_type, rule_key, weight, enabled from public.match_rules order by entity_type, rule_key$$,
  $$values
    ('recruitment_partner', 'availability', 10, true), ('recruitment_partner', 'industry', 10, true),
    ('recruitment_partner', 'occupation', 20, true), ('recruitment_partner', 'serves_destination', 35, true),
    ('recruitment_partner', 'sources_from', 15, true),
    ('staffing_partner', 'availability', 10, true), ('staffing_partner', 'industry', 10, true),
    ('staffing_partner', 'occupation', 20, true), ('staffing_partner', 'serves_destination', 35, true),
    ('staffing_partner', 'sources_from', 15, true),
    ('worker', 'availability', 15, true), ('worker', 'occupation', 40, true), ('worker', 'preferred_country', 10, true),
    ('worker', 'work_authorization', 25, true)$$,
  'the v1 rules of section 9.3 are seeded with their weights'
);
select is(
  (select count(*)::integer from pg_class c
   where c.oid in ('public.match_rules'::regclass, 'public.match_runs'::regclass, 'public.match_results'::regclass)
     and c.relrowsecurity and c.relforcerowsecurity),
  3, 'the three tables have row security, forced'
);
select ok(
  has_table_privilege('authenticated', 'public.match_runs', 'select')
  and not has_table_privilege('authenticated', 'public.match_runs', 'insert, update, delete')
  and not has_table_privilege('authenticated', 'public.match_results', 'insert, update, delete')
  and not has_table_privilege('authenticated', 'public.match_rules', 'insert, update, delete')
  and not has_table_privilege('anon', 'public.match_runs', 'select')
  and not has_table_privilege('anon', 'public.match_results', 'select'),
  'members read the runs and matches; nothing writes them through the API roles and visitors read nothing'
);
select ok(
  has_function_privilege('authenticated', 'public.chara_match(uuid, text, text, text, integer, date, public.recruitment_preference)', 'execute')
  and not has_function_privilege('anon', 'public.chara_match(uuid, text, text, text, integer, date, public.recruitment_preference)', 'execute')
  and has_function_privilege('authenticated', 'public.chara_match_results(uuid, text, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.chara_match_results(uuid, text, text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.assert_match_runner(uuid)', 'execute'),
  'signed-in users run the two functions, visitors neither'
);
select is_empty(
  $$select p.proname from pg_proc p
    where p.proname in ('chara_match', 'chara_match_results', 'assert_match_runner', 'match_weight') and p.prosrc ~* 'billing\.'$$,
  'no billing table is read: the plan is asked through private.has_feature and private.org_plan_code'
);
select is(
  (select string_agg(plan_code, ',' order by plan_code) from billing.plan_features where feature_key = 'chara_match'),
  'employer_enterprise,employer_professional,employer_starter', 'chara_match is on every paid employer plan (C2)'
);
select is(
  (select days from private.retention_policies where entity = 'match_runs'), 90, 'runs are kept 90 days'
);

-- Refusals -----------------------------------------------------------------------------------------------------------------

select is(pg_temp.run(:'own1', current_setting('t.a')::uuid), 'P0002|CHARA_NOT_FOUND|', 'release_chara_match off: not found');
update private.settings set value = 'true' where key = 'release_chara_match';
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.run(:'own1', current_setting('t.a')::uuid), 'P0002|CHARA_NOT_FOUND|', 'release 2a off: not found');
update private.settings set value = 'true' where key = 'release_partner_directories';

select is(split_part(pg_temp.run(null, current_setting('t.a')::uuid), '|', 1), '42501', 'a visitor cannot run it');
select is(pg_temp.run(:'wkr', current_setting('t.a')::uuid), '42501|CHARA_FORBIDDEN|', 'a candidate is refused');
select is(pg_temp.run(:'own2', current_setting('t.a')::uuid), '42501|CHARA_FORBIDDEN|', 'a member of another organisation is refused');
select is(
  pg_temp.run(:'own2', current_setting('t.b')::uuid), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|chara_match',
  'an employer on the free plan is refused for the plan'
);
select is(
  pg_temp.run(:'padm', current_setting('t.p1')::uuid), '42501|CHARA_FORBIDDEN|employer_only', 'a partner company is refused'
);
select is(pg_temp.run(:'mem', current_setting('t.a')::uuid, p_destination => 'XX'), 'P0001|CHARA_INVALID_INPUT|p_destination',
  'an unknown destination is refused');
select is(pg_temp.run(:'mem', current_setting('t.a')::uuid, p_industry => '1'), 'P0001|CHARA_INVALID_INPUT|p_industry',
  'an unknown industry is refused');
select is(pg_temp.run(:'mem', current_setting('t.a')::uuid, p_occupation => 'abcd'), 'P0001|CHARA_INVALID_INPUT|p_occupation',
  'an unknown occupation is refused');
select is(pg_temp.run(:'mem', current_setting('t.a')::uuid, p_workers => 0), 'P0001|CHARA_INVALID_INPUT|p_workers',
  'no workers is refused');
select is(pg_temp.run(:'mem', current_setting('t.a')::uuid, p_start => current_date - 1), 'P0001|CHARA_INVALID_INPUT|p_start',
  'a start in the past is refused');
select is(pg_temp.run(:'mem', current_setting('t.a')::uuid, p_start => current_date + 1200), 'P0001|CHARA_INVALID_INPUT|p_start',
  'a start more than three years ahead is refused');
select is(
  (select count(*)::integer from public.match_runs where organization_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid)),
  0, 'a refused run leaves no row'
);

-- International ------------------------------------------------------------------------------------------------------------

select is(
  (select count(*)::integer from stats.partner_searches where kind = 'chara_match'), 0, 'no run is logged yet'
);
select is(pg_temp.run(:'mem', current_setting('t.a')::uuid), 'ok', 'a plain member of a paid employer runs it at aal1');
select set_config('t.intl', pg_temp.run_id()::text, true);
select is(
  current_setting('t.run')::jsonb -> 'inputs',
  jsonb_build_object('destination', 'DE', 'industry', 'F', 'occupation', '7212', 'workers', 20, 'start', current_date + 60,
    'recruitment', 'international'),
  'the run keeps what was asked'
);
select is(
  pg_temp.summary(),
  '{"matching_workers": null, "workers_fewer_than": 5, "recruitment_partners": 2, "staffing_partners": 1,
    "available_workforce": "25–49", "source_countries": [{"code": "PH", "name": "Philippines"}]}'::jsonb,
  'international: four workers are fewer than k, two public recruitment partners (one also staffing), 30 workers from PH as a range'
);
select is(
  (select summary from public.match_runs where id = pg_temp.run_id()), pg_temp.summary(), 'the summary is stored with the run'
);
select is(
  (select count(*)::integer from stats.partner_searches where kind = 'chara_match' and destination_country = 'DE'
     and result_count = 2 and filter_names @> array['occupation', 'recruitment_type']),
  1, 'the run is logged once, with the destination and the partners matched only'
);
select is(
  (select string_agg(entity_type || ':' || count, ',' order by entity_type)
   from (select entity_type, count(*) from public.match_results where run_id = pg_temp.run_id() group by entity_type) x),
  'recruitment_partner:2,staffing_partner:1,worker:4', 'the matches are stored per kind'
);
select is(
  (select string_agg(t.tag, ',' order by t.tag) from public.match_results m
   join public.worker_profiles w on w.card_id = m.entity_id join tags t on t.user_id = w.user_id
   where m.run_id = pg_temp.run_id() and m.entity_type = 'worker'),
  'w1,w2,w3,w4',
  'workers: listed, of the occupation, living outside DE and authorised for or preferring DE (an expired authorisation does not count)'
);
select is(
  (select reasons from public.match_results
   where run_id = pg_temp.run_id() and entity_type = 'recruitment_partner' and entity_id = current_setting('t.p1')::uuid),
  '[{"rule": "serves_destination", "points": 35, "detail": "DE"}, {"rule": "occupation", "points": 20, "detail": "7212"},
    {"rule": "sources_from", "points": 15, "detail": "PH"}, {"rule": "industry", "points": 10, "detail": "F"},
    {"rule": "availability", "points": 10, "detail": "25–49"}]'::jsonb,
  'every rule that contributed is stored with its points and detail'
);
select is(
  (select score from public.match_results
   where run_id = pg_temp.run_id() and entity_type = 'recruitment_partner' and entity_id = current_setting('t.p1')::uuid),
  90, 'the score is the sum of the reasons'
);
select is(
  (select reasons from public.match_results where run_id = pg_temp.run_id() and entity_type = 'worker' and entity_id = pg_temp.card('w1')),
  '[{"rule": "occupation", "points": 40, "detail": "7212"}, {"rule": "work_authorization", "points": 25, "detail": "DE"},
    {"rule": "availability", "points": 15, "detail": "now"}]'::jsonb,
  'a worker authorised for the destination and available now'
);
select is(
  (select reasons from public.match_results where run_id = pg_temp.run_id() and entity_type = 'worker' and entity_id = pg_temp.card('w2')),
  jsonb_build_array(
    jsonb_build_object('rule', 'occupation', 'points', 40, 'detail', '7212'),
    jsonb_build_object('rule', 'preferred_country', 'points', 10, 'detail', 'DE'),
    jsonb_build_object('rule', 'availability', 'points', 15, 'detail', (current_date + 30)::text)),
  'a worker who prefers the destination and is available before the start'
);
select is(
  (select score from public.match_results where run_id = pg_temp.run_id() and entity_type = 'worker' and entity_id = pg_temp.card('w3')),
  50, 'an unavailable worker scores for the occupation and the preference only'
);
select is(
  (select reasons from public.match_results
   where run_id = pg_temp.run_id() and entity_type = 'staffing_partner' and entity_id = current_setting('t.p2')::uuid),
  '[{"rule": "serves_destination", "points": 35, "detail": "DE"}, {"rule": "occupation", "points": 20, "detail": "7212"},
    {"rule": "sources_from", "points": 15, "detail": "PH"}]'::jsonb,
  'a recruitment company offering staffing is a staffing match too; only its sources outside DE count'
);

-- Local and both -------------------------------------------------------------------------------------------------------------

select is(pg_temp.run(:'mem', current_setting('t.a')::uuid, 'local'), 'ok', 'a local run');
select set_config('t.local', pg_temp.run_id()::text, true);
select is(
  pg_temp.summary(),
  '{"matching_workers": null, "workers_fewer_than": 5, "recruitment_partners": 1, "staffing_partners": 2,
    "available_workforce": "1–9", "source_countries": [{"code": "DE", "name": "Germany"}]}'::jsonb,
  'local: the worker living in DE, the partners recruiting locally or both, the listings sourced in DE'
);
select is(
  (select string_agg(t.tag, ',' order by t.tag) from public.match_results m
   join public.worker_profiles w on w.card_id = m.entity_id join tags t on t.user_id = w.user_id
   where m.run_id = pg_temp.run_id() and m.entity_type = 'worker'),
  'w8', 'local: only the worker living in the destination'
);
select is(pg_temp.run(:'mem', current_setting('t.a')::uuid, 'both'), 'ok', 'a run for both');
select set_config('t.both', pg_temp.run_id()::text, true);
select is(
  pg_temp.summary(),
  '{"matching_workers": 5, "workers_fewer_than": null, "recruitment_partners": 2, "staffing_partners": 2,
    "available_workforce": "25–49",
    "source_countries": [{"code": "DE", "name": "Germany"}, {"code": "PH", "name": "Philippines"}]}'::jsonb,
  'both: five workers reach k and are counted; every public partner of the occupation in DE; all their listings'
);

-- Row security -----------------------------------------------------------------------------------------------------------------

select is(
  pg_temp.affected_as(:'mem', 'authenticated', $$select 1 from public.match_runs where organization_id = current_setting('t.a')::uuid$$),
  3::bigint, 'a member reads the organisation''s runs'
);
select is(
  pg_temp.affected_as(:'own2', 'authenticated', $$select 1 from public.match_runs$$), 0::bigint, 'another organisation reads none'
);
select is(
  pg_temp.affected_as(:'mem', 'authenticated', $$select 1 from public.match_results where run_id = current_setting('t.intl')::uuid$$),
  3::bigint, 'a member reads the partner matches of a run'
);
select is(
  pg_temp.affected_as(:'mem', 'authenticated', $$select 1 from public.match_results where entity_type = 'worker'$$),
  0::bigint, 'and no worker match: those are read through chara_match_results only'
);
select is(
  pg_temp.affected_as(:'own2', 'authenticated', $$select 1 from public.match_results$$), 0::bigint,
  'another organisation reads no match'
);

-- View matches -------------------------------------------------------------------------------------------------------------

select is(pg_temp.results(:'mem', current_setting('t.both')::uuid, 'recruitment_partner'), 'ok', 'the recruitment matches');
select is(pg_temp.slugs(), 'm-rec-intl,m-rec-staff', 'best first, public partners only');
select is(
  (select jsonb_build_object('display_name', e ->> 'display_name', 'score', (e ->> 'score')::integer, 'card', e -> 'card')
   from jsonb_array_elements(pg_temp.rows()) e where e ->> 'slug' = 'm-rec-intl'),
  '{"display_name": "M Rec Intl", "score": 90, "card": null}'::jsonb, 'a partner comes with its name and score, without a card'
);
select is(pg_temp.results(:'mem', current_setting('t.both')::uuid, 'staffing_partner'), 'ok', 'the staffing matches');
select is(pg_temp.slugs(), 'm-staff-local,m-rec-staff', 'the staffing company with listings first');
select is(pg_temp.results(:'mem', current_setting('t.both')::uuid, 'recruitment_partner', null, 1), 'ok', 'a page of one');
select ok(
  pg_temp.slugs() = 'm-rec-intl' and pg_temp.rows() -> 0 ->> 'next_cursor' is not null, 'the page has a next one'
);
select is(
  pg_temp.results(:'mem', current_setting('t.both')::uuid, 'recruitment_partner', pg_temp.rows() -> 0 ->> 'next_cursor', 1), 'ok',
  'the next page'
);
select is(pg_temp.slugs(), 'm-rec-staff', 'the cursor gives the next match');
select is(
  pg_temp.results(:'mem', current_setting('t.both')::uuid, 'recruitment_partner', 'nope'), 'P0001|CHARA_INVALID_INPUT|p_cursor',
  'a broken cursor is refused'
);
select is(
  pg_temp.results(:'mem', current_setting('t.both')::uuid, 'employer'), 'P0001|CHARA_INVALID_INPUT|p_entity_type',
  'an unknown kind is refused'
);
select is(
  pg_temp.results(:'own2', current_setting('t.both')::uuid, 'recruitment_partner'), '42501|CHARA_FORBIDDEN|',
  'another organisation cannot read the run'
);
select is(
  pg_temp.results(:'mem', current_setting('t.both')::uuid, 'worker'), 'P0002|CHARA_NOT_FOUND|',
  'the worker matches need release_find_workers'
);
update private.settings set value = 'true' where key = 'release_find_workers';
select is(pg_temp.results(:'mem', current_setting('t.both')::uuid, 'worker'), 'ok', 'with it the worker matches are read');
select ok(
  split_part(pg_temp.worker_tags(), ',', 1) = 'w1' and split_part(pg_temp.worker_tags(), ',', 5) = 'w3'
    and (select array_agg(t order by t) from unnest(string_to_array(pg_temp.worker_tags(), ',')) t) = '{w1,w2,w3,w4,w8}',
  'the cards best first'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.rows() -> 0 -> 'card') k),
  array['availability', 'available_from', 'card_id', 'current_country', 'direct_contact', 'employment_history', 'headline',
    'languages', 'notice', 'occupation_id', 'preferred_countries', 'preferred_employment_types', 'preferred_industries',
    'skills', 'training', 'updated_at', 'work_authorization_countries', 'years_experience'],
  'a worker comes as the Find Workers card and nothing else: no name, contact detail or document'
);
update public.worker_profiles set searchable = false where user_id = (select user_id from tags where tag = 'w1');
update public.organizations set moderation_state = 'hidden' where id = current_setting('t.p1')::uuid;
select is(pg_temp.results(:'mem', current_setting('t.both')::uuid, 'worker'), 'ok', 'the worker matches again');
select is(pg_temp.worker_tags() ~ 'w1', false, 'a worker who withdrew is no longer shown');
select is(pg_temp.results(:'mem', current_setting('t.both')::uuid, 'recruitment_partner'), 'ok', 'the recruitment matches again');
select is(pg_temp.slugs(), 'm-rec-staff', 'a partner hidden since the run is no longer shown');
update private.settings set value = 'false' where key = 'release_chara_match';
select is(
  pg_temp.results(:'mem', current_setting('t.both')::uuid, 'recruitment_partner'), 'P0002|CHARA_NOT_FOUND|',
  'release off: the matches are not found'
);
update private.settings set value = 'true' where key = 'release_chara_match';

-- Rate limit -----------------------------------------------------------------------------------------------------------------

update private.settings set value = '1' where key = 'rate_limit_chara_match_max';
select is(pg_temp.run(:'adm', current_setting('t.a')::uuid), 'ok', 'the first run in the window');
select is(
  pg_temp.call_as(:'adm', 'authenticated',
    $$select public.chara_match(current_setting('t.a')::uuid, 'DE', 'F', '7212', 20, current_date + 60, 'international')$$, 'aal1'),
  'P0001|CHARA_RATE_LIMITED|', 'the next one in the same window is refused'
);

-- Retention ----------------------------------------------------------------------------------------------------------------

update public.match_runs set created_at = now() - interval '91 days' where id = current_setting('t.local')::uuid;
select private.apply_retention();
select ok(
  not exists (select 1 from public.match_runs where id = current_setting('t.local')::uuid)
  and not exists (select 1 from public.match_results where run_id = current_setting('t.local')::uuid),
  'a run older than 90 days goes with its matches'
);
select ok(
  exists (select 1 from public.match_runs where id = current_setting('t.both')::uuid), 'a newer run stays'
);

select * from finish();
rollback;
