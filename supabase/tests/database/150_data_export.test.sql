begin;
select plan(103);

\ir status_fixture.inc

-- V29: the export of a user's own data (FR-S3 AC7 data, AC8 data, SOP P2-43 step Export and output "export covering
-- Phase 2 data"; NFR-S8, NFR-A3, NFR-A4, NFR-O5; GDPR Art. 15, 20; DATA_MODEL.md sections 6, 7, 9, 10):
-- request_data_export, list_my_data_exports, data_export_access_grant, the account-ops service functions, the
-- dsar-exports bucket, the data_export_ready notice, the data_exports retention and the erasure of the requests.

\set pow '00000000-0000-0000-0000-0000000f2901'
\set gow '00000000-0000-0000-0000-0000000f2902'
select pg_temp.new_user(:'pow');
select pg_temp.new_user(:'gow');
update public.profiles set account_kind = intended_account_kind where id in (:'pow', :'gow');

create function pg_temp.partner(p_owner uuid, p_type public.organization_type, p_slug text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

select pg_temp.partner(:'pow', 'recruitment_company', 'alpha-recruit') as alpha \gset
select pg_temp.partner(:'gow', 'staffing_company', 'gamma-staffing') as gamma \gset

-- p_sql (a call returning rows) as p_user: 'ok' with the rows in t.rows, or 'sqlstate|message|detail|hint'.
create function pg_temp.run(p_user uuid, p_sql text, p_aal text default 'aal1') returns text
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
  v_hint text;
  v_result text := 'ok';
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text end, true);
  execute format('set local role %I', case when p_user is null then 'anon' else 'authenticated' end);
  begin
    execute format('select set_config(''t.rows'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail,
      v_hint = pg_exception_hint;
    v_result := format('%s|%s|%s|%s', v_state, v_message, coalesce(v_detail, ''), coalesce(v_hint, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

create function pg_temp.rows() returns jsonb language sql as $$ select current_setting('t.rows')::jsonb $$;

create function pg_temp.ask(p_user uuid) returns text
language sql as $$ select pg_temp.run(p_user, 'select * from public.request_data_export()') $$;

create function pg_temp.mine(p_user uuid) returns jsonb
language plpgsql as $$
begin
  if pg_temp.run(p_user, 'select * from public.list_my_data_exports()') <> 'ok' then
    return null;
  end if;
  return pg_temp.rows();
end;
$$;

create function pg_temp.open(p_user uuid, p_export uuid) returns text
language sql as $$ select pg_temp.run(p_user, format('select * from public.data_export_access_grant(%L)', p_export)) $$;

-- Everything a request writes, to compare before and after a refused call.
create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.data_export_requests) || ',' || (select count(*) from pgmq.q_account_ops) || ','
      || (select count(*) from audit.log) || ',' || (select count(*) from pgmq.q_notifications)
$$;

create function pg_temp.service(p_sql text) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  set local role service_role;
  execute p_sql into v;
  reset role;
  return v;
end;
$$;

-- The release switch ---------------------------------------------------------------------------------------------------------

select is(
  (select s.value::text || '|' || r.value_type || '|' || coalesce(r.release_feature, 'none') from private.settings s
   join private.setting_rules r on r.key = s.key where s.key = 'release_data_export'),
  'false|boolean|none', 'release_data_export is a switch of its own, off by default, that needs no legal document'
);
select is((select value from public.get_public_settings() where key = 'release_data_export'), 'false',
  'the pages read it through get_public_settings');
-- Release 2a alone does not open the export.
update private.settings set value = 'true' where key = 'release_partner_directories';
select is(split_part(pg_temp.ask(:'wa'), '|', 3), 'release_off', 'switch off: a request is refused, even with release 2a on');
select is(split_part(pg_temp.run(:'wa', 'select * from public.list_my_data_exports()'), '|', 3), 'release_off',
  'switch off: the list is refused');
select is(split_part(pg_temp.open(:'wa', gen_random_uuid()), '|', 2), 'CHARA_NOT_FOUND', 'switch off: no download');
select is((select count(*)::integer from public.data_export_requests), 0, 'and nothing was written');

-- CHARA may switch the export on before release 2a.
update private.settings set value = 'false' where key = 'release_partner_directories';
update private.settings set value = 'true' where key = 'release_data_export';

select is(split_part(pg_temp.ask(null), '|', 1), '42501', 'an anonymous caller cannot ask for an export');
select is(split_part(pg_temp.run(null, 'select * from public.list_my_data_exports()'), '|', 1), '42501',
  'nor list exports');
select is(split_part(pg_temp.open(null, gen_random_uuid()), '|', 1), '42501', 'nor open one');

-- AC8: the request -----------------------------------------------------------------------------------------------------------

select pg_temp.writes() as before \gset
select is(pg_temp.ask(:'wa'), 'ok', 'AC8: a candidate asks for a copy of their data');
select (pg_temp.rows() -> 0 ->> 'export_id')::uuid as ex1 \gset
select is((select status::text || ':' || user_id from public.data_export_requests where id = :'ex1'), 'queued:' || :'wa',
  'AC8: one request is queued for the candidate');
select is(
  (select jsonb_agg(message - 'x') from pgmq.q_account_ops where message ->> 'action' = 'build_data_export'),
  jsonb_build_array(jsonb_build_object('action', 'build_data_export', 'user_id', :'wa', 'export_id', :'ex1')),
  'AC8: one export job is queued for account-ops'
);
select is(
  (select count(*)::integer from audit.log where action = 'data_export.requested' and entity_type = 'data_export'
     and entity_id = :'ex1' and actor_id = :'wa'),
  1, 'the request is audited against the candidate'
);

select pg_temp.writes() as before \gset
select is(pg_temp.ask(:'wa'), 'P0001|CHARA_RATE_LIMITED|export_pending|',
  'AC8: a second request while the first is being prepared is refused (An export is already being prepared)');
select is(pg_temp.writes(), :'before', 'and writes nothing');

select is(
  (select jsonb_agg(jsonb_build_object('id', e ->> 'id', 'state', e ->> 'state', 'next', e -> 'next_request_at'))
   from jsonb_array_elements(pg_temp.mine(:'wa')) e),
  jsonb_build_array(jsonb_build_object('id', :'ex1', 'state', 'preparing', 'next', null)),
  'the candidate lists the request as being prepared, without its path'
);
select ok(not (pg_temp.mine(:'wa') -> 0 ? 'storage_path'), 'the list never holds the storage path');
select is(pg_temp.mine(:'wb'), '[]'::jsonb, 'NFR-S8: the other candidate lists nothing of it');
select is(split_part(pg_temp.open(:'wa', :'ex1'), '|', 2), 'CHARA_NOT_FOUND', 'an export being prepared cannot be opened');

select is(pg_temp.ask(:'own1'), 'ok', 'a company user asks for a copy of their own data too');
select (pg_temp.rows() -> 0 ->> 'export_id')::uuid as ex_own \gset

-- AC7 (data): what account-ops reads ----------------------------------------------------------------------------------------

-- The candidate's data across Phase 1 and the Phase 2 tables built so far, and other people's data next to it.
select pg_temp.seed_app('interview', current_setting('t.a')::uuid, :'wa') as app_a \gset
update public.job_applications set cover_note = 'I have welded pipelines for ten years.' where id = :'app_a';
insert into public.application_notes (application_id, organization_id, author_id, body)
values (:'app_a', current_setting('t.a')::uuid, :'own1', 'SECRET-EMPLOYER-NOTE strong candidate');
select pg_temp.seed_app('applied', current_setting('t.a')::uuid, :'wb') as app_b \gset
select pg_temp.doc('00000000-0000-0000-0000-0000000d2901', :'wa');
select pg_temp.doc('00000000-0000-0000-0000-0000000d2902', :'wa');
update public.worker_documents set deleted_at = now() where id = '00000000-0000-0000-0000-0000000d2902';
select pg_temp.doc('00000000-0000-0000-0000-0000000d2903', :'wb');
select pg_temp.doc('00000000-0000-0000-0000-0000000d2904', :'wa', 'pending');
select pg_temp.doc('00000000-0000-0000-0000-0000000d2905', :'wa', 'rejected');
-- Rows that name other people next to the user: an opening of the candidate's document by an employer owner, the
-- candidate's share; for the company user an appeal decided by staff and a transfer to another member; for a member an
-- invitation sent by the owner.
insert into audit.document_access_log (share_id, document_id, worker_user_id, organization_id, accessed_by, purpose)
select a.passport_share_id, '00000000-0000-0000-0000-0000000d2901', :'wa', a.organization_id, :'own1', 'application_review'
from public.job_applications a where a.id = :'app_a';
insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id)
values ('organization', current_setting('t.a')::uuid, 'organization_suspended', 'SECRET-DECISION reasons of staff.', :'st_trust')
returning id as mod_action \gset
insert into public.appeals (moderation_action_id, organization_id, appellant_user_id, grounds, status, decided_by, reasons,
  due_at, decided_at)
values (:mod_action, current_setting('t.a')::uuid, :'own1', 'Our company did nothing wrong at all.', 'upheld', :'st_trust',
  'The decision stands for these reasons.', now() + interval '7 days', now());
insert into public.organization_ownership_transfers (organization_id, from_user_id, to_user_id)
values (current_setting('t.a')::uuid, :'own1', :'adm');
insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by, expires_at)
select current_setting('t.a')::uuid, u.email, 'member', encode(extensions.digest('secret-token', 'sha256'), 'hex'), :'own1', now() + interval '7 days'
from auth.users u where u.id = :'mem';
select is(pg_temp.ask(:'mem'), 'ok', 'a company member asks for a copy of their data too');
select (pg_temp.rows() -> 0 ->> 'export_id')::uuid as ex_mem \gset
insert into public.saved_jobs (worker_user_id, job_id) values (:'wa', pg_temp.open_job('Saved welder'));
insert into public.follows (user_id, organization_id) values (:'wa', current_setting('t.a')::uuid);
insert into public.reports (target_type, job_id, category, details, reporter_user_id, good_faith_confirmed, status, handled_by,
  handled_at, resolution_note)
