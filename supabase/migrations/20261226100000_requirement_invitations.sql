-- Invitations of partners to workforce requirements, data (FR-O1, SOP P2-21; FR-M3 AC9 and step Measure; decisions 2.2,
-- 3.1, 3.2; NFR-S8, NFR-S11, NFR-A3, NFR-A4, NFR-O5; docs/phase-2/DATA_MODEL.md sections 5, 6, 7, 9 and 10; release 2b).
-- An owner or admin at aal2 of an active employer invites listed, active, visible recruitment and staffing companies to
-- one of its open requirements (invite_partners), private or on the marketplace. Each invitation reveals the employer's
-- name to that partner (private.record_requirement_reveal of V39) and tells the partner's owners and admins
-- (invitation_received). The partner's members read the invitation with the requirement (get_invitation, the first open
-- marks it viewed) and accept or decline it (answer_invitation); the employer's members follow every invitation of a
-- requirement (list_requirement_invitations, requirement_invitation_usage) and the owners and admins withdraw one before
-- a response (withdraw_invitation, invitation_withdrawn to the partner). Closing or filling the requirement expires the
-- invitations that are still pending, whatever function closes it (a trigger on the requirement, no notification beyond
-- the closing notice of V43); a pause keeps them and takes no new ones. Accepted -> Responded is V44's.
--
-- Limits (NFR-A4): the invitations of one requirement that are not withdrawn count against
-- partner_invitations_per_requirement of the employer's plan (3 / 10 / 25, free 0) while entitlements_enforced is on or
-- the employer has lapsed (private.assert_within_limit), and every employer sends at most partner_invitations_per_day_max
-- (50, settings editor) invitations in 24 hours whatever its plan (an anti-spam cap, CHARA_RATE_LIMITED). Both are counted
-- under one advisory lock per employer, so two calls at the same time never pass a limit together, and a call that would
-- pass either writes nothing. The source of each invitation (suggestions, directory, profile) is stored, and an
-- invitation from the suggestions keeps the criteria the partner met at that moment (FR-M3 AC9; KPI invitations from
-- suggestions). Every function a user calls refuses to run while release_job_orders is false; the expiry runs whatever
-- the switch says, so the data stay right.

create type public.invitation_status as enum ('invited', 'viewed', 'accepted', 'declined', 'responded', 'withdrawn', 'expired');

insert into private.settings (key, value) values ('partner_invitations_per_day_max', '50') on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('partner_invitations_per_day_max', 'integer', 1, 1000, 'Partner invitations an employer sends in 24 hours, at most', null);

-- The invitations -------------------------------------------------------------------------------------------------------

