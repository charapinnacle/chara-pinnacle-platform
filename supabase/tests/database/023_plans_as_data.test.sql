begin;
select plan(132);

\ir organizations_fixture.inc

-- FR-G1: plans, limits, features, subscriptions and the entitlement helpers (ARCHITECTURE.md section 10; D4, D5, D40).

-- Reads one value as a role and token level; an error comes back as 'sqlstate|message'.
create function pg_temp.read_as(p_user uuid, p_role text, p_aal text, p_sql text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', p_aal)::text end,
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

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type default 'employer') returns uuid
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

create function pg_temp.join_org(p_org uuid, p_user uuid, p_role public.member_role) returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

create function pg_temp.subscribe(
  p_org uuid, p_plan text, p_status text, p_trial timestamptz default null, p_created timestamptz default now()
) returns void
language sql as $$
  insert into billing.subscriptions (organization_id, plan_code, status, trial_ends_at, provider, created_at)
  values (p_org, p_plan, p_status, p_trial, 'null', p_created)
$$;

-- Fixture: O (Basic, active) with an admin and a member; X (never subscribed, another owner); L (lapsed: canceled Basic)
-- with a member; E (Enterprise); N (never subscribed). Staff: admin, trust_safety and verification_reviewer.
select pg_temp.new_org(:'own1') as o \gset
select pg_temp.new_org(:'own2') as x \gset
select pg_temp.new_org(:'oth') as l \gset
select pg_temp.new_org(:'adm2') as e \gset
select pg_temp.new_org(:'slg') as n \gset
select pg_temp.join_org(:'o', :'adm', 'admin');
select pg_temp.join_org(:'o', :'mem', 'member');
select pg_temp.join_org(:'l', :'late', 'member');
insert into public.platform_staff (user_id, role)
values (:'inv', 'admin'), (:'unc', 'trust_safety'), (:'gone', 'verification_reviewer');
create temp table t_audit_baseline as select coalesce(max(id), 0) as id from audit.log;

-- AC1: the seeded plans (the second load of the seed file is checked in the browser project, plans-seed.spec.ts: the
-- test container sees this directory only)
select results_eq(
  $$select code, org_type::text, name, price_minor, currency, interval, trial_days, is_public from billing.plans order by sort$$,
  $$values
    ('free_employer', 'employer', 'Free', 0, 'EUR', 'month', 0, false),
    ('employer_starter', 'employer', 'Basic', 3900, 'EUR', 'month', 30, true),
    ('employer_professional', 'employer', 'Professional', 7900, 'EUR', 'month', 30, true),
    ('employer_enterprise', 'employer', 'Enterprise', 0, 'EUR', 'month', 30, false)$$,
  'the four employer plans are seeded with their prices, trial days and visibility'
);
select is(
  (select code from billing.plans where is_default_trial), 'employer_starter', 'Basic is the plan a trial starts on by default'
);
select is((select contact_sales from billing.plans where code = 'employer_enterprise'), true, 'Enterprise is sold by quote');
select is((select count(*) from billing.plans), 4::bigint, 'there are exactly four plans');

