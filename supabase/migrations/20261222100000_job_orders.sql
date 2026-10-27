-- The job order marketplace, data (FR-N1, SOP P2-19; decisions 3.1, 3.2, 3.6; NFR-S8, NFR-S11, NFR-P3, NFR-C8, NFR-O5;
-- docs/phase-2/DATA_MODEL.md sections 4, 6, 7 and 10; release 2b). A job order is a workforce requirement that is open,
-- has the visibility job_order_marketplace and belongs to an active employer; there is no job order table. A paused,
-- closed or filled requirement, or one of a suspended employer, leaves the marketplace at once, because both functions
-- read the requirement as it is (moderation of requirements arrives with V57, which adds its condition here).
--
-- list_job_orders and get_job_order answer the members of a listed, active, visible recruitment or staffing company
-- while release_job_orders is on. Every open job order is returned to such a partner; the full job order only when the
-- partner is eligible (decision 3.6): it serves one of the destinations, lists one of the occupations and is on a paid
-- partner plan whose features include job_order_access. A partner on a free plan code (never subscribed, or its
-- subscription lapsed) sees titles only whether entitlements_enforced is on or off, as DATA_MODEL.md section 4 says
-- ("regardless of entitlements_enforced"); with the switch on, a paid plan without the feature does too. Every other
-- partner gets the reduced row: id, title, destination and number of workers with the reasons, nothing else.
--
-- The employer's name (decision 3.2, NFR-S11) is returned only on a full row and only when the employer chose to show it
-- (show_identity) or the partner was invited, shortlisted or selected (private.requirement_reveals, written by V41 and
-- V45 through private.record_requirement_reveal). The first time a revealed partner is shown the name, seen_at is set and
-- one audit row requirement.employer_revealed is written (SOP control "audit of reveals"). Where the name is not shown,
-- no field leads to the employer: no organisation id, slug, website or logo is returned; a title, city or skills text that
-- contains the employer's display name, legal name, slug or website name is replaced by a neutral title or left out; the
-- publication is given as a date, not a time; the vacancies copied from the requirement do not name it (V35).
--
-- The order is newest first, then the id (published_at descending, id ascending), the same for every partner and every
-- plan; nothing in the order reads billing.* (NFR-C8), and the ranking page describes it. Calls are counted per user
-- like the partner searches (private.check_rate_limit 'job_orders', settings rate_limit_job_orders_max and _seconds).
-- stats.job_order_partner_weeks records the partner organisations that used the marketplace in each week (SOP KPI weekly
-- active partners), with no user and no job order. The response count arrives with V44, which replaces
-- private.requirement_response_count; the new job order alert and the pages are V40.

insert into private.settings (key, value) values
  ('rate_limit_job_orders_max', '60'),
  ('rate_limit_job_orders_seconds', '60'),
  ('job_order_response_count_min', '5')
on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('job_order_response_count_min', 'integer', 1, 20, 'Responses from which a job order shows their number', null);

-- The marketplace in its order, read from the newest page by page (FR-N1 AC12).
create index workforce_requirements_job_orders_idx
  on public.workforce_requirements (published_at desc, id)
  where status = 'open' and visibility = 'job_order_marketplace';

-- Reveals ------------------------------------------------------------------------------------------------------------------

