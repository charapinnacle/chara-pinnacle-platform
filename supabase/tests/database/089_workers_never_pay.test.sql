begin;
select plan(53);

\ir organizations_fixture.inc

-- FR-G6 (ILO Convention C181): a candidate account can neither start a checkout or the portal, nor hold a
-- subscription. AC1 to AC4 and the KPI of the SOP (worker checkout attempts refused, 100 %).

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

create function pg_temp.terms() returns integer
language sql as $$ select private.current_legal_version('subscription-and-billing-terms') $$;

-- Each call returns 'ok' or 'sqlstate|message|detail'.
create function pg_temp.checkout(p_user uuid, p_org uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.result', (select row_to_json(r)::text from public.billing_checkout_start(%L, 'employer_starter', 'DE', null, 'HRB12345', %L) r), true)$f$,
    p_org, pg_temp.terms()), p_aal)
$$;

create function pg_temp.portal(p_user uuid, p_org uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format($f$select * from public.billing_portal_start(%L)$f$, p_org), p_aal)
$$;

create function pg_temp.page_state(p_user uuid, p_org uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format($f$select * from public.billing_checkout_state(%L)$f$, p_org), p_aal)
$$;

-- The tables a table references, schema-qualified, whatever the search path.
create function pg_temp.references_of(p_table regclass) returns text[]
language sql as $$
  select array_agg(distinct n.nspname || '.' || t.relname order by n.nspname || '.' || t.relname)
  from pg_constraint c join pg_class t on t.oid = c.confrelid join pg_namespace n on n.oid = t.relnamespace
  where c.conrelid = p_table and c.contype = 'f'
$$;

-- What a call may write: customers|subscriptions|trial grants|consents|audit rows.
create function pg_temp.written() returns text
language sql as $$
  select (select count(*) from billing.customers) || '|' || (select count(*) from billing.subscriptions) || '|'
    || (select count(*) from billing.trial_grants) || '|' || (select count(*) from public.consents) || '|'
    || (select count(*) from audit.log)
$$;

select pg_temp.new_org(:'own1') as o \gset
select pg_temp.new_org(:'own1') as p \gset
insert into billing.customers (organization_id, provider, customer_ref, billing_country, vat_id) values (:'o', 'null', 'cus_o', 'DE', 'DE123456789');
insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at)
values (:'o', 'employer_starter', 'trialing', 'null', now() + interval '10 days');
select gen_random_uuid() as unknown \gset
select set_config('t.written', pg_temp.written(), true) as base \gset

-- AC1: the refusal comes first and does not depend on the organisation id.
select is(
  (select string_agg(distinct pg_temp.checkout(u.id, o.id), ' ; ')
   from (values (:'wkr'::uuid)) u (id) cross join (values (:'o'::uuid), (:'p'::uuid), (:'unknown'::uuid)) o (id)),
  'P0001|CHARA_FORBIDDEN|worker_account', 'AC1: a worker is refused the checkout with the same answer for a company organisation, another one and a random id'
);
select is(
  (select string_agg(distinct pg_temp.portal(u.id, o.id), ' ; ')
   from (values (:'wkr'::uuid)) u (id) cross join (values (:'o'::uuid), (:'p'::uuid), (:'unknown'::uuid)) o (id)),
  'P0001|CHARA_FORBIDDEN|worker_account', 'AC1: and the portal'
);
select is(
  (select string_agg(distinct pg_temp.page_state(u.id, o.id), ' ; ')
   from (values (:'wkr'::uuid)) u (id) cross join (values (:'o'::uuid), (:'p'::uuid), (:'unknown'::uuid)) o (id)),
  'P0001|CHARA_FORBIDDEN|worker_account', 'AC1: and the state the billing page reads'
);
select is(pg_temp.checkout(:'wkr', :'o', 'aal1'), 'P0001|CHARA_FORBIDDEN|worker_account', 'AC1: the account kind is checked before the second step: a worker at aal1 gets the same answer');
select is(pg_temp.portal(:'wkr', :'o', 'aal1'), 'P0001|CHARA_FORBIDDEN|worker_account', 'AC1: also for the portal');

