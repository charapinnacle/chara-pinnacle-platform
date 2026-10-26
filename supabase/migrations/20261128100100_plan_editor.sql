-- The plan, limit, feature, override and settings editor (FR-R2; docs/phase-2/DATA_MODEL.md sections 4, 6 and 7;
-- decisions 1.3, 7.1; NFR-O5). A Platform Administrator at aal2 changes plan names, visibility, trial length, limits,
-- features, per-organisation limit overrides and the allow-listed platform settings with a statement of reasons of 10
-- to 500 characters. A call that changes nothing writes nothing. Plan, limit, feature and override rows are audited by
-- their row trigger (private.billing_plan_audit), which takes the reason from chara.audit_reason; a setting change
-- writes setting.changed with the value before and after. Prices are not edited here (V17).
--
-- The editor is not behind a release switch: switching release_* on through it is how a release goes live.

-- The allow-list of the settings editor: the type and range of each editable setting. A setting without a row (the
-- rate limits, the queues, entitlements_enforced, audit_retention_years) is changed by a reviewed migration only. min and
-- max bound an integer value, or the length of a text value. release_feature names the feature of
-- private.legal_release_gaps that a release switch puts live, so the editor can warn before switching it on.
create table private.setting_rules (
  key text primary key references private.settings (key) on delete cascade,
  value_type text not null check (value_type in ('integer', 'boolean', 'text', 'email')),
  min integer,
  max integer,
  editable boolean not null default true,
  label text not null check (char_length(label) between 1 and 120 and label = btrim(label)),
  release_feature text,
  check (key not in ('entitlements_enforced', 'audit_retention_years')),
  check ((value_type in ('integer', 'text')) = (min is not null and max is not null)),
  check (min is null or min <= max),
  check (release_feature is null or (value_type = 'boolean' and key like 'release\_%'))
);

comment on table private.setting_rules is
  'Settings an administrator may change in the console (FR-R2 AC7), with their type and range. entitlements_enforced and audit_retention_years are never listed.';

alter table private.setting_rules enable row level security;
alter table private.setting_rules force row level security;
revoke all on table private.setting_rules from public, anon, authenticated, service_role;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('release_partner_directories', 'boolean', null, null, 'Release 2a: partner accounts and directories', 'partner_accounts'),
  ('partner_dpa_required', 'boolean', null, null, 'Partner data processing agreement required', null),
  ('stats_min_count', 'integer', 5, 100, 'Smallest count shown in statistics', null),
  ('organizations_per_user_max', 'integer', 1, 20, 'Organisations one person may create', null),
  ('workforce_listing_stale_days', 'integer', 7, 365, 'Days until an availability listing is stale', null),
  ('workforce_confirm_reminder_days', 'integer', 1, 364, 'Days until a listing confirmation reminder', null),
  ('workforce_available_from_max_days', 'integer', 30, 1825, 'Latest available-from date of a listing (days ahead)', null),
  ('licence_expiry_reminder_days', 'integer', 1, 180, 'Days before a licence expires that the reminder is sent', null),
  ('licence_valid_until_max_years', 'integer', 1, 50, 'Latest licence expiry accepted (years ahead)', null),
  ('partner_review_target_working_days', 'integer', 1, 20, 'Target for a partner review (working days)', null),
  ('limit_prompt_per_hour_max', 'integer', 1, 1000, 'Upgrade prompts recorded per person and hour', null),
  ('limit_prompt_per_org_key_hour_max', 'integer', 1, 1000, 'Upgrade prompts recorded per organisation, limit and hour', null),
  ('legal_entity_name', 'text', 1, 200, 'Legal entity name', null),
  ('legal_entity_address', 'text', 1, 500, 'Legal entity address', null),
  ('legal_entity_email', 'email', null, null, 'Legal entity email address', null),
  ('legal_entity_registration_number', 'text', 1, 100, 'Commercial register number', null),
  ('legal_entity_vat_id', 'text', 1, 50, 'VAT identification number', null),
  ('privacy_contact', 'text', 1, 500, 'Privacy contact', null),
  ('privacy_contact_email', 'email', null, null, 'Privacy contact email address', null),
  ('data_protection_contact', 'text', 1, 500, 'Data protection officer', null);

