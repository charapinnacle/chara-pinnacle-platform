begin;
select plan(89);

\ir apply_fixture.inc

-- Worker visibility in Find Workers (V68; FR-Q1 AC1 to AC8; NFR-C4, NFR-S8, NFR-S9): the card columns of the passport,
-- public.worker_search, set_worker_visibility, set_card_sections, my_card_preview, the consent ledger, erasure and the
-- yearly confirmation. Acme (t.a: owner own1, admin adm) and Beta (t.b: owner own2) are employers of the fixture; wa
-- (Amina) and wb (Bruno) are candidates with passports, wkr a candidate without one, wnew and wsus (suspended) candidates
-- given passports below; two partners and a platform administrator are made below. search_workers is V69's: here the
-- view is read as the database owner, which is what search_workers will do.

\set pr1 '00000000-0000-0000-0000-0000000f6801'
\set pr2 '00000000-0000-0000-0000-0000000f6802'
\set p1 '00000000-0000-0000-0000-0000000f6811'
\set p2 '00000000-0000-0000-0000-0000000f6812'
\set wer '00000000-0000-0000-0000-0000000f6821'
\set c364 '00000000-0000-0000-0000-0000000f6831'
\set c365 '00000000-0000-0000-0000-0000000f6832'
\set c400 '00000000-0000-0000-0000-0000000f6833'

select pg_temp.new_user(:'pr1');
select pg_temp.new_user(:'pr2');
select pg_temp.new_user(:'wer', 'worker');
select pg_temp.new_user(:'c364', 'worker');
select pg_temp.new_user(:'c365', 'worker');
select pg_temp.new_user(:'c400', 'worker');
update public.profiles set account_kind = intended_account_kind where id in (:'pr1', :'pr2', :'wer', :'c364', :'c365', :'c400');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country) values
  (:'p1', 'recruitment_company', 'v68-partner-one', 'Partner One Ltd', 'Partner One', 'PH'),
  (:'p2', 'staffing_company', 'v68-partner-two', 'Partner Two Ltd', 'Partner Two', 'PL');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (:'p1', :'pr1', 'owner', now()), (:'p2', :'pr2', 'owner', now());
insert into public.platform_staff (user_id, role) values (:'slg', 'admin');

select pg_temp.call_as(u, 'authenticated', format($$select public.create_worker_passport(%L, 'Tester', 'PH', 'en')$$, n), 'aal1')
from (values (:'wnew'::uuid, 'Nadia'), (:'wer'::uuid, 'Erik'), (:'c364'::uuid, 'Cora'), (:'c365'::uuid, 'Cleo'), (:'c400'::uuid, 'Cyrus')) v (u, n);
insert into public.worker_profiles (user_id, first_name, last_name, current_country) values (:'wsus', 'Sven', 'Suspended', 'PL');

-- Versions 1 and 2 of the consent are published (2 is current); 3 is written but not published.
insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values
  ('worker-visibility-consent', 1, 'Worker visibility consent', 'Version one.', 'First approved version.', now() - interval '2 days'),
  ('worker-visibility-consent', 2, 'Worker visibility consent', 'Version two.', 'Second approved version.', now() - interval '1 day'),
  ('worker-visibility-consent', 3, 'Worker visibility consent', 'Version three.', 'Third version, not published.', null);

create function pg_temp.vis(p_user uuid, p_visible text, p_version text) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format('select set_config(''t.vis'', public.set_worker_visibility(%s, %s)::text, true)', p_visible, p_version), 'aal1')
$$;
create function pg_temp.vis_changed() returns text language sql as $$ select current_setting('t.vis')::jsonb ->> 'changed' $$;
create function pg_temp.grants(p_user uuid) returns text
language sql as $$
  select coalesce(string_agg(action || ':' || version, ',' order by id), '')
  from public.consents where user_id = p_user and purpose = 'worker-visibility-consent'
$$;
create function pg_temp.card(p_user uuid) returns uuid language sql as $$ select card_id from public.worker_profiles where user_id = p_user $$;
create function pg_temp.listed(p_user uuid) returns boolean
language sql as $$ select exists (select 1 from public.worker_search s where s.card_id = pg_temp.card(p_user)) $$;
create function pg_temp.audits(p_entity text, p_action text) returns text
language sql as $$
  select coalesce(string_agg(metadata::text, ' ' order by id), '') from audit.log where entity_id = p_entity and action = p_action
