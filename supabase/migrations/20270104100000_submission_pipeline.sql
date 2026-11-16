-- Submission review pipeline (FR-O5, SOP P2-25; decision 4.1; NFR-S8, NFR-A3, NFR-O5; DATA_MODEL.md sections 5, 6, 7, 9;
-- release 2b).
--
-- An approved candidate submission (V48) moves through the stages of an application: submitted (the applied of
-- private.application_transition_allowed), viewed on the first open by a member of the employer, then shortlisted,
-- interview, offer, hired or rejected (label "Not selected") as an employer member decides, and withdrawn by the candidate
-- from any stage (V48). The employer's moves are exactly those of set_application_status with submitted in place of
-- applied; a decline needs a reason of submission_decline_reason_min_chars (10) to application_status_note_max_chars
-- (1,000) characters that the candidate reads in the journey tracker and the partner never reads. Each move writes, in one
-- transaction, the status, one event with the note, one audit row submission.status_changed, the share expiry on hired
-- and rejected (share_expiry_days_after_final), the candidate's status_changed and the partner's optional
-- submission_stage_changed (no message for viewed). Internal notes (public.submission_notes) belong to the employer: no
-- partner and no candidate reads them. Shortlisting needs the plan feature and a lapsed or restricted employer cannot move
-- a stage or add a note (read_only_free_plan); the candidate's withdrawal is never blocked. Owners and admins of the
-- employer use all of it at aal2 only, as for direct applicants (private.assert_member_aal2). Every function answers only
-- while release_candidate_submissions is on.

insert into private.settings (key, value) values ('submission_decline_reason_min_chars', '10')
on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('submission_decline_reason_min_chars', 'integer', 1, 200,
    'Minimum length of the reason an employer gives the candidate when a submitted candidate is not selected', null);

-- The moves ------------------------------------------------------------------------------------------------------------------

-- The application stage a submission stage stands for (submitted is applied); null for the states before the approval.
create function private.submission_stage_as_application(p_status public.submission_status)
returns public.application_status
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'submitted' then 'applied'::public.application_status
    when p_status in ('viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')
      then p_status::text::public.application_status
  end
$$;

revoke all on function private.submission_stage_as_application(public.submission_status)
  from public, anon, authenticated, service_role;

-- Who may make which move, p_fn naming the function that asks, as private.application_transition_allowed does for
-- applications: viewed only by mark_submission_viewed, the employer's moves only by set_submission_status (exactly the
-- pairs of set_application_status), withdrawn only by withdraw_submission (V48).
create function private.submission_move_allowed(
  p_from public.submission_status, p_to public.submission_status, p_fn text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_fn
    when 'mark_submission_viewed' then p_from = 'submitted' and p_to = 'viewed'
    when 'set_submission_status' then private.application_transition_allowed(
      private.submission_stage_as_application(p_from), private.submission_stage_as_application(p_to), 'set_application_status')
  end, false)
$$;

revoke all on function private.submission_move_allowed(public.submission_status, public.submission_status, text)
  from public, anon, authenticated, service_role;

