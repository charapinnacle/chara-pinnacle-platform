begin;
select plan(36);

\ir status_fixture.inc

create function pg_temp.owner_of(p_org uuid) returns uuid
language sql as $$ select user_id from public.organization_members where organization_id = p_org and role = 'owner' $$;

-- The count of the Open vacancies card: the query the dashboard sends to public.jobs, as the member.
create function pg_temp.open_count(p_user uuid, p_org uuid) returns jsonb
language sql as $$
  select pg_temp.json_as(p_user, format('select count(*) as open from public.jobs where organization_id = %L and status = ''open'' and deleted_at is null', p_org))
$$;

-- FR-E5 AC4. Organisation A has 3 applications and 2 Open vacancies; B has 5 applications and 1 Open vacancy.
create temp table t_a as select pg_temp.org_on('employer_starter') as org;
create temp table t_b as select pg_temp.org_on('employer_starter') as org;
select pg_temp.member_of((select org from t_a)) as ma, pg_temp.member_of((select org from t_b)) as mb \gset
select pg_temp.owner_of((select org from t_a)) as oa \gset
select (select org from t_a) as org_a, (select org from t_b) as org_b \gset

select pg_temp.open_job('Welder A1', :'org_a') is not null as j1 \gset
select pg_temp.open_job('Welder A2', :'org_a') is not null as j2 \gset
select pg_temp.open_job('Welder B1', :'org_b') is not null as j3 \gset
select pg_temp.seed_job('{"title": "Paused A", "status": "paused"}', :'org_a') is not null as j4 \gset
select pg_temp.seed_job('{"title": "Draft A"}', :'org_a') is not null as j5 \gset
select pg_temp.seed_job('{"title": "Closed A", "status": "closed"}', :'org_a') is not null as j6 \gset
select pg_temp.seed_job('{"title": "Filled A", "status": "filled"}', :'org_a') is not null as j7 \gset
select pg_temp.seed_job('{"title": "Deleted A", "status": "open", "deleted_at": "2026-01-01T00:00:00Z"}', :'org_a') is not null as j8 \gset

select pg_temp.seed_app('applied', :'org_a') as a1 \gset
select pg_temp.seed_app('hired', :'org_a') as a2 \gset
select pg_temp.seed_app('withdrawn', :'org_a') as a3 \gset
select pg_temp.seed_app(s, :'org_b') from unnest(array['applied', 'applied', 'viewed', 'interview', 'rejected']) s;

create function pg_temp.stages(p_user uuid, p_org uuid) returns jsonb
language sql as $$
  select pg_temp.json_as(p_user, format('select status, total, recent from public.get_dashboard_applications(%L) order by status', p_org))
$$;

select is(
  pg_temp.stages(:'ma', :'org_a'),
  '[{"total": 1, "recent": 1, "status": "applied"}, {"total": 1, "recent": 1, "status": "hired"}, {"total": 1, "recent": 1, "status": "withdrawn"}]'::jsonb,
  'AC4: a member of A gets the 3 applications of A by stage'
);
select is(
  (select sum((e ->> 'total')::int) from jsonb_array_elements(pg_temp.stages(:'mb', :'org_b')) e), 5::bigint,
  'AC4: a member of B gets the 5 applications of B'
);
select is(pg_temp.stages(:'mb', :'org_a'), '[]'::jsonb, 'AC4: a member of B asking for A gets no application');
select is(pg_temp.stages(:'ma', :'org_b'), '[]'::jsonb, 'and a member of A asking for B gets none');
select is(pg_temp.stages(:'wb', :'org_a'), '[]'::jsonb, 'AC4: a candidate with no application to A gets none');
select is(pg_temp.stages(:'st_admin', :'org_a'), '[]'::jsonb, 'AC4: a platform administrator who is not a member gets none');
select pg_temp.seed_app('applied') as acme_app \gset
select is(pg_temp.stages(:'pending', current_setting('t.a')::uuid), '[]'::jsonb, 'a user whose invitation is not accepted gets none, though the organisation has an application');
select is(
  pg_temp.call_as(null, 'anon', format('select * from public.get_dashboard_applications(%L)', :'org_a')),
  '42501|permission denied for function get_dashboard_applications|', 'AC4: the anonymous role is refused with permission denied'
);

