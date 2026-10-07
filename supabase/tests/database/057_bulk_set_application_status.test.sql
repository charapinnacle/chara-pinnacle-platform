begin;
select plan(41);

\ir status_fixture.inc

create function pg_temp.items(p_result jsonb) returns text
language sql as $$
  select coalesce(string_agg(i ->> 'application_id' || '=' || case when i ->> 'ok' = 'true' then 'ok' else i ->> 'error_code' end, ',' order by o), p_result #>> '{}')
  from jsonb_array_elements(case when jsonb_typeof(p_result) = 'array' then p_result else '[]' end) with ordinality as x(i, o)
$$;

-- FR-D2 AC9: each item goes through the guard on its own.
create temp table t_nine as
  select pg_temp.seed_app('applied') as applied_id, pg_temp.seed_app('hired') as hired_id, gen_random_uuid() as unknown_id;
create temp table t_before as select pg_temp.status_counts() as c;
select is(
  pg_temp.items(pg_temp.bulk_as(:'mem', array[(select applied_id from t_nine), (select hired_id from t_nine), (select unknown_id from t_nine)], 'rejected', 'Position filled')),
  (select string_agg(id || '=' || r, ',' order by id) from (
     select applied_id as id, 'ok' as r from t_nine union all
     select hired_id, 'CHARA_INVALID_TRANSITION' from t_nine union all
     select unknown_id, 'CHARA_NOT_FOUND' from t_nine) x),
  'AC9: the applied item is moved, the hired item is refused as an invalid transition and the unknown id as not found, each in its own row'
);
select is(pg_temp.status_of((select applied_id from t_nine)) || '/' || pg_temp.status_of((select hired_id from t_nine)), 'rejected/hired', 'AC9: only the applied item changed');
select is(
  (select pg_temp.event_count(applied_id) || '/' || pg_temp.audit_count(applied_id) || '/' || pg_temp.queued_for(applied_id) from t_nine),
  '2/1/1', 'AC9: the moved item has its own event, audit row and status_changed message'
);
select is(
  (select pg_temp.event_count(hired_id) || '/' || pg_temp.audit_count(hired_id) || '/' || pg_temp.queued_for(hired_id) from t_nine),
  '1/0/0', 'AC9: the refused item left no row'
);
select is(
  (select e.note from public.application_events e where e.application_id = (select applied_id from t_nine) and e.to_status = 'rejected'),
  'Position filled', 'AC9: the note is the item''s event note'
);

-- FR-E3 AC10 (database part): input limits, duplicates and invalid targets.
create temp table t_ten as select pg_temp.seed_app('applied') as a1, pg_temp.seed_app('applied') as a2;
create temp table t_before2 as select pg_temp.status_counts() as c;
select is(pg_temp.bulk_as(:'mem', '{}', 'interview'), to_jsonb('P0001|CHARA_INVALID_INPUT|p_application_ids'::text), 'no ids are refused');
select is(pg_temp.bulk_as(:'mem', null, 'interview'), to_jsonb('P0001|CHARA_INVALID_INPUT|p_application_ids'::text), 'a null array is refused');
select is(
  pg_temp.json_as(:'mem', format($$select * from public.bulk_set_application_status(array[%L, null]::uuid[], 'interview')$$, (select a1 from t_ten))),
  to_jsonb('P0001|CHARA_INVALID_INPUT|p_application_ids'::text), 'a null among the ids is refused'
);
select is(
  pg_temp.bulk_as(:'mem', array(select gen_random_uuid() from generate_series(1, 101)), 'interview'),
  to_jsonb('P0001|CHARA_INVALID_INPUT|p_application_ids'::text), '101 ids are refused'
);
select is(
  pg_temp.bulk_as(:'mem', array(select a1 from t_ten union all select a1 from t_ten) || array(select gen_random_uuid() from generate_series(1, 99)), 'interview'),
  to_jsonb('P0001|CHARA_INVALID_INPUT|p_application_ids'::text), '101 ids as sent are refused although two are the same'
);
select is(pg_temp.bulk_as(:'mem', array[(select a1 from t_ten)], 'applied'), to_jsonb('P0001|CHARA_INVALID_INPUT|p_status'::text), 'the target applied is refused');
select is(pg_temp.bulk_as(:'mem', array[(select a1 from t_ten)], 'viewed'), to_jsonb('P0001|CHARA_INVALID_INPUT|p_status'::text), 'the target viewed is refused');
select is(pg_temp.bulk_as(:'mem', array[(select a1 from t_ten)], 'withdrawn'), to_jsonb('P0001|CHARA_INVALID_INPUT|p_status'::text), 'the target withdrawn is refused');
select is(pg_temp.bulk_as(:'mem', array[(select a1 from t_ten)], 'interview', repeat('a', 1001)), to_jsonb('P0001|CHARA_INVALID_INPUT|p_note'::text), 'a note of 1001 characters is refused');
select is(pg_temp.bulk_as(:'mem', array[(select a1 from t_ten)], 'rejected'), to_jsonb('P0001|CHARA_INVALID_INPUT|p_note'::text), 'a decline without a reason is refused');
select is(pg_temp.bulk_as(:'mem', array[(select a1 from t_ten)], 'rejected', '   '), to_jsonb('P0001|CHARA_INVALID_INPUT|p_note'::text), 'a decline with a blank reason is refused');
select is(pg_temp.status_counts(), (select c from t_before2), 'the refused calls changed nothing');
select is(
  pg_temp.items(pg_temp.bulk_as(:'mem', array[(select a1 from t_ten), (select a1 from t_ten)], 'interview')),
  (select a1 || '=ok' from t_ten), 'a duplicated id is processed once'
);
select is(pg_temp.event_count((select a1 from t_ten)) || '/' || pg_temp.queued_for((select a1 from t_ten)), '2/1', 'once: one event and one message');
create temp table t_hundred as select pg_temp.seed_app('applied') as id from generate_series(1, 100);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.bulk_as(:'mem', array(select id from t_hundred), 'interview')) r where r ->> 'ok' = 'true'),
  100::bigint, '100 ids are processed'
);

