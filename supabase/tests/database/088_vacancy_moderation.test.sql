begin;
select plan(111);

-- FR-C7: moderate_job, admin_search_jobs and admin_get_job. The Trust & Safety Administrator is st_trust; Acme (t.a) has
-- the owner own1, the admin adm, the member mem and the invited-but-not-accepted member pending.
\ir status_fixture.inc

\set gone_trust '00000000-0000-0000-0000-00000000b801'
\set adm_b '00000000-0000-0000-0000-00000000b802'
\set mem_b '00000000-0000-0000-0000-00000000b803'
\set reason40 'The vacancy asks for a fee before hiring.'
\set reason30 'The employer has corrected it.'
\set reason10 'ten chars!'
\set request '7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11'

select pg_temp.new_user(:'gone_trust');
select pg_temp.new_user(:'adm_b');
select pg_temp.new_user(:'mem_b');
update public.profiles set account_kind = intended_account_kind where id in (:'gone_trust', :'adm_b', :'mem_b');
insert into public.platform_staff (user_id, role, revoked_at) values (:'gone_trust', 'trust_safety', now());
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  (current_setting('t.a')::uuid, :'adm_b', 'admin', now()),
  (current_setting('t.a')::uuid, :'mem_b', 'member', now());
insert into public.notification_preferences (user_id, digest) values (:'adm', true);
select set_config('request.headers', json_build_object('x-request-id', :'request')::text, true);

create function pg_temp.moderate_as(p_user uuid, p_job uuid, p_action text, p_reason text, p_aal text default 'aal2', p_role text default 'authenticated') returns text
language sql as $$
  select pg_temp.call_as(p_user, p_role, format('select public.moderate_job(%L, %L, %L)', p_job, p_action, p_reason), p_aal)
$$;

-- The first column of the first row of a query, read as p_role for p_user (null for anonymous), or the refusal.
create function pg_temp.scalar_as(p_role text, p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', p_aal)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- The rows of a query as one jsonb array, read as p_user at aal2 (a refusal is the text 'sqlstate|message|detail').
create function pg_temp.rows_as(p_user uuid, p_sql text, p_aal text default 'aal2') returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  set local role authenticated;
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(s)), ''[]'') from (%s) s', p_sql) into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := to_jsonb(format('%s|%s|%s', v_state, v_message, coalesce(v_detail, '')));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

create function pg_temp.state_of(p_job uuid) returns text
language sql as $$ select moderation_state::text || ':' || status::text from public.jobs where id = p_job $$;

-- Everything a moderation writes, as one text, to compare before and after a refused call.
create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.moderation_actions) || ',' || (select count(*) from audit.log) || ','
      || (select count(*) from pgmq.q_notifications) || ',' || (select count(*) from public.notifications) || ','
      || (select string_agg(id || ':' || moderation_state || ':' || status || ':' || coalesce(deleted_at::text, '-'), ',' order by id) from public.jobs)
$$;

create function pg_temp.queued(p_job uuid) returns bigint
language sql as $$ select count(*) from public.notifications where kind = 'vacancy_hidden' and payload ->> 'job_id' = p_job::text $$;

select pg_temp.open_job('Welder visible') as v1 \gset
select pg_temp.open_job('Welder second') as v2 \gset
select pg_temp.open_job('Welder paused', null, '{"status": "paused", "moderation_state": "hidden"}') as v3 \gset
select pg_temp.open_job('Welder deleted', null, jsonb_build_object('deleted_at', now())) as v_gone \gset
select pg_temp.open_job('Welder hidden', null, '{"moderation_state": "hidden"}') as v_hidden \gset
select pg_temp.open_job('Welder of Beta', current_setting('t.b')::uuid) as vb \gset
select gen_random_uuid() as v_none \gset

