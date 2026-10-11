-- Shared by the application tests (FR-D1, FR-D7): the search fixture (organizations t.a Acme with owner own1, admin adm
-- and member mem, and t.b Beta; the candidates wa, wb, wnew and wsus; seed_job, which writes a vacancy as the database
-- owner), complete passports for wa (Amina, NG) and wb (Bruno, PH), and the helpers below. Included with \ir.
\ir search_fixture.inc

\set d1 '00000000-0000-0000-0000-0000000d0001'
\set d2 '00000000-0000-0000-0000-0000000d0002'
\set d3 '00000000-0000-0000-0000-0000000d0003'
\set dx '00000000-0000-0000-0000-0000000d00b1'

select pg_temp.call_as(:'wa', 'authenticated', $$select public.create_worker_passport('Amina', 'Okafor', 'NG', 'en')$$, 'aal1') as setup_wa \gset
select pg_temp.call_as(:'wb', 'authenticated', $$select public.create_worker_passport('Bruno', 'Silva', 'PH', 'en')$$, 'aal1') as setup_wb \gset
update public.worker_profiles set occupation_id = '7212' where user_id in (:'wa', :'wb');

-- A document of a candidate, as it stands after a finished upload.
create function pg_temp.doc(p_id uuid, p_owner uuid, p_scan text default 'skipped', p_type text default 'cv') returns void
language sql as $$
  insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes, scan_status)
  values (p_id, p_owner, p_type::public.worker_document_type, 'Title ' || p_id, p_owner || '/' || p_id || '/cv.pdf', 'cv.pdf',
          'application/pdf', 1000, p_scan)
$$;

-- An open, visible vacancy of Acme (or of p_org).
create function pg_temp.open_job(p_title text default 'Welder MIG/MAG', p_org uuid default null, p_over jsonb default '{}') returns uuid
language sql as $$
  select pg_temp.seed_job(jsonb_build_object('title', p_title, 'status', 'open') || p_over, p_org)
$$;

-- apply_to_job as an authenticated user: 'ok' (the id and the outcome are then in t.app and t.outcome) or
-- 'sqlstate|message|detail'. A null note and a null array are passed as NULL.
create function pg_temp.apply_as(p_user uuid, p_job uuid, p_note text default null, p_docs uuid[] default null) returns text
language sql as $$
  select pg_temp.call_as(
    p_user, 'authenticated',
    format($f$with r as (select * from public.apply_to_job(%L, %L, %L::uuid[]))
              select set_config('t.app', (select application_id::text from r), true),
                     set_config('t.outcome', (select outcome from r), true)$f$, p_job, p_note, p_docs),
    'aal1'
  )
$$;

-- The row counts of every table and queue an application writes to, as one text, to compare before and after.
create function pg_temp.counts() returns text
language sql as $$
  select (select count(*) from public.job_applications) || ',' || (select count(*) from public.passport_shares) || ','
      || (select count(*) from public.consents) || ',' || (select count(*) from public.application_events) || ','
      || (select count(*) from audit.log) || ',' || (select count(*) from pgmq.q_notifications)
$$;

-- document_access_grant for a member of Acme: 'ok' or 'sqlstate|message|detail'.
create function pg_temp.grant_as(p_user uuid, p_doc uuid, p_aal text default 'aal1') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select * from public.document_access_grant(%L, %L)', p_doc, 'application_review'), p_aal)
$$;

-- Gives an application any status as the database owner: the transition trigger (FR-D2) judges every change of status,
-- so a test that needs a state the functions would not reach in one step switches it off for the one update.
create function pg_temp.force_status(p_app uuid, p_status text) returns void
language plpgsql as $$
begin
  alter table public.job_applications disable trigger applications_guard_transition;
  update public.job_applications set status = p_status::public.application_status where id = p_app;
  alter table public.job_applications enable always trigger applications_guard_transition;
end;
$$;
