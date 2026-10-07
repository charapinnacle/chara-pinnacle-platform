begin;
select plan(85);

\ir status_fixture.inc

select pg_temp.doc(:'d1', :'wa');

-- withdraw_application as p_user in role p_role: 'ok' or 'sqlstate|message|detail'.
create function pg_temp.withdraw_as(p_user uuid, p_app uuid, p_role text default 'authenticated') returns text
language sql as $$
  select pg_temp.call_as(p_user, p_role, format('select public.withdraw_application(%L)', p_app), 'aal1')
$$;

-- Everything a withdrawal writes, as one text, to compare before and after a refused call.
create function pg_temp.withdraw_counts() returns text
language sql as $$
  select pg_temp.status_counts() || ',' || (select count(*) from public.consents) || ','
      || (select count(*) from public.passport_shares where revoked_at is not null)
$$;

-- An application of the candidate wa to a new open vacancy of Acme, made by apply_to_job (so with a real share of the
-- document d1) and then put into p_status by the database owner.
select set_config('t.wa', :'wa', true) as keep_wa, set_config('t.d1', :'d1', true) as keep_d1 \gset
create function pg_temp.apply_in(p_status text) returns uuid
language plpgsql as $$
begin
  perform pg_temp.apply_as(current_setting('t.wa')::uuid, pg_temp.open_job('Withdraw ' || p_status || ' ' || gen_random_uuid()), null,
                           array[current_setting('t.d1')::uuid]);
  if p_status <> 'applied' then
    perform pg_temp.force_status(current_setting('t.app')::uuid, p_status);
  end if;
  return current_setting('t.app')::uuid;
end;
$$;

-- FR-D4 AC2: withdrawal from every non-final state revokes the share and ends the document access.
create temp table t_five as
  select s.ord, s.status, pg_temp.apply_in(s.status) as app
  from (values (1, 'applied'), (2, 'viewed'), (3, 'shortlisted'), (4, 'interview'), (5, 'offer')) s (ord, status);
select is(pg_temp.grant_as(:'mem', :'d1'), 'ok', 'AC2: before the withdrawals a member of the organisation opens the CV');
create temp table t_log_before as select count(*) as n from audit.document_access_log;

select is(pg_temp.withdraw_as(:'wa', t.app), 'ok', 'AC2: the candidate withdraws an application in ' || t.status) from t_five t order by t.ord;
select is(pg_temp.status_of(t.app), 'withdrawn', 'AC2: the application in ' || t.status || ' is withdrawn') from t_five t order by t.ord;
select is(
  (select count(*) from public.application_events e
   where e.application_id = t.app and e.to_status = 'withdrawn' and e.from_status = t.status::public.application_status
     and e.actor_id = :'wa' and e.note is null),
  1::bigint, 'AC2: and has one event from ' || t.status || ' to withdrawn by the candidate, without a note'
) from t_five t order by t.ord;
select is(
  (select count(*) from public.application_events e where e.application_id = t.app and e.to_status = 'withdrawn'),
  1::bigint, 'AC2: and no second event for ' || t.status
) from t_five t order by t.ord;
select is(
  (select s.revoked_at = e.created_at and s.revoked_at = now() and s.expires_at is null
   from public.passport_shares s join public.application_events e on e.application_id = s.application_id and e.to_status = 'withdrawn'
   where s.application_id = t.app),
  true, 'AC2: the share of the application in ' || t.status || ' is revoked at the time of the event'
) from t_five t order by t.ord;
select is(
  (select jsonb_agg(jsonb_build_object('action', c.action, 'version', c.version) order by c.id)
   from public.consents c where c.user_id = :'wa' and c.purpose = 'share_passport:' || current_setting('t.a') || ':' || t.app),
  (select jsonb_build_array(
     jsonb_build_object('action', 'granted', 'version', v.version), jsonb_build_object('action', 'withdrawn', 'version', v.version))
   from (select max(version) as version from public.legal_documents where slug = 'sharing-notice') v),
  'AC2: the ledger holds the granted row, unchanged, and one withdrawn row of the same purpose and version for ' || t.status
) from t_five t order by t.ord;