-- AC1: hide
select pg_temp.writes() as before_hide \gset
select is(pg_temp.moderate_as(:'st_trust', :'v1', 'hide', :'reason40'), 'ok', 'AC1: the Trust & Safety Administrator at aal2 hides an open vacancy');
select is(pg_temp.state_of(:'v1'), 'hidden:open', 'AC1: moderation_state is hidden and the status stays open');
select is(
  (select format('%s|%s|%s|%s|%s', count(*), min(target_type), min(action), min(statement_of_reasons), min(actor_id::text))
   from public.moderation_actions where target_id = :'v1'),
  format('1|job|job_hidden|%s|%s', :'reason40', :'st_trust'), 'AC1: one moderation_actions row of the type job with the reasons as given and the caller as actor'
);
select is(
  (select format('%s|%s|%s|%s|%s', count(*), min(actor_id::text), min(entity_type), min(metadata ->> 'reason'), min(metadata ->> 'request_id'))
   from audit.log where action = 'job.hide' and entity_id = :'v1'),
  format('1|%s|job|%s|%s', :'st_trust', :'reason40', :'request'), 'AC1: one audit row job.hide with the actor, the reason and the request id'
);
select is(
  (select count(*) from audit.log where entity_id = :'v1' and action not in ('job.created', 'job.hide')), 0::bigint,
  'AC1: no job.updated row for the change of moderation_state'
);

-- AC2: the statement of reasons is mandatory
create temp table bad_reasons (label text, reason text);
insert into bad_reasons values
  ('null', null), ('empty', ''), ('6 spaces', '      '), ('9 characters', 'too short'), ('2001 characters', repeat('x', 2001));
select pg_temp.writes() as before_reasons \gset
select is(
  pg_temp.moderate_as(:'st_trust', :'v2', 'hide', r.reason), 'P0001|CHARA_INVALID_INPUT|reason', 'AC2: hide with a reason of ' || r.label || ' is refused'
) from bad_reasons r;
select is(
  pg_temp.moderate_as(:'st_trust', :'v1', 'unhide', r.reason), 'P0001|CHARA_INVALID_INPUT|reason', 'AC2: unhide with a reason of ' || r.label || ' is refused'
) from bad_reasons r;
select is(pg_temp.writes(), :'before_reasons', 'AC2: a refused reason changes no state, writes no moderation or audit row and queues no notification');
select is(pg_temp.moderate_as(:'st_trust', :'v2', 'hide', '  ' || :'reason10' || '  '), 'ok', 'AC2: exactly 10 characters after trimming are accepted');
select is(
  (select statement_of_reasons from public.moderation_actions where target_id = :'v2'), :'reason10', 'AC2: and are stored trimmed'
);
select is(pg_temp.moderate_as(:'st_trust', :'v2', 'unhide', repeat('y', 2000)), 'ok', 'AC2: exactly 2000 characters are accepted');
select is(
  pg_temp.moderate_as(:'st_trust', :'v2', 'delete', :'reason40'), 'P0001|CHARA_INVALID_INPUT|action', 'AC2: an action other than hide and unhide is refused'
);
select is(pg_temp.moderate_as(:'st_trust', null, 'hide', :'reason40'), 'P0001|CHARA_INVALID_INPUT|job', 'AC2: and so is a null vacancy');

-- AC3: only trust_safety at aal2
select pg_temp.writes() as before_refusals \gset
select is(pg_temp.moderate_as(:'st_admin', :'v_hidden', 'unhide', :'reason40'), 'P0001|CHARA_FORBIDDEN|', 'AC3: a Platform Administrator is refused');
select is(pg_temp.moderate_as(:'st_review', :'v2', 'hide', :'reason40'), 'P0001|CHARA_FORBIDDEN|', 'AC3: a Verification Reviewer is refused');
select is(pg_temp.moderate_as(:'own1', :'v2', 'hide', :'reason40'), 'P0001|CHARA_FORBIDDEN|', 'AC3: the owner of Acme is refused');
select is(pg_temp.moderate_as(:'wa', :'v2', 'hide', :'reason40'), 'P0001|CHARA_FORBIDDEN|', 'AC3: a candidate is refused');
select is(pg_temp.moderate_as(:'st_trust', :'v2', 'hide', :'reason40', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'AC3: trust_safety at aal1 is refused');
select is(pg_temp.moderate_as(:'gone_trust', :'v2', 'hide', :'reason40'), 'P0001|CHARA_FORBIDDEN|', 'AC3: trust_safety with a revoked role is refused');
select is(
  pg_temp.moderate_as(null, :'v2', 'hide', :'reason40', 'aal2', 'anon'), '42501|permission denied for function moderate_job|',
  'AC3: an anonymous caller lacks EXECUTE'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$update public.jobs set moderation_state = 'visible' where id = %L$$, :'v_hidden')),
  '42501|permission denied for table jobs|', 'AC3: the owner cannot set moderation_state directly, the column is not in the grant'
);
select is(pg_temp.moderate_as(:'st_trust', :'v_none', 'hide', :'reason40'), 'P0002|CHARA_NOT_FOUND|', 'AC3: a vacancy that does not exist is not found');
select is(pg_temp.moderate_as(:'st_trust', :'v_gone', 'hide', :'reason40'), 'P0002|CHARA_NOT_FOUND|', 'AC3: nor is a soft-deleted one');
select is(pg_temp.writes(), :'before_refusals', 'AC3: no refused call changed a vacancy or wrote a row');

