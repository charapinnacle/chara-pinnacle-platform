begin;
select plan(38);

\ir apply_fixture.inc

select pg_temp.doc(:'d1', :'wa');
select pg_temp.doc(:'dx', :'wb');
create temp table t_open as select pg_temp.open_job('Open welder') as id;
create temp table t_before as select pg_temp.counts() as c;
select set_config('t.open', (select id::text from t_open), true) as keep \gset

-- FR-D1 AC6: only an active candidate account may apply.
select is(
  pg_temp.call_as(null, 'anon', format('select * from public.apply_to_job(%L)', current_setting('t.open'))),
  '42501|permission denied for function apply_to_job|', 'AC6: an anonymous call has no EXECUTE'
);
select is(pg_temp.apply_as(:'own1', current_setting('t.open')::uuid), 'P0001|CHARA_FORBIDDEN|worker_account_required', 'AC6: the owner of a company is refused');
select is(pg_temp.apply_as(:'mem', current_setting('t.open')::uuid), 'P0001|CHARA_FORBIDDEN|worker_account_required', 'AC6: a plain member of a company is refused');
select is(pg_temp.apply_as(:'slg', current_setting('t.open')::uuid), 'P0001|CHARA_FORBIDDEN|worker_account_required', 'AC6: a platform administrator of company kind is refused');
select is(pg_temp.apply_as(:'nul', current_setting('t.open')::uuid), 'P0001|CHARA_FORBIDDEN|worker_account_required', 'AC6: a user whose account kind is not chosen yet is refused');
select is(pg_temp.apply_as(:'wsus', current_setting('t.open')::uuid), 'P0001|CHARA_FORBIDDEN|account_not_active', 'AC6: a suspended candidate is refused');
update public.profiles set deleted_at = now() where id = :'wb';
select is(pg_temp.apply_as(:'wb', current_setting('t.open')::uuid), 'P0001|CHARA_FORBIDDEN|account_not_active', 'AC6: a candidate who asked for deletion is refused');
select is(pg_temp.counts(), (select c from t_before), 'AC6: the refused calls wrote no row');
update public.profiles set deleted_at = null where id = :'wb';
select is(pg_temp.apply_as(:'wb', current_setting('t.open')::uuid), 'ok', 'a candidate whose request was cancelled applies again');

-- FR-D1 AC5 and FR-C2 AC6: a vacancy that is not open and visible is refused with one code.
create temp table t_states (label text primary key, id uuid not null);
insert into t_states values
  ('draft', pg_temp.seed_job('{"title": "Draft vacancy", "status": "draft"}')),
  ('paused', pg_temp.seed_job('{"title": "Paused vacancy", "status": "paused"}')),
  ('closed', pg_temp.seed_job('{"title": "Closed vacancy", "status": "closed"}')),
  ('filled', pg_temp.seed_job('{"title": "Filled vacancy", "status": "filled"}')),
  ('hidden', pg_temp.seed_job('{"title": "Hidden vacancy", "status": "open", "moderation_state": "hidden"}')),
  ('suspended', pg_temp.seed_job('{"title": "Suspended vacancy", "status": "open", "moderation_state": "org_suspended"}')),
  ('deleted', pg_temp.seed_job('{"title": "Deleted vacancy", "status": "open", "deleted_at": "2026-01-01T00:00:00Z"}'));
create temp table t_before3 as select pg_temp.counts() as c;
select is(
  (select string_agg(s.label || '=' || pg_temp.apply_as(:'wa', s.id), ',' order by s.label) from t_states s),
  'closed=P0001|CHARA_JOB_NOT_OPEN|,deleted=P0001|CHARA_JOB_NOT_OPEN|,draft=P0001|CHARA_JOB_NOT_OPEN|,filled=P0001|CHARA_JOB_NOT_OPEN|,hidden=P0001|CHARA_JOB_NOT_OPEN|,paused=P0001|CHARA_JOB_NOT_OPEN|,suspended=P0001|CHARA_JOB_NOT_OPEN|',
  'AC5: draft, paused, closed, filled, hidden, suspended and deleted vacancies all raise CHARA_JOB_NOT_OPEN, with no detail that names the reason'
);
select is(pg_temp.apply_as(:'wa', gen_random_uuid()), 'P0001|CHARA_JOB_NOT_OPEN|', 'AC5: an unknown id raises the same code');
select is(pg_temp.apply_as(:'wa', null), 'P0001|CHARA_JOB_NOT_OPEN|', 'AC5: so does a null id');
select is(pg_temp.counts(), (select c from t_before3), 'AC5: nothing was written in any of these cases');

-- A vacancy that stops being open after a candidate applied: the next applicant is refused, the first keeps the application.
select is(pg_temp.apply_as(:'wa', current_setting('t.open')::uuid), 'ok', 'setup: the candidate applies to the open vacancy');
select set_config('t.wa_app', current_setting('t.app'), true) as keep \gset
select is(pg_temp.set_status(:'own1', current_setting('t.open')::uuid, 'paused'), 'ok', 'setup: the owner pauses the vacancy');
select is(pg_temp.apply_as(:'wb', current_setting('t.open')::uuid), 'P0001|CHARA_JOB_NOT_OPEN|', 'FR-C2 AC6: after the vacancy is paused a new application is refused');
select is((select count(*) from public.job_applications where job_id = current_setting('t.open')::uuid), 2::bigint, 'and the existing applications stay');
select is(pg_temp.apply_as(:'wa', current_setting('t.open')::uuid), 'P0001|CHARA_JOB_NOT_OPEN|', 'a repeated call by the first candidate is refused too, with the vacancy not open');