-- The guard of V48 with the stages: any move one of the functions may make.
create or replace function private.submission_transition_allowed(p_from public.submission_status, p_to public.submission_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from = 'awaiting_candidate' and p_to in ('submitted', 'declined_by_candidate', 'expired'))
    or (p_from in ('submitted', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected') and p_to = 'withdrawn')
    or private.submission_move_allowed(p_from, p_to, 'mark_submission_viewed')
    or private.submission_move_allowed(p_from, p_to, 'set_submission_status')
$$;

-- The history gains the note of a move: the reason of a decline or the employer's note to the candidate. It is read
-- through list_submission_events by the candidate and the employer only, never through the Data API.
alter table public.submission_events
  add column note text check (
    note = btrim(note) and char_length(note) between 1 and 1000 and note !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  );

comment on column public.submission_events.note is
  'The note of a stage change, visible to the candidate (the reason of a decline); never to the partner. Read through list_submission_events only.';

create or replace function private.submission_events_append_only() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.id, new.submission_id, new.from_status, new.to_status, new.note, new.created_at)
     is distinct from (old.id, old.submission_id, old.from_status, old.to_status, old.note, old.created_at)
     or new.actor_id is not null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'append_only';
  end if;
  return new;
end;
$$;

-- Internal notes ---------------------------------------------------------------------------------------------------------------

create table public.submission_notes (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.candidate_submissions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (body = btrim(body) and char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

comment on table public.submission_notes is
  'Internal notes of the employer on a candidate submission (FR-O5). Written by add_submission_note only; read by the members of the employer (owners and admins at aal2), never by the partner or the candidate.';

create index submission_notes_submission_idx on public.submission_notes (submission_id, created_at desc, id desc);
create index submission_notes_organization_idx on public.submission_notes (organization_id);
create index submission_notes_author_idx on public.submission_notes (author_id) where author_id is not null;

alter table public.submission_notes enable row level security;
alter table public.submission_notes force row level security;
revoke all on table public.submission_notes from public, anon, authenticated, service_role;
grant select on public.submission_notes to authenticated;

create policy submission_notes_select_member on public.submission_notes
  for select to authenticated
  using (organization_id in (select private.active_member_org_ids()));

-- Helpers ----------------------------------------------------------------------------------------------------------------------

-- The approved submission p_submission of an employer the caller is an accepted member of, for the employer's functions
-- (p_fn names the caller in the log line). A signed-in company account while the release is on (CHARA_FORBIDDEN
-- company_account_required, release_off); an owner or admin of the employer at aal1, CHARA_FORBIDDEN aal2_required; an
-- unknown id, a request the candidate has not approved, another organisation's submission and a suspended employer are one
-- answer, CHARA_NOT_FOUND, and an attempt on a submission of somebody else is logged (CHARA_CROSS_TENANT). With p_lock the
-- row is locked for the move and a suspended employer is CHARA_FORBIDDEN organization_suspended, as for applications.
create function private.employer_submission(p_fn text, p_submission uuid, p_lock boolean)
returns public.candidate_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.candidate_submissions;
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required', errcode = '42501';
  end if;
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.assert_member_aal2(
    (select s.employer_organization_id from public.candidate_submissions s where s.id = p_submission));
  if p_lock then
    select s.* into v_sub from public.candidate_submissions s
    where s.id = p_submission and s.worker_approved_at is not null
      and s.employer_organization_id in (select private.member_org_ids())
    for no key update;
  else
    select s.* into v_sub from public.candidate_submissions s
    where s.id = p_submission and s.worker_approved_at is not null
      and s.employer_organization_id in (select private.active_member_org_ids());
  end if;
  if not found then
    if exists (
      select 1 from public.candidate_submissions s
      where s.id = p_submission and s.worker_user_id is distinct from (select auth.uid())
        and s.employer_organization_id not in (select private.member_org_ids())
        and s.organization_id not in (select private.member_org_ids())
    ) then
      raise log 'CHARA_CROSS_TENANT caller=% function=% submission=%', (select auth.uid()), p_fn, p_submission;
    end if;
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_lock then
    if exists (select 1 from public.organizations o where o.id = v_sub.employer_organization_id and o.status <> 'active') then
      raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended';
    end if;
  end if;
  return v_sub;
end;
$$;

revoke all on function private.employer_submission(text, uuid, boolean) from public, anon, authenticated, service_role;

-- The reason of a decline: trimmed, submission_decline_reason_min_chars to application_status_note_max_chars characters
-- (FR-O5 AC3); a missing, empty, short or long reason is CHARA_INVALID_INPUT p_note. Any other note goes through
-- private.normalize_status_note (optional, at most the same maximum).
create function private.submission_status_note(p_to public.submission_status, p_note text) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_note text := private.normalize_status_note(p_note);
  v_min integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'submission_decline_reason_min_chars');
begin
  if p_to = 'rejected' then
    if v_min is null then
      raise exception 'CHARA_SETTING_MISSING' using detail = 'submission_decline_reason_min_chars';
    end if;
    if v_note is null or char_length(v_note) < v_min then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_note';
    end if;
  end if;
  return v_note;
end;
$$;

revoke all on function private.submission_status_note(public.submission_status, text) from public, anon, authenticated, service_role;

-- The one place an employer's move or the system's viewed changes a submission: the move (p_fn as in
-- private.submission_move_allowed), the plan feature of a shortlist, the event with the note, the share expiry on hired
-- and rejected, one audit row submission.status_changed (organisation, partner, from, to; never the note), and in the
-- same transaction (NFR-A3), except for viewed, the candidate's mandatory status_changed (ids and the stage, never the
-- note) and the optional submission_stage_changed to the accepted owners and admins with an active account of the active
-- partner (the stage only, never the note or the reason; FR-O5 AC5, AC10). The caller has locked the row and checked who
-- asks.
create function private.move_submission(
  p_sub public.candidate_submissions, p_to public.submission_status, p_fn text, p_actor uuid, p_note text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_key text := 'submission_stage_changed:' || p_sub.id || ':' || p_to;
  v_messages jsonb[];
begin
  if not private.submission_move_allowed(p_sub.status, p_to, p_fn) then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = p_sub.status || ' to ' || p_to;
  end if;
  if p_to = 'shortlisted' and not private.has_feature(p_sub.employer_organization_id, 'shortlisting') then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'shortlisting';
  end if;
  if p_to in ('hired', 'rejected') then
    select (s.value #>> '{}')::integer into v_days from private.settings s where s.key = 'share_expiry_days_after_final';
    if v_days is null then
      raise exception 'CHARA_SETTING_MISSING' using detail = 'share_expiry_days_after_final';
    end if;
  end if;

  update public.candidate_submissions s set status = p_to, updated_at = now() where s.id = p_sub.id;
  insert into public.submission_events (submission_id, from_status, to_status, actor_id, note)
  values (p_sub.id, p_sub.status, p_to, p_actor, p_note);
  if p_to in ('hired', 'rejected') then
    update public.passport_shares s set expires_at = now() + make_interval(days => v_days)
    where s.submission_id = p_sub.id and s.revoked_at is null and s.expires_at is null;
  end if;
  perform audit.record('submission.status_changed', 'candidate_submission', p_sub.id::text,
    jsonb_build_object('organization_id', p_sub.employer_organization_id, 'partner_organization_id', p_sub.organization_id,
      'requirement_id', p_sub.requirement_id, 'from', p_sub.status, 'to', p_to));
  if p_to = 'viewed' then
    return;
  end if;
  if exists (select 1 from public.profiles p where p.id = p_sub.worker_user_id and p.status = 'active') then
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'status_changed', 'user_id', p_sub.worker_user_id, 'submission_id', p_sub.id, 'status', p_to,
      'mandatory', true));
  end if;
  select array_agg(jsonb_build_object(
           'kind', 'submission_stage_changed', 'user_id', m.user_id, 'organization_id', m.organization_id,
           'mandatory', k.mandatory, 'dedupe_key', v_key, 'submission_id', p_sub.id, 'status', p_to)
         order by m.user_id)
  into v_messages
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id and o.status = 'active'
  join public.profiles u on u.id = m.user_id and u.status = 'active'
  join private.notification_kinds k on k.kind = 'submission_stage_changed'
  where m.organization_id = p_sub.organization_id and m.role in ('owner', 'admin') and m.accepted_at is not null
    and not exists (
      select 1 from public.notifications n
      where n.user_id = m.user_id and n.kind = 'submission_stage_changed' and n.dedupe_key = v_key);
  if v_messages is not null then
    perform pgmq.send_batch('notifications', v_messages);
  end if;
end;
$$;

revoke all on function private.move_submission(public.candidate_submissions, public.submission_status, text, uuid, text)
  from public, anon, authenticated, service_role;

-- One employer move of p_submission, shared by set_submission_status and every item of bulk_set_submission_status: the
-- row locked, an employer that is active and writable (CHARA_FEATURE_NOT_IN_PLAN read_only_free_plan for a lapsed or
-- restricted employer, FR-O5 AC11), then the move.
create function private.change_submission_status(p_submission uuid, p_to public.submission_status, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.candidate_submissions := private.employer_submission('set_submission_status', p_submission, true);
begin
  perform private.assert_org_writable(v_sub.employer_organization_id);
  perform private.move_submission(v_sub, p_to, 'set_submission_status', (select auth.uid()), p_note);
end;
$$;

revoke all on function private.change_submission_status(uuid, public.submission_status, text)
  from public, anon, authenticated, service_role;

-- Moving ----------------------------------------------------------------------------------------------------------------------

-- A member of the employer (any role; owners and admins at aal2) moves the approved submission p_submission to p_status
-- with a note the candidate reads: optional, at most application_status_note_max_chars, and for rejected the required
-- reason (FR-O5 AC2, AC3). The targets and the refusals are those of set_application_status: CHARA_FORBIDDEN
-- (company_account_required, release_off, aal2_required, organization_suspended), CHARA_NOT_FOUND, CHARA_INVALID_INPUT
-- (p_status for a null target, p_note), CHARA_INVALID_TRANSITION (any pair set_application_status refuses, with submitted
-- in place of applied, and every move to viewed or withdrawn), CHARA_FEATURE_NOT_IN_PLAN (shortlisting,
-- read_only_free_plan), CHARA_SETTING_MISSING.
create function public.set_submission_status(
  p_submission uuid, p_status public.submission_status, p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_status';
  end if;
  perform private.change_submission_status(p_submission, p_status, private.submission_status_note(p_status, p_note));
end;
$$;

revoke all on function public.set_submission_status(uuid, public.submission_status, text) from public, anon, authenticated, service_role;
grant execute on function public.set_submission_status(uuid, public.submission_status, text) to authenticated;

-- The bulk change of FR-O5 AC8, as bulk_set_application_status: 1 to 100 ids (duplicates once), one target among
-- shortlisted, interview, offer, hired and rejected, one note (the reason of a decline, required). Each submission goes
-- through the same function as set_submission_status in its own subtransaction, so a refused one (a withdrawn submission, a
-- move the table refuses, another organisation's id) changes nothing and the others still move. The result has one row per
-- distinct id in id order with the CHARA_ code of a refusal. A lapsed or restricted employer refuses the whole call before
-- any item. One audit row submission.bulk_status_changed per employer of the moved items (organisation, target, requested,
-- applied, ids; never the note), one with a null organisation when nothing moved.
create function public.bulk_set_submission_status(
  p_submission_ids uuid[], p_status public.submission_status, p_note text default null
) returns table (submission_id uuid, ok boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max constant integer := 100;
  v_note text;
  v_ids uuid[];
  v_org uuid;
  v_orgs uuid[];
  v_id uuid;
  v_applied uuid[] := array[]::uuid[];
  v_org_ids uuid[];
  v_message text;
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required', errcode = '42501';
  end if;
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if coalesce(cardinality(p_submission_ids), 0) not between 1 and v_max
     or exists (select 1 from unnest(p_submission_ids) i where i is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_submission_ids';
  end if;
  if p_status is null or p_status not in ('shortlisted', 'interview', 'offer', 'hired', 'rejected') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_status';
  end if;
  v_note := private.submission_status_note(p_status, p_note);

  v_ids := array(select distinct i from unnest(p_submission_ids) i order by i);
  for v_org in
    select distinct s.employer_organization_id from public.candidate_submissions s
    where s.id = any (v_ids) and s.worker_approved_at is not null
      and s.employer_organization_id in (select private.member_org_ids())
  loop
    perform private.assert_member_aal2(v_org);
    perform private.assert_org_writable(v_org);
  end loop;

  foreach v_id in array v_ids loop
    begin
      perform private.change_submission_status(v_id, p_status, v_note);
      submission_id := v_id;
      ok := true;
      error_code := null;
      v_applied := v_applied || v_id;
    exception when others then
      get stacked diagnostics v_message = message_text;
      if v_message not like 'CHARA\_%' then
        raise;
      end if;
      submission_id := v_id;
      ok := false;
      error_code := v_message;
    end;
    return next;
  end loop;

  v_orgs := array(select distinct s.employer_organization_id from public.candidate_submissions s where s.id = any (v_applied));
  if cardinality(v_orgs) = 0 then
    v_orgs := array[null::uuid];
  end if;
  foreach v_org in array v_orgs loop
    v_org_ids := array(
      select s.id from public.candidate_submissions s
      where s.id = any (v_applied) and s.employer_organization_id is not distinct from v_org order by s.id);
    perform audit.record('submission.bulk_status_changed', 'candidate_submission', null,
      jsonb_build_object('organization_id', v_org, 'to', p_status, 'requested', cardinality(v_ids),
        'applied', cardinality(v_org_ids), 'ids', to_jsonb(v_org_ids)));
  end loop;
end;
$$;

revoke all on function public.bulk_set_submission_status(uuid[], public.submission_status, text)
  from public, anon, authenticated, service_role;
grant execute on function public.bulk_set_submission_status(uuid[], public.submission_status, text) to authenticated;

-- The system's move submitted -> viewed on the first open by a member of the employer (FR-O5 states). Any later open, any
-- other stage and a lapsed or restricted employer change nothing and raise nothing; the event has no actor and nobody is
-- told.
create function public.mark_submission_viewed(p_submission uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.candidate_submissions := private.employer_submission('mark_submission_viewed', p_submission, true);
begin
  if v_sub.status <> 'submitted' or private.free_plan_restricted(v_sub.employer_organization_id) then
    return;
  end if;
  perform private.move_submission(v_sub, 'viewed', 'mark_submission_viewed', null, null);
end;
$$;

revoke all on function public.mark_submission_viewed(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_submission_viewed(uuid) to authenticated;

-- An internal note of the caller's employer on p_submission (FR-O5 AC5): trimmed, 1 to 5,000 characters
-- (CHARA_INVALID_INPUT p_body), refused for a lapsed or restricted employer (read_only_free_plan) and counted against the
-- daily quota of audited writes (CHARA_RATE_LIMITED), as a note on an application. Answers the id.
create function public.add_submission_note(p_submission uuid, p_body text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_sub public.candidate_submissions;
  v_id bigint;
begin
  v_sub := private.employer_submission('add_submission_note', p_submission, true);
  if char_length(v_body) not between 1 and 5000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_body';
  end if;
  perform private.assert_org_writable(v_sub.employer_organization_id);
  perform private.count_audited_write(v_sub.employer_organization_id);
  insert into public.submission_notes (submission_id, organization_id, author_id, body)
  values (v_sub.id, v_sub.employer_organization_id, (select auth.uid()), v_body)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_submission_note(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.add_submission_note(uuid, text) to authenticated;

-- Reads ------------------------------------------------------------------------------------------------------------------------

-- The approved submissions of the employer p_org (FR-O5 AC1, AC12), for one requirement or all, in one stage or all,
-- oldest approval first, p_limit (1 to 500, default 50) from p_offset, with the total of the filter on every row. Each
-- with the requirement's own title, the partner that submitted it ("Submitted by"), the stage, the candidate's name from
-- the snapshot, the approval and the time of the latest stage change.
-- For any accepted member of the employer while both releases are on (private.assert_invitation_employer, then
-- release_candidate_submissions), owners and admins at aal2; counted against rate_limit_job_orders_max. Another
-- organisation's requirement or an unknown id, CHARA_NOT_FOUND. Never the address or a request not approved.
create function public.list_employer_submissions(
  p_org uuid,
  p_requirement uuid default null,
  p_stage public.submission_status default null,
  p_limit integer default null,
  p_offset integer default null
)
returns table (
  id uuid,
  requirement_id uuid,
  requirement_title text,
  partner_name text,
  partner_slug text,
  status public.submission_status,
  candidate_name text,
  worker_approved_at timestamptz,
  stage_changed_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.assert_invitation_employer(p_org);
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.assert_member_aal2(p_org);
  perform private.check_rate_limit('job_orders', (select auth.uid()));
  if p_requirement is not null
     and not exists (select 1 from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
  select s.id, s.requirement_id, r.title, o.display_name, o.slug, s.status,
    nullif(concat_ws(' ', s.profile_snapshot ->> 'first_name', s.profile_snapshot ->> 'last_name'), ''),
    s.worker_approved_at,
    (select max(e.created_at) from public.submission_events e where e.submission_id = s.id),
    count(*) over ()
  from public.candidate_submissions s
  join public.organizations o on o.id = s.organization_id
  join public.workforce_requirements r on r.id = s.requirement_id
  where s.employer_organization_id = p_org and s.worker_approved_at is not null
    and s.employer_organization_id in (select private.active_member_org_ids())
    and (p_requirement is null or s.requirement_id = p_requirement)
    and (p_stage is null or s.status = p_stage)
  order by s.worker_approved_at, s.id
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.list_employer_submissions(uuid, uuid, public.submission_status, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_employer_submissions(uuid, uuid, public.submission_status, integer, integer)
  to authenticated;

-- One approved submission for the employer's detail page (FR-O5 step Review, AC7): the requirement, the partner, the
-- stage, the partner's note, the profile as the candidate approved it (none once withdrawn), the dates and whether the
-- share still lets the employer open anything. Refusals of private.employer_submission.
create function public.get_employer_submission(p_submission uuid)
returns table (
  id uuid,
  organization_id uuid,
  requirement_id uuid,
  requirement_title text,
  partner_name text,
  partner_slug text,
  status public.submission_status,
  candidate_name text,
  profile_snapshot jsonb,
  note text,
  worker_approved_at timestamptz,
  withdrawn_at timestamptz,
  share_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.candidate_submissions := private.employer_submission('get_employer_submission', p_submission, false);
begin
  return query
  select v_sub.id, v_sub.employer_organization_id, r.id, r.title, o.display_name, o.slug, v_sub.status,
    nullif(concat_ws(' ', v_sub.profile_snapshot ->> 'first_name', v_sub.profile_snapshot ->> 'last_name'), ''),
    case when v_sub.status <> 'withdrawn' then v_sub.profile_snapshot end,
    v_sub.note, v_sub.worker_approved_at, v_sub.withdrawn_at, private.share_valid(v_sub.passport_share_id)
  from public.workforce_requirements r
  join public.organizations o on o.id = v_sub.organization_id
  where r.id = v_sub.requirement_id;
end;
$$;

revoke all on function public.get_employer_submission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_employer_submission(uuid) to authenticated;

-- The documents of the submission's share the employer may open through document_access_grant with submission_review,
-- as application_documents: while the share is valid, never a deleted or rejected document, never a path.
create function public.submission_documents(p_submission uuid)
returns table (
  id uuid,
  title text,
  type public.worker_document_type,
  file_name text,
  size_bytes integer,
  expires_on date,
  available boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.candidate_submissions := private.employer_submission('submission_documents', p_submission, false);
begin
  if not private.share_valid(v_sub.passport_share_id) then
    return;
  end if;
  return query
  select d.id, d.title, d.type, d.file_name, d.size_bytes, d.expires_on, d.scan_status in ('clean', 'skipped')
  from public.passport_shares s
  join public.worker_documents d
    on d.id = any (array(select jsonb_array_elements_text(s.scope)::uuid))
   and d.worker_user_id = s.worker_user_id and d.deleted_at is null and d.scan_status <> 'rejected'
  where s.id = v_sub.passport_share_id
  order by d.created_at, d.id
  limit 100;
end;
$$;

revoke all on function public.submission_documents(uuid) from public, anon, authenticated, service_role;
grant execute on function public.submission_documents(uuid) to authenticated;

-- The internal notes of a submission, newest first, 50 to a page, with the author's display name, as
-- list_application_notes; a lapsed employer still reads them.
create function public.list_submission_notes(p_submission uuid, p_before_id bigint default null)
returns table (id bigint, author_name text, body text, created_at timestamptz, has_more boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.candidate_submissions := private.employer_submission('list_submission_notes', p_submission, false);
begin
  return query
  with page as (
    select n.id, n.author_id, n.body, n.created_at
    from public.submission_notes n
    where n.submission_id = v_sub.id and n.organization_id = v_sub.employer_organization_id
      and (p_before_id is null or (n.created_at, n.id) < (
        select b.created_at, b.id from public.submission_notes b where b.id = p_before_id and b.submission_id = v_sub.id))
    order by n.created_at desc, n.id desc
    limit 51
  ),
  numbered as (
    select page.*, row_number() over (order by page.created_at desc, page.id desc) as rn, count(*) over () as total from page
  )
  select numbered.id, p.display_name, numbered.body, numbered.created_at, numbered.total > 50
  from numbered
  left join public.profiles p on p.id = numbered.author_id
  where numbered.rn <= 50
  order by numbered.rn;
end;
$$;

revoke all on function public.list_submission_notes(uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.list_submission_notes(uuid, bigint) to authenticated;

-- The history of a submission from the approval on, oldest first, for its candidate (the journey tracker, FR-O5 AC9) and
-- for the members of its employer (owners and admins at aal2): each move with its note (the reason of a decline) and who
-- made it as a role (candidate, employer or system), never the person. Anybody else, CHARA_NOT_FOUND; the partner reads
-- the stages and their dates through list_partner_submissions only.
create function public.list_submission_events(p_submission uuid)
returns table (from_status public.submission_status, to_status public.submission_status, actor_role text, note text,
  created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.submission_caller();
  v_sub public.candidate_submissions;
begin
  select s.* into v_sub from public.candidate_submissions s
  where s.id = p_submission and s.worker_user_id = v_uid and s.worker_approved_at is not null;
  if not found then
    if private.account_kind() is distinct from 'company' then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_sub := private.employer_submission('list_submission_events', p_submission, false);
  end if;
  return query
  select e.from_status, e.to_status,
    case when e.actor_id is null then 'system'
      when e.actor_id = v_sub.worker_user_id then 'candidate' else 'employer' end,
    e.note, e.created_at
  from public.submission_events e
  where e.submission_id = v_sub.id and e.to_status not in ('awaiting_candidate', 'declined_by_candidate', 'expired')
  order by e.created_at, e.id;
end;
$$;

revoke all on function public.list_submission_events(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_submission_events(uuid) to authenticated;

-- list_partner_submissions of V48 with the stages and their dates (FR-O5 AC4, AC5, AC10): stage_changed_at, the time of
-- the latest change, and stages, each stage the submission reached from the approval on with its time, oldest first;
-- never the note, the reason or who moved it. Everything else is unchanged.
drop function public.list_partner_submissions(uuid, uuid, uuid, integer);

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
  stage_changed_at timestamptz,
  stages jsonb,
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
    (select max(e.created_at) from public.submission_events e where e.submission_id = s.id),
    coalesce((
      select jsonb_agg(jsonb_build_object('status', e.to_status, 'at', e.created_at) order by e.created_at, e.id)
      from public.submission_events e
      where e.submission_id = s.id and e.to_status not in ('awaiting_candidate', 'declined_by_candidate', 'expired')
    ), '[]'::jsonb),
    case when s.n = v_limit and exists (select 1 from page x where x.n = v_limit + 1) then s.id end
  from page s
  join public.workforce_requirements r on r.id = s.requirement_id
  where s.n <= v_limit
  order by s.n;
end;
$$;

revoke all on function public.list_partner_submissions(uuid, uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_partner_submissions(uuid, uuid, uuid, integer) to authenticated;

-- The partner's notice of a stage change ----------------------------------------------------------------------------------------

insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types) values
  ('submission_stage_changed', false, true, 'company', 'Stage changes of the candidates you submitted',
    array['recruitment_company', 'staffing_company']::public.organization_type[]);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon', 'job_order_match', 'invitation_received',
  'invitation_withdrawn', 'requirement_changed', 'requirement_closed', 'response_received', 'response_withdrawn',
  'response_decided', 'submission_request', 'submission_request_signup', 'submission_approved', 'submission_withdrawn',
  'submission_stage_changed'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- private.notification_payload of 20270103100000_candidate_submissions.sql with status_changed for a submission and the
-- partner's submission_stage_changed. Every other branch is unchanged.
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
    -- V50: a submission's stage names the requirement as the candidate may read it, the partner that proposed the
    -- candidate and the employer only when it shows its name; never the note (FR-O5 AC9).
    when 'status_changed' then case
      when p_message ? 'submission_id' then coalesce((
        select jsonb_build_object('submission_id', s.id, 'job_title', private.submission_candidate_title(r),
          'org_name', case when r.show_identity then e.display_name end, 'partner_name', o.display_name,
          'status', p_message -> 'status')
        from public.candidate_submissions s
        join public.organizations o on o.id = s.organization_id
        join public.workforce_requirements r on r.id = s.requirement_id
        join public.organizations e on e.id = r.organization_id
        where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
      else jsonb_build_object(
        'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name,
        'status', p_message -> 'status')
    end
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
    -- V50: to the partner's owners and admins, the stage its candidate reached and the requirement as the partner knows it
    -- (the generated title until the employer is named to it); never the candidate's name, the note or the reason (FR-O5
    -- AC5, AC10). The slug is the partner's own.
    when 'submission_stage_changed' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'status', p_message ->> 'status', 'org_slug', v_slug)
      from public.candidate_submissions s
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid
        and p_message ->> 'status' in ('shortlisted', 'interview', 'offer', 'hired', 'rejected')), '{}'::jsonb)
    else '{}'::jsonb
  end);
end;
$$;
