begin;
select plan(156);

\ir status_fixture.inc

-- V28: appeals against moderation decisions (FR-S1 step Appeal, output "Appeals and outcomes", KPI "Decisions reversed on
-- appeal", control "second-person appeal review", AC9, AC11, AC12 (data); NFR-S8, NFR-A3, NFR-A4, NFR-O5; DSA Art. 20;
-- decisions 6.4, 7.2): submit_appeal, decide_appeal by a second reviewer, list_my_appeals, the staff reads, the KPI, the
-- notices that link to the appeal, the closed_appeals retention and the cross-tenant isolation of public.appeals.

\set pow '00000000-0000-0000-0000-0000000f2801'
\set padm '00000000-0000-0000-0000-0000000f2802'
\set pmem '00000000-0000-0000-0000-0000000f2803'
\set gow '00000000-0000-0000-0000-0000000f2804'
\set trust_b '00000000-0000-0000-0000-0000000f2805'
\set gone_trust '00000000-0000-0000-0000-0000000f2806'
\set trust_own '00000000-0000-0000-0000-0000000f2807'
\set gadm '00000000-0000-0000-0000-0000000f2808'
select pg_temp.new_user(:'pow', 'company', 'maria.santos@alpha-recruit.example');
select pg_temp.new_user(:'padm');
select pg_temp.new_user(:'pmem');
select pg_temp.new_user(:'gow');
select pg_temp.new_user(:'trust_b');
select pg_temp.new_user(:'gone_trust');
select pg_temp.new_user(:'trust_own');
select pg_temp.new_user(:'gadm');
update public.profiles set account_kind = intended_account_kind
where id in (:'pow', :'padm', :'pmem', :'gow', :'trust_b', :'gone_trust', :'trust_own', :'gadm');
insert into public.platform_staff (user_id, role) values (:'trust_b', 'trust_safety'), (:'trust_own', 'trust_safety');
insert into public.platform_staff (user_id, role, revoked_at) values (:'gone_trust', 'trust_safety', now());

