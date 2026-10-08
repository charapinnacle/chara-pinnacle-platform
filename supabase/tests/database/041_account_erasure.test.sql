begin;
select plan(78);

\ir privacy_fixture.inc

\set we '00000000-0000-0000-0000-00000000a115'
select pg_temp.new_user(:'we', 'worker');
update public.profiles set account_kind = intended_account_kind where id = :'we';

create function pg_temp.o() returns uuid language sql as $$ select current_setting('t.o')::uuid $$;
create function pg_temp.p() returns uuid language sql as $$ select current_setting('t.p')::uuid $$;
create function pg_temp.pseudonym() returns uuid language sql as $$ select current_setting('t.pseudonym')::uuid $$;
create function pg_temp.count_of(p_table text, p_column text, p_user uuid) returns bigint
language plpgsql as $$
declare v bigint;
begin
  execute format('select count(*) from %s where %I::text = $1', p_table, p_column) into v using p_user::text;
  return v;
end;
$$;
create function pg_temp.erase(p_user uuid) returns text
language sql as $$ select pg_temp.call_as(null, 'service_role', format('select public.erase_user(%L)', p_user)) $$;
-- Runs a statement as the table owner while another user's erasure is in progress: only that user's pseudonymisation may pass.
create function pg_temp.tamper(p_sql text) returns text
language plpgsql as $$
declare v_result text;
begin
  perform set_config('chara.erasure_user', current_setting('t.wb'), true);
  perform set_config('chara.erasure_pseudonym', gen_random_uuid()::text, true);
  v_result := pg_temp.call_as(null, 'postgres', p_sql);
  perform set_config('chara.erasure_user', '', true);
  perform set_config('chara.erasure_pseudonym', '', true);
  return v_result;
end;
$$;
select set_config('t.wb', :'wb', true);

