begin;
select plan(48);

\ir apply_fixture.inc

select pg_temp.doc(:'d1', :'wa');
select pg_temp.doc(:'d2', :'wa', 'skipped', 'certificate');
select pg_temp.doc(:'dx', :'wb');
update public.worker_profiles set headline = 'Welder', years_experience = 6, availability = 'now' where user_id = :'wa';
insert into public.worker_skills (worker_user_id, skill) values (:'wa', 'MIG welding'), (:'wa', 'TIG welding');
insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (:'wa', 'en', 'C1'), (:'wa', 'de', 'A2');
insert into public.worker_preferred_countries (worker_user_id, country_code) values (:'wa', 'DE'), (:'wa', 'AE');
insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values (:'wa', 'NG', '2030-05-01');

create temp table t_job as select pg_temp.open_job() as id;
create temp table t_before as select pg_temp.counts() as c;
select set_config('t.job', (select id::text from t_job), true) as keep \gset

-- FR-D1 AC2: one transaction writes the consent, the share, the application, the event, the audit rows and the queue messages.
select is(pg_temp.apply_as(:'wa', current_setting('t.job')::uuid, 'I have six years of experience.', array[:'d1']::uuid[]), 'ok', 'AC2: apply_to_job runs for the candidate');
select is(current_setting('t.outcome'), 'created', 'the outcome is created');
select is(
  pg_temp.counts(),
  (select (split_part(c, ',', 1)::int + 1) || ',' || (split_part(c, ',', 2)::int + 1) || ',' || (split_part(c, ',', 3)::int + 1) || ','
       || (split_part(c, ',', 4)::int + 1) || ',' || (split_part(c, ',', 5)::int + 2) || ',' || (split_part(c, ',', 6)::int + 3) from t_before),
  'AC2: one application, share, consent and event, two audit rows (the submission and the share) and three queue messages are added'
);
select is(
  (select row(a.status, a.cover_note, a.worker_user_id, a.job_id, a.organization_id)::text
   from public.job_applications a where a.id = current_setting('t.app')::uuid),
  row('applied', 'I have six years of experience.', :'wa'::uuid, current_setting('t.job')::uuid, current_setting('t.a')::uuid)::text,
  'AC2: the application is applied, with the note, the candidate, the vacancy and its organisation'
);
select is(
  (select row(s.worker_user_id, s.organization_id, s.application_id, s.scope, s.expires_at, s.revoked_at)::text
   from public.passport_shares s where s.application_id = current_setting('t.app')::uuid),
  row(:'wa'::uuid, current_setting('t.a')::uuid, current_setting('t.app')::uuid, jsonb_build_array(:'d1'::text), null::timestamptz, null::timestamptz)::text,
  'AC2: the share is for the organisation and the application, its scope holds exactly the selected id, and it does not expire or end'
);
select is(
  (select a.passport_share_id from public.job_applications a where a.id = current_setting('t.app')::uuid),
  (select s.id from public.passport_shares s where s.application_id = current_setting('t.app')::uuid),
  'AC2: the application points at its share'
);
select is(
  (select row(c.user_id, c.purpose, c.version, c.action)::text from public.consents c where c.id = (
     select s.consent_id from public.passport_shares s where s.application_id = current_setting('t.app')::uuid)),
  row(:'wa'::uuid, 'share_passport:' || current_setting('t.a') || ':' || current_setting('t.app'), (select max(version) from public.legal_documents where slug = 'sharing-notice'), 'granted')::text,
  'AC2: the consent is granted for sharing with the organisation and this application, at the version of the sharing notice'
);
select is(
  (select row(e.from_status, e.to_status, e.actor_id, e.note)::text from public.application_events e where e.application_id = current_setting('t.app')::uuid),
  row(null::public.application_status, 'applied'::public.application_status, :'wa'::uuid, null::text)::text,
  'AC2: the first event goes from nothing to applied, by the candidate, without a note'
);
select is(
  (select jsonb_agg(l.action order by l.id) from audit.log l where l.entity_id in (current_setting('t.app'), (select id::text from public.passport_shares where application_id = current_setting('t.app')::uuid))),
  '["share.created", "application.submitted"]'::jsonb,
  'AC2: the audit log has the share and the submission (the share row is audited by its own trigger)'
);
select is(
  (select l.metadata from audit.log l where l.action = 'application.submitted' and l.entity_id = current_setting('t.app')),
  jsonb_build_object('job_id', current_setting('t.job'), 'organization_id', current_setting('t.a'), 'document_count', 1),
  'AC2: the submission names the vacancy, the organisation and the number of documents, never the note'
);
select is(
  (select l.actor_id from audit.log l where l.action = 'application.submitted' and l.entity_id = current_setting('t.app')), :'wa'::uuid,
  'AC2: the audit actor is the candidate'
);
select is(
  (select jsonb_agg(m.message - 'msg_id' order by m.message ->> 'user_id')
   from pgmq.q_notifications m where m.message ->> 'application_id' = current_setting('t.app')),
  (select jsonb_agg(jsonb_build_object('kind', 'application_received', 'user_id', u, 'application_id', current_setting('t.app'),
                                       'job_id', current_setting('t.job'), 'mandatory', false) order by u::text)
   from unnest(array[:'own1', :'adm', :'mem']::uuid[]) u),
  'AC2: one message for each of the three members of the organisation, with ids only'
);
select is(
  (select count(*) from pgmq.q_notifications m where m.message ->> 'application_id' = current_setting('t.app') and m.message ->> 'user_id' = :'wa'),
  0::bigint, 'AC2: none for the candidate'
);