-- The statement of reasons of an editor change: the reason rule of every administrative function, at most 500
-- characters here (FR-R2 data and validation). It is handed to the audit row trigger of the billing tables for the
-- rest of the call.
create function private.plan_editor_reason(p_reason text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_reason text := private.statement_of_reasons(p_reason);
begin
  if char_length(v_reason) > 500 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'reason';
  end if;
  perform set_config('chara.audit_reason', v_reason, true);
  return v_reason;
end;
$$;

revoke all on function private.plan_editor_reason(text) from public, anon, authenticated, service_role;

-- The plan row of an editor call, locked for the change; an unknown code names the field.
create function private.plan_editor_plan(p_code text) returns billing.plans
language plpgsql
set search_path = ''
as $$
declare
  v_plan billing.plans;
begin
  select * into v_plan from billing.plans p where p.code = p_code for update;
  if not found then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'plan_code';
  end if;
  return v_plan;
end;
$$;

revoke all on function private.plan_editor_plan(text) from public, anon, authenticated, service_role;

-- Plans --------------------------------------------------------------------------------------------------------------

-- The changes themselves, shared by the single RPCs and admin_update_plan_bundle: each checks its values, writes nothing
-- when the value is already set and returns whether it wrote. The caller has checked the role, taken the reason and
-- locked the plan row.

-- Name, visibility and trial length of a plan. Codes never change and no plan is deleted; only a paid plan may be public.
create function private.plan_editor_set_plan(
  p_plan billing.plans, p_name text, p_is_public boolean, p_trial_days integer
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_name text := btrim(p_name);
begin
  if v_name is null or char_length(v_name) not between 1 and 60 or v_name ~ '[[:cntrl:]]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'name';
  end if;
  if p_trial_days is null or p_trial_days not between 0 and 365 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'trial_days';
  end if;
  if p_is_public is null or (p_is_public and p_plan.price_minor = 0) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'is_public';
  end if;
  if (p_plan.name, p_plan.is_public, p_plan.trial_days) = (v_name, p_is_public, p_trial_days) then
    return false;
  end if;
  update billing.plans set name = v_name, is_public = p_is_public, trial_days = p_trial_days where code = p_plan.code;
  return true;
end;
$$;

revoke all on function private.plan_editor_set_plan(billing.plans, text, boolean, integer) from public, anon, authenticated, service_role;

-- One limit of a plan: an integer 0 to 1,000,000, or null for unlimited; the key must apply to the plan's organisation
-- type. The change is read by the next limit check; nothing is redefined.
create function private.plan_editor_set_limit(p_plan billing.plans, p_limit_key text, p_value integer) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_row billing.plan_limits;
begin
  if not exists (select 1 from billing.limit_keys k where k.key = p_limit_key and p_plan.org_type = any (k.org_types)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'unknown_limit_key';
  end if;
  if p_value not between 0 and 1000000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'limit_value';
  end if;
  select * into v_row from billing.plan_limits l where l.plan_code = p_plan.code and l.limit_key = p_limit_key for update;
  if found and v_row.limit_value is not distinct from p_value then
    return false;
  end if;
  insert into billing.plan_limits (plan_code, limit_key, limit_value) values (p_plan.code, p_limit_key, p_value)
  on conflict (plan_code, limit_key) do update set limit_value = excluded.limit_value;
  return true;
end;
$$;

revoke all on function private.plan_editor_set_limit(billing.plans, text, integer) from public, anon, authenticated, service_role;

-- Switches one feature of a plan on or off; the key must apply to the plan's organisation type.
create function private.plan_editor_set_feature(p_plan billing.plans, p_feature_key text, p_enabled boolean) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_changed integer;
begin
  if not exists (select 1 from billing.feature_keys k where k.key = p_feature_key and p_plan.org_type = any (k.org_types)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'unknown_feature_key';
  end if;
  if p_enabled is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'enabled';
  end if;
  if p_enabled then
    insert into billing.plan_features (plan_code, feature_key) values (p_plan.code, p_feature_key) on conflict do nothing;
  else
    delete from billing.plan_features where plan_code = p_plan.code and feature_key = p_feature_key;
  end if;
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;

revoke all on function private.plan_editor_set_feature(billing.plans, text, boolean) from public, anon, authenticated, service_role;

-- The single changes. Each returns whether anything changed; the audit rows come from the row trigger with the reason.
create function public.admin_update_plan(
  p_code text, p_name text, p_is_public boolean, p_trial_days integer, p_reason text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed boolean;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  perform private.plan_editor_reason(p_reason);
  v_changed := private.plan_editor_set_plan(private.plan_editor_plan(p_code), p_name, p_is_public, p_trial_days);
  perform set_config('chara.audit_reason', '', true);
  return v_changed;
end;
$$;

revoke all on function public.admin_update_plan(text, text, boolean, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_plan(text, text, boolean, integer, text) to authenticated;

-- The defaults let a client leave p_value out for unlimited; a missing reason is refused like any other.
create function public.admin_set_plan_limit(
  p_code text, p_limit_key text, p_value integer default null, p_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed boolean;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  perform private.plan_editor_reason(p_reason);
  v_changed := private.plan_editor_set_limit(private.plan_editor_plan(p_code), p_limit_key, p_value);
  perform set_config('chara.audit_reason', '', true);
  return v_changed;
end;
$$;

revoke all on function public.admin_set_plan_limit(text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_plan_limit(text, text, integer, text) to authenticated;

create function public.admin_set_plan_feature(p_code text, p_feature_key text, p_enabled boolean, p_reason text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed boolean;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  perform private.plan_editor_reason(p_reason);
  v_changed := private.plan_editor_set_feature(private.plan_editor_plan(p_code), p_feature_key, p_enabled);
  perform set_config('chara.audit_reason', '', true);
  return v_changed;
end;
$$;

revoke all on function public.admin_set_plan_feature(text, text, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_plan_feature(text, text, boolean, text) to authenticated;

-- One edit of the console as one transaction: the plan fields, limits and features of p_changes with one reason, all or
-- nothing (FR-R2 AC10). p_changes is {"plan": {"name", "is_public", "trial_days"} | null, "limits": [{"key", "value"}],
-- "features": [{"key", "enabled"}]}; each part may carry "expected", the value the editor showed (for the plan an object
-- of the three fields), and a change whose current value differs raises CHARA_CONFLICT naming it, so an edit made from a
-- stale page overwrites nothing. Returns the number of rows changed; 0 writes nothing.
create function public.admin_update_plan_bundle(p_code text, p_changes jsonb, p_reason text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan billing.plans;
  v_part jsonb;
  v_value integer;
  v_changed integer := 0;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  perform private.plan_editor_reason(p_reason);
  v_plan := private.plan_editor_plan(p_code);
  if p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or jsonb_typeof(coalesce(p_changes -> 'plan', 'null')) not in ('object', 'null')
     or jsonb_typeof(coalesce(p_changes -> 'limits', '[]')) <> 'array'
     or jsonb_typeof(coalesce(p_changes -> 'features', '[]')) <> 'array' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'changes';
  end if;

  v_part := p_changes -> 'plan';
  if jsonb_typeof(v_part) = 'object' then
    if v_part ? 'expected' and (
      v_part -> 'expected' ->> 'name' is distinct from v_plan.name
      or (v_part -> 'expected' ->> 'is_public')::boolean is distinct from v_plan.is_public
      or (v_part -> 'expected' ->> 'trial_days')::integer is distinct from v_plan.trial_days
    ) then
      raise exception 'CHARA_CONFLICT' using detail = 'plan';
    end if;
    if jsonb_typeof(v_part -> 'is_public') is distinct from 'boolean' or jsonb_typeof(v_part -> 'trial_days') is distinct from 'number'
       or jsonb_typeof(v_part -> 'name') is distinct from 'string' or v_part ->> 'trial_days' !~ '^[0-9]{1,9}$' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'changes';
    end if;
    if private.plan_editor_set_plan(v_plan, v_part ->> 'name', (v_part ->> 'is_public')::boolean, (v_part ->> 'trial_days')::integer) then
      v_changed := v_changed + 1;
    end if;
  end if;

  for v_part in select e from jsonb_array_elements(coalesce(p_changes -> 'limits', '[]')) e loop
    if jsonb_typeof(v_part -> 'key') is distinct from 'string' or coalesce(jsonb_typeof(v_part -> 'value'), 'missing') not in ('number', 'null')
       or (v_part ->> 'value' is not null and v_part ->> 'value' !~ '^[0-9]{1,9}$') then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'changes';
    end if;
    v_value := (v_part ->> 'value')::integer;
    if v_part ? 'expected' and (v_part ->> 'expected')::integer is distinct from (
      select l.limit_value from billing.plan_limits l where l.plan_code = p_code and l.limit_key = v_part ->> 'key'
    ) then
      raise exception 'CHARA_CONFLICT' using detail = 'limit:' || (v_part ->> 'key');
    end if;
    if private.plan_editor_set_limit(v_plan, v_part ->> 'key', v_value) then
      v_changed := v_changed + 1;
    end if;
  end loop;

  for v_part in select e from jsonb_array_elements(coalesce(p_changes -> 'features', '[]')) e loop
    if jsonb_typeof(v_part -> 'key') is distinct from 'string' or jsonb_typeof(v_part -> 'enabled') is distinct from 'boolean' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'changes';
    end if;
    if v_part ? 'expected' and (v_part ->> 'expected')::boolean is distinct from exists (
      select 1 from billing.plan_features f where f.plan_code = p_code and f.feature_key = v_part ->> 'key'
    ) then
      raise exception 'CHARA_CONFLICT' using detail = 'feature:' || (v_part ->> 'key');
    end if;
    if private.plan_editor_set_feature(v_plan, v_part ->> 'key', (v_part ->> 'enabled')::boolean) then
      v_changed := v_changed + 1;
    end if;
  end loop;

  perform set_config('chara.audit_reason', '', true);
  return v_changed;
end;
$$;

revoke all on function public.admin_update_plan_bundle(text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_plan_bundle(text, jsonb, text) to authenticated;

-- Overrides ----------------------------------------------------------------------------------------------------------

-- An individual limit for an organisation on an Enterprise plan (a plan sold on request, or an *_enterprise code), with
-- an expiry date in the future. The override replaces the plan limit until it expires; it cannot express unlimited.
create function public.admin_set_limit_override(
  p_org uuid, p_limit_key text, p_value integer, p_expires_at timestamptz, p_reason text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.organization_type;
  v_row billing.organization_limit_overrides;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  perform private.plan_editor_reason(p_reason);
  select o.type into v_type from public.organizations o where o.id = p_org;
  if not found then
    raise exception 'CHARA_NOT_FOUND';
  end if;
  if not exists (
    select 1 from billing.plans p
    where p.code = private.org_plan_code(p_org) and (p.contact_sales or p.code like '%\_enterprise')
  ) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'override_enterprise_only';
  end if;
  if not exists (select 1 from billing.limit_keys k where k.key = p_limit_key and v_type = any (k.org_types)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'unknown_limit_key';
  end if;
  if p_value is null or p_value not between 0 and 1000000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'limit_value';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'expires_at';
  end if;

  select * into v_row from billing.organization_limit_overrides o
  where o.organization_id = p_org and o.limit_key = p_limit_key for update;
  if found and v_row.limit_value = p_value and v_row.expires_at is not distinct from p_expires_at then
    return false;
  end if;
  insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value, expires_at)
  values (p_org, p_limit_key, p_value, p_expires_at)
  on conflict (organization_id, limit_key) do update set limit_value = excluded.limit_value, expires_at = excluded.expires_at;
  perform set_config('chara.audit_reason', '', true);
  return true;
end;
$$;

revoke all on function public.admin_set_limit_override(uuid, text, integer, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_limit_override(uuid, text, integer, timestamptz, text) to authenticated;

-- Removes an override, active or expired; the plan limit applies again at once.
create function public.admin_remove_limit_override(p_org uuid, p_limit_key text, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  perform private.plan_editor_reason(p_reason);
  delete from billing.organization_limit_overrides where organization_id = p_org and limit_key = p_limit_key;
  if not found then
    raise exception 'CHARA_NOT_FOUND';
  end if;
  perform set_config('chara.audit_reason', '', true);
end;
$$;

revoke all on function public.admin_remove_limit_override(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_remove_limit_override(uuid, text, text) to authenticated;

-- Settings -----------------------------------------------------------------------------------------------------------

-- One allow-listed setting, given as text and stored as the jsonb of its type (an integer, a boolean or a string, read
-- as value #>> '{}' like every setting). A setting outside the allow-list is refused without saying whether it exists. A
-- release switch is refused on (CHARA_FORBIDDEN release_legal_gaps) while private.legal_release_gaps names a document.
create function public.admin_set_setting(p_key text, p_value text, p_reason text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_rule private.setting_rules;
  v_text text := btrim(p_value);
  v_new jsonb;
  v_old jsonb;
  v_gaps text;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  v_reason := private.plan_editor_reason(p_reason);
  perform set_config('chara.audit_reason', '', true);
  select * into v_rule from private.setting_rules r where r.key = p_key and r.editable;
  if not found then
    raise exception 'CHARA_FORBIDDEN' using detail = 'setting_not_editable';
  end if;
  if v_text is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'value';
  end if;

  if v_rule.value_type = 'integer' then
    if v_text !~ '^-?[0-9]{1,9}$' or v_text::integer not between v_rule.min and v_rule.max then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'value';
    end if;
    v_new := to_jsonb(v_text::integer);
  elsif v_rule.value_type = 'boolean' then
    if v_text not in ('true', 'false') then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'value';
    end if;
    v_new := to_jsonb(v_text::boolean);
  elsif v_rule.value_type = 'email' then
    if char_length(v_text) > 254 or v_text !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'value';
    end if;
    v_new := to_jsonb(v_text);
  else
    if char_length(v_text) not between v_rule.min and v_rule.max or v_text ~ '[[:cntrl:]]' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'value';
    end if;
    v_new := to_jsonb(v_text);
  end if;

  select s.value into v_old from private.settings s where s.key = p_key for update;
  if v_old = v_new then
    return false;
  end if;
  -- The go-live gate: a release switch goes on only while every legal document of its release is published and
  -- approved. Switching a release off is always allowed. The documents are named in the hint.
  if v_rule.release_feature is not null and v_new = 'true'::jsonb then
    select string_agg(g.slug || ':' || g.state, ',') into v_gaps from private.legal_release_gaps(v_rule.release_feature) g;
    if v_gaps is not null then
      raise exception 'CHARA_FORBIDDEN' using detail = 'release_legal_gaps', hint = v_gaps;
    end if;
  end if;
  update private.settings set value = v_new where key = p_key;
  perform private.audit_admin('setting.changed', 'setting', p_key, v_reason, jsonb_build_object('before', v_old, 'after', v_new));
  return true;
end;
$$;

revoke all on function public.admin_set_setting(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_setting(text, text, text) to authenticated;

-- Reads --------------------------------------------------------------------------------------------------------------

-- Every plan, sold or not, with every limit and feature key of its organisation type (the catalogue labels, the value or
-- whether it is on): the console lists the plans that public.v_plans hides. A limit key without a row reads as
-- unlimited (defined false), as private.org_limit reads it.
create function public.admin_list_plans()
returns table (
  code text, org_type public.organization_type, name text, price_minor integer, currency text, trial_days integer,
  is_public boolean, contact_sales boolean, sort integer, limits jsonb, features jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  return query
  select p.code, p.org_type, p.name, p.price_minor, p.currency, p.trial_days, p.is_public, p.contact_sales, p.sort,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', k.key, 'label', k.label, 'period', k.period, 'value', l.limit_value, 'defined', l.plan_code is not null
      ) order by k.label)
      from billing.limit_keys k
      left join billing.plan_limits l on l.plan_code = p.code and l.limit_key = k.key
      where p.org_type = any (k.org_types)
    ), '[]'),
    coalesce((
      select jsonb_agg(jsonb_build_object('key', k.key, 'label', k.label, 'enabled', f.plan_code is not null) order by k.label)
      from billing.feature_keys k
      left join billing.plan_features f on f.plan_code = p.code and f.feature_key = k.key
      where p.org_type = any (k.org_types)
    ), '[]')
  from billing.plans p
  order by p.sort, p.code;
end;
$$;

revoke all on function public.admin_list_plans() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_plans() to authenticated;

-- The changes of one plan from the audit log, newest first: the administrator, the table and key changed with its
-- catalogue label, the values before and after and the reason. Rows written by a migration have no administrator.
-- Prices and provider references are plan data; no customer, subscription or payment data is read.
create function public.admin_list_plan_history(p_code text, p_limit integer default 50, p_before_id bigint default null)
returns table (
  id bigint, created_at timestamptz, actor_id uuid, actor_name text, table_name text, operation text, limit_key text,
  feature_key text, label text, before jsonb, after jsonb, reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  return query
  select l.id, l.created_at, l.actor_id, coalesce(pr.display_name, u.email::text), l.metadata ->> 'table',
    l.metadata ->> 'operation', l.metadata ->> 'limit_key', l.metadata ->> 'feature_key', coalesce(lk.label, fk.label),
    l.metadata -> 'before', l.metadata -> 'after', l.metadata ->> 'reason'
  from audit.log l
  left join public.profiles pr on pr.id = l.actor_id
  left join auth.users u on u.id = l.actor_id
  left join billing.limit_keys lk on lk.key = l.metadata ->> 'limit_key'
  left join billing.feature_keys fk on fk.key = l.metadata ->> 'feature_key'
  where l.action = 'billing.plan_changed' and l.entity_type = 'plan' and l.entity_id = p_code
    and (p_before_id is null or l.id < p_before_id)
  order by l.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.admin_list_plan_history(text, integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_plan_history(text, integer, bigint) to authenticated;

-- Every limit override, active ones first, with the plan limit it replaces and the reason of its latest change.
create function public.admin_list_limit_overrides()
returns table (
  organization_id uuid, organization_name text, plan_code text, limit_key text, limit_label text, limit_value integer,
  plan_limit integer, expires_at timestamptz, expired boolean, reason text, changed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  return query
  select o.organization_id, org.display_name, private.org_plan_code(o.organization_id), o.limit_key, k.label, o.limit_value,
    (select l.limit_value from billing.plan_limits l where l.plan_code = private.org_plan_code(o.organization_id) and l.limit_key = o.limit_key),
    o.expires_at, coalesce(o.expires_at <= now(), false), a.reason, a.created_at
  from billing.organization_limit_overrides o
  join public.organizations org on org.id = o.organization_id
  left join billing.limit_keys k on k.key = o.limit_key
  left join lateral (
    select l.metadata ->> 'reason' as reason, l.created_at
    from audit.log l
    where l.action = 'billing.plan_changed' and l.entity_type = 'organization' and l.entity_id = o.organization_id::text
      and l.metadata ->> 'table' = 'organization_limit_overrides' and l.metadata ->> 'limit_key' = o.limit_key
    order by l.id desc
    limit 1
  ) a on true
  order by coalesce(o.expires_at <= now(), false), org.display_name, o.limit_key;
end;
$$;

revoke all on function public.admin_list_limit_overrides() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_limit_overrides() to authenticated;

-- The organisations that may get an override: those whose plan is an Enterprise plan.
create function public.admin_list_enterprise_organizations()
returns table (id uuid, display_name text, org_type public.organization_type, plan_code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  return query
  select o.id, o.display_name, o.type, s.plan_code
  from billing.subscriptions s
  join public.organizations o on o.id = s.organization_id
  join billing.plans p on p.code = s.plan_code
  where s.status in ('trialing', 'active', 'past_due') and (p.contact_sales or p.code like '%\_enterprise')
  order by o.display_name, o.id;
end;
$$;

revoke all on function public.admin_list_enterprise_organizations() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_enterprise_organizations() to authenticated;

-- The allow-listed settings with their current value and rule; a release switch also lists the legal documents that
-- still stop its release (private.legal_release_gaps), as 'slug:state'.
create function public.admin_list_settings()
returns table (
  key text, label text, value text, value_type text, min integer, max integer, release_feature text, release_gaps text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  return query
  select r.key, r.label, s.value #>> '{}', r.value_type, r.min, r.max, r.release_feature,
    case when r.release_feature is not null then coalesce(
      (select array_agg(g.slug || ':' || g.state) from private.legal_release_gaps(r.release_feature) g), '{}'
    ) end
  from private.setting_rules r
  join private.settings s on s.key = r.key
  where r.editable
  order by r.release_feature is null, r.value_type, r.key;
end;
$$;

revoke all on function public.admin_list_settings() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_settings() to authenticated;
