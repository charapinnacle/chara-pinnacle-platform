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
-- partner gets the reduced row: id, title, destination and number of workers with the reasons, nothing else (the reasons
-- tell no more than that row: a missing country is the main destination, and without a paid plan only plan_required).
--
-- The employer's name (decision 3.2, NFR-S11) is returned when the partner was invited, shortlisted or selected
-- (private.requirement_reveals, written by V41 and V45 through private.record_requirement_reveal), on a full or a reduced
-- row, and on a full row when the employer chose to show it (show_identity). The first time a revealed partner is shown
-- the name, seen_at is set and one audit row requirement.employer_revealed is written (SOP control "audit of reveals").
-- Where the name is not shown, no field leads to the employer: no organisation id, slug, website or logo; the title is
-- generated from destination, workers and main occupation, the skills text is left out and the city is left out when it
-- contains one of the employer's names (private.city_names_organization); the publication is given as a date, not a
-- time; the vacancies copied from an anonymous requirement carry neither its city nor its salary (20261223100000).

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

-- The key of a name or a place for comparing them: folded (accents removed, so ß is ss), the German spellings ae, oe and
-- ue taken as a, o and u (Müller, Muller and Mueller compare equal), everything but letters and digits a single space.
create function private.name_key(p_text text) returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(regexp_replace(private.fold_text(p_text), '([aou])e', '\1', 'g'), '[^[:alnum:]]+', ' ', 'g'))
$$;

revoke all on function private.name_key(text) from public, anon, authenticated, service_role;

-- The names of p_org as keys without their legal forms (GmbH, Ltd, AG, Sp. z o.o. and the like): the display name, the
-- legal name, the slug and the website's registrable label ("mueller-bau" for https://jobs.mueller-bau.co.uk). On a
-- social or hosting site the name is in the address instead: the first path segment that is not a generic one
-- (linkedin.com/company/mueller-bau gives mueller-bau) and a subdomain of the host (muellerbau.wixsite.com).
create function private.organization_name_keys(p_org uuid) returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_names text[];
  v_host text;
  v_labels text[];
  v_n integer;
  v_at integer;
  v_legal_forms text[] := '{gmbh,mbh,ltd,limited,ag,kg,kgaa,co,inc,incorporated,llc,llp,lp,sa,sas,sarl,bv,nv,oy,oyj,ab,as,asa,aps,sp,z,o,oo,srl,s,r,l,spa,sl,plc,ug,gbr,ohg,se,corp,corporation,pte,pty,pvt,haftungsbeschrankt,und,and,et,cie}'::text[];
  v_hosts text[] := '{facebook.com,fb.com,linkedin.com,instagram.com,twitter.com,x.com,xing.com,youtube.com,tiktok.com,wixsite.com,wordpress.com,blogspot.com,github.io,google.com,business.site,jimdosite.com,jimdo.com,weebly.com,squarespace.com,webnode.page,linktr.ee,t.me,wa.me,site123.me,strikingly.com,carrd.co,notion.site}'::text[];
  v_path_skip text[] := '{company,companies,pages,page,in,people,groups,group,channel,c,user,pg,p,profile,sites,site,view,home,www}'::text[];
begin
  select * into v_org from public.organizations o where o.id = p_org;
  v_names := array[v_org.display_name, v_org.legal_name, replace(v_org.slug, '-', ' ')];
  v_host := lower(substring(v_org.website from '^https?://(?:www\.)?([^/:?#]+)'));
  if v_host is not null then
    v_labels := string_to_array(v_host, '.');
    v_n := cardinality(v_labels);
    v_at := case
      when v_n >= 3 and char_length(v_labels[v_n]) = 2
        and v_labels[v_n - 1] in ('co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ltd', 'plc', 'or', 'ne') then v_n - 2
      else v_n - 1 end;
    if v_at >= 1 then
      if array_to_string(v_labels[v_at:v_n], '.') = any (v_hosts) then
        v_names := v_names || (
          select ltrim(seg.part, '@')
          from unnest(string_to_array(substring(v_org.website from '^https?://[^/]+/([^?#]*)'), '/')) with ordinality seg (part, n)
          where ltrim(seg.part, '@') <> '' and lower(ltrim(seg.part, '@')) <> all (v_path_skip)
          order by seg.n
          limit 1);
        if v_at > 1 then
          v_names := v_names || v_labels[v_at - 1];
        end if;
      else
        v_names := v_names || v_labels[v_at];
      end if;
    end if;
  end if;
  return array(
    select k.key
    from unnest(v_names) n (name)
    cross join lateral (
      select array_to_string(array(
        select w.word from regexp_split_to_table(private.name_key(n.name), ' ') with ordinality w (word, i)
        where w.word <> '' and w.word <> all (v_legal_forms) order by w.i), ' ') as key
    ) k
    where n.name is not null and k.key <> '');
end;
$$;

revoke all on function private.organization_name_keys(uuid) from public, anon, authenticated, service_role;

-- Whether the city or region p_city names p_org: a word of one of its names with four letters or more (generic words
-- such as jobs or group aside) is a word of the place, or a name of six letters or more, spaces and hyphens removed, is
-- inside the place with its spaces and hyphens removed ("Müller Bau" in "MUELLERBAU-Werk").
create function private.city_names_organization(p_city text, p_org uuid) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_city text := ' ' || private.name_key(p_city) || ' ';
  v_joined text := replace(private.name_key(p_city), ' ', '');
  v_name text;
  v_word text;
  v_generic text[] := '{jobs,karriere,career,careers,company,group,gruppe,holding,international,global,services,service,solutions,team,home,info,official,sites,site,view,personal,recruiting,recruitment,staffing,work,works,page,pages}'::text[];