-- AC2: Phase 1 limits and features only
select results_eq(
  $$select plan_code, limit_key, limit_value from billing.plan_limits order by plan_code, limit_key$$,
  $$values
    ('employer_enterprise', 'active_jobs', 50), ('employer_enterprise', 'members', 15),
    ('employer_professional', 'active_jobs', 15), ('employer_professional', 'members', 5),
    ('employer_starter', 'active_jobs', 3), ('employer_starter', 'members', 1),
    ('free_employer', 'active_jobs', 0), ('free_employer', 'members', 0)$$,
  'the seeded limits are the owner''s numbers and every plan has both limits defined'
);
select results_eq(
  $$select plan_code, feature_key from billing.plan_features order by plan_code, feature_key$$,
  $$values
    ('employer_enterprise', 'analytics_advanced'), ('employer_enterprise', 'shortlisting'),
    ('employer_professional', 'analytics_advanced'), ('employer_professional', 'shortlisting'),
    ('employer_starter', 'shortlisting')$$,
  'shortlisting is on every paid plan, analytics_advanced on Professional and Enterprise, and the free plan has no feature'
);
select is_empty(
  $$select 1 from billing.plan_limits where limit_key = any (array['active_requirements', 'messages_per_month',
      'candidate_submissions_per_month', 'partner_invitations_per_requirement'])
    union all
    select 1 from billing.plan_features where feature_key = any (array['advanced_worker_search', 'advanced_partner_search',
      'chara_match', 'corridors', 'available_workforce_search', 'job_order_access', 'multi_partner_invitation',
      'analytics_enterprise', 'multi_country_requirements', 'priority_visibility'])$$,
  'no later-phase limit or feature key is seeded'
);
select is(
  (select count(*) from billing.plans p
   where not exists (select 1 from billing.plan_limits l where l.plan_code = p.code and l.limit_key = 'active_jobs' and l.limit_value is not null)
      or not exists (select 1 from billing.plan_limits l where l.plan_code = p.code and l.limit_key = 'members' and l.limit_value is not null)),
  0::bigint, 'every plan has a defined value for both limits'
);
select is(
  (select value #>> '{}' from private.settings where key = 'entitlements_enforced'), 'false',
  'entitlements_enforced is false by default'
);

-- AC4: nothing writes the plan tables through the API roles
select is(
  (select count(*) from (values (:'own1', 'authenticated', 'aal2'), (:'inv', 'authenticated', 'aal2'),
      (:'unc', 'authenticated', 'aal2'), (:'gone', 'authenticated', 'aal2'), (:'wkr', 'authenticated', 'aal2'),
      (null, 'anon', 'aal2')) u (uid, r, aal)
    cross join (values
      ('insert into billing.plans (code, org_type, name, price_minor, currency, interval, is_public, sort) values (''probe_plan'', ''employer'', ''P'', 1, ''EUR'', ''month'', true, 1)'),
      ('update billing.plans set price_minor = 1'), ('delete from billing.plans'), ('truncate billing.plans'),
      ('insert into billing.plan_limits (plan_code, limit_key, limit_value) values (''employer_starter'', ''probe'', 1)'),
      ('update billing.plan_limits set limit_value = 99'), ('delete from billing.plan_limits'), ('truncate billing.plan_limits'),
      ('insert into billing.plan_features (plan_code, feature_key) values (''employer_starter'', ''probe'')'),
      ('update billing.plan_features set feature_key = ''x'''), ('delete from billing.plan_features'), ('truncate billing.plan_features'),
      ('insert into public.v_plans (code) values (''probe_plan'')'), ('update public.v_plans set name = ''x'''),
      ('delete from public.v_plans')) s (sql)
    where pg_temp.call_as(nullif(u.uid, '')::uuid, u.r, s.sql, u.aal) !~ '^42501\|permission denied for (table|view)'),
  0::bigint, 'an owner, every staff role, a candidate and a visitor are refused every write on the plan tables and v_plans'
);
select is(
  (select format('%s|%s|%s', count(*), sum(price_minor), (select count(*) from billing.plan_limits) + (select count(*) from billing.plan_features))
   from billing.plans),
  '4|11800|13', 'no plan, limit or feature row changed'
);
select is(
  (select count(*) from (values ('anon'), ('authenticated')) r (rol)
    cross join (values ('billing.plans'), ('billing.plan_limits'), ('billing.plan_features'), ('public.v_plans')) t (tbl)
    where not has_table_privilege(r.rol, t.tbl, 'select')
       or has_table_privilege(r.rol, t.tbl, 'insert, update, delete, truncate, references, trigger')),
  0::bigint, 'anon and authenticated hold SELECT only on the plan tables and v_plans'
);
select is(
  (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
    cross join (values ('billing.organization_limit_overrides')) t (tbl)
    where has_table_privilege(r.rol, t.tbl, 'select, insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege(r.rol, t.tbl, 'select, insert, update, references')),
  0::bigint, 'no API role holds a privilege on the limit overrides'
);
create function pg_temp.plan_writers() returns setof text
language sql as $$
  select p.proname::text
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prosrc ~* '(insert\s+into|update|delete\s+from|truncate)\s+(table\s+)?billing\.(plans|plan_limits|plan_features|organization_limit_overrides)'
$$;
select is_empty($$select * from pg_temp.plan_writers()$$, 'no public function edits plans, limits, features or overrides');
create function public.plan_writer_probe() returns void language sql as 'update billing.plans set trial_days = 1';
select results_eq(
  $$select * from pg_temp.plan_writers()$$, $$values ('plan_writer_probe')$$, 'detector: a function that updates plans is reported'
);
drop function public.plan_writer_probe();

-- AC5: visibility through public.v_plans and billing.plans
select pg_temp.subscribe(:'o', 'employer_starter', 'active');
select pg_temp.subscribe(:'l', 'employer_starter', 'canceled', now() - interval '40 days', now() - interval '10 days');
select pg_temp.subscribe(:'e', 'employer_enterprise', 'active');
select is(
  pg_temp.read_as(null, 'anon', 'aal1', $$select string_agg(code, ',' order by sort) from public.v_plans$$),
  'employer_starter,employer_professional', 'a visitor sees the two public plans in display order'
);
select is(
  pg_temp.read_as(null, 'anon', 'aal1', $$select string_agg(code, ',' order by sort) from billing.plans$$),
  'employer_starter,employer_professional', 'a visitor reading billing.plans directly gets the same rows'
);
select is(
  pg_temp.read_as(null, 'anon', 'aal1', $$select format('%s|%s|%s|%s|%s|%s|%s|%s|%s', code, name, price_minor, currency, interval, trial_days, limits ->> 'active_jobs', limits ->> 'members', features) from public.v_plans where code = 'employer_professional'$$),
  'employer_professional|Professional|7900|EUR|month|30|15|5|["analytics_advanced", "shortlisting"]',
  'a plan row carries code, name, price, currency, interval, trial days, limits and features'
);
select is(
  pg_temp.read_as(null, 'anon', 'aal1', $$select count(*) from billing.plan_limits where plan_code in ('free_employer', 'employer_enterprise')$$),
  '0', 'the limits of a plan that is not visible are not visible'
);
select is(
  pg_temp.read_as(:'late', 'authenticated', 'aal1', $$select string_agg(code, ',' order by sort) from public.v_plans$$),
  'free_employer,employer_starter,employer_professional', 'a member of a lapsed organization also sees the free plan'
);
select is(
  pg_temp.read_as(:'adm2', 'authenticated', 'aal1', $$select string_agg(code, ',' order by sort) from public.v_plans$$),
  'employer_starter,employer_professional,employer_enterprise', 'an Enterprise member also sees Enterprise'
);
select is(
  pg_temp.read_as(:'adm2', 'authenticated', 'aal1', $$select count(*) from billing.plans where code = 'free_employer'$$),
  '0', 'the Enterprise member does not see the plan of the lapsed organization'
);
select is(
  pg_temp.read_as(:'late', 'authenticated', 'aal1', $$select count(*) from billing.plans where code = 'employer_enterprise'$$),
  '0', 'the lapsed member does not see the Enterprise plan'
);
select is(
  pg_temp.read_as(:'slg', 'authenticated', 'aal1', $$select string_agg(code, ',' order by sort) from public.v_plans$$),
  'free_employer,employer_starter,employer_professional', 'an organization that never subscribed is on the free plan and sees it'
);
select is(
  pg_temp.read_as(:'wkr', 'authenticated', 'aal1', $$select string_agg(code, ',' order by sort) from public.v_plans$$),
  'employer_starter,employer_professional', 'a candidate sees the public plans only'
);
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name in ('v_plans', 'v_my_subscription') and column_name ~ 'provider|product|price_ref|customer'),
  0::bigint, 'the views have no column holding a provider reference'
);
select is(
  (select count(*) from pg_class where oid in ('public.v_plans'::regclass, 'public.v_my_subscription'::regclass)
     and reloptions @> array['security_invoker=true']),
  2::bigint, 'both views are security_invoker'
);

-- AC6: plan data constraints
select throws_ok($$update billing.plans set price_minor = -1 where code = 'employer_starter'$$, '23514', null, 'a negative price is refused');
select throws_ok($$update billing.plans set currency = 'QQQ' where code = 'employer_starter'$$, '23503', null, 'an unknown currency is refused');
select throws_ok($$update billing.plans set interval = 'week' where code = 'employer_starter'$$, '23514', null, 'an interval other than month is refused');
select throws_ok($$update billing.plans set trial_days = -1 where code = 'employer_starter'$$, '23514', null, 'negative trial days are refused');
select throws_ok($$update billing.plans set trial_days = 366 where code = 'employer_starter'$$, '23514', null, '366 trial days are refused');
select throws_ok($$update billing.plans set name = '' where code = 'employer_starter'$$, '23514', null, 'an empty name is refused');
select throws_ok($$update billing.plans set name = repeat('x', 61) where code = 'employer_starter'$$, '23514', null, 'a name of 61 characters is refused');
select throws_ok(
  $$insert into billing.plans (code, org_type, name, price_minor, currency, interval, is_public, sort) values ('Bad Code', 'employer', 'P', 1, 'EUR', 'month', false, 1)$$,
  '23514', null, 'a plan code that is not lower-case snake_case is refused'
);
select throws_ok(
  $$insert into billing.plans (code, org_type, name, price_minor, currency, interval, is_public, sort) values ('bad__code', 'employer', 'P', 1, 'EUR', 'month', false, 1)$$,
  '23514', null, 'a plan code with a double underscore is refused'
);
select throws_ok(
  $$insert into billing.plans (code, org_type, name, price_minor, currency, interval, is_public, sort) values ('ab', 'employer', 'P', 1, 'EUR', 'month', false, 1)$$,
  '23514', null, 'a plan code of 2 characters is refused'
);
select throws_ok(
  $$insert into billing.plans (code, org_type, name, price_minor, currency, interval, is_public, sort) values (repeat('a', 65), 'employer', 'P', 1, 'EUR', 'month', false, 1)$$,
  '23514', null, 'a plan code of 65 characters is refused'
);
select throws_ok($$insert into billing.plan_limits values ('employer_starter', 'active_jobs', 1)$$, '23505', null, 'a duplicate (plan, limit key) is refused');
select throws_ok($$insert into billing.plan_limits values ('employer_starter', 'probe_limit', -1)$$, '23514', null, 'a negative limit is refused');
select throws_ok($$insert into billing.plan_limits values ('no_such_plan', 'probe_limit', 1)$$, '23503', null, 'a limit of a plan that does not exist is refused');
select throws_ok($$insert into billing.plan_features values ('no_such_plan', 'probe_feature')$$, '23503', null, 'a feature of a plan that does not exist is refused');
select throws_ok($$insert into billing.plan_features values ('employer_starter', 'Bad Key')$$, '23514', null, 'a feature key that is not snake_case is refused');
select is((select count(*) from billing.plans) + (select count(*) from billing.plan_limits) + (select count(*) from billing.plan_features), 17::bigint,
  'the refused statements wrote no row');
select lives_ok(
  $$insert into billing.plans (code, org_type, name, price_minor, currency, interval, trial_days, is_public, sort) values ('probe_zero', 'employer', 'Zero', 0, 'EUR', 'month', 0, false, 90),
      ('probe_max', 'employer', 'Max', 0, 'EUR', 'month', 365, false, 91)$$,
  'trial days of 0 and 365 are accepted'
);
select lives_ok(
  $$insert into billing.plan_limits values ('probe_max', 'active_jobs', null)$$, 'a null limit (unlimited) is accepted'
);

-- Subscriptions: constraints, one live row per organization, and the plan code that results
select throws_ok($$select pg_temp.subscribe(null, 'employer_starter', 'active')$$, '23502', null, 'a subscription needs an organization');
select throws_ok(format($$select pg_temp.subscribe(%L, 'employer_starter', 'trialing')$$, :'o'), '23505', null, 'an organization has one live subscription at most');
select throws_ok(format($$select pg_temp.subscribe(%L, 'employer_starter', 'expired')$$, :'x'), '23514', null, 'a status outside the five states is refused');
select throws_ok(format($$select pg_temp.subscribe(%L, 'no_such_plan', 'active')$$, :'x'), '23503', null, 'a subscription to an unknown plan is refused');
select throws_ok(
  format($$insert into billing.subscriptions (organization_id, plan_code, status, provider) values (%L, 'employer_starter', 'active', 'paypal')$$, :'x'),
  '23514', null, 'a provider other than null and stripe is refused'
);
select lives_ok(
  format($$select pg_temp.subscribe(%L, 'employer_starter', 'canceled', now() - interval '90 days', now() - interval '30 days')$$, :'l'),
  'canceled rows may repeat'
);

-- org_plan_code: no row, a live row and a canceled one
select is(private.org_plan_code(:'n'), 'free_employer', 'an organization that never subscribed is on free_employer, not null');
select is(private.org_plan_code(:'o'), 'employer_starter', 'an active subscription gives its plan');
select is(private.org_plan_code(:'l'), 'free_employer', 'an organization whose subscriptions are all canceled is on free_employer');
select is(private.org_plan_code(:'e'), 'employer_enterprise', 'an Enterprise subscription gives Enterprise');
select is(private.org_plan_code(gen_random_uuid()), null, 'an organization that does not exist has no plan');
create temp table t_plan_org as
select pg_temp.new_org(:'own1') as trialing, pg_temp.new_org(:'own1') as past_due, pg_temp.new_org(:'own1') as paused,
       pg_temp.new_org(:'own1', 'recruitment_company') as recruitment;
select pg_temp.subscribe(trialing, 'employer_professional', 'trialing', now() + interval '10 days') from t_plan_org;
select pg_temp.subscribe(past_due, 'employer_starter', 'past_due') from t_plan_org;
select pg_temp.subscribe(paused, 'employer_professional', 'paused') from t_plan_org;
select is(private.org_plan_code((select trialing from t_plan_org)), 'employer_professional', 'a trialing subscription gives its plan');
select is(private.org_plan_code((select past_due from t_plan_org)), 'employer_starter', 'a past_due subscription keeps its plan during the grace period');
select is(private.org_plan_code((select paused from t_plan_org)), 'free_employer', 'a paused subscription gives the free plan');
select is(private.org_plan_code((select recruitment from t_plan_org)), 'free_recruitment_company',
  'the fallback plan follows the organization type');

-- A registration leaves no subscription (D4)
select is(
  pg_temp.call_as(:'late', 'authenticated',
    $$select set_config('t.fresh', (public.create_organization('employer', 'Fresh Co', 'Fresh Co', 'DE', 'F'))::text, true)$$, 'aal1'),
  'ok', 'setup: an employer registers'
);
select is(
  (select format('%s|%s', (select count(*) from billing.subscriptions where organization_id = (current_setting('t.fresh')::jsonb ->> 'organization_id')::uuid),
     private.org_plan_code((current_setting('t.fresh')::jsonb ->> 'organization_id')::uuid))),
  '0|free_employer', 'a new organization has no subscription row and resolves to free_employer'
);

-- Limits, features and the guard (entitlements_enforced false by default)
select is(private.org_limit(:'n', 'active_jobs'), 0, 'free_employer: no open vacancies');
select is(private.org_limit(:'n', 'members'), 0, 'free_employer: no members besides the owner');
select is(private.org_limit(:'o', 'active_jobs') || '/' || private.org_limit(:'o', 'members'), '3/1', 'Basic: 3 vacancies and 1 member');
select is(private.org_limit((select trialing from t_plan_org), 'active_jobs') || '/' || private.org_limit((select trialing from t_plan_org), 'members'), '15/5', 'Professional: 15 vacancies and 5 members');
select is(private.org_limit(:'e', 'active_jobs') || '/' || private.org_limit(:'e', 'members'), '50/15', 'Enterprise: 50 vacancies and 15 members');
select is(private.org_limit(:'o', 'no_such_limit'), null, 'a limit that no plan row defines is null');
select is(private.has_feature(:'n', 'shortlisting'), true, 'while limits are not enforced every feature is available to an organization that never subscribed');
select lives_ok(format($$select private.assert_within_limit(%L, 'active_jobs', 1000)$$, :'n'), 'while limits are not enforced nothing is limited for an organization that never subscribed');
select is(private.free_plan_restricted(:'n'), false, 'an organization that never subscribed is not restricted while limits are not enforced');
select is(private.free_plan_restricted(:'l'), true, 'a lapsed organization is restricted whatever the setting');
select is(private.free_plan_restricted(:'o'), false, 'an organization on a paid plan is not restricted');
select throws_ok(
  format($$select private.assert_within_limit(%L, 'active_jobs', 0)$$, :'l'), 'P0001', 'CHARA_LIMIT_REACHED',
  'a lapsed organization cannot open a vacancy although limits are not enforced'
);
select throws_ok(
  format($$select private.assert_within_limit(%L, 'members', 1)$$, :'l'), 'P0001', 'CHARA_LIMIT_REACHED',
  'a lapsed organization cannot invite although limits are not enforced'
);

update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(private.has_feature(:'o', 'shortlisting'), true, 'enforced: Basic has shortlisting');
select is(private.has_feature(:'o', 'analytics_advanced'), false, 'enforced: Basic has no advanced analytics');
select is(private.has_feature((select trialing from t_plan_org), 'analytics_advanced'), true, 'enforced: Professional has advanced analytics');
select is(private.has_feature(:'n', 'shortlisting'), false, 'enforced: the free plan has no feature');
select is(private.has_feature(:'l', 'shortlisting'), false, 'enforced: a lapsed organization has no feature');
select is(private.has_feature((select recruitment from t_plan_org), 'shortlisting'), false, 'enforced: an unknown plan code denies a feature');
select is(private.has_feature(gen_random_uuid(), 'shortlisting'), false, 'enforced: an organization that does not exist has no feature');
select lives_ok(format($$select private.assert_within_limit(%L, 'active_jobs', 2)$$, :'o'), 'enforced: 2 of 3 vacancies may open another');
select throws_ok(format($$select private.assert_within_limit(%L, 'active_jobs', 3)$$, :'o'), 'P0001', 'CHARA_LIMIT_REACHED', 'enforced: 3 of 3 is refused');
select throws_ok(format($$select private.assert_within_limit(%L, 'members', 0)$$, :'n'), 'P0001', 'CHARA_LIMIT_REACHED', 'enforced: the free plan allows no member');
select throws_ok(format($$select private.assert_within_limit(%L, 'members', 1)$$, :'o'), 'P0001', 'CHARA_LIMIT_REACHED', 'enforced: Basic allows 1 member, the owner');
select throws_ok(
  format($$select private.assert_within_limit(%L, 'active_jobs', 0)$$, (select recruitment from t_plan_org)), '42501', 'CHARA_FORBIDDEN',
  'enforced: an unknown plan code denies'
);
select throws_ok(
  format($$select private.assert_within_limit(%L, 'active_jobs', 0)$$, gen_random_uuid()), '42501', 'CHARA_FORBIDDEN',
  'enforced: an organization that does not exist is denied'
);
select pg_temp.subscribe(o.id, 'probe_max', 'active')
from (select pg_temp.new_org(:'own1') as id) o;
select lives_ok(
  $$select private.assert_within_limit(o.organization_id, 'active_jobs', 1000000) from billing.subscriptions o where o.plan_code = 'probe_max'$$,
  'enforced: a null limit is unlimited'
);

-- AC7: per-organization limits
insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value) values (:'e', 'active_jobs', 80);
select pg_temp.new_org(:'adm2') as e2 \gset
select pg_temp.subscribe(:'e2', 'employer_enterprise', 'active');
select is(
  private.org_limit(:'e', 'active_jobs') || '/' || private.org_limit(:'e2', 'active_jobs') || '/' || private.org_limit((select trialing from t_plan_org), 'active_jobs'),
  '80/50/15', 'an override applies to its organization only'
);
select lives_ok(format($$select private.assert_within_limit(%L, 'active_jobs', 79)$$, :'e'), 'enforced: 79 of 80 may open another');
select throws_ok(format($$select private.assert_within_limit(%L, 'active_jobs', 80)$$, :'e'), 'P0001', 'CHARA_LIMIT_REACHED', 'enforced: 80 of 80 is refused');
select is(private.org_limit(:'e', 'members'), 15, 'a key without an override reads the plan');
delete from billing.organization_limit_overrides where organization_id = :'e' and limit_key = 'active_jobs';
select is(private.org_limit(:'e', 'active_jobs'), 50, 'after the override is deleted the plan limit applies');
select throws_ok(format($$insert into billing.organization_limit_overrides values (%L, 'active_jobs', -1)$$, :'e'), '23514', null, 'a negative override is refused');
insert into billing.organization_limit_overrides values (:'e', 'active_jobs', 60);
select throws_ok(format($$insert into billing.organization_limit_overrides values (%L, 'active_jobs', 70)$$, :'e'), '23505', null, 'a second override for the same key is refused');
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- Subscriptions are read by owners and admins of their organization at aal2 only
select is(
  pg_temp.read_as(:'own1', 'authenticated', 'aal2', format($$select count(*) from public.v_my_subscription where organization_id = %L$$, :'o')),
  '1', 'the owner at aal2 reads the subscription of the organization'
);
select is(
  pg_temp.read_as(:'adm', 'authenticated', 'aal2', format($$select count(*) from public.v_my_subscription where organization_id = %L$$, :'o')),
  '1', 'an admin at aal2 reads it'
);
select is(
  pg_temp.read_as(:'mem', 'authenticated', 'aal2', $$select count(*) from public.v_my_subscription$$),
  '0', 'a plain member reads nothing'
);
select is(
  pg_temp.read_as(:'own1', 'authenticated', 'aal1', $$select count(*) from public.v_my_subscription$$),
  '0', 'the owner at aal1 reads nothing'
);
select is(
  pg_temp.read_as(:'own1', 'authenticated', 'aal1', $$select count(*) from billing.subscriptions$$),
  '0', 'the aal2 gate holds on the table too'
);
select is(
  pg_temp.read_as(:'own2', 'authenticated', 'aal2', format($$select count(*) from public.v_my_subscription where organization_id = %L$$, :'o')),
  '0', 'the owner of another organization reads nothing of it'
);
select is(
  pg_temp.read_as(:'inv', 'authenticated', 'aal2', $$select count(*) from public.v_my_subscription$$),
  '0', 'a platform administrator who is not a member reads no subscription'
);
select is(
  pg_temp.read_as(null, 'anon', 'aal1', $$select count(*) from public.v_my_subscription$$),
  '42501|permission denied for view v_my_subscription', 'a visitor is refused the view'
);
select is(
  pg_temp.read_as(:'own1', 'authenticated', 'aal2', format($$select format('%%s|%%s', plan_code, plan_name) from public.v_my_subscription where organization_id = %L$$, :'o')),
  'employer_starter|Basic', 'the plan name resolves from billing.plans'
);
select is(
  pg_temp.read_as(:'oth', 'authenticated', 'aal2', $$select format('%s|%s', plan_code, status) from public.v_my_subscription$$),
  'employer_starter|canceled', 'a lapsed organization shows its newest canceled subscription'
);
select is(
  pg_temp.read_as(:'adm2', 'authenticated', 'aal2', $$select format('%s|%s', count(*), min(plan_name)) from public.v_my_subscription$$),
  '2|Enterprise', 'the Enterprise owner reads the Enterprise plan name'
);
select pg_temp.new_org(:'own1') as q \gset
select pg_temp.subscribe(:'q', 'employer_starter', 'canceled', null, now() - interval '5 days');
select pg_temp.subscribe(:'q', 'employer_professional', 'active', null, now() - interval '1 day');
select is(
  pg_temp.read_as(:'own1', 'authenticated', 'aal2', format($$select format('%%s|%%s', count(*), min(status)) from public.v_my_subscription where organization_id = %L$$, :'q')),
  '1|active', 'the view shows the live row rather than a canceled one'
);
select is(
  pg_temp.read_as(:'own1', 'authenticated', 'aal2', $$select provider_customer_ref from billing.subscriptions$$),
  '42501|permission denied for table subscriptions', 'the provider references are not readable'
);
select is(
  (select count(*) from (values ('insert into billing.subscriptions (organization_id, plan_code, status, provider) values (gen_random_uuid(), ''employer_starter'', ''active'', ''null'')'),
      ('update billing.subscriptions set status = ''active'''), ('delete from billing.subscriptions'), ('truncate billing.subscriptions')) s (sql)
    cross join (values (:'own1', 'authenticated'), (:'adm', 'authenticated'), (:'inv', 'authenticated'), (null, 'anon')) u (uid, r)
    where pg_temp.call_as(nullif(u.uid, '')::uuid, u.r, s.sql) !~ '^42501\|permission denied for table subscriptions'),
  0::bigint, 'nobody writes subscriptions through the API roles'
);

