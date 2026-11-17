-- Worker visibility in Find Workers (FR-Q1 AC1 to AC8; SOP P2-30 steps Offer, Opt in, Choose, Search, Withdraw, Remind;
-- decisions 4.2, 4.4; NFR-C4, NFR-S8, NFR-S9, NFR-A3, NFR-O5; DATA_MODEL.md sections 4, 6 and 9; V68, release 2c). A
-- worker opts in to the Find Workers card through set_worker_visibility with the current version of the legal document
-- worker-visibility-consent (the consent's purpose is the document's slug, as for every consent, so the FR-Q1 text's
-- "worker-visibility" is this slug); the consent row and worker_profiles.searchable change in one transaction, and a
-- withdrawal hides the card at the next read (NFR-C4: within one minute). The card is pseudonymous: public.worker_search
-- names it by card_id, a random identifier that is not the user id, and never carries the name, contact details, a photo
-- or a document (NFR-S9); training, employment history (never the employer's name) and the preferences appear only when
-- the worker allows them. The view is granted to no API role: search_workers (V69) is the only path for organisations.
-- Every function here answers CHARA_FORBIDDEN release_off while release_find_workers is off.

-- Settings (NFR-O5) ------------------------------------------------------------------------------------------------------

insert into private.settings (key, value) values
  ('visibility_confirmation_days', '365'),
  ('visibility_confirmation_grace_days', '30');

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('visibility_confirmation_days', 'integer', 30, 1095, 'Days before a visible worker is asked to confirm Find Workers', null),
  ('visibility_confirmation_grace_days', 'integer', 7, 90, 'Days a worker has to confirm Find Workers before the card is hidden', null);

-- The card columns of the passport --------------------------------------------------------------------------------------

-- Phase 1 kept searchable false by a check; from now on set_worker_visibility, the yearly confirmation and erase_user
-- change it, and the API roles still have no update grant on it (nor on the card columns, which set_card_sections
-- writes). visibility_reminded_at is the time the yearly reminder was sent for the current grant (null while none is
-- waiting for an answer); it is no card field.
alter table public.worker_profiles drop constraint worker_profiles_searchable_check;
alter table public.worker_profiles
  add column card_id uuid not null unique default gen_random_uuid(),
  add column card_show_training boolean not null default false,
  add column card_show_employment_history boolean not null default false,
  add column card_show_industries boolean not null default false,
  add column visibility_reminded_at timestamptz,
  add column updated_at timestamptz not null default now();

comment on table public.worker_profiles is
  'The candidate passport. Created only by create_worker_passport; searchable is changed only by set_worker_visibility, the yearly confirmation and erase_user (FR-Q1).';
comment on column public.worker_profiles.card_id is
  'The pseudonymous identifier of the Find Workers card: random, never derived from the user id, never in a profile snapshot.';
comment on column public.worker_profiles.updated_at is
  'The last change of a field the Find Workers card shows, in the profile or one of its lists.';

create index worker_profiles_searchable_idx on public.worker_profiles (user_id) where searchable;

-- A change of a card field stamps updated_at; a change of the name, of searchable or of the reminder does not, because
-- the card does not show them.
create function private.worker_profiles_touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.worker_profiles_touch_updated_at() from public, anon, authenticated, service_role;

create trigger worker_profiles_touch_updated_at
  before update of headline, current_country, occupation_id, years_experience, availability, available_from,
    card_show_training, card_show_employment_history, card_show_industries
  on public.worker_profiles
  for each row execute function private.worker_profiles_touch_updated_at();

alter table public.worker_profiles enable always trigger worker_profiles_touch_updated_at;

-- A change of one of the passport's lists stamps the profile too. Definer rights: the owner has no update grant on
-- updated_at. When the profile itself is being deleted the update finds no row.
create function private.worker_list_touch_profile() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.worker_profiles p set updated_at = now()
  where p.user_id = case when tg_op = 'DELETE' then old.worker_user_id else new.worker_user_id end;
  return null;
end;
$$;

revoke all on function private.worker_list_touch_profile() from public, anon, authenticated, service_role;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'worker_skills', 'worker_languages', 'worker_preferred_countries', 'worker_work_authorizations', 'worker_training',
    'worker_employment_history', 'worker_preferred_industries', 'worker_preferred_employment_types'
  ] loop
    execute format(
      'create trigger %1$s_touch_profile after insert or update or delete on public.%1$I '
      'for each row execute function private.worker_list_touch_profile()', v_table);
    execute format('alter table public.%1$I enable always trigger %1$s_touch_profile', v_table);
  end loop;
