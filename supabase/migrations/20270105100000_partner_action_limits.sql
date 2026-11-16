-- Partner action limits at the boundaries and after a lapse (FR-R1 AC7, AC10, AC11; NFR-A4; V51; release 2b).
--
-- The monthly limits of responses (job_order_responses_per_month, V44) and candidate submissions
-- (candidate_submissions_per_month, V48) are already checked under the partner's advisory lock. What this adds:
--
-- A partner whose paid plan ended (on its free plan with a subscription row, private.partner_lapsed) is refused a response
-- and a submission as the free plan's monthly limit, CHARA_LIMIT_REACHED with the key (the free plans allow 0), whatever
-- entitlements_enforced says (FR-R1 AC10), so its pages show the upgrade prompt and record_limit_prompt records it. A
-- partner that never subscribed keeps CHARA_FEATURE_NOT_IN_PLAN job_order_access (decision 3.6, FR-N2 AC2), and so does a
-- lapsed partner below its free plan's limit (raised in the plan editor): job order access still needs a paid plan.
--
-- The lapse takes the advisory locks of the partner's responses and submissions, so a response or a submission in progress
-- finishes before the lapse is applied and one that starts later waits for it and sees the free plan (NFR-A4).

-- Whether p_org had a subscription and is now on its free fallback plan: the lapse of FR-G4 for a partner. The same test as
-- private.free_plan_restricted without the global switch.
create function private.partner_lapsed(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.org_plan_code(p_org) like 'free\_%'
    and exists (select 1 from billing.subscriptions s where s.organization_id = p_org)
$$;

revoke all on function private.partner_lapsed(uuid) from public, anon, authenticated, service_role;

-- private.response_refusal of 20261230100000_partner_responses.sql with one change: without a paid plan, a lapsed partner
-- at its free plan's limit is refused with CHARA_LIMIT_REACHED job_order_responses_per_month instead of
-- CHARA_FEATURE_NOT_IN_PLAN job_order_access (FR-R1 AC10).
create or replace function private.response_refusal(p_org uuid, p_row public.workforce_requirements)
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
    if private.partner_lapsed(p_org) and v_limit is not null and v_used >= v_limit then
      return query select 'CHARA_LIMIT_REACHED'::text, 'job_order_responses_per_month'::text, v_invitation, v_used, v_limit,
        v_applies, null::text[];
      return;
    end if;
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

-- public.submit_candidate of 20270103100000_candidate_submissions.sql with one change: without a paid plan, a lapsed partner
-- at its free plan's limit is refused with CHARA_LIMIT_REACHED candidate_submissions_per_month instead of
-- CHARA_FEATURE_NOT_IN_PLAN job_order_access (FR-R1 AC10). The check runs under the partner's lock like the rest.
create or replace function public.submit_candidate(p_org uuid, p_requirement uuid, p_email text, p_note text default null)
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
    if private.partner_lapsed(p_org)
       and private.monthly_usage(p_org, 'candidate_submissions_per_month')
         >= private.org_limit(p_org, 'candidate_submissions_per_month') then
      raise exception 'CHARA_LIMIT_REACHED' using detail = 'candidate_submissions_per_month';
    end if;
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

-- private.pause_jobs_on_lapse of 20261216100000_requirement_lifecycle.sql with one addition: the advisory locks of the
-- partner's responses and submissions are taken first, so the lapse waits for a response or a submission in progress and
-- the next one counts against the free plan (NFR-A4). An employer has neither, and its keys are never taken by anyone else.
create or replace function private.pause_jobs_on_lapse(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('partner_responses:' || p_org::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('candidate_submissions:' || p_org::text, 0));
  perform set_config('chara.actor_fn', 'pause_jobs_on_lapse', true);
  update public.jobs set status = 'paused' where organization_id = p_org and status = 'open' and deleted_at is null;
  perform set_config('chara.actor_fn', '', true);
  perform private.pause_requirements_on_lapse(p_org);
end;
$$;
