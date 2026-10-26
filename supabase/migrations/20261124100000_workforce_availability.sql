-- Workforce availability (FR-K3; docs/phase-2/DATA_MODEL.md sections 2, 6 and 7, release 2a). A recruitment or staffing
-- company lists, per occupation and source country of its own profile, the workers available now, its monthly capacity
-- and the date from which they are available. Each listing carries the time it was last confirmed: a listing not
-- confirmed within workforce_listing_stale_days is hidden from everyone outside the partner (and from the search of V22)
-- until it is confirmed again. The number of listings is capped by the plan limit workforce_listings, in the same
-- transaction as the change (NFR-A4). Occupations and countries are code-list rows, reached through the partner's own
-- profile rows (NFR-M3). Everything here belongs to release 2a and is refused while release_partner_directories is false.

insert into private.settings (key, value) values
  ('workforce_listing_stale_days', '60'),
  ('workforce_confirm_reminder_days', '30'),
  -- How far ahead an available-from date may lie (an assumed default of FR-K3).
  ('workforce_available_from_max_days', '730')
on conflict (key) do nothing;

-- The availability list labels its listings with the same periods the database applies.
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
    'workforce_listing_stale_days', 'workforce_confirm_reminder_days', 'workforce_available_from_max_days'
  ])
$$;

-- source_scope exists only for the foreign key to the partner's source countries: it is always sources_from. Both
-- composite foreign keys cascade, so a listing goes when its occupation or source country leaves the profile (the
-- trigger below audits that).
create table public.workforce_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  occupation_id text not null references public.occupations (code),
  source_country text not null references public.countries (code),
  source_scope public.geography_scope not null generated always as ('sources_from'::public.geography_scope) stored,
  available integer not null check (available between 1 and 100000),
  monthly_capacity integer not null check (monthly_capacity between 1 and 100000),
  available_from date not null,
  confirmed_at timestamptz not null default now(),
  reminded_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_availability_listing_key unique (organization_id, occupation_id, source_country),
  constraint workforce_availability_profile_occupation_fkey foreign key (organization_id, occupation_id)
    references public.organization_occupations (organization_id, occupation_id) on delete cascade,
  constraint workforce_availability_profile_source_fkey foreign key (organization_id, source_scope, source_country)
    references public.organization_geographies (organization_id, scope, country_code) on delete cascade
);

comment on table public.workforce_availability is
  'Availability listings of a partner per occupation and source country, FR-K3. Members read all; signed-in non-members read the fresh listings of listed partners; anonymous none. Written only by the workforce availability RPCs and the confirmation reminder job.';
comment on column public.workforce_availability.confirmed_at is
  'Set on create, update and confirm; a listing older than the setting workforce_listing_stale_days is hidden outside the partner.';
comment on column public.workforce_availability.reminded_at is
  'When the daily job workforce-availability-confirm last found the listing due for confirmation (workforce_confirm_reminder_days); the reminder itself is queued from V14 on.';

-- The unique key leads with organization_id and serves both policies and the list. The search of V22 reads by
-- occupation and source country; the freshness policy and the reminder job read by confirmation time.
create index workforce_availability_search_idx on public.workforce_availability (occupation_id, source_country)
  include (available, monthly_capacity, available_from, confirmed_at);
create index workforce_availability_confirmed_at_idx on public.workforce_availability (confirmed_at);
create index workforce_availability_source_idx on public.workforce_availability (organization_id, source_country);
create index workforce_availability_created_by_idx on public.workforce_availability (created_by);

alter table public.workforce_availability enable row level security;
alter table public.workforce_availability force row level security;
revoke all on table public.workforce_availability from public, anon, authenticated, service_role;
-- Who created a listing and when it was last found due are bookkeeping, not shown to anyone.
grant select (
  id, organization_id, occupation_id, source_country, source_scope, available, monthly_capacity, available_from,
  confirmed_at, created_at, updated_at
) on public.workforce_availability to authenticated;

-- The moment before which a confirmation counts as stale. Executable by authenticated for the read policy.
create function private.workforce_fresh_since() returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select now() - make_interval(days => coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'workforce_listing_stale_days'), 60))
$$;

revoke all on function private.workforce_fresh_since() from public, anon, authenticated, service_role;
grant execute on function private.workforce_fresh_since() to authenticated;

create policy workforce_availability_select_member on public.workforce_availability
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

create policy workforce_availability_select_listed_fresh on public.workforce_availability
  for select to authenticated
  using (
    organization_id in (select private.public_partner_ids())
    and confirmed_at > (select private.workforce_fresh_since())
  );

-- The values of a listing as the audit rows keep them (old and new).
create function private.workforce_listing_values(p_row public.workforce_availability) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'occupation_id', p_row.occupation_id, 'source_country', p_row.source_country, 'available', p_row.available,
    'monthly_capacity', p_row.monthly_capacity, 'available_from', p_row.available_from, 'confirmed_at', p_row.confirmed_at
  )
$$;

revoke all on function private.workforce_listing_values(public.workforce_availability) from public, anon, authenticated, service_role;

