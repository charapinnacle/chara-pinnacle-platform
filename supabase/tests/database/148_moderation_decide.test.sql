begin;
select plan(183);

\ir status_fixture.inc

-- V27: moderation decisions (FR-S1 steps Decide, Inform and Effect, AC4, AC5, AC7, AC8, AC11; FR-J3 AC9, AC10; NFR-C7,
-- NFR-O5; decisions 2.7, 6.4, 7.2; DATA_MODEL 11.13): moderation_decide with its statement of reasons, the hide and unhide
-- of a partner profile, the suspension cascade to the partner profile, its listings, the directories, the company page,
-- the sitemaps, the follower digest and connection_target, the moderation_decision notice, the decision target and the
-- staff read of every listing.

\set pow '00000000-0000-0000-0000-0000000f2701'
\set padm '00000000-0000-0000-0000-0000000f2702'
\set pmem '00000000-0000-0000-0000-0000000f2703'
\set gow '00000000-0000-0000-0000-0000000f2704'
\set rep '00000000-0000-0000-0000-0000000f2705'
\set trust_b '00000000-0000-0000-0000-0000000f2706'
\set gone_trust '00000000-0000-0000-0000-0000000f2707'
\set fan '00000000-0000-0000-0000-0000000f2708'
\set downer '00000000-0000-0000-0000-0000000f2709'
select pg_temp.new_user(:'pow', 'company', 'maria.santos@alpha-recruit.example');
select pg_temp.new_user(:'padm');
select pg_temp.new_user(:'pmem');
select pg_temp.new_user(:'gow');
select pg_temp.new_user(:'rep', 'worker', 'rosa.worker@example.test');
select pg_temp.new_user(:'trust_b');
select pg_temp.new_user(:'gone_trust');
select pg_temp.new_user(:'fan', 'worker');
select pg_temp.new_user(:'downer');
update public.profiles set account_kind = intended_account_kind
where id in (:'pow', :'padm', :'pmem', :'gow', :'rep', :'trust_b', :'gone_trust', :'fan', :'downer');
insert into public.platform_staff (user_id, role) values (:'trust_b', 'trust_safety');
insert into public.platform_staff (user_id, role, revoked_at) values (:'gone_trust', 'trust_safety', now());

create temp sequence key_seq;
create function pg_temp.nextkey() returns text language sql as $$ select encode(sha256(('v27-' || nextval('pg_temp.key_seq'))::bytea), 'hex') $$;

-- A listed partner with an owner, serving DE from PH with occupation 7212.
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
  insert into public.organization_geographies (organization_id, scope, country_code)
  values (v_id, 'serves_market', 'DE'), (v_id, 'sources_from', 'PH');
  insert into public.organization_occupations (organization_id, occupation_id) values (v_id, '7212');
  return v_id;
end;
$$;

create function pg_temp.listing(p_org uuid, p_confirmed_days integer) returns uuid
language sql as $$
  insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
    available_from, confirmed_at)
  values (p_org, '7212', 'PH', 120, 40, current_date, now() - make_interval(days => p_confirmed_days))
  on conflict (organization_id, occupation_id, source_country) do update set confirmed_at = excluded.confirmed_at
  returning id
$$;

create function pg_temp.seed_report(p_type text, p_category text default 'misleading_or_fraud', p_org uuid default null,
  p_job uuid default null, p_path text default null, p_reporter uuid default null) returns bigint
language sql as $$
  insert into public.reports (target_type, job_id, organization_id, content_path, category, details, good_faith_confirmed,
    reporter_user_id)
  values (p_type::public.report_target_type, p_job, p_org, p_path, p_category::public.report_category,
          'Seeded text of the report, long enough.', true, p_reporter)
  returning id
$$;

-- moderation_decide as p_user at p_aal: 'ok' (with the result in t.action and t.status) or 'sqlstate|message|detail'.
create function pg_temp.decide(p_user uuid, p_decision text, p_reasons text, p_report bigint default null,
  p_target_type text default null, p_target uuid default null, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(
    p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format($f$select set_config('t.action', coalesce(d.moderation_action_id::text, ''), true),
                     set_config('t.status', coalesce(d.report_status::text, ''), true)
              from public.moderation_decide(%L, %L, %s, %L, %L) d$f$,
           p_decision, p_reasons, coalesce(p_report::text, 'null'), p_target_type, p_target),
    p_aal)
$$;

-- Everything a decision writes, to compare before and after a refused call.
create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.moderation_actions) || ',' || (select count(*) from audit.log) || ','
      || (select count(*) from pgmq.q_notifications) || ',' || (select count(*) from pgmq.q_account_ops) || ','
      || (select string_agg(id || ':' || status, ',' order by id) from public.reports) || ','
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

create function pg_temp.run(p_user uuid, p_sql text, p_aal text default 'aal1') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    p_aal)
$$;

create function pg_temp.result() returns jsonb language sql as $$ select current_setting('t.result')::jsonb $$;

create function pg_temp.slugs_of(p_user uuid, p_sql text) returns text
language plpgsql as $$
declare
  v text;
begin
  delete from private.rate_limit_hits;
  perform set_config('t.result', '[]', true);
  v := pg_temp.run(p_user, p_sql);
  if v <> 'ok' then return v; end if;
  return (select coalesce(string_agg(e ->> 'slug', ',' order by e ->> 'slug'), '') from jsonb_array_elements(pg_temp.result()) e);
end;
$$;

-- Partners of earlier test data must not change the searches below.
update public.organizations set moderation_state = 'hidden' where type <> 'employer';
update private.settings set value = 'true' where key = 'release_partner_directories';

select pg_temp.partner(:'pow', 'recruitment_company', 'alpha-recruit') as alpha \gset
select pg_temp.partner(:'gow', 'staffing_company', 'gamma-staffing') as gamma \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (:'alpha', :'padm', 'admin', now()), (:'alpha', :'pmem', 'member', now());
select pg_temp.listing(:'alpha', 2) as alpha_fresh \gset
select pg_temp.listing(:'gamma', 1) as gamma_fresh \gset
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity, available_from, confirmed_at)
values (:'gamma', '7212', 'PH', 5, 5, current_date, now()) on conflict do nothing;
insert into public.organization_geographies (organization_id, scope, country_code) values (:'gamma', 'sources_from', 'NP');
insert into public.organization_occupations (organization_id, occupation_id) values (:'gamma', '7214');
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity, available_from, confirmed_at)
values (:'gamma', '7214', 'NP', 30, 10, current_date, now() - interval '200 days');

