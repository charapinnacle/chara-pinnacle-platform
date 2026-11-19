begin;
select plan(30);

\ir status_fixture.inc

-- The retention editor and the Phase 2 retention periods (V19; FR-S3 AC1, AC10 database part; SOP P2-43 step
-- Configure, control "configured periods"; NFR-O5, NFR-S8).

\set reason 'Shorter period agreed with CHARA.'
\set gone_admin '00000000-0000-0000-0000-00000000b901'

select pg_temp.new_user(:'gone_admin');
update public.profiles set account_kind = intended_account_kind where id = :'gone_admin';
insert into public.platform_staff (user_id, role, revoked_at) values (:'gone_admin', 'admin', now());

create function pg_temp.admin(p_sql text, p_user uuid default '00000000-0000-0000-0000-00000000a021', p_aal text default 'aal2') returns text
language sql as $$ select pg_temp.call_as(p_user, 'authenticated', p_sql, p_aal) $$;

create function pg_temp.days(p_entity text) returns integer
language sql as $$ select days from private.retention_policies where entity = p_entity $$;

create function pg_temp.updates(p_entity text) returns integer
language sql as $$
  select count(*)::integer from audit.log where action = 'retention_policy.updated' and entity_id = p_entity
$$;

-- Configure: the Phase 2 periods are seeded --------------------------------------------------------------------------
select is(
  (select string_agg(entity || ':' || days, ',' order by entity) from private.retention_policies
   where entity in ('conversations', 'partner_responses', 'candidate_submissions', 'closed_requirements', 'contact_requests',
     'licence_evidence')),
  'candidate_submissions:730,closed_requirements:730,contact_requests:365,conversations:730,licence_evidence:30,partner_responses:730',
  'AC1: the Phase 2 periods are seeded (conversations, responses, submissions, closed requirements 730; contact requests 365; licence evidence 30)'
);
select is(
  (select count(*)::integer from private.retention_policies where label is null or description is null), 0,
  'every period, Phase 1 and Phase 2, has a label and a description for the editor'
);
select is(
  (select string_agg(entity, ',' order by entity) from private.retention_policies where not editable), 'audit_log,inactive_worker_data',
  'the audit log and the inactive candidate accounts periods are kept out of the editor'
);
select throws_ok(
  $$update private.retention_policies set days = 3651 where entity = 'conversations'$$, '23514', null,
  'AC10: the table refuses a period above 3,650 days'
);
select throws_ok(
  $$insert into private.retention_policies (entity, days) values ('unlabelled', 30)$$, '23502', null,
  'a new period without a label is refused, so the editor never shows a bare key'
);

