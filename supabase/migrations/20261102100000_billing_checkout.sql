-- Checkout and portal (FR-G2; ARCHITECTURE.md sections 10.1, 10.2; OPEN_QUESTIONS.md D4, D36, D40, C14, C15, L9). The
-- billing customer carries the tax data and the legal-entity identifiers of the checkout; the trial ledger holds the
-- identifiers that already had a free trial; the provider references of the plans are written by the Stripe mirror
-- script (FR-G1). Checkout and portal start through RPCs that the billing-checkout Edge Function calls with the
-- caller's own token: the role, the second step, the terms, the tax input and the trial rule are checked here, in one
-- transaction, and a refused call leaves no row. The webhook (FR-G3) links the customer reference and writes the
-- trial ledger and the subscription.

-- Upper case, with spaces, dots, hyphens and slashes removed; null for an empty value.
create function private.normalize_legal_identifier(p_value text) returns text
language sql
immutable
set search_path = ''
as $$ select nullif(upper(regexp_replace(coalesce(p_value, ''), '[\s.\-/]', '', 'g')), '') $$;

revoke all on function private.normalize_legal_identifier(text) from public, anon, authenticated, service_role;

create table billing.customers (
  organization_id uuid primary key references public.organizations (id),
  provider text not null check (provider in ('null', 'stripe')),
  customer_ref text check (customer_ref <> ''),
  billing_country text not null references public.countries (code),
  vat_id text check (vat_id ~ '^[A-Z]{2}[A-Z0-9]{6,12}$'),
  registration_number text check (registration_number ~ '^[A-Z0-9]{4,32}$'),
  created_at timestamptz not null default now(),
  constraint customers_has_identifier check (vat_id is not null or registration_number is not null)
);

comment on table billing.customers is
  'One billing customer per organization, written by billing_checkout_start; customer_ref is set by the webhook (FR-G3).';

-- The webhook finds the customer of an event by its reference.
create unique index customers_provider_ref on billing.customers (provider, customer_ref) where customer_ref is not null;

create table billing.trial_grants (
  identifier_key text primary key check (identifier_key ~ '^(vat:[A-Z]{2}[A-Z0-9]{6,12}|reg:[A-Z]{2}:[A-Z0-9]{4,32})$'),
  organization_id uuid not null references public.organizations (id),
  granted_at timestamptz not null default now()
);

comment on table billing.trial_grants is
  'One row per legal-entity identifier that had a free trial: vat:<VAT ID> or reg:<country>:<registration number>, normalised. Written by the webhook when the first trialing subscription is applied (FR-G3).';

-- The lookup of an organization's own earlier trials.
create index trial_grants_organization_idx on billing.trial_grants (organization_id);

create table billing.plan_provider_refs (
  plan_code text not null references billing.plans (code),
  provider text not null check (provider in ('stripe')),
  provider_product_ref text not null check (provider_product_ref <> ''),
  provider_price_ref text check (provider_price_ref <> ''),
  primary key (plan_code, provider)
);

comment on table billing.plan_provider_refs is
  'The product and price of a plan at the provider, written only by scripts/sync-stripe-plans.mjs and never exposed through a view.';

alter table billing.customers owner to billing_owner;
alter table billing.trial_grants owner to billing_owner;
alter table billing.plan_provider_refs owner to billing_owner;

alter table billing.customers enable row level security;
alter table billing.customers force row level security;
alter table billing.trial_grants enable row level security;
alter table billing.trial_grants force row level security;
alter table billing.plan_provider_refs enable row level security;
alter table billing.plan_provider_refs force row level security;

revoke all on billing.customers, billing.trial_grants, billing.plan_provider_refs from public, anon, authenticated, service_role;

create policy customers_all_billing_owner on billing.customers
  for all to billing_owner using (true) with check (true);
create policy trial_grants_all_billing_owner on billing.trial_grants
  for all to billing_owner using (true) with check (true);
create policy plan_provider_refs_all_billing_owner on billing.plan_provider_refs
  for all to billing_owner using (true) with check (true);

create trigger plan_provider_refs_audit
  after insert or update or delete on billing.plan_provider_refs
  for each row execute function private.billing_plan_audit();

-- A billing customer also locks the identifier of the organization: the identifier a trial was granted for cannot be
-- swapped for another one once checkout has started (replaces the version of the plans migration).
create or replace function private.legal_entity_locked(p_org uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from billing.subscriptions s where s.organization_id = p_org)
    or exists (select 1 from billing.customers c where c.organization_id = p_org)
