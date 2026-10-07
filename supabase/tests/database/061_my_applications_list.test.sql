begin;
select plan(27);

\ir status_fixture.inc

-- The one event of a seeded application and the application itself get the given times, with the append-only trigger off
-- for the one update.
create function pg_temp.set_times(p_app uuid, p_applied timestamptz, p_last timestamptz) returns uuid
language plpgsql as $$
begin
  update public.job_applications set created_at = p_applied where id = p_app;
  alter table public.application_events disable trigger application_events_append_only;
  update public.application_events set created_at = p_last where application_id = p_app;
  alter table public.application_events enable always trigger application_events_append_only;
  return p_app;
end;
$$;

-- my_applications as p_user with the named arguments p_args: the rows in order as jsonb, or the refusal as 'sqlstate|message|detail'.
create function pg_temp.mine_as(p_user uuid, p_args text default '', p_role text default 'authenticated') returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', 'aal1')::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(s) order by s.o), ''[]'') from (select m.*, row_number() over () as o from public.my_applications(%s) m) s', p_args)
      into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := to_jsonb(format('%s|%s|%s', v_state, v_message, coalesce(v_detail, '')));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

create function pg_temp.titles(p_rows jsonb) returns jsonb
language sql as $$ select coalesce(jsonb_agg(r ->> 'job_title' order by o), '[]') from jsonb_array_elements(p_rows) with ordinality as x(r, o) $$;

-- FR-D3 AC7: applications to vacancies that have left the public site. The latest events are 1, 2, 2, 5, 6 and 7 hours ago;
-- the second and third share a time, and the second is the newer application.
create temp table t_apps (n integer primary key, id uuid not null);
insert into t_apps
select n, pg_temp.set_times(
  pg_temp.seed_app('applied', p_job => pg_temp.seed_job(jsonb_build_object('title', 'Vacancy ' || n) || over)),
  now() - make_interval(days => n), now() - make_interval(hours => hrs)
)
from (values
  (1, 1, '{"status": "open"}'::jsonb), (2, 2, '{"status": "paused"}'), (3, 2, '{"status": "closed"}'),
  (4, 5, '{"status": "filled"}'), (5, 6, '{"status": "open", "moderation_state": "hidden"}'),
  (6, 7, '{"status": "open", "moderation_state": "org_suspended"}')
) v(n, hrs, over);
select pg_temp.seed_app('applied', p_worker => :'wb', p_job => pg_temp.seed_job('{"title": "Vacancy of B", "status": "open"}')) as of_b \gset

select is(
  (select array_agg(x.name order by x.ord)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as x(name, mode, ord)
   where p.oid = 'public.my_applications(public.application_status, integer, integer)'::regprocedure and x.mode = 't'),
  array['id', 'job_title', 'employer_display_name', 'job_status', 'moderation_state', 'status', 'applied_at', 'last_event_at'],
  'AC7: the return columns are the application, the title, the employer, both vacancy states, the stage and the two dates, and nothing else of the vacancy'
);
select is(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
   from pg_proc p where p.oid = 'public.my_applications(public.application_status, integer, integer)'::regprocedure),
  true, 'AC7: the function is security definer, stable and has an empty search path'
);
select is(
  pg_temp.titles(pg_temp.mine_as(:'wa')), '["Vacancy 1", "Vacancy 2", "Vacancy 3", "Vacancy 4", "Vacancy 5", "Vacancy 6"]'::jsonb,
  'AC7: all six stay in the list after the vacancies were paused, closed, filled, hidden and suspended, newest latest event first'
);
select is(
  (select jsonb_agg(r - 'id' - 'applied_at' - 'last_event_at' - 'employer_display_name' - 'o' order by o) from jsonb_array_elements(pg_temp.mine_as(:'wa')) with ordinality as x(r, o)),
  '[{"status": "applied", "job_title": "Vacancy 1", "job_status": "open", "moderation_state": "visible"},
    {"status": "applied", "job_title": "Vacancy 2", "job_status": "paused", "moderation_state": "visible"},
    {"status": "applied", "job_title": "Vacancy 3", "job_status": "closed", "moderation_state": "visible"},
    {"status": "applied", "job_title": "Vacancy 4", "job_status": "filled", "moderation_state": "visible"},
    {"status": "applied", "job_title": "Vacancy 5", "job_status": "open", "moderation_state": "hidden"},
    {"status": "applied", "job_title": "Vacancy 6", "job_status": "open", "moderation_state": "org_suspended"}]'::jsonb,
  'AC7: each row has the title, the vacancy status, the moderation state and the stage'
);
select is(
  (select r ->> 'employer_display_name' from jsonb_array_elements(pg_temp.mine_as(:'wa')) r limit 1),
  (select display_name from public.organizations where id = current_setting('t.a')::uuid), 'AC7: the employer is the display name of the organisation'
);
select is(
  (select (r ->> 'applied_at')::timestamptz = (select created_at from public.job_applications where id = (select id from t_apps where n = 1))
      and (r ->> 'last_event_at')::timestamptz = (select max(created_at) from public.application_events where application_id = (select id from t_apps where n = 1))
   from jsonb_array_elements(pg_temp.mine_as(:'wa')) r limit 1),
  true, 'AC7: the dates are the application date and the time of the latest event'
);
select is(pg_temp.titles(pg_temp.mine_as(:'wb')), '["Vacancy of B"]'::jsonb, 'AC7: another candidate gets only the own application, and nobody gets the one of B');

