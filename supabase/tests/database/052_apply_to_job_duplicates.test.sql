begin;
select plan(57);

\ir apply_fixture.inc

select pg_temp.doc(:'d1', :'wa');
select pg_temp.call_as(:'wnew', 'authenticated', $$select public.create_worker_passport('Nia', 'Mwangi', 'KE', 'en')$$, 'aal1') as setup_wnew \gset
update public.worker_profiles set occupation_id = '7212' where user_id = :'wnew';
create temp table t_states (n integer primary key, label text not null);
insert into t_states values (1, 'applied'), (2, 'viewed'), (3, 'shortlisted'), (4, 'interview'), (5, 'offer'), (6, 'hired'), (7, 'rejected');

-- FR-D7 AC1: a second call returns the existing application, in every state a non-withdrawn application can have.
create function pg_temp.dup_check(p_label text) returns text
language plpgsql as $$
declare
  v_job uuid := pg_temp.open_job('Duplicate ' || p_label);
  v_app uuid;
  v_before text;
  v_result text;
begin
  perform pg_temp.must_ok(pg_temp.apply_as(current_setting('t.wa')::uuid, v_job, 'first', array[current_setting('t.d1')::uuid]));
  v_app := current_setting('t.app')::uuid;
  update public.job_applications set status = p_label::public.application_status where id = v_app;
  v_before := pg_temp.counts();
  v_result := pg_temp.apply_as(current_setting('t.wa')::uuid, v_job, 'second', array[current_setting('t.d1')::uuid]);
  return v_result || '/' || current_setting('t.outcome') || '/' || (current_setting('t.app')::uuid = v_app)::text || '/' ||
    (select count(*) from public.job_applications a where a.job_id = v_job and a.status <> 'withdrawn') || '/' ||
    (pg_temp.counts() = (select (split_part(v_before, ',', 1)) || ',' || split_part(v_before, ',', 2) || ',' || split_part(v_before, ',', 3) || ','
       || split_part(v_before, ',', 4) || ',' || (split_part(v_before, ',', 5)::int + 1) || ',' || split_part(v_before, ',', 6)))::text;
end;
$$;
create function pg_temp.must_ok(p text) returns void language plpgsql as $$ begin if p <> 'ok' then raise exception 'setup failed: %', p; end if; end $$;
select set_config('t.wa', :'wa', true) as keep1 \gset
select set_config('t.d1', :'d1', true) as keep2 \gset

select is(pg_temp.dup_check(s.label), 'ok/existing/true/1/true', 'AC1: a second call in state ' || s.label || ' returns the existing application, creates nothing and adds one audit row')
from t_states s order by s.n;

-- FR-D7 AC2: the unique rule.
create temp table t_j as select pg_temp.open_job('Index vacancy') as id, pg_temp.open_job('Other vacancy') as other;
create function pg_temp.raw(p_job uuid, p_worker uuid, p_status text) returns text
language sql as $$
  select pg_temp.call_as(null, 'postgres', format(
    $f$insert into public.job_applications (job_id, organization_id, worker_user_id, status, passport_share_id, profile_snapshot)
       values (%L, %L, %L, %L, gen_random_uuid(), '{}')$f$, p_job, current_setting('t.a'), p_worker, p_status))