-- Delta: an employer whose company page is on, with an open vacancy and a follower.
select pg_temp.org_on('employer_professional') as delta \gset
update public.organizations set public_page_enabled = true, slug = 'delta-bau' where id = :'delta';
select pg_temp.open_job('Delta welder', :'delta') as delta_job \gset
insert into public.follows (user_id, organization_id) values (:'fan', :'delta');
insert into private.follow_activity_outbox (organization_id, entity_type, entity_id, title, created_at)
values (:'delta', 'vacancy', :'delta_job', 'Delta welder', now() - interval '1 hour');
update public.follows set created_at = now() - interval '2 hours' where user_id = :'fan';
-- Acme (t.a) searches available workforce on a paid plan.
insert into billing.subscriptions (organization_id, plan_code, status, provider)
select current_setting('t.a')::uuid, 'employer_professional', 'active', 'null'
where not exists (select 1 from billing.subscriptions s where s.organization_id = current_setting('t.a')::uuid);
select pg_temp.open_job('Acme report vacancy') as acme_job \gset

-- Structure and privileges ----------------------------------------------------------------------------------------------

select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
   where oid = 'public.moderation_decide(text, text, bigint, text, uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'public.moderation_decide(text, text, bigint, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.moderation_decide(text, text, bigint, text, uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.moderation_decide(text, text, bigint, text, uuid)', 'execute'),
  'moderation_decide is a definer function with an empty search_path for signed-in callers only'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_get_partner_moderation(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_get_partner_moderation(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.partner_profile_moderation(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.partner_profile_moderation(uuid)', 'execute')
  and (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
       where oid in ('public.admin_get_partner_moderation(uuid)'::regprocedure, 'public.partner_profile_moderation(uuid)'::regprocedure)),
  'the staff read and the partner read are definer functions for signed-in callers only'
);
select ok(
  not has_function_privilege('authenticated', 'private.set_partner_profile_moderation(uuid, boolean, text, bigint, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'private.suspend_organization_with(uuid, text, bigint)', 'execute')
  and not has_function_privilege('authenticated', 'private.reinstate_organization_with(uuid, text, bigint)', 'execute')
  and not has_function_privilege('authenticated', 'private.set_job_moderation(uuid, boolean, text, bigint)', 'execute')
  and not has_function_privilege('authenticated', 'private.record_moderation(text, uuid, text, text, text, bigint)', 'execute'),
  'the private bodies of the decisions are not callable through the API'
);
select is(
  (select count(*) from pg_proc where proname = 'record_moderation' and pronamespace = 'private'::regnamespace), 1::bigint,
  'private.record_moderation has one signature, the earlier one is gone'
);
select col_type_is('public', 'moderation_actions', 'report_id', 'bigint', 'moderation_actions.report_id names the report a decision closed');
select is(
  (select count(*) from pg_constraint where conrelid = 'public.moderation_actions'::regclass and contype = 'f'), 0::bigint,
  'moderation_actions has no foreign key: retention deletes closed reports, the decision stays'
);
select throws_ok(
  $$insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons) values ('partner_profile', gen_random_uuid(), 'job_hidden', 'Ten chars at least.')$$,
  '23514', null, 'a partner profile takes only content_hidden and content_unhidden'
);
select ok(
  (select pg_get_constraintdef(oid) ~ 'partner_profile.*content_hidden.*partner_profile.*content_unhidden' from pg_constraint
   where conname = 'moderation_actions_target_action_check'),
  'the pairs (partner_profile, content_hidden) and (partner_profile, content_unhidden) are accepted'
);
select is(
  (select format('%s|%s|%s|%s', mandatory, default_email, audience, label) from private.notification_kinds where kind = 'moderation_decision'),
  't|t|all|Moderation decisions', 'AC8: moderation_decision is a mandatory kind for every account'
);
select is(
  (select format('%s:%s:%s:%s', s.value #>> '{}', r.value_type, r.min, r.max) from private.settings s
   join private.setting_rules r on r.key = s.key where s.key = 'report_decision_target_days'),
  '7:integer:1:90', 'decision 7.2, NFR-O5: the seven-day decision target is a setting of the settings editor'
);

-- The decision target ----------------------------------------------------------------------------------------------------

select pg_temp.seed_report('content', p_path => '/en/target-a') as target_a \gset
select is(
  (select decision_due_at - created_at from public.reports where id = :target_a), interval '7 days',
  'decision 7.2: a report is due for a decision seven days after it was stored'
);
update private.settings set value = '10' where key = 'report_decision_target_days';
select pg_temp.seed_report('content', p_path => '/en/target-b') as target_b \gset
select is(
  (select format('%s|%s', (select decision_due_at - created_at from public.reports where id = :target_a),
                          (select decision_due_at - created_at from public.reports where id = :target_b))),
  '7 days|10 days', 'a changed target applies to the reports stored after it'
);
update private.settings set value = '7' where key = 'report_decision_target_days';
select pg_temp.run(:'st_admin', format('select decision_due_at from public.admin_get_report(%s)', :target_a), 'aal2') as due_read \gset
select is(
  (pg_temp.result() -> 0 ->> 'decision_due_at')::timestamptz, (select decision_due_at from public.reports where id = :target_a),
  'admin_get_report shows the decision target'
);

-- AC5: only Trust & Safety at aal2 decide ---------------------------------------------------------------------------------

select pg_temp.seed_report('partner_profile', 'misleading_or_fraud', :'alpha', p_reporter => :'rep') as rep_alpha \gset
select pg_temp.writes() as before_roles \gset
select is(pg_temp.decide(:'st_admin', 'hide', 'Hidden for misleading claims.', :rep_alpha), 'P0001|CHARA_FORBIDDEN|',
  'AC5: a Platform Administrator cannot decide');
select is(pg_temp.decide(:'st_review', 'hide', 'Hidden for misleading claims.', :rep_alpha), 'P0001|CHARA_FORBIDDEN|',
  'AC5, FR-J3 AC9: a Verification Reviewer cannot decide');
select is(pg_temp.decide(:'st_trust', 'hide', 'Hidden for misleading claims.', :rep_alpha, p_aal => 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'AC5: Trust & Safety at aal1 is sent to two-step verification');
select is(pg_temp.decide(:'gone_trust', 'hide', 'Hidden for misleading claims.', :rep_alpha), 'P0001|CHARA_FORBIDDEN|',
  'AC5: a revoked Trust & Safety role cannot decide');
select is(pg_temp.decide(:'pow', 'unhide', 'Unhide our own profile now.', null, 'partner_profile', :'alpha'), 'P0001|CHARA_FORBIDDEN|',
  'AC5: the owner of the partner cannot decide');
select is(pg_temp.decide(:'rep', 'hide', 'Hidden for misleading claims.', :rep_alpha), 'P0001|CHARA_FORBIDDEN|',
  'AC5: a worker cannot decide');
select ok(pg_temp.decide(null, 'hide', 'Hidden for misleading claims.', :rep_alpha) like '42501|%',
  'AC5: an anonymous caller has no EXECUTE');
select is(
  pg_temp.call_as(:'pow', 'authenticated', format('update public.organizations set moderation_state = %L where id = %L', 'visible', :'alpha')),
  '42501|permission denied for table organizations|', 'AC5: the owner cannot update the moderation state directly'
);
select is(pg_temp.writes(), :'before_roles', 'AC5: nothing was changed or written by the refused calls');
select is(
  pg_temp.run(:'st_admin', 'select id from public.admin_list_reports()', 'aal2'), 'ok',
  'AC5: the Platform Administrator still reads the queue'
);
select is(
  pg_temp.run(:'pow', format('select * from public.admin_get_partner_moderation(%L)', :'alpha'), 'aal2'), 'P0001|CHARA_FORBIDDEN|',
  'the staff read is refused to the partner'
);

-- AC4: the statement of reasons --------------------------------------------------------------------------------------------

select is(pg_temp.decide(:'st_trust', 'hide', null, :rep_alpha), 'P0001|CHARA_INVALID_INPUT|reason', 'AC4: no reasons are refused');
select is(pg_temp.decide(:'st_trust', 'hide', '', :rep_alpha), 'P0001|CHARA_INVALID_INPUT|reason', 'AC4: empty reasons are refused');
select is(pg_temp.decide(:'st_trust', 'hide', repeat(' ', 9), :rep_alpha), 'P0001|CHARA_INVALID_INPUT|reason', 'AC4: nine spaces are refused');
select is(pg_temp.decide(:'st_trust', 'hide', 'Nine char', :rep_alpha), 'P0001|CHARA_INVALID_INPUT|reason', 'AC4, FR-J3 AC9: nine characters are refused');
select is(pg_temp.decide(:'st_trust', 'hide', repeat('x', 2001), :rep_alpha), 'P0001|CHARA_INVALID_INPUT|reason', 'AC4: 2,001 characters are refused');
select is(pg_temp.writes(), :'before_roles', 'AC4: the item, the organisation and the report are unchanged and nothing is written');

-- Choices that do not fit the target ---------------------------------------------------------------------------------------

select is(pg_temp.decide(:'st_trust', 'delete', 'Delete this profile now.', :rep_alpha), 'P0001|CHARA_INVALID_INPUT|decision', 'an unknown decision is refused');
select is(pg_temp.decide(:'st_trust', 'unhide', 'Unhide with a report?', :rep_alpha), 'P0001|CHARA_INVALID_INPUT|decision', 'a report is not closed by an unhide');
select is(pg_temp.decide(:'st_trust', 'hide', 'Hide another target.', :rep_alpha, 'job', :'acme_job'), 'P0001|CHARA_INVALID_INPUT|target', 'a report names its own target');
select is(pg_temp.decide(:'st_trust', 'hide', 'Hide the page itself.', :target_a), 'P0001|CHARA_INVALID_INPUT|decision', 'a report about a page can only be dismissed');
select is(pg_temp.decide(:'st_trust', 'dismiss', 'Dismiss without a report.', null, 'partner_profile', :'alpha'), 'P0001|CHARA_INVALID_INPUT|decision', 'a dismissal needs a report');
select is(pg_temp.decide(:'st_trust', 'hide', 'Hide without a target.'), 'P0001|CHARA_INVALID_INPUT|target', 'own finding: a target is required');
select is(pg_temp.decide(:'st_trust', 'hide', 'Hide an organisation?', null, 'organization', :'alpha'), 'P0001|CHARA_INVALID_INPUT|target', 'an organisation is suspended, not hidden');
select is(pg_temp.decide(:'st_trust', 'suspend_organization', 'Suspend a profile?', null, 'partner_profile', :'alpha'), 'P0001|CHARA_INVALID_INPUT|target', 'a profile is hidden, not suspended');
select is(pg_temp.decide(:'st_trust', 'hide', 'Unknown report here.', -1), 'P0002|CHARA_NOT_FOUND|', 'an unknown report is not found');
select is(pg_temp.decide(:'st_trust', 'hide', 'Unknown partner here.', null, 'partner_profile', gen_random_uuid()), 'P0002|CHARA_NOT_FOUND|', 'an unknown partner is not found');
select is(pg_temp.decide(:'st_trust', 'hide', 'An employer has no profile.', null, 'partner_profile', :'delta'), 'P0002|CHARA_NOT_FOUND|', 'an employer has no partner profile to hide');
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.decide(:'st_trust', 'hide', 'Hidden for misleading claims.', :rep_alpha), 'P0001|CHARA_FORBIDDEN|release_off',
  'a partner profile is not decided on while release 2a is off');
select is(pg_temp.decide(:'st_trust', 'dismiss', 'Nothing breaks the rules here.', :target_a), 'P0001|CHARA_FORBIDDEN|release_off',
  'no report is decided with moderation_decide while release 2a is off (the console keeps the Phase 1 moves)');
select is(pg_temp.run(:'st_admin', format('select * from public.admin_get_partner_moderation(%L)', :'alpha'), 'aal2'), 'P0002|CHARA_NOT_FOUND|',
  'the staff read of a partner is not found while release 2a is off');
update private.settings set value = 'true' where key = 'release_partner_directories';
select is(pg_temp.writes(), :'before_roles', 'the refused choices wrote nothing');

-- Nobody decides on their own organisation ----------------------------------------------------------------------------------

\set tsm '00000000-0000-0000-0000-0000000f2710'
\set tsi '00000000-0000-0000-0000-0000000f2711'
select pg_temp.new_user(:'tsm');
select pg_temp.new_user(:'tsi', 'company', 'Invited.Moderator@Example.TEST');
update public.profiles set account_kind = 'company' where id in (:'tsm', :'tsi');
insert into public.platform_staff (user_id, role) values (:'tsm', 'trust_safety'), (:'tsi', 'trust_safety');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'alpha', :'tsm', 'member', now());
insert into public.organization_invitations (organization_id, email, role, token_hash)
values (:'gamma', 'invited.moderator@example.test', 'member', repeat('b', 64));
select pg_temp.writes() as before_own \gset
select is(pg_temp.decide(:'tsm', 'unhide', 'Unhide my own company.', null, 'partner_profile', :'alpha'), 'P0001|CHARA_FORBIDDEN|own_organization',
  'a Trust & Safety member of Alpha cannot unhide its profile');
select is(pg_temp.decide(:'tsm', 'dismiss', 'Nothing wrong with my company.', :rep_alpha), 'P0001|CHARA_FORBIDDEN|own_organization',
  'nor dismiss a report about it');
select is(pg_temp.decide(:'tsm', 'reinstate_organization', 'Reinstate my own company.', null, 'organization', :'alpha'), 'P0001|CHARA_FORBIDDEN|own_organization',
  'nor reinstate it');
select is(pg_temp.decide(:'tsi', 'suspend_organization', 'Suspend the company that invited me.', null, 'organization', :'gamma'), 'P0001|CHARA_FORBIDDEN|own_organization',
  'a Trust & Safety user with an open invitation to Gamma (address in another case) cannot decide on it');
select is(pg_temp.writes(), :'before_own', 'the refused own-organisation decisions wrote nothing');
select is(
  (select count(*) from pg_proc where proname = 'admin_decide_partner' and prosrc ~ 'private\.is_own_organization\(v_uid, p_org\)'
     and prosrc !~ 'organization_identifier_links'),
  1::bigint, 'admin_decide_partner reads the same own-organisation condition'
);
delete from public.organization_invitations where organization_id = :'gamma';

-- AC4, AC8: a hide with ten characters ---------------------------------------------------------------------------------------

update public.notification_preferences set email_kinds = '{"moderation_decision": false}' where user_id = :'padm';
insert into public.notification_preferences (user_id, email_kinds) values (:'padm', '{"moderation_decision": false}') on conflict (user_id) do nothing;
select coalesce(max(id), 0) as audit_base from audit.log \gset
select is(char_length('Misleading'), 10, 'the boundary statement has exactly ten characters');
select is(pg_temp.decide(:'st_trust', 'hide', 'Misleading', :rep_alpha), 'ok', 'AC4: ten characters are accepted');
select is(current_setting('t.status'), 'actioned', 'the answer says the report is actioned');
select is(
  (select format('%s|%s|%s|%s|%s|%s', target_type, target_id, action, statement_of_reasons, actor_id, report_id)
   from public.moderation_actions where id = current_setting('t.action')::bigint),
  format('partner_profile|%s|content_hidden|Misleading|%s|%s', :'alpha', :'st_trust', :rep_alpha),
  'AC4: one moderation_actions row (partner_profile, content_hidden) with the reasons, the actor and the report'
);
select is((select moderation_state::text from public.organizations where id = :'alpha'), 'hidden', 'the partner profile is hidden');
select is(
  (select string_agg(format('%s|%s|%s|%s', action, entity_type, metadata ->> 'reason', metadata ->> 'report_id'), ';' order by id)
   from audit.log where id > :audit_base and action = 'partner_profile.hide'),
  format('partner_profile.hide|partner_profile|Misleading|%s', :rep_alpha),
  'AC4: the decision is audited with the reasons and the report id in the metadata'
);
select is(
  (select format('%s|%s|%s|%s|%s', metadata ->> 'from', metadata ->> 'to', metadata ->> 'decision', metadata ->> 'reason',
                 metadata ->> 'moderation_action_id' = current_setting('t.action'))
   from audit.log where id > :audit_base and action = 'report.actioned' and entity_id = :rep_alpha::text),
  'new|actioned|hide|Misleading|t', 'the closing of the report is audited with the decision'
);
select is(
  (select format('%s|%s|%s|%s', status, handled_by, handled_at is not null, resolution_note) from public.reports where id = :rep_alpha),
  format('actioned|%s|t|Misleading', :'st_trust'), 'AC4, FR-J3 AC9: the report is actioned with the reasons as its note'
);
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.get_partner_profile('alpha-recruit', p_key => repeat('b', 64))$$, 'aal1'),
  'P0002|CHARA_NOT_FOUND|', 'the hidden profile is not found by the public'
);
select is(pg_temp.run(:'own1', format('select id from public.workforce_availability where organization_id = %L', :'alpha')), 'ok', 'the listings of the hidden partner are read');
select is(jsonb_array_length(pg_temp.result()), 0, 'its listings leave with the hidden profile (private.public_partner_ids)');
select is(
  (select string_agg(n.user_id::text, ',' order by n.user_id) from public.notifications n where n.kind = 'moderation_decision'
   and n.payload ->> 'target_id' = :'alpha'),
  (select string_agg(u, ',' order by u) from unnest(array[:'pow', :'padm']) u),
  'AC8: one moderation_decision per owner and admin of the partner, none for the member'
);
select is(
  (select format('%s|%s|%s', n.mandatory, n.status, n.email_status is null) from public.notifications n
   where n.kind = 'moderation_decision' and n.user_id = :'padm'),
  't|queued|t', 'AC8: mandatory and queued; the admin''s preference does not stop it'
);
select is(
  (select n.payload from public.notifications n where n.kind = 'moderation_decision' and n.user_id = :'pow'),
  jsonb_build_object('target_type', 'partner_profile', 'target_id', :'alpha', 'title', 'Alpha Recruit', 'org_slug', 'alpha-recruit',
    'decision', 'hide', 'reasons', 'Misleading', 'moderation_action_id', current_setting('t.action')::bigint),
  'AC8: the payload holds the target, its title, the decision, the reasons and the decision id only'
);
select is(
  (select n.payload from public.notifications n where n.kind = 'moderation_decision' and n.user_id = :'rep'),
  jsonb_build_object('reference', private.report_reference(:rep_alpha), 'outcome', 'actioned'),
  'step Inform, FR-J3 AC10: the reporter is told the outcome by reference, never the reasons or the reported party'
);
select is(
  pg_temp.run(:'rep', 'select status, resolution_note from public.list_my_reports()'), 'ok', 'the reporter lists their reports'
);
select is(
  (select e ->> 'status' || '|' || (e ->> 'resolution_note') from jsonb_array_elements(pg_temp.result()) e limit 1),
  'actioned|Misleading', 'AC8: the signed-in reporter sees the outcome and the note in list_my_reports'
);

-- AC11: the second decision on the same report ------------------------------------------------------------------------------

select pg_temp.writes() as before_race \gset
select is(pg_temp.decide(:'trust_b', 'dismiss', 'Nothing to act on here.', :rep_alpha), 'P0001|CHARA_INVALID_STATE|actioned',
  'AC11: a second decision on the report is refused with the status it now has');
select is(pg_temp.writes(), :'before_race', 'AC11: the refused decision wrote nothing');
select is((select count(*) from public.moderation_actions where report_id = :rep_alpha), 1::bigint, 'AC11: one moderation_actions row for the report');
select is(pg_temp.decide(:'trust_b', 'hide', 'Hide it once more.', null, 'partner_profile', :'alpha'), 'P0001|CHARA_INVALID_STATE|hidden',
  'a hidden profile is not hidden twice');

-- AC11: two decisions at the same moment, from two sessions. The other session commits a report, holds its row as a
-- decision in progress would, and then closes it; the decision of this session waits for the lock and then finds the
-- report closed. The report is removed again at the end, as it was committed outside this transaction.
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('other',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
-- A run that stopped midway leaves its committed reports behind; they go first.
select extensions.dblink_exec('other', $$delete from public.reports where content_path like '/en/v27-raced%'$$);
select id as raced from extensions.dblink('other',
  $$insert into public.reports (target_type, content_path, category, details, good_faith_confirmed)
    values ('content', '/en/v27-raced', 'other', 'Two staff members decide on this report at once.', true) returning id$$) as t (id bigint) \gset
select extensions.dblink_exec('other', 'begin');
select is(
  (select l from extensions.dblink('other', format('select status::text from public.reports where id = %s for no key update', :raced)) as t (l text)),
  'new', 'AC11: the other session holds the report while it decides'
);
set local lock_timeout = '300ms';
select is(split_part(pg_temp.decide(:'trust_b', 'dismiss', 'Nothing to act on in this page.', :raced), '|', 1), '55P03',
  'AC11: the second decision waits for the first');
reset lock_timeout;
select extensions.dblink_exec('other', format(
  $$update public.reports set status = 'dismissed', handled_by = %L, handled_at = now(), resolution_note = 'Closed by the first decider.' where id = %s$$,
  :'st_trust', :raced));
select extensions.dblink_exec('other', 'commit');
select is(pg_temp.decide(:'trust_b', 'dismiss', 'Nothing to act on in this page.', :raced), 'P0001|CHARA_INVALID_STATE|dismissed',
  'AC11: once the first is committed, the second is refused with the status the report now has');
select is(
  (select count(*) from audit.log where action like 'report.%' and entity_id = :raced::text), 0::bigint,
  'AC11: the refused decision wrote no audit row'
);
-- The other way round: this session dismisses while the other session's decision (an action) is in progress.
select id as raced2 from extensions.dblink('other',
  $$insert into public.reports (target_type, content_path, category, details, good_faith_confirmed)
    values ('content', '/en/v27-raced-2', 'other', 'One staff member acts while another dismisses.', true) returning id$$) as t (id bigint) \gset
select extensions.dblink_exec('other', 'begin');
select x from extensions.dblink('other', format('select 1 from public.reports where id = %s for no key update', :raced2)) as t (x integer);
set local lock_timeout = '300ms';
select is(split_part(pg_temp.decide(:'trust_b', 'dismiss', 'Nothing to act on in this page.', :raced2), '|', 1), '55P03',
  'AC11: a dismissal waits for an action in progress');
reset lock_timeout;
select extensions.dblink_exec('other', format(
  $$update public.reports set status = 'actioned', handled_by = %L, handled_at = now(), resolution_note = 'Acted on by the first decider.' where id = %s$$,
  :'st_trust', :raced2));
select extensions.dblink_exec('other', 'commit');
select is(pg_temp.decide(:'trust_b', 'dismiss', 'Nothing to act on in this page.', :raced2), 'P0001|CHARA_INVALID_STATE|actioned',
  'AC11: and is refused once the action is committed');
-- Clean-up of everything the other session committed, whatever happened above.
select extensions.dblink_exec('other', 'rollback');
select extensions.dblink_exec('other', $$delete from public.reports where content_path like '/en/v27-raced%'$$);
select extensions.dblink_disconnect('other');

-- A second report about what is already in effect -----------------------------------------------------------------------------

select current_setting('t.action') as alpha_hide \gset
select pg_temp.seed_report('partner_profile', 'misleading_or_fraud', :'alpha', p_reporter => :'fan') as rep_alpha2 \gset
select count(*) as alpha_notices from pgmq.q_notifications q where q.message ->> 'organization_id' = :'alpha' \gset
select is(pg_temp.decide(:'st_trust', 'hide', 'Same claims, already hidden.', :rep_alpha2), 'ok',
  'a second report asking to hide the hidden profile is closed');
select is(format('%s|%s', current_setting('t.status'), current_setting('t.action')), format('actioned|%s', :alpha_hide),
  'it is actioned and the answer names the decision in effect');
select is((select count(*) from public.moderation_actions where target_id = :'alpha'), 1::bigint, 'nothing is hidden twice: no second moderation action');
select is((select count(*) from pgmq.q_notifications q where q.message ->> 'organization_id' = :'alpha'), :alpha_notices::bigint,
  'the partner is not told again');
select is(
  (select format('%s|%s|%s', metadata ->> 'moderation_action_id', metadata ->> 'already_in_effect', metadata ->> 'decision')
   from audit.log where action = 'report.actioned' and entity_id = :rep_alpha2::text),
  format('%s|true|hide', :alpha_hide), 'the closing is audited with the decision in effect'
);
select is(
  (select payload ->> 'outcome' from pg_temp.notice('moderation_decision', :'fan')), 'actioned', 'the second reporter is told action was taken'
);

-- AC12 (data): the partner reads the decision ---------------------------------------------------------------------------------

select is(pg_temp.run(:'pmem', format('select * from public.partner_profile_moderation(%L)', :'alpha')), 'ok', 'a member reads the state of the profile');
select is(
  (select format('%s|%s|%s', e ->> 'moderation_state', e ->> 'reasons', (e ->> 'moderation_action_id') = current_setting('t.action'))
   from jsonb_array_elements(pg_temp.result()) e),
  'hidden|Misleading|t', 'AC12: the member sees the hidden state, the reasons and the decision an appeal names'
);
select is(pg_temp.run(:'gow', format('select * from public.partner_profile_moderation(%L)', :'alpha')), '42501|CHARA_FORBIDDEN|',
  'a competing partner does not read it');
select is(pg_temp.run(null, format('select * from public.partner_profile_moderation(%L)', :'alpha')), '42501|permission denied for function partner_profile_moderation|',
  'an anonymous caller does not read it');
select is(pg_temp.run(:'own1', format('select * from public.partner_profile_moderation(%L)', current_setting('t.a'))), '42501|CHARA_FORBIDDEN|',
  'an employer has no partner profile state');

-- Own finding: unhide ------------------------------------------------------------------------------------------------------

select is(pg_temp.decide(:'trust_b', 'unhide', 'Claims corrected by the company.', null, 'partner_profile', :'alpha'), 'ok',
  'Trust & Safety unhide a profile on their own finding');
select is(
  (select format('%s|%s|%s', action, report_id is null, actor_id) from public.moderation_actions where id = current_setting('t.action')::bigint),
  format('content_unhidden|t|%s', :'trust_b'), 'the unhide is recorded without a report'
);
select is(current_setting('t.status'), '', 'without a report the answer has no report status');
select is(
  (select n.payload ->> 'decision' from public.notifications n where n.kind = 'moderation_decision' and n.user_id = :'pow'
   order by n.msg_id desc limit 1),
  'unhide', 'the owner is told of the unhide'
);
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.get_partner_profile('alpha-recruit', p_key => repeat('c', 64))$$, 'aal1'),
  'ok', 'the profile is public again'
);
select is(
  (select pg_temp.run(:'st_trust', format('select * from public.partner_profile_moderation(%L)', :'alpha'))), '42501|CHARA_FORBIDDEN|',
  'staff are not members and read the decisions through the staff read'
);

-- Dismissal ----------------------------------------------------------------------------------------------------------------

select pg_temp.seed_report('job', 'discrimination', p_job => :'acme_job', p_reporter => :'rep') as rep_job_dismiss \gset
select count(*) as acme_queued_before from pgmq.q_notifications q
where q.message ->> 'organization_id' = current_setting('t.a') \gset
select is(pg_temp.decide(:'st_trust', 'dismiss', repeat('d', 2000), :rep_job_dismiss), 'ok', 'AC4: 2,000 characters are accepted; a report is dismissed');
select is(
  (select format('%s|%s', status, char_length(resolution_note)) from public.reports where id = :rep_job_dismiss), 'dismissed|2000',
  'the report is dismissed with the reasons as its note'
);
select is((select count(*) from public.moderation_actions where report_id = :rep_job_dismiss), 0::bigint, 'a dismissal records no moderation action');
select is(
  (select count(*) from pgmq.q_notifications q where q.message ->> 'organization_id' = current_setting('t.a')), :acme_queued_before::bigint,
  'AC8: a dismissal queues nothing to the reported party'
);
select is((select moderation_state::text from public.jobs where id = :'acme_job'), 'visible', 'the vacancy stays visible');
select is(
  (select payload ->> 'outcome' from pg_temp.notice('moderation_decision', :'rep')), 'dismissed', 'the reporter is told it was dismissed'
);

-- A vacancy hidden on a report keeps its Phase 1 notice -----------------------------------------------------------------------

select pg_temp.seed_report('job', 'illegal_content', p_job => :'acme_job') as rep_job_hide \gset
select is(pg_temp.decide(:'st_trust', 'hide', 'The vacancy asks for a fee.', :rep_job_hide), 'ok', 'a vacancy is hidden on its report');
select is(
  (select format('%s|%s|%s', target_type, action, report_id) from public.moderation_actions where id = current_setting('t.action')::bigint),
  format('job|job_hidden|%s', :rep_job_hide), 'the vacancy decision names the report'
);
select is((select moderation_state::text from public.jobs where id = :'acme_job'), 'hidden', 'the vacancy is hidden');
select is(
  (select count(*) from pgmq.q_notifications q where q.message ->> 'kind' = 'vacancy_hidden' and q.message ->> 'job_id' = :'acme_job'),
  (select count(*) from public.organization_members m where m.organization_id = current_setting('t.a')::uuid and m.role in ('owner', 'admin') and m.accepted_at is not null),
  'the owner and admins get the vacancy_hidden notice with the reasons'
);
select is(
  (select count(*) from pgmq.q_notifications q where q.message ->> 'kind' = 'moderation_decision' and q.message ->> 'organization_id' = current_setting('t.a')),
  0::bigint, 'no second notice of the same decision'
);
select is(
  (select metadata ->> 'report_id' from audit.log where action = 'job.hide' and entity_id = :'acme_job' order by id desc limit 1),
  :rep_job_hide::text, 'the job.hide audit row names the report'
);
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', format('select public.moderate_job(%L, %L, %L)', :'acme_job', 'unhide', 'Fee wording removed.')),
  'ok', 'moderate_job still unhides a vacancy with its Phase 1 checks'
);
select is(
  (select format('%s|%s', action, report_id is null) from public.moderation_actions where target_id = :'acme_job' order by id desc limit 1),
  'job_unhidden|t', 'and records it without a report'
);

