begin;
select plan(74);

\ir jobs_fixture.inc

-- FR-C6: the active_jobs limit on every change to Open (ARCHITECTURE.md section 10.4; D48). Acme (t.a: owner own1, admin
-- adm, member mem) and Beta (t.b: owner own2, admin adm2) come from the fixture; every scenario below uses an
-- organisation of its own, owned by own1 unless it says otherwise.

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

create function pg_temp.subscribe(p_org uuid, p_plan text, p_status text) returns void
language sql as $$
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (p_org, p_plan, p_status, 'null')
$$;

-- An organisation on a plan, with an admin: p_plan null is an organisation that never subscribed.
create function pg_temp.org_on(p_plan text, p_status text default 'active') returns uuid
language plpgsql as $$
declare
  v_org uuid := pg_temp.new_org(current_setting('t.owner')::uuid);
begin
  if p_plan is not null then
    perform pg_temp.subscribe(v_org, p_plan, p_status);
  end if;
  return v_org;
end;
$$;

-- Vacancies written by the database owner in any state; the limit trigger sees them too, so they are written while the
-- setting is false.
create function pg_temp.seed(
  p_org uuid, p_status text, p_count integer default 1, p_moderation text default 'visible', p_deleted boolean default false
) returns uuid[]
language sql as $$
  with ins as (
    insert into public.jobs (
      organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type,
      recruitment_preference, status, moderation_state, deleted_at
    )
    select
      p_org, 'Limit ' || p_status || ' ' || n, 'Weld steel frames in our Hamburg workshop. Weld steel frames in our Hamburg workshop.',
      '7212', 'C', 'DE', 'Hamburg', 'full_time', 'both', p_status::public.job_status,
      p_moderation::public.job_moderation_state, case when p_deleted then now() end
    from generate_series(1, p_count) n
    returning id
  )
  select array_agg(id) from ins
$$;

-- p_value null removes the row, as in a database that never had it.
create function pg_temp.set_enforced(p_value jsonb) returns void
language plpgsql as $$
begin
  delete from private.settings where key = 'entitlements_enforced';
  if p_value is not null then
    insert into private.settings (key, value) values ('entitlements_enforced', p_value);
  end if;
end;
$$;

create function pg_temp.open_count(p_org uuid) returns bigint
language sql as $$
  select count(*) from public.jobs where organization_id = p_org and status = 'open' and deleted_at is null
$$;

-- The results of publishing every draft of an organisation one after the other as p_user, oldest id first.
create function pg_temp.publish_drafts(p_user uuid, p_org uuid) returns text[]
language plpgsql as $$
declare
  v_job uuid;
  v_results text[] := '{}';
begin
  for v_job in select id from public.jobs where organization_id = p_org and status = 'draft' order by id loop
    v_results := v_results || pg_temp.set_status(p_user, v_job, 'open');
  end loop;
  return v_results;
end;
$$;

create function pg_temp.close_open(p_user uuid, p_org uuid, p_count integer) returns void
language plpgsql as $$
declare
  v_job uuid;
begin
  for v_job in select id from public.jobs where organization_id = p_org and status = 'open' order by id limit p_count loop
    perform pg_temp.set_status(p_user, v_job, 'closed');
  end loop;
end;
$$;

select set_config('t.owner', :'own1', true) as owner_set \gset

-- AC1: seeded limits and the setting; a change of the limit applies with no code change.
select results_eq(
  $$select plan_code, limit_value from billing.plan_limits where limit_key = 'active_jobs' order by plan_code$$,
  $$values ('employer_enterprise', 50), ('employer_professional', 15), ('employer_starter', 3), ('free_employer', 0)$$,
  'active_jobs is 50, 15 and 3 for the paid plans and 0, not null, for free_employer'
);
select is(
  (select value from private.settings where key = 'entitlements_enforced'), 'false'::jsonb,
  'entitlements_enforced is stored as jsonb false'
);

