begin;
select plan(105);

\ir organizations_fixture.inc

-- Find recruitment partners (V21, FR-L1 AC1 to AC6, AC11, AC12; SOP P2-10 steps Search, Show, Measure; controls
-- transparent ordering, rate limits, listing only after staff review; NFR-C8, NFR-S8; decision 1.1): search_partners, the
-- search log stats.partner_searches with its retention and admin_partner_search_stats, and the reserved directory slugs.

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_slug text, p_id uuid default gen_random_uuid())
returns uuid
language plpgsql as $$
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (p_id, p_type, p_slug, 'Legal ' || p_slug || ' Holdings Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_id, p_owner, 'owner', now());
  return p_id;
end;
$$;

-- A listed recruitment company serving p_serves with the occupations given, its profile changed at p_updated.
create function pg_temp.partner(p_owner uuid, p_slug text, p_serves text[], p_occupations text[],
  p_updated timestamptz default '2026-10-01 08:00+00', p_id uuid default gen_random_uuid()) returns uuid
language plpgsql as $$
declare
  v_id uuid := pg_temp.new_org(p_owner, 'recruitment_company', p_slug, p_id);
begin
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days', workforce_profile_updated_at = p_updated
  where id = v_id;
  insert into public.organization_geographies (organization_id, scope, country_code)
  select v_id, 'serves_market', c from unnest(p_serves) c;
  insert into public.organization_occupations (organization_id, occupation_id) select v_id, o from unnest(p_occupations) o;
  return v_id;
end;
$$;

create function pg_temp.run(p_user uuid, p_sql text) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    'aal1')
$$;

-- One search as the user (anonymous when null, with a visitor key), with a fresh rate-limit window.
create function pg_temp.search(p_user uuid, p_args text) returns text
language plpgsql as $$
begin
  delete from private.rate_limit_hits;
  return pg_temp.run(p_user, format('select * from public.search_partners(%s%s)', p_args,
    case when p_user is null then format(', p_key => %L', repeat('a', 64)) else '' end));
end;
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

create function pg_temp.slugs() returns text
language sql as $$
  select coalesce(string_agg(e ->> 'slug', ',' order by n), '') from jsonb_array_elements(pg_temp.result()) with ordinality r (e, n)
$$;

create function pg_temp.matched(p_slug text) returns text
language sql as $$
  select string_agg(m, ',' order by k)
  from jsonb_array_elements(pg_temp.result()) e, jsonb_array_elements_text(e -> 'matched_filters') with ordinality f (m, k)
  where e ->> 'slug' = p_slug
$$;

\set own '00000000-0000-0000-0000-0000001f0001'
\set wrk '00000000-0000-0000-0000-0000001f0002'
\set acm '00000000-0000-0000-0000-0000001f0003'
\set bet '00000000-0000-0000-0000-0000001f0004'
\set stf '00000000-0000-0000-0000-0000001f0005'
\set rcu '00000000-0000-0000-0000-0000001f0006'
\set stu '00000000-0000-0000-0000-0000001f0007'

select pg_temp.new_user(:'own', 'company', 'maria.santos@manila-skills.example');
select pg_temp.new_user(:'wrk', 'worker');
select pg_temp.new_user(:'acm');
select pg_temp.new_user(:'bet');
select pg_temp.new_user(:'stf');
select pg_temp.new_user(:'rcu');
select pg_temp.new_user(:'stu');
update public.profiles set account_kind = intended_account_kind where id in (:'own', :'wrk', :'acm', :'bet', :'stf', :'rcu', :'stu');
insert into public.platform_staff (user_id, role) values (:'stf', 'admin');

-- Partners of earlier test data must not change the results below: they are hidden for this transaction.
update public.organizations set moderation_state = 'hidden' where type <> 'employer';

select pg_temp.new_org(:'acm', 'employer', 'acme-gmbh') as acme \gset
select pg_temp.new_org(:'bet', 'employer', 'beta-bau') as beta \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (:'acme', 'employer_starter', 'active', 'null'), (:'beta', 'employer_professional', 'active', 'null');
-- AC1: the employer serves DE with occupation 7212 too, so only the type keeps it out. It cannot be listed: listed_at is a
-- partner column (check organizations_partner_columns_partner_only), asserted below.
insert into public.organization_geographies (organization_id, scope, country_code) values (:'acme', 'serves_market', 'DE');
insert into public.organization_occupations (organization_id, occupation_id) values (:'acme', '7212');