-- AC4: a hidden vacancy leaves the public and takes no new application
select pg_temp.seed_app('applied', null, :'wa', :'v1') as app_move \gset
select pg_temp.seed_app('applied', null, :'wb', :'v1') as app_withdraw \gset
insert into public.saved_jobs (worker_user_id, job_id) values (:'wa', :'v1');
select is(pg_temp.scalar_as('anon', null, format('select count(*) from public.jobs where id = %L', :'v1')), '0', 'AC4: an anonymous table read does not return the hidden vacancy');
select is(pg_temp.search_ids('anon', null, $$p_q => 'welder'$$) ~ :'v1', false, 'AC4: and neither does the search');
select is(
  pg_temp.scalar_as('anon', null, format('select count(*) from public.get_public_job(%L)', :'v1')), '0', 'AC4: nor the vacancy page'
);
select is(pg_temp.apply_as(:'wnew', :'v1'), 'P0001|CHARA_JOB_NOT_OPEN|', 'AC4: a second candidate cannot apply');
select is(pg_temp.set_as(:'own1', :'app_move', 'interview'), 'ok', 'AC4: the employer still moves the existing application');
select is(pg_temp.status_of(:'app_move'), 'interview', 'AC4: and it is in the interview stage');
select is(
  pg_temp.call_as(:'wb', 'authenticated', format('select public.withdraw_application(%L)', :'app_withdraw'), 'aal1'), 'ok',
  'AC4: the other candidate still withdraws'
);
select is(pg_temp.status_of(:'app_withdraw'), 'withdrawn', 'AC4: and the application is withdrawn');
select is(
  pg_temp.scalar_as('authenticated', :'mem', format('select count(*) from public.jobs where id = %L', :'v1')), '1',
  'AC4: a member of Acme still reads the vacancy'
);
select is(
  pg_temp.scalar_as('authenticated', :'wa', 'select available::text || coalesce(title, ''-'') from public.list_saved_jobs()', 'aal1'), 'false-',
  'AC4: the saved list of the candidate shows it as unavailable, with no title'
);

-- AC5: unhide
select pg_temp.writes() as before_unhide \gset
select is(pg_temp.moderate_as(:'st_trust', :'v1', 'unhide', :'reason30'), 'ok', 'AC5: the open hidden vacancy is unhidden');
select is(pg_temp.moderate_as(:'st_trust', :'v3', 'unhide', :'reason30'), 'ok', 'AC5: so is the paused one');
select is(pg_temp.state_of(:'v1'), 'visible:open', 'AC5: the open vacancy is visible');
select is(pg_temp.state_of(:'v3'), 'visible:paused', 'AC5: the paused vacancy is visible and keeps its status');
select is(pg_temp.search_ids('anon', null, $$p_q => 'welder visible'$$) ~ :'v1', true, 'AC5: the open vacancy is public again');
select is(pg_temp.search_ids('anon', null, $$p_q => 'welder paused'$$) ~ :'v3', false, 'AC5: the paused one is not public');
select is(
  (select count(*) from public.moderation_actions where target_id in (:'v1', :'v3') and action = 'job_unhidden' and statement_of_reasons = :'reason30'),
  2::bigint, 'AC5: one moderation row (job_unhidden) per call'
);
select is(
  (select count(*) from audit.log where action = 'job.unhide' and entity_id in (:'v1', :'v3') and metadata ->> 'reason' = :'reason30'),
  2::bigint, 'AC5: and one audit row job.unhide per call'
);
select pg_temp.writes() as after_unhide \gset
select is(pg_temp.moderate_as(:'st_trust', :'v1', 'unhide', :'reason30'), 'P0001|CHARA_INVALID_STATE|visible', 'AC5: a second unhide of the first is refused');
select is(pg_temp.writes(), :'after_unhide', 'AC5: and writes nothing');
select is(pg_temp.moderate_as(:'st_trust', :'v1', 'hide', :'reason40'), 'ok', 'a visible vacancy is hidden again');
select is(pg_temp.moderate_as(:'st_trust', :'v1', 'hide', :'reason40'), 'P0001|CHARA_INVALID_STATE|hidden', 'and a hidden one is not hidden twice');