select is(pg_temp.grant_as(:'mem', :'d1'), '42501|CHARA_FORBIDDEN|', 'AC2: the member cannot open the CV any more');
select is((select count(*) from audit.document_access_log), (select n from t_log_before), 'AC2: and the refusal writes no access-log row');
select is(
  pg_temp.json_as(:'mem', format('select user_id from public.worker_profiles where user_id = %L', :'wa')), '[]'::jsonb,
  'AC2: the live passport returns no row for the member (no policy gives an organisation the live passport yet; this fails if one ignores a revoked share)'
);
select is(
  pg_temp.json_as(:'mem', format('select status, applicant_name from public.get_applicant(%L)', (select app from t_five where ord = 5))),
  '[{"status": "withdrawn", "applicant_name": "Amina Okafor"}]'::jsonb,
  'AC2: the member still reads the application with the name of its snapshot'
);

-- FR-D4 AC3: final states cannot be withdrawn and a repeat changes nothing.
create temp table t_final as
  select 'hired' as status, pg_temp.seed_app('hired') as app
  union all select 'rejected', pg_temp.seed_app('rejected')
  union all select 'withdrawn', pg_temp.seed_app('withdrawn');
create temp table t_c1 as select pg_temp.withdraw_counts() as c;
select is(pg_temp.withdraw_as(:'wa', t.app), format('P0001|CHARA_INVALID_TRANSITION|%s to withdrawn', t.status), 'AC3: an application in ' || t.status || ' cannot be withdrawn')
from t_final t order by t.status;
select is(pg_temp.withdraw_counts(), (select c from t_c1), 'AC3: the refusals add no event, consent, queue message or audit row and revoke nothing');
create temp table t_twice as select pg_temp.apply_in('applied') as app;
select is(pg_temp.withdraw_as(:'wa', (select app from t_twice)), 'ok', 'AC3: a fresh application is withdrawn');
create temp table t_c2 as select pg_temp.withdraw_counts() as c, (select revoked_at from public.passport_shares where application_id = (select app from t_twice)) as revoked_at;
select is(pg_temp.withdraw_as(:'wa', (select app from t_twice)), 'P0001|CHARA_INVALID_TRANSITION|withdrawn to withdrawn', 'AC3: the second call is refused');
select is(pg_temp.withdraw_counts(), (select c from t_c2), 'AC3: and writes nothing');
select is((select revoked_at from public.passport_shares where application_id = (select app from t_twice)), (select revoked_at from t_c2), 'AC3: and revoked_at keeps its first value');

-- FR-D4 AC5: all writes succeed or none.
create temp table t_atomic as select pg_temp.apply_in('offer') as app;
create function pg_temp.refuse_consent() returns trigger language plpgsql as $$ begin raise exception 'ledger is down'; end $$;
create trigger refuse_consent before insert on public.consents for each row when (new.action = 'withdrawn') execute function pg_temp.refuse_consent();
create temp table t_c3 as select pg_temp.withdraw_counts() as c;
select is(pg_temp.withdraw_as(:'wa', (select app from t_atomic)), 'P0001|ledger is down|', 'AC5: a failing insert into consents fails the call');
select is(pg_temp.status_of((select app from t_atomic)), 'offer', 'AC5: the status is still offer');
select is(pg_temp.withdraw_counts(), (select c from t_c3), 'AC5: no event, audit row, queue message or consent was added');
select is((select revoked_at is null from public.passport_shares where application_id = (select app from t_atomic)), true, 'AC5: and the share is not revoked');
drop trigger refuse_consent on public.consents;
select is(pg_temp.withdraw_as(:'wa', (select app from t_atomic)), 'ok', 'AC5: without the failure the same call succeeds');

