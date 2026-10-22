-- Partner organisations (infrastructure for FR-J1, FR-J4, FR-K1, FR-K2; docs/phase-2/DATA_MODEL.md sections 2 to 5).
-- Recruitment and staffing companies are organisations of the two partner types (section 3). This migration adds the
-- partner enums, the intended organisation type of a company sign-up, the partner columns of an organisation, the
-- staff-only identifier links, partner types in create_organization, the return of a listed partner to review when its
-- legal identity changes, the staff correction of the type and the one definition of a listed partner.
--
-- Partner organisations belong to release 2a: create_organization refuses the partner types while the setting
-- release_partner_directories is false, exactly as Phase 1 did, and so does a sign-up that names a partner type.

-- The release switch and its reader, as in 20261114100000_in_app_notifications.sql (the same body, so whichever of the two
-- migrations runs second leaves the function as it was).
insert into private.settings (key, value) values ('release_partner_directories', 'false') on conflict (key) do nothing;

create or replace function private.release_on(p_key text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::boolean from private.settings s where s.key = p_key), false)
$$;

revoke all on function private.release_on(text) from public, anon, authenticated, service_role;

create type public.partner_review_status as enum (
  'onboarding', 'pending_review', 'info_requested', 'listed', 're_review', 'declined'
);
create type public.geography_scope as enum ('sources_from', 'serves_market');
create type public.partner_service_type as enum ('staffing', 'temporary', 'contract', 'project', 'permanent');
create type public.workforce_size_band as enum ('1_49', '50_249', '250_999', '1000_plus');

-- Profiles ---------------------------------------------------------------------------------------------------------

-- Null means an employer (or no company at all); only the two partner types are stored, so "the type a company user may
-- create" is coalesce(intended_organization_type, 'employer').
alter table public.profiles
  add column intended_organization_type public.organization_type,
  add constraint profiles_intended_organization_type_check check (
    intended_organization_type is null
    or (intended_account_kind = 'company' and intended_organization_type <> 'employer')
  );

comment on column public.profiles.intended_organization_type is
  'Partner type named at sign-up (recruitment_company or staffing_company); null for workers and employers. Frozen once the account kind is committed; only admin_set_organization_type corrects it afterwards.';

revoke select on public.profiles from authenticated;
grant select (
  id, account_kind, intended_account_kind, intended_organization_type, pending_consents, display_name, preferred_lang,
  status, deleted_at, created_at
) on public.profiles to authenticated;

-- 20261005110000 with the intended organisation type: it changes only with the intended kind while the kind is not
-- committed (choose_account_kind announces that), or through the staff correction of an organisation's type, which
-- announces it with chara.correct_organization_type for its own transaction.
create or replace function private.profiles_guard_account_kind() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.intended_account_kind is distinct from old.intended_account_kind
     and old.intended_account_kind is not null
     and not (old.account_kind is null and coalesce(current_setting('chara.replace_intended_kind', true), '') = 'on') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'intended_account_kind cannot be changed';
  end if;
  if new.account_kind is distinct from old.account_kind
     and not coalesce(old.account_kind is null and new.account_kind = new.intended_account_kind, false) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind is committed once from the intended kind';
  end if;
  if new.intended_organization_type is distinct from old.intended_organization_type
     and not (old.account_kind is null and coalesce(current_setting('chara.replace_intended_kind', true), '') = 'on')
     and coalesce(current_setting('chara.correct_organization_type', true), '') <> 'on' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'intended_organization_type cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger profiles_guard_account_kind on public.profiles;

create trigger profiles_guard_account_kind
  before update of account_kind, intended_account_kind, intended_organization_type on public.profiles
  for each row execute function private.profiles_guard_account_kind();

alter table public.profiles enable always trigger profiles_guard_account_kind;

-- 20261005110000 with the partner type of a company sign-up (user metadata intended_organization_type). 'employer' is
-- stored as null; a partner type is refused while release 2a is off, and any type is refused for a worker.
create or replace function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := new.raw_user_meta_data ->> 'intended_account_kind';
  v_type text := nullif(new.raw_user_meta_data ->> 'intended_organization_type', 'employer');
begin
  if v_kind is not null and v_kind not in ('worker', 'company') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'intended_account_kind must be worker or company';
  end if;
  if v_type is not null then
    if v_kind is distinct from 'company' or v_type not in ('recruitment_company', 'staffing_company') then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'intended_organization_type';
    end if;
    if not private.release_on('release_partner_directories') then
      raise exception 'CHARA_FORBIDDEN' using detail = 'organization_type_not_available';
    end if;
  end if;

  insert into public.profiles (id, intended_account_kind, intended_organization_type, pending_consents)
  values (
    new.id,
    v_kind::public.account_kind,
    v_type::public.organization_type,
    case when v_kind is null then '[]'::jsonb else coalesce(new.raw_user_meta_data -> 'pending_consents', '[]') end
  );
  return new;
