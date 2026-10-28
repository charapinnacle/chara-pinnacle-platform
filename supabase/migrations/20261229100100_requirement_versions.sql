-- Versions of workforce requirements, change notices and closing notices to the partners involved (FR-M2 steps Edit and
-- Expire, outputs "change notifications" and "expiry reminders", control "versioned edits with notifications"; FR-O1 step
-- Track; FR-T1; decisions 3.2, 3.5; NFR-S8, NFR-S11, NFR-A3, NFR-O5; docs/phase-2/DATA_MODEL.md sections 6, 7 and 9;
-- release 2b). Every save of a published (open or paused) requirement that changes a field partners are shown writes one
-- row of public.requirement_versions (the fields changed in the order of the form, their old and new values, who and
-- when), and tells the partners whose invitation is still live (invited, viewed, accepted, responded) with
-- requirement_changed. Edits made within requirement_change_notice_minutes (15, settings editor) of a notice that is still
-- waiting become that one notice: its email leaves after the delay and names every field changed in between. When the
-- requirement closes or is filled the same partners get requirement_closed, and requirement_closing_soon now reaches them
-- too, requirement_closing_reminder_days before the closing date. The employer's members read every version
-- (list_requirement_versions); a partner reads only the versions written after it was invited and while its invitation
-- is live, without who made them (list_invitation_changes). Every notice and read is limited to release_job_orders.
-- The partners with a marketplace response are added to the recipients by V44, which creates the responses.

-- Settings (NFR-O5) -------------------------------------------------------------------------------------------------------

insert into private.settings (key, value) values ('requirement_change_notice_minutes', '15') on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('requirement_change_notice_minutes', 'integer', 0, 1440,
    'Minutes a change notice to partners waits, so further edits of a workforce requirement join it', null);

-- The fields partners are shown ------------------------------------------------------------------------------------------

-- The fields of a requirement that the partners with an invitation read (get_invitation), in the order of the form:
-- a change to any of them is versioned and announced. occupations and countries stand for requirement_occupations and
-- requirement_countries, as in the requirement.updated audit rows of save_requirement.
create function private.requirement_change_fields() returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['title', 'workers_needed', 'occupations', 'country_code', 'countries', 'city_region', 'industry_code',
    'skills', 'experience_years', 'start_date', 'duration_months', 'employment_type', 'salary_min', 'salary_max',
    'salary_currency', 'salary_period', 'accommodation', 'work_permit_support', 'visa_support', 'recruitment_preference',
    'partner_need', 'closes_on']
$$;

revoke all on function private.requirement_change_fields() from public, anon, authenticated, service_role;

-- The versions --------------------------------------------------------------------------------------------------------------

create table public.requirement_versions (
  requirement_id uuid not null references public.workforce_requirements (id) on delete cascade,
  version integer not null check (version >= 1),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  status public.requirement_status not null check (status in ('open', 'paused')),
  changed_fields text[] not null check (cardinality(changed_fields) >= 1 and changed_fields <@ private.requirement_change_fields()),
  old_values jsonb not null check (jsonb_typeof(old_values) = 'object'),
  new_values jsonb not null check (jsonb_typeof(new_values) = 'object'),
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (requirement_id, version)
);

comment on table public.requirement_versions is
  'One row per save of a published workforce requirement that changed a field partners are shown (FR-M2 step Edit): the fields in the order of the form with their old and new values. Append-only; written only by save_requirement; employer members read it, partners only through list_invitation_changes.';
comment on column public.requirement_versions.status is 'The status of the requirement when it was edited (open or paused).';
comment on column public.requirement_versions.old_values is
  'The changed fields before the edit: columns as stored, occupations as [{code, name, quantity}], countries as codes.';
comment on column public.requirement_versions.changed_by is
  'The employer member who saved the edit; cleared when the account is erased. Never shown to partners.';

create index requirement_versions_organization_idx on public.requirement_versions (organization_id);
create index requirement_versions_changed_by_idx on public.requirement_versions (changed_by) where changed_by is not null;

alter table public.requirement_versions enable row level security;
alter table public.requirement_versions force row level security;
revoke all on table public.requirement_versions from public, anon, authenticated, service_role;
grant select on public.requirement_versions to authenticated;

