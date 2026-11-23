begin;
select plan(104);

\ir organizations_fixture.inc

-- Find staffing partners and search available workforce (V22, FR-L2 AC1 to AC5, AC7, AC11; FR-K3 AC6 to AC8; SOP P2-11
-- steps Search, Show; SOP P2-07 step Search; controls stale listings hidden, transparent ordering, rate limits; NFR-C8,
-- NFR-S8; decision 1.1): search_partners with p_kind staffing, search_available_workforce, their search log and statistics.

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

-- A listed partner of the type given, serving p_serves, with occupation 7212 and source countries PH and NP, its profile
-- changed at p_updated, and the service types given.
create function pg_temp.partner(p_owner uuid, p_type public.organization_type, p_slug text, p_serves text[],
  p_services public.partner_service_type[] default '{}', p_updated timestamptz default '2026-10-01 08:00+00',
  p_id uuid default gen_random_uuid()) returns uuid
language plpgsql as $$
declare
  v_id uuid := pg_temp.new_org(p_owner, p_type, p_slug, p_id);
begin
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days', workforce_profile_updated_at = p_updated
  where id = v_id;
  insert into public.organization_geographies (organization_id, scope, country_code)
  select v_id, 'serves_market'::public.geography_scope, c from unnest(p_serves) c
  union all select v_id, 'sources_from'::public.geography_scope, c from unnest(array['PH', 'NP']) c;
  insert into public.organization_occupations (organization_id, occupation_id) values (v_id, '7212'), (v_id, '7214');
  insert into public.organization_service_types (organization_id, service) select v_id, s from unnest(p_services) s;
  return v_id;
end;
$$;

create function pg_temp.listing(p_org uuid, p_available integer, p_monthly integer, p_from_days integer, p_confirmed_days integer,
  p_occupation text default '7212', p_source text default 'PH') returns uuid
language sql as $$
  insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
    available_from, confirmed_at)
  values (p_org, p_occupation, p_source, p_available, p_monthly, current_date + p_from_days,
    now() - make_interval(days => p_confirmed_days))
  returning id
$$;

-- Hides the partners of one block, so the next block reads only its own.
create function pg_temp.hide(p_prefix text) returns void
language sql as $$
  update public.organizations set moderation_state = 'hidden' where slug like p_prefix || '-%'
$$;

create function pg_temp.run(p_user uuid, p_sql text) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    'aal1')
$$;

-- One directory search as the user (anonymous when null, with a visitor key), with a fresh rate-limit window.
create function pg_temp.search(p_user uuid, p_args text) returns text
language plpgsql as $$
begin
  delete from private.rate_limit_hits;
  perform set_config('t.result', '[]', true);
  return pg_temp.run(p_user, format('select * from public.search_partners(%s%s)', p_args,
    case when p_user is null then format(', p_key => %L', repeat('a', 64)) else '' end));
end;
$$;

-- One available-workforce search as the user, with a fresh rate-limit window.
create function pg_temp.workforce(p_user uuid, p_args text) returns text
language plpgsql as $$
begin
  delete from private.rate_limit_hits;
  perform set_config('t.result', '[]', true);
  return pg_temp.run(p_user, format('select * from public.search_available_workforce(%s)', p_args));
end;
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

create function pg_temp.slugs() returns text
language sql as $$
  select coalesce(string_agg(e ->> 'slug', ',' order by n), '') from jsonb_array_elements(pg_temp.result()) with ordinality r (e, n)
$$;

create function pg_temp.row_of(p_slug text) returns jsonb
language sql as $$
  select e from jsonb_array_elements(pg_temp.result()) e where e ->> 'slug' = p_slug
$$;

create function pg_temp.matched(p_slug text) returns text
language sql as $$
  select string_agg(m, ',' order by k)
  from jsonb_array_elements_text(pg_temp.row_of(p_slug) -> 'matched_filters') with ordinality f (m, k)
$$;

\set own '00000000-0000-0000-0000-0000002f0001'
\set wrk '00000000-0000-0000-0000-0000002f0002'
\set acm '00000000-0000-0000-0000-0000002f0003'
\set bet '00000000-0000-0000-0000-0000002f0004'
\set fre '00000000-0000-0000-0000-0000002f0005'
\set mem '00000000-0000-0000-0000-0000002f0006'
\set stf '00000000-0000-0000-0000-0000002f0007'
\set sus '00000000-0000-0000-0000-0000002f0008'

select pg_temp.new_user(:'own', 'company', 'ana.reyes@cebu-staffing.example');
select pg_temp.new_user(:'wrk', 'worker');
select pg_temp.new_user(:'acm');
select pg_temp.new_user(:'bet');
select pg_temp.new_user(:'fre');
select pg_temp.new_user(:'mem');
select pg_temp.new_user(:'stf');
select pg_temp.new_user(:'sus');
update public.profiles set account_kind = intended_account_kind
where id in (:'own', :'wrk', :'acm', :'bet', :'fre', :'mem', :'stf', :'sus');
insert into public.platform_staff (user_id, role) values (:'stf', 'admin');

