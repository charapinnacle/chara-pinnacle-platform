-- Profile views (FR-R6 AC1, AC2, SOP P2-40 step Count; FR-K4 AC8; docs/phase-2/DATA_MODEL.md sections 2, 6, 7 Discovery and
-- 10). A view of a public partner profile is counted once per viewing organisation per UTC day: one row of
-- private.profile_view_events (viewed organisation, viewing organisation, day), which no API role reads. Only a signed-in
-- member of another active company organisation is counted; the partner's own members, candidates and visitors are
-- not, so no cookie or visitor identifier is needed. The row is the only place that names a viewer: the partner reads
-- counts only, built from it by the daily aggregation of the next migration, and the row is removed after the retention
-- period profile_view_events (35 days).
--
-- record_profile_view is called by get_partner_profile once the profile is found, so the member preview, a read over the
-- throttle, an unknown or hidden slug and a switched-off release count nothing. A user who belongs to several companies
-- counts once for each of them, as each organisation viewed the profile; repeated reads of the same organisation on the
-- same day add nothing (the primary key), so a single viewer cannot raise the count. A view is not written to the audit
-- log: the audit row would keep the viewer's identity for six years, where the event keeps it for 35 days.

create table private.profile_view_events (
  viewed_organization_id uuid not null references public.organizations (id) on delete cascade,
  viewer_organization_id uuid not null references public.organizations (id) on delete cascade,
  viewed_on date not null default (now() at time zone 'utc')::date,
  primary key (viewed_organization_id, viewed_on, viewer_organization_id),
  constraint profile_view_events_other_check check (viewer_organization_id <> viewed_organization_id)
);

comment on table private.profile_view_events is
  'One row per partner profile, viewing company organisation and UTC day (FR-R6). Read only by private.aggregate_org_analytics; no API role has a privilege; removed after the retention period profile_view_events.';

create index profile_view_events_viewer_idx on private.profile_view_events (viewer_organization_id);
create index profile_view_events_viewed_on_idx on private.profile_view_events (viewed_on);

alter table private.profile_view_events enable row level security;
alter table private.profile_view_events force row level security;
revoke all on table private.profile_view_events from public, anon, authenticated, service_role;

-- Records that the caller's organisations viewed the public profile of p_org today. Returns nothing and raises nothing
-- for a view that is not counted (FR-R6 AC1: the call never fails the page): no caller, the release off, a member of
-- the partner, a partner that is not public, or a caller without an active organisation.
create function public.record_profile_view(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or p_org is null or not private.release_on('release_partner_directories')
     or private.is_org_member(p_org) then
    return;
  end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = p_org and o.type <> 'employer' and o.moderation_state = 'visible' and private.is_listed_partner(o.id)
  ) then
    return;
  end if;

  -- A view that cannot be recorded is lost rather than failing the profile read (AC1).
  begin
    insert into private.profile_view_events (viewed_organization_id, viewer_organization_id)
    select p_org, v from private.active_org_ids() v
    on conflict do nothing;
  exception when others then
    null;
  end;
end;
$$;

revoke all on function public.record_profile_view(uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_profile_view(uuid) to authenticated;

-- get_partner_profile of 20261129100000 with the view recorded for a signed-in reader once the profile is found.
create or replace function public.get_partner_profile(p_slug text, p_key text default null, p_proof text default null)
returns table (
  slug text,
  display_name text,
  organization_type public.organization_type,
  based_in_country text,
  based_in_country_name text,
  served_countries jsonb,
  source_countries jsonb,
  industries jsonb,
  occupations jsonb,
  languages jsonb,
  service_types public.partner_service_type[],
  recruitment_type public.recruitment_preference,
  workforce_size_band public.workforce_size_band,
  founded_year smallint,
  description text,
  website text,
  commitment_current boolean,
  profile_updated_at timestamptz,
  listings jsonb,
  viewer_is_member boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_allowed boolean;
  v_retry integer;
begin
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is null then
    select a.allowed, a.retry_after_seconds into v_allowed, v_retry
    from public.rate_limit_attempt('partner_profile', p_key, p_proof) a;
    if not v_allowed then
      raise exception 'CHARA_RATE_LIMITED' using detail = v_retry::text;
    end if;
  else
    perform private.check_rate_limit('partner_profile', v_uid);
  end if;

  select o.id into v_org
  from public.organizations o
  where o.slug = p_slug and o.type <> 'employer' and o.moderation_state = 'visible' and private.is_listed_partner(o.id);
  if v_org is null then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_uid is not null then
    perform public.record_profile_view(v_org);
  end if;

  return query
  select p.*, v_uid is not null and private.is_org_member(v_org)
  from private.partner_profile(v_org) p;
end;
$$;

revoke all on function public.get_partner_profile(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.get_partner_profile(text, text, text) to anon, authenticated;