end;
$$;

-- The cards ---------------------------------------------------------------------------------------------------------------

-- Every passport's card as companies would see it, whether or not it is listed: what my_card_preview shows the worker and
-- what public.worker_search lists. listed is the one rule of visibility: opted in, the account active and no deletion
-- requested (FR-Q1 AC7; an erased worker has no passport). The optional sections are null unless the worker allows them
-- (AC5); an allowed empty section is an empty list. Employment history never carries the employer's name; work
-- authorisations count while they have not expired.
create view private.worker_cards with (security_invoker = true) as
select
  w.user_id,
  w.searchable and pr.status = 'active' and pr.deleted_at is null as listed,
  w.card_id,
  w.headline,
  w.occupation_id,
  coalesce(
    (select array_agg(s.skill order by lower(s.skill)) from public.worker_skills s where s.worker_user_id = w.user_id),
    '{}') as skills,
  w.years_experience,
  coalesce(
    (select jsonb_agg(jsonb_build_object('code', l.language_code, 'level', l.cefr_level) order by l.language_code)
     from public.worker_languages l where l.worker_user_id = w.user_id),
    '[]') as languages,
  w.availability,
  w.available_from,
  w.current_country,
  coalesce(
    (select array_agg(c.country_code order by c.country_code)
     from public.worker_preferred_countries c where c.worker_user_id = w.user_id),
    '{}') as preferred_countries,
  coalesce(
    (select array_agg(a.country_code order by a.country_code)
     from public.worker_work_authorizations a
     where a.worker_user_id = w.user_id and (a.expires_on is null or a.expires_on >= (now() at time zone 'utc')::date)),
    '{}') as work_authorization_countries,
  case when w.card_show_training then coalesce(
    (select jsonb_agg(jsonb_build_object('course', t.course, 'provider', t.provider, 'year_completed', t.year_completed)
       order by t.year_completed desc, t.course)
     from public.worker_training t where t.worker_user_id = w.user_id),
    '[]') end as training,
  case when w.card_show_employment_history then coalesce(
    (select jsonb_agg(jsonb_build_object('role', h.role, 'country_code', h.country_code,
       'from_month', to_char(h.from_month, 'YYYY-MM'), 'to_month', to_char(h.to_month, 'YYYY-MM'))
       order by h.from_month desc, h.role)
     from public.worker_employment_history h where h.worker_user_id = w.user_id),
    '[]') end as employment_history,
  case when w.card_show_industries then coalesce(
    (select array_agg(i.industry_code order by i.industry_code)
     from public.worker_preferred_industries i where i.worker_user_id = w.user_id),
    '{}') end as preferred_industries,
  case when w.card_show_industries then coalesce(
    (select array_agg(e.employment_type::text order by e.employment_type)
     from public.worker_preferred_employment_types e where e.worker_user_id = w.user_id),
    '{}') end as preferred_employment_types,
  w.updated_at
from public.worker_profiles w
join public.profiles pr on pr.id = w.user_id;

revoke all on private.worker_cards from public, anon, authenticated, service_role;

-- The listed cards with the card fields only (AC4; a test fixes the column list). Not granted to any API role:
-- search_workers (V69) reads it for the searchers FR-Q2 allows. A worker who withdraws is gone at the next read.
create view public.worker_search with (security_invoker = true) as
select c.card_id, c.headline, c.occupation_id, c.skills, c.years_experience, c.languages, c.availability, c.available_from,
  c.current_country, c.preferred_countries, c.work_authorization_countries, c.training, c.employment_history,
  c.preferred_industries, c.preferred_employment_types, c.updated_at
