begin;
select plan(31);

\ir organizations_fixture.inc

-- FR-G2 AC7 and FR-A2 AC7, AC8: one free trial per legal entity, and the identifier that decides it. The identifiers
-- are compared after upper-casing and removing spaces, dots, hyphens and slashes.

create function pg_temp.new_org(p_owner uuid, p_identifier text default null, p_kind text default 'vat_number') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, legal_entity_identifier, legal_entity_identifier_kind)
  values (
    v_id, 'employer', 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'DE',
    p_identifier, case when p_identifier is not null then p_kind end
  );
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.trial_days(p_user uuid, p_org uuid, p_country text, p_vat text, p_reg text) returns text
language plpgsql as $$
declare
  v_answer text;
begin
  v_answer := pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.trial', (select trial_days::text from public.billing_checkout_start(%L, 'employer_starter', %L, %L, %L, %s)), true)$f$,
    p_org, p_country, p_vat, p_reg, private.current_legal_version('subscription-and-billing-terms')));
  return case when v_answer = 'ok' then current_setting('t.trial') else v_answer end;
end;
$$;

-- AC7: Organisation A had a trial under both of its identifiers.
select pg_temp.new_org(:'own1') as a \gset
insert into billing.trial_grants (identifier_key, organization_id) values
  ('reg:DE:HRB12345', :'a'), ('vat:DE123456789', :'a');
select count(*) as grants from billing.trial_grants \gset

select pg_temp.new_org(:'own2') as b \gset
select is(pg_temp.trial_days(:'own2', :'b', 'DE', null, 'hrb-12345'), '0', 'AC7: the registration number in another spelling gets no trial');
select pg_temp.new_org(:'own2') as c \gset
select is(pg_temp.trial_days(:'own2', :'c', 'DE', 'DE 123 456 789', null), '0', 'AC7: the VAT ID in another spelling gets no trial');
select pg_temp.new_org(:'own2') as e \gset
select is(pg_temp.trial_days(:'own2', :'e', 'DE', 'DE123456789', 'HRB 99999'), '0', 'AC7: a new registration number with the VAT ID of A gets no trial');
select is(pg_temp.trial_days(:'own1', :'a', 'DE', 'DE123456789', 'HRB 12345'), '0', 'AC7: A itself gets no second trial');
select pg_temp.new_org(:'own2') as d \gset
select is(pg_temp.trial_days(:'own2', :'d', 'DE', 'DE555555555', 'HRB 55555'), '30', 'AC7: an organisation with new identifiers gets the trial of the plan');
select pg_temp.new_org(:'own2') as other_country \gset
select is(pg_temp.trial_days(:'own2', :'other_country', 'AT', null, 'HRB 12345'), '30', 'the registration number is compared within its country');
select is((select count(*) from billing.trial_grants), :'grants'::bigint, 'AC7: the call writes no trial grant');

-- The trial length follows the plan record, and the plan record alone.
update billing.plans set trial_days = 14 where code = 'employer_starter';
select pg_temp.new_org(:'own2') as d14 \gset
select is(pg_temp.trial_days(:'own2', :'d14', 'DE', 'DE555555556', null), '14', 'the trial length is plans.trial_days');
update billing.plans set trial_days = 0 where code = 'employer_starter';
select pg_temp.new_org(:'own2') as d0 \gset
select is(pg_temp.trial_days(:'own2', :'d0', 'DE', 'DE555555557', null), '0', 'a plan without a trial gets none');
update billing.plans set trial_days = 30 where code = 'employer_starter';

-- The organisation's own history decides, whatever identifiers it submits now.
select pg_temp.new_org(:'own2') as own_history \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at)
values (:'own_history', 'employer_starter', 'canceled', 'null', now() - interval '10 days');
select is(pg_temp.trial_days(:'own2', :'own_history', 'DE', 'DE777777777', null), '0', 'an organisation whose subscription had a trial gets none with new identifiers');
select pg_temp.new_org(:'own2') as own_grant \gset
insert into billing.trial_grants (identifier_key, organization_id) values ('vat:DE888888888', :'own_grant');
select is(pg_temp.trial_days(:'own2', :'own_grant', 'DE', 'DE999999999', null), '0', 'an organisation with a trial grant gets none with new identifiers');

-- FR-A2 AC8: the stored identifier of an organisation that had a trial, with no grant row.
select pg_temp.new_org(:'own1', 'DE123456000') as old_a \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at)
values (:'old_a', 'employer_starter', 'canceled', 'null', now() - interval '40 days');
select pg_temp.new_org(:'own1', 'FR999999999') as a2 \gset

select pg_temp.call_as(:'adm', 'authenticated',
  $$select set_config('t.nb', (public.create_organization('employer', 'Newcomer B GmbH', 'Newcomer B', 'DE', 'F', null, 'de 123 456 000', 'vat_number'))->>'organization_id', true)$$, 'aal1') as setup_b \gset
select pg_temp.call_as(:'mem', 'authenticated',
  $$select set_config('t.nb2', (public.create_organization('employer', 'Newcomer B2 GmbH', 'Newcomer B2', 'FR', 'F', null, 'fr 999 999 999', 'vat_number'))->>'organization_id', true)$$, 'aal1') as setup_b2 \gset