$$;

-- AC4: the view of the cards -------------------------------------------------------------------------------------------

select columns_are('public', 'worker_search', array[
  'card_id', 'headline', 'occupation_id', 'skills', 'years_experience', 'languages', 'availability', 'available_from',
  'current_country', 'preferred_countries', 'work_authorization_countries', 'training', 'employment_history',
  'preferred_industries', 'preferred_employment_types', 'updated_at'
], 'AC4: public.worker_search has exactly the card columns');
select is_empty(
  $$select column_name::text from information_schema.columns where table_schema = 'public' and table_name = 'worker_search'
    and column_name ~ '(user_id|first_name|last_name|name|email|phone|photo|document|date_of_birth|nationality|gender|religion)'$$,
  'AC4: no column of the view is or contains an identity, contact or document field'
);
select ok(
  not has_table_privilege('anon', 'public.worker_search', 'select') and not has_table_privilege('authenticated', 'public.worker_search', 'select')
  and not has_table_privilege('service_role', 'public.worker_search', 'select'),
  'AC4: the view is granted to no API role'
);
select is(pg_temp.state_as(:'own1', 'select count(*) from public.worker_search'), '42501', 'AC4: a company owner cannot read the view');
select is(split_part(pg_temp.call_as(null, 'anon', 'select count(*) from public.worker_search'), '|', 1), '42501', 'AC4: nor can an anonymous caller');
select is(
  (select count(*) from public.worker_profiles where card_id = user_id or card_id is null), 0::bigint,
  'AC4: card_id is set and is never the user id'
);
select ok(
  not has_column_privilege('authenticated', 'public.worker_profiles', 'card_id', 'update')
  and not has_column_privilege('authenticated', 'public.worker_profiles', 'card_show_training', 'update')
  and not has_column_privilege('authenticated', 'public.worker_profiles', 'searchable', 'update')
  and not has_column_privilege('authenticated', 'public.worker_profiles', 'visibility_reminded_at', 'update')
  and not has_column_privilege('authenticated', 'public.worker_profiles', 'updated_at', 'update'),
  'the card and visibility columns have no update grant'
);

-- AC1: off by default ---------------------------------------------------------------------------------------------------

select is((select searchable from public.worker_profiles where user_id = :'wa'), false, 'AC1: a new passport is not searchable');
select is(pg_temp.grants(:'wa'), '', 'AC1: and has no worker-visibility-consent row');
select is(pg_temp.listed(:'wa'), false, 'AC1: and is not in public.worker_search');

-- The release switch -----------------------------------------------------------------------------------------------------

select is(pg_temp.vis(:'wa', 'true', '2'), '42501|CHARA_FORBIDDEN|release_off', 'set_worker_visibility is refused while release_find_workers is off');
select is(pg_temp.call_as(:'wa', 'authenticated', 'select * from public.my_card_preview()', 'aal1'), '42501|CHARA_FORBIDDEN|release_off',
  'my_card_preview is refused while the release is off');
select is(pg_temp.call_as(:'wa', 'authenticated', 'select public.set_card_sections(true, true, true)', 'aal1'), '42501|CHARA_FORBIDDEN|release_off',
  'set_card_sections is refused while the release is off');
update private.settings set value = 'true' where key = 'release_find_workers';

-- AC2: opting in ----------------------------------------------------------------------------------------------------------

select is(pg_temp.vis(:'wa', 'true', '2'), 'ok', 'AC2: the worker opts in with the current version');
select is(pg_temp.vis_changed(), 'true', 'AC2: and the answer says it changed');
select is(pg_temp.grants(:'wa'), 'granted:2', 'AC2: one granted row of version 2');
select is((select searchable from public.worker_profiles where user_id = :'wa'), true, 'AC2: searchable is true');
select is(pg_temp.listed(:'wa'), true, 'AC2: and the card is in the view');
select is(pg_temp.vis(:'wa', 'true', '2'), 'ok', 'AC2: the repeat succeeds');
select is(pg_temp.vis_changed(), 'false', 'AC2: and changes nothing');
select is(pg_temp.grants(:'wa'), 'granted:2', 'AC2: the repeat writes no row');
select is(pg_temp.audits(:'wa', 'worker.visibility_changed'), '{"to": true, "from": false, "version": 2}',
  'AC2: one audit row worker.visibility_changed to true with version 2');
