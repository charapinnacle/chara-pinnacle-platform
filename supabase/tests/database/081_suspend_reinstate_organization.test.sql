begin;
select plan(48);

\ir status_fixture.inc

\set why 'The company details are false and misleading.'
\set back 'Documents checked, the company is genuine.'
\set request '7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11'

select set_config('request.headers', json_build_object('x-request-id', :'request')::text, true);

insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.b')::uuid, :'adm', 'admin', now());

select pg_temp.open_job('Visible vacancy one') as v1 \gset
select pg_temp.open_job('Visible vacancy two') as v2 \gset
select pg_temp.seed_job('{"title": "Hidden by moderation", "status": "open", "moderation_state": "hidden"}') as v3 \gset
select pg_temp.seed_job('{"title": "Draft vacancy"}') as v4 \gset
select pg_temp.open_job('Vacancy of Beta', current_setting('t.b')::uuid) as vb \gset

create function pg_temp.suspend_as(p_user uuid, p_org uuid, p_reason text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.suspend_organization(%L, %L)', p_org, p_reason), p_aal)
$$;
create function pg_temp.reinstate_as(p_user uuid, p_org uuid, p_reason text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.reinstate_organization(%L, %L)', p_org, p_reason), p_aal)
$$;
create function pg_temp.states() returns text
language sql as $$
  select string_agg(title || ':' || status || ':' || moderation_state, ',' order by title) from public.jobs
  where organization_id = current_setting('t.a')::uuid and title <> 'Status vacancy'
$$;
create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.moderation_actions) || ',' || (select count(*) from audit.log) || ','
      || (select count(*) from pgmq.q_account_ops) || ',' || (select count(*) from pgmq.q_notifications) || ','
      || (select string_agg(id || ':' || status, ',' order by id) from public.organizations) || ','
      || pg_temp.states()
$$;

insert into billing.subscriptions (organization_id, plan_code, status, provider, current_period_start, current_period_end)
values (current_setting('t.a')::uuid, 'employer_starter', 'active', 'null', now() - interval '3 days', now() + interval '27 days');

select to_jsonb(s) as subscription from billing.subscriptions s where organization_id = current_setting('t.a')::uuid \gset
select count(*) as billing_rows from billing.subscriptions \gset
select pg_temp.states() as states_before \gset
select count(*) as accounts_before from pgmq.q_account_ops \gset

-- AC6: the suspension
select is(pg_temp.suspend_as(:'st_trust', current_setting('t.a')::uuid, :'why'), 'ok', 'AC6: the Trust & Safety Administrator suspends the organisation');
select is((select status::text from public.organizations where id = current_setting('t.a')::uuid), 'suspended', 'AC6: the organisation is suspended');
select is(
  (select string_agg(id::text || ':' || moderation_state, ',' order by title) from public.jobs
   where id in (:'v1', :'v2', :'v3', :'v4')),
  format('%s:org_suspended,%s:hidden,%s:org_suspended,%s:org_suspended', :'v4', :'v3', :'v1', :'v2'),
  'AC6: the visible vacancies, the draft too, are org_suspended and the hidden one stays hidden'
);
select is(
  (select string_agg(title || ':' || status, ',' order by title) from public.jobs where organization_id = current_setting('t.a')::uuid),
  'Draft vacancy:draft,Hidden by moderation:open,Visible vacancy one:open,Visible vacancy two:open',
  'AC6: the status of every vacancy is unchanged'
);
select is(
  (select to_jsonb(s) from billing.subscriptions s where organization_id = current_setting('t.a')::uuid), :'subscription'::jsonb,
  'AC6: the subscription is identical'
);
select is((select count(*) from billing.subscriptions), :billing_rows::bigint, 'AC6: no billing row is created');
select is(
  (select format('%s|%s|%s', count(*), min(target_type), min(statement_of_reasons)) from public.moderation_actions
   where target_id = current_setting('t.a')::uuid and action = 'organization_suspended'),
  format('1|organization|%s', :'why'), 'AC6: one moderation row of the type organization'
);
select is(
  (select format('%s|%s|%s', count(*), min(metadata ->> 'reason'), min(metadata ->> 'request_id'))
   from audit.log where action = 'organization.suspend' and entity_id = current_setting('t.a')),
  format('1|%s|%s', :'why', :'request'), 'AC6: one audit row organization.suspend with the reason'
);
select is(
  (select count(*) from audit.log where action = 'job.org_suspend' and entity_id in (:'v1', :'v2', :'v4')
     and metadata ->> 'request_id' = :'request' and metadata ->> 'organization_id' = current_setting('t.a')),
  3::bigint, 'AC6: one job.org_suspend row per changed vacancy with the same request id'
);
select is(
  (select count(*) from audit.log where entity_id in (:'v1', :'v2', :'v3', :'v4') and action <> 'job.created'
     and action <> 'job.org_suspend'),
  0::bigint, 'AC6: the hidden vacancy and the others get no other audit row'
);
select is(
  (select count(*) from pgmq.q_account_ops where message = jsonb_build_object('action', 'sign_out_organization', 'organization_id', current_setting('t.a'))),
  1::bigint, 'AC6: exactly one account-ops message signs the members out'
);
select is((select count(*) from pgmq.q_account_ops), :accounts_before::bigint + 1, 'AC6: and queues no other job, no ban');
select is(
  (select string_agg(user_id::text, ',' order by user_id) from public.notifications where kind = 'account_suspended'),
  (select string_agg(u, ',' order by u) from (values (:'own1'), (:'adm')) v (u)),
  'AC6: the owner and the admin each get an account_suspended email and the member none'
);
select is(
  (select count(*) from public.notifications where kind = 'account_suspended' and payload ->> 'reasons' = :'why'
     and payload ->> 'org_slug' = (select slug from public.organizations where id = current_setting('t.a')::uuid)),
  2::bigint, 'AC6: each email carries the reasons and names the organisation'
);

select pg_temp.seed_app('applied') as app \gset
select is(
  pg_temp.set_as(:'mem', :'app', 'shortlisted'), 'P0001|CHARA_FORBIDDEN|organization_suspended',
  'AC6: the member cannot change a stage of the suspended organisation'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.invite_member(%L, 'new@example.test', 'member')$$, current_setting('t.a'))),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'AC6: the admin cannot invite'
);
select is(
  pg_temp.insert_as(:'own1'), '42501|new row violates row-level security policy for table "jobs"|',
  'AC6 and D45: the owner cannot insert a vacancy'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$update public.jobs set title = 'Changed' where id = %L$$, :'v1'), 'aal2'), 'ok',
  'D45: an update of a vacancy of the suspended organisation is accepted as a statement'
);
select is((select title from public.jobs where id = :'v1'), 'Visible vacancy one', 'D45: and changes no row');
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$update public.jobs set status = 'closed' where id = %L$$, :'v1'), 'aal2'), 'ok',
  'D45: a change of status is refused the same way'
);
select is((select status::text from public.jobs where id = :'v1'), 'open', 'D45: the status stays');
select is(pg_temp.val_as(:'adm', 'aal2', $$select count(*) from public.profiles$$), '1', 'AC6: the people still read their own profile');
select is(pg_temp.insert_as(:'adm', '{}', current_setting('t.b')::uuid), 'ok', 'AC6: and still work in another organisation');
select is(
  pg_temp.val_as(:'adm', 'aal2', format($$select count(*) from public.organizations where id = %L$$, current_setting('t.b'))), '1',
  'AC6: the other organisation is readable'
);
select is(
  (select count(*) from public.jobs where id = :'vb' and moderation_state = 'visible'), 1::bigint,
  'the vacancies of another organisation are untouched'
);

