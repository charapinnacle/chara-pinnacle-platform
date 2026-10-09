begin;
select plan(14);

\ir organizations_fixture.inc

-- FR-H2 AC9: the pricing page reads public.v_plans. A visitor sees exactly the public plans, the rest of billing is
-- closed to them, and no API role writes a plan.

create function pg_temp.new_org(p_owner uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'employer', 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.codes_as(p_role text, p_user uuid default null) returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', 'aal1')::text end,
    true
  );
  execute format('set local role %I', p_role);
  select string_agg(code, ',' order by sort) into v_result from public.v_plans;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

select pg_temp.new_org(:'own1') as o \gset

select is(
  pg_temp.codes_as('anon'), 'employer_starter,employer_professional',
  'a visitor sees exactly the public plans, in display order'
);

update billing.plans set is_public = true, contact_sales = false, price_minor = 19900 where code = 'employer_enterprise';
select is(
  pg_temp.codes_as('anon'), 'employer_starter,employer_professional,employer_enterprise',
  'a plan made public appears at once'
);

update billing.plans set contact_sales = true where code = 'employer_enterprise';
select is(
  (select format('%s|%s', count(*), bool_and(contact_sales)) from public.v_plans where code = 'employer_enterprise'),
  '1|t', 'a plan sold by contact is a row of the view with contact_sales set'
);

update billing.plans set is_public = false where code = 'employer_enterprise';
select is(
  pg_temp.codes_as('anon'), 'employer_starter,employer_professional',
  'a plan made private disappears again'
);

insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (:'o', 'employer_enterprise', 'active', 'null');
select is(
  pg_temp.codes_as('authenticated', :'own1'), 'employer_starter,employer_professional,employer_enterprise',
  'a member also reads the plan of the own organisation, so the page filters on is_public itself'
);
select is(
  pg_temp.codes_as('authenticated', :'own2'), 'employer_starter,employer_professional',
  'a person of another organisation does not'
);

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'v_plans' and column_name ~* 'provider|stripe|ref$|customer'),
  0::bigint, 'the view holds no column of the payment provider'
);
select is(
  (select count(*) from pg_class c, lateral unnest(coalesce(c.reloptions, '{}')) o
   where c.oid = 'public.v_plans'::regclass and o = 'security_invoker=true'),
  1::bigint, 'the view is security_invoker'
);

select is(
  (select count(*) from (values ('anon'), ('authenticated')) r (rol)
    cross join (values ('billing.subscriptions'), ('billing.customers'), ('billing.orders'), ('billing.provider_events'),
      ('billing.trial_grants'), ('billing.plan_provider_refs')) t (tbl)
    where has_table_privilege(r.rol, t.tbl, 'select')),
  0::bigint, 'a visitor and a signed-in user hold no table-wide select on the other billing tables'
);

set local role anon;
select throws_ok($$select count(*) from billing.subscriptions$$, '42501', 'permission denied for table subscriptions', 'a visitor is refused the subscriptions');
select throws_ok($$select count(*) from billing.customers$$, '42501', 'permission denied for table customers', 'and the customers');
select throws_ok($$select count(*) from billing.orders$$, '42501', 'permission denied for table orders', 'and the orders');
select throws_ok($$select count(*) from billing.provider_events$$, '42501', 'permission denied for table provider_events', 'and the provider events');
select throws_ok($$update billing.plans set price_minor = 1$$, '42501', 'permission denied for table plans', 'and cannot change a price');
reset role;

select * from finish();
rollback;