-- AC6: one mandatory notification for each owner and administrator
select pg_temp.open_job('Welder notified') as vn \gset
select count(*) as notified_before from public.notifications \gset
select is(pg_temp.moderate_as(:'st_trust', :'vn', 'hide', :'reason40'), 'ok', 'AC6: the first hide');
select is(pg_temp.queued(:'vn'), 3::bigint, 'AC6: queues 3 notifications of kind vacancy_hidden');
select is(
  (select string_agg(user_id::text, ',' order by user_id) from public.notifications where kind = 'vacancy_hidden' and payload ->> 'job_id' = :'vn'),
  (select string_agg(u, ',' order by u) from (values (:'own1'), (:'adm'), (:'adm_b')) v (u)),
  'AC6: for the owner and the 2 admins, none for the members, the pending invitation or candidates'
);
select is(
  (select count(*) from public.notifications where kind = 'vacancy_hidden' and payload ->> 'job_id' = :'vn' and status = 'queued'
     and payload ->> 'job_title' = 'Welder notified' and payload ->> 'reasons' = :'reason40'),
  3::bigint, 'AC6: they are queued and carry the vacancy id, the title and the reasons'
);
select is(
  (select count(*) from public.notifications where kind = 'vacancy_hidden' and payload ->> 'job_id' = :'vn' and payload::text ~ 'Okafor|Amina|applicant|@'),
  0::bigint, 'AC6: and no applicant data or address'
);
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'job_id' = :'vn' and (message ->> 'mandatory')::boolean),
  3::bigint, 'AC6: every message is mandatory, so the digest preference of an administrator does not hold it back'
);
select is(pg_temp.moderate_as(:'st_trust', :'vn', 'unhide', :'reason30'), 'ok', 'AC6: the unhide');
select is(pg_temp.queued(:'vn'), 3::bigint, 'AC6: queues none');
select is(pg_temp.moderate_as(:'st_trust', :'vn', 'hide', :'reason40'), 'ok', 'AC6: the second hide');
select is(pg_temp.queued(:'vn'), 6::bigint, 'AC6: queues 3 more, 6 in total');
select is(pg_temp.moderate_as(:'st_trust', :'vn', 'hide', :'reason40'), 'P0001|CHARA_INVALID_STATE|hidden', 'AC6: the third hide in a row is refused');
select is(pg_temp.queued(:'vn'), 6::bigint, 'AC6: and the total stays 6');

