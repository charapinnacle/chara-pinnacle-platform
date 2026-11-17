begin;
select plan(15);

-- The personal-data catalogue (V19; FR-S3 AC9; SOP P2-43 step Check and control "tests for every new table";
-- DATA_MODEL.md section 10). Every table that holds a user id or an email address is listed below with how account
-- erasure handles it and which retention period applies, or with the reason why none does. A table found in the database
-- that the list does not name fails the first test, so a later unit that adds one has to decide both. A table is found
-- when a column refers to auth.users, public.profiles or public.worker_profiles, when a uuid column is named like a user
-- (user_id, *_user_id, *_by, actor_id, author_id, sender_id, recipient_id, owner_id, member_id, worker_id, candidate_id), when a text column is named email or *_email, or when a column holds an address
-- (inet).
--   erasure:   erase_user  the table is named in public.erase_user, which deletes or pseudonymises its rows
--              cascade     every user column refers to a user table with on delete cascade or set null, so the
--                          deletion of the profile by erase_user removes or clears it
--              any other   the reason why erasure leaves the table alone
--   retention: policy:<e>  a row <e> of private.retention_policies, applied by a private function that names the table
--              any other   the reason why the table has no period
--   export:    export:<s>  the table is read by public.account_ops_export_data into the section <s> of the user's copy
--                          (FR-S3 AC7, V29), which becomes <s>.json in the zip
--              any other   the reason why the user's copy leaves the table out