-- A listed partner with an owner.
create function pg_temp.partner(p_owner uuid, p_type public.organization_type, p_slug text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days', workforce_profile_updated_at = now() - interval '1 day'
  where id = v_id;
  return v_id;
end;
$$;

-- p_sql (a call returning rows) as p_user at p_aal: 'ok' with the rows in t.rows, or 'sqlstate|message|detail'.
create function pg_temp.run(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.rows'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    p_aal)
$$;

create function pg_temp.rows() returns jsonb language sql as $$ select current_setting('t.rows')::jsonb $$;

create function pg_temp.appeal(p_user uuid, p_action bigint, p_grounds text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.run(p_user, format('select * from public.submit_appeal(%s, %L)', coalesce(p_action::text, 'null'), p_grounds), p_aal)
$$;

create function pg_temp.decide(p_user uuid, p_appeal bigint, p_outcome text, p_reasons text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.run(p_user, format('select * from public.decide_appeal(%s, %L, %L)', coalesce(p_appeal::text, 'null'), p_outcome, p_reasons), p_aal)
$$;

create function pg_temp.mine(p_user uuid, p_action bigint default null) returns jsonb
language plpgsql as $$
begin
  if pg_temp.run(p_user, format('select * from public.list_my_appeals(%s)', coalesce(p_action::text, 'null')), 'aal1') <> 'ok' then
    return null;
  end if;
  return pg_temp.rows();
end;
$$;

-- Everything an appeal call writes, to compare before and after a refused call.
create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.moderation_actions) || ',' || (select count(*) from audit.log) || ','
      || (select count(*) from pgmq.q_notifications) || ',' || (select count(*) from pgmq.q_account_ops) || ','
      || coalesce((select string_agg(id || ':' || status, ',' order by id) from public.appeals), '') || ','
      || (select string_agg(id || ':' || status || ':' || coalesce(moderation_state::text, '-'), ',' order by id) from public.organizations)
      || ',' || (select string_agg(id || ':' || moderation_state, ',' order by id) from public.jobs)
$$;

create function pg_temp.queued(p_kind text, p_user uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(q.message order by q.msg_id), '[]')
  from pgmq.q_notifications q where q.message ->> 'kind' = p_kind and q.message ->> 'user_id' = p_user::text
$$;

create function pg_temp.notice(p_kind text, p_user uuid) returns public.notifications
language sql as $$
  select n.* from public.notifications n where n.kind = p_kind and n.user_id = p_user order by n.msg_id desc nulls last limit 1
$$;

-- A decision by the Trust & Safety Administrator st_trust (A) through moderation_decide; answers its id.
create function pg_temp.decision(p_decision text, p_type text, p_target uuid) returns bigint
language plpgsql as $$
declare
  v text;
begin
  v := pg_temp.call_as('00000000-0000-0000-0000-00000000a022', 'authenticated',
    format($f$select set_config('t.action', d.moderation_action_id::text, true) from public.moderation_decide(%L, %L, null, %L, %L) d$f$,
      p_decision, 'The statement of reasons of this decision.', p_type, p_target));
  if v <> 'ok' then raise exception 'decision failed: %', v; end if;
  return current_setting('t.action')::bigint;
end;
$$;

select pg_temp.partner(:'pow', 'recruitment_company', 'alpha-recruit') as alpha \gset
select pg_temp.partner(:'gow', 'staffing_company', 'gamma-staffing') as gamma \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (:'alpha', :'padm', 'admin', now()), (:'alpha', :'pmem', 'member', now()), (:'gamma', :'gadm', 'admin', now()),
       (:'gamma', :'trust_own', 'member', now());
select pg_temp.open_job('Acme hidden welder') as job1 \gset
select pg_temp.open_job('Acme second vacancy') as job2 \gset
select pg_temp.open_job('Acme third vacancy') as job3 \gset
select pg_temp.open_job('Acme old vacancy') as job_old \gset
select pg_temp.open_job('Beta vacancy', current_setting('t.b')::uuid) as job_beta \gset

-- Release 2a off: Phase 1 is unchanged ------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.call_as(:'st_trust', 'authenticated', format('select public.moderate_job(%L, %L, %L)', :'job_beta', 'hide', 'Hidden before release 2a.')), 'ok',
  'before release 2a a vacancy is hidden with the Phase 1 control');
select ok(
  not (pg_temp.notice('vacancy_hidden', :'own2')).payload ? 'moderation_action_id',
  'before release 2a vacancy_hidden carries no decision id: the notice keeps the Phase 1 appeal route'
);
select is(pg_temp.call_as(:'st_trust', 'authenticated', format('select public.suspend_organization(%L, %L)', current_setting('t.b'), 'Suspended before release 2a.')), 'ok',
  'before release 2a an organisation is suspended with the Phase 1 control');
select ok(
  not (pg_temp.notice('account_suspended', :'own2')).payload ? 'moderation_action_id',
  'and account_suspended carries no decision id either'
);
select id as beta_susp from public.moderation_actions where action = 'organization_suspended' and target_id = current_setting('t.b')::uuid \gset
select is(pg_temp.appeal(:'own2', :beta_susp, 'We think this suspension was a mistake.'), 'P0001|CHARA_FORBIDDEN|release_off',
  'submit_appeal answers release_off while release 2a is off');
select is(pg_temp.run(:'own2', 'select * from public.list_my_appeals()'), 'P0001|CHARA_FORBIDDEN|release_off',
  'list_my_appeals answers release_off');
select is(pg_temp.decide(:'trust_b', 1, 'uphold', 'Nothing to change here at all.'), 'P0001|CHARA_FORBIDDEN|release_off',
  'decide_appeal answers release_off');
select is(pg_temp.run(:'st_admin', 'select * from public.admin_list_appeals()'), 'P0001|CHARA_FORBIDDEN|release_off',
  'admin_list_appeals answers release_off');
select is(pg_temp.run(:'st_admin', 'select * from public.admin_get_appeal(1)'), 'P0001|CHARA_FORBIDDEN|release_off',
  'admin_get_appeal answers release_off');
select is(pg_temp.run(:'st_admin', 'select * from public.admin_appeal_stats()'), 'P0001|CHARA_FORBIDDEN|release_off',
  'admin_appeal_stats answers release_off');
select is(pg_temp.call_as(:'trust_b', 'authenticated', format('select public.reinstate_organization(%L, %L)', current_setting('t.b'), 'Reinstated before release 2a.')), 'ok',
  'Beta is reinstated again with the Phase 1 control');

update private.settings set value = 'true' where key = 'release_partner_directories';

-- Structure and privileges ----------------------------------------------------------------------------------------------

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.appeals'::regclass),
  'NFR-S8: public.appeals has RLS enabled and forced'
);
select ok(
  not has_table_privilege('anon', 'public.appeals', 'select, insert, update, delete')
  and not has_table_privilege('authenticated', 'public.appeals', 'select, insert, update, delete')
  and not has_table_privilege('service_role', 'public.appeals', 'select, insert, update, delete'),
  'NFR-S8: no API role reads or writes public.appeals directly; it is read and written through RPCs'
);
select is(
  (select array_agg(e::text order by e) from unnest(enum_range(null::public.appeal_status)) e),
  array['open', 'upheld', 'restored'], 'an appeal is open, upheld or restored'
);
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
   where oid in ('public.submit_appeal(bigint, text)'::regprocedure, 'public.decide_appeal(bigint, text, text)'::regprocedure,
                 'public.list_my_appeals(bigint, uuid)'::regprocedure, 'public.admin_list_appeals(text, integer, bigint, timestamptz)'::regprocedure,
                 'public.admin_get_appeal(bigint)'::regprocedure, 'public.admin_appeal_stats(integer)'::regprocedure)),
  'the appeal RPCs are definer functions with an empty search_path'
);
select ok(
  (select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
                   and not has_function_privilege('service_role', f, 'execute'))
   from unnest(array['public.submit_appeal(bigint, text)', 'public.decide_appeal(bigint, text, text)', 'public.list_my_appeals(bigint, uuid)',
     'public.admin_list_appeals(text, integer, bigint, timestamptz)', 'public.admin_get_appeal(bigint)',
     'public.admin_appeal_stats(integer)']) f),
  'the appeal RPCs are for signed-in callers only'
);
select ok(
  not has_function_privilege('authenticated', 'private.appealable_decision(bigint)', 'execute')
  and not has_function_privilege('authenticated', 'private.appeal_link(bigint)', 'execute')
  and not has_function_privilege('authenticated', 'private.appeal_setting(text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.set_partner_profile_moderation(uuid, boolean, text, bigint, boolean)', 'execute'),
  'the private helpers are not callable through the API'
);
select is(
  (select count(*) from pg_proc where proname = 'set_partner_profile_moderation' and pronamespace = 'private'::regnamespace), 1::bigint,
  'private.set_partner_profile_moderation has one signature, the earlier one is gone'
);
select is(
  (select string_agg(key || ':' || min || '-' || max || ':' || (select value #>> '{}' from private.settings s where s.key = r.key), ',' order by key)
   from private.setting_rules r where key in ('appeal_window_months', 'appeal_decision_target_days')),
  'appeal_decision_target_days:1-90:7,appeal_window_months:1-24:6',
  'NFR-O5: the appeal window (6 months) and the decision target (7 days) are settings of the audited settings editor'
);
select throws_ok(
  format($$insert into public.appeals (moderation_action_id, organization_id, grounds, due_at)
           values (%s, %L, 'Nineteen characters', now())$$, :beta_susp, current_setting('t.b')),
  '23514', null, 'the table refuses grounds shorter than 20 characters'
);
select throws_ok(
  format($$insert into public.appeals (moderation_action_id, organization_id, grounds, due_at, status)
           values (%s, %L, 'Grounds of twenty chars at least.', now(), 'upheld')$$, :beta_susp, current_setting('t.b')),
  '23514', null, 'the table refuses a decided appeal without a decision time and reasons'
);

-- Decisions that can be appealed ------------------------------------------------------------------------------------------

select pg_temp.decision('hide', 'partner_profile', :'alpha') as act_hide \gset
select pg_temp.decision('hide', 'job', :'job1') as act_job \gset
select pg_temp.decision('hide', 'job', :'job2') as act_job2 \gset
select pg_temp.decision('unhide', 'job', :'job2') as act_job2_un \gset
select pg_temp.decision('hide', 'job', :'job3') as act_job3 \gset
select pg_temp.decision('suspend_organization', 'organization', :'gamma') as act_susp \gset
-- A decision taken 6 months and 1 day ago (written as the database owner; moderation_actions only refuses changes).
insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id, created_at)
values ('job', :'job_old', 'job_hidden', 'Hidden long ago for misleading claims.', :'st_trust', now() - interval '6 months 1 day');
update public.jobs set moderation_state = 'hidden' where id = :'job_old';
select id as act_old from public.moderation_actions where target_id = :'job_old' \gset

select is(
  (select jsonb_build_object('has', n.payload ? 'moderation_action_id', 'id', n.payload -> 'moderation_action_id')
   from public.notifications n where n.kind = 'vacancy_hidden' and n.user_id = :'own1' and n.payload ->> 'job_id' = :'job1'),
  jsonb_build_object('has', true, 'id', :act_job), 'with release 2a vacancy_hidden carries the decision id the appeal names'
);
select is(
  (pg_temp.notice('account_suspended', :'gow')).payload -> 'moderation_action_id', to_jsonb(:act_susp),
  'and the suspension notice of an organisation carries it too'
);
select is(
  (select n.payload -> 'moderation_action_id' from public.notifications n
   where n.kind = 'moderation_decision' and n.user_id = :'pow' and n.payload ->> 'decision' = 'hide'),
  to_jsonb(:act_hide), 'the moderation_decision notice of the hidden profile names the decision'
);

-- list_my_appeals: what the affected organisation reads ------------------------------------------------------------------

select is(
  (select jsonb_build_object('action', e ->> 'action', 'title', e ->> 'title', 'reasons', e ->> 'reasons', 'can', e -> 'can_appeal',
     'effect', e -> 'in_effect', 'appeal', e -> 'appeal_id', 'until', (e ->> 'appeal_until')::timestamptz = (e ->> 'decided_at')::timestamptz + interval '6 months',
     'target', e -> 'target_days')
   from jsonb_array_elements(pg_temp.mine(:'pow')) e),
  jsonb_build_object('action', 'content_hidden', 'title', 'Alpha Recruit', 'reasons', 'The statement of reasons of this decision.',
    'can', true, 'effect', true, 'appeal', null, 'until', true, 'target', 7),
  'AC12 (data): the owner reads the decision on its profile, its reasons, the end of the window, the 7-day target and that it can appeal'
);
select is(
  (select jsonb_agg(e -> 'can_appeal') from jsonb_array_elements(pg_temp.mine(:'pmem')) e), '[false]'::jsonb,
  'AC12 (data): a member reads the same decision and reasons but cannot appeal'
);
select ok(
  not exists (select 1 from jsonb_array_elements(pg_temp.mine(:'pow')) e where e ? 'actor_id' or e ? 'decided_by'),
  'the affected organisation never reads who decided'
);
select is(
  (select string_agg(e ->> 'moderation_action_id', ',' order by (e ->> 'moderation_action_id')::bigint desc) from jsonb_array_elements(pg_temp.mine(:'own1')) e),
  concat_ws(',', :act_job3, :act_job2, :act_job), 'Acme reads the decisions on its vacancies of the window, newest first; the old one is outside it'
);
select is(
  (select jsonb_agg(jsonb_build_object('id', e -> 'moderation_action_id', 'effect', e -> 'in_effect', 'can', e -> 'can_appeal'))
   from jsonb_array_elements(pg_temp.mine(:'own1', :act_job2)) e),
  jsonb_build_array(jsonb_build_object('id', :act_job2, 'effect', false, 'can', false)),
  'a decision undone since is listed as no longer in effect and cannot be appealed'
);
select is(
  (select jsonb_agg(e ->> 'action') from jsonb_array_elements(pg_temp.mine(:'gow')) e), '["organization_suspended"]'::jsonb,
  'a suspended organisation reads its suspension'
);
select is(
  (select coalesce(jsonb_agg(e), '[]') from jsonb_array_elements(pg_temp.mine(:'own2')) e where e ->> 'organization_id' <> current_setting('t.b')),
  '[]'::jsonb, 'NFR-S8: another employer reads only its own decisions, nothing of Acme or the partners'
);
select is(pg_temp.mine(:'wa'), '[]'::jsonb, 'NFR-S8: a candidate reads nothing');
select is(pg_temp.mine(:'wb'), '[]'::jsonb, 'NFR-S8: the other candidate reads nothing');
select is(pg_temp.mine(:'gow', :act_hide), '[]'::jsonb, 'NFR-S8: a competing partner does not read the decision on Alpha');
select is(pg_temp.run(null, 'select * from public.list_my_appeals()'), '42501|permission denied for function list_my_appeals|',
  'NFR-S8: an anonymous caller cannot call list_my_appeals');

-- submit_appeal: refusals -------------------------------------------------------------------------------------------------

select pg_temp.writes() as before_refusals \gset
select is(pg_temp.appeal(null, :act_hide, 'We think this decision was a mistake.'), '42501|permission denied for function submit_appeal|',
  'an anonymous caller cannot appeal');
select is(pg_temp.appeal(:'pow', :act_hide, null), 'P0001|CHARA_INVALID_INPUT|grounds', 'grounds are required');
select is(pg_temp.appeal(:'pow', :act_hide, '   Nineteen chars.  '), 'P0001|CHARA_INVALID_INPUT|grounds',
  'AC12: grounds of 19 characters after trimming are refused');
select is(pg_temp.appeal(:'pow', :act_hide, repeat('g', 2001)), 'P0001|CHARA_INVALID_INPUT|grounds', 'grounds of 2,001 characters are refused');
select is(pg_temp.appeal(:'pmem', :act_hide, 'We think this decision was a mistake.'), 'P0001|CHARA_FORBIDDEN|',
  'AC12: a member cannot appeal');
select is(pg_temp.appeal(:'pow', :act_hide, 'We think this decision was a mistake.', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'the owner appeals at aal2');
select is(pg_temp.appeal(:'own2', :act_job, 'We think this decision was a mistake.'), 'P0002|CHARA_NOT_FOUND|',
  'NFR-S8: another employer is answered not found');
select is(pg_temp.appeal(:'gow', :act_hide, 'We think this decision was a mistake.'), 'P0002|CHARA_NOT_FOUND|',
  'NFR-S8: a competing partner is answered not found');
select is(pg_temp.appeal(:'wa', :act_hide, 'We think this decision was a mistake.', 'aal1'), 'P0002|CHARA_NOT_FOUND|',
  'NFR-S8: a candidate is answered not found');
select is(pg_temp.appeal(:'pow', :act_job2_un, 'We think this decision was a mistake.'), 'P0002|CHARA_NOT_FOUND|',
  'an unhide is no decision against the organisation and is not found');
select is(pg_temp.appeal(:'pow', 999999999, 'We think this decision was a mistake.'), 'P0002|CHARA_NOT_FOUND|',
  'an unknown decision is not found, as one of another organisation');
select is(pg_temp.appeal(:'own1', :act_old, 'We think this decision was a mistake.'), 'P0001|CHARA_INVALID_STATE|appeal_window_closed',
  'AC9: an appeal 6 months and 1 day after the decision is refused');
select is(pg_temp.appeal(:'own1', :act_job2, 'We think this decision was a mistake.'), 'P0001|CHARA_INVALID_STATE|not_in_effect',
  'a decision undone since cannot be appealed');
update public.profiles set status = 'suspended' where id = :'gadm';
select is(pg_temp.appeal(:'gadm', :act_susp, 'We think this decision was a mistake.'), 'P0001|CHARA_FORBIDDEN|profile_suspended',
  'a suspended account cannot appeal');
update public.profiles set status = 'active' where id = :'gadm';
select is(pg_temp.writes(), :'before_refusals', 'the refused appeals wrote nothing');

-- submit_appeal: lodged ---------------------------------------------------------------------------------------------------

select is(pg_temp.appeal(:'padm', :act_hide, repeat('Our profile follows the rules. ', 2) || 'Please look again.'), 'ok',
  'AC9: an admin of the partner lodges an appeal with grounds of 50 characters or more');
select (pg_temp.rows() -> 0 ->> 'appeal_id')::bigint as ap_hide \gset
select is(
  (select jsonb_build_object('status', status, 'appellant', appellant_user_id, 'org', organization_id, 'due', due_at = lodged_at + interval '7 days',
     'lodged', lodged_at = now(), 'decided', decided_at, 'by', decided_by)
   from public.appeals where id = :ap_hide),
  jsonb_build_object('status', 'open', 'appellant', :'padm', 'org', :'alpha', 'due', true, 'lodged', true, 'decided', null, 'by', null),
  'AC9: one appeal row, open, due 7 days after it was lodged'
);
select is((pg_temp.rows() -> 0 ->> 'due_at')::timestamptz, now() + interval '7 days', 'the caller is told the due time');
select is(
  (select count(*) from audit.log where action = 'appeal.lodged' and entity_id = :ap_hide::text and actor_id = :'padm'
     and metadata ->> 'moderation_action_id' = :act_hide::text),
  1::bigint, 'the appeal is audited as appeal.lodged by the appellant'
);
select is(pg_temp.appeal(:'pow', :act_hide, 'A second appeal on the same decision.'), 'P0001|CHARA_INVALID_STATE|appeal_exists',
  'AC9: a second appeal on the same decision is refused');
select is((select count(*) from public.appeals where moderation_action_id = :act_hide), 1::bigint, 'one appeal per decision');
select throws_ok(
  format($$insert into public.appeals (moderation_action_id, organization_id, grounds, due_at) values (%s, %L, 'Grounds of twenty chars at least.', now())$$, :act_hide, :'alpha'),
  '23505', null, 'the table holds one appeal per decision'
);
select is(
  (select jsonb_build_object('can', e -> 'can_appeal', 'status', e ->> 'appeal_status', 'grounds', e ? 'grounds')
   from jsonb_array_elements(pg_temp.mine(:'pmem')) e),
  jsonb_build_object('can', false, 'status', 'open', 'grounds', true),
  'AC12 (data): every member reads that the appeal is under review'
);
select is(pg_temp.appeal(:'own1', :act_job, 'The vacancy is genuine and lawful.'), 'ok', 'the owner of Acme appeals the hidden vacancy');
select (pg_temp.rows() -> 0 ->> 'appeal_id')::bigint as ap_job \gset
update private.settings set value = '3' where key = 'appeal_decision_target_days';
select is(pg_temp.appeal(:'own1', :act_job3, 'This vacancy too is genuine and lawful.'), 'ok', 'and the third vacancy');
select (pg_temp.rows() -> 0 ->> 'appeal_id')::bigint as ap_job3 \gset
select is((select due_at from public.appeals where id = :ap_job3), now() + interval '3 days',
  'NFR-O5: the decision target follows its setting');
update private.settings set value = '7' where key = 'appeal_decision_target_days';
select is(pg_temp.appeal(:'gow', :act_susp, 'Our company is suspended without cause.'), 'ok',
  'the owner of a suspended organisation appeals its suspension');
select (pg_temp.rows() -> 0 ->> 'appeal_id')::bigint as ap_susp \gset
update private.settings set value = '12' where key = 'appeal_window_months';
select ok(
  (select bool_and((e ->> 'can_appeal')::boolean) from jsonb_array_elements(pg_temp.mine(:'own1', :act_old)) e),
  'NFR-O5: the appeal window follows its setting'
);
update private.settings set value = '6' where key = 'appeal_window_months';

-- NFR-A4: two appeals on one decision at the same moment. The other session holds the lock of the decision, as an appeal
-- in progress would; the appeal of this session waits for it.
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('other',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_exec('other', 'begin');
select x from extensions.dblink('other', format($$select 1 from (select pg_advisory_xact_lock(hashtextextended('appeal:%s', 0))) l$$, :act_old)) as t (x integer);
set local lock_timeout = '300ms';
select is(split_part(pg_temp.appeal(:'own1', :act_old, 'We think this decision was a mistake.'), '|', 1), '55P03',
  'NFR-A4: a second appeal on a decision waits for the first');
reset lock_timeout;
select extensions.dblink_exec('other', 'rollback');
select extensions.dblink_disconnect('other');

-- NFR-S8: direct reads and writes of the table ----------------------------------------------------------------------------

select is(pg_temp.call_as(:'own1', 'authenticated', 'select count(*) from public.appeals'), '42501|permission denied for table appeals|',
  'NFR-S8: an employer owner cannot select public.appeals');
select is(pg_temp.call_as(:'own2', 'authenticated', 'select count(*) from public.appeals'), '42501|permission denied for table appeals|',
  'NFR-S8: the other employer cannot either');
select is(pg_temp.call_as(:'pow', 'authenticated', 'select count(*) from public.appeals'), '42501|permission denied for table appeals|',
  'NFR-S8: a partner owner cannot');
select is(pg_temp.call_as(:'gow', 'authenticated', 'select count(*) from public.appeals'), '42501|permission denied for table appeals|',
  'NFR-S8: the other partner cannot');
select is(pg_temp.call_as(:'wa', 'authenticated', 'select count(*) from public.appeals', 'aal1'), '42501|permission denied for table appeals|',
  'NFR-S8: a candidate cannot');
select is(pg_temp.call_as(:'wb', 'authenticated', 'select count(*) from public.appeals', 'aal1'), '42501|permission denied for table appeals|',
  'NFR-S8: the other candidate cannot');
select is(pg_temp.call_as(null, 'anon', 'select count(*) from public.appeals'), '42501|permission denied for table appeals|',
  'NFR-S8: an anonymous caller cannot');
select is(pg_temp.call_as(:'pow', 'authenticated', format('update public.appeals set status = %L', 'restored')), '42501|permission denied for table appeals|',
  'nobody outside the RPCs decides an appeal');

-- Staff reads ---------------------------------------------------------------------------------------------------------------

select is(pg_temp.run(:'st_trust', 'select * from public.admin_list_appeals()'), 'ok', 'AC11: Trust & Safety read the appeals');
select is(
  (select string_agg(e.v ->> 'id', ',' order by e.n) from jsonb_array_elements(pg_temp.rows()) with ordinality e (v, n)),
  concat_ws(',', :ap_job3, :ap_hide, :ap_job, :ap_susp), 'open appeals come by due time: the 3-day target first, then by id'
);
select is(
  (select jsonb_build_object('type', e ->> 'target_type', 'title', e ->> 'title', 'org', e ->> 'organization_name', 'overdue', e -> 'overdue')
   from jsonb_array_elements(pg_temp.rows()) e where (e ->> 'id')::bigint = :ap_hide),
  jsonb_build_object('type', 'partner_profile', 'title', 'Alpha Recruit', 'org', 'Alpha Recruit', 'overdue', false),
  'each row names the target, its organisation and whether it is overdue'
);
select is(
  pg_temp.run(:'st_admin', format('select * from public.admin_list_appeals(%L, 2, %s, %L)', 'open', :ap_job3,
    (select due_at from public.appeals where id = :ap_job3))), 'ok',
  'the Platform Administrator reads them too, after a cursor'
);
select is((select string_agg(e ->> 'id', ',') from jsonb_array_elements(pg_temp.rows()) e), concat_ws(',', :ap_hide, :ap_job),
  'the page continues after the last row''s due time and id');
select is(pg_temp.run(:'st_review', 'select * from public.admin_list_appeals()'), 'P0001|CHARA_FORBIDDEN|', 'a Verification Reviewer reads no appeals');
select is(pg_temp.run(:'st_trust', 'select * from public.admin_list_appeals()', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'staff read the appeals at aal2');
select is(pg_temp.run(:'pow', 'select * from public.admin_list_appeals()'), 'P0001|CHARA_FORBIDDEN|', 'a partner owner reads no appeals');
select is(pg_temp.run(null, 'select * from public.admin_list_appeals()'), '42501|permission denied for function admin_list_appeals|',
  'an anonymous caller cannot list appeals');
select is(pg_temp.run(:'st_trust', $$select * from public.admin_list_appeals('closed')$$), 'P0001|CHARA_INVALID_INPUT|status',
  'an unknown status is refused');
select is(pg_temp.run(:'st_trust', format('select * from public.admin_get_appeal(%s)', :ap_hide)), 'ok', 'Trust & Safety open one appeal');
select is(
  (select jsonb_build_object('action', e ->> 'action', 'reasons', e ->> 'decision_reasons', 'grounds', e ->> 'grounds', 'own', e -> 'own_decision',
     'effect', e -> 'in_effect', 'appellant', e ? 'appellant_user_id')
   from jsonb_array_elements(pg_temp.rows()) e),
  jsonb_build_object('action', 'content_hidden', 'reasons', 'The statement of reasons of this decision.',
    'grounds', repeat('Our profile follows the rules. ', 2) || 'Please look again.', 'own', true, 'effect', true, 'appellant', false),
  'the appeal comes with the decision and its reasons; the decider is told it is their own decision; never the appellant'
);
select is(pg_temp.run(:'trust_b', format('select own_decision from public.admin_get_appeal(%s)', :ap_hide)), 'ok', 'the second reviewer opens it');
select is(pg_temp.rows() -> 0 -> 'own_decision', 'false'::jsonb, 'and is not its decider');
select is(pg_temp.run(:'trust_b', 'select * from public.admin_get_appeal(999999999)'), 'P0002|CHARA_NOT_FOUND|', 'an unknown appeal is not found');

-- decide_appeal: refusals -------------------------------------------------------------------------------------------------

select pg_temp.writes() as before_decide \gset
select is(pg_temp.decide(null, :ap_hide, 'restore', 'Restored after a second look at the facts.'), '42501|permission denied for function decide_appeal|',
  'an anonymous caller cannot decide');
select is(pg_temp.decide(:'st_admin', :ap_hide, 'restore', 'Restored after a second look at the facts.'), 'P0001|CHARA_FORBIDDEN|',
  'a Platform Administrator cannot decide an appeal');
select is(pg_temp.decide(:'st_review', :ap_hide, 'restore', 'Restored after a second look at the facts.'), 'P0001|CHARA_FORBIDDEN|',
  'a Verification Reviewer cannot');
select is(pg_temp.decide(:'gone_trust', :ap_hide, 'restore', 'Restored after a second look at the facts.'), 'P0001|CHARA_FORBIDDEN|',
  'a Trust & Safety Administrator whose role was revoked cannot');
select is(pg_temp.decide(:'trust_b', :ap_hide, 'restore', 'Restored after a second look at the facts.', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'Trust & Safety decide at aal2');
select is(pg_temp.decide(:'pow', :ap_hide, 'restore', 'Restored after a second look at the facts.'), 'P0001|CHARA_FORBIDDEN|',
  'the partner cannot decide its own appeal');
select is(pg_temp.decide(:'st_trust', :ap_hide, 'restore', 'Restored after a second look at the facts.'), 'P0001|CHARA_FORBIDDEN|same_reviewer',
  'AC9: the administrator who took the decision cannot decide its appeal');
select is(pg_temp.decide(:'trust_own', :ap_susp, 'restore', 'Restored after a second look at the facts.'), 'P0001|CHARA_FORBIDDEN|own_organization',
  'nobody decides an appeal of their own organisation');
select is(pg_temp.decide(:'trust_b', :ap_hide, 'restore', 'Too short'), 'P0001|CHARA_INVALID_INPUT|reason',
  'a statement of reasons of 9 characters is refused');
select is(pg_temp.decide(:'trust_b', :ap_hide, 'reverse', 'Restored after a second look at the facts.'), 'P0001|CHARA_INVALID_INPUT|outcome',
  'an unknown outcome is refused');
select is(pg_temp.decide(:'trust_b', 999999999, 'uphold', 'Restored after a second look at the facts.'), 'P0002|CHARA_NOT_FOUND|',
  'an unknown appeal is not found');
select is(pg_temp.writes(), :'before_decide', 'the refused decisions wrote nothing');

-- decide_appeal: restore ----------------------------------------------------------------------------------------------------

select count(*) as notices_before from pgmq.q_notifications \gset
select is(pg_temp.decide(:'trust_b', :ap_hide, 'restore', 'The profile meets the rules after review.'), 'ok',
  'AC9: a second administrator restores with 40 characters of reasons');
select (pg_temp.rows() -> 0 ->> 'reversal_action_id')::bigint as rev_hide \gset
select is(pg_temp.rows() -> 0 ->> 'status', 'restored', 'the answer is the outcome');
select is((select moderation_state::text from public.organizations where id = :'alpha'), 'visible', 'AC9: the profile is shown again');
select is(
  (select jsonb_build_object('type', target_type, 'action', action, 'actor', actor_id, 'reasons', statement_of_reasons)
   from public.moderation_actions where id = :rev_hide),
  jsonb_build_object('type', 'partner_profile', 'action', 'content_unhidden', 'actor', :'trust_b', 'reasons', 'The profile meets the rules after review.'),
  'AC9: the reversal is a content_unhidden decision of the second administrator with the reasons'
);
select is(
  (select jsonb_build_object('status', status, 'by', decided_by, 'reasons', reasons, 'at', decided_at = now()) from public.appeals where id = :ap_hide),
  jsonb_build_object('status', 'restored', 'by', :'trust_b', 'reasons', 'The profile meets the rules after review.', 'at', true),
  'AC9: the outcome, the reasons and who decided are recorded'
);
select is(
  (select jsonb_build_object('n', count(*), 'decision', min(metadata ->> 'moderation_action_id'), 'reversal', min(metadata ->> 'reversal_action_id'),
     'reason', min(metadata ->> 'reason'))
   from audit.log where action = 'appeal.restored' and entity_id = :ap_hide::text and actor_id = :'trust_b'),
  jsonb_build_object('n', 1, 'decision', :act_hide::text, 'reversal', :rev_hide::text, 'reason', 'The profile meets the rules after review.'),
  'AC9: one audit row of the appeal, with the decision and the reversal'
);
select is((select count(*) from audit.log where action = 'partner_profile.unhide' and entity_id = :'alpha'), 1::bigint,
  'the reversal is audited by its own body, as every unhide');
select is((select count(*) from pgmq.q_notifications)::integer - :notices_before, 1,
  'AC9: one notice is queued, not a second one for the unhide');
select is(
  (select jsonb_build_object('user', message ->> 'user_id', 'mandatory', message -> 'mandatory') from pgmq.q_notifications
   order by msg_id desc limit 1),
  jsonb_build_object('user', :'padm', 'mandatory', true), 'AC9: the notice is the appellant''s and mandatory'
);
select is(
  (pg_temp.notice('moderation_decision', :'padm')).payload,
  jsonb_build_object('target_type', 'partner_profile', 'target_id', :'alpha', 'title', 'Alpha Recruit', 'org_slug', 'alpha-recruit',
    'appeal_id', :ap_hide, 'appeal_outcome', 'restored', 'reasons', 'The profile meets the rules after review.',
    'moderation_action_id', :act_hide),
  'AC9: the notice carries the target, the outcome of the appeal and its reasons only'
);
select is((pg_temp.notice('moderation_decision', :'padm')).mandatory, true, 'and is stored as mandatory');
select is(pg_temp.decide(:'trust_b', :ap_hide, 'uphold', 'Second decision on the same appeal.'), 'P0001|CHARA_INVALID_STATE|restored',
  'a decided appeal is not decided again');
select is(
  (select jsonb_build_object('status', e ->> 'appeal_status', 'reasons', e ->> 'appeal_reasons', 'effect', e -> 'in_effect', 'can', e -> 'can_appeal')
   from jsonb_array_elements(pg_temp.mine(:'pow', :act_hide)) e),
  jsonb_build_object('status', 'restored', 'reasons', 'The profile meets the rules after review.', 'effect', false, 'can', false),
  'the partner reads the outcome and its reasons'
);

-- decide_appeal: uphold ------------------------------------------------------------------------------------------------------

select pg_temp.writes() as before_uphold \gset
select is(pg_temp.decide(:'trust_b', :ap_job, 'uphold', 'The vacancy asks candidates for a fee.'), 'ok', 'AC9: an appeal is upheld');
select is(pg_temp.rows() -> 0 -> 'reversal_action_id', 'null'::jsonb, 'nothing is undone');
select is((select moderation_state::text from public.jobs where id = :'job1'), 'hidden', 'AC9: an upheld appeal changes nothing');
select is((select count(*) from public.moderation_actions)::text, split_part(:'before_uphold', ',', 1), 'no moderation action is written');
select is(
  (select jsonb_build_object('status', status, 'by', decided_by, 'reasons', reasons) from public.appeals where id = :ap_job),
  jsonb_build_object('status', 'upheld', 'by', :'trust_b', 'reasons', 'The vacancy asks candidates for a fee.'),
  'AC9: but is recorded the same way'
);
select is((select count(*) from audit.log where action = 'appeal.upheld' and entity_id = :ap_job::text), 1::bigint, 'with one audit row');
select is(
  (select jsonb_build_object('title', payload ->> 'title', 'outcome', payload ->> 'appeal_outcome', 'type', payload ->> 'target_type')
   from public.notifications where kind = 'moderation_decision' and user_id = :'own1' order by id desc limit 1),
  jsonb_build_object('title', 'Acme hidden welder', 'outcome', 'upheld', 'type', 'job'),
  'and the appellant is told, with the title of the vacancy'
);

-- decide_appeal: restore of a suspension and of a decision undone meanwhile -------------------------------------------------

select is(pg_temp.decide(:'trust_b', :ap_susp, 'restore', 'The suspension was based on a mistaken report.'), 'ok',
  'a suspension is restored on appeal');
select (pg_temp.rows() -> 0 ->> 'reversal_action_id')::bigint as rev_susp \gset
select is(
  (select jsonb_build_object('status', o.status, 'profile', o.moderation_state, 'action', a.action)
   from public.organizations o, public.moderation_actions a where o.id = :'gamma' and a.id = :rev_susp),
  jsonb_build_object('status', 'active', 'profile', 'visible', 'action', 'organization_reinstated'),
  'the organisation is reinstated through the reinstatement body, its profile with it'
);
select is(jsonb_array_length(pg_temp.queued('account_reinstated', :'gow')), 1, 'the owner gets the reinstatement notice of Phase 1');
select is(
  (select payload ->> 'appeal_outcome' from public.notifications where kind = 'moderation_decision' and user_id = :'gow' order by id desc limit 1),
  'restored', 'and, as appellant, the outcome of the appeal'
);

select pg_temp.decision('unhide', 'job', :'job3') as act_job3_un \gset
select count(*) as actions_before from public.moderation_actions \gset
select is(pg_temp.decide(:'trust_b', :ap_job3, 'restore', 'Already shown again by a later decision.'), 'ok',
  'an appeal of a decision undone meanwhile is restored');
select is(pg_temp.rows() -> 0 -> 'reversal_action_id', 'null'::jsonb, 'without acting again');
select is((select count(*) from public.moderation_actions), :actions_before::bigint, 'no moderation action is written');
select is(
  (select metadata -> 'already_reversed' from audit.log where action = 'appeal.restored' and entity_id = :ap_job3::text),
  'true'::jsonb, 'the audit row says it was already reversed'
);
select is(
  (select string_agg(id || ':' || coalesce(reversal_action_id::text, '-'), ',' order by id) from public.appeals where status <> 'open'),
  concat_ws(',', :ap_hide || ':' || :rev_hide, :ap_job || ':-', :ap_job3 || ':-', :ap_susp || ':' || :rev_susp),
  'appeals.reversal_action_id holds the reversal of each restore that undid something, and nothing otherwise'
);

-- KPI and states --------------------------------------------------------------------------------------------------------------

select is(pg_temp.run(:'st_admin', 'select * from public.admin_appeal_stats()'), 'ok', 'the Platform Administrator reads the appeal KPI');
select is(pg_temp.rows() -> 0, '{"decided": 4, "restored": 2, "open": 0, "overdue": 0}'::jsonb,
  'KPI decisions reversed on appeal: 2 of 4 decided appeals reversed; the restore that found nothing to undo is not counted');
select is(pg_temp.run(:'st_trust', 'select * from public.admin_appeal_stats(0)'), 'P0001|CHARA_INVALID_INPUT|days', 'a period of 0 days is refused');
select is(pg_temp.run(:'pow', 'select * from public.admin_appeal_stats()'), 'P0001|CHARA_FORBIDDEN|', 'a partner reads no KPI');
select is(pg_temp.run(:'st_trust', $$select id from public.admin_list_appeals('decided')$$), 'ok', 'decided appeals are listed');
select is((select string_agg(e ->> 'id', ',') from jsonb_array_elements(pg_temp.rows()) e), concat_ws(',', :ap_susp, :ap_job3, :ap_job, :ap_hide),
  'newest first');
select is(pg_temp.run(:'st_trust', 'select id from public.admin_list_appeals()'), 'ok', 'and no appeal is open');
select is(pg_temp.rows(), '[]'::jsonb, 'the open list is empty');
update public.appeals set due_at = now() - interval '1 hour', lodged_at = now() - interval '8 days', status = 'open', reasons = null,
  decided_at = null, decided_by = null
where id = :ap_job;
select is(pg_temp.run(:'st_trust', 'select overdue from public.admin_list_appeals()'), 'ok', 'an appeal past its due time');
select is(pg_temp.rows() -> 0 -> 'overdue', 'true'::jsonb, 'is flagged overdue');

-- A restore of a deleted vacancy, after the appellant left the organisation ----------------------------------------------

select pg_temp.open_job('Acme deleted vacancy') as job_del \gset
select pg_temp.decision('hide', 'job', :'job_del') as act_del \gset
select is(pg_temp.appeal(:'adm', :act_del, 'The vacancy was lawful before we removed it.'), 'ok', 'an admin of Acme appeals a hidden vacancy');
select (pg_temp.rows() -> 0 ->> 'appeal_id')::bigint as ap_del \gset
update public.jobs set deleted_at = now() where id = :'job_del';
delete from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id = :'adm';
select count(*) as actions_before_del from public.moderation_actions \gset
select is(pg_temp.decide(:'trust_b', :ap_del, 'restore', 'The vacancy was lawful, but it no longer exists.'), 'ok',
  'an appeal of a vacancy deleted since is restored');
select is((select count(*) from public.moderation_actions), :actions_before_del::bigint, 'nothing is undone: no moderation action');
select is((select reversal_action_id from public.appeals where id = :ap_del), null, 'and no reversal is recorded');
select is(
  (select metadata - 'request_id' - 'reason' - 'organization_id' - 'moderation_action_id' from audit.log
   where action = 'appeal.restored' and entity_id = :ap_del::text),
  '{"target_type": "job", "target_deleted": true}'::jsonb,
  'the audit row says the vacancy was deleted, not that a later decision reversed it'
);
select is(
  (select count(*) from pgmq.q_notifications q where q.message ->> 'appeal_id' = :ap_del::text and q.message ->> 'user_id' = :'adm'),
  0::bigint, 'the appellant who left the organisation is not sent the outcome'
);
select is(
  (select string_agg(q.message ->> 'user_id', ',') from pgmq.q_notifications q where q.message ->> 'appeal_id' = :ap_del::text),
  :'own1', 'the current owners and admins of the organisation are sent it instead (members are not)'
);

-- list_my_appeals by vacancy -------------------------------------------------------------------------------------------------

savepoint many_decisions;
insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id)
select 'job', :'job2', 'job_hidden', 'Repeated decision number ' || n || ' on one vacancy.', :'st_trust' from generate_series(1, 101) n;
select ok(
  not exists (select 1 from jsonb_array_elements(pg_temp.mine(:'own1')) e where (e ->> 'moderation_action_id')::bigint = :act_job),
  'the list of an organisation with more than 100 decisions stops at the newest 100'
);
select is(pg_temp.run(:'own1', format('select moderation_action_id from public.list_my_appeals(null, %L)', :'job1'), 'aal1'), 'ok',
  'a vacancy page asks for the decisions on its vacancy');
select is(pg_temp.rows(), jsonb_build_array(jsonb_build_object('moderation_action_id', :act_job)),
  'and finds its decision whatever the number of others');
select is(pg_temp.run(:'own2', format('select moderation_action_id from public.list_my_appeals(null, %L)', :'job1'), 'aal1'), 'ok',
  'another employer asks for the same vacancy');
select is(pg_temp.rows(), '[]'::jsonb, 'NFR-S8: and reads nothing');
rollback to savepoint many_decisions;

-- Retention -----------------------------------------------------------------------------------------------------------------

select is((select days from private.retention_policies where entity = 'closed_appeals'), 365, 'closed appeals are kept 365 days');
insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id, created_at)
values ('job', :'job_beta', 'job_hidden', 'Hidden more than two years ago.', :'st_trust', now() - interval '25 months')
returning id as act_ancient \gset
insert into public.appeals (moderation_action_id, organization_id, grounds, status, reasons, lodged_at, due_at, decided_at)
values (:act_ancient, current_setting('t.b')::uuid, 'Grounds lodged more than two years ago.', 'upheld', 'Upheld long ago.',
        now() - interval '25 months', now() - interval '25 months' + interval '7 days', now() - interval '366 days')
returning id as ap_ancient \gset
update public.appeals set decided_at = now() - interval '366 days', lodged_at = now() - interval '380 days' where id = :ap_hide;
update public.appeals set lodged_at = now() - interval '400 days', due_at = now() - interval '393 days' where id = :ap_job;
select private.apply_retention();
select is(
  (select string_agg(id::text, ',' order by id) from public.appeals),
  concat_ws(',', :ap_hide, :ap_job, :ap_job3, :ap_susp, :ap_del),
  'apply_retention deletes a decided appeal older than 365 days whose decision is outside the longest window; it keeps open ones, recent ones and one whose decision is recent'
);
select is((select count(*) from public.moderation_actions where id = :act_ancient), 1::bigint, 'the decision it was about is kept');
select is((select metadata ->> 'removed' from audit.log where action = 'retention.run' and entity_id = 'closed_appeals' order by id desc limit 1), '1',
  'the run is recorded');

-- A short retention period never reopens a decision to a second appeal.
update private.retention_policies set days = 30 where entity = 'closed_appeals';
select pg_temp.open_job('Acme vacancy decided 60 days ago') as job_60 \gset
insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons, actor_id, created_at)
values ('job', :'job_60', 'job_hidden', 'Hidden sixty days ago for a fee demand.', :'st_trust', now() - interval '60 days')
returning id as act_60 \gset
update public.jobs set moderation_state = 'hidden' where id = :'job_60';
insert into public.appeals (moderation_action_id, organization_id, grounds, status, reasons, lodged_at, due_at, decided_at)
values (:act_60, current_setting('t.a')::uuid, 'The vacancy asks for no fee at all.', 'upheld', 'The fee demand is documented.',
        now() - interval '50 days', now() - interval '43 days', now() - interval '40 days')
returning id as ap_60 \gset
select private.apply_retention();
select is((select count(*) from public.appeals where id = :ap_60), 1::bigint,
  'with a 30-day period, an appeal decided 40 days ago on a decision of 60 days ago is kept');
select is(
  (select jsonb_build_object('can', e -> 'can_appeal', 'status', e ->> 'appeal_status') from jsonb_array_elements(pg_temp.mine(:'own1', :act_60)) e),
  jsonb_build_object('can', false, 'status', 'upheld'), 'and the decision cannot be appealed a second time'
);

select * from finish();
rollback;