-- FR-D4 AC6: only the owning candidate may withdraw.
create temp table t_x as select pg_temp.apply_in('applied') as app;
create temp table t_c4 as select pg_temp.withdraw_counts() as c;
select is(pg_temp.withdraw_as(c.id, (select app from t_x)), 'P0002|CHARA_NOT_FOUND|', 'AC6: ' || c.who || ' gets CHARA_NOT_FOUND')
from (values (:'wb'::uuid, 'another candidate'), (:'mem'::uuid, 'a member of the job''s organisation'), (:'adm'::uuid, 'an admin of the job''s organisation'),
             (:'own1'::uuid, 'the owner of the job''s organisation'), (:'st_admin'::uuid, 'platform staff (admin)'),
             (:'st_trust'::uuid, 'platform staff (trust_safety)'), (:'st_review'::uuid, 'platform staff (verification_reviewer)')) c (id, who);
select is(pg_temp.withdraw_as(:'wa', gen_random_uuid()), 'P0002|CHARA_NOT_FOUND|', 'AC6: an unknown id is the same answer');
select is(pg_temp.withdraw_as(null, (select app from t_x), 'anon'), '42501|permission denied for function withdraw_application|', 'AC6: an anonymous call is refused');
select is(pg_temp.withdraw_as(:'wa', (select app from t_x), 'service_role'), '42501|permission denied for function withdraw_application|', 'AC6: service_role has no execute either');
select is(pg_temp.withdraw_counts(), (select c from t_c4), 'AC6: none of these calls changed anything');
select is(pg_temp.status_of((select app from t_x)), 'applied', 'AC6: the application is still applied');

-- FR-D4 AC7: never blocked by the vacancy, the organisation or the plan.
create temp table t_blocked (what text, app uuid);
insert into t_blocked values
  ('a paused vacancy', pg_temp.seed_app('applied', null, :'wa', pg_temp.seed_job('{"status": "paused"}'))),
  ('a closed vacancy', pg_temp.seed_app('applied', null, :'wa', pg_temp.seed_job('{"status": "closed"}'))),
  ('a filled vacancy', pg_temp.seed_app('applied', null, :'wa', pg_temp.seed_job('{"status": "filled"}'))),
  ('a vacancy hidden by moderation', pg_temp.seed_app('applied', null, :'wa', pg_temp.seed_job('{"status": "open", "moderation_state": "hidden"}'))),
  ('a vacancy of a suspended organisation', pg_temp.seed_app('applied', null, :'wa', pg_temp.seed_job('{"status": "open", "moderation_state": "org_suspended"}'))),
  ('a vacancy that was deleted', pg_temp.seed_app('applied', null, :'wa', pg_temp.seed_job('{"status": "closed", "deleted_at": "2026-01-01T00:00:00Z"}')));
create temp table t_suspended as select pg_temp.org_on() as org;
insert into t_blocked values ('a suspended organisation', pg_temp.seed_app('offer', (select org from t_suspended)));
update public.organizations set status = 'suspended' where id = (select org from t_suspended);
insert into t_blocked values
  ('an organisation on free_employer after a cancelled subscription', pg_temp.seed_app('applied', pg_temp.org_on('employer_starter', 'canceled'))),
  ('an organisation on free_employer with limits enforced', pg_temp.seed_app('shortlisted', pg_temp.org_on()));
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.withdraw_as(:'wa', t.app), 'ok', 'AC7: the withdrawal succeeds for ' || t.what) from t_blocked t;
select is(pg_temp.status_of(t.app), 'withdrawn', 'AC7: and the application of ' || t.what || ' is withdrawn') from t_blocked t where t.what like '%organisation%';
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- FR-D4 AC8: the candidate is emailed, the employer is not.
create temp table t_mail as select pg_temp.apply_in('applied') as app;
delete from pgmq.q_notifications;
select is(pg_temp.withdraw_as(:'wa', (select app from t_mail)), 'ok', 'AC8: the candidate withdraws');
select is(
  (select jsonb_agg(m.message - 'msg_id') from pgmq.q_notifications m),
  jsonb_build_array(jsonb_build_object(
    'kind', 'status_changed', 'user_id', :'wa', 'application_id', (select app from t_mail),
    'job_id', (select job_id from public.job_applications where id = (select app from t_mail)), 'status', 'withdrawn', 'mandatory', true)),
  'AC8: exactly one message is queued, a status_changed for the candidate, with ids and the new state only'
);
select is(
  pg_temp.json_as(:'mem', format('select to_status, actor_kind from public.list_applicant_events(%L) order by id desc limit 1', (select app from t_mail))),
  '[{"to_status": "withdrawn", "actor_kind": "candidate"}]'::jsonb,
  'AC8: the member of the organisation reads the withdrawn event in the history'
);

