begin;
select plan(19);

\ir status_fixture.inc

-- Event times are set by the owner with the append-only trigger off for the one update, so that the order of the timeline
-- does not depend on the transaction time every event of this test would share.
create function pg_temp.event_at(p_app uuid, p_status text, p_at timestamptz) returns void
language plpgsql as $$
begin
  alter table public.application_events disable trigger application_events_append_only;
  update public.application_events set created_at = p_at where application_id = p_app and to_status = p_status::public.application_status;
  alter table public.application_events enable always trigger application_events_append_only;
end;
$$;

-- FR-D3: Applied (the candidate), Viewed (the system), Shortlisted with a note (a member of the employer), Withdrawn (the candidate).
create temp table t_app as select pg_temp.seed_app('applied') as id;
select pg_temp.viewed_as(:'mem', (select id from t_app)) as viewed \gset
select pg_temp.set_as(:'mem', (select id from t_app), 'shortlisted', 'We will call you next week') as shortlisted \gset
insert into public.application_events (application_id, from_status, to_status, actor_id, note)
select id, 'shortlisted', 'withdrawn', :'wa', null from t_app;
select pg_temp.event_at((select id from t_app), 'applied', now() - interval '4 days');
select pg_temp.event_at((select id from t_app), 'viewed', now() - interval '3 days');
select pg_temp.event_at((select id from t_app), 'shortlisted', now() - interval '1 day');
select pg_temp.event_at((select id from t_app), 'withdrawn', now() - interval '1 hour');
create temp table t_other as select pg_temp.seed_app('applied', p_worker => :'wb') as id;

select columns_are(
  'public', 'v_my_application_timeline', array['application_id', 'created_at', 'from_status', 'to_status', 'note', 'actor_role'],
  'AC4: the view has the application, the time, both stages, the note and the actor role, and no actor id or other user id'
);
select is(
  (select c.reloptions from pg_class c where c.oid = 'public.v_my_application_timeline'::regclass), array['security_invoker=true'],
  'AC4: the view is security_invoker'
);
select is(
  pg_temp.json_as(:'wa', format('select to_status, actor_role, note from public.v_my_application_timeline where application_id = %L order by created_at', (select id from t_app))),
  '[{"note": null, "to_status": "applied", "actor_role": "you"},
    {"note": null, "to_status": "viewed", "actor_role": "system"},
    {"note": "We will call you next week", "to_status": "shortlisted", "actor_role": "employer"},
    {"note": null, "to_status": "withdrawn", "actor_role": "you"}]'::jsonb,
  'AC4: the candidate reads the four events oldest first, told as you, system, employer and you, with the note of the stage change'
);
select is(
  pg_temp.json_as(:'wa', format('select from_status from public.v_my_application_timeline where application_id = %L order by created_at', (select id from t_app))),
  '[{"from_status": null}, {"from_status": "applied"}, {"from_status": "viewed"}, {"from_status": "shortlisted"}]'::jsonb,
  'AC4: each row carries the stage it came from'
);
select is(
  pg_temp.json_as(:'wa', format('select count(*) as n from public.v_my_application_timeline where application_id = %L', (select id from t_other))),
  '[{"n": 0}]'::jsonb, 'AC4: the view returns no event of another candidate''s application, with a filter on its id'
);
select is(
  pg_temp.json_as(:'wb', 'select count(*) as n from public.v_my_application_timeline'), '[{"n": 1}]'::jsonb,
  'AC4: and without a filter the other candidate reads only the own event'
);
select is(
  pg_temp.json_as(:'wa', 'select actor_id from public.v_my_application_timeline'), to_jsonb('42703|column "actor_id" does not exist|'::text),
  'AC4: no actor id can be selected from the view'
);
select is(
  pg_temp.json_as(:'wa', 'select actor_id from public.application_events'), to_jsonb('42501|permission denied for table application_events|'::text),
  'AC4: nor from the table, whose column grant leaves it out'
);
select is(
  (select pg_temp.json_as(:'wa', 'select * from public.v_my_application_timeline')::text ~ (:'mem' || '|' || :'own1' || '|' || :'adm')),
  false, 'AC6: no user id of the employer members occurs in what the candidate reads from the view'
);
select is(
  pg_temp.json_as(:'wa', 'select count(*) as n from public.v_my_application_timeline'), '[{"n": 4}]'::jsonb,
  'AC4: the candidate reads the four events of the own application and nothing else'
);

select is(
  pg_temp.val_as(:'wb', 'aal1', format('select private.application_event_actor_role(%s)', (select min(id) from public.application_events where application_id = (select id from t_app)))),
  null, 'AC4: the helper tells nothing about an event of another candidate''s application'
);
select is(
  has_function_privilege('anon', 'private.application_event_actor_role(bigint)', 'execute'), false, 'AC4: the helper is not open to anonymous callers'
);

select is(pg_temp.call_as(null, 'anon', 'select 1 from public.v_my_application_timeline') ~ '^42501\|permission denied for view', true, 'AC4: an anonymous caller is refused by the missing grant');
select is(pg_temp.json_as(:'mem', 'select count(*) as n from public.v_my_application_timeline'), '[{"n": 0}]'::jsonb, 'AC4: a member of the employer reads no row');
select is(pg_temp.json_as(:'own1', 'select count(*) as n from public.v_my_application_timeline'), '[{"n": 0}]'::jsonb, 'AC4: an owner of the employer reads no row');
select is(pg_temp.json_as(:'st_admin', 'select count(*) as n from public.v_my_application_timeline'), '[{"n": 0}]'::jsonb, 'AC4: a platform administrator reads no row');
select is(pg_temp.json_as(:'st_review', 'select count(*) as n from public.v_my_application_timeline'), '[{"n": 0}]'::jsonb, 'AC4: a verification reviewer reads no row');
select is(pg_temp.json_as(:'st_trust', 'select count(*) as n from public.v_my_application_timeline'), '[{"n": 0}]'::jsonb, 'AC4: a trust and safety administrator reads no row');

-- FR-D3 AC5: the decline reason is a stage-change note and reaches the candidate; internal notes live in application_notes,
-- a table of FR-E2 (U33) that does not exist yet, so the check that the candidate cannot read it is made there.
create temp table t_declined as select pg_temp.seed_app('applied') as id;
select pg_temp.set_as(:'mem', (select id from t_declined), 'rejected', 'Position filled') as declined \gset
select is(
  pg_temp.json_as(:'wa', format('select to_status, note from public.v_my_application_timeline where application_id = %L order by created_at, to_status', (select id from t_declined))),
  '[{"note": null, "to_status": "applied"}, {"note": "Position filled", "to_status": "rejected"}]'::jsonb,
  'AC5: the timeline returns the note of the stage change'
);

select * from finish();
rollback;