create policy requirement_versions_select_member on public.requirement_versions
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- Append-only: nothing of a version changes, except changed_by becoming null (the erasure of the member, on delete set
-- null). Deletes come only with the requirement (on delete cascade); no API role writes the table.
create function private.requirement_versions_append_only() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.requirement_id, new.version, new.organization_id, new.status, new.changed_fields, new.old_values,
      new.new_values, new.created_at)
     is distinct from (old.requirement_id, old.version, old.organization_id, old.status, old.changed_fields,
      old.old_values, old.new_values, old.created_at)
     or new.changed_by is not null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'append_only';
  end if;
  return new;
end;
$$;

revoke all on function private.requirement_versions_append_only() from public, anon, authenticated, service_role;

create trigger requirement_versions_append_only
  before update on public.requirement_versions
  for each row execute function private.requirement_versions_append_only();

alter table public.requirement_versions enable always trigger requirement_versions_append_only;

-- Notification kinds -----------------------------------------------------------------------------------------------------

-- Optional, email on by default, for recruitment and staffing companies; requirement_closing_soon now reaches them too.
insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types) values
  ('requirement_changed', false, true, 'company', 'Changes to workforce requirements you are invited to',
    array['recruitment_company', 'staffing_company']::public.organization_type[]),
  ('requirement_closed', false, true, 'company', 'Closed workforce requirements you are invited to',
    array['recruitment_company', 'staffing_company']::public.organization_type[]);

update private.notification_kinds
set organization_types = array['employer', 'recruitment_company', 'staffing_company']::public.organization_type[]
where kind = 'requirement_closing_soon';

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon', 'job_order_match', 'invitation_received',
  'invitation_withdrawn', 'requirement_changed', 'requirement_closed'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- Queueing to the partners -------------------------------------------------------------------------------------------------

-- The body of private.queue_invitation_event of 20261226100000_requirement_invitations.sql with the dedupe key given by
-- the caller, so a notice that repeats for a new fact (a new closing date) is not taken for a repeat. One message of
-- p_kind about the invitation p_invitation to each accepted owner and admin with an active account of the active invited
-- partner, none to a recipient who already has the key. Answers the number queued, in the caller's transaction (NFR-A3).
create function private.queue_invitation_message(p_invitation uuid, p_kind text, p_dedupe_key text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages jsonb[];
begin
  select array_agg(jsonb_build_object(
           'kind', p_kind, 'user_id', m.user_id, 'organization_id', i.organization_id, 'mandatory', k.mandatory,
           'dedupe_key', p_dedupe_key, 'requirement_invitation_id', i.id)
         order by m.user_id)
  into v_messages
  from public.requirement_invitations i
  join public.organizations o on o.id = i.organization_id and o.status = 'active'
  join public.organization_members m on m.organization_id = i.organization_id and m.role in ('owner', 'admin')
    and m.accepted_at is not null
  join public.profiles u on u.id = m.user_id and u.status = 'active'
  join private.notification_kinds k on k.kind = p_kind
  where i.id = p_invitation
    and not exists (
      select 1 from public.notifications n where n.user_id = m.user_id and n.kind = p_kind and n.dedupe_key = p_dedupe_key);

  if v_messages is null then
    return 0;
  end if;
  perform pgmq.send_batch('notifications', v_messages);
  return cardinality(v_messages);
end;
$$;

revoke all on function private.queue_invitation_message(uuid, text, text) from public, anon, authenticated, service_role;

-- private.queue_invitation_event of 20261226100000_requirement_invitations.sql, now through queue_invitation_message with
-- its key of one message per kind and invitation; what it queues is unchanged.
create or replace function private.queue_invitation_event(p_invitation uuid, p_kind text) returns integer
language sql
security definer
set search_path = ''
as $$
  select private.queue_invitation_message(p_invitation, p_kind, p_kind || ':' || p_invitation)
$$;

-- The change notice of version p_version of the requirement p_requirement (FR-M2 step Edit), while release 2b is on, to
-- the owners and admins with an active account of every active partner whose invitation is invited, viewed, accepted or
-- responded; nothing to declined, withdrawn or expired invitations, members, other partners or the employer. A recipient
-- who still has an unread notice of the same invitation that is waiting for its email (queued; or suppressed, when the
-- recipient turned the email off) and is younger than requirement_change_notice_minutes gets that notice widened to
-- this version instead of a new one, so a burst of edits is one notice naming every field. Any other recipient gets a new
-- message that the notify function sends only after that many minutes (pgmq delay); its in-app item shows at once.
-- Answers the number of new messages, in the caller's transaction (NFR-A3).
create function private.queue_requirement_change(p_requirement uuid, p_version integer) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window integer := 60 * coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,4}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'requirement_change_notice_minutes'), 15);
  v_messages jsonb[];
