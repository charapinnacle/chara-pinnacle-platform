-- The team of a recruitment or staffing company (V81, FR-J1 AC9 and AC11; FR-A5; docs/phase-2/DATA_MODEL.md sections 2,
-- 4 and 8, release 2a). Partner organisations use the members, invitations and ownership transfer of Phase 1: the same
-- tables and the same functions, with the members limit of the partner plans (limit key members: Basic 1,
-- Professional 5, Enterprise 15, the free plans 0, counted by private.team_size as for employers). This migration adds
-- what a partner needs on top: invitations to a partner open only while release 2a is on, the members limit is
-- serialised per organisation by an advisory lock, and the invitation says which type of account joins it.

-- invite_member of 20261101100000 with two additions. An invitation to a recruitment or staffing company is refused while
-- release 2a is off (CHARA_FORBIDDEN detail release_off), after the caller was checked, so an outsider learns nothing.
-- The advisory lock organization_members:<org> is taken before the earlier invitation of the address is removed and the
-- team counted, so two invitations of one organisation at the boundary of the members limit cannot both pass (NFR-A4),
-- whatever other lock the caller holds; invitations of other organisations do not wait. Employers keep every check of
-- before in the same order.
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
  if private.org_type(p_org) <> 'employer' and not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;

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

  perform pg_advisory_xact_lock(hashtextextended('organization_members:' || p_org::text, 0));
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

-- accept_invitation of 20261117100100: an invitation to a recruitment or staffing company is accepted only while release
-- 2a is on (CHARA_FORBIDDEN detail release_off, checked once the token is known to be valid for the caller); the type of
-- the organisation must still equal the intended type of the account. Accepting adds no team member to the count of the
-- members limit: the open invitation it turns into a member was counted when it was sent.
create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_email text;
  v_invitation public.organization_invitations;
  v_type public.organization_type;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid;
  if not found or v_profile.account_kind is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if v_profile.account_kind <> 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'workers_cannot_join_organizations';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'email_unconfirmed';
  end if;

  select * into v_invitation
  from public.organization_invitations i
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  for update;
  if not found or not private.invitation_is_open(v_invitation) or v_invitation.email <> v_email::extensions.citext then
    raise exception 'CHARA_INVITATION_INVALID';
  end if;
  v_type := private.org_type(v_invitation.organization_id);
  if v_type <> 'employer' and not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if v_type <> coalesce(v_profile.intended_organization_type, 'employer') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_type_mismatch';
  end if;
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = v_invitation.organization_id and m.user_id = v_uid
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'already_a_member';
  end if;

  insert into public.organization_members (organization_id, user_id, role, invited_by, accepted_at)
  values (v_invitation.organization_id, v_uid, v_invitation.role, v_invitation.invited_by, now());
  update public.organization_invitations set accepted_at = now() where id = v_invitation.id;

  perform audit.record(
    'invitation_accepted', 'organization_invitation', v_invitation.id::text,
    jsonb_build_object('organization_id', v_invitation.organization_id, 'role', v_invitation.role)
  );
  return v_invitation.organization_id;
end;
$$;

-- invitation_preview of 20261008100000 with the type of the inviting organisation, so the invitation and sign-up pages
-- offer the account of that type and sign-up stores it as intended_organization_type (FR-J1). An invitation to a
-- recruitment or staffing company is not shown while release 2a is off, as if it did not exist. The return type changes,
-- so the function is dropped and created again; its only caller is the web DAL.
drop function public.invitation_preview(text);

create function public.invitation_preview(p_token text)
returns table (
  organization_name text, role public.member_role, email text, expires_at timestamptz,
  organization_type public.organization_type
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.display_name, i.role, i.email::text, i.expires_at, o.type
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    and private.invitation_is_open(i)
    and (o.type = 'employer' or private.release_on('release_partner_directories'))
$$;

revoke all on function public.invitation_preview(text) from public, anon, authenticated, service_role;
grant execute on function public.invitation_preview(text) to anon, authenticated;

-- private.notification_payload of 20261210100000_data_export.sql with the organisation type in member_invitation, so
-- the email names the account that can accept (an employer account, or a recruitment or staffing company account).
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
    else '{}'::jsonb
  end);
end;
$$;
