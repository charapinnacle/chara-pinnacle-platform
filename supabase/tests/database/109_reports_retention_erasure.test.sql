begin;
select plan(24);

\ir status_fixture.inc

-- FR-B6, NFR-C1, D82: closed reports are kept for a period and then removed, open ones never; the erasure of a candidate
-- takes the account and the address out of the reports the candidate made.

create function pg_temp.erase(p_user uuid) returns text
language sql as $$ select pg_temp.call_as(null, 'service_role', format('select public.erase_user(%L)', p_user)) $$;

create function pg_temp.old_report(
  p_status text, p_days_ago integer, p_user uuid default null, p_email text default null, p_at_days integer default null
) returns bigint
language sql as $$
  insert into public.reports (target_type, content_path, category, details, reporter_user_id, reporter_email, good_faith_confirmed,
                              status, handled_by, handled_at, resolution_note, created_at)
  values ('content', '/en', 'other', 'Text of the report that is long enough.', p_user, p_email, true, p_status::public.report_status,
          case when p_status <> 'new' then gen_random_uuid() end,
          case when p_status <> 'new' then now() - make_interval(days => p_days_ago) end,
          case when p_status in ('actioned', 'dismissed') then 'The note of the closing.' end,
          now() - make_interval(days => coalesce(p_at_days, p_days_ago + 5)))
  returning id
$$;

-- Retention
select is((select days from private.retention_policies where entity = 'closed_reports'), 365, 'AC: closed reports are kept 365 days after the closing, a default for CHARA to confirm');
select pg_temp.old_report('actioned', 366) as closed_old \gset
select pg_temp.old_report('dismissed', 400) as dismissed_old \gset
select pg_temp.old_report('actioned', 364) as closed_young \gset
select pg_temp.old_report('dismissed', 60) as dismissed_young \gset
select pg_temp.old_report('new', 900) as open_new \gset
select pg_temp.old_report('in_review', 900) as open_review \gset
select (select count(*) from audit.log where action = 'retention.run') as runs_before \gset
select private.apply_retention();
select is(
  (select string_agg(id::text, ',' order by id) from public.reports where id in (:'closed_old', :'dismissed_old')), null,
  'AC: a report closed more than 365 days ago is removed, actioned or dismissed'
);
select is(
  (select count(*) from public.reports where id in (:'closed_young', :'dismissed_young')), 2::bigint, 'one closed a day short of the period is kept, and a recent one'
);
select is(
  (select count(*) from public.reports where id in (:'open_new', :'open_review')), 2::bigint, 'open reports are never removed, however old'
);
select is(
  (select format('%s|%s|%s|%s', actor_id is null, entity_type, metadata ->> 'days', metadata ->> 'removed')
   from audit.log where action = 'retention.run' and entity_id = 'closed_reports'),
  't|retention_policies|365|2', 'the run is audited with the period and the number removed, and has no actor'
);
select private.apply_retention();
select is(
  (select count(*) from audit.log where action = 'retention.run' and entity_id = 'closed_reports' and (metadata ->> 'removed')::int = 0), 1::bigint,
  'a second run removes nothing and says so'
);
update private.retention_policies set days = 30 where entity = 'closed_reports';
select private.apply_retention();
select is(
  (select count(*) from public.reports where id in (:'closed_young', :'dismissed_young')), 0::bigint, 'the period is a setting: with 30 days the others go'
);
select is(
  (select count(*) from public.reports where id in (:'open_new', :'open_review')), 2::bigint, 'and the open ones still stay'
);
delete from private.retention_policies where entity = 'closed_reports';
select pg_temp.old_report('actioned', 1000) as closed_ancient \gset
select (select count(*) from audit.log where action = 'retention.run' and entity_id = 'closed_reports') as rule_runs \gset
select private.apply_retention();
select is(
  (select count(*) from public.reports where id = :'closed_ancient'), 1::bigint, 'without a row for the period the rule is skipped'
);
select is(
  (select count(*) from audit.log where action = 'retention.run' and entity_id = 'closed_reports'), :'rule_runs'::bigint, 'and writes no audit row'
);
insert into private.retention_policies (entity, days) values ('closed_reports', 365);
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', 'select * from private.retention_policies', 'aal2'), '42501|permission denied for table retention_policies|',
  'the periods stay unreadable for the API roles'
);
select ok(
  exists (select 1 from pg_indexes where tablename = 'reports' and indexname = 'reports_closed_idx' and indexdef ~ 'handled_at'),
  'an index on the closing time serves the daily delete'
);

-- Erasure of a candidate
select pg_temp.old_report('new', 3, p_user => :'wa', p_at_days => 3) as ra1 \gset
select pg_temp.old_report('actioned', 1, p_user => :'wa', p_at_days => 4) as ra2 \gset
select pg_temp.old_report('new', 2, p_email => (select email from auth.users where id = :'wa'), p_at_days => 2) as rv_wa \gset
select pg_temp.old_report('new', 2, p_email => 'someone.else@example.test', p_at_days => 2) as rv_other \gset
select pg_temp.old_report('new', 2, p_user => :'wb', p_at_days => 2) as rb \gset
select count(*) as reports_before from public.reports \gset
update public.profiles set deleted_at = now() - interval '31 days' where id = :'wa';
select is(pg_temp.erase(:'wa'), 'ok', 'erase_user runs for the candidate');
select is((select count(*) from public.reports), :'reports_before'::bigint, 'AC: no report is deleted by an erasure');
select is(
  (select count(*) from public.reports where reporter_user_id = :'wa'), 0::bigint, 'AC: no report names the erased account any more'
);
select is(
  (select count(distinct reporter_user_id) from public.reports where id in (:'ra1', :'ra2')), 1::bigint,
  'AC: both reports of the candidate carry the same pseudonym instead'
);
select is(
  (select reporter_user_id::text from public.reports where id = :'ra1'), (select entity_id from audit.log where action = 'account.erased'),
  'which is the pseudonym of the erasure in the audit log'
);
select is(
  (select count(*) from public.reports where id in (:'ra1', :'ra2') and reporter_email is null), 2::bigint, 'and neither has an address'
);
select is(
  (select details from public.reports where id = :'ra2'), 'Text of the report that is long enough.', 'the text of the report and its outcome are kept for the retention period'
);
select is(
  (select format('%s|%s', reporter_email is null, reporter_user_id is null) from public.reports where id = :'rv_wa'), 't|t',
  'AC: the address of the candidate, given as a visitor, is cleared, and the report stays without an account'
);
select is(
  (select reporter_email from public.reports where id = :'rv_other'), 'someone.else@example.test', 'the address of someone else is kept'
);
select is(
  (select reporter_user_id from public.reports where id = :'rb'), :'wb'::uuid, 'and so is the account of another reporter'
);
select is(
  pg_temp.call_as(:'wb', 'authenticated', 'select * from public.list_my_reports()', 'aal1'), 'ok', 'another reporter still lists their reports'
);
select is(
  (select count(*) from audit.log where action = 'report.submitted' and actor_id = :'wa'), 0::bigint,
  'no audit row of a report names the erased account either'
);

select * from finish();
rollback;
