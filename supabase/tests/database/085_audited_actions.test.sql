begin;
select plan(41);

-- FR-F2 AC1 to AC4 and AC8: the audit row of every administrative function. moderate_job (FR-C7) is covered by 088; the guard of AC8
-- covers it too.
\ir status_fixture.inc

\set request '7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11'
\set reason25 'Reason of 25 characters!!'

select set_config(
  'request.headers',
  json_build_object('x-request-id', :'request', 'x-forwarded-for', '203.0.113.7, 10.0.0.1')::text,
  true
);
select coalesce(max(id), 0) as base from audit.log \gset

-- A fresh target for a call of p_fn with p_reason, so every call can succeed once; the target is left in t.target.
create function pg_temp.fresh_sql(p_fn text, p_reason text) returns text
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_org uuid;
begin
  perform set_config('t.target', v_id::text, true);
  if p_fn in ('grant_platform_role', 'reset_mfa', 'suspend_user', 'reinstate_user', 'revoke_platform_role') then
    perform pg_temp.new_user(v_id);
    update public.profiles set account_kind = intended_account_kind where id = v_id;
  end if;
  if p_fn = 'reinstate_user' then
    update public.profiles set status = 'suspended' where id = v_id;
  elsif p_fn = 'revoke_platform_role' then
    insert into public.platform_staff (user_id, role) values (v_id, 'verification_reviewer');
  elsif p_fn = 'suspend_organization' then
    v_org := pg_temp.org_on();
    perform pg_temp.open_job('Vacancy ' || n, v_org) from generate_series(1, 3) n;
    perform set_config('t.target', v_org::text, true);
  elsif p_fn = 'reinstate_organization' then
    v_org := pg_temp.org_on();
    update public.organizations set status = 'suspended' where id = v_org;
    perform pg_temp.seed_job(jsonb_build_object('title', 'Held ' || n, 'status', 'open', 'moderation_state', 'org_suspended'), v_org)
    from generate_series(1, 2) n;
    perform set_config('t.target', v_org::text, true);
  elsif p_fn = 'publish_legal_document' then
    perform set_config('t.target', 'audit-doc-' || left(v_id::text, 8) || ':1', true);
  end if;
  return case p_fn
    when 'grant_platform_role' then format('select public.grant_platform_role(%L, %L, %L)', v_id, 'trust_safety', p_reason)
    when 'revoke_platform_role' then format('select public.revoke_platform_role(%L, %L, %L)', v_id, 'verification_reviewer', p_reason)
    when 'reset_mfa' then format('select public.reset_mfa(%L, %L)', v_id, p_reason)
    when 'publish_legal_document' then format(
      'select public.publish_legal_document(%L, %L, %L, %L)', 'audit-doc-' || left(v_id::text, 8), 'Audit document', 'The text.', p_reason)
    when 'suspend_user' then format('select public.suspend_user(%L, %L)', v_id, p_reason)
    when 'reinstate_user' then format('select public.reinstate_user(%L, %L)', v_id, p_reason)
    when 'suspend_organization' then format('select public.suspend_organization(%L, %L)', v_org, p_reason)
    when 'reinstate_organization' then format('select public.reinstate_organization(%L, %L)', v_org, p_reason)
  end;
end;
$$;

create temp table fns (name text primary key, caller uuid not null, action text not null, entity_type text not null);
insert into fns values
  ('grant_platform_role', :'st_admin', 'platform_role.grant', 'platform_staff'),
  ('revoke_platform_role', :'st_admin', 'platform_role.revoke', 'platform_staff'),
  ('reset_mfa', :'st_admin', 'mfa.reset', 'profile'),
  ('publish_legal_document', :'st_admin', 'legal_document.publish', 'legal_document'),
  ('suspend_user', :'st_trust', 'user.suspend', 'profile'),
  ('reinstate_user', :'st_trust', 'user.reinstate', 'profile'),
  ('suspend_organization', :'st_trust', 'organization.suspend', 'organization'),
  ('reinstate_organization', :'st_trust', 'organization.reinstate', 'organization');