-- AC6: the reinstatement
select pg_temp.writes() as before_reinstate \gset
select is(pg_temp.reinstate_as(:'st_trust', current_setting('t.a')::uuid, :'back'), 'ok', 'AC6: the organisation is reinstated');
select is((select status::text from public.organizations where id = current_setting('t.a')::uuid), 'active', 'AC6: its status is active');
select is(
  (select string_agg(moderation_state::text, ',' order by title) from public.jobs where id in (:'v1', :'v2', :'v3', :'v4')),
  'visible,hidden,visible,visible', 'AC6: the vacancies of the suspension are visible again and the hidden one stays hidden'
);
select is(
  (select count(*) from audit.log where action = 'organization.reinstate' and entity_id = current_setting('t.a')
     and metadata ->> 'reason' = :'back' and metadata ->> 'request_id' = :'request'),
  1::bigint, 'AC6: one audit row organization.reinstate'
);
select is(
  (select count(*) from audit.log where action = 'job.org_reinstate' and entity_id in (:'v1', :'v2', :'v4')), 3::bigint,
  'AC6: and one job.org_reinstate row per vacancy'
);
select is(
  (select count(*) from public.moderation_actions where target_id = current_setting('t.a')::uuid and action = 'organization_reinstated'),
  1::bigint, 'AC6: one moderation row for the reinstatement'
);
select is((select count(*) from pgmq.q_account_ops), :accounts_before::bigint + 1, 'AC6: no job is queued, there is no ban to lift');
select is(
  (select string_agg(user_id::text, ',' order by user_id) from public.notifications where kind = 'account_reinstated'),
  (select string_agg(u, ',' order by u) from (values (:'own1'), (:'adm')) v (u)),
  'AC6: the owner and the admin get an account_reinstated email'
);
select is(
  (select to_jsonb(s) from billing.subscriptions s where organization_id = current_setting('t.a')::uuid), :'subscription'::jsonb,
  'AC6: the subscription is still identical'
);
select is(pg_temp.states(), :'states_before', 'AC6: every vacancy is as it was before the suspension');
select is(pg_temp.insert_as(:'own1'), 'ok', 'AC6: the owner inserts a vacancy again');
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.invite_member(%L, 'new@example.test', 'member')$$, current_setting('t.a'))),
  'ok', 'AC6: and the admin invites again'
);

