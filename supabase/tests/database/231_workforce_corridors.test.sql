begin;
select plan(41);

\ir organizations_fixture.inc

-- Workforce corridors v1 and the network view (brief sections 18 to 20; ARCHITECTURE.md section 9.4; OPEN_QUESTIONS.md L2,
-- D73): the snapshots stats.corridor_stats_mv and stats.network_stats_mv, their refresh, and list_corridors, get_corridor
-- and get_network with the threshold stats_min_count (k, 5) and the workforce ranges.

create function pg_temp.partner(
  p_type public.organization_type, p_slug text, p_based_in text, p_sources text[], p_serves text[], p_industries text[],
  p_services public.partner_service_type[] default '{}'
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug || ' Holdings Ltd', initcap(replace(p_slug, '-', ' ')), p_based_in);
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (v_id, current_setting('t.owner')::uuid, 'owner', now());
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  insert into public.organization_geographies (organization_id, scope, country_code)
  select v_id, 'sources_from'::public.geography_scope, c from unnest(p_sources) c
  union all select v_id, 'serves_market'::public.geography_scope, c from unnest(p_serves) c;
  insert into public.organization_industries (organization_id, industry_code) select v_id, c from unnest(p_industries) c;
  insert into public.organization_occupations (organization_id, occupation_id) values (v_id, '7212');
  insert into public.organization_service_types (organization_id, service) select v_id, s from unnest(p_services) s;
  return v_id;
end;
$$;

create function pg_temp.listing(p_org uuid, p_available integer, p_confirmed_days integer, p_source text default 'PH') returns void
language sql as $$
  insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
    available_from, confirmed_at)
  values (p_org, '7212', p_source, p_available, 10, current_date, now() - make_interval(days => p_confirmed_days))
$$;

-- p_sql as an anonymous visitor: the jsonb it answers, or {"error": "sqlstate|message"}.
create function pg_temp.anon(p_sql text) returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    execute p_sql into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    v_result := jsonb_build_object('error', v_state || '|' || v_message);
  end;
  reset role;
  return v_result;
end;
$$;

-- The same as a signed-in user (the owner of the fixtures, at aal1): the workforce range is for signed-in users only.
create function pg_temp.signed(p_sql text) returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  begin
    execute p_sql into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    v_result := jsonb_build_object('error', v_state || '|' || v_message);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

create function pg_temp.pairs(p_list jsonb) returns text
language sql as $$
  select coalesce(string_agg((c ->> 'source_country') || '>' || (c ->> 'destination_country'), ',' order by n), '')
  from jsonb_array_elements(p_list -> 'corridors') with ordinality r (c, n)
$$;

\set own '00000000-0000-0000-0000-000000231001'
select pg_temp.new_user(:'own', 'company');
update public.profiles set account_kind = intended_account_kind where id = :'own';
select set_config('t.owner', :'own', true);

-- Partners of earlier test data must not change the figures below: they are hidden for this transaction.
update public.organizations set moderation_state = 'hidden' where type <> 'employer';
select private.refresh_corridor_statistics();