$$;
select is(pg_temp.raw((select id from t_j), :'wa', 'applied'), 'ok', 'AC2: a first application is inserted');
select is(split_part(pg_temp.raw((select id from t_j), :'wa', 'applied'), '|', 1), '23505', 'AC2: a second row for the same pair is a unique violation');
select is(
  pg_temp.raw((select id from t_j), :'wa', 'hired') like '23505|duplicate key value violates unique constraint "job_applications_one_active_per_job_worker"%',
  true, 'AC2: on the partial unique index, whatever the status'
);
select is(pg_temp.raw((select id from t_j), :'wa', 'withdrawn'), 'ok', 'AC2: a withdrawn row for the pair is allowed next to the active one');
select is(pg_temp.raw((select id from t_j), :'wb', 'applied'), 'ok', 'AC2: another candidate for the same vacancy is allowed');
select is(pg_temp.raw((select other from t_j), :'wa', 'applied'), 'ok', 'AC2: the same candidate for another vacancy is allowed');
update public.job_applications set status = 'withdrawn' where job_id = (select id from t_j) and worker_user_id = :'wa' and status = 'applied';
select is(pg_temp.raw((select id from t_j), :'wa', 'applied'), 'ok', 'AC2: after the first is withdrawn a new active row is allowed');
select is(pg_temp.raw((select id from t_j), :'wa', 'withdrawn'), 'ok', 'AC2: a further withdrawn row is allowed');
select is(
  (select count(*) filter (where status = 'withdrawn') || '/' || count(*) filter (where status <> 'withdrawn')
   from public.job_applications where job_id = (select id from t_j) and worker_user_id = :'wa'),
  '3/1', 'AC2: three withdrawn rows and one active row exist for one pair'
);
select is(
  (select pg_get_indexdef(i.indexrelid) from pg_index i where i.indexrelid = 'public.job_applications_one_active_per_job_worker'::regclass),
  'CREATE UNIQUE INDEX job_applications_one_active_per_job_worker ON public.job_applications USING btree (job_id, worker_user_id) WHERE (status <> ''withdrawn''::application_status)',
  'AC2: the index is unique on the vacancy and the candidate, for non-withdrawn rows'
);

-- FR-D7 AC3: re-apply after withdrawal only while the vacancy is open.
create temp table t_r as select pg_temp.open_job('Reapply open') as open_id, pg_temp.open_job('Reapply paused') as paused_id;
select is(pg_temp.apply_as(:'wa', (select open_id from t_r), null, array[:'d1']::uuid[]), 'ok', 'AC3: the candidate applies');
select set_config('t.first', current_setting('t.app'), true) as keep3 \gset
update public.job_applications set status = 'withdrawn' where id = current_setting('t.first')::uuid;
create temp table t_b3 as select pg_temp.counts() as c;
select is(pg_temp.apply_as(:'wa', (select open_id from t_r), null, array[:'d1']::uuid[]), 'ok', 'AC3: after withdrawal a new application is possible on an open vacancy');
select is(current_setting('t.outcome'), 'created', 'AC3: the outcome is created');
select isnt(current_setting('t.app'), current_setting('t.first'), 'AC3: with a new id');
select is(
  pg_temp.counts(),
  (select (split_part(c, ',', 1)::int + 1) || ',' || (split_part(c, ',', 2)::int + 1) || ',' || (split_part(c, ',', 3)::int + 1) || ','
       || (split_part(c, ',', 4)::int + 1) || ',' || (split_part(c, ',', 5)::int + 2) || ',' || (split_part(c, ',', 6)::int + 3) from t_b3),
  'AC3: with a new share, consent, event, audit rows and three employer messages'
);
select is(
  (select count(*) from public.job_applications where job_id = (select open_id from t_r) and worker_user_id = :'wa' and status <> 'withdrawn'), 1::bigint,
  'AC3: exactly one non-withdrawn application exists'
);
select is(pg_temp.apply_as(:'wb', (select paused_id from t_r)), 'ok', 'setup: a second candidate applies to the vacancy that is paused next');
update public.job_applications set status = 'withdrawn' where id = current_setting('t.app')::uuid;
select is(pg_temp.set_status(:'own1', (select paused_id from t_r), 'paused'), 'ok', 'setup: the vacancy is paused');
create temp table t_b3b as select pg_temp.counts() as c;
select is(pg_temp.apply_as(:'wb', (select paused_id from t_r)), 'P0001|CHARA_JOB_NOT_OPEN|', 'AC3: re-applying to a paused vacancy raises CHARA_JOB_NOT_OPEN');
select is(pg_temp.counts(), (select c from t_b3b), 'AC3: and nothing is created');

