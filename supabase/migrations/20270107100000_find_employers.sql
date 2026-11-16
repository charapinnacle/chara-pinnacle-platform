-- Find employers for partners (FR-L3, SOP P2-12; decisions 2.2, 3.2, 3.6; NFR-S8, NFR-S11, NFR-C8, NFR-M3;
-- docs/phase-2/DATA_MODEL.md sections 2, 7 and 10; release 2b). search_employers answers the members of a listed, active,
-- visible recruitment or staffing company on a paid partner plan with the feature employer_discovery, while
-- release_job_orders is on. It returns two kinds of rows, never joined by a key the partner can read:
--   company    an active employer whose company page is public (FR-K5, while release 2a is on), or that is named on at
--              least one open job order this partner sees; with its named job orders that fit the filters
--   job_order  an open job order whose employer is not named to this partner (decision 3.2): no employer column at all
-- Which job orders a partner sees, in full or reduced, and when the employer is named, is that of list_job_orders (FR-N1):
-- the same private.job_order_reasons and reveals, the same neutral title, and a filter on a detail a reduced row does not
-- show (industry, occupation) returns eligible job orders only.
--
-- Depth (decision 2.2, FR-L3 open point): destination and industry with employer_discovery; occupation, minimum size and
-- saved searches with advanced_employer_discovery. A partner on a free plan code is refused whatever entitlements_enforced
-- says, as the job order eligibility of decision 3.6 is.
--
-- The order is the latest activity, then the id: for a company the newest publication of a named job order that fits or,
-- while its page is public and no job-order-only filter is given, of an open vacancy on the page; for an anonymous job
-- order its publication. Nothing in it reads billing.* (NFR-C8) and the ranking page describes it. Calls are counted per
-- partner organisation (private.check_rate_limit 'employer_search', settings rate_limit_employer_search_max and _seconds);
-- the first page of a search is logged in stats.partner_searches as kind employers, with nothing personal.

insert into private.settings (key, value) values
  ('rate_limit_employer_search_max', '60'),
  ('rate_limit_employer_search_seconds', '60')
on conflict (key) do nothing;

-- The search log --------------------------------------------------------------------------------------------------------------

alter table stats.partner_searches drop constraint partner_searches_kind_check;
alter table stats.partner_searches add constraint partner_searches_kind_check
  check (kind in ('recruitment', 'staffing', 'available_workforce', 'employers'));

alter table stats.partner_searches drop constraint partner_searches_filter_names_check;
alter table stats.partner_searches add constraint partner_searches_filter_names_check check (
  filter_names <@ array['destination', 'occupation', 'based_in', 'sources_from', 'industry', 'language', 'recruitment_type',
                        'staffing_type', 'workforce_size', 'capacity', 'timeframe', 'min_workers']
);

comment on table stats.partner_searches is
  'One row per first page of a Find Partners search (FR-L1, FR-L2 KPIs: share of searches with at least one result, zero-result searches by destination), of an available-workforce search (FR-K3) or of a Find Employers search (FR-L3, kind employers). Holds no user, organisation, address, session or free text. result_count is the number of results on the first page (at most the page size), so it tells zero from some. Written by search_partners, search_available_workforce and search_employers, read through admin_partner_search_stats, kept for partner_searches days.';

