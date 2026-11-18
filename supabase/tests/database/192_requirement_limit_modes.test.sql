begin;
select plan(16);

\ir apply_fixture.inc
\ir billing_events_fixture.inc

-- The open-requirements limit in both modes of entitlements_enforced (20270115200100; FR-M4 AC3, FR-G5; NFR-A4): while
-- it is on, publishing and reopening are refused at the plan's limit and billing_usage says the limit applies; while it
-- is off, both succeed above the limit and billing_usage says it does not apply, so the billing page does not claim
-- that publishing is blocked. Acme (t.a: owner own1) and Beta (t.b: admin adm2) are employers of the fixture.

update private.settings set value = 'true' where key = 'release_job_orders';

create function pg_temp.enforce(p_on boolean) returns void
language sql as $$ update private.settings set value = to_jsonb(p_on) where key = 'entitlements_enforced' $$;

create function pg_temp.seed_req(p_org uuid, p_status text, p_title text) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_published boolean := p_status <> 'draft';
begin
  insert into public.workforce_requirements (
    organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on, status_changed_at, updated_at
  ) values (
    p_org, p_title, 10, 'DE', 'Hamburg', 'C', current_date + 30, 'full_time', 'international', 'both',
    p_status::public.requirement_status, case when v_published then 'private'::public.requirement_visibility end,
    case when v_published then now() - interval '10 days' end, case when v_published then current_date + 80 end,
    now() - interval '1 day', now() - interval '1 day'
  ) returning id into v_id;
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

create function pg_temp.version(p_req uuid) returns timestamptz
language sql as $$ select updated_at from public.workforce_requirements where id = p_req $$;

create function pg_temp.pub(p_org uuid, p_req uuid) returns text
language sql as $$
  select pg_temp.call_as(current_setting('t.own1')::uuid, 'authenticated', format(
    'select public.publish_requirement(%L, %L, ''private'', false, %L::timestamptz)', p_org, p_req, pg_temp.version(p_req)))
$$;

create function pg_temp.reopen(p_org uuid, p_req uuid) returns text
language sql as $$
  select pg_temp.call_as(current_setting('t.own1')::uuid, 'authenticated', format(
    'select public.set_requirement_status(%L, %L, ''open'', %L::timestamptz)', p_org, p_req, pg_temp.version(p_req)))
$$;

create function pg_temp.state(p_req uuid) returns text
language sql as $$ select status::text from public.workforce_requirements where id = p_req $$;

create function pg_temp.open_count(p_org uuid) returns integer
language sql as $$ select count(*)::integer from public.workforce_requirements where organization_id = p_org and status = 'open' $$;

-- billing_usage of active_requirements as the user at aal2: 'used/limit applies', or 'sqlstate|message|detail'.
create function pg_temp.billing(p_user uuid, p_org uuid) returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
  begin
    select u.used || '/' || u.limit_value || ' ' || u.applies into v_result
    from public.billing_usage(p_org) u where u.limit_key = 'active_requirements';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

select set_config('t.own1', :'own1', false) as setup_own1 \gset
select pg_temp.new_org(:'own1') as o \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'o', 'employer_starter', 'active', 'null');
select pg_temp.seed_req(:'o', 'open', 'Open ' || n) from generate_series(1, 3) n;
select pg_temp.seed_req(:'o', 'draft', 'Draft one') as d1 \gset
select pg_temp.seed_req(:'o', 'draft', 'Draft two') as d2 \gset
select pg_temp.seed_req(:'o', 'paused', 'Paused one') as p1 \gset

select ok(
  (select array_agg(p.parameter_name::text order by p.ordinal_position) from information_schema.parameters p
   join information_schema.routines r on r.specific_name = p.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'billing_usage' and p.parameter_mode = 'OUT')
    = array['limit_key', 'used', 'limit_value', 'applies'],
  'billing_usage answers whether each limit applies');

-- Enforced -------------------------------------------------------------------------------------------------------------------

select pg_temp.enforce(true);
select is(pg_temp.billing(:'own1', :'o'), '3/3 true', 'enforced: 3 of 3 open requirements, and the limit applies');
select is(pg_temp.pub(:'o', :'d1'), 'P0001|CHARA_LIMIT_REACHED|active_requirements', 'enforced: a publish at the limit is refused');
select is(pg_temp.reopen(:'o', :'p1'), 'P0001|CHARA_LIMIT_REACHED|active_requirements', 'enforced: so is a reopen');
select is(pg_temp.state(:'d1') || ',' || pg_temp.state(:'p1'), 'draft,paused', 'both keep their status');
select is(pg_temp.open_count(:'o'), 3, 'the organisation stays at its limit');

-- Not enforced ------------------------------------------------------------------------------------------------------------

select pg_temp.enforce(false);
select is(pg_temp.billing(:'own1', :'o'), '3/3 false', 'not enforced: the limit does not apply');
select is(pg_temp.pub(:'o', :'d1'), 'ok', 'not enforced: a publish above the limit succeeds');
select is(pg_temp.open_count(:'o'), 4, 'the organisation has 4 open requirements');
select is(pg_temp.billing(:'own1', :'o'), '4/3 false', 'billing_usage reads 4 of 3 and that the limit does not apply');

-- Enforced again, over the limit ----------------------------------------------------------------------------------------------

select pg_temp.enforce(true);
select is(pg_temp.billing(:'own1', :'o'), '4/3 true', 'enforced again: 4 of 3, and the limit applies');
select is(pg_temp.pub(:'o', :'d2'), 'P0001|CHARA_LIMIT_REACHED|active_requirements', 'over the limit a publish is refused');
select is(pg_temp.reopen(:'o', :'p1'), 'P0001|CHARA_LIMIT_REACHED|active_requirements', 'and so is a reopen');
select is(pg_temp.open_count(:'o'), 4, 'the open requirements stay open: nothing is closed');

-- Access ----------------------------------------------------------------------------------------------------------------------

select is(pg_temp.billing(:'adm2', :'o'), 'P0001|CHARA_FORBIDDEN|', 'NFR-S8: an admin of another employer is refused');
select is(pg_temp.call_as(null, 'anon', format('select * from public.billing_usage(%L)', :'o')),
  '42501|permission denied for function billing_usage|', 'NFR-S8: the anonymous caller has no EXECUTE');

select * from finish();
rollback;
