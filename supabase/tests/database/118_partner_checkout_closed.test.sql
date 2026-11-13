begin;
select plan(5);

\ir organizations_fixture.inc

-- Partner checkout stays closed until V15 (V03; carry-over of the V01 review): once partner organisations can be created,
-- billing_checkout_start must not sell a partner plan, not even one of the organisation's own type.

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, legal_entity_identifier,
    legal_entity_identifier_kind)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'DE',
    'DE123456789', 'vat_number');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.checkout(p_user uuid, p_org uuid, p_plan text) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select * from public.billing_checkout_start(%L, %L, 'DE', 'DE123456789', null, %s)$f$,
    p_org, p_plan, private.current_legal_version('subscription-and-billing-terms')))
$$;

\set p2 '00000000-0000-0000-0000-0000000e0001'
\set p4 '00000000-0000-0000-0000-0000000e0002'

update private.settings set value = 'true' where key = 'release_partner_directories';
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  (:'p2', 'p2@partner.test', now(), '{"intended_account_kind": "company", "intended_organization_type": "staffing_company"}'),
  (:'p4', 'p4@partner.test', now(), '{"intended_account_kind": "company", "intended_organization_type": "recruitment_company"}');
update public.profiles set account_kind = intended_account_kind where id in (:'p2', :'p4');
select pg_temp.new_org(:'p2', 'staffing_company') as stf \gset
select pg_temp.new_org(:'p4', 'recruitment_company') as rec \gset
select pg_temp.new_org(:'own1', 'employer') as emp \gset

select is(
  (select count(*) filter (where r = 'P0001|CHARA_FORBIDDEN|plan_not_sold') || '/' || count(*)
   from (select pg_temp.checkout(:'p2', :'stf', p.code) as r from billing.plans p where p.org_type = 'staffing_company') c),
  '4/4',
  'a staffing company owner at aal2 cannot check out any plan of the own type'
);
select is(
  (select count(*) filter (where r = 'P0001|CHARA_FORBIDDEN|plan_not_sold') || '/' || count(*)
   from (select pg_temp.checkout(:'p4', :'rec', p.code) as r from billing.plans p) c),
  '12/12',
  'a recruitment company owner cannot check out any plan at all'
);
select is(
  (select count(*) from billing.customers where organization_id in (:'stf', :'rec')),
  0::bigint,
  'the refused checkouts wrote no customer'
);
select is(
  (select count(*) filter (where r = 'P0001|CHARA_FORBIDDEN|plan_not_sold') || '/' || count(*)
   from (select pg_temp.checkout(:'own1', :'emp', p.code) as r from billing.plans p where p.org_type <> 'employer') c),
  '8/8',
  'an employer owner cannot check out a partner plan either'
);
select is(
  pg_temp.checkout(:'own1', :'emp', 'employer_starter'),
  'ok',
  'the employer checkout of an employer plan is unchanged'
);

select * from finish();
rollback;
