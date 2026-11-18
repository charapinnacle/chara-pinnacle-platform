-- The partner search counts of the statistics page follow the privacy threshold of the partner network figures (FR-S2
-- AC9, V31): a count below private.stats_min_count leaves the database as null. The searches with and without results
-- are shown only when both reach the threshold, since the total minus one gives the other (complementary suppression);
-- a destination is listed only with at least that many searches without results. The threshold is returned with the
-- counts, so the page says "fewer than" it. The added column changes the result type, so the function is replaced.

drop function public.admin_partner_search_stats(text, date, date);

create function public.admin_partner_search_stats(p_kind text, p_from date, p_to date)
returns table (searches bigint, with_results bigint, zero_results bigint, zero_by_destination jsonb, min_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min integer;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('recruitment', 'staffing', 'available_workforce') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_kind';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'range';
  end if;
  v_min := private.stats_min_count();

  return query
  with period as (
    select s.destination_country, s.result_count
    from stats.partner_searches s
    where s.kind = p_kind
      and s.created_at >= p_from::timestamp at time zone 'UTC' and s.created_at < (p_to + 1)::timestamp at time zone 'UTC'
  ),
  totals as (
    select
      count(*) as n,
      count(*) filter (where p.result_count > 0) as found,
      count(*) filter (where p.result_count = 0) as zero
    from period p
  )
  select
    case when t.n >= v_min then t.n end,
    case when t.found >= v_min and t.zero >= v_min then t.found end,
    case when t.found >= v_min and t.zero >= v_min then t.zero end,
    (select coalesce(jsonb_agg(jsonb_build_object('code', z.code, 'name', z.name, 'searches', z.n) order by z.n desc, z.name), '[]'::jsonb)
     from (
       select c.code, c.name, count(*) as n
       from period q
       join public.countries c on c.code = q.destination_country
       where q.result_count = 0
       group by c.code, c.name
       having count(*) >= v_min
       order by n desc, c.name
       limit 10
     ) z),
    v_min
  from totals t;
end;
$$;
revoke all on function public.admin_partner_search_stats(text, date, date) from public, anon, authenticated, service_role;
grant execute on function public.admin_partner_search_stats(text, date, date) to authenticated;
comment on function public.admin_partner_search_stats(text, date, date) is
  'Partner search counts of one kind and range for Platform Administrators (FR-L1, FR-L2, FR-K3 KPIs): null below stats_min_count, with complementary suppression of the searches with and without results; destinations below the threshold are left out. Counts only.';
