begin;
select plan(108);

\ir status_fixture.inc

-- FR-F4 (proposed), D82: submit_report. A visitor or a signed-in user reports a public vacancy, a company (through one of
-- its public vacancies) or a page; a member of an organisation reports an applicant of that organisation. The reports
-- table has no grant, so nothing here reads it except as the database owner.

\set oth '00000000-0000-0000-0000-00000000f001'
select pg_temp.new_user(:'oth', 'company');
update public.profiles set account_kind = intended_account_kind where id = :'oth';

create temp sequence key_seq;
create function pg_temp.nextkey() returns text language sql as $$ select encode(sha256(nextval('pg_temp.key_seq')::text::bytea), 'hex') $$;

-- The named arguments of submit_report. A target is a vacancy (job, company), an application (profile) or a path (content).
create function pg_temp.args(
  p_type text, p_job uuid default null, p_app uuid default null, p_path text default null,
  p_category text default 'misleading_or_fraud', p_details text default 'The vacancy asks for a fee before any work.',
  p_email text default null, p_good_faith boolean default true, p_key text default null, p_proof text default null
) returns text
language sql as $$
  select format(
    'p_target_type => %L, p_job => %L, p_application => %L, p_path => %L, p_category => %L, p_details => %L, p_good_faith => %L, p_email => %L, p_key => %L, p_proof => %L',
    p_type, p_job, p_app, p_path, p_category, p_details, p_good_faith, p_email, coalesce(p_key, pg_temp.nextkey()), p_proof)
$$;

-- submit_report as p_user (null for anonymous): 'ok' (reference and duplicate flag then in t.ref and t.dup) or the refusal.
create function pg_temp.report_as(p_user uuid, p_args text, p_aal text default 'aal1') returns text
language sql as $$
  select pg_temp.call_as(
    p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format($f$select set_config('t.ref', r.reference, true), set_config('t.dup', r.is_duplicate::text, true) from public.submit_report(%s) r$f$, p_args),
    p_aal)
$$;

create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.reports) || ',' || (select count(*) from audit.log) || ','
      || (select count(*) from pgmq.q_notifications) || ',' || (select count(*) from public.notifications)
$$;

select pg_temp.open_job('Report vacancy') as v1 \gset
select pg_temp.open_job('Report second') as v2 \gset
select pg_temp.open_job('Report of Beta', current_setting('t.b')::uuid) as vb \gset
select pg_temp.seed_job('{"title": "Report draft", "status": "draft"}') as v_draft \gset
select pg_temp.seed_job('{"title": "Report paused", "status": "paused"}') as v_paused \gset
select pg_temp.seed_job('{"title": "Report closed", "status": "closed"}') as v_closed \gset
select pg_temp.seed_job('{"title": "Report hidden", "status": "open", "moderation_state": "hidden"}') as v_hidden \gset
select pg_temp.seed_job('{"title": "Report suspended", "status": "open", "moderation_state": "org_suspended"}') as v_susp \gset
select pg_temp.seed_job('{"title": "Report deleted", "status": "open", "deleted_at": "2026-01-01T00:00:00Z"}') as v_gone \gset
select pg_temp.seed_app('applied') as app_a \gset
select pg_temp.seed_app('applied', current_setting('t.b')::uuid) as app_b \gset
select gen_random_uuid() as nobody \gset

-- Structure and privileges
select enum_has_labels('public', 'report_target_type', array['job', 'company', 'profile', 'content'], 'the four kinds of target');
select enum_has_labels('public', 'report_category',
  array['illegal_content', 'misleading_or_fraud', 'discrimination', 'fee_demanded_from_worker', 'harassment', 'privacy_violation', 'other'],
  'the seven categories');