select is(
  (select string_agg(distinct pg_temp.checkout(u.id, o.id), ' ; ')
   from (values (:'nul'::uuid)) u (id) cross join (values (:'o'::uuid), (:'p'::uuid), (:'unknown'::uuid)) o (id)),
  'P0001|CHARA_FORBIDDEN|account_kind_unset', 'AC1: a user whose account kind is not set is refused the checkout, for any organisation id'
);
select is(
  (select string_agg(distinct pg_temp.portal(u.id, o.id), ' ; ')
   from (values (:'nul'::uuid)) u (id) cross join (values (:'o'::uuid), (:'p'::uuid), (:'unknown'::uuid)) o (id)),
  'P0001|CHARA_FORBIDDEN|account_kind_unset', 'AC1: and the portal'
);
select is(pg_temp.page_state(:'nul', :'o'), 'P0001|CHARA_FORBIDDEN|account_kind_unset', 'AC1: and the page state');

select is(pg_temp.written(), current_setting('t.written'), 'AC1: the refused calls leave no row in the customers, subscriptions, trial grants, consents or audit log (the order of the checks is proven by the identical answers for any organisation id above)');

select is(
  pg_temp.call_as(null, 'anon', format($$select * from public.billing_checkout_start(%L, 'employer_starter', 'DE', null, 'HRB12345', 0)$$, :'o')),
  '42501|permission denied for function billing_checkout_start|', 'AC1: an anonymous caller has no EXECUTE on the checkout'
);
select is(
  pg_temp.call_as(null, 'anon', format($$select * from public.billing_portal_start(%L)$$, :'o')),
  '42501|permission denied for function billing_portal_start|', 'AC1: nor on the portal'
);

-- The control: a company owner passes the account-kind check and gets the parameters of its own organisation.
select is(pg_temp.checkout(:'own1', :'p'), 'ok', 'AC1: a company owner at aal2 starts a checkout, so the refusal is not a blanket one');
select is(
  (current_setting('t.result')::jsonb) ->> 'slug', (select slug from public.organizations where id = :'p'),
  'AC1: and receives the parameters of its own organisation'
);
select isnt(pg_temp.written(), current_setting('t.written'), 'AC1: and the start writes its rows, which shows the check above can see a write');
select is(pg_temp.portal(:'own1', :'o'), 'ok', 'AC1: the owner opens the portal of an organisation with a customer');
select is(pg_temp.page_state(:'own1', :'o'), 'ok', 'AC1: and reads the page state');
select is(pg_temp.portal(:'own1', :'unknown'), 'P0001|CHARA_FORBIDDEN|', 'AC1: a company user is still refused for an organisation that is not theirs, without the worker detail');
select is(pg_temp.checkout(:'own2', :'o'), 'P0001|CHARA_FORBIDDEN|', 'AC1: and the owner of another organisation is refused the checkout without it');

select ok(
  (select bool_and(prosecdef is false and proconfig = array['search_path=""']) from pg_proc where oid = 'private.assert_company_account()'::regprocedure)
  and not has_function_privilege('authenticated', 'private.assert_company_account()', 'execute')
  and not has_function_privilege('anon', 'private.assert_company_account()', 'execute'),
  'the check is a private function with a fixed search path that no API role can call'
);

