-- Workforce corridors v1 and the network view (client brief sections 18 to 20; ARCHITECTURE.md section 9.4; OPEN_QUESTIONS.md
-- L2, D73). Country-neutral: a corridor is any source country to any other destination country that the listed partners
-- name, none is hard-coded (L2). Every figure comes from the database and leaves it through the functions below only.
--
-- Which partners count: the public partners of the directories (private.public_partner_ids: listed, not declined, active,
-- visible), recruitment partners being recruitment companies and staffing partners staffing companies plus recruitment
-- companies that offer staffing, as search_partners p_kind reads them. A partner belongs to the corridor S to D when S is in
-- its sources_from and D in its serves_market (organization_geographies), S different from D. The available workforce of
-- a corridor is the sum of available of the fresh listings (confirmed after private.workforce_fresh_since) of those
-- partners whose source country is S.
--
-- Suppression with k = private.stats_min_count() (floor 5), as v_platform_counts: a count below k leaves the database as
-- null, which the pages read as "fewer than k"; a corridor whose partners together are fewer than k is not listed, and
-- reading it answers the suppressed form (every figure null) so that a link never breaks. The partner total itself is
-- never returned: with one of the two counts shown it would give back the other below k (complementary suppression); it
-- only decides whether a corridor is listed and its place in the list. The available workforce is a range
-- (private.workforce_band, 20270223100000_workforce_counts_as_ranges.sql), never a number, and only once at least k
-- partners have a fresh listing behind it, so no partner's own capacity is shown in a range; and only to a signed-in
-- caller (owner decision, OPEN_QUESTIONS.md P26), as the directories show available workforce to signed-in users only:
-- a visitor gets null and workforce_requires_sign_in true. Partner counts and industries stay public.

insert into private.settings (key, value) values ('release_corridors', 'false') on conflict (key) do nothing;

-- The corridor pages describe the partner network and carry the immigration notice, so the switch goes live under the
-- legal documents of release 2a, like release_partner_directories.
insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('release_corridors', 'boolean', null, null, 'Workforce corridors: corridor and network pages', 'partner_accounts');

-- get_public_settings of 20270216200200_contact_request_public_periods.sql with release_corridors, which the menu, the
-- sitemap and the corridor pages read. release_boosts is added by 20270304100000_partner_boosts.sql and kept here; a key
-- without a settings row returns no row.
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
    'contact_request_expiry_days', 'release_boosts', 'release_corridors'
  ])
$$;

-- The snapshots ----------------------------------------------------------------------------------------------------------

-- One row per corridor with at least one partner: exact counts, the exact workforce and the five industries named by most
-- of its partners (then by code). Not readable through the API.
create materialized view stats.corridor_stats_mv as
with partners as (
  select o.id,
    o.type = 'recruitment_company' as recruitment,
    o.type = 'staffing_company' or exists (
      select 1 from public.organization_service_types st where st.organization_id = o.id and st.service = 'staffing'
    ) as staffing
  from public.organizations o
  where o.type in ('recruitment_company', 'staffing_company') and o.id in (select private.public_partner_ids())
),
pairs as (
  select p.id, p.recruitment, p.staffing, s.country_code as source_country, d.country_code as destination_country
  from partners p
  join public.organization_geographies s on s.organization_id = p.id and s.scope = 'sources_from'
  join public.organization_geographies d on d.organization_id = p.id and d.scope = 'serves_market'
  where s.country_code <> d.country_code
),
workforce as (
  select x.source_country, x.destination_country, sum(a.available) as workers, count(distinct a.organization_id) as partners
  from pairs x
  join public.workforce_availability a
    on a.organization_id = x.id and a.source_country = x.source_country and a.confirmed_at > private.workforce_fresh_since()
  group by x.source_country, x.destination_country
),
industries as (
  select x.source_country, x.destination_country, i.industry_code,
    row_number() over (partition by x.source_country, x.destination_country order by count(*) desc, i.industry_code) as rank
  from pairs x
  join public.organization_industries i on i.organization_id = x.id
  group by x.source_country, x.destination_country, i.industry_code
)
select
  x.source_country,
  x.destination_country,
  (count(*) filter (where x.recruitment))::integer as recruitment_partners,
  (count(*) filter (where x.staffing))::integer as staffing_partners,
  count(*)::integer as partners,
  coalesce(max(w.workers), 0)::integer as workers_available,
  coalesce(max(w.partners), 0)::integer as workforce_partners,
  coalesce((
    select array_agg(i.industry_code order by i.rank)
    from industries i
    where i.source_country = x.source_country and i.destination_country = x.destination_country and i.rank <= 5
  ), '{}') as industries,
  now() as refreshed_at
from pairs x
left join workforce w on w.source_country = x.source_country and w.destination_country = x.destination_country
group by x.source_country, x.destination_country;

