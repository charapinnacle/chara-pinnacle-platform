begin;
select plan(49);

\ir status_fixture.inc

-- FR-E4: shortlisting is a move to the Shortlisted state through set_application_status, allowed by the plan feature
-- 'shortlisting' (billing.plan_features), with no flag of its own.

-- One application's state as one text: status, events written, status_changed messages queued.
create function pg_temp.snap(p_app uuid) returns text
language sql as $$ select pg_temp.status_of(p_app) || '/' || pg_temp.event_count(p_app) || '/' || pg_temp.queued_for(p_app) $$;

create function pg_temp.owner_of(p_org uuid) returns uuid
language sql as $$ select user_id from public.organization_members where organization_id = p_org and role = 'owner' limit 1 $$;

-- AC3: the seeded features. Read first, because AC2 deletes a row.
select is(
  (select jsonb_agg(plan_code order by plan_code) from billing.plan_features where feature_key = 'shortlisting'),
  '["employer_enterprise", "employer_professional", "employer_starter"]'::jsonb,
  'AC3: the three paid plans carry shortlisting'
);
select is(
  (select count(*) from billing.plan_features where feature_key = 'shortlisting' and plan_code = 'free_employer'), 0::bigint,
  'AC3: free_employer does not'
);

-- AC1: Applied and Viewed to Shortlisted, with the limits enforced, on each paid plan.
update private.settings set value = 'true' where key = 'entitlements_enforced';
create temp table t_paid as
  select p.plan, pg_temp.org_on(p.plan) as org
  from (values ('employer_starter'), ('employer_professional'), ('employer_enterprise')) p (plan);
create function pg_temp.shortlist_round(p_plan text) returns jsonb
language plpgsql as $$
declare
  v_org uuid := (select org from t_paid where plan = p_plan);
  v_member uuid := pg_temp.member_of(v_org);
  v_a1 uuid := pg_temp.seed_app('applied', v_org);
  v_a2 uuid := pg_temp.seed_app('viewed', v_org);
  v_a3 uuid := pg_temp.seed_app('applied', v_org);
  v_calls text[];
begin
  v_calls := array[
    pg_temp.set_as(v_member, v_a1, 'shortlisted', 'Strong profile'),
    pg_temp.set_as(v_member, v_a2, 'shortlisted', 'Strong profile'),
    pg_temp.set_as(pg_temp.owner_of(v_org), v_a3, 'shortlisted')
  ];
  return jsonb_build_object(
    'calls', to_jsonb(v_calls),
    'snaps', jsonb_build_array(pg_temp.snap(v_a1), pg_temp.snap(v_a2), pg_temp.snap(v_a3)),
    'events', (select jsonb_agg(jsonb_build_array(e.from_status, e.to_status, e.actor_id = case when e.application_id = v_a3 then pg_temp.owner_of(v_org) else v_member end, e.note) order by e.application_id = v_a1 desc, e.application_id = v_a2 desc)
               from public.application_events e where e.application_id in (v_a1, v_a2, v_a3) and e.to_status = 'shortlisted'),
    'shares', (select jsonb_agg(jsonb_build_array(s.expires_at is null, s.revoked_at is null)) from public.passport_shares s where s.application_id in (v_a1, v_a2, v_a3)),
    'queued', (select jsonb_agg(m.message ->> 'status') from pgmq.q_notifications m where m.message ->> 'application_id' in (v_a1::text, v_a2::text, v_a3::text))
  );
