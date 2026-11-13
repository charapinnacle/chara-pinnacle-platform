begin;
select plan(38);

\ir organizations_fixture.inc

-- FR-R1 data (docs/phase-2/DATA_MODEL.md sections 2, 4 and 8): the eight partner plans, their limits and features, the
-- Phase 2 rows of the employer plans and the catalogue billing.limit_keys and billing.feature_keys. AC1, AC2 and AC9;
-- checkout, usage and enforcement at the boundary belong to later units. The second load of the seed file is checked
-- in the browser project (plans-seed.spec.ts): the test container sees this directory only.

create function pg_temp.read_as(p_user uuid, p_role text, p_sql text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', 'aal2')::text end,
    true
  );
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_result;
  exception when others then
    v_result := sqlstate || '|' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.on_plan(p_owner uuid, p_type public.organization_type, p_plan text) returns uuid
language plpgsql as $$
declare
  v_id uuid := pg_temp.new_org(p_owner, p_type);
begin
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  return v_id;
end;
$$;

-- The features among those AC9 names that private.has_feature grants.
create function pg_temp.features_of(p_org uuid) returns text
language sql as $$
  select coalesce(string_agg(k, ',' order by k), '')
  from unnest(array['worker_search', 'advanced_worker_search', 'employer_discovery', 'advanced_employer_discovery',
    'analytics_advanced', 'analytics_enterprise']) k
  where private.has_feature(p_org, k)
$$;

-- AC1: the plan records
select results_eq(
  $$select code, org_type::text, name, price_minor, currency, interval, trial_days, is_public, contact_sales, is_default_trial
    from billing.plans where org_type <> 'employer' order by sort$$,
  $$values
    ('free_recruitment_company', 'recruitment_company', 'Free', 0, 'EUR', 'month', 0, false, false, false),
    ('recruitment_partner', 'recruitment_company', 'Basic', 4900, 'EUR', 'month', 30, true, false, false),
    ('recruitment_professional', 'recruitment_company', 'Professional', 9900, 'EUR', 'month', 30, true, false, false),
    ('recruitment_enterprise', 'recruitment_company', 'Enterprise', 19900, 'EUR', 'month', 30, true, true, false),
    ('free_staffing_company', 'staffing_company', 'Free', 0, 'EUR', 'month', 0, false, false, false),
    ('staffing_partner', 'staffing_company', 'Basic', 5900, 'EUR', 'month', 30, true, false, false),
    ('staffing_professional', 'staffing_company', 'Professional', 12900, 'EUR', 'month', 30, true, false, false),
    ('staffing_enterprise', 'staffing_company', 'Enterprise', 24900, 'EUR', 'month', 30, true, true, false)$$,
  'the eight partner plans carry their prices excluding VAT, the 30-day trial and Enterprise sold on request'
);
select results_eq(
  $$select code, name, price_minor, trial_days, is_public, contact_sales, is_default_trial, sort
    from billing.plans where org_type = 'employer' order by sort$$,
  $$values
    ('free_employer', 'Free', 0, 0, false, false, false, 0),
    ('employer_starter', 'Basic', 3900, 30, true, false, true, 10),
    ('employer_professional', 'Professional', 7900, 30, true, false, false, 20),
    ('employer_enterprise', 'Enterprise', 0, 30, false, true, false, 30)$$,
  'the four employer plans are unchanged'
);
select is((select count(*) from billing.plans), 12::bigint, 'there are exactly twelve plans');
select pg_temp.new_org(:'own1', 'recruitment_company') as rec, pg_temp.new_org(:'own1', 'staffing_company') as sta \gset
select is(
  private.org_plan_code(:'rec') || ',' || private.org_plan_code(:'sta'),
  'free_recruitment_company,free_staffing_company',
  'a partner organisation without a subscription resolves to the seeded fallback plan of its type'
);

