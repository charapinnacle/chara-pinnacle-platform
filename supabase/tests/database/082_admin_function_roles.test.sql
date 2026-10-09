begin;
select plan(25);

\ir status_fixture.inc

\set gone_admin '00000000-0000-0000-0000-00000000b301'
\set gone_trust '00000000-0000-0000-0000-00000000b302'
\set grantee '00000000-0000-0000-0000-00000000b303'
\set revokee '00000000-0000-0000-0000-00000000b304'
\set resetee '00000000-0000-0000-0000-00000000b305'
\set victim '00000000-0000-0000-0000-00000000b306'

select pg_temp.new_user(:'gone_admin');
select pg_temp.new_user(:'gone_trust');
select pg_temp.new_user(:'grantee');
select pg_temp.new_user(:'revokee');
select pg_temp.new_user(:'resetee');
select pg_temp.new_user(:'victim');
update public.profiles set account_kind = intended_account_kind where id in (:'gone_admin', :'gone_trust', :'grantee', :'revokee', :'resetee', :'victim');
insert into public.platform_staff (user_id, role, revoked_at) values (:'gone_admin', 'admin', now()), (:'gone_trust', 'trust_safety', now());
insert into public.platform_staff (user_id, role) values (:'revokee', 'verification_reviewer');

select pg_temp.org_on('employer_starter') as org_active \gset
select pg_temp.org_on() as org_suspended \gset
update public.organizations set status = 'suspended' where id = :'org_suspended';

-- The 14 functions of Phase 1 that the console calls (moderate_job is FR-C7): the SQL of a valid call and the roles that
-- may make it. The calls that change something name their own targets, so a call that is refused changes none of them.
create temp table fns (name text primary key, sql text not null, roles text[] not null);
insert into fns values
  ('grant_platform_role', format($$select public.grant_platform_role(%L, 'trust_safety', 'New T&S hire, ticket 4812')$$, :'grantee'), '{admin}'),
  ('revoke_platform_role', format($$select public.revoke_platform_role(%L, 'verification_reviewer', 'Left the team, ticket 4813')$$, :'revokee'), '{admin}'),
  ('reset_mfa', format($$select public.reset_mfa(%L, 'Lost the phone, identity checked')$$, :'resetee'), '{admin}'),
  ('publish_legal_document', $$select public.publish_legal_document('matrix-terms', 'Matrix terms', 'The text of the terms.', 'Adds the matrix of roles.', 0)$$, '{admin}'),
  ('admin_application_counts', $$select * from public.admin_application_counts(current_date - 30, current_date)$$, '{admin}'),
  ('admin_search_audit', $$select * from public.admin_search_audit()$$, '{admin}'),
  ('list_platform_staff', $$select * from public.list_platform_staff()$$, '{admin}'),
  ('suspend_user', format($$select public.suspend_user(%L, 'Fake profile reported 3x.')$$, :'victim'), '{trust_safety}'),
  ('reinstate_user', format($$select public.reinstate_user(%L, 'Identity confirmed by mail.')$$, :'wsus'), '{trust_safety}'),
  ('suspend_organization', format($$select public.suspend_organization(%L, 'The company details are false.')$$, :'org_active'), '{trust_safety}'),
  ('reinstate_organization', format($$select public.reinstate_organization(%L, 'Documents checked, genuine.')$$, :'org_suspended'), '{trust_safety}'),
  ('admin_list_moderation_actions', $$select * from public.admin_list_moderation_actions()$$, '{trust_safety}'),
  ('admin_search_users', $$select * from public.admin_search_users('example')$$, '{admin,trust_safety}'),
  ('admin_search_organizations', $$select * from public.admin_search_organizations('org')$$, '{admin,trust_safety}'),
  ('admin_get_user', format($$select * from public.admin_get_user(%L)$$, :'wa'), '{admin,trust_safety}'),
  ('admin_get_organization', format($$select * from public.admin_get_organization(%L)$$, current_setting('t.a')), '{admin,trust_safety}');