end;
$$;

-- Organisations ----------------------------------------------------------------------------------------------------

-- moderation_state reuses the states of a vacancy (visible, hidden by moderation, hidden with a suspended organisation);
-- the moderation units (V26, V27) set it for the partner profile.
alter table public.organizations
  add column review_status public.partner_review_status,
  add column submitted_at timestamptz,
  add column listed_at timestamptz,
  add column info_step text constraint organizations_info_step_check
    check (info_step in ('company', 'where_you_serve', 'commitments')),
  add column recruitment_type public.recruitment_preference,
  add column founded_year smallint constraint organizations_founded_year_check check (founded_year between 1800 and 2200),
  add column workforce_size_band public.workforce_size_band,
  add column workforce_profile_updated_at timestamptz,
  add column public_page_enabled boolean not null default false,
  add column moderation_state public.job_moderation_state;

-- Added not valid and validated apart, as in 20261005110000: the validation scan holds a lighter lock.
alter table public.organizations
  add constraint organizations_review_status_partner_only
    check ((type = 'employer') = (review_status is null)) not valid,
  add constraint organizations_moderation_state_partner_only
    check ((type = 'employer') = (moderation_state is null)) not valid,
  add constraint organizations_partner_columns_partner_only check (
    type <> 'employer' or (
      submitted_at is null and listed_at is null and info_step is null and recruitment_type is null
      and founded_year is null and workforce_size_band is null and workforce_profile_updated_at is null
    )
  ) not valid,
  add constraint organizations_public_page_employer_only check (not public_page_enabled or type = 'employer') not valid;
alter table public.organizations validate constraint organizations_review_status_partner_only;
alter table public.organizations validate constraint organizations_moderation_state_partner_only;
alter table public.organizations validate constraint organizations_partner_columns_partner_only;
alter table public.organizations validate constraint organizations_public_page_employer_only;

comment on column public.organizations.review_status is
  'Staff review of a partner (FR-J4); null exactly for employers. Never public, never shown as verification.';
comment on column public.organizations.listed_at is
  'First approval of the partner. Listed means listed_at is not null, review_status <> declined and status = active (private.is_listed_partner).';
comment on column public.organizations.info_step is
  'Onboarding step that staff reopened with a request for information: company, where_you_serve or commitments.';
comment on column public.organizations.workforce_profile_updated_at is
  'Last change of the workforce profile (exposed as profile_updated_at).';
comment on column public.organizations.public_page_enabled is
  'Whether the public company page of an employer is on (FR-K5); always false for partners.';

-- A partner starts in onboarding with a visible profile, whoever inserts the row.
create function private.organizations_partner_defaults() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type <> 'employer' then
    new.review_status := coalesce(new.review_status, 'onboarding');
    new.moderation_state := coalesce(new.moderation_state, 'visible');
  end if;
  return new;
end;
$$;

revoke all on function private.organizations_partner_defaults() from public, anon, authenticated, service_role;

create trigger organizations_partner_defaults
  before insert on public.organizations
  for each row execute function private.organizations_partner_defaults();

alter table public.organizations enable always trigger organizations_partner_defaults;

-- The directories, search and the public profile read the listed partners of a type.
create index organizations_listed_partners_idx on public.organizations (type, id)
  where listed_at is not null and review_status <> 'declined' and status = 'active';

-- The canonical listed predicate (DATA_MODEL.md section 2). A partner in re_review, or asked for information during a
-- re-review, stays listed until staff decide (FR-J4). Executable by the API roles because the read policies of the
-- workforce profile tables use it; whether an organisation is listed is public.
create function private.is_listed_partner(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org and o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active'
  )
$$;

create function private.public_partner_ids() returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id from public.organizations o
  where o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active'
$$;

revoke all on function private.is_listed_partner(uuid) from public, anon, authenticated, service_role;
revoke all on function private.public_partner_ids() from public, anon, authenticated, service_role;
grant execute on function private.is_listed_partner(uuid) to anon, authenticated;
grant execute on function private.public_partner_ids() to anon, authenticated;

-- Identifier links -------------------------------------------------------------------------------------------------

