-- The Find Workers load (V80, NFR-P3): 100,000 visible worker cards among 110,000 passports, searched by two employers,
-- and the timing helper. Included with \ir by 220_find_workers_load.test.sql (the light CI check) and read into the
-- psql input of scripts/load/find-workers.mjs (the runbook check with query plans, docs/perf/release-2c.md). Everything
-- it writes is rolled back with the transaction that runs it. setseed makes every run seed the same passports.

create function pg_temp.workers_pick(p_list text[]) returns text
language sql volatile as $$
  select p_list[1 + floor(random() * cardinality(p_list))::integer]
$$;

-- p_visible listed cards and p_hidden passports that must never be found (eight in ten not opted in, one in ten of a
-- suspended account, one in ten with a deletion requested). Each passport has an occupation of 29 common ISCO-08 unit
-- groups (welders, care workers and drivers weighted up), a headline, a current country of 25 source countries, two to
-- six skills of 40, one to three languages with a CEFR level, one to four preferred countries of 30, an unexpired work
-- authorisation for one in five, and for half of them the preferred industries and employment types on the card; the
-- cards were last changed over the past year. The two measured searchers are employers based in Germany: one on
-- Professional (the advanced filters) with 100 saved cards and 300 contact requests, one on Starter.
create function pg_temp.seed_find_workers(p_visible integer, p_hidden integer) returns void
language plpgsql as $$
declare
  v_owner_pro uuid := '00000000-0000-0000-0000-0000000b8001';
  v_owner_basic uuid := '00000000-0000-0000-0000-0000000b8002';
  v_pro uuid := '00000000-0000-0000-0000-0000000b8011';
  v_basic uuid := '00000000-0000-0000-0000-0000000b8012';
  v_sources text[] := '{PH,PH,PH,IN,IN,NP,NP,VN,ID,BD,LK,PK,KE,NG,NG,UA,PL,RO,MX,UZ,KG,MA,EG,GH,ET}';
  v_markets text[] := '{DE,DE,DE,DE,PL,PL,NL,AE,AE,SA,SA,QA,KW,GB,GB,AT,CA,AU,JP,IT,ES,FR,SE,NO,BE,IE,CZ,SG,MY,IL}';
  v_occupations text[] := '{7212,7212,7212,7126,5322,5322,5322,2221,8322,8332,8332,7112,7115,7411,9313,5120,5131,7231,6111,9211,7233,3221,5311,7214,7127,9321,7522,5141,7213,7111,7122,7124,4222}';
  v_headlines text[] := '{"Experienced welder for shipyards","Care worker for the elderly","Truck driver with a C+E licence","Cook in hotel kitchens","Electrician for building sites","Plumber and pipe fitter","Nurse with ICU experience","Carpenter and joiner","Farm worker for the harvest","Construction labourer","Motor mechanic","Waiter in restaurants","Bricklayer and plasterer","Machinery mechanic","Hand packer in warehouses"}';
  v_skills text[] := '{MIG welding,TIG welding,MAG welding,Stick welding,Pipe welding,Blueprint reading,Forklift,First aid,Elderly care,Dementia care,Patient hygiene,Medication rounds,Food safety,Pastry,Grill cooking,Wiring,Solar panels,Conduit bending,Pipe fitting,Heating systems,Bricklaying,Plastering,Formwork,Scaffolding,Tiling,Joinery,Roofing,Driving C+E,ADR,Tachograph,Engine repair,Diagnostics,Hydraulics,Harvesting,Greenhouse work,Packing,Inventory,Customer service,Bartending,Housekeeping}';
  v_languages text[] := '{en,en,en,en,de,de,ar,ar,fr,ru,pl,hi,tl,ne,uk,es}';
  v_levels public.cefr_level[] := '{A1,A2,B1,B1,B2,B2,C1,C2}';
  v_industries text[] := '{C,C,F,F,Q,Q,I,H,A,G,N}';
  v_types text[] := '{full_time,full_time,full_time,part_time,contract,temporary,seasonal}';
