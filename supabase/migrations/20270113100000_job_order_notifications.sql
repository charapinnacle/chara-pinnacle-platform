-- Release 2b notification kinds (FR-T1 2b; docs/phase-2/DATA_MODEL.md section 9; NFR-A3). V33 and V40 to V50 built every
-- 2b kind with its producer, template, bell presenter and dedupe key; what they left open is that the preferences page and
-- set_notification_preferences offered those kinds while their release was still off, so a partner, an employer or a
-- worker saw switches (and, for a worker, "Always sent" submission requests) for a release that does not exist yet.
--
-- release_key: the release switch of private.settings a kind belongs to, null for a kind that only needs the
-- notifications release (release_partner_directories, checked by private.require_notifications_release). While the switch
-- is off, notification_kind_catalogue() leaves the kind out and set_notification_preferences refuses it like a kind of
-- another audience (CHARA_INVALID_INPUT p_kinds). A choice saved while the release was on stays stored when it goes off
-- again and applies once it is back. The producers already queue nothing while their release is off, so the enqueue
-- trigger is unchanged.
alter table private.notification_kinds
  add column release_key text references private.settings (key) check (release_key like 'release\_%');

update private.notification_kinds set release_key = 'release_job_orders'
where kind in (
  'requirement_closing_soon', 'job_order_match', 'invitation_received', 'invitation_withdrawn', 'requirement_changed',
  'requirement_closed', 'response_received', 'response_withdrawn', 'response_decided'
);

update private.notification_kinds set release_key = 'release_candidate_submissions'
where kind in (
  'submission_request', 'submission_request_signup', 'submission_approved', 'submission_withdrawn', 'submission_stage_changed'
);

-- The function of 20261126100000_partner_review_emails.sql with one change: a kind whose release is off is left out.
create or replace function public.notification_kind_catalogue() returns table (
  kind text,
  mandatory boolean,
  default_email boolean,
  audience text,
  label text,
  email_enabled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_notifications_release();
  v_kind text := private.account_kind()::text;
  v_types public.organization_type[] := private.user_organization_types(v_uid);
  v_choices jsonb := coalesce((select p.email_kinds from public.notification_preferences p where p.user_id = v_uid), '{}');
begin
  return query
  select k.kind, k.mandatory, k.default_email, k.audience, k.label,
         k.mandatory or coalesce(case when jsonb_typeof(v_choices -> k.kind) = 'boolean' then (v_choices ->> k.kind)::boolean end, k.default_email)
  from private.notification_kinds k
  where (k.audience = 'all' or k.audience = v_kind) and (k.organization_types is null or k.organization_types && v_types)
    and (k.release_key is null or private.release_on(k.release_key))
  order by k.mandatory, k.label;
end;
$$;
revoke all on function public.notification_kind_catalogue() from public, anon, authenticated, service_role;
grant execute on function public.notification_kind_catalogue() to authenticated;

-- The function of 20261126100000_partner_review_emails.sql with one change: a kind whose release is off is refused like a
-- kind of another audience.
create or replace function public.set_notification_preferences(p_kinds jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_notifications_release();
  v_account text := private.account_kind()::text;
  v_types public.organization_type[] := private.user_organization_types(v_uid);
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb;
begin
  if v_account is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind_required';
  end if;
  if p_kinds is null or jsonb_typeof(p_kinds) <> 'object' or p_kinds = '{}'::jsonb then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_kinds';
  end if;
  if exists (
    select 1 from jsonb_each(p_kinds) e join private.notification_kinds k on k.kind = e.key where k.mandatory
  ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'mandatory_kind';
  end if;
  if exists (
    select 1 from jsonb_each(p_kinds) e
    left join private.notification_kinds k on k.kind = e.key and k.audience in ('all', v_account)
      and (k.organization_types is null or k.organization_types && v_types)
      and (k.release_key is null or private.release_on(k.release_key))
    where k.kind is null or jsonb_typeof(e.value) <> 'boolean'
  ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_kinds';
  end if;

  -- The row exists before it is locked, so two first saves at once queue on the lock instead of one failing.
  insert into public.notification_preferences (user_id) values (v_uid) on conflict (user_id) do nothing;
  select p.email_kinds into v_old from public.notification_preferences p where p.user_id = v_uid for update;
  select jsonb_object_agg(e.key, jsonb_build_object(
           'from', coalesce(case when jsonb_typeof(v_old -> e.key) = 'boolean' then v_old -> e.key end, to_jsonb(k.default_email)),
           'to', e.value))
  into v_changes
  from jsonb_each(p_kinds) e
  join private.notification_kinds k on k.kind = e.key
  where coalesce(case when jsonb_typeof(v_old -> e.key) = 'boolean' then v_old -> e.key end, to_jsonb(k.default_email)) <> e.value;

  v_new := v_old || p_kinds;
  if v_new = v_old then
    return;
  end if;
  update public.notification_preferences set email_kinds = v_new where user_id = v_uid;
  if v_changes is not null then
    perform audit.record(
      'notification_preferences.changed', 'notification_preferences', v_uid::text, jsonb_build_object('kinds', v_changes)
    );
  end if;
end;
$$;
revoke all on function public.set_notification_preferences(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_notification_preferences(jsonb) to authenticated;