-- Candidate A: passport with children, three documents (one already deleted), two shares, openings, a consent ledger,
-- audit rows in every role the user can have in them.
select pg_temp.doc(:'d1', :'wa');
select pg_temp.doc(:'d2', :'wa');
select pg_temp.doc(:'d3', :'wa');
update public.worker_documents set deleted_at = now() where id = :'d3';
insert into public.worker_skills (worker_user_id, skill) values (:'wa', 'Welding'), (:'wa', 'Wiring');
insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (:'wa', 'en', 'B2');
insert into public.worker_preferred_countries (worker_user_id, country_code) values (:'wa', 'DE');
insert into public.worker_work_authorizations (worker_user_id, country_code) values (:'wa', 'DE');
select pg_temp.share(pg_temp.o(), :'wa', array[:'d1', :'d2']::uuid[]);
select pg_temp.share(pg_temp.p(), :'wa', array[:'d2']::uuid[], 'sharing-notice-b');
update private.settings set value = '0' where key = 'document_access_repeat_seconds';
select pg_temp.must(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'));
select pg_temp.must(pg_temp.grant_as(:'wa', :'d1', 'owner_download', 'aal1'));
insert into public.platform_staff (user_id, role) values (:'wa', 'trust_safety');
update public.platform_staff set revoked_at = now() where user_id = :'wa';
insert into audit.log (actor_id, action, entity_type, entity_id, metadata, ip)
values (:'wa', 'probe.own', 'probe', :'wa', jsonb_build_object('who', :'wa'::uuid, 'note', 'kept'), '10.1.2.3');
insert into audit.log (actor_id, action, entity_type, entity_id, metadata, ip)
values (:'mem', 'probe.about', 'probe', :'wa', '{}', '10.9.9.9');
select pg_temp.must(pg_temp.call_as(:'wa', 'authenticated', 'select public.request_account_deletion()', 'aal1'));

-- Notifications (FR-I2): A has one queued, one sent and archived, and a preference row; B has the same and keeps them.
select pgmq.send('notifications', jsonb_build_object('kind', 'mfa_reset', 'user_id', u)) from unnest(array[:'wa', :'wb']::uuid[]) u;
select pgmq.archive('notifications', n.msg_id) from public.notifications n where n.kind = 'mfa_reset';
update public.notifications set status = 'sent', sent_at = now(), provider_message_id = 'prov-' || user_id where kind = 'mfa_reset';
select pgmq.send('notifications', jsonb_build_object('kind', 'mfa_reset', 'user_id', u)) from unnest(array[:'wa', :'wb']::uuid[]) u;
insert into public.notification_preferences (user_id, digest, email_undeliverable_at) values (:'wa', true, now()), (:'wb', false, null);

-- Candidate B shares the organisation and must not change.
select pg_temp.doc(:'dc', :'wb');
select pg_temp.share(pg_temp.o(), :'wb', array[:'dc']::uuid[]);
select pg_temp.must(pg_temp.grant_as(:'mem', :'dc', p_aal => 'aal1'));

create temp table before as select
  (select count(*) from audit.log) as audit_rows,
  (select max(id) from audit.log) as audit_max,
  (select count(*) from public.consents) as consent_rows,
  (select string_agg(purpose || ':' || version || ':' || action, ',' order by id) from public.consents where user_id = :'wa') as consent_a,
  (select count(*) from audit.document_access_log) as log_rows,
  (select string_agg(application_id::text, ',' order by application_id) from public.passport_shares where worker_user_id = :'wa') as applications_a,
  (select count(*) from public.passport_shares) as share_rows,
  (select count(*) from public.worker_documents where worker_user_id = :'wb') as docs_b,
  (select count(*) from public.passport_shares where worker_user_id = :'wb' and revoked_at is null) as shares_b,
  (select count(*) from public.consents where user_id = :'wb') as consents_b,
  (select count(*) from audit.document_access_log where worker_user_id = :'wb') as log_b,
  (select deleted_at from public.profiles where id = :'wa') as requested_at;
update public.profiles set deleted_at = now() - interval '31 days' where id = :'wa';
update before set requested_at = now() - interval '31 days';

-- Refusals: nothing is erased unless the request is due, the user is a candidate and holds no platform role.
select is(pg_temp.erase(:'own1'), 'P0001|CHARA_FORBIDDEN|worker_account_required', 'erase_user refuses an account that is not a candidate');
select is(pg_temp.erase(:'wnew'), 'P0001|CHARA_FORBIDDEN|deletion_not_requested', 'erase_user refuses a candidate who asked for no deletion');
select is((select count(*) from public.profiles where id in (:'own1', :'wnew')), 2::bigint, 'and removes nothing');
select is(pg_temp.erase('00000000-0000-0000-0000-0000000fffff'), 'ok', 'an unknown user is not an error: there is nothing to erase');
update public.profiles set deleted_at = now() - interval '31 days' where id = :'we';
insert into public.platform_staff (user_id, role) values (:'we', 'admin');
select is(pg_temp.erase(:'we'), 'P0001|CHARA_FORBIDDEN|platform_staff', 'erase_user refuses a user who holds a platform role');
select is((select count(*) from public.profiles where id = :'we'), 1::bigint, 'and removes nothing');

-- AC8: the erasure.
select is(pg_temp.call_as(null, 'service_role', format($$select set_config('t.erased', public.erase_user(%L)::text, true)$$, :'wa')), 'ok', 'AC8: erase_user runs for A');
select is(current_setting('t.erased'), 'true', 'AC8: and reports that it erased');
select set_config('t.pseudonym', (select entity_id from audit.log where action = 'account.erased'), true);
select is(pg_temp.count_of('public.worker_profiles', 'user_id', :'wa'), 0::bigint, 'AC8: the passport is gone');
select is(pg_temp.count_of('public.worker_skills', 'worker_user_id', :'wa'), 0::bigint, 'AC8: the skills are gone');
select is(pg_temp.count_of('public.worker_languages', 'worker_user_id', :'wa'), 0::bigint, 'AC8: the languages are gone');
select is(pg_temp.count_of('public.worker_preferred_countries', 'worker_user_id', :'wa'), 0::bigint, 'AC8: the preferred countries are gone');
select is(pg_temp.count_of('public.worker_work_authorizations', 'worker_user_id', :'wa'), 0::bigint, 'AC8: the work authorisations are gone');
select is(pg_temp.count_of('public.worker_documents', 'worker_user_id', :'wa'), 0::bigint, 'AC8: the documents are gone, the deleted one included');
select is(pg_temp.count_of('public.profiles', 'id', :'wa'), 0::bigint, 'AC8: the profile is gone');
select is(pg_temp.count_of('public.platform_staff', 'user_id', :'wa'), 0::bigint, 'AC8: the revoked platform role history leaves with the profile');
select is(pg_temp.count_of('auth.users', 'id', :'wa'), 1::bigint, 'the auth user is removed by account-ops, not by the database step');

select is(
  (select count(*) from public.passport_shares where worker_user_id = pg_temp.pseudonym()), 2::bigint,
  'AC8: both shares carry the pseudonym'
);
select is(pg_temp.count_of('public.passport_shares', 'worker_user_id', :'wa'), 0::bigint, 'AC8: no share names the user');
select is(
  (select count(*) from public.passport_shares where worker_user_id = pg_temp.pseudonym() and revoked_at is not null and scope = '[]'), 2::bigint,
  'AC8: the shares are revoked with an empty scope'
);
select is(
  (select string_agg(application_id::text, ',' order by application_id) from public.passport_shares where worker_user_id = pg_temp.pseudonym()),
  (select applications_a from before), 'AC8: the shares keep their application and organisation'
);
select is(
  (select count(*) from public.passport_shares where organization_id in (pg_temp.o(), pg_temp.p()) and worker_user_id = pg_temp.pseudonym()), 2::bigint,
  'AC8: one share per organisation'
);
select is(
  (select count(*) from auth.users where id = pg_temp.pseudonym()) + (select count(*) from public.profiles where id = pg_temp.pseudonym()), 0::bigint,
  'AC8: the pseudonym is no auth user and no profile'
);
select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'P0002|CHARA_NOT_FOUND|', 'AC8: the grant for an old document is not found');