-- A candidate who applied to A sees only the own application, never the others.
update public.job_applications set worker_user_id = :'wb' where id = :'a1';
select is(
  (select sum((e ->> 'total')::int) from jsonb_array_elements(pg_temp.stages(:'wb', :'org_a')) e), 1::bigint,
  'a candidate asking for the organisation they applied to gets their own application only'
);
update public.job_applications set worker_user_id = '00000000-0000-0000-0000-00000000a101' where id = :'a1';

select is(pg_temp.open_count(:'ma', :'org_a'), '[{"open": 2}]'::jsonb, 'AC4 and AC1: the member of A counts 2 Open vacancies, not the paused, draft, closed, filled and deleted ones');
select is(pg_temp.open_count(:'mb', :'org_b'), '[{"open": 1}]'::jsonb, 'AC4: the member of B counts 1');

-- AC2: the window is the rolling 7 x 24 hours before now, any current stage, one organisation.
create temp table t_w as select pg_temp.org_on('employer_starter') as org;
select (select org from t_w) as org_w, pg_temp.member_of((select org from t_w)) as mw \gset
select pg_temp.seed_app('applied', :'org_w') as w1 \gset
select pg_temp.seed_app('withdrawn', :'org_w') as w2 \gset
select pg_temp.seed_app('interview', :'org_w') as w3 \gset
select pg_temp.seed_app('applied', :'org_w') as w4 \gset
select pg_temp.seed_app('hired', :'org_w') as w5 \gset
update public.job_applications set created_at = now() - interval '1 hour' where id = :'w1';
update public.job_applications set created_at = now() - interval '3 days' where id = :'w2';
update public.job_applications set created_at = now() - interval '6 days 23 hours' where id = :'w3';
update public.job_applications set created_at = now() - interval '7 days 1 hour' where id = :'w4';
update public.job_applications set created_at = now() - interval '30 days' where id = :'w5';
select pg_temp.seed_app('applied', :'org_b') as b_today \gset

select is(
  pg_temp.json_as(:'mw', format('select coalesce(sum(recent), 0)::int as recent, sum(total)::int as total from public.get_dashboard_applications(%L)', :'org_w')),
  '[{"total": 5, "recent": 3}]'::jsonb,
  'AC2: 3 of the 5 applications of the organisation fall in the last 7 x 24 hours (1 hour, 3 days and 6 days 23 hours), whatever their stage, and the 4 of B made today are not counted'
);
select is(
  pg_temp.json_as(:'mw', format('select status, recent from public.get_dashboard_applications(%L) order by status', :'org_w')),
  '[{"status": "applied", "recent": 1}, {"status": "interview", "recent": 1}, {"status": "hired", "recent": 0}, {"status": "withdrawn", "recent": 1}]'::jsonb,
  'the recent count is per stage, and the application of 7 days 1 hour and the one of 30 days are out of it'
);

-- AC3: every stage with its number, and a stage with no application has no row (the page shows 0).
create temp table t_s as select pg_temp.org_on('employer_starter') as org;
select (select org from t_s) as org_s, pg_temp.member_of((select org from t_s)) as ms \gset
select pg_temp.seed_app(s, :'org_s') from unnest(array[
  'applied', 'applied', 'applied', 'viewed', 'viewed', 'shortlisted', 'interview', 'hired', 'rejected', 'withdrawn']) s;
select is(
  pg_temp.json_as(:'ms', format('select status, total from public.get_dashboard_applications(%L) order by status', :'org_s')),
  '[{"total": 3, "status": "applied"}, {"total": 2, "status": "viewed"}, {"total": 1, "status": "shortlisted"}, {"total": 1, "status": "interview"},
    {"total": 1, "status": "hired"}, {"total": 1, "status": "rejected"}, {"total": 1, "status": "withdrawn"}]'::jsonb,
  'AC3: the stages hold 3, 2, 1, 1, 0 (no row for offer), 1, 1, 1 applications'
);
select pg_temp.set_as(:'ms', (select id from public.job_applications where organization_id = :'org_s' and status = 'applied' limit 1), 'interview') as moved \gset
select is(
  pg_temp.json_as(:'ms', format('select status, total from public.get_dashboard_applications(%L) where status in (''applied'', ''interview'') order by status', :'org_s')),
  '[{"total": 2, "status": "applied"}, {"total": 2, "status": "interview"}]'::jsonb,
  'AC3: after a move the next read gives Applied 2 and Interview 2, nothing is stored or cached by the function'
);

