begin;
select plan(48);

\ir applicants_fixture.inc

-- export_applicants as p_user: the json value it returns, or the refusal text 'sqlstate|message|detail'.
create function pg_temp.export_as(p_user uuid, p_job uuid, p_stage text default null) returns jsonb
language plpgsql as $$
declare
  v_result jsonb := pg_temp.json_as(p_user, format('select public.export_applicants(%L, %L::public.application_status) as r', p_job, p_stage));
begin
  return case when jsonb_typeof(v_result) = 'string' then v_result else v_result -> 0 -> 'r' end;
end;
$$;

create function pg_temp.exports_of(p_job uuid) returns text
language sql as $$ select count(*)::text from audit.log where action = 'applicants_exported' and entity_id = p_job::text $$;

-- Three organisations on the three cases of AC9, each with a vacancy and two applicants.
create temp table t_f as select pg_temp.org_on('employer_starter', 'canceled') as org;
create temp table t_p as select pg_temp.org_on('employer_starter') as org;
create temp table t_n as select pg_temp.org_on() as org;
select pg_temp.seed_job('{"title": "Lapsed vacancy", "status": "paused"}', (select org from t_f)) as jf \gset
select pg_temp.seed_job('{"title": "Paid vacancy", "status": "open"}', (select org from t_p)) as jp \gset
select pg_temp.seed_job('{"title": "Trial vacancy", "status": "open"}', (select org from t_n)) as jn \gset
select pg_temp.seed_applicant(:'jf', (select org from t_f), 'applied', '2026-09-04 10:00+00', 'Ana Silva', 80, 2),
       pg_temp.seed_applicant(:'jf', (select org from t_f), 'shortlisted', '2026-09-03 10:00+00', 'Ben Okoro', 55, 0),
       pg_temp.seed_applicant(:'jp', (select org from t_p), 'applied', '2026-09-04 10:00+00', 'Ana Silva', 80, 2),
       pg_temp.seed_applicant(:'jp', (select org from t_p), 'shortlisted', '2026-09-03 10:00+00', 'Ben Okoro', 55, 0),
       pg_temp.seed_applicant(:'jn', (select org from t_n), 'applied', '2026-09-04 10:00+00', 'Ana Silva', 80, 2),
       pg_temp.seed_applicant(:'jn', (select org from t_n), 'shortlisted', '2026-09-03 10:00+00', 'Ben Okoro', 55, 0);
select pg_temp.member_of((select org from t_f)) as mf \gset
select pg_temp.member_of((select org from t_p)) as mp \gset
select pg_temp.member_of((select org from t_n)) as mn \gset

-- AC9: with the setting false.
select is(jsonb_array_length(pg_temp.export_as(:'mp', :'jp')), 2, 'AC9: an organisation on a paid plan receives its rows (setting false)');
select is(jsonb_array_length(pg_temp.export_as(:'mn', :'jn')), 2, 'AC9: an organisation that never subscribed receives its rows (setting false)');
select is(pg_temp.export_as(:'mf', :'jf'), to_jsonb('P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan'::text), 'AC9: a lapsed organisation is refused with read_only_free_plan (setting false)');
select is(pg_temp.exports_of(:'jp') || pg_temp.exports_of(:'jn') || pg_temp.exports_of(:'jf'), '110', 'AC9: one audit row each for the two that received rows, none for the refused one');

-- AC9: with the setting true.
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(jsonb_array_length(pg_temp.export_as(:'mp', :'jp')), 2, 'AC9: the paid plan still receives its rows (setting true)');
select is(pg_temp.export_as(:'mf', :'jf'), to_jsonb('P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan'::text), 'AC9: the lapsed organisation is refused (setting true)');
select is(pg_temp.export_as(:'mn', :'jn'), to_jsonb('P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan'::text), 'AC9: the organisation that never subscribed is refused (setting true)');
select is(pg_temp.exports_of(:'jp') || pg_temp.exports_of(:'jn') || pg_temp.exports_of(:'jf'), '210', 'AC9: the refusals wrote no audit row, the paid plan one more');
delete from billing.plan_features where plan_code = 'employer_starter' and feature_key = 'csv_export';
select is(pg_temp.export_as(:'mp', :'jp'), to_jsonb('P0001|CHARA_FEATURE_NOT_IN_PLAN|csv_export'::text), 'AC9: without the csv_export row the plan refuses with detail csv_export');
select is(pg_temp.exports_of(:'jp'), '2', 'AC9: and writes no audit row');
insert into billing.plan_features (plan_code, feature_key) values ('employer_starter', 'csv_export');
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- AC8: the filtered export holds every row of the stage, newest first, with the five values of the list and nothing else.
select pg_temp.seed_job('{"title": "Big vacancy", "status": "open"}', (select org from t_p)) as jbig \gset
select pg_temp.seed_applicant(:'jbig', (select org from t_p), case when n % 5 = 0 then 'shortlisted' else 'applied' end,
  '2026-09-01 10:00+00'::timestamptz + make_interval(mins => n), 'Cand ' || n, 50 + n % 40, n % 3)
