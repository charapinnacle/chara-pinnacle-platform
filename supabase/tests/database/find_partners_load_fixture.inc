-- The Find Partners load (V78, NFR-P3): 5,000 listed partner organisations with the geographies, occupations, offer and
-- availability listings of a realistic network, plus unlisted and hidden partners that the searches must skip, and the
-- timing helper. Included with \ir by 155_find_partners_load.test.sql (the light CI check) and read into the psql input
-- of scripts/load/find-partners.mjs (the runbook check with query plans, docs/perf/release-2a.md). Everything it writes
-- is rolled back with the transaction that runs it. setseed makes every run seed the same network.

-- The labour-migration markets: where partners are based and source workers, where they recruit for, and the
-- occupations most of them list (each also lists a few others from the whole ISCO-08 list).
create function pg_temp.load_pick(p_list text[], p_count integer) returns text[]
language sql volatile as $$
  select coalesce(array_agg(code), '{}')
  from (select distinct code from (select p_list[1 + floor(random() * cardinality(p_list))::integer] as code
                                   from generate_series(1, p_count)) picks) chosen
$$;

create function pg_temp.seed_find_partners(p_listed integer, p_unlisted integer) returns void
language plpgsql as $$
declare
  v_owner uuid := gen_random_uuid();
  v_sources text[] := '{PH,PH,PH,IN,IN,NP,NP,VN,ID,BD,LK,PK,KE,NG,UA,PL,RO,MX,UZ,KG,MA,EG,GH,ET,MM}';
  v_markets text[] := '{DE,DE,DE,DE,AE,AE,SA,SA,QA,KW,GB,NL,PL,CA,AU,JP,IT,ES,FR,AT,CH,SE,NO,BE,IE,CZ,SG,HK,MY,IL}';
  v_popular text[] := '{7212,7212,7126,5322,5322,2221,2221,8322,7112,7115,7411,9313,5120,5131,9112,8332,7231,6111,9211,7233,3221,5311,7214,7127,9321,7522,5141,4222,2512,3115,8211,7213,9333,5151,9412,8343,7132,7111,7122,7124,7421,3256,5321}';
  v_all text[] := (select array_agg(code order by code) from public.occupations);
  v_languages text[] := '{en,en,en,ar,tl,hi,ne,vi,id,bn,si,ur,sw,uk,pl,ro,es,de,fr,ru,zh,ja}';
  v_industries text[] := (select array_agg(code order by code) from public.industries);
  v_staffing text[] := '{temporary,contract,project}';