-- Partners of earlier test data must not change the results below: they are hidden for this transaction.
update public.organizations set moderation_state = 'hidden' where type <> 'employer';

select pg_temp.new_org(:'acm', 'employer', 'acme-staffing-gmbh') as acme \gset
select pg_temp.new_org(:'bet', 'employer', 'beta-staffing-bau') as beta \gset
select pg_temp.new_org(:'fre', 'employer', 'free-staffing-kg') as free_org \gset
select pg_temp.new_org(:'sus', 'employer', 'suspended-staffing-ag') as suspended_org \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'beta', :'mem', 'member', now());
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (:'acme', 'employer_starter', 'active', 'null'), (:'beta', 'employer_professional', 'active', 'null'),
       (:'suspended_org', 'employer_professional', 'active', 'null');
update public.organizations set status = 'suspended' where id = :'suspended_org';

-- Grants and release switch ----------------------------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'public.search_available_workforce(text, text, integer, integer, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.search_available_workforce(text, text, integer, integer, text, integer)', 'execute'),
  'FR-K3 AC8: search_available_workforce is executable by authenticated only'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where proname = 'search_available_workforce'),
  'search_available_workforce is security definer with an empty search_path'
);
select is(pg_temp.search(null, '''staffing'', p_destination => ''DE'''), 'P0002|CHARA_NOT_FOUND|',
  'while release_partner_directories is false nobody searches the staffing directory');