-- A member who has not accepted the invitation yet is not told.
create temp table t_job2 as select pg_temp.open_job('Second welder') as id;
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (current_setting('t.a')::uuid, :'oth', 'member', null);
select is(pg_temp.apply_as(:'wb', (select id from t_job2)), 'ok', 'a second candidate applies without documents');
select is(
  (select count(*) from pgmq.q_notifications m where m.message ->> 'application_id' = current_setting('t.app')), 3::bigint,
  'three messages: an invited member who has not accepted gets none'
);
select is(
  (select s.scope from public.passport_shares s where s.application_id = current_setting('t.app')::uuid), '[]'::jsonb,
  'AC4: without documents the scope is the empty array, never document types'
);

-- FR-D1 AC3: a failure leaves nothing behind.
create temp table t_job3 as select pg_temp.open_job('Third welder') as id;
create temp table t_before3 as select pg_temp.counts() as c;
select is(pg_temp.apply_as(:'wa', (select id from t_job3), null, array[:'d1', :'dx']::uuid[]), 'P0002|CHARA_NOT_FOUND|', 'AC3a: a document of another candidate is refused as not found');
select is(pg_temp.counts(), (select c from t_before3), 'AC3a: nothing was written');
update public.worker_documents set deleted_at = now() where id = :'d2';
create temp table t_before3b as select pg_temp.counts() as c;
select is(pg_temp.apply_as(:'wa', (select id from t_job3), null, array[:'d2']::uuid[]), 'P0002|CHARA_NOT_FOUND|', 'AC3b: a deleted document is refused with the same code');
select is(pg_temp.counts(), (select c from t_before3b), 'AC3b: nothing was written');
create function pg_temp.fail_queue() returns trigger language plpgsql as $$ begin raise exception 'queue is down'; end $$;
create trigger fail_queue before insert on pgmq.q_notifications for each row execute function pg_temp.fail_queue();
select is(pg_temp.apply_as(:'wa', (select id from t_job3)), 'P0001|queue is down|', 'AC3c: a failing queue write fails the call with its error');
drop trigger fail_queue on pgmq.q_notifications;
select is(pg_temp.counts(), (select c from t_before3b), 'AC3c: the consent, share, application, event and audit rows were rolled back with it');
select is(pg_temp.apply_as(:'wa', (select id from t_job3)), 'ok', 'afterwards the same application succeeds');