-- A listing removed with its occupation or source country (set_organization_workforce_offer, set_organization_geographies
-- or the organisation itself) is audited here; the profile row is already gone when the cascade deletes the listing. A
-- listing deleted by delete_workforce_availability still has both rows and is audited by that function.
create function private.audit_workforce_listing_removed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  if not exists (
    select 1 from public.organization_occupations o
    where o.organization_id = old.organization_id and o.occupation_id = old.occupation_id
  ) then
    v_reason := 'occupation_removed';
  elsif not exists (
    select 1 from public.organization_geographies g
    where g.organization_id = old.organization_id and g.scope = 'sources_from' and g.country_code = old.source_country
  ) then
    v_reason := 'source_country_removed';
  else
    return null;
  end if;
  perform audit.record('workforce_availability.removed_with_profile', 'workforce_availability', old.id::text,
    jsonb_build_object('organization_id', old.organization_id, 'reason', v_reason,
      'old', private.workforce_listing_values(old)));
  return null;
end;
$$;

revoke all on function private.audit_workforce_listing_removed() from public, anon, authenticated, service_role;

create trigger workforce_availability_removed_with_profile
  after delete on public.workforce_availability
  for each row execute function private.audit_workforce_listing_removed();

-- Owner or admin at aal2 of an active partner organisation, release 2a only.
create function private.assert_listing_manager(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  perform private.assert_org_manager(p_org, 'admin');
  if private.org_type(p_org) not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'partner_only';
  end if;
end;
$$;

revoke all on function private.assert_listing_manager(uuid) from public, anon, authenticated, service_role;

-- The date to store: today (UTC) for an earlier date or none, refused beyond workforce_available_from_max_days ahead.
create function private.listing_available_from(p_available_from date) returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_max integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'workforce_available_from_max_days'), 730);
begin
  if p_available_from > v_today + v_max then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'available_from';
  end if;
  return greatest(coalesce(p_available_from, v_today), v_today);
end;
$$;

revoke all on function private.listing_available_from(date) from public, anon, authenticated, service_role;

-- The plan limit of listings for the availability section, read like organization_occupations_limit: the limit when it
-- applies, null when it does not or the plan has none. Members of the organisation only.
create function public.workforce_listings_limit(p_org uuid) returns integer
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
    return private.org_limit(p_org, 'workforce_listings');
  end if;
  return null;
end;
$$;

revoke all on function public.workforce_listings_limit(uuid) from public, anon, authenticated, service_role;
grant execute on function public.workforce_listings_limit(uuid) to authenticated;