begin
  perform setseed(0.78);
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (v_owner, 'load-owner@load.test', now(), jsonb_build_object('intended_account_kind', 'company'));
  update public.profiles set account_kind = 'company' where id = v_owner;

  create temp table load_partners on commit drop as
  select
    gen_random_uuid() as id,
    n,
    n <= p_listed as listed,
    case when n % 10 < 7 then 'recruitment_company' else 'staffing_company' end::public.organization_type as type,
    (pg_temp.load_pick(v_sources, 1))[1] as based_in,
    pg_temp.load_pick(v_sources, 1 + floor(random() * 4)::integer) as sources,
    pg_temp.load_pick(v_markets, 1 + floor(random() * 6)::integer) as markets,
    pg_temp.load_pick(v_popular, 2 + floor(random() * 10)::integer)
      || pg_temp.load_pick(v_all, 1 + floor(random() * 4)::integer) as occupations,
    pg_temp.load_pick(v_industries, 1 + floor(random() * 3)::integer) as industries,
    pg_temp.load_pick(v_languages, 1 + floor(random() * 4)::integer) as languages,
    pg_temp.load_pick(v_staffing, 1 + floor(random() * 3)::integer) as staffing_types,
    random() < 0.2 as also_staffing,
    (array['local', 'international', 'both'])[1 + floor(random() * 3)::integer]::public.recruitment_preference as recruitment_type,
    (array['1_49', '50_249', '250_999', '1000_plus'])[1 + floor(random() * 4)::integer]::public.workforce_size_band as size_band,
    now() - random() * interval '180 days' as profile_updated_at
  from generate_series(1, p_listed + p_unlisted) n;

  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, recruitment_type,
    workforce_size_band)
  select id, type, 'load-partner-' || n, 'Load Partner ' || n || ' Holdings Ltd', 'Load Partner ' || lpad(n::text, 5, '0'),
    based_in, recruitment_type, size_band
  from load_partners;
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  select id, v_owner, 'owner', now() from load_partners;
  insert into public.organization_geographies (organization_id, scope, country_code)
  select p.id, 'sources_from', c from load_partners p, unnest(p.sources || p.based_in) c group by p.id, c;
  insert into public.organization_geographies (organization_id, scope, country_code)
  select p.id, 'serves_market', c from load_partners p, unnest(p.markets) c;
  insert into public.organization_occupations (organization_id, occupation_id)
  select p.id, o from load_partners p, unnest(p.occupations) o group by p.id, o;
  insert into public.organization_industries (organization_id, industry_code)
  select p.id, i from load_partners p, unnest(p.industries) i;
  insert into public.organization_languages (organization_id, language_code)
  select p.id, l from load_partners p, unnest(p.languages) l;
  insert into public.organization_service_types (organization_id, service)
  select p.id, s::public.partner_service_type from load_partners p, unnest(p.staffing_types) s
  where p.type = 'staffing_company' or p.also_staffing;
  insert into public.organization_service_types (organization_id, service)
  select p.id, 'staffing' from load_partners p where p.type = 'recruitment_company' and p.also_staffing;

  -- Six in ten partners keep availability listings: one to four, of their own occupations and source countries,
  -- confirmed in the last 90 days, so about a third of them are stale (workforce_listing_stale_days is 60).
  insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
    available_from, confirmed_at)
  select distinct on (p.id, o.code, s.code) p.id, o.code, s.code, 5 + floor(random() * 300)::integer,
    1 + floor(random() * 80)::integer, current_date + floor(random() * 120)::integer, now() - random() * interval '90 days'
  from load_partners p
  cross join lateral (select g.n from generate_series(1, 1 + floor(random() * 4)::integer) g (n)) k
  cross join lateral (select p.occupations[1 + floor(random() * cardinality(p.occupations))::integer] as code, k.n) o
  cross join lateral (select (p.sources || p.based_in)[1 + floor(random() * (cardinality(p.sources) + 1))::integer] as code, k.n) s
  where p.n % 10 < 6;

  -- The listed ones, then the unlisted ones in every state a search skips, and one in a hundred listed hidden by moderation.
  update public.organizations o set review_status = 'listed', listed_at = p.profile_updated_at - interval '1 day',
    submitted_at = p.profile_updated_at - interval '2 days', workforce_profile_updated_at = p.profile_updated_at
  from load_partners p where p.id = o.id and p.listed;
  update public.organizations o
  set review_status = (array['onboarding', 'pending_review', 'info_requested', 'declined'])[1 + p.n % 4]::public.partner_review_status,
    info_step = case when p.n % 4 = 2 then 'company' end,
    submitted_at = case when p.n % 4 > 0 then now() - interval '1 day' end
  from load_partners p where p.id = o.id and not p.listed;
  update public.organizations o set moderation_state = 'hidden' from load_partners p where p.id = o.id and p.listed and p.n % 100 = 0;

  -- Planner statistics for every table the searches read: a freshly reset database has none, and the plans (and the
  -- plan-shape checks of 155) must be those of a network of this size. The analyze rolls back with the transaction.
  analyze public.organizations, public.organization_geographies, public.organization_occupations,
    public.organization_industries, public.organization_languages, public.organization_service_types,
    public.workforce_availability, public.occupations, public.countries;
end;
$$;

-- The employer that runs the available-workforce search and the advanced filters (signed in, active, a member).
create function pg_temp.load_employer() returns uuid
language plpgsql as $$
declare
  v_user uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (v_user, 'load-employer@load.test', now(), jsonb_build_object('intended_account_kind', 'company'));
  update public.profiles set account_kind = 'company' where id = v_user;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_org, 'employer', 'load-employer', 'Load Employer GmbH', 'Load Employer', 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_org, v_user, 'owner', now());
  return v_user;
end;
$$;

-- The typical searches of the two directories and of the available workforce, in the order they are run. A visitor
-- searches the directories (anonymous, with a visitor key); the advanced filters and the available workforce need a
-- signed-in employer.
create temp table load_cases (
  position integer primary key,
  label text not null unique,
  as_employer boolean not null,
  sql text not null
);

create temp table load_results (
  label text primary key,
  runs integer not null,
  rows_returned integer not null,
  p50_ms numeric not null,
  p95_ms numeric not null,
  max_ms numeric not null
);

-- Sets the claims and the API role of a search: the employer when given, an anonymous visitor otherwise. The caller resets
-- them inline: the API roles cannot call a pg_temp function.
create function pg_temp.load_act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text end,
    true);
  execute format('set local role %I', case when p_user is null then 'anon' else 'authenticated' end);