-- FR-D1 AC4: the share scope holds the selected ids only.
\set cv_old '00000000-0000-0000-0000-0000000d00e1'
\set cv_new '00000000-0000-0000-0000-0000000d00e2'
\set cv_later '00000000-0000-0000-0000-0000000d00e3'
select pg_temp.doc(:'cv_old', :'wa');
select pg_temp.doc(:'cv_new', :'wa');
create temp table t_v1 as select pg_temp.open_job('Scope vacancy one') as id;
create temp table t_v2 as select pg_temp.open_job('Scope vacancy two') as id;
select is(pg_temp.apply_as(:'wa', (select id from t_v1), null, array[:'cv_old']::uuid[]), 'ok', 'AC4: applies to V1 with cv_old only');
select set_config('t.share1', (select s.id::text from public.passport_shares s where s.application_id = current_setting('t.app')::uuid), true) as keep \gset
select pg_temp.doc(:'cv_later', :'wa');
select is(pg_temp.apply_as(:'wa', (select id from t_v2)), 'ok', 'AC4: applies to V2 of the same organisation with no document');
select is(
  (select s.scope from public.passport_shares s where s.id = current_setting('t.share1')::uuid), jsonb_build_array(:'cv_old'::text),
  'AC4: the scope of V1 is the id of the selected CV'
);
select is(pg_temp.grant_as(:'mem', :'cv_old'), 'ok', 'AC4: a member opens the selected CV');
select is(
  (select count(*) from audit.document_access_log where document_id = :'cv_old' and share_id = current_setting('t.share1')::uuid),
  1::bigint, 'AC4: one access log row, naming the share of V1'
);
select is(pg_temp.grant_as(:'mem', :'cv_new'), '42501|CHARA_FORBIDDEN|', 'AC4: a CV of the candidate that was not selected is refused');
select is(pg_temp.grant_as(:'mem', :'cv_later'), '42501|CHARA_FORBIDDEN|', 'AC4: a CV uploaded after the application is refused');
select is((select count(*) from audit.document_access_log where document_id in (:'cv_new', :'cv_later')), 0::bigint, 'AC4: the refusals wrote no log row');
update public.passport_shares set revoked_at = now() where id = current_setting('t.share1')::uuid;
select is(pg_temp.grant_as(:'mem', :'cv_old'), '42501|CHARA_FORBIDDEN|', 'AC4: with V1 withdrawn the selected CV is refused too, V2 lists no document');

-- FR-D1 AC9: the snapshot is taken at apply time and does not change later.
create temp table t_v9 as select pg_temp.open_job('Snapshot vacancy') as id;
select is(pg_temp.apply_as(:'wa', (select id from t_v9)), 'ok', 'AC9: the candidate applies');
select set_config('t.snap', (select a.profile_snapshot::text from public.job_applications a where a.id = current_setting('t.app')::uuid), true) as keep \gset
select is(
  current_setting('t.snap')::jsonb,
  jsonb_build_object(
    'first_name', 'Amina', 'last_name', 'Okafor', 'headline', 'Welder', 'current_country', 'NG', 'occupation_id', '7212',
    'occupation', (select label from public.occupations where code = '7212'), 'years_experience', 6, 'availability', 'now',
    'available_from', null, 'skills', jsonb_build_array('MIG welding', 'TIG welding'),
    'languages', jsonb_build_array(jsonb_build_object('code', 'de', 'level', 'A2'), jsonb_build_object('code', 'en', 'level', 'C1')),
    'preferred_countries', jsonb_build_array('AE', 'DE'),
    'work_authorizations', jsonb_build_array(jsonb_build_object('country', 'NG', 'expires_on', '2030-05-01'))
  ),
  'AC9: the snapshot holds the name, headline, country, occupation, skills, languages with levels, experience, availability, preferred countries and work authorisation with expiry'
);
select is(
  (select count(*) from jsonb_object_keys(current_setting('t.snap')::jsonb) k where k ~* 'mail|birth|path|file|document|nationality'),
  0::bigint, 'AC9: no email, date of birth, storage path or file name key'
);
update public.worker_profiles set headline = 'Senior welder' where user_id = :'wa';
delete from public.worker_skills where worker_user_id = :'wa' and skill = 'TIG welding';
select is(
  (select a.profile_snapshot from public.job_applications a where a.id = current_setting('t.app')::uuid), current_setting('t.snap')::jsonb,
  'AC9: after an edit of the passport the stored snapshot still shows Welder and the removed skill'
);