-- AC2: limits, one row per limit key of the plan's type
select results_eq(
  $$select l.plan_code, string_agg(l.limit_key || '=' || coalesce(l.limit_value::text, 'unlimited'), ',' order by l.limit_key)
    from billing.plan_limits l join billing.plans p on p.code = l.plan_code
    where p.org_type <> 'employer' group by l.plan_code, p.sort order by p.sort$$,
  $$values
    ('free_recruitment_company', 'active_jobs=0,candidate_submissions_per_month=0,job_order_responses_per_month=0,listed_occupations=10,markets=3,members=0,messages_per_month=0,workforce_listings=0'),
    ('recruitment_partner', 'active_jobs=0,candidate_submissions_per_month=25,job_order_responses_per_month=10,listed_occupations=10,markets=3,members=1,messages_per_month=100,workforce_listings=10'),
    ('recruitment_professional', 'active_jobs=0,candidate_submissions_per_month=100,job_order_responses_per_month=50,listed_occupations=30,markets=10,members=5,messages_per_month=500,workforce_listings=50'),
    ('recruitment_enterprise', 'active_jobs=0,candidate_submissions_per_month=500,job_order_responses_per_month=200,listed_occupations=unlimited,markets=unlimited,members=15,messages_per_month=2000,workforce_listings=unlimited'),
    ('free_staffing_company', 'active_jobs=0,candidate_submissions_per_month=0,job_order_responses_per_month=0,listed_occupations=10,markets=3,members=0,messages_per_month=0,workforce_listings=0'),
    ('staffing_partner', 'active_jobs=0,candidate_submissions_per_month=25,job_order_responses_per_month=10,listed_occupations=10,markets=3,members=1,messages_per_month=100,workforce_listings=10'),
    ('staffing_professional', 'active_jobs=0,candidate_submissions_per_month=100,job_order_responses_per_month=50,listed_occupations=30,markets=10,members=5,messages_per_month=500,workforce_listings=50'),
    ('staffing_enterprise', 'active_jobs=0,candidate_submissions_per_month=500,job_order_responses_per_month=200,listed_occupations=unlimited,markets=unlimited,members=15,messages_per_month=2000,workforce_listings=unlimited')$$,
  'the partner limits are the values of the data model; null (unlimited) only on Enterprise'
);
select is_empty(
  $$select p.code, k.key from billing.plans p join billing.limit_keys k on p.org_type = any (k.org_types)
    where not exists (select 1 from billing.plan_limits l where l.plan_code = p.code and l.limit_key = k.key)
    union all
    select l.plan_code, l.limit_key from billing.plan_limits l join billing.plans p on p.code = l.plan_code
    where not exists (select 1 from billing.limit_keys k where k.key = l.limit_key and p.org_type = any (k.org_types))$$,
  'every plan has a row for every limit key of its type and none for another key, so no missing row reads as unlimited'
);
select results_eq(
  $$select p.code, string_agg(f.feature_key, ',' order by f.feature_key)
    from billing.plans p join billing.plan_features f on f.plan_code = p.code
    where p.org_type <> 'employer' group by p.code, p.sort order by p.sort$$,
  $$values
    ('recruitment_partner', 'analytics_basic,employer_discovery,job_order_access,worker_search'),
    ('recruitment_professional', 'advanced_employer_discovery,advanced_worker_search,analytics_advanced,analytics_basic,employer_discovery,job_order_access,worker_search'),
    ('recruitment_enterprise', 'advanced_employer_discovery,advanced_worker_search,analytics_advanced,analytics_basic,analytics_enterprise,employer_discovery,job_order_access,worker_search'),
    ('staffing_partner', 'analytics_basic,employer_discovery,job_order_access,worker_search'),
    ('staffing_professional', 'advanced_employer_discovery,advanced_worker_search,analytics_advanced,analytics_basic,employer_discovery,job_order_access,worker_search'),
    ('staffing_enterprise', 'advanced_employer_discovery,advanced_worker_search,analytics_advanced,analytics_basic,analytics_enterprise,employer_discovery,job_order_access,worker_search')$$,
  'Basic, Professional and Enterprise of both types carry their features, each tier adding to the one below'
);
select is_empty(
  $$select 1 from billing.plan_features where plan_code in ('free_recruitment_company', 'free_staffing_company', 'free_employer')$$,
  'the free plans have no feature row'
);
select is_empty(
  $$select f.plan_code, f.feature_key from billing.plan_features f join billing.plans p on p.code = f.plan_code
    where not exists (select 1 from billing.feature_keys k where k.key = f.feature_key and p.org_type = any (k.org_types))$$,
  'every feature row names a catalogue key of the plan''s type'
);