select is(pg_temp.vis(:'wb', 'true', '1'), 'P0001|CHARA_CONSENT_REQUIRED|worker-visibility-consent', 'AC2: an older version fails');
select is(pg_temp.vis(:'wb', 'true', '3'), 'P0001|CHARA_CONSENT_REQUIRED|worker-visibility-consent', 'AC2: an unpublished version fails');
select is(pg_temp.vis(:'wb', 'true', 'null'), 'P0001|CHARA_CONSENT_REQUIRED|worker-visibility-consent', 'AC2: no version fails');
select is(pg_temp.vis(:'wb', 'null', '2'), 'P0001|CHARA_INVALID_INPUT|p_visible', 'a null choice fails');
select is((select searchable from public.worker_profiles where user_id = :'wb') || ':' || pg_temp.grants(:'wb'), 'false:',
  'AC2: the refused calls leave searchable false and write no row');

-- AC3: only the worker, only through the RPC --------------------------------------------------------------------------------

select is(pg_temp.state_as(:'wa', format('update public.worker_profiles set searchable = false where user_id = %L', :'wa')), '42501',
  'AC3: a direct update of searchable is refused');
select is(pg_temp.vis(:'wb', 'true', '2'), 'ok', 'AC3: another worker opts in');
select is((select string_agg(searchable::text, ',' order by first_name) from public.worker_profiles where user_id in (:'wa', :'wb')), 'true,true',
  'AC3: and changes only the own flag');
select is(pg_temp.vis(:'own1', 'true', '2'), 'P0001|CHARA_FORBIDDEN|worker_account_required', 'AC3: a company owner is refused');
select is(pg_temp.call_as(:'slg', 'authenticated', 'select public.set_worker_visibility(false, null)', 'aal2'),
  'P0001|CHARA_FORBIDDEN|worker_account_required', 'AC3: a platform administrator at aal2 is refused');
select matches(pg_temp.call_as(null, 'anon', 'select public.set_worker_visibility(true, 2)'), '^42501\|permission denied',
  'AC3: an anonymous caller has no execute');
select is(pg_temp.vis(:'wkr', 'true', '2'), 'P0002|CHARA_NOT_FOUND|', 'a worker without a passport is answered not found');
select is((select searchable from public.worker_profiles where user_id = :'wa'), true, 'AC3: W''s flag is unchanged');
select is(
  pg_temp.call_as(:'wnew', 'authenticated', $$select public.accept_consents('[{"purpose": "worker-visibility-consent", "version": 2}]')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|worker-visibility-consent', 'the consent cannot be granted without the card (accept_consents)'
);
select is(
  pg_temp.call_as(:'wa', 'authenticated', $$select public.withdraw_consent('worker-visibility-consent')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|worker-visibility-consent', 'nor withdrawn without it (withdraw_consent)'
);

-- NFR-S8: nobody else reads the card columns of a passport -----------------------------------------------------------------

select is(
  (select string_agg(pg_temp.val_as(u, 'aal2', format('select count(*) from public.worker_profiles where user_id = %L', :'wa')), ',' order by o)
   from unnest(array[:'own1', :'own2', :'pr1', :'pr2', :'wb']::uuid[]) with ordinality x (u, o)),
  '0,0,0,0,0', 'NFR-S8: two employers, two partners and another candidate read no row of the visible passport'
);
select is(split_part(pg_temp.call_as(null, 'anon', 'select count(*) from public.worker_profiles'), '|', 1), '42501',
  'NFR-S8: an anonymous caller is refused');
select is(pg_temp.val_as(:'wa', 'aal1', 'select count(*) from public.worker_profiles where card_id is not null'), '1',
  'the owner reads the own card id');
select is(pg_temp.call_as(:'own1', 'authenticated', 'select * from public.my_card_preview()', 'aal1'),
  'P0001|CHARA_FORBIDDEN|worker_account_required', 'a company owner has no card preview');

-- AC5: the optional sections ---------------------------------------------------------------------------------------------

select is(pg_temp.state_as(:'wa', format($$insert into public.worker_training (worker_user_id, course, provider, year_completed)
  values (%1$L, 'Welding level 2', 'TÜV Nord', 2021), (%1$L, 'Forklift licence', null, 2019)$$, :'wa')), 'ok', 'AC5: two training entries');
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_employment_history (worker_user_id, role, employer_name, country_code, from_month, to_month)
  values (%1$L, 'Welder', 'Bau GmbH', 'DE', '2020-01-01', '2022-06-01'), (%1$L, 'Fitter', null, 'NG', '2018-03-01', '2019-12-01'),
         (%1$L, 'Helper', 'Lagos Steel', 'NG', '2016-01-01', '2018-02-01')$$, :'wa')), 'ok', 'AC5: three employment history entries');
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_preferred_industries (worker_user_id, industry_code) values (%1$L, 'C'), (%1$L, 'F')$$, :'wa')),
  'ok', 'AC5: two preferred industries');