-- admin_partner_search_stats of 20261203100100 with the kind employers among the kinds it reads.
create or replace function public.admin_partner_search_stats(p_kind text, p_from date, p_to date)
returns table (searches bigint, with_results bigint, zero_results bigint, zero_by_destination jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('recruitment', 'staffing', 'available_workforce', 'employers') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_kind';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'range';
  end if;

  return query
  with period as (
    select s.destination_country, s.result_count
    from stats.partner_searches s
    where s.kind = p_kind
      and s.created_at >= p_from::timestamp at time zone 'UTC' and s.created_at < (p_to + 1)::timestamp at time zone 'UTC'
  )
  select
    count(*),
    count(*) filter (where p.result_count > 0),
    count(*) filter (where p.result_count = 0),
    (select coalesce(jsonb_agg(jsonb_build_object('code', z.code, 'name', z.name, 'searches', z.n) order by z.n desc, z.name), '[]'::jsonb)
     from (
       select c.code, c.name, count(*) as n
       from period q
       join public.countries c on c.code = q.destination_country
       where q.result_count = 0
       group by c.code, c.name
       order by n desc, c.name
       limit 10
     ) z)
  from period p;
end;
$$;

revoke all on function public.admin_partner_search_stats(text, date, date) from public, anon, authenticated, service_role;
grant execute on function public.admin_partner_search_stats(text, date, date) to authenticated;

-- Saved searches --------------------------------------------------------------------------------------------------------------

-- The filters are columns with foreign keys to the code lists (NFR-M3) rather than the JSON of DATA_MODEL.md, so a saved
-- search can never hold a code that does not exist.
create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'employers' check (kind = 'employers'),
  destination_country text references public.countries (code),
  industry_code text references public.industries (code),
  occupation_id text references public.occupations (code),
  min_workers integer check (min_workers between 1 and 100000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(destination_country, industry_code, occupation_id, min_workers) > 0),
  constraint saved_searches_filters_key
    unique nulls not distinct (organization_id, kind, destination_country, industry_code, occupation_id, min_workers)
);

comment on table public.saved_searches is
  'The Find Employers searches a recruitment or staffing company saved (FR-L3 AC9), shared by its members. Written only by save_employer_search and delete_saved_search; created_by is cleared with the profile.';

create index saved_searches_list_idx on public.saved_searches (organization_id, created_at desc, id);
create index saved_searches_created_by_idx on public.saved_searches (created_by);

alter table public.saved_searches enable row level security;
alter table public.saved_searches force row level security;
revoke all on table public.saved_searches from public, anon, authenticated, service_role;
grant select on public.saved_searches to authenticated;

create policy saved_searches_select_member on public.saved_searches
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- Helpers ---------------------------------------------------------------------------------------------------------------------