begin
  if not private.release_on('release_job_orders') then
    return 0;
  end if;

  with recipients as (
    select i.id as invitation_id, i.organization_id, m.user_id, k.mandatory
    from public.requirement_invitations i
    join public.organizations o on o.id = i.organization_id and o.status = 'active'
    join public.organization_members m on m.organization_id = i.organization_id and m.role in ('owner', 'admin')
      and m.accepted_at is not null
    join public.profiles u on u.id = m.user_id and u.status = 'active'
    join private.notification_kinds k on k.kind = 'requirement_changed'
    where i.requirement_id = p_requirement and i.status in ('invited', 'viewed', 'accepted', 'responded')
  ), widened as (
    update public.notifications n
    set payload = private.notification_payload('requirement_changed', jsonb_build_object(
      'organization_id', r.organization_id, 'requirement_invitation_id', r.invitation_id,
      'from_version', n.payload -> 'from_version', 'to_version', p_version))
    from recipients r
    where n.user_id = r.user_id and n.kind = 'requirement_changed' and n.payload ->> 'invitation_id' = r.invitation_id::text
      and n.read_at is null and n.status in ('queued', 'suppressed')
      and n.created_at > now() - make_interval(secs => v_window)
    returning n.user_id, n.payload ->> 'invitation_id' as invitation_id
  )
  select array_agg(jsonb_build_object(
           'kind', 'requirement_changed', 'user_id', r.user_id, 'organization_id', r.organization_id,
           'mandatory', r.mandatory, 'dedupe_key', 'requirement_changed:' || r.invitation_id || ':' || p_version,
           'requirement_invitation_id', r.invitation_id, 'from_version', p_version, 'to_version', p_version)
         order by r.user_id)
  into v_messages
  from recipients r
  where not exists (select 1 from widened w where w.user_id = r.user_id and w.invitation_id = r.invitation_id::text);

  if v_messages is null then
    return 0;
  end if;
  perform pgmq.send_batch('notifications', v_messages, v_window);
  return cardinality(v_messages);
end;
$$;

revoke all on function private.queue_requirement_change(uuid, integer) from public, anon, authenticated, service_role;