select is(pg_temp.workforce(:'bet', '''DE'', ''7212'', 100, 60'), 'P0002|CHARA_NOT_FOUND|',
  'nor the available workforce');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- FR-L2 AC1: staffing companies and recruitment companies offering staffing, marked ---------------------------------------
select pg_temp.partner(:'own', 'staffing_company', 'l2a1-s1', '{DE}', '{temporary}') as s1 \gset
select pg_temp.partner(:'own', 'recruitment_company', 'l2a1-r1', '{DE}', '{staffing,contract}') as r1 \gset
select pg_temp.partner(:'own', 'recruitment_company', 'l2a1-r2', '{DE}') as r2 \gset
select pg_temp.partner(:'own', 'staffing_company', 'l2a1-s2', '{DE}', '{temporary}') as s2 \gset
update public.organizations set review_status = 'pending_review', listed_at = null where id = :'s2';
select pg_temp.partner(:'own', 'staffing_company', 'l2a1-s3', '{DE}', '{temporary}') as s3 \gset
update public.organizations set status = 'suspended' where id = :'s3';
select pg_temp.partner(:'own', 'staffing_company', 'l2a1-s4', '{DE}', '{temporary}') as s4 \gset
update public.organizations set moderation_state = 'hidden' where id = :'s4';
select pg_temp.partner(:'own', 'staffing_company', 'l2a1-s5', '{DE}', '{temporary}') as s5 \gset
update public.organizations set review_status = 'declined' where id = :'s5';
update public.organizations set legal_entity_identifier = 'PHSEC2099999', legal_entity_identifier_kind = 'registration_number'
where id = :'s1';
insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until,
  confirmed_at, partner_terms_version)
values (:'s1', 'PH', 'Department of Migrant Workers', 'DMW-777-LB-010101-R', current_date + 400, now(), 1);
insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'s1', 'staffing_professional', 'active', 'null');

select is(pg_temp.search(null, '''staffing'', p_destination => ''DE'''), 'ok', 'a visitor searches the staffing directory');
select is((select string_agg(e ->> 'slug', ',' order by e ->> 'slug') from jsonb_array_elements(pg_temp.result()) e), 'l2a1-r1,l2a1-s1',
  'FR-L2 AC1: S1 and R1, never R2 (no staffing), S2 (pending), S3 (suspended), S4 (hidden by moderation) or S5 (declined)');
select is(pg_temp.row_of('l2a1-r1') ->> 'organization_type' || '|' || (pg_temp.row_of('l2a1-r1') ->> 'also_offers_staffing'),
  'recruitment_company|true', 'FR-L2 AC1: R1 is a recruitment company that also offers staffing');
select is(pg_temp.row_of('l2a1-s1') ->> 'organization_type' || '|' || (pg_temp.row_of('l2a1-s1') ->> 'also_offers_staffing'),
  'staffing_company|false', 'FR-L2 AC1: S1 is a staffing company');
select is(pg_temp.row_of('l2a1-r1') -> 'staffing_types', '["contract"]'::jsonb,
  'FR-L2 AC1: the staffing types of R1, without the service staffing itself');
select ok(
  pg_temp.result()::text !~ '(Legal l2a1|PHSEC2099999|DMW-777|Migrant|ana\.reyes|listed_at|review_status|staffing_professional)',
  'privacy: no legal name, identifier, licence, member email, review state or plan in the staffing results'
);
select is(pg_temp.search(:'acm', '''staffing'''), 'ok', 'an employer searches without filters');
select ok(pg_temp.slugs() !~ 'l2a1-(r2|s2|s3|s4|s5)', 'FR-L2 AC1: without filters too, only S1 and R1');
select is(pg_temp.search(null, '''recruitment'', p_destination => ''DE'''), 'ok', 'the recruitment directory');
select is((select string_agg(e ->> 'slug', ',' order by e ->> 'slug') from jsonb_array_elements(pg_temp.result()) e), 'l2a1-r1,l2a1-r2',
  'FR-L2 AC1: R1 is still returned by kind recruitment, never a staffing company');
select is(pg_temp.row_of('l2a1-r1') ->> 'also_offers_staffing', 'true', 'and is marked there too');
select pg_temp.hide('l2a1');

-- FR-L2 AC2: the staffing type filter ranks and is named ---------------------------------------------------------------------
select pg_temp.partner(:'own', 'staffing_company', 'l2a2-t1', '{DE}', '{temporary}', '2026-10-01 08:00+00') as t1 \gset
select pg_temp.partner(:'own', 'staffing_company', 'l2a2-t2', '{DE}', '{contract,project}', '2026-10-02 08:00+00') as t2 \gset
select pg_temp.partner(:'own', 'staffing_company', 'l2a2-t3', '{DE}', '{permanent}', '2026-10-03 08:00+00') as t3 \gset
select pg_temp.partner(:'own', 'staffing_company', 'l2a2-t4', '{DE}', '{temporary,contract,project,permanent}', '2026-09-01 08:00+00') as t4 \gset
select is(pg_temp.search(null, '''staffing'', p_staffing_types => ''{temporary}'''), 'ok', 'staffing type temporary');
select is(pg_temp.slugs(), 'l2a2-t1,l2a2-t4,l2a2-t3,l2a2-t2', 'FR-L2 AC2: temporary ranks T1 and T4 first');
select is(pg_temp.matched('l2a2-t1') || '|' || pg_temp.matched('l2a2-t4') || '|' || coalesce(pg_temp.matched('l2a2-t2'), ''),
  'staffing_type|staffing_type|', 'FR-L2 AC2: and names staffing_type for them only');
select is(pg_temp.search(null, '''staffing'', p_staffing_types => ''{project}'''), 'ok', 'staffing type project');
select is(pg_temp.slugs(), 'l2a2-t2,l2a2-t4,l2a2-t3,l2a2-t1', 'FR-L2 AC2: project ranks T2 and T4 first');
select is(pg_temp.search(null, '''staffing'', p_staffing_types => ''{Permanent}'''), 'ok', 'staffing type permanent, any case');
select is(pg_temp.slugs(), 'l2a2-t3,l2a2-t4,l2a2-t2,l2a2-t1', 'FR-L2 AC2: permanent ranks T3 and T4 first');
select is(pg_temp.search(null, '''staffing'', p_staffing_types => ''{temporary,project}'''), 'ok', 'two staffing types');
select is(pg_temp.slugs(), 'l2a2-t2,l2a2-t1,l2a2-t4,l2a2-t3', 'FR-L2 AC2: either type matches');
select is(pg_temp.search(null, '''staffing'', p_staffing_types => ''{gig}''') || '/' || pg_temp.result()::text,
  'P0001|CHARA_INVALID_INPUT|p_staffing_types/[]', 'FR-L2 AC2: gig fails, naming the staffing types, with no rows');
select is(pg_temp.search(null, '''staffing'', p_staffing_types => ''{staffing}''') || ',' || pg_temp.search(null, '''staffing'', p_staffing_types => ''{null}'''),
  'P0001|CHARA_INVALID_INPUT|p_staffing_types,P0001|CHARA_INVALID_INPUT|p_staffing_types',
  'FR-L2 AC2: the service staffing and a null are no staffing types');
select pg_temp.hide('l2a2');

-- FR-L2 AC3: operating country, markets served and workforce size --------------------------------------------------------------
select pg_temp.partner(:'own', 'staffing_company', 'l2a3-s1', '{DE,NL}', '{temporary}', '2026-09-01 08:00+00') as a3s1 \gset
select pg_temp.partner(:'own', 'staffing_company', 'l2a3-s2', '{DE}', '{temporary}', '2026-10-01 08:00+00') as a3s2 \gset
select pg_temp.partner(:'own', 'staffing_company', 'l2a3-s3', '{FR}', '{temporary}', '2026-10-02 08:00+00') as a3s3 \gset
update public.organizations set based_in_country = 'PL', workforce_size_band = '250_999' where id = :'a3s1';
update public.organizations set based_in_country = 'RO', workforce_size_band = '50_249' where id = :'a3s2';
update public.organizations set based_in_country = 'PL', workforce_size_band = '1000_plus' where id = :'a3s3';
select is(pg_temp.search(null, '''staffing'', p_destination => ''DE'''), 'ok', 'destination DE');
select is(pg_temp.slugs(), 'l2a3-s2,l2a3-s1', 'FR-L2 AC3: S1 and S2 serve DE, S3 never');
select is(pg_temp.search(null, '''staffing'', p_destination => ''DE'', p_based_in => ''pl'''), 'ok', 'based in PL');
select is(pg_temp.slugs() || '|' || pg_temp.matched('l2a3-s1'), 'l2a3-s1,l2a3-s2|destination,based_in',
  'FR-L2 AC3: based in PL ranks S1 first, naming based_in');
select is(pg_temp.search(null, '''staffing'', p_destination => ''DE'', p_workforce_size => ''250_999'''), 'ok', 'workforce size');
select is(pg_temp.slugs() || '|' || pg_temp.matched('l2a3-s1'), 'l2a3-s1,l2a3-s2|destination,workforce_size',
  'FR-L2 AC3: workforce size 250_999 ranks S1 first, naming workforce_size');
select is(pg_temp.search(null, '''staffing'', p_workforce_size => ''huge''') || '/' || pg_temp.result()::text,
  'P0001|CHARA_INVALID_INPUT|p_workforce_size/[]', 'FR-L2 AC3: an unknown band fails, naming the workforce size');
select pg_temp.hide('l2a3');

-- Advanced filters of the staffing directory follow advanced_partner_search, as in FR-L1 ---------------------------------------
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(
  concat_ws(',', pg_temp.search(null, '''staffing'', p_capacity => 100'), pg_temp.search(:'wrk', '''staffing'', p_within_days => 60'),
    pg_temp.search(:'acm', '''staffing'', p_capacity => 100, p_within_days => 60')),
  'P0001|CHARA_UNAUTHENTICATED|advanced_partner_search,P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_partner_search,'
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_partner_search',
  'FR-L2 step Filter: capacity and timeframe ask a visitor to sign in and are refused to a candidate and a Starter employer'
);
select is(pg_temp.search(:'bet', '''staffing'', p_capacity => 100, p_within_days => 60'), 'ok', 'FR-L2 step Filter: Professional may');
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- FR-L2 AC5: the order of FR-L1, never the plan ----------------------------------------------------------------------------------
select pg_temp.partner(:'own', 'staffing_company', 'l2a5-four', '{DE}', '{temporary}', '2026-08-01 08:00+00') as four \gset
select pg_temp.partner(:'own', 'staffing_company', 'l2a5-newer', '{DE}', '{temporary}', '2026-10-02 08:00+00') as newer \gset
select pg_temp.partner(:'own', 'staffing_company', 'l2a5-older', '{DE}', '{temporary}', '2026-10-01 08:00+00') as older \gset
select pg_temp.partner(:'own', 'staffing_company', 'l2a5-zero', '{DE}', '{contract}', '2026-10-03 08:00+00') as zero \gset
update public.organizations set based_in_country = 'PL', workforce_size_band = '250_999' where id = :'four';
update public.organizations set workforce_size_band = '250_999' where id in (:'newer', :'older');
update public.organizations set based_in_country = 'IN' where id in (:'newer', :'older', :'zero');
insert into public.organization_industries (organization_id, industry_code) values (:'four', 'C');
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (:'newer', 'staffing_partner', 'active', 'null'), (:'older', 'staffing_enterprise', 'active', 'null');
select is(pg_temp.search(null, '''staffing'', p_based_in => ''PL'', p_industry => ''C'', p_staffing_types => ''{temporary}'', p_workforce_size => ''250_999'''),
  'ok', 'four ranking filters');
select is(pg_temp.slugs(), 'l2a5-four,l2a5-newer,l2a5-older,l2a5-zero',
  'FR-L2 AC5: 4 matches, the newer 2-match (Basic), the older 2-match (Enterprise), then 0 matches');
select is(pg_temp.matched('l2a5-four'), 'based_in,industry,staffing_type,workforce_size', 'FR-L2 AC5: four matched filters, in order');
update billing.subscriptions set plan_code = 'staffing_enterprise' where organization_id = :'newer';
update billing.subscriptions set plan_code = 'free_staffing_company' where organization_id = :'older';
select is(pg_temp.search(null, '''staffing'', p_based_in => ''PL'', p_industry => ''C'', p_staffing_types => ''{temporary}'', p_workforce_size => ''250_999'''),
  'ok', 'after the plans changed');
select is(pg_temp.slugs(), 'l2a5-four,l2a5-newer,l2a5-older,l2a5-zero', 'FR-L2 AC5: changing the plans does not change the order');
select ok(
  (select bool_and(prosrc !~ 'billing\.') from pg_proc where proname in ('search_partners', 'search_available_workforce')),
  'FR-L2 AC5, NFR-C8: no column, sort key or tie-break of either search reads billing.*'
);
select pg_temp.hide('l2a5');

-- FR-L2 AC7: stale listings are hidden from cards and capacity -------------------------------------------------------------------
select pg_temp.partner(:'own', 'staffing_company', 'l2a7-co', '{DE}', '{temporary}') as a7 \gset
select pg_temp.listing(:'a7', 120, 40, 0, 59) as fresh_listing \gset
select pg_temp.listing(:'a7', 500, 40, 0, 61, '7214') as stale_listing \gset
select pg_temp.listing(:'a7', 30, 5, 0, 10, '7212', 'NP') as second_source \gset
select is(pg_temp.search(null, '''staffing'''), 'ok', 'a visitor');
select is(
  (select jsonb_build_object('w', e -> 'available_workforce', 'c', e -> 'capacity_confirmed_at')
   from jsonb_array_elements(pg_temp.result()) e where e ->> 'slug' = 'l2a7-co'),
  '{"w": null, "c": null}'::jsonb,
  'FR-K3 AC4: a visitor reads neither the available workforce nor its confirmation'
);
select is(pg_temp.search(:'wrk', '''staffing'''), 'ok', 'a signed-in reader, a staffing company with a stale listing');
select is(
  (select jsonb_agg(jsonb_build_object('code', w ->> 'code', 'name', w ->> 'name', 'available', w ->> 'available'))
   from jsonb_array_elements(pg_temp.result() -> 0 -> 'available_workforce') w),
  '[{"code": "7212", "name": "Welders and flame cutters", "available": "100–249"}]'::jsonb,
  'FR-L2 AC7: only the fresh 7212 listings (both source countries summed, 150 as a range), never the stale 7214 one'
);
select is((pg_temp.result() -> 0 -> 'available_workforce' -> 0 ->> 'confirmed_at')::timestamptz, now() - interval '10 days',
  'FR-L2 AC6: the occupation carries its latest confirmation');
select is(pg_temp.search(:'bet', '''staffing'', p_occupation => ''7214'', p_capacity => 100'), 'ok', 'capacity of the stale occupation');
select is(pg_temp.matched('l2a7-co'), 'occupation', 'FR-L2 AC7: the stale listing does not count for capacity');
select is(pg_temp.call_as(:'own', 'authenticated', format('select public.confirm_workforce_availability(%L)', :'stale_listing')), 'ok',
  'the partner confirms the stale listing');
select is(pg_temp.search(:'wrk', '''staffing'''), 'ok', 'the next call');
select is(
  (select string_agg(w ->> 'code', ',' order by n) from jsonb_array_elements(pg_temp.result() -> 0 -> 'available_workforce') with ordinality x (w, n)),
  '7214,7212', 'FR-L2 AC7: after the confirmation the 7214 listing is shown (the largest first)'
);
select pg_temp.hide('l2a7');

-- FR-L2 AC11: the search log of the staffing directory -----------------------------------------------------------------------------
select pg_temp.partner(:'own', 'staffing_company', 'l2a11-' || n, '{DE}', '{temporary}') from generate_series(1, 3) n;
delete from stats.partner_searches;
select is(pg_temp.search(:'acm', '''staffing'', p_destination => ''DE'', p_staffing_types => ''{temporary,temporary}'''), 'ok',
  'a signed-in employer searches the staffing directory');
select is(jsonb_array_length(pg_temp.result()), 3, 'FR-L2 AC11: 3 rows');
select results_eq(
  'select kind, filter_names, destination_country, result_count from stats.partner_searches',
  $$values ('staffing'::text, '{destination,staffing_type}'::text[], 'DE'::text, 3)$$,
  'FR-L2 AC11: exactly one row with kind staffing, the filter names, DE and 3'
);
select is(
  (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
   where table_schema = 'stats' and table_name = 'partner_searches'),
  'id,kind,filter_names,destination_country,result_count,created_at',
  'FR-L2 AC11: no user, organisation, IP or session column'
);
select is(pg_temp.search(null, '''staffing'', p_workforce_size => ''50_249'''), 'ok', 'a search by workforce size');
select is((select filter_names from stats.partner_searches order by id desc limit 1), '{workforce_size}'::text[],
  'FR-L2 AC11: the workforce size is logged by name');
select pg_temp.hide('l2a11');

-- FR-K3 AC7, FR-L2 AC4: who can supply 100 welders for DE within 60 days -----------------------------------------------------------
select pg_temp.partner(:'own', 'staffing_company', 'k3a7-a', '{DE}', '{temporary}') as wa \gset
select pg_temp.partner(:'own', 'staffing_company', 'k3a7-b', '{DE}', '{temporary}') as wb \gset
select pg_temp.partner(:'own', 'staffing_company', 'k3a7-c', '{DE}', '{temporary}') as wc \gset
select pg_temp.partner(:'own', 'staffing_company', 'k3a7-d', '{DE}', '{temporary}') as wd \gset
select pg_temp.partner(:'own', 'staffing_company', 'k3a7-e', '{NL}', '{temporary}') as we \gset
select pg_temp.partner(:'own', 'staffing_company', 'k3a7-f', '{DE}', '{temporary}') as wf \gset
update public.organizations set review_status = 'pending_review', listed_at = null where id = :'wf';
select pg_temp.partner(:'own', 'staffing_company', 'k3a7-g', '{DE}', '{temporary}') as wg \gset
select pg_temp.partner(:'own', 'recruitment_company', 'k3a7-h', '{DE}') as wh \gset
select pg_temp.partner(:'own', 'staffing_company', 'k3a7-m', '{DE}', '{temporary}') as wm \gset
select pg_temp.partner(:'own', 'staffing_company', 'k3a7-p', '{DE}', '{temporary}') as wp \gset
select pg_temp.partner(:'own', 'staffing_company', 'k3a7-x', '{DE}', '{temporary}') as wx \gset
update public.organizations set moderation_state = 'hidden' where id = :'wx';
select pg_temp.listing(:'wa', 120, 40, 0, 5);
select pg_temp.listing(:'wb', 60, 30, 0, 3);
select pg_temp.listing(:'wc', 50, 10, 0, 2);
select pg_temp.listing(:'wd', 200, 50, 90, 2);
select pg_temp.listing(:'we', 500, 50, 0, 2);
select pg_temp.listing(:'wf', 300, 50, 0, 2);
select pg_temp.listing(:'wg', 200, 50, 0, 70);
select pg_temp.listing(:'wh', 150, 1, 0, 10);
select pg_temp.listing(:'wm', 60, 1, 0, 1, '7212', 'PH');
select pg_temp.listing(:'wm', 50, 1, 0, 1, '7212', 'NP');
select pg_temp.listing(:'wm', 900, 1, 0, 1, '7214', 'PH');
select pg_temp.listing(:'wp', 80, 30, 45, 1);
select pg_temp.listing(:'wx', 400, 30, 0, 1);
select pg_temp.partner(:'own', 'staffing_company', 'k3a7-y', '{DE}', '{temporary}') as wy \gset
update public.organizations set review_status = 'declined' where id = :'wy';
select pg_temp.listing(:'wy', 400, 30, 0, 1);

select is(pg_temp.workforce(:'bet', '''de'', ''7212'', 100, 60'), 'ok', 'a Professional employer admin searches');
select is(pg_temp.slugs(), 'k3a7-m,k3a7-a,k3a7-h,k3a7-b',
  'FR-K3 AC7: M, A and H cover 100 now (latest confirmed first), then B; C, D, E, F, G, P, the hidden X and the declined Y never');
select is(
  (select string_agg(format('%s=%s/%s', e ->> 'slug', e ->> 'supply', e ->> 'available_now'), ',' order by n)
   from jsonb_array_elements(pg_temp.result()) with ordinality r (e, n)),
  'k3a7-m=100–249/100–249,k3a7-a=100–249/100–249,k3a7-h=100–249/100–249,k3a7-b=100–249/50–99',
  'FR-K3 AC7: the supply (114, 200, 152, 120) and the workers available now (110, 120, 150, 60) come back as ranges'
);
select is(pg_temp.row_of('k3a7-a') -> 'listings',
  jsonb_build_array(jsonb_build_object('source_country', 'PH', 'source_country_name', 'Philippines', 'available', '100–249',
    'monthly_capacity', '25–49', 'available_from', current_date, 'confirmed_at', now() - interval '5 days')),
  'FR-K3 AC7: each row carries its listings with the date of last confirmation');
select is(pg_temp.row_of('k3a7-h') ->> 'organization_type', 'recruitment_company',
  'FR-K3 AC7: a listed recruitment company with a fitting listing is a partner too');
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.result() -> 0) k),
  'available_now,confirmed_at,display_name,id,listings,next_cursor,organization_type,slug,supply',
  'privacy: the columns are exactly the public ones'
);
select ok(pg_temp.result()::text !~ '(Legal k3a7|ana\.reyes|reminded_at|created_by|review_status|staffing_(partner|professional|enterprise)|free_staffing)',
  'privacy: no legal name, member, bookkeeping, review state or plan in the available workforce');
select is(pg_temp.workforce(:'bet', '''DE'', ''7212'', 95, 60'), 'ok', 'a listing available in 45 days');
select ok(pg_temp.slugs() ~ 'k3a7-p' and pg_temp.slugs() !~ 'k3a7-c',
  'FR-K3: P supplies 80 + 30 x 15 / 30 = 95 within 60 days; C supplies 70');
select is(pg_temp.workforce(:'bet', '''DE'', ''7212'', 100, 90'), 'ok', 'within 90 days');
select ok(pg_temp.slugs() ~ 'k3a7-d', 'FR-K3 AC7: D counts once its date lies within the timeframe');

update billing.subscriptions set plan_code = 'employer_enterprise' where organization_id = :'beta';
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (:'wb', 'staffing_enterprise', 'active', 'null'), (:'wm', 'free_staffing_company', 'active', 'null');
select is(pg_temp.workforce(:'bet', '''DE'', ''7212'', 100, 60'), 'ok', 'after the plans changed');
select is(pg_temp.slugs(), 'k3a7-m,k3a7-a,k3a7-h,k3a7-b', 'NFR-C8: the plans of the partners do not change the order');

-- Paging and the log ---------------------------------------------------------------------------------------------------------------
delete from stats.partner_searches;
select is(pg_temp.workforce(:'bet', '''DE'', ''7212'', 100, 60, p_limit => 3'), 'ok', 'a page of 3');
select is(pg_temp.slugs(), 'k3a7-m,k3a7-a,k3a7-h', 'the first page');
select ok((pg_temp.result() -> 2 ->> 'next_cursor') is not null and (pg_temp.result() -> 0 ->> 'next_cursor') is null,
  'the last row of a page with a next one carries the cursor');
select results_eq(
  'select kind, filter_names, destination_country, result_count from stats.partner_searches',
  $$values ('available_workforce'::text, '{destination,occupation,capacity,timeframe}'::text[], 'DE'::text, 3)$$,
  'KPI: one log row of kind available_workforce with the results of the first page'
);
select is(pg_temp.workforce(:'bet', format('''DE'', ''7212'', 100, 60, p_limit => 3, p_cursor => %L', pg_temp.result() -> 2 ->> 'next_cursor')),
  'ok', 'the next page');
select is(pg_temp.slugs() || '|' || coalesce(pg_temp.result() -> 0 ->> 'next_cursor', 'none'), 'k3a7-b|none',
  'the next page holds the rest, without a cursor');
select is((select count(*) from stats.partner_searches)::integer, 1, 'a next page is not logged again');
select is(pg_temp.workforce(:'bet', '''DE'', ''9999'', 100, 60'), 'ok', 'an occupation without listings');
select is((select result_count from stats.partner_searches order by id desc limit 1), 0, 'KPI: a search without results logs 0');

-- FR-K3 AC8: signed-in employers on a plan with the feature -------------------------------------------------------------------------
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.workforce(:'acm', '''DE'', ''7212'', 100, 60'), 'ok', 'FR-K3 AC8: an employer on employer_starter gets results');
select is(jsonb_array_length(pg_temp.result()), 4, 'FR-K3 AC8: the same four partners');
select is(pg_temp.workforce(:'mem', '''DE'', ''7212'', 100, 60'), 'ok', 'FR-K3: a member of a Professional employer searches too');
select is(pg_temp.workforce(:'fre', '''DE'', ''7212'', 100, 60'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|available_workforce_search',
  'FR-K3 AC8: free_employer is refused, naming the feature');
select is(pg_temp.workforce(:'wrk', '''DE'', ''7212'', 100, 60'), '42501|CHARA_FORBIDDEN|', 'FR-K3 AC8: a worker is refused');
select is(pg_temp.workforce(:'own', '''DE'', ''7212'', 100, 60'), '42501|CHARA_FORBIDDEN|',
  'FR-K3: a partner does not search other partners'' capacity');
select is(pg_temp.workforce(:'sus', '''DE'', ''7212'', 100, 60'), '42501|CHARA_FORBIDDEN|',
  'FR-K3: neither does the member of a suspended employer');
select matches(pg_temp.workforce(null, '''DE'', ''7212'', 100, 60'), '^42501\|permission denied for function search_available_workforce',
  'FR-K3 AC8: an anonymous caller is refused at the EXECUTE grant');
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(pg_temp.workforce(:'fre', '''DE'', ''7212'', 100, 60'), 'ok', 'while entitlements_enforced is false every employer may');

-- Validation and the rate limit --------------------------------------------------------------------------------------------------
select is(
  concat_ws(',',
    pg_temp.workforce(:'bet', 'null, ''7212'', 100, 60'), pg_temp.workforce(:'bet', '''DEU'', ''7212'', 100, 60'),
    pg_temp.workforce(:'bet', '''DE'', null, 100, 60'), pg_temp.workforce(:'bet', '''DE'', ''721'', 100, 60'),
    pg_temp.workforce(:'bet', '''DE'', ''7212'', null, 60'), pg_temp.workforce(:'bet', '''DE'', ''7212'', 0, 60'),
    pg_temp.workforce(:'bet', '''DE'', ''7212'', 100001, 60'), pg_temp.workforce(:'bet', '''DE'', ''7212'', 100, null'),
    pg_temp.workforce(:'bet', '''DE'', ''7212'', 100, 0'), pg_temp.workforce(:'bet', '''DE'', ''7212'', 100, 366'),
    pg_temp.workforce(:'bet', '''DE'', ''7212'', 100, 60, p_cursor => ''2|x|y''')),
  'P0001|CHARA_INVALID_INPUT|p_destination,P0001|CHARA_INVALID_INPUT|p_destination,P0001|CHARA_INVALID_INPUT|p_occupation,'
  'P0001|CHARA_INVALID_INPUT|p_occupation,P0001|CHARA_INVALID_INPUT|p_workers_needed,P0001|CHARA_INVALID_INPUT|p_workers_needed,'
  'P0001|CHARA_INVALID_INPUT|p_workers_needed,P0001|CHARA_INVALID_INPUT|p_within_days,P0001|CHARA_INVALID_INPUT|p_within_days,'
  'P0001|CHARA_INVALID_INPUT|p_within_days,P0001|CHARA_INVALID_INPUT|p_cursor',
  'every parameter is required, checked and named'
);
select is(pg_temp.workforce(:'bet', '''DE'', ''7212'', 100000, 365') || pg_temp.workforce(:'bet', '''DE'', ''7212'', 1, 1'), 'okok',
  'the bounds 1 and 100,000 workers, 1 and 365 days are accepted');
update private.settings set value = '1' where key = 'rate_limit_partner_search_max';
select is(pg_temp.workforce(:'bet', '''DE'', ''7212'', 100, 60'), 'ok', 'the first search of the window');
select is(pg_temp.run(:'bet', 'select * from public.search_available_workforce(''DE'', ''7212'', 100, 60)'), 'P0001|CHARA_RATE_LIMITED|',
  'risk scraping: the signed-in search limit of partner_search applies');
update private.settings set value = '60' where key = 'rate_limit_partner_search_max';
select pg_temp.hide('k3a7');

-- FR-K3 AC6: listings not confirmed within the staleness period are hidden until confirmed ------------------------------------------
select pg_temp.partner(:'own', 'staffing_company', 'k3a6-59', '{DE}', '{temporary}') as q59 \gset
select pg_temp.partner(:'own', 'staffing_company', 'k3a6-60', '{DE}', '{temporary}') as q60 \gset
select pg_temp.partner(:'own', 'staffing_company', 'k3a6-61', '{DE}', '{temporary}') as q61 \gset
select pg_temp.listing(:'q59', 100, 1, 0, 59);
select pg_temp.listing(:'q60', 100, 1, 0, 60);
select pg_temp.listing(:'q61', 100, 1, 0, 61) as listing61 \gset
select is(pg_temp.workforce(:'acm', '''DE'', ''7212'', 100, 1'), 'ok', 'the employer searches');
select is(pg_temp.slugs(), 'k3a6-59', 'FR-K3 AC6: only the listing confirmed 59 days ago');
select is(pg_temp.call_as(:'own', 'authenticated', format('select public.confirm_workforce_availability(%L)', :'listing61')), 'ok',
  'the owner confirms the 61-day listing');
select is(pg_temp.workforce(:'acm', '''DE'', ''7212'', 100, 1'), 'ok', 'the employer searches again');
select is(pg_temp.slugs(), 'k3a6-61,k3a6-59', 'FR-K3 AC6: the confirmed listing is returned, as the most recently confirmed');
update private.settings set value = '90' where key = 'workforce_listing_stale_days';
select is(pg_temp.workforce(:'acm', '''DE'', ''7212'', 100, 1'), 'ok', 'with the staleness setting at 90');
select is(pg_temp.slugs(), 'k3a6-61,k3a6-59,k3a6-60', 'FR-K3 AC6: the 60-day listing shows without a migration');
update private.settings set value = '60' where key = 'workforce_listing_stale_days';

-- Statistics ---------------------------------------------------------------------------------------------------------------------
select is(pg_temp.call_as(:'stf', 'authenticated', $$select set_config('t.result', (select to_jsonb(s) from public.admin_partner_search_stats('available_workforce', current_date, current_date) s)::text, true)$$),
  'ok', 'KPI: a Platform Administrator reads the available-workforce searches');
select is(pg_temp.result() ->> 'searches',
  (select case when count(*) >= private.stats_min_count() then count(*)::text end from stats.partner_searches
   where kind = 'available_workforce'),
  'KPI: every available-workforce search of the day is counted, shown from the privacy threshold on');
select is(pg_temp.call_as(:'stf', 'authenticated', $$select * from public.admin_partner_search_stats('staffing', current_date, current_date)$$),
  'ok', 'KPI: and the staffing directory searches');
select is(pg_temp.call_as(:'stf', 'authenticated', $$select * from public.admin_partner_search_stats('workers', current_date, current_date)$$),
  'P0001|CHARA_INVALID_INPUT|p_kind', 'an unknown kind is refused');
select is(pg_temp.call_as(:'acm', 'authenticated', $$select * from public.admin_partner_search_stats('available_workforce', current_date, current_date)$$),
  'P0001|CHARA_FORBIDDEN|', 'an employer cannot read the statistics');

select * from finish();
rollback;