-- AC8: the suspension of an organisation
select pg_temp.org_on() as org \gset
select pg_temp.seed_job('{"title": "Suspend one", "status": "open"}', :'org') as s1 \gset
select pg_temp.seed_job('{"title": "Suspend two", "status": "open"}', :'org') as s2 \gset
select pg_temp.seed_job('{"title": "Suspend hidden", "status": "open", "moderation_state": "hidden"}', :'org') as s3 \gset
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', format($$select public.suspend_organization(%L, 'The company details are false.')$$, :'org')), 'ok',
  'AC8: the organisation is suspended'
);
select is(
  (select string_agg(moderation_state::text, ',' order by title) from public.jobs where organization_id = :'org'),
  'hidden,org_suspended,org_suspended', 'AC8: the two visible vacancies are org_suspended and the hidden one stays hidden'
);
select is(pg_temp.moderate_as(:'st_trust', :'s1', 'hide', :'reason40'), 'P0001|CHARA_INVALID_STATE|org_suspended', 'AC8: moderate_job on an org_suspended vacancy is refused');
select is(pg_temp.moderate_as(:'st_trust', :'s1', 'unhide', :'reason40'), 'P0001|CHARA_INVALID_STATE|org_suspended', 'AC8: so is an unhide of it');
select is(pg_temp.moderate_as(:'st_trust', :'s3', 'unhide', :'reason30'), 'ok', 'AC8: the hidden vacancy of the suspended organisation is unhidden');
select is(pg_temp.state_of(:'s3'), 'org_suspended:open', 'AC8: and stays out of the public with the suspension, not visible');
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', format($$select public.reinstate_organization(%L, 'Documents checked, genuine.')$$, :'org')), 'ok',
  'AC8: the organisation is reinstated'
);
select is(
  (select string_agg(moderation_state::text, ',' order by title) from public.jobs where organization_id = :'org'),
  'visible,visible,visible', 'AC8: the three vacancies are visible again'
);
select pg_temp.seed_job('{"title": "Hidden twice", "status": "open", "moderation_state": "hidden"}', :'org') as s4 \gset
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', format($$select public.suspend_organization(%L, 'The company details are false.')$$, :'org')), 'ok',
  'AC8: a second suspension'
);
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', format($$select public.reinstate_organization(%L, 'Documents checked, genuine.')$$, :'org')), 'ok',
  'AC8: and reinstatement'
);
select is(pg_temp.state_of(:'s4'), 'hidden:open', 'AC8: a vacancy hidden by moderation stays hidden through both');

-- AC11: the search
select pg_temp.seed_job('{"title": "Paging crane operator", "status": "open", "created_at": "2026-01-01T10:00:00Z"}', current_setting('t.b')::uuid) as p1 \gset
select pg_temp.seed_job('{"title": "Paging crane rigger", "status": "draft", "created_at": "2026-01-02T10:00:00Z"}', current_setting('t.b')::uuid) as p2 \gset
select pg_temp.seed_job('{"title": "Paging crane planner", "status": "paused", "created_at": "2026-01-03T10:00:00Z"}', current_setting('t.b')::uuid) as p3 \gset
select pg_temp.seed_job('{"title": "Paging crane deleted", "deleted_at": "2026-01-04T10:00:00Z", "created_at": "2026-01-04T10:00:00Z"}', current_setting('t.b')::uuid) as p4 \gset