-- Writes the version of an edit of the requirement p_old (now p_new) by save_requirement and announces it: nothing for a
-- draft or when no field partners are shown changed (p_changed is the list of save_requirement). The fields keep the
-- order of requirement_change_fields; occupations are stored with their names, countries as codes. The caller holds the
-- requirement's row lock, so the version numbers never collide. Answers the version written, or null.
create function private.record_requirement_version(
  p_old public.workforce_requirements,
  p_new public.workforce_requirements,
  p_changed jsonb,
  p_old_occupations jsonb,
  p_new_occupations jsonb,
  p_old_countries text[],
  p_new_countries text[]
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[];
  v_before jsonb;
  v_after jsonb;
  v_version integer;
begin
  if p_old.status not in ('open', 'paused') then
    return null;
  end if;
  select array_agg(f.name order by f.position) into v_fields
  from unnest(private.requirement_change_fields()) with ordinality f(name, position)
  where p_changed ? f.name;
  if v_fields is null then
    return null;
  end if;

  v_before := to_jsonb(p_old) || jsonb_build_object('countries', to_jsonb(p_old_countries), 'occupations', (
    select coalesce(jsonb_agg(jsonb_build_object('code', oc.code, 'name', oc.label, 'quantity', (e ->> 'quantity')::integer)
      order by (e ->> 'quantity')::integer desc, oc.label), '[]')
    from jsonb_array_elements(p_old_occupations) e join public.occupations oc on oc.code = e ->> 'occupation_id'));
  v_after := to_jsonb(p_new) || jsonb_build_object('countries', to_jsonb(p_new_countries), 'occupations', (
    select coalesce(jsonb_agg(jsonb_build_object('code', oc.code, 'name', oc.label, 'quantity', (e ->> 'quantity')::integer)
      order by (e ->> 'quantity')::integer desc, oc.label), '[]')
    from jsonb_array_elements(p_new_occupations) e join public.occupations oc on oc.code = e ->> 'occupation_id'));

  select coalesce(max(v.version), 0) + 1 into v_version from public.requirement_versions v where v.requirement_id = p_new.id;
  insert into public.requirement_versions (
    requirement_id, version, organization_id, status, changed_fields, old_values, new_values, changed_by
  ) values (
    p_new.id, v_version, p_new.organization_id, p_old.status, v_fields,
    (select jsonb_object_agg(f, v_before -> f) from unnest(v_fields) f),
    (select jsonb_object_agg(f, v_after -> f) from unnest(v_fields) f),
    (select auth.uid())
  );
  perform private.queue_requirement_change(p_new.id, v_version);
  return v_version;
end;
$$;

revoke all on function private.record_requirement_version(
  public.workforce_requirements, public.workforce_requirements, jsonb, jsonb, jsonb, text[], text[]
) from public, anon, authenticated, service_role;

-- public.save_requirement of 20261217100000_requirement_limits.sql with one addition: after the requirement.updated audit
-- row, the edit of an open or paused requirement is versioned and announced to the partners involved
-- (private.record_requirement_version). Everything else is unchanged.
create or replace function public.save_requirement(
  p_org uuid,
  p_workers_needed integer,
  p_country_code text,
  p_city_region text,
  p_industry_code text,
  p_occupations jsonb,
  p_start_date date,
  p_employment_type public.employment_type,
  p_recruitment_preference public.recruitment_preference,
  p_partner_need public.partner_need,
  p_accommodation boolean,
  p_work_permit_support boolean,
  p_visa_support boolean,
  p_requirement uuid default null,
  p_title text default null,
  p_skills text default null,
  p_experience_years smallint default null,
  p_duration_months smallint default null,
  p_salary_min numeric default null,
  p_salary_max numeric default null,
  p_salary_currency text default null,
  p_salary_period public.salary_period default null,
  p_expected_updated_at timestamptz default null,
  p_additional_countries text[] default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_skills text := nullif(btrim(coalesce(p_skills, '')), '');
  v_city text := btrim(p_city_region);
  v_country text := upper(btrim(p_country_code));
  v_industry text := upper(btrim(p_industry_code));
  v_currency text := upper(nullif(btrim(coalesce(p_salary_currency, '')), ''));
  v_old public.workforce_requirements;
  v_new public.workforce_requirements;
  v_old_occupations jsonb := '[]'::jsonb;
  v_new_occupations jsonb;
  v_old_countries text[] := '{}'::text[];
  v_new_countries text[];
  v_additional text[];
  v_changed jsonb;
  v_criterion text;
  v_field text;
begin
  perform private.assert_requirement_manager(p_org);

  if p_requirement is not null then
    select * into v_old from public.workforce_requirements r
    where r.id = p_requirement and r.organization_id = p_org
    for update;
    if not found then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_old.status in ('closed', 'filled') then
      raise exception 'CHARA_INVALID_STATE' using detail = v_old.status::text;
    end if;
    if p_expected_updated_at is distinct from v_old.updated_at then
      raise exception 'CHARA_CONFLICT' using detail = 'stale';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('occupation_id', o.occupation_id, 'quantity', o.quantity)
             order by o.occupation_id), '[]')
    into v_old_occupations
    from public.requirement_occupations o where o.requirement_id = p_requirement;
    select coalesce(array_agg(c.country_code order by c.country_code), '{}') into v_old_countries
    from public.requirement_countries c where c.requirement_id = p_requirement;
  end if;

  if p_start_date is null
     or (p_start_date is distinct from v_old.start_date
         and (p_start_date < v_today or p_start_date > (v_today + interval '3 years')::date)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'start_date';
  end if;

  if p_occupations is null or jsonb_typeof(p_occupations) <> 'array'
     or jsonb_array_length(p_occupations) not between 1 and 10
     or exists (
       select 1 from jsonb_array_elements(p_occupations) e
       where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'occupation_id') <> 'string'
          or jsonb_typeof(e -> 'quantity') <> 'number' or (e ->> 'quantity') !~ '^\d{1,6}$'
     )
     or (select count(distinct btrim(e ->> 'occupation_id')) from jsonb_array_elements(p_occupations) e)
        <> jsonb_array_length(p_occupations) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupations';
  end if;
  select jsonb_agg(jsonb_build_object('occupation_id', btrim(e ->> 'occupation_id'), 'quantity', (e ->> 'quantity')::integer)
           order by btrim(e ->> 'occupation_id'))
  into v_new_occupations
  from jsonb_array_elements(p_occupations) e;

  if p_additional_countries is not null then
    if cardinality(p_additional_countries) > 9
       or exists (select 1 from unnest(p_additional_countries) c where c is null or btrim(c) !~ '^[A-Za-z]{2}$') then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'countries';
    end if;
    select coalesce(array_agg(distinct upper(btrim(c))), '{}') into v_additional
    from unnest(p_additional_countries) c
    where upper(btrim(c)) is distinct from v_country;
  end if;

  foreach v_field in array array['title', 'skills', 'city_region'] loop
    v_criterion := private.prohibited_criterion(case v_field
      when 'title' then case when v_title is distinct from v_old.title then v_title end
      when 'skills' then v_skills
      else v_city end);
    if v_criterion is not null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'prohibited_criterion:' || v_field;
    end if;
  end loop;

  perform private.count_audited_write(p_org);

  if p_requirement is null then
    insert into public.workforce_requirements (
      organization_id, title, workers_needed, country_code, city_region, industry_code, skills, experience_years,
      start_date, duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation,
      work_permit_support, visa_support, recruitment_preference, partner_need
    ) values (
      p_org, coalesce(v_title, '-'), p_workers_needed, v_country, v_city, v_industry, v_skills, p_experience_years,
      p_start_date, p_duration_months, p_employment_type, p_salary_min, p_salary_max, v_currency, p_salary_period,
      coalesce(p_accommodation, false), coalesce(p_work_permit_support, false), coalesce(p_visa_support, false),
      p_recruitment_preference, p_partner_need
    )
    returning * into v_new;
  else
    update public.workforce_requirements r
    set title = coalesce(v_title, '-'), workers_needed = p_workers_needed, country_code = v_country,
        city_region = v_city, industry_code = v_industry, skills = v_skills, experience_years = p_experience_years,
        start_date = p_start_date, duration_months = p_duration_months, employment_type = p_employment_type,
        salary_min = p_salary_min, salary_max = p_salary_max, salary_currency = v_currency,
        salary_period = p_salary_period, accommodation = coalesce(p_accommodation, false),
        work_permit_support = coalesce(p_work_permit_support, false), visa_support = coalesce(p_visa_support, false),
        recruitment_preference = p_recruitment_preference, partner_need = p_partner_need,
        closes_on = case when r.closes_on is not null then greatest(r.closes_on, p_start_date) end
    where r.id = p_requirement
    returning * into v_new;
    delete from public.requirement_occupations o where o.requirement_id = p_requirement;
    if v_additional is not null then
      delete from public.requirement_countries c
      where c.requirement_id = p_requirement and c.country_code <> all (v_additional || v_new.country_code);
    elsif v_old.country_code <> v_new.country_code then
      delete from public.requirement_countries c
      where c.requirement_id = p_requirement and c.country_code = v_old.country_code;
    end if;
  end if;

  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select v_new.id, e ->> 'occupation_id', (e ->> 'quantity')::integer
  from jsonb_array_elements(v_new_occupations) e;
  insert into public.requirement_countries (requirement_id, country_code) values (v_new.id, v_new.country_code)
  on conflict do nothing;
  if v_additional is not null then
    insert into public.requirement_countries (requirement_id, country_code)
    select v_new.id, c from unnest(v_additional) c order by c
    on conflict do nothing;
  end if;

  if (select sum((e ->> 'quantity')::integer) from jsonb_array_elements(v_new_occupations) e) <> v_new.workers_needed then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupation_quantities';
  end if;

  -- The title an employer left empty: the number of workers, the occupations by quantity and the place, cut to 120.
  if v_title is null then
    update public.workforce_requirements r
    set title = left(format('%s workers: %s, %s', v_new.workers_needed,
          (select string_agg(oc.label, ', ' order by o.quantity desc, oc.label)
           from public.requirement_occupations o join public.occupations oc on oc.code = o.occupation_id
           where o.requirement_id = v_new.id),
          v_new.city_region), 120)
    where r.id = v_new.id
    returning * into v_new;
  end if;

  if p_requirement is null then
    perform audit.record('requirement.created', 'requirement', v_new.id::text,
      jsonb_build_object('organization_id', p_org, 'partner_need', v_new.partner_need));
    return v_new.id;
  end if;

  select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
  from jsonb_each(to_jsonb(v_new) - 'updated_at') n
  where n.value is distinct from (to_jsonb(v_old) -> n.key);
  if v_new_occupations is distinct from v_old_occupations then
    v_changed := v_changed || '["occupations"]'::jsonb;
  end if;
  select coalesce(array_agg(c.country_code order by c.country_code), '{}') into v_new_countries
  from public.requirement_countries c where c.requirement_id = v_new.id;
  if v_new_countries is distinct from v_old_countries then
    v_changed := v_changed || '["countries"]'::jsonb;
  end if;
  if jsonb_array_length(v_changed) > 0 then
    update public.workforce_requirements r set updated_at = now() where r.id = v_new.id;
    perform audit.record('requirement.updated', 'requirement', v_new.id::text,
      jsonb_build_object('organization_id', p_org, 'changed_fields', v_changed, 'status', v_new.status));
    perform private.record_requirement_version(v_old, v_new, v_changed, v_old_occupations, v_new_occupations,
      v_old_countries, v_new_countries);
  end if;
  return v_new.id;