-- AC2: no billing structure can hold a worker.
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'billing' and column_name in ('user_id', 'worker_user_id', 'profile_id', 'candidate_id', 'created_by', 'actor_id')),
  0::bigint, 'AC2: no billing table has a column for a person'
);
select is(
  (select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'billing' and c.contype = 'f' and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)),
  0::bigint, 'AC2: no billing table has a foreign key to auth.users or public.profiles'
);
select is(
  pg_temp.references_of('billing.subscriptions'), array['billing.plans', 'public.organizations'], 'AC2: billing.subscriptions references plans and organisations only'
);
select is(
  pg_temp.references_of('billing.customers'), array['public.countries', 'public.organizations'], 'AC2: billing.customers references organisations (and the country list) only'
);
select is(
  (select count(*) from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'billing'::regnamespace
     and c.confrelid not in ('public.organizations'::regclass, 'public.countries'::regclass, 'public.currencies'::regclass)
     and (select t.relnamespace from pg_class t where t.oid = c.confrelid) <> 'billing'::regnamespace),
  0::bigint, 'AC2: every foreign key of the billing schema points to an organisation, a reference list (countries, currencies) or another billing table'
);
select is(
  enum_range(null::public.organization_type)::text, '{employer,recruitment_company,staffing_company}',
  'AC2: organization_type has no worker label'
);

-- AC3: a worker cannot become a billing user through an organisation.
select pg_temp.call_as(:'own1', 'authenticated', format(
  $f$select set_config('t.token', (select token from public.invite_member(%L, '00000000-0000-0000-0000-00000000e005@example.test', 'admin')), true)$f$, :'o')) as invited \gset