select is(
  (select format('%s|%s|%s|%s', training, employment_history, preferred_industries, preferred_employment_types) from public.worker_search where card_id = pg_temp.card(:'wa')),
  '|||', 'AC5: with every section off the card shows none of them'
);
select is(pg_temp.call_as(:'wa', 'authenticated', 'select public.set_card_sections(false, true, false)', 'aal1'), 'ok',
  'AC5: the worker shows the employment history');
select is(
  (select employment_history from public.worker_search where card_id = pg_temp.card(:'wa')),
  '[{"role": "Welder", "to_month": "2022-06", "from_month": "2020-01", "country_code": "DE"}, {"role": "Fitter", "to_month": "2019-12", "from_month": "2018-03", "country_code": "NG"}, {"role": "Helper", "to_month": "2018-02", "from_month": "2016-01", "country_code": "NG"}]'::jsonb,
  'AC5: each entry holds role, country and months, newest first'
);
select is((select count(*) from public.worker_search s where s::text ~ '(Bau GmbH|Lagos Steel|Amina|Okafor)'), 0::bigint,
  'AC5, NFR-S9: no card carries an employer name or the worker''s name');
select is(
  (select format('%s|%s', training, preferred_industries) from public.worker_search where card_id = pg_temp.card(:'wa')),
  '|', 'AC5: training and industries stay hidden'
);
select is(pg_temp.audits(:'wa', 'worker.card_sections_changed'), '{"training": false, "industries": false, "employment_history": true}',
  'AC5: the choice is audited');
select is(pg_temp.call_as(:'wa', 'authenticated', 'select public.set_card_sections(true, true, true)', 'aal1'), 'ok', 'every section can be shown');
select is(
  (select format('%s|%s|%s', jsonb_array_length(training), preferred_industries, preferred_employment_types) from public.worker_search where card_id = pg_temp.card(:'wa')),
  '2|{C,F}|{}', 'the card then shows the training, the industries and the (empty) employment types'
);
select is(pg_temp.call_as(:'wa', 'authenticated', 'select public.set_card_sections(null, true, true)', 'aal1'), 'P0001|CHARA_INVALID_INPUT|sections',
  'a missing choice fails');
update public.worker_profiles set updated_at = now() - interval '3 days' where user_id = :'wa';
select is(pg_temp.state_as(:'wa', format($$insert into public.worker_skills (worker_user_id, skill) values (%L, 'TIG welding')$$, :'wa')), 'ok',
  'the worker adds a skill');
select is((select updated_at = now() from public.worker_search where card_id = pg_temp.card(:'wa')), true,
  'a change of a list stamps the card''s updated_at');

-- The preview -------------------------------------------------------------------------------------------------------------

select is(
  pg_temp.val_as(:'wa', 'aal1', $$select format('%s|%s|%s|%s|%s|%s', visible::text, opted_in::text, consent_version, current_version, (visible_since is not null)::text,
    (card_id = (select w.card_id from public.worker_profiles w where w.user_id = auth.uid()))::text) from public.my_card_preview()$$),
  'true|true|2|2|true|true', 'AC9 data: the preview is the own card with its state'
);
select is(pg_temp.val_as(:'wa', 'aal1', $$select (p::text ~ '(Amina|Okafor|Bau GmbH)')::text from public.my_card_preview() p$$), 'false',
  'NFR-S9: the preview carries no name and no employer name');