comment on materialized view stats.corridor_stats_mv is
  'Exact figures per corridor (source country to destination country) of the listed partners, refreshed every 30 minutes by the job refresh-corridor-statistics. Not readable through the API: list_corridors and get_corridor apply stats_min_count and the workforce ranges.';

create unique index corridor_stats_mv_key on stats.corridor_stats_mv (source_country, destination_country);

revoke all on table stats.corridor_stats_mv from public, anon, authenticated, service_role;

-- The network of a destination by industry and occupation (brief section 19): the partners serving the destination that
-- name the industry (and the occupation; occupation_id '' is the whole industry). kind recruitment counts recruitment
-- partners, by source country (sources_from); kind staffing counts staffing partners, by the country they are based in
-- (organizations.based_in_country, set for every partner, where sources_from is optional for a staffing company);
-- country_code '' is all countries. kind workforce sums the fresh listings of those partners (of the occupation, or all of
-- them for the whole industry) in value, with the partners behind it in partners. A source country equal to the
-- destination counts here: the network includes partners recruiting in the country itself.
create materialized view stats.network_stats_mv as
with partners as (
  select o.id, o.based_in_country,
    o.type = 'recruitment_company' as recruitment,
    o.type = 'staffing_company' or exists (
      select 1 from public.organization_service_types st where st.organization_id = o.id and st.service = 'staffing'
    ) as staffing
  from public.organizations o
  where o.type in ('recruitment_company', 'staffing_company') and o.id in (select private.public_partner_ids())
),
served as (
  select p.*, d.country_code as destination_country, i.industry_code
  from partners p
  join public.organization_geographies d on d.organization_id = p.id and d.scope = 'serves_market'
  join public.organization_industries i on i.organization_id = p.id
),
cells as (
  select s.id, s.based_in_country, s.recruitment, s.staffing, s.destination_country, s.industry_code, o.occupation_id
  from served s
  join public.organization_occupations o on o.organization_id = s.id
  union all
  select s.id, s.based_in_country, s.recruitment, s.staffing, s.destination_country, s.industry_code, ''
  from served s
),
figures as (
  select c.destination_country, c.industry_code, c.occupation_id, 'recruitment' as kind, '' as country_code,
    count(*) as value, count(*) as partners
  from cells c
  where c.recruitment
  group by c.destination_country, c.industry_code, c.occupation_id
  union all
  select c.destination_country, c.industry_code, c.occupation_id, 'recruitment', g.country_code, count(*), count(*)
  from cells c
  join public.organization_geographies g on g.organization_id = c.id and g.scope = 'sources_from'
  where c.recruitment
  group by c.destination_country, c.industry_code, c.occupation_id, g.country_code
  union all
  select c.destination_country, c.industry_code, c.occupation_id, 'staffing', '', count(*), count(*)
  from cells c
  where c.staffing
  group by c.destination_country, c.industry_code, c.occupation_id
  union all
  select c.destination_country, c.industry_code, c.occupation_id, 'staffing', c.based_in_country, count(*), count(*)
  from cells c
  where c.staffing and c.based_in_country is not null
  group by c.destination_country, c.industry_code, c.occupation_id, c.based_in_country
  union all
  select c.destination_country, c.industry_code, c.occupation_id, 'workforce', '', sum(a.available), count(distinct c.id)
  from cells c
  join public.workforce_availability a
    on a.organization_id = c.id and (c.occupation_id = '' or a.occupation_id = c.occupation_id)
      and a.confirmed_at > private.workforce_fresh_since()
  group by c.destination_country, c.industry_code, c.occupation_id
)
select f.destination_country, f.industry_code, f.occupation_id, f.kind, f.country_code, f.value::integer as value,
  f.partners::integer as partners, now() as refreshed_at
from figures f;

comment on materialized view stats.network_stats_mv is
  'Exact figures of the network of each destination country by industry and occupation, refreshed every 30 minutes by the job refresh-corridor-statistics. Not readable through the API: get_network applies stats_min_count and the workforce ranges.';

create unique index network_stats_mv_key on stats.network_stats_mv (destination_country, industry_code, occupation_id, kind, country_code);

revoke all on table stats.network_stats_mv from public, anon, authenticated, service_role;

-- Both snapshots in one run, as the job does it; answers nothing. Owner only.
create function private.refresh_corridor_statistics() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view concurrently stats.corridor_stats_mv;
  refresh materialized view concurrently stats.network_stats_mv;
end;
$$;

revoke all on function private.refresh_corridor_statistics() from public, anon, authenticated, service_role;

select cron.schedule('refresh-corridor-statistics', '*/30 * * * *', 'select private.refresh_corridor_statistics()');