-- The employer plans: Phase 1 rows unchanged, Phase 2 rows added
select results_eq(
  $$select plan_code, string_agg(limit_key || '=' || coalesce(limit_value::text, 'unlimited'), ',' order by limit_key)
    from billing.plan_limits where plan_code like '%employer%' group by plan_code order by plan_code$$,
  $$values
    ('employer_enterprise', 'active_jobs=50,active_requirements=50,members=15,messages_per_month=2000,partner_invitations_per_requirement=25'),
    ('employer_professional', 'active_jobs=15,active_requirements=15,members=5,messages_per_month=500,partner_invitations_per_requirement=10'),
    ('employer_starter', 'active_jobs=3,active_requirements=3,members=1,messages_per_month=100,partner_invitations_per_requirement=3'),
    ('free_employer', 'active_jobs=0,active_requirements=0,members=0,messages_per_month=0,partner_invitations_per_requirement=0')$$,
  'the employer limits keep their Phase 1 values and add active requirements, partner invitations and messages'
);
select results_eq(
  $$select plan_code, string_agg(feature_key, ',' order by feature_key)
    from billing.plan_features where plan_code like '%employer%' group by plan_code order by plan_code$$,
  $$values
    ('employer_enterprise', 'advanced_partner_search,advanced_worker_search,analytics_advanced,available_workforce_search,csv_export,multi_country_requirements,shortlisting,worker_search'),
    ('employer_professional', 'advanced_partner_search,advanced_worker_search,analytics_advanced,available_workforce_search,csv_export,multi_country_requirements,shortlisting,worker_search'),
    ('employer_starter', 'available_workforce_search,csv_export,shortlisting,worker_search')$$,
  'the employer features keep their Phase 1 rows and add worker and workforce search on every paid plan, the advanced ones on Professional and Enterprise'
);

-- The catalogue
select results_eq(
  $$select key, org_types::text, period from billing.limit_keys order by key$$,
  $$values
    ('active_jobs', '{employer,recruitment_company,staffing_company}', 'none'),
    ('active_requirements', '{employer}', 'none'),
    ('candidate_submissions_per_month', '{recruitment_company,staffing_company}', 'month'),
    ('job_order_responses_per_month', '{recruitment_company,staffing_company}', 'month'),
    ('listed_occupations', '{recruitment_company,staffing_company}', 'none'),
    ('markets', '{recruitment_company,staffing_company}', 'none'),
    ('members', '{employer,recruitment_company,staffing_company}', 'none'),
    ('messages_per_month', '{employer,recruitment_company,staffing_company}', 'month'),
    ('partner_invitations_per_requirement', '{employer}', 'none'),
    ('workforce_listings', '{recruitment_company,staffing_company}', 'none')$$,
  'the limit keys are the canonical ones with their organisation types and period'
);
select results_eq(
  $$select key, org_types::text from billing.feature_keys order by key$$,
  $$values
    ('advanced_employer_discovery', '{recruitment_company,staffing_company}'),
    ('advanced_partner_search', '{employer}'),
    ('advanced_worker_search', '{employer,recruitment_company,staffing_company}'),
    ('analytics_advanced', '{employer,recruitment_company,staffing_company}'),
    ('analytics_basic', '{recruitment_company,staffing_company}'),
    ('analytics_enterprise', '{recruitment_company,staffing_company}'),
    ('available_workforce_search', '{employer}'),
    ('csv_export', '{employer}'),
    ('employer_discovery', '{recruitment_company,staffing_company}'),
    ('job_order_access', '{recruitment_company,staffing_company}'),
    ('multi_country_requirements', '{employer}'),
    ('shortlisting', '{employer}'),
    ('worker_search', '{employer,recruitment_company,staffing_company}')$$,
  'the feature keys are the canonical ones with their organisation types'
);
select is_empty(
  $$select key from billing.limit_keys where label = '' union all select key from billing.feature_keys where label = ''$$,
  'every key has a label'
);
select col_is_pk('billing', 'limit_keys', 'key', 'a limit key is unique');
select col_is_pk('billing', 'feature_keys', 'key', 'a feature key is unique');
select throws_ok(
  $$insert into billing.limit_keys (key, org_types, period, label) values ('markets', '{employer}', 'none', 'Again')$$,
  '23505', null, 'a limit key cannot be added twice'
);
select throws_ok(
  $$insert into billing.limit_keys (key, org_types, period, label) values ('Bad Key', '{employer}', 'none', 'Bad')$$,
  '23514', null, 'a limit key that is not snake_case is refused'
);
select throws_ok(
  $$insert into billing.limit_keys (key, org_types, period, label) values ('probe_limit', '{}', 'none', 'Probe')$$,
  '23514', null, 'a limit key applies to at least one organisation type'
);
select throws_ok(
  $$insert into billing.limit_keys (key, org_types, period, label) values ('probe_limit', '{employer}', 'week', 'Probe')$$,
  '23514', null, 'a period other than none and month is refused'
);
select throws_ok(
  $$insert into billing.feature_keys (key, org_types, label) values ('probe_feature', '{employer}', ' Probe ')$$,
  '23514', null, 'a label with surrounding spaces is refused'
);

