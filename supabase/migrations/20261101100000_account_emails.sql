-- Account emails (FR-I1; ARCHITECTURE.md sections 4, 6.1, 8; OPEN_QUESTIONS.md D10, D62, D65). The sign-up confirmation
-- and the password reset are sent by Auth through the custom SMTP of the transactional email provider; the invitation
-- to a team and the notice of a reset of two-step verification go through the notifications queue. mfa_reset has been
-- queued by reset_mfa since FR-A4; this migration adds the kind member_invitation and the queueing of it in
-- invite_member.
--
-- The invitee may have no account, so the row has no user_id and the address travels in the queue message, which
-- notify deletes (not archives) when it is finished, as for deletion_completed (D46). The raw token exists nowhere
-- else than in the payload of the row while the row is queued: invite_member adds it after the queue message is
-- written, so it is never in the queue, and a trigger removes it from the payload when the row leaves the queued state.

-- Both checks are added not valid and validated in 20261101100100, so the scan of a large table does not hold the lock
-- that every producer of notifications waits for.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation'
)) not valid;
alter table public.notifications drop constraint notifications_check;
alter table public.notifications add constraint notifications_check
  check (user_id is not null or kind in ('deletion_completed', 'member_invitation')) not valid;

comment on column public.notifications.payload is
  'What the email may show, built from the queue message by private.notification_payload. A member_invitation holds the link token while the row is queued and loses it when the row is sent, failed or suppressed. A suppressed member_invitation was replaced by a newer invitation to the same address.';

-- A re-invitation replaces the invitation that is still waiting, and must also stop that invitation's email.
create index notifications_invitation_idx on public.notifications ((payload ->> 'invitation_id'))
  where kind = 'member_invitation' and status = 'queued';

create function private.notification_drop_token() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.payload := new.payload - 'token';
  return new;
end;
$$;

revoke all on function private.notification_drop_token() from public, anon, authenticated, service_role;

create trigger notifications_drop_token before update of status on public.notifications
  for each row when (new.status <> 'queued' and new.payload ? 'token') execute function private.notification_drop_token();

-- The function of 20261031100000 with one more kind: member_invitation shows the organisation's display name, the role
-- and the expiry of the invitation, looked up from its id. The token is not part of the message.
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
begin
  if p_message ->> 'job_id' is not null then
    select j.id, j.title, o.slug, o.display_name into v_job_id, v_title, v_slug, v_org_name
    from public.jobs j join public.organizations o on o.id = j.organization_id
    where j.id = (p_message ->> 'job_id')::uuid;
  end if;
  if p_message ->> 'organization_id' is not null then
    select o.slug into v_slug from public.organizations o where o.id = (p_message ->> 'organization_id')::uuid;
  end if;
  if p_message ->> 'invitation_id' is not null then
    select i.id, i.role, i.expires_at, o.display_name into v_invitation_id, v_role, v_expires, v_org_name
    from public.organization_invitations i join public.organizations o on o.id = i.organization_id
    where i.id = (p_message ->> 'invitation_id')::uuid;
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
      'document_slug', p_message -> 'document_slug', 'version', p_message -> 'version')
    when 'deletion_requested' then jsonb_build_object('erases_on', p_message -> 'erases_on')
    when 'erasure_paused' then jsonb_build_object('account_id', p_message -> 'user_id')
    when 'member_invitation' then jsonb_build_object(
      'invitation_id', v_invitation_id, 'org_name', v_org_name, 'role', v_role, 'expires_at', v_expires)
    else '{}'::jsonb
  end);
end;
$$;

-- The function of 20261008100000 with the email: the invitation is queued in the transaction that creates it, the
-- token is added to the payload of its row, and the email of an invitation that this one replaces is stopped. A call
-- that is refused leaves no row and no message, as before. The caller still gets the token once.
create or replace function public.invite_member(p_org uuid, p_email text, p_role text)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(p_email));
  v_token text;
  v_id uuid;
  v_expires timestamptz;
  v_replaced uuid;
  v_msg bigint;
begin
  perform private.assert_org_manager(p_org, 'admin');

  if p_role is null or p_role not in ('admin', 'member') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'role';
  end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'email';
  end if;
  if exists (
    select 1
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_org and lower(u.email) = v_email
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'already_a_member';
  end if;
  if (
    select count(*) from audit.log l
    where l.action = 'member_invited' and l.metadata ->> 'organization_id' = p_org::text
      and l.created_at > now() - interval '1 hour'
  ) >= (select (value #>> '{}')::integer from private.settings where key = 'invitations_per_hour_max') then
    raise exception 'CHARA_RATE_LIMITED';
  end if;

  for v_replaced in
    delete from public.organization_invitations i
    where i.organization_id = p_org and i.email = v_email::extensions.citext and i.accepted_at is null
    returning i.id
  loop
    update public.notifications n set status = 'suppressed'
    where n.kind = 'member_invitation' and n.status = 'queued' and n.payload ->> 'invitation_id' = v_replaced::text;
  end loop;
  perform private.assert_within_limit(p_org, 'members', private.team_size(p_org));

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.organization_invitations as i (organization_id, email, role, token_hash, invited_by)
  values (p_org, v_email, p_role::public.member_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_uid)
  returning i.id, i.expires_at into v_id, v_expires;

  perform audit.record(
    'member_invited', 'organization_invitation', v_id::text,
    jsonb_build_object('organization_id', p_org, 'role', p_role)
  );
  select m into v_msg from pgmq.send('notifications', jsonb_build_object(
    'kind', 'member_invitation', 'invitation_id', v_id, 'email', v_email, 'mandatory', true
  )) m;
  update public.notifications n set payload = n.payload || jsonb_build_object('token', v_token) where n.msg_id = v_msg;
  return query select v_token, v_expires;
end;
$$;
