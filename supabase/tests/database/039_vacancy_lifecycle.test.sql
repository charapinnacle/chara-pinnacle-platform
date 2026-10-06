begin;
select plan(76);

\ir jobs_fixture.inc

-- A vacancy written by the database owner in any status (an insert is not guarded), with a status_changed_at and a
-- published_at far in the past so that a later change is visible although a transaction has one clock.
create function pg_temp.job_in(
  p_status text, p_org uuid default null, p_moderation text default 'visible', p_deleted boolean default false,
  p_title text default null
) returns uuid
language sql as $$
  insert into public.jobs (
    organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type,
    recruitment_preference, status, moderation_state, deleted_at, status_changed_at, published_at
  ) values (
    coalesce(p_org, current_setting('t.a')::uuid), coalesce(p_title, 'Lifecycle ' || p_status),
    'Weld steel frames in our Hamburg workshop. Weld steel frames in our Hamburg workshop.',
    '7212', 'C', 'DE', 'Hamburg', 'full_time', 'both', p_status::public.job_status, p_moderation::public.job_moderation_state,
    case when p_deleted then now() end, '2020-01-01T00:00:00Z',
    case when p_status <> 'draft' then '2020-02-02T00:00:00Z'::timestamptz end
  ) returning id
$$;

-- One attempt: a fresh vacancy in p_from, p_to applied by p_user, and what is left behind.
create function pg_temp.attempt(p_user uuid, p_from text, p_to text) returns jsonb
language plpgsql as $$
declare
  v_job uuid := pg_temp.job_in(p_from);
  v_result text := pg_temp.set_status(p_user, v_job, p_to);
begin
  return (
    select jsonb_build_object(
      'result', v_result,
      'status', j.status,
      'changed_now', j.status_changed_at = now(),
      'published_kept', j.published_at = '2020-02-02T00:00:00Z',
      'published_now', j.published_at = now(),
      'audits', (select count(*) from audit.log a where a.entity_id = j.id::text and a.action = 'job.status_changed'),
      'actor', (select a.actor_id from audit.log a where a.entity_id = j.id::text and a.action = 'job.status_changed'),
      'from', (select a.metadata ->> 'from' from audit.log a where a.entity_id = j.id::text and a.action = 'job.status_changed'),
      'to', (select a.metadata ->> 'to' from audit.log a where a.entity_id = j.id::text and a.action = 'job.status_changed'),
      'updates', (select count(*) from audit.log a where a.entity_id = j.id::text and a.action = 'job.updated')
    )
    from public.jobs j where j.id = v_job
  );
end;
$$;

create temp table t_allowed (from_s text, to_s text);
insert into t_allowed values
  ('draft', 'open'), ('open', 'paused'), ('open', 'closed'), ('open', 'filled'),
  ('paused', 'open'), ('paused', 'closed'), ('paused', 'filled'), ('closed', 'open');
create temp table t_refused (from_s text, to_s text);
insert into t_refused values
  ('draft', 'paused'), ('draft', 'closed'), ('draft', 'filled'), ('open', 'draft'), ('paused', 'draft'),
  ('closed', 'draft'), ('closed', 'paused'), ('closed', 'filled'), ('filled', 'draft'), ('filled', 'open'),
  ('filled', 'paused'), ('filled', 'closed');
create temp table t_ran as
  select a.from_s, a.to_s, u.who, pg_temp.attempt(u.id, a.from_s, a.to_s) as r
  from t_allowed a cross join (values ('owner', :'own1'::uuid), ('admin', :'adm'::uuid)) u (who, id);
create temp table t_denied as
  select a.from_s, a.to_s, pg_temp.attempt(:'own1', a.from_s, a.to_s) as r
  from t_refused a;
create temp table t_noop as
  select s, pg_temp.attempt(:'adm', s, s) as r from unnest(array['draft', 'open', 'paused', 'closed', 'filled']) s;

