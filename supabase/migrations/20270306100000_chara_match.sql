-- CHARA Match v1 (ARCHITECTURE.md section 9.3, ADR-0005; OPEN_QUESTIONS.md C2, R21; client brief section 7). An employer
-- enters a destination, an industry, an occupation, a number of workers, a start date and a recruitment type (local,
-- international or both) and sees its potential workforce network: the matching workers, recruitment partners and
-- staffing partners, the workforce available from the partners as a range and the source countries, then the matches
-- with why each one matched. Structured data only, no AI, no promise of success.
-- - Matching is deterministic and rule-based (ADR-0005): public.match_rules holds one weight per rule and kind, and every
--   contribution of a match is stored as {rule, points, detail} in public.match_results.reasons; the score is their sum.
--   Seeded v1 rules:
--     worker                                occupation 40, work_authorization (for the destination) 25 or else
--                                           preferred_country (the destination) 10, availability (now or by the start) 15
--     recruitment_partner, staffing_partner serves_destination 35, occupation 20, sources_from (a source country that fits
--                                           the recruitment type) 15, industry 10, availability (fresh listings of the
--                                           occupation by the start, at least 10 % of the workers needed) 10
--   Not seeded, because the form or the data has nothing to match them on: the worker's skills (a requirement's skills are
--   free text, which is never interpreted) and languages (the form asks for none), the partners' service type (the form
--   asks for none), and the badge rules of section 9.3 (no verification badge exists yet). Boosts never enter the score.
-- - Who is matched: workers who chose to be found (private.worker_cards where listed, the rule of Find Workers) of the
--   occupation who may work in or prefer the destination; public partners (listed, not declined, active, visible) that
--   serve the destination and list the occupation, whose recruitment type fits. A recruitment company that offers
--   staffing is both a recruitment and a staffing partner, as in the directories. The recruitment type: local keeps the
--   workers living in the destination and the partners' sources and listings in it; international those of other
--   countries; both everything.
-- - public.chara_match runs it for a member (any role) of an active employer on a paid plan with the feature chara_match
--   (every paid employer plan, C2: never reserved for a higher plan), while release_chara_match and
--   release_partner_directories are on. It writes one public.match_runs row (inputs and summary) and the matches with
--   their reasons, at most match_results_max per kind, and answers the run. The summary is counted from the same run:
--   the worker count from 1 to private.stats_min_count() - 1 is null with workers_fewer_than; the workforce is a range
--   (private.workforce_band). Counted per user (rate_limit_chara_match_max per _seconds); logged as one row of
--   stats.partner_searches of kind chara_match (no user, no organisation, no value but the destination).
-- - public.chara_match_results pages the matches of one kind of a run of the caller's organisation, best first:
--   partners with their name and slug while they are public; workers as the Find Workers card while they are listed,
--   only for an organisation private.assert_worker_searcher allows (release_find_workers on).
-- - The members of the organisation read its runs and its partner matches through row security; the worker matches only
--   through chara_match_results, so a card that is no longer listed is never read again. Runs are kept match_runs days
--   (90) by private.apply_retention, their matches with them.

-- Settings -----------------------------------------------------------------------------------------------------------------

insert into private.settings (key, value) values
  ('release_chara_match', 'false'),
  ('rate_limit_chara_match_max', '10'),
  ('rate_limit_chara_match_seconds', '60'),
  ('match_results_max', '200')
on conflict (key) do nothing;

-- The switch names no release feature: CHARA Match needs release 2a (partner accounts) too, whose legal documents that
-- release puts live.
insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('release_chara_match', 'boolean', null, null, 'CHARA Match: rule-based matches for employers (needs release 2a)', null),
  ('rate_limit_chara_match_max', 'integer', 1, 1000, 'CHARA Match runs one person may start in the window', null),
  ('rate_limit_chara_match_seconds', 'integer', 60, 604800, 'Seconds of the CHARA Match window', null),
  ('match_results_max', 'integer', 10, 1000, 'Matches kept per kind for one CHARA Match run at most', null);

insert into private.retention_policies (entity, days, label, description) values
  ('match_runs', 90, 'CHARA Match runs',
   'Days a CHARA Match run of an employer (what was asked, the summary and the matches with their reasons) is kept.');

-- The feature is on every paid employer plan (C2, R21). A rebuilt database gets the rows from supabase/seeds/ref/plans.sql.
insert into billing.feature_keys (key, org_types, label) values ('chara_match', '{employer}', 'CHARA Match')
on conflict (key) do nothing;