begin
  perform setseed(0.80);

  create temp table load_workers on commit drop as
  select gen_random_uuid() as id, gen_random_uuid() as card_id, n,
    case
      when n <= p_visible then 'visible'
      when n <= p_visible + p_hidden * 8 / 10 then 'not_opted_in'
      when n <= p_visible + p_hidden * 9 / 10 then 'suspended'
      else 'deleting'
    end as kind,
    pg_temp.workers_pick(v_occupations) as occupation,
    pg_temp.workers_pick(v_headlines) as headline,
    pg_temp.workers_pick(v_sources) as country,
    floor(random() * 26)::smallint as years,
    (array['now', 'now', 'from_date', 'unavailable'])[1 + floor(random() * 4)::integer]::public.worker_availability as availability,
    current_date + floor(random() * 240)::integer as from_date,
    random() < 0.5 as show_industries,
    now() - make_interval(secs => random() * 365 * 86400) as updated_at
  from generate_series(1, p_visible + p_hidden) n;
  analyze load_workers;

  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  select id, 'load-worker-' || n || '@load.test', now(), jsonb_build_object('intended_account_kind', 'worker')
  from load_workers;
  analyze public.profiles;
  update public.profiles p set account_kind = 'worker',
    status = case when w.kind = 'suspended' then 'suspended' else 'active' end::public.profile_status,
    deleted_at = case when w.kind = 'deleting' then now() end
  from load_workers w where p.id = w.id;

  insert into public.worker_profiles (user_id, card_id, first_name, last_name, headline, current_country, occupation_id,
    years_experience, availability, available_from, searchable, card_show_industries, updated_at)
  select id, card_id, 'Loadfirst', 'Loadlast', headline, country, occupation, years, availability,
    case when availability = 'from_date' then from_date end, kind <> 'not_opted_in', show_industries, updated_at
  from load_workers;

  -- The per-row triggers of the lists (the size limits, which the seed keeps, and the stamp of the card's change time,
  -- which the seed sets) would add minutes to the seed; they are off until the transaction is rolled back.
  alter table public.worker_skills disable trigger user;
  alter table public.worker_languages disable trigger user;
  alter table public.worker_preferred_countries disable trigger user;
  alter table public.worker_work_authorizations disable trigger user;
  alter table public.worker_preferred_industries disable trigger user;
  alter table public.worker_preferred_employment_types disable trigger user;

  insert into public.worker_skills (worker_user_id, skill)
  select distinct on (w.id, s) w.id, s
  from load_workers w cross join lateral (
    select pg_temp.workers_pick(v_skills) as s, k from generate_series(1, 2 + (w.n * 7) % 5) k) x;
  insert into public.worker_languages (worker_user_id, language_code, cefr_level)
  select distinct on (w.id, l) w.id, l, v_levels[1 + floor(random() * cardinality(v_levels))::integer]
  from load_workers w cross join lateral (
    select pg_temp.workers_pick(v_languages) as l, k from generate_series(1, 1 + (w.n * 11) % 3) k) x;
  insert into public.worker_preferred_countries (worker_user_id, country_code)
  select distinct on (w.id, c) w.id, c
  from load_workers w cross join lateral (
    select pg_temp.workers_pick(v_markets) as c, k from generate_series(1, 1 + (w.n * 13) % 4) k) x;
  insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on)
  select id, pg_temp.workers_pick(v_markets), current_date + 400 from load_workers where n % 5 = 0;
  insert into public.worker_preferred_industries (worker_user_id, industry_code)
  select distinct on (w.id, i) w.id, i
  from load_workers w cross join lateral (
    select pg_temp.workers_pick(v_industries) as i, k from generate_series(1, 1 + w.n % 2) k) x;
  insert into public.worker_preferred_employment_types (worker_user_id, employment_type)
  select distinct on (w.id, t) w.id, t::public.employment_type
  from load_workers w cross join lateral (
    select pg_temp.workers_pick(v_types) as t, k from generate_series(1, 1 + w.n % 2) k) x;

  -- Two rules of the kind the platform holds, so the cards of Nepal and Ethiopia are shaped.
  insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref) values
    ('NP', null, 'licensed_partner_required', 'Hiring from Nepal needs a licensed recruitment partner.', 'LOAD-V80'),
    ('ET', 'DE', 'blocked', 'Direct hiring from Ethiopia to Germany is not allowed.', 'LOAD-V80');

  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (v_owner_pro, 'workers-pro@load.test', now(), jsonb_build_object('intended_account_kind', 'company')),
    (v_owner_basic, 'workers-basic@load.test', now(), jsonb_build_object('intended_account_kind', 'company'));
  update public.profiles set account_kind = 'company' where id in (v_owner_pro, v_owner_basic);
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country) values
    (v_pro, 'employer', 'workers-pro', 'Workers Pro GmbH', 'Workers Pro', 'DE'),
    (v_basic, 'employer', 'workers-basic', 'Workers Basic GmbH', 'Workers Basic', 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values
    (v_pro, v_owner_pro, 'owner', now()), (v_basic, v_owner_basic, 'owner', now());
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values
    (v_pro, 'employer_professional', 'active', 'null'), (v_basic, 'employer_starter', 'active', 'null');

  insert into public.saved_worker_cards (organization_id, card_id, saved_by)
  select v_pro, card_id, v_owner_pro from load_workers where kind = 'visible' and n % 997 = 0 limit 100;
  insert into public.contact_requests (organization_id, worker_user_id, card_id, sent_by, message, destination_country, status,
    created_at, expires_at, responded_at)
  select v_pro, id, card_id, v_owner_pro, 'We are hiring in Hamburg and would like to talk to you.', 'DE',
    case when n % 3 = 0 then 'accepted' else 'pending' end::public.contact_request_status,
    now() - interval '3 days', now() + interval '27 days', case when n % 3 = 0 then now() - interval '2 days' end
  from load_workers where kind = 'visible' and n % 331 = 0 limit 300;

  -- Planner statistics for every table the search reads (see find_partners_load_fixture.inc); rolled back with the rest.
  analyze public.worker_profiles, public.profiles, public.worker_skills, public.worker_languages, public.worker_preferred_countries,
    public.worker_work_authorizations, public.worker_preferred_industries, public.worker_preferred_employment_types,
    public.saved_worker_cards, public.contact_requests, public.organizations, billing.subscriptions;
end;
$$;

create temp table load_cases (
  position integer primary key,
  label text not null unique,
  caller uuid not null,
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

-- Sets the claims and the API role of the calling member; the caller resets them inline (the API roles cannot call a
-- pg_temp function).
create function pg_temp.workers_act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
end;
$$;

-- The calls of the Find Workers page, after the seed: the access check, a search without a filter, a keyword, the basic
-- filters, a deep page through the cursor, the advanced filters of the Professional employer, a narrow search that
-- answers few, the requests and the saved cards the page reads with the results.
create function pg_temp.prepare_find_workers_cases() returns void
language plpgsql as $$
declare
  v_pro_user uuid := '00000000-0000-0000-0000-0000000b8001';
  v_basic_user uuid := '00000000-0000-0000-0000-0000000b8002';
  v_pro text := '00000000-0000-0000-0000-0000000b8011';
  v_basic text := '00000000-0000-0000-0000-0000000b8012';
  v_search text := 'select * from public.search_workers(%L, %L::jsonb%s)';
  v_deep text;
  v_cards text;
begin
  -- The 2,000th card in the order of a search without a keyword (score 0, newest change first, card id), as the cursor
  -- of the 100th page of 20 encodes it.
  select encode(convert_to('0|' || (c.updated_at at time zone 'UTC')::text || '|' || c.card_id, 'UTF8'), 'hex')
  into v_deep
  from public.worker_profiles c join public.profiles pr on pr.id = c.user_id
  where c.searchable and pr.status = 'active' and pr.deleted_at is null
  order by c.updated_at desc, c.card_id offset 1999 limit 1;
  select array_agg(card_id)::text into v_cards
  from (select r.card_id from public.contact_requests r where r.organization_id = v_pro::uuid order by r.card_id limit 20) x;

  insert into load_cases (position, label, caller, sql) values
  (1, 'access check', v_basic_user, format('select * from public.worker_search_access(%L)', v_basic)),
  (2, 'basic: first page', v_basic_user, format(v_search, v_basic, '{}', '')),
  (3, 'basic: keyword "welder"', v_basic_user, format(v_search, v_basic, '{"q": "welder"}', '')),
  (4, 'basic: keyword "dementia"', v_basic_user, format(v_search, v_basic, '{"q": "dementia"}', '')),
  (5, 'basic: occupation, destination', v_basic_user, format(v_search, v_basic, '{"occupation": "7212", "destination": "DE"}', '')),
  (6, 'basic: lives in, available now', v_basic_user,
    format(v_search, v_basic, '{"current_country": "PH", "availability": "now"}', '')),
  (7, 'basic: available by, page of 50', v_basic_user,
    format(v_search, v_basic, format('{"available_by": "%s"}', current_date + 60), ', p_limit => 50')),
  (8, 'basic: deep page (cursor at 2,000)', v_basic_user, format(v_search, v_basic, '{}', format(', p_cursor => %L', v_deep))),
  (9, 'basic: rules shape the cards (Ethiopia)', v_basic_user,
    format(v_search, v_basic, '{"current_country": "ET", "destination": "DE"}', '')),
  (10, 'advanced: two skills', v_pro_user, format(v_search, v_pro, '{"skills": ["TIG welding", "Pipe welding"]}', '')),
  (11, 'advanced: language, destination', v_pro_user,
    format(v_search, v_pro, '{"languages": [{"code": "de", "min_level": "B1"}], "destination": "DE"}', '')),
  (12, 'advanced: five filters, page of 50', v_pro_user,
    format(v_search, v_pro, '{"occupation": "5322", "min_experience": 5, "languages": [{"code": "en", "min_level": "B2"}],
      "industry": "Q", "available_by": "' || (current_date + 90) || '"}', ', p_limit => 50')),
  (13, 'advanced: keyword, work authorisation', v_pro_user,
    format(v_search, v_pro, '{"q": "driver", "work_authorization": "DE"}', '')),
  (14, 'advanced: sparse', v_pro_user,
    format(v_search, v_pro, '{"q": "dementia", "current_country": "MX", "employment_type": "seasonal", "min_experience": 25}', '')),
  (15, 'page: requests of 20 cards', v_pro_user, format('select * from public.card_contact_requests(%L, %L::uuid[])', v_pro, v_cards)),
  (16, 'page: saved workers', v_pro_user, format('select * from public.list_saved_worker_cards(%L)', v_pro));
end;
$$;

-- Runs every case once untimed (a warm-up) and then p_runs times, as run_find_partners_load does; the rate-limit window
-- is emptied before each run, so the limit never stops the load.
create function pg_temp.run_find_workers_load(p_runs integer) returns void
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
      perform pg_temp.workers_act_as(v_case.caller);
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