create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from audit.log) || ',' || (select count(*) from public.moderation_actions) || ','
      || (select count(*) from public.platform_staff) || ',' || (select count(*) from public.legal_documents) || ','
      || (select count(*) from pgmq.q_account_ops) || ',' || (select count(*) from pgmq.q_notifications) || ','
      || (select count(*) from public.notifications) || ','
      || (select string_agg(id || ':' || status, ',' order by id) from public.profiles) || ','
      || (select string_agg(id || ':' || status, ',' order by id) from public.organizations)
$$;

-- One call of p_fn: the outcome, the target and the audit rows it wrote (ids after the fixture's own rows).
create temp table calls (
  n serial primary key, fn text, label text, outcome text, target text, first_id bigint, last_id bigint, rows_written bigint,
  unchanged boolean
);
create function pg_temp.attempt(p_fn text, p_reason text, p_label text, p_caller uuid default null, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_sql text := pg_temp.fresh_sql(p_fn, p_reason);
  v_before bigint := (select coalesce(max(id), 0) from audit.log);
  v_state text := pg_temp.writes();
  v_out text;
begin
  v_out := pg_temp.call_as(coalesce(p_caller, (select caller from fns where name = p_fn)), 'authenticated', v_sql, p_aal);
  insert into calls (fn, label, outcome, target, first_id, last_id, rows_written, unchanged)
  select p_fn, p_label, v_out, current_setting('t.target'), v_before + 1, (select coalesce(max(id), 0) from audit.log),
         (select count(*) from audit.log where id > v_before), pg_temp.writes() = v_state;
  return v_out;
end;
$$;

-- AC1: one successful call of each function with a reason of 25 characters
select count(*) as ac1_calls from (select pg_temp.attempt(name, :'reason25', 'ac1') from fns order by name) c \gset
select is((select count(*) from calls where label = 'ac1' and outcome = 'ok'), 8::bigint, 'AC1: each of the 8 audited functions that exist succeeds once');
select is(
  (select string_agg(fn || ':' || rows_written, ',' order by fn) from calls where label = 'ac1'),
  'grant_platform_role:1,publish_legal_document:1,reinstate_organization:3,reinstate_user:1,reset_mfa:1,revoke_platform_role:1,suspend_organization:4,suspend_user:1',
  'AC1: exactly one audit row per call, and one more per vacancy whose moderation state changed (3 and 2)'
);
select is_empty(
  $$select c.fn, l.id from calls c join fns f on f.name = c.fn join audit.log l on l.id = c.first_id
    where c.label = 'ac1' and not (l.actor_id = f.caller and l.action = f.action and l.entity_type = f.entity_type
      and l.entity_id = c.target)$$,
  'AC1: the row holds the actor (auth.uid of the caller), the action, the entity type and the target'
);
select is_empty(
  $$select c.fn, l.id from calls c join audit.log l on l.id between c.first_id and c.last_id
    where c.label = 'ac1' and not (l.metadata ->> 'reason' = 'Reason of 25 characters!!' and l.metadata ->> 'request_id' = '7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11')$$,
  'AC1: every row, the vacancy rows included, holds the reason and the request id of the header'
);
select is_empty(
  $$select c.fn, l.id from calls c join audit.log l on l.id between c.first_id and c.last_id
    where c.label = 'ac1' and not (host(l.ip) = '203.0.113.7' and l.created_at between now() - interval '5 seconds' and now() + interval '5 seconds')$$,
  'AC1: the address is the leftmost x-forwarded-for entry and the time is that of the database'
);
select is(
  (select string_agg(l.action || ':' || l.entity_type, ',' order by l.id) from calls c join audit.log l on l.id between c.first_id and c.last_id
   where c.label = 'ac1' and c.fn = 'suspend_organization'),
  'organization.suspend:organization,job.org_suspend:job,job.org_suspend:job,job.org_suspend:job',
  'AC1: the organisation row comes first and the vacancy rows name the entity type job'
);
select is(
  (select string_agg(l.action, ',') from calls c join audit.log l on l.id between c.first_id and c.last_id
   where c.label = 'ac1' and c.fn = 'reinstate_organization' and l.entity_type = 'job'),
  'job.org_reinstate,job.org_reinstate', 'AC1: a reinstatement writes job.org_reinstate for each vacancy it restores'
);
select is(
  (select count(*) from calls c join audit.log l on l.id between c.first_id and c.last_id
   where c.label = 'ac1' and l.entity_type = 'job' and l.entity_id in (select id::text from public.jobs)),
  5::bigint, 'AC1: the vacancy rows name vacancies that exist'
);
select is(
  (select count(*) from audit.log l join public.platform_staff s on s.user_id::text = l.entity_id
   where l.id > :base and l.action = 'platform_role.grant' and (l.metadata ->> 'staff_id')::bigint = s.id and s.granted_by = l.actor_id),
  1::bigint, 'AC1: the role rows name the person and the staff row, and the grantor is the actor'
);

-- AC2: the request id is never empty
select set_config('request.headers', json_build_object('x-request-id', :'request')::text, true);
select pg_temp.attempt('suspend_user', :'reason25', 'ac2-header') as r \gset
select set_config('request.headers', '', true);
select pg_temp.attempt('suspend_user', :'reason25', 'ac2-none') as r \gset
select set_config('request.headers', json_build_object('x-request-id', 'not-a-uuid')::text, true);
select pg_temp.attempt('suspend_user', :'reason25', 'ac2-bad') as r \gset
select pg_temp.attempt('suspend_organization', :'reason25', 'ac2-org') as r \gset
select is(
  (select l.metadata ->> 'request_id' from calls c join audit.log l on l.id = c.first_id where c.label = 'ac2-header'),
  :'request', 'AC2: the header value is the request id'
);
select ok(
  (select bool_and(l.metadata ->> 'request_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and l.metadata ->> 'request_id' <> :'request')
   from calls c join audit.log l on l.id = c.first_id where c.label in ('ac2-none', 'ac2-bad')),
  'AC2: without the header, and with a header that is no uuid, a uuid is generated'
);
select is(
  (select count(distinct l.metadata ->> 'request_id') from calls c join audit.log l on l.id between c.first_id and c.last_id where c.label = 'ac2-org'),
  1::bigint, 'AC2: the 4 rows of a suspension of an organisation with 3 vacancies share one request id'
);
select is((select rows_written from calls where label = 'ac2-org'), 4::bigint, 'AC2: those are the organisation row and the 3 vacancy rows');
select is(
  (select count(*) from audit.log
   where id > :base and action in ('platform_role.grant', 'platform_role.revoke', 'mfa.reset', 'legal_document.publish', 'user.suspend',
     'user.reinstate', 'organization.suspend', 'organization.reinstate', 'job.org_suspend', 'job.org_reinstate')
     and coalesce(metadata ->> 'request_id', '') = ''),
  0::bigint, 'AC2: no administrative audit row has a null or empty request id'
);

-- AC3: the reason is required and bounded (the change summary of a legal document: 1000)
select set_config('request.headers', json_build_object('x-request-id', :'request')::text, true);
create temp table reasons (label text primary key, value text, valid boolean not null);
insert into reasons values
  ('null', null, false), ('empty', '', false), ('spaces', '        ', false), ('9 characters', repeat('r', 9), false),
  ('10 characters', repeat('r', 10), true), ('2000 characters', repeat('r', 2000), true), ('2001 characters', repeat('r', 2001), false);
-- the change summary of a legal document has its own limits: 1000 characters, and the field is named
create function pg_temp.reason_of(p_fn text, p_label text) returns text
language sql as $$
  select case when p_fn = 'publish_legal_document' and p_label = '2000 characters' then repeat('r', 1000)
              when p_fn = 'publish_legal_document' and p_label = '2001 characters' then repeat('r', 1001)
              else value end
  from reasons where label = p_label
$$;
select count(*) as ac3_refused from (
  select pg_temp.attempt(f.name, pg_temp.reason_of(f.name, r.label), 'ac3 ' || r.label)
  from fns f cross join reasons r where not r.valid order by f.name, r.label
) c \gset
select is(
  (select count(*) from calls where label like 'ac3 %' and outcome = case
     when fn = 'publish_legal_document' then 'P0001|CHARA_INVALID_INPUT|change_summary' else 'P0001|CHARA_INVALID_INPUT|reason' end),
  40::bigint, 'AC3: null, empty, spaces, 9 characters and over the limit raise CHARA_INVALID_INPUT in all 8 functions'
);
select is((select count(*) from calls where label like 'ac3 %' and rows_written > 0), 0::bigint, 'AC3: and none of the 40 refused calls writes an audit row');
select is(
  (select count(*) from calls where label like 'ac3 %' and not unchanged), 0::bigint,
  'AC3: nor a state change, a role, a document, a job, an email or a notification'
);
select count(*) as ac3_valid from (
  select pg_temp.attempt(f.name, pg_temp.reason_of(f.name, r.label), 'ac3 ' || r.label)
  from fns f cross join reasons r where r.valid order by f.name, r.label
) c \gset
select is(
  (select count(*) from calls where label like 'ac3 %' and outcome = 'ok' and rows_written >= 1),
  16::bigint, 'AC3: 10 characters and the upper bound succeed (2 x 8) and write their rows'
);
select is(
  (select count(*) from audit.log
   where id > :base and action in ('platform_role.grant', 'platform_role.revoke', 'mfa.reset', 'legal_document.publish', 'user.suspend',
     'user.reinstate', 'organization.suspend', 'organization.reinstate', 'job.org_suspend', 'job.org_reinstate')
     and actor_id is not null and char_length(coalesce(metadata ->> 'reason', '')) < 10),
  0::bigint, 'AC3 KPI: admin audit rows of a person where the reason is missing or shorter than 10 characters: 0'
);
select is(
  (select count(*) from audit.log where id > :base and char_length(metadata ->> 'reason') > 2000), 0::bigint,
  'AC3: and none is longer than 2000 characters'
);
select is(
  (select l.metadata ->> 'reason' from calls c join audit.log l on l.id = c.first_id where c.label = 'ac3 2000 characters' and c.fn = 'suspend_user'),
  repeat('r', 2000), 'AC3: a reason of 2000 characters is stored whole'
);

-- AC4: a refused call leaves no trace
select pg_temp.attempt('suspend_user', :'reason25', 'ac4 wrong role', :'st_admin') as r \gset
select pg_temp.attempt('grant_platform_role', :'reason25', 'ac4 wrong role', :'st_trust') as r \gset
select pg_temp.attempt('suspend_user', :'reason25', 'ac4 aal1', :'st_trust', 'aal1') as r \gset
select pg_temp.attempt('reset_mfa', :'reason25', 'ac4 aal1', :'st_admin', 'aal1') as r \gset
select pg_temp.attempt('suspend_organization', :'reason25', 'ac4 reviewer', :'st_review') as r \gset
select pg_temp.attempt('reinstate_user', 'short', 'ac4 reason') as r \gset
create temp table suspended_user as select id from public.profiles where status = 'suspended' limit 1;
select pg_temp.call_as(
  :'st_trust', 'authenticated', format('select public.suspend_user(%L, %L)', (select id from suspended_user), :'reason25')
) as invalid_state \gset
select is(
  (select string_agg(label || '=' || outcome, ' ; ' order by n) from calls where label like 'ac4 %'),
  'ac4 wrong role=P0001|CHARA_FORBIDDEN| ; ac4 wrong role=P0001|CHARA_FORBIDDEN| ; ac4 aal1=P0001|CHARA_FORBIDDEN|aal2_required ; ac4 aal1=P0001|CHARA_FORBIDDEN|aal2_required ; ac4 reviewer=P0001|CHARA_FORBIDDEN| ; ac4 reason=P0001|CHARA_INVALID_INPUT|reason',
  'AC4: a wrong role, aal1 and an invalid reason are refused'
);
select is(:'invalid_state'::text, 'P0001|CHARA_INVALID_STATE|suspended', 'AC4: so is an invalid state');
select is((select count(*) from calls where label like 'ac4 %' and rows_written > 0), 0::bigint, 'AC4: none of them writes an audit row');
select is(
  (select count(*) from calls where label like 'ac4 %' and not unchanged), 0::bigint,
  'AC4: nor a moderation row, a role, a document, a status change, a queue message or a notification'
);

create function public.audit_test_fail() returns trigger
language plpgsql as $$ begin raise exception 'audit write failed' using errcode = 'XX000'; end; $$;
create trigger audit_test_fail before insert on audit.log for each row execute function public.audit_test_fail();
select pg_temp.attempt('suspend_user', :'reason25', 'ac4 audit failure') as r \gset
select is(
  (select outcome from calls where label = 'ac4 audit failure'), 'XX000|audit write failed|',
  'AC4: a call whose audit row cannot be written raises'
);
select is(
  (select status::text from public.profiles where id::text = (select target from calls where label = 'ac4 audit failure')), 'active',
  'AC4: and the status stays active'
);
select is(
  (select count(*) from public.moderation_actions where target_id::text = (select target from calls where label = 'ac4 audit failure')),
  0::bigint, 'AC4: with no moderation row'
);
select is(
  (select unchanged from calls where label = 'ac4 audit failure'), true,
  'AC4: no queue message, no notification and no audit row: the change cannot succeed without its audit row'
);
drop trigger audit_test_fail on audit.log;
drop function public.audit_test_fail();

-- the grant of a role fails the same way: the trigger row is part of the call
create function public.audit_test_fail() returns trigger
language plpgsql as $$ begin raise exception 'audit write failed' using errcode = 'XX000'; end; $$;
create trigger audit_test_fail before insert on audit.log for each row execute function public.audit_test_fail();
select pg_temp.attempt('grant_platform_role', :'reason25', 'ac4 role audit failure') as r \gset
select is(
  (select outcome || '|' || unchanged from calls where label = 'ac4 role audit failure'),
  'XX000|audit write failed||true', 'AC4: a role is not granted when its audit row fails'
);
drop trigger audit_test_fail on audit.log;
drop function public.audit_test_fail();

-- AC8: the coverage guard. It reads the source of the functions, so a comment or an audit call on one branch would
-- satisfy it; the proof that each of the eight writes its row is the matrix of AC1 above, and the guard is the tripwire
-- for the function that comes next. A function that only writes platform_staff counts as audited when it is one of the two
-- whose change the always-on trigger records (an insert, or a revocation); any other function must call the audit itself.
create function pg_temp.unaudited() returns setof name
language sql as $$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc ~ 'has_platform_role|assert_staff|assert_platform_admin'
    and p.proname not in ('admin_search_users', 'admin_search_organizations', 'admin_get_user', 'admin_get_organization',
      'admin_application_counts', 'admin_search_audit', 'admin_list_moderation_actions', 'admin_list_legal_documents',
      'admin_export_legal_documents', 'list_platform_staff', 'admin_search_jobs', 'admin_get_job', 'admin_staff_count',
      'admin_moderation_counts')
    and p.prosrc !~ 'audit\.record|private\.audit_admin|private\.record_moderation'
    and not (p.proname in ('grant_platform_role', 'revoke_platform_role') and p.prosrc ~ '(insert into|update) public\.platform_staff')
  order by p.proname
$$;
create function pg_temp.audited() returns name[]
language sql as $$
  select array_agg(p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ~ 'has_platform_role|assert_staff|assert_platform_admin'
    and (p.prosrc ~ 'audit\.record|private\.audit_admin|private\.record_moderation'
      or (p.proname in ('grant_platform_role', 'revoke_platform_role') and p.prosrc ~ '(insert into|update) public\.platform_staff'))
$$;
select is_empty($$select * from pg_temp.unaudited()$$, 'AC8: every staff-gated function that is not read-only calls the audit function');
select is(
  pg_temp.audited(),
  array['grant_platform_role', 'moderate_job', 'publish_legal_document', 'reinstate_organization', 'reinstate_user', 'reset_mfa', 'revoke_platform_role', 'suspend_organization', 'suspend_user']::name[],
  'AC8: the audited functions are the 9 that exist; the allowlist holds the read-only ones'
);
create function public.unaudited_admin_function() returns void
language plpgsql security definer set search_path = ''
as $$ begin perform private.assert_staff(array['admin']::public.platform_role[]); update public.profiles set status = 'suspended'; end; $$;
select is(
  (select array_agg(x) from pg_temp.unaudited() x), array['unaudited_admin_function']::name[],
  'AC8: a new staff-gated function that does not call the audit function and is not on the allowlist fails the guard'
);
drop function public.unaudited_admin_function();
select is_empty($$select * from pg_temp.unaudited()$$, 'AC8: and the guard passes again without it');
create function public.change_staff_role() returns void
language plpgsql security definer set search_path = ''
as $$ begin perform private.assert_platform_admin(); update public.platform_staff set role = 'admin'; end; $$;
select is(
  (select array_agg(x) from pg_temp.unaudited() x), array['change_staff_role']::name[],
  'AC8: a staff-gated function that updates platform_staff in a way the trigger does not record fails the guard'
);
drop function public.change_staff_role();

-- KPI: administrative actions without an audit row, reconciled with the tables that hold the change
select is(
  (select count(*) from public.moderation_actions m
   where not exists (select 1 from audit.log l where l.entity_id = m.target_id::text and l.entity_type = m.target_type
     and l.action = case m.action when 'account_suspended' then 'user.suspend' when 'account_reinstated' then 'user.reinstate'
       when 'organization_suspended' then 'organization.suspend' else 'organization.reinstate' end)),
  0::bigint, 'KPI: no suspension or reinstatement without its audit row'
);
select is(
  (select count(*) from public.platform_staff s
   where not exists (select 1 from audit.log l where l.action = 'platform_role.grant' and (l.metadata ->> 'staff_id')::bigint = s.id)
      or (s.revoked_at is not null
          and not exists (select 1 from audit.log l where l.action = 'platform_role.revoke' and (l.metadata ->> 'staff_id')::bigint = s.id))),
  0::bigint, 'KPI: no grant or revocation of a role without its audit row'
);
select is(
  (select count(*) from public.legal_documents d
   where d.slug like 'audit-doc-%'
     and not exists (select 1 from audit.log l where l.action = 'legal_document.publish' and l.entity_id = d.slug || ':' || d.version)),
  0::bigint, 'KPI: no publication of a legal document without its audit row'
);

-- grant_platform_role and revoke_platform_role write their row through the trigger of platform_staff, which also audits the
-- ticketed bootstrap insert of the runbook; the guard accepts a write to that table because the trigger is always on
select is(
  (select format('%s|%s', t.tgenabled, pg_get_functiondef(t.tgfoid) ~ 'private\.audit_admin')
   from pg_trigger t where t.tgrelid = 'public.platform_staff'::regclass and t.tgname = 'platform_staff_audit'),
  'A|t', 'AC8: the trigger of platform_staff is ENABLE ALWAYS and writes through the audit function'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'platform_reason'), 0::bigint,
  'one reason rule: the statement of reasons of 10 to 2000 characters serves all functions'
);
select set_config('request.headers', '', true);
select is(private.request_id() = private.request_id(), true, 'the generated request id is stable within a transaction');

select * from finish();
rollback;
