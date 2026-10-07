begin;
select plan(45);

\ir status_fixture.inc

-- FR-D5: who reads job_applications and application_events. n_as counts the rows a query returns for a caller; refused is
-- the refusal text of a query for a role without a grant.
create function pg_temp.n_as(p_user uuid, p_sql text, p_aal text default 'aal1') returns text
language sql as $$ select pg_temp.val_as(p_user, p_aal, 'select count(*) from (' || p_sql || ') q') $$;

create function pg_temp.ids_of(p_apps uuid[]) returns text
language sql as $$ select 'id = any (' || quote_literal(p_apps::text) || '::uuid[])' $$;

create function pg_temp.owner_of(p_org uuid) returns uuid
language sql as $$ select user_id from public.organization_members where organization_id = p_org and role = 'owner' $$;

-- AC1: candidates wa (3 applications) and wb (2) to a third organisation.
create temp table t_c as select pg_temp.org_on() as org;
create temp table t_wa as select pg_temp.seed_app('applied', (select org from t_c), :'wa') as id from generate_series(1, 3);
create temp table t_wb as select pg_temp.seed_app('applied', (select org from t_c), :'wb') as id from generate_series(1, 2);
select array_agg(id) as wa_ids from t_wa \gset
select array_agg(id) as wb_ids from t_wb \gset

select is(pg_temp.n_as(:'wa', 'select 1 from public.job_applications'), '3', 'AC1: candidate A reads the own three applications');
select is(pg_temp.n_as(:'wa', 'select 1 from public.application_events'), '3', 'AC1: and their three events');
select is(pg_temp.n_as(:'wa', 'select 1 from public.v_my_application_timeline'), '3', 'AC1: and three rows of the timeline');
select is(
  pg_temp.n_as(:'wa', 'select 1 from public.job_applications where ' || pg_temp.ids_of(:'wb_ids')) || pg_temp.n_as(:'wa', 'select 1 from public.application_events where application_id = any (' || quote_literal(:'wb_ids') || '::uuid[])')
    || pg_temp.n_as(:'wa', 'select 1 from public.v_my_application_timeline where application_id = any (' || quote_literal(:'wb_ids') || '::uuid[])'),
  '000', 'AC1: a filter on the ids of candidate B returns no row of the applications, the events or the timeline'
);
select is(pg_temp.n_as(:'wb', 'select 1 from public.job_applications'), '2', 'AC1: candidate B reads the own two applications');
select is(
  pg_temp.call_as(null, 'anon', 'select 1 from public.job_applications') || '/' || pg_temp.call_as(null, 'anon', 'select 1 from public.application_events')
    || '/' || pg_temp.call_as(null, 'anon', 'select 1 from public.application_notes'),
  '42501|permission denied for table job_applications|/42501|permission denied for table application_events|/42501|permission denied for table application_notes|',
  'AC1: an anonymous session is denied by the missing grants'
);
select is(
  pg_temp.call_as(null, 'service_role', 'select 1 from public.job_applications') || '/' || pg_temp.call_as(null, 'service_role', 'select 1 from public.application_events')
    || '/' || pg_temp.call_as(null, 'service_role', 'select 1 from public.application_notes'),
  '42501|permission denied for table job_applications|/42501|permission denied for table application_events|/42501|permission denied for table application_notes|',
  'AC1: service_role is denied by the missing grants'
);
select is(pg_temp.n_as(:'st_admin', 'select 1 from public.job_applications', 'aal2') || pg_temp.n_as(:'st_admin', 'select 1 from public.application_events', 'aal2') || pg_temp.n_as(:'st_admin', 'select 1 from public.application_notes', 'aal2'), '000', 'AC1: a platform administrator at aal2 reads no row');
select is(pg_temp.n_as(:'st_trust', 'select 1 from public.job_applications', 'aal2') || pg_temp.n_as(:'st_trust', 'select 1 from public.application_events', 'aal2') || pg_temp.n_as(:'st_trust', 'select 1 from public.application_notes', 'aal2'), '000', 'AC1: trust and safety at aal2 reads no row');
select is(pg_temp.n_as(:'st_review', 'select 1 from public.job_applications', 'aal2') || pg_temp.n_as(:'st_review', 'select 1 from public.application_events', 'aal2') || pg_temp.n_as(:'st_review', 'select 1 from public.application_notes', 'aal2'), '000', 'AC1: a verification reviewer at aal2 reads no row');
select is(pg_temp.n_as(:'own1', 'select 1 from public.job_applications') || pg_temp.n_as(:'own2', 'select 1 from public.job_applications'), '00', 'AC1: the owners of two other organisations read none of them');
select is(pg_temp.n_as(pg_temp.owner_of((select org from t_c)), 'select 1 from public.job_applications'), '5', 'AC1: the owner of the organisation they were made to reads all five');