create table public.requirement_invitations (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.workforce_requirements (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employer_organization_id uuid not null references public.organizations (id) on delete cascade,
  status public.invitation_status not null default 'invited',
  source text not null check (source in ('suggestions', 'directory', 'profile')),
  suggestion_criteria text[] check (
    suggestion_criteria <@ array['industry', 'recruitment_type', 'capacity', 'available_before_start']
  ),
  invited_by uuid references public.profiles (id) on delete set null,
  invited_at timestamptz not null default now(),
  viewed_at timestamptz,
  answered_at timestamptz,
  decline_reason text check (
    decline_reason = btrim(decline_reason) and char_length(decline_reason) between 1 and 500
    and decline_reason !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  ),
  responded_at timestamptz,
  withdrawn_at timestamptz,
  expired_at timestamptz,
  constraint requirement_invitations_partner_key unique (requirement_id, organization_id),
  constraint requirement_invitations_criteria_source check ((source = 'suggestions') = (suggestion_criteria is not null)),
  constraint requirement_invitations_answer check (status not in ('accepted', 'declined') or answered_at is not null),
  constraint requirement_invitations_decline_reason check (decline_reason is null or status = 'declined'),
  constraint requirement_invitations_withdrawn check ((status = 'withdrawn') = (withdrawn_at is not null)),
  constraint requirement_invitations_expired check ((status = 'expired') = (expired_at is not null)),
  constraint requirement_invitations_responded check ((status = 'responded') = (responded_at is not null)),
  constraint requirement_invitations_viewed check (status <> 'viewed' or viewed_at is not null)
);

comment on table public.requirement_invitations is
  'Invitations of recruitment and staffing companies to workforce requirements (FR-O1): one per requirement and partner. Members of the partner and of the employer read their own; written only by invite_partners, get_invitation (viewed), answer_invitation, withdraw_invitation, the expiry on close and the responses of V44.';
comment on column public.requirement_invitations.source is
  'Where the employer chose the partner: suggestions (FR-M3), directory (FR-L1, FR-L2) or profile (FR-K4); the KPI invitations from suggestions.';
comment on column public.requirement_invitations.suggestion_criteria is
  'For an invitation from the suggestions only: the criteria of suggest_partners the partner met when it was invited (FR-M3 AC9). No personal data.';
comment on column public.requirement_invitations.invited_by is
  'The employer member who sent the invitation; cleared when the account is erased. Not readable through the Data API.';
comment on column public.requirement_invitations.answered_at is
  'When the partner accepted or declined; kept when the invitation later becomes responded, withdrawn or expired.';
comment on column public.requirement_invitations.decline_reason is
  'The optional reason of a decline (up to 500 characters), shown to the employer.';

create index requirement_invitations_organization_idx on public.requirement_invitations (organization_id, invited_at desc, id);
create index requirement_invitations_employer_idx on public.requirement_invitations (employer_organization_id, invited_at);
create index requirement_invitations_invited_by_idx on public.requirement_invitations (invited_by) where invited_by is not null;
create index requirement_invitations_pending_idx on public.requirement_invitations (requirement_id)
  where status in ('invited', 'viewed', 'accepted');

alter table public.requirement_invitations enable row level security;
alter table public.requirement_invitations force row level security;
revoke all on table public.requirement_invitations from public, anon, authenticated, service_role;
grant select (
  id, requirement_id, organization_id, employer_organization_id, status, source, invited_at, viewed_at, answered_at,
  decline_reason, responded_at, withdrawn_at, expired_at
) on public.requirement_invitations to authenticated;

create policy requirement_invitations_select_member on public.requirement_invitations
  for select to authenticated
  using (
    organization_id in (select private.member_org_ids())
    or employer_organization_id in (select private.member_org_ids())
  );

-- The moves of DATA_MODEL.md section 5: invited -> viewed; invited or viewed -> accepted, declined or responded (a
-- response that accepts, V44); accepted -> responded; invited, viewed or accepted -> withdrawn (employer) or expired
-- (requirement closed or filled). Declined, responded, withdrawn and expired are final. No API role writes the table, so
-- this holds the functions of this and later units to the table of states.
create function private.requirement_invitations_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    (old.status = 'invited' and new.status = 'viewed')
    or (old.status in ('invited', 'viewed') and new.status in ('accepted', 'declined', 'responded'))
    or (old.status = 'accepted' and new.status = 'responded')
    or (old.status in ('invited', 'viewed', 'accepted') and new.status in ('withdrawn', 'expired'))
  ) then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = old.status || ' to ' || new.status;
  end if;
  if (new.requirement_id, new.organization_id, new.employer_organization_id, new.source, new.invited_at)
     is distinct from (old.requirement_id, old.organization_id, old.employer_organization_id, old.source, old.invited_at)
     or new.suggestion_criteria is distinct from old.suggestion_criteria then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.requirement_invitations_guard() from public, anon, authenticated, service_role;

create trigger requirement_invitations_guard
  before update of status on public.requirement_invitations
  for each row when (old.status is distinct from new.status)
  execute function private.requirement_invitations_guard();

alter table public.requirement_invitations enable always trigger requirement_invitations_guard;

-- Notifications ---------------------------------------------------------------------------------------------------------

-- Optional, email on by default, for recruitment and staffing companies.
insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types) values
  ('invitation_received', false, true, 'company', 'Invitations to workforce requirements',
    array['recruitment_company', 'staffing_company']::public.organization_type[]),
  ('invitation_withdrawn', false, true, 'company', 'Withdrawn invitations',
    array['recruitment_company', 'staffing_company']::public.organization_type[]);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon', 'job_order_match', 'invitation_received',
  'invitation_withdrawn'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- One message of p_kind about the invitation p_invitation to each accepted owner and admin of the invited partner whose