insert into billing.plan_features (plan_code, feature_key)
select p.code, 'chara_match' from billing.plans p
where p.code in ('employer_starter', 'employer_professional', 'employer_enterprise')
on conflict (plan_code, feature_key) do nothing;

alter table stats.partner_searches drop constraint partner_searches_kind_check;
alter table stats.partner_searches add constraint partner_searches_kind_check
  check (kind in ('recruitment', 'staffing', 'available_workforce', 'employers', 'chara_match'));

comment on table stats.partner_searches is
  'One row per first page of a Find Partners search (FR-L1, FR-L2 KPIs: share of searches with at least one result, zero-result searches by destination), of an available-workforce search (FR-K3), of a Find Employers search (FR-L3, kind employers) or per CHARA Match run (kind chara_match, result_count the partners matched up to 50). Holds no user, organisation, address, session or free text. result_count is the number of results on the first page (at most the page size), so it tells zero from some. Written by search_partners, search_available_workforce, search_employers and chara_match, read through admin_partner_search_stats, kept for partner_searches days.';

-- Tables -------------------------------------------------------------------------------------------------------------------

create table public.match_rules (
  entity_type text not null check (entity_type in ('worker', 'recruitment_partner', 'staffing_partner')),
  rule_key text not null check (rule_key ~ '^[a-z]+(_[a-z]+)*$'),
  weight integer not null check (weight between 0 and 100),
  enabled boolean not null default true,
  primary key (entity_type, rule_key)
);

comment on table public.match_rules is
  'The rules of CHARA Match (ADR-0005): one weight per rule and kind of match. A disabled rule adds nothing. Changed by a reviewed migration only; readable by every signed-in user, since the rules are documented.';

alter table public.match_rules enable row level security;
alter table public.match_rules force row level security;
revoke all on table public.match_rules from public, anon, authenticated, service_role;
grant select on public.match_rules to authenticated;

create policy match_rules_select on public.match_rules
  for select to authenticated
  using (true);

insert into public.match_rules (entity_type, rule_key, weight) values
  ('worker', 'occupation', 40),
  ('worker', 'work_authorization', 25),
  ('worker', 'preferred_country', 10),
  ('worker', 'availability', 15),
  ('recruitment_partner', 'serves_destination', 35),
  ('recruitment_partner', 'occupation', 20),
  ('recruitment_partner', 'sources_from', 15),
  ('recruitment_partner', 'industry', 10),
  ('recruitment_partner', 'availability', 10),
  ('staffing_partner', 'serves_destination', 35),
  ('staffing_partner', 'occupation', 20),
  ('staffing_partner', 'sources_from', 15),
  ('staffing_partner', 'industry', 10),
  ('staffing_partner', 'availability', 10);

create table public.match_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.match_runs is
  'One CHARA Match run of an employer (section 9.3): what was asked (inputs) and the summary counted from its matches. Written only by chara_match; read by the organisation''s members; kept match_runs days.';

create index match_runs_organization_idx on public.match_runs (organization_id, created_at desc);
create index match_runs_created_by_idx on public.match_runs (created_by);
create index match_runs_created_at_idx on public.match_runs (created_at);

alter table public.match_runs enable row level security;
alter table public.match_runs force row level security;
revoke all on table public.match_runs from public, anon, authenticated, service_role;
grant select on public.match_runs to authenticated;

create policy match_runs_select_member on public.match_runs
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- entity_id is the organisation of a partner match and the card id (the pseudonym of V68) of a worker match.
create table public.match_results (
  run_id uuid not null references public.match_runs (id) on delete cascade,
  entity_type text not null check (entity_type in ('worker', 'recruitment_partner', 'staffing_partner')),
  entity_id uuid not null,
  score integer not null check (score between 0 and 100),
  reasons jsonb not null check (jsonb_typeof(reasons) = 'array'),
  primary key (run_id, entity_type, entity_id)
);

comment on table public.match_results is
  'The matches of a CHARA Match run with why each matched (reasons: {rule, points, detail} per rule that contributed; score their sum). Written only by chara_match. The members of the organisation read the partner matches; worker matches only through chara_match_results while the card is listed.';

create index match_results_page_idx on public.match_results (run_id, entity_type, score desc, entity_id);

alter table public.match_results enable row level security;
alter table public.match_results force row level security;
revoke all on table public.match_results from public, anon, authenticated, service_role;
grant select on public.match_results to authenticated;

create policy match_results_select_member on public.match_results
  for select to authenticated
  using (
    entity_type <> 'worker'
    and run_id in (select r.id from public.match_runs r where r.organization_id in (select private.member_org_ids()))
  );