-- AC3: Acme has six applications, one to a vacancy in each state; Beta two. Another candidate (wnew) made them.
create temp table t_b as select pg_temp.org_on() as org;
create temp table t_acme as
  select s.ord, pg_temp.seed_app('applied', current_setting('t.a')::uuid, :'wnew', pg_temp.seed_job(s.over::jsonb)) as id
  from (values
    (1, '{"title": "Open welder", "status": "open"}'),
    (2, '{"title": "Paused welder", "status": "paused"}'),
    (3, '{"title": "Closed welder", "status": "closed"}'),
    (4, '{"title": "Filled welder", "status": "filled"}'),
    (5, '{"title": "Hidden welder", "status": "open", "moderation_state": "hidden"}'),
    (6, '{"title": "Suspended welder", "status": "open", "moderation_state": "org_suspended"}')) s (ord, over);
create temp table t_beta as select pg_temp.seed_app('applied', (select org from t_b), :'wnew') as id from generate_series(1, 2);
select array_agg(id) as beta_ids from t_beta \gset
select array_agg(id) as acme_ids from t_acme \gset

select is(pg_temp.n_as(:'own1', 'select 1 from public.job_applications'), '6', 'AC3: the owner of Acme reads the six applications, whatever the state of the vacancy');
select is(pg_temp.n_as(:'adm', 'select 1 from public.job_applications'), '6', 'AC3: an admin reads the six');
select is(pg_temp.n_as(:'mem', 'select 1 from public.job_applications'), '6', 'AC3: a member reads the six');
select is(pg_temp.n_as(:'own1', 'select 1 from public.application_events'), '6', 'AC3: the owner reads their six events');
select is(pg_temp.n_as(:'adm', 'select 1 from public.application_events'), '6', 'AC3: an admin reads their six events');
select is(pg_temp.n_as(:'mem', 'select 1 from public.application_events'), '6', 'AC3: a member reads their six events');
select is(
  pg_temp.n_as(:'mem', 'select 1 from public.job_applications where ' || pg_temp.ids_of(:'beta_ids')) || pg_temp.n_as(:'mem', 'select 1 from public.application_events where application_id = any (' || quote_literal(:'beta_ids') || '::uuid[])'),
  '00', 'AC3: and none of Beta''s, with a filter on their ids'
);
select is(pg_temp.n_as(:'own2', 'select 1 from public.job_applications') || pg_temp.n_as(:'adm2', 'select 1 from public.application_events'), '00', 'AC3: Beta''s owner and admin, who have no application, read none of Acme''s');
select is(pg_temp.n_as(pg_temp.owner_of((select org from t_b)), 'select 1 from public.job_applications'), '2', 'AC3: the owner of the other organisation reads its two');
select is(pg_temp.n_as(pg_temp.member_of((select org from t_b)), 'select 1 from public.job_applications where ' || pg_temp.ids_of(:'acme_ids')), '0', 'AC3: and none of Acme''s');
select is(pg_temp.n_as(pg_temp.member_of((select org from t_b)), 'select 1 from public.application_events'), '2', 'AC3: its member reads only its two events');
select is(pg_temp.n_as(:'wnew', 'select 1 from public.job_applications'), '8', 'AC3: the candidate who applied to both reads all eight of their own');

-- The candidate's timeline stays the candidate's: a member of the organisation reads nothing from it.
select is(pg_temp.n_as(:'mem', 'select 1 from public.v_my_application_timeline'), '0', 'AC1: a member reads no row of the candidate''s timeline');

-- Only the columns the grant names are readable by a member too: the actor of an event is not.
select is(pg_temp.state_as(:'mem', 'select actor_id from public.application_events'), '42501', 'a member cannot select the actor of an event');

-- AC4: a removed member and a pending invitation.
create temp table t_removed as select pg_temp.member_of((select org from t_b)) as u;
select is(pg_temp.n_as((select u from t_removed), 'select 1 from public.job_applications'), '2', 'AC4: the member sees the applications before the removal');
select is(
  pg_temp.call_as(pg_temp.owner_of((select org from t_b)), 'authenticated', format($$select public.remove_member(%L, %L)$$, (select org from t_b), (select u from t_removed))),
  'ok', 'AC4: the owner removes the member'
);
select is(pg_temp.n_as((select u from t_removed), 'select 1 from public.job_applications'), '0', 'AC4: the removed member''s next query returns no application');
select is(pg_temp.n_as((select u from t_removed), 'select 1 from public.application_events'), '0', 'AC4: and no event');
select is(pg_temp.n_as(:'pending', 'select 1 from public.job_applications') || pg_temp.n_as(:'pending', 'select 1 from public.application_events'), '00', 'AC4: a user whose invitation is pending reads no application and no event');
select is(pg_temp.n_as(:'pending', 'select 1 from public.application_notes'), '0', 'AC4: nor a note');

