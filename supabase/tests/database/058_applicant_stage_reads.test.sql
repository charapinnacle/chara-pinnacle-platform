begin;
select plan(23);

\ir status_fixture.inc

update public.profiles set display_name = 'Mia Member' where id = :'mem';
create temp table t_app as select pg_temp.seed_app('applied') as id;
select id as app_id from t_app \gset

-- get_applicant: the application with what the page needs to move it.
select is(
  pg_temp.json_as(:'mem', format('select job_title, applicant_name, status, shortlisting_available, stage_change_blocked, note_max_chars from public.get_applicant(%L)', :'app_id')),
  '[{"status": "applied", "job_title": "Status vacancy", "applicant_name": "Amina Okafor", "note_max_chars": 1000, "shortlisting_available": true, "stage_change_blocked": null}]'::jsonb,
  'a member reads the title, the name in the snapshot, the stage, the plan facts and the note limit'
);
select is(jsonb_array_length(pg_temp.json_as(:'own1', format('select * from public.get_applicant(%L)', :'app_id'))), 1, 'the owner reads it too');
select is(jsonb_array_length(pg_temp.json_as(:'adm', format('select * from public.get_applicant(%L)', :'app_id'))), 1, 'and an admin');
select is(pg_temp.json_as(:'own2', format('select * from public.get_applicant(%L)', :'app_id')), '[]'::jsonb, 'a member of another organisation gets no row');
select is(pg_temp.json_as(:'pending', format('select * from public.get_applicant(%L)', :'app_id')), '[]'::jsonb, 'a member whose invitation is not accepted gets no row');
select is(pg_temp.json_as(:'st_admin', format('select * from public.get_applicant(%L)', :'app_id')), '[]'::jsonb, 'a platform administrator gets no row');
select is(pg_temp.json_as(:'mem', format('select * from public.get_applicant(%L)', gen_random_uuid())), '[]'::jsonb, 'an unknown id gets no row, as the others do');
select is(pg_temp.json_as(:'wa', format('select * from public.get_applicant(%L)', :'app_id')), to_jsonb('P0001|CHARA_FORBIDDEN|company_account_required'::text), 'the candidate is refused');
select is(
  pg_temp.call_as(null, 'anon', format('select * from public.get_applicant(%L)', :'app_id')),
  '42501|permission denied for function get_applicant|', 'an anonymous call has no EXECUTE'
);

insert into billing.plans (code, org_type, name, price_minor, currency, interval, trial_days, is_public, sort)
values ('employer_noshort', 'employer', 'No shortlist', 100, 'EUR', 'month', 0, false, 99);
create function pg_temp.blocked(p_org uuid) returns text
language sql as $$
  select (pg_temp.json_as(pg_temp.member_of(p_org), format('select stage_change_blocked, shortlisting_available from public.get_applicant(%L)', pg_temp.seed_app('applied', p_org))) -> 0)::text
$$;
create temp table t_suspended as select pg_temp.org_on() as org;
update public.organizations set status = 'suspended' where id = (select org from t_suspended);
select is(pg_temp.blocked((select org from t_suspended)), '{"stage_change_blocked": "organization_suspended", "shortlisting_available": true}', 'a suspended organisation is reported as blocked');
select is(pg_temp.blocked(pg_temp.org_on('employer_starter', 'canceled')), '{"stage_change_blocked": "read_only_free_plan", "shortlisting_available": false}', 'a lapsed organisation is read only and has no shortlisting');
select is(pg_temp.blocked(pg_temp.org_on('employer_noshort')), '{"stage_change_blocked": null, "shortlisting_available": true}', 'with limits not enforced a plan without the feature still offers it');
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.blocked(pg_temp.org_on('employer_noshort')), '{"stage_change_blocked": null, "shortlisting_available": false}', 'with limits enforced the plan without shortlisting does not offer it');
select is(pg_temp.blocked(pg_temp.org_on('employer_starter')), '{"stage_change_blocked": null, "shortlisting_available": true}', 'employer_starter offers it');
select is(pg_temp.blocked(pg_temp.org_on()), '{"stage_change_blocked": "read_only_free_plan", "shortlisting_available": false}', 'with limits enforced an organisation on free_employer is read only');
update private.settings set value = 'false' where key = 'entitlements_enforced';

create temp table t_erased as select pg_temp.seed_app('applied') as id;
update public.job_applications set profile_snapshot = profile_snapshot - 'first_name' - 'last_name' where id = (select id from t_erased);
select is(
  pg_temp.json_as(:'mem', format('select applicant_name from public.get_applicant(%L)', (select id from t_erased))), '[{"applicant_name": null}]'::jsonb,
  'an erased candidate has no name'
);

-- list_applicant_events: the history, oldest first, with who made each move and no id.
create temp table t_hist as select pg_temp.seed_app('applied') as id;
select pg_temp.viewed_as(:'own1', (select id from t_hist)) as v \gset
select pg_temp.set_as(:'mem', (select id from t_hist), 'shortlisted', 'Strong welding record') as s1 \gset
select pg_temp.set_as(:'adm', (select id from t_hist), 'interview') as s2 \gset
select is(
  pg_temp.json_as(:'mem', format('select from_status, to_status, actor_kind, actor_name, note from public.list_applicant_events(%L)', (select id from t_hist))),
  '[{"note": null, "to_status": "applied", "actor_kind": "candidate", "actor_name": null, "from_status": null},
    {"note": null, "to_status": "viewed", "actor_kind": "system", "actor_name": null, "from_status": "applied"},
    {"note": "Strong welding record", "to_status": "shortlisted", "actor_kind": "employer", "actor_name": "Mia Member", "from_status": "viewed"},
    {"note": null, "to_status": "interview", "actor_kind": "employer", "actor_name": null, "from_status": "shortlisted"}]'::jsonb,
  'the events come oldest first with the kind of actor, the name of the employer member and the note'
);
select is(
  (select array_agg(a.attname::text order by a.attnum) from pg_proc p, unnest(p.proargnames) with ordinality a(attname, attnum)
   where p.oid = 'public.list_applicant_events(uuid)'::regprocedure and a.attnum > 1),
  array['id', 'from_status', 'to_status', 'actor_kind', 'actor_name', 'note', 'created_at'],
  'the result has no actor id and no other user id'
);
select is(pg_temp.json_as(:'own2', format('select * from public.list_applicant_events(%L)', (select id from t_hist))), '[]'::jsonb, 'a member of another organisation gets no event');
select is(pg_temp.json_as(:'st_admin', format('select * from public.list_applicant_events(%L)', (select id from t_hist))), '[]'::jsonb, 'a platform administrator gets no event');
select is(pg_temp.json_as(:'wa', format('select * from public.list_applicant_events(%L)', (select id from t_hist))), to_jsonb('P0001|CHARA_FORBIDDEN|company_account_required'::text), 'the candidate is refused');
select is(
  pg_temp.call_as(null, 'anon', format('select * from public.list_applicant_events(%L)', (select id from t_hist))),
  '42501|permission denied for function list_applicant_events|', 'an anonymous call has no EXECUTE'
);
select is(pg_temp.json_as(:'mem', format('select * from public.list_applicant_events(%L)', gen_random_uuid())), '[]'::jsonb, 'an unknown id gets no event');

select * from finish();
rollback;