select enum_has_labels('public', 'report_status', array['new', 'in_review', 'actioned', 'dismissed'], 'the four statuses');
select columns_are('public', 'reports',
  array['id', 'target_type', 'job_id', 'organization_id', 'application_id', 'content_path', 'category', 'details', 'reporter_user_id',
        'reporter_email', 'good_faith_confirmed', 'status', 'handled_by', 'handled_at', 'resolution_note', 'created_at'],
  'reports has the columns of the record and no name, no phone, no address of a reporter beyond the optional email');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.reports'::regclass)
  and not exists (select 1 from pg_policy where polrelid = 'public.reports'::regclass),
  'RLS is enabled and forced and there is no policy: the table is closed to every API role'
);
select ok(
  not exists (
    select 1 from (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
    where has_table_privilege(r.rolname, 'public.reports', 'select, insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege(r.rolname, 'public.reports', 'select, insert, update, references')),
  'no API role holds a privilege on the table'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
   where oid = 'public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text)'::regprocedure)
  and has_function_privilege('anon', 'public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.submit_report(public.report_target_type, public.report_category, text, boolean, text, uuid, uuid, text, text, text)', 'execute'),
  'submit_report is a definer function with an empty search_path, open to visitors and signed-in users only'
);
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.reports$$, 'aal1'), '42501|permission denied for table reports|',
  'AC: an anonymous caller cannot read reports'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', $$select * from public.reports$$, 'aal1'), '42501|permission denied for table reports|',
  'AC: a signed-in user cannot read reports, not even their own'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', $$insert into public.reports (target_type, content_path, category, details, good_faith_confirmed) values ('content', '/en', 'other', 'Twenty characters or more of text.', true)$$, 'aal1'),
  '42501|permission denied for table reports|', 'nor write to the table'
);

-- The constraints of the table, written as the database owner
select throws_ok($$insert into public.reports (target_type, content_path, category, details, good_faith_confirmed) values ('content', '/en', 'other', 'too short, 19 chrs.', true)$$, '23514', null, 'details of 19 characters are refused');
select throws_ok(format($$insert into public.reports (target_type, content_path, category, details, good_faith_confirmed) values ('content', '/en', 'other', %L, true)$$, repeat('x', 2001)), '23514', null, 'and of 2001');
select throws_ok($$insert into public.reports (target_type, content_path, category, details, good_faith_confirmed) values ('content', '/en', 'other', 'Twenty characters or more of text.', false)$$, '23514', null, 'good faith must be confirmed');
select throws_ok(format($$insert into public.reports (target_type, job_id, organization_id, category, details, good_faith_confirmed) values ('job', %L, %L, 'other', 'Twenty characters or more of text.', true)$$, :'v1', current_setting('t.a')), '23514', null, 'a job report names the vacancy only');
select throws_ok($$insert into public.reports (target_type, application_id, category, details, good_faith_confirmed) values ('profile', gen_random_uuid(), 'other', 'Twenty characters or more of text.', true)$$, '23514', null, 'a profile report needs a reporter and an application');
select throws_ok($$insert into public.reports (target_type, content_path, category, details, good_faith_confirmed) values ('content', '//evil.example', 'other', 'Twenty characters or more of text.', true)$$, '23514', null, 'a path cannot start with two slashes');
select throws_ok($$insert into public.reports (target_type, content_path, category, details, good_faith_confirmed, reporter_user_id, reporter_email) values ('content', '/en', 'other', 'Twenty characters or more of text.', true, gen_random_uuid(), 'a@example.test')$$, '23514', null, 'a signed-in reporter has no address of their own in the record');
select throws_ok($$insert into public.reports (target_type, content_path, category, details, good_faith_confirmed, status) values ('content', '/en', 'other', 'Twenty characters or more of text.', true, 'dismissed')$$, '23514', null, 'a closed report needs who closed it, when and the note');

select is(
  (select array_agg(a.attname order by a.attname)
   from pg_index i join pg_class c on c.oid = i.indexrelid join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
   where i.indrelid = 'public.reports'::regclass and c.relname in ('reports_job_idx', 'reports_organization_idx', 'reports_application_idx')),
  array['application_id', 'job_id', 'organization_id']::name[], 'each foreign key of a report (vacancy, organisation, application) has an index led by its column'
);
select is(
  private.report_reference(42) || ' ' || private.report_reference(999999) || ' ' || private.report_reference(1234567),
  'R-000042 R-999999 R-1234567', 'a reference is six digits and grows past a million without cutting a digit'
);