-- Helpers ------------------------------------------------------------------------------------------------------------------

-- The points of p_rule for p_entity_type: its weight while it is enabled, else 0.
create function private.match_weight(p_entity_type text, p_rule text) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.weight from public.match_rules r where r.entity_type = p_entity_type and r.rule_key = p_rule and r.enabled), 0)
$$;

revoke all on function private.match_weight(text, text) from public, anon, authenticated, service_role;

-- The checks both functions start with, for the employer p_org: CHARA_NOT_FOUND while release_chara_match or
-- release_partner_directories is off; CHARA_FORBIDDEN (42501) without a session or for a caller who is not an accepted
-- member, then employer_only and organization_suspended; CHARA_FEATURE_NOT_IN_PLAN chara_match for a free plan code (a
-- lapsed subscription falls back to it) or a plan without the feature.
create function private.assert_match_runner(p_org uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if not private.release_on('release_chara_match') or not private.release_on('release_partner_directories') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is null or p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_org from public.organizations o where o.id = p_org;
  if v_org.type <> 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'employer_only', errcode = '42501';
  end if;
  if v_org.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended', errcode = '42501';
  end if;
  if private.org_plan_code(p_org) like 'free\_%' or not private.has_feature(p_org, 'chara_match') then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'chara_match';
  end if;
end;
$$;

revoke all on function private.assert_match_runner(uuid) from public, anon, authenticated, service_role;

-- chara_match ---------------------------------------------------------------------------------------------------------------

-- Runs CHARA Match for the employer p_org. Refusals in order: those of private.assert_match_runner, CHARA_RATE_LIMITED,
-- CHARA_INVALID_INPUT naming the argument (p_destination, p_industry and p_occupation must be known codes, p_workers 1 to
-- 100,000, p_start from today (UTC) to 36 months ahead, p_recruitment given). Answers the run: its id, the inputs and the
-- summary {matching_workers, workers_fewer_than, recruitment_partners, staffing_partners, available_workforce,
-- source_countries}.
create function public.chara_match(
  p_org uuid, p_destination text, p_industry text, p_occupation text, p_workers integer, p_start date,
  p_recruitment public.recruitment_preference
) returns table (run_id uuid, inputs jsonb, summary jsonb, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_destination text := upper(btrim(p_destination));
  v_industry text := upper(btrim(p_industry));
  v_occupation text := btrim(p_occupation);
  v_today date := (now() at time zone 'utc')::date;
  v_fresh_since timestamptz := private.workforce_fresh_since();
  v_min integer := private.stats_min_count();
  v_max integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'match_results_max'), 200);
  v_need integer;
  v_run public.match_runs;
  v_partners uuid[];
  v_workers integer;
  v_recruitment integer;
  v_staffing integer;
  v_supply integer;
  v_source_codes text[];
  v_sources jsonb;