-- AC1: every listing state, serving DE with occupation 7212 ---------------------------------------------------------------
select pg_temp.partner(:'own', 'listed-co', '{DE}', '{7212}') as listed \gset
select pg_temp.partner(:'own', 'pending-co', '{DE}', '{7212}') as pending \gset
update public.organizations set review_status = 'pending_review', listed_at = null where id = :'pending';
select pg_temp.partner(:'own', 'info-co', '{DE}', '{7212}') as info \gset
update public.organizations set review_status = 'info_requested', listed_at = null, info_step = 'company' where id = :'info';
select pg_temp.partner(:'own', 'declined-co', '{DE}', '{7212}') as declined \gset
update public.organizations set review_status = 'declined' where id = :'declined';
select pg_temp.partner(:'own', 'suspended-co', '{DE}', '{7212}') as suspended \gset
update public.organizations set status = 'suspended' where id = :'suspended';
select pg_temp.partner(:'own', 'hidden-co', '{DE}', '{7212}') as hidden \gset
update public.organizations set moderation_state = 'hidden' where id = :'hidden';
select pg_temp.partner(:'own', 're-review-co', '{DE}', '{7212}', '2026-09-01 08:00+00') as rereview \gset
update public.organizations set review_status = 're_review' where id = :'rereview';
select pg_temp.new_org(:'own', 'staffing_company', 'staffing-co') as staffing \gset
update public.organizations set review_status = 'listed', listed_at = now(), submitted_at = now() where id = :'staffing';
insert into public.organization_geographies (organization_id, scope, country_code) values (:'staffing', 'serves_market', 'DE');
insert into public.organization_occupations (organization_id, occupation_id) values (:'staffing', '7212');
update public.organizations set legal_entity_identifier = 'PHSEC2012345', legal_entity_identifier_kind = 'registration_number',
  recruitment_type = 'international'
where id = :'listed';
insert into public.organization_geographies (organization_id, scope, country_code) values (:'listed', 'sources_from', 'PH');
insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until,
  confirmed_at, partner_terms_version)
values (:'listed', 'PH', 'Department of Migrant Workers', 'DMW-123-LB-031522-R', current_date + 400, now(), 1);
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
  available_from, confirmed_at)
values (:'listed', '7212', 'PH', 40, 15, current_date + 14, now() - interval '3 days');

-- Grants and release switch ----------------------------------------------------------------------------------------------
select ok(
  has_function_privilege('anon', 'public.search_partners(text, text, text, text, text[], text, text, public.recruitment_preference, text[], text, integer, integer, text, integer, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.search_partners(text, text, text, text, text[], text, text, public.recruitment_preference, text[], text, integer, integer, text, integer, text, text)', 'execute'),
  'AC1: search_partners is executable by anon and authenticated'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where proname = 'search_partners'),
  'search_partners is security definer with an empty search_path'
);
select ok(
  not has_function_privilege('anon', 'public.admin_partner_search_stats(text, date, date)', 'execute'),
  'the search statistics are not executable by anon'
);
select is(pg_temp.search(null, '''recruitment'', p_destination => ''DE'''), 'P0002|CHARA_NOT_FOUND|',
  'while release_partner_directories is false nobody can search');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC1: only listed, active, visible recruitment companies ------------------------------------------------------------------
select is(pg_temp.search(null, '''recruitment'', p_destination => ''DE'', p_occupation => ''7212'''), 'ok', 'a visitor searches');
select is(pg_temp.slugs(), 'listed-co,re-review-co',
  'AC1: a visitor gets the listed company (and the one in re-review, which stays listed until staff decide)');
select is(pg_temp.search(:'wrk', '''recruitment'', p_destination => ''DE'', p_occupation => ''7212'''), 'ok', 'a candidate searches');
select is(pg_temp.slugs(), 'listed-co,re-review-co', 'AC1: so does a signed-in candidate');
select is(pg_temp.search(:'acm', '''recruitment'', p_destination => ''DE'', p_occupation => ''7212'''), 'ok', 'an employer admin searches');
select is(pg_temp.slugs(), 'listed-co,re-review-co',
  'AC1: and an employer admin: pending, info requested, declined, suspended, hidden, staffing and employer never appear');
select is(pg_temp.search(:'own', '''recruitment'''), 'ok', 'a search without filters is allowed');
select ok(pg_temp.slugs() !~ '(pending|info|declined|suspended|hidden|staffing)-co|acme',
  'AC1: without filters too, no unlisted partner, staffing company or employer is returned');
select throws_ok(format('update public.organizations set listed_at = now() where id = %L', :'acme'), '23514', null,
  'AC1: an employer cannot carry listed_at, so the fixture employer serves DE with 7212 unlisted and the type excludes it');
