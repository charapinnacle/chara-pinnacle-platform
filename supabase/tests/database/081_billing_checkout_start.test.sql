begin;
select plan(57);

\ir organizations_fixture.inc

-- FR-G2 AC4 to AC6 and the checks of FR-A2 AC7: billing_checkout_start (ARCHITECTURE.md sections 10.1, 10.2). Every
-- scenario below runs against an organisation of its own, owned by own1 unless it says otherwise.

\set plat '00000000-0000-0000-0000-00000000a021'
select pg_temp.new_user(:'plat');
update public.profiles set account_kind = intended_account_kind where id = :'plat';
insert into public.platform_staff (user_id, role) values (:'plat', 'admin');

create function pg_temp.new_org(p_owner uuid, p_identifier text default 'HRB12345') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, legal_entity_identifier, legal_entity_identifier_kind)
  values (
    v_id, 'employer', 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'DE',
    p_identifier, case when p_identifier is not null then 'registration_number' end
  );
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

-- The answer of a call as 'ok' or 'sqlstate|message|detail'; the row it returned is left in t.result.
create function pg_temp.checkout(
  p_user uuid, p_org uuid, p_plan text, p_country text, p_vat text, p_reg text, p_terms integer,
  p_aal text default 'aal2', p_extra text default ''
) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.result', (select row_to_json(r)::text from public.billing_checkout_start(%L, %L, %L, %L, %L, %L%s) r), true)$f$,
    p_org, p_plan, p_country, p_vat, p_reg, p_terms, p_extra), p_aal)
$$;

-- What the call may write, as customers|consents|audit rows of checkout starts.
create function pg_temp.written() returns text
language sql as $$
  select (select count(*) from billing.customers) || '|'
    || (select count(*) from public.consents where purpose = 'subscription-and-billing-terms') || '|'
    || (select count(*) from audit.log where action = 'billing.checkout_started')
$$;

create function pg_temp.terms() returns integer
language sql as $$ select private.current_legal_version('subscription-and-billing-terms') $$;

select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""'])
   from pg_proc where oid in (
     'public.billing_checkout_start(uuid, text, text, text, text, integer, text, integer)'::regprocedure,
     'public.billing_portal_start(uuid)'::regprocedure, 'public.billing_checkout_state(uuid)'::regprocedure))
  and has_function_privilege('authenticated', 'public.billing_checkout_start(uuid, text, text, text, text, integer, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.billing_checkout_start(uuid, text, text, text, text, integer, text, integer)', 'execute')
  and not has_function_privilege('service_role', 'public.billing_checkout_start(uuid, text, text, text, text, integer, text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.billing_trial_used(uuid, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.normalize_legal_identifier(text)', 'execute'),
  'the RPCs are security definer with an empty search_path, run for authenticated only, and the helpers are not callable'
);

-- AC4: the terms. Version 0 is the seeded draft; versions 1 and 2 are published below.
select pg_temp.new_org(:'own1') as o \gset
select set_config('t.written', pg_temp.written(), true) as base \gset

update public.legal_documents set published_at = null where slug = 'subscription-and-billing-terms';
select is(
  pg_temp.checkout(:'own1', :'o', 'employer_starter', 'DE', 'DE123456789', 'HRB 12345', 0),
  'P0001|CHARA_FORBIDDEN|terms_not_published', 'AC4: with no published version of the terms the call is refused'
);
update public.legal_documents set published_at = now() where slug = 'subscription-and-billing-terms';
insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values
  ('subscription-and-billing-terms', 1, 'Subscription and Billing Terms', 'Version one.', 'First approved text of the terms.', now() - interval '2 days'),
  ('subscription-and-billing-terms', 2, 'Subscription and Billing Terms', 'Version two.', 'Second approved text of the terms.', now() - interval '1 day');

select is(
  pg_temp.checkout(:'own1', :'o', 'employer_starter', 'DE', 'DE123456789', 'HRB 12345', 1),
  'P0001|CHARA_FORBIDDEN|terms_version_mismatch', 'AC4: an earlier version of the terms is refused'
);
select is(
  pg_temp.checkout(:'own1', :'o', 'employer_starter', 'DE', 'DE123456789', 'HRB 12345', null),
  'P0001|CHARA_FORBIDDEN|terms_version_mismatch', 'AC4: no version is refused'
);
select is(
  pg_temp.checkout(:'own1', :'o', 'employer_starter', 'DE', 'DE123456789', 'HRB 12345', 3),
  'P0001|CHARA_FORBIDDEN|terms_version_mismatch', 'AC4: a version that does not exist is refused'
);
select is(pg_temp.written(), current_setting('t.written'), 'AC4: the refused calls wrote no customer, no consent and no audit row');