from private.worker_cards c
where c.listed;

revoke all on public.worker_search from public, anon, authenticated, service_role;

comment on view public.worker_search is
  'The pseudonymous Find Workers cards of listed workers (FR-Q1 AC4). Read only through search_workers; never a name, contact detail, photo or document.';

-- Visibility --------------------------------------------------------------------------------------------------------------

-- The worker calling, while release_find_workers is on: the user id. No session, CHARA_FORBIDDEN (42501); the release
-- off, CHARA_FORBIDDEN release_off; an account that is not a worker's (a company member, a platform administrator),
-- CHARA_FORBIDDEN worker_account_required (AC3).
create function private.find_workers_worker() returns uuid
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
  if not private.release_on('release_find_workers') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.account_kind = 'worker') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required';
  end if;
  return v_uid;
end;
$$;

revoke all on function private.find_workers_worker() from public, anon, authenticated, service_role;

-- Hides p_user's card if it is listed: one withdrawn consent row with the version last granted, searchable false and the
-- reminder cleared in the caller's transaction, and one audit row worker.visibility_changed with p_reason (withdrawn,
-- confirmation_expired, erased). Answers whether anything changed. The passport row is locked first, so a withdrawal,
-- an opt-in and the confirmation job are serialised per worker.
create function private.hide_worker_card(p_user uuid, p_reason text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_searchable boolean;
  v_version integer;
begin
  select w.searchable into v_searchable from public.worker_profiles w where w.user_id = p_user for update;
  if not coalesce(v_searchable, false) then
    return false;
  end if;
  select c.version into v_version
  from public.consents c
  where c.user_id = p_user and c.purpose = 'worker-visibility-consent' and c.action = 'granted'
  order by c.id desc limit 1;

  if v_version is not null then
    insert into public.consents (user_id, purpose, version, action)
    values (p_user, 'worker-visibility-consent', v_version, 'withdrawn');
  end if;
  update public.worker_profiles set searchable = false, visibility_reminded_at = null where user_id = p_user;
  perform audit.record('worker.visibility_changed', 'profile', p_user::text,
    jsonb_strip_nulls(jsonb_build_object('from', true, 'to', false, 'version', v_version, 'reason', p_reason)));
  return true;
end;
$$;

revoke all on function private.hide_worker_card(uuid, text) from public, anon, authenticated, service_role;

-- set_worker_visibility(p_visible, p_version): the caller's own card only (AC2, AC3, AC6, AC8).
--   true: p_version must be the current version of worker-visibility-consent (an older or an unpublished one,
--     CHARA_CONSENT_REQUIRED worker-visibility-consent); the account active (CHARA_FORBIDDEN profile_not_active
--     otherwise). One granted consent row, searchable true and one audit row worker.visibility_changed. A repeat with the
--     same version writes nothing, unless the yearly reminder is waiting for an answer: then it is the confirmation, a new
--     granted row that restarts the 12 months (audit reason confirmed).
--   false: p_version is ignored; a listed card is hidden through private.hide_worker_card (reason withdrawn); a hidden
--     card writes nothing. Always allowed, whatever the account status. Conversations and contact requests are untouched.
-- Answers visible, the version of the consent that applies, visible_since and changed.
create function public.set_worker_visibility(p_visible boolean, p_version integer default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.find_workers_worker();
  v_profile public.worker_profiles;
  v_status public.profile_status;
  v_deleted timestamptz;
  v_current integer := private.current_legal_version('worker-visibility-consent');
  v_last public.consents;
  v_changed boolean;
begin
  if p_visible is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_visible';
  end if;
  select * into v_profile from public.worker_profiles w where w.user_id = v_uid for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not p_visible then
    v_changed := private.hide_worker_card(v_uid, 'withdrawn');
    return jsonb_build_object('visible', false, 'version', null, 'visible_since', null, 'changed', v_changed);
  end if;

  select p.status, p.deleted_at into v_status, v_deleted from public.profiles p where p.id = v_uid;
  if v_status <> 'active' or v_deleted is not null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;
  if p_version is null or v_current is null or p_version <> v_current then
    raise exception 'CHARA_CONSENT_REQUIRED' using detail = 'worker-visibility-consent';
  end if;

  select * into v_last from public.consents c
  where c.user_id = v_uid and c.purpose = 'worker-visibility-consent'
  order by c.id desc limit 1;
  v_changed := not coalesce(v_profile.searchable and v_last.action = 'granted' and v_last.version = p_version
    and v_profile.visibility_reminded_at is null, false);

  if v_changed then
    insert into public.consents (user_id, purpose, version, action)
    values (v_uid, 'worker-visibility-consent', p_version, 'granted');
    update public.worker_profiles set searchable = true, visibility_reminded_at = null where user_id = v_uid;
    perform audit.record('worker.visibility_changed', 'profile', v_uid::text,
      jsonb_strip_nulls(jsonb_build_object('from', v_profile.searchable, 'to', true, 'version', p_version,
        'reason', case when v_profile.searchable then 'confirmed' end)));
  end if;

  return jsonb_build_object('visible', true, 'version', p_version,
    'visible_since', private.worker_visible_since(v_uid), 'changed', v_changed);
end;
$$;

-- The time of the first grant of the current visible period: the first granted worker-visibility-consent row after the
-- last withdrawal (a confirmation does not move it). Null while the worker is not visible.
create function private.worker_visible_since(p_user uuid) returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select min(c.created_at)
  from public.consents c
  where c.user_id = p_user and c.purpose = 'worker-visibility-consent' and c.action = 'granted'
    and c.id > coalesce((
      select max(x.id) from public.consents x
      where x.user_id = p_user and x.purpose = 'worker-visibility-consent' and x.action = 'withdrawn'), 0)
    and exists (select 1 from public.worker_profiles w where w.user_id = p_user and w.searchable)
$$;

revoke all on function private.worker_visible_since(uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_worker_visibility(boolean, integer) from public, anon, authenticated, service_role;
grant execute on function public.set_worker_visibility(boolean, integer) to authenticated;

-- The worker's choice of the optional card sections (AC5; FR-Q4 step Card): training, employment history, and preferred
-- industries with the preferred employment types. Allowed whether or not the card is visible, so it can be prepared
-- before the opt-in. Audit worker.card_sections_changed with the new choice when it changes. Answers the stored choice.
create function public.set_card_sections(p_training boolean, p_employment_history boolean, p_industries boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.find_workers_worker();
  v_profile public.worker_profiles;
begin
  if p_training is null or p_employment_history is null or p_industries is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'sections';
  end if;
  select * into v_profile from public.worker_profiles w where w.user_id = v_uid for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if (v_profile.card_show_training, v_profile.card_show_employment_history, v_profile.card_show_industries)
     is distinct from (p_training, p_employment_history, p_industries) then
    update public.worker_profiles
    set card_show_training = p_training, card_show_employment_history = p_employment_history,
        card_show_industries = p_industries
    where user_id = v_uid;
    perform audit.record('worker.card_sections_changed', 'profile', v_uid::text,
      jsonb_build_object('training', p_training, 'employment_history', p_employment_history, 'industries', p_industries));
  end if;
  return jsonb_build_object('training', p_training, 'employment_history', p_employment_history, 'industries', p_industries);
end;
$$;

revoke all on function public.set_card_sections(boolean, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_card_sections(boolean, boolean, boolean) to authenticated;

-- The caller's own card exactly as companies would see it (the columns of public.worker_search, AC9), with the state of
-- the opt-in: visible (listed now), opted_in (searchable, which a suspension or a deletion request does not clear),
-- visible_since, the version of the consent last granted and the current version of the document, confirm_by (the
-- end of the answer period while the yearly reminder waits) and the three section choices. No row without a passport.
create function public.my_card_preview() returns table (
  card_id uuid,
  headline text,
  occupation_id text,
  skills text[],
  years_experience smallint,
  languages jsonb,
  availability public.worker_availability,
  available_from date,
  current_country text,
  preferred_countries text[],
  work_authorization_countries text[],
  training jsonb,
  employment_history jsonb,
  preferred_industries text[],
  preferred_employment_types text[],
  updated_at timestamptz,
  visible boolean,
  opted_in boolean,
  visible_since timestamptz,
  consent_version integer,
  current_version integer,
  confirm_by timestamptz,
  show_training boolean,
  show_employment_history boolean,
  show_industries boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.find_workers_worker();
  v_grace integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'visibility_confirmation_grace_days'), 30);
begin
  return query
  select c.card_id, c.headline, c.occupation_id, c.skills, c.years_experience, c.languages, c.availability,
    c.available_from, c.current_country, c.preferred_countries, c.work_authorization_countries, c.training,
    c.employment_history, c.preferred_industries, c.preferred_employment_types, c.updated_at,
    c.listed, w.searchable, private.worker_visible_since(v_uid),
    (select x.version from public.consents x
     where x.user_id = v_uid and x.purpose = 'worker-visibility-consent' and x.action = 'granted'
     order by x.id desc limit 1),
    private.current_legal_version('worker-visibility-consent'),
    case when w.searchable then w.visibility_reminded_at + make_interval(days => v_grace) end,
    w.card_show_training, w.card_show_employment_history, w.card_show_industries
  from private.worker_cards c
  join public.worker_profiles w on w.user_id = c.user_id
  where c.user_id = v_uid;
end;
$$;

revoke all on function public.my_card_preview() from public, anon, authenticated, service_role;
grant execute on function public.my_card_preview() to authenticated;

-- The consent can be given and withdrawn only with the card: accept_consents and withdraw_consent refuse the slug, or a
-- grant without searchable (or a withdrawal that leaves the card listed) would split the ledger from the search.

-- accept_consents of 20261120100000_employer_pays_commitment.sql with worker-visibility-consent among the refused
-- documents; everything else is unchanged.
create or replace function public.accept_consents(p_consents jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status public.profile_status;
  v_kind public.account_kind;
  v_org_type public.organization_type;
  v_own text[];
  v_other text[];
  v_entry jsonb;
  v_purpose text;
  v_version integer;
  v_recorded jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  -- The row lock serialises concurrent calls of one user, so the idempotency check below cannot race.
  select p.status, coalesce(p.account_kind, p.intended_account_kind), p.intended_organization_type
  into v_status, v_kind, v_org_type
  from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;
  if v_kind is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind_not_chosen';
  end if;
  v_own := private.required_consents(v_kind, v_org_type);
  v_other := private.other_consents(v_kind, v_org_type)
    || array['employer-pays-commitment', 'partner-dpa', 'worker-visibility-consent'];

  if jsonb_typeof(p_consents) is distinct from 'array'
     or jsonb_array_length(p_consents) > private.max_consent_entries() then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_consents must be an array of at most 20 entries';
  end if;

  for v_entry in select e from jsonb_array_elements(p_consents) e loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or jsonb_typeof(v_entry -> 'purpose') is distinct from 'string'
       or (v_entry ->> 'version') !~ '^[0-9]{1,9}$' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'each entry needs a purpose and an integer version';
    end if;
    v_purpose := v_entry ->> 'purpose';
    v_version := (v_entry ->> 'version')::integer;

    if v_purpose = any (v_other) and v_purpose <> all (v_own) then
      raise exception 'CHARA_INVALID_INPUT' using detail = v_purpose;
    end if;
    if v_version is distinct from private.current_legal_version(v_purpose) then
      if exists (
        select 1 from public.legal_documents d
        where d.slug = v_purpose and d.version = v_version and d.published_at <= now()
      ) then
        raise exception 'CHARA_CONSENT_REQUIRED' using detail = v_purpose;
      end if;
      raise exception 'CHARA_INVALID_INPUT' using detail = v_purpose;
    end if;

    if exists (
      select 1 from (
        select c.action, c.version from public.consents c
        where c.user_id = v_uid and c.purpose = v_purpose
        order by c.id desc limit 1
      ) latest
      where latest.action = 'granted' and latest.version = v_version
    ) then
      continue;
    end if;

    insert into public.consents (user_id, purpose, version, action)
    values (v_uid, v_purpose, v_version, 'granted');
    v_recorded := v_recorded || jsonb_build_object('purpose', v_purpose, 'version', v_version);
  end loop;

  if jsonb_array_length(v_recorded) > 0 then
    perform audit.record('consents_accepted', 'profile', v_uid::text, jsonb_build_object('consents', v_recorded));
  end if;
end;
$$;

-- withdraw_consent of 20261004100300_consents.sql with worker-visibility-consent refused like the age attestation:
-- set_worker_visibility(false, null) withdraws it together with the card.
create or replace function public.withdraw_consent(p_purpose text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_action public.consent_action;
  v_version integer;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  perform 1 from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  -- The age attestation (FR-A9) is never undone; the visibility consent goes with the card (FR-Q1).
  if p_purpose in ('age-18-plus', 'worker-visibility-consent') then
    raise exception 'CHARA_INVALID_INPUT' using detail = p_purpose;
  end if;

  select c.action, c.version into v_action, v_version
  from public.consents c
  where c.user_id = v_uid and c.purpose = p_purpose
  order by c.id desc limit 1;
  if not found or v_action <> 'granted' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'no granted consent for ' || coalesce(p_purpose, 'null');
  end if;

  insert into public.consents (user_id, purpose, version, action)
  values (v_uid, p_purpose, v_version, 'withdrawn');
  perform audit.record(
    'consent_withdrawn', 'profile', v_uid::text,
    jsonb_build_object('purpose', p_purpose, 'version', v_version)
  );
end;
$$;

-- Yearly confirmation (AC8) ----------------------------------------------------------------------------------------------

insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types, release_key) values
  ('visibility_confirmation', false, true, 'worker', 'Yearly confirmation of your Find Workers card', null, 'release_find_workers');

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon', 'job_order_match', 'invitation_received',
  'invitation_withdrawn', 'requirement_changed', 'requirement_closed', 'response_received', 'response_withdrawn',
  'response_decided', 'submission_request', 'submission_request_signup', 'submission_approved', 'submission_withdrawn',
  'submission_stage_changed', 'visibility_confirmation'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- Daily (visibility-confirmation), while release 2c is on, at p_now:
--   1. a visible worker whose reminder was sent visibility_confirmation_grace_days (30) or more ago without a new grant is
--      hidden (private.hide_worker_card, reason confirmation_expired);
--   2. a visible worker with an active account whose last grant is visibility_confirmation_days (365) or more old and who
--      has no reminder waiting is stamped and gets one visibility_confirmation (dedupe key: the grant), with the end of
--      the answer period as respond_by, in this transaction (NFR-A3). A second run the same day finds the stamp.
-- A confirmation (set_worker_visibility(true, current version)) writes a new grant and clears the stamp. Answers the
-- numbers reminded and hidden.
create function private.visibility_confirmation_run(p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'visibility_confirmation_days'), 365);
  v_grace integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'visibility_confirmation_grace_days'), 30);
  v_row record;
  v_hidden integer := 0;
  v_reminded integer := 0;
begin
  if not private.release_on('release_find_workers') then
    return jsonb_build_object('reminded', 0, 'hidden', 0);
  end if;

  for v_row in
    select w.user_id from public.worker_profiles w
    where w.searchable and w.visibility_reminded_at <= p_now - make_interval(days => v_grace)
    order by w.user_id
  loop
    if private.hide_worker_card(v_row.user_id, 'confirmation_expired') then
      v_hidden := v_hidden + 1;
    end if;
  end loop;

  for v_row in
    update public.worker_profiles w
    set visibility_reminded_at = p_now
    from (
      select x.user_id, g.id as grant_id
      from public.worker_profiles x
      join public.profiles pr on pr.id = x.user_id and pr.status = 'active' and pr.deleted_at is null
      cross join lateral (
        select c.id, c.action, c.created_at from public.consents c
        where c.user_id = x.user_id and c.purpose = 'worker-visibility-consent'
        order by c.id desc limit 1
      ) g
      where x.searchable and x.visibility_reminded_at is null
        and g.action = 'granted' and g.created_at <= p_now - make_interval(days => v_days)
    ) due
    where w.user_id = due.user_id
    returning w.user_id, due.grant_id
  loop
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'visibility_confirmation', 'user_id', v_row.user_id, 'mandatory', false,
      'dedupe_key', 'visibility_confirmation:' || v_row.grant_id,
      'respond_by', p_now + make_interval(days => v_grace)));
    v_reminded := v_reminded + 1;
  end loop;

  return jsonb_build_object('reminded', v_reminded, 'hidden', v_hidden);