-- FR-D7 AC7: duplicate attempts are counted.
create temp table t_c as select pg_temp.open_job('Counted vacancy') as id;
select is(pg_temp.apply_as(:'wb', (select id from t_c)), 'ok', 'AC7: the candidate has an active application');
select set_config('t.counted', current_setting('t.app'), true) as keep4 \gset
select is((select count(*) from generate_series(1, 3) where pg_temp.apply_as(:'wb', (select id from t_c)) = 'ok'), 3::bigint, 'AC7: three more attempts are answered');
select is(
  (select jsonb_agg(l.metadata) from audit.log l where l.action = 'application.duplicate_attempt' and l.entity_id = current_setting('t.counted')),
  jsonb_build_array(jsonb_build_object('job_id', (select id from t_c)), jsonb_build_object('job_id', (select id from t_c)), jsonb_build_object('job_id', (select id from t_c))),
  'AC7: three audit rows name the existing application and carry the vacancy id only'
);
select is(
  (select count(*) from audit.log l where l.action = 'application.duplicate_attempt' and l.actor_id = :'wb' and l.entity_id = current_setting('t.counted')
     and l.created_at >= date_trunc('month', now())),
  3::bigint, 'AC7: the monthly count query returns 3'
);

-- FR-D7 AC8: the abuse rate limit counts created applications and duplicate attempts.
create temp table t_rl as select pg_temp.open_job('Rate vacancy') as id;
select is(
  (select count(*) from generate_series(1, 60) where pg_temp.apply_as(:'wnew', (select id from t_rl)) = 'ok'), 60::bigint,
  'AC8: calls 1 to 60 of one candidate within the hour are answered (one creates, 59 are duplicates)'
);
create temp table t_b8 as select pg_temp.counts() as c;
select is(pg_temp.apply_as(:'wnew', (select id from t_rl)), 'P0001|CHARA_RATE_LIMITED|', 'AC8: the 61st call raises CHARA_RATE_LIMITED');
select is(pg_temp.counts(), (select c from t_b8), 'AC8: and writes nothing');
select is(pg_temp.apply_as(:'wb', (select id from t_rl)), 'ok', 'AC8: another candidate is not affected');
select is(pg_temp.apply_as(:'wnew', pg_temp.open_job('Rate vacancy two')), 'P0001|CHARA_RATE_LIMITED|', 'AC8: the limit holds for any vacancy');
update private.settings set value = '5' where key = 'apply_rate_limit_max';
select is(pg_temp.apply_as(:'wb', (select id from t_rl)), 'P0001|CHARA_RATE_LIMITED|', 'AC8: the limit is a setting: with 5 a candidate who made more calls is refused');
update private.settings set value = '60' where key = 'apply_rate_limit_max';
-- The window: sixty calls that are older than an hour no longer count, sixty within it do.
insert into audit.log (actor_id, action, entity_type, entity_id, metadata, created_at)
select :'wb', 'application.duplicate_attempt', 'job_application', gen_random_uuid()::text, '{}', now() - interval '2 hours' from generate_series(1, 60);
select is(pg_temp.apply_as(:'wb', (select id from t_rl)), 'ok', 'AC8: once the window has elapsed calls succeed again (sixty calls two hours ago do not count)');
insert into audit.log (actor_id, action, entity_type, entity_id, metadata, created_at)
select :'wb', 'application.duplicate_attempt', 'job_application', gen_random_uuid()::text, '{}', now() - interval '59 minutes' from generate_series(1, 60);
select is(pg_temp.apply_as(:'wb', (select id from t_rl)), 'P0001|CHARA_RATE_LIMITED|', 'AC8: sixty calls 59 minutes ago still count');
select is(
  (select count(*) from pg_indexes where indexname = 'log_apply_actor_idx'), 1::bigint,
  'AC8: the count is served by a partial index on the audit log'
);

