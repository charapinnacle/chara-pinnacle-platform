begin;
select plan(41);

\ir status_fixture.inc

select pg_temp.doc(:'d1', :'wa');

-- FR-D2 AC5: the note of a stage change.
create temp table t_notes as select pg_temp.seed_app('applied') as a_long, pg_temp.seed_app('applied') as a_over,
  pg_temp.seed_app('applied') as a_empty, pg_temp.seed_app('applied') as a_padded, pg_temp.seed_app('applied') as a_blank;
select is(pg_temp.set_as(:'mem', (select a_long from t_notes), 'rejected', repeat('a', 1000)), 'ok', 'AC5: a note of 1000 characters is accepted');
select is((select length(note) from public.application_events where application_id = (select a_long from t_notes) and to_status = 'rejected'), 1000, 'AC5: and stored whole');
create temp table t_before as select pg_temp.status_counts() as c;
select is(pg_temp.set_as(:'mem', (select a_over from t_notes), 'rejected', repeat('a', 1001)), 'P0001|CHARA_INVALID_INPUT|p_note', 'AC5: a note of 1001 characters is refused');
select is(pg_temp.status_counts(), (select c from t_before), 'AC5: the refused note changed nothing');
select is(pg_temp.set_as(:'mem', (select a_empty from t_notes), 'interview', ''), 'ok', 'AC5: an empty note is accepted');
select is((select note is null from public.application_events where application_id = (select a_empty from t_notes) and to_status = 'interview'), true, 'AC5: and stored as null');
select is(pg_temp.set_as(:'mem', (select a_blank from t_notes), 'interview', E' \t\n '), 'ok', 'AC5: a note of white space only is accepted');
select is((select note is null from public.application_events where application_id = (select a_blank from t_notes) and to_status = 'interview'), true, 'AC5: and stored as null');
select is(pg_temp.set_as(:'mem', (select a_padded from t_notes), 'rejected', '  Position filled  '), 'ok', 'AC5: a padded note is accepted');
select is((select note from public.application_events where application_id = (select a_padded from t_notes) and to_status = 'rejected'), 'Position filled', 'AC5: and stored trimmed');
select is(
  pg_temp.json_as(:'wa', format('select to_status, note from public.application_events where application_id = %L order by id', (select a_padded from t_notes))),
  '[{"note": null, "to_status": "applied"}, {"note": "Position filled", "to_status": "rejected"}]'::jsonb,
  'AC5: the candidate reads the note of the stage change'
);
update private.settings set value = '5' where key = 'application_status_note_max_chars';
select is(pg_temp.set_as(:'mem', pg_temp.seed_app('applied'), 'interview', 'abcdef'), 'P0001|CHARA_INVALID_INPUT|p_note', 'AC5: the limit is the setting: 6 characters are refused at a limit of 5');
select is(pg_temp.set_as(:'mem', pg_temp.seed_app('applied'), 'interview', 'abcde'), 'ok', 'AC5: and 5 are accepted');
delete from private.settings where key = 'application_status_note_max_chars';
select is(pg_temp.set_as(:'mem', pg_temp.seed_app('applied'), 'interview', 'x'), 'P0001|CHARA_SETTING_MISSING|application_status_note_max_chars', 'AC5: a missing setting fails the call instead of lifting the limit');
insert into private.settings (key, value) values ('application_status_note_max_chars', '1000');

-- FR-D2 AC6: the events cannot be written around the functions.
select is(
  (select count(*) from (values ('authenticated'), ('anon'), ('service_role')) r(role)
    where has_table_privilege(r.role, 'public.application_events', 'insert, update, delete, truncate')
       or has_any_column_privilege(r.role, 'public.application_events', 'insert, update')),
  0::bigint, 'AC6: no API role has a write privilege on application_events'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$insert into public.application_events (application_id, to_status) values (%L, 'hired')$$, (select a_long from t_notes))),
  '42501|permission denied for table application_events|', 'AC6: a member cannot insert an event'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$update public.application_events set note = 'x' where application_id = %L$$, (select a_long from t_notes))),
  '42501|permission denied for table application_events|', 'AC6: the candidate cannot update an event'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$delete from public.application_events where application_id = %L$$, (select a_long from t_notes))),
  '42501|permission denied for table application_events|', 'AC6: the candidate cannot delete an event'
);
select throws_ok(format($$update public.application_events set note = 'x' where application_id = %L$$, (select a_long from t_notes)), '42501', 'application_events is append-only', 'AC6: the table owner cannot update an event');
select throws_ok(format($$delete from public.application_events where application_id = %L$$, (select a_long from t_notes)), '42501', 'application_events is append-only', 'AC6: the table owner cannot delete an event');
select throws_ok('truncate public.application_events', '42501', null, 'AC6: the table owner cannot truncate the events');