-- AC9: the ledgers keep their rows under the pseudonym.
select is(pg_temp.count_of('public.consents', 'user_id', :'wa'), 0::bigint, 'AC9: no consent row names the user');
select is(
  (select string_agg(purpose || ':' || version || ':' || action, ',' order by id) from public.consents where user_id = pg_temp.pseudonym()),
  (select consent_a from before), 'AC9: the consent rows are the same under the pseudonym'
);
select is((select count(*) from public.consents), (select consent_rows from before), 'AC9: no consent row was deleted');
select is(pg_temp.count_of('audit.document_access_log', 'worker_user_id', :'wa') + pg_temp.count_of('audit.document_access_log', 'accessed_by', :'wa'), 0::bigint, 'AC9: no access log row names the user');
select is((select count(*) from audit.document_access_log), (select log_rows from before), 'AC9: no access log row was deleted');
select is(
  (select count(*) from audit.document_access_log where worker_user_id = pg_temp.pseudonym() and accessed_by = pg_temp.pseudonym() and purpose = 'owner_download'), 1::bigint,
  'AC9: the owner download carries the pseudonym in both columns'
);
select is(
  (select count(*) from audit.document_access_log where worker_user_id = pg_temp.pseudonym() and accessed_by = :'mem' and purpose = 'application_review'), 1::bigint,
  'AC9: the opening by the member keeps the member and carries the pseudonym for the candidate'
);
select is(
  pg_temp.count_of('audit.log', 'actor_id', :'wa') + pg_temp.count_of('audit.log', 'entity_id', :'wa'), 0::bigint,
  'AC9: no audit row names the user as actor or entity'
);
select is((select count(*) from audit.log where id <= (select audit_max from before)), (select audit_rows from before), 'AC9: no audit row was deleted');
select is(
  (select actor_id::text || '|' || entity_id || '|' || (metadata ->> 'who') || '|' || (metadata ->> 'note') || '|' || coalesce(ip::text, 'null')
   from audit.log where action = 'probe.own'),
  pg_temp.pseudonym() || '|' || pg_temp.pseudonym() || '|' || pg_temp.pseudonym() || '|kept|null',
  'AC9: the user''s own audit row carries the pseudonym as actor, entity and in the metadata, and loses the address'
);
select is(
  (select actor_id::text || '|' || entity_id || '|' || host(ip) from audit.log where action = 'probe.about'),
  :'mem' || '|' || pg_temp.pseudonym() || '|10.9.9.9', 'AC9: a row about the user by someone else keeps the actor and the address'
);
select is(
  (select count(*) from audit.log where entity_type = 'platform_staff' and metadata::text like '%' || :'wa' || '%'), 0::bigint,
  'AC9: the role history rows no longer name the user'
);
select is(
  (select count(*) from audit.log where entity_type = 'platform_staff' and metadata ->> 'user_id' = pg_temp.pseudonym()::text), 2::bigint,
  'AC9: they carry the pseudonym'
);
select is((select count(*) from audit.log where action = 'account.erased'), 1::bigint, 'AC9: one account.erased row records the completion');
select is(
  (select (metadata ->> 'requested_at')::timestamptz = (select requested_at from before) and (metadata ->> 'completed_at')::timestamptz = now() and actor_id is null
   from audit.log where action = 'account.erased'),
  true, 'AC9: it records requested_at and completed_at, with no actor'
);
select is(
  (select (select array_agg(k order by k) from jsonb_object_keys(metadata) k) from audit.log where action = 'account.erased'),
  array['completed_at', 'requested_at'], 'AC9: and nothing else'
);
select is(
  (select count(*) from audit.log where metadata::text like '%' || :'wa' || '%' or entity_id = :'wa'), 0::bigint,
  'AC9: the user id is nowhere in the audit log'
);