end;
$$;
select is(
  pg_temp.shortlist_round('employer_starter'),
  '{"calls": ["ok", "ok", "ok"], "snaps": ["shortlisted/2/1", "shortlisted/2/1", "shortlisted/2/1"],
    "events": [["applied", "shortlisted", true, "Strong profile"], ["viewed", "shortlisted", true, "Strong profile"], ["applied", "shortlisted", true, null]],
    "shares": [[true, true], [true, true], [true, true]], "queued": ["shortlisted", "shortlisted", "shortlisted"]}'::jsonb,
  'AC1: employer_starter shortlists Applied and Viewed (member) and Applied (owner); one event and one message each, shares untouched'
);
select is(
  pg_temp.shortlist_round('employer_professional') ->> 'snaps', '["shortlisted/2/1", "shortlisted/2/1", "shortlisted/2/1"]',
  'AC1: employer_professional shortlists the same way'
);
select is(
  pg_temp.shortlist_round('employer_enterprise') ->> 'snaps', '["shortlisted/2/1", "shortlisted/2/1", "shortlisted/2/1"]',
  'AC1: employer_enterprise shortlists the same way'
);
select is(
  pg_temp.shortlist_round('employer_professional') -> 'shares', '[[true, true], [true, true], [true, true]]'::jsonb,
  'AC1: no share expires or is revoked by a shortlisting'
);
select is(
  (select count(*) from audit.log where action = 'application.status_changed' and metadata ->> 'to' = 'shortlisted' and metadata ->> 'from' in ('applied', 'viewed')),
  12::bigint, 'AC1: every shortlisting wrote one audit row'
);

-- AC2: a plan that lacks the feature (the row is deleted here), and a plan code that is in no plan. The foreign key of
-- the subscription to the plans is dropped inside this transaction to give the second organisation such a code.
delete from billing.plan_features where plan_code = 'employer_starter' and feature_key = 'shortlisting';
alter table billing.subscriptions drop constraint subscriptions_plan_code_fkey;
create temp table t_lack as select pg_temp.org_on('employer_starter') as starter, pg_temp.org_on('ghost_plan') as ghost;
create temp table t_lack_apps as
  select pg_temp.seed_app('applied', starter) as a_starter, pg_temp.seed_app('applied', ghost) as a_ghost,
         pg_temp.seed_app('applied', starter) as a_force, pg_temp.seed_app('applied', starter) as a_bulk
  from t_lack;
create function pg_temp.force_shortlist(p_app uuid) returns void
language plpgsql as $$
begin
  perform set_config('chara.actor_fn', 'set_application_status', true);
  update public.job_applications set status = 'shortlisted' where id = p_app;
