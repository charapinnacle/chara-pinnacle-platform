-- Partner responses to workforce requirements, data (FR-N2, SOP P2-20; FR-O2, SOP P2-22; FR-J2 AC9 and step Rules check;
-- FR-O1 step Track (accepted -> responded); FR-M2 and FR-T1 recipients; decisions 2.2, 2.6, 3.2, 3.3, 3.4, 3.6, 4.5; NFR-S8,
-- NFR-S11, NFR-A3, NFR-A4, NFR-C6, NFR-O5; docs/phase-2/DATA_MODEL.md sections 5, 6, 7, 8, 9 and 11; release 2b).
--
-- A recruitment or staffing company answers a workforce requirement once (respond_to_invitation): through a live
-- invitation, private or on the marketplace, or as an eligible partner of a job order of the marketplace. Any accepted
-- member of a listed, active, visible partner may respond, edit (update_response) and withdraw (withdraw_response), with
-- no two-step verification (FR-N2 open point). A response needs, in this order: an open requirement of an active
-- employer, no earlier response of the partner (a withdrawn one is not replaced), a paid partner plan with job order
-- access in both states of entitlements_enforced (decision 3.6), for a marketplace response the destination served and
-- an occupation listed, a current employer-pays commitment (FR-J3), a current licence for every destination that a
-- direct-hiring rule marks licensed_partner_required (FR-J2 AC9, decision 2.6), and room in the monthly limit
-- job_order_responses_per_month (both partner types, DATA_MODEL.md section 2) while it applies. Every response written
-- counts in its calendar month (UTC) whatever happens to it later. The checks and the count run under one advisory lock
-- per partner, so two calls at the same time never pass the limit or the one-response rule together (NFR-A4).
--
-- Every submitted or changed proposal is kept as a version (partner_response_versions, append-only); an edit that changes
-- nothing writes nothing. The employer's members read every response and version of their requirements
-- (list_requirement_responses, get_response, list_response_versions); a partner reads only its own and never learns of
-- another partner's response (NFR-S8). Responding through an invitation moves it to responded. The employer's owners and
-- admins are told of a new and a withdrawn response (response_received, response_withdrawn), never of an edit; the
-- partners with a live marketplace response now get the change, closing-soon and closed notices of V43 too. No reveal of
-- the employer is written here: shortlisting and selection are V47's. Documents are V45, pages V46, decisions V47.
-- Every function a user calls refuses to run while release_job_orders is false.

create type public.response_status as enum ('submitted', 'updated', 'withdrawn', 'shortlisted', 'selected', 'declined');
create type public.fee_model as enum ('fee_per_hire', 'percent_first_year_salary', 'hourly_rate', 'monthly_rate', 'on_request');

-- How far above the workers needed a partner may offer, set by the employer (FR-O2 AC4); 0 by default.
alter table public.workforce_requirements
  add column max_capacity_over_percent smallint not null default 0 check (max_capacity_over_percent between 0 and 100);

comment on column public.workforce_requirements.max_capacity_over_percent is
  'How many per cent above workers_needed a partner response may offer (0 to 100, default 0), set by the employer with set_requirement_capacity_tolerance.';

-- The responses ----------------------------------------------------------------------------------------------------------

create table public.partner_responses (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.workforce_requirements (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employer_organization_id uuid not null references public.organizations (id) on delete cascade,
  invitation_id uuid references public.requirement_invitations (id) on delete set null,
  status public.response_status not null default 'submitted',
  version integer not null default 1 check (version >= 1),
  capacity integer not null check (capacity between 1 and 200000),
  available_from date not null,
  timeline_note text check (
    timeline_note = btrim(timeline_note) and char_length(timeline_note) between 1 and 1000
    and timeline_note !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  ),
  experience_note text not null check (
    experience_note = btrim(experience_note) and char_length(experience_note) between 20 and 4000
    and experience_note !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  ),
  fee_model public.fee_model not null,
  fee_amount numeric(12, 2),
  fee_currency text references public.currencies (code),
  notes text check (
    notes = btrim(notes) and char_length(notes) between 1 and 2000 and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  ),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  employer_seen_version integer not null default 0 check (employer_seen_version >= 0),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decision_note text check (
    decision_note = btrim(decision_note) and char_length(decision_note) between 1 and 1000
    and decision_note !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  ),
  submissions_allowed boolean not null default false,
  withdrawn_at timestamptz,
  withdrawal_reason text check (
    withdrawal_reason = btrim(withdrawal_reason) and char_length(withdrawal_reason) between 1 and 500
    and withdrawal_reason !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  ),
  constraint partner_responses_partner_key unique (requirement_id, organization_id),
  -- Decision 3.3: a fixed fee or a rate has an amount above 0 (at most 9,999,999.99) and a currency; a percentage of the
  -- first-year salary is above 0 and at most 100, without a currency; on request has neither.
  constraint partner_responses_fee check (case fee_model
    when 'on_request' then fee_amount is null and fee_currency is null
    when 'percent_first_year_salary' then fee_amount > 0 and fee_amount <= 100 and fee_currency is null
    else fee_amount > 0 and fee_amount <= 9999999.99 and fee_currency is not null
  end),
  constraint partner_responses_withdrawn check ((status = 'withdrawn') = (withdrawn_at is not null)),
  constraint partner_responses_withdrawal_reason check (withdrawal_reason is null or status = 'withdrawn'),
  constraint partner_responses_decided check ((status in ('shortlisted', 'selected', 'declined')) = (decided_at is not null)),
  constraint partner_responses_decision_note check (decision_note is null or decided_at is not null),
  constraint partner_responses_submissions check (not submissions_allowed or status in ('shortlisted', 'selected')),
  constraint partner_responses_seen check (employer_seen_version <= version)
);

comment on table public.partner_responses is
  'The response of a recruitment or staffing company to a workforce requirement (FR-N2, FR-O2): one per requirement and partner, never replaced. Members of the partner and of the employer read it; written only by respond_to_invitation, update_response, withdraw_response and the decision functions of V47.';
comment on column public.partner_responses.invitation_id is
  'The invitation the partner responded through (it became responded); null for a response to the marketplace job order.';
comment on column public.partner_responses.version is 'The current version; partner_response_versions keeps every version.';
comment on column public.partner_responses.created_by is
  'The partner member who submitted the response; cleared when the account is erased. Not readable through the Data API.';
comment on column public.partner_responses.employer_seen_version is
  'The version a member of the employer last opened (get_response), so a newer one shows Updated. Not readable through the Data API.';
comment on column public.partner_responses.withdrawal_reason is
  'The optional reason of a withdrawal (up to 500 characters), shown to the employer.';
comment on column public.partner_responses.decided_by is
  'The employer member who shortlisted, selected or declined (V47); cleared when the account is erased. Not readable through the Data API.';

create index partner_responses_organization_idx on public.partner_responses (organization_id, created_at desc, id);
create index partner_responses_employer_idx on public.partner_responses (employer_organization_id);
create index partner_responses_invitation_idx on public.partner_responses (invitation_id) where invitation_id is not null;
create index partner_responses_created_by_idx on public.partner_responses (created_by) where created_by is not null;
create index partner_responses_decided_by_idx on public.partner_responses (decided_by) where decided_by is not null;

alter table public.partner_responses enable row level security;
alter table public.partner_responses force row level security;
revoke all on table public.partner_responses from public, anon, authenticated, service_role;
grant select (
  id, requirement_id, organization_id, employer_organization_id, invitation_id, status, version, capacity, available_from,
  timeline_note, experience_note, fee_model, fee_amount, fee_currency, notes, created_at, updated_at, decided_at,
  decision_note, submissions_allowed, withdrawn_at, withdrawal_reason
) on public.partner_responses to authenticated;

create policy partner_responses_select_member on public.partner_responses
  for select to authenticated
  using (
    organization_id in (select private.member_org_ids())
    or employer_organization_id in (select private.member_org_ids())
  );

-- The moves of DATA_MODEL.md section 5: submitted -> updated (an edit; updated stays updated, the status does not change);
-- submitted or updated -> withdrawn (partner), shortlisted, selected or declined (employer, V47); shortlisted -> selected
-- or declined. Withdrawn, selected and declined are final. No API role writes the table, so this holds the functions of
-- this and later units to the table of states.
create function private.partner_responses_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    (old.status = 'submitted' and new.status = 'updated')
    or (old.status in ('submitted', 'updated') and new.status in ('withdrawn', 'shortlisted', 'selected', 'declined'))
    or (old.status = 'shortlisted' and new.status in ('selected', 'declined'))
  ) then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = old.status || ' to ' || new.status;
  end if;
  return new;
end;
$$;

revoke all on function private.partner_responses_guard() from public, anon, authenticated, service_role;

create trigger partner_responses_guard
  before update of status on public.partner_responses
  for each row when (old.status is distinct from new.status)
  execute function private.partner_responses_guard();

alter table public.partner_responses enable always trigger partner_responses_guard;