-- account is active (not suspended or awaiting deletion, as the job order alert), while the partner is active; none to
-- members or pending invitees, and none to a recipient who already has it (dedupe key per kind and invitation). The
-- message names the invitation only (requirement_invitation_id, so the member invitation branch of the payload is not
-- read); the payload decides what the partner is told. Answers the number queued, in the caller's transaction (NFR-A3).
create function private.queue_invitation_event(p_invitation uuid, p_kind text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := p_kind || ':' || p_invitation;
  v_messages jsonb[];
begin
  select array_agg(jsonb_build_object(
           'kind', p_kind, 'user_id', m.user_id, 'organization_id', i.organization_id, 'mandatory', k.mandatory,
           'dedupe_key', v_key, 'requirement_invitation_id', i.id)
         order by m.user_id)
  into v_messages
  from public.requirement_invitations i
  join public.organizations o on o.id = i.organization_id and o.status = 'active'
  join public.organization_members m on m.organization_id = i.organization_id and m.role in ('owner', 'admin')
    and m.accepted_at is not null
  join public.profiles u on u.id = m.user_id and u.status = 'active'
  join private.notification_kinds k on k.kind = p_kind
  where i.id = p_invitation
    and not exists (
      select 1 from public.notifications n where n.user_id = m.user_id and n.kind = p_kind and n.dedupe_key = v_key);

  if v_messages is null then
    return 0;
  end if;
  perform pgmq.send_batch('notifications', v_messages);
  return cardinality(v_messages);
end;
$$;

revoke all on function private.queue_invitation_event(uuid, text) from public, anon, authenticated, service_role;

-- Helpers ---------------------------------------------------------------------------------------------------------------

-- Whether p_org may be invited: a recruitment or staffing company that is listed (private.is_listed_partner: listed, not
-- declined, active) and visible (not hidden by moderation), as the directories show it.
create function private.invitable_partner(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org and o.type in ('recruitment_company', 'staffing_company') and o.moderation_state = 'visible'
  ) and private.is_listed_partner(p_org)
$$;

revoke all on function private.invitable_partner(uuid) from public, anon, authenticated, service_role;

-- The criteria of suggest_partners (20261220100000) that the partner p_partner meets for the requirement p_requirement
-- now, in the order of that function: industry, recruitment_type, capacity (for every occupation, the partner's fresh
-- listings of it summed over the source countries hold the quantity) and available_before_start (the same with the
-- listings available on or before the start date). The same rules as the suggestions; pgTAP 166 holds the two equal.
create function private.suggestion_criteria(p_requirement uuid, p_partner uuid) returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when exists (
      select 1 from public.organization_industries i where i.organization_id = o.id and i.industry_code = r.industry_code
    ) then 'industry' end,
    case when o.recruitment_type = 'both' or r.recruitment_preference = 'both'
      or o.recruitment_type = r.recruitment_preference then 'recruitment_type' end,
    case when cov.covered then 'capacity' end,
    case when cov.covered_by_start then 'available_before_start' end
  ], null)
  from public.workforce_requirements r
  cross join public.organizations o
  cross join lateral (
    select
      bool_and(coalesce(f.available, 0) >= q.quantity) as covered,
      bool_and(coalesce(f.available_by_start, 0) >= q.quantity) as covered_by_start
    from public.requirement_occupations q
    cross join lateral (
      select
        sum(a.available) as available,
        sum(a.available) filter (where a.available_from <= r.start_date) as available_by_start
      from public.workforce_availability a
      where a.organization_id = o.id and a.occupation_id = q.occupation_id and a.confirmed_at > private.workforce_fresh_since()
    ) f
    where q.requirement_id = r.id
  ) cov
  where r.id = p_requirement and o.id = p_partner
$$;

revoke all on function private.suggestion_criteria(uuid, uuid) from public, anon, authenticated, service_role;