-- FR-D7 AC9: erasure of two applicants.
create temp table t_e as select pg_temp.open_job('Erasure vacancy') as id;
update private.settings set value = '1000' where key = 'apply_rate_limit_max';
select is(pg_temp.apply_as(:'wa', (select id from t_e), 'Please consider me, Amina.', array[:'d1']::uuid[]), 'ok', 'AC9: candidate A applies with a note');
select set_config('t.ea', current_setting('t.app'), true) as keep5 \gset
select is(pg_temp.apply_as(:'wb', (select id from t_e), 'Hello from Bruno.'), 'ok', 'AC9: candidate B applies with a note');
select set_config('t.eb', current_setting('t.app'), true) as keep6 \gset
update public.profiles set deleted_at = now() - interval '31 days' where id in (:'wa', :'wb');
select is(pg_temp.call_as(null, 'service_role', format('select public.erase_user(%L)', :'wa')), 'ok', 'AC9: erase_user runs for A');
select is(pg_temp.call_as(null, 'service_role', format('select public.erase_user(%L)', :'wb')), 'ok', 'AC9: and for B, without a unique violation');
select is(
  (select count(*) from public.job_applications where id in (current_setting('t.ea')::uuid, current_setting('t.eb')::uuid)), 2::bigint,
  'AC9: no application is lost'
);
select is(
  (select count(distinct worker_user_id) from public.job_applications where id in (current_setting('t.ea')::uuid, current_setting('t.eb')::uuid)
     and worker_user_id not in (:'wa', :'wb')), 2::bigint,
  'AC9: the applications carry two different pseudonyms'
);
select is(
  (select count(*) from public.job_applications where id in (current_setting('t.ea')::uuid, current_setting('t.eb')::uuid)
     and cover_note is null and not (profile_snapshot ? 'first_name' or profile_snapshot ? 'last_name' or profile_snapshot ? 'headline')
     and profile_snapshot ? 'skills' and profile_snapshot ? 'current_country'),
  2::bigint, 'AC9: the cover note is null, the name and headline are removed from the snapshot and the rest stays'
);
select is(
  (select count(*) from public.application_events where application_id in (current_setting('t.ea')::uuid, current_setting('t.eb')::uuid)
     and actor_id in (:'wa', :'wb')), 0::bigint, 'AC9: the events no longer name the candidates'
);
select is(
  (select count(distinct actor_id) from public.application_events where application_id in (current_setting('t.ea')::uuid, current_setting('t.eb')::uuid)),
  2::bigint, 'AC9: they name two pseudonyms'
);

-- The events are append-only; the erasure may move the actor and nothing else.
create temp table t_ev as select e.id from public.application_events e limit 1;
select is(pg_temp.call_as(null, 'postgres', 'update public.application_events set note = ''x'''), '42501|application_events is append-only|', 'an update of an event is refused, even for the owner');
select is(pg_temp.call_as(null, 'postgres', 'update public.application_events set actor_id = null'), '42501|application_events is append-only|', 'also of the actor outside an erasure');
select is(pg_temp.call_as(null, 'postgres', 'delete from public.application_events'), '42501|application_events is append-only|', 'a delete is refused');
select is(pg_temp.call_as(null, 'postgres', 'truncate public.application_events'), '42501|application_events is append-only|', 'and a truncate');

-- The consent check that replaced the foreign key.
select is(pg_temp.call_as(null, 'postgres', format($$insert into public.consents (user_id, purpose, version, action) values (%L, 'share_passport:%s', 0, 'granted')$$, :'wnew', current_setting('t.a'))), 'ok', 'a sharing consent for an organisation at a version of the sharing notice is accepted');
select is(split_part(pg_temp.call_as(null, 'postgres', format($$insert into public.consents (user_id, purpose, version, action) values (%L, 'share_passport:%s', 999, 'granted')$$, :'wnew', current_setting('t.a'))), '|', 1), '23503', 'an unknown version of the notice is refused');
select is(split_part(pg_temp.call_as(null, 'postgres', format($$insert into public.consents (user_id, purpose, version, action) values (%L, 'share_passport:not-an-organisation', 0, 'granted')$$, :'wnew')), '|', 1), '23503', 'a purpose that names no organisation is refused');
select is(split_part(pg_temp.call_as(null, 'postgres', format($$insert into public.consents (user_id, purpose, version, action) values (%L, 'share_passport:%s', null, 'granted')$$, :'wnew', current_setting('t.a'))), '|', 1), '23502', 'a missing version is still a not-null violation');

select * from finish();
rollback;