-- AC10: ordering by the latest event, equal times newer application first, even when a later event moves an older application up.
select is(
  (select (r ->> 'job_title') from jsonb_array_elements(pg_temp.mine_as(:'wa')) with ordinality as x(r, o) where o = 2), 'Vacancy 2',
  'AC10: of two applications whose latest events are equal, the newer application comes first'
);
select pg_temp.set_as(:'mem', (select id from t_apps where n = 6), 'interview') as moved \gset
select is(
  pg_temp.titles(pg_temp.mine_as(:'wa')) -> 0, '"Vacancy 6"'::jsonb,
  'AC10: a new event puts the oldest application on top'
);

-- FR-D3 AC2: the stage filter.
select pg_temp.force_status((select id from t_apps where n = 3), 'shortlisted');
select is(pg_temp.titles(pg_temp.mine_as(:'wa', 'p_stage => ''shortlisted''')), '["Vacancy 3"]'::jsonb, 'AC2: the filter returns only the application in that stage');
select is(pg_temp.titles(pg_temp.mine_as(:'wa', 'p_stage => ''interview''')), '["Vacancy 6"]'::jsonb, 'AC2: and in another stage');
select is(jsonb_array_length(pg_temp.mine_as(:'wa', 'p_stage => ''applied''')), 4, 'AC2: the other four are still applied');
select is(pg_temp.titles(pg_temp.mine_as(:'wa', 'p_stage => ''hired''')), '[]'::jsonb, 'AC2: a stage without applications gives an empty list');
select is(pg_temp.titles(pg_temp.mine_as(:'wa', 'p_stage => null')) = pg_temp.titles(pg_temp.mine_as(:'wa')), true, 'AC2: a null stage is every stage');
select is(pg_temp.mine_as(:'wa', 'p_stage => ''foo'''), to_jsonb('22P02|invalid input value for enum application_status: "foo"|'::text), 'AC2: a value that is not a stage is refused');

-- Access: only candidates, only their own rows.
select is(pg_temp.mine_as(:'own1'), to_jsonb('P0001|CHARA_FORBIDDEN|'::text), 'AC11: a company user is refused');
select is(pg_temp.mine_as(:'st_admin'), to_jsonb('P0001|CHARA_FORBIDDEN|'::text), 'AC11: a platform administrator is refused');
select is(pg_temp.mine_as(:'st_review'), to_jsonb('P0001|CHARA_FORBIDDEN|'::text), 'AC11: a verification reviewer is refused');
select is(pg_temp.mine_as(:'st_trust'), to_jsonb('P0001|CHARA_FORBIDDEN|'::text), 'AC11: a trust and safety administrator is refused');
select is(pg_temp.mine_as(null, '', 'anon'), to_jsonb('42501|permission denied for function my_applications|'::text), 'AC11: an anonymous caller has no EXECUTE');
select is(pg_temp.mine_as(:'wnew'), '[]'::jsonb, 'a candidate who has not applied gets an empty list');

-- AC10: pages of 20, 20 and 15 of 55 applications, the limit and the offset.
insert into t_apps
select 100 + n, pg_temp.set_times(pg_temp.seed_app('applied', p_worker => :'wnew'), now() - make_interval(days => 100), now() - make_interval(mins => n))
from generate_series(1, 55) n;
select is(
  (select array[jsonb_array_length(pg_temp.mine_as(:'wnew')), jsonb_array_length(pg_temp.mine_as(:'wnew', 'p_offset => 20')),
                jsonb_array_length(pg_temp.mine_as(:'wnew', 'p_offset => 40')), jsonb_array_length(pg_temp.mine_as(:'wnew', 'p_offset => 60'))]),
  array[20, 20, 15, 0], 'AC10: the default page has 20 rows, the pages after it 20 and 15, and one past the end none'
);
select is(
  (select count(distinct r ->> 'id') from (
     select jsonb_array_elements(pg_temp.mine_as(:'wnew', 'p_limit => 20, p_offset => 0')) r
     union all select jsonb_array_elements(pg_temp.mine_as(:'wnew', 'p_limit => 20, p_offset => 20'))
     union all select jsonb_array_elements(pg_temp.mine_as(:'wnew', 'p_limit => 20, p_offset => 40'))) t),
  55::bigint, 'AC10: the three pages hold all 55 applications once'
);
select is(
  (select (r ->> 'id')::uuid from jsonb_array_elements(pg_temp.mine_as(:'wnew', 'p_limit => 1, p_offset => 20')) r),
  (select id from t_apps where n = 121), 'AC10: the 21st row is the one whose latest event is 21 minutes old'
);
select is(jsonb_array_length(pg_temp.mine_as(:'wnew', 'p_limit => 500')), 50, 'a limit above the maximum is lowered to 50');
select is(jsonb_array_length(pg_temp.mine_as(:'wnew', 'p_limit => 0')), 1, 'a limit of 0 is raised to 1');
select is(pg_temp.mine_as(:'wnew', 'p_offset => -1'), to_jsonb('P0001|CHARA_INVALID_INPUT|p_offset'::text), 'a negative offset is refused');

select * from finish();
rollback;