-- A caller of the partner side: an accepted member of p_org (any role, no aal2, like the job order pages) while
-- release_job_orders is on, of a recruitment or staffing company that is active. Not listed any more is no refusal: an
-- invitation stays readable to the company it was sent to. CHARA_FORBIDDEN (42501) for a non-member, release_off,
-- partner_only, organization_suspended.
create function private.assert_invitation_partner(p_org uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_job_orders') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  select * into v_org from public.organizations o where o.id = p_org;
  if v_org.type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'partner_only', errcode = '42501';
  end if;
  if v_org.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended', errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_invitation_partner(uuid) from public, anon, authenticated, service_role;

-- A reader of the employer side: an accepted member of the employer p_org (any role) while release_job_orders is on.
create function private.assert_invitation_employer(p_org uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_job_orders') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if private.org_type(p_org) <> 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'employer_only', errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_invitation_employer(uuid) from public, anon, authenticated, service_role;

-- Inviting ----------------------------------------------------------------------------------------------------------------

-- Invites the partners p_partners (1 to 25 distinct ids) to the requirement p_requirement of p_org, chosen in p_source
-- (suggestions, directory or profile) (FR-O1 AC1 to AC6; FR-M3 AC9). For an owner or admin at aal2 of the active employer
-- (private.assert_requirement_manager: CHARA_FORBIDDEN, aal2_required, release_off, employer_only). Refusals, in this
-- order, each writing nothing: p_partners empty, null, repeated or more than 25, CHARA_INVALID_INPUT p_partners; another
-- source, CHARA_INVALID_INPUT p_source; no such requirement of p_org, CHARA_NOT_FOUND; a requirement that is not open
-- (draft, paused, closed, filled), CHARA_INVALID_STATE requirement_not_open; any partner that cannot be invited (not a
-- recruitment or staffing company, not listed, declined, suspended, hidden, unknown), CHARA_INVALID_INPUT
-- partner_unavailable for the whole call, without saying which or why; more invitations than the plan allows for the
-- requirement (those not withdrawn count, the call as a whole), CHARA_LIMIT_REACHED partner_invitations_per_requirement;
-- more than partner_invitations_per_day_max new invitations of the employer in 24 hours, CHARA_RATE_LIMITED
-- partner_invitations_per_day; the daily quota of audited writes, CHARA_RATE_LIMITED.
--
-- A partner already invited to the requirement (in any status) gets no second row: its invitation is returned with
-- already_invited true and nothing is sent again. Each new invitation is one row (invited, invited_by the caller), one
-- audit row requirement.invitation_sent (the invitation, with the requirement and the partner), one reveal of the employer
-- name (cause invitation) and one invitation_received to the partner's owners and admins, all in this transaction. The
-- answer lists every partner of the call with its invitation, in the order given.
create function public.invite_partners(p_org uuid, p_requirement uuid, p_partners uuid[], p_source text)
returns table (invitation_id uuid, organization_id uuid, status public.invitation_status, already_invited boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.workforce_requirements;
  v_new uuid[];
  v_used integer;
  v_day_max integer := coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,6}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'partner_invitations_per_day_max'), 50);
  v_partner uuid;
  v_id uuid;