end;
$$;

-- private.notification_payload of 20261226100000_requirement_invitations.sql with requirement_changed and
-- requirement_closed added and a partner's branch in requirement_closing_soon. Every other branch is unchanged.
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
    when 'requirement_changed' then coalesce((
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
    when 'requirement_closed' then coalesce((
      select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name,
        'close_reason', r.close_reason, 'org_slug', v_slug)
      from public.requirement_invitations i
      join public.workforce_requirements r on r.id = i.requirement_id
      join public.organizations e on e.id = r.organization_id
      where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    else '{}'::jsonb
  end);
end;
$$;

-- Closing notices to the partners -------------------------------------------------------------------------------------------

-- private.remind_closing_requirements of 20261229100000_close_paused_requirements.sql with one addition (FR-M2 AC6, FR-T1
-- AC6): every partner whose invitation to the reminded requirement is invited, viewed, accepted or responded is told too,
-- its owners and admins with an active account, once per closing date (an extension reminds again); declined, withdrawn
-- and expired invitations get nothing. The employer's part is unchanged. Returns the number of requirements reminded.
create or replace function private.remind_closing_requirements() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_days integer := coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,4}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'requirement_closing_reminder_days'), 7);
  v_row record;
  v_invitation uuid;
  v_count integer := 0;
