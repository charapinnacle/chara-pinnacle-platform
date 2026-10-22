-- In-app notifications and per-kind email preferences (FR-T1 base; docs/phase-2/DATA_MODEL.md sections 4 and 9). Every
-- notifications row is now also an item of the recipient's in-app list: read_at marks it read, mandatory says whether a
-- preference may stop its email, email_status says why an item was not emailed, and dedupe_key lets a scheduled job queue
-- an event at most once per recipient. The kinds live in one catalogue, private.notification_kinds; it holds the Phase 1
-- kinds now, and each Phase 2 unit adds its kinds to the catalogue, the kind check and the email templates together.
--
-- The new screens and RPCs belong to release 2a and answer only while the setting release_partner_directories is true.
-- The queue, the enqueue trigger and the delivery path keep working whatever the setting.

insert into private.settings (key, value) values ('release_partner_directories', 'false') on conflict (key) do nothing;

create function private.release_on(p_key text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::boolean from private.settings s where s.key = p_key), false)
$$;

revoke all on function private.release_on(text) from public, anon, authenticated, service_role;

-- The release switches are not secret: the pages show or hide the release from them.
create or replace function public.get_public_settings() returns table (key text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.value #>> '{}'
  from private.settings s
  where s.key = any (array[
    'legal_entity_name', 'legal_entity_address', 'legal_entity_registration_number', 'legal_entity_vat_id',
    'legal_entity_email', 'privacy_contact', 'data_protection_contact', 'release_partner_directories'
  ])
$$;

-- audience: who can receive the kind (worker, company, all signed-in users, or staff through the privacy contact).
-- default_email: whether an optional kind is emailed while the recipient has not chosen; a mandatory kind is always
-- emailed, so it cannot default to off.
create table private.notification_kinds (
  kind text primary key check (kind ~ '^[a-z][a-z_]{1,62}$'),
  mandatory boolean not null,
  default_email boolean not null default true,
  audience text not null check (audience in ('worker', 'company', 'all', 'staff')),
  label text not null check (length(label) between 1 and 80),
  check (default_email or not mandatory)
);

alter table private.notification_kinds enable row level security;
alter table private.notification_kinds force row level security;
revoke all on table private.notification_kinds from public, anon, authenticated, service_role;

-- Phase 1 has one optional kind, application_received (the daily summary is its preference); every other kind is
-- mandatory (ARCHITECTURE.md section 4, email catalogue).
insert into private.notification_kinds (kind, mandatory, default_email, audience, label) values
  ('application_received', false, true, 'company', 'New applications'),
  ('status_changed', true, true, 'worker', 'Application updates'),
  ('vacancy_hidden', true, true, 'company', 'Vacancy hidden by moderation'),
  ('trial_ending', true, true, 'company', 'Trial ending'),
  ('payment_failed', true, true, 'company', 'Failed payments'),
  ('legal_version', true, true, 'all', 'New versions of legal documents'),
  ('mfa_reset', true, true, 'all', 'Two-step verification reset'),
  ('deletion_requested', true, true, 'worker', 'Account deletion requested'),
  ('deletion_completed', true, true, 'worker', 'Account deletion completed'),
  ('erasure_paused', true, true, 'staff', 'Erasure paused by a legal hold'),
  ('member_invitation', true, true, 'company', 'Team invitations'),
  ('account_suspended', true, true, 'all', 'Account suspended'),
  ('account_reinstated', true, true, 'all', 'Account reinstated'),
  ('account_exists', true, true, 'all', 'Sign-up with your email address');

alter table public.notifications
  add column read_at timestamptz,
  add column email_status text check (email_status in ('suppressed_by_preference', 'suppressed_undeliverable')),
  add column mandatory boolean not null default true,
  add column dedupe_key text check (length(dedupe_key) between 1 and 200);

comment on column public.notifications.email_status is
  'Why the item was not emailed: the recipient turned the optional kind off, or the address is undeliverable; null otherwise.';
comment on column public.notifications.dedupe_key is
  'Set by a producer that may run more than once for the same event; a second message with the key is dropped.';

update public.notifications set mandatory = false where kind = 'application_received';
-- The rows written before the list existed were never shown in the app, so they do not count as unread.
update public.notifications set read_at = created_at;

-- nulls not distinct: a key also de-duplicates the rows without a user (an email to an address).
create unique index notifications_dedupe_idx on public.notifications (user_id, kind, dedupe_key) nulls not distinct
  where dedupe_key is not null;
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

grant select (read_at, email_status, mandatory) on public.notifications to authenticated;

alter table public.notification_preferences
  add column email_kinds jsonb not null default '{}' check (jsonb_typeof(email_kinds) = 'object');

comment on column public.notification_preferences.email_kinds is
  'The recipient''s email choice per optional kind, {kind: boolean}; a kind that is missing follows its default_email.';

grant select (email_kinds) on public.notification_preferences to authenticated;

-- The enqueue trigger of 20261031100000 with these changes: mandatory comes from the catalogue; an optional kind the
-- recipient turned off keeps its in-app row, recorded suppressed with email_status suppressed_by_preference, and loses
-- its message; a message whose dedupe_key the recipient already has for the kind writes nothing and is dropped. The
-- daily summary still holds application_received for those who chose it, as long as its email is on.
create or replace function private.notification_enqueued() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := new.message ->> 'kind';
  v_user uuid := nullif(new.message ->> 'user_id', '')::uuid;
  v_dedupe text := nullif(new.message ->> 'dedupe_key', '');
  v_mandatory boolean;
  v_default boolean;
  v_choice jsonb;
  v_digest boolean;
  v_email boolean;
  v_id uuid;
begin
  select k.mandatory, k.default_email into v_mandatory, v_default from private.notification_kinds k where k.kind = v_kind;
  select p.email_kinds -> v_kind, p.digest into v_choice, v_digest from public.notification_preferences p where p.user_id = v_user;
  v_mandatory := coalesce(v_mandatory, true);
  v_email := v_mandatory or v_user is null
    or coalesce(case when jsonb_typeof(v_choice) = 'boolean' then v_choice::text::boolean end, v_default, true);
  v_digest := v_email and v_kind = 'application_received' and not (new.message ? 'vacancies') and coalesce(v_digest, false);

  insert into public.notifications (user_id, kind, payload, msg_id, mandatory, status, email_status, dedupe_key)
  values (
    v_user, v_kind, private.notification_payload(v_kind, new.message),
    case when v_email and not v_digest then new.msg_id end,
    v_mandatory,
    case when v_email then 'queued' else 'suppressed' end,
    case when not v_email then 'suppressed_by_preference' end,
    v_dedupe
  )
  on conflict (user_id, kind, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  if v_id is null or not v_email or v_digest then
    perform pgmq.delete('notifications', new.msg_id);
  end if;
  return null;
end;
$$;

-- The function of 20261030100000 with one change: a message to an undeliverable address records email_status
-- suppressed_undeliverable next to the status suppressed, so the in-app item says why no email came.
create or replace function public.notify_dequeue(p_limit integer default 25) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vt integer;
  v_max integer;
  v_delays text;
  v_threshold integer;
  v_msg pgmq.message_record;
  v_row public.notifications;
  v_to text;
  v_out jsonb := '[]'::jsonb;
  v_closed jsonb := '[]'::jsonb;
begin
  select
    max(s.value #>> '{}') filter (where s.key = 'notify_visibility_seconds')::integer,
    max(s.value #>> '{}') filter (where s.key = 'notify_max_reads')::integer,
    max(s.value #>> '{}') filter (where s.key = 'notify_retry_delays_seconds'),
    max(s.value #>> '{}') filter (where s.key = 'notify_backlog_threshold')::integer
  into v_vt, v_max, v_delays, v_threshold
  from private.settings s
  where s.key in ('notify_visibility_seconds', 'notify_max_reads', 'notify_retry_delays_seconds', 'notify_backlog_threshold');
  if v_vt is null or v_max is null or v_delays is null or v_threshold is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'notify';
  end if;

  for v_msg in select * from pgmq.read('notifications', v_vt, least(greatest(coalesce(p_limit, 25), 1), 100)) loop
    select * into v_row from public.notifications n where n.msg_id = v_msg.msg_id for update;
    if not found then
      perform pgmq.delete('notifications', v_msg.msg_id);
      continue;
    end if;
    if v_row.status <> 'queued' then
      perform private.close_notification_message(v_msg.msg_id);
      continue;
    end if;

    v_to := v_msg.message ->> 'email';
    if v_to is null then
      select u.email into v_to from auth.users u where u.id = v_row.user_id;
      if exists (
        select 1 from public.notification_preferences p where p.user_id = v_row.user_id and p.email_undeliverable_at is not null
      ) then
        update public.notifications set status = 'suppressed', email_status = 'suppressed_undeliverable' where id = v_row.id;
        perform private.close_notification_message(v_msg.msg_id);
        continue;
      end if;
    end if;

    if v_msg.read_ct > v_max or v_to is null then
      update public.notifications
      set status = 'failed', last_error = case when v_to is null then 'no_recipient' else 'abandoned' end
      where id = v_row.id;
      perform private.close_notification_message(v_msg.msg_id);
      v_closed := v_closed || jsonb_build_object(
        'notification_id', v_row.id, 'kind', v_row.kind, 'error', case when v_to is null then 'no_recipient' else 'abandoned' end
      );
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'notification_id', v_row.id, 'kind', v_row.kind, 'payload', v_row.payload, 'recipient', v_to, 'attempt', v_msg.read_ct
    );
  end loop;

  return jsonb_build_object(
    'queue_depth', (select count(*) from pgmq.q_notifications q where q.vt <= clock_timestamp()),
    'backlog_threshold', v_threshold,
    'retry_delays', to_jsonb(string_to_array(v_delays, ',')::integer[]),
    'messages', v_out,
    'failed_closed', v_closed
  );
end;
$$;

-- What the in-app list holds for a user: every own row except the notice of a paused erasure (which the policy hides
-- too) and the daily summary, whose applications are already items of their own.
create function private.unread_notifications(p_user uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.notifications n
  where n.user_id = p_user and n.read_at is null
    and n.kind <> 'erasure_paused' and not (n.kind = 'application_received' and n.payload ? 'vacancies')
$$;

revoke all on function private.unread_notifications(uuid) from public, anon, authenticated, service_role;

create function private.require_notifications_release() returns uuid
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
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  return v_uid;
end;
$$;

revoke all on function private.require_notifications_release() from public, anon, authenticated, service_role;

-- The caller's in-app list, newest first, in keyset pages.
--   p_cursor  the next_cursor of the last row of the previous page
--   p_limit   1 to 50, 20 when missing
--   CHARA_FORBIDDEN (no session: 42501; detail release_off), CHARA_INVALID_INPUT (detail p_cursor)
create function public.list_my_notifications(p_cursor text default null, p_limit integer default null) returns table (
  id uuid,
  kind text,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz,
  next_cursor text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_notifications_release();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_cursor_created timestamptz;
  v_cursor_id uuid;
begin
  if p_cursor is not null then
    begin
      if p_cursor !~ '^[0-9T:.Z-]+\|[0-9a-f-]{36}$' then
        raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
      end if;
      v_cursor_created := split_part(p_cursor, '|', 1)::timestamptz;
      v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end;
  end if;

  return query
  with page as (
    select n.id, n.kind, n.payload, n.read_at, n.created_at,
           row_number() over (order by n.created_at desc, n.id desc) as position
    from public.notifications n
    where n.user_id = v_uid
      and n.kind <> 'erasure_paused' and not (n.kind = 'application_received' and n.payload ? 'vacancies')
      and (v_cursor_id is null or (n.created_at, n.id) < (v_cursor_created, v_cursor_id))
    order by n.created_at desc, n.id desc
    limit v_limit + 1
  )
  select
    p.id, p.kind, p.payload, p.read_at, p.created_at,
    case
      when p.position = v_limit and exists (select 1 from page x where x.position > v_limit)
        then to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p.id
    end
  from page p
  where p.position <= v_limit
  order by p.position;
end;
$$;

revoke all on function public.list_my_notifications(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_my_notifications(text, integer) to authenticated;

--   CHARA_FORBIDDEN (no session: 42501; detail release_off)
create function public.unread_notification_count() returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.unread_notifications(private.require_notifications_release());
end;
$$;

revoke all on function public.unread_notification_count() from public, anon, authenticated, service_role;
grant execute on function public.unread_notification_count() to authenticated;

-- Marks the given items of the caller's list read, or all of them when p_ids is null, and answers how many changed. An id that
-- is not the caller's, or already read, changes nothing and is not reported, so the answer never tells whether an id
-- exists. read_at is the only column this changes.
--   CHARA_FORBIDDEN (no session: 42501; detail release_off), CHARA_INVALID_INPUT (detail p_ids: more than 100)
create function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_notifications_release();
  v_changed integer;
begin
  if cardinality(p_ids) > 100 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_ids';
  end if;
  update public.notifications n set read_at = now()
  where n.user_id = v_uid and n.read_at is null and (p_ids is null or n.id = any (p_ids))
    and n.kind <> 'erasure_paused' and not (n.kind = 'application_received' and n.payload ? 'vacancies');
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- The kinds the caller can receive (their account kind's and those of every user), with whether each is emailed to
-- them now: always for a mandatory kind, otherwise their choice or the kind's default.
--   CHARA_FORBIDDEN (no session: 42501; detail release_off)
create function public.notification_kind_catalogue() returns table (
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
  v_choices jsonb := coalesce((select p.email_kinds from public.notification_preferences p where p.user_id = v_uid), '{}');
begin
  return query
  select k.kind, k.mandatory, k.default_email, k.audience, k.label,
         k.mandatory or coalesce(case when jsonb_typeof(v_choices -> k.kind) = 'boolean' then (v_choices ->> k.kind)::boolean end, k.default_email)
  from private.notification_kinds k
  where k.audience = 'all' or k.audience = v_kind
  order by k.mandatory, k.label;
end;
$$;

revoke all on function public.notification_kind_catalogue() from public, anon, authenticated, service_role;
grant execute on function public.notification_kind_catalogue() to authenticated;

-- The caller's email choice per optional kind, {kind: boolean}, merged into what is stored; kinds left out keep their
-- choice. Only workers and company users choose, and only kinds of their audience. A mandatory kind is refused whatever
-- the value. A save that changes no choice is not audited; a change is audited with each kind's old and new value. The
-- digest choice of employer users stays with set_notification_preferences(p_digest).
--   CHARA_FORBIDDEN (no session: 42501; detail release_off, account_kind_required)
--   CHARA_INVALID_INPUT (detail p_kinds: not an object, empty, an unknown kind or one of another audience, or a value that
--   is not a boolean; detail mandatory_kind)
create function public.set_notification_preferences(p_kinds jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_notifications_release();
  v_account text := private.account_kind()::text;
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