-- who: the roles the caller holds, unrevoked
create temp table callers (name text primary key, uid uuid, db_role text not null, aal text not null, held text[] not null);
insert into callers values
  ('admin at aal2', :'st_admin', 'authenticated', 'aal2', '{admin}'),
  ('admin at aal1', :'st_admin', 'authenticated', 'aal1', '{admin}'),
  ('trust_safety at aal2', :'st_trust', 'authenticated', 'aal2', '{trust_safety}'),
  ('trust_safety at aal1', :'st_trust', 'authenticated', 'aal1', '{trust_safety}'),
  ('verification_reviewer at aal2', :'st_review', 'authenticated', 'aal2', '{verification_reviewer}'),
  ('verification_reviewer at aal1', :'st_review', 'authenticated', 'aal1', '{verification_reviewer}'),
  ('revoked admin', :'gone_admin', 'authenticated', 'aal2', '{}'),
  ('revoked trust_safety', :'gone_trust', 'authenticated', 'aal2', '{}'),
  ('user with no staff row', :'own2', 'authenticated', 'aal2', '{}'),
  ('anon', null, 'anon', 'aal2', '{}');

create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.platform_staff) || ',' || (select count(*) from public.moderation_actions) || ','
      || (select count(*) from audit.log) || ',' || (select count(*) from pgmq.q_account_ops) || ','
      || (select count(*) from pgmq.q_notifications) || ',' || (select count(*) from public.notifications) || ','
      || (select count(*) from public.legal_documents) || ','
      || (select string_agg(id || ':' || status, ',' order by id) from public.profiles) || ','
      || (select string_agg(id || ':' || status, ',' order by id) from public.organizations)
$$;

create function pg_temp.expected(p_fn text, p_caller text) returns text
language sql as $$
  select case
    when c.db_role = 'anon' then format('42501|permission denied for function %s|', f.name)
    when f.roles && c.held and c.aal = 'aal2' then 'ok'
    when f.roles && c.held then 'P0001|CHARA_FORBIDDEN|aal2_required'
    else 'P0001|CHARA_FORBIDDEN|'
  end
  from fns f, callers c where f.name = p_fn and c.name = p_caller
$$;

-- AC2: every refused call, and only those, in one pass; nothing is written by any of them
select pg_temp.writes() as before \gset
create temp table refused as
select f.name as fn, c.name as caller, pg_temp.call_as(c.uid, c.db_role, f.sql, c.aal) as outcome
from fns f cross join callers c
where not (f.roles && c.held and c.aal = 'aal2');
select is((select count(*) from refused), 140::bigint, 'AC2: each of the 16 functions was called by each of the 10 callers that may not call it');
select is_empty(
  $$select fn, caller, outcome from refused r where outcome is distinct from pg_temp.expected(fn, caller)$$,
  'AC2: a caller without the role, at aal1, revoked or anonymous is refused with the expected error by every function'
);
select is(pg_temp.writes(), :'before', 'AC2: a refused call changes no row, writes no audit row, queues no job and creates no notification');

-- AC2: the role at aal2 succeeds
create temp table allowed as
select f.name as fn, c.name as caller, pg_temp.call_as(c.uid, c.db_role, f.sql, c.aal) as outcome
from fns f join callers c on f.roles && c.held and c.aal = 'aal2'
order by f.name, c.name;
select is_empty($$select * from allowed where outcome <> 'ok'$$, 'AC2: the role named for the function, at aal2, succeeds');
select is((select count(*) from allowed), 20::bigint, 'AC2: each of the 16 functions was called by each role it names');
select is(
  (select count(*) from refused where fn in ('suspend_user', 'reinstate_user', 'suspend_organization', 'reinstate_organization')
     and caller in ('admin at aal2', 'admin at aal1') and outcome = 'P0001|CHARA_FORBIDDEN|'),
  8::bigint, 'AC2: the Platform Administrator is refused suspend and reinstate'
);
select is(
  (select count(*) from allowed where caller like 'verification_reviewer%'), 0::bigint, 'AC2: the Verification Reviewer can do nothing'
);
select is(
  (select count(*) from refused where caller = 'verification_reviewer at aal2' and outcome = 'P0001|CHARA_FORBIDDEN|'), 16::bigint,
  'AC2: and is refused all 16 with CHARA_FORBIDDEN'
);

