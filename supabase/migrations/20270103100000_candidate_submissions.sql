-- Candidate submissions, data (FR-O4, SOP P2-24; decisions 4.1, 6.3; NFR-S8, NFR-S9, NFR-C4, NFR-A3, NFR-A4, NFR-O5;
-- docs/phase-2/DATA_MODEL.md sections 4, 5, 6, 7, 9 and 10; release 2b).
--
-- A recruitment or staffing company whose response to a requirement is selected, or shortlisted with submissions allowed
-- (private.submissions_allowed_for, V47), proposes candidates for it by email address (submit_candidate). Nothing reaches
-- the employer until the candidate, who needs a worker account with that confirmed address, approves the request and
-- chooses the passport documents to share (approve_submission): the approval writes the consent
-- share_passport:<employer>:submission:<id> (sharing notice) and a passport share to the employer, as an application
-- does, and stores a profile snapshot. The candidate may decline a request (decline_submission) and withdraw an approved
-- submission at any time, in any stage, which revokes the share and writes the withdrawn consent at once
-- (withdraw_submission). A request nobody answers expires after candidate_submission_expiry_days (14) by a daily job.
--
-- The partner gets the same reply whether or not the address has an account, and of which kind: an active worker with a
-- confirmed address is linked and told in the app and by email (submission_request); an address without an account is
-- invited to create a worker account (submission_request_signup, at most once per address per
-- submission_signup_email_interval_days); a company account or a closed account is told nothing. A worker who confirms the
-- address later finds the request when the submission pages read it. The worker id, the address and the snapshot are read
-- only through the functions here: the partner reads the address until approval and the candidate's name after it, the
-- employer reads approved submissions only (and documents through document_access_grant, logged as submission_review),
-- and no partner learns of another partner's submission. One candidate is submitted at most once per requirement; a
-- second partner's request still gets the neutral reply, and the candidate's approval of it is refused.
--
-- Every request created counts in its calendar month (UTC) against candidate_submissions_per_month, whatever happens to
-- it later, under one advisory lock per partner (NFR-A4). The stages after submitted, the notes and the bulk actions are
-- V50's; pages V49; retention, erasure and export of submissions V58. Every function a user calls refuses to run while
-- release_candidate_submissions is false.

insert into private.settings (key, value) values
  ('candidate_submission_expiry_days', '14'),
  ('submission_signup_email_interval_days', '7')
on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('candidate_submission_expiry_days', 'integer', 1, 60, 'Days a candidate has to answer a submission request', null),
  ('submission_signup_email_interval_days', 'integer', 1, 30,
    'Days between two sign-up invitations to the same address for submission requests', null);

-- The states of DATA_MODEL.md section 5: a request awaits the candidate, who approves (submitted), declines, or lets it
-- expire; from submitted the stages of an application (V50); withdrawn by the candidate from submitted or any later stage.
create type public.submission_status as enum (
  'awaiting_candidate', 'declined_by_candidate', 'expired', 'submitted', 'viewed', 'shortlisted', 'interview', 'offer',
  'hired', 'rejected', 'withdrawn'
);

-- The submissions -----------------------------------------------------------------------------------------------------------