-- One row per anonymous job order and partner that may see the employer's name: invited (V41), shortlisted or selected
-- (V45). The first cause is kept. seen_at is the first time the name was shown to the partner through the job order
-- functions. No API role reads it; the employer learns nothing from it.
create table private.requirement_reveals (
  requirement_id uuid not null references public.workforce_requirements (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  cause text not null check (cause in ('invitation', 'shortlist', 'selection')),
  revealed_at timestamptz not null default now(),
  seen_at timestamptz,
  primary key (requirement_id, organization_id),
  check (seen_at >= revealed_at)
);

comment on table private.requirement_reveals is
  'Partners to whom the employer name of an anonymous job order is revealed (decision 3.2): cause invitation, shortlist or selection, the time of the cause and the first time the name was shown. Written by private.record_requirement_reveal and the job order functions only.';

create index requirement_reveals_organization_idx on private.requirement_reveals (organization_id);

alter table private.requirement_reveals enable row level security;
alter table private.requirement_reveals force row level security;
revoke all on table private.requirement_reveals from public, anon, authenticated, service_role;

-- Records that p_partner may see the employer name of p_requirement because of p_cause; true when this is the first
-- reveal for the pair. For the invitation (V41) and response decision (V45) functions, which have checked both sides.
create function private.record_requirement_reveal(p_requirement uuid, p_partner uuid, p_cause text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.requirement_reveals (requirement_id, organization_id, cause)
  values (p_requirement, p_partner, p_cause)
  on conflict (requirement_id, organization_id) do nothing;
  return found;
end;
$$;

revoke all on function private.record_requirement_reveal(uuid, uuid, text) from public, anon, authenticated, service_role;

-- The KPI record ------------------------------------------------------------------------------------------------------------

-- One row per partner organisation and ISO week (Monday, UTC) in which one of its members opened the marketplace.
create table stats.job_order_partner_weeks (
  week_start date not null check (extract(isodow from week_start) = 1),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (week_start, organization_id)
);

comment on table stats.job_order_partner_weeks is
  'FR-N1 KPI "weekly active partners in the marketplace": the partner organisations whose members called list_job_orders or get_job_order in each ISO week, with the first and last time. No user and no job order. Written by the job order functions only; no API role reads it.';

create index job_order_partner_weeks_organization_idx on stats.job_order_partner_weeks (organization_id);

alter table stats.job_order_partner_weeks enable row level security;
alter table stats.job_order_partner_weeks force row level security;
revoke all on table stats.job_order_partner_weeks from public, anon, authenticated, service_role;

-- Helpers -------------------------------------------------------------------------------------------------------------------

-- The words of a text for comparing names: folded, everything but letters and digits a single space.
create function private.name_words(p_text text) returns text
language sql
immutable
set search_path = ''
as $$ select btrim(regexp_replace(private.fold_text(p_text), '[^[:alnum:]]+', ' ', 'g')) $$;

revoke all on function private.name_words(text) from public, anon, authenticated, service_role;

-- Whether p_text contains, as whole words, the display name, the legal name, the slug or the website name (host without
-- www, and its first label) of p_org. Names shorter than three characters are not looked for.
create function private.text_names_organization(p_text text, p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_text is not null and exists (
    select 1
    from public.organizations o
    cross join lateral (select lower(substring(o.website from '^https?://(?:www\.)?([^/:?#]+)')) as host) h
    cross join lateral unnest(array[o.display_name, o.legal_name, replace(o.slug, '-', ' '), h.host, split_part(h.host, '.', 1)])
      n (name)
    where o.id = p_org
      and char_length(private.name_words(n.name)) >= 3
      and position(' ' || private.name_words(n.name) || ' ' in ' ' || private.name_words(p_text) || ' ') > 0
  )
$$;

revoke all on function private.text_names_organization(text, uuid) from public, anon, authenticated, service_role;

-- The title of a job order whose own title would name a hidden employer: destination, number of workers and the main
-- occupation (the largest quantity, then the name), as in "Germany, 100 Welders and flame cutters".
create function private.job_order_neutral_title(p_requirement uuid) returns text
language sql
stable
set search_path = ''
as $$
  select left(format('%s, %s %s', c.name, r.workers_needed, (
      select oc.label from public.requirement_occupations ro join public.occupations oc on oc.code = ro.occupation_id
      where ro.requirement_id = r.id order by ro.quantity desc, oc.label limit 1)), 120)
  from public.workforce_requirements r
  join public.countries c on c.code = r.country_code
  where r.id = p_requirement
$$;

revoke all on function private.job_order_neutral_title(uuid) from public, anon, authenticated, service_role;

-- The responses a job order has received that are not withdrawn. No response exists before V44, which replaces this.
create function private.requirement_response_count(p_requirement uuid) returns integer
language sql
stable
set search_path = ''
as $$ select 0 where p_requirement is not null $$;

revoke all on function private.requirement_response_count(uuid) from public, anon, authenticated, service_role;

-- What decides the eligibility of a partner (decision 3.6): a paid plan code with the feature job_order_access (the
-- feature check passes on every plan while entitlements_enforced is off and the organisation is not restricted, the plan
-- code check never does), the countries it serves and the occupations it lists.
create function private.job_order_partner_facts(p_org uuid, out paid boolean, out served text[], out occupations text[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.org_plan_code(p_org) not like 'free\_%' and private.has_feature(p_org, 'job_order_access'),
    array(select g.country_code from public.organization_geographies g where g.organization_id = p_org and g.scope = 'serves_market'),
    array(select oo.occupation_id from public.organization_occupations oo where oo.organization_id = p_org)
$$;

revoke all on function private.job_order_partner_facts(uuid) from public, anon, authenticated, service_role;

-- Why a partner with these facts sees only the title of a job order, in a fixed order; empty when it is eligible.
create function private.job_order_reasons(p_requirement uuid, p_paid boolean, p_served text[], p_occupations text[])
returns text[]
language sql
stable
set search_path = ''
as $$
  select array_remove(array[
    case when not exists (
      select 1 from public.requirement_countries rc where rc.requirement_id = p_requirement and rc.country_code = any (p_served)
    ) then 'served_country_missing' end,
    case when not exists (
      select 1 from public.requirement_occupations ro where ro.requirement_id = p_requirement and ro.occupation_id = any (p_occupations)
    ) then 'occupation_missing' end,
    case when not p_paid then 'plan_required' end
  ], null)
$$;

revoke all on function private.job_order_reasons(uuid, boolean, text[], text[]) from public, anon, authenticated, service_role;

-- The checks every job order read starts with. Refusals (CHARA_FORBIDDEN, 42501): no session or not an accepted member
-- of p_org; release_off; partner_only for an employer; organization_suspended; not_listed (never listed, declined);
-- profile_hidden (hidden by moderation). Over the allowance, CHARA_RATE_LIMITED. Records the week's use.
create function private.assert_job_order_partner(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
begin
  if v_uid is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_job_orders') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.check_rate_limit('job_orders', v_uid);
  select * into v_org from public.organizations o where o.id = p_org;
  if v_org.type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'partner_only', errcode = '42501';
  end if;
  if v_org.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended', errcode = '42501';
  end if;
  if not private.is_listed_partner(p_org) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'not_listed', errcode = '42501';
  end if;
  if v_org.moderation_state <> 'visible' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_hidden', errcode = '42501';
  end if;
  insert into stats.job_order_partner_weeks as w (week_start, organization_id)
  values (date_trunc('week', now() at time zone 'utc')::date, p_org)
  on conflict (week_start, organization_id) do update set last_seen_at = now();
end;
$$;

revoke all on function private.assert_job_order_partner(uuid) from public, anon, authenticated, service_role;

-- Marks the reveals of p_requirements to p_org as seen (those not yet seen) and writes one audit row each.
create function private.mark_reveals_seen(p_org uuid, p_requirements uuid[]) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen record;
begin
  for v_seen in
    update private.requirement_reveals rv set seen_at = now()
    where rv.organization_id = p_org and rv.requirement_id = any (p_requirements) and rv.seen_at is null
    returning rv.requirement_id, rv.cause
  loop
    perform audit.record('requirement.employer_revealed', 'requirement', v_seen.requirement_id::text,
      jsonb_build_object('organization_id', p_org, 'cause', v_seen.cause));
  end loop;
end;
$$;

revoke all on function private.mark_reveals_seen(uuid, uuid[]) from public, anon, authenticated, service_role;

-- The list ------------------------------------------------------------------------------------------------------------------

-- The open job orders for the partner p_org (FR-N1 AC1 to AC6, AC8), newest first, pages of 20 by default and at most
-- 50, next_cursor (the id of the last row) on the last row of a page that has a next one. Filters, all optional and
-- combined: destination (any destination of the job order), source country (job orders recruiting internationally or
-- both, and local ones whose destination it is), occupation, industry, workers from and to (1 to 100,000), start date
-- from and to, recruitment type local or international (job orders of that type or both). Codes are checked for their
-- shape only: an unknown code answers no rows. Refusals: those of private.assert_job_order_partner, then
-- CHARA_INVALID_INPUT naming the parameter (a minimum above the maximum names the minimum; a cursor that is not a job
-- order, p_cursor). A reduced row is filtered only on what it shows: with a filter on anything but the destination and
-- the number of workers, the list holds eligible job orders only, so a filter never tells a partner what it cannot see.
create function public.list_job_orders(
  p_org uuid,
  p_destination text default null,
  p_source text default null,
  p_occupation text default null,
  p_industry text default null,
  p_workers_min integer default null,
  p_workers_max integer default null,
  p_start_from date default null,
  p_start_to date default null,
  p_recruitment public.recruitment_preference default null,
  p_cursor uuid default null,
  p_limit integer default null
) returns table (
  id uuid,
  eligible boolean,
  reasons text[],
  title text,
  country_code text,
  workers_needed integer,
  countries text[],
  city_region text,
  industry_code text,
  occupations jsonb,
  start_date date,
  employment_type public.employment_type,
  recruitment_preference public.recruitment_preference,
  published_on date,
  response_count integer,
  responses_fewer_than integer,
  employer_name text,
  employer_company_slug text,
  next_cursor uuid
)
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_destination text := upper(p_destination);
  v_source text := upper(p_source);
  v_industry text := upper(p_industry);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_count_min integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'job_order_response_count_min'), 5);
  v_reduced_filtered boolean := p_source is not null or p_occupation is not null or p_industry is not null
    or p_start_from is not null or p_start_to is not null or p_recruitment is not null;
  v_facts record;
  v_cursor_published timestamptz;
  v_ids uuid[];
  v_more boolean;
begin
  perform private.assert_job_order_partner(p_org);

  if v_destination !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_destination';
  end if;
  if v_source !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_source';
  end if;
  if p_occupation !~ '^[0-9]{4}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_occupation';
  end if;
  if v_industry !~ '^[A-Z]$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_industry';
  end if;
  if p_workers_min not between 1 and 100000 or p_workers_min > p_workers_max then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_workers_min';
  end if;
  if p_workers_max not between 1 and 100000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_workers_max';
  end if;
  if p_start_from > p_start_to then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_start_from';
  end if;
  if p_recruitment = 'both' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_recruitment';
  end if;
  if p_cursor is not null then
    select r.published_at into v_cursor_published
    from public.workforce_requirements r
    where r.id = p_cursor and r.visibility = 'job_order_marketplace';
    if v_cursor_published is null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end if;
  end if;

  select * into v_facts from private.job_order_partner_facts(p_org);

  select coalesce(array_agg(j.id order by j.published_at desc, j.id), '{}') into v_ids
  from (
    select r.id, r.published_at
    from public.workforce_requirements r
    join public.organizations e on e.id = r.organization_id
    where r.status = 'open' and r.visibility = 'job_order_marketplace' and e.status = 'active'
      and (p_cursor is null or r.published_at < v_cursor_published or (r.published_at = v_cursor_published and r.id > p_cursor))
      and (p_workers_min is null or r.workers_needed >= p_workers_min)
      and (p_workers_max is null or r.workers_needed <= p_workers_max)
      and (v_destination is null or exists (
        select 1 from public.requirement_countries rc where rc.requirement_id = r.id and rc.country_code = v_destination
      ))
      and (p_occupation is null or exists (
        select 1 from public.requirement_occupations ro where ro.requirement_id = r.id and ro.occupation_id = p_occupation
      ))
      and (v_industry is null or r.industry_code = v_industry)
      and (p_start_from is null or r.start_date >= p_start_from)
      and (p_start_to is null or r.start_date <= p_start_to)
      and (p_recruitment is null or r.recruitment_preference in ('both', p_recruitment))
      and (v_source is null or r.recruitment_preference <> 'local' or exists (
        select 1 from public.requirement_countries rc where rc.requirement_id = r.id and rc.country_code = v_source
      ))
      and case
        when not v_reduced_filtered and (v_destination is null or r.country_code = v_destination) then true
        else cardinality(private.job_order_reasons(r.id, v_facts.paid, v_facts.served, v_facts.occupations)) = 0
      end
    order by r.published_at desc, r.id
    limit v_limit + 1
  ) j;

  v_more := cardinality(v_ids) > v_limit;
  v_ids := v_ids[1:v_limit];

  return query
  with page as (
    select
      u.n, r.*, e.display_name, e.slug, e.public_page_enabled,
      private.job_order_reasons(r.id, v_facts.paid, v_facts.served, v_facts.occupations) as why,
      exists (
        select 1 from private.requirement_reveals rv where rv.requirement_id = r.id and rv.organization_id = p_org
      ) as revealed
    from unnest(v_ids) with ordinality u (id, n)
    join public.workforce_requirements r on r.id = u.id
    join public.organizations e on e.id = r.organization_id
  ),
  shown as (
    select p.*, cardinality(p.why) = 0 as full_row,
      cardinality(p.why) = 0 and (p.show_identity or p.revealed) as named
    from page p
  )
  select
    s.id,
    s.full_row,
    s.why,
    case when not s.named and private.text_names_organization(s.title, s.organization_id)
      then private.job_order_neutral_title(s.id) else s.title end,
    s.country_code,
    s.workers_needed,
    case when s.full_row then array(
      select rc.country_code from public.requirement_countries rc where rc.requirement_id = s.id
      order by rc.country_code <> s.country_code, rc.country_code) end,
    case when s.full_row and (s.named or not private.text_names_organization(s.city_region, s.organization_id))
      then s.city_region end,
    case when s.full_row then s.industry_code end,
    case when s.full_row then (
      select jsonb_agg(jsonb_build_object('code', ro.occupation_id, 'name', oc.label, 'quantity', ro.quantity)
        order by ro.quantity desc, oc.label)
      from public.requirement_occupations ro join public.occupations oc on oc.code = ro.occupation_id
      where ro.requirement_id = s.id) end,
    case when s.full_row then s.start_date end,
    case when s.full_row then s.employment_type end,
    case when s.full_row then s.recruitment_preference end,
    case when s.full_row then (s.published_at at time zone 'utc')::date end,
    case when s.full_row and private.requirement_response_count(s.id) >= v_count_min
      then private.requirement_response_count(s.id) end,
    case when s.full_row and private.requirement_response_count(s.id) < v_count_min then v_count_min end,
    case when s.named then s.display_name end,
    case when s.named and s.public_page_enabled then s.slug end,
    case when v_more and s.n = v_limit then s.id end
  from shown s
  order by s.n;

  perform private.mark_reveals_seen(p_org, array(
    select r.id from public.workforce_requirements r
    where r.id = any (v_ids) and not r.show_identity
      and cardinality(private.job_order_reasons(r.id, v_facts.paid, v_facts.served, v_facts.occupations)) = 0));
end;
$$;

revoke all on function public.list_job_orders(
  uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_job_orders(
  uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer
) to authenticated;

-- One job order --------------------------------------------------------------------------------------------------------------

-- The job order p_requirement for the partner p_org (FR-N1 AC2, AC3, AC5; the detail page of V40). The refusals of
-- private.assert_job_order_partner; CHARA_NOT_FOUND for a requirement that never was on the marketplace (a draft, a
-- private requirement, an unknown id). A marketplace requirement that is no longer open (paused, closed, filled, or its
-- employer suspended) answers one row with open false and nothing else but its id. An open one answers the full job
-- order to an eligible partner, with the terms the list leaves out, and the reduced row otherwise; the employer name as
-- in list_job_orders.
create function public.get_job_order(p_org uuid, p_requirement uuid)
returns table (
  id uuid,
  open boolean,
  eligible boolean,
  reasons text[],
  title text,
  country_code text,
  workers_needed integer,
  countries text[],
  city_region text,
  industry_code text,
  occupations jsonb,
  skills text,
  experience_years smallint,
  start_date date,
  duration_months smallint,
  employment_type public.employment_type,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_period public.salary_period,
  accommodation boolean,
  work_permit_support boolean,
  visa_support boolean,
  recruitment_preference public.recruitment_preference,
  partner_need public.partner_need,
  published_on date,
  closes_on date,
  response_count integer,
  responses_fewer_than integer,
  employer_name text,
  employer_company_slug text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
  v_employer public.organizations;
  v_facts record;
  v_why text[];
  v_full boolean;
  v_named boolean;
  v_count integer;
  v_count_min integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'job_order_response_count_min'), 5);
begin
  perform private.assert_job_order_partner(p_org);

  select * into v_row from public.workforce_requirements r
  where r.id = p_requirement and r.visibility = 'job_order_marketplace';
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_employer from public.organizations o where o.id = v_row.organization_id;
  if v_row.status <> 'open' or v_employer.status <> 'active' then
    return query select v_row.id, false, null::boolean, null::text[], null::text, null::text, null::integer, null::text[],
      null::text, null::text, null::jsonb, null::text, null::smallint, null::date, null::smallint, null::public.employment_type,
      null::numeric, null::numeric, null::text, null::public.salary_period, null::boolean, null::boolean, null::boolean,
      null::public.recruitment_preference, null::public.partner_need, null::date, null::date, null::integer, null::integer,
      null::text, null::text;
    return;
  end if;

  select * into v_facts from private.job_order_partner_facts(p_org);
  v_why := private.job_order_reasons(v_row.id, v_facts.paid, v_facts.served, v_facts.occupations);
  v_full := cardinality(v_why) = 0;
  v_named := v_full and (v_row.show_identity or exists (
    select 1 from private.requirement_reveals rv where rv.requirement_id = v_row.id and rv.organization_id = p_org));
  v_count := private.requirement_response_count(v_row.id);

  return query select
    v_row.id,
    true,
    v_full,
    v_why,
    case when not v_named and private.text_names_organization(v_row.title, v_row.organization_id)
      then private.job_order_neutral_title(v_row.id) else v_row.title end,
    v_row.country_code,
    v_row.workers_needed,
    case when v_full then array(
      select rc.country_code from public.requirement_countries rc where rc.requirement_id = v_row.id
      order by rc.country_code <> v_row.country_code, rc.country_code) end,
    case when v_full and (v_named or not private.text_names_organization(v_row.city_region, v_row.organization_id))
      then v_row.city_region end,
    case when v_full then v_row.industry_code end,
    case when v_full then (
      select jsonb_agg(jsonb_build_object('code', ro.occupation_id, 'name', oc.label, 'quantity', ro.quantity)
        order by ro.quantity desc, oc.label)
      from public.requirement_occupations ro join public.occupations oc on oc.code = ro.occupation_id
      where ro.requirement_id = v_row.id) end,
    case when v_full and (v_named or not private.text_names_organization(v_row.skills, v_row.organization_id))
      then v_row.skills end,
    case when v_full then v_row.experience_years end,
    case when v_full then v_row.start_date end,
    case when v_full then v_row.duration_months end,
    case when v_full then v_row.employment_type end,
    case when v_full then v_row.salary_min end,
    case when v_full then v_row.salary_max end,
    case when v_full then v_row.salary_currency end,
    case when v_full then v_row.salary_period end,
    case when v_full then v_row.accommodation end,
    case when v_full then v_row.work_permit_support end,
    case when v_full then v_row.visa_support end,
    case when v_full then v_row.recruitment_preference end,
    case when v_full then v_row.partner_need end,
    case when v_full then (v_row.published_at at time zone 'utc')::date end,
    case when v_full then v_row.closes_on end,
    case when v_full and v_count >= v_count_min then v_count end,
    case when v_full and v_count < v_count_min then v_count_min end,
    case when v_named then v_employer.display_name end,
    case when v_named and v_employer.public_page_enabled then v_employer.slug end;

  if v_full and not v_row.show_identity then
    perform private.mark_reveals_seen(p_org, array[v_row.id]);
  end if;
end;
$$;

revoke all on function public.get_job_order(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_job_order(uuid, uuid) to authenticated;