-- FR-D1 AC6 (part): no API role writes the tables; AC9: nobody updates the snapshot.
select is(pg_temp.state_as(:'wa', format($$insert into public.job_applications (job_id, organization_id, worker_user_id, passport_share_id, profile_snapshot) values (%L, %L, %L, gen_random_uuid(), '{}')$$, current_setting('t.job'), current_setting('t.a'), :'wa')), '42501', 'AC6: a candidate cannot insert an application');
select is(pg_temp.state_as(:'wa', $$insert into public.application_events (application_id, to_status) values (current_setting('t.app')::uuid, 'applied')$$), '42501', 'AC6: nor an event');
select is(pg_temp.state_as(:'wa', format($$insert into public.passport_shares (worker_user_id, organization_id, application_id, scope, consent_id) values (%L, %L, %L, '[]', 1)$$, :'wa', current_setting('t.a'), current_setting('t.app'))), '42501', 'AC6: nor a share');
select is(pg_temp.state_as(:'wa', format($$insert into public.consents (user_id, purpose, version, action) values (%L, 'privacy-policy', 0, 'granted')$$, :'wa')), '42501', 'AC6: nor a consent');
select is(
  pg_temp.state_as(:'wa', $$update public.job_applications set profile_snapshot = '{}'$$) || pg_temp.state_as(:'wa', 'update public.job_applications set cover_note = null')
  || pg_temp.state_as(:'wa', 'delete from public.job_applications') || pg_temp.state_as(:'wa', 'delete from public.application_events'),
  '42501425014250142501', 'AC9: the candidate cannot update the snapshot or anything else, or delete an application or an event'
);
select is(
  pg_temp.state_as(:'mem', $$update public.job_applications set profile_snapshot = '{}'$$) || pg_temp.state_as(:'own1', $$update public.job_applications set profile_snapshot = '{}'$$),
  '4250142501', 'AC9: nor a member or the owner of the organisation'
);

-- Reads: the candidate reads the own rows only, and not the actor of an event.
select is(pg_temp.affected_as(:'wa', 'authenticated', 'select 1 from public.job_applications'), 5::bigint, 'the candidate reads the own five applications of this run');
select is(pg_temp.affected_as(:'wb', 'authenticated', 'select 1 from public.job_applications'), 1::bigint, 'another candidate reads only the own one');
select is(pg_temp.affected_as(:'own1', 'authenticated', 'select 1 from public.job_applications'), 0::bigint, 'a member of the organisation reads none (the employer read is FR-D5)');
select is(pg_temp.affected_as(:'wa', 'authenticated', 'select 1 from public.application_events'), 5::bigint, 'the candidate reads the events of the own applications');
select is(pg_temp.state_as(:'wa', 'select actor_id from public.application_events'), '42501', 'but not the actor of an event');
select is(pg_temp.call_as(null, 'anon', 'select 1 from public.job_applications') || '/' || pg_temp.call_as(null, 'anon', 'select 1 from public.application_events'), '42501|permission denied for table job_applications|/42501|permission denied for table application_events|', 'anonymous callers have no grant');

select * from finish();
rollback;
