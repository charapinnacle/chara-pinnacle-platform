begin;
select plan(31);

\ir organizations_fixture.inc

-- FR-R1 AC4, AC5 (V15): billing_checkout_start sells the public, priced partner plans that are not for contact to the
-- partner organisations of the plan's type, refuses a plan of another type with plan_not_for_org_type before every other
-- plan check, and grants one free trial per legal entity across all organisation types. Replaces the closed checkout of
-- V03 (20261115100200).

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_identifier text default null) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, legal_entity_identifier,
    legal_entity_identifier_kind)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'DE',
    p_identifier, case when p_identifier is not null then 'registration_number' end);
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

-- The answer of a checkout: 'ok:<trial days>:<price reference>' or the refusal 'sqlstate|message|detail'.
create function pg_temp.checkout(
  p_user uuid, p_org uuid, p_plan text, p_reg text default 'HRB12345', p_aal text default 'aal2', p_provider text default 'null'
) returns text
language plpgsql as $$
declare
  v_answer text;
begin
  v_answer := pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.out', (select trial_days || ':' || coalesce(price_ref, '-')
       from public.billing_checkout_start(%L, %L, 'DE', null, %L, %s, %L)), true)$f$,
    p_org, p_plan, p_reg, private.current_legal_version('subscription-and-billing-terms'), p_provider), p_aal);
  return case when v_answer = 'ok' then 'ok:' || current_setting('t.out') else v_answer end;
end;
$$;

create function pg_temp.written(p_org uuid, p_user uuid) returns text
language sql as $$
  select (select count(*) from billing.customers where organization_id = p_org) || '/' ||
    (select count(*) from public.consents where user_id = p_user and purpose = 'subscription-and-billing-terms') || '/' ||
    (select count(*) from audit.log where action = 'billing.checkout_started' and entity_id = p_org::text)
$$;

\set rec_owner '00000000-0000-0000-0000-0000000f1501'
\set stf_owner '00000000-0000-0000-0000-0000000f1502'
\set rec_admin '00000000-0000-0000-0000-0000000f1503'
\set rec_member '00000000-0000-0000-0000-0000000f1504'
\set b_owner '00000000-0000-0000-0000-0000000f1505'
\set d_owner '00000000-0000-0000-0000-0000000f1506'

update private.settings set value = 'true' where key = 'release_partner_directories';
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select u.id, u.id || '@partner.test', now(), jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', u.type)
from (values
  (:'rec_owner'::uuid, 'recruitment_company'), (:'stf_owner'::uuid, 'staffing_company'), (:'rec_admin'::uuid, 'recruitment_company'),
  (:'rec_member'::uuid, 'recruitment_company'), (:'b_owner'::uuid, 'recruitment_company'), (:'d_owner'::uuid, 'recruitment_company')
) u (id, type);
update public.profiles set account_kind = intended_account_kind
where id in (:'rec_owner', :'stf_owner', :'rec_admin', :'rec_member', :'b_owner', :'d_owner');

select pg_temp.new_org(:'rec_owner', 'recruitment_company') as rec \gset
select pg_temp.new_org(:'stf_owner', 'staffing_company') as stf \gset
select pg_temp.new_org(:'own1', 'employer') as emp \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  (:'rec', :'rec_admin', 'admin', now()), (:'rec', :'rec_member', 'member', now());

-- AC4: the refusals, in the order the criterion names them, write nothing.
select is(pg_temp.checkout(:'rec_owner', :'rec', 'employer_starter'), '42501|CHARA_FORBIDDEN|plan_not_for_org_type',
  'AC4: an employer plan is not for a recruitment company');
select is(pg_temp.checkout(:'rec_owner', :'rec', 'staffing_partner'), '42501|CHARA_FORBIDDEN|plan_not_for_org_type',
  'AC4: a staffing plan is not for a recruitment company');
select is(pg_temp.checkout(:'rec_owner', :'rec', 'recruitment_enterprise'), 'P0001|CHARA_FORBIDDEN|plan_not_sold',
  'AC4: the contact-sales Enterprise plan of the own type is not sold');
select is(pg_temp.checkout(:'rec_owner', :'rec', 'free_recruitment_company'), 'P0001|CHARA_FORBIDDEN|plan_not_sold',
  'AC4: the free plan of the own type is not sold');
select is(pg_temp.checkout(:'rec_owner', :'rec', 'no_such_plan'), 'P0001|CHARA_FORBIDDEN|unknown_plan', 'AC4: an unknown code is unknown');
select is(pg_temp.checkout(:'rec_owner', :'rec', 'free_employer'), '42501|CHARA_FORBIDDEN|plan_not_for_org_type',
  'the type is checked before the plan is: a plan of another type that is not sold either is named as of another type');
select is(pg_temp.written(:'rec', :'rec_owner'), '0/0/0', 'AC4: no refusal wrote a customer, a consent or an audit row');

-- Wrong role, other organisation, worker, anonymous, second factor, suspension.
select is(pg_temp.checkout(:'rec_member', :'rec', 'recruitment_partner'), 'P0001|CHARA_FORBIDDEN|', 'a member cannot start a checkout');
select is(pg_temp.checkout(:'stf_owner', :'rec', 'recruitment_partner'), 'P0001|CHARA_FORBIDDEN|',
  'the owner of a competing partner cannot start a checkout for another organisation');