-- The read path -------------------------------------------------------------------------------------------------------------
-- Owner's rights, as private.platform_counts: the visitor has no privilege on the snapshots or the settings. While
-- release_corridors is off every function answers CHARA_NOT_FOUND (P0002), as the directories do while release 2a is off.

-- A country code of a corridor address: two letters of public.countries, any case. Answers the upper-case code, or null.
create function private.corridor_country(p_code text) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.code from public.countries c where c.code = upper(btrim(p_code)) and p_code ~ '^\s*[A-Za-z]{2}\s*$'
$$;

revoke all on function private.corridor_country(text) from public, anon, authenticated, service_role;

-- The listed corridors: those with at least k partners, the most partners first, then by the names of the source and the
-- destination. One JSON value, so the Data API does not cut the list at its row limit:
-- {min_count, workforce_requires_sign_in, refreshed_at, corridors: [{source_country, source_name, destination_country, destination_name,
-- recruitment_partners, staffing_partners, workers_available}]}, a count null below min_count, workers_available a range
-- or null (always null for a visitor).
create function public.list_corridors() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min integer;
  v_signed_in boolean := (select auth.uid()) is not null;
begin
  if not private.release_on('release_corridors') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_min := private.stats_min_count();
  return jsonb_build_object(
    'min_count', v_min,
    'workforce_requires_sign_in', not v_signed_in,
    'refreshed_at', (select max(c.refreshed_at) from stats.corridor_stats_mv c),
    'corridors', coalesce((
      select jsonb_agg(jsonb_build_object(
          'source_country', c.source_country, 'source_name', s.name,
          'destination_country', c.destination_country, 'destination_name', d.name,
          'recruitment_partners', case when c.recruitment_partners >= v_min then c.recruitment_partners end,
          'staffing_partners', case when c.staffing_partners >= v_min then c.staffing_partners end,
          'workers_available', case when v_signed_in and c.workforce_partners >= v_min then private.workforce_band(c.workers_available) end
        ) order by c.partners desc, s.name, d.name)
      from stats.corridor_stats_mv c
      join public.countries s on s.code = c.source_country
      join public.countries d on d.code = c.destination_country
      where c.partners >= v_min
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.list_corridors() is
  'The workforce corridors with at least stats_min_count partners (brief section 18): countries, partner counts (null below stats_min_count) and the available workforce as a range. Aggregates only.';

revoke all on function public.list_corridors() from public, anon, authenticated, service_role;
grant execute on function public.list_corridors() to anon, authenticated;

-- One corridor, listed or not: {source_country, source_name, destination_country, destination_name, listed, min_count,
-- workforce_requires_sign_in, refreshed_at, recruitment_partners, staffing_partners, workers_available, industries: [{code, name}]}. A corridor with
-- fewer than k partners (none included) answers listed false and every figure null, no industry. Codes that are not two
-- letters, not a country, or the same country twice answer CHARA_NOT_FOUND.
create function public.get_corridor(p_source text, p_destination text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min integer;
  v_source text := private.corridor_country(p_source);
  v_destination text := private.corridor_country(p_destination);
  v_row stats.corridor_stats_mv;
  v_listed boolean;
  v_signed_in boolean := (select auth.uid()) is not null;
begin
  if not private.release_on('release_corridors') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_source is null or v_destination is null or v_source = v_destination then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_min := private.stats_min_count();
  select * into v_row from stats.corridor_stats_mv c where c.source_country = v_source and c.destination_country = v_destination;
  v_listed := coalesce(v_row.partners >= v_min, false);
  return jsonb_build_object(
    'source_country', v_source,
    'source_name', (select c.name from public.countries c where c.code = v_source),
    'destination_country', v_destination,
    'destination_name', (select c.name from public.countries c where c.code = v_destination),
    'listed', v_listed,
    'min_count', v_min,
    'workforce_requires_sign_in', not v_signed_in,
    'refreshed_at', (select max(c.refreshed_at) from stats.corridor_stats_mv c),
    'recruitment_partners', case when v_listed and v_row.recruitment_partners >= v_min then v_row.recruitment_partners end,
    'staffing_partners', case when v_listed and v_row.staffing_partners >= v_min then v_row.staffing_partners end,
    'workers_available', case when v_signed_in and v_listed and v_row.workforce_partners >= v_min then private.workforce_band(v_row.workers_available) end,
    'industries', case when v_listed then coalesce((
      select jsonb_agg(jsonb_build_object('code', i.code, 'name', i.name) order by t.n)
      from unnest(v_row.industries) with ordinality t (code, n)
      join public.industries i on i.code = t.code
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

comment on function public.get_corridor(text, text) is
  'One workforce corridor (brief section 18): countries, whether it is listed, partner counts (null below stats_min_count), the available workforce as a range and its main industries. Aggregates only.';

revoke all on function public.get_corridor(text, text) from public, anon, authenticated, service_role;
grant execute on function public.get_corridor(text, text) to anon, authenticated;

-- The network of one destination (brief section 19): {destination_country, destination_name, min_count,
-- workforce_requires_sign_in, refreshed_at,
-- industries: [{code, name, recruitment_partners, staffing_partners, workers_available, occupations: [{code, label,
-- recruitment_partners, staffing_partners, workers_available, recruitment_sources: [{code, name, partners}],
-- staffing_bases: [{code, name, partners}]}]}]}. An industry or an occupation is included only when its recruitment or its
-- staffing partners are at least k, a country only with at least k partners; counts below k are null and the workforce
-- is a range behind at least k partners. Industries and occupations by most partners, then by name; countries likewise.
-- A code that is not a country answers CHARA_NOT_FOUND; a country without partners answers no industry.
create function public.get_network(p_destination text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min integer;
  v_destination text := private.corridor_country(p_destination);
  v_signed_in boolean := (select auth.uid()) is not null;
begin
  if not private.release_on('release_corridors') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_destination is null then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_min := private.stats_min_count();
  return (
    with dest_rows as (
      select n.* from stats.network_stats_mv n where n.destination_country = v_destination
    ),
    cells as (
      select r.industry_code, r.occupation_id,
        coalesce(max(r.partners) filter (where r.kind = 'recruitment' and r.country_code = ''), 0) as recruitment,
        coalesce(max(r.partners) filter (where r.kind = 'staffing' and r.country_code = ''), 0) as staffing,
        max(r.value) filter (where r.kind = 'workforce') as workers,
        coalesce(max(r.partners) filter (where r.kind = 'workforce'), 0) as workforce_partners
      from dest_rows r
      group by r.industry_code, r.occupation_id
      having coalesce(max(r.partners) filter (where r.kind = 'recruitment' and r.country_code = ''), 0) >= v_min
        or coalesce(max(r.partners) filter (where r.kind = 'staffing' and r.country_code = ''), 0) >= v_min
    ),
    figures as (
      select c.*,
        jsonb_build_object(
          'recruitment_partners', case when c.recruitment >= v_min then c.recruitment end,
          'staffing_partners', case when c.staffing >= v_min then c.staffing end,
          'workers_available', case when v_signed_in and c.workforce_partners >= v_min then private.workforce_band(c.workers) end
        ) as counts
      from cells c
    )
    select jsonb_build_object(
      'destination_country', v_destination,
      'destination_name', (select c.name from public.countries c where c.code = v_destination),
      'min_count', v_min,
      'workforce_requires_sign_in', not v_signed_in,
      'refreshed_at', (select max(n.refreshed_at) from stats.network_stats_mv n),
      'industries', coalesce((
        select jsonb_agg(
            jsonb_build_object('code', f.industry_code, 'name', i.name) || f.counts || jsonb_build_object('occupations', coalesce((
              select jsonb_agg(
                  jsonb_build_object('code', o.occupation_id, 'label', oc.label) || o.counts || jsonb_build_object(
                    'recruitment_sources', coalesce((
                      select jsonb_agg(jsonb_build_object('code', r.country_code, 'name', co.name, 'partners', r.partners)
                        order by r.partners desc, co.name)
                      from dest_rows r
                      join public.countries co on co.code = r.country_code
                      where r.industry_code = o.industry_code and r.occupation_id = o.occupation_id and r.kind = 'recruitment'
                        and r.partners >= v_min
                    ), '[]'::jsonb),
                    'staffing_bases', coalesce((
                      select jsonb_agg(jsonb_build_object('code', r.country_code, 'name', co.name, 'partners', r.partners)
                        order by r.partners desc, co.name)
                      from dest_rows r
                      join public.countries co on co.code = r.country_code
                      where r.industry_code = o.industry_code and r.occupation_id = o.occupation_id and r.kind = 'staffing'
                        and r.partners >= v_min
                    ), '[]'::jsonb)
                  )
                  order by greatest(o.recruitment, o.staffing) desc, oc.label)
              from figures o
              join public.occupations oc on oc.code = o.occupation_id
              where o.industry_code = f.industry_code and o.occupation_id <> ''
            ), '[]'::jsonb))
          order by greatest(f.recruitment, f.staffing) desc, i.name)
        from figures f
        join public.industries i on i.code = f.industry_code
        where f.occupation_id = ''
      ), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.get_network(text) is
  'The partner network of one destination country by industry and occupation (brief section 19): recruitment partners by source country, staffing partners by country of base, the available workforce as a range; counts below stats_min_count null or left out. Aggregates only.';

revoke all on function public.get_network(text) from public, anon, authenticated, service_role;
grant execute on function public.get_network(text) to anon, authenticated;