begin
  perform private.assert_match_runner(p_org);
  perform private.check_rate_limit('chara_match', v_uid);

  if v_destination is null or not exists (select 1 from public.countries c where c.code = v_destination) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_destination';
  end if;
  if v_industry is null or not exists (select 1 from public.industries i where i.code = v_industry) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_industry';
  end if;
  if v_occupation is null or not exists (select 1 from public.occupations o where o.code = v_occupation) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_occupation';
  end if;
  if p_workers is null or p_workers not between 1 and 100000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_workers';
  end if;
  if p_start is null or p_start < v_today or p_start > (v_today + interval '36 months')::date then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_start';
  end if;
  if p_recruitment is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_recruitment';
  end if;
  -- 10 % of the workers needed, at least one.
  v_need := greatest(ceil(p_workers / 10.0)::integer, 1);

  insert into public.match_runs (organization_id, created_by, inputs)
  values (p_org, v_uid, jsonb_build_object(
    'destination', v_destination, 'industry', v_industry, 'occupation', v_occupation, 'workers', p_workers,
    'start', p_start, 'recruitment', p_recruitment))
  returning * into v_run;

  -- Workers: the listed cards of the occupation that may work in or prefer the destination.
  with candidates as (
    select c.card_id, c.availability, c.available_from,
      exists (
        select 1 from public.worker_work_authorizations a
        where a.worker_user_id = c.user_id and a.country_code = v_destination
          and (a.expires_on is null or a.expires_on >= v_today)
      ) as authorized,
      exists (
        select 1 from public.worker_preferred_countries pc where pc.worker_user_id = c.user_id and pc.country_code = v_destination
      ) as prefers
    from private.worker_cards c
    where c.listed and c.occupation_id = v_occupation
      and (p_recruitment = 'both' or (p_recruitment = 'local') = (c.current_country = v_destination))
  ),
  reasoned as (
    select c.card_id, (
      select coalesce(jsonb_agg(jsonb_build_object('rule', r.rule, 'points', w.points, 'detail', r.detail) order by r.n), '[]'::jsonb)
      from (values
        (1, 'occupation', v_occupation),
        (2, 'work_authorization', case when c.authorized then v_destination end),
        (3, 'preferred_country', case when not c.authorized and c.prefers then v_destination end),
        (4, 'availability', case
          when c.availability = 'now' then 'now'
          when c.availability = 'from_date' and c.available_from <= p_start then c.available_from::text
        end)
      ) r (n, rule, detail)
      cross join lateral (select private.match_weight('worker', r.rule) as points) w
      where r.detail is not null and w.points > 0
    ) as reasons
    from candidates c
    where c.authorized or c.prefers
  ),
  scored as (
    select r.*, (select coalesce(sum((e ->> 'points')::integer), 0) from jsonb_array_elements(r.reasons) e)::integer as score
    from reasoned r
  ),
  kept as (
    insert into public.match_results (run_id, entity_type, entity_id, score, reasons)
    select v_run.id, 'worker', s.card_id, s.score, s.reasons
    from scored s
    order by s.score desc, s.card_id
    limit v_max
  )
  select count(*)::integer into v_workers from scored;

  -- Partners: the public partners that serve the destination and list the occupation, whose recruitment type fits.
  select
    coalesce(array_agg(p.id), '{}'),
    (count(*) filter (where p.type = 'recruitment_company'))::integer,
    (count(*) filter (where p.type = 'staffing_company' or p.staffing_service))::integer
  into v_partners, v_recruitment, v_staffing
  from (
    select o.id, o.type,
      o.type = 'recruitment_company' and exists (
        select 1 from public.organization_service_types st where st.organization_id = o.id and st.service = 'staffing'
      ) as staffing_service
    from public.organizations o
    where o.type in ('recruitment_company', 'staffing_company')
      and o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active'
      and o.moderation_state = 'visible'
      and (p_recruitment = 'both' or o.recruitment_type in ('both', p_recruitment))
      and exists (
        select 1 from public.organization_geographies g
        where g.organization_id = o.id and g.scope = 'serves_market' and g.country_code = v_destination
      )
      and exists (
        select 1 from public.organization_occupations oo where oo.organization_id = o.id and oo.occupation_id = v_occupation
      )
  ) p;

  with facts as (
    select o.id, o.type,
      o.type = 'recruitment_company' and exists (
        select 1 from public.organization_service_types st where st.organization_id = o.id and st.service = 'staffing'
      ) as staffing_service,
      array(
        select g.country_code from public.organization_geographies g
        where g.organization_id = o.id and g.scope = 'sources_from'
          and (p_recruitment = 'both' or (p_recruitment = 'local') = (g.country_code = v_destination))
        order by g.country_code
      ) as sources,
      exists (
        select 1 from public.organization_industries i where i.organization_id = o.id and i.industry_code = v_industry
      ) as industry,
      (select sum(a.available)::integer
       from public.workforce_availability a
       where a.organization_id = o.id and a.occupation_id = v_occupation and a.confirmed_at > v_fresh_since
         and a.available_from <= p_start
         and (p_recruitment = 'both' or (p_recruitment = 'local') = (a.source_country = v_destination))) as supply
    from public.organizations o
    where o.id = any (v_partners)
  ),
  kinds as (
    select f.*, k.kind
    from facts f
    cross join (values ('recruitment_partner'), ('staffing_partner')) k (kind)
    where (k.kind = 'recruitment_partner' and f.type = 'recruitment_company')
       or (k.kind = 'staffing_partner' and (f.type = 'staffing_company' or f.staffing_service))
  ),
  reasoned as (
    select k.id, k.kind, (
      select coalesce(jsonb_agg(jsonb_build_object('rule', r.rule, 'points', w.points, 'detail', r.detail) order by r.n), '[]'::jsonb)
      from (values
        (1, 'serves_destination', v_destination),
        (2, 'occupation', v_occupation),
        (3, 'sources_from', case when cardinality(k.sources) > 0 then array_to_string(k.sources[1:5], ',') end),
        (4, 'industry', case when k.industry then v_industry end),
        (5, 'availability', case when k.supply >= v_need then private.workforce_band(k.supply) end)
      ) r (n, rule, detail)
      cross join lateral (select private.match_weight(k.kind, r.rule) as points) w
      where r.detail is not null and w.points > 0
    ) as reasons
    from kinds k
  ),
  scored as (
    select r.*, (select coalesce(sum((e ->> 'points')::integer), 0) from jsonb_array_elements(r.reasons) e)::integer as score
    from reasoned r
  )
  insert into public.match_results (run_id, entity_type, entity_id, score, reasons)
  select v_run.id, s.kind, s.id, s.score, s.reasons
  from (select s.*, row_number() over (partition by s.kind order by s.score desc, s.id) as n from scored s) s
  where s.n <= v_max;

  -- The workforce of the partners' fresh listings of the occupation available by the start, from the source countries
  -- the recruitment type allows.
  select coalesce(sum(a.available), 0)::integer, coalesce(array_agg(distinct a.source_country), '{}')
  into v_supply, v_source_codes
  from public.workforce_availability a
  where a.organization_id = any (v_partners) and a.occupation_id = v_occupation and a.confirmed_at > v_fresh_since
    and a.available_from <= p_start
    and (p_recruitment = 'both' or (p_recruitment = 'local') = (a.source_country = v_destination));
  select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name) order by c.name, c.code), '[]'::jsonb)
  into v_sources
  from public.countries c
  where c.code = any (v_source_codes);

  update public.match_runs r
  set summary = jsonb_build_object(
    'matching_workers', case when v_workers > 0 and v_workers < v_min then null else v_workers end,
    'workers_fewer_than', case when v_workers > 0 and v_workers < v_min then v_min end,
    'recruitment_partners', v_recruitment,
    'staffing_partners', v_staffing,
    'available_workforce', private.workforce_band(v_supply),
    'source_countries', v_sources)
  where r.id = v_run.id
  returning * into v_run;

  insert into stats.partner_searches (kind, filter_names, destination_country, result_count)
  values (
    'chara_match',
    array['destination', 'industry', 'occupation', 'min_workers', 'timeframe', 'recruitment_type'],
    v_destination,
    least(cardinality(v_partners), 50)
  );

  return query select v_run.id, v_run.inputs, v_run.summary, v_run.created_at;