-- AC6: withdrawal ---------------------------------------------------------------------------------------------------------

select is(pg_temp.vis(:'wb', 'false', 'null'), 'ok', 'AC6: the worker withdraws');
select is(pg_temp.vis_changed(), 'true', 'AC6: and the answer says it changed');
select is(pg_temp.grants(:'wb'), 'granted:2,withdrawn:2', 'AC6: one withdrawn row with the version last granted');
select is((select searchable from public.worker_profiles where user_id = :'wb') || ':' || pg_temp.listed(:'wb'), 'false:false',
  'AC6: searchable is false and the card is gone from the view in the same transaction');
select is(pg_temp.audits(:'wb', 'worker.visibility_changed'),
  '{"to": true, "from": false, "version": 2} {"to": false, "from": true, "reason": "withdrawn", "version": 2}',
  'AC6: the withdrawal is audited');
select is(pg_temp.vis(:'wb', 'false', 'null') || ':' || pg_temp.vis_changed() || ':' || pg_temp.grants(:'wb'), 'ok:false:granted:2,withdrawn:2',
  'AC6: withdrawing again writes nothing');
select is(pg_temp.val_as(:'wb', 'aal1', 'select format(''%s|%s|%s'', visible::text, visible_since, (card_id is not null)::text) from public.my_card_preview()'),
  'false||true', 'the preview of a hidden card still shows the card');

-- AC7: suspended, closing and erased workers --------------------------------------------------------------------------------

select is(pg_temp.vis(:'wnew', 'true', '2') || pg_temp.vis(:'wer', 'true', '2'), 'okok', 'AC7: two more workers opt in');
insert into public.consents (user_id, purpose, version, action) values (:'wsus', 'worker-visibility-consent', 2, 'granted');
update public.worker_profiles set searchable = true where user_id = :'wsus';
update public.profiles set status = 'deletion_pending', deleted_at = now() where id = :'wnew';
update public.profiles set status = 'deletion_pending', deleted_at = now() - interval '400 days' where id = :'wer';
select public.erase_user(:'wer') as erased \gset
select set_config('t.pseud', (select entity_id from audit.log where action = 'account.erased' order by id desc limit 1), true) as keep \gset
select is(
  (select count(*) from public.worker_search s
   where s.card_id in (select card_id from public.worker_profiles where user_id in (:'wa', :'wsus', :'wnew', :'wer'))),
  1::bigint, 'AC7: of an active, a suspended, a closing and an erased visible worker only one is in the view'
);
select is(pg_temp.listed(:'wa'), true, 'AC7: and it is the active one');
select is(pg_temp.grants(current_setting('t.pseud')::uuid), 'granted:2,withdrawn:2', 'AC7: erasure writes the withdrawal, under the pseudonym');
select is(pg_temp.audits(current_setting('t.pseud'), 'worker.visibility_changed'),
  '{"to": true, "from": false, "version": 2} {"to": false, "from": true, "reason": "erased", "version": 2}',
  'AC7: and its audit row, under the pseudonym');
select is(pg_temp.vis(:'wnew', 'true', '2'), 'P0001|CHARA_FORBIDDEN|profile_not_active', 'a worker who asked for deletion cannot opt in again');
select is(pg_temp.vis(:'wsus', 'false', 'null') || ':' || pg_temp.grants(:'wsus'), 'ok:granted:2,withdrawn:2',
  'a suspended worker can always withdraw');

-- AC8: the yearly confirmation ----------------------------------------------------------------------------------------------

select is(pg_temp.vis(:'c364', 'true', '2') || pg_temp.vis(:'c365', 'true', '2') || pg_temp.vis(:'c400', 'true', '2'), 'okokok',
  'AC8: three workers opt in');
insert into public.consents (user_id, purpose, version, action, created_at) values
  (:'c364', 'worker-visibility-consent', 2, 'granted', now() - interval '364 days'),
  (:'c365', 'worker-visibility-consent', 2, 'granted', now() - interval '365 days'),
  (:'c400', 'worker-visibility-consent', 2, 'granted', now() - interval '400 days');
