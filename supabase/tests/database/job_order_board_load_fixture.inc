-- The job order board load (V79, NFR-P3): 2,000 open marketplace requirements among 8,000 of 400 employers, seen by a
-- network of 5,000 listed partners with the responses and the reveals (invitations, shortlists) of a busy marketplace,
-- and the timing helper. Included with \ir by 189_job_order_board_load.test.sql (the light CI check) and read into the
-- psql input of scripts/load/job-order-board.mjs (the runbook check with query plans, docs/perf/release-2b.md).
-- Everything it writes is rolled back with the transaction that runs it. setseed makes every run seed the same network.

create function pg_temp.board_pick(p_list text[]) returns text
language sql volatile as $$
  select p_list[1 + floor(random() * cardinality(p_list))::integer]
$$;

-- The two partners whose board is measured, after the network: an eligible one on the Professional plan that serves
-- Germany, Poland and the Netherlands and lists welders, care workers and plumbers, with 40 job orders revealed to it,
-- and one of the same profile on no plan, which sees every job order reduced.
create function pg_temp.seed_job_order_board(p_open integer, p_other integer, p_partners integer) returns void
language plpgsql as $$
declare
  v_owner uuid := gen_random_uuid();
  v_markets text[] := '{DE,DE,DE,DE,PL,PL,NL,AE,AE,SA,SA,QA,KW,GB,GB,AT,CA,AU,JP,IT,ES,FR,SE,NO,BE,IE,CZ,SG,MY,IL}';
  v_sources text[] := '{PH,PH,PH,IN,IN,NP,NP,VN,ID,BD,LK,PK,KE,NG,UA,PL,RO,MX,UZ,KG,MA,EG,GH,ET,MM}';
  v_popular text[] := '{7212,7212,7126,5322,5322,2221,2221,8322,7112,7115,7411,9313,5120,5131,9112,8332,7231,6111,9211,7233,3221,5311,7214,7127,9321,7522,5141,4222,2512,3115,8211,7213,9333,5151,9412,8343,7132,7111,7122,7124,7421,3256,5321}';
  v_industries text[] := '{C,C,C,F,F,Q,Q,I,H,A,G,N}';