-- AC1: the eight allowed changes succeed for the owner and for the admin, each audited once with actor and both statuses.
select is((select count(*) from t_ran), 16::bigint, 'eight allowed changes were each applied by the owner and by the admin');
select is((select count(*) from t_ran where r ->> 'result' = 'ok'), 16::bigint, 'every allowed change succeeds');
select is((select count(*) from t_ran where r ->> 'status' = to_s), 16::bigint, 'and the status is the new value');
select is((select count(*) from t_ran where (r ->> 'audits')::int = 1), 16::bigint, 'exactly one job.status_changed row exists per change');
select is(
  (select count(*) from t_ran where r ->> 'from' = from_s and r ->> 'to' = to_s), 16::bigint,
  'the row holds the old and the new status'
);
select is(
  (select count(*) from t_ran where r ->> 'actor' = case who when 'owner' then :'own1' else :'adm' end), 16::bigint,
  'and names the user who made the change as the actor'
);
select is((select count(*) from t_ran where (r ->> 'updates')::int = 0), 16::bigint, 'a status change writes no job.updated row');
select is((select count(*) from t_ran where (r ->> 'changed_now')::boolean), 16::bigint, 'status_changed_at is set on every change');
select is(
  (select count(*) from t_ran where to_s = 'open' and from_s = 'draft' and (r ->> 'published_now')::boolean), 2::bigint,
  'published_at is set at the first draft to open'
);
select is(
  (select count(*) from t_ran where to_s = 'open' and from_s <> 'draft' and (r ->> 'published_kept')::boolean), 4::bigint,
  'published_at is unchanged by paused to open and closed to open'
);
select is(
  (select count(*) from t_ran where to_s <> 'open' and (r ->> 'published_kept')::boolean), 10::bigint,
  'and by a change that does not open the vacancy'
);

select pg_temp.job_in('draft') as chain \gset
select pg_temp.set_status(:'adm', :'chain', 'open') as c1 \gset
update public.jobs set published_at = '2020-03-03T00:00:00Z' where id = :'chain';
select pg_temp.set_status(:'adm', :'chain', 'paused') as c2 \gset
select pg_temp.set_status(:'adm', :'chain', 'open') as c3 \gset
select is(
  (select published_at from public.jobs where id = :'chain'), '2020-03-03T00:00:00Z'::timestamptz,
  'a vacancy that goes draft, open, paused, open keeps the published_at of its first publication'
);
select is(
  (select count(*) from audit.log where entity_id = :'chain' and action = 'job.status_changed'), 3::bigint,
  'and has one audit row per change'
);
-- The query of docs/runbooks/vacancy-lifecycle.md section 1, with its audit.log read narrowed to the vacancy of this test.
select is(
  (with changes as (
     select entity_id::uuid as job_id, created_at, metadata ->> 'to' as to_status,
            lead(created_at) over (partition by entity_id order by id) as next_at
     from audit.log
     where action = 'job.status_changed' and entity_id = :'chain'
   )
   select count(*) || '/' || count(next_at) || '/' || (avg(next_at - created_at) is not null)
   from changes where to_status = 'open'),
  '2/1/true', 'the KPI "average time Open" finds two spells, one of them ended, and averages the ended one'
);

select pg_temp.job_in('open') as moderated \gset
update public.jobs set moderation_state = 'hidden' where id = :'moderated';
select is(
  (select status_changed_at from public.jobs where id = :'moderated'), '2020-01-01T00:00:00Z'::timestamptz,
  'a moderation_state change does not alter status_changed_at'
);
select is(
  (select count(*) from audit.log where entity_id = :'moderated' and action = 'job.status_changed'), 0::bigint,
  'and writes no status audit row'
);
select pg_temp.set_status(:'adm', :'moderated', 'paused') as c4 \gset
select is((select status from public.jobs where id = :'moderated'), 'paused'::public.job_status, 'a hidden vacancy can still be paused by its admin');

-- AC2: the twelve refused changes fail, change nothing and write nothing; the same status is a no-op.
select is((select count(*) from t_denied), 12::bigint, 'twelve refused changes were attempted');
select is(
  (select count(*) from t_denied where r ->> 'result' = 'P0001|CHARA_INVALID_TRANSITION|' || from_s || ' to ' || to_s), 12::bigint,
  'each fails with CHARA_INVALID_TRANSITION naming both statuses'
);
select is((select count(*) from t_denied where r ->> 'status' = from_s), 12::bigint, 'each vacancy keeps its status');
select is((select count(*) from t_denied where (r ->> 'audits')::int = 0), 12::bigint, 'and no audit row is written');
select is((select count(*) from t_denied where not (r ->> 'changed_now')::boolean), 12::bigint, 'and status_changed_at is not touched');
select is((select count(*) from t_noop where r ->> 'result' = 'ok'), 5::bigint, 'setting the status a vacancy already has succeeds in every status');
select is((select count(*) from t_noop where (r ->> 'audits')::int = 0 and (r ->> 'updates')::int = 0), 5::bigint, 'and writes no audit row');
select is(
  (select count(*) from t_noop where r ->> 'status' = s and not (r ->> 'changed_now')::boolean), 5::bigint,
  'and leaves status and status_changed_at as they were'
);
select is(
  (select count(*) from t_denied where from_s = 'filled' and r ->> 'status' = 'filled'), 4::bigint, 'a Filled vacancy never changes status again'
);