-- Applications of a deleted vacancy are counted, like the applicant list the stages link to (D61 departure 3). deleted_at has
-- no writer yet; a change of this rule has to change this test and the list together.
create temp table t_d as select pg_temp.org_on('employer_starter') as org;
select (select org from t_d) as org_d, pg_temp.member_of((select org from t_d)) as md \gset
select pg_temp.seed_job('{"title": "Deleted D", "status": "closed", "deleted_at": "2026-01-01T00:00:00Z"}', :'org_d') as dj \gset
select pg_temp.seed_app('applied', :'org_d', '00000000-0000-0000-0000-00000000a101', :'dj') as d1 \gset
select is(
  pg_temp.json_as(:'md', format('select status, total, recent from public.get_dashboard_applications(%L)', :'org_d')),
  '[{"status": "applied", "total": 1, "recent": 1}]'::jsonb,
  'the application of a deleted vacancy is counted in the stages and in the last 7 days'
);

-- A suspended organisation shows no figure.
create temp table t_x as select pg_temp.org_on('employer_starter') as org;
select pg_temp.seed_app('applied', (select org from t_x)) as x1 \gset
update public.organizations set status = 'suspended' where id = (select org from t_x);
select is(pg_temp.stages(pg_temp.member_of((select org from t_x)), (select org from t_x)), '[]'::jsonb, 'a suspended organisation has no application in the dashboard read (FR-D5)');