select pg_temp.org_on('employer_starter') as basic \gset
select pg_temp.seed(:'basic', 'open', 3);
select pg_temp.seed(:'basic', 'draft', 2);
select pg_temp.set_enforced('true');
select is(
  pg_temp.publish_drafts(:'own1', :'basic'), array['P0001|CHARA_LIMIT_REACHED|active_jobs', 'P0001|CHARA_LIMIT_REACHED|active_jobs'],
  'at 3 open a Basic organisation is refused both publishes'
);
update billing.plan_limits set limit_value = 4 where plan_code = 'employer_starter' and limit_key = 'active_jobs';
select is(
  pg_temp.publish_drafts(:'own1', :'basic'), array['ok', 'P0001|CHARA_LIMIT_REACHED|active_jobs'],
  'after the limit row is changed to 4 the fourth publish succeeds and the fifth is refused, with no code change'
);
update billing.plan_limits set limit_value = 3 where plan_code = 'employer_starter' and limit_key = 'active_jobs';

-- The limit rows are readable (public plans feed the pricing page, FR-G1) but no API role writes them; the settings
-- table is closed to every API role.
select is(
  (select count(*) from (values ('anon', null::uuid), ('authenticated', :'adm'::uuid), ('service_role', null::uuid)) r (role_name, uid)
   cross join (values ('select * from private.settings'), ('insert into private.settings values (''x'', ''1'')'),
                      ('update private.settings set value = ''true'''), ('delete from private.settings')) s (stmt)
   where split_part(pg_temp.call_as(r.uid, r.role_name, s.stmt), '|', 1) = '42501'),
  12::bigint, 'anon, authenticated and service_role are refused select, insert, update and delete on private.settings'
);
select is(
  (select count(*) from (values ('anon', null::uuid), ('authenticated', :'adm'::uuid), ('service_role', null::uuid)) r (role_name, uid)
   cross join (values ('insert into billing.plan_limits values (''employer_starter'', ''x'', 1)'),
                      ('update billing.plan_limits set limit_value = 99'), ('delete from billing.plan_limits')) s (stmt)
   where split_part(pg_temp.call_as(r.uid, r.role_name, s.stmt), '|', 1) = '42501'),
  9::bigint, 'anon, authenticated and service_role are refused insert, update and delete on billing.plan_limits'
);
select is(
  split_part(pg_temp.call_as(null, 'service_role', 'select * from billing.plan_limits'), '|', 1), '42501',
  'and the service role cannot read it'
);
select is(
  (select value_text from (select pg_temp.val_as(:'adm', 'aal1', $$select limit_value::text from billing.plan_limits where plan_code = 'employer_starter' and limit_key = 'active_jobs'$$) value_text) v),
  '3', 'a signed-in user reads the limit of a public plan'
);

select pg_temp.subscribe(current_setting('t.a')::uuid, 'employer_starter', 'active');
select pg_temp.seed(current_setting('t.a')::uuid, 'open', 2);
select pg_temp.seed(current_setting('t.a')::uuid, 'draft', 1);
select pg_temp.seed(current_setting('t.a')::uuid, 'paused', 1);
select is(
  (select pg_temp.val_as(:'adm', 'aal1', $$select organization_id || '|' || plan_code || '|' || plan_name || '|' || active_jobs_limit || '|' || open_jobs from public.v_org_limits where organization_id = current_setting('t.a')::uuid$$)),
  current_setting('t.a') || '|employer_starter|Basic|3|2',
  'an admin of Acme reads the plan, the limit and the open count of Acme from v_org_limits'
);
select is(
  (select pg_temp.val_as(:'mem', 'aal1', $$select open_jobs from public.v_org_limits where organization_id = current_setting('t.a')::uuid$$)),
  '2', 'and so does a plain member'
);
select is(
  (select pg_temp.val_as(:'adm2', 'aal1', $$select count(*) from public.v_org_limits where organization_id = current_setting('t.a')::uuid$$)),
  '0', 'an admin of Beta sees no row of Acme'
);
select is(
  (select pg_temp.val_as(:'adm2', 'aal1', $$select organization_id || '|' || plan_code || '|' || active_jobs_limit || '|' || open_jobs from public.v_org_limits$$)),
  current_setting('t.b') || '|free_employer|0|0', 'and reads only the row of Beta, on the free plan with a limit of 0'
);
select is(
  (select split_part(pg_temp.call_as(null, 'anon', 'select * from public.v_org_limits'), '|', 1)), '42501',
  'an anonymous caller is refused the view'
);
select is(
  (select pg_temp.val_as(:'wa', 'aal1', 'select count(*) from public.v_org_limits')), '0', 'a candidate runs the select and gets no row'
);

