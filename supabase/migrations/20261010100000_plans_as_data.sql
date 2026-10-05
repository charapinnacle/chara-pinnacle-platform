-- Plans as data (FR-G1; ARCHITECTURE.md sections 5.1, 10.1, 10.4; OPEN_QUESTIONS.md C1 to C3, C10, C11, D4, D5, D15, D36,
-- D38, D40). The schema billing, owned by the role billing_owner, holds plans, their limits and features, per-organization
-- limit overrides and subscriptions. Plans, limits and features are rows: the seeds in seeds/ref load them and a
-- reviewed migration changes them; no API role can write them and no RPC edits them. Subscriptions are written only by
-- the billing webhook (FR-G3); none is created with an organization (D4). The entitlement helpers read these tables.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'billing_owner') then
    create role billing_owner nologin;
  end if;
end;
$$;

grant billing_owner to postgres;
create schema billing authorization billing_owner;
revoke all on schema billing from public;
grant usage on schema billing to anon, authenticated;

-- The tables are created by postgres, so the foreign keys are checked with its rights, and handed to billing_owner at
-- the end. Row level security is forced everywhere and BYPASSRLS is not inherited through role membership, so every
-- table has a policy for billing_owner.

create table billing.plans (
  code text primary key check (length(code) between 3 and 64 and code ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  org_type public.organization_type not null,
  name text not null check (length(name) between 1 and 60 and name = btrim(name)),
  price_minor integer not null check (price_minor >= 0),
  currency text not null references public.currencies (code),
  interval text not null check (interval in ('month')),
  trial_days integer not null default 30 check (trial_days between 0 and 365),
  is_public boolean not null,
  is_default_trial boolean not null default false,
  contact_sales boolean not null default false,
  sort integer not null
);

comment on table billing.plans is
  'Plan records (FR-G1). Prices are EUR minor units, exclusive of VAT. Plan codes never change; names, prices, trial_days and visibility are changed by a reviewed migration.';

create table billing.plan_limits (
  plan_code text not null references billing.plans (code) on delete cascade,
  limit_key text not null check (limit_key ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  limit_value integer check (limit_value >= 0),
  primary key (plan_code, limit_key)
);

comment on column billing.plan_limits.limit_value is 'Null means unlimited.';

create table billing.plan_features (
  plan_code text not null references billing.plans (code) on delete cascade,
  feature_key text not null check (feature_key ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  primary key (plan_code, feature_key)
);

create table billing.organization_limit_overrides (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  limit_key text not null check (limit_key ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  limit_value integer not null check (limit_value >= 0),
  primary key (organization_id, limit_key)
);

comment on table billing.organization_limit_overrides is
  'A row replaces the plan limit of one organization (Enterprise values raised under fair use).';

create table billing.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  plan_code text not null references billing.plans (code),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'paused')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  past_due_since timestamptz,
  last_provider_event_at timestamptz,
  provider text not null check (provider in ('null', 'stripe')),
  provider_customer_ref text,
  provider_subscription_ref text,
  created_at timestamptz not null default now()
);

comment on table billing.subscriptions is
  'Written only by the billing webhook. An organization without a non-canceled row is on the free plan of its type (private.org_plan_code).';

-- The plan lookup, the foreign key and the trial lookup of private.legal_entity_trial_used read by organization.
create index subscriptions_organization_idx on billing.subscriptions (organization_id);
create unique index subscriptions_one_live_per_organization
  on billing.subscriptions (organization_id) where status <> 'canceled';
create index subscriptions_plan_idx on billing.subscriptions (plan_code);
-- Serves the policy predicate of plans_select_public and the pricing page (public plans of a type in display order).
create index plans_public_idx on billing.plans (org_type, sort) where is_public;

alter table billing.plans owner to billing_owner;
alter table billing.plan_limits owner to billing_owner;
alter table billing.plan_features owner to billing_owner;
alter table billing.organization_limit_overrides owner to billing_owner;
alter table billing.subscriptions owner to billing_owner;

alter table billing.plans enable row level security;
alter table billing.plans force row level security;
alter table billing.plan_limits enable row level security;
alter table billing.plan_limits force row level security;
alter table billing.plan_features enable row level security;
alter table billing.plan_features force row level security;
alter table billing.organization_limit_overrides enable row level security;
alter table billing.organization_limit_overrides force row level security;
alter table billing.subscriptions enable row level security;
alter table billing.subscriptions force row level security;

revoke all on all tables in schema billing from public, anon, authenticated, service_role;

create policy plans_all_billing_owner on billing.plans
  for all to billing_owner using (true) with check (true);
create policy plan_limits_all_billing_owner on billing.plan_limits
  for all to billing_owner using (true) with check (true);
create policy plan_features_all_billing_owner on billing.plan_features
  for all to billing_owner using (true) with check (true);
create policy organization_limit_overrides_all_billing_owner on billing.organization_limit_overrides
  for all to billing_owner using (true) with check (true);
create policy subscriptions_all_billing_owner on billing.subscriptions
  for all to billing_owner using (true) with check (true);

-- The session helpers are defined before the policies that call them.
create function private.org_plan_code(p_org uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when s.status in ('trialing', 'active', 'past_due') then s.plan_code end
     from billing.subscriptions s
     where s.organization_id = p_org and s.status <> 'canceled'
     order by s.created_at desc
     limit 1),
    'free_' || (select o.type::text from public.organizations o where o.id = p_org)
  )
$$;

revoke all on function private.org_plan_code(uuid) from public, anon, authenticated, service_role;
grant execute on function private.org_plan_code(uuid) to authenticated;

-- Everyone reads the public plans; a member also reads the plan their organization is on, so that the plan name of a
-- subscription resolves for a plan that is not sold (the fallback plan, Enterprise). Limits and features follow the
-- visibility of their plan through the plans policies.
grant select on billing.plans, billing.plan_limits, billing.plan_features to anon, authenticated;

create policy plans_select_public on billing.plans
  for select to anon, authenticated
  using (is_public);
create policy plans_select_own_organization on billing.plans
  for select to authenticated
  using (code in (select private.org_plan_code(o) from private.member_org_ids() o));
create policy plan_limits_select on billing.plan_limits
  for select to anon, authenticated
  using (plan_code in (select p.code from billing.plans p));
create policy plan_features_select on billing.plan_features
  for select to anon, authenticated
  using (plan_code in (select p.code from billing.plans p));

-- Owners and admins read the subscription of their organization at aal2 (D8); provider references are not granted.
grant select (
  id, organization_id, plan_code, status, trial_ends_at, current_period_start, current_period_end, cancel_at,
  past_due_since, created_at
) on billing.subscriptions to authenticated;

create policy subscriptions_select_admin on billing.subscriptions
  for select to authenticated
  using (organization_id in (select private.member_org_ids('admin')));
create policy subscriptions_requires_mfa on billing.subscriptions
  as restrictive for select to authenticated
  using ((select private.is_aal2()));

create view public.v_plans with (security_invoker = true) as
select
  p.code, p.org_type, p.name, p.price_minor, p.currency, p.interval, p.trial_days, p.is_public, p.is_default_trial,
  p.contact_sales, p.sort,
  coalesce((select jsonb_object_agg(l.limit_key, l.limit_value) from billing.plan_limits l where l.plan_code = p.code), '{}') as limits,
  coalesce((select jsonb_agg(f.feature_key order by f.feature_key) from billing.plan_features f where f.plan_code = p.code), '[]') as features
from billing.plans p;

-- One row per organization: its live subscription, otherwise the newest canceled one.
create view public.v_my_subscription with (security_invoker = true) as
select distinct on (s.organization_id)
  s.organization_id, s.plan_code, p.name as plan_name, s.status, s.trial_ends_at, s.current_period_end, s.cancel_at,
  s.past_due_since
from billing.subscriptions s
left join billing.plans p on p.code = s.plan_code
order by s.organization_id, (s.status = 'canceled'), s.created_at desc;

revoke all on public.v_plans, public.v_my_subscription from public, anon, authenticated, service_role;
grant select on public.v_plans to anon, authenticated;
grant select on public.v_my_subscription to authenticated;

-- One audit row per changed plan, limit, feature or override. Migrations run as postgres, so actor_id is null for them;
-- an update records the changed columns only.
create function private.billing_plan_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_code text := case tg_table_name when 'plans' then v_row ->> 'code' else v_row ->> 'plan_code' end;
begin
  if tg_op = 'UPDATE' then
    if v_old = v_new then
      return null;
    end if;
    select jsonb_object_agg(n.key, o.value), jsonb_object_agg(n.key, n.value)
    into v_old, v_new
    from jsonb_each(v_new) n
    join jsonb_each(v_old) o on o.key = n.key
    where n.value is distinct from o.value;
  end if;

  perform audit.record(
    'billing.plan_changed', 'plan', v_code,
    jsonb_build_object('table', tg_table_name, 'plan_code', v_code, 'operation', lower(tg_op), 'before', v_old, 'after', v_new)
  );
  return null;
end;
$$;

revoke all on function private.billing_plan_audit() from public, anon, authenticated, service_role;

create trigger plans_audit
  after insert or update or delete on billing.plans
  for each row execute function private.billing_plan_audit();
create trigger plan_limits_audit
  after insert or update or delete on billing.plan_limits
  for each row execute function private.billing_plan_audit();
create trigger plan_features_audit
  after insert or update or delete on billing.plan_features
  for each row execute function private.billing_plan_audit();
create trigger organization_limit_overrides_audit
  after insert or update or delete on billing.organization_limit_overrides
  for each row execute function private.billing_plan_audit();

-- Entitlements (ARCHITECTURE.md section 10.4). The fallback plan 'free_' || organization type is used for an organization
-- without a live subscription; a plan code with no row in billing.plans denies. The limits are not enforced while
-- private.settings.entitlements_enforced (inserted by the team migration) is false, except for a lapsed organization:
-- one that is on a free plan and has a subscription row, all of them canceled (C11).
create or replace function private.org_limit(p_org uuid, p_key text) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.limit_value from billing.organization_limit_overrides o where o.organization_id = p_org and o.limit_key = p_key),
    (select l.limit_value from billing.plan_limits l where l.plan_code = private.org_plan_code(p_org) and l.limit_key = p_key)
  )