$$;

-- Whether a free trial was already used, by the organization itself or by the legal entity: a trial grant of the
-- organization or of one of the submitted identifiers, a subscription of the organization that had a trial, or another
-- organization with the stored or a submitted identifier whose subscription had one. The identifiers are normalised.
create function private.billing_trial_used(p_org uuid, p_country text, p_vat text, p_reg text) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from billing.subscriptions s where s.organization_id = p_org and s.trial_ends_at is not null)
    or exists (select 1 from billing.trial_grants g where g.organization_id = p_org)
    or exists (
      select 1 from billing.trial_grants g
      where g.identifier_key = any (array_remove(array[
        case when p_vat is not null then 'vat:' || p_vat end,
        case when p_reg is not null and p_country is not null then 'reg:' || p_country || ':' || p_reg end
      ], null))
    )
    or private.legal_entity_trial_used((select o.legal_entity_identifier from public.organizations o where o.id = p_org))
    or private.legal_entity_trial_used(p_vat)
    or private.legal_entity_trial_used(p_reg)
$$;

revoke all on function private.billing_trial_used(uuid, text, text, text) from public, anon, authenticated, service_role;

create function private.assert_billing_manager(p_org uuid) returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;
end;
$$;

revoke all on function private.assert_billing_manager(uuid) from public, anon, authenticated, service_role;