values ('job', pg_temp.open_job('Reported vacancy'), 'misleading_or_fraud', 'The salary in this vacancy is not real.', :'wa', true,
  'dismissed', :'st_trust', now(), 'SECRET-STAFF-RESOLUTION');
insert into public.worker_skills (worker_user_id, skill) values (:'wa', 'MIG welding');

select pg_temp.service(format('select public.account_ops_export_data(%L)', :'ex1')) as data \gset

select is((:'data'::jsonb) ->> 'user_id', :'wa', 'AC7: the data is that of the requesting user');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((:'data'::jsonb) -> 'sections') k),
  array['account', 'activity', 'appeals', 'applications', 'consents', 'contact_requests', 'conversations', 'data_exports',
        'document_access', 'documents', 'followed_companies', 'job_invitations', 'messages', 'notification_preferences',
        'notifications', 'organization_invitations', 'organization_memberships', 'ownership_transfers', 'partner_responses',
        'passport', 'passport_shares', 'platform_roles', 'reports', 'requirements', 'saved_vacancies', 'submissions'],
  'AC7: one section per kind of data, each written as <section>.json'
);
select is((:'data'::jsonb) #>> '{sections,account,email}', (select email::text from auth.users where id = :'wa'),
  'AC7: the account holds the email address');
select is((:'data'::jsonb) #>> '{sections,passport,first_name}', 'Amina', 'AC7: the passport holds the name');
select is((:'data'::jsonb) #> '{sections,passport,skills}', '["MIG welding"]'::jsonb, 'and the skills');
select is(
  (select jsonb_agg(jsonb_build_object('vacancy', e ->> 'vacancy', 'employer', e ->> 'employer', 'status', e ->> 'status',
     'cover_note', e ->> 'cover_note', 'steps', jsonb_array_length(e -> 'history')))
   from jsonb_array_elements((:'data'::jsonb) #> '{sections,applications}') e),
  jsonb_build_array(jsonb_build_object('vacancy', 'Status vacancy', 'employer', 'Acme Bau', 'status', 'interview',
    'cover_note', 'I have welded pipelines for ten years.', 'steps', 1)),
  'AC7: the applications name the vacancy and the employer by display name, with the status history'
);
select is(
  (select jsonb_agg(jsonb_build_object('file', e -> 'file', 'note', e -> 'note')) from jsonb_array_elements((:'data'::jsonb) #> '{sections,documents}') e),
  '[{"file": "documents/00000000-0000-0000-0000-0000000d2901/cv.pdf", "note": null},
    {"file": null, "note": "Not included because the file has not passed its check."},
    {"file": null, "note": "Not included because the file has not passed its check."}]'::jsonb,
  'AC7: the documents list the current documents, not the deleted one; a pending or rejected one has no file and says why'
);
select is(
  (:'data'::jsonb) -> 'files',
  jsonb_build_array(jsonb_build_object('bucket_id', 'passport-documents',
    'path', :'wa' || '/00000000-0000-0000-0000-0000000d2901/cv.pdf',
    'name', 'documents/00000000-0000-0000-0000-0000000d2901/cv.pdf', 'size_bytes', 1000)),
  'AC7: the files to add are the candidate''s own checked files (not the pending or rejected ones), in their own folder'
);
select is((:'data'::jsonb) #>> '{sections,document_access,0,organization}', 'Acme Bau',
  'the openings of the candidate''s documents name the organisation');
select is((:'data'::jsonb) #>> '{sections,passport_shares,0,organization}', 'Acme Bau', 'the shares name the organisation');
select is(jsonb_array_length((:'data'::jsonb) #> '{sections,saved_vacancies}'), 1, 'the saved vacancies');
select is((:'data'::jsonb) #>> '{sections,followed_companies,0,company}', 'Acme Bau', 'the followed companies (Phase 2)');
select ok(jsonb_array_length((:'data'::jsonb) #> '{sections,consents}') >= 1, 'the consents');
select is(
  ((:'data'::jsonb) #> '{sections,reports,0}') - 'reported_at'::text - 'closed_at'::text - 'reference'::text,
  '{"about": "job", "status": "dismissed", "details": "The salary in this vacancy is not real.", "category": "misleading_or_fraud"}'::jsonb,
  'the reports the candidate made, with their outcome'
);
select ok((:'data'::jsonb) #> '{sections,activity}' @> '[{"action": "data_export.requested", "about": "data_export"}]',
  'the candidate''s own activity from the audit log');
select is((:'data'::jsonb) #> '{sections,data_exports,0,ready_at}', 'null'::jsonb, 'and the request itself');
select ok(
  position('SECRET-EMPLOYER-NOTE' in :'data') = 0 and position('SECRET-STAFF-RESOLUTION' in :'data') = 0,
  'AC7: the internal notes of the employer and of staff are left out'
);
select ok(
  position(:'own1' in :'data') = 0 and position(:'st_trust' in :'data') = 0 and position(:'wb' in :'data') = 0
    and position('Bruno' in :'data') = 0 and position('0000000d2903' in :'data') = 0,
  'AC7: no other person''s id, name or document appears, and no staff member'
);
select pg_temp.service(format('select public.account_ops_export_data(%L)', :'ex_own')) as data_own \gset
select pg_temp.service(format('select public.account_ops_export_data(%L)', :'ex_mem')) as data_mem \gset
select is((:'data_own'::jsonb) #>> '{sections,organization_memberships,0,organization}', 'Acme Bau',
  'the company user''s export holds the organisation they belong to');
select is(
  ((:'data_own'::jsonb) #> '{sections,appeals,0}') - 'lodged_at'::text - 'decided_at'::text,
  '{"organization": "Acme Bau", "grounds": "Our company did nothing wrong at all.", "status": "upheld", "reasons": "The decision stands for these reasons."}'::jsonb,
  'the company user''s appeal with its outcome and reasons'
);
select is((:'data_own'::jsonb) #>> '{sections,ownership_transfers,0,direction}', 'given', 'the transfer the owner gave');
select ok(
  position(:'adm' in :'data_own') = 0 and position(:'st_trust' in :'data_own') = 0 and position(:'wa' in :'data_own') = 0
    and position('SECRET-DECISION' in :'data_own') = 0,
  'AC7: the company user''s export names neither the decider of the appeal nor the new owner'
);
select is((:'data_mem'::jsonb) #>> '{sections,organization_invitations,0,organization}', 'Acme Bau',
  'a member''s export holds the invitation they received');
select ok(
  position(:'own1' in :'data_mem') = 0 and position(encode(extensions.digest('secret-token', 'sha256'), 'hex') in :'data_mem') = 0,
  'AC7: without who sent it or its token'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', format('select public.account_ops_export_data(%L)', :'ex1'), 'aal1'),
  '42501|permission denied for function account_ops_export_data|', 'the data function is not the user''s to call'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', format('select public.account_ops_export_ready(%L, 10)', :'ex1'), 'aal1'),
  '42501|permission denied for function account_ops_export_ready|', 'nor is marking an export ready'
);

-- The bucket -----------------------------------------------------------------------------------------------------------------

select is(
  (select public::text || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'dsar-exports'),
  'false:52428800:application/zip', 'the bucket dsar-exports is private, 50 MB, zip only'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and (qual like '%dsar-exports%' or with_check like '%dsar-exports%')),
  0, 'no storage policy opens the bucket to any API role: downloads go through document-url only'
);
select throws_ok(
  format($$insert into storage.objects (bucket_id, name) values ('dsar-exports', %L)$$, :'wa' || '/' || gen_random_uuid() || '.zip'),
  '42501', 'CHARA_NOT_FOUND', 'a file at the name of no request is refused'
);
select throws_ok(
  format($$insert into storage.objects (bucket_id, name) values ('dsar-exports', %L)$$, :'wb' || '/' || :'ex1' || '.zip'),
  '42501', 'CHARA_NOT_FOUND', 'a file of a request in another user''s folder is refused'
);
select lives_ok(
  format($$insert into storage.objects (bucket_id, name) values ('dsar-exports', %L)$$, :'wa' || '/' || :'ex1' || '.zip'),
  'the file of a request being prepared is accepted at <user>/<request>.zip'
);
select throws_ok(
  format($$update storage.objects set name = %L where bucket_id = 'dsar-exports' and name = %L$$,
    :'wa' || '/' || gen_random_uuid() || '.zip', :'wa' || '/' || :'ex1' || '.zip'),
  '42501', 'CHARA_NOT_FOUND', 'the file cannot be renamed to the name of no request'
);

-- AC8: ready and the notice --------------------------------------------------------------------------------------------------

select is(pg_temp.service(format('select to_jsonb(public.account_ops_export_ready(%L, 4321, 2))', :'ex1')), 'true'::jsonb,
  'AC8: account-ops marks the export ready');
select is((pg_temp.mine(:'wa') -> 0 ->> 'files_left_out')::integer, 2, 'the list says how many documents were not included');
select is(
  (select status || '|' || storage_path || '|' || size_bytes || '|' || (expires_at = ready_at + interval '7 days')
   from public.data_export_requests where id = :'ex1'),
  'ready|' || :'wa' || '/' || :'ex1' || '.zip|4321|true',
  'AC8: the file is kept for the data_exports period (7 days)'
);
select is(
  (select jsonb_agg(message - 'expires_at') from pgmq.q_notifications where message ->> 'kind' = 'data_export_ready'),
  jsonb_build_array(jsonb_build_object('kind', 'data_export_ready', 'user_id', :'wa', 'mandatory', true, 'export_id', :'ex1')),
  'AC8, NFR-A3: one mandatory data_export_ready notice is queued in the same transaction'
);
select is(
  (select count(*)::integer from audit.log where action = 'data_export.ready' and entity_id = :'ex1' and actor_id = :'wa'),
  1, 'the build is audited against the user'
);
select is(pg_temp.service(format('select to_jsonb(public.account_ops_export_ready(%L, 4321))', :'ex1')), 'false'::jsonb,
  'a second call finds it ready and does nothing');
select is((select count(*)::integer from pgmq.q_notifications where message ->> 'kind' = 'data_export_ready'), 1,
  'and queues no second notice');
select is(pg_temp.service(format('select public.account_ops_export_data(%L)', :'ex1')), null,
  'a build job read again after the export is ready reads nothing');
select is(
  private.notification_payload('data_export_ready', jsonb_build_object('kind', 'data_export_ready', 'user_id', :'wa',
    'export_id', :'ex1', 'expires_at', '2026-12-17T08:00:00+00:00', 'path', 'x')),
  jsonb_build_object('export_id', :'ex1', 'expires_at', '2026-12-17T08:00:00+00:00'),
  'the notice payload holds the request and the expiry only'
);
select is(
  (select mandatory::text || ':' || audience from private.notification_kinds where kind = 'data_export_ready'),
  'true:all', 'data_export_ready is a mandatory kind for every account'
);

-- AC8: the download ----------------------------------------------------------------------------------------------------------

select is(pg_temp.open(:'wa', :'ex1'), 'ok', 'AC8: the owner opens the ready export');
select is(
  pg_temp.rows() -> 0,
  jsonb_build_object('bucket_id', 'dsar-exports', 'object_path', :'wa' || '/' || :'ex1' || '.zip',
    'file_name', 'chara-pinnacle-data-' || to_char(now() at time zone 'utc', 'YYYY-MM-DD') || '.zip'),
  'AC8: document-url signs the zip in the private bucket'
);
select is(
  (select count(*)::integer from audit.log where action = 'data_export.downloaded' and entity_id = :'ex1' and actor_id = :'wa'),
  1, 'every download is audited'
);
select is(split_part(pg_temp.open(:'wb', :'ex1'), '|', 2), 'CHARA_NOT_FOUND', 'NFR-S8: the other candidate cannot open it');
select is(split_part(pg_temp.open(:'own1', :'ex1'), '|', 2), 'CHARA_NOT_FOUND', 'NFR-S8: an employer cannot');
select is(split_part(pg_temp.open(:'pow', :'ex1'), '|', 2), 'CHARA_NOT_FOUND', 'NFR-S8: a partner cannot');
select is(split_part(pg_temp.run(:'st_admin', format('select * from public.data_export_access_grant(%L)', :'ex1'), 'aal2'), '|', 2),
  'CHARA_NOT_FOUND', 'NFR-S8: a Platform Administrator cannot either');

select matches(pg_temp.ask(:'wa'), '^P0001\|CHARA_RATE_LIMITED\|export_recent\|',
  'AC8: a new request within 24 hours of the last one is refused');
select is(split_part(pg_temp.ask(:'wa'), '|', 4)::timestamptz, (select requested_at + interval '24 hours' from public.data_export_requests where id = :'ex1'),
  'and says from when a new one is accepted');
select is(
  (select jsonb_build_object('state', e ->> 'state', 'next', (e ->> 'next_request_at')::timestamptz = (select requested_at + interval '24 hours' from public.data_export_requests where id = :'ex1'))
   from jsonb_array_elements(pg_temp.mine(:'wa')) e),
  '{"state": "ready", "next": true}'::jsonb, 'the list shows it ready and when a new request is accepted'
);

-- The link is refused once the export has expired.
update public.data_export_requests set expires_at = now() - interval '1 second' where id = :'ex1';
select is(split_part(pg_temp.open(:'wa', :'ex1'), '|', 2), 'CHARA_NOT_FOUND', 'AC8: an expired export cannot be opened');
select is(pg_temp.mine(:'wa') -> 0 ->> 'state', 'expired', 'and is listed as expired');

-- NFR-O5: the interval is a setting.
update private.settings set value = '1' where key = 'data_export_interval_hours';
update public.data_export_requests set requested_at = now() - interval '2 hours' where id = :'ex1';
select is(pg_temp.ask(:'wa'), 'ok', 'NFR-O5: with an interval of one hour, a request two hours after the last is accepted');
select (pg_temp.rows() -> 0 ->> 'export_id')::uuid as ex2 \gset
update public.data_export_requests set requested_at = now() - interval '90 minutes' where id = :'ex2';
select is(pg_temp.mine(:'wa') -> 0 ->> 'state', 'failed', 'a request still queued after the interval (its job was abandoned) is listed as failed');
select is(pg_temp.ask(:'wa'), 'ok', 'and does not block a new request');
select (pg_temp.rows() -> 0 ->> 'export_id')::uuid as ex3 \gset
update private.settings set value = '24' where key = 'data_export_interval_hours';
update private.settings set value = '"x"' where key = 'data_export_interval_hours';
select is(private.data_export_interval(), interval '24 hours', 'an interval setting that is not a number falls back to 24 hours');
update private.settings set value = '24' where key = 'data_export_interval_hours';
select is(
  (select value_type || ':' || min || ':' || max from private.setting_rules where key = 'data_export_interval_hours'),
  'integer:1:168', 'NFR-O5: the settings editor accepts 1 to 168 hours'
);

-- NFR-A4: two requests of one user at the same moment. The other session holds the lock of the user, as a request in
-- progress would; the request of this session waits for it.
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('other',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_exec('other', 'begin');
select x from extensions.dblink('other', format($$select 1 from (select pg_advisory_xact_lock(hashtextextended('data_export:%s', 0))) l$$, :'wb')) as t (x integer);
set local lock_timeout = '300ms';
select is(split_part(pg_temp.ask(:'wb'), '|', 1), '55P03', 'NFR-A4: a second request of a user waits for the first');
reset lock_timeout;
select extensions.dblink_exec('other', 'rollback');
select extensions.dblink_disconnect('other');
select is((select count(*)::integer from public.data_export_requests where user_id = :'wb'), 0, 'and nothing was written for it');

-- NFR-S8: direct reads and writes of the table ------------------------------------------------------------------------------

select is(pg_temp.call_as(:'wa', 'authenticated', 'select count(*) from public.data_export_requests', 'aal1'),
  '42501|permission denied for table data_export_requests|', 'NFR-S8: a candidate cannot select the table, not even their rows');
select is(pg_temp.call_as(:'wb', 'authenticated', 'select count(*) from public.data_export_requests', 'aal1'),
  '42501|permission denied for table data_export_requests|', 'NFR-S8: the other candidate cannot');
select is(pg_temp.call_as(:'own1', 'authenticated', 'select count(*) from public.data_export_requests'),
  '42501|permission denied for table data_export_requests|', 'NFR-S8: an employer owner cannot');
select is(pg_temp.call_as(:'own2', 'authenticated', 'select count(*) from public.data_export_requests'),
  '42501|permission denied for table data_export_requests|', 'NFR-S8: the other employer cannot');
select is(pg_temp.call_as(:'pow', 'authenticated', 'select count(*) from public.data_export_requests'),
  '42501|permission denied for table data_export_requests|', 'NFR-S8: a partner owner cannot');
select is(pg_temp.call_as(:'gow', 'authenticated', 'select count(*) from public.data_export_requests'),
  '42501|permission denied for table data_export_requests|', 'NFR-S8: the other partner cannot');
select is(pg_temp.call_as(null, 'anon', 'select count(*) from public.data_export_requests'),
  '42501|permission denied for table data_export_requests|', 'NFR-S8: an anonymous caller cannot');
select is(pg_temp.call_as(:'wa', 'authenticated', format('update public.data_export_requests set expires_at = now() + interval ''1 year'' where id = %L', :'ex3'), 'aal1'),
  '42501|permission denied for table data_export_requests|', 'NFR-S8: a candidate cannot extend their export');
select is(pg_temp.call_as(:'wa', 'authenticated', format('insert into public.data_export_requests (user_id) values (%L)', :'wa'), 'aal1'),
  '42501|permission denied for table data_export_requests|', 'NFR-S8: nor write a request directly');
select is(pg_temp.call_as(:'wa', 'authenticated', 'delete from public.data_export_requests', 'aal1'),
  '42501|permission denied for table data_export_requests|', 'NFR-S8: nor delete one');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.data_export_requests'::regclass),
  'NFR-S8: row level security is enabled and forced'
);

-- Retention: data exports, 7 days (AC8 "the zip is deleted after 7 days") ----------------------------------------------------

select is(
  (select days || ':' || editable from private.retention_policies where entity = 'data_exports'),
  '7:true', 'the data_exports period is seeded at 7 days and editable in the retention editor'
);
-- ex1: ready, expired a second ago. A ready one that expires tomorrow, a queued one 8 days old and one 6 days old.
insert into public.data_export_requests (id, user_id, status, requested_at, ready_at, expires_at, storage_path) values
  ('00000000-0000-0000-0000-00000000e291', :'wb', 'ready', now() - interval '6 days', now() - interval '6 days',
   now() + interval '1 day', :'wb' || '/00000000-0000-0000-0000-00000000e291.zip');
insert into public.data_export_requests (id, user_id, requested_at) values
  ('00000000-0000-0000-0000-00000000e292', :'wb', now() - interval '8 days'),
  ('00000000-0000-0000-0000-00000000e293', :'gow', now() - interval '6 days');
delete from pgmq.q_account_ops;

select lives_ok('select private.apply_retention()', 'the daily retention job runs');
select is(
  (select string_agg(id::text, ',' order by id) from public.data_export_requests
   where id in (:'ex1', '00000000-0000-0000-0000-00000000e291', '00000000-0000-0000-0000-00000000e292', '00000000-0000-0000-0000-00000000e293')),
  '00000000-0000-0000-0000-00000000e291,00000000-0000-0000-0000-00000000e293',
  'AC8: the expired export and the queued one older than 7 days are deleted; the others are kept'
);
select is(
  (select jsonb_agg(message order by msg_id) from pgmq.q_account_ops),
  jsonb_build_array(jsonb_build_object('action', 'delete_object', 'user_id', :'wa', 'bucket_id', 'dsar-exports',
    'path', :'wa' || '/' || :'ex1' || '.zip')),
  'AC8: the removal of the expired zip is queued for account-ops, in the folder of its user'
);
select is(
  (select metadata - 'request_id' from audit.log where action = 'retention.run' and entity_id = 'data_exports' order by id desc limit 1),
  '{"days": 7, "removed": 2}'::jsonb, 'the run is audited with the period and the count'
);
select lives_ok('select private.apply_retention()', 'a second run the same day');
select is(
  (select metadata - 'request_id' from audit.log where action = 'retention.run' and entity_id = 'data_exports' order by id desc limit 1),
  '{"days": 7, "removed": 0}'::jsonb, 'removes nothing and records 0'
);

-- Erasure: the requests go with the account, and the build job then reads nothing ---------------------------------------------

update public.profiles set deleted_at = now() - interval '31 days' where id = :'wa';
select is(pg_temp.call_as(null, 'service_role', format('select public.erase_user(%L)', :'wa')), 'ok', 'erase_user runs for the candidate');
select is((select count(*)::integer from public.data_export_requests where user_id = :'wa'), 0,
  'the erased candidate''s export requests are deleted with the profile (account-ops then purges their folder in dsar-exports)');
select is(pg_temp.service(format('select public.account_ops_export_data(%L)', :'ex3')), null,
  'a build job of the erased candidate that is still queued reads nothing');

select * from finish();
rollback;