select is(
  pg_temp.rows_as(:'st_trust', $$select * from public.admin_search_jobs('paging crane')$$) -> 0 ->> 'title', 'Paging crane planner',
  'AC11: the trust_safety user at aal2 gets rows, the newest first'
);
select is(
  (select jsonb_agg(k order by k) from jsonb_object_keys(pg_temp.rows_as(:'st_trust', $$select * from public.admin_search_jobs('paging crane')$$) -> 0) k),
  '["created_at", "id", "moderation_state", "organization_name", "status", "title"]'::jsonb,
  'AC11: with exactly id, title, organisation name, status, moderation_state and created_at'
);
select is(
  (select string_agg(r ->> 'title', ',' order by (r ->> 'created_at') desc)
   from jsonb_array_elements(pg_temp.rows_as(:'st_trust', $$select * from public.admin_search_jobs('PAGING CRANE')$$)) r),
  'Paging crane planner,Paging crane rigger,Paging crane operator',
  'AC11: it finds a title in any case, drafts and paused ones included, and not the soft-deleted one'
);
select is(
  pg_temp.rows_as(:'st_trust', format($$select * from public.admin_search_jobs(%L)$$, :'p1')) -> 0 ->> 'id', :'p1', 'AC11: it finds a vacancy by its id'
);
select is(
  pg_temp.rows_as(:'st_trust', format($$select * from public.admin_search_jobs(%L)$$, :'p4')), '[]'::jsonb, 'AC11: but not a soft-deleted one by its id'
);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.rows_as(:'st_trust', $$select * from public.admin_search_jobs('beta works')$$)) r
   where r ->> 'organization_name' = 'Beta Works'),
  4::bigint, 'AC11: it finds the vacancies of an organisation by its name'
);
select is(
  pg_temp.rows_as(:'st_trust', $$select * from public.admin_search_jobs('%%%')$$), '[]'::jsonb, 'AC11: a percent sign in the term is no wildcard'
);
select is(pg_temp.rows_as(:'st_trust', $$select * from public.admin_search_jobs('ab')$$), to_jsonb('P0001|CHARA_INVALID_INPUT|term'::text), 'AC11: a term of 2 characters is refused');
select is(
  pg_temp.rows_as(:'st_trust', $$select * from public.admin_search_jobs(repeat('x', 101))$$), to_jsonb('P0001|CHARA_INVALID_INPUT|term'::text),
  'AC11: and so is one of 101'
);
select is(
  (select string_agg(r ->> 'title', ',') from jsonb_array_elements(pg_temp.rows_as(:'st_trust', $$select * from public.admin_search_jobs('paging crane', 2)$$)) r),
  'Paging crane planner,Paging crane rigger', 'AC11: a page of 2 holds the 2 newest'
);
select is(
  (select string_agg(r ->> 'title', ',') from jsonb_array_elements(pg_temp.rows_as(
     :'st_trust', format($$select * from public.admin_search_jobs('paging crane', 2, %L, %L)$$, '2026-01-02T10:00:00Z'::timestamptz, :'p2'))) r),
  'Paging crane operator', 'AC11: the next page starts after the last row of the page before'
);
select is(
  jsonb_array_length(pg_temp.rows_as(:'st_trust', $$select * from public.admin_search_jobs('paging crane', 1000)$$)), 3,
  'AC11: the page size is capped at 100 (here the 3 rows exist)'
);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.rows_as(:'st_trust', $$select * from public.admin_search_jobs('welder', 100)$$)) r
   where r::text ~ 'cover|snapshot|note|worker'),
  0::bigint, 'AC11: no row names an application, a note or a candidate'
);

create temp table callers (name text primary key, uid uuid, db_role text not null, aal text not null);
insert into callers values
  ('admin', :'st_admin', 'authenticated', 'aal2'), ('reviewer', :'st_review', 'authenticated', 'aal2'),
  ('candidate', :'wa', 'authenticated', 'aal2'), ('owner', :'own1', 'authenticated', 'aal2'),
  ('trust at aal1', :'st_trust', 'authenticated', 'aal1'), ('revoked trust', :'gone_trust', 'authenticated', 'aal2'),
  ('anon', null, 'anon', 'aal2');
select pg_temp.writes() as before_reads \gset
select is(
  (select count(*) from callers c where pg_temp.call_as(c.uid, c.db_role, $$select * from public.admin_search_jobs('welder')$$, c.aal)
     = case when c.db_role = 'anon' then '42501|permission denied for function admin_search_jobs|'
            when c.aal = 'aal1' then 'P0001|CHARA_FORBIDDEN|aal2_required' else 'P0001|CHARA_FORBIDDEN|' end),
  7::bigint, 'AC11: every other caller is refused by admin_search_jobs (anon for lack of EXECUTE)'
);
select is(
  (select count(*) from callers c where pg_temp.call_as(c.uid, c.db_role, format($$select * from public.admin_get_job(%L)$$, :'v1'), c.aal)
     = case when c.db_role = 'anon' then '42501|permission denied for function admin_get_job|'
            when c.aal = 'aal1' then 'P0001|CHARA_FORBIDDEN|aal2_required' else 'P0001|CHARA_FORBIDDEN|' end),
  7::bigint, 'AC11: and by admin_get_job'
);
select is(pg_temp.writes(), :'before_reads', 'AC11: a refused read writes nothing');
select is(pg_temp.scalar_as('authenticated', :'st_trust', 'select count(*) from public.job_applications'), '0', 'AC11: the trust_safety user reads no application');
select is(pg_temp.scalar_as('authenticated', :'st_trust', 'select count(*) from public.application_notes'), '0', 'AC11: nor a note');
select is(pg_temp.scalar_as('authenticated', :'st_trust', 'select count(*) from public.worker_documents'), '0', 'AC11: nor a document');
select is(
  pg_temp.scalar_as('authenticated', :'st_trust', $$select count(*) from public.jobs where status <> 'open' or moderation_state <> 'visible'$$), '0',
  'AC11: nor a draft or hidden vacancy from the table'
);