-- AC1, AC10: who may change a period ---------------------------------------------------------------------------------
create temp table callers (label text primary key, uid uuid, aal text, expected text);
insert into callers values
  ('admin at aal1', :'st_admin', 'aal1', 'P0001|CHARA_FORBIDDEN|aal2_required'),
  ('revoked admin', :'gone_admin', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('trust and safety', :'st_trust', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('verification reviewer', :'st_review', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('organisation owner', :'own1', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('candidate', :'wa', 'aal2', 'P0001|CHARA_FORBIDDEN|');
create temp table calls (fn text primary key, sql text not null);
insert into calls values
  ('admin_set_retention_policy', format($$select public.admin_set_retention_policy('conversations', 365, %L)$$, :'reason')),
  ('admin_list_retention_policies', $$select * from public.admin_list_retention_policies()$$);
select is_empty(
  $$select c.label, f.fn from callers c cross join calls f where pg_temp.admin(f.sql, c.uid, c.aal) <> c.expected$$,
  'AC1, AC10: aal1 gets aal2_required; a revoked administrator, Trust & Safety, a reviewer, an owner and a candidate get CHARA_FORBIDDEN'
);
select is(
  (select count(*)::integer from calls f where pg_temp.call_as(null, 'anon', f.sql) ~ '^42501\|permission denied for function'), 2,
  'the anonymous caller lacks EXECUTE on both functions'
);
select is(
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute') || ':'
     || has_function_privilege('authenticated', p.oid, 'execute') || ':' || has_function_privilege('service_role', p.oid, 'execute')
     || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ' '), ''), ',' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('admin_set_retention_policy', 'admin_list_retention_policies')),
  'admin_list_retention_policies:false:true:false:true:search_path="",admin_set_retention_policy:false:true:false:true:search_path=""',
  'both are definer functions with an empty search path, executable by authenticated only'
);
select is(pg_temp.days('conversations'), 730, 'and no refused call changed the period');
select is(pg_temp.updates('conversations'), 0, 'or wrote an audit row');

-- AC1: the administrator changes a period ----------------------------------------------------------------------------
select is(char_length(:'reason'), 33, 'the reason of the criterion is about 30 characters');
select is(
  pg_temp.val_as(:'st_admin', 'aal2', format($$select public.admin_set_retention_policy('conversations', 365, %L)::text$$, :'reason')),
  'true', 'AC1: the administrator at aal2 sets conversations to 365 days'
);
select is(pg_temp.days('conversations'), 365, 'AC1: the period is 365 days');
select is(
  (select concat_ws('|', count(*), max(actor_id::text), max(metadata ->> 'before'), max(metadata ->> 'after'), max(metadata ->> 'reason'))
   from audit.log where action = 'retention_policy.updated' and entity_type = 'retention_policy' and entity_id = 'conversations'),
  '1|' || :'st_admin' || '|730|365|' || :'reason',
  'AC1: one audit row retention_policy.updated names the administrator, the period before and after and the reason'
);
select is(
  pg_temp.val_as(:'st_admin', 'aal2', format($$select public.admin_set_retention_policy('conversations', 365, %L)::text$$, :'reason')),
  'false', 'the same period again changes nothing'
);
select is(pg_temp.updates('conversations'), 1, 'and writes no second audit row');
select matches(
  pg_temp.admin(format($$select public.admin_set_retention_policy('conversations', 0, %L)$$, :'reason')),
  '^23514\|.*retention_policies_days_check', 'AC1: 0 days fails with check_violation 23514 (days >= 1)'
);
select is(
  pg_temp.admin(format($$select public.admin_set_retention_policy('conversations', 3651, %L)$$, :'reason')),
  'P0001|CHARA_INVALID_INPUT|days', 'AC10: 3,651 days is refused'
);
select is(
  pg_temp.admin(format($$select public.admin_set_retention_policy('conversations', 40000, %L)$$, :'reason')),
  'P0001|CHARA_INVALID_INPUT|days', 'AC10: 40,000 days is refused'
);
select is(
  pg_temp.admin(format($$select public.admin_set_retention_policy('conversations', null, %L)$$, :'reason')),
  'P0001|CHARA_INVALID_INPUT|days', 'a missing period is refused'
);
select is(pg_temp.admin($$select public.admin_set_retention_policy('conversations', 400, 'too short')$$),
  'P0001|CHARA_INVALID_INPUT|reason', 'a reason under 10 characters is refused');
select is(pg_temp.admin(format($$select public.admin_set_retention_policy('conversations', 400, %L)$$, repeat('r', 501))),
  'P0001|CHARA_INVALID_INPUT|reason', 'a reason over 500 characters is refused');
select is(pg_temp.admin(format($$select public.admin_set_retention_policy('audit_log', 400, %L)$$, :'reason')),
  'P0001|CHARA_FORBIDDEN|retention_not_editable', 'the audit log period cannot be changed in the editor');
select is(pg_temp.admin(format($$select public.admin_set_retention_policy('inactive_worker_data', 1, %L)$$, :'reason')),
  'P0001|CHARA_FORBIDDEN|retention_not_editable', 'the inactive candidate period cannot be changed there either, so one day never erases every candidate');
select is(pg_temp.admin(format($$select public.admin_set_retention_policy('no_such_entity', 400, %L)$$, :'reason')),
  'P0001|CHARA_FORBIDDEN|retention_not_editable', 'an unknown entity gets the same answer');
select is(pg_temp.days('conversations') || ':' || pg_temp.days('audit_log') || ':' || pg_temp.days('inactive_worker_data') || ':' || pg_temp.updates('conversations'), '365:2191:730:1',
  'no refused change wrote anything');
select is(
  pg_temp.val_as(:'st_admin', 'aal2', format($$select public.admin_set_retention_policy('conversations', 3650, %L)::text
    || public.admin_set_retention_policy('conversations', 1, %L)::text || public.admin_set_retention_policy('conversations', 730, %L)::text$$,
    :'reason', :'reason', :'reason')),
  'truetruetrue', 'AC10: 3,650 and 1 day are the bounds that are accepted'
);
select is(
  pg_temp.val_as(:'st_admin', 'aal2', $$select string_agg(entity || ':' || days || ':' || editable, ',' order by entity)
    from public.admin_list_retention_policies() where entity in ('audit_log', 'conversations', 'licence_evidence')$$),
  'audit_log:2191:false,conversations:730:true,licence_evidence:30:true', 'AC10: the editor lists each entity with its period'
);
select is(
  pg_temp.val_as(:'st_admin', 'aal2', $$select (select count(*) from public.admin_list_retention_policies())::text
    || ':' || (select label from public.admin_list_retention_policies() where entity = 'licence_evidence')
    || ':' || (select (array_agg(entity))[count(*)] from public.admin_list_retention_policies())$$),
  (select count(*) from private.retention_policies)::text || ':Replaced licence evidence:inactive_worker_data',
  'every period is listed with its label, the migration-only ones last'
);

-- NFR-S8: the periods are read only through the editor --------------------------------------------------------------
create temp table readers (label text primary key, uid uuid, db_role text);
insert into readers values
  ('anonymous', null, 'anon'), ('employer A owner', :'own1', 'authenticated'), ('employer B owner', :'own2', 'authenticated'),
  ('candidate A', :'wa', 'authenticated'), ('candidate B', :'wb', 'authenticated'), ('Trust & Safety', :'st_trust', 'authenticated'),
  ('administrator', :'st_admin', 'authenticated');
select is(
  (select count(*)::integer from readers r
   where pg_temp.call_as(r.uid, r.db_role, 'select * from private.retention_policies') ~ '^42501\|'),
  7, 'NFR-S8: no caller reads or writes the periods table directly, the administrator included'
);

select * from finish();
rollback;
