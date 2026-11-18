-- An invited partner reads the job order on the marketplace as on its invitation (FR-O1 AC8 and roles, FR-N1 AC3 and
-- AC5; V79 smoke test). get_invitation shows every field of the requirement while the invitation is invited, viewed,
-- accepted or responded, whatever the partner's plan, countries or occupations; list_job_orders and get_job_order showed
-- the same requirement to the same partner as a reduced row (title, destination, workers and a reason) when it was not
-- eligible on its own. Now such an invitation makes the row full on the marketplace too: eligible, no reason, the fields
-- the invitation page shows (the employer's name already revealed by the invitation), and the row is found by the
-- filters on hidden fields. Nothing else changes: responding still needs a paid plan and the other checks of
-- respond_to_invitation (FR-O1 open point, FR-N2), which the page reads through get_response_eligibility; a declined,
-- withdrawn or expired invitation grants nothing, as on the invitation page; no other partner learns of the invitation.

-- Whether the partner p_org holds an invitation to p_requirement that shows the requirement in full (get_invitation).
create function private.job_order_invited(p_requirement uuid, p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.requirement_invitations i
    where i.requirement_id = p_requirement and i.organization_id = p_org
      and i.status in ('invited', 'viewed', 'accepted', 'responded'))
$$;

revoke all on function private.job_order_invited(uuid, uuid) from public, anon, authenticated, service_role;

-- list_job_orders of 20270111100100: an invited partner's row is full (private.job_order_invited).
create or replace function public.list_job_orders(p_org uuid, p_destination text default null::text, p_source text default null::text, p_occupation text default null::text, p_industry text default null::text, p_workers_min integer default null::integer, p_workers_max integer default null::integer, p_start_from date default null::date, p_start_to date default null::date, p_recruitment public.recruitment_preference default null::public.recruitment_preference, p_cursor uuid default null::uuid, p_limit integer default null::integer) returns table (id uuid, eligible boolean, reasons text[], title text, country_code text, workers_needed integer, countries text[], city_region text, industry_code text, occupations jsonb, start_date date, employment_type public.employment_type, recruitment_preference public.recruitment_preference, published_on date, response_count integer, responses_fewer_than integer, employer_name text, employer_company_slug text, next_cursor uuid)
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
    where r.status = 'open' and r.visibility = 'job_order_marketplace' and e.status = 'active' and r.moderation_state = 'visible'
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
          or private.job_order_invited(r.id, p_org)
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
      case when private.job_order_invited(r.id, p_org) then '{}'::text[]
        else private.job_order_reasons(r.id, v_facts.paid, v_facts.served, v_facts.occupations) end as why,
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
        and (cardinality(private.job_order_reasons(r.id, v_facts.paid, v_facts.served, v_facts.occupations)) = 0
          or private.job_order_invited(r.id, p_org)))));
end;
$$;

-- get_job_order of 20270111100100: an invited partner reads the job order in full (private.job_order_invited).
create or replace function public.get_job_order(p_org uuid, p_requirement uuid) returns table (id uuid, open boolean, eligible boolean, reasons text[], title text, country_code text, workers_needed integer, countries text[], city_region text, industry_code text, occupations jsonb, skills text, experience_years smallint, start_date date, duration_months smallint, employment_type public.employment_type, salary_min numeric, salary_max numeric, salary_currency text, salary_period public.salary_period, accommodation boolean, work_permit_support boolean, visa_support boolean, recruitment_preference public.recruitment_preference, partner_need public.partner_need, published_on date, closes_on date, response_count integer, responses_fewer_than integer, employer_name text, employer_company_slug text)
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
  if v_row.status <> 'open' or v_employer.status <> 'active' or v_row.moderation_state <> 'visible' then
    return query select v_row.id, false, null::boolean, null::text[], null::text, null::text, null::integer, null::text[],
      null::text, null::text, null::jsonb, null::text, null::smallint, null::date, null::smallint, null::public.employment_type,
      null::numeric, null::numeric, null::text, null::public.salary_period, null::boolean, null::boolean, null::boolean,
      null::public.recruitment_preference, null::public.partner_need, null::date, null::date, null::integer, null::integer,
      null::text, null::text;
    return;
  end if;

  select * into v_facts from private.job_order_partner_facts(p_org);
  v_why := case when private.job_order_invited(v_row.id, p_org) then '{}'::text[]
    else private.job_order_reasons(v_row.id, v_facts.paid, v_facts.served, v_facts.occupations) end;
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