-- FR-E3 AC7 (database part): a mixed selection and its one audit row.
create temp table t_mixed as select pg_temp.seed_app('applied') as a1, pg_temp.seed_app('interview') as a2, pg_temp.seed_app('hired') as a3;
create temp table t_mixed_result as
  select pg_temp.bulk_as(:'mem', array[(select a1 from t_mixed), (select a2 from t_mixed), (select a3 from t_mixed)], 'offer', 'Secret reason text') as r;
select is(
  (select count(*) from jsonb_array_elements((select r from t_mixed_result)) i where i ->> 'ok' = 'true' and i ->> 'application_id' = (select a2 from t_mixed)::text),
  1::bigint, 'AC7: the interview item became an offer'
);
select is(
  (select count(*) from jsonb_array_elements((select r from t_mixed_result)) i where i ->> 'ok' = 'false' and i ->> 'error_code' = 'CHARA_INVALID_TRANSITION'),
  2::bigint, 'AC7: the applied and the hired item are refused with CHARA_INVALID_TRANSITION'
);
select is(
  (select pg_temp.status_of(a1) || '/' || pg_temp.status_of(a2) || '/' || pg_temp.status_of(a3) from t_mixed), 'applied/offer/hired', 'AC7: and only that one changed'
);
select is(
  (select jsonb_agg(l.metadata - 'ids') from audit.log l where l.action = 'application.bulk_status_changed' and l.actor_id = :'mem' and l.metadata ->> 'to' = 'offer'),
  '[{"to": "offer", "applied": 1, "requested": 3}]'::jsonb, 'AC7: one audit row for the call with the target, requested and applied'
);
select is(
  (select jsonb_array_length(l.metadata -> 'ids') from audit.log l where l.action = 'application.bulk_status_changed' and l.metadata ->> 'to' = 'offer'),
  3, 'AC7: and the three ids'
);
select is(
  (select count(*) from audit.log l where l.metadata::text like '%Secret reason text%'), 0::bigint, 'AC7: no audit row holds the note'
);

-- FR-E3 AC6 (database part): the share expiry is set per item.
create temp table t_final as
  select pg_temp.seed_app('interview') as i1, pg_temp.seed_app('interview') as i2, pg_temp.seed_app('interview') as i3,
         pg_temp.seed_app('offer') as o1, pg_temp.seed_app('offer') as o2;
select pg_temp.bulk_as(:'mem', array[(select i1 from t_final), (select i2 from t_final), (select i3 from t_final)], 'rejected', 'Position filled') as r1 \gset
select pg_temp.bulk_as(:'mem', array[(select o1 from t_final), (select o2 from t_final)], 'hired') as r2 \gset
select is(
  (select count(*) from public.passport_shares s where s.application_id in (select i1 from t_final union select i2 from t_final union select i3 from t_final union select o1 from t_final union select o2 from t_final)
     and s.expires_at = now() + interval '30 days' and s.revoked_at is null),
  5::bigint, 'AC6: each of the five shares ends 30 days after the move and is not revoked'
);
select is(
  (select count(*) from pgmq.q_notifications m where m.message ->> 'kind' = 'status_changed' and m.message ->> 'application_id' in
     (select i1::text from t_final union select i2::text from t_final union select i3::text from t_final union select o1::text from t_final union select o2::text from t_final)),
  5::bigint, 'AC6: five status_changed messages, one per application'
);

