-- Where you serve (FR-K1; docs/phase-2/DATA_MODEL.md sections 4 and 6, release 2a). A recruitment or staffing company
-- records the countries it sources workers from and the countries it recruits or supplies workers for; the country it is
-- based in stays the column organizations.based_in_country. Countries are rows of public.countries (NFR-M3). The number
-- of served countries is capped by the plan limit markets, in the same transaction as the change (NFR-A4). Everything
-- here belongs to release 2a and is refused while release_partner_directories is false.

create table public.organization_geographies (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scope public.geography_scope not null,
  country_code text not null references public.countries (code),
  created_at timestamptz not null default now(),
  primary key (organization_id, scope, country_code)
);

comment on table public.organization_geographies is
  'Countries a partner sources workers from (sources_from) and recruits or supplies workers for (serves_market), FR-K1. Written only by set_organization_geographies.';

-- The directory filters by destination or source country (FR-L1, FR-L2); the primary key serves the policies, which
-- filter on organization_id.
create index organization_geographies_scope_country_idx
  on public.organization_geographies (scope, country_code, organization_id);
create index organization_geographies_country_idx on public.organization_geographies (country_code);

alter table public.organization_geographies enable row level security;
alter table public.organization_geographies force row level security;
revoke all on table public.organization_geographies from public, anon, authenticated, service_role;
grant select on table public.organization_geographies to anon, authenticated;

-- The geographies of a listed partner are public (they are shown on its profile and searched in the directories); before
-- it is listed only its own members read them.
create policy organization_geographies_select_listed on public.organization_geographies
  for select to anon, authenticated
  using (organization_id in (select private.public_partner_ids()));

create policy organization_geographies_select_member on public.organization_geographies
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- The plan limit of served countries for the Where you serve form: the limit when it applies (enforced, or the
-- organisation lapsed to its free plan), null when it does not or the plan has none. Members of the organisation only;
-- an unknown plan reads 0, as the database refuses every served country then.
create function public.organization_markets_limit(p_org uuid) returns integer
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
    return private.org_limit(p_org, 'markets');
  end if;
  return null;
end;
$$;

revoke all on function public.organization_markets_limit(uuid) from public, anon, authenticated, service_role;
grant execute on function public.organization_markets_limit(uuid) to authenticated;

-- Replaces both sets of countries of a partner. Owner or admin of an active partner organisation, aal1 enough (FR-K1
-- AC6: onboarding comes before the Security step). Codes are trimmed, upper-cased and merged; one unknown code refuses
-- the whole call (CHARA_INVALID_INPUT country_code). Calls for one organisation are serialised by an advisory lock taken
-- before the current rows are read, so two saves at the same moment cannot both pass the markets limit with different
-- countries. A save that adds a served country is checked against the limit; one that only keeps or removes countries is
-- not, so a partner above a lowered limit keeps its countries and may only remove (FR-K1 open point). A change stamps
-- workforce_profile_updated_at and writes one audit row with the added and removed countries per scope; a save that
-- changes nothing writes neither.
create function public.set_organization_geographies(
  p_org uuid, p_sources_from text[], p_serves_market text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
  v_sources text[];
  v_serves text[];
  v_old_sources text[];
  v_old_serves text[];
  v_sources_added text[];
  v_sources_removed text[];
  v_serves_added text[];
  v_serves_removed text[];
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

  perform pg_advisory_xact_lock(hashtextextended('organization_geographies:' || p_org::text, 0));

  select * into v_org from public.organizations o where o.id = p_org;
  if v_org.type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'partner_only';
  end if;
  if v_org.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_sources_from, '{}') || coalesce(p_serves_market, '{}')) c (code)
    where not exists (select 1 from public.countries r where r.code = upper(btrim(c.code)))
  ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'country_code';
  end if;
  v_sources := array(select distinct upper(btrim(c)) from unnest(coalesce(p_sources_from, '{}')) c order by 1);
  v_serves := array(select distinct upper(btrim(c)) from unnest(coalesce(p_serves_market, '{}')) c order by 1);

  select
    coalesce(array_agg(g.country_code order by g.country_code) filter (where g.scope = 'sources_from'), '{}'),
    coalesce(array_agg(g.country_code order by g.country_code) filter (where g.scope = 'serves_market'), '{}')
  into v_old_sources, v_old_serves
  from public.organization_geographies g
  where g.organization_id = p_org;

  v_sources_added := array(select unnest(v_sources) except select unnest(v_old_sources) order by 1);
  v_sources_removed := array(select unnest(v_old_sources) except select unnest(v_sources) order by 1);
  v_serves_added := array(select unnest(v_serves) except select unnest(v_old_serves) order by 1);
  v_serves_removed := array(select unnest(v_old_serves) except select unnest(v_serves) order by 1);

  if cardinality(v_serves_added) > 0 then
    perform private.assert_within_limit(p_org, 'markets', cardinality(v_serves) - 1);
  end if;

  if cardinality(v_sources_added) + cardinality(v_sources_removed) + cardinality(v_serves_added)
     + cardinality(v_serves_removed) = 0 then
    return jsonb_build_object('sources_from', to_jsonb(v_sources), 'serves_market', to_jsonb(v_serves), 'changed', false);
  end if;

  delete from public.organization_geographies g
  where g.organization_id = p_org and (
    (g.scope = 'sources_from' and g.country_code = any (v_sources_removed))
    or (g.scope = 'serves_market' and g.country_code = any (v_serves_removed))
  );
  insert into public.organization_geographies (organization_id, scope, country_code)
  select p_org, 'sources_from'::public.geography_scope, c from unnest(v_sources_added) c
  union all
  select p_org, 'serves_market'::public.geography_scope, c from unnest(v_serves_added) c;

  update public.organizations set workforce_profile_updated_at = now() where id = p_org;

  perform audit.record(
    'organization.geographies_changed', 'organization', p_org::text,
    jsonb_build_object(
      'sources_from', jsonb_build_object('added', to_jsonb(v_sources_added), 'removed', to_jsonb(v_sources_removed)),
      'serves_market', jsonb_build_object('added', to_jsonb(v_serves_added), 'removed', to_jsonb(v_serves_removed))
    )
  );
  return jsonb_build_object('sources_from', to_jsonb(v_sources), 'serves_market', to_jsonb(v_serves), 'changed', true);
end;
$$;

revoke all on function public.set_organization_geographies(uuid, text[], text[]) from public, anon, authenticated, service_role;
grant execute on function public.set_organization_geographies(uuid, text[], text[]) to authenticated;