end;
$$;
create temp table t_lack_before as select pg_temp.snap(a_starter) as s, pg_temp.snap(a_ghost) as g from t_lack_apps;
select is(
  pg_temp.set_as(pg_temp.member_of((select starter from t_lack)), (select a_starter from t_lack_apps), 'shortlisted'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|shortlisting', 'AC2: a member of a plan without the feature is refused, detail shortlisting'
);
select is(
  pg_temp.set_as(pg_temp.member_of((select ghost from t_lack)), (select a_ghost from t_lack_apps), 'shortlisted'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|shortlisting', 'AC2: a member of an organisation whose plan code is in no plan is refused the same way'
);
select is(
  (select pg_temp.snap(a_starter) || '#' || pg_temp.snap(a_ghost) from t_lack_apps),
  (select s || '#' || g from t_lack_before), 'AC2: status, events and messages are unchanged'
);
select is(
  pg_temp.set_as(pg_temp.member_of((select starter from t_lack)), (select a_starter from t_lack_apps), 'interview'),
  'ok', 'AC2: the move to Interview succeeds on the same plan'
);
select is(pg_temp.snap((select a_starter from t_lack_apps)), 'interview/2/1', 'AC2: and writes its event and message');
select throws_ok(
  format($$select pg_temp.force_shortlist(%L)$$, (select a_force from t_lack_apps)),
  'P0001', 'CHARA_FEATURE_NOT_IN_PLAN', 'AC2: the trigger refuses the move for the database owner too'
);

-- AC4: while limits are not enforced, and for a lapsed organisation.
update private.settings set value = 'false' where key = 'entitlements_enforced';
create temp table t_ac4 as select pg_temp.org_on() as never, pg_temp.org_on('employer_starter', 'canceled') as lapsed;
create temp table t_ac4_apps as select pg_temp.seed_app('applied', never) as a_never, pg_temp.seed_app('applied', lapsed) as a_lapsed from t_ac4;
select is(
  pg_temp.set_as(pg_temp.member_of((select never from t_ac4)), (select a_never from t_ac4_apps), 'shortlisted'),
  'ok', 'AC4: an organisation that never subscribed shortlists while limits are not enforced'
);
select is(
  pg_temp.set_as(pg_temp.member_of((select lapsed from t_ac4)), (select a_lapsed from t_ac4_apps), 'shortlisted'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC4: a lapsed organisation is refused, detail read_only_free_plan, whatever the setting says'
);
select is(pg_temp.snap((select a_lapsed from t_ac4_apps)), 'applied/1/0', 'AC4: the lapsed organisation''s application is unchanged');

-- AC5: only Applied and Viewed can be shortlisted.
update private.settings set value = 'true' where key = 'entitlements_enforced';
create temp table t_ac5 as
  select s.status, pg_temp.seed_app(s.status, (select org from t_paid where plan = 'employer_professional')) as app
  from (values ('interview'), ('offer'), ('hired'), ('rejected'), ('withdrawn'), ('shortlisted')) s (status);
create temp table t_ac5_before as select status, pg_temp.snap(app) as s from t_ac5;
select is(
  (select jsonb_object_agg(status, pg_temp.set_as(pg_temp.member_of((select org from t_paid where plan = 'employer_professional')), app, 'shortlisted'))
   from t_ac5),
  '{"interview": "P0001|CHARA_INVALID_TRANSITION|interview to shortlisted", "offer": "P0001|CHARA_INVALID_TRANSITION|offer to shortlisted",
    "hired": "P0001|CHARA_INVALID_TRANSITION|hired to shortlisted", "rejected": "P0001|CHARA_INVALID_TRANSITION|rejected to shortlisted",
    "withdrawn": "P0001|CHARA_INVALID_TRANSITION|withdrawn to shortlisted", "shortlisted": "P0001|CHARA_INVALID_TRANSITION|shortlisted to shortlisted"}'::jsonb,
  'AC5: each of the six other states is refused with CHARA_INVALID_TRANSITION'
);
select is(
  (select jsonb_object_agg(status, pg_temp.snap(app)) from t_ac5), (select jsonb_object_agg(status, s) from t_ac5_before),
  'AC5: no status, event or message changed'
);

-- AC6: leaving the shortlist follows the transition table.
create temp table t_ac6 as
  select n, pg_temp.seed_app('shortlisted', (select org from t_paid where plan = 'employer_professional')) as app from generate_series(1, 5) n;
select pg_temp.member_of((select org from t_paid where plan = 'employer_professional')) as m6 \gset
select is(pg_temp.set_as(:'m6', (select app from t_ac6 where n = 1), 'interview'), 'ok', 'AC6: Shortlisted to Interview');
select is(pg_temp.set_as(:'m6', (select app from t_ac6 where n = 2), 'offer'), 'ok', 'AC6: Shortlisted to Offer');
select is(pg_temp.set_as(:'m6', (select app from t_ac6 where n = 3), 'rejected'), 'ok', 'AC6: Shortlisted to Not selected');
select is(
  (select jsonb_agg(pg_temp.snap(app) order by n) from t_ac6 where n <= 3), '["interview/2/1", "offer/2/1", "rejected/2/1"]'::jsonb,
  'AC6: one event and one message each'
);
select is(
  pg_temp.set_as(:'m6', (select app from t_ac6 where n = 4), 'applied'), 'P0001|CHARA_INVALID_TRANSITION|shortlisted to applied',
  'AC6: back to Applied is refused'
);
select is(
  pg_temp.set_as(:'m6', (select app from t_ac6 where n = 4), 'viewed'), 'P0001|CHARA_INVALID_TRANSITION|shortlisted to viewed',
  'AC6: back to Viewed is refused'
);
select is(
  pg_temp.set_as(:'m6', (select app from t_ac6 where n = 4), 'hired'), 'P0001|CHARA_INVALID_TRANSITION|shortlisted to hired',
  'AC6: straight to Hired is refused'
);
select is(pg_temp.snap((select app from t_ac6 where n = 4)), 'shortlisted/1/0', 'AC6: the application stays Shortlisted without a new event');
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$select public.withdraw_application(%L)$$, (select app from t_ac6 where n = 5)), 'aal1'),
  'ok', 'AC6: the candidate of a shortlisted application can still withdraw'
);
select is(pg_temp.status_of((select app from t_ac6 where n = 5)), 'withdrawn', 'AC6: and it is withdrawn');

