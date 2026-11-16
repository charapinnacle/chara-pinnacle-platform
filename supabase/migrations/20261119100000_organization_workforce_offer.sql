-- What you offer (FR-K2; docs/phase-2/DATA_MODEL.md sections 2, 4 and 6, release 2a). A recruitment or staffing company
-- records the occupations it recruits or supplies (ISCO-08 unit groups), the industries it serves (ISIC Rev.4 sections),
-- the languages its candidates speak (ISO 639-1), its recruitment type and its service types. Every value is a row of a
-- code list or an enum value (NFR-M3). The number of occupations is capped by the plan limit listed_occupations, in the
-- same transaction as the change (NFR-A4). A recruitment company may add the service staffing with its staffing types and
-- then appears in the staffing directory too, still billed on its recruitment plan [d2.4]. Everything here belongs to
-- release 2a and is refused while release_partner_directories is false.

create table public.organization_occupations (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  occupation_id text not null references public.occupations (code),
  created_at timestamptz not null default now(),
  primary key (organization_id, occupation_id)
);

create table public.organization_industries (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  industry_code text not null references public.industries (code),
  created_at timestamptz not null default now(),
  primary key (organization_id, industry_code)
);

create table public.organization_languages (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  language_code text not null references public.languages (code),
  created_at timestamptz not null default now(),
  primary key (organization_id, language_code)
);

create table public.organization_service_types (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service public.partner_service_type not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, service)
);

comment on table public.organization_occupations is
  'ISCO-08 occupations a partner recruits or supplies, FR-K2; counted against listed_occupations. Written only by set_organization_workforce_offer.';
comment on table public.organization_industries is
  'ISIC Rev.4 sections a partner serves, FR-K2. Written only by set_organization_workforce_offer.';
comment on table public.organization_languages is
  'ISO 639-1 languages the candidates of a partner speak, FR-K2. Written only by set_organization_workforce_offer.';
comment on table public.organization_service_types is
  'Service types of a partner, FR-K2: the staffing types of a staffing company, or staffing and its types added by a recruitment company [d2.4]. Written only by set_organization_workforce_offer.';

-- The directories filter by occupation, industry, language and service type (FR-L1, FR-L2, FR-M3, FR-N1); the primary
-- keys serve the policies, which filter on organization_id.
create index organization_occupations_occupation_idx on public.organization_occupations (occupation_id, organization_id);
create index organization_industries_industry_idx on public.organization_industries (industry_code, organization_id);
create index organization_languages_language_idx on public.organization_languages (language_code, organization_id);
create index organization_service_types_service_idx on public.organization_service_types (service, organization_id);

-- The offer of a listed partner is public (shown on its profile and searched in the directories); before it is listed
-- only its own members read it, as for organization_geographies.
alter table public.organization_occupations enable row level security;
alter table public.organization_occupations force row level security;
revoke all on table public.organization_occupations from public, anon, authenticated, service_role;
grant select on table public.organization_occupations to anon, authenticated;
create policy organization_occupations_select_listed on public.organization_occupations
  for select to anon, authenticated
  using (organization_id in (select private.public_partner_ids()));
create policy organization_occupations_select_member on public.organization_occupations
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

alter table public.organization_industries enable row level security;
alter table public.organization_industries force row level security;
revoke all on table public.organization_industries from public, anon, authenticated, service_role;
grant select on table public.organization_industries to anon, authenticated;
create policy organization_industries_select_listed on public.organization_industries
  for select to anon, authenticated
  using (organization_id in (select private.public_partner_ids()));
create policy organization_industries_select_member on public.organization_industries
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

alter table public.organization_languages enable row level security;
alter table public.organization_languages force row level security;
revoke all on table public.organization_languages from public, anon, authenticated, service_role;
grant select on table public.organization_languages to anon, authenticated;
create policy organization_languages_select_listed on public.organization_languages
  for select to anon, authenticated
  using (organization_id in (select private.public_partner_ids()));
create policy organization_languages_select_member on public.organization_languages
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

alter table public.organization_service_types enable row level security;
alter table public.organization_service_types force row level security;
revoke all on table public.organization_service_types from public, anon, authenticated, service_role;
grant select on table public.organization_service_types to anon, authenticated;
create policy organization_service_types_select_listed on public.organization_service_types
  for select to anon, authenticated
  using (organization_id in (select private.public_partner_ids()));