update public.worker_profiles set visibility_reminded_at = now() - interval '30 days' where user_id = :'c400';
select is(private.visibility_confirmation_run(now()), '{"hidden": 1, "reminded": 1}'::jsonb, 'AC8: the run reminds one worker and hides one');
select is(
  (select string_agg(n.user_id::text || ':' || (n.payload ->> 'respond_by')::timestamptz::text, ',') from public.notifications n
   where n.kind = 'visibility_confirmation' and n.user_id in (:'c364', :'c365', :'c400')),
  :'c365' || ':' || (now() + interval '30 days')::text, 'AC8: the 365-day worker gets one visibility_confirmation with the answer date'
);
select is((select payload - 'respond_by' from public.notifications where kind = 'visibility_confirmation' and user_id = :'c365'), '{}'::jsonb,
  'NFR-S9: the notice carries nothing else');
select is(
  (select searchable || ':' || pg_temp.grants(:'c400') from public.worker_profiles where user_id = :'c400'),
  'false:granted:2,granted:2,withdrawn:2', 'AC8: the 400-day worker reminded 30 days ago is hidden with a withdrawn row'
);
select is(pg_temp.audits(:'c400', 'worker.visibility_changed'),
  '{"to": true, "from": false, "version": 2} {"to": false, "from": true, "reason": "confirmation_expired", "version": 2}',
  'AC8: with the reason confirmation_expired');
select is(private.visibility_confirmation_run(now()), '{"hidden": 0, "reminded": 0}'::jsonb, 'AC8: a second run the same day does nothing');
select is((select count(*) from public.notifications where kind = 'visibility_confirmation' and user_id = :'c365'), 1::bigint,
  'AC8: so the reminder is not repeated');
select is(pg_temp.val_as(:'c365', 'aal1', 'select confirm_by = now() + interval ''30 days'' from public.my_card_preview()'), 'true',
  'the preview shows the date by which to confirm');
select is(pg_temp.vis(:'c365', 'true', '2') || ':' || pg_temp.vis_changed(), 'ok:true', 'AC8: the worker confirms');
select is(
  pg_temp.grants(:'c365') || ':' || (select coalesce(visibility_reminded_at::text, 'none') from public.worker_profiles where user_id = :'c365'),
  'granted:2,granted:2,granted:2:none', 'AC8: the confirmation is a new granted row and clears the reminder'
);
select is(pg_temp.audits(:'c365', 'worker.visibility_changed'),
  '{"to": true, "from": false, "version": 2} {"to": true, "from": true, "reason": "confirmed", "version": 2}',
  'AC8: and is audited as confirmed');
update private.settings set value = '366' where key = 'visibility_confirmation_days';
select is(private.visibility_confirmation_run(now() + interval '365 days'), '{"hidden": 0, "reminded": 1}'::jsonb,
  'NFR-O5: the period is a setting (366 days: only the confirmed grant of today is not due a year on)');
update private.settings set value = 'false' where key = 'release_find_workers';
select is(private.visibility_confirmation_run(now() + interval '900 days'), '{"hidden": 0, "reminded": 0}'::jsonb,
  'the job does nothing while the release is off');

-- The job, the kind and the settings ----------------------------------------------------------------------------------------

select is((select count(*) from cron.job where jobname = 'visibility-confirmation' and schedule = '35 1 * * *'
  and command = 'select private.visibility_confirmation_run()'), 1::bigint, 'AC8: a daily pg_cron job runs the confirmation');
select is(
  (select format('%s|%s|%s|%s', mandatory::text, default_email::text, audience, release_key) from private.notification_kinds where kind = 'visibility_confirmation'),
  'false|true|worker|release_find_workers', 'the kind visibility_confirmation is an optional worker kind of release 2c'
);
select is(
  (select string_agg(r.key || ':' || s.value::text || ':' || r.min || '..' || r.max, ',' order by r.key)
   from private.setting_rules r join private.settings s using (key) where r.key like 'visibility_confirmation%'),
  'visibility_confirmation_days:366:30..1095,visibility_confirmation_grace_days:30:7..90',
  'NFR-O5: both periods are settings with an audited editor range'
);
select ok(
  not has_function_privilege('authenticated', 'private.visibility_confirmation_run(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.my_card_preview()', 'execute')
  and not has_function_privilege('anon', 'public.set_card_sections(boolean, boolean, boolean)', 'execute'),
  'the job is no API function and anonymous callers execute none of the RPCs'
);

select * from finish();
rollback;