begin
  if p_city is null then
    return false;
  end if;
  foreach v_name in array private.organization_name_keys(p_org) loop
    if char_length(replace(v_name, ' ', '')) >= 6 and position(replace(v_name, ' ', '') in v_joined) > 0 then
      return true;
    end if;
    foreach v_word in array string_to_array(v_name, ' ') loop
      if char_length(v_word) >= 4 and v_word <> all (v_generic) and position(' ' || v_word || ' ' in v_city) > 0 then
        return true;
      end if;
    end loop;
  end loop;
  return false;
end;
$$;

revoke all on function private.city_names_organization(text, uuid) from public, anon, authenticated, service_role;

-- The title of a job order shown without the employer's name: destination, number of workers and the main occupation
-- (the largest quantity, then the name), as in "Germany, 100 Welders and flame cutters" (FR-N1: the title is generated).
create function private.job_order_neutral_title(p_requirement uuid) returns text
language sql
stable
set search_path = ''
as $$
  select left(c.name || ', ' || concat_ws(' ', r.workers_needed, (
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

-- Why a partner with these facts sees only the title of a job order; empty when it is eligible (a paid plan, one of the
-- destinations served, one of the occupations listed). The reasons tell no more than the reduced row shows: a country
-- is missing when the main destination is not served (further destinations stay hidden), and a partner without a paid
-- plan is told only plan_required, so changing its profile reveals nothing of the occupations.
create function private.job_order_reasons(p_requirement uuid, p_paid boolean, p_served text[], p_occupations text[])
returns text[]
language sql
stable
set search_path = ''
as $$
  with f as (
    select
      exists (
        select 1 from public.requirement_countries rc where rc.requirement_id = p_requirement and rc.country_code = any (p_served)
      ) as served,
      exists (
        select 1 from public.workforce_requirements r where r.id = p_requirement and r.country_code = any (p_served)
      ) as served_main,
      exists (
        select 1 from public.requirement_occupations ro where ro.requirement_id = p_requirement and ro.occupation_id = any (p_occupations)
      ) as listed
  )
  select case
    when not p_paid then array['plan_required']
    when f.served and f.listed then '{}'::text[]
    else array_remove(array[
      case when not f.served_main then 'served_country_missing' end,
      case when not f.listed then 'occupation_missing' end
    ], null)
  end
  from f
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
-- CHARA_INVALID_INPUT naming the parameter (each range is checked first, then a minimum above the maximum names the
-- minimum; a cursor that is not a job order, p_cursor). A reduced row is filtered only on what it shows: with a filter on anything but the destination and
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
  if p_workers_min not between 1 and 100000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_workers_min';
  end if;
  if p_workers_max not between 1 and 100000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_workers_max';
  end if;
  if p_workers_min > p_workers_max then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_workers_min';
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
      p.revealed or (cardinality(p.why) = 0 and p.show_identity) as named
    from page p
  )
  select
    s.id,
    s.full_row,
    s.why,
    case when s.named then s.title else private.job_order_neutral_title(s.id) end,
    s.country_code,
    s.workers_needed,
    case when s.full_row then array(
      select rc.country_code from public.requirement_countries rc where rc.requirement_id = s.id
      order by rc.country_code <> s.country_code, rc.country_code) end,
    case when s.full_row and (s.named or not private.city_names_organization(s.city_region, s.organization_id))
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

  -- The reveals whose name was shown: every page row but the eligible ones the employer names anyway.
  perform private.mark_reveals_seen(p_org, array(
    select r.id from public.workforce_requirements r
    where r.id = any (v_ids)
      and not (r.show_identity
        and cardinality(private.job_order_reasons(r.id, v_facts.paid, v_facts.served, v_facts.occupations)) = 0)));
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
  v_revealed boolean;
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
  v_revealed := exists (
    select 1 from private.requirement_reveals rv where rv.requirement_id = v_row.id and rv.organization_id = p_org);
  v_named := v_revealed or (v_full and v_row.show_identity);
  v_count := private.requirement_response_count(v_row.id);

  return query select
    v_row.id,
    true,
    v_full,
    v_why,
    case when v_named then v_row.title else private.job_order_neutral_title(v_row.id) end,
    v_row.country_code,
    v_row.workers_needed,
    case when v_full then array(
      select rc.country_code from public.requirement_countries rc where rc.requirement_id = v_row.id
      order by rc.country_code <> v_row.country_code, rc.country_code) end,
    case when v_full and (v_named or not private.city_names_organization(v_row.city_region, v_row.organization_id))
      then v_row.city_region end,
    case when v_full then v_row.industry_code end,
    case when v_full then (
      select jsonb_agg(jsonb_build_object('code', ro.occupation_id, 'name', oc.label, 'quantity', ro.quantity)
        order by ro.quantity desc, oc.label)
      from public.requirement_occupations ro join public.occupations oc on oc.code = ro.occupation_id
      where ro.requirement_id = v_row.id) end,
    case when v_full and v_named then v_row.skills end,
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

  if v_revealed and not (v_full and v_row.show_identity) then
    perform private.mark_reveals_seen(p_org, array[v_row.id]);
  end if;
end;
$$;

revoke all on function public.get_job_order(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_job_order(uuid, uuid) to authenticated;