from generate_series(1, 60) n;
select is(jsonb_array_length(pg_temp.export_as(:'mp', :'jbig', 'shortlisted')), 12, 'AC8: the stage filter matches 12 of the 60 applications, all pages of it');
select is(jsonb_array_length(pg_temp.export_as(:'mp', :'jbig')), 60, 'AC8: without a filter all 60 rows, not a page of 50');
select is(
  (select array_agg(k order by k) from (select distinct jsonb_object_keys(e) k from jsonb_array_elements(pg_temp.export_as(:'mp', :'jbig')) e) x),
  array['applied_at', 'candidate_name', 'completeness', 'documents', 'status'],
  'AC8: a row holds the name, stage, date, completeness and document count only'
);
select is(
  (select e ->> 'candidate_name' from jsonb_array_elements(pg_temp.export_as(:'mp', :'jbig', 'shortlisted')) e limit 1), 'Cand 60',
  'AC8: the newest row comes first'
);
select is(
  (select bool_and(e ->> 'status' = 'shortlisted') from jsonb_array_elements(pg_temp.export_as(:'mp', :'jbig', 'shortlisted')) e), true,
  'AC8: every row of the filtered export has the stage'
);
select results_eq(
  format($$select actor_id::text, entity_type, entity_id, metadata ->> 'organization_id', metadata ->> 'stage', metadata ->> 'rows'
    from audit.log where action = 'applicants_exported' and entity_id = %L order by id desc limit 1$$, :'jbig'),
  format($$select %L, 'job', %L, %L, 'shortlisted', '12'$$, :'mp', :'jbig', (select org from t_p)),
  'AC8: the audit row names the actor, the vacancy, the organisation, the stage filter and the row count'
);
select is(
  (select count(*) from audit.log where action = 'applicants_exported' and metadata::text ~* '(cand|ana|ben)'), 0::bigint,
  'AC8: no audit row holds a candidate name'
);
select is(
  (select metadata ? 'stage' and metadata ->> 'stage' is null from audit.log where action = 'applicants_exported' and entity_id = :'jbig' and metadata ->> 'rows' = '60' limit 1),
  true, 'AC8: an export without a filter records no stage'
);

-- AC10: other organisations, other candidates, platform staff and visitors, against Ana's application to organisation A (t_p).
select pg_temp.apply_as(:'wa', :'jp') as applied \gset
select current_setting('t.app')::uuid as ana_app \gset
select pg_temp.exports_of(:'jp') as exports_before \gset
select pg_temp.event_count(:'ana_app') as events_before \gset
create function pg_temp.n_as(p_user uuid, p_sql text, p_aal text default 'aal1') returns text
language sql as $$ select pg_temp.val_as(p_user, p_aal, 'select count(*) from (' || p_sql || ') q') $$;

select is(
  pg_temp.n_as(:'mn', 'select 1 from public.job_applications where organization_id = ' || quote_literal((select org from t_p)))
    || pg_temp.n_as(:'wb', 'select 1 from public.job_applications where organization_id = ' || quote_literal((select org from t_p)))
    || pg_temp.n_as(:'st_admin', 'select 1 from public.job_applications where organization_id = ' || quote_literal((select org from t_p)), 'aal2'),
  '000', 'AC10: a member of B, another candidate and a platform administrator select no application of A'
);
select is(
  pg_temp.n_as(:'mn', 'select 1 from public.application_events e join public.job_applications a on a.id = e.application_id where a.organization_id = ' || quote_literal((select org from t_p)))
    || pg_temp.n_as(:'wb', 'select 1 from public.application_events')
    || pg_temp.n_as(:'st_admin', 'select 1 from public.application_events', 'aal2'),
  '000', 'AC10: nor an event of one'
);
select is(
  pg_temp.call_as(null, 'anon', 'select 1 from public.job_applications') || '/' || pg_temp.call_as(null, 'anon', 'select 1 from public.application_events'),
  '42501|permission denied for table job_applications|/42501|permission denied for table application_events|',
  'AC10: the anonymous selects fail with permission denied'
);
select is(pg_temp.n_as(:'wa', 'select 1 from public.job_applications'), '1', 'AC10: Ana sees only her own application');
select is(pg_temp.n_as(:'mp', 'select 1 from public.job_applications where organization_id = ' || quote_literal((select org from t_p))), '63', 'AC10: a member of A sees the 63 applications of A (2, 60 and Ana''s)');
select is(pg_temp.n_as(:'mp', 'select 1 from public.job_applications where organization_id = ' || quote_literal((select org from t_n))), '0', 'AC10: and none of B''s');
select is(pg_temp.n_as(:'mp', 'select 1 from public.application_events'), '63', 'AC10: A''s member sees A''s events');