-- Row level security and grants on the catalogue
select is(
  (select count(*) from pg_class where oid in ('billing.limit_keys'::regclass, 'billing.feature_keys'::regclass)
     and relrowsecurity and relforcerowsecurity and relowner = 'billing_owner'::regrole),
  2::bigint, 'both catalogue tables are owned by billing_owner with row level security enabled and forced'
);
select is(
  (select count(*) from (values ('anon'), ('authenticated')) r (rol)
    cross join (values ('billing.limit_keys'), ('billing.feature_keys')) t (tbl)
    where not has_table_privilege(r.rol, t.tbl, 'select')
       or has_table_privilege(r.rol, t.tbl, 'insert, update, delete, truncate, references, trigger')),
  0::bigint, 'anon and authenticated hold SELECT only on the catalogue'
);
select is(
  (select count(*) from (values ('billing.limit_keys'), ('billing.feature_keys')) t (tbl)
    where has_table_privilege('service_role', t.tbl, 'select, insert, update, delete, truncate, references, trigger')),
  0::bigint, 'service_role holds no privilege on the catalogue'
);
select is(
  pg_temp.read_as(null, 'anon', $$select (select count(*) from billing.limit_keys) || '/' || (select count(*) from billing.feature_keys)$$),
  '10/13', 'a visitor reads the whole catalogue'
);
select is(
  pg_temp.read_as(:'wkr', 'authenticated', $$select (select count(*) from billing.limit_keys) || '/' || (select count(*) from billing.feature_keys)$$),
  '10/13', 'a signed-in user reads the whole catalogue'
);
select is(
  (select count(*) from (values (:'own1'::uuid, 'authenticated'), (:'wkr'::uuid, 'authenticated'), (null::uuid, 'anon')) u (uid, r)
    cross join (values
      ($$insert into billing.limit_keys (key, org_types, period, label) values ('probe_limit', '{employer}', 'none', 'Probe')$$),
      ($$update billing.limit_keys set label = 'x'$$), ($$delete from billing.limit_keys$$),
      ($$insert into billing.feature_keys (key, org_types, label) values ('probe_feature', '{employer}', 'Probe')$$),
      ($$update billing.feature_keys set label = 'x'$$), ($$delete from billing.feature_keys$$)) s (sql)
    where pg_temp.read_as(u.uid, u.r, s.sql) !~ '^42501\|permission denied for table'),
  0::bigint, 'an owner, a candidate and a visitor are refused every write on the catalogue'
);
select is(
  (select (select count(*) from billing.limit_keys) || '/' || (select count(*) from billing.feature_keys)),
  '10/13', 'the refused writes changed nothing'
);