-- AC7, FR-J3 AC9: the suspension of a partner -----------------------------------------------------------------------------------

select is(pg_temp.slugs_of(null, format('select slug from public.search_partners(%L, p_key => %L)', 'staffing', repeat('d', 64))),
  'gamma-staffing', 'before: Gamma is in Find staffing partners');
select is(pg_temp.slugs_of(:'own1', $$select slug from public.search_available_workforce('DE', '7212', 10, 60)$$), 'alpha-recruit,gamma-staffing',
  'before: Gamma is in the available workforce search');
select ok(public.list_sitemap_partners() @> jsonb_build_array(jsonb_build_object('slug', 'gamma-staffing')), 'before: Gamma is in the sitemap');
select is(pg_temp.run(:'own1', $$select organization_id from public.connection_target('gamma-staffing')$$), 'ok', 'before: Gamma is a connection target');
select is(jsonb_array_length(pg_temp.result()), 1, 'before: connection_target answers Gamma');
select is(pg_temp.run(:'own1', format('select id from public.workforce_availability where organization_id = %L', :'gamma')), 'ok', 'before: a signed-in user reads the listings');
select is(jsonb_array_length(pg_temp.result()), 1, 'before: the fresh listing is read, the stale one is not');
select is(pg_temp.run(:'own1', format('select country_code from public.organization_geographies where organization_id = %L', :'gamma')), 'ok', 'before: the geographies are read');
select is(jsonb_array_length(pg_temp.result()), 3, 'before: three geographies are public');
select count(*) as gamma_rows from public.workforce_availability where organization_id = :'gamma' \gset

