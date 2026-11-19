-- list_job_orders of 20270115200200 with the source country checked before the partner's eligibility (NFR-P3). The
-- planner put the source filter after private.job_order_reasons, so with p_source the board computed the eligibility of
-- every row it read, local job orders of other countries included (about 1,600 calls for a page of 50 in the load of
-- 189); a case runs the cheap check first and the eligibility only for the rows the source keeps. Same rows, same order.
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
      and case
        when v_source is not null and r.recruitment_preference = 'local' and not exists (
          select 1 from public.requirement_countries rc where rc.requirement_id = r.id and rc.country_code = v_source
        ) then false
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
