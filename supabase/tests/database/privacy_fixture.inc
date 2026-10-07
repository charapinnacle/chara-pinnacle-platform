-- Shared by the privacy tests (FR-B3): the passport fixture plus candidates A and B with passports, organization O
-- (owner, admin and member) and organization P, the three platform staff roles, a sharing notice and three helpers that
-- add a document or a share the way the application RPCs of later units will. Included with \ir.
\ir passport_fixture.inc

\set d1 '00000000-0000-0000-0000-0000000d0001'
\set d2 '00000000-0000-0000-0000-0000000d0002'
\set d3 '00000000-0000-0000-0000-0000000d0003'
\set dc '00000000-0000-0000-0000-0000000d00c1'

create function pg_temp.must(p_result text) returns void
language plpgsql as $$
begin
  if p_result <> 'ok' then
    raise exception 'setup failed: %', p_result;
  end if;
end;
$$;

select pg_temp.must(pg_temp.call_as(:'wa', 'authenticated', $$select public.create_worker_passport('Amina', 'Okafor', 'NG', 'en')$$, 'aal1'));
select pg_temp.must(pg_temp.call_as(:'wb', 'authenticated', $$select public.create_worker_passport('Bruno', 'Silva', 'PT', 'en')$$, 'aal1'));
select pg_temp.must(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.o', (public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'DE', 'F'))->>'organization_id', true)$$, 'aal1'));
select pg_temp.must(pg_temp.call_as(:'own2', 'authenticated',
  $$select set_config('t.p', (public.create_organization('employer', 'Beta Works Ltd', 'Beta Works', 'GB', 'F'))->>'organization_id', true)$$, 'aal1'));
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.o')::uuid, :'adm', 'admin', now()), (current_setting('t.o')::uuid, :'mem', 'member', now());
insert into public.platform_staff (user_id, role) values (:'slg', 'admin'), (:'adm2', 'verification_reviewer'), (:'late', 'trust_safety');

insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
select s, 1, 'Sharing notice ' || s, 'Text', 'First version', now()
from unnest(array['sharing-notice', 'sharing-notice-b', 'sharing-notice-c']) as s;

-- A document of a candidate, as it stands after a finished upload.
create function pg_temp.doc(p_id uuid, p_owner uuid, p_scan text default 'skipped', p_type text default 'cv') returns void
language sql as $$
  insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes, scan_status)
  values (p_id, p_owner, p_type::public.worker_document_type, 'Title ' || p_id, p_owner || '/' || p_id || '/cv.pdf', 'cv.pdf',
          'application/pdf', 1000, p_scan)
$$;

-- An application of p_owner to a new vacancy of p_org, as apply_to_job writes it, for a share that a test inserts next.
create function pg_temp.stub_application(p_org uuid, p_owner uuid) returns uuid
language plpgsql as $$
declare
  v_job uuid;
  v_application uuid := gen_random_uuid();
begin
  insert into public.jobs (organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type, recruitment_preference)
  values (p_org, 'Welder MIG/MAG', btrim(repeat('Weld steel frames in our workshop. ', 2)), '7212', 'C', 'DE', 'Hamburg', 'full_time', 'both')
  returning id into v_job;
  insert into public.job_applications (id, job_id, organization_id, worker_user_id, passport_share_id, profile_snapshot)
  values (v_application, v_job, p_org, p_owner, gen_random_uuid(), '{}');
  return v_application;
end;
$$;

-- A granted consent and a share to p_org for a new application. The consent purpose is the slug of a sharing notice.
create function pg_temp.share(
  p_org uuid, p_owner uuid, p_scope uuid[], p_purpose text default 'sharing-notice', p_expires timestamptz default null
) returns uuid
language plpgsql as $$
declare
  v_consent bigint;
  v_share uuid;
begin
  insert into public.consents (user_id, purpose, version, action) values (p_owner, p_purpose, 1, 'granted') returning id into v_consent;
  insert into public.passport_shares (worker_user_id, organization_id, application_id, scope, consent_id, expires_at)
  values (p_owner, p_org, pg_temp.stub_application(p_org, p_owner), to_jsonb(p_scope), v_consent, p_expires)
  returning id into v_share;
  return v_share;
end;
$$;

-- The outcome of the grant for a caller: 'ok' or 'sqlstate|message|detail'.
create function pg_temp.grant_as(p_user uuid, p_doc uuid, p_purpose text default 'application_review', p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select * from public.document_access_grant(%L, %L)', p_doc, p_purpose), p_aal)
$$;