select is(pg_temp.set_as(:'mn', :'ana_app', 'interview'), 'P0002|CHARA_NOT_FOUND|', 'AC10: a member of B cannot move an application of A');
select is(pg_temp.set_as(:'st_admin', :'ana_app', 'interview', null, 'aal2'), 'P0002|CHARA_NOT_FOUND|', 'AC10: nor a platform administrator');
select is(pg_temp.set_as(:'wb', :'ana_app', 'interview'), 'P0001|CHARA_FORBIDDEN|company_account_required', 'AC10: another candidate is refused as a candidate (FR-D2: the account kind is checked first)');
select is(pg_temp.set_as(:'wa', :'ana_app', 'interview'), 'P0001|CHARA_FORBIDDEN|company_account_required', 'AC10: Ana herself is refused');
select is(pg_temp.call_as(null, 'anon', format('select public.set_application_status(%L, ''interview'')', :'ana_app')), '42501|permission denied for function set_application_status|', 'AC10: an anonymous call has no EXECUTE');

select is(pg_temp.export_as(:'mn', :'jp'), to_jsonb('P0002|CHARA_NOT_FOUND|'::text), 'AC10: a member of B cannot export a vacancy of A');
select is(pg_temp.export_as(:'wb', :'jp'), to_jsonb('P0001|CHARA_FORBIDDEN|company_account_required'::text), 'AC10: another candidate is refused as a candidate');
select is(pg_temp.export_as(:'wa', :'jp'), to_jsonb('P0001|CHARA_FORBIDDEN|company_account_required'::text), 'AC10: and so is the candidate who applied to the vacancy');
select pg_temp.ex_member((select org from t_p), false) as pending_a \gset
select pg_temp.ex_member((select org from t_p), true) as removed_a \gset
select is(pg_temp.export_as(:'pending_a', :'jp'), to_jsonb('P0002|CHARA_NOT_FOUND|'::text), 'AC10: an invitee who has not accepted cannot export');
select is(pg_temp.export_as(:'removed_a', :'jp'), to_jsonb('P0002|CHARA_NOT_FOUND|'::text), 'AC10: nor a removed member');
select is(pg_temp.export_as(:'st_admin', :'jp'), to_jsonb('P0002|CHARA_NOT_FOUND|'::text), 'AC10: nor a platform administrator');
select is(pg_temp.call_as(null, 'authenticated', format('select public.export_applicants(%L)', :'jp'), 'aal1'), '42501|CHARA_UNAUTHENTICATED|', 'AC10: a session without a user is unauthenticated');
select is(pg_temp.call_as(null, 'anon', format('select public.export_applicants(%L)', :'jp')), '42501|permission denied for function export_applicants|', 'AC10: an anonymous call has no EXECUTE');
select is(
  pg_temp.exports_of(:'jp') || '/' || pg_temp.event_count(:'ana_app') || '/' || pg_temp.status_of(:'ana_app'),
  :'exports_before' || '/' || :'events_before' || '/applied', 'AC10: no audit row and no event was created and the status is unchanged'
);

-- Other refusals: no vacancy, a deleted one, a suspended organisation, a wrong stage, the row limit and the setting.
select is(pg_temp.export_as(:'mp', gen_random_uuid()), to_jsonb('P0002|CHARA_NOT_FOUND|'::text), 'a vacancy that does not exist is not found');
select is(pg_temp.json_as(:'mp', 'select public.export_applicants(null) as r'), to_jsonb('P0001|CHARA_INVALID_INPUT|p_job_id'::text), 'a missing vacancy id is invalid input');
select is(split_part(pg_temp.export_as(:'mp', :'jp', 'hacked') #>> '{}', '|', 1), '22P02', 'a stage the enum does not know is refused');
update private.settings set value = '11' where key = 'applicant_export_max_rows';
select is(pg_temp.export_as(:'mp', :'jbig', 'shortlisted'), to_jsonb('P0001|CHARA_LIMIT_REACHED|applicant_export_max_rows'::text), 'the export of more rows than the limit allows is refused, not cut');
update private.settings set value = '12' where key = 'applicant_export_max_rows';
select is(jsonb_array_length(pg_temp.export_as(:'mp', :'jbig', 'shortlisted')), 12, 'and one at the limit is exported');
delete from private.settings where key = 'applicant_export_max_rows';
select is(pg_temp.export_as(:'mp', :'jp'), to_jsonb('P0001|CHARA_SETTING_MISSING|applicant_export_max_rows'::text), 'a missing limit setting fails the call');
insert into private.settings (key, value) values ('applicant_export_max_rows', '10000');
update public.jobs set deleted_at = now() where id = :'jp';
select is(pg_temp.export_as(:'mp', :'jp'), to_jsonb('P0002|CHARA_NOT_FOUND|'::text), 'a deleted vacancy is not found');
update public.jobs set deleted_at = null where id = :'jp';
update public.organizations set status = 'suspended' where id = (select org from t_p);
select is(pg_temp.export_as(:'mp', :'jp'), to_jsonb('P0002|CHARA_NOT_FOUND|'::text), 'a suspended organisation exports nothing');

select is((select count(*) from pg_proc where proname = 'export_applicants' and prosecdef and proconfig = array['search_path=""']), 1::bigint, 'the export is a definer function with an empty search path');

select * from finish();
rollback;