-- The owner's session is not the only guard: the database owner, with no user and no setting, is refused as well.
select pg_temp.job_in('open') as bare \gset
select throws_ok(
  format($$update public.jobs set status = 'paused' where id = %L$$, :'bare'), '42501', 'CHARA_FORBIDDEN',
  'a status change with no signed-in user and no system setting is refused'
);
select is((select status from public.jobs where id = :'bare'), 'open'::public.job_status, 'and the vacancy stays open');

-- AC3: only an owner or admin of the organisation changes status.
-- RLS stops a non-admin before the trigger runs, so the guard's own check is reached with the table owner (which skips
-- RLS) carrying the user's claims.
select pg_temp.job_in('open') as guard_job \gset
select set_config('request.jwt.claims', json_build_object('sub', :'mem'::text, 'role', 'authenticated', 'aal', 'aal1')::text, true) as as_member \gset
select throws_ok(
  format($$update public.jobs set status = 'paused' where id = %L$$, :'guard_job'), '42501', 'CHARA_FORBIDDEN',
  'the guard refuses a member of the organisation even where row level security is skipped'
);
select set_config('request.jwt.claims', json_build_object('sub', :'adm2'::text, 'role', 'authenticated', 'aal', 'aal1')::text, true) as as_other \gset
select throws_ok(
  format($$update public.jobs set status = 'paused' where id = %L$$, :'guard_job'), '42501', 'CHARA_FORBIDDEN',
  'and an admin of another organisation'
);
select is(
  (select status::text || '/' || (select count(*) from audit.log where entity_id = :'guard_job' and action = 'job.status_changed')
   from public.jobs where id = :'guard_job'),
  'open/0', 'the status and the audit log are unchanged'
);
select set_config('request.jwt.claims', json_build_object('sub', :'adm'::text, 'role', 'authenticated', 'aal', 'aal1')::text, true) as as_admin \gset
select lives_ok(
  format($$update public.jobs set status = 'paused' where id = %L$$, :'guard_job'), 'the same update by an admin of the organisation succeeds'
);
select set_config('request.jwt.claims', '', true) as claims_off \gset
select is((select status from public.jobs where id = :'guard_job'), 'paused'::public.job_status, 'and pauses the vacancy');

-- A soft-deleted vacancy is immutable: no actor changes its status and the lapse skips it.
select pg_temp.job_in('open', null, 'visible', true, 'Deleted open') as gone \gset
select is(
  pg_temp.set_status(:'own1', :'gone', 'paused'), 'P0001|CHARA_INVALID_TRANSITION|deleted',
  'the owner cannot change the status of a soft-deleted vacancy'
);
select is(
  (select status::text || '/' || (select count(*) from audit.log where entity_id = :'gone' and action = 'job.status_changed')
   from public.jobs where id = :'gone'),
  'open/0', 'which keeps its status and writes no audit row'
);

select pg_temp.job_in('open') as acme_open \gset
select is(
  pg_temp.affected_as(:'mem', 'authenticated', format($$update public.jobs set status = 'paused' where id = %L$$, :'acme_open')), 0::bigint,
  'a member of the organisation updates no row'
);
select is(
  pg_temp.affected_as(:'adm2', 'authenticated', format($$update public.jobs set status = 'paused' where id = %L$$, :'acme_open')), 0::bigint,
  'an admin of another organisation updates no row'
);
select is(
  pg_temp.affected_as(:'own2', 'authenticated', format($$update public.jobs set status = 'paused' where id = %L$$, :'acme_open')), 0::bigint,
  'the owner of another organisation updates no row'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$update public.jobs set status = 'paused' where id = %L$$, :'acme_open')), 0::bigint,
  'a candidate updates no row'
);
select is(
  split_part(pg_temp.call_as(null, 'anon', format($$update public.jobs set status = 'paused' where id = %L$$, :'acme_open')), '|', 1), '42501',
  'an anonymous caller is refused: no update grant'
);
select is((select status from public.jobs where id = :'acme_open'), 'open'::public.job_status, 'the vacancy stays open');
select is((select count(*) from audit.log where entity_id = :'acme_open' and action = 'job.status_changed'), 0::bigint, 'and no audit row exists');
select is(
  pg_temp.affected_as(:'own1', 'authenticated', format($$update public.jobs set status = 'paused' where id = %L$$, :'acme_open')), 1::bigint,
  'the owner of the organisation does update it'
);
select is(
  pg_temp.state_as(:'adm', format($$update public.jobs set status_changed_at = now() where id = %L$$, :'acme_open')), '42501',
  'status_changed_at is not client-writable'
);
select is(
  pg_temp.state_as(:'adm', format($$update public.jobs set published_at = now() where id = %L$$, :'acme_open')), '42501',
  'published_at is not client-writable'
);
select is(
  split_part(pg_temp.call_as(null, 'anon', 'select published_at, status_changed_at from public.jobs'), '|', 1), 'ok',
  'both columns are readable (the public page shows the posting date)'
);

