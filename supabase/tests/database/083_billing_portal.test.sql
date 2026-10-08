begin;
select plan(28);

\ir organizations_fixture.inc

-- FR-G2 AC10: the portal, the state the billing page reads, and the two KPIs of the SOP (checkout conversion and
-- trial-to-paid conversion) as the checkout runbook states them.

create function pg_temp.new_org(p_owner uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, legal_entity_identifier, legal_entity_identifier_kind)
  values (
    v_id, 'employer', 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'DE',
    'REG' || upper(left(replace(v_id::text, '-', ''), 12)), 'registration_number'
  );
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

-- 'ok' or 'sqlstate|message|detail'; the row of the call is left in t.result.
create function pg_temp.portal(p_user uuid, p_org uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.result', (select row_to_json(r)::text from public.billing_portal_start(%L) r), true)$f$, p_org), p_aal)
$$;

create function pg_temp.opened() returns bigint
language sql as $$ select count(*) from audit.log where action = 'billing.portal_opened' $$;

select pg_temp.new_org(:'own1') as o \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  (:'o', :'adm', 'admin', now()), (:'o', :'mem', 'member', now());
insert into billing.customers (organization_id, provider, customer_ref, billing_country, vat_id) values (:'o', 'null', 'cus_o', 'DE', 'DE123456789');

select pg_temp.new_org(:'own1') as q \gset
insert into billing.customers (organization_id, provider, customer_ref, billing_country, vat_id) values (:'q', 'null', 'cus_q', 'DE', 'DE123456780');
insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at)
values (:'q', 'employer_starter', 'canceled', 'null', now() - interval '60 days');

select pg_temp.new_org(:'own1') as p \gset
select pg_temp.new_org(:'own1') as unlinked \gset
insert into billing.customers (organization_id, provider, billing_country, vat_id) values (:'unlinked', 'null', 'DE', 'DE123456781');

select set_config('t.opened', pg_temp.opened()::text, true) as base \gset

select is(pg_temp.portal(:'own1', :'o'), 'ok', 'AC10: the owner at aal2 opens the portal');
select is(
  current_setting('t.result')::jsonb,
  jsonb_build_object('customer_ref', 'cus_o', 'slug', (select slug from public.organizations where id = :'o')),
  'AC10: and receives the customer reference of the organisation and the slug for the return address'
);
select is(pg_temp.portal(:'adm', :'o'), 'ok', 'AC10: the admin at aal2 opens the portal');
select is(pg_temp.portal(:'own1', :'q'), 'ok', 'AC10: the owner of a lapsed organisation opens the portal');
select is(current_setting('t.result')::jsonb ->> 'customer_ref', 'cus_q', 'AC10: and receives its customer reference');
select is(
  (select format('%s|%s|%s', entity_type, count(*), count(distinct actor_id)) from audit.log
   where action = 'billing.portal_opened' and entity_id in (:'o', :'q') group by entity_type),
  'organization|3|2', 'AC10: each successful call wrote one audit row for the organisation'
);
select is(pg_temp.opened(), current_setting('t.opened')::bigint + 3, 'AC10: and no other');