begin
  perform setseed(0.79);
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (v_owner, 'board-owner@load.test', now(), jsonb_build_object('intended_account_kind', 'company'));
  update public.profiles set account_kind = 'company' where id = v_owner;

  -- The partner network: seven in ten recruitment companies, one to four destinations, three to ten occupations, six in
  -- ten on a paid plan.
  create temp table board_partners on commit drop as
  select gen_random_uuid() as id, n,
    case when n % 10 < 7 then 'recruitment_company' else 'staffing_company' end::public.organization_type as type,
    pg_temp.board_pick(v_sources) as based_in,
    array(select distinct pg_temp.board_pick(v_markets) from generate_series(1, 1 + (n * 7) % 4)) as markets,
    array(select distinct pg_temp.board_pick(v_popular) from generate_series(1, 3 + (n * 13) % 8)) as occupations,
    n % 10 < 6 as paid
  from generate_series(1, p_partners) n;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, review_status, listed_at,
    submitted_at)
  select id, type, 'board-partner-' || n, 'Board Partner ' || n || ' Ltd', 'Board Partner ' || lpad(n::text, 5, '0'), based_in,
    'listed', now() - interval '30 days', now() - interval '31 days'
  from board_partners;
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  select id, v_owner, 'owner', now() from board_partners;
  insert into public.organization_geographies (organization_id, scope, country_code)
  select p.id, 'serves_market', c from board_partners p, unnest(p.markets) c;
  insert into public.organization_occupations (organization_id, occupation_id)
  select p.id, o from board_partners p, unnest(p.occupations) o;
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  select id, case when type = 'recruitment_company' then 'recruitment_' else 'staffing_' end
    || case when n % 3 = 0 then 'professional' else 'partner' end, 'active', 'null'
  from board_partners where paid;

  -- The employers: one in a hundred suspended, one in five on Professional (several destinations allowed), a third with a
  -- public company page.
  create temp table board_employers on commit drop as
  select gen_random_uuid() as id, n from generate_series(1, 400) n;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, status, public_page_enabled,
    website)
  select id, 'employer', 'board-employer-' || n, 'Board Employer ' || n || ' GmbH', 'Board Employer ' || n,
    pg_temp.board_pick(v_markets), case when n % 100 = 0 then 'suspended' else 'active' end::public.organization_status,
    n % 3 = 0, 'https://board-employer-' || n || '.example'
  from board_employers;
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  select id, v_owner, 'owner', now() from board_employers;
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  select id, 'employer_professional', 'active', 'null' from board_employers where n % 5 = 0;

  -- p_open open marketplace job orders (the newest first by n), then p_other requirements the board must skip: closed,
  -- filled, paused, drafts, private ones and open marketplace ones hidden by moderation. The employer of a requirement
  -- is drawn so that the suspended employers own open job orders too.
  create temp table board_requirements on commit drop as
  select gen_random_uuid() as id, n,
    (select e.id from board_employers e where e.n = 1 + (g.n * 37) % 400) as organization_id,
    1 + (g.n * 37) % 400 as employer_n,
    pg_temp.board_pick(v_markets) as country,
    pg_temp.board_pick(v_markets) as second_country,
    pg_temp.board_pick(v_popular) as occ1,
    pg_temp.board_pick(v_popular) as occ2,
    pg_temp.board_pick(v_industries) as industry,
    case
      when n <= p_open then 'open'
      when n <= p_open + p_other * 3 / 16 then 'closed'
      when n <= p_open + p_other * 5 / 16 then 'filled'
      when n <= p_open + p_other * 7 / 16 then 'paused'
      when n <= p_open + p_other * 9 / 16 then 'draft'
      else 'open'
    end as status,
    case when n > p_open + p_other * 9 / 16 and n <= p_open + p_other * 15 / 16 then 'private' else 'job_order_marketplace' end as visibility,
    n > p_open + p_other * 15 / 16 as hidden,
    now() - make_interval(mins => n * 7) as published_at,
    random() < 0.3 as show_identity,
    random() < 0.15 as two_countries,
    random() < 0.6 as two_occupations,
    10 + floor(random() * 190)::integer as workers,
    current_date + 30 + floor(random() * 300)::integer as start_date,
    (array['local', 'international', 'both'])[1 + floor(random() * 3)::integer]::public.recruitment_preference as recruitment
  from generate_series(1, p_open + p_other) g (n);

  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on, close_reason, created_by,
    moderation_state
  )
  select id, organization_id, 'Board requirement ' || n, workers, country, 'City ' || (n % 80), industry, start_date, 'full_time',
    recruitment, 'both', status::public.requirement_status,
    case when status <> 'draft' then visibility::public.requirement_visibility end,
    status <> 'draft' and show_identity,
    case when status <> 'draft' then published_at end,
    case when status <> 'draft' then start_date + 30 end,
    case status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason,
    v_owner,
    case when hidden then 'hidden' else 'visible' end::public.job_moderation_state
  from board_requirements;
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select id, occ1, case when two_occupations and occ2 <> occ1 then workers - workers / 3 else workers end from board_requirements
  union all
  select id, occ2, workers / 3 from board_requirements where two_occupations and occ2 <> occ1;
  insert into public.requirement_countries (requirement_id, country_code) select id, country from board_requirements;
  insert into public.requirement_countries (requirement_id, country_code)
  select id, second_country from board_requirements where two_countries and second_country <> country and employer_n % 5 = 0;

  -- Responses: zero to eight partners on each job order that is or was on the marketplace, a tenth withdrawn; and the
  -- reveals of a busy marketplace (an invitation or a shortlist of a partner on one job order in three).
  insert into public.partner_responses (requirement_id, organization_id, employer_organization_id, status, capacity,
    available_from, experience_note, fee_model, withdrawn_at)
  select distinct on (r.id, p.id) r.id, p.id, r.organization_id,
    case when (k.n + r.n) % 10 = 0 then 'withdrawn' else 'submitted' end::public.response_status, 5 + k.n, current_date + 20,
    'Placed crews in this trade for many years', 'on_request', case when (k.n + r.n) % 10 = 0 then now() end
  from board_requirements r
  cross join lateral generate_series(1, floor(random() * 9)::integer) k (n)
  cross join lateral (select 1 + floor(random() * p_partners)::integer as n, k.n as draw) pick
  join board_partners p on p.n = pick.n
  where r.status <> 'draft' and r.visibility = 'job_order_marketplace';
  insert into private.requirement_reveals (requirement_id, organization_id, cause, revealed_at, seen_at)
  select distinct on (r.id, p.id) r.id, p.id, (array['invitation', 'shortlist'])[1 + k.n % 2], r.published_at, null
  from board_requirements r
  cross join lateral generate_series(1, 1 + floor(random() * 3)::integer) k (n)
  cross join lateral (select 1 + floor(random() * p_partners)::integer as n, k.n as draw) pick
  join board_partners p on p.n = pick.n
  where r.status <> 'draft' and r.n % 3 = 0;

  -- The measured partners.
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    ('00000000-0000-0000-0000-0000000b7901', 'board-eligible@load.test', now(), jsonb_build_object('intended_account_kind', 'company')),
    ('00000000-0000-0000-0000-0000000b7902', 'board-free@load.test', now(), jsonb_build_object('intended_account_kind', 'company'));
  update public.profiles set account_kind = 'company'
  where id in ('00000000-0000-0000-0000-0000000b7901', '00000000-0000-0000-0000-0000000b7902');
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, review_status, listed_at,
    submitted_at) values
    ('00000000-0000-0000-0000-0000000b7911', 'recruitment_company', 'board-eligible', 'Board Eligible Ltd', 'Board Eligible', 'PH',
      'listed', now() - interval '30 days', now() - interval '31 days'),
    ('00000000-0000-0000-0000-0000000b7912', 'recruitment_company', 'board-free', 'Board Free Ltd', 'Board Free', 'PH',
      'listed', now() - interval '30 days', now() - interval '31 days');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values
    ('00000000-0000-0000-0000-0000000b7911', '00000000-0000-0000-0000-0000000b7901', 'owner', now()),
    ('00000000-0000-0000-0000-0000000b7912', '00000000-0000-0000-0000-0000000b7902', 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  select o, 'serves_market', c
  from unnest('{00000000-0000-0000-0000-0000000b7911,00000000-0000-0000-0000-0000000b7912}'::uuid[]) o, unnest('{DE,PL,NL}'::text[]) c;
  insert into public.organization_occupations (organization_id, occupation_id)
  select o, c
  from unnest('{00000000-0000-0000-0000-0000000b7911,00000000-0000-0000-0000-0000000b7912}'::uuid[]) o,
    unnest('{7212,5322,7126}'::text[]) c;
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  values ('00000000-0000-0000-0000-0000000b7911', 'recruitment_professional', 'active', 'null');
  insert into private.requirement_reveals (requirement_id, organization_id, cause, revealed_at)
  select id, '00000000-0000-0000-0000-0000000b7911', 'invitation', published_at
  from board_requirements where status = 'open' and visibility = 'job_order_marketplace' and not show_identity and n % 50 = 7;

  -- Planner statistics for every table the board reads (see find_partners_load_fixture.inc); rolled back with the rest.
  analyze public.workforce_requirements, public.requirement_occupations, public.requirement_countries, public.organizations,
    public.organization_geographies, public.organization_occupations, public.partner_responses, private.requirement_reveals,
    billing.subscriptions;
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

-- Sets the claims and the API role of the calling partner member; the caller resets them inline (the API roles cannot
-- call a pg_temp function).
create function pg_temp.board_act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
end;
$$;

-- The typical calls of the board page and the job order page, after the seed: the eligible partner's first page, a
-- page of 50, its filters (one to five), a deep page through the cursor, a named and an anonymous job order and one no
-- longer open; the free partner's first page and a filter on a field it cannot see (every row read, none answered).
create function pg_temp.prepare_job_order_board_cases() returns void
language plpgsql as $$
declare
  v_eligible text := '00000000-0000-0000-0000-0000000b7911';
  v_free text := '00000000-0000-0000-0000-0000000b7912';
  v_list text := 'select * from public.list_job_orders(%L%s)';
  v_cursor uuid := (select id from board_requirements where n = 1900);
  v_anonymous uuid := (select id from board_requirements
                        where n >= 1000 and n <= 2000 and not show_identity and n % 50 <> 7 order by n limit 1);
  v_named uuid := (select id from board_requirements where n % 50 = 7 and n <= 2000 and not show_identity order by n limit 1);
  v_ended uuid := (select id from board_requirements where status = 'closed' order by n limit 1);
begin
  insert into load_cases (position, label, caller, sql) values
  (1, 'eligible: first page', '00000000-0000-0000-0000-0000000b7901', format(v_list, v_eligible, '')),
  (2, 'eligible: page of 50', '00000000-0000-0000-0000-0000000b7901', format(v_list, v_eligible, ', p_limit => 50')),
  (3, 'eligible: destination', '00000000-0000-0000-0000-0000000b7901', format(v_list, v_eligible, ', p_destination => ''DE''')),
  (4, 'eligible: destination, occupation, 50', '00000000-0000-0000-0000-0000000b7901',
    format(v_list, v_eligible, ', p_destination => ''DE'', p_occupation => ''7212'', p_limit => 50')),
  (5, 'eligible: five filters', '00000000-0000-0000-0000-0000000b7901',
    format(v_list, v_eligible, format(', p_destination => %L, p_occupation => %L, p_workers_min => 20, p_start_from => %L,
      p_recruitment => %L, p_limit => 50', 'DE', '5322', current_date + 60, 'international'))),
  (6, 'eligible: sparse filter', '00000000-0000-0000-0000-0000000b7901',
    format(v_list, v_eligible, format(', p_destination => %L, p_occupation => %L, p_start_from => %L, p_start_to => %L, p_limit => 50',
      'PL', '7126', current_date + 100, current_date + 130))),
  (7, 'eligible: source country', '00000000-0000-0000-0000-0000000b7901',
    format(v_list, v_eligible, ', p_source => ''PH'', p_limit => 50')),
  (8, 'eligible: deep page (cursor at 1,900)', '00000000-0000-0000-0000-0000000b7901',
    format(v_list, v_eligible, format(', p_cursor => %L, p_limit => 50', v_cursor))),
  (9, 'free: first page', '00000000-0000-0000-0000-0000000b7902', format(v_list, v_free, '')),
  (10, 'free: hidden-field filter', '00000000-0000-0000-0000-0000000b7902',
    format(v_list, v_free, ', p_industry => ''C'', p_limit => 50')),
  (11, 'job order: anonymous', '00000000-0000-0000-0000-0000000b7901',
    format('select * from public.get_job_order(%L, %L)', v_eligible, v_anonymous)),
  (12, 'job order: revealed', '00000000-0000-0000-0000-0000000b7901',
    format('select * from public.get_job_order(%L, %L)', v_eligible, v_named)),
  (13, 'job order: no longer open', '00000000-0000-0000-0000-0000000b7901',
    format('select * from public.get_job_order(%L, %L)', v_eligible, v_ended));
end;
$$;

-- Runs every case once untimed (a warm-up) and then p_runs times, as run_find_partners_load does; the rate-limit window
-- is emptied before each run, so the limit never stops the load.
create function pg_temp.run_job_order_board_load(p_runs integer) returns void
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
      perform pg_temp.board_act_as(v_case.caller);
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