select pg_temp.seed_report('partner_profile', 'fee_demanded_from_worker', :'gamma', p_reporter => :'rep') as rep_gamma \gset
\set reasons120 'The company asked workers to pay a placement fee of several months of wages before departure, against the commitment.'
select coalesce(max(id), 0) as audit_suspend from audit.log \gset
select is(pg_temp.decide(:'st_trust', 'suspend_organization', :'reasons120', :rep_gamma), 'ok', 'AC7, FR-J3 AC9: Trust & Safety suspend the partner on the fee-demand report');
select is(
  (select format('%s|%s', status, moderation_state) from public.organizations where id = :'gamma'), 'suspended|org_suspended',
  'AC7: Gamma is suspended and its profile leaves with it'
);
select is(
  (select format('%s|%s|%s|%s', target_type, action, statement_of_reasons = :'reasons120', report_id) from public.moderation_actions where id = current_setting('t.action')::bigint),
  format('organization|organization_suspended|t|%s', :rep_gamma), 'AC7: one moderation_actions row organization_suspended with the reasons and the report'
);
select is(
  (select string_agg(action, ',' order by id) from audit.log where id > :audit_suspend and entity_id in (:'gamma'::text, :rep_gamma::text)),
  'organization.suspend,partner_profile.org_suspend,report.actioned', 'the suspension, the profile cascade and the closing are audited'
);
select is(
  (select format('%s|%s', status, handled_by) from public.reports where id = :rep_gamma), format('actioned|%s', :'st_trust'),
  'FR-J3 AC9: the report is actioned by the decider'
);
select is(
  (select count(*) from pgmq.q_account_ops q where q.message ->> 'action' = 'sign_out_organization' and q.message ->> 'organization_id' = :'gamma'),
  1::bigint, 'step Effect: the members are signed out'
);
select is(
  (select format('%s|%s|%s', payload ->> 'reasons' = :'reasons120', payload ->> 'org_name', mandatory) from pg_temp.notice('account_suspended', :'gow')),
  't|Gamma Staffing|t', 'AC8, FR-J3 AC10: the owner gets the mandatory suspension notice with the reasons (account_suspended, DATA_MODEL section 2)'
);
select is(
  (select payload from pg_temp.notice('moderation_decision', :'rep')),
  jsonb_build_object('reference', private.report_reference(:rep_gamma), 'outcome', 'actioned'),
  'FR-J3 AC10: the reporting worker learns that action was taken and nothing about the partner''s account'
);
select ok(
  not exists (select 1 from public.notifications n where n.user_id = :'gow' and n.payload::text like '%rosa.worker%'),
  'FR-J3 AC10: no payload to the partner names the reporter'
);
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.get_partner_profile('gamma-staffing', p_key => repeat('e', 64))$$, 'aal1'),
  'P0002|CHARA_NOT_FOUND|', 'AC7, FR-J3 AC9: the partner profile returns not found'
);
select is(pg_temp.slugs_of(null, format('select slug from public.search_partners(%L, p_key => %L)', 'staffing', repeat('f', 64))),
  '', 'AC7: Gamma leaves Find staffing partners');