-- A visitor reports a vacancy
select (select count(*) from pgmq.q_notifications) + (select count(*) from public.notifications) as queued_before \gset
select is(pg_temp.report_as(null, pg_temp.args('job', :'v1', p_email => '  Visitor@Example.test ')), 'ok', 'AC: a visitor reports an open vacancy');
select matches(current_setting('t.ref'), '^R-[0-9]{6}$', 'and gets a reference number');
select is(current_setting('t.dup'), 'false', 'which is a new report');
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s', target_type, job_id = :'v1', organization_id is null, category, status, reporter_user_id is null,
                 reporter_email, good_faith_confirmed) from public.reports order by id desc limit 1),
  'job|t|t|misleading_or_fraud|new|t|visitor@example.test|t', 'the record holds the vacancy, the category, the trimmed lower-case address of the visitor and status new'
);
select is(
  (select details from public.reports order by id desc limit 1), 'The vacancy asks for a fee before any work.', 'and the text'
);
select is(
  (select format('%s|%s|%s|%s', actor_id is null, entity_type, entity_id, metadata ->> 'target_type') from audit.log where action = 'report.submitted' order by id desc limit 1),
  format('t|report|%s|job', (select id from public.reports order by id desc limit 1)), 'one audit row names the report and the kind, with no actor for a visitor'
);
select is(
  (select count(*) from audit.log where action = 'report.submitted' and (metadata::text like '%fee before%' or metadata::text ilike '%visitor@example%')),
  0::bigint, 'the audit row carries neither the text nor the address'
);
select is(
  (select count(*) from pgmq.q_notifications) + (select count(*) from public.notifications), :'queued_before'::bigint,
  'nothing is queued: no email goes to an address that was not verified'
);

-- A signed-in user reports a vacancy
select is(pg_temp.report_as(:'wa', pg_temp.args('job', :'v1', p_category => 'harassment', p_email => 'ignored@example.test')), 'ok', 'a signed-in candidate reports it too');
select is(
  (select format('%s|%s|%s', reporter_user_id, reporter_email is null, category) from public.reports order by id desc limit 1),
  format('%s|t|harassment', :'wa'), 'the record holds the account, and an address given with it is dropped'
);
select is(
  (select actor_id from audit.log where action = 'report.submitted' order by id desc limit 1), :'wa'::uuid, 'and the audit row names the account'
);
select is(pg_temp.report_as(:'own1', pg_temp.args('job', :'vb', p_category => 'other')), 'ok', 'a member of another company reports a vacancy of Beta');

-- Vacancies that are not public
select pg_temp.writes() as before_np \gset
select is(pg_temp.report_as(null, pg_temp.args('job', :'v_draft')), 'P0002|CHARA_NOT_FOUND|', 'AC: a draft vacancy cannot be reported');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v_paused')), 'P0002|CHARA_NOT_FOUND|', 'nor a paused one');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v_closed')), 'P0002|CHARA_NOT_FOUND|', 'nor a closed one');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v_hidden')), 'P0002|CHARA_NOT_FOUND|', 'nor one hidden by moderation');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v_susp')), 'P0002|CHARA_NOT_FOUND|', 'nor one of a suspended company');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v_gone')), 'P0002|CHARA_NOT_FOUND|', 'nor a deleted one');
select is(pg_temp.report_as(null, pg_temp.args('job', :'nobody')), 'P0002|CHARA_NOT_FOUND|', 'nor one that does not exist: the answer is the same');
select is(pg_temp.report_as(:'mem', pg_temp.args('job', :'v_draft')), 'P0002|CHARA_NOT_FOUND|', 'a member of the company cannot report its own draft either');
select is(pg_temp.report_as(null, pg_temp.args('job', null)), 'P0001|CHARA_INVALID_INPUT|job', 'a job report without a vacancy is refused');
select is(pg_temp.writes(), :'before_np', 'the refused reports stored nothing and wrote no audit row');

-- A company, found through one of its public vacancies
select is(pg_temp.report_as(null, pg_temp.args('company', :'v1', p_category => 'illegal_content')), 'ok', 'a visitor reports the company of a public vacancy');
select is(
  (select format('%s|%s|%s', organization_id = current_setting('t.a')::uuid, job_id = :'v1', application_id is null) from public.reports order by id desc limit 1),
  't|t|t', 'the record holds the organisation and the vacancy it was found through'
);
select is(pg_temp.report_as(null, pg_temp.args('company', :'v_hidden')), 'P0002|CHARA_NOT_FOUND|', 'a company is not reachable through a vacancy that is not public');