-- worker_user_id carries no foreign key, as on job_applications: the submission outlives the account (erasure, V58).
-- passport_share_id has none either: the share names the submission (passport_shares.submission_id) and each row would
-- have to exist before the other.
create table public.candidate_submissions (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.workforce_requirements (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employer_organization_id uuid not null references public.organizations (id) on delete cascade,
  response_id uuid references public.partner_responses (id) on delete set null,
  invited_email text not null check (
    invited_email = lower(btrim(invited_email)) and char_length(invited_email) <= 254
    and invited_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  worker_user_id uuid,
  submitted_by uuid references public.profiles (id) on delete set null,
  note text check (
    note = btrim(note) and char_length(note) between 1 and 1000 and note !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  ),
  status public.submission_status not null default 'awaiting_candidate',
  invitation_emailed_at timestamptz,
  decided_at timestamptz,
  worker_approved_at timestamptz,
  passport_share_id uuid,
  profile_snapshot jsonb check (jsonb_typeof(profile_snapshot) = 'object'),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_submissions_decided check ((status = 'awaiting_candidate') = (decided_at is null)),
  constraint candidate_submissions_approved check (
    (status in ('awaiting_candidate', 'declined_by_candidate', 'expired')) = (worker_approved_at is null)
  ),
  constraint candidate_submissions_approval check (
    worker_approved_at is null
    or (worker_user_id is not null and passport_share_id is not null and profile_snapshot is not null)
  ),
  constraint candidate_submissions_withdrawn check ((status = 'withdrawn') = (withdrawn_at is not null))
);

comment on table public.candidate_submissions is
  'A candidate proposed by a recruitment or staffing company for a workforce requirement (FR-O4). Written only by the submission functions; the partner reads its own rows, the employer the approved ones, the candidate the own ones. The address, the worker id and the snapshot are read through the functions only.';
comment on column public.candidate_submissions.invited_email is
  'The address the partner entered, trimmed and lower-cased; used only to send the request and to match the candidate''s confirmed account. Not readable through the Data API.';
comment on column public.candidate_submissions.worker_user_id is
  'The candidate''s account: set when the address belongs to an active worker with a confirmed address, at the request or when the worker reads the requests later. Not readable through the Data API.';
comment on column public.candidate_submissions.invitation_emailed_at is
  'When an invitation to create a worker account was queued for the address (no account had it). Not readable through the Data API.';
comment on column public.candidate_submissions.decided_at is
  'When the candidate approved or declined the request, or it expired.';
comment on column public.candidate_submissions.profile_snapshot is
  'The passport as it was when the candidate approved (private.profile_snapshot). Not readable through the Data API.';

-- One active request per partner, requirement and address: a repeated request answers the existing one (FR-O4 AC8).
create unique index candidate_submissions_active_request_key on public.candidate_submissions (requirement_id, organization_id, invited_email)
  where status not in ('declined_by_candidate', 'expired', 'withdrawn');
-- One submission per candidate and requirement from the approval on, whichever partner (FR-O4 AC8).
create unique index candidate_submissions_one_per_candidate on public.candidate_submissions (requirement_id, worker_user_id)
  where status not in ('awaiting_candidate', 'declined_by_candidate', 'expired', 'withdrawn');
-- The partner's list and monthly count, the employer's policy and list, the candidate's policy, the claim of a confirmed
-- address, the sign-up invitation interval and the daily expiry.
create index candidate_submissions_organization_idx on public.candidate_submissions (organization_id, created_at desc, id);
create index candidate_submissions_employer_idx on public.candidate_submissions (employer_organization_id, requirement_id);
create index candidate_submissions_worker_idx on public.candidate_submissions (worker_user_id, created_at desc, id)
  where worker_user_id is not null;
create index candidate_submissions_unclaimed_idx on public.candidate_submissions (invited_email)
  where worker_user_id is null and status = 'awaiting_candidate';
create index candidate_submissions_invitation_idx on public.candidate_submissions (invited_email, invitation_emailed_at)
  where invitation_emailed_at is not null;
create index candidate_submissions_awaiting_idx on public.candidate_submissions (created_at) where status = 'awaiting_candidate';
create index candidate_submissions_response_idx on public.candidate_submissions (response_id) where response_id is not null;
create index candidate_submissions_submitted_by_idx on public.candidate_submissions (submitted_by) where submitted_by is not null;

alter table public.candidate_submissions enable row level security;
alter table public.candidate_submissions force row level security;
revoke all on table public.candidate_submissions from public, anon, authenticated, service_role;
grant select (
  id, requirement_id, organization_id, response_id, note, status, decided_at, worker_approved_at, withdrawn_at, created_at,
  updated_at
) on public.candidate_submissions to authenticated;

-- The employer reads a submission only once the candidate approved it, and an owner or admin only at aal2, as for
-- applicants (private.active_member_org_ids).
create policy candidate_submissions_select on public.candidate_submissions
  for select to authenticated
  using (
    organization_id in (select private.member_org_ids())
    or (worker_approved_at is not null and employer_organization_id in (select private.active_member_org_ids()))
    or worker_user_id = (select auth.uid())
  );

-- The moves of this unit; V50 replaces the function with the stages after submitted.
create function private.submission_transition_allowed(p_from public.submission_status, p_to public.submission_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from = 'awaiting_candidate' and p_to in ('submitted', 'declined_by_candidate', 'expired'))
    or (p_from in ('submitted', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected') and p_to = 'withdrawn')
$$;

revoke all on function private.submission_transition_allowed(public.submission_status, public.submission_status)
  from public, anon, authenticated, service_role;

create function private.candidate_submissions_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.submission_transition_allowed(old.status, new.status) then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = old.status || ' to ' || new.status;
  end if;
  return new;
end;
$$;

revoke all on function private.candidate_submissions_guard() from public, anon, authenticated, service_role;

create trigger candidate_submissions_guard
  before update of status on public.candidate_submissions
  for each row when (old.status is distinct from new.status)
  execute function private.candidate_submissions_guard();

alter table public.candidate_submissions enable always trigger candidate_submissions_guard;

-- What a submission is about never changes: the requirement, the partner, the employer, the address and the time it was
-- sent; the candidate is set once; the member and the response only become null; the approval, the share and the
-- snapshot are written once.
create function private.candidate_submissions_immutable() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.requirement_id, new.organization_id, new.employer_organization_id, new.invited_email, new.created_at, new.note)
     is distinct from (old.requirement_id, old.organization_id, old.employer_organization_id, old.invited_email,
       old.created_at, old.note)
     or (old.worker_user_id is not null and new.worker_user_id is distinct from old.worker_user_id)
     or (new.submitted_by is distinct from old.submitted_by and new.submitted_by is not null)
     or (new.response_id is distinct from old.response_id and new.response_id is not null)
     or (old.worker_approved_at is not null and (new.worker_approved_at, new.passport_share_id, new.profile_snapshot)
           is distinct from (old.worker_approved_at, old.passport_share_id, old.profile_snapshot))
     or (old.invitation_emailed_at is not null and new.invitation_emailed_at is distinct from old.invitation_emailed_at) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.candidate_submissions_immutable() from public, anon, authenticated, service_role;

create trigger candidate_submissions_immutable
  before update on public.candidate_submissions
  for each row execute function private.candidate_submissions_immutable();

alter table public.candidate_submissions enable always trigger candidate_submissions_immutable;

-- The history -----------------------------------------------------------------------------------------------------------------

create table public.submission_events (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.candidate_submissions (id) on delete cascade,
  from_status public.submission_status,
  to_status public.submission_status not null,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.submission_events is
  'Append-only history of a candidate submission (FR-O4, FR-O5). Written only by the submission functions; the candidate and, after the approval, the employer read it without actor_id; the partner reads the stages through list_partner_submissions.';

create index submission_events_submission_idx on public.submission_events (submission_id, created_at, id);
create index submission_events_actor_idx on public.submission_events (actor_id) where actor_id is not null;

-- Whether the caller reads the history of p_submission: its candidate, or a member of its employer once the candidate
-- approved (owners and admins at aal2). A definer, so the policy needs no grant on the columns of candidate_submissions.
create function private.submission_history_reader(p_submission uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.candidate_submissions s
    where s.id = p_submission
      and (s.worker_user_id = (select auth.uid())
        or (s.worker_approved_at is not null and s.employer_organization_id in (select private.active_member_org_ids())))
  )
$$;

revoke all on function private.submission_history_reader(uuid) from public, anon, authenticated, service_role;
grant execute on function private.submission_history_reader(uuid) to authenticated;

alter table public.submission_events enable row level security;
alter table public.submission_events force row level security;
revoke all on table public.submission_events from public, anon, authenticated, service_role;
grant select (id, submission_id, from_status, to_status, created_at) on public.submission_events to authenticated;

create policy submission_events_select on public.submission_events
  for select to authenticated
  using (private.submission_history_reader(submission_id));

-- Append-only: nothing of an event changes, except actor_id becoming null (the erasure of the member). Deletes come only
-- with the submission (on delete cascade).
create function private.submission_events_append_only() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.id, new.submission_id, new.from_status, new.to_status, new.created_at)
     is distinct from (old.id, old.submission_id, old.from_status, old.to_status, old.created_at)
     or new.actor_id is not null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'append_only';
  end if;
  return new;
end;
$$;

revoke all on function private.submission_events_append_only() from public, anon, authenticated, service_role;

create trigger submission_events_append_only
  before update on public.submission_events
  for each row execute function private.submission_events_append_only();

alter table public.submission_events enable always trigger submission_events_append_only;

create function private.submission_events_no_delete() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() <= 1 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'append_only';
  end if;
  return old;
end;
$$;

revoke all on function private.submission_events_no_delete() from public, anon, authenticated, service_role;

create trigger submission_events_no_delete
  before delete on public.submission_events
  for each row execute function private.submission_events_no_delete();

alter table public.submission_events enable always trigger submission_events_no_delete;

-- Passport shares by submission (risky: the guard and the audit name a fixed column set) ----------------------------------

-- A share is given either for an application or for a submission, never both; its organisation is always the employer.
alter table public.passport_shares alter column application_id drop not null;
alter table public.passport_shares
  add column submission_id uuid references public.candidate_submissions (id) on delete cascade,
  add constraint passport_shares_one_source check (num_nonnulls(application_id, submission_id) = 1);
create unique index passport_shares_submission_key on public.passport_shares (submission_id);

comment on table public.passport_shares is
  'What a candidate shares with an employer, for one application or one candidate submission. Written only by the application and submission functions; employers never read it.';

-- private.passport_shares_guard of 20261016100000_account_closure.sql with submission_id in the fixed columns.
create or replace function private.passport_shares_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_pseudonymised(old.worker_user_id, new.worker_user_id)
     and (new.id, new.organization_id, new.application_id, new.submission_id, new.consent_id, new.created_at, new.expires_at)
           is not distinct from (old.id, old.organization_id, old.application_id, old.submission_id, old.consent_id,
             old.created_at, old.expires_at)
     and new.scope = '[]'::jsonb
     and new.revoked_at is not null
     and (old.revoked_at is null or new.revoked_at = old.revoked_at) then
    return new;
  end if;
  if (new.id, new.worker_user_id, new.organization_id, new.application_id, new.submission_id, new.scope, new.consent_id,
      new.created_at)
       is distinct from
     (old.id, old.worker_user_id, old.organization_id, old.application_id, old.submission_id, old.scope, old.consent_id,
      old.created_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.expires_at is not null and new.expires_at is distinct from old.expires_at) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'share_is_fixed';
  end if;
  return new;
end;
$$;

-- private.passport_shares_audit of 20261013100000_privacy_by_default.sql: the rows name the submission of a submission
-- share instead of the application, and still never a document or a person (NFR-C1).
create or replace function private.passport_shares_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb := jsonb_strip_nulls(jsonb_build_object(
    'organization_id', new.organization_id, 'application_id', new.application_id, 'submission_id', new.submission_id));
begin
  if tg_op = 'INSERT' then
    perform audit.record('share.created', 'passport_shares', new.id::text, v_metadata);
    return null;
  end if;
  if old.revoked_at is null and new.revoked_at is not null then
    perform audit.record('share.revoked', 'passport_shares', new.id::text, v_metadata);
  end if;
  if old.expires_at is null and new.expires_at is not null then
    perform audit.record('share.expiry_set', 'passport_shares', new.id::text, v_metadata);
  end if;
  return null;
end;
$$;

-- private.consents_check_document of 20261025100000_withdraw_application.sql: the purpose of a submission share,
-- share_passport:<employer>:submission:<submission>, is checked against the sharing notice too.
create or replace function private.consents_check_document() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.purpose is null or new.version is null then
    return new;
  end if;
  if not exists (
    select 1 from public.legal_documents d
    where d.version = new.version
      and d.slug = (case when new.purpose ~ '^share_passport:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(submission:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         then 'sharing-notice' else new.purpose end)
  ) then
    raise exception 'insert or update on table "consents" violates foreign key constraint "consents_purpose_version_fkey"'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

-- The employer opens a document of a submission share for the purpose submission_review.
alter table audit.document_access_log drop constraint document_access_log_purpose_check;
alter table audit.document_access_log add constraint document_access_log_purpose_check
  check (purpose in ('application_review', 'owner_download', 'submission_review')) not valid;
alter table audit.document_access_log validate constraint document_access_log_purpose_check;

-- public.document_access_grant of 20261109110000_applicant_data_aal2.sql with one change: a third party names the kind of
-- share it opens the document through, application_review for an application share and submission_review for a
-- submission share, and the log records that purpose. Only shares of that kind are considered.
create or replace function public.document_access_grant(p_document_id uuid, p_purpose text)
returns table (bucket_id text, object_path text, file_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_document public.worker_documents;
  v_share uuid;
  v_org uuid;
  v_repeat integer := (select (value #>> '{}')::integer from private.settings where key = 'document_access_repeat_seconds');
begin
  if v_uid is null then
    raise exception 'CHARA_UNAUTHENTICATED' using errcode = '42501';
  end if;
  perform private.check_rate_limit('document_access', v_uid);

  select * into v_document from public.worker_documents d where d.id = p_document_id and d.deleted_at is null;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_document.worker_user_id <> v_uid then
    select s.id, s.organization_id into v_share, v_org
    from public.passport_shares s
    where s.worker_user_id = v_document.worker_user_id
      and s.organization_id in (select private.member_org_ids())
      and s.scope ? v_document.id::text
      and case p_purpose when 'submission_review' then s.submission_id is not null else s.application_id is not null end
      and private.share_valid(s.id)
    order by (not private.is_aal2() and s.organization_id in (select private.member_org_ids('admin'))), s.created_at desc
    limit 1;
    if v_org is null then
      raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
    end if;
    perform private.assert_member_aal2(v_org);
  end if;

  if (v_document.worker_user_id = v_uid and p_purpose is distinct from 'owner_download')
     or (v_document.worker_user_id <> v_uid and p_purpose is distinct from 'application_review'
         and p_purpose is distinct from 'submission_review') then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501', detail = 'purpose_mismatch';
  end if;

  if v_document.scan_status not in ('clean', 'skipped') then
    raise exception 'CHARA_DOCUMENT_NOT_SCANNED';
  end if;

  if not exists (
    select 1 from audit.document_access_log l
    where l.accessed_at > now() - make_interval(secs => coalesce(v_repeat, 0))
      and l.accessed_by = v_uid and l.document_id = v_document.id and l.purpose = p_purpose
  ) then
    insert into audit.document_access_log (share_id, document_id, worker_user_id, organization_id, accessed_by, purpose)
    values (v_share, v_document.id, v_document.worker_user_id, v_org, v_uid, p_purpose);
  end if;

  return query select v_document.bucket_id, v_document.storage_path, v_document.file_name;
end;
$$;

-- Usage: the monthly key candidate_submissions_per_month counts every request of the month --------------------------------

-- private.monthly_usage of 20261230100000_partner_responses.sql with the submissions counted: every candidate_submissions
-- row of the partner created since the start of the calendar month in UTC, whatever its status (a declined, expired or
-- withdrawn request still counts, FR-O4 AC3). messages_per_month still counts 0 until V66.
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
  if p_limit_key = 'candidate_submissions_per_month' then
    return (select count(*)::integer from public.candidate_submissions s
            where s.organization_id = p_org and s.created_at >= private.month_start());
  end if;
  return 0;
end;
$$;

-- Notification kinds -----------------------------------------------------------------------------------------------------------

-- The request is mandatory, to the candidate's account or, without one, to the address; the approval and the withdrawal
-- are optional with email on, for the partner and the employer.
insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types) values
  ('submission_request', true, true, 'worker', 'Requests to submit you for a job', null),
  ('submission_request_signup', true, true, 'worker', 'Invitations to create an account for a submission request', null),
  ('submission_approved', false, true, 'company', 'Candidates who approved a submission',
    array['employer', 'recruitment_company', 'staffing_company']::public.organization_type[]),
  ('submission_withdrawn', false, true, 'company', 'Candidates who withdrew a submission',
    array['employer', 'recruitment_company', 'staffing_company']::public.organization_type[]);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon', 'job_order_match', 'invitation_received',
  'invitation_withdrawn', 'requirement_changed', 'requirement_closed', 'response_received', 'response_withdrawn',
  'response_decided', 'submission_request', 'submission_request_signup', 'submission_approved', 'submission_withdrawn'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- The invitation to an address without an account has no user, as the email of a completed deletion.
alter table public.notifications drop constraint notifications_check;
alter table public.notifications add constraint notifications_check
  check (user_id is not null or kind in ('deletion_completed', 'member_invitation', 'submission_request_signup')) not valid;
alter table public.notifications validate constraint notifications_check;

-- One message of p_kind (submission_approved, submission_withdrawn) about p_submission to each accepted owner and admin
-- with an active account of the partner and of the employer while each is active, once per submission and kind (FR-O4
-- AC5, AC9). organization_id is the recipient's organisation, so the payload links its own page. Answers the number
-- queued, in the caller's transaction (NFR-A3).
create function private.queue_submission_event(p_submission uuid, p_kind text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := p_kind || ':' || p_submission;
  v_messages jsonb[];
begin
  select array_agg(jsonb_build_object(
           'kind', p_kind, 'user_id', m.user_id, 'organization_id', m.organization_id, 'mandatory', k.mandatory,
           'dedupe_key', v_key, 'submission_id', s.id)
         order by m.organization_id, m.user_id)
  into v_messages
  from public.candidate_submissions s
  join public.organization_members m on m.organization_id in (s.organization_id, s.employer_organization_id)
    and m.role in ('owner', 'admin') and m.accepted_at is not null
  join public.organizations o on o.id = m.organization_id and o.status = 'active'
  join public.profiles u on u.id = m.user_id and u.status = 'active'
  join private.notification_kinds k on k.kind = p_kind
  where s.id = p_submission
    and not exists (
      select 1 from public.notifications n where n.user_id = m.user_id and n.kind = p_kind and n.dedupe_key = v_key);

  if v_messages is null then
    return 0;
  end if;
  perform pgmq.send_batch('notifications', v_messages);
  return cardinality(v_messages);
end;
$$;

revoke all on function private.queue_submission_event(uuid, text) from public, anon, authenticated, service_role;

-- Helpers ------------------------------------------------------------------------------------------------------------------------

-- The title of p_row as a candidate reads it: the employer's own title when the employer shows its name, the generated
-- title otherwise, which names neither the employer nor anything it wrote (NFR-S11).
create function private.submission_candidate_title(p_row public.workforce_requirements) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_row.show_identity then p_row.title else private.job_order_neutral_title(p_row.id) end
$$;

revoke all on function private.submission_candidate_title(public.workforce_requirements)
  from public, anon, authenticated, service_role;

-- A caller who sends requests for p_org: an accepted member (any role, no aal2) of an active, listed, visible recruitment
-- or staffing company (private.assert_responding_partner) while release_candidate_submissions is on (CHARA_FORBIDDEN
-- release_off).
create function private.assert_submitting_partner(p_org uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_responding_partner(p_org);
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_submitting_partner(uuid) from public, anon, authenticated, service_role;

-- A signed-in caller while release_candidate_submissions is on, answered with the user id: the candidate's functions.
-- CHARA_FORBIDDEN without a session or with the release off; who the caller is decides the rows, so a company user or
-- another worker finds nothing (CHARA_NOT_FOUND, FR-O4 AC7, AC9).
create function private.submission_caller() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  return v_uid;
end;
$$;

revoke all on function private.submission_caller() from public, anon, authenticated, service_role;

-- The worker account that owns p_email: an active worker, not closing, whose address is confirmed; null for any other
-- address (none, a company account, an unconfirmed or closed account).
create function private.submission_worker_for(p_email text) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.email = p_email and u.is_sso_user = false and u.email_confirmed_at is not null
    and p.account_kind = 'worker' and p.status = 'active' and p.deleted_at is null
  limit 1
$$;

revoke all on function private.submission_worker_for(text) from public, anon, authenticated, service_role;

-- Links to p_user the pending requests sent to its confirmed address before it had an account (FR-O4 AC10): a person who
-- signs up with another address finds none. Only an active worker; the requests already linked stay as they are.
create function private.claim_submission_requests(p_user uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  if v_email is null or private.submission_worker_for(v_email) is distinct from p_user then
    return;
  end if;
  update public.candidate_submissions s set worker_user_id = p_user, updated_at = now()
  where s.worker_user_id is null and s.status = 'awaiting_candidate' and s.invited_email = v_email;
end;
$$;

revoke all on function private.claim_submission_requests(uuid) from public, anon, authenticated, service_role;

-- The pending request p_submission of the candidate p_user, held for the answer. Not the candidate's, CHARA_NOT_FOUND;
-- answered or expired, CHARA_INVALID_STATE with its status; older than candidate_submission_expiry_days but not yet
-- moved by the daily job, CHARA_INVALID_STATE expired.
create function private.pending_submission(p_user uuid, p_submission uuid) returns public.candidate_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.candidate_submissions;
  v_days integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'candidate_submission_expiry_days');
begin
  perform private.claim_submission_requests(p_user);
  select * into v_row from public.candidate_submissions s
  where s.id = p_submission and s.worker_user_id = p_user
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status <> 'awaiting_candidate' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_row.status::text;
  end if;
  if v_row.created_at < now() - make_interval(days => coalesce(v_days, 14)) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'expired';
  end if;
  return v_row;
end;
$$;

revoke all on function private.pending_submission(uuid, uuid) from public, anon, authenticated, service_role;

-- Sending --------------------------------------------------------------------------------------------------------------------------

-- A request of the partner p_org to the candidate at p_email for the requirement p_requirement, with an optional note
-- (FR-O4 step Request, AC1 to AC4, AC8). For any accepted member of an active, listed, visible partner
-- (private.assert_submitting_partner). Refusals, in this order, each writing and counting nothing: p_email missing, longer
-- than 254 characters or not an address, CHARA_INVALID_INPUT p_email; a note over 1,000 characters or with control
-- characters, CHARA_INVALID_INPUT p_note; an unknown requirement, CHARA_NOT_FOUND; no selected response of the partner, nor
-- a shortlisted one with submissions allowed, CHARA_FORBIDDEN submissions_not_open; a requirement that is not open or whose
-- employer is suspended, CHARA_INVALID_STATE requirement_not_open; no paid plan with job order access,
-- CHARA_FEATURE_NOT_IN_PLAN job_order_access; no current employer-pays commitment, CHARA_CONSENT_REQUIRED
-- employer-pays-commitment; an active request of the partner to the same address for the requirement answers that one and
-- counts nothing; the monthly limit used up while it applies (entitlements_enforced, or a lapsed partner),
-- CHARA_LIMIT_REACHED candidate_submissions_per_month; the daily quota of audited writes, CHARA_RATE_LIMITED. The checks,
-- the count and the write run under the advisory lock of the partner's submissions (NFR-A4).
--
-- Writes the request (awaiting_candidate) with the candidate linked when the address is an active worker's confirmed
-- address, its first event, one audit row submission.requested, and in the same transaction (NFR-A3) the mandatory
-- submission_request to that worker, or, for an address without an account, one submission_request_signup to the address
-- unless one went there within submission_signup_email_interval_days; a company or closed account is told nothing. The
-- reply is the same whatever the address is: the id, the status and whether the request already existed; never the
-- candidate or the kind of account (AC2).
create function public.submit_candidate(p_org uuid, p_requirement uuid, p_email text, p_note text default null)
returns table (id uuid, status public.submission_status, existing boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.workforce_requirements;
  v_response uuid;
  v_existing public.candidate_submissions;
  v_used integer;
  v_limit integer;
  v_applies boolean;
  v_worker uuid;
  v_interval integer := (select (s.value #>> '{}')::integer from private.settings s
                         where s.key = 'submission_signup_email_interval_days');
  v_invite boolean := false;
  v_id uuid := gen_random_uuid();
begin
  perform private.assert_submitting_partner(p_org);
  if v_email = '' or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_email';
  end if;
  if char_length(v_note) > 1000 or v_note ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_note';
  end if;

  select * into v_row from public.workforce_requirements r where r.id = p_requirement for share;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('candidate_submissions:' || p_org::text, 0));
  -- The response is held too, so a decision that closes submissions at the same time is seen here or waits for this call.
  select p.id into v_response from public.partner_responses p
  where p.requirement_id = v_row.id and p.organization_id = p_org
  for share;
  if not private.submissions_allowed_for(v_row.id, p_org) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'submissions_not_open', errcode = '42501';
  end if;
  if v_row.status <> 'open'
     or not exists (select 1 from public.organizations e where e.id = v_row.organization_id and e.status = 'active') then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_not_open';
  end if;
  if not (select f.paid from private.job_order_partner_facts(p_org) f) then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'job_order_access';
  end if;
  if not private.partner_commitment_current(p_org) then
    raise exception 'CHARA_CONSENT_REQUIRED' using detail = 'employer-pays-commitment';
  end if;

  select * into v_existing from public.candidate_submissions s
  where s.requirement_id = v_row.id and s.organization_id = p_org and s.invited_email = v_email
    and s.status not in ('declined_by_candidate', 'expired', 'withdrawn');
  if found then
    return query select v_existing.id, v_existing.status, true;
    return;
  end if;

  v_used := private.monthly_usage(p_org, 'candidate_submissions_per_month');
  v_limit := private.org_limit(p_org, 'candidate_submissions_per_month');
  v_applies := coalesce((select (s.value #>> '{}')::boolean from private.settings s where s.key = 'entitlements_enforced'), false)
    or private.free_plan_restricted(p_org);
  if v_applies and v_limit is not null and v_used >= v_limit then
    raise exception 'CHARA_LIMIT_REACHED' using detail = 'candidate_submissions_per_month';
  end if;
  perform private.count_audited_write(p_org);

  v_worker := private.submission_worker_for(v_email);
  if v_worker is null and not exists (select 1 from auth.users u where u.email = v_email and u.is_sso_user = false) then
    -- One invitation per address and interval, whichever partner asks: the address is locked for the check.
    perform pg_advisory_xact_lock(hashtextextended('submission_signup:' || v_email, 0));
    v_invite := not exists (
      select 1 from public.candidate_submissions s
      where s.invited_email = v_email
        and s.invitation_emailed_at > now() - make_interval(days => coalesce(v_interval, 7)));
  end if;

  insert into public.candidate_submissions (
    id, requirement_id, organization_id, employer_organization_id, response_id, invited_email, worker_user_id, submitted_by,
    note, invitation_emailed_at
  ) values (
    v_id, v_row.id, p_org, v_row.organization_id, v_response, v_email, v_worker, (select auth.uid()), v_note,
    case when v_invite then now() end
  );
  insert into public.submission_events (submission_id, from_status, to_status, actor_id)
  values (v_id, null, 'awaiting_candidate', (select auth.uid()));
  perform audit.record('submission.requested', 'candidate_submission', v_id::text,
    jsonb_strip_nulls(jsonb_build_object('requirement_id', v_row.id, 'organization_id', p_org,
      'employer_organization_id', v_row.organization_id, 'with_note', case when v_note is not null then true end)));

  if v_worker is not null then
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'submission_request', 'user_id', v_worker, 'mandatory', true,
      'dedupe_key', 'submission_request:' || v_id, 'submission_id', v_id));
  elsif v_invite then
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'submission_request_signup', 'email', v_email, 'mandatory', true,
      'dedupe_key', 'submission_request_signup:' || v_id, 'submission_id', v_id));
  end if;

  return query select v_id, 'awaiting_candidate'::public.submission_status, false;
end;
$$;

revoke all on function public.submit_candidate(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.submit_candidate(uuid, uuid, text, text) to authenticated;

-- Answering -------------------------------------------------------------------------------------------------------------------------

-- The candidate approves the pending request p_submission and shares the documents p_document_ids (none is allowed: the
-- employer then reads the profile snapshot only) (FR-O4 step Approve, AC5, AC8). For the worker it was sent to
-- (private.pending_submission: CHARA_NOT_FOUND for anyone else, CHARA_INVALID_STATE when answered or expired). Refusals, in
-- this order, each writing nothing: a closing or inactive account, CHARA_FORBIDDEN account_not_active; a requirement that
-- is not open or whose employer is suspended, CHARA_INVALID_STATE requirement_not_open; the candidate already submitted
-- for the requirement by any partner, CHARA_CONFLICT already_submitted; an incomplete passport, CHARA_PROFILE_INCOMPLETE
-- with the missing fields; a null id or more documents than apply_documents_max, CHARA_INVALID_INPUT p_document_ids; a
-- document that is not the candidate's own, CHARA_NOT_FOUND; one not scanned clean, CHARA_DOCUMENT_NOT_SCANNED.
--
-- Writes, in one transaction, the granted consent share_passport:<employer>:submission:<id> at the current version of the
-- sharing notice, the share to the employer with the chosen document ids, the status submitted with the approval time and
-- the profile snapshot, the event, one audit row submission.approved, and submission_approved to the owners and admins of
-- the partner and of the employer (NFR-A3, NFR-C4). Answers the status.
create function public.approve_submission(p_submission uuid, p_document_ids uuid[] default null)
returns public.submission_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.submission_caller();
  v_sub public.candidate_submissions;
  v_profile public.worker_profiles;
  v_missing text[];
  v_ids uuid[];
  v_max integer := (select l.documents_max from public.apply_limits() l);
  v_version integer;
  v_consent bigint;
  v_share uuid := gen_random_uuid();
begin
  v_sub := private.pending_submission(v_uid, p_submission);
  if exists (select 1 from public.profiles p where p.id = v_uid and (p.status <> 'active' or p.deleted_at is not null)) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_not_active', errcode = '42501';
  end if;
  if not exists (
    select 1 from public.workforce_requirements r join public.organizations e on e.id = r.organization_id
    where r.id = v_sub.requirement_id and r.status = 'open' and e.status = 'active'
  ) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_not_open';
  end if;
  if exists (
    select 1 from public.candidate_submissions s
    where s.requirement_id = v_sub.requirement_id and s.worker_user_id = v_uid and s.id <> v_sub.id
      and s.status not in ('awaiting_candidate', 'declined_by_candidate', 'expired', 'withdrawn')
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'already_submitted';
  end if;

  select * into v_profile from public.worker_profiles w where w.user_id = v_uid;
  v_missing := array_remove(array[
    case when v_profile.first_name is null then 'first_name' end,
    case when v_profile.last_name is null then 'last_name' end,
    case when v_profile.current_country is null then 'current_country' end,
    case when v_profile.occupation_id is null then 'occupation_id' end
  ], null);
  if cardinality(v_missing) > 0 then
    raise exception 'CHARA_PROFILE_INCOMPLETE' using detail = array_to_string(v_missing, ', ');
  end if;

  if exists (select 1 from unnest(coalesce(p_document_ids, '{}')) d where d is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_document_ids';
  end if;
  v_ids := array(select distinct d from unnest(coalesce(p_document_ids, '{}')) d order by d);
  if cardinality(v_ids) > v_max then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_document_ids';
  end if;
  if (select count(*) from public.worker_documents d
      where d.id = any (v_ids) and d.worker_user_id = v_uid and d.deleted_at is null) <> cardinality(v_ids) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.worker_documents d where d.id = any (v_ids) and d.scan_status not in ('clean', 'skipped')) then
    raise exception 'CHARA_DOCUMENT_NOT_SCANNED';
  end if;

  v_version := private.current_legal_version('sharing-notice');
  if v_version is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'sharing-notice';
  end if;
  insert into public.consents (user_id, purpose, version, action)
  values (v_uid, 'share_passport:' || v_sub.employer_organization_id || ':submission:' || v_sub.id, v_version, 'granted')
  returning id into v_consent;
  insert into public.passport_shares (id, worker_user_id, organization_id, submission_id, scope, consent_id)
  values (v_share, v_uid, v_sub.employer_organization_id, v_sub.id, to_jsonb(v_ids), v_consent);

  update public.candidate_submissions s
  set status = 'submitted', decided_at = now(), worker_approved_at = now(), passport_share_id = v_share,
      profile_snapshot = private.profile_snapshot(v_uid), updated_at = now()
  where s.id = v_sub.id;
  insert into public.submission_events (submission_id, from_status, to_status, actor_id)
  values (v_sub.id, 'awaiting_candidate', 'submitted', v_uid);
  perform audit.record('submission.approved', 'candidate_submission', v_sub.id::text,
    jsonb_build_object('requirement_id', v_sub.requirement_id, 'organization_id', v_sub.organization_id,
      'employer_organization_id', v_sub.employer_organization_id, 'document_count', cardinality(v_ids)));
  perform private.queue_submission_event(v_sub.id, 'submission_approved');
  return 'submitted'::public.submission_status;
end;
$$;

revoke all on function public.approve_submission(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.approve_submission(uuid, uuid[]) to authenticated;

-- The candidate declines the pending request p_submission (FR-O4 step Decline, AC7): for the worker it was sent to
-- (private.pending_submission). The status becomes declined_by_candidate with the time, one event and one audit row
-- submission.declined; no consent, share or notification. Answers the status.
create function public.decline_submission(p_submission uuid)
returns public.submission_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.submission_caller();
  v_sub public.candidate_submissions;
begin
  v_sub := private.pending_submission(v_uid, p_submission);
  update public.candidate_submissions s
  set status = 'declined_by_candidate', decided_at = now(), updated_at = now()
  where s.id = v_sub.id;
  insert into public.submission_events (submission_id, from_status, to_status, actor_id)
  values (v_sub.id, 'awaiting_candidate', 'declined_by_candidate', v_uid);
  perform audit.record('submission.declined', 'candidate_submission', v_sub.id::text,
    jsonb_build_object('requirement_id', v_sub.requirement_id, 'organization_id', v_sub.organization_id));
  return 'declined_by_candidate'::public.submission_status;
end;
$$;

revoke all on function public.decline_submission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.decline_submission(uuid) to authenticated;

-- The candidate withdraws the approved submission p_submission from submitted or any later stage, hired included (FR-O4
-- step Withdraw, AC9; DATA_MODEL.md section 11 item 5). Never blocked by the requirement, the organisations or a plan. Not
-- the caller's own submission, CHARA_NOT_FOUND; one that is not approved or already withdrawn, CHARA_INVALID_STATE with its
-- status. In one transaction (NFR-C4): the status withdrawn with the time, the share revoked, the withdrawn consent row
-- (purpose and version of the granted one), the event, one audit row submission.withdrawn and submission_withdrawn to the
-- owners and admins of the partner and of the employer. Answers the status.
create function public.withdraw_submission(p_submission uuid)
returns public.submission_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.submission_caller();
  v_sub public.candidate_submissions;
begin
  select * into v_sub from public.candidate_submissions s
  where s.id = p_submission and s.worker_user_id = v_uid
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_sub.worker_approved_at is null or v_sub.status = 'withdrawn' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_sub.status::text;
  end if;

  update public.candidate_submissions s
  set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
  where s.id = v_sub.id;
  update public.passport_shares s set revoked_at = now()
  where s.submission_id = v_sub.id and s.revoked_at is null;
  insert into public.consents (user_id, purpose, version, action)
  select c.user_id, c.purpose, c.version, 'withdrawn'
  from public.passport_shares s
  join public.consents c on c.id = s.consent_id and c.user_id = v_uid
  where s.submission_id = v_sub.id;
  insert into public.submission_events (submission_id, from_status, to_status, actor_id)
  values (v_sub.id, v_sub.status, 'withdrawn', v_uid);
  perform audit.record('submission.withdrawn', 'candidate_submission', v_sub.id::text,
    jsonb_build_object('requirement_id', v_sub.requirement_id, 'organization_id', v_sub.organization_id,
      'employer_organization_id', v_sub.employer_organization_id, 'from', v_sub.status));
  perform private.queue_submission_event(v_sub.id, 'submission_withdrawn');
  return 'withdrawn'::public.submission_status;
end;
$$;

revoke all on function public.withdraw_submission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_submission(uuid) to authenticated;

-- Expiry ---------------------------------------------------------------------------------------------------------------------------

-- The daily job: every request still awaiting the candidate candidate_submission_expiry_days after it was sent becomes
-- expired (FR-O4 open point, 14 days by default), with an event without actor and one audit row submission.expired each.
-- No notification. The request still counts in its month. Answers the number expired.
create function private.expire_submission_requests() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'candidate_submission_expiry_days');
  v_row record;
  v_count integer := 0;
begin
  if v_days is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'candidate_submission_expiry_days';
  end if;
  for v_row in
    update public.candidate_submissions s
    set status = 'expired', decided_at = now(), updated_at = now()
    where s.status = 'awaiting_candidate' and s.created_at < now() - make_interval(days => v_days)
    returning s.id, s.requirement_id, s.organization_id
  loop
    insert into public.submission_events (submission_id, from_status, to_status, actor_id)
    values (v_row.id, 'awaiting_candidate', 'expired', null);
    perform audit.record('submission.expired', 'candidate_submission', v_row.id::text,
      jsonb_build_object('requirement_id', v_row.requirement_id, 'organization_id', v_row.organization_id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.expire_submission_requests() from public, anon, authenticated, service_role;

select cron.schedule('expire-submission-requests', '30 0 * * *', 'select private.expire_submission_requests()');

-- Reads ------------------------------------------------------------------------------------------------------------------------------

-- The pending requests of the caller (FR-O4 steps Invite and Approve, AC5, AC8, AC10), newest first: the requests sent to
-- its confirmed address before it had an account are linked first. For each, what the candidate needs to answer: the
-- partner, the requirement as the candidate may read it (the employer's title and name only when the employer shows its
-- name, private.submission_candidate_title), destination, start date, workers needed, the partner's note, when it was
-- sent and when it expires, and the partner that already submitted the candidate for the same requirement, if any (only
-- Decline is then offered). A caller who is not a worker finds none.
create function public.list_my_submission_requests()
returns table (
  id uuid,
  partner_name text,
  partner_slug text,
  title text,
  country_code text,
  country_name text,
  city_region text,
  start_date date,
  workers_needed integer,
  employer_name text,
  note text,
  created_at timestamptz,
  expires_at timestamptz,
  submitted_by_partner text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.submission_caller();
  v_days integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'candidate_submission_expiry_days');
begin
  perform private.claim_submission_requests(v_uid);
  return query
  select s.id, o.display_name, o.slug, private.submission_candidate_title(r), r.country_code, c.name,
    case when r.show_identity then r.city_region end, r.start_date, r.workers_needed,
    case when r.show_identity then e.display_name end,
    s.note, s.created_at, s.created_at + make_interval(days => coalesce(v_days, 14)),
    (select po.display_name from public.candidate_submissions x join public.organizations po on po.id = x.organization_id
     where x.requirement_id = s.requirement_id and x.worker_user_id = v_uid and x.id <> s.id
       and x.status not in ('awaiting_candidate', 'declined_by_candidate', 'expired', 'withdrawn'))
  from public.candidate_submissions s
  join public.organizations o on o.id = s.organization_id
  join public.workforce_requirements r on r.id = s.requirement_id
  join public.countries c on c.code = r.country_code
  join public.organizations e on e.id = r.organization_id
  where s.worker_user_id = v_uid and s.status = 'awaiting_candidate'
    and s.created_at >= now() - make_interval(days => coalesce(v_days, 14))
  order by s.created_at desc, s.id;
end;
$$;

revoke all on function public.list_my_submission_requests() from public, anon, authenticated, service_role;
grant execute on function public.list_my_submission_requests() to authenticated;

-- The caller's answered submissions (FR-O4 AC9, FR-O5 journey), newest first: approved ones in any stage, declined,
-- expired and withdrawn, with the partner, the requirement as the candidate may read it, the status and its dates. A caller
-- who is not a worker finds none.
create function public.list_my_submissions()
returns table (
  id uuid,
  status public.submission_status,
  partner_name text,
  partner_slug text,
  title text,
  country_code text,
  country_name text,
  employer_name text,
  created_at timestamptz,
  decided_at timestamptz,
  worker_approved_at timestamptz,
  withdrawn_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.submission_caller();
begin
  return query
  select s.id, s.status, o.display_name, o.slug, private.submission_candidate_title(r), r.country_code, c.name,
    case when r.show_identity then e.display_name end,
    s.created_at, s.decided_at, s.worker_approved_at, s.withdrawn_at
  from public.candidate_submissions s
  join public.organizations o on o.id = s.organization_id
  join public.workforce_requirements r on r.id = s.requirement_id
  join public.countries c on c.code = r.country_code
  join public.organizations e on e.id = r.organization_id
  where s.worker_user_id = v_uid and s.status <> 'awaiting_candidate'
  order by s.created_at desc, s.id;
end;
$$;

revoke all on function public.list_my_submissions() from public, anon, authenticated, service_role;
grant execute on function public.list_my_submissions() to authenticated;

-- The partner's own submissions (FR-O4 AC12, FR-O5 for the partner), newest first, all requirements or one, pages of 20
-- (at most 50) with the id of the last row as cursor. For any accepted member of the active partner while the release is
-- on (private.assert_invitation_partner, then release_candidate_submissions); counted against rate_limit_job_orders_max.
-- Each row shows the address entered until the candidate approves and the candidate's name from the snapshot after it,
-- never the worker id or whether the address has an account; the status, including the stage the employer set; the note
-- and the dates. The requirement's own title when the employer is named to the partner (a shortlist or selection reveals
-- it), the generated title otherwise. An unknown cursor, CHARA_INVALID_INPUT p_cursor.
create function public.list_partner_submissions(
  p_org uuid, p_requirement uuid default null, p_cursor uuid default null, p_limit integer default null
)
returns table (
  id uuid,
  requirement_id uuid,
  title text,
  status public.submission_status,
  invited_email text,
  candidate_name text,
  note text,
  created_at timestamptz,
  decided_at timestamptz,
  worker_approved_at timestamptz,
  withdrawn_at timestamptz,
  next_cursor uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_cursor public.candidate_submissions;
begin
  perform private.assert_invitation_partner(p_org);
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.check_rate_limit('job_orders', (select auth.uid()));
  if p_cursor is not null then
    select * into v_cursor from public.candidate_submissions s where s.id = p_cursor and s.organization_id = p_org;
    if not found then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end if;
  end if;
  return query
  with page as (
    select s.*, row_number() over (order by s.created_at desc, s.id) as n
    from public.candidate_submissions s
    where s.organization_id = p_org and (p_requirement is null or s.requirement_id = p_requirement)
      and (p_cursor is null or s.created_at < v_cursor.created_at or (s.created_at = v_cursor.created_at and s.id > p_cursor))
    order by s.created_at desc, s.id
    limit v_limit + 1
  )
  select s.id, s.requirement_id,
    case when private.requirement_named_to(r.id, p_org) then r.title else private.job_order_neutral_title(r.id) end,
    s.status,
    case when s.worker_approved_at is null then s.invited_email end,
    case when s.worker_approved_at is not null
      then nullif(concat_ws(' ', s.profile_snapshot ->> 'first_name', s.profile_snapshot ->> 'last_name'), '') end,
    s.note, s.created_at, s.decided_at, s.worker_approved_at, s.withdrawn_at,
    case when s.n = v_limit and exists (select 1 from page x where x.n = v_limit + 1) then s.id end
  from page s
  join public.workforce_requirements r on r.id = s.requirement_id
  where s.n <= v_limit
  order by s.n;
end;
$$;

revoke all on function public.list_partner_submissions(uuid, uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_partner_submissions(uuid, uuid, uuid, integer) to authenticated;

-- The candidates submitted for the requirement p_requirement of the employer p_org (FR-O4 AC6, step Deliver; the pipeline
-- of FR-O5 builds on it), oldest approval first: only submissions the candidate approved, whatever happened after (a
-- withdrawn one shows as withdrawn, without the snapshot); documents are opened through document_access_grant. For any accepted member of the employer while the
-- release is on (private.assert_invitation_employer, then release_candidate_submissions), an owner or admin at aal2 as for
-- applicants (CHARA_FORBIDDEN aal2_required); counted against rate_limit_job_orders_max. Another organisation's requirement
-- or an unknown id, CHARA_NOT_FOUND. Never the address or a request the candidate has not approved.
create function public.list_requirement_submissions(p_org uuid, p_requirement uuid)
returns table (
  id uuid,
  partner_organization_id uuid,
  partner_name text,
  partner_slug text,
  status public.submission_status,
  candidate_name text,
  profile_snapshot jsonb,
  note text,
  created_at timestamptz,
  worker_approved_at timestamptz,
  withdrawn_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_invitation_employer(p_org);
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.assert_member_aal2(p_org);
  perform private.check_rate_limit('job_orders', (select auth.uid()));
  if not exists (select 1 from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
  select s.id, s.organization_id, o.display_name, o.slug, s.status,
    nullif(concat_ws(' ', s.profile_snapshot ->> 'first_name', s.profile_snapshot ->> 'last_name'), ''),
    case when s.status <> 'withdrawn' then s.profile_snapshot end,
    s.note, s.created_at, s.worker_approved_at, s.withdrawn_at
  from public.candidate_submissions s
  join public.organizations o on o.id = s.organization_id
  where s.requirement_id = p_requirement and s.employer_organization_id = p_org and s.worker_approved_at is not null
  order by s.worker_approved_at, s.id;
end;
$$;

revoke all on function public.list_requirement_submissions(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_requirement_submissions(uuid, uuid) to authenticated;

-- private.notification_payload of 20270102100000_response_decisions.sql with the four submission kinds added. Every other
-- branch is unchanged.
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
    -- V47: to the partner's owners and admins, its own decision only; the requirement's own title and the employer's name
    -- once the employer is named to the partner, the generated title otherwise (NFR-S11). Never the note or anything of
    -- another partner (FR-O3 AC7). The slug is the partner's own.
    when 'response_decided' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
        'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
        'decision', p_message ->> 'decision', 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations e on e.id = r.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid
        and p_message ->> 'decision' in ('shortlisted', 'selected', 'declined', 'submissions_allowed')), '{}'::jsonb)
    -- V48: to the candidate, the partner and the requirement as the candidate may read it (the employer's own title and
    -- name only when the employer shows its name, NFR-S11), destination and start date, for the request page; to an
    -- address without an account the same without the id (the page needs an account). Never the address or another
    -- partner (FR-O4 AC1, AC2, AC10).
    when 'submission_request' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'partner_name', o.display_name,
        'title', private.submission_candidate_title(r), 'country_code', r.country_code, 'country_name', c.name,
        'start_date', r.start_date, 'employer_name', case when r.show_identity then e.display_name end)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    when 'submission_request_signup' then coalesce((
      select jsonb_build_object('partner_name', o.display_name, 'title', private.submission_candidate_title(r),
        'country_code', r.country_code, 'country_name', c.name, 'start_date', r.start_date,
        'employer_name', case when r.show_identity then e.display_name end)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    -- V48: to the owners and admins of the partner and of the employer, the requirement as the recipient knows it (the
    -- generated title to a partner the employer is not named to) and the partner's name; never the candidate, the address
    -- or the documents (FR-O4 AC5, AC9). The slug is the recipient's own.
    when 'submission_approved' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when (p_message ->> 'organization_id')::uuid = s.employer_organization_id
                        or private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    when 'submission_withdrawn' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when (p_message ->> 'organization_id')::uuid = s.employer_organization_id
                        or private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    else '{}'::jsonb
  end);
end;
$$;