-- What a response is about never changes: the requirement, the partner, the employer and the time it was sent; the
-- version only grows; the invitation and the members only become null (on delete set null).
create function private.partner_responses_immutable() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.requirement_id, new.organization_id, new.employer_organization_id, new.created_at)
     is distinct from (old.requirement_id, old.organization_id, old.employer_organization_id, old.created_at)
     or new.version < old.version
     or (new.invitation_id is distinct from old.invitation_id and new.invitation_id is not null)
     or (new.created_by is distinct from old.created_by and new.created_by is not null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.partner_responses_immutable() from public, anon, authenticated, service_role;

create trigger partner_responses_immutable
  before update on public.partner_responses
  for each row execute function private.partner_responses_immutable();

alter table public.partner_responses enable always trigger partner_responses_immutable;

-- The versions --------------------------------------------------------------------------------------------------------------

create function private.partner_response_fields() returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['capacity', 'available_from', 'timeline_note', 'experience_note', 'fee_model', 'fee_amount', 'fee_currency',
    'notes']
$$;

revoke all on function private.partner_response_fields() from public, anon, authenticated, service_role;

create table public.partner_response_versions (
  response_id uuid not null references public.partner_responses (id) on delete cascade,
  version integer not null check (version >= 1),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employer_organization_id uuid not null references public.organizations (id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  changed_fields text[] not null check (changed_fields <@ private.partner_response_fields()),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (response_id, version),
  check ((version = 1) = (cardinality(changed_fields) = 0))
);

comment on table public.partner_response_versions is
  'Every version of a partner response (FR-O2): the proposal as submitted (version 1, no changed fields) and after each edit that changed it, with the fields changed. Append-only; written only by respond_to_invitation and update_response; the members of the partner and of the employer read it.';
comment on column public.partner_response_versions.payload is
  'The proposal of this version: capacity, available_from, timeline_note, experience_note, fee_model, fee_amount, fee_currency, notes.';
comment on column public.partner_response_versions.created_by is
  'The partner member who wrote this version; cleared when the account is erased. Not readable through the Data API.';

create index partner_response_versions_organization_idx on public.partner_response_versions (organization_id);
create index partner_response_versions_employer_idx on public.partner_response_versions (employer_organization_id);
create index partner_response_versions_created_by_idx on public.partner_response_versions (created_by) where created_by is not null;

alter table public.partner_response_versions enable row level security;
alter table public.partner_response_versions force row level security;
revoke all on table public.partner_response_versions from public, anon, authenticated, service_role;
grant select (response_id, version, organization_id, employer_organization_id, payload, changed_fields, created_at)
  on public.partner_response_versions to authenticated;

create policy partner_response_versions_select_member on public.partner_response_versions
  for select to authenticated
  using (
    organization_id in (select private.member_org_ids())
    or employer_organization_id in (select private.member_org_ids())
  );

-- Append-only: nothing of a version changes, except created_by becoming null (the erasure of the member). Deletes come only
-- with the response (on delete cascade); no API role writes the table.
create function private.partner_response_versions_append_only() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.response_id, new.version, new.organization_id, new.employer_organization_id, new.payload, new.changed_fields,
      new.created_at)
     is distinct from (old.response_id, old.version, old.organization_id, old.employer_organization_id, old.payload,
      old.changed_fields, old.created_at)
     or new.created_by is not null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'append_only';
  end if;
  return new;
end;
$$;

revoke all on function private.partner_response_versions_append_only() from public, anon, authenticated, service_role;

create trigger partner_response_versions_append_only
  before update on public.partner_response_versions
  for each row execute function private.partner_response_versions_append_only();

alter table public.partner_response_versions enable always trigger partner_response_versions_append_only;

-- The eligibility decisions shown (SOP P2-20 output "response eligibility decisions", KPI "responses refused by reason") --

-- A refused call writes nothing (its transaction rolls back), so the refusals are recorded where the partner is told:
-- one row per job order, partner and reason that get_response_eligibility answered, with the first and last time.
create table stats.job_order_response_refusals (
  requirement_id uuid not null references public.workforce_requirements (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  reason text not null check (reason in (
    'requirement_not_open', 'job_order_access', 'served_country_missing', 'occupation_missing', 'employer_pays_commitment',
    'licence_required', 'job_order_responses_per_month'
  )),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (requirement_id, organization_id, reason)
);

comment on table stats.job_order_response_refusals is
  'FR-N2 KPI "responses refused by reason": the partner organisations told by get_response_eligibility that they cannot respond to a requirement, with the reason and the first and last time. No user. Written by that function only; no API role reads it.';

create index job_order_response_refusals_organization_idx on stats.job_order_response_refusals (organization_id);

alter table stats.job_order_response_refusals enable row level security;
alter table stats.job_order_response_refusals force row level security;
revoke all on table stats.job_order_response_refusals from public, anon, authenticated, service_role;

-- Usage: the monthly key job_order_responses_per_month counts every response of the month ---------------------------------

-- private.monthly_usage of 20261125100000_partner_usage_helpers.sql with the responses counted: every partner_responses
-- row of the organisation created since the start of the calendar month in UTC, whatever its status (a withdrawn
-- response still counts, FR-N2 AC6). The other monthly keys still count 0 until V48 and V66.
create or replace function private.monthly_usage(p_org uuid, p_limit_key text) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null or not exists (select 1 from billing.limit_keys k where k.key = p_limit_key and k.period = 'month') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'limit_key', errcode = '22023';
  end if;
  if p_limit_key = 'job_order_responses_per_month' then
    return (select count(*)::integer from public.partner_responses p
            where p.organization_id = p_org and p.created_at >= private.month_start());
  end if;
  return 0;
end;
$$;

-- private.requirement_response_count of 20261222100000_job_orders.sql, now counting: the responses a requirement has
-- received that are not withdrawn. list_job_orders and get_job_order show the number from job_order_response_count_min on.
create or replace function private.requirement_response_count(p_requirement uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.partner_responses p
  where p.requirement_id = p_requirement and p.status <> 'withdrawn'
$$;

-- Notification kinds -----------------------------------------------------------------------------------------------------

-- Optional, email on by default, for employers.
insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types) values
  ('response_received', false, true, 'company', 'Responses to your workforce requirements',
    array['employer']::public.organization_type[]),
  ('response_withdrawn', false, true, 'company', 'Withdrawn responses to your workforce requirements',
    array['employer']::public.organization_type[]);

update private.notification_kinds set label = 'Changes to workforce requirements you are invited to or responded to'
where kind = 'requirement_changed';
update private.notification_kinds set label = 'Closed workforce requirements you are invited to or responded to'
where kind = 'requirement_closed';

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon', 'job_order_match', 'invitation_received',
  'invitation_withdrawn', 'requirement_changed', 'requirement_closed', 'response_received', 'response_withdrawn'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- The waiting change notices of a marketplace response, found by the widening and by the suppression below.
create index notifications_requirement_changed_response_idx on public.notifications ((payload ->> 'response_id'))
  where kind = 'requirement_changed';

-- One message of p_kind about the response p_response, keyed p_dedupe_key, to each accepted owner and admin with an
-- active account of the responding partner while it is active; none to a recipient who already has the key. The
-- marketplace responders' share of the notices of V43 (FR-M2 AC6 P5). Answers the number queued, in the caller's
-- transaction (NFR-A3).
create function private.queue_response_message(p_response uuid, p_kind text, p_dedupe_key text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages jsonb[];
begin
  select array_agg(jsonb_build_object(
           'kind', p_kind, 'user_id', m.user_id, 'organization_id', p.organization_id, 'mandatory', k.mandatory,
           'dedupe_key', p_dedupe_key, 'partner_response_id', p.id)
         order by m.user_id)
  into v_messages
  from public.partner_responses p
  join public.organizations o on o.id = p.organization_id and o.status = 'active'
  join public.organization_members m on m.organization_id = p.organization_id and m.role in ('owner', 'admin')
    and m.accepted_at is not null
  join public.profiles u on u.id = m.user_id and u.status = 'active'
  join private.notification_kinds k on k.kind = p_kind
  where p.id = p_response
    and not exists (
      select 1 from public.notifications n where n.user_id = m.user_id and n.kind = p_kind and n.dedupe_key = p_dedupe_key);

  if v_messages is null then
    return 0;
  end if;
  perform pgmq.send_batch('notifications', v_messages);
  return cardinality(v_messages);
end;
$$;

revoke all on function private.queue_response_message(uuid, text, text) from public, anon, authenticated, service_role;

-- One message of p_kind (response_received, response_withdrawn) about the response p_response to each accepted owner and
-- admin with an active account of the employer while it is active, once per kind and response; none to members, pending
-- invitees or the partner (FR-T1 AC1). Answers the number queued, in the caller's transaction (NFR-A3).
create function private.queue_response_employer_event(p_response uuid, p_kind text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := p_kind || ':' || p_response;
  v_messages jsonb[];
begin
  select array_agg(jsonb_build_object(
           'kind', p_kind, 'user_id', m.user_id, 'organization_id', p.employer_organization_id, 'mandatory', k.mandatory,
           'dedupe_key', v_key, 'partner_response_id', p.id)
         order by m.user_id)
  into v_messages
  from public.partner_responses p
  join public.organizations o on o.id = p.employer_organization_id and o.status = 'active'
  join public.organization_members m on m.organization_id = p.employer_organization_id and m.role in ('owner', 'admin')
    and m.accepted_at is not null
  join public.profiles u on u.id = m.user_id and u.status = 'active'
  join private.notification_kinds k on k.kind = p_kind
  where p.id = p_response
    and not exists (
      select 1 from public.notifications n where n.user_id = m.user_id and n.kind = p_kind and n.dedupe_key = v_key);

  if v_messages is null then
    return 0;
  end if;
  perform pgmq.send_batch('notifications', v_messages);
  return cardinality(v_messages);
end;
$$;

revoke all on function private.queue_response_employer_event(uuid, text) from public, anon, authenticated, service_role;

-- Helpers ---------------------------------------------------------------------------------------------------------------

-- Whether the employer of p_requirement is named to the partner p_org: a reveal (invitation, shortlist, selection) or the
-- employer chose to show its name (decision 3.2, NFR-S11).
create function private.requirement_named_to(p_requirement uuid, p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.requirement_reveals rv where rv.requirement_id = p_requirement and rv.organization_id = p_org
  ) or exists (
    select 1 from public.workforce_requirements r where r.id = p_requirement and r.show_identity
  )
$$;

revoke all on function private.requirement_named_to(uuid, uuid) from public, anon, authenticated, service_role;

-- The destinations of p_requirement that need a licensed partner (FR-J2 AC9, decision 2.6, DATA_MODEL.md section 11 item
-- 6) and for which p_org holds no current licence: a direct-hiring rule licensed_partner_required names the destination
-- (destination_country, from any source country), and no licence entry of the partner for that country is valid until
-- today (UTC) or later. A rule for a source country with any destination names no destination and needs no licence here.
-- The main destination first, then by code.
create function private.response_licence_missing(p_requirement uuid, p_org uuid) returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(rc.country_code order by rc.country_code <> r.country_code, rc.country_code), '{}')
  from public.requirement_countries rc
  join public.workforce_requirements r on r.id = rc.requirement_id
  where rc.requirement_id = p_requirement
    and exists (
      select 1 from public.direct_hiring_rules d
      where d.destination_country = rc.country_code and d.rule = 'licensed_partner_required')
    and not exists (
      select 1 from public.partner_licences l
      where l.organization_id = p_org and l.country_code = rc.country_code
        and l.valid_until >= (now() at time zone 'utc')::date)
$$;

revoke all on function private.response_licence_missing(uuid, uuid) from public, anon, authenticated, service_role;

-- A caller who may respond for p_org or change its response: an accepted member (any role, no aal2, FR-N2 open point)
-- while release_job_orders is on, of a recruitment or staffing company that is active, listed and visible.
-- CHARA_FORBIDDEN (42501): no session or not a member; release_off; partner_only; organization_suspended; not_listed;
-- profile_hidden.
create function private.assert_responding_partner(p_org uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  perform private.assert_invitation_partner(p_org);
  select * into v_org from public.organizations o where o.id = p_org;
  if not private.is_listed_partner(p_org) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'not_listed', errcode = '42501';
  end if;
  if v_org.moderation_state <> 'visible' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_hidden', errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_responding_partner(uuid) from public, anon, authenticated, service_role;

-- Why the partner p_org cannot respond to the requirement p_row now: the first missing condition as the error a response
-- raises (message and detail), or a null message when it may (FR-N2 AC2, AC3, AC5, AC6, AC10; FR-J2 AC9). In order:
-- CHARA_NOT_FOUND when the partner may not see the requirement (no invitation that is invited, viewed, accepted or
-- responded, and not a published job order of the marketplace); CHARA_INVALID_STATE requirement_not_open (draft, paused, closed, filled, or
-- the employer suspended); CHARA_CONFLICT already_responded (any response, withdrawn ones too); CHARA_FEATURE_NOT_IN_PLAN
-- job_order_access (no paid plan with job order access, in both states of entitlements_enforced, decision 3.6); for a
-- marketplace response only, CHARA_FORBIDDEN served_country_missing or occupation_missing (private.job_order_reasons; an
-- invited partner was chosen by the employer); CHARA_CONSENT_REQUIRED employer-pays-commitment (FR-J3); CHARA_LICENCE_REQUIRED
-- with the first destination missing a licence; CHARA_LIMIT_REACHED job_order_responses_per_month when the monthly limit
-- applies (entitlements_enforced, or the partner lapsed) and is used up. Also answers the live invitation, the month's use,
-- the limit and whether it applies, for the eligibility panel. The caller holds the partner's lock when it writes.
create function private.response_refusal(p_org uuid, p_row public.workforce_requirements)
returns table (
  message text, detail text, invitation_id uuid, used integer, limit_value integer, applies boolean, licence_missing text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invitation uuid;
  v_facts record;
  v_reasons text[];
  v_used integer := private.monthly_usage(p_org, 'job_order_responses_per_month');
  v_limit integer := private.org_limit(p_org, 'job_order_responses_per_month');
  v_applies boolean := coalesce(
    (select (s.value #>> '{}')::boolean from private.settings s where s.key = 'entitlements_enforced'), false)
    or private.free_plan_restricted(p_org);
  v_missing text[];
begin
  select i.id into v_invitation from public.requirement_invitations i
  where i.requirement_id = p_row.id and i.organization_id = p_org and i.status in ('invited', 'viewed', 'accepted', 'responded');

  if v_invitation is null and (p_row.visibility is distinct from 'job_order_marketplace' or p_row.published_at is null) then
    return query select 'CHARA_NOT_FOUND'::text, null::text, null::uuid, v_used, v_limit, v_applies, null::text[];
    return;
  end if;
  if p_row.status <> 'open'
     or not exists (select 1 from public.organizations e where e.id = p_row.organization_id and e.status = 'active') then
    return query select 'CHARA_INVALID_STATE'::text, 'requirement_not_open'::text, v_invitation, v_used, v_limit, v_applies,
      null::text[];
    return;
  end if;
  if exists (select 1 from public.partner_responses p where p.requirement_id = p_row.id and p.organization_id = p_org) then
    return query select 'CHARA_CONFLICT'::text, 'already_responded'::text, v_invitation, v_used, v_limit, v_applies,
      null::text[];
    return;
  end if;
  select * into v_facts from private.job_order_partner_facts(p_org);
  if not v_facts.paid then
    return query select 'CHARA_FEATURE_NOT_IN_PLAN'::text, 'job_order_access'::text, v_invitation, v_used, v_limit,
      v_applies, null::text[];
    return;
  end if;
  if v_invitation is null then
    v_reasons := private.job_order_reasons(p_row.id, v_facts.paid, v_facts.served, v_facts.occupations);
    if cardinality(v_reasons) > 0 then
      return query select 'CHARA_FORBIDDEN'::text, v_reasons[1], v_invitation, v_used, v_limit, v_applies, null::text[];
      return;
    end if;
  end if;
  if not private.partner_commitment_current(p_org) then
    return query select 'CHARA_CONSENT_REQUIRED'::text, 'employer-pays-commitment'::text, v_invitation, v_used, v_limit,
      v_applies, null::text[];
    return;
  end if;
  v_missing := private.response_licence_missing(p_row.id, p_org);
  if cardinality(v_missing) > 0 then
    return query select 'CHARA_LICENCE_REQUIRED'::text, v_missing[1], v_invitation, v_used, v_limit, v_applies, v_missing;
    return;
  end if;
  if v_applies and v_limit is not null and v_used >= v_limit then
    return query select 'CHARA_LIMIT_REACHED'::text, 'job_order_responses_per_month'::text, v_invitation, v_used, v_limit,
      v_applies, null::text[];
    return;
  end if;
  return query select null::text, null::text, v_invitation, v_used, v_limit, v_applies, null::text[];
end;
$$;

revoke all on function private.response_refusal(uuid, public.workforce_requirements) from public, anon, authenticated, service_role;

-- Raises the refusal p_message with p_detail with the SQLSTATE of the codebase for it.
create function private.raise_response_refusal(p_message text, p_detail text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_message = 'CHARA_NOT_FOUND' then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  elsif p_message = 'CHARA_FORBIDDEN' then
    raise exception 'CHARA_FORBIDDEN' using detail = p_detail, errcode = '42501';
  end if;
  raise exception using message = p_message, detail = p_detail, errcode = 'P0001';
end;
$$;

revoke all on function private.raise_response_refusal(text, text) from public, anon, authenticated, service_role;

-- The most workers a response to p_row may offer: workers_needed plus max_capacity_over_percent, rounded down (FR-O2 AC4).
create function private.response_capacity_max(p_row public.workforce_requirements) returns integer
language sql
immutable
set search_path = ''
as $$ select floor(p_row.workers_needed * (100 + p_row.max_capacity_over_percent) / 100.0)::integer $$;

revoke all on function private.response_capacity_max(public.workforce_requirements) from public, anon, authenticated, service_role;

-- The proposal of the response p as stored, with the keys of private.partner_response_fields: the payload of its versions.
create function private.response_payload(p public.partner_responses) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'capacity', p.capacity, 'available_from', p.available_from, 'timeline_note', p.timeline_note,
    'experience_note', p.experience_note, 'fee_model', p.fee_model, 'fee_amount', p.fee_amount,
    'fee_currency', p.fee_currency, 'notes', p.notes)
$$;

revoke all on function private.response_payload(public.partner_responses) from public, anon, authenticated, service_role;

-- The proposal of a response checked and normalised (FR-O2 data and validation). Texts are trimmed, an empty optional
-- text is none, the currency is upper case. Refusals, CHARA_INVALID_INPUT: capacity missing or below 1 (capacity), above
-- the allowed maximum (capacity_above_allowed:<maximum>); available_from missing, before today (UTC) or more than three
-- years ahead (available_from; an unchanged date p_kept_from of an existing response is kept); experience missing or
-- outside 20 to 4,000 characters (experience_note); timeline over 1,000 (timeline_note); notes over 2,000 (notes); a
-- control character other than tab and line breaks in a text (the field); no fee model (fee_model). The fee rules and the
-- currency list are the table's (23514, 23503).
create function private.response_proposal(
  p_row public.workforce_requirements,
  p_capacity integer,
  p_available_from date,
  p_experience_note text,
  p_fee_model public.fee_model,
  p_fee_amount numeric,
  p_fee_currency text,
  p_timeline_note text,
  p_notes text,
  p_kept_from date default null
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_max integer := private.response_capacity_max(p_row);
  v_experience text := btrim(coalesce(p_experience_note, ''));
  v_timeline text := nullif(btrim(coalesce(p_timeline_note, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_controls text := '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]';
begin
  if p_capacity is null or p_capacity < 1 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'capacity';
  end if;
  if p_capacity > v_max then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'capacity_above_allowed:' || v_max;
  end if;
  if p_available_from is null
     or (p_available_from is distinct from p_kept_from
         and (p_available_from < v_today or p_available_from > (v_today + interval '3 years')::date)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'available_from';
  end if;
  if char_length(v_experience) not between 20 and 4000 or v_experience ~ v_controls then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'experience_note';
  end if;
  if char_length(v_timeline) > 1000 or v_timeline ~ v_controls then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'timeline_note';
  end if;
  if char_length(v_notes) > 2000 or v_notes ~ v_controls then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'notes';
  end if;
  if p_fee_model is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'fee_model';
  end if;
  return jsonb_build_object(
    'capacity', p_capacity, 'available_from', p_available_from, 'timeline_note', v_timeline,
    'experience_note', v_experience, 'fee_model', p_fee_model, 'fee_amount', round(p_fee_amount, 2),
    'fee_currency', upper(nullif(btrim(coalesce(p_fee_currency, '')), '')), 'notes', v_notes);
end;
$$;

revoke all on function private.response_proposal(
  public.workforce_requirements, integer, date, text, public.fee_model, numeric, text, text, text, date
) from public, anon, authenticated, service_role;

-- Responding ------------------------------------------------------------------------------------------------------------

-- The response of the partner p_org to the requirement p_requirement (FR-N2 step Respond, FR-O2 step Submit; AC1 to AC7 and
-- AC10 of FR-N2, AC1, AC3, AC4 of FR-O2, FR-J2 AC9). For an accepted member of an active, listed, visible partner
-- (private.assert_responding_partner); the conditions and their refusals of private.response_refusal, each writing
-- nothing and counting nothing; then the proposal (private.response_proposal; the fee rules 23514, an unknown currency
-- 23503); the daily quota of audited writes. The requirement is held against a close until the transaction ends, and one
-- advisory lock per partner holds the one-response rule and the monthly count, so a second call at the same time waits
-- and is then refused (already_responded, or the limit).
--
-- Writes the response (submitted, version 1, the invitation it answers) and its version 1, moves the invitation to
-- responded (from invited, viewed or accepted; DATA_MODEL.md section 5), one audit row response.created and one
-- response_received to the employer's owners and admins, all in this transaction. Answers the response id.
create function public.respond_to_invitation(
  p_org uuid,
  p_requirement uuid,
  p_capacity integer,
  p_available_from date,
  p_experience_note text,
  p_fee_model public.fee_model,
  p_fee_amount numeric default null,
  p_fee_currency text default null,
  p_timeline_note text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
  v_check record;
  v_proposal jsonb;
  v_id uuid;
begin
  perform private.assert_responding_partner(p_org);

  select * into v_row from public.workforce_requirements r where r.id = p_requirement for share;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('partner_responses:' || p_org::text, 0));

  select * into v_check from private.response_refusal(p_org, v_row);
  if v_check.message is not null then
    perform private.raise_response_refusal(v_check.message, v_check.detail);
  end if;

  v_proposal := private.response_proposal(v_row, p_capacity, p_available_from, p_experience_note, p_fee_model, p_fee_amount,
    p_fee_currency, p_timeline_note, p_notes);
  perform private.count_audited_write(p_org);

  insert into public.partner_responses (
    requirement_id, organization_id, employer_organization_id, invitation_id, capacity, available_from, timeline_note,
    experience_note, fee_model, fee_amount, fee_currency, notes, created_by
  ) values (
    v_row.id, p_org, v_row.organization_id, v_check.invitation_id, (v_proposal ->> 'capacity')::integer,
    (v_proposal ->> 'available_from')::date, v_proposal ->> 'timeline_note', v_proposal ->> 'experience_note',
    (v_proposal ->> 'fee_model')::public.fee_model, (v_proposal ->> 'fee_amount')::numeric, v_proposal ->> 'fee_currency',
    v_proposal ->> 'notes', (select auth.uid())
  )
  returning id into v_id;

  insert into public.partner_response_versions (
    response_id, version, organization_id, employer_organization_id, payload, changed_fields, created_by
  )
  select p.id, 1, p.organization_id, p.employer_organization_id, private.response_payload(p), '{}', p.created_by
  from public.partner_responses p where p.id = v_id;

  if v_check.invitation_id is not null then
    update public.requirement_invitations i
    set status = 'responded', responded_at = now(), answered_at = coalesce(i.answered_at, now()),
        viewed_at = coalesce(i.viewed_at, now())
    where i.id = v_check.invitation_id;
  end if;

  perform audit.record('response.created', 'partner_response', v_id::text,
    jsonb_strip_nulls(jsonb_build_object('requirement_id', v_row.id, 'organization_id', p_org,
      'employer_organization_id', v_row.organization_id, 'invitation_id', v_check.invitation_id,
      'fee_model', p_fee_model)));
  perform private.queue_response_employer_event(v_id, 'response_received');
  return v_id;
end;
$$;

revoke all on function public.respond_to_invitation(
  uuid, uuid, integer, date, text, public.fee_model, numeric, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.respond_to_invitation(
  uuid, uuid, integer, date, text, public.fee_model, numeric, text, text, text
) to authenticated;

-- The edit of the response p_response of the partner p_org before the employer decides (FR-O2 step Edit, AC8). For an
-- accepted member of an active, listed, visible partner. Refusals, each writing nothing: no such response of p_org,
-- CHARA_NOT_FOUND; a status other than submitted or updated, CHARA_INVALID_STATE with it; a closed or filled requirement,
-- CHARA_INVALID_STATE requirement_closed (a paused one keeps its responses and their edits); p_expected_version given and
-- not the current version, CHARA_CONFLICT stale; the proposal as when responding (an unchanged available_from is kept).
-- A call that changes no field writes nothing and answers the current version. Otherwise the response takes the new
-- values, the next version and the status updated, the version is kept with the fields changed, one audit row
-- response.updated names them; counts against the daily quota of audited writes. No notification: the employer sees
-- Updated (AC9). Answers the version.
create function public.update_response(
  p_org uuid,
  p_response uuid,
  p_capacity integer,
  p_available_from date,
  p_experience_note text,
  p_fee_model public.fee_model,
  p_fee_amount numeric default null,
  p_fee_currency text default null,
  p_timeline_note text default null,
  p_notes text default null,
  p_expected_version integer default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.partner_responses;
  v_row public.workforce_requirements;
  v_proposal jsonb;
  v_before jsonb;
  v_changed text[];
  v_version integer;
begin
  perform private.assert_responding_partner(p_org);
  select * into v_old from public.partner_responses p where p.id = p_response and p.organization_id = p_org for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.status not in ('submitted', 'updated') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_old.status::text;
  end if;
  select * into v_row from public.workforce_requirements r where r.id = v_old.requirement_id for share;
  if v_row.status in ('closed', 'filled') then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_closed';
  end if;
  if p_expected_version is not null and p_expected_version <> v_old.version then
    raise exception 'CHARA_CONFLICT' using detail = 'stale';
  end if;

  v_proposal := private.response_proposal(v_row, p_capacity, p_available_from, p_experience_note, p_fee_model, p_fee_amount,
    p_fee_currency, p_timeline_note, p_notes, v_old.available_from);
  v_before := private.response_payload(v_old);
  select coalesce(array_agg(f.name order by f.position), '{}') into v_changed
  from unnest(private.partner_response_fields()) with ordinality f(name, position)
  where (v_proposal -> f.name) is distinct from (v_before -> f.name);
  if cardinality(v_changed) = 0 then
    return v_old.version;
  end if;

  perform private.count_audited_write(p_org);
  v_version := v_old.version + 1;
  update public.partner_responses p
  set capacity = (v_proposal ->> 'capacity')::integer, available_from = (v_proposal ->> 'available_from')::date,
      timeline_note = v_proposal ->> 'timeline_note', experience_note = v_proposal ->> 'experience_note',
      fee_model = (v_proposal ->> 'fee_model')::public.fee_model, fee_amount = (v_proposal ->> 'fee_amount')::numeric,
      fee_currency = v_proposal ->> 'fee_currency', notes = v_proposal ->> 'notes',
      version = v_version, status = 'updated', updated_at = now()
  where p.id = v_old.id;
  insert into public.partner_response_versions (
    response_id, version, organization_id, employer_organization_id, payload, changed_fields, created_by
  )
  select p.id, v_version, p.organization_id, p.employer_organization_id, private.response_payload(p), v_changed,
    (select auth.uid())
  from public.partner_responses p where p.id = v_old.id;
  perform audit.record('response.updated', 'partner_response', v_old.id::text,
    jsonb_build_object('requirement_id', v_old.requirement_id, 'organization_id', p_org,
      'employer_organization_id', v_old.employer_organization_id, 'version', v_version, 'changed_fields', to_jsonb(v_changed)));
  return v_version;
end;
$$;

revoke all on function public.update_response(
  uuid, uuid, integer, date, text, public.fee_model, numeric, text, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.update_response(
  uuid, uuid, integer, date, text, public.fee_model, numeric, text, text, text, integer
) to authenticated;

-- The withdrawal of the response p_response of the partner p_org until the employer decides (FR-N2 step Withdraw, AC8,
-- AC10; FR-O2 step Withdraw), on an open, paused, closed or filled requirement. For any accepted member of the active
-- partner (private.assert_invitation_partner; a partner no longer listed or hidden may still withdraw). An optional reason
-- (trimmed, 1 to 500 characters, no control characters; empty is none) the employer reads; out of bounds CHARA_INVALID_INPUT
-- p_reason. No such response of p_org, CHARA_NOT_FOUND; a status other than submitted or updated, CHARA_INVALID_STATE with
-- it. One audit row response.withdrawn and one response_withdrawn to the employer's owners and admins; counts against the
-- daily quota of audited writes. The response still counts against the monthly limit; it cannot be replaced.
create function public.withdraw_response(p_org uuid, p_response uuid, p_reason text default null)
returns public.response_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.partner_responses;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.assert_invitation_partner(p_org);
  if char_length(v_reason) > 500 or v_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_reason';
  end if;
  select * into v_old from public.partner_responses p where p.id = p_response and p.organization_id = p_org for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.status not in ('submitted', 'updated') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_old.status::text;
  end if;
  perform private.count_audited_write(p_org);
  update public.partner_responses p
  set status = 'withdrawn', withdrawn_at = now(), withdrawal_reason = v_reason, updated_at = now()
  where p.id = v_old.id;
  perform audit.record('response.withdrawn', 'partner_response', v_old.id::text,
    jsonb_strip_nulls(jsonb_build_object('requirement_id', v_old.requirement_id, 'organization_id', p_org,
      'employer_organization_id', v_old.employer_organization_id, 'from', v_old.status,
      'with_reason', case when v_reason is not null then true end)));
  perform private.queue_response_employer_event(v_old.id, 'response_withdrawn');
  return 'withdrawn'::public.response_status;
end;
$$;

revoke all on function public.withdraw_response(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_response(uuid, uuid, text) to authenticated;

-- How many per cent above the workers needed partners may offer on the requirement p_requirement of p_org (FR-O2 AC4 and
-- data: set by the employer, 0 to 100). For an owner or admin at aal2 of the active employer
-- (private.assert_requirement_manager); no such requirement of p_org, CHARA_NOT_FOUND; closed or filled,
-- CHARA_INVALID_STATE with the status; another value, CHARA_INVALID_INPUT p_percent. Applies to responses and edits from
-- now on; responses already sent keep their capacity. A call with the current value writes nothing and answers false;
-- otherwise one audit row requirement.capacity_tolerance_set with the old and new values, true.
create function public.set_requirement_capacity_tolerance(p_org uuid, p_requirement uuid, p_percent integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
begin
  perform private.assert_requirement_manager(p_org);
  if p_percent is null or p_percent not between 0 and 100 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_percent';
  end if;
  select * into v_row from public.workforce_requirements r
  where r.id = p_requirement and r.organization_id = p_org
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status in ('closed', 'filled') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_row.status::text;
  end if;
  if v_row.max_capacity_over_percent = p_percent then
    return false;
  end if;
  perform private.count_audited_write(p_org);
  update public.workforce_requirements r set max_capacity_over_percent = p_percent where r.id = v_row.id;
  perform audit.record('requirement.capacity_tolerance_set', 'requirement', v_row.id::text,
    jsonb_build_object('organization_id', p_org, 'from', v_row.max_capacity_over_percent, 'to', p_percent));
  return true;
end;
$$;

revoke all on function public.set_requirement_capacity_tolerance(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.set_requirement_capacity_tolerance(uuid, uuid, integer) to authenticated;

-- Reading ---------------------------------------------------------------------------------------------------------------

-- Whether and why the partner p_org may respond to p_requirement now, for the eligibility panel of the job order and
-- invitation pages (FR-N2 AC1, AC4, AC12, FR-J2 AC10). For an accepted member of an active, listed, visible partner;
-- CHARA_NOT_FOUND when the partner may not see the requirement (as respond_to_invitation). refusal and detail are those a
-- response would raise now (null when it may respond); the partner's own response (id and status) once it responded;
-- the month's use, the limit (null is unlimited) and whether it applies, with the start of the next month; the most
-- workers it may offer when it may respond; the destinations missing a licence when that is the refusal. A refusal other
-- than already_responded is recorded once per job order, partner and reason (stats.job_order_response_refusals, KPI).
create function public.get_response_eligibility(p_org uuid, p_requirement uuid)
returns table (
  requirement_id uuid,
  can_respond boolean,
  refusal text,
  detail text,
  invited boolean,
  response_id uuid,
  response_status public.response_status,
  used integer,
  limit_value integer,
  applies boolean,
  period_resets_at timestamptz,
  max_capacity integer,
  licence_missing text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
  v_check record;
  v_response public.partner_responses;
begin
  perform private.assert_responding_partner(p_org);
  select * into v_row from public.workforce_requirements r where r.id = p_requirement;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_check from private.response_refusal(p_org, v_row);
  select * into v_response from public.partner_responses p where p.requirement_id = v_row.id and p.organization_id = p_org;
  if v_check.message = 'CHARA_NOT_FOUND' then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_check.message is not null and v_check.message <> 'CHARA_CONFLICT' then
    insert into stats.job_order_response_refusals as s (requirement_id, organization_id, reason)
    values (v_row.id, p_org, case when v_check.message = 'CHARA_LICENCE_REQUIRED' then 'licence_required'
      else replace(v_check.detail, '-', '_') end)
    on conflict on constraint job_order_response_refusals_pkey do update set last_seen_at = now();
  end if;

  return query select
    v_row.id,
    v_check.message is null,
    v_check.message,
    v_check.detail,
    v_check.invitation_id is not null,
    v_response.id,
    v_response.status,
    v_check.used,
    v_check.limit_value,
    v_check.applies,
    private.month_start(private.month_start() + interval '32 days'),
    case when v_check.message is null then private.response_capacity_max(v_row) end,
    v_check.licence_missing;
end;
$$;

revoke all on function public.get_response_eligibility(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_response_eligibility(uuid, uuid) to authenticated;

-- The responses of the partner p_org, newest first, pages of 20 by default and at most 50, from the cursor p_cursor (the id
-- of the last row of the previous page) on; next_cursor on the last row of a page that has a next one (FR-O2 pages of
-- V46). For any accepted member of the active partner (private.assert_invitation_partner). The requirement is shown as the
-- partner knows it: its own title and the employer's name only when the employer is named to the partner (an invitation,
-- a shortlist or selection, or the employer shows its name; NFR-S11), the generated title otherwise. A cursor that is not
-- a response of p_org, CHARA_INVALID_INPUT p_cursor.
create function public.list_my_responses(p_org uuid, p_cursor uuid default null, p_limit integer default null)
returns table (
  id uuid,
  requirement_id uuid,
  invitation_id uuid,
  status public.response_status,
  version integer,
  capacity integer,
  available_from date,
  fee_model public.fee_model,
  fee_amount numeric,
  fee_currency text,
  created_at timestamptz,
  updated_at timestamptz,
  withdrawn_at timestamptz,
  decided_at timestamptz,
  requirement_status public.requirement_status,
  title text,
  country_code text,
  workers_needed integer,
  employer_name text,
  next_cursor uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_cursor public.partner_responses;
begin
  perform private.assert_invitation_partner(p_org);
  if p_cursor is not null then
    select * into v_cursor from public.partner_responses p where p.id = p_cursor and p.organization_id = p_org;
    if not found then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end if;
  end if;
  return query
  with page as (
    select p.*, row_number() over (order by p.created_at desc, p.id) as n
    from public.partner_responses p
    where p.organization_id = p_org
      and (p_cursor is null or p.created_at < v_cursor.created_at or (p.created_at = v_cursor.created_at and p.id > p_cursor))
    order by p.created_at desc, p.id
    limit v_limit + 1
  )
  select p.id, p.requirement_id, p.invitation_id, p.status, p.version, p.capacity, p.available_from, p.fee_model,
    p.fee_amount, p.fee_currency, p.created_at, p.updated_at, p.withdrawn_at, p.decided_at, r.status,
    case when nm.named then r.title else private.job_order_neutral_title(r.id) end,
    r.country_code, r.workers_needed,
    case when nm.named then e.display_name end,
    case when p.n = v_limit and exists (select 1 from page x where x.n = v_limit + 1) then p.id end
  from page p
  join public.workforce_requirements r on r.id = p.requirement_id
  join public.organizations e on e.id = r.organization_id
  cross join lateral (select private.requirement_named_to(r.id, p_org) as named) nm
  where p.n <= v_limit
  order by p.n;
end;
$$;

revoke all on function public.list_my_responses(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_my_responses(uuid, uuid, integer) to authenticated;

-- One response for either party (FR-O2 AC1 read view, AC9; FR-N2 AC9, AC10: a response stays readable to both whatever the
-- requirement's status). p_org is the caller's organisation: the partner that sent it (any accepted member of the active
-- partner) reads its own response with the requirement as it knows it (title and employer name as list_my_responses); the
-- employer of the requirement (any accepted member) reads it with the partner's display name and slug, and the opening
-- marks the current version seen (the badge Updated, FR-O2 AC9; no audit row, the system records it). Any other response,
-- including another partner's, CHARA_NOT_FOUND, so a competing partner learns nothing. updated_unseen is for the employer.
create function public.get_response(p_org uuid, p_response uuid)
returns table (
  id uuid,
  requirement_id uuid,
  invitation_id uuid,
  status public.response_status,
  version integer,
  capacity integer,
  available_from date,
  timeline_note text,
  experience_note text,
  fee_model public.fee_model,
  fee_amount numeric,
  fee_currency text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  submissions_allowed boolean,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  updated_unseen boolean,
  requirement_status public.requirement_status,
  title text,
  country_code text,
  workers_needed integer,
  max_capacity integer,
  employer_name text,
  partner_name text,
  partner_slug text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resp public.partner_responses;
  v_row public.workforce_requirements;
  v_employer boolean;
  v_named boolean;
  v_unseen boolean;
begin
  if private.org_type(p_org) = 'employer' then
    perform private.assert_invitation_employer(p_org);
    v_employer := true;
  else
    perform private.assert_invitation_partner(p_org);
    v_employer := false;
  end if;
  select * into v_resp from public.partner_responses p
  where p.id = p_response and (case when v_employer then p.employer_organization_id else p.organization_id end) = p_org;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_row from public.workforce_requirements r where r.id = v_resp.requirement_id;
  v_named := v_employer or private.requirement_named_to(v_row.id, v_resp.organization_id);
  v_unseen := v_resp.status = 'updated' and v_resp.employer_seen_version < v_resp.version;
  if v_employer and v_resp.employer_seen_version < v_resp.version then
    update public.partner_responses p set employer_seen_version = p.version where p.id = v_resp.id;
  end if;

  return query select
    v_resp.id, v_resp.requirement_id, v_resp.invitation_id, v_resp.status, v_resp.version, v_resp.capacity,
    v_resp.available_from, v_resp.timeline_note, v_resp.experience_note, v_resp.fee_model, v_resp.fee_amount,
    v_resp.fee_currency, v_resp.notes, v_resp.created_at, v_resp.updated_at, v_resp.decided_at, v_resp.decision_note,
    v_resp.submissions_allowed, v_resp.withdrawn_at, v_resp.withdrawal_reason,
    case when v_employer then v_unseen end,
    v_row.status,
    case when v_named then v_row.title else private.job_order_neutral_title(v_row.id) end,
    v_row.country_code,
    v_row.workers_needed,
    private.response_capacity_max(v_row),
    case when v_named and not v_employer then (select e.display_name from public.organizations e where e.id = v_row.organization_id) end,
    case when v_employer then (select o.display_name from public.organizations o where o.id = v_resp.organization_id) end,
    case when v_employer then (select o.slug from public.organizations o where o.id = v_resp.organization_id) end;
end;
$$;

revoke all on function public.get_response(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_response(uuid, uuid) to authenticated;

-- The responses to the requirement p_requirement of p_org, oldest first (FR-O2 step Submit and Edit, FR-N2 AC9: the
-- employer sees each response, Updated until opened, and Withdrawn with the date and the reason), for any accepted member
-- of the employer while release 2b is on (private.assert_invitation_employer). Another organisation's requirement or an
-- unknown id, CHARA_NOT_FOUND. Every status is listed; the comparison and the decisions are V47's.
create function public.list_requirement_responses(p_org uuid, p_requirement uuid)
returns table (
  id uuid,
  organization_id uuid,
  partner_name text,
  partner_slug text,
  invitation_id uuid,
  status public.response_status,
  version integer,
  updated_unseen boolean,
  capacity integer,
  available_from date,
  fee_model public.fee_model,
  fee_amount numeric,
  fee_currency text,
  created_at timestamptz,
  updated_at timestamptz,
  decided_at timestamptz,
  withdrawn_at timestamptz,
  withdrawal_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_invitation_employer(p_org);
  if not exists (select 1 from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
  select p.id, p.organization_id, o.display_name, o.slug, p.invitation_id, p.status, p.version,
    p.status = 'updated' and p.employer_seen_version < p.version,
    p.capacity, p.available_from, p.fee_model, p.fee_amount, p.fee_currency, p.created_at, p.updated_at, p.decided_at,
    p.withdrawn_at, p.withdrawal_reason
  from public.partner_responses p
  join public.organizations o on o.id = p.organization_id
  where p.requirement_id = p_requirement and p.employer_organization_id = p_org
  order by p.created_at, p.id;
end;
$$;

revoke all on function public.list_requirement_responses(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_requirement_responses(uuid, uuid) to authenticated;

-- The versions of the response p_response, newest first, for either party as get_response decides it (FR-O2 AC7, AC9: the
-- history with the fields changed and the proposal of each version). Any other response, CHARA_NOT_FOUND.
create function public.list_response_versions(p_org uuid, p_response uuid)
returns table (version integer, created_at timestamptz, changed_fields text[], payload jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.org_type(p_org) = 'employer' then
    perform private.assert_invitation_employer(p_org);
  else
    perform private.assert_invitation_partner(p_org);
  end if;
  if not exists (
    select 1 from public.partner_responses p
    where p.id = p_response and (p.organization_id = p_org or p.employer_organization_id = p_org)
  ) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
  select v.version, v.created_at, v.changed_fields, v.payload
  from public.partner_response_versions v
  where v.response_id = p_response
  order by v.version desc;
end;
$$;

revoke all on function public.list_response_versions(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_response_versions(uuid, uuid) to authenticated;

-- The changes of the requirement of the response p_response of the partner p_org since the response was sent, newest first
-- (FR-M2 step Edit for the partners that responded; list_invitation_changes is the invited partners' read). For any
-- accepted member of the active partner; only while the response is submitted, updated, shortlisted or selected, never who
-- made the change. When the employer is not named to the partner (NFR-S11) the values of the title, the skills and the
-- city or region are left out (the field names stay). Another partner's response or an unknown id, CHARA_NOT_FOUND.
create function public.list_response_changes(p_org uuid, p_response uuid)
returns table (version integer, created_at timestamptz, changed_fields text[], old_values jsonb, new_values jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resp public.partner_responses;
  v_hidden text[];
begin
  perform private.assert_invitation_partner(p_org);
  select * into v_resp from public.partner_responses p where p.id = p_response and p.organization_id = p_org;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_resp.status not in ('submitted', 'updated', 'shortlisted', 'selected') then
    return;
  end if;
  v_hidden := case when private.requirement_named_to(v_resp.requirement_id, p_org) then '{}'::text[]
    else array['title', 'skills', 'city_region'] end;
  return query
  select v.version, v.created_at, v.changed_fields, v.old_values - v_hidden, v.new_values - v_hidden
  from public.requirement_versions v
  where v.requirement_id = v_resp.requirement_id and v.created_at >= v_resp.created_at
  order by v.version desc;
end;
$$;

revoke all on function public.list_response_changes(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_response_changes(uuid, uuid) to authenticated;

-- Notices to the partners that responded on the marketplace (V43 carry-over, FR-M2 AC6 P5, FR-T1 AC6) ----------------------

-- A response that ends (withdrawn, declined) drops its change notices whose email has not left, as an invitation that ends
-- does (V43): they become suppressed (suppressed_superseded) and the in-app item stays.
create function private.partner_responses_drop_change_notices() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications n set status = 'suppressed', email_status = 'suppressed_superseded'
  where n.kind = 'requirement_changed' and n.payload ->> 'response_id' = new.id::text and n.status = 'queued';
  return null;
end;
$$;

revoke all on function private.partner_responses_drop_change_notices() from public, anon, authenticated, service_role;

create trigger partner_responses_drop_change_notices
  after update of status on public.partner_responses
  for each row when (new.status in ('withdrawn', 'declined') and old.status is distinct from new.status)
  execute function private.partner_responses_drop_change_notices();

alter table public.partner_responses enable always trigger partner_responses_drop_change_notices;

-- private.queue_requirement_change of 20261229100100_requirement_versions.sql with one addition: the partners with a live
-- marketplace response (submitted, updated, shortlisted or selected, not through an invitation, whose partners the
-- invitation branch tells already) are recipients too, each response its own context like an invitation: its waiting
-- notice is widened, otherwise a new message keyed by the response and the version. Everything else is unchanged.
create or replace function private.queue_requirement_change(p_requirement uuid, p_version integer) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window integer := 60 * coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,4}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'requirement_change_notice_minutes'), 15);
  v_messages jsonb[];
begin
  if not private.release_on('release_job_orders') then
    return 0;
  end if;

  with recipients as (
    select 'invitation_id'::text as context_key, i.id as context_id, i.organization_id, m.user_id, k.mandatory
    from public.requirement_invitations i
    join public.organizations o on o.id = i.organization_id and o.status = 'active'
    join public.organization_members m on m.organization_id = i.organization_id and m.role in ('owner', 'admin')
      and m.accepted_at is not null
    join public.profiles u on u.id = m.user_id and u.status = 'active'
    join private.notification_kinds k on k.kind = 'requirement_changed'
    where i.requirement_id = p_requirement and i.status in ('invited', 'viewed', 'accepted', 'responded')
    union all
    select 'response_id'::text, p.id, p.organization_id, m.user_id, k.mandatory
    from public.partner_responses p
    join public.organizations o on o.id = p.organization_id and o.status = 'active'
    join public.organization_members m on m.organization_id = p.organization_id and m.role in ('owner', 'admin')
      and m.accepted_at is not null
    join public.profiles u on u.id = m.user_id and u.status = 'active'
    join private.notification_kinds k on k.kind = 'requirement_changed'
    where p.requirement_id = p_requirement and p.invitation_id is null
      and p.status in ('submitted', 'updated', 'shortlisted', 'selected')
  ), waiting as (
    select n.id, r.organization_id, r.context_key, r.context_id
    from public.notifications n
    join recipients r on r.user_id = n.user_id and n.payload ->> r.context_key = r.context_id::text
    left join pgmq.q_notifications q on q.msg_id = n.msg_id
    where n.kind = 'requirement_changed' and n.read_at is null
      and ((n.status = 'queued' and q.read_ct = 0 and q.vt > clock_timestamp())
        or (n.status = 'suppressed' and n.email_status = 'suppressed_by_preference'
          and n.created_at > now() - make_interval(secs => v_window)))
    for update of n
  ), locked as (
    select q.msg_id from pgmq.q_notifications q
    where q.msg_id in (select n.msg_id from public.notifications n where n.id in (select w.id from waiting w))
      and q.read_ct = 0 and q.vt > clock_timestamp()
    for update of q
  ), widened as (
    update public.notifications n
    set payload = private.notification_payload('requirement_changed', jsonb_build_object(
      'organization_id', w.organization_id,
      case w.context_key when 'invitation_id' then 'requirement_invitation_id' else 'partner_response_id' end, w.context_id,
      'from_version', n.payload -> 'from_version', 'to_version', p_version))
    from waiting w
    where n.id = w.id and (n.msg_id is null or n.msg_id in (select l.msg_id from locked l))
    returning n.user_id, w.context_id
  )
  select array_agg(jsonb_build_object(
           'kind', 'requirement_changed', 'user_id', r.user_id, 'organization_id', r.organization_id,
           'mandatory', r.mandatory, 'dedupe_key', 'requirement_changed:' || r.context_id || ':' || p_version,
           case r.context_key when 'invitation_id' then 'requirement_invitation_id' else 'partner_response_id' end,
           r.context_id, 'from_version', p_version, 'to_version', p_version)
         order by r.user_id)
  into v_messages
  from recipients r
  where not exists (select 1 from widened w where w.user_id = r.user_id and w.context_id = r.context_id);

  if v_messages is null then
    return 0;
  end if;
  perform pgmq.send_batch('notifications', v_messages, v_window);
  return cardinality(v_messages);
end;
$$;

-- private.remind_closing_requirements of 20261229100100_requirement_versions.sql with one addition: the partners with a
-- live marketplace response to the reminded requirement are told too, its owners and admins with an active account, once
-- per closing date. The employer's and the invited partners' parts are unchanged.
create or replace function private.remind_closing_requirements() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_days integer := coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,4}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'requirement_closing_reminder_days'), 7);
  v_row record;
  v_invitation uuid;
  v_response uuid;
  v_count integer := 0;
begin
  if not private.release_on('release_job_orders') then
    return 0;
  end if;
  for v_row in
    update public.workforce_requirements r
    set closing_reminder_for = r.closes_on
    where r.closes_on between v_today and v_today + v_days
      and (r.status = 'open' or (r.status = 'paused' and not private.requirement_paused_by_lapse(r.id)))
      and r.closing_reminder_for is distinct from r.closes_on
      and exists (select 1 from public.organizations o where o.id = r.organization_id and o.status = 'active')
    returning r.id, r.organization_id, r.closes_on
  loop
    perform private.queue_org_event(v_row.organization_id, 'requirement_closing_soon',
      jsonb_build_object('requirement_id', v_row.id), 'requirement_closing_soon:' || v_row.id || ':' || v_row.closes_on);
    for v_invitation in
      select i.id from public.requirement_invitations i
      where i.requirement_id = v_row.id and i.status in ('invited', 'viewed', 'accepted', 'responded')
      order by i.id
    loop
      perform private.queue_invitation_message(v_invitation, 'requirement_closing_soon',
        'requirement_closing_soon:' || v_row.id || ':' || v_row.closes_on);
    end loop;
    for v_response in
      select p.id from public.partner_responses p
      where p.requirement_id = v_row.id and p.invitation_id is null
        and p.status in ('submitted', 'updated', 'shortlisted', 'selected')
      order by p.id
    loop
      perform private.queue_response_message(v_response, 'requirement_closing_soon',
        'requirement_closing_soon:' || v_row.id || ':' || v_row.closes_on);
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- private.requirements_expire_invitations of 20261229100100_requirement_versions.sql with one addition: the partners with
-- a live marketplace response when the requirement closed or was filled get requirement_closed with the reason, once per
-- response, while release 2b is on. The expiry, its audit rows and the invited partners' notices are unchanged.
create or replace function private.requirements_expire_invitations() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv record;
  v_live uuid[];
begin
  select array_agg(i.id order by i.id) into v_live
  from public.requirement_invitations i
  where i.requirement_id = new.id and i.status in ('invited', 'viewed', 'accepted', 'responded');

  for v_inv in
    update public.requirement_invitations i set status = 'expired', expired_at = now()
    where i.requirement_id = new.id and i.status in ('invited', 'viewed', 'accepted')
    returning i.id, i.organization_id, i.employer_organization_id
  loop
    perform audit.record('requirement.invitation_expired', 'requirement_invitation', v_inv.id::text,
      jsonb_build_object('requirement_id', new.id, 'organization_id', v_inv.organization_id,
        'employer_organization_id', v_inv.employer_organization_id, 'requirement_status', new.status));
  end loop;

  if private.release_on('release_job_orders') then
    if v_live is not null then
      perform private.queue_invitation_event(l.id, 'requirement_closed') from unnest(v_live) l(id);
    end if;
    perform private.queue_response_message(p.id, 'requirement_closed', 'requirement_closed:' || p.id)
    from public.partner_responses p
    where p.requirement_id = new.id and p.invitation_id is null
      and p.status in ('submitted', 'updated', 'shortlisted', 'selected');
  end if;
  return null;
end;
$$;

-- private.notification_payload of 20261229100100_requirement_versions.sql with response_received and response_withdrawn
-- added and a marketplace responder's branch (a message naming partner_response_id) in requirement_closing_soon,
-- requirement_changed and requirement_closed: the requirement's own title and the employer's name only when the employer
-- is named to that partner (private.requirement_named_to), the generated title otherwise (NFR-S11), and the response id
-- for the link. Every other branch is unchanged.
create or replace function private.notification_payload(p_kind text, p_message jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_title text;
  v_slug text;
  v_org_name text;
  v_invitation_id uuid;
  v_role public.member_role;
  v_expires timestamptz;
  v_org_type public.organization_type;
  v_decision public.partner_review_decisions;
  v_licence_id uuid;
  v_country_code text;
  v_country_name text;
  v_valid_until date;
begin
  if p_message ->> 'job_id' is not null then
    select j.id, j.title, o.slug, o.display_name into v_job_id, v_title, v_slug, v_org_name
    from public.jobs j join public.organizations o on o.id = j.organization_id
    where j.id = (p_message ->> 'job_id')::uuid;
  end if;
  if p_message ->> 'organization_id' is not null then
    select o.slug, o.display_name into v_slug, v_org_name
    from public.organizations o where o.id = (p_message ->> 'organization_id')::uuid;
  end if;
  if p_message ->> 'invitation_id' is not null then
    select i.id, i.role, i.expires_at, o.display_name, o.type into v_invitation_id, v_role, v_expires, v_org_name, v_org_type
    from public.organization_invitations i join public.organizations o on o.id = i.organization_id
    where i.id = (p_message ->> 'invitation_id')::uuid;
  end if;
  if p_message ->> 'decision_id' is not null then
    select * into v_decision from public.partner_review_decisions d where d.id = (p_message ->> 'decision_id')::bigint;
  end if;
  if p_message ->> 'licence_id' is not null then
    select l.id, l.country_code, c.name, l.valid_until into v_licence_id, v_country_code, v_country_name, v_valid_until
    from public.partner_licences l join public.countries c on c.code = l.country_code
    where l.id = (p_message ->> 'licence_id')::uuid;
  end if;

  return jsonb_strip_nulls(case p_kind
    when 'application_received' then case
      when p_message ? 'vacancies' then jsonb_build_object(
        'total', p_message -> 'total',
        'vacancies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'job_id', j.id, 'job_title', j.title, 'org_name', o.display_name, 'org_slug', o.slug, 'count', v.item -> 'count'
          ) order by v.position)
          from jsonb_array_elements(p_message -> 'vacancies') with ordinality as v(item, position)
          join public.jobs j on j.id = (v.item ->> 'job_id')::uuid
          join public.organizations o on o.id = j.organization_id
        ), '[]'::jsonb))
      else jsonb_build_object(
        'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name, 'org_slug', v_slug)
    end
    when 'status_changed' then jsonb_build_object(
      'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name,
      'status', p_message -> 'status')
    when 'vacancy_hidden' then jsonb_build_object(
      'job_id', v_job_id, 'job_title', v_title, 'org_slug', v_slug, 'reasons', p_message -> 'reasons',
      'moderation_action_id', p_message -> 'moderation_action_id')
    when 'trial_ending' then jsonb_build_object(
      'org_slug', v_slug, 'trial_ends_at', p_message -> 'trial_ends_at', 'plan_code', p_message -> 'plan_code',
      'plan_name', p_message -> 'plan_name',
      'amount_minor', p_message -> 'amount_minor', 'currency', p_message -> 'currency')
    when 'payment_failed' then jsonb_build_object('org_slug', v_slug)
    when 'legal_version' then jsonb_build_object(
      'document_slug', p_message -> 'document_slug', 'version', p_message -> 'version',
      'change_summary', p_message -> 'change_summary')
    when 'account_suspended' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug,
      'moderation_action_id', p_message -> 'moderation_action_id')
    when 'account_reinstated' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug)
    when 'member_invitation' then jsonb_build_object(
      'invitation_id', v_invitation_id, 'org_name', v_org_name, 'role', v_role, 'expires_at', v_expires, 'org_type', v_org_type)
    when 'deletion_requested' then jsonb_build_object('erases_on', p_message -> 'erases_on')
    when 'erasure_paused' then jsonb_build_object('account_id', p_message -> 'user_id')
    -- The reason of an approval stays in the staff record, as in partner_review_outcome.
    when 'partner_approved' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at)
    when 'partner_info_requested' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at,
      'info_step', v_decision.info_step, 'reason', v_decision.reason)
    when 'partner_declined' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at,
      'reason', v_decision.reason)
    when 'licence_expiring' then jsonb_build_object(
      'licence_id', v_licence_id, 'country_code', v_country_code, 'country_name', v_country_name,
      'valid_until', v_valid_until, 'org_name', v_org_name, 'org_slug', v_slug)
    when 'partner_licence_expired' then jsonb_build_object(
      'licence_id', v_licence_id, 'country_code', v_country_code, 'country_name', v_country_name,
      'valid_until', v_valid_until, 'org_name', v_org_name, 'org_slug', v_slug)
    -- The ten listings confirmed longest ago are named; total says how many are due.
    when 'listing_confirmation_due' then jsonb_build_object(
      'org_name', v_org_name, 'org_slug', v_slug,
      'total', jsonb_array_length(coalesce(p_message -> 'listing_ids', '[]'::jsonb)),
      'stale_days', (select (s.value #>> '{}')::integer from private.settings s where s.key = 'workforce_listing_stale_days'),
      'listings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'listing_id', x.id, 'occupation', x.label, 'country_name', x.name, 'confirmed_at', x.confirmed_at
        ) order by x.confirmed_at, x.id)
        from (
          select w.id, oc.label, c.name, w.confirmed_at
          from jsonb_array_elements_text(coalesce(p_message -> 'listing_ids', '[]'::jsonb)) e(id)
          join public.workforce_availability w on w.id = e.id::uuid
          join public.occupations oc on oc.code = w.occupation_id
          join public.countries c on c.code = w.source_country
          order by w.confirmed_at, w.id
          limit 10
        ) x
      ), '[]'::jsonb))
    when 'followed_company_activity' then jsonb_build_object(
      'organization_id', p_message -> 'organization_id', 'org_name', v_org_name, 'org_slug', v_slug,
      'total', jsonb_array_length(coalesce(p_message -> 'job_ids', '[]'::jsonb)),
      'vacancies', coalesce((
        select jsonb_agg(jsonb_build_object('job_id', x.id, 'job_title', x.title) order by x.position)
        from (
          select j.id, j.title, e.position
          from jsonb_array_elements_text(coalesce(p_message -> 'job_ids', '[]'::jsonb)) with ordinality e(id, position)
          join public.jobs j on j.id = e.id::uuid
          order by e.position
          limit 10
        ) x
      ), '[]'::jsonb))
    when 'moderation_decision' then case
      when p_message ? 'report_id' then jsonb_build_object(
        'reference', private.report_reference((p_message ->> 'report_id')::bigint), 'outcome', p_message -> 'outcome')
      when p_message ? 'appeal_id' then jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case when p_message ->> 'target_type' = 'job' then v_title else v_org_name end,
        'org_slug', v_slug, 'appeal_id', p_message -> 'appeal_id', 'appeal_outcome', p_message -> 'appeal_outcome',
        'reasons', p_message -> 'reasons', 'moderation_action_id', p_message -> 'moderation_action_id')
      else jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case when p_message ->> 'target_type' = 'partner_profile' then v_org_name end,
        'org_slug', v_slug, 'decision', p_message -> 'decision', 'reasons', p_message -> 'reasons',
        'moderation_action_id', p_message -> 'moderation_action_id')
    end
    when 'data_export_ready' then jsonb_build_object('export_id', p_message -> 'export_id', 'expires_at', p_message -> 'expires_at')
    -- The recipient's own organisation names the link; never the employer to a partner. A partner's reminder (V43) names
    -- its invitation for the link to its invitation page.
    when 'requirement_closing_soon' then case
      when p_message ? 'requirement_invitation_id' then coalesce((
        select jsonb_build_object('requirement_id', r.id, 'invitation_id', i.id, 'title', r.title, 'closes_on', r.closes_on,
          'org_slug', v_slug)
        from public.requirement_invitations i join public.workforce_requirements r on r.id = i.requirement_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
      -- V44: a marketplace responder, which the requirement's own title names only when the employer is named to it.
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('requirement_id', r.id, 'response_id', p.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'closes_on', r.closes_on, 'org_slug', v_slug)
        from public.partner_responses p join public.workforce_requirements r on r.id = p.requirement_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('requirement_id', r.id, 'title', r.title, 'closes_on', r.closes_on, 'org_slug', v_slug)
        from public.workforce_requirements r where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    end
    -- NFR-S11: the generated title and the destination only, whatever the employer chose to show; the slug is the
    -- recipient partner's own, for the link to its job order page.
    when 'job_order_match' then coalesce((
      select jsonb_build_object('requirement_id', r.id, 'title', private.job_order_neutral_title(r.id),
        'country_code', r.country_code, 'country_name', c.name, 'org_slug', v_slug)
      from public.workforce_requirements r join public.countries c on c.code = r.country_code
      where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    -- An invitation reveals the employer to the invited partner (decision 3.2; NFR-S11 protects the partners that are
    -- not invited or selected), so the item and the email name the requirement's own title and the employer (FR-O1
    -- AC7, AC11), and nothing else of the employer: no member, no address. The slug is the recipient partner's own.
    when 'invitation_received' then coalesce((
      select jsonb_build_object('invitation_id', i.id, 'title', r.title,
        'country_code', r.country_code, 'country_name', c.name, 'workers_needed', r.workers_needed,
        'start_date', r.start_date, 'employer_name', e.display_name, 'org_slug', v_slug)
      from public.requirement_invitations i
      join public.workforce_requirements r on r.id = i.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    when 'invitation_withdrawn' then coalesce((
      select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name, 'org_slug', v_slug)
      from public.requirement_invitations i
      join public.workforce_requirements r on r.id = i.requirement_id
      join public.organizations e on e.id = r.organization_id
      where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    -- V43: the invitation reveals the requirement's own title and the employer to the invited partner (as
    -- invitation_received); the change notice names the fields changed in the versions from_version to to_version, in
    -- the order of the form, never their values, who changed them or anything the invitation did not show.
    when 'requirement_changed' then case
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
          'changed_fields', (
            select coalesce(jsonb_agg(f.name order by f.position), '[]')
            from unnest(private.requirement_change_fields()) with ordinality f(name, position)
            where exists (
              select 1 from public.requirement_versions v
              where v.requirement_id = r.id and f.name = any (v.changed_fields)
                and v.version between (p_message ->> 'from_version')::integer and (p_message ->> 'to_version')::integer)),
          'from_version', (p_message ->> 'from_version')::integer, 'to_version', (p_message ->> 'to_version')::integer,
          'org_slug', v_slug)
        from public.partner_responses p
        join public.workforce_requirements r on r.id = p.requirement_id
        join public.organizations e on e.id = r.organization_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name,
          'changed_fields', (
            select coalesce(jsonb_agg(f.name order by f.position), '[]')
            from unnest(private.requirement_change_fields()) with ordinality f(name, position)
            where exists (
              select 1 from public.requirement_versions v
              where v.requirement_id = r.id and f.name = any (v.changed_fields)
                and v.version between (p_message ->> 'from_version')::integer and (p_message ->> 'to_version')::integer)),
          'from_version', (p_message ->> 'from_version')::integer, 'to_version', (p_message ->> 'to_version')::integer,
          'org_slug', v_slug)
        from public.requirement_invitations i
        join public.workforce_requirements r on r.id = i.requirement_id
        join public.organizations e on e.id = r.organization_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    end
    when 'requirement_closed' then case
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
          'close_reason', r.close_reason, 'org_slug', v_slug)
        from public.partner_responses p
        join public.workforce_requirements r on r.id = p.requirement_id
        join public.organizations e on e.id = r.organization_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name,
          'close_reason', r.close_reason, 'org_slug', v_slug)
        from public.requirement_invitations i
        join public.workforce_requirements r on r.id = i.requirement_id
        join public.organizations e on e.id = r.organization_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    end
    -- V44: to the employer's owners and admins, the requirement's own title and the partner's display name; never the
    -- statement, the fee or the withdrawal reason of the response (FR-T1 AC2). The slug is the employer's own.
    when 'response_received' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id, 'title', r.title,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations o on o.id = p.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
    when 'response_withdrawn' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id, 'title', r.title,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations o on o.id = p.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
    else '{}'::jsonb
  end);
end;
$$;