select is(pg_temp.checkout(:'rec_admin', :'rec', 'recruitment_partner', 'HRB12345', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'an admin needs the second factor');
select is(pg_temp.checkout(:'wkr', :'rec', 'recruitment_partner'), 'P0001|CHARA_FORBIDDEN|worker_account', 'a worker never pays');
select is(
  pg_temp.call_as(null, 'anon', format($$select * from public.billing_checkout_start(%L, 'recruitment_partner', 'DE', null, 'HRB12345', 1)$$, :'rec')),
  '42501|permission denied for function billing_checkout_start|', 'an anonymous caller has no EXECUTE'
);
update public.organizations set status = 'suspended' where id = :'stf';
select is(pg_temp.checkout(:'stf_owner', :'stf', 'staffing_partner'), 'P0001|CHARA_FORBIDDEN|organization_suspended',
  'a suspended partner organisation cannot buy');
update public.organizations set status = 'active' where id = :'stf';

-- Release 2a gates the partner checkout; the plan refusals read the same while it is off.
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.checkout(:'rec_owner', :'rec', 'recruitment_partner'), '42501|CHARA_FORBIDDEN|release_off',
  'while release 2a is off no partner plan is sold');
select is(pg_temp.checkout(:'rec_owner', :'rec', 'employer_starter'), '42501|CHARA_FORBIDDEN|plan_not_for_org_type',
  'and a plan of another type is still refused as such');
select is(pg_temp.checkout(:'own1', :'emp', 'employer_starter'), 'ok:30:-', 'the employer checkout does not depend on the release');
update private.settings set value = 'true' where key = 'release_partner_directories';
select is(pg_temp.written(:'rec', :'rec_owner'), '0/0/0', 'none of these wrote anything for the recruitment company');

-- AC4: the plan of the own type is sold, with its trial, and audited.
select is(pg_temp.checkout(:'rec_admin', :'rec', 'recruitment_partner'), 'ok:30:-',
  'AC4: an admin at aal2 starts the checkout of recruitment_partner with the trial of the plan (no price reference for the null provider)');
select is(
  (select string_agg(metadata ->> 'plan_code', ',') from audit.log where action = 'billing.checkout_started' and entity_id = :'rec'),
  'recruitment_partner', 'AC4: one billing.checkout_started audit row names the plan'
);
select is(pg_temp.checkout(:'stf_owner', :'stf', 'staffing_professional', 'HRB77777'), 'ok:30:-',
  'the owner of a staffing company buys a staffing plan');
select is(
  (select count(*) filter (where r = '42501|CHARA_FORBIDDEN|plan_not_for_org_type') || '/' || count(*)
   from (select pg_temp.checkout(:'own1', :'emp', p.code) as r from billing.plans p where p.org_type <> 'employer') c),
  '8/8', 'an employer owner cannot buy any partner plan'
);

-- Stripe only once the price exists at the provider (decision 7.3).
select is(pg_temp.checkout(:'stf_owner', :'stf', 'staffing_partner', 'HRB77777', 'aal2', 'stripe'), 'P0001|CHARA_UNAVAILABLE|plan_not_synced',
  'a partner plan without a Stripe price cannot be bought through Stripe');
insert into billing.plan_provider_refs (plan_code, provider, provider_product_ref, provider_price_ref)
values ('staffing_partner', 'stripe', 'prod_staffing_partner', 'price_staffing_partner');
select is(pg_temp.checkout(:'stf_owner', :'stf', 'staffing_partner', 'HRB77777', 'aal2', 'stripe'), 'ok:30:price_staffing_partner',
  'AC4: with the mirrored price the checkout returns its reference');

-- AC5: one free month per legal entity across all company types.
insert into billing.trial_grants (identifier_key, organization_id) values ('reg:DE:HRB12345', :'emp');
select pg_temp.new_org(:'b_owner', 'recruitment_company') as b \gset
select is(pg_temp.checkout(:'b_owner', :'b', 'recruitment_partner', 'hrb-12345'), 'ok:0:-',
  'AC5: a recruitment company with the registration number of an employer that had its trial gets none');
select is(pg_temp.checkout(:'b_owner', :'b', 'recruitment_partner', 'HRB 31337'), 'ok:30:-',
  'and with its own new registration number it gets the trial');
select pg_temp.new_org(:'stf_owner', 'staffing_company') as c \gset
select is(pg_temp.checkout(:'stf_owner', :'c', 'staffing_partner', 'HRB 424242'), 'ok:30:-', 'AC5: C with new identifiers receives 30 days');
select is(
  public.billing_apply_event(public.billing_ingest_event('null', 'c_sub', 'subscription.activated', jsonb_build_object(
    'orgId', :'c', 'planCode', 'staffing_partner', 'status', 'trialing', 'providerSubscriptionRef', 'sub_c',
    'trialEndsAt', '2026-12-27T10:00:00Z'), true, now())),
  'applied', 'AC5: the first trialing subscription of C is applied by the webhook'
);
select is((select string_agg(identifier_key, ',') from billing.trial_grants where organization_id = :'c'), 'reg:DE:HRB424242',
  'AC5: after the webhook C''s identifier is a trial grant');
select pg_temp.new_org(:'d_owner', 'recruitment_company') as d \gset
select is(pg_temp.checkout(:'d_owner', :'d', 'recruitment_partner', 'HRB424242'), 'ok:0:-',
  'AC5: a later checkout of an organisation of another type with the same identifier receives no trial');
select pg_temp.new_org(:'own2', 'employer') as e \gset
select is(pg_temp.checkout(:'own2', :'e', 'employer_starter', 'HRB 424242'), 'ok:0:-',
  'AC5: and an employer with the identifier of the staffing company that had its trial receives none either');
select is(
  public.billing_apply_event(public.billing_ingest_event('null', 'd_wrong', 'subscription.activated', jsonb_build_object(
    'orgId', :'d', 'planCode', 'employer_starter', 'status', 'active', 'providerSubscriptionRef', 'sub_d'), true, now())),
  'error', 'a subscription event naming a plan of another type is never applied to the organisation'
);

select * from finish();
rollback;