-- FR-D4 AC9: records are retained and audited.
create temp table t_audit as select pg_temp.apply_in('shortlisted') as app;
update public.job_applications set cover_note = 'My private cover words' where id = (select app from t_audit);
create temp table t_rows as
  select (select count(*) from public.job_applications) as a, (select count(*) from public.application_events) as e,
         (select count(*) from public.passport_shares) as s, (select count(*) from public.consents) as c;
select pg_temp.withdraw_as(:'wa', (select app from t_audit)) as done \gset
select is(
  (select jsonb_agg(to_jsonb(l) - 'id' - 'created_at' - 'ip' order by l.id) from audit.log l
   where l.action = 'application.withdrawn' and l.entity_id = (select app::text from t_audit)),
  jsonb_build_array(jsonb_build_object(
    'actor_id', :'wa', 'action', 'application.withdrawn', 'entity_type', 'job_application', 'entity_id', (select app from t_audit),
    'metadata', jsonb_build_object('organization_id', current_setting('t.a'), 'from', 'shortlisted', 'to', 'withdrawn'))),
  'AC9: one audit row application.withdrawn names the application, the organisation and both states'
);
select is(
  (select count(*) from audit.log l where l.action = 'application.status_changed' and l.entity_id = (select app::text from t_audit)),
  0::bigint, 'AC9: and no second status_changed row for the same move'
);
select is(
  (select count(*) from audit.log l where l.action = 'share.revoked' and l.metadata ->> 'application_id' = (select app::text from t_audit)),
  1::bigint, 'AC9: the revocation of the share is audited once by the share itself'
);
select is(
  (select count(*) from audit.log l where l.metadata::text like '%private cover words%' or l.entity_id like '%private cover words%')
  + (select count(*) from pgmq.q_notifications m where m.message::text like '%private cover words%'),
  0::bigint, 'AC9: no audit row or queue message holds the cover note'
);
select is(
  (select row(count(*) >= (select a from t_rows), (select count(*) from public.application_events) = (select e from t_rows) + 1,
              (select count(*) from public.passport_shares) = (select s from t_rows),
              (select count(*) from public.consents) = (select c from t_rows) + 1)::text from public.job_applications),
  '(t,t,t,t)', 'AC9: nothing is deleted: the application, its share and the ledger stay, the event and the withdrawn consent are added'
);

-- The function is open to the candidate and acts for the caller.
select is(
  (select count(*) from (values ('anon'), ('service_role')) r (role) where has_function_privilege(r.role, 'public.withdraw_application(uuid)', 'execute')),
  0::bigint, 'anon and service_role have no execute on withdraw_application'
);
select is(has_function_privilege('authenticated', 'public.withdraw_application(uuid)', 'execute'), true, 'authenticated has execute on withdraw_application');
select is(
  (select prosrc ~ 'auth\.uid' and prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.withdraw_application(uuid)'::regprocedure),
  true, 'withdraw_application is a definer with an empty search_path that acts for auth.uid()'
);
select is(
  (select prosrc !~ 'assert_org_writable' from pg_proc where oid = 'public.withdraw_application(uuid)'::regprocedure),
  true, 'withdraw_application does not call assert_org_writable'
);

select * from finish();
rollback;
