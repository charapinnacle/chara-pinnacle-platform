-- Shared by the webhook tests (FR-G3): organisations with a billing customer, and events of the null provider that are
-- stored and applied the way the billing-webhook function does it. Included with \ir after organizations_fixture.inc.
create function pg_temp.new_org(
  p_owner uuid, p_vat text default null, p_reg text default 'HRB12345', p_customer boolean default true
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'employer', 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  if p_customer then
    insert into billing.customers (organization_id, provider, billing_country, vat_id, registration_number)
    values (v_id, 'null', 'DE', p_vat, p_reg);
  end if;
  return v_id;
end;
$$;

create function pg_temp.join_org(p_org uuid, p_user uuid, p_role public.member_role) returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

-- Stores an event of the null provider and returns its id; a second call with the same p_id returns the first id.
create function pg_temp.ingest(p_id text, p_kind text, p_payload jsonb, p_at timestamptz default '2026-11-01T10:00:00Z') returns uuid
language sql as $$
  select public.billing_ingest_event('null', p_id, p_kind, p_payload, true, p_at)
$$;

-- Stores and applies an event; returns the status billing_apply_event answers.
create function pg_temp.deliver(p_id text, p_kind text, p_payload jsonb, p_at timestamptz default '2026-11-01T10:00:00Z') returns text
language sql as $$
  select public.billing_apply_event(pg_temp.ingest(p_id, p_kind, p_payload, p_at))
$$;

create function pg_temp.checkout_event(p_org uuid, p_customer text, p_sub text default null) returns jsonb
language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('orgId', p_org, 'providerCustomerRef', p_customer, 'providerSubscriptionRef', p_sub))
$$;

create function pg_temp.sub_event(
  p_org uuid, p_plan text, p_status text, p_sub text default 'sub_1', p_trial_end text default null, p_period_end text default null,
  p_customer text default null
) returns jsonb
language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'orgId', p_org, 'planCode', p_plan, 'status', p_status, 'providerSubscriptionRef', p_sub, 'trialEndsAt', p_trial_end,
    'currentPeriodEnd', p_period_end, 'providerCustomerRef', p_customer
  ))
$$;

-- plan|status|customer|subscription|trial end|period end|past due since|last event of the live or the newest subscription.
create function pg_temp.sub(p_org uuid) returns text
language sql as $$
  select format('%s|%s|%s|%s|%s|%s|%s|%s', plan_code, status, provider_customer_ref, provider_subscription_ref,
    to_char(trial_ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'), to_char(current_period_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'),
    to_char(past_due_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'), to_char(last_provider_event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'))
  from billing.subscriptions where organization_id = p_org order by (status = 'canceled'), created_at desc limit 1
$$;

create function pg_temp.event_status(p_provider_event_id text) returns text
language sql as $$
  select status || coalesce('/' || error, '') from billing.provider_events where provider = 'null' and provider_event_id = p_provider_event_id
$$;

create function pg_temp.applied_audit(p_org uuid) returns bigint
language sql as $$ select count(*) from audit.log where action = 'billing.event_applied' and entity_id = p_org::text $$;

create function pg_temp.alerts(p_kind text default null) returns bigint
language sql as $$ select count(*) from private.security_events where p_kind is null or kind = p_kind $$;