select is(:'invited'::text, 'ok', 'AC3: setup: a pending invitation to the worker''s address');
select throws_ok(
  format($$insert into public.organization_members (organization_id, user_id, role, accepted_at) values (%L, %L, 'admin', now())$$, :'o', :'wkr'),
  'P0001', 'CHARA_FORBIDDEN', 'AC3: a membership row for the worker is rejected by the trigger'
);
select is(
  pg_temp.call_as(:'wkr', 'authenticated', $$select public.accept_invitation(current_setting('t.token'))$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|workers_cannot_join_organizations', 'AC3: accept_invitation raises for the worker'
);
select is(
  (select count(*) from public.organization_members where user_id = :'wkr'), 0::bigint, 'AC3: the worker has no membership'
);
select is(
  pg_temp.val_as(:'wkr', 'aal2', 'select count(*) from public.v_my_subscription'), '0',
  'AC3: the subscription view returns no row to the worker, although the organisation has a subscription'
);
select is(
  pg_temp.val_as(:'own1', 'aal2', format('select count(*) from public.v_my_subscription where organization_id = %L', :'o')), '1',
  'AC3: the same view returns it to the owner of the organisation'
);

-- AC4: a worker cannot become a company user later.
select is(
  pg_temp.call_as(:'wkr', 'authenticated', format($$update public.profiles set account_kind = 'company' where id = %L$$, :'wkr'), 'aal1'),
  '42501|permission denied for table profiles|', 'AC4: the API refuses the worker''s own update of the account kind: the role has no UPDATE privilege on the profile'
);
select is((select account_kind::text from public.profiles where id = :'wkr'), 'worker', 'AC4: the account kind stays worker after the update through the API');
select throws_ok(
  format($$update public.profiles set account_kind = 'company' where id = %L$$, :'wkr'),
  'P0001', 'CHARA_FORBIDDEN', 'AC4: the immutability trigger rejects the change of the account kind, as the table owner too'
);
select throws_ok(
  format($$update public.profiles set intended_account_kind = 'company' where id = %L$$, :'wkr'),
  'P0001', 'CHARA_FORBIDDEN', 'AC4: and the change of the intended kind'
);
select is(pg_temp.val_as(:'wkr', 'aal1', $$select public.set_account_kind()::text$$), 'worker', 'AC4: set_account_kind answers worker and changes nothing');
select is((select account_kind::text from public.profiles where id = :'wkr'), 'worker', 'AC4: the account kind is still worker');
select is(pg_temp.checkout(:'wkr', :'p'), 'P0001|CHARA_FORBIDDEN|worker_account', 'AC4: the checkout still raises worker_account');

-- The KPI of the SOP: the attempts the billing-checkout function records after the refusal, and the attempts that got through.
create function pg_temp.record_attempt(p_user uuid) returns text
language sql as $$
  select pg_temp.call_as(null, 'service_role', format(
    $f$select set_config('t.recorded', public.billing_record_worker_attempt(%L)::text, true)$f$, p_user))
  || '|' || current_setting('t.recorded')
$$;
select is(pg_temp.record_attempt(:'wkr'), 'ok|true', 'KPI: the function records a refused attempt of the worker');
select is(pg_temp.record_attempt(:'wkr'), 'ok|true', 'KPI: and a second one');
create function pg_temp.worker_kpi() returns text
language sql as $$
  select format('%s|%s',
    (select count(*) from audit.log where action = 'billing.worker_checkout_refused'),
    (select count(*) from audit.log l join public.profiles p on p.id = l.actor_id
     where l.action in ('billing.checkout_started', 'billing.portal_opened') and p.account_kind = 'worker'))
$$;
select is(pg_temp.worker_kpi(), '2|0', 'KPI: two refusals are counted and no worker checkout or portal start exists, so 100 % are refused');
select is(
  (select row(actor_id, entity_type, entity_id, metadata)::text from audit.log where action = 'billing.worker_checkout_refused' limit 1),
  format('(%s,profile,%s,{})', :'wkr'::text, :'wkr'::text),
  'KPI: the record names the worker, the profile and carries no payload'
);
select is(
  (select count(*) from audit.log where action = 'billing.checkout_started' and actor_id = :'own1'), 1::bigint,
  'KPI: the company owner''s start is recorded under the owner and is not counted as a worker''s'
);
select is(pg_temp.record_attempt(:'own1'), 'ok|false', 'KPI: a company account is not recorded as a refused worker');
select is(pg_temp.record_attempt(gen_random_uuid()), 'ok|false', 'KPI: nor an unknown user');
select is((select count(*) from audit.log where action = 'billing.worker_checkout_refused'), 2::bigint, 'KPI: both wrote nothing');

-- A loop cannot grow the log without bound: the allowance per person and window.
update private.settings set value = '3' where key = 'worker_checkout_refused_audit_max';
select pg_temp.record_attempt(:'wkr') as third \gset
select is(:'third'::text, 'ok|true', 'KPI: the attempt that reaches the allowance of the window is still recorded');
select is(pg_temp.record_attempt(:'wkr'), 'ok|false', 'KPI: an attempt beyond the allowance is not recorded');
select is(
  (select count(*) from audit.log where action = 'billing.worker_checkout_refused' and actor_id = :'wkr'), 3::bigint,
  'KPI: the log holds the allowance and no more'
);
update private.settings set value = '0' where key = 'worker_checkout_refused_audit_seconds';
select is(pg_temp.record_attempt(:'wkr'), 'ok|true', 'KPI: only the attempts inside the window count: with an empty window the allowance is open again');
select is(
  pg_temp.call_as(null, 'anon', format($$select public.billing_record_worker_attempt(%L)$$, :'wkr')),
  '42501|permission denied for function billing_record_worker_attempt|', 'KPI: an anonymous caller cannot record'
);
select is(
  pg_temp.call_as(:'wkr', 'authenticated', format($$select public.billing_record_worker_attempt(%L)$$, :'wkr')),
  '42501|permission denied for function billing_record_worker_attempt|', 'KPI: nor can the worker, so the allowance is not a way to write the log'
);

-- AC8 (manual check, kept honest): the Platform Rules in force say that a worker never pays and where to report a fee request.
select ok(
  (select d.body ~* 'never pay' and d.body ~* 'finding work' and d.body ~* 'applying' and d.body ~* 'Trust & Safety Administrator'
   from public.legal_documents d where d.slug = 'platform-rules' order by d.version desc limit 1),
  'AC8: the current Platform Rules state that a worker never pays and name the Trust & Safety Administrator as the recipient of fee-request reports'
);

select * from finish();
rollback;
