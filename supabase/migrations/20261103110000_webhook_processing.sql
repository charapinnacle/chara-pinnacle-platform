-- Payment webhook processing (FR-G3; ARCHITECTURE.md sections 8, 10.1, 10.3, 12; OPEN_QUESTIONS.md D4, D40, D67, L6).
-- Events of the payment provider are stored once, by provider and event id, and applied to the subscription records
-- by billing_apply_event. The two public functions are owned by billing_owner and executable by service_role only; the
-- billing-webhook Edge Function and the retry job are their only callers. An event that cannot be applied yet stays
-- 'received' and is retried every 5 minutes; after an hour it becomes an error and raises an operations alert.
-- The lapse of an organisation (pausing its vacancies, FR-G4) is added to the cancellation by U47.

insert into private.settings (key, value) values ('billing_retry_alert_minutes', '60');

-- 13 months, as days (OPEN_QUESTIONS.md L6): the payloads of the provider are deleted, the audit rows stay.
insert into private.retention_policies (entity, days) values ('billing_provider_events', 396);

-- Operations alerts that must outlive a log line: a failed event, a repeated trial, a difference found by the weekly
-- reconciliation. Written only by private.raise_alert; nobody reads the table through the API.
create table private.security_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]*$' and length(kind) <= 64),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);

comment on table private.security_events is
  'Operations alerts (ids and codes only, never a payload). The same alert is a server log line with the key "alert", which the log platform watches.';

create index security_events_kind_created_idx on private.security_events (kind, created_at desc);

alter table private.security_events enable row level security;
alter table private.security_events force row level security;
revoke all on table private.security_events from public, anon, authenticated, service_role;

create function private.raise_alert(p_kind text, p_detail jsonb default '{}') returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.security_events (kind, detail) values (p_kind, p_detail);
  raise log '%', jsonb_build_object('alert', p_kind, 'detail', p_detail)::text;
end;
$$;

revoke all on function private.raise_alert(text, jsonb) from public, anon, authenticated, service_role;

create table billing.provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('null', 'stripe')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 255),
  kind text not null check (kind in (
    'checkout.completed', 'subscription.activated', 'subscription.updated', 'subscription.canceled',
    'subscription.trial_will_end', 'payment.succeeded', 'payment.failed'
  )),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 32768),
  signature_valid boolean not null check (signature_valid),
  provider_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  status text not null default 'received' check (status in ('received', 'applied', 'stale', 'error')),
  applied_at timestamptz,
  error text check (error in ('unknown_plan', 'org_not_linked', 'transient')),
  unique (provider, provider_event_id),
  check ((status = 'applied') = (applied_at is not null)),
  check ((status = 'error') = (error is not null))
);

comment on table billing.provider_events is
  'The events of the payment provider in normalised form (ids, plan code, status, dates, amounts; no name, address or card). An event with an invalid signature is never stored. Read by operators with SQL only.';

-- The retry job reads the events that wait, oldest first; the retention job deletes by age.
create index provider_events_received_idx on billing.provider_events (received_at) where status = 'received';
create index provider_events_received_at_idx on billing.provider_events (received_at);

create table billing.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  kind text not null check (kind in ('subscription')),
  sku_or_plan text not null check (sku_or_plan <> ''),
  amount_minor integer not null check (amount_minor > 0),
  tax_minor integer not null default 0 check (tax_minor >= 0),
  currency text not null references public.currencies (code),
  provider text not null check (provider in ('null', 'stripe')),
  provider_ref text not null check (provider_ref <> ''),
  invoice_ref text check (invoice_ref <> ''),
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);

comment on table billing.orders is
  'One row per paid invoice with an amount above zero, written by the billing webhook. The tax amount and the invoice reference are the provider''s (Stripe Tax). The zero-amount invoice of a trial is no order.';

create index orders_organization_idx on billing.orders (organization_id, created_at desc);

-- The webhook finds the subscription of an event by its reference; a reference belongs to one subscription.
create unique index subscriptions_provider_ref
  on billing.subscriptions (provider, provider_subscription_ref) where provider_subscription_ref is not null;