-- FR-D2 AC7: status, event, audit row, share and queue message are one transaction.
create temp table t_atomic as select pg_temp.seed_app('applied') as id;
create function pg_temp.refuse_queue() returns trigger language plpgsql as $$ begin raise exception 'queue is down'; end $$;
create trigger refuse_queue before insert on pgmq.q_notifications for each row execute function pg_temp.refuse_queue();
create temp table t_before2 as select pg_temp.status_counts() as c;
select is(pg_temp.set_as(:'mem', (select id from t_atomic), 'rejected', 'Position filled'), 'P0001|queue is down|', 'AC7: a failing queue write fails the call');
select is(pg_temp.status_counts(), (select c from t_before2), 'AC7: the status, events, audit log, queue and shares are unchanged');
drop trigger refuse_queue on pgmq.q_notifications;
select is(pg_temp.set_as(:'mem', (select id from t_atomic), 'rejected', 'Position filled'), 'ok', 'AC7: without the failure the same call succeeds');
select is(pg_temp.status_of((select id from t_atomic)), 'rejected', 'AC7: the new status is written');
select is(pg_temp.event_count((select id from t_atomic)), 2::bigint, 'AC7: with one event');
select is(
  (select jsonb_agg(to_jsonb(l) - 'id' - 'created_at' - 'ip' order by l.id) from audit.log l where l.action = 'application.status_changed' and l.entity_id = (select id::text from t_atomic)),
  jsonb_build_array(jsonb_build_object(
    'actor_id', :'mem', 'action', 'application.status_changed', 'entity_type', 'job_application', 'entity_id', (select id from t_atomic),
    'metadata', jsonb_build_object('organization_id', current_setting('t.a'), 'from', 'applied', 'to', 'rejected'))),
  'AC7: with one audit row naming the application, the organisation and both states, and no note'
);
select is(
  (select jsonb_agg(m.message) from pgmq.q_notifications m where m.message ->> 'application_id' = (select id::text from t_atomic)),
  jsonb_build_array(jsonb_build_object(
    'kind', 'status_changed', 'user_id', :'wa', 'application_id', (select id from t_atomic),
    'job_id', (select job_id from public.job_applications where id = (select id from t_atomic)), 'status', 'rejected', 'mandatory', true)),
  'AC7: and one status_changed message for the candidate, with ids and the new state and no note'
);

-- An erased candidate has no profile any more: the move is made and nobody is told.
create temp table t_erased as select pg_temp.seed_app('applied', null, gen_random_uuid()) as id;
select is(pg_temp.set_as(:'mem', (select id from t_erased), 'interview'), 'ok', 'a candidate without a profile (erased): the move is made');
select is(pg_temp.queued_for((select id from t_erased)), 0::bigint, 'and no message is queued for the pseudonym');

-- FR-D2 AC8: the share ends 30 days after Hired or Not selected.
select pg_temp.apply_as(:'wa', pg_temp.open_job('Share vacancy'), null, array[:'d1'::uuid]) as applied \gset
select current_setting('t.app') as app_hired \gset
select pg_temp.apply_as(:'wb', (select job_id from public.job_applications where id = :'app_hired')) as applied_b \gset
select current_setting('t.app') as app_rejected \gset
select pg_temp.set_as(:'mem', :'app_hired', 'shortlisted') as s1 \gset
select pg_temp.set_as(:'mem', :'app_hired', 'interview') as s2 \gset
select pg_temp.set_as(:'mem', :'app_hired', 'offer') as s3 \gset
select pg_temp.set_as(:'mem', :'app_rejected', 'interview') as s4 \gset
select is(
  (select count(*) from public.passport_shares where application_id in (:'app_hired', :'app_rejected') and (expires_at is not null or revoked_at is not null)),
  0::bigint, 'AC8: shortlisted, interview and offer leave expires_at null'
);
select is(pg_temp.set_as(:'mem', :'app_hired', 'hired'), 'ok', 'AC8: a member hires');
select is(pg_temp.set_as(:'mem', :'app_rejected', 'rejected', 'Position filled'), 'ok', 'AC8: and declines');
select is(
  (select count(*) from public.passport_shares where application_id in (:'app_hired', :'app_rejected') and expires_at = now() + interval '30 days' and revoked_at is null),
  2::bigint, 'AC8: both shares end 30 days after the move and are not revoked'
);
select is((select count(*) from audit.log where action = 'share.expiry_set' and metadata ->> 'application_id' in (:'app_hired', :'app_rejected')), 2::bigint, 'AC8: the expiry is audited once per share');
select is(pg_temp.grant_as(:'mem', :'d1'), 'ok', 'AC8: while the share runs the member opens the shared document');
alter table public.passport_shares disable trigger passport_shares_guard;
update public.passport_shares set expires_at = now() - interval '1 minute' where application_id = :'app_hired';
alter table public.passport_shares enable always trigger passport_shares_guard;
select is(pg_temp.grant_as(:'mem', :'d1'), '42501|CHARA_FORBIDDEN|', 'AC8: once the expiry is past the document is refused');
select is((select revoked_at is null from public.passport_shares where application_id = :'app_hired'), true, 'AC8: and the share was never revoked');
update private.settings set value = '14' where key = 'share_expiry_days_after_final';
create temp table t_fourteen as select pg_temp.seed_app('offer') as id;
select is(pg_temp.set_as(:'mem', (select id from t_fourteen), 'hired'), 'ok', 'AC8: after the setting changes to 14 a member hires');
select is(
  (select expires_at = now() + interval '14 days' from public.passport_shares where application_id = (select id from t_fourteen)),
  true, 'AC8: the share ends 14 days after the move'
);
delete from private.settings where key = 'share_expiry_days_after_final';
select is(pg_temp.set_as(:'mem', pg_temp.seed_app('offer'), 'hired'), 'P0001|CHARA_SETTING_MISSING|share_expiry_days_after_final', 'AC8: a missing setting fails the move instead of leaving the share open');

select * from finish();
rollback;