select is(pg_temp.search(null, format('''recruitment'', p_destination => %L', :'pending')), 'P0001|CHARA_INVALID_INPUT|p_destination',
  'AC1: an id cannot be passed as a filter');
select is(pg_temp.search(null, '''recruitment'', p_occupation => ''pending-co'''), 'P0001|CHARA_INVALID_INPUT|p_occupation',
  'AC1: nor a slug');

-- AC4: public columns only ---------------------------------------------------------------------------------------------------
select is(pg_temp.search(null, '''recruitment'', p_destination => ''DE'', p_occupation => ''7212'''), 'ok', 'the result is read');
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.result() -> 0) k),
  'also_offers_staffing,available_workforce,based_in_country,capacity_confirmed_at,display_name,id,main_occupations,matched_filters,next_cursor,organization_type,profile_updated_at,served_countries,slug,staffing_types',
  'AC4: the columns are exactly the public ones'
);
select ok(
  pg_temp.result()::text !~ '(Legal listed-co|PHSEC2012345|DMW-123|Migrant|maria\.santos|listed_at|review_status|international|recruitment_partner)',
  'AC4: no legal name, identifier, licence, member email, review state or plan in the result'
);
select is(pg_temp.result() -> 0 -> 'served_countries', '[{"code": "DE", "name": "Germany"}]'::jsonb, 'AC4: the countries served, named');
select ok((pg_temp.result() -> 0 ->> 'capacity_confirmed_at') is not null, 'AC4: the confirmation time of a fresh listing');
select is((pg_temp.result() -> 1 ->> 'capacity_confirmed_at'), null, 'and none without a listing');

select is((pg_temp.result() -> 0 ->> 'profile_updated_at')::timestamptz, '2026-10-01 08:00+00'::timestamptz,
  'AC4: profile_updated_at is the time the profile last changed');
select pg_temp.partner(:'own', 'never-changed', '{LU}', '{7212}', null) as never \gset
select pg_temp.partner(:'own', 'changed-lu', '{LU}', '{7212}', now() - interval '40 days') as changed_lu \gset
select is(pg_temp.search(null, '''recruitment'', p_destination => ''LU'''), 'ok', 'a profile that never changed');
select is(pg_temp.slugs() || '|' || coalesce(pg_temp.result() -> 0 ->> 'profile_updated_at', 'null'), 'never-changed,changed-lu|null',
  'AC4: before any change profile_updated_at is null, and the listing time (30 days ago) sorts it');
select pg_temp.partner(:'own', 'many-occupations', '{CH}', '{7212,7411,7126,5120,9313,8322}') as many \gset
insert into public.organization_geographies (organization_id, scope, country_code) values (:'many', 'sources_from', 'PH');
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
  available_from, confirmed_at)
values (:'many', '7212', 'PH', 10, 5, current_date, now() - interval '1 day'),
       (:'many', '7411', 'PH', 50, 5, current_date, now() - interval '1 day'),
       (:'many', '7126', 'PH', 30, 5, current_date, now() - interval '1 day'),
       (:'many', '8322', 'PH', 99, 5, current_date, now() - interval '61 days');
select is(pg_temp.search(null, '''recruitment'', p_destination => ''CH'''), 'ok', 'a partner with six occupations');
select is(
  (select string_agg(o ->> 'code', ',' order by n) from jsonb_array_elements(pg_temp.result() -> 0 -> 'main_occupations') with ordinality x (o, n)),
  '7411,7126,7212,9313,8322',
  'AC4: at most five main occupations, by the workers of fresh listings, then by name (a stale listing counts nothing)'
);

-- AC2: destination and occupation narrow, the other filters rank and are named -----------------------------------------------
select pg_temp.partner(:'own', 'r1-at', '{AT}', '{7212}', '2026-10-01 08:00+00') as r1 \gset
update public.organizations set recruitment_type = 'international' where id = :'r1';
insert into public.organization_geographies (organization_id, scope, country_code) values (:'r1', 'sources_from', 'PH');
insert into public.organization_industries (organization_id, industry_code) values (:'r1', 'C');
insert into public.organization_languages (organization_id, language_code) values (:'r1', 'tl');
select pg_temp.partner(:'own', 'r2-at', '{AT}', '{7212}', '2026-10-02 08:00+00') as r2 \gset
update public.organizations set recruitment_type = 'local' where id = :'r2';
select pg_temp.partner(:'own', 'r3-nl', '{NL}', '{7212}') as r3 \gset
select pg_temp.partner(:'own', 'r4-at', '{AT}', '{5120}') as r4 \gset
select pg_temp.partner(:'own', 'r5-at', '{AT}', '{7212}', '2026-09-01 08:00+00') as r5 \gset
update public.organizations set recruitment_type = 'both', based_in_country = 'IN' where id = :'r5';

select is(pg_temp.search(null, '''recruitment'', p_destination => ''AT'', p_occupation => ''7212'''), 'ok', 'destination and occupation');
select is(pg_temp.slugs(), 'r2-at,r1-at,r5-at', 'AC2: R1 and R2 (and R5), never R3 (destination) or R4 (occupation)');
select is(pg_temp.matched('r1-at'), 'destination,occupation', 'AC2: the two narrowing filters are named');
select is(
  pg_temp.search(null, '''recruitment'', p_destination => ''at'', p_occupation => ''7212'', p_based_in => ''PH'', p_sources_from => ''{PH}'', p_industry => ''C'', p_language => ''tl'', p_recruitment_type => ''international'''),
  'ok', 'every basic filter (lower-case codes accepted)'
);
select is(pg_temp.slugs(), 'r1-at,r2-at,r5-at', 'AC2: R1 first');
select is(pg_temp.matched('r1-at'), 'destination,occupation,based_in,sources_from,industry,language,recruitment_type',
  'AC2: R1 matched every filter, named in order');
select is(pg_temp.matched('r2-at'), 'destination,occupation,based_in', 'AC2: R2 matched destination, occupation and based in');
select is(pg_temp.matched('r5-at'), 'destination,occupation,recruitment_type', 'AC2: international matches a partner with both');
select is(pg_temp.search(null, '''recruitment'', p_destination => ''AT'', p_recruitment_type => ''local'''), 'ok', 'local');
select is(
  (select string_agg(e ->> 'slug', ',' order by e ->> 'slug') from jsonb_array_elements(pg_temp.result()) e
   where e -> 'matched_filters' ? 'recruitment_type'),
  'r2-at,r5-at', 'AC2: local matches local or both, never international'
);
select is(pg_temp.search(null, '''recruitment'', p_destination => ''XX'''), 'ok', 'AC2: destination XX is no error');
select is(jsonb_array_length(pg_temp.result()), 0, 'AC2: and returns 0 rows');

-- AC3: matched filters, then profile time, then id; never the plan ------------------------------------------------------------
select pg_temp.partner(:'own', 'a-be', '{BE}', '{7212}', '2026-08-01 08:00+00') as a_be \gset
insert into public.organization_languages (organization_id, language_code) values (:'a_be', 'tl');
select pg_temp.partner(:'own', 'b-be', '{BE}', '{7212}', '2026-10-01 08:00+00', '00000000-0000-0000-0000-00000000be0b') as b_be \gset
select pg_temp.partner(:'own', 'c-be', '{BE}', '{7212}', '2026-10-02 08:00+00', '00000000-0000-0000-0000-00000000be0c') as c_be \gset
select pg_temp.partner(:'own', 'd-be', '{BE}', '{7212}', '2026-10-02 08:00+00', '00000000-0000-0000-0000-00000000be0d') as d_be \gset
update public.organizations set based_in_country = 'IN' where id in (:'b_be', :'c_be', :'d_be');
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (:'b_be', 'recruitment_enterprise', 'active', 'null'), (:'c_be', 'recruitment_partner', 'active', 'null');
select is(pg_temp.search(null, '''recruitment'', p_destination => ''BE'', p_occupation => ''7212'', p_based_in => ''PH'', p_language => ''tl'''), 'ok', 'the order');
select is(pg_temp.slugs(), 'a-be,c-be,d-be,b-be', 'AC3: A (4 filters), then C (newer), D (same time, higher id), B (Enterprise)');
update billing.subscriptions set plan_code = 'free_recruitment_company' where organization_id = :'b_be';
update billing.subscriptions set plan_code = 'recruitment_professional' where organization_id = :'c_be';
select is(pg_temp.search(null, '''recruitment'', p_destination => ''BE'', p_occupation => ''7212'', p_based_in => ''PH'', p_language => ''tl'''), 'ok', 'after the plans changed');
select is(pg_temp.slugs(), 'a-be,c-be,d-be,b-be', 'AC3: the same order after the plans changed');
select ok(
  (select prosrc !~ 'billing\.' from pg_proc where proname = 'search_partners'),
  'AC3, NFR-C8: no column, sort key or tie-break of search_partners reads billing.*'
);

-- AC5: advanced filters follow advanced_partner_search -------------------------------------------------------------------------
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.search(:'acm', '''recruitment'', p_capacity => 100, p_within_days => 60'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_partner_search', 'AC5: capacity and timeframe are refused on Starter');
select is(pg_temp.search(null, '''recruitment'', p_capacity => 100, p_within_days => 60'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_partner_search', 'AC5: and for a visitor');
select is(pg_temp.search(:'wrk', '''recruitment'', p_capacity => 100, p_within_days => 60'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_partner_search', 'AC5: and for a candidate');
select is(pg_temp.search(:'own', '''recruitment'', p_capacity => 100'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_partner_search', 'AC5: and for a partner whose plan lacks the feature');
select is(pg_temp.search(:'bet', '''recruitment'', p_capacity => 100, p_within_days => 60'), 'ok', 'AC5: Professional may');
select is(pg_temp.search(:'acm', '''recruitment'', p_sources_from => ''{PH,IN}'''),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_partner_search', 'AC5: two source countries are refused on Starter');
select is(pg_temp.search(null, '''recruitment'', p_sources_from => ''{PH,IN}'''),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_partner_search', 'AC5: and for a visitor');
select is(pg_temp.search(:'bet', '''recruitment'', p_sources_from => ''{PH,IN,ph}'''), 'ok', 'AC5: Professional may');
select is(
  pg_temp.search(null, '''recruitment'', p_sources_from => ''{PH,ph}''') || pg_temp.search(:'wrk', '''recruitment'', p_sources_from => ''{PH}''')
  || pg_temp.search(:'acm', '''recruitment'', p_sources_from => ''{PH}'''),
  'okokok', 'AC5: everyone may use one source country (a repeated one counts once)'
);
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(pg_temp.search(:'acm', '''recruitment'', p_capacity => 100, p_within_days => 60'), 'ok',
  'AC5: with entitlements_enforced false the Starter admin may');
select is(pg_temp.search(null, '''recruitment'', p_capacity => 100') || '/' || pg_temp.search(:'wrk', '''recruitment'', p_sources_from => ''{PH,IN}'''),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_partner_search/P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_partner_search',
  'AC5: while the visitor and the candidate are still refused (no plan)');

-- AC6: the capacity filter uses fresh listings only ------------------------------------------------------------------------------
select pg_temp.partner(:'own', 'cap-r1', '{DK}', '{7212}', '2026-09-01 08:00+00') as c1 \gset
select pg_temp.partner(:'own', 'cap-r2', '{DK}', '{7212}', '2026-10-04 08:00+00') as c2 \gset
select pg_temp.partner(:'own', 'cap-r3', '{DK}', '{7212}', '2026-10-03 08:00+00') as c3 \gset
select pg_temp.partner(:'own', 'cap-r4', '{DK}', '{7212}', '2026-10-02 08:00+00') as c4 \gset
insert into public.organization_geographies (organization_id, scope, country_code)
select o, 'sources_from', 'PH' from unnest(array[:'c1', :'c2', :'c3', :'c4']::uuid[]) o;
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
  available_from, confirmed_at)
values (:'c1', '7212', 'PH', 120, 10, current_date, now() - interval '10 days'),
       (:'c2', '7212', 'PH', 150, 10, current_date, now() - interval '61 days'),
       (:'c3', '7212', 'PH', 90, 10, current_date, now() - interval '1 day'),
       (:'c4', '7212', 'PH', 120, 10, current_date + 90, now() - interval '1 day');
select is(pg_temp.search(:'bet', '''recruitment'', p_destination => ''DK'', p_occupation => ''7212'', p_capacity => 100, p_within_days => 60'), 'ok', 'capacity and timeframe');
select is(pg_temp.slugs(), 'cap-r1,cap-r2,cap-r3,cap-r4', 'AC6: R1 first, the others after it by profile time');
select is(pg_temp.matched('cap-r1'), 'destination,occupation,capacity,timeframe', 'AC6: only R1 has capacity and timeframe');
select is(pg_temp.matched('cap-r2') || '|' || pg_temp.matched('cap-r3') || '|' || pg_temp.matched('cap-r4'),
  'destination,occupation|destination,occupation|destination,occupation',
  'AC6: R2 (stale), R3 (fewer than 100) and R4 (available later) match neither');
select is((select e ->> 'capacity_confirmed_at' from jsonb_array_elements(pg_temp.result()) e where e ->> 'slug' = 'cap-r2'), null,
  'AC6: the stale confirmation of R2 is not returned as a current value');

-- Validation -----------------------------------------------------------------------------------------------------------------------
select is(
  concat_ws(',',
    pg_temp.search(null, '''agency'''), pg_temp.search(null, 'null'), pg_temp.search(null, '''recruitment'', p_destination => ''deu'''),
    pg_temp.search(null, '''recruitment'', p_occupation => ''721'''), pg_temp.search(null, '''recruitment'', p_industry => ''CC'''),
    pg_temp.search(null, '''recruitment'', p_language => ''tgl'''), pg_temp.search(null, '''recruitment'', p_recruitment_type => ''both'''),
    pg_temp.search(:'bet', '''recruitment'', p_capacity => 0'), pg_temp.search(:'bet', '''recruitment'', p_capacity => 100001'),
    pg_temp.search(:'bet', '''recruitment'', p_within_days => 0'), pg_temp.search(:'bet', '''recruitment'', p_within_days => 366'),
    pg_temp.search(null, '''recruitment'', p_sources_from => ''{PHL}'''), pg_temp.search(null, '''recruitment'', p_cursor => ''2|x|y''')),
  'P0001|CHARA_INVALID_INPUT|p_kind,P0001|CHARA_INVALID_INPUT|p_kind,P0001|CHARA_INVALID_INPUT|p_destination,'
  'P0001|CHARA_INVALID_INPUT|p_occupation,P0001|CHARA_INVALID_INPUT|p_industry,P0001|CHARA_INVALID_INPUT|p_language,'
  'P0001|CHARA_INVALID_INPUT|p_recruitment_type,P0001|CHARA_INVALID_INPUT|p_capacity,P0001|CHARA_INVALID_INPUT|p_capacity,'
  'P0001|CHARA_INVALID_INPUT|p_within_days,P0001|CHARA_INVALID_INPUT|p_within_days,P0001|CHARA_INVALID_INPUT|p_sources_from,'
  'P0001|CHARA_INVALID_INPUT|p_cursor',
  'every parameter is checked and named'
);
select is(pg_temp.search(:'bet', '''recruitment'', p_capacity => 100000, p_within_days => 365') || pg_temp.search(:'bet', '''recruitment'', p_capacity => 1, p_within_days => 1'),
  'okok', 'the bounds 1 and 100,000 workers, 1 and 365 days are accepted');

-- AC12: keyset pagination ----------------------------------------------------------------------------------------------------------
select count(pg_temp.partner(:'own', 'page-' || n, '{KE}', '{7212}', timestamptz '2026-07-01 08:00+00' + make_interval(hours => n)))
from generate_series(1, 45) n;
create temp table seen (page integer, slug text, cursor text);
create temp table seen_changed (page integer, slug text, cursor text);
create function pg_temp.fetch_page(p_table text, p_page integer) returns text
language plpgsql as $$
declare
  v_cursor text;
  v_result text;
begin
  if p_page > 1 then
    execute format('select cursor from %I where page = %s and cursor is not null', p_table, p_page - 1) into v_cursor;
  end if;
  v_result := pg_temp.search(null, format('''recruitment'', p_destination => ''KE'', p_cursor => %L', v_cursor));
  execute format('insert into %I select %s, e ->> ''slug'', e ->> ''next_cursor'' from jsonb_array_elements(%L::jsonb) e',
    p_table, p_page, pg_temp.result());
  return v_result;
end;
$$;
select is(pg_temp.fetch_page('seen', 1) || pg_temp.fetch_page('seen', 2) || pg_temp.fetch_page('seen', 3), 'okokok', 'pages 1, 2 and 3');
select is((select string_agg(c::text, ',' order by p) from (select page as p, count(*) as c from seen group by page) x), '20,20,5',
  'AC12: pages of 20, 20 and 5');
select is((select count(distinct slug)::integer from seen), 45, 'AC12: no partner twice and none skipped');
select is((select count(cursor)::integer from seen where page = 3), 0, 'AC12: the last page has no next cursor');
select is((select count(cursor)::integer from seen where page < 3), 2, 'AC12: the others have exactly one, on their last row');

-- The keyset departure: a partner whose profile changes while someone pages moves to the front, before the cursor.
select is(pg_temp.fetch_page('seen_changed', 1), 'ok', 'page 1 again');
update public.organizations set workforce_profile_updated_at = now() where slug = 'page-5';
select is(pg_temp.fetch_page('seen_changed', 2) || pg_temp.fetch_page('seen_changed', 3), 'okok', 'pages 2 and 3 after page-5 changed');
select is((select string_agg(c::text, ',' order by p) from (select page as p, count(*) as c from seen_changed group by page) x), '20,20,4',
  'AC12 departure: the pages after the change hold one partner less');
select is(
  (select string_agg(s.slug, ',') from seen s where not exists (select 1 from seen_changed c where c.slug = s.slug)),
  'page-5', 'AC12 departure: a partner updated before it was shown moves before the cursor and is the one partner skipped'
);
select is((select (count(*) - count(distinct slug))::integer from seen_changed), 0, 'AC12 departure: still no partner twice');
select count(pg_temp.partner(:'own', 'more-' || n, '{KE}', '{7212}')) from generate_series(1, 10) n;
select is(pg_temp.search(null, '''recruitment'', p_destination => ''KE'', p_limit => 500'), 'ok', 'a limit of 500');
select is(jsonb_array_length(pg_temp.result()), 50, 'AC12: is capped at 50');
select is(pg_temp.search(null, '''recruitment'', p_destination => ''KE'''), 'ok', 'no limit');
select is(jsonb_array_length(pg_temp.result()), 20, 'AC12: gives 20');

-- AC11: the search log, without personal data -----------------------------------------------------------------------------------
delete from stats.partner_searches;
select is(pg_temp.search(:'acm', '''recruitment'', p_destination => ''NO'', p_occupation => ''7212'', p_language => ''tl'''), 'ok', 'a search without results');
select is(
  (select jsonb_agg(jsonb_build_object('kind', kind, 'filters', filter_names, 'destination', destination_country, 'count', result_count))
   from stats.partner_searches),
  '[{"kind": "recruitment", "filters": ["destination", "occupation", "language"], "destination": "NO", "count": 0}]'::jsonb,
  'AC11: exactly one row: kind, filter names, destination, result count 0'
);
select is(
  (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
   where table_schema = 'stats' and table_name = 'partner_searches'),
  'id,kind,filter_names,destination_country,result_count,created_at',
  'AC11: the log has no user, organisation, address, session or free-text column'
);
select is(pg_temp.search(null, format('''recruitment'', p_destination => ''KE'', p_cursor => %L', (select cursor from seen where page = 1 and cursor is not null))), 'ok', 'a next page');
select is(pg_temp.search(null, '''recruitment'', p_destination => ''XX'', p_capacity => null'), 'ok', 'an unknown destination');
select is(
  (select string_agg(coalesce(destination_country, '-') || ':' || result_count, ',' order by id) from stats.partner_searches),
  'NO:0,-:0', 'a next page is not logged again; an unknown destination is logged without it'
);
select is(pg_temp.call_as(:'acm', 'authenticated', 'select count(*) from stats.partner_searches'), '42501|permission denied for schema stats|',
  'NFR-S8: a signed-in user cannot read the log');
select is(pg_temp.call_as(null, 'anon', 'select count(*) from stats.partner_searches'), '42501|permission denied for schema stats|',
  'NFR-S8: nor can a visitor');

-- AC11: 60 searches per visitor key and minute ---------------------------------------------------------------------------------
delete from private.rate_limit_hits;
create function pg_temp.searches_as(p_user uuid, p_key text, p_count integer) returns text
language plpgsql as $$
declare
  v_result text;
  v_ok integer := 0;
begin
  for i in 1..p_count loop
    v_result := pg_temp.run(p_user, format('select * from public.search_partners(''recruitment'', p_destination => ''DE'', p_key => %L)', p_key));
    exit when v_result <> 'ok';
    v_ok := v_ok + 1;
  end loop;
  return v_ok || ':' || v_result;
end;
$$;
select is(pg_temp.searches_as(null, repeat('d', 64), 60), '60:ok', 'AC11: one visitor key searches 60 times');
select matches(pg_temp.run(null, format('select * from public.search_partners(''recruitment'', p_key => %L)', repeat('d', 64))),
  '^P0001\|CHARA_RATE_LIMITED\|[1-9][0-9]*$', 'AC11: the 61st within the window is refused with the seconds to wait');
select is(pg_temp.run(null, format('select * from public.search_partners(''recruitment'', p_key => %L)', repeat('e', 64))), 'ok',
  'another visitor key is not affected');
select is(pg_temp.searches_as(:'wrk', null, 60), '60:ok', 'a signed-in user searches 60 times');
select is(pg_temp.run(:'wrk', 'select * from public.search_partners(''recruitment'')'), 'P0001|CHARA_RATE_LIMITED|',
  'the 61st search of the signed-in user is refused (check_rate_limit)');
select is(pg_temp.run(null, 'select * from public.search_partners(''recruitment'')'), 'P0001|CHARA_INVALID_INPUT|p_key',
  'an anonymous search without a visitor key is refused');
select is((select count(*)::integer from private.missing_reference_data() where name like 'rate_limit_partner_search%'), 0,
  'the deployment check finds the throttle settings');
delete from private.settings where key = 'rate_limit_partner_search_max';
select is((select string_agg(name, ',') from private.missing_reference_data() where name like 'rate_limit_partner_search%'),
  'rate_limit_partner_search_max', 'and reports a missing one');
insert into private.settings (key, value) values ('rate_limit_partner_search_max', '60');

-- The search statistics ---------------------------------------------------------------------------------------------------------
delete from stats.partner_searches;
insert into stats.partner_searches (kind, filter_names, destination_country, result_count, created_at)
values ('recruitment', '{destination}', 'NO', 0, now()), ('recruitment', '{destination}', 'NO', 0, now()),
       ('recruitment', '{destination}', 'SE', 0, now()), ('recruitment', '{destination}', 'DE', 3, now()),
       ('recruitment', '{}', null, 20, now()), ('recruitment', '{destination}', 'NO', 0, now() - interval '40 days'),
       ('staffing', '{destination}', 'NO', 0, now());
select is(
  pg_temp.call_as(:'stf', 'authenticated', format(
    'select set_config(''t.result'', to_jsonb(s)::text, true) from public.admin_partner_search_stats(''recruitment'', %L, %L) s',
    current_date - 29, current_date)),
  'ok', 'a Platform Administrator reads the statistics');
select is(pg_temp.result(),
  '{"searches": 5, "with_results": 2, "zero_results": 3, "zero_by_destination": [{"code": "NO", "name": "Norway", "searches": 2}, {"code": "SE", "name": "Sweden", "searches": 1}]}'::jsonb,
  'KPIs: searches, with at least one result, zero results and zero-result searches by destination, within the days and the kind');
select is(pg_temp.call_as(:'acm', 'authenticated', format('select * from public.admin_partner_search_stats(''recruitment'', %L, %L)', current_date, current_date)),
  'P0001|CHARA_FORBIDDEN|', 'an employer admin cannot read them');
select is(pg_temp.call_as(:'stf', 'authenticated', format('select * from public.admin_partner_search_stats(''recruitment'', %L, %L)', current_date - 366, current_date)),
  'P0001|CHARA_INVALID_INPUT|range', 'at most 366 days');

-- Retention ------------------------------------------------------------------------------------------------------------------------
select is((select days || '/' || editable from private.retention_policies where entity = 'partner_searches'), '730/true',
  'the log is kept 730 days, editable in the retention editor');
update stats.partner_searches set created_at = now() - interval '731 days' where destination_country = 'SE';
select private.apply_retention();
select is((select count(*)::integer from stats.partner_searches where destination_country = 'SE'), 0, 'apply_retention removes rows past the period');
select is((select count(*)::integer from stats.partner_searches), 6, 'and keeps the others');

-- Reserved directory slugs ---------------------------------------------------------------------------------------------------------
select throws_ok(
  format('insert into public.organizations (type, slug, legal_name, display_name, based_in_country) values (%L, %L, %L, %L, %L)',
    'recruitment_company', 'recruitment', 'Recruitment Ltd', 'Recruitment', 'PH'),
  '23505', 'CHARA_CONFLICT', 'no organisation takes the slug of the recruitment directory (a unique violation, so create_organization retries)'
);
select throws_ok(format('update public.organizations set slug = %L where id = %L', 'staffing', :'listed'),
  '23505', 'CHARA_CONFLICT', 'nor the slug of the staffing directory');
select is(pg_temp.run(:'rcu', 'select public.create_organization(''employer'', ''Recruitment GmbH'', ''Recruitment'', ''DE'', ''C'') ->> ''slug'' as slug'),
  'ok', 'a company called Recruitment signs up');
select matches(pg_temp.result() -> 0 ->> 'slug', '^recruitment-[0-9a-f]{6}$', 'and create_organization gives it a suffixed slug');
select is(pg_temp.run(:'stu', 'select public.create_organization(''employer'', ''Staffing GmbH'', ''Staffing'', ''DE'', ''C'') ->> ''slug'' as slug'),
  'ok', 'a company called Staffing signs up');
select matches(pg_temp.result() -> 0 ->> 'slug', '^staffing-[0-9a-f]{6}$', 'and create_organization gives it a suffixed slug');
select lives_ok(
  format('insert into public.organizations (type, slug, legal_name, display_name, based_in_country) values (%L, %L, %L, %L, %L)',
    'employer', 'recruitment-agency', 'Recruitment Agency GmbH', 'Recruitment Agency', 'DE'),
  'a slug that only starts with the word is free'
);

select * from finish();
rollback;