-- The plan card. A refusal is the text 'sqlstate|message|detail'; the rows are one jsonb array.
create function pg_temp.plan_of(p_user uuid, p_org uuid, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  set local role authenticated;
  begin
    select coalesce(jsonb_agg(to_jsonb(p)), '[]')::text into v_result from public.get_dashboard_plan(p_org) p;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- AC5: a trialing subscription shows the plan name from billing.plans, the status and the trial end.
create temp table t_t as select pg_temp.org_on('employer_starter', 'trialing') as org;
update billing.subscriptions set trial_ends_at = '2026-12-01T10:00:00Z' where organization_id = (select org from t_t);
select (select org from t_t) as org_t, pg_temp.member_of((select org from t_t)) as mt, pg_temp.owner_of((select org from t_t)) as ot \gset
select is(
  pg_temp.plan_of(:'mt', :'org_t', 'aal1')::jsonb,
  '[{"status": "trialing", "plan_name": "Basic", "past_due_since": null, "trial_ends_at": "2026-12-01T10:00:00+00:00", "current_period_end": null, "subscription_ended": false}]'::jsonb,
  'AC5: a plain member at aal1 reads the plan name, the trialing status and the trial end'
);
select is(pg_temp.plan_of(:'ot', :'org_t')::jsonb, pg_temp.plan_of(:'mt', :'org_t', 'aal1')::jsonb, 'AC5: the owner at aal2 reads the same');
select is(pg_temp.plan_of(:'ot', :'org_t', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'an owner at aal1 is refused, as the policy of the subscriptions refuses it');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'org_t', :'adm', 'admin', now());
select is(pg_temp.plan_of(:'adm', :'org_t', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'and so is an admin at aal1');
select is(jsonb_array_length(pg_temp.plan_of(:'adm', :'org_t')::jsonb), 1, 'an admin at aal2 reads it');
select is(pg_temp.plan_of(:'mb', :'org_t', 'aal1'), '[]', 'a member of another organisation gets no row');
select is(pg_temp.plan_of(:'st_admin', :'org_t'), '[]', 'a platform administrator who is not a member gets no row');
select is(pg_temp.plan_of(:'wb', :'org_t', 'aal1'), 'P0001|CHARA_FORBIDDEN|company_account_required', 'a candidate is refused');
select is(
  pg_temp.call_as(null, 'anon', format('select * from public.get_dashboard_plan(%L)', :'org_t')),
  '42501|permission denied for function get_dashboard_plan|', 'the anonymous role has no EXECUTE'
);
select is(
  (select array_agg(a.attname::text order by a.attnum) from pg_proc p, unnest(p.proargnames) with ordinality a(attname, attnum)
   where p.oid = 'public.get_dashboard_plan(uuid)'::regprocedure and a.attnum > 1),
  array['plan_name', 'status', 'trial_ends_at', 'current_period_end', 'past_due_since', 'subscription_ended'],
  'the result holds no provider, no reference and no plan code'
);

-- The name is the one in billing.plans, whatever the code.
update billing.plans set name = 'Renamed basic' where code = 'employer_starter';
select is(pg_temp.plan_of(:'mt', :'org_t', 'aal1')::jsonb -> 0 ->> 'plan_name', 'Renamed basic', 'AC5: the plan name comes from billing.plans');
update billing.plans set name = 'Basic' where code = 'employer_starter';

-- AC5: an active subscription shows the next billing date.
create temp table t_p as select pg_temp.org_on('employer_professional', 'active') as org;
update billing.subscriptions set current_period_end = '2026-11-03T00:00:00Z' where organization_id = (select org from t_p);
select is(
  pg_temp.plan_of(pg_temp.member_of((select org from t_p)), (select org from t_p), 'aal1')::jsonb,
  '[{"status": "active", "plan_name": "Professional", "past_due_since": null, "trial_ends_at": null, "current_period_end": "2026-11-03T00:00:00+00:00", "subscription_ended": false}]'::jsonb,
  'AC5: an active subscription shows the plan name, Active and the period end'
);

-- AC7: past due keeps the paid plan and shows since when.
create temp table t_q as select pg_temp.org_on('employer_starter', 'past_due') as org;
update billing.subscriptions set past_due_since = '2026-10-06T08:00:00Z' where organization_id = (select org from t_q);
select is(
  pg_temp.plan_of(pg_temp.member_of((select org from t_q)), (select org from t_q), 'aal1')::jsonb,
  '[{"status": "past_due", "plan_name": "Basic", "past_due_since": "2026-10-06T08:00:00+00:00", "trial_ends_at": null, "current_period_end": null, "subscription_ended": false}]'::jsonb,
  'AC7: a past due subscription keeps the paid plan name and gives past_due_since'
);

-- AC8: a lapsed organisation is on the free plan with a subscription that has ended; a new one is on it with none.
create temp table t_l as select pg_temp.org_on('employer_starter', 'canceled') as org;
select is(
  pg_temp.plan_of(pg_temp.member_of((select org from t_l)), (select org from t_l), 'aal1')::jsonb,
  '[{"status": "free", "plan_name": "Free", "past_due_since": null, "trial_ends_at": null, "current_period_end": null, "subscription_ended": true}]'::jsonb,
  'AC8: a cancelled subscription gives the Free plan and subscription_ended'
);
create temp table t_n as select pg_temp.org_on() as org;
select is(
  pg_temp.plan_of(pg_temp.member_of((select org from t_n)), (select org from t_n), 'aal1')::jsonb,
  '[{"status": "free", "plan_name": "Free", "past_due_since": null, "trial_ends_at": null, "current_period_end": null, "subscription_ended": false}]'::jsonb,
  'AC8: an organisation that never subscribed gives the Free plan and no ended subscription'
);
insert into billing.subscriptions (organization_id, plan_code, status, provider) values ((select org from t_l), 'employer_professional', 'active', 'null');
select is(
  pg_temp.plan_of(pg_temp.member_of((select org from t_l)), (select org from t_l), 'aal1')::jsonb -> 0 ->> 'plan_name', 'Professional',
  'a new live subscription after a cancelled one is the one shown'
);
select is(
  pg_temp.plan_of(pg_temp.member_of((select org from t_l)), (select org from t_l), 'aal1')::jsonb -> 0 ->> 'subscription_ended', 'false',
  'and the organisation is no longer lapsed'
);
create temp table t_z as select pg_temp.org_on('employer_starter', 'paused') as org;
select is(
  pg_temp.plan_of(pg_temp.member_of((select org from t_z)), (select org from t_z), 'aal1')::jsonb -> 0 ->> 'plan_name', 'Free',
  'a paused subscription resolves to the free plan, as the entitlements do'
);
select is(
  pg_temp.plan_of(pg_temp.member_of((select org from t_z)), (select org from t_z), 'aal1')::jsonb -> 0 ->> 'status', 'free',
  'and its status is free, so the status list of the function stays tied to private.org_plan_code'
);

select * from finish();
rollback;
