begin;
select plan(23);

\ir organizations_fixture.inc

-- FR-G5 AC7: the usage the billing page shows, and who may read it (AC2, AC3 for the subscription view are in
-- 023_plans_as_data).

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

create function pg_temp.seed_jobs(p_org uuid, p_status text, p_count integer, p_deleted boolean default false) returns void
language sql as $$
  insert into public.jobs (
    organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type,
    recruitment_preference, status, deleted_at
  )
  select
    p_org, 'Usage ' || p_status || ' ' || n, 'Weld steel frames in our Hamburg workshop. Weld steel frames in our Hamburg workshop.',
    '7212', 'C', 'DE', 'Hamburg', 'full_time', 'both', p_status::public.job_status, case when p_deleted then now() end
  from generate_series(1, p_count) n
$$;

create function pg_temp.subscribe(p_org uuid, p_plan text, p_status text) returns void
language sql as $$
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (p_org, p_plan, p_status, 'null')
$$;

-- 'key=used/limit;...' in key order, or 'sqlstate|message|detail'.
create function pg_temp.usage(p_user uuid, p_org uuid, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
  v_result text;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text end,
    true
  );
  set local role authenticated;
  begin
    select string_agg(format('%s=%s/%s', u.limit_key, u.used, coalesce(u.limit_value::text, 'null')), ';' order by u.limit_key)
    into v_result from public.billing_usage(p_org) u;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- O: Professional, active, with 7 open, 2 paused, 1 closed and 1 deleted vacancy and three members (owner, admin, member).
select pg_temp.new_org(:'own1') as o \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (:'o', :'adm', 'admin', now()), (:'o', :'mem', 'member', now());
select pg_temp.subscribe(:'o', 'employer_professional', 'active');
select pg_temp.seed_jobs(:'o', 'open', 7);
select pg_temp.seed_jobs(:'o', 'paused', 2);
select pg_temp.seed_jobs(:'o', 'closed', 1);
select pg_temp.seed_jobs(:'o', 'open', 1, true);

-- B: Basic with 3 open vacancies, alone. D: downgraded to Basic with 5 open vacancies.
select pg_temp.new_org(:'own2') as b \gset
select pg_temp.subscribe(:'b', 'employer_starter', 'active');
select pg_temp.seed_jobs(:'b', 'open', 3);
select pg_temp.new_org(:'own2') as d \gset
select pg_temp.subscribe(:'d', 'employer_starter', 'active');
select pg_temp.seed_jobs(:'d', 'open', 5);

-- P: Professional with the owner and one pending invitation, which the member limit counts as a seat.
select pg_temp.new_org(:'own2') as p \gset
insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by)
values (:'p', 'pending@example.test', 'member', repeat('a', 64), :'own2');
select pg_temp.subscribe(:'p', 'employer_professional', 'active');

-- F: never subscribed. L: lapsed. E: Enterprise with a limit that is null (unlimited) and one raised by an override.
select pg_temp.new_org(:'own2') as f \gset
select pg_temp.new_org(:'own2') as l \gset
select pg_temp.subscribe(:'l', 'employer_starter', 'canceled');
select pg_temp.new_org(:'adm2') as e \gset
select pg_temp.subscribe(:'e', 'employer_enterprise', 'active');

select is(pg_temp.usage(:'own1', :'o'), 'active_jobs=7/15;members=3/5', 'AC7: the owner at aal2 reads 7 of 15 open vacancies and 3 of 5 members; paused, closed and deleted vacancies are not counted');
select is(pg_temp.usage(:'own2', :'p'), 'active_jobs=0/15;members=2/5', 'AC7: a pending invitation holds a seat, as the member limit counts it');
select is(pg_temp.usage(:'adm', :'o'), 'active_jobs=7/15;members=3/5', 'AC7: the admin at aal2 reads the same');
select is(pg_temp.usage(:'own2', :'b'), 'active_jobs=3/3;members=1/1', 'AC7: a Basic organisation reads 3 of 3 vacancies and 1 of 1 members (the owner counts, C12)');
select is(pg_temp.usage(:'own2', :'d'), 'active_jobs=5/3;members=1/1', 'AC7: an organisation downgraded to Basic reads 5 of 3: the limit is not applied to the data');
select is(pg_temp.usage(:'own2', :'f'), 'active_jobs=0/0;members=1/0', 'AC9: an organisation that never subscribed reads the limits of the free plan');
select is(pg_temp.usage(:'own2', :'l'), 'active_jobs=0/0;members=1/0', 'AC5: a lapsed organisation reads the limits of the free plan');
select is(pg_temp.usage(:'adm2', :'e'), 'active_jobs=0/50;members=1/15', 'AC7: an Enterprise organisation reads the limits of its plan');

update billing.plan_limits set limit_value = null where plan_code = 'employer_enterprise' and limit_key = 'members';
insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value) values (:'e', 'active_jobs', 80);
select is(pg_temp.usage(:'adm2', :'e'), 'active_jobs=0/80;members=1/null', 'AC7: an override replaces the plan limit and a null limit is unlimited');

select pg_temp.seed_jobs(:'o', 'open', 1);
select is(pg_temp.usage(:'own1', :'o'), 'active_jobs=8/15;members=3/5', 'the count follows the vacancies at once');
delete from public.jobs where organization_id = :'o' and title = 'Usage open 1' and deleted_at is null;
select is(pg_temp.usage(:'own1', :'o'), 'active_jobs=6/15;members=3/5', 'and drops when two vacancies leave the open state');

select is(pg_temp.usage(:'mem', :'o'), 'P0001|CHARA_FORBIDDEN|', 'AC3: a member is refused');
select is(pg_temp.usage(:'own1', :'o', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'AC3: an owner at aal1 is refused with the reason');
select is(pg_temp.usage(:'adm', :'o', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'AC3: so is an admin at aal1');
select is(pg_temp.usage(:'own2', :'o'), 'P0001|CHARA_FORBIDDEN|', 'AC3: the owner of another organisation is refused');
select is(pg_temp.usage(:'inv', :'o'), 'P0001|CHARA_FORBIDDEN|', 'AC3: a platform administrator who is not a member is refused');
select is(pg_temp.usage(:'wkr', :'o'), 'P0001|CHARA_FORBIDDEN|worker_account', 'AC3: a candidate is refused');
select is(pg_temp.usage(:'own1', gen_random_uuid()), 'P0001|CHARA_FORBIDDEN|', 'an organisation that does not exist is refused like one that is not the caller''s');
select is(
  pg_temp.call_as(null, 'anon', format($$select * from public.billing_usage(%L)$$, :'o')),
  '42501|permission denied for function billing_usage|', 'AC3: an anonymous caller has no EXECUTE'
);
select is(
  pg_temp.call_as(null, 'authenticated', format($$select * from public.billing_usage(%L)$$, :'o')),
  'P0001|CHARA_FORBIDDEN|', 'an authenticated token without a user is refused'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'billing_usage' and p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('service_role', p.oid, 'execute')),
  1, 'the function is a definer with an empty search path and service_role cannot call it'
);

select is(
  (select count(*)::integer from audit.log where action like 'billing.%' and entity_id = :'o'), 0,
  'reading the usage writes no audit row'
);
select is(
  (select count(*)::integer from pg_indexes where schemaname = 'public' and tablename = 'jobs' and indexname = 'jobs_organization_open_idx'),
  1, 'the open count reads the partial index of the limit check'
);

select * from finish();
rollback;