-- AC9: features are read from plan rows
update private.settings set value = 'true' where key = 'entitlements_enforced';
create temp table t_orgs as
select pg_temp.on_plan(:'own2', 'recruitment_company', 'recruitment_partner') as partner,
       pg_temp.on_plan(:'own2', 'recruitment_company', 'recruitment_professional') as professional,
       pg_temp.on_plan(:'own2', 'recruitment_company', 'recruitment_enterprise') as enterprise,
       pg_temp.new_org(:'own2', 'recruitment_company') as free,
       pg_temp.on_plan(:'own2', 'staffing_company', 'staffing_partner') as staffing;
select results_eq(
  $$select pg_temp.features_of(partner), pg_temp.features_of(professional), pg_temp.features_of(enterprise),
      pg_temp.features_of(free), pg_temp.features_of(staffing) from t_orgs$$,
  $$values (
    'employer_discovery,worker_search',
    'advanced_employer_discovery,advanced_worker_search,analytics_advanced,employer_discovery,worker_search',
    'advanced_employer_discovery,advanced_worker_search,analytics_advanced,analytics_enterprise,employer_discovery,worker_search',
    '',
    'employer_discovery,worker_search')$$,
  'Basic has worker search and employer discovery, Professional adds the advanced ones, Enterprise adds enterprise analytics, the free plan has none'
);
insert into billing.plan_features (plan_code, feature_key) values ('recruitment_partner', 'analytics_enterprise');
select is(
  private.has_feature((select partner from t_orgs), 'analytics_enterprise'), true,
  'a feature row added in the transaction is effective in the next statement'
);
select is(
  (select string_agg(coalesce(private.org_limit(free, k.key)::text, 'unlimited'), ',' order by k.key)
   from t_orgs, billing.limit_keys k where 'recruitment_company' = any (k.org_types)),
  '0,0,0,10,3,0,0,0', 'every partner limit of the free plan resolves to a number, none to unlimited'
);
select throws_ok(
  format($$select private.assert_within_limit(%L, 'job_order_responses_per_month', 0)$$, (select free from t_orgs)),
  'P0001', 'CHARA_LIMIT_REACHED', 'the free partner plan allows no job order response'
);
delete from billing.plans where code = 'free_recruitment_company';
select is(
  pg_temp.features_of((select free from t_orgs)), '', 'an organisation whose plan code has no row has no feature'
);
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- Nothing of Phase 1 shows or sells a partner plan
select is(
  pg_temp.read_as(null, 'anon', $$select string_agg(code, ',' order by sort) from public.v_plans where org_type = 'employer' and is_public$$),
  'employer_starter,employer_professional', 'the employer pricing page reads the same two plans as before'
);
select is(
  pg_temp.read_as(null, 'anon', $$select string_agg(code, ',' order by sort) from public.v_plans where org_type <> 'employer'$$),
  'recruitment_partner,recruitment_professional,recruitment_enterprise,staffing_partner,staffing_professional,staffing_enterprise',
  'a visitor reads the public partner plans and never the free partner plans'
);
-- Seven partner plans are left: the free recruitment plan was removed above.
select pg_temp.new_org(:'own1', 'employer') as emp \gset
select is(
  (select count(*) filter (where r = 'P0001|CHARA_FORBIDDEN|plan_not_sold') || '/' || count(*)
   from (select pg_temp.call_as(:'own1', 'authenticated', format(
       $f$select * from public.billing_checkout_start(%L, %L, 'DE', null, 'HRB12345', %s)$f$,
       :'emp', p.code, private.current_legal_version('subscription-and-billing-terms'))) as r
     from billing.plans p where p.org_type <> 'employer') c),
  '7/7',
  'an employer owner at aal2 cannot check out any partner plan'
);
select is(
  (select count(*) from billing.customers where organization_id = :'emp'), 0::bigint, 'the refused checkouts wrote no customer'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('recruitment_company', 'Rec Co', 'Rec Co', 'DE', 'F')$$, 'aal1')
    || ',' ||
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('staffing_company', 'Staff Co', 'Staff Co', 'DE', 'F')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|organization_type_not_available,P0001|CHARA_FORBIDDEN|organization_type_not_available',
  'no partner organisation can be created yet, so no one can buy a partner plan'
);

select * from finish();
rollback;