alter table billing.provider_events owner to billing_owner;
alter table billing.orders owner to billing_owner;

alter table billing.provider_events enable row level security;
alter table billing.provider_events force row level security;
alter table billing.orders enable row level security;
alter table billing.orders force row level security;

revoke all on billing.provider_events, billing.orders from public, anon, authenticated, service_role;

create policy provider_events_all_billing_owner on billing.provider_events
  for all to billing_owner using (true) with check (true);
create policy orders_all_billing_owner on billing.orders
  for all to billing_owner using (true) with check (true);

-- What the functions of billing_owner may reach outside the schema billing: the organisations (read), and three
-- definer functions of private that write the audit row, queue the email and raise the alert. billing_owner has no
-- other privilege in public, private or audit, and none on the verification tables (NFR-S3).
grant usage on schema public, private to billing_owner;
grant select on public.organizations to billing_owner;
create policy organizations_select_billing_owner on public.organizations
  for select to billing_owner using (true);

create function private.billing_audit(p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action is null or p_action !~ '^billing\.[a-z_]+$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'action';
  end if;
  perform audit.record(p_action, p_entity_type, p_entity_id, p_metadata);
end;
$$;

-- The email goes to the owner of the organisation and to nobody else (mandatory, SOP FR-I2); the producer contract is
-- the pgmq message of docs/runbooks/transactional-emails.md section 5.
create function private.billing_notify_owner(p_org uuid, p_kind text, p_message jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if p_kind not in ('trial_ending', 'payment_failed') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'kind';
  end if;
  select m.user_id into v_owner
  from public.organization_members m
  where m.organization_id = p_org and m.role = 'owner' and m.accepted_at is not null;
  if v_owner is not null then
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', p_kind, 'user_id', v_owner, 'mandatory', true, 'organization_id', p_org
    ) || p_message);
  end if;
end;
$$;

revoke all on function private.billing_audit(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.billing_notify_owner(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.billing_audit(text, text, text, jsonb) to billing_owner;
grant execute on function private.billing_notify_owner(uuid, text, jsonb) to billing_owner;
grant execute on function private.raise_alert(text, jsonb) to billing_owner;

-- The organisation an event is about: the one named by the provider's metadata when it exists, else the one that owns
-- the customer or the subscription of the event (an invoice of a subscription created outside Checkout carries no
-- metadata). Null while the link does not exist yet.
create function billing.resolve_organization(p_provider text, p_payload jsonb) returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select o.id from public.organizations o where o.id = (p_payload ->> 'orgId')::uuid),
    (select c.organization_id from billing.customers c
     where c.provider = p_provider and c.customer_ref = p_payload ->> 'providerCustomerRef'),
    (select s.organization_id from billing.subscriptions s
     where s.provider = p_provider and s.provider_subscription_ref = p_payload ->> 'providerSubscriptionRef')
  )
$$;

-- The subscription row an event applies to: the one with its reference, else the live row of the organisation that has
-- no reference yet (the first event after Checkout) or that the event names no reference for (an invoice).
create function billing.subscription_for(p_org uuid, p_provider text, p_ref text) returns billing.subscriptions
language sql
stable
set search_path = ''
as $$
  select s.* from billing.subscriptions s
  where s.organization_id = p_org and s.provider = p_provider
    and (s.provider_subscription_ref = p_ref
         or (s.status <> 'canceled' and (s.provider_subscription_ref is null or p_ref is null)))
  order by (s.provider_subscription_ref = p_ref) desc nulls last, s.created_at desc
  limit 1
$$;