select is(
  pg_temp.checkout(:'own1', :'o', 'employer_starter', 'de', 'DE 123 456 789', 'HRB 12345', 2),
  'ok', 'AC4: the current version is accepted'
);
select is(
  (select format('%s|%s|%s|%s|%s', user_id, purpose, version, action, count(*) over ())
   from public.consents where purpose = 'subscription-and-billing-terms'),
  format('%s|subscription-and-billing-terms|2|granted|1', :'own1'),
  'AC4: one consent row for the caller, the purpose, the version and the action granted'
);
select is(
  (select format('%s|%s|%s|%s', actor_id, entity_type, entity_id, count(*) over ())
   from audit.log where action = 'billing.checkout_started'),
  format('%s|organization|%s|1', :'own1', :'o'), 'AC4: one audit row names the actor and the organisation'
);
select is(
  (select metadata from audit.log where action = 'billing.checkout_started'),
  '{"plan_code": "employer_starter", "trial_days": 30, "legal_entity_trial_used": false}'::jsonb,
  'AC4: the audit metadata holds the plan and the trial length, and no VAT ID, registration number or card data'
);
select is(
  (select row_to_json(c)::jsonb - 'created_at' from billing.customers c where organization_id = :'o'),
  jsonb_build_object(
    'organization_id', :'o', 'provider', 'null', 'customer_ref', null, 'billing_country', 'DE',
    'vat_id', 'DE123456789', 'registration_number', 'HRB12345'
  ),
  'the customer holds the upper-cased country and the normalised identifiers'
);
select is(
  current_setting('t.result')::jsonb,
  jsonb_build_object('price_ref', null, 'customer_ref', null, 'trial_days', 30, 'slug', (select slug from public.organizations where id = :'o')),
  'the call returns the trial length, no price reference for the null provider, and the slug for the return address'
);

-- A second start by the same person (a cancelled checkout) records the start again but not the terms again, and keeps
-- the customer reference the webhook linked.
update billing.customers set customer_ref = 'cus_linked' where organization_id = :'o';
select is(
  pg_temp.checkout(:'own1', :'o', 'employer_professional', 'AT', 'ATU12345678', null, 2),
  'ok', 'a second start is accepted'
);
select is(
  (select count(*) from public.consents where purpose = 'subscription-and-billing-terms')
  || '|' || (select count(*) from audit.log where action = 'billing.checkout_started')
  || '|' || (select format('%s|%s|%s|%s', customer_ref, billing_country, vat_id, registration_number is null) from billing.customers where organization_id = :'o'),
  '1|2|cus_linked|AT|ATU12345678|t',
  'the terms are recorded once, each start is audited, the saved values are replaced and the linked customer reference is kept'
);
select is(
  current_setting('t.result')::jsonb ->> 'customer_ref', 'cus_linked', 'the linked customer reference is returned'
);
update billing.customers set provider = 'stripe', customer_ref = 'cus_stripe' where organization_id = :'o';
select pg_temp.checkout(:'own1', :'o', 'employer_starter', 'DE', 'DE123456789', null, 2) as again \gset
select is(
  (select format('%s|%s', provider, customer_ref is null) from billing.customers where organization_id = :'o'),
  'null|t', 'a customer reference of another provider is dropped when the provider changes'
);

-- AC5: who may start a checkout. Each refusal leaves the three tables as they were.
select pg_temp.new_org(:'own1') as p \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  (:'p', :'adm', 'admin', now()), (:'p', :'mem', 'member', now());
select set_config('t.written', pg_temp.written(), true) as base \gset

