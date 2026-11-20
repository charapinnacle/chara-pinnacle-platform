begin;
select plan(26);

\ir apply_fixture.inc

-- Direct-hiring rules in direct applications (V72; FR-Q5 AC5, AC6, AC9; DATA_MODEL.md section 4, apply_to_job risky):
-- apply_to_job refuses a candidate whose current country is blocked for the vacancy's country, carries the rule and its
-- notice otherwise, and does so only while release_job_orders or release_find_workers is on. Acme (t.a) is in DE; wa is
-- from NG and wb from PH (apply_fixture); wnp is from NP and wae from AE.

\set wnp '00000000-0000-0000-0000-0000000f7201'
\set wae '00000000-0000-0000-0000-0000000f7202'

update private.settings set value = 'false' where key in ('release_job_orders', 'release_find_workers');
select pg_temp.new_user(:'wnp', 'worker');
select pg_temp.new_user(:'wae', 'worker');
update public.profiles set account_kind = 'worker' where id in (:'wnp', :'wae');
select pg_temp.call_as(:'wnp', 'authenticated', $$select public.create_worker_passport('Nima', 'Rai', 'NP', 'en')$$, 'aal1') as setup_np \gset
select pg_temp.call_as(:'wae', 'authenticated', $$select public.create_worker_passport('Omar', 'Haddad', 'AE', 'en')$$, 'aal1') as setup_ae \gset
update public.worker_profiles set occupation_id = '7212' where user_id in (:'wnp', :'wae');

insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref) values
  ('PH', 'DE', 'blocked', 'Direct hiring from the Philippines to Germany is not allowed.', 'LO-1'),
  ('NP', 'DE', 'licensed_partner_required', 'Hiring from Nepal to Germany needs a licensed recruitment partner.', 'LO-2');

-- apply_to_job as p_user: 'outcome|rule|notice' (null parts left out) or 'sqlstate|message|detail'.
create function pg_temp.apply_rule(p_user uuid, p_job uuid) returns text
language plpgsql as $$
declare
  v_result text;
begin
  v_result := pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.res', (select concat_ws('|', outcome, hiring_rule, hiring_notice) from public.apply_to_job(%L)), true)$f$,
    p_job), 'aal1');
  return case when v_result = 'ok' then current_setting('t.res') else v_result end;
end;
$$;

