begin;
select plan(52);

\ir status_fixture.inc

-- Direct-hiring rules by country (V37; FR-Q5 AC1 to AC4, AC11, AC12; SOP P2-34 steps Configure, Default and Review,
-- outputs "rules with audit", KPI "countries with a reviewed rule", controls "rules set after legal review", "audit
-- trail"; decision 4.5; NFR-O5, NFR-S8, NFR-C6). Enforcement in search, contact requests, invitations and applications
-- (AC5 to AC9) is V72.

\set reason 'Rule set after the legal opinion of November.'
\set gone_admin '00000000-0000-0000-0000-00000000b937'
\set notice200 'Direct hiring of workers who live in the Philippines needs a recruitment agency licensed there. Please contact a licensed recruitment partner on CHARA to hire from the Philippines; partners stay open.'

select pg_temp.new_user(:'gone_admin');
update public.profiles set account_kind = intended_account_kind where id = :'gone_admin';
insert into public.platform_staff (user_id, role, revoked_at) values (:'gone_admin', 'admin', now());

create function pg_temp.admin(p_sql text, p_user uuid default '00000000-0000-0000-0000-00000000a021', p_aal text default 'aal2') returns text
language sql as $$ select pg_temp.call_as(p_user, 'authenticated', p_sql, p_aal) $$;

create function pg_temp.upsert(p_source text, p_dest text, p_rule text, p_notice text, p_ref text, p_reason text default 'Rule set after the legal opinion of November.')
returns text
language sql as $$
  select pg_temp.admin(format('select public.admin_upsert_direct_hiring_rule(p_source => %L, p_destination => %L, p_rule => %L, p_notice => %L, p_legal_opinion_ref => %L, p_reason => %L)',
    p_source, p_dest, p_rule, p_notice, p_ref, p_reason))
$$;

create function pg_temp.resolved(p_source text, p_dest text) returns text
language sql as $$ select rule || '|' || notice || '|' || (rule_id is null) from private.direct_hiring_rule(p_source, p_dest) $$;

create function pg_temp.rules() returns text
language sql as $$
  select coalesce(string_agg(source_country || '>' || coalesce(destination_country, '*') || ':' || rule, ',' order by source_country, destination_country nulls first), '')
  from public.direct_hiring_rules
$$;

create function pg_temp.audits() returns integer
language sql as $$ select count(*)::integer from audit.log where action like 'direct\_hiring\_rule.%' $$;

-- Structure ----------------------------------------------------------------------------------------------------------
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.direct_hiring_rule_value'::regtype),
  'allowed,licensed_partner_required,blocked', 'the rule values are allowed, licensed_partner_required and blocked'
);
select is(
  (select relrowsecurity::text || relforcerowsecurity::text from pg_class where oid = 'public.direct_hiring_rules'::regclass),
  'truetrue', 'NFR-S8: row level security is enabled and forced on the rules'
);
select is(
  (select count(*)::integer from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'direct_hiring_rules' and grantee in ('anon', 'authenticated', 'service_role')),
  0, 'AC11: no API role holds any grant on the rules table'
);
select is(pg_temp.rules(), '', 'Default: no rule is seeded, the platform does not decide the law of a country');
select is(
  (select string_agg(r.key || ':' || r.value_type || ':' || r.min || ':' || r.max || ':' || (s.value #>> '{}'), ',' order by r.key)
   from private.setting_rules r join private.settings s on s.key = r.key where r.key like 'direct\_hiring\_%'),
  'direct_hiring_general_notice:text:20:1000:' || (select value #>> '{}' from private.settings where key = 'direct_hiring_general_notice')
    || ',direct_hiring_review_days:integer:30:1095:365',
  'NFR-O5: the general notice (20 to 1,000 characters) and the review period (365 days) are settings of the settings editor'
);
select matches(
  (select value #>> '{}' from private.settings where key = 'direct_hiring_general_notice'),
  '^Workers never pay\.', 'Default: the general notice is the worker statement of the Platform Rules'
);

-- AC2: who may change and read rules ---------------------------------------------------------------------------------
create temp table callers (label text primary key, uid uuid, aal text, expected text);
insert into callers values
  ('admin at aal1', :'st_admin', 'aal1', 'P0001|CHARA_FORBIDDEN|aal2_required'),
  ('revoked admin', :'gone_admin', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('trust and safety', :'st_trust', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('verification reviewer', :'st_review', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('employer owner', :'own1', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('worker', :'wa', 'aal2', 'P0001|CHARA_FORBIDDEN|');
create temp table calls (fn text primary key, sql text not null);
insert into calls values
  ('admin_upsert_direct_hiring_rule',
   format($$select public.admin_upsert_direct_hiring_rule('PH', 'blocked', %L, 'LO-2026-11 PH', %L)$$, :'notice200', :'reason')),
  ('admin_delete_direct_hiring_rule', format($$select public.admin_delete_direct_hiring_rule(gen_random_uuid(), %L)$$, :'reason')),
  ('admin_list_direct_hiring_rules', $$select * from public.admin_list_direct_hiring_rules()$$),
  ('admin_list_direct_hiring_rule_history', $$select * from public.admin_list_direct_hiring_rule_history()$$);
select is_empty(
  $$select c.label, f.fn from callers c cross join calls f where pg_temp.admin(f.sql, c.uid, c.aal) <> c.expected$$,
  'AC2: aal1 gets aal2_required; a revoked administrator, Trust & Safety, a reviewer, an employer owner and a worker get CHARA_FORBIDDEN'
);
select is(
  (select count(*)::integer from calls f where pg_temp.call_as(null, 'anon', f.sql) ~ '^42501\|permission denied for function'), 4,
  'AC2: the anonymous caller lacks EXECUTE on the four admin functions'
);
select matches(
  pg_temp.call_as(:'own1', 'authenticated',
    $$insert into public.direct_hiring_rules (source_country, rule, notice, legal_opinion_ref) values ('PH', 'blocked', 'A notice long enough to pass.', 'LO')$$),
  '^42501\|permission denied for table direct_hiring_rules', 'AC2: an employer owner inserting into the table directly is refused (42501)'
);
select is(pg_temp.rules() || ':' || pg_temp.audits(), ':0', 'AC2: no refused call wrote a rule or an audit row');
select is(
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute') || ':'
     || has_function_privilege('authenticated', p.oid, 'execute') || ':' || has_function_privilege('service_role', p.oid, 'execute')
     || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ' '), ''), ',' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '%direct\_hiring\_rule%'),
  'admin_delete_direct_hiring_rule:false:true:false:true:search_path="",admin_list_direct_hiring_rule_history:false:true:false:true:search_path="",'
  || 'admin_list_direct_hiring_rules:false:true:false:true:search_path="",admin_upsert_direct_hiring_rule:false:true:false:true:search_path=""',
  'the admin functions are definer functions with an empty search path, executable by authenticated only'
);
select is(
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute') || ':'
     || has_function_privilege('authenticated', p.oid, 'execute') || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ' '), ''), ',' order by p.proname)
   from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.proname in ('hiring_rule_notice', 'direct_hiring_rule')),
  'direct_hiring_rule:false:false:true:search_path="",hiring_rule_notice:true:true:true:search_path=""',
  'AC11: hiring_rule_notice is open to anon and authenticated; the resolution helper to no API role'
);

-- AC1: the administrator creates two rules and edits the first --------------------------------------------------------
select is(char_length(:'notice200'), 200, 'AC1: the notice of the criterion has 200 characters');
select is(pg_temp.upsert('PH', null, 'licensed_partner_required', :'notice200', 'LO-2026-11 PH'), 'ok',
  'AC1: the administrator at aal2 creates PH (any destination) licensed_partner_required');
select is(pg_temp.upsert('PH', 'DE', 'blocked', 'Direct hiring from the Philippines to Germany is not available.', 'LO-2026-11 PH-DE'), 'ok',
  'AC1: and a second rule PH -> DE blocked');
select is(pg_temp.upsert('PH', null, 'licensed_partner_required', 'Hiring from the Philippines needs a licensed recruitment partner.', 'LO-2026-11 PH'), 'ok',
  'AC1: and edits the first rule''s notice');
select is(pg_temp.rules(), 'PH>*:licensed_partner_required,PH>DE:blocked', 'AC1: two rows exist, PH any destination and PH -> DE');
select is(
  (select count(*)::integer from public.direct_hiring_rules where updated_by = :'st_admin' and updated_at is not null), 2,
  'AC1: each row names the administrator who changed it and when'
);
select is(
  (select string_agg(action, ',' order by id) from audit.log where action like 'direct\_hiring\_rule.%'),
  'direct_hiring_rule.created,direct_hiring_rule.created,direct_hiring_rule.updated',
  'AC1: three audit rows: created, created, updated'
);
select is(
  (select concat_ws('|', actor_id, metadata #>> '{before,notice}', metadata #>> '{after,notice}', metadata #>> '{after,legal_opinion_ref}',
     metadata ->> 'reason', metadata ? 'request_id', entity_id = (select id::text from public.direct_hiring_rules where destination_country is null))
   from audit.log where action = 'direct_hiring_rule.updated'),
  concat_ws('|', :'st_admin', :'notice200', 'Hiring from the Philippines needs a licensed recruitment partner.', 'LO-2026-11 PH', :'reason', 't', 't'),
  'AC1: the update row holds the old and new values, the reason and the request id, on the rule''s id'
);
select is(
  (select not (metadata ? 'before') and metadata #>> '{after,destination_country}' = 'DE' and metadata #>> '{after,rule}' = 'blocked'
   from audit.log where action = 'direct_hiring_rule.created' and metadata #>> '{after,destination_country}' = 'DE'),
  true, 'AC1: a created row has no before value and the new values after'
);
select is(pg_temp.upsert('PH', null, 'licensed_partner_required', 'Hiring from the Philippines needs a licensed recruitment partner.', ' LO-2026-11 PH '),
  'ok', 'the same values again (spaces trimmed) are accepted');
select is(pg_temp.audits(), 3, 'and write nothing');
select is(
  pg_temp.val_as(:'st_admin', 'aal2', format($$select public.admin_upsert_direct_hiring_rule('PH', 'licensed_partner_required',
    'Hiring from the Philippines needs a licensed recruitment partner.', 'LO-2026-11 PH', %L)::text$$, :'reason')),
  'false', 'an unchanged call answers false'
);

-- AC3: input and uniqueness ------------------------------------------------------------------------------------------
select is(pg_temp.upsert('PH', null, 'blocked', 'Direct hiring from the Philippines is not available.', 'LO-2026-12 PH'), 'ok',
  'AC3: a second PH rule with no destination ...');
select is(
  (select count(*) || ':' || max(rule::text) from public.direct_hiring_rules where source_country = 'PH' and destination_country is null),
  '1:blocked', 'AC3: ... updates the existing row instead of adding one'
);
select throws_ok(
  $$insert into public.direct_hiring_rules (source_country, rule, notice, legal_opinion_ref) values ('PH', 'allowed', 'A notice long enough to pass.', 'LO')$$,
  '23505', null, 'AC3: the table is unique on source and destination with nulls not distinct'
);
create temp table bad_input (label text primary key, src text, dest text, rule text, notice text, ref text, detail text);
insert into bad_input values
  ('source XX', 'XX', null, 'blocked', 'A notice long enough to pass.', 'LO', 'source_country'),
  ('source null', null, null, 'blocked', 'A notice long enough to pass.', 'LO', 'source_country'),
  ('destination XX', 'NP', 'XX', 'blocked', 'A notice long enough to pass.', 'LO', 'destination_country'),
  ('DE -> DE', 'DE', 'DE', 'blocked', 'A notice long enough to pass.', 'LO', 'destination_country'),
  ('rule partner', 'NP', null, 'partner', 'A notice long enough to pass.', 'LO', 'rule'),
  ('rule null', 'NP', null, null, 'A notice long enough to pass.', 'LO', 'rule'),
  ('notice 19', 'NP', null, 'blocked', repeat('n', 19), 'LO', 'notice'),
  ('notice 1001', 'NP', null, 'blocked', repeat('n', 1001), 'LO', 'notice'),
  ('notice control', 'NP', null, 'blocked', 'A notice long enough' || chr(10) || 'to pass.', 'LO', 'notice'),
  ('notice null', 'NP', null, 'blocked', null, 'LO', 'notice'),
  ('reference empty', 'NP', null, 'blocked', 'A notice long enough to pass.', '  ', 'legal_opinion_ref'),
  ('reference 201', 'NP', null, 'blocked', 'A notice long enough to pass.', repeat('r', 201), 'legal_opinion_ref');
select is_empty(
  $$select label from bad_input where pg_temp.upsert(src, dest, rule, notice, ref) <> 'P0001|CHARA_INVALID_INPUT|' || detail$$,
  'AC3: XX, DE -> DE, "partner", a notice of 19 or 1,001 characters or with a line break, an empty or 201-character reference: CHARA_INVALID_INPUT naming the field'
);
select is(pg_temp.upsert('NP', null, 'blocked', 'A notice long enough to pass.', 'LO', 'too short'), 'P0001|CHARA_INVALID_INPUT|reason',
  'a reason under 10 characters is refused');
select throws_ok(
  $$insert into public.direct_hiring_rules (source_country, rule, notice, legal_opinion_ref) values ('XX', 'blocked', 'A notice long enough to pass.', 'LO')$$,
  '23503', null, 'AC3: the table refuses an unknown source country (23503)'
);
select throws_ok(
  $$insert into public.direct_hiring_rules (source_country, rule, notice, legal_opinion_ref) values ('NP', 'partner', 'A notice long enough to pass.', 'LO')$$,
  '22P02', null, 'AC3: and an unknown rule value (22P02)'
);
select throws_ok(
  $$insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref) values ('DE', 'DE', 'blocked', 'A notice long enough to pass.', 'LO')$$,
  '23514', null, 'AC3: and a destination equal to the source (23514)'
);
select is(pg_temp.rules() || ':' || pg_temp.audits(), 'PH>*:blocked,PH>DE:blocked:4', 'AC3: no refused input wrote a rule or an audit row');
select is(
  pg_temp.upsert('NP', null, 'licensed_partner_required', repeat('n', 20), 'L') || pg_temp.upsert('NG', 'AE', 'allowed', repeat('n', 1000), repeat('r', 200)),
  'okok', 'AC3: a notice of 20 and 1,000 characters and a reference of 1 and 200 are accepted'
);

-- AC4: resolution: the pair, then the source, then the default -------------------------------------------------------
select is(pg_temp.upsert('PH', null, 'licensed_partner_required', 'Hiring from the Philippines needs a licensed recruitment partner.', 'LO-2026-12 PH'),
  'ok', 'AC4: PH (any) is licensed_partner_required again');
select is(pg_temp.resolved('PH', 'DE'), 'blocked|Direct hiring from the Philippines to Germany is not available.|false',
  'AC4: PH -> DE gives blocked with its notice');
select is(pg_temp.resolved('PH', 'PL'), 'licensed_partner_required|Hiring from the Philippines needs a licensed recruitment partner.|false',
  'AC4: PH -> PL gives the PH rule');
select is(pg_temp.resolved('PH', null), 'licensed_partner_required|Hiring from the Philippines needs a licensed recruitment partner.|false',
  'AC4: PH with no destination gives the PH rule');
select is(pg_temp.resolved('KE', 'DE'),
  'allowed|' || (select value #>> '{}' from private.settings where key = 'direct_hiring_general_notice') || '|true',
  'AC4, Default: a source without a rule (KE -> DE) is allowed with the general notice and no rule');
select is(pg_temp.resolved(null, 'DE'), 'allowed|' || (select value #>> '{}' from private.settings where key = 'direct_hiring_general_notice') || '|true',
  'a worker without a current country gets the default');

-- AC11: public reads give the rule and notice only, behind release 2b ------------------------------------------------
select is(pg_temp.call_as(null, 'anon', $$select * from public.hiring_rule_notice('PH', 'DE')$$),
  '42501|CHARA_FORBIDDEN|release_off', 'release gate: hiring_rule_notice is refused while release_job_orders is off');
update private.settings set value = 'true' where key = 'release_job_orders';
create temp table readers (label text primary key, uid uuid, db_role text);
insert into readers values ('anonymous', null, 'anon'), ('worker', :'wa', 'authenticated'), ('employer member', :'mem', 'authenticated');
select is_empty(
  $$select label from readers r
    where pg_temp.call_as(r.uid, r.db_role, $q$do $b$ begin
      if (select rule::text || '|' || notice from public.hiring_rule_notice('PH', 'DE'))
         is distinct from 'blocked|Direct hiring from the Philippines to Germany is not available.' then
        raise exception 'wrong';
      end if;
    end $b$ $q$) <> 'ok'$$,
  'AC11: an anonymous caller, a worker and an employer member read the rule value and notice of PH -> DE'
);
select is(
  (select pg_get_function_result('public.hiring_rule_notice(text, text)'::regprocedure)),
  'TABLE(rule direct_hiring_rule_value, notice text)', 'AC11: the function returns the rule value and notice text only'
);
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.hiring_rule_notice('ph', null)$$) || ',' ||
  pg_temp.call_as(null, 'anon', $$select * from public.hiring_rule_notice('PH', 'Germany')$$),
  'P0001|CHARA_INVALID_INPUT|source_country,P0001|CHARA_INVALID_INPUT|destination_country', 'a malformed country code is refused'
);
select is(
  (select count(*)::integer from readers r where pg_temp.call_as(r.uid, r.db_role, 'select * from public.direct_hiring_rules') ~ '^42501\|')
  + (case when pg_temp.admin('select * from public.direct_hiring_rules') ~ '^42501\|' then 1 else 0 end),
  4, 'AC11, NFR-S8: direct selects are refused (42501) for anon, a worker, an employer member and the administrator'
);
update private.settings set value = 'false' where key = 'release_job_orders';

-- AC11, Review: the administrator reads the reference, who changed a rule, its age and the history -------------------
update public.direct_hiring_rules set updated_at = now() - interval '400 days' where source_country = 'NG';
select is(
  pg_temp.val_as(:'st_admin', 'aal2', $$select string_agg(source_country || '>' || coalesce(destination_country, '*') || ':' || legal_opinion_ref
    || ':' || review_due || ':' || coalesce(updated_by_name, '-'), ',' order by source_name, destination_country nulls first)
    from public.admin_list_direct_hiring_rules() where source_country in ('PH', 'NG')$$),
  'NG>AE:' || repeat('r', 200) || ':true:' || :'st_admin' || '@example.test,PH>*:LO-2026-12 PH:false:' || :'st_admin' || '@example.test,PH>DE:LO-2026-11 PH-DE:false:'
    || :'st_admin' || '@example.test',
  'AC11, Review: the list shows the reference, who changed each rule, any destination first, and flags a rule unchanged for 400 days'
);
select is(
  pg_temp.val_as(:'st_admin', 'aal2', $$select source_name || ':' || coalesce(destination_name, 'any') from public.admin_list_direct_hiring_rules() where source_country = 'NG'$$),
  'Nigeria:United Arab Emirates', 'the list names the countries'
);

-- AC12: deleting a rule restores the default -------------------------------------------------------------------------
select is(
  pg_temp.admin(format($$select public.admin_delete_direct_hiring_rule(%L, %L)$$,
    (select id from public.direct_hiring_rules where source_country = 'PH' and destination_country is null), :'reason')),
  'ok', 'AC12: the administrator deletes PH (any destination)'
);
select is(
  (select concat_ws('|', count(*), max(metadata #>> '{before,rule}'), max(metadata #>> '{before,legal_opinion_ref}'), bool_and(not (metadata ? 'after')))
   from audit.log where action = 'direct_hiring_rule.deleted'),
  '1|licensed_partner_required|LO-2026-12 PH|t', 'AC12: one audit row direct_hiring_rule.deleted holds the old values'
);
select is(pg_temp.resolved('PH', 'PL') || ',' || pg_temp.resolved('PH', 'DE'),
  'allowed|' || (select value #>> '{}' from private.settings where key = 'direct_hiring_general_notice') || '|true,'
  || 'blocked|Direct hiring from the Philippines to Germany is not available.|false',
  'AC12: PH -> PL returns to the default; the PH -> DE rule still applies');
select is(pg_temp.admin(format($$select public.admin_delete_direct_hiring_rule(gen_random_uuid(), %L)$$, :'reason')),
  'P0001|CHARA_NOT_FOUND|', 'an unknown rule is not found');
select is(
  pg_temp.val_as(:'st_admin', 'aal2', $$select string_agg(action || ':' || coalesce(after ->> 'source_country', before ->> 'source_country'), ',' order by id desc)
    from public.admin_list_direct_hiring_rule_history(3)$$),
  'direct_hiring_rule.deleted:PH,direct_hiring_rule.updated:PH,direct_hiring_rule.created:NG',
  'the history lists the changes newest first, a deleted rule included, up to the limit'
);

select * from finish();
rollback;
