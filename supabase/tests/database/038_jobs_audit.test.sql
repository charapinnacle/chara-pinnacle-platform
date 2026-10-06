begin;
select plan(32);

\ir jobs_fixture.inc

-- FR-C1 step "Save draft": the creation is audited once, with the actor and the organisation, and without the text.
select pg_temp.insert_as(:'adm', '{"title": "Audit check"}') as created \gset
select is(:'created'::text, 'ok', 'setup: an admin creates a vacancy');
select is(
  (select count(*) from audit.log a join public.jobs j on j.id::text = a.entity_id
   where a.action = 'job.created' and j.title = 'Audit check'),
  1::bigint, 'exactly one job.created row exists for the vacancy'
);
select is(
  (select a.actor_id from audit.log a join public.jobs j on j.id::text = a.entity_id
   where a.action = 'job.created' and j.title = 'Audit check'),
  :'adm'::uuid, 'the row names the admin as the actor'
);
select is(
  (select a.metadata from audit.log a join public.jobs j on j.id::text = a.entity_id
   where a.action = 'job.created' and j.title = 'Audit check'),
  jsonb_build_object('organization_id', current_setting('t.a')), 'and only the organisation, no text of the vacancy'
);
select is(
  pg_temp.insert_as(:'mem', '{"title": "Refused one"}'), '42501|new row violates row-level security policy for table "jobs"|',
  'a refused insert is refused by row level security'
);
select is(
  (select count(*) from audit.log where action = 'job.created'), 1::bigint, 'one job.created row in all'
);

select id as job from public.jobs where title = 'Audit check' \gset

-- Updates: the changed columns are named, a status change carries both statuses, a no-change update writes nothing.
select count(*) as base from audit.log where action = 'job.updated' and entity_id = :'job' \gset
update public.jobs set title = title where id = :'job';
select is(
  (select count(*) from audit.log where action = 'job.updated' and entity_id = :'job'), :base::bigint,
  'an update that changes nothing writes no audit row'
);
update public.jobs set city = 'Bremen', salary_min = 1000, salary_currency = 'EUR', salary_period = 'month' where id = :'job';
select is(
  (select metadata -> 'changed_fields' from audit.log where action = 'job.updated' and entity_id = :'job' order by id desc limit 1),
  '["city", "salary_currency", "salary_min", "salary_period"]'::jsonb, 'an update names every changed column, sorted'
);
select ok(
  not ((select metadata from audit.log where action = 'job.updated' and entity_id = :'job' order by id desc limit 1) ? 'to'),
  'a content update carries no status'
);
select pg_temp.set_status(:'adm', :'job', 'open') as made_open \gset
select is(
  (select metadata - 'organization_id' from audit.log where action = 'job.status_changed' and entity_id = :'job' order by id desc limit 1),
  '{"from": "draft", "to": "open"}'::jsonb,
  'a status change is its own action and records both statuses, which the average-time-open KPI reads'
);
select is(
  (select count(*) from audit.log where action = 'job.updated' and entity_id = :'job'), :base::bigint + 1,
  'a status change writes no job.updated row'
);
select ok(
  (select p.published_at - j.created_at < interval '1 day' from public.jobs p, public.jobs j where p.id = :'job' and j.id = p.id),
  'the KPI "published within 1 day of creation" (published_at minus created_at) is answerable from the stored row'
);
select ok(
  not exists (select 1 from audit.log where action like 'job.%' and metadata::text like '%Bremen%'),
  'no audit row holds a value of the vacancy'
);

-- record_job_form_invalid: the refused form submissions behind the validation error rate.
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_form_invalid(%L, array['title', 'salaryMin'])$$, current_setting('t.a')), 'aal1'),
  'ok', 'an admin reports a refused submission'
);
select is(
  (select metadata from audit.log where action = 'job.form_invalid' order by id desc limit 1),
  '{"fields": ["title", "salaryMin"]}'::jsonb, 'the row holds the field names only'
);
select is(
  (select entity_id || '/' || (actor_id = :'adm'::uuid)::text from audit.log where action = 'job.form_invalid' order by id desc limit 1),
  current_setting('t.a') || '/true', 'filed under the organisation, actor the admin'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.record_job_form_invalid(%L, array['title'])$$, current_setting('t.a')), 'aal1'),
  'ok', 'an owner can report too'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select public.record_job_form_invalid(%L, array['title'])$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|', 'a member cannot report'
);
select is(
  pg_temp.call_as(:'adm2', 'authenticated', format($$select public.record_job_form_invalid(%L, array['title'])$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|', 'an admin of another organisation cannot report'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', format($$select public.record_job_form_invalid(%L, array['title'])$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|', 'a candidate cannot report'
);
select is(
  split_part(pg_temp.call_as(null, 'anon', format($$select public.record_job_form_invalid(%L, array['title'])$$, current_setting('t.a'))), '|', 1),
  '42501', 'an anonymous caller has no execute grant'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_form_invalid(%L, array[]::text[])$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|p_fields', 'an empty list of fields is refused'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_form_invalid(%L, array['not a field name'])$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|p_fields', 'a value that is not a field name is refused'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_form_invalid(%L, array['title', 'someOtherField'])$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|p_fields', 'a well-formed name that is not a field of the form is refused'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_form_invalid(%L, array_fill('a'::text, array[21]))$$, current_setting('t.a')), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|p_fields', 'more than 20 fields are refused'
);
select is(
  (select count(*) from audit.log where action = 'job.form_invalid'), 2::bigint, 'only the two accepted reports were written'
);

update private.settings set value = '3' where key = 'job_form_invalid_per_hour_max';
select pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_form_invalid(%L, array['city'])$$, current_setting('t.a')), 'aal1') as third \gset
select pg_temp.call_as(:'adm', 'authenticated', format($$select public.record_job_form_invalid(%L, array['city'])$$, current_setting('t.a')), 'aal1') as fourth \gset
select is(
  (select count(*) from audit.log where action = 'job.form_invalid' and actor_id = :'adm'), 3::bigint,
  'the hourly ceiling is read from the setting and stops the audit rows of one user'
);
select is(:'third' || '/' || :'fourth', 'ok/ok', 'a call beyond the ceiling does nothing and is not an error');
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.record_job_form_invalid(%L, array['city'])$$, current_setting('t.a')), 'aal1'),
  'ok', 'the ceiling counts per user'
);
select is(
  (select count(*) from audit.log where action = 'job.form_invalid' and actor_id = :'own1'), 2::bigint, 'the other user kept writing'
);
update private.settings set value = '0' where key = 'job_form_invalid_per_hour_max';
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.record_job_form_invalid(%L, array['city'])$$, current_setting('t.a')), 'aal1'),
  'ok', 'a ceiling of zero records nothing'
);
select is(
  (select count(*) from audit.log where action = 'job.form_invalid' and actor_id = :'own1'), 2::bigint, 'and no row appeared'
);

select * from finish();
rollback;