-- FR-E3 AC11 (database part): a retry and a stale selection.
select is(
  pg_temp.items(pg_temp.bulk_as(:'mem', array[(select i1 from t_final), (select i2 from t_final)], 'rejected', 'Position filled')),
  (select string_agg(id || '=CHARA_INVALID_TRANSITION', ',' order by id) from (select i1 as id from t_final union all select i2 from t_final) x),
  'AC11: the identical decline sent again refuses both items, Not selected being final'
);
select is((select pg_temp.event_count(i1) || '/' || pg_temp.queued_for(i1) from t_final), '2/1', 'AC11: and nothing is duplicated');
create temp table t_stale as select pg_temp.seed_app('applied') as a3, pg_temp.seed_app('withdrawn') as a4;
select is(
  pg_temp.items(pg_temp.bulk_as(:'mem', array[(select a3 from t_stale), (select a4 from t_stale)], 'interview')),
  (select string_agg(id || '=' || r, ',' order by id) from (select a3 as id, 'ok' as r from t_stale union all select a4, 'CHARA_INVALID_TRANSITION' from t_stale) x),
  'AC11: an application withdrawn after the selection is refused as an invalid transition, the other one moves'
);
select is(
  (select s.revoked_at is not null and s.expires_at is null from public.passport_shares s where s.application_id = (select a4 from t_stale)),
  true, 'AC11: and the withdrawn application keeps its revoked share'
);

-- FR-D2 AC9 and FR-E3 AC8: a restricted organisation is refused as a whole; FR-E3 AC9: callers and other organisations.
insert into billing.subscriptions (organization_id, plan_code, status, provider)
select o.id, 'employer_starter', 'canceled', 'null' from (select pg_temp.org_on() as id) o;
create temp table t_lapsed as
  select s.organization_id as org, pg_temp.member_of(s.organization_id) as member, pg_temp.seed_app('applied', s.organization_id) as a1,
         pg_temp.seed_app('applied', s.organization_id) as a2
  from billing.subscriptions s where s.status = 'canceled' and s.plan_code = 'employer_starter';
select is(
  pg_temp.bulk_as((select member from t_lapsed), array[(select a1 from t_lapsed), (select a2 from t_lapsed)], 'interview'),
  to_jsonb('P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan'::text), 'AC9: a lapsed organisation is refused as a whole'
);
select is((select pg_temp.status_of(a1) || pg_temp.status_of(a2) from t_lapsed), 'appliedapplied', 'AC9: and nothing moved');

create temp table t_cross as select pg_temp.seed_app('applied') as a_of_a, pg_temp.seed_app('applied', current_setting('t.b')::uuid) as a_of_b;
select is(
  pg_temp.items(pg_temp.bulk_as(:'mem', array[(select a_of_a from t_cross), (select a_of_b from t_cross)], 'interview')),
  (select string_agg(id || '=' || r, ',' order by id) from (select a_of_a as id, 'ok' as r from t_cross union all select a_of_b, 'CHARA_NOT_FOUND' from t_cross) x),
  'a member of A moves the item of A and is told the item of B was not found'
);
select is(pg_temp.status_of((select a_of_b from t_cross)), 'applied', 'and the item of B is unchanged');
select is(
  pg_temp.items(pg_temp.bulk_as(:'st_admin', array[(select a_of_a from t_cross)], 'offer')), (select a_of_a || '=CHARA_NOT_FOUND' from t_cross),
  'a platform administrator who is no member gets not found for an id of A'
);
select is(
  pg_temp.items(pg_temp.bulk_as(:'own2', array[(select a_of_a from t_cross)], 'offer')),
  (select a_of_a || '=CHARA_NOT_FOUND' from t_cross), 'the owner of B gets not found for an id of A, as for an unknown id'
);
select is(pg_temp.bulk_as(:'wa', array[(select a_of_a from t_cross)], 'offer'), to_jsonb('P0001|CHARA_FORBIDDEN|company_account_required'::text), 'a candidate is refused');
select is(
  pg_temp.call_as(null, 'anon', format($$select * from public.bulk_set_application_status(array[%L]::uuid[], 'offer')$$, (select a_of_a from t_cross))),
  '42501|permission denied for function bulk_set_application_status|', 'an anonymous call has no EXECUTE'
);
select is(pg_temp.status_of((select a_of_a from t_cross)), 'interview', 'none of these calls moved the application of A');

select * from finish();
rollback;
