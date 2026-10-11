begin;
select plan(69);

\ir status_fixture.inc

-- FR-F1, FR-C7, FR-F3, D82: the queue of Trust & Safety (read also by the Platform Administrator), the status changes with
-- their audit rows, and what a signed-in reporter sees of their own reports.

\set gone_trust '00000000-0000-0000-0000-00000000b811'
\set request '4f2d8c1e-7a3b-4d5e-9f60-1b2c3d4e5f60'
select pg_temp.new_user(:'gone_trust');
update public.profiles set account_kind = intended_account_kind where id = :'gone_trust';
insert into public.platform_staff (user_id, role, revoked_at) values (:'gone_trust', 'trust_safety', now());
select set_config('request.headers', json_build_object('x-request-id', :'request')::text, true);

create function pg_temp.seed_report(
  p_type text, p_job uuid default null, p_org uuid default null, p_app uuid default null, p_path text default null,
  p_category text default 'misleading_or_fraud', p_user uuid default null, p_email text default null,
  p_at timestamptz default now(), p_details text default 'Seeded text of the report, long enough.'
) returns bigint
language sql as $$
  insert into public.reports (target_type, job_id, organization_id, application_id, content_path, category, details, reporter_user_id,
                              reporter_email, good_faith_confirmed, created_at)
  values (p_type::public.report_target_type, p_job, p_org, p_app, p_path, p_category::public.report_category, p_details, p_user,
          p_email, true, p_at)
  returning id
$$;