create policy organization_service_types_select_member on public.organization_service_types
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- The plan limit of listed occupations for the What you offer form, read like organization_markets_limit: the limit when
-- it applies, null when it does not or the plan has none. Members of the organisation only.
create function public.organization_occupations_limit(p_org uuid) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if coalesce((select (value #>> '{}')::boolean from private.settings where key = 'entitlements_enforced'), false)
     or private.free_plan_restricted(p_org) then
    return private.org_limit(p_org, 'listed_occupations');
  end if;
  return null;
end;
$$;

revoke all on function public.organization_occupations_limit(uuid) from public, anon, authenticated, service_role;
grant execute on function public.organization_occupations_limit(uuid) to authenticated;

-- Replaces the workforce offer of a partner. Owner or admin of an active partner organisation, aal1 enough (onboarding
-- comes before the Security step, FR-J1 AC9). Codes are trimmed, cased as their code list and merged; one unknown value
-- refuses the whole call, naming the field (occupation_id, industry_code, language_code). A list longer than its code
-- list is refused before it is scanned. The staffing rules [d2.4]: a staffing company names at least one staffing type
-- (staffing itself is its type, not a service it adds); a recruitment company names staffing types only together with
-- the service staffing, and staffing only with at least one type. Calls for one organisation are serialised by an
-- advisory lock taken before the current rows are read, so two saves at the same moment cannot both pass the
-- listed_occupations limit. A save that adds an occupation is checked against the limit; one that only keeps or removes
-- occupations is not, so a partner above a lowered limit keeps its occupations and may only remove. A change stamps
-- workforce_profile_updated_at and writes one audit row with what changed; a save that changes nothing writes neither.
create function public.set_organization_workforce_offer(
  p_org uuid,
  p_occupations text[],
  p_industries text[],
  p_languages text[],
  p_recruitment_type public.recruitment_preference,
  p_service_types public.partner_service_type[],
  p_workforce_size_band public.workforce_size_band default null,
  p_founded_year smallint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
  v_occupations text[];
  v_industries text[];
  v_languages text[];
  v_services public.partner_service_type[];
  v_staffing_types integer;
  v_old_occupations text[];
  v_old_industries text[];
  v_old_languages text[];
  v_old_services public.partner_service_type[];
  v_changes jsonb := '{}'::jsonb;
  v_added text[];
  v_removed text[];
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'suspended') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_suspended';
  end if;
  if not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('organization_workforce_offer:' || p_org::text, 0));

  select * into v_org from public.organizations o where o.id = p_org;
  if v_org.type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'partner_only';
  end if;
  if v_org.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
  end if;

  if coalesce(cardinality(p_occupations), 0) > (select count(*) from public.occupations)
     or exists (
       select 1 from unnest(coalesce(p_occupations, '{}')) c (code)
       where not exists (select 1 from public.occupations r where r.code = btrim(c.code))
     ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupation_id';
  end if;
  if coalesce(cardinality(p_industries), 0) > (select count(*) from public.industries)
     or exists (
       select 1 from unnest(coalesce(p_industries, '{}')) c (code)
       where not exists (select 1 from public.industries r where r.code = upper(btrim(c.code)))
     ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'industry_code';
  end if;
  if coalesce(cardinality(p_languages), 0) > (select count(*) from public.languages)
     or exists (
       select 1 from unnest(coalesce(p_languages, '{}')) c (code)
       where not exists (select 1 from public.languages r where r.code = lower(btrim(c.code)))
     ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'language_code';
  end if;
  if coalesce(cardinality(p_service_types), 0) > cardinality(enum_range(null::public.partner_service_type))
     or array_position(p_service_types, null) is not null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'service_types';
  end if;
  if p_recruitment_type is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'recruitment_type';
  end if;
  if p_founded_year is not null and p_founded_year not between 1800 and extract(year from now())::integer then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'founded_year';
  end if;

  v_occupations := array(select distinct btrim(c) from unnest(coalesce(p_occupations, '{}')) c order by 1);
  v_industries := array(select distinct upper(btrim(c)) from unnest(coalesce(p_industries, '{}')) c order by 1);
  v_languages := array(select distinct lower(btrim(c)) from unnest(coalesce(p_languages, '{}')) c order by 1);
  v_services := array(select distinct s from unnest(coalesce(p_service_types, '{}')) s order by 1);
  v_staffing_types := cardinality(array_remove(v_services, 'staffing'));

  if v_org.type = 'staffing_company' then
    if 'staffing' = any (v_services) then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'service_types';
    end if;
    if v_staffing_types = 0 then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'staffing_types';
    end if;
  elsif 'staffing' = any (v_services) then
    if v_staffing_types = 0 then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'staffing_types';
    end if;
  elsif v_staffing_types > 0 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'staffing_service_required';
  end if;

  v_old_occupations := array(
    select o.occupation_id from public.organization_occupations o where o.organization_id = p_org order by 1);
  v_old_industries := array(
    select i.industry_code from public.organization_industries i where i.organization_id = p_org order by 1);
  v_old_languages := array(
    select l.language_code from public.organization_languages l where l.organization_id = p_org order by 1);
  v_old_services := array(
    select s.service from public.organization_service_types s where s.organization_id = p_org order by 1);

  v_added := array(select unnest(v_occupations) except select unnest(v_old_occupations) order by 1);
  v_removed := array(select unnest(v_old_occupations) except select unnest(v_occupations) order by 1);
  if cardinality(v_added) > 0 then
    perform private.assert_within_limit(p_org, 'listed_occupations', cardinality(v_occupations) - 1);
  end if;
  if cardinality(v_added) + cardinality(v_removed) > 0 then
    delete from public.organization_occupations o where o.organization_id = p_org and o.occupation_id = any (v_removed);
    insert into public.organization_occupations (organization_id, occupation_id) select p_org, c from unnest(v_added) c;
    v_changes := v_changes || jsonb_build_object('occupations',
      jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));
  end if;

  v_added := array(select unnest(v_industries) except select unnest(v_old_industries) order by 1);
  v_removed := array(select unnest(v_old_industries) except select unnest(v_industries) order by 1);
  if cardinality(v_added) + cardinality(v_removed) > 0 then
    delete from public.organization_industries i where i.organization_id = p_org and i.industry_code = any (v_removed);
    insert into public.organization_industries (organization_id, industry_code) select p_org, c from unnest(v_added) c;
    v_changes := v_changes || jsonb_build_object('industries',
      jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));
  end if;

  v_added := array(select unnest(v_languages) except select unnest(v_old_languages) order by 1);
  v_removed := array(select unnest(v_old_languages) except select unnest(v_languages) order by 1);
  if cardinality(v_added) + cardinality(v_removed) > 0 then
    delete from public.organization_languages l where l.organization_id = p_org and l.language_code = any (v_removed);
    insert into public.organization_languages (organization_id, language_code) select p_org, c from unnest(v_added) c;
    v_changes := v_changes || jsonb_build_object('languages',
      jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));
  end if;

  v_added := array(select unnest(v_services)::text except select unnest(v_old_services)::text order by 1);
  v_removed := array(select unnest(v_old_services)::text except select unnest(v_services)::text order by 1);
  if cardinality(v_added) + cardinality(v_removed) > 0 then
    delete from public.organization_service_types s
    where s.organization_id = p_org and s.service::text = any (v_removed);
    insert into public.organization_service_types (organization_id, service)
    select p_org, c::public.partner_service_type from unnest(v_added) c;
    v_changes := v_changes || jsonb_build_object('service_types',
      jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));
  end if;

  if v_org.recruitment_type is distinct from p_recruitment_type then
    v_changes := v_changes || jsonb_build_object('recruitment_type',
      jsonb_build_object('old', v_org.recruitment_type, 'new', p_recruitment_type));
  end if;
  if v_org.workforce_size_band is distinct from p_workforce_size_band then
    v_changes := v_changes || jsonb_build_object('workforce_size_band',
      jsonb_build_object('old', v_org.workforce_size_band, 'new', p_workforce_size_band));
  end if;
  if v_org.founded_year is distinct from p_founded_year then
    v_changes := v_changes || jsonb_build_object('founded_year',
      jsonb_build_object('old', v_org.founded_year, 'new', p_founded_year));
  end if;

  v_result := jsonb_build_object(
    'occupations', to_jsonb(v_occupations),
    'industries', to_jsonb(v_industries),
    'languages', to_jsonb(v_languages),
    'recruitment_type', p_recruitment_type,
    'service_types', to_jsonb(v_services),
    'workforce_size_band', p_workforce_size_band,
    'founded_year', p_founded_year
  );
  if v_changes = '{}'::jsonb then
    return v_result || jsonb_build_object('changed', false);
  end if;

  update public.organizations
  set recruitment_type = p_recruitment_type,
      workforce_size_band = p_workforce_size_band,
      founded_year = p_founded_year,
      workforce_profile_updated_at = now()
  where id = p_org;

  perform audit.record('organization.workforce_profile_changed', 'organization', p_org::text, v_changes);
  return v_result || jsonb_build_object('changed', true);
end;
$$;

revoke all on function public.set_organization_workforce_offer(
  uuid, text[], text[], text[], public.recruitment_preference, public.partner_service_type[], public.workforce_size_band, smallint
) from public, anon, authenticated, service_role;
grant execute on function public.set_organization_workforce_offer(
  uuid, text[], text[], text[], public.recruitment_preference, public.partner_service_type[], public.workforce_size_band, smallint
) to authenticated;