begin
  if not private.release_on('release_job_orders') then
    return 0;
  end if;
  for v_row in
    update public.workforce_requirements r
    set closing_reminder_for = r.closes_on
    where r.status in ('open', 'paused') and r.closes_on between v_today and v_today + v_days
      and r.closing_reminder_for is distinct from r.closes_on
      and exists (select 1 from public.organizations o where o.id = r.organization_id and o.status = 'active')
    returning r.id, r.organization_id, r.closes_on
  loop
    perform private.queue_org_event(v_row.organization_id, 'requirement_closing_soon',
      jsonb_build_object('requirement_id', v_row.id), 'requirement_closing_soon:' || v_row.id || ':' || v_row.closes_on);
    for v_invitation in
      select i.id from public.requirement_invitations i
      where i.requirement_id = v_row.id and i.status in ('invited', 'viewed', 'accepted', 'responded')
      order by i.id
    loop
      perform private.queue_invitation_message(v_invitation, 'requirement_closing_soon',
        'requirement_closing_soon:' || v_row.id || ':' || v_row.closes_on);
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- private.requirements_expire_invitations of 20261226100000_requirement_invitations.sql with one addition: the partners
-- whose invitation was still live when the requirement closed or was filled (invited, viewed, accepted, responded) get
-- requirement_closed with the reason, once per invitation, while release 2b is on; the expiry itself and its audit rows
-- are unchanged. Any close counts: the employer's, the daily one (open or paused past the date).
create or replace function private.requirements_expire_invitations() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv record;
  v_live uuid[];