-- The ids of a query's rows as one text in the order returned, or the refusal as 'sqlstate|message|detail'.
create function pg_temp.call_ids(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v jsonb := pg_temp.json_as(p_user, p_sql, p_aal);
begin
  return case when jsonb_typeof(v) = 'string' then v #>> '{}'
    else (select coalesce(string_agg(e ->> 'id', ',' order by o), '') from jsonb_array_elements(v) with ordinality t (e, o)) end;
end;
$$;

create function pg_temp.status_as(p_user uuid, p_id bigint, p_status text, p_note text default null, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.admin_set_report_status(%L, %L, %L)', p_id, p_status, p_note), p_aal)
$$;

create function pg_temp.staff_json(p_user uuid, p_sql text) returns jsonb
language sql as $$ select pg_temp.json_as(p_user, p_sql, 'aal2') $$;

create function pg_temp.writes() returns text
language sql as $$
  select (select string_agg(id || ':' || status || ':' || coalesce(handled_at::text, '-') || ':' || coalesce(resolution_note, '-'), ',' order by id) from public.reports)
      || ',' || (select count(*) from audit.log) || ',' || (select count(*) from pgmq.q_notifications)
$$;

select pg_temp.open_job('Queue vacancy') as v1 \gset
select pg_temp.open_job('Queue second') as v2 \gset
select pg_temp.seed_app('applied') as app_a \gset

-- Seven reports, oldest first: the ids ascend with the creation time
select pg_temp.seed_report('job', p_job => :'v1', p_user => :'wa', p_at => now() - interval '7 days') as r1 \gset
select pg_temp.seed_report('company', p_job => :'v1', p_org => current_setting('t.a')::uuid, p_email => 'visitor@example.test', p_category => 'illegal_content', p_at => now() - interval '6 days') as r2 \gset
select pg_temp.seed_report('content', p_path => '/en/jobs', p_category => 'other', p_at => now() - interval '5 days') as r3 \gset
select pg_temp.seed_report('profile', p_app => :'app_a', p_user => :'own1', p_category => 'harassment', p_at => now() - interval '4 days') as r4 \gset
select pg_temp.seed_report('job', p_job => :'v2', p_user => :'wb', p_category => 'discrimination', p_at => now() - interval '3 days') as r5 \gset
select pg_temp.seed_report('job', p_job => :'v2', p_user => :'wa', p_category => 'other', p_at => now() - interval '2 days') as r6 \gset
select pg_temp.seed_report('content', p_path => '/en/pricing', p_category => 'other', p_at => now() - interval '1 day') as r7 \gset

-- The reporter's own list
select is(
  pg_temp.call_ids(:'wa', 'select * from public.list_my_reports()', 'aal1'), format('%s,%s', :'r6', :'r1'),
  'AC: a signed-in reporter lists their own reports, newest first'
);
select is(pg_temp.call_ids(:'wb', 'select * from public.list_my_reports()', 'aal1'), :'r5'::text, 'and another reporter lists theirs');
select is(pg_temp.call_ids(:'wnew', 'select * from public.list_my_reports()', 'aal1'), '', 'a user who reported nothing sees nothing');
select is(
  pg_temp.call_as(null, 'anon', 'select * from public.list_my_reports()', 'aal1'), '42501|permission denied for function list_my_reports|',
  'AC: an anonymous caller cannot list reports'
);
select is(
  pg_temp.json_as(:'wa', format('select target_type, target_label, category, status from public.list_my_reports() where id = %s', :'r1'), 'aal1'),
  '[{"status": "new", "category": "misleading_or_fraud", "target_type": "job", "target_label": "Queue vacancy"}]'::jsonb,
  'the list shows the kind, the vacancy by its title, the category and the status'
);
select is(
  pg_temp.json_as(:'wa', format('select reference from public.list_my_reports() where id = %s', :'r1'), 'aal1') #>> '{0,reference}',
  'R-' || lpad(:'r1', 6, '0'), 'and the reference number'
);
select is(
  (select array_agg(a.name order by a.ord) from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a (name, mode, ord)
   where p.oid = 'public.list_my_reports(integer, timestamptz, bigint)'::regprocedure and a.mode = 't'),
  array['id', 'reference', 'target_type', 'target_label', 'category', 'status', 'resolution_note', 'handled_at', 'created_at'],
  'it returns neither the text of the report nor the staff member who handled it'
);
select is(
  pg_temp.json_as(:'own1', format('select target_label from public.list_my_reports() where id = %s', :'r4'), 'aal2'), '[{"target_label": "Candidate profile"}]'::jsonb,
  'a report of a candidate is labelled "Candidate profile": no name, no vacancy'
);
select is(pg_temp.call_ids(:'wa', 'select * from public.list_my_reports(1)', 'aal1'), :'r6'::text, 'the page size is honoured');
select is(
  pg_temp.call_ids(:'wa', format('select * from public.list_my_reports(1, %L, %s)', (select created_at from public.reports where id = :'r6'), :'r6'), 'aal1'), :'r1'::text,
  'and the cursor leads to the next page'
);
select is(
  pg_temp.call_ids(:'wa', 'select * from public.list_my_reports(1, now(), null)', 'aal1'), 'P0001|CHARA_INVALID_INPUT|p_after',
  'half a cursor is refused'
);

-- The queue
select is(
  pg_temp.call_ids(:'st_trust', 'select * from public.admin_list_reports()'), format('%s,%s,%s,%s,%s,%s,%s', :'r1', :'r2', :'r3', :'r4', :'r5', :'r6', :'r7'),
  'AC: the queue of open reports, oldest first, for Trust & Safety'
);
select is(
  pg_temp.call_ids(:'st_admin', 'select * from public.admin_list_reports()'), format('%s,%s,%s,%s,%s,%s,%s', :'r1', :'r2', :'r3', :'r4', :'r5', :'r6', :'r7'),
  'AC: and for the Platform Administrator, who reads'
);
select is(pg_temp.call_ids(:'st_trust', $$select * from public.admin_list_reports('open', 'job')$$), format('%s,%s,%s', :'r1', :'r5', :'r6'), 'the list filters by kind');
select is(pg_temp.call_ids(:'st_trust', $$select * from public.admin_list_reports('open', 'profile')$$), :'r4'::text, 'the kind profile is listed too');
select is(pg_temp.call_ids(:'st_trust', 'select * from public.admin_list_reports(null, null, 3)'), format('%s,%s,%s', :'r1', :'r2', :'r3'), 'a page of three, and null is the open queue');
select is(pg_temp.call_ids(:'st_trust', format('select * from public.admin_list_reports(%L, null, 3, %s)', 'open', :'r3')), format('%s,%s,%s', :'r4', :'r5', :'r6'), 'the next page continues after the last id');
select is(pg_temp.call_ids(:'st_trust', $$select * from public.admin_list_reports('bogus')$$), 'P0001|CHARA_INVALID_INPUT|status', 'an unknown status is refused');
select is(
  (select array_agg(a.name order by a.ord) from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a (name, mode, ord)
   where p.oid = 'public.admin_list_reports(text, public.report_target_type, integer, bigint)'::regprocedure and a.mode = 't'),
  array['id', 'reference', 'target_type', 'target_label', 'category', 'status', 'created_at', 'handled_at'],
  'the queue shows no text of a report and no address'
);
select is(
  pg_temp.call_ids(:'st_trust', 'select * from public.admin_list_reports()', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'AC: at aal1 the queue is refused'
);
select is(pg_temp.call_ids(:'st_review', 'select * from public.admin_list_reports()'), 'P0001|CHARA_FORBIDDEN|', 'a Verification Reviewer is refused');
select is(pg_temp.call_ids(:'gone_trust', 'select * from public.admin_list_reports()'), 'P0001|CHARA_FORBIDDEN|', 'and a revoked Trust & Safety Administrator');
select is(pg_temp.call_ids(:'own1', 'select * from public.admin_list_reports()'), 'P0001|CHARA_FORBIDDEN|', 'and the owner of a company');

-- One report in context
select is(
  pg_temp.staff_json(:'st_trust', format('select reporter_kind, reporter_email, job_title, job_status, job_moderation_state, organization_name, organization_status, content_path from public.admin_get_report(%s)', :'r1')),
  '[{"job_title": "Queue vacancy", "job_status": "open", "content_path": null, "reporter_kind": "account", "reporter_email": null, "organization_name": "Acme Bau", "organization_status": "active", "job_moderation_state": "visible"}]'::jsonb,
  'AC: a vacancy report shows the vacancy and its organisation in context; a signed-in reporter is only "account"'
);
select is(
  pg_temp.staff_json(:'st_admin', format('select reporter_kind, reporter_email, organization_name from public.admin_get_report(%s)', :'r2')),
  '[{"reporter_kind": "visitor", "reporter_email": "visitor@example.test", "organization_name": "Acme Bau"}]'::jsonb,
  'the Platform Administrator reads a company report, and the address of a visitor is shown'
);
select is(
  pg_temp.staff_json(:'st_trust', format('select content_path, job_title, organization_name from public.admin_get_report(%s)', :'r3')),
  '[{"job_title": null, "content_path": "/en/jobs", "organization_name": null}]'::jsonb, 'a content report shows the path'
);
select is(
  pg_temp.staff_json(:'st_trust', format('select job_title, organization_name, reporter_kind from public.admin_get_report(%s)', :'r4')),
  '[{"job_title": "Status vacancy", "reporter_kind": "account", "organization_name": "Acme Bau"}]'::jsonb,
  'AC: a profile report shows the vacancy applied to and the organisation'
);
select is(
  position('Amina' in pg_temp.staff_json(:'st_trust', format('select * from public.admin_get_report(%s)', :'r4'))::text)
    + position('Okafor' in pg_temp.staff_json(:'st_trust', format('select * from public.admin_get_report(%s)', :'r4'))::text),
  0, 'FR-F3: and no name of the candidate anywhere in it'
);
select ok(
  not ((select array_agg(a.name) from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a (name, mode, ord)
        where p.oid = 'public.admin_get_report(bigint)'::regprocedure and a.mode = 't')
       && array['application_id', 'worker_user_id', 'profile_snapshot', 'first_name', 'last_name', 'reporter_user_id', 'handled_by']),
  'the columns hold no application id, no candidate and no account id'
);
select is(pg_temp.call_as(:'st_trust', 'authenticated', 'select * from public.admin_get_report(999999)'), 'P0002|CHARA_NOT_FOUND|', 'an unknown report is not found');
select is(pg_temp.call_as(:'st_trust', 'authenticated', 'select * from public.admin_get_report(null)'), 'P0001|CHARA_INVALID_INPUT|report', 'and a missing one is refused');
select is(pg_temp.call_as(:'mem', 'authenticated', format('select * from public.admin_get_report(%s)', :'r1')), 'P0001|CHARA_FORBIDDEN|', 'a member of a company cannot read a report');

-- Working the queue
select pg_temp.writes() as before_refused \gset
select is(pg_temp.status_as(:'st_admin', :'r1', 'in_review'), 'P0001|CHARA_FORBIDDEN|', 'AC: the Platform Administrator cannot act on a report');
select is(pg_temp.status_as(:'st_review', :'r1', 'in_review'), 'P0001|CHARA_FORBIDDEN|', 'nor a Verification Reviewer');
select is(pg_temp.status_as(:'st_trust', :'r1', 'in_review', null, 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'nor Trust & Safety at aal1');
select is(pg_temp.status_as(:'gone_trust', :'r1', 'in_review'), 'P0001|CHARA_FORBIDDEN|', 'nor a revoked one');
select is(pg_temp.status_as(:'own1', :'r1', 'dismissed', 'The reason is long enough.'), 'P0001|CHARA_FORBIDDEN|', 'nor the owner of a company');
select is(pg_temp.status_as(:'st_trust', :'r1', 'new'), 'P0001|CHARA_INVALID_INPUT|status', 'a report cannot go back to new');
select is(pg_temp.status_as(:'st_trust', :'r1', 'dismissed'), 'P0001|CHARA_INVALID_INPUT|reason', 'AC: dismissing needs a note');
select is(pg_temp.status_as(:'st_trust', :'r1', 'actioned', 'too short'), 'P0001|CHARA_INVALID_INPUT|reason', 'of at least 10 characters');
select is(pg_temp.status_as(:'st_trust', :'r1', 'actioned', repeat('n', 2001)), 'P0001|CHARA_INVALID_INPUT|reason', 'and at most 2000');
select is(pg_temp.status_as(:'st_trust', :'r1', 'in_review'), 'P0001|CHARA_INVALID_INPUT|reason', 'FR-F1: putting a report in review needs a reason too');
select is(pg_temp.status_as(:'st_trust', 999999, 'in_review', 'Looking at the report.'), 'P0002|CHARA_NOT_FOUND|', 'an unknown report is not found');
select is(pg_temp.writes(), :'before_refused', 'the refused calls changed nothing and wrote no audit row');

select is(pg_temp.status_as(:'st_trust', :'r1', 'in_review', 'Reading the report.'), 'ok', 'AC: Trust & Safety puts a report in review with a reason');
select is(
  (select format('%s|%s|%s|%s', status, handled_by = :'st_trust', handled_at is not null, resolution_note is null) from public.reports where id = :'r1'),
  'in_review|t|t|t', 'with who and when, and no note on the report (the reporter reads notes of closings only)'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s', actor_id = :'st_trust', entity_type, metadata ->> 'from', metadata ->> 'to', metadata ->> 'reason', metadata ->> 'request_id')
   from audit.log where action = 'report.in_review' and entity_id = :'r1'::text),
  format('t|report|new|in_review|Reading the report.|%s', :'request'), 'one audit row records the move, the actor, the reason and the request'
);
select is(pg_temp.status_as(:'st_trust', :'r1', 'in_review', 'Reading it again.'), 'P0001|CHARA_INVALID_STATE|in_review', 'a report already in review is refused');
select is(pg_temp.call_ids(:'st_trust', 'select * from public.admin_list_reports()'), format('%s,%s,%s,%s,%s,%s,%s', :'r1', :'r2', :'r3', :'r4', :'r5', :'r6', :'r7'), 'it stays in the open queue');
select is(pg_temp.call_ids(:'st_trust', $$select * from public.admin_list_reports('in_review')$$), :'r1'::text, 'and is the one of the filter in review');
select is(pg_temp.call_ids(:'st_trust', $$select * from public.admin_list_reports('new')$$), format('%s,%s,%s,%s,%s,%s', :'r2', :'r3', :'r4', :'r5', :'r6', :'r7'), 'and not of the filter new');

-- Closing: after the existing controls are used, the report is marked actioned; the controls are not repeated
select pg_temp.call_as(:'st_trust', 'authenticated', format($$select public.moderate_job(%L, 'hide', 'The vacancy asks for a fee before hiring.')$$, :'v1')) as hid \gset
select is(
  pg_temp.staff_json(:'st_trust', format('select job_moderation_state from public.admin_get_report(%s)', :'r1')), '[{"job_moderation_state": "hidden"}]'::jsonb,
  'the report shows that the vacancy is hidden now'
);
select is(pg_temp.status_as(:'st_trust', :'r1', 'actioned', E'  The vacancy was hidden.  \n'), 'ok', 'AC: Trust & Safety marks it actioned with a note');
select is(
  (select format('%s|%s|%s|%s', status, resolution_note, handled_by = :'st_trust', handled_at is not null) from public.reports where id = :'r1'),
  'actioned|The vacancy was hidden.|t|t', 'the note is stored trimmed'
);
select is(
  (select format('%s|%s|%s', metadata ->> 'from', metadata ->> 'to', metadata ->> 'reason') from audit.log where action = 'report.actioned' and entity_id = :'r1'::text),
  'in_review|actioned|The vacancy was hidden.', 'and the audit row has the move and the reason'
);
select is(pg_temp.status_as(:'st_trust', :'r1', 'dismissed', 'Changed my mind about it.'), 'P0001|CHARA_INVALID_STATE|actioned', 'a closed report does not change again');
select is(pg_temp.status_as(:'st_trust', :'r1', 'in_review', 'Reopening it.'), 'P0001|CHARA_INVALID_STATE|actioned', 'and is not reopened');
select is((select moderation_state::text from public.jobs where id = :'v2'), 'visible', 'closing a report hides nothing by itself');
select is(pg_temp.status_as(:'st_trust', :'r2', 'dismissed', 'Nothing in it breaks the rules.'), 'ok', 'a new report is dismissed straight away with a note');
select is(
  (select format('%s|%s', status, resolution_note) from public.reports where id = :'r2'), 'dismissed|Nothing in it breaks the rules.', 'with the note stored'
);
select is(pg_temp.call_ids(:'st_trust', 'select * from public.admin_list_reports()'), format('%s,%s,%s,%s,%s', :'r3', :'r4', :'r5', :'r6', :'r7'), 'closed reports leave the open queue');
select is(pg_temp.call_ids(:'st_trust', $$select * from public.admin_list_reports('actioned')$$), :'r1'::text, 'and are listed by their status');
select is(pg_temp.call_ids(:'st_trust', $$select * from public.admin_list_reports('all')$$), format('%s,%s,%s,%s,%s,%s,%s', :'r7', :'r6', :'r5', :'r4', :'r3', :'r2', :'r1'), 'the list of all is newest first');
select is(pg_temp.call_ids(:'st_trust', $$select * from public.admin_list_reports('dismissed', 'company')$$), :'r2'::text, 'also by status and kind');

-- The signed-in reporter is told
select is(
  pg_temp.json_as(:'wa', format('select status, resolution_note, handled_at is not null as closed from public.list_my_reports() where id = %s', :'r1'), 'aal1'),
  '[{"status": "actioned", "closed": true, "resolution_note": "The vacancy was hidden."}]'::jsonb,
  'AC: the reporter sees the outcome and the note of their closed report in their list'
);
select is(
  pg_temp.json_as(:'wa', format('select status, resolution_note from public.list_my_reports() where id = %s', :'r6'), 'aal1'),
  '[{"status": "new", "resolution_note": null}]'::jsonb, 'and an open one without a note'
);
select is(
  pg_temp.call_ids(:'wb', 'select * from public.list_my_reports()', 'aal1'), :'r5'::text,
  'another reporter does not see the outcome of a report that is not theirs'
);

-- The time to resolve reports (FR-F1 KPI) is measurable from the record: the query of docs/runbooks/reports.md section 4
select pg_temp.seed_report('content', p_path => '/en/kpi-closed', p_at => now() - interval '30 hours') as rk \gset
select pg_temp.seed_report('content', p_path => '/en/kpi-open', p_at => now() - interval '90 hours') as rko \gset
select pg_temp.status_as(:'st_trust', :'rk', 'dismissed', 'Closed to measure the time.') as kpi_closed \gset
select is(
  (select round(extract(epoch from handled_at - created_at) / 3600)::text from public.reports where id = :'rk' and status in ('actioned', 'dismissed')),
  '30', 'KPI: the time to resolve a report is handled_at less created_at, here 30 hours'
);
select is(
  (select count(*) from public.reports where id = :'rko' and status in ('actioned', 'dismissed')), 0::bigint,
  'KPI: and a report that is still open is left out of it'
);

select * from finish();
rollback;
