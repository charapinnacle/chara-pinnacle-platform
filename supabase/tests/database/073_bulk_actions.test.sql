begin;
select plan(17);

\ir status_fixture.inc

-- FR-E3 AC8: a lapsed or restricted organisation is refused as a whole, before any item. L is lapsed (a cancelled
-- subscription), N never subscribed, E is on free_employer without a subscription (the same state as N, tried once the
-- limits are enforced), P is on employer_starter.
create temp table t_orgs as
  select 'L' as k, pg_temp.org_on('employer_starter', 'canceled') as org
  union all select 'N', pg_temp.org_on()
  union all select 'P', pg_temp.org_on('employer_starter');
create function pg_temp.three(p_key text) returns uuid[]
language sql as $$
  select array[pg_temp.seed_app('applied', o.org), pg_temp.seed_app('applied', o.org), pg_temp.seed_app('applied', o.org)]
  from t_orgs o where o.k = p_key
$$;
create function pg_temp.bulk_for(p_key text, p_ids uuid[], p_status text, p_note text default null) returns jsonb
language sql as $$
  select pg_temp.bulk_as(pg_temp.member_of(o.org), p_ids, p_status, p_note) from t_orgs o where o.k = p_key
$$;
create temp table t_ids as select pg_temp.three('L') as l, pg_temp.three('N') as n;
create temp table t_before as select pg_temp.status_counts() as c;

update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(
  pg_temp.bulk_for('L', (select l from t_ids), 'interview'),
  to_jsonb('P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan'::text), 'AC8: limits not enforced: a lapsed organisation is refused with read_only_free_plan'
);
select is(pg_temp.status_counts(), (select c from t_before), 'AC8: and no status, event, notification or audit row changed');
select is(
  (select count(*) from jsonb_array_elements(pg_temp.bulk_for('N', (select n from t_ids), 'interview')) r where r ->> 'ok' = 'true'),
  3::bigint, 'AC8: limits not enforced: an organisation that never subscribed moves all 3'
);
select is(
  (select string_agg(pg_temp.status_of(i), ',') from unnest((select n from t_ids)) i), 'interview,interview,interview', 'AC8: and the 3 are in Interview'
);

update private.settings set value = 'true' where key = 'entitlements_enforced';
create temp table t_ids2 as select pg_temp.three('L') as l, pg_temp.three('N') as n;
create temp table t_before2 as select pg_temp.status_counts() as c;
select is(
  pg_temp.bulk_for('L', (select l from t_ids2), 'interview'),
  to_jsonb('P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan'::text), 'AC8: limits enforced: the lapsed organisation is still refused'
);
select is(
  pg_temp.bulk_for('N', (select n from t_ids2), 'interview'),
  to_jsonb('P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan'::text), 'AC8: limits enforced: an organisation on free_employer is refused'
);
select is(pg_temp.status_counts(), (select c from t_before2), 'AC8: and again nothing changed');

-- FR-E3 AC3: a stage move with a note: one event per item with the actor and the note, one queue message per item, none
-- of them holding the note.
create temp table t_move as select pg_temp.three('P') as ids;
select pg_temp.bulk_for('P', (select ids from t_move), 'interview', 'Interviews in week 41') as moved \gset
select is(
  (select count(*) from public.application_events e
   where e.application_id = any ((select ids from t_move)::uuid[]) and e.from_status = 'applied' and e.to_status = 'interview'
     and e.actor_id = pg_temp.member_of((select org from t_orgs where k = 'P')) and e.note = 'Interviews in week 41'),
  3::bigint, 'AC3: 3 events, applied to interview, by the member, with the note'
);
select is(
  (select count(*) from pgmq.q_notifications m
   where m.message ->> 'kind' = 'status_changed' and m.message ->> 'application_id' = any (array(select unnest((select ids from t_move))::text))
     and m.message ->> 'status' = 'interview' and not m.message ? 'note'),
  3::bigint, 'AC3: 3 status_changed messages, one per candidate, with no note'
);

-- FR-E3 AC4: a decline with a template is final, and the candidate reads the reason.
create temp table t_decline as
  select o as org, pg_temp.seed_app('interview', o) as d1, pg_temp.seed_app('interview', o) as d2 from (select org as o from t_orgs where k = 'P') x;
select pg_temp.bulk_for('P', array[(select d1 from t_decline), (select d2 from t_decline)], 'rejected', 'Qualifications do not match the requirements of this role') as declined \gset
select is(
  (select pg_temp.status_of(d1) || '/' || pg_temp.status_of(d2) from t_decline), 'rejected/rejected', 'AC4: both are Not selected'
);
select is(
  pg_temp.json_as(:'wa', format($$select note from public.application_events where application_id = %L and to_status = 'rejected'$$, (select d1 from t_decline))),
  '[{"note": "Qualifications do not match the requirements of this role"}]'::jsonb, 'AC4: the candidate reads the reason as the employer''s note on the event'
);
select is(
  (select count(*) from pgmq.q_notifications m where m.message ->> 'application_id' = (select d1::text from t_decline) and m.message::text like '%Qualifications%'),
  0::bigint, 'AC4: the message to the candidate does not contain the reason text'
);
select is(
  (select string_agg(r ->> 'error_code', ',') from jsonb_array_elements(pg_temp.bulk_for('P', array[(select d1 from t_decline), (select d2 from t_decline)], 'interview')) r),
  'CHARA_INVALID_TRANSITION,CHARA_INVALID_TRANSITION', 'AC4: a later move of either is refused: there is no undo'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname ~ '(undo|revert|restore)' and p.proname ~ 'application'),
  0::bigint, 'AC4: and no function offers an undo'
);

-- FR-E3 AC9: no other status, event or notification changes when an outsider calls.
create temp table t_guard as select pg_temp.seed_app('applied') as a, pg_temp.status_counts() as c;
select pg_temp.bulk_as(:'st_admin', array[(select a from t_guard)], 'interview') as admin_try \gset
select pg_temp.bulk_as(:'wa', array[(select a from t_guard)], 'interview') as candidate_try \gset
select pg_temp.bulk_as(:'own2', array[(select a from t_guard)], 'interview') as other_org_try \gset
select is(
  regexp_replace(pg_temp.status_counts(), '^\d+,\d+,\d+', '') , regexp_replace((select c from t_guard), '^\d+,\d+,\d+', ''),
  'AC9: platform staff, a candidate and a member of another organisation changed no status'
);
select is(
  (select pg_temp.event_count(a) from t_guard), 1::bigint, 'AC9: and wrote no event'
);

-- The SOP KPI "bulk actions per month": the query of docs/runbooks/bulk-actions.md, on the audit rows written above. Six
-- calls got past the whole-call refusals (N moved 3, P moved 3, P declined 2, the retry on the declined two applied 0, the
-- platform administrator and the member of another organisation applied 0); the refused ones before any item wrote none.
select results_eq(
  $$select count(*) as bulk_actions, coalesce(sum((l.metadata ->> 'applied')::integer), 0) as applications_changed
    from audit.log l
    where l.action = 'application.bulk_status_changed' and l.created_at >= date_trunc('month', now())$$,
  $$values (6::bigint, 8::bigint)$$,
  'KPI: 6 audited calls this month that changed 8 applications'
);

select * from finish();
rollback;