begin
  select array_agg(i.id order by i.id) into v_live
  from public.requirement_invitations i
  where i.requirement_id = new.id and i.status in ('invited', 'viewed', 'accepted', 'responded');

  for v_inv in
    update public.requirement_invitations i set status = 'expired', expired_at = now()
    where i.requirement_id = new.id and i.status in ('invited', 'viewed', 'accepted')
    returning i.id, i.organization_id, i.employer_organization_id
  loop
    perform audit.record('requirement.invitation_expired', 'requirement_invitation', v_inv.id::text,
      jsonb_build_object('requirement_id', new.id, 'organization_id', v_inv.organization_id,
        'employer_organization_id', v_inv.employer_organization_id, 'requirement_status', new.status));
  end loop;

  if v_live is not null and private.release_on('release_job_orders') then
    perform private.queue_invitation_event(l.id, 'requirement_closed') from unnest(v_live) l(id);
  end if;
  return null;
end;
$$;

-- Reading the history -------------------------------------------------------------------------------------------------------

-- The versions of the requirement p_requirement of p_org, newest first (FR-M2 output "status history" for edits), for any
-- accepted member of the employer while release 2b is on (private.assert_invitation_employer); another organisation's
-- requirement or an unknown id is CHARA_NOT_FOUND. changed_by_name is the display name of the member who saved it (null
-- when the profile has none or was erased; changed_by_member says which).
create function public.list_requirement_versions(p_org uuid, p_requirement uuid)
returns table (
  version integer,
  created_at timestamptz,
  status public.requirement_status,
  changed_fields text[],
  old_values jsonb,
  new_values jsonb,
  changed_by_member boolean,
  changed_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_invitation_employer(p_org);
  if not exists (select 1 from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
  select v.version, v.created_at, v.status, v.changed_fields, v.old_values, v.new_values, v.changed_by is not null, p.display_name
  from public.requirement_versions v
  left join public.profiles p on p.id = v.changed_by
  where v.requirement_id = p_requirement and v.organization_id = p_org
  order by v.version desc;
end;
$$;

revoke all on function public.list_requirement_versions(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_requirement_versions(uuid, uuid) to authenticated;

-- The changes of the requirement of the invitation p_invitation of the partner p_org since the partner was invited,
-- newest first (FR-M2 step Edit: what changed after the partner started working on it), for any accepted member of the
-- active partner while release 2b is on (private.assert_invitation_partner). Only while the invitation is invited,
-- viewed, accepted or responded, when the partner reads the requirement in full (get_invitation); no row once it is
-- declined, withdrawn or expired, and never who made the change. Another partner's invitation or an unknown id is
-- CHARA_NOT_FOUND, so a competing partner learns nothing.
create function public.list_invitation_changes(p_org uuid, p_invitation uuid)
returns table (
  version integer,
  created_at timestamptz,
  changed_fields text[],
  old_values jsonb,
  new_values jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.requirement_invitations;
begin
  perform private.assert_invitation_partner(p_org);
  select * into v_inv from public.requirement_invitations i where i.id = p_invitation and i.organization_id = p_org;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_inv.status not in ('invited', 'viewed', 'accepted', 'responded') then
    return;
  end if;
  return query
  select v.version, v.created_at, v.changed_fields, v.old_values, v.new_values
  from public.requirement_versions v
  where v.requirement_id = v_inv.requirement_id and v.created_at >= v_inv.invited_at
  order by v.version desc;
end;
$$;

revoke all on function public.list_invitation_changes(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_invitation_changes(uuid, uuid) to authenticated;