-- One grant per legal-entity identifier of the customer, written when the first trial of the organisation is applied.
-- An identifier that another organisation already holds keeps its first holder, and the repeat is an alert.
create function billing.record_trial_grants(p_org uuid, p_event uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_customer billing.customers;
  v_keys text[];
begin
  select * into v_customer from billing.customers c where c.organization_id = p_org;
  v_keys := array_remove(array[
    case when v_customer.vat_id is not null then 'vat:' || v_customer.vat_id end,
    case when v_customer.registration_number is not null
      then 'reg:' || v_customer.billing_country || ':' || v_customer.registration_number end
  ], null);
  insert into billing.trial_grants (identifier_key, organization_id)
  select k, p_org from unnest(v_keys) k
  on conflict (identifier_key) do nothing;
  if exists (
    select 1 from billing.trial_grants g where g.identifier_key = any (v_keys) and g.organization_id <> p_org
  ) then
    perform private.raise_alert(
      'billing_trial_repeated', jsonb_build_object('organization_id', p_org, 'event_id', p_event)
    );
  end if;
end;
$$;

-- checkout.session.completed: the customer of the organisation, and the subscription if the session carries it.
create function billing.apply_checkout(p_ev billing.provider_events, p_org uuid, out outcome text, out from_status text, out to_status text)
language plpgsql
set search_path = ''
as $$
declare
  v_customer text := p_ev.payload ->> 'providerCustomerRef';
  v_sub text := p_ev.payload ->> 'providerSubscriptionRef';
  v_current text;
begin
  select c.customer_ref into v_current
  from billing.customers c where c.organization_id = p_org and c.provider = p_ev.provider for update;
  if not found then
    outcome := 'unresolved';
    return;
  end if;
  if v_current is not null and v_current <> v_customer then
    raise exception 'CHARA_CONFLICT' using detail = 'customer_ref';
  end if;
  update billing.customers set customer_ref = v_customer where organization_id = p_org;
  update billing.subscriptions
  set provider_customer_ref = coalesce(provider_customer_ref, v_customer),
      provider_subscription_ref = coalesce(provider_subscription_ref, v_sub)
  where organization_id = p_org and provider = p_ev.provider and status <> 'canceled'
  returning status into from_status;
  to_status := from_status;
  outcome := 'applied';
end;
$$;

-- customer.subscription.created, .updated and .deleted: upsert status, plan and dates. A plan code that is not a plan
-- of the organisation's type is an error and changes nothing.
create function billing.apply_subscription(p_ev billing.provider_events, p_org uuid, out outcome text, out from_status text, out to_status text)
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := p_ev.payload;
  v_ref text := v_p ->> 'providerSubscriptionRef';
  v_status text := case p_ev.kind when 'subscription.canceled' then 'canceled' else v_p ->> 'status' end;
  v_row billing.subscriptions := billing.subscription_for(p_org, p_ev.provider, v_ref);
  v_plan billing.plans;
  v_customer text;
begin
  if v_row.id is not null and (v_row.status = 'canceled' or v_row.last_provider_event_at > p_ev.provider_created_at) then
    outcome := 'stale';
    return;
  end if;

  select * into v_plan from billing.plans pl where pl.code = v_p ->> 'planCode';
  if (p_ev.kind <> 'subscription.canceled' or v_row.id is null)
     and (v_plan.code is null or v_plan.org_type is distinct from (select o.type from public.organizations o where o.id = p_org)) then
    outcome := 'unknown_plan';
    return;
  end if;

  v_customer := coalesce(
    v_row.provider_customer_ref, v_p ->> 'providerCustomerRef',
    (select c.customer_ref from billing.customers c where c.organization_id = p_org and c.provider = p_ev.provider)
  );
  from_status := v_row.status;
  to_status := v_status;

  if v_row.id is null then
    insert into billing.subscriptions (
      organization_id, plan_code, status, trial_ends_at, current_period_start, current_period_end, cancel_at,
      last_provider_event_at, provider, provider_customer_ref, provider_subscription_ref
    ) values (
      p_org, v_plan.code, v_status, (v_p ->> 'trialEndsAt')::timestamptz, (v_p ->> 'currentPeriodStart')::timestamptz,
      (v_p ->> 'currentPeriodEnd')::timestamptz, (v_p ->> 'cancelAt')::timestamptz, p_ev.provider_created_at,
      p_ev.provider, v_customer, v_ref
    );
  else
    update billing.subscriptions s
    set plan_code = coalesce(v_plan.code, s.plan_code),
        status = v_status,
        trial_ends_at = coalesce((v_p ->> 'trialEndsAt')::timestamptz, s.trial_ends_at),
        current_period_start = coalesce((v_p ->> 'currentPeriodStart')::timestamptz, s.current_period_start),
        current_period_end = coalesce((v_p ->> 'currentPeriodEnd')::timestamptz, s.current_period_end),
        cancel_at = (v_p ->> 'cancelAt')::timestamptz,
        past_due_since = case when v_status in ('active', 'trialing') then null else s.past_due_since end,
        last_provider_event_at = greatest(s.last_provider_event_at, p_ev.provider_created_at),
        provider_customer_ref = v_customer,
        provider_subscription_ref = coalesce(s.provider_subscription_ref, v_ref)
    where s.id = v_row.id;
  end if;

  if v_p ->> 'trialEndsAt' is not null and v_row.trial_ends_at is null then
    perform billing.record_trial_grants(p_org, p_ev.id);
  end if;
  outcome := 'applied';
end;
$$;

-- invoice.payment_failed: Past due, with the start of the dunning period set once; the email goes out only when this
-- event set it.
create function billing.apply_payment_failed(p_ev billing.provider_events, p_org uuid, out outcome text, out from_status text, out to_status text)
language plpgsql
set search_path = ''
as $$
declare
  v_row billing.subscriptions := billing.subscription_for(p_org, p_ev.provider, p_ev.payload ->> 'providerSubscriptionRef');
begin
  if v_row.id is null then
    outcome := 'unresolved';
    return;
  end if;
  from_status := v_row.status;
  to_status := v_row.status;
  outcome := 'applied';
  if v_row.status in ('canceled', 'paused') then
    return;
  end if;
  if v_row.last_provider_event_at > p_ev.provider_created_at then
    outcome := 'stale';
    return;
  end if;

  update billing.subscriptions
  set status = 'past_due',
      past_due_since = coalesce(past_due_since, p_ev.provider_created_at),
      last_provider_event_at = greatest(last_provider_event_at, p_ev.provider_created_at)
  where id = v_row.id;
  to_status := 'past_due';
  if v_row.past_due_since is null then
    perform private.billing_notify_owner(p_org, 'payment_failed', '{}');
  end if;
end;
$$;

-- invoice.paid: the order of a paid invoice, the end of the dunning period, and Active when the provider's
-- subscription is. The zero-amount invoice of a trial leaves Trialing as it is.
create function billing.apply_payment_succeeded(p_ev billing.provider_events, p_org uuid, out outcome text, out from_status text, out to_status text)
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := p_ev.payload;
  v_row billing.subscriptions := billing.subscription_for(p_org, p_ev.provider, v_p ->> 'providerSubscriptionRef');
begin
  if (v_p ->> 'amountMinor')::integer > 0 then
    insert into billing.orders (
      organization_id, kind, sku_or_plan, amount_minor, tax_minor, currency, provider, provider_ref, invoice_ref
    ) values (
      p_org, 'subscription', coalesce(v_row.plan_code, v_p ->> 'planCode', 'subscription'),
      (v_p ->> 'amountMinor')::integer, coalesce((v_p ->> 'taxMinor')::integer, 0), v_p ->> 'currency', p_ev.provider,
      v_p ->> 'providerPaymentRef', v_p ->> 'invoiceRef'
    ) on conflict (provider, provider_ref) do nothing;
  end if;

  from_status := v_row.status;
  to_status := v_row.status;
  outcome := 'applied';
  if v_row.id is null or v_row.status in ('canceled', 'paused') then
    return;
  end if;
  if v_row.last_provider_event_at > p_ev.provider_created_at then
    outcome := 'stale';
    return;
  end if;

  to_status := case when v_p ->> 'subscriptionStatus' = 'active' and v_row.status in ('past_due', 'trialing')
    then 'active' else v_row.status end;
  update billing.subscriptions
  set status = to_status,
      past_due_since = null,
      last_provider_event_at = greatest(last_provider_event_at, p_ev.provider_created_at)
  where id = v_row.id;
end;
$$;

-- customer.subscription.trial_will_end: one trial_ending email to the owner, with the price after the trial. A
-- subscription that is no longer trialing needs no reminder.
create function billing.apply_trial_will_end(p_ev billing.provider_events, p_org uuid, out outcome text, out from_status text, out to_status text)
language plpgsql
set search_path = ''
as $$
declare
  v_row billing.subscriptions := billing.subscription_for(p_org, p_ev.provider, p_ev.payload ->> 'providerSubscriptionRef');
  v_plan billing.plans;
begin
  if v_row.id is null then
    outcome := 'unresolved';
    return;
  end if;
  from_status := v_row.status;
  to_status := v_row.status;
  outcome := 'applied';
  if v_row.status <> 'trialing' then
    return;
  end if;
  select * into v_plan from billing.plans pl where pl.code = v_row.plan_code;
  perform private.billing_notify_owner(p_org, 'trial_ending', jsonb_build_object(
    'trial_ends_at', coalesce(p_ev.payload ->> 'trialEndsAt', v_row.trial_ends_at::text),
    'plan_code', v_plan.code, 'amount_minor', v_plan.price_minor, 'currency', v_plan.currency
  ));
end;
$$;

alter function billing.resolve_organization(text, jsonb) owner to billing_owner;
alter function billing.subscription_for(uuid, text, text) owner to billing_owner;
alter function billing.record_trial_grants(uuid, uuid) owner to billing_owner;
alter function billing.apply_checkout(billing.provider_events, uuid) owner to billing_owner;
alter function billing.apply_subscription(billing.provider_events, uuid) owner to billing_owner;
alter function billing.apply_payment_failed(billing.provider_events, uuid) owner to billing_owner;
alter function billing.apply_payment_succeeded(billing.provider_events, uuid) owner to billing_owner;
alter function billing.apply_trial_will_end(billing.provider_events, uuid) owner to billing_owner;

revoke all on function billing.resolve_organization(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function billing.subscription_for(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function billing.record_trial_grants(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function billing.apply_checkout(billing.provider_events, uuid) from public, anon, authenticated, service_role;
revoke all on function billing.apply_subscription(billing.provider_events, uuid) from public, anon, authenticated, service_role;
revoke all on function billing.apply_payment_failed(billing.provider_events, uuid) from public, anon, authenticated, service_role;
revoke all on function billing.apply_payment_succeeded(billing.provider_events, uuid) from public, anon, authenticated, service_role;
revoke all on function billing.apply_trial_will_end(billing.provider_events, uuid) from public, anon, authenticated, service_role;

-- Owning a function of schema public needs the right to create in it, for the moment of the change of owner only.
grant create on schema public to billing_owner;

-- Stores an event once. A second delivery of the same provider event id returns the id of the first row and changes
-- nothing, whatever its payload. The webhook verifies the signature before it calls this; an event with an invalid
-- signature is refused here as well, because storing it under the event id would let a forgery block the genuine event.
create function public.billing_ingest_event(
  p_provider text,
  p_provider_event_id text,
  p_kind text,
  p_payload jsonb,
  p_signature_valid boolean,
  p_provider_created_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_signature_valid is distinct from true then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'signature';
  end if;
  insert into billing.provider_events (provider, provider_event_id, kind, payload, signature_valid, provider_created_at)
  values (p_provider, p_provider_event_id, p_kind, p_payload, true, p_provider_created_at)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_id;
  if v_id is null then
    select e.id into v_id
    from billing.provider_events e where e.provider = p_provider and e.provider_event_id = p_provider_event_id;
  end if;
  return v_id;
end;
$$;

-- Applies a stored event and answers its status: applied; stale (older than the stored state: the caller fetches the
-- current state from the provider); error (a plan that is unknown; the event stays in error until an operator resets
-- it); received (the organisation or its subscription is not known yet: the retry job tries again). Applying an event
-- that is no longer 'received' changes nothing and answers its status. Everything happens in one transaction, and the
-- events of one organisation are applied one at a time.
create function public.billing_apply_event(p_event_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev billing.provider_events;
  v_org uuid;
  v_out record;
begin
  select * into v_ev from billing.provider_events e where e.id = p_event_id for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_ev.status <> 'received' then
    return v_ev.status;
  end if;

  v_org := billing.resolve_organization(v_ev.provider, v_ev.payload);
  if v_org is null then
    return 'received';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing:' || v_org::text, 0));

  if v_ev.kind = 'checkout.completed' then
    select * into v_out from billing.apply_checkout(v_ev, v_org);
  elsif v_ev.kind = 'payment.failed' then
    select * into v_out from billing.apply_payment_failed(v_ev, v_org);
  elsif v_ev.kind = 'payment.succeeded' then
    select * into v_out from billing.apply_payment_succeeded(v_ev, v_org);
  elsif v_ev.kind = 'subscription.trial_will_end' then
    select * into v_out from billing.apply_trial_will_end(v_ev, v_org);
  else
    select * into v_out from billing.apply_subscription(v_ev, v_org);
  end if;

  if v_out.outcome = 'unresolved' then
    return 'received';
  elsif v_out.outcome = 'stale' then
    update billing.provider_events set status = 'stale' where id = v_ev.id;
    return 'stale';
  elsif v_out.outcome = 'unknown_plan' then
    update billing.provider_events set status = 'error', error = 'unknown_plan' where id = v_ev.id;
    perform private.raise_alert('billing_event_error', jsonb_build_object(
      'event_id', v_ev.id, 'kind', v_ev.kind, 'error', 'unknown_plan', 'organization_id', v_org
    ));
    return 'error';
  end if;

  update billing.provider_events set status = 'applied', applied_at = now() where id = v_ev.id;
  perform private.billing_audit('billing.event_applied', 'organization', v_org::text, jsonb_build_object(
    'event_id', v_ev.id, 'kind', v_ev.kind, 'organization_id', v_org,
    'from_status', v_out.from_status, 'to_status', v_out.to_status
  ));
  return 'applied';
end;
$$;

alter function public.billing_ingest_event(text, text, text, jsonb, boolean, timestamptz) owner to billing_owner;
alter function public.billing_apply_event(uuid) owner to billing_owner;

revoke create on schema public from billing_owner;

revoke all on function public.billing_ingest_event(text, text, text, jsonb, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_apply_event(uuid) from public, anon, authenticated;
grant execute on function public.billing_ingest_event(text, text, text, jsonb, boolean, timestamptz) to service_role;
grant execute on function public.billing_apply_event(uuid) to service_role;

-- Every 5 minutes: applies the events that are still 'received' (an organisation that is not linked yet, a transient
-- failure of the application, a webhook that stopped between the two calls). An event that is still 'received' an hour
-- after it arrived (billing_retry_alert_minutes) becomes an error with the reason org_not_linked, or transient when its
-- application raised, and raises one alert. Bounded to the 100 oldest events of a run.
create function billing.retry_failed_events() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'billing_retry_alert_minutes');
  v_ev record;
  v_status text;
  v_reason text;
  v_count integer := 0;
begin
  if v_minutes is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'billing_retry_alert_minutes';
  end if;
  for v_ev in
    select e.id, e.kind, e.received_at from billing.provider_events e where e.status = 'received' order by e.received_at limit 100
  loop
    begin
      v_status := public.billing_apply_event(v_ev.id);
      v_reason := 'org_not_linked';
    exception when others then
      v_status := 'received';
      v_reason := 'transient';
    end;
    if v_status = 'received' and v_ev.received_at <= now() - make_interval(mins => v_minutes) then
      update billing.provider_events set status = 'error', error = v_reason where id = v_ev.id and status = 'received';
      if found then
        perform private.raise_alert('billing_event_error', jsonb_build_object(
          'event_id', v_ev.id, 'kind', v_ev.kind, 'error', v_reason
        ));
      end if;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function billing.retry_failed_events() from public, anon, authenticated, service_role;

select cron.schedule('billing-retry-events', '*/5 * * * *', 'select billing.retry_failed_events()');

-- Weekly, Monday 04:00 UTC: the billing-reconcile function compares the provider's subscriptions with the records.
-- Nothing is called while the Vault secrets are not set (private.call_edge_function).
select cron.schedule('billing-reconcile-weekly', '0 4 * * 1', $$select private.call_edge_function('billing-reconcile')$$);

-- The subscription records the reconciliation compares, a page at a time in the order of the primary key.
create function public.billing_reconcile_records(p_provider text, p_after uuid default null, p_limit integer default 1000)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
  from (
    select s.id, s.organization_id, s.provider_subscription_ref, s.plan_code, s.status
    from billing.subscriptions s
    where s.provider = p_provider and s.provider_subscription_ref is not null and (p_after is null or s.id > p_after)
    order by s.id
    limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
  ) r
$$;

-- The result of one comparison: one operations alert per difference and one audit row for the run. Returns the number
-- of differences.
create function public.billing_reconcile_report(p_provider text, p_checked integer, p_differences jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_difference jsonb;
begin
  if p_provider not in ('null', 'stripe') or p_checked is null or p_checked < 0
     or p_differences is null or jsonb_typeof(p_differences) <> 'array' or jsonb_array_length(p_differences) > 1000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'report';
  end if;
  for v_difference in select d from jsonb_array_elements(p_differences) d loop
    if jsonb_typeof(v_difference) <> 'object'
       or v_difference ->> 'kind' not in ('missing_record', 'extra_record', 'status_mismatch', 'plan_mismatch')
       or coalesce(v_difference ->> 'subscription_ref', '') = '' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'difference';
    end if;
  end loop;

  for v_difference in select d from jsonb_array_elements(p_differences) d loop
    perform private.raise_alert('billing_reconciliation_difference', jsonb_build_object(
      'provider', p_provider, 'difference', v_difference ->> 'kind', 'subscription_ref', v_difference ->> 'subscription_ref'
    ));
  end loop;
  perform private.billing_audit('billing.reconciled', 'billing', p_provider, jsonb_build_object(
    'checked', p_checked, 'differences', jsonb_array_length(p_differences)
  ));
  return jsonb_array_length(p_differences);
end;
$$;

grant create on schema public to billing_owner;
alter function public.billing_reconcile_records(text, uuid, integer) owner to billing_owner;
alter function public.billing_reconcile_report(text, integer, jsonb) owner to billing_owner;
revoke create on schema public from billing_owner;

revoke all on function public.billing_reconcile_records(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.billing_reconcile_report(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.billing_reconcile_records(text, uuid, integer) to service_role;
grant execute on function public.billing_reconcile_report(text, integer, jsonb) to service_role;

-- apply_retention keeps its rules for the document access log, the notifications and the audit log, and adds the
-- payloads of the provider (private.apply_retention of 20261102110000 with the events added).
create or replace function private.apply_retention() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_removed bigint;
begin
  select p.days into v_days from private.retention_policies p where p.entity = 'document_access_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.document_access_log where accessed_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform audit.record(
      'retention.run', 'retention_policies', 'document_access_log',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'notifications';
  if found then
    delete from pgmq.a_notifications where archived_at < now() - make_interval(days => v_days);
    delete from public.notifications where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform audit.record(
      'retention.run', 'retention_policies', 'notifications',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'billing_provider_events';
  if found then
    delete from billing.provider_events where received_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform audit.record(
      'retention.run', 'retention_policies', 'billing_provider_events',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'audit_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.log where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform audit.record(
      'retention.run', 'retention_policies', 'audit_log',
      jsonb_build_object('days', v_days, 'removed', v_removed)
    );
  end if;
end;
$$;