-- A page of the site
select is(pg_temp.report_as(null, pg_temp.args('content', p_path => '/en/jobs/abc', p_category => 'other')), 'ok', 'a visitor reports a page by its path');
select is((select content_path from public.reports order by id desc limit 1), '/en/jobs/abc', 'the path is stored');
select is(pg_temp.report_as(null, pg_temp.args('content', p_path => '/en/jobs?q=welder')), 'P0001|CHARA_INVALID_INPUT|path', 'a query string is not part of a path');
select is(pg_temp.report_as(null, pg_temp.args('content', p_path => '//evil.example/x')), 'P0001|CHARA_INVALID_INPUT|path', 'nor a second slash at the start');
select is(pg_temp.report_as(null, pg_temp.args('content', p_path => '/en/../admin')), 'P0001|CHARA_INVALID_INPUT|path', 'nor a step up');
select is(pg_temp.report_as(null, pg_temp.args('content', p_path => 'en/jobs')), 'P0001|CHARA_INVALID_INPUT|path', 'nor a path that is relative');
select is(pg_temp.report_as(null, pg_temp.args('content', p_path => '/' || repeat('a', 256))), 'P0001|CHARA_INVALID_INPUT|path', 'nor one of 257 characters');
select is(pg_temp.report_as(null, pg_temp.args('content', p_path => null)), 'P0001|CHARA_INVALID_INPUT|path', 'nor a missing one');

-- A candidate profile: only a member of the organisation, for its own applicant
select is(pg_temp.report_as(:'own1', pg_temp.args('profile', p_app => :'app_a', p_category => 'privacy_violation', p_details => 'The profile shows data it should not show.'), 'aal2'), 'ok', 'AC: the owner at aal2 reports an applicant of the organisation');
select is(
  (select format('%s|%s|%s|%s|%s', application_id = :'app_a', job_id is null, organization_id is null, content_path is null, reporter_user_id = :'own1')
   from public.reports order by id desc limit 1),
  't|t|t|t|t', 'the record holds the application id and the reporter, nothing of the candidate'
);
select is(pg_temp.report_as(:'mem', pg_temp.args('profile', p_app => :'app_a', p_category => 'harassment')), 'ok', 'a plain member reports at aal1, as for the rest of the applicant data');
select is(pg_temp.report_as(:'own1', pg_temp.args('profile', p_app => :'app_a', p_category => 'other'), 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'the owner at aal1 is sent to two-step verification');
select is(pg_temp.report_as(:'adm', pg_temp.args('profile', p_app => :'app_a', p_category => 'other'), 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'and so is an administrator');
select is(pg_temp.report_as(:'own2', pg_temp.args('profile', p_app => :'app_a', p_category => 'other'), 'aal2'), 'P0002|CHARA_NOT_FOUND|', 'AC: a member of another organisation cannot report the applicant');
select is(pg_temp.report_as(:'oth', pg_temp.args('profile', p_app => :'app_a', p_category => 'other'), 'aal2'), 'P0002|CHARA_NOT_FOUND|', 'nor a company user who belongs to no organisation');
select is(pg_temp.report_as(:'pending', pg_temp.args('profile', p_app => :'app_a', p_category => 'other'), 'aal2'), 'P0002|CHARA_NOT_FOUND|', 'nor an invitee who has not accepted');
select is(pg_temp.report_as(:'wa', pg_temp.args('profile', p_app => :'app_a', p_category => 'other')), 'P0001|CHARA_FORBIDDEN|company_account_required', 'nor a candidate, not even the applicant');
select is(pg_temp.report_as(null, pg_temp.args('profile', p_app => :'app_a', p_category => 'other')), 'P0001|CHARA_FORBIDDEN|sign_in_required', 'nor a visitor: there is no public button');
select is(pg_temp.report_as(:'own1', pg_temp.args('profile', p_app => :'nobody', p_category => 'other'), 'aal2'), 'P0002|CHARA_NOT_FOUND|', 'an application that does not exist is not found');
select is(pg_temp.report_as(:'own1', pg_temp.args('profile', p_app => null, p_category => 'other'), 'aal2'), 'P0001|CHARA_INVALID_INPUT|application', 'and a missing one is refused');
update public.organizations set status = 'suspended' where id = current_setting('t.a')::uuid;
select is(pg_temp.report_as(:'mem', pg_temp.args('profile', p_app => :'app_a', p_category => 'other')), 'P0002|CHARA_NOT_FOUND|', 'a member of a suspended organisation cannot report an applicant');
update public.organizations set status = 'active' where id = current_setting('t.a')::uuid;
select is(
  (select count(*) from public.reports where target_type = 'profile' and application_id = :'app_b'), 0::bigint, 'no report was stored for the applicant of the other organisation'
);

-- Validation
select pg_temp.writes() as before_inv \gset
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_details => 'Nineteen chars 19..')), 'P0001|CHARA_INVALID_INPUT|details', 'AC: details of 19 characters are refused');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_details => '   ' || 'x' || '   ')), 'P0001|CHARA_INVALID_INPUT|details', 'and so is text that is short once trimmed');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_details => repeat('y', 2001))), 'P0001|CHARA_INVALID_INPUT|details', 'and 2001 characters');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_details => null)), 'P0001|CHARA_INVALID_INPUT|details', 'and a missing text');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_good_faith => false)), 'P0001|CHARA_INVALID_INPUT|good_faith', 'AC: the good-faith statement is required');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_good_faith => null)), 'P0001|CHARA_INVALID_INPUT|good_faith', 'also when it is missing');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_email => 'not an address')), 'P0001|CHARA_INVALID_INPUT|email', 'an address that is not one is refused');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_category => null)), 'P0001|CHARA_INVALID_INPUT|category', 'a missing category is refused');
select is(pg_temp.report_as(null, pg_temp.args(null, :'v2')), 'P0001|CHARA_INVALID_INPUT|target_type', 'and a missing kind');
select is(pg_temp.writes(), :'before_inv', 'the refused reports stored nothing');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_details => '  ' || repeat('z', 20) || E'\n ')), 'ok', 'exactly 20 characters after trimming are accepted');
select is((select details from public.reports order by id desc limit 1), repeat('z', 20), 'and stored trimmed');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_details => repeat('y', 2000), p_category => 'other')), 'ok', 'exactly 2000 characters are accepted');