select is(pg_temp.slugs_of(:'own1', $$select slug from public.search_available_workforce('DE', '7212', 10, 60)$$), 'alpha-recruit',
  'AC7: Gamma''s listings leave the available workforce search');
select ok(not (public.list_sitemap_partners() @> jsonb_build_array(jsonb_build_object('slug', 'gamma-staffing'))), 'AC7: Gamma leaves the sitemap');
select is(pg_temp.run(:'own1', $$select organization_id from public.connection_target('gamma-staffing')$$), 'ok', 'connection_target answers');
select is(jsonb_array_length(pg_temp.result()), 0, 'AC7: Gamma is no connection target');
select is(pg_temp.run(:'own1', format('select id from public.workforce_availability where organization_id = %L', :'gamma')), 'ok', 'the listings are read');
select is(jsonb_array_length(pg_temp.result()), 0, 'AC7: no listing of Gamma is readable by others');
select is(pg_temp.run(:'own1', format('select country_code from public.organization_geographies where organization_id = %L', :'gamma')), 'ok', 'the geographies are read');
select is(jsonb_array_length(pg_temp.result()), 0, 'AC7: no geography of Gamma is readable by others');
select is(
  pg_temp.call_as(:'gow', 'authenticated', format('select public.add_workforce_availability(%L, %L, %L, 10, 5, current_date)', :'gamma', '7214', 'PH')),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'AC7: a member of Gamma cannot add a listing'
);
select is(
  pg_temp.call_as(:'gow', 'authenticated', format('select public.set_organization_geographies(%L, array[%L], array[%L])', :'gamma', 'PH', 'DE')),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'AC7: a member of Gamma cannot change where it serves'
);
select is((select count(*) from public.workforce_availability where organization_id = :'gamma'), :gamma_rows::bigint,
  'AC7: no row of Gamma is deleted');