select is(pg_temp.checkout(:'mem', :'p', 'employer_starter', 'DE', 'DE123456789', null, 2), 'P0001|CHARA_FORBIDDEN|', 'AC5: a member is refused');
select is(pg_temp.checkout(:'own2', :'p', 'employer_starter', 'DE', 'DE123456789', null, 2), 'P0001|CHARA_FORBIDDEN|', 'AC5: the owner of another organisation is refused');
select is(pg_temp.checkout(:'plat', :'p', 'employer_starter', 'DE', 'DE123456789', null, 2), 'P0001|CHARA_FORBIDDEN|', 'AC5: a Platform Administrator who is no member is refused');
select is(pg_temp.checkout(:'wkr', :'p', 'employer_starter', 'DE', 'DE123456789', null, 2), 'P0001|CHARA_FORBIDDEN|', 'a candidate is refused');
select is(pg_temp.checkout(:'own1', :'p', 'employer_starter', 'DE', 'DE123456789', null, 2, 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'AC5: an owner at aal1 is refused and told to confirm the second step');
select is(pg_temp.checkout(:'adm', :'p', 'employer_starter', 'DE', 'DE123456789', null, 2, 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'AC5: an admin at aal1 is refused');
select is(
  pg_temp.call_as(null, 'anon', format($$select * from public.billing_checkout_start(%L, 'employer_starter', 'DE', 'DE123456789', null, 2)$$, :'p')),
  '42501|permission denied for function billing_checkout_start|', 'AC5: an anonymous caller has no EXECUTE'
);
select is(pg_temp.written(), current_setting('t.written'), 'AC5: every refusal left customers, consents and audit as they were');
select is(pg_temp.checkout(:'adm', :'p', 'employer_starter', 'DE', 'DE123456789', null, 2), 'ok', 'AC5: an admin at aal2 succeeds');
select is(pg_temp.checkout(:'own1', :'p', 'employer_starter', 'DE', 'DE123456789', null, 2), 'ok', 'AC5: an owner at aal2 succeeds');

update public.organizations set status = 'suspended' where id = :'p';
select is(pg_temp.checkout(:'own1', :'p', 'employer_starter', 'DE', 'DE123456789', null, 2), 'P0001|CHARA_FORBIDDEN|organization_suspended', 'a suspended organisation cannot start a checkout');
update public.organizations set status = 'active' where id = :'p';

-- AC6: plan and tax input.
select pg_temp.new_org(:'own1') as q \gset
select set_config('t.written', pg_temp.written(), true) as base \gset
select is(pg_temp.checkout(:'own1', :'q', 'employer_enterprise', 'DE', 'DE123456789', null, 2), 'P0001|CHARA_FORBIDDEN|plan_not_sold', 'AC6: Enterprise is not sold');
select is(pg_temp.checkout(:'own1', :'q', 'free_employer', 'DE', 'DE123456789', null, 2), 'P0001|CHARA_FORBIDDEN|plan_not_sold', 'AC6: the free plan is not sold');
select is(pg_temp.checkout(:'own1', :'q', 'no_such_plan', 'DE', 'DE123456789', null, 2), 'P0001|CHARA_FORBIDDEN|unknown_plan', 'AC6: an unknown plan code is refused');
select is(pg_temp.checkout(:'own1', :'q', null, 'DE', 'DE123456789', null, 2), 'P0001|CHARA_FORBIDDEN|unknown_plan', 'AC6: no plan code is refused');
select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', 'XX', 'DE123456789', null, 2), '22023|CHARA_INVALID_INPUT|billing_country', 'AC6: a country that is not in the list is refused');
select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', 'DEU', 'DE123456789', null, 2), '22023|CHARA_INVALID_INPUT|billing_country', 'AC6: a three-letter country is refused');
select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', null, 'DE123456789', null, 2), '22023|CHARA_INVALID_INPUT|billing_country', 'AC6: no country is refused');
select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', 'DE', ' ', '', 2), '22023|CHARA_INVALID_INPUT|identifier', 'AC6: with neither a VAT ID nor a registration number the call is refused');
select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', 'DE', 'DE12', null, 2), '22023|CHARA_INVALID_INPUT|vat_id', 'AC6: a VAT ID of 4 characters is refused');
select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', 'DE', '12345678', null, 2), '22023|CHARA_INVALID_INPUT|vat_id', 'a VAT ID without the two letters is refused');
select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', 'DE', 'DE1234567890123', null, 2), '22023|CHARA_INVALID_INPUT|vat_id', 'a VAT ID of 15 characters is refused');
select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', 'DE', null, 'AB1', 2), '22023|CHARA_INVALID_INPUT|registration_number', 'AC6: a registration number of 3 characters is refused');
select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', 'DE', null, repeat('A', 33), 2), '22023|CHARA_INVALID_INPUT|registration_number', 'AC6: a registration number of 33 characters is refused');
select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', 'DE', null, 'AB-12*', 2), '22023|CHARA_INVALID_INPUT|registration_number', 'a registration number with a symbol is refused');
select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', 'DE', 'DE123456789', null, 2, 'aal2', ', ''paypal'''), '22023|CHARA_INVALID_INPUT|provider', 'a provider that does not exist is refused');
select is(pg_temp.written(), current_setting('t.written'), 'AC6: no row is written by any of the refused calls');

select is(pg_temp.checkout(:'own1', :'q', 'employer_starter', 'DE', 'DE123456', null, 2), 'ok', 'AC6: a VAT ID of 8 characters after normalisation is accepted');
select pg_temp.new_org(:'own1') as q2 \gset
select is(pg_temp.checkout(:'own1', :'q2', 'employer_starter', 'DE', 'de-1234 5678.9012', null, 2), 'ok', 'AC6: a VAT ID of 14 characters after normalisation is accepted');
select pg_temp.new_org(:'own1') as q3 \gset
select is(pg_temp.checkout(:'own1', :'q3', 'employer_starter', 'DE', null, 'AB12', 2), 'ok', 'AC6: a registration number of 4 characters is accepted');
select pg_temp.new_org(:'own1') as q4 \gset
select is(pg_temp.checkout(:'own1', :'q4', 'employer_professional', 'DE', null, repeat('A', 32), 2), 'ok', 'AC6: a registration number of 32 characters is accepted');

-- FR-A2 AC7: an organisation with no stored identifier and nothing submitted is told that the identifier is required.
select pg_temp.new_org(:'own1', null) as noid \gset
select is(
  pg_temp.checkout(:'own1', :'noid', 'employer_starter', 'DE', null, null, 2),
  'P0001|CHARA_FORBIDDEN|legal_entity_identifier_required', 'FR-A2 AC7: with no identifier stored or submitted the call is refused as such'
);

-- The checks that follow the tax input.
select pg_temp.new_org(:'own1') as sub \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'sub', 'employer_starter', 'canceled', 'null');
select is(pg_temp.checkout(:'own1', :'sub', 'employer_starter', 'DE', 'DE123456789', null, 2), 'ok', 'an organisation with only cancelled subscriptions may start again');
insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'sub', 'employer_starter', 'past_due', 'null');
select is(pg_temp.checkout(:'own1', :'sub', 'employer_starter', 'DE', 'DE123456789', null, 2), 'P0001|CHARA_FORBIDDEN|already_subscribed', 'an organisation with a live subscription cannot start a second one (plan changes go through the portal)');

select pg_temp.new_org(:'own1') as strp \gset
select is(pg_temp.checkout(:'own1', :'strp', 'employer_starter', 'DE', 'DE123456789', null, 2, 'aal2', ', ''stripe'''), 'P0001|CHARA_UNAVAILABLE|plan_not_synced', 'the Stripe provider needs the price reference the mirror script stores');
insert into billing.plan_provider_refs (plan_code, provider, provider_product_ref, provider_price_ref)
values ('employer_starter', 'stripe', 'prod_basic', 'price_basic');
select is(pg_temp.checkout(:'own1', :'strp', 'employer_starter', 'DE', 'DE123456789', null, 2, 'aal2', ', ''stripe'''), 'ok', 'with the price reference stored the call succeeds');
select is(current_setting('t.result')::jsonb ->> 'price_ref', 'price_basic', 'it returns the price reference of the plan');
select is(
  (select provider from billing.customers where organization_id = :'strp'), 'stripe', 'and records the provider on the customer'
);

-- The trial length the caller was shown must still be the one that applies.
select pg_temp.new_org(:'own1') as shown \gset
select set_config('t.written', pg_temp.written(), true) as base \gset
select is(
  pg_temp.checkout(:'own1', :'shown', 'employer_starter', 'DE', 'DE123456789', null, 2, 'aal2', ', ''null'', 0'),
  'P0001|CHARA_FORBIDDEN|trial_changed', 'a trial length that differs from the disclosed one is refused'
);
select is(pg_temp.written(), current_setting('t.written'), 'and writes nothing');
select is(
  pg_temp.checkout(:'own1', :'shown', 'employer_starter', 'DE', 'DE123456789', null, 2, 'aal2', ', ''null'', 30'),
  'ok', 'the disclosed trial length is accepted'
);

select * from finish();
rollback;