-- Duplicates within 24 hours: the same reporter, the same target, the same category
select pg_temp.report_as(:'wb', pg_temp.args('job', :'v2', p_category => 'discrimination')) as first_call \gset
select current_setting('t.ref') as first_ref \gset
select pg_temp.writes() as before_dup \gset
select is(pg_temp.report_as(:'wb', pg_temp.args('job', :'v2', p_category => 'discrimination', p_details => 'A second text, written an hour later.')), 'ok', 'AC: the same signed-in reporter reports the same vacancy again');
select is(format('%s|%s', current_setting('t.ref'), current_setting('t.dup')), format('%s|true', :'first_ref'), 'and gets the reference of the first report, marked as a duplicate');
select is(pg_temp.writes(), :'before_dup', 'nothing is stored and no audit row is written');
select is(pg_temp.report_as(:'wb', pg_temp.args('job', :'v2', p_category => 'harassment')), 'ok', 'another category is a new report');
select is(current_setting('t.dup'), 'false', 'which is not a duplicate');
select is(pg_temp.report_as(:'wb', pg_temp.args('job', :'v1', p_category => 'discrimination')), 'ok', 'so is another vacancy');
select is(current_setting('t.dup'), 'false', 'which is not a duplicate either');
select is(pg_temp.report_as(:'wa', pg_temp.args('job', :'v2', p_category => 'discrimination')), 'ok', 'and another reporter');
select is(current_setting('t.dup'), 'false', 'is not a duplicate of the first');
select is(pg_temp.report_as(:'wb', pg_temp.args('company', :'v2', p_category => 'discrimination')), 'ok', 'the same words about the company are another kind of report');
select is(current_setting('t.dup'), 'false', 'and not a duplicate');
update public.reports set created_at = now() - interval '25 hours' where reporter_user_id = :'wb' and category = 'discrimination' and target_type = 'job';
select is(pg_temp.report_as(:'wb', pg_temp.args('job', :'v2', p_category => 'discrimination')), 'ok', 'after 24 hours the same report is a new one');
select is(current_setting('t.dup'), 'false', 'which is not a duplicate');
select pg_temp.report_as(null, pg_temp.args('job', :'v2', p_email => 'Twice@Example.test', p_category => 'fee_demanded_from_worker')) as v_first \gset
select current_setting('t.ref') as v_ref \gset
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_email => 'twice@example.test', p_category => 'fee_demanded_from_worker')), 'ok', 'a visitor who gave an address reports again, in another case');
select is(format('%s|%s', current_setting('t.ref'), current_setting('t.dup')), format('%s|true', :'v_ref'), 'and gets the first reference');
select pg_temp.report_as(null, pg_temp.args('job', :'v2', p_category => 'privacy_violation')) as a1 \gset
select current_setting('t.ref') as a1_ref \gset
select pg_temp.report_as(null, pg_temp.args('job', :'v2', p_category => 'privacy_violation')) as a2 \gset
select isnt(current_setting('t.ref'), :'a1_ref', 'a visitor without an address cannot be told apart: the throttle is the limit');