begin
  perform private.assert_requirement_manager(p_org);

  if p_partners is null or cardinality(p_partners) not between 1 and 25 or array_position(p_partners, null) is not null
     or (select count(distinct x) from unnest(p_partners) x) <> cardinality(p_partners) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_partners';
  end if;
  if p_source is null or p_source not in ('suggestions', 'directory', 'profile') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_source';
  end if;

  -- The requirement is held against a close, fill or pause until this transaction ends, so no invitation is written
  -- after the expiry of a close has run.
  select * into v_row from public.workforce_requirements r
  where r.id = p_requirement and r.organization_id = p_org
  for share;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status <> 'open' then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_not_open';
  end if;

  if exists (select 1 from unnest(p_partners) x where not private.invitable_partner(x)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'partner_unavailable';
  end if;

  -- One lock per employer before both counts: a second call of the same employer waits for this one to commit and then
  -- counts its rows; nothing of another employer waits.
  perform pg_advisory_xact_lock(hashtextextended('partner_invitations:' || p_org::text, 0));

  v_new := array(
    select x from unnest(p_partners) with ordinality u (x, n)
    where not exists (
      select 1 from public.requirement_invitations i where i.requirement_id = v_row.id and i.organization_id = u.x)
    order by u.n);

  if cardinality(v_new) > 0 then
    select count(*)::integer into v_used from public.requirement_invitations i
    where i.requirement_id = v_row.id and i.status <> 'withdrawn';
    perform private.assert_within_limit(p_org, 'partner_invitations_per_requirement', v_used + cardinality(v_new) - 1);
    if (select count(*) from public.requirement_invitations i
        where i.employer_organization_id = p_org and i.invited_at > now() - interval '24 hours') + cardinality(v_new) > v_day_max then
      raise exception 'CHARA_RATE_LIMITED' using detail = 'partner_invitations_per_day';
    end if;
    perform private.count_audited_write(p_org);

    foreach v_partner in array v_new loop
      insert into public.requirement_invitations (
        requirement_id, organization_id, employer_organization_id, source, suggestion_criteria, invited_by
      ) values (
        v_row.id, v_partner, p_org, p_source,
        case when p_source = 'suggestions' then coalesce(private.suggestion_criteria(v_row.id, v_partner), '{}') end,
        v_uid
      )
      returning id into v_id;
      perform audit.record('requirement.invitation_sent', 'requirement_invitation', v_id::text,
        jsonb_build_object('requirement_id', v_row.id, 'organization_id', v_partner, 'employer_organization_id', p_org,
          'source', p_source));
      perform private.record_requirement_reveal(v_row.id, v_partner, 'invitation');
      perform private.queue_invitation_event(v_id, 'invitation_received');
    end loop;
  end if;

  return query
  select i.id, i.organization_id, i.status, not (i.organization_id = any (v_new))
  from unnest(p_partners) with ordinality u (x, n)
  join public.requirement_invitations i on i.requirement_id = v_row.id and i.organization_id = u.x
  order by u.n;
end;
$$;

revoke all on function public.invite_partners(uuid, uuid, uuid[], text) from public, anon, authenticated, service_role;
grant execute on function public.invite_partners(uuid, uuid, uuid[], text) to authenticated;

-- Withdraws the invitation p_invitation to a requirement of p_org before a response (FR-O1 step Withdraw, AC10): invited,
-- viewed or accepted become withdrawn; declined, responded, withdrawn and expired are CHARA_INVALID_STATE with the status.
-- For an owner or admin at aal2 of the active employer (private.assert_requirement_manager); no such invitation of p_org,
-- CHARA_NOT_FOUND. One audit row requirement.invitation_withdrawn and one invitation_withdrawn to the partner's owners
-- and admins; counts against the daily quota of audited writes. A withdrawn invitation no longer counts against the plan.
create function public.withdraw_invitation(p_org uuid, p_invitation uuid) returns public.invitation_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.requirement_invitations;
begin
  perform private.assert_requirement_manager(p_org);
  select * into v_inv from public.requirement_invitations i
  where i.id = p_invitation and i.employer_organization_id = p_org
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_inv.status not in ('invited', 'viewed', 'accepted') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_inv.status::text;
  end if;
  perform private.count_audited_write(p_org);
  update public.requirement_invitations i set status = 'withdrawn', withdrawn_at = now() where i.id = v_inv.id;
  perform audit.record('requirement.invitation_withdrawn', 'requirement_invitation', v_inv.id::text,
    jsonb_build_object('requirement_id', v_inv.requirement_id, 'organization_id', v_inv.organization_id,
      'employer_organization_id', p_org, 'from', v_inv.status));
  perform private.queue_invitation_event(v_inv.id, 'invitation_withdrawn');
  return 'withdrawn'::public.invitation_status;
end;
$$;

revoke all on function public.withdraw_invitation(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_invitation(uuid, uuid) to authenticated;

-- The partner's answer (FR-O1 step Answer, AC8): p_answer accepted or declined on an invitation of p_org that is invited
-- or viewed, by any accepted member of the active partner (private.assert_invitation_partner). A decline may carry a
-- reason (trimmed, 1 to 500 characters, no control characters; empty is none), which the employer reads; a reason with
-- an acceptance, another answer or a reason out of bounds is CHARA_INVALID_INPUT p_reason or p_answer. No such
-- invitation of p_org, CHARA_NOT_FOUND; another status, CHARA_INVALID_STATE with it. One audit row
-- requirement.invitation_accepted or requirement.invitation_declined; counts against the daily quota of audited writes.
-- An acceptance opens the response form of V44 (responding needs a paid partner plan there, not here).
create function public.answer_invitation(p_org uuid, p_invitation uuid, p_answer text, p_reason text default null)
returns public.invitation_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.requirement_invitations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.assert_invitation_partner(p_org);
  if p_answer is null or p_answer not in ('accepted', 'declined') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_answer';
  end if;
  if v_reason is not null and (p_answer = 'accepted' or char_length(v_reason) > 500
       or v_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_reason';
  end if;
  select * into v_inv from public.requirement_invitations i
  where i.id = p_invitation and i.organization_id = p_org
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_inv.status not in ('invited', 'viewed') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_inv.status::text;
  end if;
  perform private.count_audited_write(p_org);
  update public.requirement_invitations i
  set status = p_answer::public.invitation_status, answered_at = now(),
      viewed_at = coalesce(i.viewed_at, now()), decline_reason = v_reason
  where i.id = v_inv.id;
  perform audit.record(
    case when p_answer = 'accepted' then 'requirement.invitation_accepted' else 'requirement.invitation_declined' end,
    'requirement_invitation', v_inv.id::text,
    jsonb_strip_nulls(jsonb_build_object('requirement_id', v_inv.requirement_id, 'organization_id', p_org,
      'employer_organization_id', v_inv.employer_organization_id, 'with_reason', case when v_reason is not null then true end)));
  return p_answer::public.invitation_status;
end;
$$;

revoke all on function public.answer_invitation(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.answer_invitation(uuid, uuid, text, text) to authenticated;

-- Reading -----------------------------------------------------------------------------------------------------------------

-- The invitation p_invitation of the partner p_org with its requirement (FR-O1 AC8: an invited partner sees the
-- requirement, even private, and the employer name, which the invitation reveals). For any accepted member of the active
-- partner (private.assert_invitation_partner); an invitation of another partner or an unknown id is CHARA_NOT_FOUND, so
-- a competing partner learns nothing. While the invitation is invited, viewed, accepted or responded every field of the
-- requirement is returned; once declined, withdrawn or expired only the invitation, the title and the employer. The
-- first open by a member of the partner moves invited to viewed (no audit row: the system records it); the first time
-- the employer name is shown to the partner on a requirement that does not show it anyway, the reveal is marked seen
-- with one audit row requirement.employer_revealed (as the job order functions do).
create function public.get_invitation(p_org uuid, p_invitation uuid)
returns table (
  id uuid,
  requirement_id uuid,
  status public.invitation_status,
  invited_at timestamptz,
  viewed_at timestamptz,
  answered_at timestamptz,
  decline_reason text,
  responded_at timestamptz,
  withdrawn_at timestamptz,
  expired_at timestamptz,
  requirement_status public.requirement_status,
  title text,
  country_code text,
  workers_needed integer,
  countries text[],
  city_region text,
  industry_code text,
  occupations jsonb,
  skills text,
  experience_years smallint,
  start_date date,
  duration_months smallint,
  employment_type public.employment_type,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_period public.salary_period,
  accommodation boolean,
  work_permit_support boolean,
  visa_support boolean,
  recruitment_preference public.recruitment_preference,
  partner_need public.partner_need,
  published_on date,
  closes_on date,
  employer_name text,
  employer_company_slug text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.requirement_invitations;
  v_row public.workforce_requirements;
  v_employer public.organizations;
  v_full boolean;
begin
  perform private.assert_invitation_partner(p_org);
  select * into v_inv from public.requirement_invitations i where i.id = p_invitation and i.organization_id = p_org;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_inv.status = 'invited' then
    update public.requirement_invitations i set status = 'viewed', viewed_at = now()
    where i.id = v_inv.id and i.status = 'invited'
    returning * into v_inv;
    if v_inv.id is null then
      select * into v_inv from public.requirement_invitations i where i.id = p_invitation;
    end if;
  end if;
  select * into v_row from public.workforce_requirements r where r.id = v_inv.requirement_id;
  select * into v_employer from public.organizations o where o.id = v_row.organization_id;
  v_full := v_inv.status in ('invited', 'viewed', 'accepted', 'responded');

  return query select
    v_inv.id,
    v_inv.requirement_id,
    v_inv.status,
    v_inv.invited_at,
    v_inv.viewed_at,
    v_inv.answered_at,
    v_inv.decline_reason,
    v_inv.responded_at,
    v_inv.withdrawn_at,
    v_inv.expired_at,
    case when v_full then v_row.status end,
    v_row.title,
    case when v_full then v_row.country_code end,
    case when v_full then v_row.workers_needed end,
    case when v_full then array(
      select rc.country_code from public.requirement_countries rc where rc.requirement_id = v_row.id
      order by rc.country_code <> v_row.country_code, rc.country_code) end,
    case when v_full then v_row.city_region end,
    case when v_full then v_row.industry_code end,
    case when v_full then (
      select jsonb_agg(jsonb_build_object('code', ro.occupation_id, 'name', oc.label, 'quantity', ro.quantity)
        order by ro.quantity desc, oc.label)
      from public.requirement_occupations ro join public.occupations oc on oc.code = ro.occupation_id
      where ro.requirement_id = v_row.id) end,
    case when v_full then v_row.skills end,
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
    v_employer.display_name,
    case when v_employer.public_page_enabled then v_employer.slug end;

  if not (v_row.show_identity and v_row.visibility = 'job_order_marketplace') then
    perform private.mark_reveals_seen(p_org, array[v_row.id]);
  end if;
end;
$$;

revoke all on function public.get_invitation(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_invitation(uuid, uuid) to authenticated;

-- The invitations of the partner p_org, newest first (invited_at descending, then id), optionally of one status, pages
-- of 20 by default and at most 50 with the id of the last row as cursor (next_cursor on the last row of a page that has a
-- next one; a cursor that is not an invitation of p_org is CHARA_INVALID_INPUT p_cursor). For any accepted member of the
-- active partner. Each row names the requirement as the invitation reveals it (the employer's title and name), its
-- destination, workers, start date and status. Reading the list marks nothing viewed.
create function public.list_my_invitations(
  p_org uuid,
  p_status public.invitation_status default null,
  p_cursor uuid default null,
  p_limit integer default null
) returns table (
  id uuid,
  requirement_id uuid,
  status public.invitation_status,
  invited_at timestamptz,
  answered_at timestamptz,
  title text,
  country_code text,
  workers_needed integer,
  start_date date,
  requirement_status public.requirement_status,
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
  v_cursor_at timestamptz;
begin
  perform private.assert_invitation_partner(p_org);
  if p_cursor is not null then
    select i.invited_at into v_cursor_at from public.requirement_invitations i
    where i.id = p_cursor and i.organization_id = p_org;
    if v_cursor_at is null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end if;
  end if;

  return query
  with page as (
    select i.*, row_number() over (order by i.invited_at desc, i.id) as n
    from public.requirement_invitations i
    where i.organization_id = p_org
      and (p_status is null or i.status = p_status)
      and (p_cursor is null or i.invited_at < v_cursor_at or (i.invited_at = v_cursor_at and i.id > p_cursor))
    order by i.invited_at desc, i.id
    limit v_limit + 1
  )
  select p.id, p.requirement_id, p.status, p.invited_at, p.answered_at, r.title, r.country_code, r.workers_needed,
    r.start_date, r.status, e.display_name,
    case when p.n = v_limit and exists (select 1 from page x where x.n > v_limit) then p.id end
  from page p
  join public.workforce_requirements r on r.id = p.requirement_id
  join public.organizations e on e.id = r.organization_id
  where p.n <= v_limit
  order by p.n;
end;
$$;

revoke all on function public.list_my_invitations(uuid, public.invitation_status, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_my_invitations(uuid, public.invitation_status, uuid, integer) to authenticated;

-- Every invitation of the requirement p_requirement of the employer p_org, newest first (FR-O1 step Track, AC9), for any
-- accepted member of the employer (private.assert_invitation_employer); no such requirement of p_org, CHARA_NOT_FOUND.
-- Each row names the partner as its public profile does (display name, slug, type), the status with its times, the
-- decline reason, the source and the criteria recorded from the suggestions. Never who invited.
create function public.list_requirement_invitations(p_org uuid, p_requirement uuid)
returns table (
  id uuid,
  organization_id uuid,
  partner_name text,
  partner_slug text,
  partner_type public.organization_type,
  status public.invitation_status,
  source text,
  suggestion_criteria text[],
  invited_at timestamptz,
  viewed_at timestamptz,
  answered_at timestamptz,
  decline_reason text,
  responded_at timestamptz,
  withdrawn_at timestamptz,
  expired_at timestamptz
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
  select i.id, i.organization_id, o.display_name, o.slug, o.type, i.status, i.source, i.suggestion_criteria, i.invited_at,
    i.viewed_at, i.answered_at, i.decline_reason, i.responded_at, i.withdrawn_at, i.expired_at
  from public.requirement_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.requirement_id = p_requirement and i.employer_organization_id = p_org
  order by i.invited_at desc, i.id;
end;
$$;

revoke all on function public.list_requirement_invitations(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_requirement_invitations(uuid, uuid) to authenticated;

-- The invitation allowance of the requirement p_requirement of p_org for the pages ("5 of 10 invitations used", the
-- upgrade prompt with the plan name): used counts the invitations that are not withdrawn, limit_value is the plan's
-- partner_invitations_per_requirement (null for unlimited), applies says whether the limit is enforced for the employer
-- (entitlements_enforced, or a lapse), as org_usage does. Any accepted member of the employer; CHARA_NOT_FOUND otherwise.
create function public.requirement_invitation_usage(p_org uuid, p_requirement uuid)
returns table (used integer, limit_value integer, applies boolean, plan_name text)
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
  return query select
    (select count(*)::integer from public.requirement_invitations i
     where i.requirement_id = p_requirement and i.status <> 'withdrawn'),
    private.org_limit(p_org, 'partner_invitations_per_requirement'),
    coalesce((select (s.value #>> '{}')::boolean from private.settings s where s.key = 'entitlements_enforced'), false)
      or private.free_plan_restricted(p_org),
    (select p.name from billing.plans p where p.code = private.org_plan_code(p_org));
end;
$$;

revoke all on function public.requirement_invitation_usage(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.requirement_invitation_usage(uuid, uuid) to authenticated;

-- Expiry --------------------------------------------------------------------------------------------------------------------

-- A requirement that closes or is filled, by the employer or the daily close of V33, expires its invitations that are
-- invited, viewed or accepted (FR-O1 step Track, AC10), one audit row requirement.invitation_expired each with the
-- status of the requirement; responded, declined and withdrawn ones keep their state. No notification: the partners are
-- told by the closing notice of V43. A pause changes nothing.
create function private.requirements_expire_invitations() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv record;
begin
  for v_inv in
    update public.requirement_invitations i set status = 'expired', expired_at = now()
    where i.requirement_id = new.id and i.status in ('invited', 'viewed', 'accepted')
    returning i.id, i.organization_id, i.employer_organization_id
  loop
    perform audit.record('requirement.invitation_expired', 'requirement_invitation', v_inv.id::text,
      jsonb_build_object('requirement_id', new.id, 'organization_id', v_inv.organization_id,
        'employer_organization_id', v_inv.employer_organization_id, 'requirement_status', new.status));
  end loop;
  return null;
end;
$$;

revoke all on function private.requirements_expire_invitations() from public, anon, authenticated, service_role;

create trigger workforce_requirements_expire_invitations
  after update of status on public.workforce_requirements
  for each row when (new.status in ('closed', 'filled') and old.status is distinct from new.status)
  execute function private.requirements_expire_invitations();

alter table public.workforce_requirements enable always trigger workforce_requirements_expire_invitations;

-- private.notification_payload of 20261225100000_job_order_alert.sql with invitation_received and invitation_withdrawn
-- added. Every other branch is unchanged.
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
    -- The recipient's own organisation names the link; never the employer to a partner (V43).
    when 'requirement_closing_soon' then coalesce((
      select jsonb_build_object('requirement_id', r.id, 'title', r.title, 'closes_on', r.closes_on, 'org_slug', v_slug)
      from public.workforce_requirements r where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    -- NFR-S11: the generated title and the destination only, whatever the employer chose to show; the slug is the
    -- recipient partner's own, for the link to its job order page.
    when 'job_order_match' then coalesce((
      select jsonb_build_object('requirement_id', r.id, 'title', private.job_order_neutral_title(r.id),
        'country_code', r.country_code, 'country_name', c.name, 'org_slug', v_slug)
      from public.workforce_requirements r join public.countries c on c.code = r.country_code
      where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    -- NFR-S11, DATA_MODEL.md section 9: the employer's own title and name only when it shows them on the marketplace;
    -- otherwise the generated title and no name, since an email leaves the platform. The partner reads the name in
    -- the app, where the invitation reveals it. The slug is the recipient partner's own, for the link.
    when 'invitation_received' then coalesce((
      select jsonb_build_object('invitation_id', i.id,
        'title', case when r.show_identity and r.visibility = 'job_order_marketplace' then r.title
          else private.job_order_neutral_title(r.id) end,
        'country_code', r.country_code, 'country_name', c.name, 'workers_needed', r.workers_needed,
        'start_date', r.start_date,
        'employer_name', case when r.show_identity and r.visibility = 'job_order_marketplace' then e.display_name end,
        'org_slug', v_slug)
      from public.requirement_invitations i
      join public.workforce_requirements r on r.id = i.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    when 'invitation_withdrawn' then coalesce((
      select jsonb_build_object('invitation_id', i.id,
        'title', case when r.show_identity and r.visibility = 'job_order_marketplace' then r.title
          else private.job_order_neutral_title(r.id) end,
        'org_slug', v_slug)
      from public.requirement_invitations i
      join public.workforce_requirements r on r.id = i.requirement_id
      where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    else '{}'::jsonb
  end);
end;
$$;