-- FR-D1 AC5: an incomplete profile.
create temp table t_job as select pg_temp.open_job('Profile vacancy') as id;
update public.worker_profiles set occupation_id = null where user_id = :'wa';
select is(pg_temp.apply_as(:'wa', (select id from t_job)), 'P0001|CHARA_PROFILE_INCOMPLETE|occupation_id', 'AC5: a profile without an occupation raises CHARA_PROFILE_INCOMPLETE and names the field');
select is(pg_temp.apply_as(:'wnew', (select id from t_job)), 'P0001|CHARA_PROFILE_INCOMPLETE|first_name, last_name, current_country, occupation_id', 'AC5: a candidate without a passport row gets all four fields');
update public.worker_profiles set occupation_id = '7212' where user_id = :'wa';

-- FR-D1 AC5: invalid input.
create temp table t_job5 as select pg_temp.open_job('Input vacancy') as id;
create temp table t_before5 as select pg_temp.counts() as c;
select is(pg_temp.apply_as(:'wa', (select id from t_job5), repeat('a', 2001)), 'P0001|CHARA_INVALID_INPUT|p_note', 'AC5: a note of 2001 characters is refused');
select is(
  pg_temp.apply_as(:'wa', (select id from t_job5), null, array(select gen_random_uuid() from generate_series(1, 11))),
  'P0001|CHARA_INVALID_INPUT|p_document_ids', 'AC5: 11 document ids are refused'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$select * from public.apply_to_job(%L, null, array[null, %L]::uuid[])$$, (select id from t_job5), :'d1'), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|p_document_ids', 'AC5: a null among the ids is refused'
);
select is(pg_temp.counts(), (select c from t_before5), 'AC5: nothing was written in these cases');
select is(pg_temp.apply_as(:'wa', (select id from t_job5), repeat('a', 2000) || repeat(' ', 10)), 'ok', 'AC5: a note of 2000 characters padded with spaces is accepted');
select is((select length(a.cover_note) from public.job_applications a where a.id = current_setting('t.app')::uuid), 2000, 'AC5: and stored trimmed');
create temp table t_job6 as select pg_temp.open_job('Spaces vacancy') as id;
select is(pg_temp.apply_as(:'wa', (select id from t_job6), E'  \t\n  '), 'ok', 'AC5: a note of only white space is accepted');
select is((select a.cover_note is null from public.job_applications a where a.id = current_setting('t.app')::uuid), true, 'AC5: and stored as null');
create temp table t_job7 as select pg_temp.open_job('Ten documents vacancy') as id;
select pg_temp.doc(('00000000-0000-0000-0000-0000000e00' || lpad(n::text, 2, '0'))::uuid, :'wa') from generate_series(1, 10) n;
select is(
  pg_temp.apply_as(:'wa', (select id from t_job7), null, array(select ('00000000-0000-0000-0000-0000000e00' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 10) n) || array(select ('00000000-0000-0000-0000-0000000e00' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 3) n)),
  'ok', 'AC5: ten documents are accepted, the repeated ids collapse'
);
select is(
  (select jsonb_array_length(s.scope) from public.passport_shares s where s.application_id = current_setting('t.app')::uuid), 10,
  'the scope holds ten ids'
);
create temp table t_job8 as select pg_temp.open_job('Note vacancy') as id;
select is(pg_temp.apply_as(:'wa', (select id from t_job8), '<script>alert(1)</script>'), 'ok', 'a note with markup is accepted as text');
select is((select a.cover_note from public.job_applications a where a.id = current_setting('t.app')::uuid), '<script>alert(1)</script>', 'and stored as typed');

-- The limits are settings.
select is((select row(cover_note_max_chars, documents_max)::text from public.apply_limits()), '(2000,10)', 'the limits are the settings, 2000 characters and 10 documents');
update private.settings set value = '5' where key = 'apply_cover_note_max_chars';
create temp table t_job9 as select pg_temp.open_job('Setting vacancy') as id;
select is(pg_temp.apply_as(:'wa', (select id from t_job9), 'abcdef'), 'P0001|CHARA_INVALID_INPUT|p_note', 'a lower setting refuses a note of 6 characters');
update private.settings set value = '2000' where key = 'apply_cover_note_max_chars';
delete from private.settings where key = 'apply_documents_max';
select is(pg_temp.apply_as(:'wa', (select id from t_job9)), 'P0001|CHARA_SETTING_MISSING|apply_limits', 'a missing setting fails the call instead of lifting the limit');
insert into private.settings (key, value) values ('apply_documents_max', '10');
select is(pg_temp.call_as(null, 'anon', 'select * from public.apply_limits()'), '42501|permission denied for function apply_limits|', 'anonymous callers cannot read the limits');

-- FR-D1 AC10: no monthly limit and no country-pair block.
select pg_temp.seed_job(jsonb_build_object('title', 'Welder ' || n, 'status', 'open', 'country_code', (array['DE', 'AE', 'PH', 'SA'])[1 + n % 4]))
from generate_series(1, 30) n;
create temp table t_thirty as select id from public.jobs where title ~ '^Welder [0-9]+$';
update private.settings set value = '1000' where key = 'apply_rate_limit_max';
select is(
  (select count(*) from t_thirty t where pg_temp.apply_as(:'wb', t.id) = 'ok'), 30::bigint,
  'AC10: a candidate in PH applies to 30 open vacancies in DE, AE, PH and SA in one month and none is refused'
);
select is((select prosrc !~ 'usage_counters|check_limit|org_limit' from pg_proc where proname = 'apply_to_job'), true, 'AC10: apply_to_job counts against no usage counter or plan limit');

select * from finish();
rollback;