-- Starts a checkout for p_org as an owner or admin at aal2 of an active organization. The checks come first and write
-- nothing; then the customer's tax data, the acceptance of the Subscription and Billing Terms (the consent purpose is
-- the slug of the document) and the audit row are written together. Returns what the function needs to create the
-- hosted session: the price at the provider, the customer reference if the webhook has linked one, the trial length
-- (0 for a legal entity that already had a trial) and the slug of the organization for the return address. The caller
-- states the trial length they were shown (p_disclosed_trial_days), so that an identifier that changes the answer
-- cannot start a trial, or a charge, that was not disclosed.
create function public.billing_checkout_start(
  p_org uuid,
  p_plan_code text,
  p_billing_country text,
  p_vat_id text,
  p_registration_number text,
  p_terms_version integer,
  p_provider text default 'null',
  p_disclosed_trial_days integer default null
) returns table (price_ref text, customer_ref text, trial_days integer, slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
  v_plan billing.plans;
  v_country text := upper(btrim(p_billing_country));
  v_vat text := private.normalize_legal_identifier(p_vat_id);
  v_reg text := private.normalize_legal_identifier(p_registration_number);
  v_terms integer;
  v_price_ref text;
  v_customer_ref text;
  v_used boolean;
  v_trial integer;
begin
  perform private.assert_org_manager(p_org, 'admin');
  select * into v_org from public.organizations o where o.id = p_org;

  if p_provider is null or p_provider not in ('null', 'stripe') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'provider', errcode = '22023';
  end if;
  select * into v_plan from billing.plans p where p.code = p_plan_code;
  if not found then
    raise exception 'CHARA_FORBIDDEN' using detail = 'unknown_plan';
  end if;
  if not v_plan.is_public or v_plan.price_minor <= 0 or v_plan.contact_sales or v_plan.org_type <> v_org.type then
    raise exception 'CHARA_FORBIDDEN' using detail = 'plan_not_sold';
  end if;

  if v_country is null or v_country !~ '^[A-Z]{2}$' or not exists (select 1 from public.countries c where c.code = v_country) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'billing_country', errcode = '22023';
  end if;
  if v_vat is null and v_reg is null then
    if v_org.legal_entity_identifier is null then
      raise exception 'CHARA_FORBIDDEN' using detail = 'legal_entity_identifier_required';
    end if;
    raise exception 'CHARA_INVALID_INPUT' using detail = 'identifier', errcode = '22023';
  end if;
  if v_vat is not null and v_vat !~ '^[A-Z]{2}[A-Z0-9]{6,12}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'vat_id', errcode = '22023';
  end if;
  if v_reg is not null and v_reg !~ '^[A-Z0-9]{4,32}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'registration_number', errcode = '22023';
  end if;

  v_terms := private.current_legal_version('subscription-and-billing-terms');
  if v_terms is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'terms_not_published';
  end if;
  if p_terms_version is distinct from v_terms then
    raise exception 'CHARA_FORBIDDEN' using detail = 'terms_version_mismatch';
  end if;

  if exists (select 1 from billing.subscriptions s where s.organization_id = p_org and s.status <> 'canceled') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'already_subscribed';
  end if;

  select r.provider_price_ref into v_price_ref
  from billing.plan_provider_refs r where r.plan_code = p_plan_code and r.provider = p_provider;
  if p_provider = 'stripe' and v_price_ref is null then
    raise exception 'CHARA_UNAVAILABLE' using detail = 'plan_not_synced';
  end if;

  v_used := private.billing_trial_used(p_org, v_country, v_vat, v_reg);
  v_trial := case when v_used then 0 else v_plan.trial_days end;
  if p_disclosed_trial_days is not null and p_disclosed_trial_days <> v_trial then
    raise exception 'CHARA_FORBIDDEN' using detail = 'trial_changed';
  end if;

  insert into billing.customers as c (organization_id, provider, billing_country, vat_id, registration_number)
  values (p_org, p_provider, v_country, v_vat, v_reg)
  on conflict (organization_id) do update
    set customer_ref = case when c.provider = excluded.provider then c.customer_ref end,
        provider = excluded.provider,
        billing_country = excluded.billing_country,
        vat_id = excluded.vat_id,
        registration_number = excluded.registration_number
  returning c.customer_ref into v_customer_ref;

  if not exists (
    select 1 from (
      select c.action, c.version from public.consents c
      where c.user_id = v_uid and c.purpose = 'subscription-and-billing-terms'
      order by c.id desc limit 1
    ) latest
    where latest.action = 'granted' and latest.version = v_terms
  ) then
    insert into public.consents (user_id, purpose, version, action)
    values (v_uid, 'subscription-and-billing-terms', v_terms, 'granted');
  end if;

  perform audit.record(
    'billing.checkout_started', 'organization', p_org::text,
    jsonb_build_object('plan_code', p_plan_code, 'trial_days', v_trial, 'legal_entity_trial_used', v_used)
  );
  return query select v_price_ref, v_customer_ref, v_trial, v_org.slug;
end;
$$;

revoke all on function public.billing_checkout_start(uuid, text, text, text, text, integer, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.billing_checkout_start(uuid, text, text, text, text, integer, text, integer)
  to authenticated;

-- Opens the customer portal for p_org: an owner or admin at aal2, also of a lapsed or suspended organization (the
-- portal is where the invoices and the cancellation are). Returns the customer reference and the slug for the return
-- address; an organization the webhook has not linked to a customer has no portal.
create function public.billing_portal_start(p_org uuid) returns table (customer_ref text, slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text;
  v_slug text;
begin
  perform private.assert_billing_manager(p_org);
  select c.customer_ref, o.slug into v_ref, v_slug
  from billing.customers c join public.organizations o on o.id = c.organization_id
  where c.organization_id = p_org;
  if v_ref is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'no_customer';
  end if;

  perform audit.record('billing.portal_opened', 'organization', p_org::text);
  return query select v_ref, v_slug;
end;
$$;

revoke all on function public.billing_portal_start(uuid) from public, anon, authenticated, service_role;
grant execute on function public.billing_portal_start(uuid) to authenticated;

-- What the confirmation step of the billing page needs: whether this legal entity already had a trial (decided with
-- the values saved by an earlier attempt), whether a portal exists, the saved or stored tax data to fill in, and
-- whether the identifier of the organization can still be changed.
create function public.billing_checkout_state(p_org uuid) returns table (
  trial_used boolean,
  has_customer boolean,
  identifier_locked boolean,
  identifier text,
  identifier_kind text,
  billing_country text,
  vat_id text,
  registration_number text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_billing_manager(p_org);
  return query
  select
    private.billing_trial_used(p_org, c.billing_country, c.vat_id, c.registration_number),
    c.customer_ref is not null,
    private.legal_entity_locked(p_org),
    o.legal_entity_identifier,
    o.legal_entity_identifier_kind,
    coalesce(c.billing_country, o.based_in_country),
    c.vat_id,
    c.registration_number
  from public.organizations o
  left join billing.customers c on c.organization_id = o.id
  where o.id = p_org;
end;
$$;

revoke all on function public.billing_checkout_state(uuid) from public, anon, authenticated, service_role;
grant execute on function public.billing_checkout_state(uuid) to authenticated;