-- AC7
select pg_temp.writes() as before \gset
select is(pg_temp.suspend_as(:'st_trust', current_setting('t.b')::uuid, null), 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: a null reason is refused');
select is(pg_temp.suspend_as(:'st_trust', current_setting('t.b')::uuid, '   '), 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: spaces are refused');
select is(pg_temp.suspend_as(:'st_trust', current_setting('t.b')::uuid, ' 123456789 '), 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: 9 characters are refused');
select is(pg_temp.suspend_as(:'st_trust', current_setting('t.b')::uuid, repeat('x', 2001)), 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: 2001 characters are refused');
select is(pg_temp.reinstate_as(:'st_trust', current_setting('t.a')::uuid, null), 'P0001|CHARA_INVALID_INPUT|reason', 'AC7: the same for the reinstatement');
select is(
  pg_temp.suspend_as(:'st_trust', '00000000-0000-0000-0000-00000000ffff', :'why'), 'P0002|CHARA_NOT_FOUND|', 'AC7: an unknown organisation is not found'
);
select is(
  pg_temp.reinstate_as(:'st_trust', current_setting('t.a')::uuid, :'why'), 'P0001|CHARA_INVALID_STATE|active',
  'AC7: an active organisation cannot be reinstated'
);
select is(pg_temp.writes(), :'before', 'AC7: no refused call changed anything');
select is(pg_temp.suspend_as(:'st_trust', current_setting('t.b')::uuid, repeat('a', 10)), 'ok', 'AC7: 10 characters are accepted');
select is(
  pg_temp.suspend_as(:'st_trust', current_setting('t.b')::uuid, :'why'), 'P0001|CHARA_INVALID_STATE|suspended',
  'AC7: a suspended organisation cannot be suspended again'
);
select is(pg_temp.reinstate_as(:'st_trust', current_setting('t.b')::uuid, repeat('b', 2000)), 'ok', 'AC7: 2000 characters are accepted');

select * from finish();
rollback;