select set_config('t.general', (select value #>> '{}' from private.settings where key = 'direct_hiring_general_notice'), true);

-- Shape -----------------------------------------------------------------------------------------------------------------

select is(
  replace(pg_get_function_result('public.apply_to_job(uuid, text, uuid[])'::regprocedure), 'public.', ''),
  'TABLE(application_id uuid, outcome text, hiring_rule direct_hiring_rule_value, hiring_notice text)',
  'apply_to_job answers the rule and its notice beside the application and the outcome'
);
select ok(
  has_function_privilege('authenticated', 'public.apply_to_job(uuid, text, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.apply_to_job(uuid, text, uuid[])', 'execute')
  and not has_function_privilege('service_role', 'public.apply_to_job(uuid, text, uuid[])', 'execute'),
  'the grants of apply_to_job are unchanged: signed-in users only'
);
select ok(
  not has_function_privilege('authenticated', 'private.direct_hiring_rule_for(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'private.direct_hiring_rule_for(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.assert_direct_hiring_allowed(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.direct_hiring_enforced()', 'execute')
  and not has_function_privilege('authenticated', 'private.org_licensed_for(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.destination_needs_licence(uuid, text)', 'execute'),
  'the enforcing helpers are for the database functions only'
);

-- Gate off: nothing is refused and no rule is answered -------------------------------------------------------------------

select set_config('t.j_off', pg_temp.open_job('Welder before go-live')::text, true);
select is(pg_temp.apply_rule(:'wb', current_setting('t.j_off')::uuid), 'created',
  'gate off: a PH candidate applies to a DE vacancy and no rule is answered');

-- Gate on (release_find_workers) ------------------------------------------------------------------------------------------

update private.settings set value = 'true' where key = 'release_find_workers';
select set_config('t.j1', pg_temp.open_job('Welder Hamburg')::text, true);
select set_config('t.before', pg_temp.counts(), true);
select is(pg_temp.apply_rule(:'wb', current_setting('t.j1')::uuid), '42501|CHARA_FORBIDDEN|direct_hiring_blocked',
  'AC6: the PH candidate is refused for the DE vacancy');
select is(pg_temp.counts(), current_setting('t.before'), 'AC6: the refusal writes no application, share, consent, event, audit row or notice');
select is(
  (select count(*)::integer from public.job_applications where job_id = current_setting('t.j1')::uuid and worker_user_id = :'wb'),
  0, 'AC6: no application row exists for the PH candidate'
);
select is(pg_temp.apply_rule(:'wnp', current_setting('t.j1')::uuid),
  'created|licensed_partner_required|Hiring from Nepal to Germany needs a licensed recruitment partner.',
  'AC6: the NP candidate applies and the answer carries the partner-required notice');
select is(pg_temp.apply_rule(:'wa', current_setting('t.j1')::uuid),
  'created|allowed|' || current_setting('t.general'),
  'AC6: the NG candidate applies with the general notice');
select is(
  (select string_agg(p.first_name, ',' order by p.first_name) from public.job_applications a
   join public.worker_profiles p on p.user_id = a.worker_user_id where a.job_id = current_setting('t.j1')::uuid),
  'Amina,Nima', 'AC6: the NP and NG applications are created'
);

-- AC9: an application made before the rule stays and is answered as existing.
select is(pg_temp.apply_rule(:'wb', current_setting('t.j_off')::uuid), 'existing',
  'AC9: the PH candidate''s earlier application is answered existing, not refused');
select is(
  (select status::text from public.job_applications where job_id = current_setting('t.j_off')::uuid and worker_user_id = :'wb'),
  'applied', 'AC9: and it stays as it was'
);

-- The rule follows the vacancy's country and the candidate's current country, never a nationality.
select set_config('t.j_ph', pg_temp.open_job('Welder Manila', null, '{"country_code": "PH"}')::text, true);
select is(pg_temp.apply_rule(:'wb', current_setting('t.j_ph')::uuid), 'created|allowed|' || current_setting('t.general'),
  'hiring within one country gets the default: the PH candidate applies to a PH vacancy');
select set_config('t.j_pl', pg_temp.open_job('Welder Gdansk', null, '{"country_code": "PL"}')::text, true);
select is(pg_temp.apply_rule(:'wb', current_setting('t.j_pl')::uuid), 'created|allowed|' || current_setting('t.general'),
  'a pair without a rule gets the default: PH to PL');
select set_config('t.j2', pg_temp.open_job('Welder Bremen')::text, true);
select is(pg_temp.apply_rule(:'wae', current_setting('t.j2')::uuid), 'created|allowed|' || current_setting('t.general'),
  'AC5: an AE candidate applies to a DE vacancy');
update public.worker_profiles set current_country = 'PH' where user_id = :'wae';
select set_config('t.j3', pg_temp.open_job('Welder Kiel')::text, true);
select is(pg_temp.apply_rule(:'wae', current_setting('t.j3')::uuid), '42501|CHARA_FORBIDDEN|direct_hiring_blocked',
  'AC5: after moving to PH the same candidate is refused for a new DE vacancy');
select is(
  (select count(*)::integer from public.job_applications where job_id = current_setting('t.j2')::uuid and worker_user_id = :'wae'),
  1, 'AC9: the application made before the move stays'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema in ('public', 'private') and column_name ilike '%nationality%'
  ),
  'AC5: no table holds a nationality'
);

-- A source rule with any destination, and a pair rule over it.
insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref) values
  ('NG', null, 'blocked', 'Direct hiring of workers living in Nigeria is not allowed.', 'LO-3'),
  ('NG', 'PL', 'licensed_partner_required', 'Hiring from Nigeria to Poland needs a licensed recruitment partner.', 'LO-4');
select set_config('t.j4', pg_temp.open_job('Welder Leipzig')::text, true);
select is(pg_temp.apply_rule(:'wa', current_setting('t.j4')::uuid), '42501|CHARA_FORBIDDEN|direct_hiring_blocked',
  'the rule of the source with any destination applies to a pair without its own rule');
select is(pg_temp.apply_rule(:'wa', current_setting('t.j_pl')::uuid),
  'created|licensed_partner_required|Hiring from Nigeria to Poland needs a licensed recruitment partner.',
  'the rule of the pair wins over the rule of the source');
select is(
  (select status::text from public.job_applications where job_id = current_setting('t.j1')::uuid and worker_user_id = :'wa'),
  'applied', 'AC9: the NG application made before the NG rule stays'
);

-- The gate is either switch: release_job_orders alone enforces too.
update private.settings set value = 'false' where key = 'release_find_workers';
select set_config('t.j5', pg_temp.open_job('Welder Rostock')::text, true);
select is(pg_temp.apply_rule(:'wa', current_setting('t.j5')::uuid), 'created',
  'both switches off: the NG candidate applies to a DE vacancy without a rule answered');
update private.settings set value = 'true' where key = 'release_job_orders';
select set_config('t.j6', pg_temp.open_job('Welder Lübeck')::text, true);
select is(pg_temp.apply_rule(:'wa', current_setting('t.j6')::uuid), '42501|CHARA_FORBIDDEN|direct_hiring_blocked',
  'release_job_orders on: the rule is enforced');

-- The order of the refusals: a vacancy that is not open, and an incomplete passport, come first.
select set_config('t.j7', pg_temp.seed_job('{"title": "Draft welder", "status": "draft"}')::text, true);
select is(pg_temp.apply_rule(:'wb', current_setting('t.j7')::uuid), 'P0001|CHARA_JOB_NOT_OPEN|',
  'a vacancy that is not open is refused as before, whatever the rule');
update public.worker_profiles set occupation_id = null where user_id = :'wb';
select is(pg_temp.apply_rule(:'wb', current_setting('t.j6')::uuid), 'P0001|CHARA_PROFILE_INCOMPLETE|occupation_id',
  'an incomplete passport is named before the rule');
update public.worker_profiles set occupation_id = '7212' where user_id = :'wb';

-- An application the candidate withdrew and makes again reads the rule of today.
select id as earlier from public.job_applications where job_id = current_setting('t.j_off')::uuid and worker_user_id = :'wb' \gset
select pg_temp.force_status(:'earlier', 'withdrawn');
select is(pg_temp.apply_rule(:'wb', current_setting('t.j_off')::uuid), '42501|CHARA_FORBIDDEN|direct_hiring_blocked',
  'AC9: a new application after a withdrawal is a new action and reads the rule');

select * from finish();
rollback;
