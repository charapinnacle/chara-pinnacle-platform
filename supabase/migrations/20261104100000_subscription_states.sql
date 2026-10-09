-- Subscription states (FR-G4; ARCHITECTURE.md sections 10.1, 10.3, 10.4; OPEN_QUESTIONS.md C11, D71). The states and their
-- transitions came with the webhook (FR-G3); the entitlement helpers and the read-only rules with FR-G1, FR-C2 and FR-D2.
-- What this adds: the lapse (a subscription that becomes canceled pauses the open vacancies of its organisation in the
-- transaction of the event) and the daily check that a subscription is not still Past due a day after its grace period,
-- which only Stripe's dunning ends.

-- The lapse. billing_apply_event of 20261103120000_webhook_processing.sql with one addition, marked below: a status that
-- turns canceled calls private.pause_jobs_on_lapse (FR-C2) before the event is marked applied. If that raises, the
-- transaction of the event is rolled back and the subscription keeps its status; the retry job tries the event again.
-- Keyed on the status and not on the kind of the event, so that every way into canceled lapses the organisation once:
-- a second event finds the subscription canceled and is stale.
create or replace function public.billing_apply_event(p_event_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev billing.provider_events;
  v_org uuid;
  v_out record;
begin
  select * into v_ev from billing.provider_events e where e.id = p_event_id;
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
  select * into v_ev from billing.provider_events e where e.id = p_event_id for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_ev.status <> 'received' then
    return v_ev.status;
  end if;

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
  elsif v_out.outcome in ('unknown_plan', 'customer_conflict') then
    update billing.provider_events set status = 'error', error = v_out.outcome where id = v_ev.id;
    perform private.raise_alert('billing_event_error', jsonb_build_object(
      'event_id', v_ev.id, 'kind', v_ev.kind, 'error', v_out.outcome, 'organization_id', v_org
    ));
    return 'error';
  end if;

  if v_out.to_status = 'canceled' and v_out.from_status is distinct from 'canceled' then
    perform private.pause_jobs_on_lapse(v_org);
  end if;

  update billing.provider_events set status = 'applied', applied_at = now() where id = v_ev.id;
  perform private.billing_audit('billing.event_applied', 'organization', v_org::text, jsonb_build_object(
    'event_id', v_ev.id, 'kind', v_ev.kind, 'organization_id', v_org,
    'from_status', v_out.from_status, 'to_status', v_out.to_status
  ));
  return 'applied';
end;
$$;

-- The overdue check reads the filter column, so it does not scan the table.
create index subscriptions_past_due_idx on billing.subscriptions (past_due_since) where status = 'past_due';

-- Whether an operations alert with this kind and detail exists; billing_owner has no other way to read the alerts.
create function private.alert_raised(p_kind text, p_detail jsonb) returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from private.security_events e where e.kind = p_kind and e.detail = p_detail) $$;

revoke all on function private.alert_raised(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.alert_raised(text, jsonb) to billing_owner;

-- Stripe's dunning settings cancel a subscription 7 days after its first failed payment (grace period, FR-G4); the system
-- never cancels on its own. This is the safety net for a cancellation that did not arrive: a subscription still Past due
-- more than one day after the grace period (7 + 1 days after past_due_since) raises one operations alert, once for each
-- dunning period (the alert holds the subscription and past_due_since). The oldest 100 not yet alerted are taken in a run.
-- Changes no subscription and no vacancy. p_now is for the tests. Returns the number of alerts raised.
create function billing.check_past_due_overdue(p_now timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert jsonb;
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('billing_past_due_overdue', 0));
  for v_alert in
    select d.detail
    from billing.subscriptions s
    cross join lateral (
      select jsonb_build_object(
        'subscription_id', s.id, 'organization_id', s.organization_id,
        'past_due_since', to_char(s.past_due_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ) as detail
    ) d
    where s.status = 'past_due'
      and s.past_due_since < p_now - interval '8 days'
      and not private.alert_raised('billing_past_due_overdue', d.detail)
    order by s.past_due_since
    limit 100
  loop
    perform private.raise_alert('billing_past_due_overdue', v_alert);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

alter function billing.check_past_due_overdue(timestamptz) owner to billing_owner;
revoke all on function billing.check_past_due_overdue(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('billing-past-due-overdue', '30 5 * * *', 'select billing.check_past_due_overdue()');