end;
$$;

revoke all on function private.visibility_confirmation_run(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('visibility-confirmation', '35 1 * * *', 'select private.visibility_confirmation_run()');

-- The payload of the new kind ----------------------------------------------------------------------------------------------

-- notification_payload of 20270111100100_moderation_job_orders.sql with one branch added for visibility_confirmation.
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
    -- V54: the named job orders of the digest follow the vacancies, by their current title, the ten oldest with how many
    -- there are; a partner follower's items carry the requirement id and the slug of the follower's own company for the
    -- link, a candidate's the title only (decision 3.1). Absent when the digest holds no job order.
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
      ), '[]'::jsonb),
      'job_order_total', case when p_message ? 'requirement_ids' then jsonb_array_length(p_message -> 'requirement_ids') end,
      'partner_slug', (select o.slug from public.organizations o where o.id = (p_message ->> 'partner_id')::uuid),
      'job_orders', case when p_message ? 'requirement_ids' then coalesce((
        select jsonb_agg(jsonb_build_object(
          'requirement_id', case when p_message ? 'partner_id' then x.id end, 'title', x.title) order by x.position)
        from (
          select r.id, r.title, e.position
          from jsonb_array_elements_text(p_message -> 'requirement_ids') with ordinality e(id, position)
          join public.workforce_requirements r on r.id = e.id::uuid
          order by e.position
          limit 10
        ) x
      ), '[]'::jsonb) end)
    when 'moderation_decision' then case
      when p_message ? 'report_id' then jsonb_build_object(
        'reference', private.report_reference((p_message ->> 'report_id')::bigint), 'outcome', p_message -> 'outcome')
      when p_message ? 'appeal_id' then jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case
          when p_message ->> 'target_type' = 'job' then v_title
          when p_message ->> 'target_type' in ('requirement', 'partner_response', 'candidate_submission') then p_message ->> 'title'
          else v_org_name
        end,
        'org_slug', v_slug, 'appeal_id', p_message -> 'appeal_id', 'appeal_outcome', p_message -> 'appeal_outcome',
        'reasons', p_message -> 'reasons', 'moderation_action_id', p_message -> 'moderation_action_id')
      else jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case
          when p_message ->> 'target_type' = 'partner_profile' then v_org_name
          when p_message ->> 'target_type' in ('requirement', 'partner_response', 'candidate_submission') then p_message ->> 'title'
        end,
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
    -- V68: to the worker, the end of the answer period of the yearly confirmation only; the card, the name and the
    -- consent stay out (NFR-S9).
    when 'visibility_confirmation' then jsonb_build_object('respond_by', p_message -> 'respond_by')
    else '{}'::jsonb
  end);