-- The release switch and the grants ------------------------------------------------------------------------------------
select is(
  (select (value #>> '{}') || ':' || jsonb_typeof(value) from private.settings where key = 'release_corridors'), 'false:boolean',
  'release_corridors exists as a jsonb boolean and is off by default'
);
select is(
  (select value_type || ':' || release_feature from private.setting_rules where key = 'release_corridors'), 'boolean:partner_accounts',
  'the console edits the switch, which goes live under the legal documents of release 2a'
);
select is(
  pg_temp.anon($$select to_jsonb(array_agg(key || '=' || value)) from public.get_public_settings() where key = 'release_corridors'$$),
  '["release_corridors=false"]'::jsonb, 'an anonymous visitor reads the switch through get_public_settings'
);
select is(pg_temp.anon('select public.list_corridors()'), '{"error": "P0002|CHARA_NOT_FOUND"}'::jsonb,
  'while the switch is off list_corridors answers CHARA_NOT_FOUND');
select is(pg_temp.anon($$select public.get_corridor('PH', 'DE')$$), '{"error": "P0002|CHARA_NOT_FOUND"}'::jsonb,
  'and get_corridor too');
select is(pg_temp.anon($$select public.get_network('DE')$$), '{"error": "P0002|CHARA_NOT_FOUND"}'::jsonb,
  'and get_network too');

update private.settings set value = 'true' where key = 'release_corridors';

select ok(
  not has_table_privilege('anon', 'stats.corridor_stats_mv', 'select')
  and not has_table_privilege('authenticated', 'stats.corridor_stats_mv', 'select')
  and not has_table_privilege('anon', 'stats.network_stats_mv', 'select')
  and not has_table_privilege('authenticated', 'stats.network_stats_mv', 'select')
  and not has_table_privilege('service_role', 'stats.network_stats_mv', 'select'),
  'no API role reads the exact snapshots'
);
select is(
  pg_temp.anon('select to_jsonb(count(*)) from stats.corridor_stats_mv'), '{"error": "42501|permission denied for schema stats"}'::jsonb,
  'an anonymous visitor reading a snapshot is refused'
);
select ok(
  has_function_privilege('anon', 'public.list_corridors()', 'execute')
  and has_function_privilege('anon', 'public.get_corridor(text, text)', 'execute')
  and has_function_privilege('anon', 'public.get_network(text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_network(text)', 'execute')
  and not has_function_privilege('anon', 'private.refresh_corridor_statistics()', 'execute')
  and not has_function_privilege('authenticated', 'private.refresh_corridor_statistics()', 'execute')
  and not has_function_privilege('anon', 'private.corridor_country(text)', 'execute'),
  'the three readers are open to anon and authenticated; the refresh and the helper to no API role'
);
select is(
  (select schedule || ' ' || command from cron.job where jobname = 'refresh-corridor-statistics'),
  '*/30 * * * * select private.refresh_corridor_statistics()', 'the job refresh-corridor-statistics runs every 30 minutes'
);

-- The fixtures ----------------------------------------------------------------------------------------------------------
-- PH to DE: six recruitment companies (r1 also offers staffing, r1 also names industry F), five with a fresh listing of
-- 20 welders from PH and one with a stale listing of 1,000. PL to DE: five staffing companies based in PL, no listing. RO to
-- DE: three staffing companies. A recruitment company that sources from DE for DE (no corridor). Four that would add
-- 5,000 workers each but are not public: not listed, hidden, suspended, declined.
select pg_temp.partner('recruitment_company', 'cor-r' || n, 'PH', '{PH}', '{DE}',
  case when n = 1 then '{C,F}'::text[] else '{C}' end, case when n = 1 then '{staffing}'::public.partner_service_type[] else '{}' end)
from generate_series(1, 6) n;
select pg_temp.listing(o.id, 20, 3) from public.organizations o where o.slug in ('cor-r1', 'cor-r2', 'cor-r3', 'cor-r4', 'cor-r5');
select pg_temp.listing(o.id, 1000, 90) from public.organizations o where o.slug = 'cor-r6';
select pg_temp.partner('staffing_company', 'cor-s' || n, 'PL', '{PL}', '{DE}', '{C}') from generate_series(1, 5) n;
select pg_temp.partner('staffing_company', 'cor-t' || n, 'RO', '{RO}', '{DE}', '{C}') from generate_series(1, 3) n;
select pg_temp.partner('recruitment_company', 'cor-d1', 'DE', '{DE}', '{DE}', '{A}');
select pg_temp.partner('recruitment_company', 'cor-x' || n, 'PH', '{PH}', '{DE}', '{C}') from generate_series(1, 4) n;
select pg_temp.listing(o.id, 5000, 1) from public.organizations o where o.slug like 'cor-x%';
update public.organizations set listed_at = null, review_status = 'pending_review' where slug = 'cor-x1';
update public.organizations set moderation_state = 'hidden' where slug = 'cor-x2';
update public.organizations set status = 'suspended' where slug = 'cor-x3';
update public.organizations set review_status = 'declined' where slug = 'cor-x4';

select is(pg_temp.pairs(pg_temp.anon('select public.list_corridors()')), '',
  'nothing is listed before the next refresh: the pages read the snapshot');
select lives_ok('select private.refresh_corridor_statistics()', 'the refresh runs concurrently inside a transaction');

-- The exact snapshot -----------------------------------------------------------------------------------------------------
select is(
  (select string_agg(format('%s>%s r%s s%s p%s w%s/%s %s', source_country, destination_country, recruitment_partners,
     staffing_partners, partners, workers_available, workforce_partners, industries), '; ' order by source_country)
   from stats.corridor_stats_mv),
  'PH>DE r6 s1 p6 w100/5 {C,F}; PL>DE r0 s5 p5 w0/0 {C}; RO>DE r0 s3 p3 w0/0 {C}',
  'one row per corridor: the stale listing and the four partners that are not public are left out, and no corridor from DE to DE'
);

-- list_corridors -----------------------------------------------------------------------------------------------------------
select pg_temp.signed('select public.list_corridors()') as list \gset
select pg_temp.anon('select public.list_corridors()') as visitor_list \gset
select is(pg_temp.pairs(:'list'), 'PH>DE,PL>DE', 'the index lists the corridors with at least k partners, the most partners first');
select is(
  (:'list'::jsonb -> 'corridors' -> 0) - 'source_name' - 'destination_name',
  '{"source_country": "PH", "destination_country": "DE", "recruitment_partners": 6, "staffing_partners": null, "workers_available": "100–249"}'::jsonb,
  'a count below k is null (fewer than k), and a signed-in user gets the workforce as a range, never the number'
);
select is(
  (:'visitor_list'::jsonb -> 'corridors' -> 0) - 'source_name' - 'destination_name',
  '{"source_country": "PH", "destination_country": "DE", "recruitment_partners": 6, "staffing_partners": null, "workers_available": null}'::jsonb,
  'P26: a visitor gets the same corridors and counts but no workforce range'
);
select is(
  (:'visitor_list'::jsonb ->> 'workforce_requires_sign_in') || ',' || (:'list'::jsonb ->> 'workforce_requires_sign_in'), 'true,false',
  'P26: the flag tells the page to ask a visitor to sign in, and not a signed-in user'
);
select is(pg_temp.pairs(:'visitor_list'), pg_temp.pairs(:'list'), 'P26: the index itself is the same for both');
select is((:'list'::jsonb -> 'corridors' -> 0 ->> 'source_name') || ' > ' || (:'list'::jsonb -> 'corridors' -> 0 ->> 'destination_name'),
  'Philippines > Germany', 'with the names of the countries');
select is(
  (:'list'::jsonb -> 'corridors' -> 1) - 'source_name' - 'destination_name',
  '{"source_country": "PL", "destination_country": "DE", "recruitment_partners": null, "staffing_partners": 5, "workers_available": null}'::jsonb,
  'no workforce is shown when fewer than k partners have a fresh listing behind it'
);
select is((:'list'::jsonb ->> 'min_count')::integer, 5, 'the threshold is returned for the "fewer than" text');
select ok(not (:'list'::jsonb ? 'partners') and not (:'list'::jsonb -> 'corridors' -> 0 ? 'partners'),
  'the partner total is never returned, so it cannot give back a hidden count');
select ok(:'list'::text !~* '(cor-|legal |holdings|[0-9a-f]{8}-[0-9a-f]{4})', 'no organisation slug, name or id leaves the database');

-- get_corridor ---------------------------------------------------------------------------------------------------------------
select is(
  pg_temp.signed($$select public.get_corridor('ph', 'de')$$) - 'refreshed_at',
  '{"source_country": "PH", "source_name": "Philippines", "destination_country": "DE", "destination_name": "Germany", "listed": true,
    "min_count": 5, "workforce_requires_sign_in": false, "recruitment_partners": 6, "staffing_partners": null, "workers_available": "100–249",
    "industries": [{"code": "C", "name": "Manufacturing"}, {"code": "F", "name": "Construction"}]}'::jsonb,
  'a listed corridor in any case of the codes: counts, the workforce range and its industries by most partners'
);
select is(
  pg_temp.anon($$select public.get_corridor('ph', 'de')$$) - 'refreshed_at' - 'source_name' - 'destination_name' - 'industries',
  '{"source_country": "PH", "destination_country": "DE", "listed": true, "min_count": 5, "workforce_requires_sign_in": true,
    "recruitment_partners": 6, "staffing_partners": null, "workers_available": null}'::jsonb,
  'P26: a visitor reads the counts of the corridor but no workforce range'
);
select is(jsonb_array_length(pg_temp.anon($$select public.get_corridor('ph', 'de')$$) -> 'industries'), 2,
  'P26: and its industries');