end;
$$;

-- The cases, after the seed. The second page of a search follows the cursor its first page gives.
create function pg_temp.prepare_find_partners_cases(p_employer uuid) returns void
language plpgsql as $$
declare
  v_key text := repeat('a', 64);
  v_cursor text;
begin
  delete from private.rate_limit_hits;
  perform pg_temp.load_act_as(null);
  select s.next_cursor into v_cursor
  from public.search_partners('recruitment', p_destination => 'DE', p_key => v_key) s where s.next_cursor is not null;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  insert into load_cases (position, label, as_employer, sql) values
  (1, 'recruitment: no filter', false,
    format('select * from public.search_partners(%L, p_key => %L)', 'recruitment', v_key)),
  (2, 'recruitment: destination', false,
    format('select * from public.search_partners(%L, p_destination => %L, p_key => %L)', 'recruitment', 'DE', v_key)),
  (3, 'recruitment: destination, occupation', false,
    format('select * from public.search_partners(%L, p_destination => %L, p_occupation => %L, p_key => %L)',
      'recruitment', 'DE', '7212', v_key)),
  (4, 'recruitment: five filters', false,
    format('select * from public.search_partners(%L, p_destination => %L, p_occupation => %L, p_based_in => %L,
      p_language => %L, p_recruitment_type => %L, p_key => %L)', 'recruitment', 'AE', '5322', 'PH', 'en', 'international', v_key)),
  (5, 'recruitment: rare destination and occupation', false,
    format('select * from public.search_partners(%L, p_destination => %L, p_occupation => %L, p_key => %L)',
      'recruitment', 'JP', '2221', v_key)),
  (6, 'recruitment: destination, second page', false,
    format('select * from public.search_partners(%L, p_destination => %L, p_cursor => %L, p_key => %L)',
      'recruitment', 'DE', v_cursor, v_key)),
  (7, 'recruitment: advanced (capacity, timeframe, two sources)', true,
    format('select * from public.search_partners(%L, p_destination => %L, p_occupation => %L, p_sources_from => %L,
      p_capacity => 20, p_within_days => 60)', 'recruitment', 'DE', '7212', '{PH,IN}')),
  (8, 'staffing: no filter', false,
    format('select * from public.search_partners(%L, p_key => %L)', 'staffing', v_key)),
  (9, 'staffing: destination, staffing type', false,
    format('select * from public.search_partners(%L, p_destination => %L, p_staffing_types => %L, p_key => %L)',
      'staffing', 'DE', '{temporary}', v_key)),
  (10, 'staffing: four filters', false,
    format('select * from public.search_partners(%L, p_destination => %L, p_occupation => %L, p_industry => %L,
      p_workforce_size => %L, p_key => %L)', 'staffing', 'NL', '8332', 'H', '50_249', v_key)),
  (11, 'available workforce: 50 welders, Germany, 60 days', true,
    format('select * from public.search_available_workforce(%L, %L, 50, 60)', 'DE', '7212')),
  (12, 'available workforce: 200 care workers, UAE, 90 days', true,
    format('select * from public.search_available_workforce(%L, %L, 200, 90)', 'AE', '5322'));
end;
$$;

-- Runs every case once untimed (a warm-up, so the first plan and the cold cache are not measured) and then p_runs times,
-- and records the server time of each timed run in load_results. The rate-limit window is emptied before each run, so
-- the limit never stops the load (it is not what is measured).
create function pg_temp.run_find_partners_load(p_employer uuid, p_runs integer) returns void
language plpgsql as $$
declare
  v_case record;
  v_times numeric[];
  v_started timestamptz;
  v_rows integer;
begin
  for v_case in select * from load_cases order by position loop
    v_times := '{}';
    for i in 0..p_runs loop
      delete from private.rate_limit_hits;
      perform pg_temp.load_act_as(case when v_case.as_employer then p_employer end);
      v_started := clock_timestamp();
      execute format('select count(*) from (%s) r', v_case.sql) into v_rows;
      if i > 0 then
        v_times := v_times || (extract(epoch from clock_timestamp() - v_started) * 1000)::numeric;
      end if;
      reset role;
      perform set_config('request.jwt.claims', '', true);
    end loop;
    insert into load_results
    select v_case.label, p_runs, v_rows,
      round(percentile_cont(0.5) within group (order by t)::numeric, 1),
      round(percentile_cont(0.95) within group (order by t)::numeric, 1),
      round(max(t), 1)
    from unnest(v_times) t;
  end loop;
end;
$$;