select pg_temp.seed_report('partner_profile', 'fee_demanded_from_worker', :'gamma') as rep_gamma2 \gset
select count(*) as ops_before from pgmq.q_account_ops \gset
select is(pg_temp.decide(:'trust_b', 'suspend_organization', 'Another fee demand by the same company.', :rep_gamma2), 'ok',
  'a second report asking to suspend the suspended partner is closed');
select is(
  (select format('%s|%s', r.status, (select count(*) from public.moderation_actions a where a.target_id = :'gamma' and a.action = 'organization_suspended'))
   from public.reports r where r.id = :rep_gamma2),
  'actioned|1', 'it is actioned without a second suspension'
);
select is((select count(*) from pgmq.q_account_ops), :ops_before::bigint, 'the members are not signed out again');

-- Staff read of every listing (DATA_MODEL 11.13) -----------------------------------------------------------------------------------

select is(pg_temp.run(:'st_admin', format('select * from public.admin_get_partner_moderation(%L)', :'gamma'), 'aal2'), 'ok',
  'the Platform Administrator reads the partner');
select is(
  (select format('%s|%s|%s|%s', e ->> 'status', e ->> 'moderation_state', jsonb_array_length(e -> 'listings'),
     (select string_agg(l ->> 'stale', ',' order by l ->> 'confirmed_at') from jsonb_array_elements(e -> 'listings') l))
   from jsonb_array_elements(pg_temp.result()) e),
  'suspended|org_suspended|2|true,false', 'staff read the stale listing and the listings of the suspended partner'
);
select is(
  (select (e -> 'history' -> 0 ->> 'action') || '|' || (e -> 'history' -> 0 ->> 'report_id') from jsonb_array_elements(pg_temp.result()) e),
  format('organization_suspended|%s', :rep_gamma), 'the staff read lists the decisions with their report'
);
select is(pg_temp.run(:'st_trust', format('select * from public.admin_get_partner_moderation(%L)', :'gamma'), 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'the staff read needs aal2');
select is(pg_temp.run(:'st_review', format('select * from public.admin_get_partner_moderation(%L)', :'gamma'), 'aal2'), 'P0001|CHARA_FORBIDDEN|',
  'a Verification Reviewer does not read it');
select is(pg_temp.run(:'st_admin', format('select * from public.admin_get_partner_moderation(%L)', :'delta'), 'aal2'), 'P0002|CHARA_NOT_FOUND|',
  'an employer is not a partner');

-- Reinstatement ------------------------------------------------------------------------------------------------------------------

select is(pg_temp.decide(:'st_trust', 'reinstate_organization', 'The company refunded the workers.', null, 'organization', :'gamma'), 'ok',
  'Trust & Safety reinstate the partner on their own finding');
select is((select format('%s|%s', status, moderation_state) from public.organizations where id = :'gamma'), 'active|visible',
  'the profile comes back with the reinstatement');
select is(pg_temp.slugs_of(null, format('select slug from public.search_partners(%L, p_key => %L)', 'staffing', repeat('9', 64))),
  'gamma-staffing', 'Gamma is in Find staffing partners again');
select is(pg_temp.slugs_of(:'own1', $$select slug from public.search_available_workforce('DE', '7212', 10, 60)$$), 'alpha-recruit,gamma-staffing',
  'its listings are found again');
select is(
  (select payload ->> 'reasons' from pg_temp.notice('account_reinstated', :'gow')), 'The company refunded the workers.',
  'the owner is told of the reinstatement with the reasons'
);
select is(pg_temp.decide(:'st_trust', 'reinstate_organization', 'Reinstate once more.', null, 'organization', :'gamma'), 'P0001|CHARA_INVALID_STATE|active',
  'an active organisation is not reinstated');

-- A profile hidden by its own decision stays hidden ------------------------------------------------------------------------------

select is(pg_temp.decide(:'st_trust', 'hide', 'Hidden before the suspension.', null, 'partner_profile', :'alpha'), 'ok', 'Alpha is hidden');
select is(pg_temp.decide(:'st_trust', 'suspend_organization', 'Suspended after the hide.', null, 'organization', :'alpha'), 'ok', 'then suspended');
select is((select moderation_state::text from public.organizations where id = :'alpha'), 'hidden', 'the suspension leaves a hidden profile hidden');
select is(pg_temp.decide(:'st_trust', 'reinstate_organization', 'Reinstated after the review.', null, 'organization', :'alpha'), 'ok', 'Alpha is reinstated');
select is((select format('%s|%s', status, moderation_state) from public.organizations where id = :'alpha'), 'active|hidden',
  'AC7: reinstatement makes items visible again except those hidden by their own decision');
select is(pg_temp.decide(:'st_trust', 'suspend_organization', 'Suspended once again.', null, 'organization', :'alpha'), 'ok', 'Alpha is suspended again');
select is(pg_temp.decide(:'st_trust', 'unhide', 'Unhidden while suspended.', null, 'partner_profile', :'alpha'), 'ok', 'its profile is unhidden during the suspension');
select is((select moderation_state::text from public.organizations where id = :'alpha'), 'org_suspended',
  'an unhidden profile of a suspended partner waits for the reinstatement');

-- The suspension of an employer: company page, sitemap, vacancies and follower digest ----------------------------------------------

select is(pg_temp.run(null, $$select slug from public.get_company_page('delta-bau')$$), 'ok', 'before: the company page of Delta is public');
select is(pg_temp.decide(:'st_trust', 'suspend_organization', 'Discriminatory wording in every vacancy.', null, 'organization', :'delta'), 'ok',
  'AC7: Delta is suspended');
select is(pg_temp.run(null, $$select slug from public.get_company_page('delta-bau')$$), 'P0002|CHARA_NOT_FOUND|', 'AC7: its company page is not found');
select ok(not (public.list_sitemap_companies() @> jsonb_build_array(jsonb_build_object('slug', 'delta-bau'))), 'AC7: it leaves the company sitemap');
select is((select moderation_state::text from public.jobs where id = :'delta_job'), 'org_suspended', 'AC7: its vacancy leaves the job list');
select is((select moderation_state from public.organizations where id = :'delta'), null, 'an employer has no partner profile state');
select is(private.queue_follower_digests(now()), 0, 'AC7: the follower digest stops for the suspended company');
select is(pg_temp.run(:'fan', $$select organization_id from public.connection_target('delta-bau')$$), 'ok', 'connection_target answers');
select is(jsonb_array_length(pg_temp.result()), 0, 'AC7: Delta is no connection target');
select is(pg_temp.decide(:'st_trust', 'reinstate_organization', 'Wording corrected in every vacancy.', null, 'organization', :'delta'), 'ok', 'Delta is reinstated');
select is(pg_temp.run(null, $$select slug from public.get_company_page('delta-bau')$$), 'ok', 'its company page is public again');
select is(private.queue_follower_digests(now()), 1, 'the follower digest resumes');

-- Phase 1 entry points keep their behaviour and cascade too ---------------------------------------------------------------------

select is(
  pg_temp.call_as(:'st_trust', 'authenticated', format('select public.suspend_organization(%L, %L)', :'gamma', 'Suspended from the organisation page.')),
  'ok', 'suspend_organization still suspends with its Phase 1 checks'
);
select is((select format('%s|%s', status, moderation_state) from public.organizations where id = :'gamma'), 'suspended|org_suspended',
  'and cascades to the partner profile');
select is(
  (select report_id from public.moderation_actions where target_id = :'gamma' order by id desc limit 1), null,
  'the console suspension names no report'
);
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', format('select public.suspend_organization(%L, %L)', :'gamma', 'Suspended twice in a row.')),
  'P0001|CHARA_INVALID_STATE|suspended', 'a suspended organisation is not suspended twice'
);
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', format('select public.reinstate_organization(%L, %L)', :'gamma', 'Reinstated from the page.')),
  'ok', 'reinstate_organization still reinstates'
);
select is((select moderation_state::text from public.organizations where id = :'gamma'), 'visible', 'and brings the profile back');
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', format('select public.suspend_organization(%L, %L)', :'gamma', 'short')),
  'P0001|CHARA_INVALID_INPUT|reason', 'suspend_organization still requires its statement of reasons'
);
select is(
  (select count(*) from public.moderation_actions m where not exists (
     select 1 from audit.log l where l.entity_id = m.target_id::text and l.entity_type = m.target_type
       and l.metadata ->> 'reason' = m.statement_of_reasons)),
  0::bigint, 'control audit trail: every decision has its audit row with the reasons'
);

select * from finish();
rollback;