-- Changing a value is a data change (AC3) and is audited (AC9)
create temp table t_sub_before as select md5(s::text) as hash from billing.subscriptions s where s.organization_id = :'o';
select is(private.org_limit(:'o', 'active_jobs'), 3, 'before the change Basic allows 3 vacancies');
update billing.plan_limits set limit_value = 4 where plan_code = 'employer_starter' and limit_key = 'active_jobs';
update billing.plans set trial_days = 14, name = 'Standard' where code = 'employer_starter';
select is(private.org_limit(:'o', 'active_jobs'), 4, 'a new limit applies right after the update, with no function redefined');
select is(
  pg_temp.read_as(null, 'anon', 'aal1', $$select format('%s|%s', trial_days, name) from public.v_plans where code = 'employer_starter'$$),
  '14|Standard', 'v_plans shows the new trial days and name'
);
select is(
  (select md5(s::text) = hash from billing.subscriptions s, t_sub_before where s.organization_id = :'o'), true,
  'the subscription row is unchanged'
);
update billing.plans set name = 'Standard' where code = 'employer_starter';
update billing.plans set price_minor = 4200 where code = 'employer_starter';
delete from billing.plan_features where plan_code = 'employer_enterprise' and feature_key = 'analytics_advanced';
insert into billing.plan_limits values ('employer_starter', 'probe_limit', 7);
select results_eq(
  $$select entity_type, entity_id, actor_id::text, metadata ->> 'table', metadata ->> 'operation', metadata -> 'before', metadata -> 'after'
    from audit.log where id > (select id from t_audit_baseline) and action = 'billing.plan_changed'
      and metadata ->> 'plan_code' = 'employer_starter' and metadata ->> 'table' = 'plans' and metadata -> 'after' ? 'price_minor'$$,
  $$values ('plan', 'employer_starter', null::text, 'plans', 'update', '{"price_minor": 3900}'::jsonb, '{"price_minor": 4200}'::jsonb)$$,
  'a price change writes one audit row with the plan code, the table and the changed columns before and after'
);
select results_eq(
  $$select metadata ->> 'table', metadata ->> 'operation', metadata -> 'before' ->> 'feature_key', metadata -> 'after' = 'null'::jsonb
    from audit.log where id > (select id from t_audit_baseline) and action = 'billing.plan_changed'
      and metadata ->> 'operation' = 'delete' and metadata ->> 'table' = 'plan_features'$$,
  $$values ('plan_features', 'delete', 'analytics_advanced', true)$$,
  'deleting a feature row writes one audit row holding the deleted row'
);
select results_eq(
  $$select metadata ->> 'table', metadata ->> 'plan_code', metadata -> 'after' ->> 'limit_key', metadata -> 'after' ->> 'limit_value'
    from audit.log where id > (select id from t_audit_baseline) and action = 'billing.plan_changed'
      and metadata ->> 'operation' = 'insert' and metadata -> 'after' ->> 'limit_key' = 'probe_limit'$$,
  $$values ('plan_limits', 'employer_starter', 'probe_limit', '7')$$,
  'inserting a limit writes one audit row holding the new row'
);
select is(
  (select count(*) from audit.log where id > (select id from t_audit_baseline) and action = 'billing.plan_changed'
     and metadata ->> 'plan_code' = 'employer_starter' and metadata ->> 'operation' = 'update'),
  3::bigint, 'the three updates of employer_starter wrote three rows: limit, trial days and name in one, then the price (the repeated name wrote none)'
);
select is(
  (select count(*) from audit.log where id > (select id from t_audit_baseline) and action = 'billing.plan_changed'
     and metadata ->> 'table' = 'organization_limit_overrides' and entity_type = 'plan' and entity_id is null
     and (metadata -> case metadata ->> 'operation' when 'delete' then 'before' else 'after' end) ->> 'organization_id' = :'e'),
  3::bigint, 'overrides are audited too: two inserts and one delete'
);