end;
$$;

-- Erasure ------------------------------------------------------------------------------------------------------------------

-- erase_user of 20270112100000_network_retention_submissions.sql with one change (FR-Q1 AC7): a listed card is hidden
-- with a withdrawn consent row and its audit row before the consents and the audit log are pseudonymised, so both carry
-- the pseudonym. Everything else is unchanged.
create or replace function public.erase_user(p_user_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.account_kind;
  v_requested timestamptz;
  v_hold boolean;
  v_email text;
  v_pseudonym uuid := gen_random_uuid();
  v_subject text := p_user_id::text;
  v_submissions bigint;
  v_shares bigint;
begin
  select p.account_kind, p.deleted_at, p.legal_hold into v_kind, v_requested, v_hold
  from public.profiles p where p.id = p_user_id for no key update;
  if not found then
    return false;
  end if;
  if v_kind is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required';
  end if;
  if v_requested is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'deletion_not_requested';
  end if;
  if now() < private.cooling_off_ends_at(v_requested) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'cooling_off_not_ended';
  end if;
  if v_hold then
    raise exception 'CHARA_FORBIDDEN' using detail = 'legal_hold';
  end if;
  if exists (select 1 from public.platform_staff s where s.user_id = p_user_id and s.revoked_at is null) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'platform_staff';
  end if;

  select u.email into v_email from auth.users u where u.id = p_user_id;
  perform set_config('chara.erasure_user', v_subject, true);
  perform set_config('chara.erasure_pseudonym', v_pseudonym::text, true);

  delete from public.application_notes n using public.job_applications a
  where a.id = n.application_id and a.worker_user_id = p_user_id;
  -- The submissions go with their shares (on delete cascade) and history; so do the requests that still wait for the
  -- address, whose partner never learns whether an account had it.
  with gone as (
    delete from public.candidate_submissions s
    where s.worker_user_id = p_user_id or (s.worker_user_id is null and s.invited_email = lower(v_email))
    returning s.passport_share_id
  )
  select count(*), count(gone.passport_share_id) into v_submissions, v_shares from gone;
  update public.passport_shares
  set worker_user_id = v_pseudonym, scope = '[]', revoked_at = coalesce(revoked_at, now())
  where worker_user_id = p_user_id;
  update public.job_applications a
  set worker_user_id = v_pseudonym, cover_note = null,
      profile_snapshot = a.profile_snapshot - 'first_name' - 'last_name' - 'headline'
  where a.worker_user_id = p_user_id;
  update public.application_events set actor_id = v_pseudonym where actor_id = p_user_id;
  perform private.hide_worker_card(p_user_id, 'erased');
  update public.consents set user_id = v_pseudonym where user_id = p_user_id;
  update public.reports
  set reporter_user_id = case when reporter_user_id = p_user_id then v_pseudonym else reporter_user_id end,
      reporter_email = null
  where reporter_user_id = p_user_id or reporter_email = lower(v_email);
  update audit.document_access_log
  set worker_user_id = v_pseudonym, accessed_by = case when accessed_by = p_user_id then v_pseudonym else accessed_by end
  where worker_user_id = p_user_id;
  update audit.log
  set actor_id = case when actor_id = p_user_id then v_pseudonym else actor_id end,
      entity_id = case when entity_id = v_subject then v_pseudonym::text else entity_id end,
      ip = case when actor_id = p_user_id then null else ip end,
      metadata = replace(metadata::text, v_subject, v_pseudonym::text)::jsonb
  where actor_id = p_user_id or entity_id = v_subject
     or (entity_type = 'platform_staff'
         and entity_id = any (array(select s.id::text from public.platform_staff s where s.user_id = p_user_id)));

  delete from public.worker_documents where worker_user_id = p_user_id;
  delete from public.worker_profiles where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;
  perform pgmq.delete('notifications', array(select n.msg_id from public.notifications n where n.user_id = p_user_id and n.msg_id is not null));
  delete from pgmq.a_notifications a where a.msg_id = any (array(select n.msg_id from public.notifications n where n.user_id = p_user_id and n.msg_id is not null));
  delete from public.notifications where user_id = p_user_id;
  delete from public.notification_preferences where user_id = p_user_id;
  delete from pgmq.a_account_ops a where a.message ->> 'user_id' = v_subject;

  perform set_config('chara.erasure_user', '', true);
  perform set_config('chara.erasure_pseudonym', '', true);

  perform audit.record(
    'account.erased', 'profile', v_pseudonym::text,
    jsonb_build_object('requested_at', v_requested, 'completed_at', now(),
      'deleted', jsonb_build_object('candidate_submissions', v_submissions, 'submission_passport_shares', v_shares))
  );
  -- The auth user is deleted next, so the address travels in the message; notify deletes it after sending.
  if v_email is not null then
    perform pgmq.send('notifications', jsonb_build_object('kind', 'deletion_completed', 'email', v_email, 'mandatory', true));
  end if;
  return true;
end;
$$;
