-- Application notifications (FR-D6; OPEN_QUESTIONS.md D63). The producers (apply_to_job, set_application_status,
-- bulk_set_application_status, withdraw_application) and the queue of FR-I2 already create the individual emails. This
-- migration adds what the SOP still asks for: the payload of the two application emails (the organisation's display name
-- instead of the vacancy id), the daily summary of the employer members who chose it, and the member's own switch.
--
-- A held application_received (digest member, no message) is the item of the summary: the summary job turns all of a
-- member's held rows into one message and marks them summarised, so each application is summarised once.

-- Added not valid and validated after, so the check of the existing rows does not hold the table locked.
alter table public.notifications drop constraint notifications_status_check;
alter table public.notifications add constraint notifications_status_check
  check (status in ('queued', 'sent', 'failed', 'suppressed', 'summarised')) not valid;
alter table public.notifications validate constraint notifications_status_check;

create index notifications_held_idx on public.notifications (user_id) where status = 'queued' and msg_id is null;

-- The time of the daily summary and the length of its list are owner points (OPEN_QUESTIONS.md P15): the hour in the
-- time zone, and the number of vacancies listed.
insert into private.settings (key, value) values
  ('daily_summary_hour', '8'),
  ('daily_summary_timezone', '"Europe/Berlin"'),
  ('daily_summary_max_vacancies', '20');

-- The function of 20261030100000 with these changes: application_received and status_changed carry the organisation's
-- display name and no vacancy id, and an application_received that holds a list of vacancies is the daily summary
-- (total, and per vacancy the title, the organisation and the count). Everything is looked up from ids.
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
    select o.slug into v_slug from public.organizations o where o.id = (p_message ->> 'organization_id')::uuid;
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
    else '{}'::jsonb
  end);
end;
$$;

-- The function of 20261030100000 with one change: the summary message is never held for the next summary.
create or replace function private.notification_enqueued() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := new.message ->> 'kind';
  v_user uuid := nullif(new.message ->> 'user_id', '')::uuid;
  v_digest boolean := v_kind = 'application_received' and not (new.message ? 'vacancies')
    and coalesce((select p.digest from public.notification_preferences p where p.user_id = v_user), false);
begin
  insert into public.notifications (user_id, kind, payload, msg_id)
  values (v_user, v_kind, private.notification_payload(v_kind, new.message), case when v_digest then null else new.msg_id end);
  if v_digest then
    perform pgmq.delete('notifications', new.msg_id);
  end if;
  return null;
end;
$$;

-- Turns the held applications of every member into one summary message each. It acts only when the hour in the time
-- zone of the settings is the hour of the settings (8 in Europe/Berlin: the job runs at every full UTC hour, so that is
-- 06:00 UTC in summer time and 07:00 in winter time, on the days the clocks change as well), and a second call in the
-- same hour finds nothing held. Held applications of an organisation the member has left are marked and not sent. The
-- summary lists the daily_summary_max_vacancies vacancies with the most applications; the total counts all of them.
-- Answers the number of summaries queued. p_now exists for the tests.
--   CHARA_SETTING_MISSING (detail daily_summary)
create function private.enqueue_daily_summaries(p_now timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hour integer;
  v_zone text;
  v_max integer;
  v_queued integer;
begin
  select
    max(s.value #>> '{}') filter (where s.key = 'daily_summary_hour')::integer,
    max(s.value #>> '{}') filter (where s.key = 'daily_summary_timezone'),
    max(s.value #>> '{}') filter (where s.key = 'daily_summary_max_vacancies')::integer
  into v_hour, v_zone, v_max
  from private.settings s
  where s.key in ('daily_summary_hour', 'daily_summary_timezone', 'daily_summary_max_vacancies');
  if v_hour is null or v_zone is null or v_max is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'daily_summary';
  end if;
  if extract(hour from (p_now at time zone v_zone)) <> v_hour then
    return 0;
  end if;

  with taken as (
    update public.notifications n set status = 'summarised'
    where n.id in (
      select h.id from public.notifications h
      where h.status = 'queued' and h.msg_id is null and h.kind = 'application_received'
      for update skip locked
    )
    returning n.user_id, (n.payload ->> 'application_id')::uuid as application_id
  ), per_vacancy as (
    select t.user_id, a.job_id, count(*)::integer as applications
    from taken t
    join public.job_applications a on a.id = t.application_id
    join public.organization_members m
      on m.organization_id = a.organization_id and m.user_id = t.user_id and m.accepted_at is not null
    group by t.user_id, a.job_id
  ), ranked as (
    select p.*, row_number() over (partition by p.user_id order by p.applications desc, p.job_id) as position
    from per_vacancy p
  )
  select count(*) into v_queued from (
    select pgmq.send('notifications', jsonb_build_object(
      'kind', 'application_received', 'user_id', r.user_id, 'mandatory', false,
      'total', sum(r.applications),
      'vacancies', jsonb_agg(jsonb_build_object('job_id', r.job_id, 'count', r.applications) order by r.position)
        filter (where r.position <= v_max)
    ))
    from ranked r group by r.user_id
  ) sent;
  return v_queued;
end;
$$;

revoke all on function private.enqueue_daily_summaries(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('notify-daily-summary', '0 * * * *', 'select private.enqueue_daily_summaries()');

-- The employer member's own choice for application_received: immediately (false) or in the daily summary (true).
-- Candidates have no choice, their status emails are mandatory. A save that changes nothing writes nothing, and a user
-- without a row who keeps the default gets no row.
--   CHARA_FORBIDDEN (detail company_account_required), CHARA_INVALID_INPUT (detail p_digest)
create function public.set_notification_preferences(p_digest boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old boolean;
begin
  if v_uid is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  if p_digest is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_digest';
  end if;

  select p.digest into v_old from public.notification_preferences p where p.user_id = v_uid for update;
  v_old := coalesce(v_old, false);
  if v_old = p_digest then
    return;
  end if;
  insert into public.notification_preferences (user_id, digest) values (v_uid, p_digest)
  on conflict (user_id) do update set digest = excluded.digest;
  perform audit.record(
    'notification_preferences.changed', 'notification_preferences', v_uid::text,
    jsonb_build_object(
      'from', case when v_old then 'daily_summary' else 'immediate' end,
      'to', case when p_digest then 'daily_summary' else 'immediate' end
    )
  );
end;
$$;

revoke all on function public.set_notification_preferences(boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_notification_preferences(boolean) to authenticated;