-- One row per pair of organisations that named the same legal-entity identifier, written by create_organization for the
-- new organisation against every earlier one (decision 2.4: a second type is a second account with the same identifier,
-- which staff see linked). Read only by the staff review (V11); never returned to the partner.
create table private.organization_identifier_links (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  other_organization_id uuid not null references public.organizations (id) on delete cascade,
  same_type boolean not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, other_organization_id),
  check (organization_id <> other_organization_id)
);

create index organization_identifier_links_other_idx on private.organization_identifier_links (other_organization_id);

alter table private.organization_identifier_links enable row level security;
alter table private.organization_identifier_links force row level security;
revoke all on table private.organization_identifier_links from public, anon, authenticated, service_role;

-- create_organization ----------------------------------------------------------------------------------------------

-- 20261006100000 with the partner types: a company user creates the type named at sign-up and no other
-- (organization_type_mismatch), a partner needs the legal-entity identifier, starts in review_status onboarding, and an
-- identifier another organisation already named is recorded in the staff-only links and the audit row, never in the
-- result. While release 2a is off the partner types are refused as in Phase 1.
create or replace function public.create_organization(
  p_type public.organization_type,
  p_legal_name text,
  p_display_name text,
  p_based_in_country text,
  p_industry_code text,
  p_website text default null,
  p_identifier text default null,
  p_identifier_kind text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_id uuid := gen_random_uuid();
  v_legal text := btrim(p_legal_name);
  v_display text := coalesce(nullif(btrim(p_display_name), ''), btrim(p_legal_name));
  v_partner boolean := p_type in ('recruitment_company', 'staffing_company');
  v_identifier text;
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_existing public.organizations;
  v_duplicate boolean;
  v_same_type boolean;
  v_trial_used boolean;
  v_constraint text;
  v_column text;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid for no key update;
  if not found or v_profile.account_kind is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;
  if p_type is null or (v_partner and not private.release_on('release_partner_directories')) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_type_not_available';
  end if;
  if p_type <> coalesce(v_profile.intended_organization_type, 'employer') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_type_mismatch';
  end if;
  if v_legal is null or p_industry_code is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = case when v_legal is null then 'legal_name' else 'industry_code' end;
  end if;
  v_identifier := private.legal_entity_identifier(p_identifier, p_identifier_kind);
  if v_partner and v_identifier is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'legal_entity_identifier';
  end if;

  select o.* into v_existing
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = v_uid and m.role = 'owner'
    and private.legal_name_key(o.legal_name) = private.legal_name_key(v_legal)
    and o.created_at > now() - interval '1 minute';
  if found then
    return jsonb_build_object(
      'organization_id', v_existing.id, 'slug', v_existing.slug,
      'duplicate_legal_name', exists (
        select 1 from public.organizations o
        where private.legal_name_key(o.legal_name) = private.legal_name_key(v_legal) and o.id <> v_existing.id
      )
    );
  end if;
  if (select count(*) from public.organization_members m where m.user_id = v_uid and m.role = 'owner')
     >= (select (value #>> '{}')::integer from private.settings where key = 'organizations_per_user_max') then
    raise exception 'CHARA_LIMIT_REACHED' using detail = 'organizations';
  end if;

  v_duplicate := exists (
    select 1 from public.organizations o where private.legal_name_key(o.legal_name) = private.legal_name_key(v_legal)
  );
  v_trial_used := private.legal_entity_trial_used(v_identifier);

  v_base := btrim(left(btrim(regexp_replace(lower(extensions.unaccent(v_display)), '[^a-z0-9]+', '-', 'g'), '-'), 60), '-');
  if v_base = '' then
    v_base := 'org-' || left(v_id::text, 8);
  end if;

  loop
    v_slug := case when v_n = 1 then v_base
      else btrim(left(v_base, 51), '-') || '-' || case when v_n < 5 then substr(md5(random()::text), 1, 6) else left(v_id::text, 8) end
    end;
    begin
      insert into public.organizations (
        id, type, slug, legal_name, display_name, based_in_country, industry_code, website,
        legal_entity_identifier, legal_entity_identifier_kind
      )
      values (
        v_id, p_type, v_slug, v_legal, v_display, upper(btrim(p_based_in_country)), upper(btrim(p_industry_code)),
        nullif(btrim(p_website), ''), v_identifier, case when v_identifier is not null then p_identifier_kind end
      );
      exit;
    exception
      when unique_violation then
        if v_n >= 5 then
          raise exception 'CHARA_CONFLICT' using detail = 'slug';
        end if;
        v_n := v_n + 1;
      when check_violation or not_null_violation then
        get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
        raise exception 'CHARA_INVALID_INPUT' using detail = coalesce(nullif(v_constraint, ''), v_column);
    end;
  end loop;

  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (v_id, v_uid, 'owner', now());

  if v_identifier is not null then
    insert into private.organization_identifier_links (organization_id, other_organization_id, same_type)
    select v_id, o.id, o.type = p_type
    from public.organizations o
    where o.legal_entity_identifier = v_identifier and o.id <> v_id;
    v_same_type := exists (
      select 1 from private.organization_identifier_links l where l.organization_id = v_id and l.same_type
    );
  end if;

  perform audit.record(
    'organization_created', 'organization', v_id::text,
    jsonb_build_object(
      'slug', v_slug, 'type', p_type, 'duplicate_legal_name', v_duplicate, 'legal_entity_trial_used', v_trial_used
    ) || case when v_identifier is null then '{}'::jsonb
      else jsonb_build_object('duplicate_identifier_same_type', v_same_type) end
  );
  return jsonb_build_object('organization_id', v_id, 'slug', v_slug, 'duplicate_legal_name', v_duplicate);
end;
$$;

-- Re-review --------------------------------------------------------------------------------------------------------

-- A listed partner whose legal name, identifier, identifier kind or type changes goes back to the staff queue
-- (FR-J4 AC9), at its end, and stays listed until staff decide. Whatever function made the change, one audit row names
-- the fields. Definer rights for the audit row.
create function private.organizations_return_to_review() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields jsonb;
begin
  if old.review_status is distinct from 'listed' then
    return new;
  end if;
  select coalesce(jsonb_agg(f.name order by f.name), '[]') into v_fields
  from (values
    ('legal_name', new.legal_name is distinct from old.legal_name),
    ('legal_entity_identifier', new.legal_entity_identifier is distinct from old.legal_entity_identifier),
    ('legal_entity_identifier_kind', new.legal_entity_identifier_kind is distinct from old.legal_entity_identifier_kind),
    ('type', new.type is distinct from old.type)
  ) as f (name, changed)
  where f.changed;
  if jsonb_array_length(v_fields) = 0 then
    return new;
  end if;

  new.review_status := 're_review';
  new.submitted_at := now();
  perform audit.record('partner.returned_to_review', 'organization', new.id::text, jsonb_build_object('fields', v_fields));
  return new;
end;
$$;

revoke all on function private.organizations_return_to_review() from public, anon, authenticated, service_role;

create trigger organizations_return_to_review
  before update of legal_name, legal_entity_identifier, legal_entity_identifier_kind, type on public.organizations
  for each row execute function private.organizations_return_to_review();

alter table public.organizations enable always trigger organizations_return_to_review;

-- Type correction --------------------------------------------------------------------------------------------------

-- The partner type is fixed at sign-up (decision 2.4); only a Platform Administrator at aal2 corrects it, between the two
-- partner types, with a statement of reasons, never on an organisation the administrator belongs to. The trigger above
-- returns a listed partner to review. The identifier links of the organisation are re-evaluated, and the members whose
-- intended type was the old type move to the new one, so their sign-up documents follow the organisation.
create function public.admin_set_organization_type(
  p_org uuid, p_type public.organization_type, p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_old public.organization_type;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  v_reason := private.statement_of_reasons(p_reason);
  if p_type is null or p_type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'type';
  end if;

  select o.type into v_old from public.organizations o where o.id = p_org for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND';
  end if;
  if exists (
    select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = (select auth.uid())
  ) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'own_organization';
  end if;
  if v_old = 'employer' or v_old = p_type then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'type';
  end if;

  update public.organizations set type = p_type where id = p_org;

  update private.organization_identifier_links l
  set same_type = (
    select a.type = b.type from public.organizations a, public.organizations b
    where a.id = l.organization_id and b.id = l.other_organization_id
  )
  where l.organization_id = p_org or l.other_organization_id = p_org;

  perform set_config('chara.correct_organization_type', 'on', true);
  update public.profiles p set intended_organization_type = p_type
  from public.organization_members m
  where m.organization_id = p_org and m.user_id = p.id and p.intended_organization_type = v_old;
  perform set_config('chara.correct_organization_type', 'off', true);

  perform private.audit_admin(
    'organization.type_corrected', 'organization', p_org::text, v_reason,
    jsonb_build_object('from', v_old, 'to', p_type)
  );
end;
$$;

revoke all on function public.admin_set_organization_type(uuid, public.organization_type, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_organization_type(uuid, public.organization_type, text) to authenticated;
