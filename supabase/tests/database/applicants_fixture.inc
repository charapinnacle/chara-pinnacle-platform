-- Shared by the applicant list tests (FR-E1): the status fixture plus seed_applicant, which writes an application of a
-- new candidate as the database owner with the share and the consent apply_to_job makes. Included with \ir.
\ir status_fixture.inc

-- p_name is 'First Last'; p_completeness null leaves the snapshot without one (the trigger then takes the passport's, 0 for a
-- candidate without a passport); p_docs is the number of document ids in the scope of the share.
create function pg_temp.seed_applicant(
  p_job uuid, p_org uuid, p_status text, p_at timestamptz, p_name text, p_completeness integer, p_docs integer,
  p_revoked boolean default false
) returns uuid
language plpgsql as $$
declare
  v_app uuid := gen_random_uuid();
  v_share uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_consent bigint;
begin
  insert into public.consents (user_id, purpose, version, action)
  values (v_worker, 'share_passport:' || p_org || ':' || v_app, private.current_legal_version('sharing-notice'), 'granted')
  returning id into v_consent;
  insert into public.job_applications (id, job_id, organization_id, worker_user_id, status, passport_share_id, profile_snapshot, created_at)
  values (
    v_app, p_job, p_org, v_worker, p_status::public.application_status, v_share,
    jsonb_build_object('first_name', split_part(p_name, ' ', 1), 'last_name', nullif(split_part(p_name, ' ', 2), ''))
      || case when p_completeness is null then '{}'::jsonb else jsonb_build_object('completeness', p_completeness) end,
    p_at
  );
  insert into public.passport_shares (id, worker_user_id, organization_id, application_id, scope, consent_id, revoked_at)
  values (v_share, v_worker, p_org, v_app, (select coalesce(jsonb_agg(gen_random_uuid()), '[]') from generate_series(1, p_docs)), v_consent,
          case when p_revoked then now() end);
  insert into public.application_events (application_id, from_status, to_status, actor_id, created_at)
  values (v_app, null, 'applied', v_worker, p_at);
  return v_app;
end;
$$;