select is(
  pg_temp.anon($$select public.get_corridor('RO', 'DE')$$) - 'refreshed_at' - 'source_name' - 'destination_name',
  '{"source_country": "RO", "destination_country": "DE", "listed": false, "min_count": 5, "workforce_requires_sign_in": true,
    "recruitment_partners": null,
    "staffing_partners": null, "workers_available": null, "industries": []}'::jsonb,
  'a corridor below k answers the suppressed form, so its link does not break'
);
select is(
  pg_temp.anon($$select public.get_corridor('NZ', 'DE')$$) ->> 'listed', 'false', 'a corridor without any partner reads the same way'
);
select is(pg_temp.anon($$select public.get_corridor('DE', 'DE')$$), '{"error": "P0002|CHARA_NOT_FOUND"}'::jsonb,
  'the same country twice is not a corridor');
select is(pg_temp.anon($$select public.get_corridor('ZZ', 'DE')$$), '{"error": "P0002|CHARA_NOT_FOUND"}'::jsonb,
  'nor a code that is not a country');
select is(pg_temp.anon($$select public.get_corridor('PHL', 'DE')$$), '{"error": "P0002|CHARA_NOT_FOUND"}'::jsonb,
  'nor three letters');

-- get_network ----------------------------------------------------------------------------------------------------------------
select pg_temp.signed($$select public.get_network('de')$$) as network \gset
select pg_temp.anon($$select public.get_network('de')$$) as visitor_network \gset
select is(
  (select string_agg(i ->> 'code', ',') from jsonb_array_elements(:'network'::jsonb -> 'industries') i), 'C',
  'only industries with at least k recruitment or staffing partners: F and A have one partner each'
);
select is(
  (:'network'::jsonb -> 'industries' -> 0) - 'occupations',
  '{"code": "C", "name": "Manufacturing", "recruitment_partners": 6, "staffing_partners": 9, "workers_available": "100–249"}'::jsonb,
  'the industry: recruitment partners, staffing partners (staffing companies and r1, which offers staffing), the workforce range'
);
select is(
  :'network'::jsonb -> 'industries' -> 0 -> 'occupations' -> 0,
  '{"code": "7212", "label": "Welders and flame cutters", "recruitment_partners": 6, "staffing_partners": 9, "workers_available": "100–249",
    "recruitment_sources": [{"code": "PH", "name": "Philippines", "partners": 6}],
    "staffing_bases": [{"code": "PL", "name": "Poland", "partners": 5}]}'::jsonb,
  'the occupation: recruitment partners by source country and staffing partners by country of base, each country below k left out'
);
select is(
  (:'visitor_network'::jsonb ->> 'workforce_requires_sign_in') || ','
    || coalesce(:'visitor_network'::jsonb -> 'industries' -> 0 ->> 'workers_available', 'null') || ','
    || coalesce(:'visitor_network'::jsonb -> 'industries' -> 0 -> 'occupations' -> 0 ->> 'workers_available', 'null') || ','
    || (:'visitor_network'::jsonb -> 'industries' -> 0 ->> 'recruitment_partners'),
  'true,null,null,6', 'P26: a visitor reads the network counts but no workforce range of an industry or an occupation'
);
select is(
  pg_temp.anon($$select public.get_network('NZ')$$) -> 'industries', '[]'::jsonb, 'a destination without partners has no industry'
);
select is(pg_temp.anon($$select public.get_network('Germany')$$), '{"error": "P0002|CHARA_NOT_FOUND"}'::jsonb,
  'a destination that is not a country code is not found');

-- A higher threshold hides more; one below 5 is read as 5 -------------------------------------------------------------------
update private.settings set value = '6' where key = 'stats_min_count';
select is(pg_temp.pairs(pg_temp.anon('select public.list_corridors()')), 'PH>DE', 'with k 6 the corridor of five partners leaves the index');
select is(pg_temp.signed($$select public.get_corridor('PH', 'DE')$$) ->> 'workers_available', null,
  'and five partners with listings no longer show a workforce range');
update private.settings set value = '2' where key = 'stats_min_count';
select is(pg_temp.pairs(pg_temp.anon('select public.list_corridors()')), 'PH>DE,PL>DE', 'a threshold below 5 is read as 5');

-- A partner that leaves the directory leaves the corridor at the next refresh ------------------------------------------------
update public.organizations set moderation_state = 'hidden' where slug = 'cor-s5';
select private.refresh_corridor_statistics();
select is(pg_temp.pairs(pg_temp.anon('select public.list_corridors()')), 'PH>DE', 'a hidden staffing company takes PL to DE below k');

select * from finish();
rollback;