-- billing_owner and service_role (NFR-S3)
select is(
  (select count(*) from pg_class c where c.relnamespace = 'billing'::regnamespace and c.relkind = 'r'
     and pg_get_userbyid(c.relowner) <> 'billing_owner'),
  0::bigint, 'billing_owner owns every table in billing'
);
select is(pg_get_userbyid((select nspowner from pg_namespace where nspname = 'billing')), 'billing_owner', 'billing_owner owns the schema');
select ok(pg_has_role('postgres', 'billing_owner', 'usage'), 'postgres is a member of billing_owner and inherits its privileges');
select is(
  (select count(*) from pg_class c where c.relnamespace = 'billing'::regnamespace and c.relkind = 'r'
     and not exists (
       select 1 from pg_policy p
       where p.polrelid = c.oid and p.polroles = array['billing_owner'::regrole::oid] and p.polcmd = '*'
         and pg_get_expr(p.polqual, p.polrelid) = 'true' and pg_get_expr(p.polwithcheck, p.polrelid) = 'true')),
  0::bigint, 'every billing table has the billing_owner policy using (true) with check (true)'
);
create function pg_temp.billing_owner_reach() returns setof text
language sql as $$
  select format('%I.%I', n.nspname, c.relname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm')
    and n.nspname in ('public', 'private', 'audit', 'stats')
    and ((c.relname ~ '^verification' and (
           has_table_privilege('billing_owner', c.oid, 'select, insert, update, delete, truncate, references, trigger')
           or has_any_column_privilege('billing_owner', c.oid, 'select, insert, update, references')))
         or has_table_privilege('billing_owner', c.oid, 'insert, update, delete, truncate'))
  order by 1
$$;
select is_empty($$select * from pg_temp.billing_owner_reach()$$, 'billing_owner has no privilege on verification tables and writes nowhere in public, private, audit or stats');
create table public.verifications_probe (a int);
grant select on public.verifications_probe to billing_owner;
select results_eq($$select * from pg_temp.billing_owner_reach()$$, $$values ('public.verifications_probe')$$,
  'detector: a privilege of billing_owner on a verification table is reported');
drop table public.verifications_probe;
select is(
  (select count(*) from pg_class c where c.relnamespace = 'billing'::regnamespace and c.relkind = 'r'
     and (has_table_privilege('service_role', c.oid, 'select, insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege('service_role', c.oid, 'select, insert, update, references'))),
  0::bigint, 'service_role holds no privilege on any table in billing'
);
select is(
  (select count(*) from pg_class c where c.relnamespace = 'billing'::regnamespace and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'insert, update, delete, truncate, references, trigger')
       or has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate, references, trigger'))),
  0::bigint, 'anon and authenticated hold no write privilege on any table in billing'
);
select is(
  (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
    cross join (values ('private.has_feature(uuid, text)'), ('private.org_limit(uuid, text)'), ('private.free_plan_restricted(uuid)'),
                ('private.assert_within_limit(uuid, text, integer)'), ('private.legal_entity_trial_used(text)'),
                ('private.legal_entity_locked(uuid)'), ('private.billing_plan_audit()')) f (fn)
    where has_function_privilege(r.rol, f.fn, 'execute')),
  0::bigint, 'the entitlement helpers and the audit trigger function are not executable by the API roles'
);
select is(
  (select format('%s|%s|%s', has_function_privilege('authenticated', 'private.org_plan_code(uuid)', 'execute'),
    has_function_privilege('anon', 'private.org_plan_code(uuid)', 'execute'),
    has_function_privilege('service_role', 'private.org_plan_code(uuid)', 'execute'))),
  't|f|f', 'only authenticated runs org_plan_code, for the plan policy'
);
select is(
  (select count(*) from pg_proc p where p.pronamespace in ('private'::regnamespace, 'public'::regnamespace)
     and p.proname in ('org_plan_code', 'org_limit', 'has_feature', 'free_plan_restricted', 'assert_within_limit', 'billing_plan_audit')
     and (not p.prosecdef or not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""'))),
  0::bigint, 'the billing functions are security definer with an empty search_path'
);

-- The index the trial lookup reads by (FR-A2, D36)
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
  (select string_agg(l, ' ') from pg_temp.explain_lines($$select 1 from public.organizations where legal_entity_identifier = 'DE123456789'$$) l) like '%organizations_legal_entity_identifier%',
  'the trial lookup by legal-entity identifier uses its index'
);
reset enable_seqscan;

select * from finish();
rollback;