-- AC11 (database side): one completion email, with the address, and a retry changes nothing.
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'kind' = 'deletion_completed'), 1::bigint,
  'AC11: one deletion_completed email is queued'
);
select is(
  (select message ->> 'email' from pgmq.q_notifications where message ->> 'kind' = 'deletion_completed'), :'wa' || '@example.test',
  'AC11: to the address held before the auth user is deleted'
);
select is(
  (select replace(message::text, message ->> 'email', '') like '%' || :'wa' || '%' from pgmq.q_notifications where message ->> 'kind' = 'deletion_completed'), false,
  'AC11: apart from the address (which the test fixture builds from the id) the message does not name the user'
);
select is(pg_temp.call_as(null, 'service_role', format($$select set_config('t.erased', public.erase_user(%L)::text, true)$$, :'wa')), 'ok', 'AC11: a retry runs');
select is(current_setting('t.erased'), 'false', 'AC11: it reports that nothing was left to erase');
select is((select count(*) from audit.log where action = 'account.erased'), 1::bigint, 'AC11: it writes no second account.erased row');
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'kind' = 'deletion_completed'), 1::bigint, 'AC11: and queues no second email'
);

select is(
  (select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'wa'), 0::bigint,
  'AC11: the earlier messages of the user are removed from the notification queue'
);

select is(
  (select count(*) from public.notifications where user_id = :'wa' or msg_id in (select msg_id from pgmq.a_notifications where message ->> 'user_id' = :'wa')),
  0::bigint, 'AC11: the notifications of the user are deleted'
);
select is((select count(*) from pgmq.a_notifications where message ->> 'user_id' = :'wa'), 0::bigint, 'AC11: with their archived messages');
select is((select count(*) from public.notification_preferences where user_id = :'wa'), 0::bigint, 'AC11: and the delivery marks of the address');
select is(
  (select row(count(*), count(*) filter (where status = 'sent'))::text from public.notifications where user_id = :'wb' and kind = 'mfa_reset'), '(2,1)',
  'AC11: the notifications of the other candidate stay'
);
select is(
  (select row((select count(*) from pgmq.q_notifications where message ->> 'user_id' = :'wb'), (select count(*) from pgmq.a_notifications where message ->> 'user_id' = :'wb'),
              (select count(*) from public.notification_preferences where user_id = :'wb'))::text), '(1,1,1)',
  'AC11: and so do their messages and preference row'
);
select is(
  (select row(user_id is null, payload)::text from public.notifications where kind = 'deletion_completed'), '(t,{})',
  'AC11: the completion notice has a row with no user and no payload, the address stays in the message'
);

-- A job acknowledged after the erasure does not write the old user id back into the audit log; one for a user who still
-- has a profile is audited with the id as before.
select set_config('t.job_b', pgmq.send('account_ops', jsonb_build_object('action', 'sign_out', 'user_id', :'wb'::uuid))::text, true);
select set_config('t.job_a', pgmq.send('account_ops', jsonb_build_object('action', 'sign_out', 'user_id', :'wa'::uuid))::text, true);
select is(
  pg_temp.call_as(null, 'service_role', $$select public.account_ops_ack(current_setting('t.job_b')::bigint)$$),
  'ok', 'the ack of a job of a user who still exists runs'
);
select is(
  pg_temp.call_as(null, 'service_role', $$select public.account_ops_ack(current_setting('t.job_a')::bigint)$$),
  'ok', 'the ack of a job of the erased user runs'
);
select is(
  (select count(*) from audit.log where action = 'account_ops_done' and entity_id = :'wb'), 1::bigint,
  'the audit row of the user who exists names the user'
);
select is(
  (select count(*) from audit.log where action = 'account_ops_done' and entity_id is null), 1::bigint,
  'the audit row of the erased user names nobody'
);
select is(
  (select count(*) from audit.log where entity_id = :'wa' or metadata::text like '%' || :'wa' || '%'), 0::bigint,
  'and the user id is still nowhere in the audit log'
);

