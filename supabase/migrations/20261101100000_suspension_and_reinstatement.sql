-- Suspension and reinstatement (FR-F1; ARCHITECTURE.md sections 4, 8, 11; OPEN_QUESTIONS.md D45, D65). Only a Trust & Safety
-- Administrator at aal2 suspends or reinstates a user or an organisation, with a statement of reasons of 10 to 2000
-- characters. Each action writes one moderation_actions row and one audit row in the transaction of the change, queues the
-- mandatory email and, where a session must end, an account-ops job. Vacancy moderation (moderate_job) is FR-C7.

create table public.moderation_actions (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('profile', 'organization')),
  target_id uuid not null,
  action text not null check (action in ('account_suspended', 'account_reinstated', 'organization_suspended', 'organization_reinstated')),
  statement_of_reasons text not null check (char_length(statement_of_reasons) between 10 and 2000),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((target_type = 'profile') = (action in ('account_suspended', 'account_reinstated')))
);

comment on table public.moderation_actions is
  'Append-only record of the suspensions and reinstatements of users and organisations. target_id has no foreign key: the record outlives an erased account.';

create index moderation_actions_target_idx on public.moderation_actions (target_type, target_id, id desc);
create index moderation_actions_actor_idx on public.moderation_actions (actor_id) where actor_id is not null;

alter table public.moderation_actions enable row level security;
alter table public.moderation_actions force row level security;
revoke all on table public.moderation_actions from public, anon, authenticated, service_role;

create trigger moderation_actions_append_only
  before update or delete on public.moderation_actions
  for each row execute function private.refuse_change();

create trigger moderation_actions_no_truncate
  before truncate on public.moderation_actions
  for each statement execute function private.refuse_change();

alter table public.moderation_actions enable always trigger moderation_actions_append_only;
alter table public.moderation_actions enable always trigger moderation_actions_no_truncate;

-- Two emails more: the suspension and the reinstatement carry the statement of reasons (payload key reasons). The
-- legal_version payload also carries the change summary.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'account_suspended', 'account_reinstated'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- The function of 20261031100000 with these changes: the organisation branch also reads the display name, and the
-- suspension, the reinstatement and the legal version carry what their emails show.
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
      'job_id', v_job_id, 'job_title', v_title, 'org_slug', v_slug, 'reasons', p_message -> 'reasons')
    when 'trial_ending' then jsonb_build_object(
      'org_slug', v_slug, 'trial_ends_at', p_message -> 'trial_ends_at', 'plan_code', p_message -> 'plan_code',
      'amount_minor', p_message -> 'amount_minor', 'currency', p_message -> 'currency')
    when 'payment_failed' then jsonb_build_object('org_slug', v_slug)
    when 'legal_version' then jsonb_build_object(
      'document_slug', p_message -> 'document_slug', 'version', p_message -> 'version',
      'change_summary', p_message -> 'change_summary')
    when 'account_suspended' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug)
    when 'account_reinstated' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug)
    when 'deletion_requested' then jsonb_build_object('erases_on', p_message -> 'erases_on')
    when 'erasure_paused' then jsonb_build_object('account_id', p_message -> 'user_id')
    else '{}'::jsonb
  end);
end;
$$;

-- The caller must hold one of the roles, unrevoked, and be at aal2. The role is looked up, never read from the token.
create function private.assert_staff(p_roles public.platform_role[]) returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (
    select 1 from public.platform_staff s
    where s.user_id = v_uid and s.role = any (p_roles) and s.revoked_at is null
  ) then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;
  return v_uid;
end;
$$;

revoke all on function private.assert_staff(public.platform_role[]) from public, anon, authenticated, service_role;