create temp table catalogue (tbl text primary key, erasure text not null, retention text not null, export text not null);
insert into catalogue values
  ('audit.document_access_log', 'erase_user', 'policy:document_access_log', 'export:document_access'),
  ('audit.log', 'erase_user', 'policy:audit_log', 'export:activity'),
  ('public.appeals', 'cascade', 'policy:closed_appeals', 'export:appeals'),
  ('audit.partner_document_access_log',
   'accessed_by is a Verification Reviewer, a Trust & Safety Administrator or an owner or admin of the partner, never a candidate: erase_user erases candidate accounts only',
   'policy:partner_document_access_log',
   'the access record of an organisation''s licence evidence: a security record about the organisation''s file'),
  ('private.login_failures', 'cascade', 'policy:login_failures',
   'a counter of failed sign-ins per time window, kept 30 days, with no content of its own'),
  ('public.application_notes', 'erase_user', 'kept with the application it belongs to; applications have no period yet (OPEN_QUESTIONS.md L6)',
   'the internal notes of an employer about an application, written by another person; left out like staff notes'),
  ('public.application_events', 'erase_user',
   'kept with the application it belongs to; applications have no period yet (OPEN_QUESTIONS.md L6)', 'export:applications'),
  ('public.consents', 'erase_user', 'consent evidence is kept for the life of the account (GDPR Art. 7(1)) and pseudonymised at erasure',
   'export:consents'),
  ('public.data_export_requests', 'cascade', 'policy:data_exports', 'export:data_exports'),
  ('public.direct_hiring_rules', 'cascade',
   'platform configuration kept while the rule applies; updated_by is a Platform Administrator, cleared with the profile, and the change history is in audit.log',
   'platform configuration written by a Platform Administrator; updated_by only names who changed a rule last'),
  ('public.follows', 'cascade',
   'a follow lasts until the user removes it or the account ends (FR-L4); the followed company reads a count only',
   'export:followed_companies'),
  ('public.job_applications', 'erase_user', 'applications have no period yet (OPEN_QUESTIONS.md L6); pseudonymised at erasure',
   'export:applications'),
  ('public.jobs', 'cascade', 'organisation data: a vacancy follows its organisation; the creator link is cleared at erasure',
   'organisation data: the vacancies of an employer; created_by only names the member who wrote one'),
  ('public.moderation_actions', 'actor_id is a platform staff member, and erase_user refuses staff accounts',
   'the statement of reasons of a moderation decision has no period yet (OPEN_QUESTIONS.md L6)',
   'the staff record of decisions on organisations and vacancies; members read them through list_my_appeals'),
  ('public.notification_preferences', 'erase_user', 'one row per account, deleted with the account', 'export:notification_preferences'),
  ('public.notifications', 'erase_user', 'policy:notifications', 'export:notifications'),
  ('public.organization_invitations',
   'email is the invited address of a company invitation, never a candidate account; invited_by is cleared with the profile',
   'policy:organization_invitations', 'export:organization_invitations'),
  ('public.organization_members', 'cascade', 'a membership lasts as long as the account and ends with it', 'export:organization_memberships'),
  ('public.organization_ownership_transfers', 'cascade', 'a transfer lives with the memberships of both accounts and is deleted with either',
   'export:ownership_transfers'),
  ('public.partner_licences', 'cascade',
   'organisation data kept until the partner removes the entry (Phase 3 badge history); replaced and removed files follow licence_evidence',
   'organisation data: the licences of a partner company, not the personal data of a member'),
  ('public.partner_review_decisions', 'decided_by is a platform staff member, and erase_user refuses staff accounts',
   'the append-only review record of an organisation is kept with the organisation',
   'the staff review record of an organisation; it names a staff member, whom the export never names'),
  ('public.passport_shares', 'erase_user', 'kept with the application it was given for; revoked and pseudonymised at erasure',
   'export:passport_shares'),
  ('public.platform_staff', 'cascade', 'a staff role lasts as long as the account', 'export:platform_roles'),
  ('public.profiles', 'erase_user', 'the account itself; inactive candidate accounts are put up for deletion after inactive_worker_data',
   'export:account'),
  ('public.reports', 'erase_user', 'policy:closed_reports', 'export:reports'),
  ('public.saved_items', 'cascade',
   'organisation data kept until a member removes the partner (FR-L4); saved_by is cleared with the account',
   'organisation data: the partners an employer saved; saved_by only names the member who saved one'),
  ('public.saved_jobs', 'cascade', 'policy:saved_jobs', 'export:saved_vacancies'),
  ('public.saved_searches', 'cascade',
   'organisation data kept until a member deletes the search (FR-L3); created_by is cleared with the account',
   'organisation data: the Find Employers searches a partner saved; created_by only names the member who saved one'),
  ('public.worker_documents', 'erase_user', 'policy:deleted_worker_documents', 'export:documents'),
  ('public.worker_languages', 'cascade', 'passport data deleted with the passport; inactive accounts are put up for deletion after inactive_worker_data',
   'export:passport'),
  ('public.worker_preferred_countries', 'cascade', 'passport data deleted with the passport; inactive accounts are put up for deletion after inactive_worker_data',
   'export:passport'),
  ('public.worker_profiles', 'erase_user', 'the passport; inactive accounts are put up for deletion after inactive_worker_data', 'export:passport'),
  ('public.worker_training', 'cascade', 'passport data deleted with the passport; inactive accounts are put up for deletion after inactive_worker_data',
   'export:passport'),
  ('public.worker_employment_history', 'cascade', 'passport data deleted with the passport; inactive accounts are put up for deletion after inactive_worker_data',
   'export:passport'),
  ('public.worker_preferred_industries', 'cascade', 'passport data deleted with the passport; inactive accounts are put up for deletion after inactive_worker_data',
   'export:passport'),
  ('public.worker_preferred_employment_types', 'cascade', 'passport data deleted with the passport; inactive accounts are put up for deletion after inactive_worker_data',
   'export:passport'),
  ('public.worker_skills', 'cascade', 'passport data deleted with the passport; inactive accounts are put up for deletion after inactive_worker_data',
   'export:passport'),
  ('public.worker_work_authorizations', 'cascade', 'passport data deleted with the passport; inactive accounts are put up for deletion after inactive_worker_data',
   'export:passport'),
  ('public.workforce_requirements', 'cascade',
   'organisation data: a requirement belongs to its employer; closed requirements follow closed_requirements (730 days), applied from V58',
   'organisation data: the workforce requirements of an employer; created_by only names the member who wrote one'),
  ('public.requirement_invitations', 'cascade',
   'organisation data: an invitation lives with its requirement (closed requirements follow closed_requirements, 730 days, applied from V58); invited_by is cleared with the profile',
   'organisation data: the invitations between an employer and a partner company; invited_by only names the member who sent one'),
  ('public.requirement_versions', 'cascade',
   'organisation data: a version lives with its requirement (closed requirements follow closed_requirements, 730 days, applied from V58); changed_by is cleared with the profile',
   'organisation data: the edit history of an employer''s workforce requirements; changed_by only names the member who saved an edit'),
  ('public.partner_responses', 'cascade',
   'organisation data: a response lives with its requirement (responses and closed requirements follow partner_responses and closed_requirements, 730 days, applied from V58); created_by and decided_by are cleared with the profile',
   'organisation data: the proposals between a partner company and an employer; created_by and decided_by only name the members who sent or decided one'),
  ('public.partner_response_versions', 'cascade',
   'organisation data: a version lives with its response; created_by is cleared with the profile',
   'organisation data: the version history of a partner company''s proposal; created_by only names the member who wrote a version'),
  ('public.partner_response_documents', 'cascade',
   'organisation data: a supporting document lives with its response (partner_responses, 730 days, applied from V58); staged files that never reach a response are dropped by the daily clean-up; uploaded_by is cleared with the profile',
   'organisation data: the supporting documents of a partner company''s proposal; uploaded_by only names the member who added one'),
  ('public.candidate_submissions',
   'worker_user_id carries no foreign key, as on job_applications: erase_user deletes the candidate''s submissions and their shares from V58 (DATA_MODEL.md section 10), before release 2b goes live; submitted_by is cleared with the profile',
   'candidate_submissions (730 days after the requirement closed or the submission was withdrawn) is applied from V58, before release 2b goes live',
   'the candidate''s copy gains the own submissions with V58 (FR-S3), before release 2b goes live; the address a partner entered is not the candidate''s data until the candidate approves'),
  ('public.submission_events', 'cascade',
   'an event lives with its submission (candidate_submissions, applied from V58); actor_id is cleared with the profile',
   'the history of a submission, exported with the submissions from V58; actor_id only names who moved it'),
  ('public.submission_notes', 'cascade',
   'an internal note lives with its submission (candidate_submissions, applied from V58); author_id is cleared with the profile',
   'organisation data: the employer''s internal notes on a submitted candidate, never shown to the candidate (as application_notes); author_id only names the member who wrote one'),
  ('public.workforce_availability', 'cascade', 'an organisation listing kept while the partner lists it; stale listings are hidden (FR-K3)',
   'organisation data: the availability listings of a partner company');