select is(
  (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
   cross join (values ('private.org_limit(uuid, text)'), ('private.assert_within_limit(uuid, text, integer)'),
                      ('private.jobs_enforce_limits()')) f (fn)
   where has_function_privilege(r.rol, f.fn, 'execute')),
  0::bigint, 'the limit helpers and the trigger function stay closed to the API roles'
);
select is(
  (select pg_temp.val_as(:'adm2', 'aal1', format($$select private.member_org_job_limit(%L)::text$$, current_setting('t.a')))),
  null, 'the member limit helper answers null for an organisation the caller is not a member of'
);

-- AC2: the setting is read in every stored form; an organisation that never subscribed has a limit of 0.
create temp table t_forms (form text, value jsonb, org uuid, drafts uuid[], results text[]);
insert into t_forms (form, value) values
  ('false', 'false'), ('missing', null), ('true', 'true'), ('text', '"true"');
update t_forms set org = pg_temp.org_on(null);
update t_forms set drafts = pg_temp.seed(org, 'draft', 5);
do $$
declare
  v_form record;
begin
  for v_form in select * from t_forms loop
    perform pg_temp.set_enforced(v_form.value);
    update t_forms set results = pg_temp.publish_drafts(current_setting('t.owner')::uuid, v_form.org) where form = v_form.form;
  end loop;
end;
$$;
select is(
  (select count(*) from t_forms f, unnest(f.results) r where f.form in ('false', 'missing') and r = 'ok'), 10::bigint,
  'with the setting false or missing, 5 publishes of 5 drafts all succeed in each of two organisations'
);
select is(
  (select count(*) from t_forms f, unnest(f.results) r
   where f.form in ('true', 'text') and r = 'P0001|CHARA_LIMIT_REACHED|active_jobs'), 10::bigint,
  'with jsonb true and with jsonb "true" every publish is refused with CHARA_LIMIT_REACHED (limit 0)'
);
select is(
  (select count(*) from t_forms f where f.form in ('true', 'text') and pg_temp.open_count(f.org) = 0), 2::bigint,
  'and nothing opened'
);

-- AC3: publish at the boundary for each plan.
select pg_temp.set_enforced('false');
create temp table t_plans (plan text, org uuid, open_before integer, results text[]);
insert into t_plans (plan, open_before) values ('employer_starter', 2), ('employer_professional', 14), ('employer_enterprise', 49);
update t_plans set org = pg_temp.org_on(plan);
do $$
declare
  v_plan record;
begin
  for v_plan in select * from t_plans loop
    perform pg_temp.seed(v_plan.org, 'open', v_plan.open_before);
    perform pg_temp.seed(v_plan.org, 'draft', 3);
  end loop;
end;
$$;
select pg_temp.set_enforced('true');
update t_plans set results = pg_temp.publish_drafts(current_setting('t.owner')::uuid, org);
select is(
  (select count(*) from t_plans where results[1] = 'ok' and pg_temp.open_count(org) = open_before + 1), 3::bigint,
  'the first publish in each organisation succeeds and brings the open count to 3, 15 and 50'
);
select is(
  (select count(*) from t_plans where results[2] = 'P0001|CHARA_LIMIT_REACHED|active_jobs'), 3::bigint,
  'the next publish fails with CHARA_LIMIT_REACHED and detail active_jobs'
);
select is(
  (select count(*) from t_plans where results[3] = results[2]), 3::bigint, 'and so does the one after'
);
select is(
  (select count(*) from t_plans p join public.jobs j on j.organization_id = p.org and j.status = 'draft'), 6::bigint,
  'two drafts of each organisation stay draft'
);
select is(
  (select count(*) from audit.log a join public.jobs j on j.id::text = a.entity_id
   join t_plans p on p.org = j.organization_id
   where a.action = 'job.status_changed' and j.status = 'draft'), 0::bigint,
  'and none of them has a status audit row'
);