create function private.statement_of_reasons(p_reason text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reason text := btrim(p_reason, E' \t\r\n');
begin
  if v_reason is null or char_length(v_reason) not between 10 and 2000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'reason';
  end if;
  return v_reason;
end;
$$;

revoke all on function private.statement_of_reasons(text) from public, anon, authenticated, service_role;

-- The id the web tier sends with each request (header x-request-id), so an audit row can be matched to the request that
-- caused it. Anything that is not a UUID is dropped.
create function private.request_id() returns text
language sql
stable
set search_path = ''
as $$
  select case when h ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then lower(h) end
  from (select nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id' as h) s
$$;

revoke all on function private.request_id() from public, anon, authenticated, service_role;
grant execute on function private.request_id() to authenticated;

create function private.record_moderation(
  p_target_type text, p_target_id uuid, p_action text, p_audit_action text, p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id)
  values (p_target_type, p_target_id, p_action, p_reason, (select auth.uid()));
  perform audit.record(
    p_audit_action, p_target_type, p_target_id::text,
    jsonb_strip_nulls(jsonb_build_object('reason', p_reason, 'request_id', private.request_id()))
  );
end;
$$;

revoke all on function private.record_moderation(text, uuid, text, text, text) from public, anon, authenticated, service_role;

-- One mandatory email to each owner and admin of the organisation, who are the people who can answer for it.
create function private.queue_organization_notice(p_kind text, p_org uuid, p_reason text) returns void
language sql
security definer
set search_path = ''
as $$
  select pgmq.send('notifications', jsonb_build_object(
    'kind', p_kind, 'user_id', m.user_id, 'mandatory', true, 'organization_id', p_org, 'reasons', p_reason
  ))
  from public.organization_members m
  where m.organization_id = p_org and m.role in ('owner', 'admin') and m.accepted_at is not null
$$;

revoke all on function private.queue_organization_notice(text, uuid, text) from public, anon, authenticated, service_role;

-- The sign-in ban and the global sign-out are the job of account-ops. The job reads the profile status when it runs, so a
-- suspension followed at once by a reinstatement ends as the profile says whatever the order the jobs are taken in.
create function public.suspend_user(p_user_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_status public.profile_status;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_user_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'user';
  end if;

  select p.status into v_status from public.profiles p where p.id = p_user_id for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;
  if exists (select 1 from public.platform_staff s where s.user_id = p_user_id and s.revoked_at is null) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'staff_account';
  end if;

  update public.profiles set status = 'suspended' where id = p_user_id;
  perform private.record_moderation('profile', p_user_id, 'account_suspended', 'user.suspend', v_reason);
  perform pgmq.send('account_ops', jsonb_build_object('action', 'suspend_user', 'user_id', p_user_id));
  perform pgmq.send('notifications', jsonb_build_object(
    'kind', 'account_suspended', 'user_id', p_user_id, 'mandatory', true, 'reasons', v_reason
  ));
end;
$$;

revoke all on function public.suspend_user(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.suspend_user(uuid, text) to authenticated;

create function public.reinstate_user(p_user_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_status public.profile_status;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_user_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'user';
  end if;

  select p.status into v_status from public.profiles p where p.id = p_user_id for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'suspended' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;

  update public.profiles set status = 'active' where id = p_user_id;
  perform private.record_moderation('profile', p_user_id, 'account_reinstated', 'user.reinstate', v_reason);
  perform pgmq.send('account_ops', jsonb_build_object('action', 'reinstate_user', 'user_id', p_user_id));
  perform pgmq.send('notifications', jsonb_build_object(
    'kind', 'account_reinstated', 'user_id', p_user_id, 'mandatory', true, 'reasons', v_reason
  ));
end;
$$;

revoke all on function public.reinstate_user(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.reinstate_user(uuid, text) to authenticated;

-- Every visible vacancy of the organisation leaves the public (moderation_state org_suspended); one hidden by moderation
-- stays hidden, and so do the status of the vacancy and the subscription, which are not touched. Members are signed out
-- by account-ops but not banned: they may belong to other organisations.
create function public.suspend_organization(p_org uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_status public.organization_status;
  v_request text := private.request_id();
  v_job uuid;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_org is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'organization';
  end if;

  select o.status into v_status from public.organizations o where o.id = p_org for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;

  update public.organizations set status = 'suspended' where id = p_org;
  perform private.record_moderation('organization', p_org, 'organization_suspended', 'organization.suspend', v_reason);
  for v_job in
    update public.jobs set moderation_state = 'org_suspended'
    where organization_id = p_org and moderation_state = 'visible' and deleted_at is null
    returning id
  loop
    perform audit.record(
      'job.org_suspend', 'job', v_job::text,
      jsonb_strip_nulls(jsonb_build_object('organization_id', p_org, 'request_id', v_request))
    );
  end loop;
  perform pgmq.send('account_ops', jsonb_build_object('action', 'sign_out_organization', 'organization_id', p_org));
  perform private.queue_organization_notice('account_suspended', p_org, v_reason);
end;
$$;

revoke all on function public.suspend_organization(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.suspend_organization(uuid, text) to authenticated;

-- No account-ops job: the suspension set no ban and members sign in with a new session as before.
create function public.reinstate_organization(p_org uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_status public.organization_status;
  v_request text := private.request_id();
  v_job uuid;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_org is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'organization';
  end if;

  select o.status into v_status from public.organizations o where o.id = p_org for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'suspended' then
    raise exception 'CHARA_INVALID_STATE' using detail = v_status::text;
  end if;

  update public.organizations set status = 'active' where id = p_org;
  perform private.record_moderation('organization', p_org, 'organization_reinstated', 'organization.reinstate', v_reason);
  for v_job in
    update public.jobs set moderation_state = 'visible'
    where organization_id = p_org and moderation_state = 'org_suspended'
    returning id
  loop
    perform audit.record(
      'job.org_reinstate', 'job', v_job::text,
      jsonb_strip_nulls(jsonb_build_object('organization_id', p_org, 'request_id', v_request))
    );
  end loop;
  perform private.queue_organization_notice('account_reinstated', p_org, v_reason);
end;
$$;

revoke all on function public.reinstate_organization(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.reinstate_organization(uuid, text) to authenticated;