-- V58 applies the periods of the job order network, erases the candidate's submissions and exports the rows a user wrote.
update catalogue k set erasure = v.erasure, retention = v.retention, export = v.export
from (values
  ('public.workforce_requirements', 'cascade', 'policy:closed_requirements', 'export:requirements'),
  ('public.requirement_invitations', 'cascade',
   'organisation data: an invitation is deleted with its requirement (closed_requirements); invited_by is cleared with the profile',
   'organisation data: the invitations between an employer and a partner company; invited_by only names the member who sent one'),
  ('public.requirement_versions', 'cascade',
   'organisation data: a version is deleted with its requirement (closed_requirements); changed_by is cleared with the profile',
   'organisation data: the edit history of an employer''s workforce requirements; changed_by only names the member who saved an edit'),
  ('public.partner_responses', 'cascade', 'policy:partner_responses', 'export:partner_responses'),
  ('public.partner_response_versions', 'cascade',
   'organisation data: a version is deleted with its response (partner_responses); created_by is cleared with the profile',
   'organisation data: the version history of a partner company''s proposal; created_by only names the member who wrote a version'),
  ('public.partner_response_documents', 'cascade',
   'organisation data: a supporting document is deleted with its response (partner_responses) and its file queued for removal; staged files that never reach a response are dropped by the daily clean-up; uploaded_by is cleared with the profile',
   'organisation data: the supporting documents of a partner company''s proposal; uploaded_by only names the member who added one'),
  ('public.candidate_submissions', 'erase_user', 'policy:candidate_submissions', 'export:submissions'),
  ('public.submission_events', 'cascade',
   'an event is deleted with its submission (candidate_submissions); actor_id is cleared with the profile', 'export:submissions'),
  ('public.submission_notes', 'cascade',
   'an internal note is deleted with its submission (candidate_submissions); author_id is cleared with the profile',
   'organisation data: the employer''s internal notes on a submitted candidate, never shown to the candidate (as application_notes); author_id only names the member who wrote one')
) as v (tbl, erasure, retention, export)
where k.tbl = v.tbl;