-- admin_get_job
select is(
  (select jsonb_agg(k order by k) from jsonb_object_keys(pg_temp.rows_as(:'st_trust', format($$select * from public.admin_get_job(%L)$$, :'vn')) -> 0) k),
  '["city", "country_code", "created_at", "description", "history", "id", "moderation_state", "organization_id", "organization_name", "status", "title"]'::jsonb,
  'the vacancy to assess has its text, the organisation and the history, and no applicant data'
);
select is(
  (select string_agg(h ->> 'action', ',' order by ord) from jsonb_array_elements(
     pg_temp.rows_as(:'st_trust', format($$select * from public.admin_get_job(%L)$$, :'vn')) -> 0 -> 'history') with ordinality as t (h, ord)),
  'job_hidden,job_unhidden,job_hidden', 'the history lists the actions, the newest first'
);
select is(
  pg_temp.rows_as(:'st_trust', format($$select moderation_state from public.admin_get_job(%L)$$, :'v_hidden')) -> 0 ->> 'moderation_state', 'hidden',
  'a hidden vacancy can be read by the Trust & Safety Administrator'
);
select is(
  pg_temp.rows_as(:'st_trust', format($$select * from public.admin_get_job(%L)$$, :'v_gone')), to_jsonb('P0002|CHARA_NOT_FOUND|'::text),
  'a soft-deleted vacancy is not found'
);
select is(
  pg_temp.rows_as(:'st_trust', format($$select * from public.admin_get_job(%L)$$, :'v_none')), to_jsonb('P0002|CHARA_NOT_FOUND|'::text),
  'nor one that does not exist'
);
select is(
  pg_temp.rows_as(:'st_trust', $$select * from public.admin_get_job(null)$$), to_jsonb('P0001|CHARA_INVALID_INPUT|job'::text), 'nor a null id'
);

-- The record
select is(
  (select count(*) from public.moderation_actions where target_type = 'job'), 10::bigint, 'the record holds one row for each hide and unhide that succeeded'
);
select throws_ok(
  format($$insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons) values ('job', %L, 'account_suspended', 'A written reason')$$, :'v1'),
  '23514', null, 'a vacancy cannot carry the action of an account'
);
select throws_ok(
  format($$insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons) values ('profile', %L, 'job_hidden', 'A written reason')$$, :'wa'),
  '23514', null, 'nor an account the action of a vacancy'
);
select throws_ok(
  format($$update public.moderation_actions set statement_of_reasons = 'Another written reason' where target_id = %L$$, :'v1'), null, null,
  'the record of a vacancy is append-only'
);
select is(
  pg_temp.scalar_as('authenticated', :'st_trust', $$select count(*) from public.admin_list_moderation_actions(100) where target_type = 'job'$$), '0',
  'the page of suspensions lists no vacancy'
);

-- The monthly statistics of the runbook (FR-C7 step Report)
select is(
  (select format('%s|%s', hidden, unhidden) from (
     select count(*) filter (where action = 'job_hidden') as hidden, count(*) filter (where action = 'job_unhidden') as unhidden
     from public.moderation_actions
     where target_type = 'job' and created_at >= date_trunc('month', now()) and created_at < date_trunc('month', now()) + interval '1 month'
   ) m),
  '5|5', 'the monthly statistics count the hides and the unhides of the month'
);
select is(
  (select count(*) from public.moderation_actions where target_type = 'job' and created_at < date_trunc('month', now())), 0::bigint,
  'and none of an earlier month'
);

-- The statement of the runbook for the 7 days: a restore is an unhide, whose time follows the hide
select is(
  (select count(*) from public.moderation_actions h join public.moderation_actions u
     on u.target_type = 'job' and u.target_id = h.target_id and u.action = 'job_unhidden' and u.id > h.id
   where h.target_type = 'job' and h.action = 'job_hidden' and h.target_id = :'v1'),
  1::bigint, 'a hide is followed by its unhide for the same vacancy (the restore decision of an appeal)'
);

select * from finish();
rollback;