-- AC9: past applicants of a lapsed organisation stay readable; changes are refused.
create temp table t_lapsed as select pg_temp.org_on('employer_starter', 'canceled') as org;
create temp table t_four as select pg_temp.seed_app('applied', (select org from t_lapsed), :'wnew') as id from generate_series(1, 4);
select is(pg_temp.n_as(pg_temp.member_of((select org from t_lapsed)), 'select 1 from public.job_applications'), '4', 'AC9: a member of the lapsed organisation reads all four applications');
select is(pg_temp.n_as(pg_temp.member_of((select org from t_lapsed)), 'select 1 from public.application_events'), '4', 'AC9: and their four events');
select is(
  pg_temp.set_as(pg_temp.member_of((select org from t_lapsed)), (select min(id::text)::uuid from t_four), 'interview'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC9: a status change is refused with the plan detail'
);
select is(pg_temp.status_of((select min(id::text)::uuid from t_four)), 'applied', 'AC9: the status is unchanged');
select is(pg_temp.n_as(pg_temp.member_of((select org from t_lapsed)), 'select 1 from public.job_applications'), '4', 'AC9: the lapsed organisation still reads the four');

-- AC11: a suspended organisation is refused in the database: its members read no application, event or note, and the two
-- reads of the applicant page return no row; its candidates keep their rows.
create temp table t_susp as select pg_temp.org_on() as org;
create temp table t_susp_app as select pg_temp.seed_app('applied', (select org from t_susp), :'wnew') as id;
insert into public.application_notes (application_id, organization_id, author_id, body)
values ((select id from t_susp_app), (select org from t_susp), pg_temp.owner_of((select org from t_susp)), 'Internal');
select is(
  pg_temp.n_as(pg_temp.member_of((select org from t_susp)), 'select 1 from public.job_applications') || pg_temp.n_as(pg_temp.member_of((select org from t_susp)), 'select 1 from public.application_events')
    || pg_temp.n_as(pg_temp.member_of((select org from t_susp)), 'select 1 from public.application_notes'),
  '111', 'AC11: a member of the organisation reads its application, event and note while it is active'
);
update public.organizations set status = 'suspended' where id = (select org from t_susp);
select is(
  pg_temp.n_as(pg_temp.member_of((select org from t_susp)), 'select 1 from public.job_applications') || pg_temp.n_as(pg_temp.member_of((select org from t_susp)), 'select 1 from public.application_events')
    || pg_temp.n_as(pg_temp.member_of((select org from t_susp)), 'select 1 from public.application_notes'),
  '000', 'AC11: once it is suspended its member reads none of them'
);
select is(
  pg_temp.n_as(pg_temp.owner_of((select org from t_susp)), 'select 1 from public.job_applications') || pg_temp.n_as(pg_temp.owner_of((select org from t_susp)), 'select 1 from public.application_notes'),
  '00', 'AC11: nor does its owner'
);
select is(
  pg_temp.json_as(pg_temp.member_of((select org from t_susp)), format('select * from public.get_applicant(%L)', (select id from t_susp_app)))
    || pg_temp.json_as(pg_temp.member_of((select org from t_susp)), format('select * from public.list_applicant_events(%L)', (select id from t_susp_app))),
  '[]'::jsonb || '[]'::jsonb, 'AC11: get_applicant and list_applicant_events return no row for it'
);
select is(pg_temp.n_as(:'wnew', 'select 1 from public.job_applications where id = ' || quote_literal((select id from t_susp_app))), '1', 'AC11: the candidate of a suspended organisation''s vacancy still reads the own application');

-- No direct write by any API role, including the database function owner rights an RPC runs with.
select is(
  pg_temp.state_as(:'own1', 'delete from public.job_applications') || pg_temp.state_as(:'own1', 'delete from public.application_events'),
  '4250142501', 'an owner cannot delete an application or an event'
);

select is((select count(*) from public.job_applications), 18::bigint, 'the test wrote the 18 applications it counted');
select is((select count(*) from public.application_events), 18::bigint, 'and 18 events, none from the refused calls');

select * from finish();
rollback;