select is(
  (select (metadata ->> 'legal_entity_trial_used') from audit.log where action = 'organization_created' and entity_id = current_setting('t.nb')),
  'true', 'AC8: the organisation of a legal entity that had a trial is flagged when it is created'
);
select is(
  (select (metadata ->> 'legal_entity_trial_used') from audit.log where action = 'organization_created' and entity_id = current_setting('t.nb2')),
  'false', 'AC8: the organisation of a legal entity without a trial is not flagged'
);
select is(
  pg_temp.trial_days(:'adm', current_setting('t.nb')::uuid, 'DE', 'DE123456000', null), '0',
  'AC8: checkout for the flagged organisation carries no trial'
);
select is(
  pg_temp.trial_days(:'mem', current_setting('t.nb2')::uuid, 'FR', 'FR999999999', null), '30',
  'AC8: checkout for the other carries the trial of the plan'
);
select is(
  (select metadata ->> 'legal_entity_trial_used' from audit.log where action = 'billing.checkout_started' and entity_id = current_setting('t.nb')),
  'true', 'the checkout audit row carries the flag as evaluated at checkout'
);

-- Submitted and stored identifiers are both looked up in the stored identifiers of other organisations.
select pg_temp.new_org(:'own2') as submitted \gset
select is(pg_temp.trial_days(:'own2', :'submitted', 'DE', 'DE123456000', null), '0', 'AC8: a submitted VAT ID that another organisation holds, with a trial, gets none');

-- A null identifier never matches another.
select pg_temp.new_org(:'own1') as null_a \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at)
values (:'null_a', 'employer_starter', 'canceled', 'null', now() - interval '40 days');
select pg_temp.new_org(:'own2') as null_b \gset
select is(pg_temp.trial_days(:'own2', :'null_b', 'DE', 'DE444444444', null), '30', 'AC8: an organisation with a null identifier never matches another');

-- FR-A2 AC7: the identifier of the owner is required, and locked once checkout has started.
select pg_temp.new_org(:'own1') as x \gset
select is(
  pg_temp.trial_days(:'own1', :'x', 'DE', null, null), 'P0001|CHARA_FORBIDDEN|legal_entity_identifier_required',
  'FR-A2 AC7: checkout for an organisation with no identifier is refused as such'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.set_legal_entity_identifier(%L, 'DE 123 456 788', 'vat_number')$$, :'x')),
  'ok', 'FR-A2 AC7: the owner at aal2 stores the identifier'
);
select is(pg_temp.trial_days(:'own1', :'x', 'DE', 'DE123456788', null), '30', 'checkout then starts with a trial');
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.set_legal_entity_identifier(%L, 'FR 999 999 998', 'vat_number')$$, :'x')),
  'P0001|CHARA_FORBIDDEN|legal_entity_identifier_locked', 'FR-A2 AC7: once the billing customer exists the identifier is locked'
);
select is(
  (select legal_entity_identifier from public.organizations where id = :'x'), 'DE123456788', 'FR-A2 AC7: the value is unchanged'
);

-- The lookups use their indexes.
create function pg_temp.explain_lines(p_sql text) returns setof text
language plpgsql as $$
declare
  v_line text;
begin
  for v_line in execute 'explain ' || p_sql loop
    return next v_line;
  end loop;
end;
$$;
set local enable_seqscan = off;
select ok(
  (select string_agg(l, ' ') from pg_temp.explain_lines($$select 1 from billing.trial_grants where organization_id = gen_random_uuid()$$) l) like '%trial_grants_organization_idx%',
  'the trial grants of an organisation are read by their index'
);
select ok(
  (select string_agg(l, ' ') from pg_temp.explain_lines($$select 1 from billing.trial_grants where identifier_key = any (array['vat:DE123456789'])$$) l) like '%trial_grants_pkey%',
  'the trial grants of an identifier are read by their key'
);
select ok(
  (select string_agg(l, ' ') from pg_temp.explain_lines($$select 1 from billing.customers where provider = 'stripe' and customer_ref = 'cus_1'$$) l) like '%customers_provider_ref%',
  'the customer of a provider reference is read by its index'
);
reset enable_seqscan;

-- The tables are closed to every API role, and the checks of the data.
select ok(
  not exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) r (name), unnest(array['customers', 'trial_grants', 'plan_provider_refs']) t (name)
    where has_any_column_privilege(r.name, 'billing.' || t.name, 'select, insert, update, references')
       or has_table_privilege(r.name, 'billing.' || t.name, 'select, insert, update, delete, truncate, references, trigger')
  ),
  'anon, authenticated and service_role hold no privilege on customers, trial grants or plan provider references'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select * from billing.customers$$), '42501|permission denied for table customers|',
  'an owner cannot read the billing customers through the API role'
);
select throws_ok(
  format($$insert into billing.customers (organization_id, provider, billing_country, vat_id) values (%L, 'null', 'DE', 'DE12')$$, :'own_grant'),
  '23514', null, 'a customer needs a valid VAT ID'
);
select throws_ok(
  format($$insert into billing.customers (organization_id, provider, billing_country) values (%L, 'null', 'DE')$$, :'own_grant'),
  '23514', null, 'a customer needs a VAT ID or a registration number'
);
select throws_ok(
  $$insert into billing.trial_grants (identifier_key, organization_id) values ('vat:de123', gen_random_uuid())$$,
  '23514', null, 'a trial grant key has the documented form'
);

select * from finish();
rollback;