-- AC4: the system pauses Open vacancies on lapse, and that is the only change it may make.
select pg_temp.job_in('open', current_setting('t.b')::uuid) as b1 \gset
select pg_temp.job_in('open', current_setting('t.b')::uuid, 'hidden') as b2 \gset
select pg_temp.job_in('open', current_setting('t.b')::uuid) as b3 \gset
select pg_temp.job_in('draft', current_setting('t.b')::uuid) as bd \gset
select pg_temp.job_in('paused', current_setting('t.b')::uuid) as bp \gset
select pg_temp.job_in('closed', current_setting('t.b')::uuid) as bc \gset
select pg_temp.job_in('open', current_setting('t.a')::uuid) as acme_other \gset
select pg_temp.job_in('open', current_setting('t.b')::uuid, 'visible', true, 'Deleted open of Beta') as bdel \gset

select is((select value #>> '{}' from private.settings where key = 'entitlements_enforced'), 'false', 'setup: entitlements are not enforced');
select count(*) as before_all from public.jobs \gset
select private.pause_jobs_on_lapse(current_setting('t.b')::uuid) as lapse1 \gset
select is(
  (select array_agg(id order by title, id) from public.jobs where organization_id = current_setting('t.b')::uuid and status = 'paused'),
  (select array_agg(id order by title, id) from public.jobs where id in (:'b1', :'b2', :'b3', :'bp')),
  'the three open vacancies, the hidden one included, and the one already paused are paused'
);
select is(
  (select status::text from public.jobs where id = :'bd') || '/' || (select status::text from public.jobs where id = :'bc'),
  'draft/closed', 'the draft and the closed vacancy are untouched'
);
select is(
  (select count(*) from audit.log where action = 'job.status_changed' and entity_id in (:'b1', :'b2', :'b3')), 3::bigint,
  'one audit row per paused vacancy'
);
select is(
  (select count(*) from audit.log where action = 'job.status_changed' and entity_id in (:'b1', :'b2', :'b3')
     and actor_id is null and metadata = jsonb_build_object(
       'organization_id', current_setting('t.b'), 'from', 'open', 'to', 'paused', 'actor_fn', 'pause_jobs_on_lapse')),
  3::bigint, 'with no actor and the function named in the metadata'
);
select is((select count(*) from audit.log where entity_id in (:'bd', :'bp', :'bc') and action = 'job.status_changed'), 0::bigint, 'no row for the vacancies it did not change');
select is(
  (select status::text || '/' || (select count(*) from audit.log where entity_id = :'bdel' and action = 'job.status_changed')
   from public.jobs where id = :'bdel'),
  'open/0', 'a soft-deleted open vacancy is not paused and writes no audit row'
);
select is((select status from public.jobs where id = :'acme_other'), 'open'::public.job_status, 'a vacancy of another organisation is not touched');
select is(current_setting('chara.actor_fn', true), '', 'the setting does not outlive the function');
select private.pause_jobs_on_lapse(current_setting('t.b')::uuid) as lapse_again \gset
select is(
  (select count(*) from audit.log where action = 'job.status_changed' and metadata ->> 'actor_fn' = 'pause_jobs_on_lapse'), 3::bigint,
  'a second run changes and writes nothing'
);

-- With the limits on, reopening goes through the active_jobs check (FR-C6): Beta is given a Basic plan for the setup.
update private.settings set value = 'true' where key = 'entitlements_enforced';
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (current_setting('t.b')::uuid, 'employer_starter', 'active', 'null');
select pg_temp.set_status(:'adm2', :'b1', 'open') as reopen \gset
select is(
  (select status from public.jobs where id = :'b1'), 'open'::public.job_status, 'setup: the administrator of the organisation reopens one vacancy'
);
select private.pause_jobs_on_lapse(current_setting('t.b')::uuid) as lapse_again \gset
select is(
  (select status from public.jobs where id = :'b1'), 'paused'::public.job_status,
  'the rule applies whether or not entitlements are enforced'
);
update private.settings set value = 'false' where key = 'entitlements_enforced';
delete from billing.subscriptions where organization_id = current_setting('t.b')::uuid;

select throws_ok(
  format($$update public.jobs set status = 'paused' where id = %L$$, :'acme_other'), '42501', 'CHARA_FORBIDDEN',
  'an open to paused update with no user and no setting is refused'
);
select set_config('chara.actor_fn', 'pause_jobs_on_lapse', true) as set_on \gset
select throws_ok(
  format($$update public.jobs set status = 'open' where id = %L$$, :'bd'), 'P0001', 'CHARA_INVALID_TRANSITION',
  'the setting does not allow draft to open'
);
select throws_ok(
  format($$update public.jobs set status = 'open' where id = %L$$, :'bp'), 'P0001', 'CHARA_INVALID_TRANSITION',
  'the setting does not allow paused to open'
);
select throws_ok(
  format($$update public.jobs set status = 'closed' where id = %L$$, :'acme_other'), 'P0001', 'CHARA_INVALID_TRANSITION',
  'the setting does not allow open to closed'
);
select lives_ok(
  format($$update public.jobs set status = 'paused' where id = %L$$, :'acme_other'), 'the setting allows open to paused'
);
select set_config('chara.actor_fn', '', true) as set_off \gset
select is((select count(*) from public.jobs), :before_all::bigint, 'no vacancy is deleted');
select is(
  (select count(*) from public.jobs where id in (:'b1', :'b2', :'b3', :'bd', :'bp', :'bc')), 6::bigint, 'the six vacancies of the lapsed organisation all still exist'
);
select is(
  (select bool_or(has_function_privilege(r, 'private.pause_jobs_on_lapse(uuid)', 'execute'))
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  false, 'no API role may run the lapse function'
);
select is(
  has_function_privilege('billing_owner', 'private.pause_jobs_on_lapse(uuid)', 'execute'), true,
  'billing_owner, which applies billing events, may'
);
select is(
  (select p.prosecdef and 'search_path=""' = any (p.proconfig) from pg_proc p where p.oid = 'private.pause_jobs_on_lapse(uuid)'::regprocedure),
  true, 'the lapse function is a definer function with an empty search_path'
);
select is(
  (select 'search_path=""' = any (p.proconfig) from pg_proc p where p.oid = 'private.jobs_guard_transition()'::regprocedure),
  true, 'the guard has an empty search_path'
);
select is(
  (select t.tgenabled from pg_trigger t where t.tgname = 'jobs_guard_transition' and t.tgrelid = 'public.jobs'::regclass),
  'A'::"char", 'the guard trigger fires in every replication role'
);

-- AC5: of every combination of status, moderation state and deletion only the open, visible, undeleted vacancy is public.
select count(pg_temp.job_in(s, current_setting('t.a')::uuid, m, d, 'Matrix ' || s || ' ' || m || ' ' || d)) as made
from unnest(array['draft', 'open', 'paused', 'closed', 'filled']) s,
     unnest(array['visible', 'hidden', 'org_suspended']) m,
     unnest(array[false, true]) d \gset
select is((select count(*) from public.jobs where title like 'Matrix %'), 30::bigint, 'setup: thirty vacancies cover every combination');
select is(
  pg_temp.affected_as(null, 'anon', $$select id from public.jobs where title like 'Matrix %'$$), 1::bigint, 'an anonymous caller reads exactly one of them'
);
select is(
  pg_temp.affected_as(
    null, 'anon', $$select id from public.jobs where title like 'Matrix %' and status = 'open' and moderation_state = 'visible' and deleted_at is null$$
  ), 1::bigint, 'the open, visible, undeleted one'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', $$select id from public.jobs where title like 'Matrix %'$$), 1::bigint,
  'a signed-in candidate reads the same one'
);
select is(
  pg_temp.affected_as(:'adm2', 'authenticated', $$select id from public.jobs where title like 'Matrix %'$$), 1::bigint,
  'and so does an admin of another organisation'
);
select is(
  pg_temp.affected_as(:'mem', 'authenticated', $$select id from public.jobs where title like 'Matrix %'$$), 30::bigint,
  'a member of the owning organisation reads all thirty'
);

select * from finish();
rollback;