-- AC4: reopening is checked like publishing.
select pg_temp.set_enforced('false');
select pg_temp.org_on('employer_starter') as reopen_org \gset
select a[1] as ro_open1, a[2] as ro_open2 from (select pg_temp.seed(:'reopen_org', 'open', 3) a) s \gset
select (pg_temp.seed(:'reopen_org', 'paused'))[1] as ro_paused \gset
select (pg_temp.seed(:'reopen_org', 'closed'))[1] as ro_closed \gset
select pg_temp.set_enforced('true');
select is(pg_temp.set_status(:'own1', :'ro_paused', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'at 3 open a paused vacancy cannot be reopened');
select is(pg_temp.set_status(:'own1', :'ro_closed', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'nor a closed one');
select is(pg_temp.set_status(:'own1', :'ro_open1', 'paused'), 'ok', 'an open vacancy can be paused');
select is(pg_temp.set_status(:'own1', :'ro_paused', 'open'), 'ok', 'then the paused one can be reopened (3 open)');
select is(pg_temp.set_status(:'own1', :'ro_open1', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'and reopening the one paused just now is refused again');
select is((select status::text from public.jobs where id = :'ro_closed'), 'closed', 'a refused reopen leaves the vacancy as it was');
select is(pg_temp.set_status(:'own1', :'ro_open2', 'open'), 'ok', 'setting an Open vacancy to Open at the limit is a no-op, not a check');

-- AC5: only open, undeleted vacancies count.
select pg_temp.set_enforced('false');
select pg_temp.org_on('employer_starter') as count_org \gset
select pg_temp.seed(:'count_org', 'open', 1);
select pg_temp.seed(:'count_org', 'open', 1, 'hidden');
select pg_temp.seed(:'count_org', 'draft', 2);
select pg_temp.seed(:'count_org', 'paused', 2);
select pg_temp.seed(:'count_org', 'closed', 2);
select pg_temp.seed(:'count_org', 'filled', 1);
select pg_temp.seed(:'count_org', 'open', 1, 'visible', true);
select pg_temp.org_on('employer_starter') as beta_like \gset
select pg_temp.seed(:'beta_like', 'open', 3);
select pg_temp.set_enforced('true');
select is(pg_temp.insert_as(:'own1', '{}', :'count_org'), 'ok', 'creating a draft is not limited');
select is(pg_temp.insert_as(:'own1', '{}', :'beta_like'), 'ok', 'not even in an organisation at its limit');
select (array(select id from public.jobs where organization_id = :'count_org' and status = 'draft' order by id))[1] as c1 \gset
select (array(select id from public.jobs where organization_id = :'count_org' and status = 'draft' order by id))[2] as c2 \gset
select is(pg_temp.set_status(:'own1', :'c1', 'open'), 'ok', 'the first publish succeeds: only the visible and the hidden open vacancy count, 2 of 3');
select is(pg_temp.set_status(:'own1', :'c2', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'the next is refused');
select is(pg_temp.open_count(:'count_org'), 3::bigint, 'draft, paused, closed, filled, deleted and the other organisation are not counted');

-- AC6: free plan, lapsed, past due and trialing organisations.
select pg_temp.set_enforced('true');
select pg_temp.org_on(null) as free_org \gset
select (pg_temp.seed(:'free_org', 'draft'))[1] as free_job \gset
select is(pg_temp.set_status(:'own1', :'free_job', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'an organisation with no subscription, enforcement on: refused (limit 0)');
select pg_temp.org_on('employer_starter', 'canceled') as lapsed \gset
select (pg_temp.seed(:'lapsed', 'draft'))[1] as lapsed_draft \gset
select (pg_temp.seed(:'lapsed', 'paused'))[1] as lapsed_paused \gset
select is(pg_temp.set_status(:'own1', :'lapsed_draft', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'a lapsed organisation, enforcement on: refused to publish');
select pg_temp.set_enforced('false');
select is(pg_temp.set_status(:'own1', :'lapsed_draft', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'enforcement off: still refused to publish');
select is(pg_temp.set_status(:'own1', :'lapsed_paused', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'and to reopen a paused vacancy');
select pg_temp.set_enforced(null);
select is(pg_temp.set_status(:'own1', :'lapsed_paused', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'with the setting row missing as well');
select is(pg_temp.set_status(:'own1', :'free_job', 'open'), 'ok', 'while a never-subscribed organisation publishes when enforcement is off');
select pg_temp.set_enforced('true');
select pg_temp.org_on('employer_starter', 'past_due') as past_due \gset
select pg_temp.org_on('employer_starter', 'trialing') as trialing \gset
select pg_temp.seed(:'past_due', 'open', 2);
select pg_temp.seed(:'trialing', 'open', 2);
select (pg_temp.seed(:'past_due', 'draft', 2))[1] as pd_job \gset
select (pg_temp.seed(:'trialing', 'draft', 2))[1] as tr_job \gset
select is(pg_temp.set_status(:'own1', :'pd_job', 'open'), 'ok', 'a past_due organisation keeps the Basic limit: a third vacancy publishes');
select is(pg_temp.set_status(:'own1', :'tr_job', 'open'), 'ok', 'so does a trialing one');
select is(
  (select array_agg(pg_temp.set_status(:'own1', j.id, 'open')) from public.jobs j
   where j.organization_id in (:'past_due', :'trialing') and j.status = 'draft'),
  array['P0001|CHARA_LIMIT_REACHED|active_jobs', 'P0001|CHARA_LIMIT_REACHED|active_jobs'], 'and a fourth is refused'
);

-- AC7: downgrade keeps data and blocks creation over the limit.
select pg_temp.set_enforced('false');
select pg_temp.org_on('employer_professional') as down \gset
select pg_temp.seed(:'down', 'open', 10) as down_open \gset
select pg_temp.set_enforced('true');
update billing.subscriptions set plan_code = 'employer_starter' where organization_id = :'down';
select is(pg_temp.open_count(:'down'), 10::bigint, 'after the change to Basic all 10 vacancies are still open');
select is(
  (select count(*) from public.jobs where organization_id = :'down' and (status <> 'open' or deleted_at is not null)),
  0::bigint, 'none was paused, closed or deleted'
);
select (:'down_open'::uuid[])[1] as down1 \gset
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$update public.jobs set title = 'Edited while over the limit' where id = %L$$, :'down1'), 'aal1'),
  'ok', 'an open vacancy can still be edited'
);
select is(pg_temp.insert_as(:'own1', '{}', :'down'), 'ok', 'and a draft created');
select (array(select id from public.jobs where organization_id = :'down' and status = 'draft'))[1] as down_draft \gset
select is(pg_temp.set_status(:'own1', :'down_draft', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'publishing is refused');
select pg_temp.close_open(:'own1', :'down', 1);
select is(pg_temp.set_status(:'own1', :'down_draft', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'closing one of the 10 (9 open) does not allow another publish');
select pg_temp.close_open(:'own1', :'down', 6);
select is(pg_temp.open_count(:'down'), 3::bigint, 'after six more are closed 3 are open');
select is(pg_temp.set_status(:'own1', :'down_draft', 'open'), 'P0001|CHARA_LIMIT_REACHED|active_jobs', 'and publishing is still refused at 3');
select pg_temp.close_open(:'own1', :'down', 1);
select is(pg_temp.set_status(:'own1', :'down_draft', 'open'), 'ok', 'at 2 open, publishing works again');

-- AC8: an unknown plan denies, a null limit means unlimited.
select pg_temp.set_enforced('false');
select pg_temp.new_org(:'own1', 'staffing_company') as unknown_org \gset
select (pg_temp.seed(:'unknown_org', 'draft'))[1] as unknown_job \gset
select pg_temp.set_enforced('true');
select is(
  pg_temp.set_status(:'own1', :'unknown_job', 'open'), '42501|CHARA_FORBIDDEN|unknown_plan',
  'an organisation whose plan code is not in billing.plans is refused with CHARA_FORBIDDEN and detail unknown_plan'
);
select pg_temp.set_enforced('false');
select pg_temp.org_on('employer_starter') as unlimited \gset
select pg_temp.seed(:'unlimited', 'open', 100);
select (pg_temp.seed(:'unlimited', 'draft'))[1] as unlimited_job \gset
select pg_temp.set_enforced('true');
update billing.plan_limits set limit_value = null where plan_code = 'employer_starter' and limit_key = 'active_jobs';
select is(pg_temp.set_status(:'own1', :'unlimited_job', 'open'), 'ok', 'a null limit never blocks, even at 100 open vacancies');
update billing.plan_limits set limit_value = 3 where plan_code = 'employer_starter' and limit_key = 'active_jobs';

-- Order and scope of the checks.
select is(
  (select array_agg(t.tgname::text order by t.tgname) from pg_trigger t
   where t.tgrelid = 'public.jobs'::regclass and not t.tgisinternal and t.tgtype & 2 = 2),
  array['jobs_guard_transition', 'jobs_limit_check'],
  'the limit trigger is a BEFORE trigger that sorts after the transition guard'
);
select pg_temp.org_on('employer_starter') as order_org \gset
select pg_temp.set_enforced('false');
select pg_temp.seed(:'order_org', 'open', 3);
select (pg_temp.seed(:'order_org', 'paused'))[1] as order_paused \gset
select (pg_temp.seed(:'order_org', 'filled'))[1] as order_filled \gset
select (pg_temp.seed(:'order_org', 'closed', 1, 'visible', true))[1] as order_deleted \gset
select pg_temp.set_enforced('true');
select set_config('request.jwt.claims', json_build_object('sub', :'mem'::text, 'role', 'authenticated', 'aal', 'aal1')::text, true) as as_member \gset
select throws_ok(
  format($$update public.jobs set status = 'open' where id = %L$$, :'order_paused'), '42501', 'CHARA_FORBIDDEN',
  'a member who reopens at the limit is told they may not, not that the limit is reached (row level security skipped)'
);
select set_config('request.jwt.claims', '', true) as claims_cleared \gset
select is(pg_temp.set_status(:'own1', :'order_filled', 'open'), 'P0001|CHARA_INVALID_TRANSITION|filled to open', 'a Filled vacancy at the limit is an invalid transition');
select is(pg_temp.set_status(:'own1', :'order_deleted', 'open'), 'P0001|CHARA_INVALID_TRANSITION|deleted', 'and so is a deleted one');
select is(pg_temp.set_status(:'own1', :'order_paused', 'closed'), 'ok', 'a change that does not open the vacancy is never counted');
select throws_ok(
  format($$insert into public.jobs (organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type, recruitment_preference, status)
           values (%L, 'Inserted open', %L, '7212', 'C', 'DE', 'Hamburg', 'full_time', 'both', 'open')$$,
         :'order_org', 'Weld steel frames in our Hamburg workshop. Weld steel frames in our Hamburg workshop.'),
  'P0001', 'CHARA_LIMIT_REACHED', 'a row inserted as Open is checked as well'
);

-- Another organisation of the caller is not touched: an admin of Beta cannot publish Acme's draft at all.
select is(
  pg_temp.affected_as(:'adm2', 'authenticated', format($$update public.jobs set status = 'open' where organization_id = %L and status = 'draft'$$, current_setting('t.a'))),
  0::bigint, 'an admin of another organisation changes no vacancy (row level security)'
);

-- Prompt event: recorded only for a real prompt, by an admin, within the ceiling.
select pg_temp.set_enforced('true');
create temp table t_baseline as select coalesce(max(id), 0) as id from audit.log;
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_limit_prompt(%L)$$, current_setting('t.a')), 'aal1'), 'ok',
  'an admin of Acme reports the prompt'
);
select is(
  (select count(*) from audit.log where id > (select id from t_baseline) and action = 'limit.prompt_shown'), 0::bigint,
  'nothing is recorded while Acme is below its limit (2 open of 3)'
);
select pg_temp.seed(current_setting('t.a')::uuid, 'open', 1);
select pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_limit_prompt(%L)$$, current_setting('t.a')), 'aal1') as reported \gset
select is(
  (select jsonb_build_object('actor', actor_id, 'org', entity_id, 'meta', metadata) from audit.log
   where id > (select id from t_baseline) and action = 'limit.prompt_shown'),
  jsonb_build_object(
    'actor', :'adm'::uuid, 'org', current_setting('t.a'),
    'meta', jsonb_build_object('limit_key', 'active_jobs', 'plan_code', 'employer_starter', 'limit', 3, 'open_jobs', 3)
  ),
  'at the limit the prompt is recorded with the actor, the plan, the limit and the usage'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select public.record_job_limit_prompt(%L)$$, current_setting('t.a')), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'a member cannot report it'
);
select is(
  pg_temp.call_as(:'adm2', 'authenticated', format($$select public.record_job_limit_prompt(%L)$$, current_setting('t.a')), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'nor can an admin of another organisation'
);
select is(
  split_part(pg_temp.call_as(null, 'anon', format($$select public.record_job_limit_prompt(%L)$$, current_setting('t.a'))), '|', 1),
  '42501', 'nor an anonymous caller'
);
select is(
  split_part(pg_temp.call_as(null, 'service_role', format($$select public.record_job_limit_prompt(%L)$$, current_setting('t.a'))), '|', 1),
  '42501', 'nor the service role'
);
update private.settings set value = '2' where key = 'limit_prompt_per_hour_max';
select pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_limit_prompt(%L)$$, current_setting('t.a')), 'aal1') as again1 \gset
select pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_limit_prompt(%L)$$, current_setting('t.a')), 'aal1') as again2 \gset
select is(
  (select count(*) from audit.log where id > (select id from t_baseline) and action = 'limit.prompt_shown'), 2::bigint,
  'a ceiling of 2 per user and hour stops the third report'
);
select pg_temp.set_enforced('false');
update private.settings set value = '30' where key = 'limit_prompt_per_hour_max';
select pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_limit_prompt(%L)$$, current_setting('t.a')), 'aal1') as off \gset
select is(
  (select count(*) from audit.log where id > (select id from t_baseline) and action = 'limit.prompt_shown'), 2::bigint,
  'a prompt is not recorded for an organisation whose limit is not enforced'
);

-- KPI "upgrade conversions from limit prompts" (docs/runbooks/plan-limits.md, section 2): Acme was prompted at Basic.
select pg_temp.set_enforced('true');
create function pg_temp.conversion() returns text
language sql as $$
  with prompted as (
    select p.entity_id::uuid as organization_id, max((p.metadata ->> 'limit')::integer) as limit_at_prompt
    from audit.log p
    where p.action = 'limit.prompt_shown'
      and p.entity_id = current_setting('t.a')
    group by 1
  )
  select count(*) || '/' || count(*) filter (
    where private.org_limit(p.organization_id, 'active_jobs') is null
       or private.org_limit(p.organization_id, 'active_jobs') > p.limit_at_prompt
  )
  from prompted p
$$;
select is(pg_temp.conversion(), '1/0', 'before an upgrade the prompted organisation has not converted');
update billing.subscriptions set plan_code = 'employer_professional' where organization_id = current_setting('t.a')::uuid;
select is(pg_temp.conversion(), '1/1', 'after it moves to Professional the conversion is counted');

select * from finish();
rollback;