-- AC7: no flag, only the state.
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name in ('job_applications', 'application_events') and column_name ilike '%shortlist%'),
  0::bigint, 'AC7: neither table has a shortlist column'
);
create temp table t_ac7 as select pg_temp.seed_job('{"title": "Count vacancy", "status": "paused"}', (select org from t_paid where plan = 'employer_enterprise')) as job;
create temp table t_ac7_apps as
  select pg_temp.seed_app(w.status, (select org from t_paid where plan = 'employer_enterprise'), w.worker, (select job from t_ac7))
  from (values ('shortlisted', :'wa'::uuid), ('shortlisted', :'wb'::uuid), ('applied', :'wnew'::uuid)) w (status, worker);
select is(
  (select count(*) from public.job_applications where job_id = (select job from t_ac7) and status = 'shortlisted'), 2::bigint,
  'AC7: the number of shortlisted applicants of a vacancy is the count of applications in that state'
);

-- Control: the feature is checked in the database on every path (SOP risk: feature leakage across plans).
select is(
  pg_temp.bulk_as(pg_temp.member_of((select starter from t_lack)), array[(select a_bulk from t_lack_apps)], 'shortlisted') -> 0 ->> 'error_code',
  'CHARA_FEATURE_NOT_IN_PLAN', 'control: a bulk call is refused for the plan without the feature'
);
select is(pg_temp.status_of((select a_bulk from t_lack_apps)), 'applied', 'control: and the application stays Applied');
select is(
  pg_temp.call_as(null, 'anon', format($$select public.set_application_status(%L, 'shortlisted')$$, (select app from t_ac5 where status = 'interview'))),
  '42501|permission denied for function set_application_status|', 'control: an anonymous caller has no EXECUTE'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$update public.job_applications set status = 'shortlisted' where id = %L$$, (select app from t_ac6 where n = 4))),
  '42501|permission denied for table job_applications|', 'control: no API role can write the status of an application directly'
);

-- AC12: outsiders cannot shortlist. The anonymous caller has no EXECUTE (default-deny grants), so the database answers
-- 42501 before the function runs, not CHARA_UNAUTHENTICATED (D60 departure).
create temp table t_ac12 as select pg_temp.seed_app('applied', (select org from t_paid where plan = 'employer_professional')) as app;
create temp table t_ac12_before as select pg_temp.snap(app) as s from t_ac12;
select is(
  pg_temp.call_as(null, 'anon', format($$select public.set_application_status(%L, 'shortlisted')$$, (select app from t_ac12))),
  '42501|permission denied for function set_application_status|', 'AC12: an anonymous caller is refused'
);
select is(
  pg_temp.set_as(:'wa', (select app from t_ac12), 'shortlisted'), 'P0001|CHARA_FORBIDDEN|company_account_required',
  'AC12: the candidate gets CHARA_FORBIDDEN'
);
select is(
  pg_temp.set_as(pg_temp.member_of((select org from t_paid where plan = 'employer_enterprise')), (select app from t_ac12), 'shortlisted'),
  'P0002|CHARA_NOT_FOUND|', 'AC12: a member of another organisation gets CHARA_NOT_FOUND'
);
select is(
  pg_temp.set_as(:'st_admin', (select app from t_ac12), 'shortlisted', null, 'aal2'), 'P0002|CHARA_NOT_FOUND|',
  'AC12: a platform administrator who is not a member gets CHARA_NOT_FOUND'
);
select is(pg_temp.snap((select app from t_ac12)), (select s from t_ac12_before), 'AC12: the application stays Applied with no event and no message');

-- AC9: a plan change does not disturb a shortlisted applicant. The organisation moves from a plan with the feature to
-- employer_starter, whose row was deleted above.
create temp table t_ac9 as select pg_temp.org_on('employer_professional') as org;
create temp table t_ac9_apps as
  select pg_temp.seed_app('shortlisted', org) as kept, pg_temp.seed_app('applied', org) as fresh from t_ac9;