-- AC2: the configuration tables
select is_empty(
  $$select r.role_name, t.table_name, p.privilege
    from (values ('anon'), ('authenticated'), ('service_role')) r (role_name)
    cross join (values ('billing.plans'), ('billing.plan_limits'), ('billing.plan_features'), ('private.settings'), ('private.retention_policies')) t (table_name)
    cross join (values ('insert'), ('update'), ('delete')) p (privilege)
    where has_table_privilege(r.role_name, t.table_name, p.privilege)
       or (p.privilege <> 'delete' and has_any_column_privilege(r.role_name, t.table_name, p.privilege))$$,
  'AC2: none of the three API roles can insert, update or delete the five configuration tables'
);
select is_empty(
  $$select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (select name from fns)
      and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(billing\.plans|billing\.plan_limits|billing\.plan_features|private\.settings|private\.retention_policies)'$$,
  'AC2: none of the functions writes to the configuration tables'
);
select is_empty(
  $$select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (select name from fns)
      and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))$$,
  'every function is a definer function with an empty search path'
);
select is_empty(
  $$select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (select name from fns)
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
           or not has_function_privilege('authenticated', p.oid, 'execute'))$$,
  'only authenticated can execute them'
);

-- what the allowed calls did
select is((select status::text from public.profiles where id = :'victim'), 'suspended', 'the Trust & Safety Administrator suspended the user');
select is((select status::text from public.profiles where id = :'wsus'), 'active', 'and reinstated the other');
select is((select status::text from public.organizations where id = :'org_active'), 'suspended', 'and suspended the organisation');
select is((select status::text from public.organizations where id = :'org_suspended'), 'active', 'and reinstated the other');
select is(
  (select count(*) from public.platform_staff where user_id = :'grantee' and role = 'trust_safety' and revoked_at is null), 1::bigint,
  'the Platform Administrator granted a role'
);
select is((select revoked_at is not null from public.platform_staff where user_id = :'revokee'), true, 'and revoked one');
select is((select max(version) from public.legal_documents where slug = 'matrix-terms'), 1, 'and published a document');
select is(
  (select count(*) from audit.log where action in ('user.suspend', 'user.reinstate', 'organization.suspend', 'organization.reinstate', 'legal_document.publish', 'mfa.reset', 'platform_role.grant', 'platform_role.revoke')
     and created_at > now() - interval '1 minute' and actor_id in (:'st_admin', :'st_trust')),
  8::bigint, 'every state-changing call wrote its own audit row'
);
select is_empty(
  format($$select id, action from audit.log
    where action in ('user.suspend', 'user.reinstate', 'organization.suspend', 'organization.reinstate', 'legal_document.publish', 'mfa.reset', 'platform_role.grant', 'platform_role.revoke')
      and created_at > now() - interval '1 minute' and actor_id in (%L, %L) and coalesce(metadata ->> 'reason', '') = ''$$, :'st_admin', :'st_trust'),
  'KPI: the query of the runbook finds no action of these calls without a reason'
);

-- the helpers hide behind the schema
select is(
  pg_temp.call_as(:'st_admin', 'authenticated', $$select private.assert_staff('{admin}')$$), '42501|permission denied for function assert_staff|',
  'the role check is no API function'
);
select is(
  pg_temp.call_as(:'st_admin', 'authenticated', $$select private.record_moderation('profile', gen_random_uuid(), 'account_suspended', 'user.suspend', 'A written reason')$$),
  '42501|permission denied for function record_moderation|', 'nor is the writer of moderation actions'
);
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', $$insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons) values ('profile', gen_random_uuid(), 'account_suspended', 'A written reason')$$),
  '42501|permission denied for table moderation_actions|', 'moderation_actions cannot be written through the API'
);
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', $$select * from public.moderation_actions$$), '42501|permission denied for table moderation_actions|',
  'nor read'
);

select * from finish();
rollback;
