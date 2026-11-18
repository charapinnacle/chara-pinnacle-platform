-- Candidate requests end when the partner may no longer submit (FR-O3 step Open submissions, FR-O4 AC4 and step Approve,
-- FR-O5; NFR-C4, NFR-S9). A decline of the partner's response, a withdrawal of it, or the employer closing submissions
-- to a shortlisted partner leaves private.submissions_allowed_for false; until now the partner's requests still awaiting
-- the candidate stayed open and approve_submission shared the passport anyway. Now:
--   * every request of that partner for that requirement still awaiting the candidate expires at once, marked
--     submissions_closed so the candidate and the partner read why (an event without actor and submission.expired with
--     the reason, as the daily expiry writes; no notification, as for the daily expiry). The request still counts in its
--     month. Approved submissions are the candidate's and the employer's (FR-O5): they keep their stage, their share and
--     their consent, and only the candidate withdraws them (FR-O4 AC9).
--   * approve_submission refuses a request whose partner may no longer submit (CHARA_INVALID_STATE submissions_closed),
--     and approve_submission and decline_submission answer a request closed this way with submissions_closed instead of
--     expired.
--   * list_my_submissions and list_partner_submissions say whether an expired request was closed this way.
-- The requests already left open by such a decision are expired by this migration.

alter table public.candidate_submissions
  add column submissions_closed boolean not null default false,
  add constraint candidate_submissions_closed check (not submissions_closed or status = 'expired');

comment on column public.candidate_submissions.submissions_closed is
  'The request expired because the partner may no longer submit candidates for the requirement (its response declined or withdrawn, or submissions closed by the employer), not because the candidate did not answer. Read through the submission functions.';

-- Expires every request of the partner p_partner for the requirement p_requirement still awaiting the candidate, with
-- one event without actor and one audit row submission.expired (reason submissions_closed) each. Answers the number
-- expired.
create function private.close_submission_requests(p_requirement uuid, p_partner uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    update public.candidate_submissions s
    set status = 'expired', decided_at = now(), updated_at = now(), submissions_closed = true
    where s.requirement_id = p_requirement and s.organization_id = p_partner and s.status = 'awaiting_candidate'
    returning s.id, s.employer_organization_id
  loop
    insert into public.submission_events (submission_id, from_status, to_status, actor_id)
    values (v_row.id, 'awaiting_candidate', 'expired', null);
    perform audit.record('submission.expired', 'candidate_submission', v_row.id::text,
      jsonb_build_object('requirement_id', p_requirement, 'organization_id', p_partner,
        'employer_organization_id', v_row.employer_organization_id, 'reason', 'submissions_closed'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.close_submission_requests(uuid, uuid) from public, anon, authenticated, service_role;

-- Whatever ends the partner's permission (decide_response declining, set_submissions_allowed closing, withdraw_response,
-- a later function) closes its requests in the same transaction. The response row is held by that change, and
-- submit_candidate holds it for share, so no request is written in between.
create function private.partner_responses_close_requests() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.close_submission_requests(new.requirement_id, new.organization_id);
  return null;
end;
$$;

revoke all on function private.partner_responses_close_requests() from public, anon, authenticated, service_role;

create trigger partner_responses_close_requests
  after update of status, submissions_allowed on public.partner_responses
  for each row
  when (not (new.submissions_allowed and new.status in ('shortlisted', 'selected')))
  execute function private.partner_responses_close_requests();

alter table public.partner_responses enable always trigger partner_responses_close_requests;

select private.close_submission_requests(s.requirement_id, s.organization_id)
from (
  select distinct s.requirement_id, s.organization_id from public.candidate_submissions s
  where s.status = 'awaiting_candidate' and not private.submissions_allowed_for(s.requirement_id, s.organization_id)
) s;

-- private.pending_submission of 20270103100000: a request closed with the partner's permission answers
-- submissions_closed.
create or replace function private.pending_submission(p_user uuid, p_submission uuid) returns public.candidate_submissions
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
  if v_row.submissions_closed then
    raise exception 'CHARA_INVALID_STATE' using detail = 'submissions_closed';
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

-- approve_submission of 20270111100100: after the requirement, the partner must still be allowed to submit
-- (private.submissions_allowed_for), else CHARA_INVALID_STATE submissions_closed and nothing is shared. The response is
-- not locked here: the change that closes submissions locks the response and then this request, so a lock here, taken
-- after the request's, could deadlock with it; an approval committed first stays approved, one after it finds the
-- request closed.
create or replace function public.approve_submission(p_submission uuid, p_document_ids uuid[] default null::uuid[]) returns public.submission_status
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
    where r.id = v_sub.requirement_id and r.status = 'open' and e.status = 'active' and r.moderation_state = 'visible'
  ) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_not_open';
  end if;
  if not private.submissions_allowed_for(v_sub.requirement_id, v_sub.organization_id) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'submissions_closed';
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

-- list_my_submissions of 20270103100000 with submissions_closed. Everything else is unchanged.
drop function public.list_my_submissions();

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
  withdrawn_at timestamptz,
  submissions_closed boolean
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
    s.created_at, s.decided_at, s.worker_approved_at, s.withdrawn_at, s.submissions_closed
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

-- list_partner_submissions of 20270111100200 with submissions_closed. Everything else is unchanged.
drop function public.list_partner_submissions(uuid, uuid, uuid, integer);

create function public.list_partner_submissions(p_org uuid, p_requirement uuid default null::uuid, p_cursor uuid default null::uuid, p_limit integer default null::integer) returns table (id uuid, requirement_id uuid, title text, status public.submission_status, invited_email text, candidate_name text, note text, created_at timestamptz, decided_at timestamptz, worker_approved_at timestamptz, withdrawn_at timestamptz, stage_changed_at timestamptz, stages jsonb, next_cursor uuid, moderation_state public.job_moderation_state, moderation_action_id bigint, submissions_closed boolean)
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
    case when s.n = v_limit and exists (select 1 from page x where x.n = v_limit + 1) then s.id end,
    s.moderation_state,
    case when s.moderation_state = 'hidden' then (
      select a.id from public.moderation_actions a
      where a.target_type = 'candidate_submission' and a.target_id = s.id and a.action = 'content_hidden'
      order by a.id desc limit 1) end,
    s.submissions_closed
  from page s
  join public.workforce_requirements r on r.id = s.requirement_id
  where s.n <= v_limit
  order by s.n;
end;
$$;

revoke all on function public.list_partner_submissions(uuid, uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_partner_submissions(uuid, uuid, uuid, integer) to authenticated;