select set_config('t.opened', pg_temp.opened()::text, true) as base \gset
select is(pg_temp.portal(:'mem', :'o'), 'P0001|CHARA_FORBIDDEN|', 'AC10: a member is refused');
select is(pg_temp.portal(:'own1', :'o', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'AC10: an owner at aal1 is refused');
select is(pg_temp.portal(:'own2', :'o'), 'P0001|CHARA_FORBIDDEN|', 'AC10: the owner of another organisation is refused');
select is(pg_temp.portal(:'wkr', :'o'), 'P0001|CHARA_FORBIDDEN|', 'a candidate is refused');
select is(pg_temp.portal(:'own1', :'p'), 'P0001|CHARA_FORBIDDEN|no_customer', 'AC10: an organisation that never checked out has no portal');
select is(pg_temp.portal(:'own1', :'unlinked'), 'P0001|CHARA_FORBIDDEN|no_customer', 'an organisation whose customer the webhook has not linked yet has no portal');
select is(
  pg_temp.call_as(null, 'anon', format($$select * from public.billing_portal_start(%L)$$, :'o')),
  '42501|permission denied for function billing_portal_start|', 'an anonymous caller has no EXECUTE'
);
select is(pg_temp.opened(), current_setting('t.opened')::bigint, 'AC10: refused calls wrote no audit row');

update public.organizations set status = 'suspended' where id = :'o';
select is(pg_temp.portal(:'own1', :'o'), 'ok', 'the portal stays open to a suspended organisation, where its invoices and its cancellation are');
update public.organizations set status = 'active' where id = :'o';

-- The state the billing page reads.
create function pg_temp.state(p_user uuid, p_org uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.result', (select row_to_json(r)::text from public.billing_checkout_state(%L) r), true)$f$, p_org), p_aal)
$$;
select is(pg_temp.state(:'own1', :'o'), 'ok', 'the owner at aal2 reads the state');
select is(
  current_setting('t.result')::jsonb,
  jsonb_build_object(
    'trial_used', false, 'has_customer', true, 'identifier_locked', true,
    'identifier', (select legal_entity_identifier from public.organizations where id = :'o'),
    'identifier_kind', 'registration_number', 'billing_country', 'DE', 'vat_id', 'DE123456789', 'registration_number', null
  ),
  'it holds the saved tax data, the stored identifier and whether the portal and the identifier lock apply'
);
select is(pg_temp.state(:'own1', :'q'), 'ok', 'the state of a lapsed organisation is read');
select is((current_setting('t.result')::jsonb ->> 'trial_used'), 'true', 'a legal entity whose subscription had a trial is reported as having used it');
select is(pg_temp.state(:'own1', :'p'), 'ok', 'the state of an organisation that never checked out is read');
select is(
  current_setting('t.result')::jsonb - 'identifier' - 'identifier_kind',
  '{"trial_used": false, "has_customer": false, "identifier_locked": false, "billing_country": "DE", "vat_id": null, "registration_number": null}'::jsonb,
  'it offers the country of the organisation and no tax data'
);
select is(pg_temp.state(:'mem', :'o'), 'P0001|CHARA_FORBIDDEN|', 'a member cannot read it');
select is(pg_temp.state(:'own1', :'o', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'nor an owner at aal1');
select is(pg_temp.state(:'own2', :'o'), 'P0001|CHARA_FORBIDDEN|', 'nor another organisation');

-- The KPIs: checkout conversion (organisations that started, and those with a subscription created after their first
-- start) and trial-to-paid conversion (trials that have ended, and those on a paid subscription).
create function pg_temp.checkout_conversion() returns text
language sql as $$
  with starts as (
    select entity_id::uuid as organization_id, min(created_at) as first_start
    from audit.log where action = 'billing.checkout_started' group by entity_id
  )
  select format('%s|%s', count(*), count(*) filter (where exists (
    select 1 from billing.subscriptions s where s.organization_id = st.organization_id and s.created_at >= st.first_start
  )))
  from starts st
$$;
create function pg_temp.trial_to_paid() returns text
language sql as $$
  select format('%s|%s', count(*), count(*) filter (where status in ('active', 'past_due')))
  from billing.subscriptions where trial_ends_at <= now()
$$;
select is(pg_temp.checkout_conversion(), '0|0', 'KPI: no checkout has started yet');
select pg_temp.new_org(:'own1') as k1 \gset
select pg_temp.new_org(:'own1') as k2 \gset
select pg_temp.call_as(:'own1', 'authenticated', format($$select * from public.billing_checkout_start(%L, 'employer_starter', 'DE', 'DE123456000', null, %s)$$, :'k1', private.current_legal_version('subscription-and-billing-terms'))) as s1 \gset
select pg_temp.call_as(:'own1', 'authenticated', format($$select * from public.billing_checkout_start(%L, 'employer_starter', 'DE', 'DE123456001', null, %s)$$, :'k2', private.current_legal_version('subscription-and-billing-terms'))) as s2 \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at)
values (:'k1', 'employer_starter', 'active', 'null', now() - interval '1 day');
select is(pg_temp.checkout_conversion(), '2|1', 'KPI: two organisations started a checkout and one has a subscription since');
select is(pg_temp.trial_to_paid(), '2|1', 'KPI: two trials have ended (one is the lapsed organisation) and one is on a paid subscription');

select * from finish();
rollback;