-- The user columns of every table of the five application schemas, extension tables left out.
create function pg_temp.user_columns() returns table (tbl text, col text, refers_on_delete "char")
language sql stable as $$
  select format('%s.%s', n.nspname, c.relname), a.attname::text,
    (select k.confdeltype from pg_constraint k
     where k.conrelid = c.oid and k.contype = 'f' and a.attnum = any (k.conkey)
       and k.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass, 'public.worker_profiles'::regclass)
     limit 1)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'private', 'audit', 'billing', 'stats')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
    and (
      exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and a.attnum = any (k.conkey)
              and k.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass, 'public.worker_profiles'::regclass))
      or (a.atttypid = 'uuid'::regtype and a.attname ~ '((^|_)user_id|_by|^(actor|author|sender|recipient|owner|member|worker|candidate)_id)$')
      or (a.atttypid in ('text'::regtype, 'extensions.citext'::regtype) and a.attname ~ '(^|_)email$')
      or a.atttypid = 'inet'::regtype
    )
$$;

create function pg_temp.uncovered() returns text
language sql stable as $$
  select coalesce(string_agg(distinct u.tbl, ',' order by u.tbl), '')
  from pg_temp.user_columns() u where u.tbl not in (select tbl from catalogue)
$$;

select is(pg_temp.uncovered(), '', 'AC9: every table with a user id or an email address is in the catalogue');
select is(
  (select coalesce(string_agg(tbl, ',' order by tbl), '') from catalogue where tbl not in (select tbl from pg_temp.user_columns())),
  '', 'and every catalogue entry still holds a user column'
);
select is(
  (select coalesce(string_agg(tbl, ',' order by tbl), '') from catalogue
   where erasure = 'erase_user' and position(tbl in pg_get_functiondef('public.erase_user(uuid)'::regprocedure)) = 0),
  '', 'AC9: every table said to be handled by erase_user is named there'
);
select is(
  (select coalesce(string_agg(distinct u.tbl || '.' || u.col, ',' order by u.tbl || '.' || u.col), '')
   from catalogue k join pg_temp.user_columns() u on u.tbl = k.tbl
   where k.erasure = 'cascade' and u.refers_on_delete is distinct from 'c' and u.refers_on_delete is distinct from 'n'),
  '', 'AC9: every user column of a table erased by cascade refers to a user table with on delete cascade or set null'
);
select is(
  (select coalesce(string_agg(k.tbl, ',' order by k.tbl), '') from catalogue k
   where k.retention like 'policy:%'
     and not (
       exists (select 1 from private.retention_policies p where p.entity = substr(k.retention, 8))
       and exists (select 1 from pg_proc f where f.pronamespace = 'private'::regnamespace
                   and f.prosrc like '%''' || substr(k.retention, 8) || '''%' and f.prosrc like '%' || k.tbl || '%')
     )),
  '', 'AC9: every period named has a row in retention_policies and a private function that applies it to the table'
);
select is(
  (select coalesce(string_agg(tbl, ',' order by tbl), '') from catalogue
   where (erasure not in ('erase_user', 'cascade') and char_length(erasure) < 30)
      or (retention not like 'policy:%' and char_length(retention) < 30)
      or (export not like 'export:%' and char_length(export) < 30)),
  '', 'AC9: every table left alone by erasure, retention or the export states its reason'
);

-- The export: every table said to be exported is read by the export function, into a section the function returns.
select is(
  (select coalesce(string_agg(tbl, ',' order by tbl), '') from catalogue
   where export like 'export:%' and position(tbl in pg_get_functiondef('public.account_ops_export_data(uuid)'::regprocedure)) = 0),
  '', 'AC9: every table said to be in the export is read by account_ops_export_data'
);
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-0000000c1401', 'catalogue@example.test', '{"intended_account_kind": "worker"}');
insert into public.data_export_requests (id, user_id) values ('00000000-0000-0000-0000-0000000c1402', '00000000-0000-0000-0000-0000000c1401');
select is(
  (select coalesce(string_agg(tbl, ',' order by tbl), '') from catalogue
   where export like 'export:%'
     and not (public.account_ops_export_data('00000000-0000-0000-0000-0000000c1402') -> 'sections') ? substr(export, 8)),
  '', 'AC9: every section named is one the export writes'
);
select is(
  (select count(*)::integer from jsonb_object_keys(public.account_ops_export_data('00000000-0000-0000-0000-0000000c1402') -> 'sections') k
   where k not in (select substr(export, 8) from catalogue where export like 'export:%')),
  0, 'and the export writes no section the catalogue does not name'
);

-- The notes of an employer about a candidate go with the candidate: erase_user deletes the notes of the candidate's
-- applications (the behaviour is tested in 065_application_notes), whoever wrote them.
select ok(
  pg_get_functiondef('public.erase_user(uuid)'::regprocedure)
    ~ 'delete from public\.application_notes n using public\.job_applications a\s+where a\.id = n\.application_id and a\.worker_user_id = p_user_id',
  'AC9: erase_user deletes the notes on the applications of the erased candidate'
);

-- The test fails for a new table that holds a user id and is in none of the lists.
create table public.catalogue_probe (id uuid primary key, owner_user_id uuid references public.profiles (id));
create table private.catalogue_probe_log (id bigint primary key, contact_email text);
create table public.catalogue_probe_note (id bigint primary key, author_id uuid, body text);
select is(pg_temp.uncovered(), 'private.catalogue_probe_log,public.catalogue_probe,public.catalogue_probe_note',
  'AC9: a new table with a user id, an author id or an email column that no list names is reported');
drop table public.catalogue_probe;
drop table private.catalogue_probe_log;
drop table public.catalogue_probe_note;

-- The Phase 2 tables that AC9 names and that later units create: each must be catalogued once it exists, even one whose
-- personal data is reached only through another table (a conversation through its messages and participants).
select is(
  (select coalesce(string_agg(t, ',' order by t), '')
   from unnest(array['public.partner_responses', 'public.candidate_submissions', 'public.contact_requests', 'public.conversations',
     'public.conversation_participants', 'public.messages', 'public.workforce_requirements', 'public.requirement_invitations',
     'public.partner_licences']) t
   where to_regclass(t) is not null and t not in (select tbl from catalogue)),
  '', 'AC9: each table of the criterion that exists is in the catalogue (V58 and V74 add theirs)'
);
select is(
  (select string_agg(t, ',' order by t) from unnest(array['public.partner_responses', 'public.candidate_submissions',
     'public.contact_requests', 'public.conversations', 'public.conversation_participants', 'public.messages']) t
   where to_regclass(t) is null),
  'public.contact_requests,public.conversation_participants,public.conversations,public.messages',
  'the other tables of releases 2b and 2c do not exist yet: their retention rules and erasure arrive with them (V58, V74); workforce_requirements came with V32, requirement_invitations with V41, partner_responses with V44, candidate_submissions with V48'
);
select is(
  (select string_agg(entity, ',' order by entity) from private.retention_policies
   where entity in ('conversations', 'partner_responses', 'candidate_submissions', 'closed_requirements', 'contact_requests', 'licence_evidence')),
  'candidate_submissions,closed_requirements,contact_requests,conversations,licence_evidence,partner_responses',
  'AC9: each of them already has its retention entity to apply'
);
select is(
  (select count(*)::integer from catalogue
   where (tbl like 'public.partner_%' or tbl like 'audit.partner_%' or tbl = 'public.workforce_availability')
     and tbl not in ('public.partner_responses', 'public.partner_response_versions', 'public.partner_response_documents')),
  4, 'the four Phase 2 tables of release 2a with a user column are catalogued: licences, review decisions, availability, evidence access log'
);

select * from finish();
rollback;