$$;

create function private.free_plan_restricted(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.org_plan_code(p_org) like 'free\_%'
    and (
      coalesce((select (value #>> '{}')::boolean from private.settings where key = 'entitlements_enforced'), false)
      or exists (select 1 from billing.subscriptions s where s.organization_id = p_org)
    )
$$;

create function private.has_feature(p_org uuid, p_key text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not coalesce((select (value #>> '{}')::boolean from private.settings where key = 'entitlements_enforced'), false)
    or exists (
      select 1 from billing.plan_features f
      where f.plan_code = private.org_plan_code(p_org) and f.feature_key = p_key
    )
$$;

create or replace function private.assert_within_limit(p_org uuid, p_key text, p_current integer) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if not coalesce((select (value #>> '{}')::boolean from private.settings where key = 'entitlements_enforced'), false)
     and not private.free_plan_restricted(p_org) then
    return;
  end if;
  if not exists (select 1 from billing.plans p where p.code = private.org_plan_code(p_org)) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'unknown_plan', errcode = '42501';
  end if;
  v_limit := private.org_limit(p_org, p_key);
  if v_limit is not null and p_current >= v_limit then
    raise exception 'CHARA_LIMIT_REACHED' using detail = p_key, errcode = 'P0001';
  end if;
end;
$$;

revoke all on function private.free_plan_restricted(uuid) from public, anon, authenticated, service_role;
revoke all on function private.has_feature(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.org_limit(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.assert_within_limit(uuid, text, integer) from public, anon, authenticated, service_role;

-- The employer registration migration left two placeholders (D36). The trial flag is true when another organization
-- with the same identifier has a subscription that ever had a trial; an organization without an identifier never
-- matches. The lock holds once the organization has a subscription row; U45 adds billing.customers to it.
create or replace function private.legal_entity_trial_used(p_identifier text) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations o
    join billing.subscriptions s on s.organization_id = o.id
    where o.legal_entity_identifier = p_identifier and s.trial_ends_at is not null
  )
$$;

create or replace function private.legal_entity_locked(p_org uuid) returns boolean
language sql
stable
set search_path = ''
as $$ select exists (select 1 from billing.subscriptions s where s.organization_id = p_org) $$;

create index organizations_legal_entity_identifier
  on public.organizations (legal_entity_identifier) where legal_entity_identifier is not null;