-- An erasure that stops after the database step (Storage or Auth down for longer than the attempts): the abandoned job
-- names nobody, and the next daily run queues the account again.
select set_config('t.job_x', pgmq.send('account_ops', jsonb_build_object('action', 'erase_user', 'user_id', :'wa'::uuid))::text, true);
update pgmq.q_account_ops set read_ct = 9, vt = now() - interval '1 second' where msg_id = current_setting('t.job_x')::bigint;
select is(
  (select count(*) from public.account_ops_dequeue(25) d where d.message ->> 'user_id' = :'wa'), 0::bigint,
  'a job of the erased user past the attempt limit is not handed out'
);
select is(
  (select count(*) from audit.log where action = 'account_ops_abandoned' and entity_id is null and metadata ->> 'action' = 'erase_user'), 1::bigint,
  'it is audited as abandoned, naming nobody'
);
select is(
  (select count(*) from audit.log where entity_id = :'wa' or metadata::text like '%' || :'wa' || '%'), 0::bigint,
  'and the user id is still nowhere in the audit log'
);
select is(
  (select count(*) from pgmq.q_account_ops where message ->> 'action' = 'erase_user' and message ->> 'user_id' = :'wa'), 0::bigint,
  'no job is left for the account that still has an auth user'
);
select is(private.queue_account_erasures() >= 1, true, 'the daily run queues the account again');
select private.queue_account_erasures();
select is(
  (select message from pgmq.q_account_ops where message ->> 'user_id' = :'wa' and message ->> 'action' = 'erase_user'),
  jsonb_build_object('action', 'erase_user', 'user_id', :'wa'::uuid), 'with exactly one job, which erase_user turns into the purge of the files and the auth user'
);

-- Candidate B is untouched.
select is((select count(*) from public.worker_documents where worker_user_id = :'wb'), (select docs_b from before), 'B keeps the documents');
select is((select count(*) from public.passport_shares where worker_user_id = :'wb' and revoked_at is null), (select shares_b from before), 'B keeps the shares');
select is((select count(*) from public.consents where user_id = :'wb'), (select consents_b from before), 'B keeps the consents');
select is((select count(*) from audit.document_access_log where worker_user_id = :'wb'), (select log_b from before), 'B keeps the access log rows');

-- AC9: the pseudonymisation is the only change the append-only rules allow, also while an erasure runs.
select is(pg_temp.call_as(null, 'postgres', $$update audit.log set action = 'x' where action = 'probe.about'$$), '42501|audit.log is append-only|', 'AC9: any other update of audit.log still fails');
select is(pg_temp.call_as(null, 'postgres', $$delete from audit.log where action = 'probe.about'$$), '42501|audit.log is append-only|', 'AC9: a delete still fails');
select is(
  pg_temp.call_as(null, 'postgres', format($$update audit.log set actor_id = %L where action = 'probe.about'$$, pg_temp.pseudonym())),
  '42501|audit.log is append-only|', 'AC9: pseudonymising without an erasure in progress fails'
);
select is(
  pg_temp.tamper($$update audit.log set action = 'x' where action = 'probe.about'$$), '42501|audit.log is append-only|',
  'AC9: during another user''s erasure the action of an audit row cannot be changed'
);
select is(
  pg_temp.tamper($$update audit.log set actor_id = gen_random_uuid() where action = 'probe.about'$$), '42501|audit.log is append-only|',
  'AC9: nor can it be given to someone who is no pseudonym of the erased user'
);
select is(
  pg_temp.tamper($$update audit.log set metadata = '{"x": 1}' where action = 'probe.about'$$), '42501|audit.log is append-only|',
  'AC9: nor the metadata rewritten'
);
select is(
  pg_temp.tamper($$update public.consents set purpose = 'x' where user_id = (select user_id from public.consents limit 1)$$), '42501|consents is append-only|',
  'AC9: the consent ledger allows nothing but the pseudonym'
);
select is(
  pg_temp.tamper($$update audit.document_access_log set purpose = 'owner_download'$$), '42501|audit.document_access_log is append-only|',
  'AC9: nor does the access log'
);

select * from finish();
rollback;