end;
$$;

revoke all on function public.chara_match(uuid, text, text, text, integer, date, public.recruitment_preference)
  from public, anon, authenticated, service_role;
grant execute on function public.chara_match(uuid, text, text, text, integer, date, public.recruitment_preference)
  to authenticated;

-- chara_match_results ---------------------------------------------------------------------------------------------------

-- One page of the matches of p_entity_type (worker, recruitment_partner, staffing_partner) of the run p_run, best first
-- (score, then id); pages of 20 by default and at most 50, the last row of a page with a next one carrying next_cursor
-- (score|id). A partner comes with its slug, name and type while it is public; a worker with its card (the columns of
-- public.worker_search, with how the direct-hiring rules of the run's destination shape contact) while it is listed.
-- Refusals in order: those of private.assert_match_runner for the run's organisation, CHARA_INVALID_INPUT p_entity_type, those of private.assert_worker_searcher for workers,
-- CHARA_RATE_LIMITED (worker_search for workers, partner_search for partners), CHARA_INVALID_INPUT p_cursor.
create function public.chara_match_results(p_run uuid, p_entity_type text, p_cursor text default null, p_limit integer default null)
returns table (
  entity_id uuid,
  score integer,
  reasons jsonb,
  slug text,
  display_name text,
  organization_type public.organization_type,
  card jsonb,
  next_cursor text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_run public.match_runs;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_after_score integer;
  v_after_id uuid;
begin
  -- An unknown run and a run of another organisation are refused alike (CHARA_FORBIDDEN), so neither is told apart.
  select * into v_run from public.match_runs r where r.id = p_run;
  perform private.assert_match_runner(v_run.organization_id);

  if p_entity_type is null or p_entity_type not in ('worker', 'recruitment_partner', 'staffing_partner') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_entity_type';
  end if;
  if p_entity_type = 'worker' then
    perform private.assert_worker_searcher(v_run.organization_id);
    perform private.check_rate_limit('worker_search', v_uid);
  else
    perform private.check_rate_limit('partner_search', v_uid);
  end if;

  if p_cursor is not null then
    begin
      if p_cursor !~ '^[0-9]{1,3}\|[0-9a-f-]{36}$' then
        raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
      end if;
      v_after_score := split_part(p_cursor, '|', 1)::integer;
      v_after_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end;
  end if;

  return query
  with shown as (
    select m.entity_id, m.score, m.reasons, o.slug, o.display_name, o.type,
      case when c.card_id is not null then (
        select to_jsonb(x) from (
          select c.card_id, c.headline, c.occupation_id, c.skills, c.years_experience, c.languages, c.availability,
            c.available_from, c.current_country, c.preferred_countries, c.work_authorization_countries, c.training,
            c.employment_history, c.preferred_industries, c.preferred_employment_types, c.updated_at,
            dc.direct_contact, dc.notice
          from private.worker_card_contact(c.current_country, v_run.inputs ->> 'destination', false) dc
        ) x
      ) end as card
    from public.match_results m
    left join public.organizations o
      on p_entity_type <> 'worker' and o.id = m.entity_id
        and o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active'
        and o.moderation_state = 'visible'
    left join private.worker_cards c on p_entity_type = 'worker' and c.card_id = m.entity_id and c.listed
    where m.run_id = v_run.id and m.entity_type = p_entity_type
      and (o.id is not null or c.card_id is not null)
      and (v_after_id is null or m.score < v_after_score or (m.score = v_after_score and m.entity_id > v_after_id))
    order by m.score desc, m.entity_id
    limit v_limit + 1
  ),
  numbered as (
    select s.*, row_number() over (order by s.score desc, s.entity_id) as n from shown s
  )
  select r.entity_id, r.score, r.reasons, r.slug, r.display_name, r.type, r.card,
    case when r.n = v_limit and exists (select 1 from numbered x where x.n > v_limit) then r.score || '|' || r.entity_id end
  from numbered r
  where r.n <= v_limit
  order by r.n;
end;
$$;

revoke all on function public.chara_match_results(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.chara_match_results(uuid, text, text, integer) to authenticated;

-- Retention -----------------------------------------------------------------------------------------------------------------

-- private.apply_retention of 20270214100000_messaging_retention_erasure.sql with the CHARA Match runs (match_runs, with
-- their matches) added before the inactive accounts.
create or replace function private.apply_retention() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_removed bigint;
  v_file record;
  v_req_days integer;
  v_requirements uuid[] := '{}'::uuid[];
  v_more bigint;
  v_floor integer;
begin
  select p.days into v_days from private.retention_policies p where p.entity = 'document_access_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.document_access_log where accessed_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform private.record_retention('document_access_log', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'notifications';
  if found then
    delete from pgmq.a_notifications where archived_at < now() - make_interval(days => v_days);
    delete from public.notifications where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('notifications', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'billing_provider_events';
  if found then
    delete from billing.provider_events where received_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('billing_provider_events', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'security_events';
  if found then
    delete from private.security_events where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('security_events', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'audit_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.log where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform private.record_retention('audit_log', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'organization_invitations';
  if found then
    delete from public.organization_invitations i where coalesce(i.accepted_at, i.expires_at) < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('organization_invitations', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'deleted_worker_documents';
  if found then
    delete from public.worker_documents d
    where d.deleted_at < now() - make_interval(days => v_days)
      and not exists (select 1 from storage.objects o where o.bucket_id = d.bucket_id and o.name = d.storage_path);
    get diagnostics v_removed = row_count;
    perform private.record_retention('deleted_worker_documents', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'login_failures';
  if found then
    delete from private.login_failures f where f.window_started_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('login_failures', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'cron_job_run_details';
  if found then
    delete from cron.job_run_details r where r.end_time < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('cron_job_run_details', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'account_ops_archive';
  if found then
    delete from pgmq.a_account_ops a where a.archived_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('account_ops_archive', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'closed_reports';
  if found then
    delete from public.reports r where r.status in ('actioned', 'dismissed') and r.handled_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('closed_reports', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'partner_document_access_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.partner_document_access_log where accessed_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform private.record_retention('partner_document_access_log', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'licence_evidence';
  if found then
    v_removed := 0;
    for v_file in
      delete from private.retired_licence_evidence r where r.retired_at < now() - make_interval(days => v_days)
      returning r.organization_id, r.storage_path
    loop
      perform private.queue_evidence_removal(v_file.organization_id, v_file.storage_path);
      v_removed := v_removed + 1;
    end loop;
    perform private.record_retention('licence_evidence', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'profile_view_events';
  if found then
    delete from private.profile_view_events e where e.viewed_on < (now() at time zone 'utc')::date - v_days;
    get diagnostics v_removed = row_count;
    perform private.record_retention('profile_view_events', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'org_analytics';
  if found then
    delete from private.org_analytics_daily d where d.day < (now() at time zone 'utc')::date - v_days;
    get diagnostics v_removed = row_count;
    perform private.record_retention('org_analytics', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'partner_searches';
  if found then
    delete from stats.partner_searches s where s.created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('partner_searches', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'worker_search_log';
  if found then
    delete from private.worker_search_log s where s.created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('worker_search_log', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'closed_appeals';
  if found then
    -- The decision must also be older than the longest appeal window the settings editor allows (24 months), so that a
    -- shortened period never deletes an appeal whose decision could be appealed again once its row is gone.
    delete from public.appeals a
    where a.status <> 'open' and a.decided_at < now() - make_interval(days => v_days)
      and exists (select 1 from public.moderation_actions m
                  where m.id = a.moderation_action_id and m.created_at < now() - make_interval(months => 24));
    get diagnostics v_removed = row_count;
    perform private.record_retention('closed_appeals', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'data_exports';
  if found then
    v_removed := 0;
    for v_file in
      delete from public.data_export_requests r
      where (r.status = 'ready' and r.expires_at <= now())
         or (r.status = 'queued' and r.requested_at < now() - make_interval(days => v_days))
      returning r.user_id, r.storage_path
    loop
      if v_file.storage_path is not null then
        perform pgmq.send('account_ops', jsonb_build_object(
          'action', 'delete_object', 'user_id', v_file.user_id, 'bucket_id', 'dsar-exports', 'path', v_file.storage_path
        ));
      end if;
      v_removed := v_removed + 1;
    end loop;
    perform private.record_retention('data_exports', v_days, v_removed);
  end if;

  -- The job order network. The submissions and responses of an ended requirement go before it, so that a decision on one
  -- of them keeps its title (private.keep_moderated_item); an item under a report that is not closed waits for it.
  select p.days into v_req_days from private.retention_policies p where p.entity = 'closed_requirements';
  if v_req_days is not null then
    select coalesce(array_agg(r.id), '{}') into v_requirements
    from public.workforce_requirements r
    where r.status in ('closed', 'filled') and r.status_changed_at < now() - make_interval(days => v_req_days)
      and not exists (
        select 1 from public.reports x
        where x.status in ('new', 'in_review')
          and (x.requirement_id = r.id
            or x.partner_response_id in (select pr.id from public.partner_responses pr where pr.requirement_id = r.id)
            or x.candidate_submission_id in (select cs.id from public.candidate_submissions cs where cs.requirement_id = r.id))
      );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'candidate_submissions';
  if found then
    delete from public.candidate_submissions s
    where (s.requirement_id = any (v_requirements)
        or (s.status = 'withdrawn' and s.withdrawn_at < now() - make_interval(days => v_days))
        or (s.status in ('declined_by_candidate', 'expired') and s.decided_at < now() - make_interval(days => v_days))
        or exists (select 1 from public.workforce_requirements r
                   where r.id = s.requirement_id and r.status in ('closed', 'filled')
                     and r.status_changed_at < now() - make_interval(days => v_days)))
      and not exists (select 1 from public.reports x
                      where x.candidate_submission_id = s.id and x.status in ('new', 'in_review'));
    get diagnostics v_removed = row_count;
    perform private.record_retention('candidate_submissions', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'partner_responses';
  if found then
    delete from public.partner_responses pr
    where (pr.requirement_id = any (v_requirements)
        or exists (select 1 from public.workforce_requirements r
                   where r.id = pr.requirement_id and r.status in ('closed', 'filled')
                     and r.status_changed_at < now() - make_interval(days => v_days)))
      and not exists (select 1 from public.reports x
                      where x.partner_response_id = pr.id and x.status in ('new', 'in_review'));
    get diagnostics v_removed = row_count;
    perform private.record_retention('partner_responses', v_days, v_removed);
  end if;

  if v_req_days is not null then
    delete from public.workforce_requirements r where r.id = any (v_requirements);
    get diagnostics v_removed = row_count;
    perform private.record_retention('closed_requirements', v_req_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'job_order_metrics';
  if found then
    delete from stats.job_order_partner_weeks w where w.week_start < (now() at time zone 'utc')::date - v_days;
    get diagnostics v_removed = row_count;
    delete from stats.job_order_response_refusals f where f.last_seen_at < now() - make_interval(days => v_days);
    get diagnostics v_more = row_count;
    perform private.record_retention('job_order_metrics', v_days, v_removed + v_more);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'conversations';
  if found then
    delete from public.conversations c
    where c.last_message_at < now() - make_interval(days => v_days)
      and not exists (
        select 1 from public.reports x join public.messages m on m.id = x.message_id
        where x.status in ('new', 'in_review') and m.conversation_id = c.id
      );
    get diagnostics v_removed = row_count;
    perform private.record_retention('conversations', v_days, v_removed);
  end if;

  -- An earlier request blocks the next one for contact_request_repeat_days, a decline for contact_request_decline_days
  -- (V70): the rows are kept at least that long whatever the period says.
  select p.days into v_days from private.retention_policies p where p.entity = 'contact_requests';
  if found then
    v_floor := greatest(v_days, coalesce((
      select case when s.value #>> '{}' ~ '^[0-9]{1,5}$' then (s.value #>> '{}')::integer end
      from private.settings s where s.key = 'contact_request_repeat_days'), 0));
    delete from public.contact_requests r
    where r.status <> 'declined'
      and coalesce(r.responded_at, r.withdrawn_at, case when r.status = 'expired' then r.expires_at end, r.created_at)
        < now() - make_interval(days => v_floor)
      and not (r.status = 'accepted'
               and exists (select 1 from public.conversations c where c.context_type = 'contact_request' and c.context_id = r.id))
      and not exists (select 1 from public.reports x where x.contact_request_id = r.id and x.status in ('new', 'in_review'));
    get diagnostics v_removed = row_count;
    perform private.record_retention('contact_requests', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'contact_request_declines';
  if found then
    v_floor := greatest(v_days, coalesce((
      select case when s.value #>> '{}' ~ '^[0-9]{1,5}$' then (s.value #>> '{}')::integer end
      from private.settings s where s.key = 'contact_request_decline_days'), 0));
    delete from public.contact_requests r
    where r.status = 'declined' and r.responded_at < now() - make_interval(days => v_floor)
      and not exists (select 1 from public.reports x where x.contact_request_id = r.id and x.status in ('new', 'in_review'));
    get diagnostics v_removed = row_count;
    perform private.record_retention('contact_request_declines', v_days, v_removed);
  end if;

  -- A saved card whose worker no longer shows it (hidden, suspended or closing): counted from the saving or from the
  -- worker's last withdrawal of the visibility consent, whichever is later.
  select p.days into v_days from private.retention_policies p where p.entity = 'saved_worker_cards';
  if found then
    delete from public.saved_worker_cards s
    using public.worker_profiles w
    where w.card_id = s.card_id
      and s.created_at < now() - make_interval(days => v_days)
      and not (w.searchable
               and exists (select 1 from public.profiles u where u.id = w.user_id and u.status = 'active' and u.deleted_at is null))
      and not exists (
        select 1 from public.consents c
        where c.user_id = w.user_id and c.purpose = 'worker-visibility-consent' and c.action = 'withdrawn'
          and c.created_at >= now() - make_interval(days => v_days)
      );
    get diagnostics v_removed = row_count;
    perform private.record_retention('saved_worker_cards', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'match_runs';
  if found then
    delete from public.match_runs r where r.created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('match_runs', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'inactive_worker_data';
  if found then
    perform private.record_retention('inactive_worker_data', v_days, private.request_inactive_erasures(v_days));
  end if;
end;
$$;

revoke all on function private.apply_retention() from public, anon, authenticated, service_role;

-- Public settings ---------------------------------------------------------------------------------------------------------

-- get_public_settings of 20270216200200_contact_request_public_periods.sql with release_chara_match, so the pages show or
-- hide CHARA Match from it.
create or replace function public.get_public_settings() returns table (key text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.value #>> '{}'
  from private.settings s
  where s.key = any (array[
    'legal_entity_name', 'legal_entity_address', 'legal_entity_registration_number', 'legal_entity_vat_id',
    'legal_entity_email', 'privacy_contact', 'data_protection_contact', 'release_partner_directories',
    'partner_review_target_working_days', 'licence_number_patterns', 'licence_valid_until_max_years',
    'workforce_listing_stale_days', 'workforce_confirm_reminder_days', 'workforce_available_from_max_days',
    'release_job_orders', 'release_candidate_submissions', 'release_messaging', 'release_find_workers',
    'release_data_export', 'requirement_open_days', 'requirement_extension_days', 'requirement_closing_reminder_days',
    'response_documents_max', 'message_body_max_chars', 'contact_request_repeat_days', 'contact_request_decline_days',
    'contact_request_expiry_days', 'release_chara_match'
  ])
$$;