-- Adds a listing (FR-K3 AC1 to AC3). The occupation must be one of the partner's occupations and the country one of its
-- source countries (CHARA_INVALID_INPUT occupation_not_in_profile, source_country_not_in_profile); numbers outside 1 to
-- 100,000 fail on their checks (23514); the date follows private.listing_available_from. The same occupation and
-- country twice raises CHARA_CONFLICT detail listing. Calls for one organisation are serialised by an advisory lock
-- taken before the listings are counted, so two adds at the same moment cannot both pass the workforce_listings limit.
-- The listing is confirmed on creation; the profile date is stamped and the audit row keeps the new values.
create function public.add_workforce_availability(
  p_org uuid, p_occupation_id text, p_source_country text, p_available integer, p_monthly_capacity integer,
  p_available_from date
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occupation text := btrim(p_occupation_id);
  v_country text := upper(btrim(p_source_country));
  v_from date;
  v_new public.workforce_availability;
begin
  perform private.assert_listing_manager(p_org);
  perform pg_advisory_xact_lock(hashtextextended('workforce_availability:' || p_org::text, 0));

  v_from := private.listing_available_from(p_available_from);
  -- The profile rows are locked until the end of the transaction, so a profile save cannot remove them between this
  -- check and the insert (the foreign keys would refuse the insert with a bare 23503 instead of the named refusal).
  perform 1 from public.organization_occupations o
  where o.organization_id = p_org and o.occupation_id = v_occupation
  for key share;
  if not found then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupation_not_in_profile';
  end if;
  perform 1 from public.organization_geographies g
  where g.organization_id = p_org and g.scope = 'sources_from' and g.country_code = v_country
  for key share;
  if not found then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'source_country_not_in_profile';
  end if;
  if exists (
    select 1 from public.workforce_availability w
    where w.organization_id = p_org and w.occupation_id = v_occupation and w.source_country = v_country
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'listing';
  end if;
  perform private.assert_within_limit(p_org, 'workforce_listings',
    (select count(*)::integer from public.workforce_availability w where w.organization_id = p_org));

  insert into public.workforce_availability (
    organization_id, occupation_id, source_country, available, monthly_capacity, available_from
  ) values (p_org, v_occupation, v_country, p_available, p_monthly_capacity, v_from)
  returning * into v_new;

  update public.organizations set workforce_profile_updated_at = now() where id = p_org;
  perform audit.record('workforce_availability.created', 'workforce_availability', v_new.id::text,
    jsonb_build_object('organization_id', p_org, 'new', private.workforce_listing_values(v_new)));
  return v_new.id;
end;
$$;

revoke all on function public.add_workforce_availability(uuid, text, text, integer, integer, date)
  from public, anon, authenticated, service_role;
grant execute on function public.add_workforce_availability(uuid, text, text, integer, integer, date) to authenticated;

-- The listing for a change, locked, after its organisation's manager is checked. An unknown id raises CHARA_NOT_FOUND
-- (P0002); a listing of an organisation the caller does not manage, CHARA_FORBIDDEN.
create function private.managed_listing(p_listing uuid) returns public.workforce_availability
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_availability;
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  select * into v_row from public.workforce_availability w where w.id = p_listing;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.assert_listing_manager(v_row.organization_id);
  select * into v_row from public.workforce_availability w where w.id = p_listing for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function private.managed_listing(uuid) from public, anon, authenticated, service_role;

-- Changes the numbers and the date of a listing; occupation and country identify it and stay. An update confirms the
-- listing too (Stale or Fresh -> Fresh). The audit row keeps the old and the new values.
create function public.update_workforce_availability(
  p_listing uuid, p_available integer, p_monthly_capacity integer, p_available_from date
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.workforce_availability := private.managed_listing(p_listing);
  v_new public.workforce_availability;
begin
  update public.workforce_availability
  set available = p_available,
      monthly_capacity = p_monthly_capacity,
      available_from = private.listing_available_from(p_available_from),
      confirmed_at = now(),
      reminded_at = null,
      updated_at = now()
  where id = p_listing
  returning * into v_new;

  update public.organizations set workforce_profile_updated_at = now() where id = v_old.organization_id;
  perform audit.record('workforce_availability.updated', 'workforce_availability', p_listing::text,
    jsonb_build_object('organization_id', v_old.organization_id,
      'old', private.workforce_listing_values(v_old), 'new', private.workforce_listing_values(v_new)));
end;
$$;

revoke all on function public.update_workforce_availability(uuid, integer, integer, date)
  from public, anon, authenticated, service_role;
grant execute on function public.update_workforce_availability(uuid, integer, integer, date) to authenticated;

-- Confirms a listing unchanged (FR-K3 AC6, AC10): confirmed_at is now, so a stale listing is shown again. Returns the new
-- confirmation time.
create function public.confirm_workforce_availability(p_listing uuid) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.workforce_availability := private.managed_listing(p_listing);
  v_confirmed timestamptz;
begin
  update public.workforce_availability
  set confirmed_at = now(), reminded_at = null, updated_at = now()
  where id = p_listing
  returning confirmed_at into v_confirmed;

  update public.organizations set workforce_profile_updated_at = now() where id = v_old.organization_id;
  perform audit.record('workforce_availability.confirmed', 'workforce_availability', p_listing::text,
    jsonb_build_object('organization_id', v_old.organization_id,
      'old', jsonb_build_object('confirmed_at', v_old.confirmed_at), 'new', jsonb_build_object('confirmed_at', v_confirmed)));
  return v_confirmed;
end;
$$;

revoke all on function public.confirm_workforce_availability(uuid) from public, anon, authenticated, service_role;
grant execute on function public.confirm_workforce_availability(uuid) to authenticated;

-- Deletes a listing (Any -> Deleted); the audit row keeps the old values.
create function public.delete_workforce_availability(p_listing uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.workforce_availability := private.managed_listing(p_listing);
begin
  delete from public.workforce_availability where id = p_listing;
  update public.organizations set workforce_profile_updated_at = now() where id = v_old.organization_id;
  perform audit.record('workforce_availability.deleted', 'workforce_availability', p_listing::text,
    jsonb_build_object('organization_id', v_old.organization_id, 'old', private.workforce_listing_values(v_old)));
end;
$$;

revoke all on function public.delete_workforce_availability(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_workforce_availability(uuid) to authenticated;

-- Confirmation reminders ------------------------------------------------------------------------------------------------

-- Finds the listings of active partners last confirmed workforce_confirm_reminder_days ago or earlier and not found due
-- within that period, and stamps reminded_at, so a listing is due once per period until it is confirmed (confirming
-- clears the stamp). A second run on the same day finds nothing. Nothing is queued yet: the kind
-- listing_confirmation_due, its template and the queueing per organisation come with V14. Returns the number stamped.
create function private.mark_workforce_confirmations_due() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due timestamptz := now() - make_interval(days => coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'workforce_confirm_reminder_days'), 30));
  v_count integer;
begin
  if not private.release_on('release_partner_directories') then
    return 0;
  end if;
  update public.workforce_availability w
  set reminded_at = now()
  where w.confirmed_at <= v_due
    and (w.reminded_at is null or w.reminded_at <= v_due)
    and exists (select 1 from public.organizations o where o.id = w.organization_id and o.status = 'active');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.mark_workforce_confirmations_due() from public, anon, authenticated, service_role;

select cron.schedule('workforce-availability-confirm', '30 0 * * *', 'select private.mark_workforce_confirmations_due()');