update billing.subscriptions set plan_code = 'employer_starter' where organization_id = (select org from t_ac9);
select is(
  pg_temp.json_as(pg_temp.member_of((select org from t_ac9)), format('select status from public.v_job_applicants where id = %L', (select kept from t_ac9_apps))),
  '[{"status": "shortlisted"}]'::jsonb, 'AC9: after the plan change the applicant is still Shortlisted and readable'
);
select is(
  pg_temp.set_as(pg_temp.member_of((select org from t_ac9)), (select kept from t_ac9_apps), 'interview'), 'ok',
  'AC9: the move to Interview succeeds'
);
select is(pg_temp.snap((select kept from t_ac9_apps)), 'interview/2/1', 'AC9: and writes its event and message');
select is(
  pg_temp.set_as(pg_temp.member_of((select org from t_ac9)), (select fresh from t_ac9_apps), 'shortlisted'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|shortlisting', 'AC9: a new shortlisting is refused with CHARA_FEATURE_NOT_IN_PLAN'
);
select is(pg_temp.status_of((select fresh from t_ac9_apps)), 'applied', 'AC9: and the other application stays Applied');

-- AC8: bulk shortlisting on a plan without the feature, then with the row added and no deployment. Departure (D60): the
-- bulk function answers per item (FR-D2 AC9, D53), so the first call returns three refused items instead of raising.
create temp table t_ac8_apps as
  select pg_temp.seed_app('applied', (select starter from t_lack)) as a1, pg_temp.seed_app('applied', (select starter from t_lack)) as a2,
         pg_temp.seed_app('applied', (select starter from t_lack)) as a3;
create temp table t_ac8_first as
  select pg_temp.bulk_as(pg_temp.member_of((select starter from t_lack)), array[a1, a2, a3], 'shortlisted') as r from t_ac8_apps;
select is(
  (select jsonb_path_query_array(r, '$[*].error_code') from t_ac8_first),
  '["CHARA_FEATURE_NOT_IN_PLAN", "CHARA_FEATURE_NOT_IN_PLAN", "CHARA_FEATURE_NOT_IN_PLAN"]'::jsonb,
  'AC8: without the row all three items are refused with CHARA_FEATURE_NOT_IN_PLAN'
);
select is(
  (select jsonb_agg(pg_temp.snap(a)) from t_ac8_apps, unnest(array[a1, a2, a3]) a), '["applied/1/0", "applied/1/0", "applied/1/0"]'::jsonb,
  'AC8: and nothing changed: Applied, one event, no message each'
);
insert into billing.plan_features (plan_code, feature_key) values ('employer_starter', 'shortlisting');
create temp table t_ac8_second as
  select pg_temp.bulk_as(pg_temp.member_of((select starter from t_lack)), array[a1, a2, a3], 'shortlisted') as r from t_ac8_apps;
select is(
  (select jsonb_path_query_array(r, '$[*].ok') from t_ac8_second), '[true, true, true]'::jsonb,
  'AC8: after the row is added the repeated call shortlists all three'
);
select is(
  (select jsonb_agg(pg_temp.snap(a)) from t_ac8_apps, unnest(array[a1, a2, a3]) a), '["shortlisted/2/1", "shortlisted/2/1", "shortlisted/2/1"]'::jsonb,
  'AC8: each has Shortlisted, one more event and one message'
);

-- KPI of the SOP: shortlist usage by plan, the statement of docs/runbooks/shortlisting.md as written.
select is(
  (select jsonb_object_agg(plan, jsonb_build_array(moves, organizations)) from (
    with per_org as (
      select a.organization_id, count(*) as moves
      from public.application_events e
      join public.job_applications a on a.id = e.application_id
      where e.to_status = 'shortlisted' and e.created_at >= now() - interval '1 year'
      group by 1
    )
    select private.org_plan_code(organization_id) as plan, sum(moves) as moves, count(*) as organizations
    from per_org group by 1 order by 1
  ) k),
  '{"employer_enterprise": [3, 1], "employer_professional": [6, 1], "employer_starter": [6, 2], "free_employer": [1, 1]}'::jsonb,
  'KPI: the usage query counts the shortlisting moves and the organisations by plan'
);

select * from finish();
rollback;