-- Only one report of that kind is within the 24 hours
select is(
  (select count(*) from public.reports where reporter_user_id = :'wb' and target_type = 'job' and job_id = :'v2' and category = 'discrimination' and created_at > now() - interval '24 hours'), 1::bigint,
  'one report of that kind is within the 24 hours'
);

-- The throttle: ten reports per visitor and hour
delete from private.rate_limit_hits;
select string_agg(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_category => 'other', p_key => repeat('1', 64))), ',') as ten from generate_series(1, 10) g \gset
select is(:'ten'::text, 'ok,ok,ok,ok,ok,ok,ok,ok,ok,ok', 'the visitor makes ten reports');
select matches(
  pg_temp.report_as(null, pg_temp.args('job', :'v2', p_category => 'other', p_key => repeat('1', 64))), '^P0001\|CHARA_RATE_LIMITED\|[0-9]+$',
  'the eleventh is refused as rate limited'
);
select ok(
  (select split_part(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_key => repeat('1', 64))), '|', 3)::integer between 1 and 3600),
  'with the seconds to wait'
);
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_category => 'other', p_key => repeat('2', 64))), 'ok', 'another visitor is not affected');
select matches(pg_temp.report_as(:'wa', pg_temp.args('job', :'v1', p_category => 'other', p_key => repeat('1', 64))), '^P0001\|CHARA_RATE_LIMITED\|[0-9]+$', 'a signed-in user behind the same address shares the budget');
select is(pg_temp.report_as(null, pg_temp.args('job', :'v2', p_key => 'not a key')), 'P0001|CHARA_INVALID_INPUT|p_key', 'a key that is not 64 hex digits is refused');

-- With the Vault secret set the web tier's proof is required
select vault.create_secret(encode(extensions.hmac('rate_limit_attempt', 'test-visitor-hash-secret-0123456789abcdef', 'sha256'), 'hex'), 'rate_limit_proof_key') is not null as vault_set \gset
create function pg_temp.proof(p_action text, p_key text) returns text
language sql as $$
  select encode(extensions.hmac(
    p_action || '|' || p_key || '|' || floor(extract(epoch from now()) / 60)::bigint,
    encode(extensions.hmac('rate_limit_attempt', 'test-visitor-hash-secret-0123456789abcdef', 'sha256'), 'hex'), 'sha256'), 'hex')
$$;
select is(
  pg_temp.report_as(null, pg_temp.args('job', :'v2', p_category => 'other', p_key => repeat('3', 64))), '42501|CHARA_FORBIDDEN|p_proof',
  'AC: a call without the proof is refused'
);
select is(
  pg_temp.report_as(null, pg_temp.args('job', :'v2', p_category => 'other', p_key => repeat('3', 64), p_proof => pg_temp.proof('login', repeat('3', 64)))),
  '42501|CHARA_FORBIDDEN|p_proof', 'and so is the proof of another action'
);
select is(
  pg_temp.report_as(null, pg_temp.args('job', :'v2', p_category => 'other', p_key => repeat('3', 64), p_proof => pg_temp.proof('report', repeat('4', 64)))),
  '42501|CHARA_FORBIDDEN|p_proof', 'and the proof of another key'
);
select is(
  pg_temp.report_as(null, pg_temp.args('job', :'v2', p_category => 'other', p_key => repeat('3', 64), p_proof => pg_temp.proof('report', repeat('3', 64)))),
  'ok', 'the proof of the web tier for this key and action is accepted'
);
select is(
  (select count(*) from private.rate_limit_hits where action = 'report'), 3::bigint, 'the counters of the action report hold one row per visitor key'
);

select * from finish();
rollback;