-- The checks every Find Employers call starts with. CHARA_NOT_FOUND while release_job_orders is off; CHARA_FORBIDDEN
-- (42501) without a session or for a caller who is not an accepted member of p_org, then with the detail partner_only,
-- organization_suspended, not_listed or profile_hidden; CHARA_FEATURE_NOT_IN_PLAN employer_discovery for a free plan code
-- or a plan without the feature.
create function private.assert_employer_search_partner(p_org uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if not private.release_on('release_job_orders') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
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
  if private.org_plan_code(p_org) like 'free\_%' or not private.has_feature(p_org, 'employer_discovery') then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'employer_discovery';
  end if;
end;
$$;

revoke all on function private.assert_employer_search_partner(uuid) from public, anon, authenticated, service_role;

-- The open job orders the partner p_org sees that fit the filters, with whether it sees them in full, why not, and whether
-- the employer is named to it (as list_job_orders decides both). A reduced row is kept only when no filter asks for a
-- detail it does not show (industry, occupation) and the destination, if given, is its main one.
create function private.employer_search_job_orders(
  p_org uuid, p_destination text, p_industry text, p_occupation text, p_min_workers integer
) returns table (
  id uuid,
  organization_id uuid,
  published_at timestamptz,
  full_row boolean,
  named boolean,
  revealed boolean,
  show_identity boolean,
  why text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with facts as (
    select * from private.job_order_partner_facts(p_org)
  ),
  fitting as (
    select r.id, r.organization_id, r.published_at, r.country_code, r.show_identity,
      private.job_order_reasons(r.id, f.paid, f.served, f.occupations) as why,
      exists (
        select 1 from private.requirement_reveals rv where rv.requirement_id = r.id and rv.organization_id = p_org
      ) as revealed
    from public.workforce_requirements r
    join public.organizations e on e.id = r.organization_id
    cross join facts f
    where r.status = 'open' and r.visibility = 'job_order_marketplace' and e.status = 'active'
      and (p_min_workers is null or r.workers_needed >= p_min_workers)
      and (p_destination is null or exists (
        select 1 from public.requirement_countries rc where rc.requirement_id = r.id and rc.country_code = p_destination
      ))
      and (p_occupation is null or exists (
        select 1 from public.requirement_occupations ro where ro.requirement_id = r.id and ro.occupation_id = p_occupation
      ))
      and (p_industry is null or r.industry_code = p_industry)
  )
  select j.id, j.organization_id, j.published_at, cardinality(j.why) = 0,
    j.revealed or (cardinality(j.why) = 0 and j.show_identity), j.revealed, j.show_identity, j.why
  from fitting j
  where cardinality(j.why) = 0
     or (p_occupation is null and p_industry is null and (p_destination is null or j.country_code = p_destination))
$$;

revoke all on function private.employer_search_job_orders(uuid, text, text, text, integer)
  from public, anon, authenticated, service_role;

-- One job order of a result as the partner may read it: the employer's own title only when it is named, otherwise the
-- neutral title; industry and publication date only on a full row; no city, skills or employer field.
create function private.employer_search_job_order(p_requirement uuid, p_full boolean, p_named boolean, p_why text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'eligible', p_full,
    'reasons', to_jsonb(p_why),
    'title', case when p_named then r.title else private.job_order_neutral_title(r.id) end,
    'country_code', r.country_code,
    'workers_needed', r.workers_needed,
    'industry_code', case when p_full then r.industry_code end,
    'published_on', case when p_full then (r.published_at at time zone 'utc')::date end
  )
  from public.workforce_requirements r
  where r.id = p_requirement
$$;

revoke all on function private.employer_search_job_order(uuid, boolean, boolean, text[])
  from public, anon, authenticated, service_role;

-- Whether the partner p_org may use the advanced filters and saved searches, for the page to show them or show them
-- locked (FR-L3 AC9), after the checks of private.assert_employer_search_partner, whose refusals the page shows instead
-- of the form (AC8). Not counted against the search allowance: it reads no employer.
create function public.employer_search_access(p_org uuid) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_employer_search_partner(p_org);
  return private.has_feature(p_org, 'advanced_employer_discovery');
end;
$$;

revoke all on function public.employer_search_access(uuid) from public, anon, authenticated, service_role;
grant execute on function public.employer_search_access(uuid) to authenticated;

-- The search -------------------------------------------------------------------------------------------------------------------

-- Find Employers for the partner p_org (FR-L3 AC1 to AC6, AC10). Filters, all optional and combined: destination (a
-- destination of the job order; for a public page, the country it is based in or of one of its open vacancies), industry
-- (of the job order; of the employer for a public page), occupation and minimum workers (job orders only, so a company
-- then needs a named job order that fits). Codes are checked for their shape only: an unknown code answers no rows. Pages
-- of 20 by default and at most 50; next_cursor (the id of the last row) on the last row of a page that has a next one.
-- A company row lists at most its five newest fitting named job orders; job_order_count counts them all. Refusals: those
-- of private.assert_employer_search_partner, CHARA_RATE_LIMITED, CHARA_INVALID_INPUT naming the parameter (a cursor that
-- is no longer a result, p_cursor), then CHARA_FEATURE_NOT_IN_PLAN advanced_employer_discovery for occupation or size.
create function public.search_employers(
  p_org uuid,
  p_destination text default null,
  p_industry text default null,
  p_occupation text default null,
  p_min_workers integer default null,
  p_cursor uuid default null,
  p_limit integer default null
) returns table (
  kind text,
  employer_id uuid,
  display_name text,
  slug text,
  website text,
  based_in_country text,
  industry_code text,
  open_vacancy_count integer,
  job_order_count integer,
  job_orders jsonb,
  next_cursor uuid
)
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_destination text := upper(p_destination);
  v_industry text := upper(p_industry);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_pages boolean := private.release_on('release_partner_directories');
  v_page_filters boolean := p_occupation is null and p_min_workers is null;
  v_jo jsonb;
  v_ids uuid[];
  v_kinds text[];
  v_from integer := 0;
  v_more boolean;
begin
  perform private.assert_employer_search_partner(p_org);
  perform private.check_rate_limit('employer_search', p_org);

  if v_destination !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_destination';
  end if;
  if v_industry !~ '^[A-Z]$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_industry';
  end if;
  if p_occupation !~ '^[0-9]{4}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_occupation';
  end if;
  if p_min_workers not between 1 and 100000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_min_workers';
  end if;
  if not v_page_filters and not private.has_feature(p_org, 'advanced_employer_discovery') then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'advanced_employer_discovery';
  end if;

  select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb) into v_jo
  from private.employer_search_job_orders(p_org, v_destination, v_industry, p_occupation, p_min_workers) j;

  with jo as (
    select * from jsonb_to_recordset(v_jo) as x (id uuid, organization_id uuid, published_at timestamptz, named boolean)
  ),
  companies as (
    select e.id,
      greatest(
        (select max(j.published_at) from jo j where j.organization_id = e.id and j.named),
        case when v_pages and e.public_page_enabled and v_page_filters then (
          select max(coalesce(v.published_at, v.created_at)) from public.jobs v
          where v.organization_id = e.id and v.status = 'open' and v.deleted_at is null and v.moderation_state = 'visible'
        ) end
      ) as sort_at
    from public.organizations e
    where e.type = 'employer' and e.status = 'active'
      and (
        (v_pages and e.public_page_enabled and v_page_filters
          and (v_industry is null or e.industry_code = v_industry)
          and (v_destination is null or e.based_in_country = v_destination or exists (
            select 1 from public.jobs v
            where v.organization_id = e.id and v.country_code = v_destination and v.status = 'open'
              and v.deleted_at is null and v.moderation_state = 'visible'
          )))
        or exists (select 1 from jo j where j.organization_id = e.id and j.named)
      )
  ),
  r as (
    select 'company' as kind, c.id, c.sort_at from companies c
    union all
    select 'job_order', j.id, j.published_at from jo j where not j.named
  )
  select coalesce(array_agg(r.id order by r.sort_at desc nulls last, r.id), '{}'),
    coalesce(array_agg(r.kind order by r.sort_at desc nulls last, r.id), '{}')
  into v_ids, v_kinds
  from r;

  if p_cursor is not null then
    v_from := array_position(v_ids, p_cursor);
    if v_from is null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end if;
  end if;
  v_more := cardinality(v_ids) > v_from + v_limit;
  v_ids := v_ids[v_from + 1:v_from + v_limit];
  v_kinds := v_kinds[v_from + 1:v_from + v_limit];

  return query
  with jo as (
    select * from jsonb_to_recordset(v_jo)
      as x (id uuid, organization_id uuid, published_at timestamptz, full_row boolean, named boolean, why text[])
  ),
  page as (
    select u.id, u.n, v_kinds[u.n] as kind from unnest(v_ids) with ordinality u (id, n)
  )
  select
    p.kind,
    e.id,
    e.display_name,
    case when v_pages and e.public_page_enabled then e.slug end,
    case when v_pages and e.public_page_enabled then e.website end,
    case when v_pages and e.public_page_enabled then e.based_in_country end,
    case when v_pages and e.public_page_enabled then e.industry_code end,
    case when v_pages and e.public_page_enabled then (
      select count(*)::integer from public.jobs v
      where v.organization_id = e.id and v.status = 'open' and v.deleted_at is null and v.moderation_state = 'visible'
    ) end,
    case when p.kind = 'company'
      then (select count(*)::integer from jo j where j.organization_id = p.id and j.named)
      else 1 end,
    case when p.kind = 'company' then (
      select coalesce(jsonb_agg(private.employer_search_job_order(t.id, t.full_row, t.named, t.why)
        order by t.published_at desc, t.id), '[]'::jsonb)
      from (
        select j.* from jo j where j.organization_id = p.id and j.named order by j.published_at desc, j.id limit 5
      ) t)
    else (
      select jsonb_build_array(private.employer_search_job_order(j.id, j.full_row, j.named, j.why)) from jo j where j.id = p.id
    ) end,
    case when v_more and p.n = cardinality(v_ids) then p.id end
  from page p
  left join public.organizations e on p.kind = 'company' and e.id = p.id
  order by p.n;

  -- The reveals whose name a company row showed: its listed job orders but those the employer names anyway.
  perform private.mark_reveals_seen(p_org, array(
    select t.id
    from unnest(v_ids) with ordinality u (id, n)
    cross join lateral (
      select j.id, j.full_row, j.show_identity
      from jsonb_to_recordset(v_jo)
        as j (id uuid, organization_id uuid, published_at timestamptz, full_row boolean, named boolean, show_identity boolean)
      where j.organization_id = u.id and j.named
      order by j.published_at desc, j.id
      limit 5
    ) t
    where v_kinds[u.n] = 'company' and not (t.full_row and t.show_identity)));

  if p_cursor is null then
    insert into stats.partner_searches (kind, filter_names, destination_country, result_count)
    values (
      'employers',
      array_remove(array[
        case when v_destination is not null then 'destination' end,
        case when v_industry is not null then 'industry' end,
        case when p_occupation is not null then 'occupation' end,
        case when p_min_workers is not null then 'min_workers' end
      ], null),
      (select c.code from public.countries c where c.code = v_destination),
      cardinality(v_ids)
    );
  end if;
end;
$$;

revoke all on function public.search_employers(uuid, text, text, text, integer, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_employers(uuid, text, text, text, integer, uuid, integer) to authenticated;

-- Saving a search (FR-L3 AC9) --------------------------------------------------------------------------------------------------

-- Saves the filters of a Find Employers search for the partner p_org and returns its id; saving the same filters again
-- returns the saved search. Any member may save, with advanced_employer_discovery. Refusals: those of
-- private.assert_employer_search_partner, CHARA_FEATURE_NOT_IN_PLAN advanced_employer_discovery, CHARA_INVALID_INPUT
-- naming a parameter whose code is not in its code list or whose number is out of range, or filters when none is given.
create function public.save_employer_search(
  p_org uuid,
  p_destination text default null,
  p_industry text default null,
  p_occupation text default null,
  p_min_workers integer default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destination text := upper(p_destination);
  v_industry text := upper(p_industry);
  v_id uuid;
begin
  perform private.assert_employer_search_partner(p_org);
  if not private.has_feature(p_org, 'advanced_employer_discovery') then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'advanced_employer_discovery';
  end if;
  if num_nonnulls(p_destination, p_industry, p_occupation, p_min_workers) = 0 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'filters';
  end if;
  if v_destination is not null and not exists (select 1 from public.countries c where c.code = v_destination) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_destination';
  end if;
  if v_industry is not null and not exists (select 1 from public.industries i where i.code = v_industry) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_industry';
  end if;
  if p_occupation is not null and not exists (select 1 from public.occupations o where o.code = p_occupation) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_occupation';
  end if;
  if p_min_workers not between 1 and 100000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_min_workers';
  end if;

  insert into public.saved_searches (organization_id, destination_country, industry_code, occupation_id, min_workers, created_by)
  values (p_org, v_destination, v_industry, p_occupation, p_min_workers, (select auth.uid()))
  on conflict on constraint saved_searches_filters_key do nothing
  returning id into v_id;

  if v_id is null then
    select s.id into v_id from public.saved_searches s
    where s.organization_id = p_org and s.kind = 'employers'
      and s.destination_country is not distinct from v_destination and s.industry_code is not distinct from v_industry
      and s.occupation_id is not distinct from p_occupation and s.min_workers is not distinct from p_min_workers;
    return v_id;
  end if;

  perform audit.record('saved_search.added', 'organization', p_org::text, jsonb_build_object('saved_search_id', v_id));
  return v_id;
end;
$$;

revoke all on function public.save_employer_search(uuid, text, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.save_employer_search(uuid, text, text, text, integer) to authenticated;

-- Removes the saved search p_id of the partner p_org; any member may, whatever the plan now is, so a company that left
-- an advanced plan can still clear its list. CHARA_NOT_FOUND while release_job_orders is off and for an id that is not
-- one of p_org's saved searches; CHARA_FORBIDDEN (42501) for a caller who is not an accepted member of p_org.
create function public.delete_saved_search(p_org uuid, p_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.release_on('release_job_orders') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.saved_searches s where s.id = p_id and s.organization_id = p_org;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform audit.record('saved_search.removed', 'organization', p_org::text, jsonb_build_object('saved_search_id', p_id));
end;
$$;

revoke all on function public.delete_saved_search(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_saved_search(uuid, uuid) to authenticated;
