begin;
select plan(14);

\ir jobs_fixture.inc

-- FR-C1 AC11 and FR-C2 as the edit page uses them (OPEN_QUESTIONS.md D78): an owner or admin corrects the content of a
-- vacancy in any status; the edit keeps the status, its dates and the moderation state, is audited as job.updated, and
-- an open vacancy shows the new text to the public at once with a new lastmod for the sitemap.

create function pg_temp.seed(p_status text, p_moderation text default 'visible') returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  execute pg_temp.insert_job(current_setting('t.a')::uuid, jsonb_build_object(
    'status', p_status, 'moderation_state', p_moderation, 'created_at', now() - interval '3 days',
    'status_changed_at', now() - interval '2 days', 'published_at', now() - interval '2 days'
  )) || ' returning id' into v_id;
  update public.jobs set updated_at = now() - interval '1 day' where id = v_id;
  return v_id;
end;
$$;

-- The trigger stamps every update, so the past updated_at of the seeds is written with it switched off.
alter table public.jobs disable trigger jobs_touch_updated_at;
select pg_temp.seed('open') as open_job \gset
select pg_temp.seed('open', 'hidden') as hidden_job \gset
select pg_temp.seed('paused') as paused_job \gset
alter table public.jobs enable always trigger jobs_touch_updated_at;
select count(*) as audit_base from audit.log where entity_id in (:'open_job', :'hidden_job', :'paused_job') \gset

-- An admin corrects an open vacancy
select is(
  pg_temp.affected_as(:'adm', 'authenticated', format(
    $$update public.jobs set title = 'Welder MIG/MAG night shift', city = 'Bremen', salary_min = 3000, salary_max = 3600,
      salary_currency = 'EUR', salary_period = 'month' where id = %L$$, :'open_job')),
  1::bigint, 'an admin edits the content of an open vacancy'
);
select is(
  (select format('%s|%s|%s|%s', status, status_changed_at = now() - interval '2 days', published_at = now() - interval '2 days', updated_at = now())
   from public.jobs where id = :'open_job'),
  'open|t|t|t', 'the status and its dates are kept and updated_at is stamped'
);
select is(
  (select metadata -> 'changed_fields' from audit.log where action = 'job.updated' and entity_id = :'open_job'),
  '["city", "salary_currency", "salary_max", "salary_min", "salary_period", "title"]'::jsonb,
  'one job.updated row names the changed columns'
);
select is(
  (select count(*) from audit.log where action = 'job.status_changed' and entity_id = :'open_job'), 0::bigint,
  'the edit writes no status change'
);
select is(
  pg_temp.call_as(null, 'anon', format($$select set_config('t.public', (select title || '|' || city from public.get_public_job(%L)), true)$$, :'open_job'), 'aal1')
    || '|' || current_setting('t.public'),
  'ok|Welder MIG/MAG night shift|Bremen', 'a visitor reads the new title and city on the public vacancy at once'
);
select is(
  pg_temp.call_as(null, 'anon', format(
    $$select set_config('t.lastmod', (select e ->> 'updated_at' from jsonb_array_elements(public.list_sitemap_jobs()) e where e ->> 'id' = %L), true)$$,
    :'open_job'), 'aal1') || '|' || (current_setting('t.lastmod')::timestamptz = now()),
  'ok|true', 'the sitemap entry of the vacancy carries the time of the edit'
);

-- The owner edits a paused vacancy; it stays paused
select is(
  pg_temp.affected_as(:'own1', 'authenticated', format($$update public.jobs set visa_support = false where id = %L$$, :'paused_job')),
  1::bigint, 'the owner edits a paused vacancy'
);
select is((select status::text from public.jobs where id = :'paused_job'), 'paused', 'the paused vacancy stays paused');

-- A vacancy hidden by moderation: the content can be corrected, the moderation state cannot
select is(
  pg_temp.affected_as(:'adm', 'authenticated', format($$update public.jobs set title = 'Welder corrected wording' where id = %L$$, :'hidden_job')),
  1::bigint, 'an admin corrects the wording of a hidden vacancy'
);
select is(
  pg_temp.state_as(:'adm', format($$update public.jobs set moderation_state = 'visible' where id = %L$$, :'hidden_job')), '42501',
  'the admin cannot change its moderation state'
);
select is(
  (select format('%s|%s', moderation_state, status) from public.jobs where id = :'hidden_job'), 'hidden|open',
  'the hidden vacancy stays hidden and open'
);
select is(
  pg_temp.affected_as(null, 'anon', format($$select id from public.jobs where id = %L$$, :'hidden_job')), 0::bigint,
  'the corrected hidden vacancy is still not public'
);

-- A member and another organisation's admin change nothing
select is(
  pg_temp.affected_as(:'mem', 'authenticated', format($$update public.jobs set title = 'Member edit' where id = %L$$, :'open_job'))
    + pg_temp.affected_as(:'adm2', 'authenticated', format($$update public.jobs set title = 'Beta edit' where id = %L$$, :'open_job')),
  0::bigint, 'a member and the admin of another organisation update no row'
);
select is(
  (select count(*) from audit.log where entity_id in (:'open_job', :'hidden_job', :'paused_job')), :audit_base + 3::bigint,
  'exactly the three accepted edits were audited'
);

select * from finish();
rollback;
