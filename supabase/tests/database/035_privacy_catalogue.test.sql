begin;
select plan(10);

\ir privacy_fixture.inc

create function pg_temp.candidate_tables() returns regclass[] language sql as $$
  select array['public.worker_profiles', 'public.worker_skills', 'public.worker_languages', 'public.worker_preferred_countries',
               'public.worker_work_authorizations', 'public.worker_documents', 'public.passport_shares', 'public.worker_training',
               'public.worker_employment_history', 'public.worker_preferred_industries',
               'public.worker_preferred_employment_types']::regclass[]
$$;

-- AC10: the functions the API roles can run that read candidate data, directly or through one private helper, are exactly
-- the ones below; a new one makes this test fail until it is reviewed and added. Each is either the owner's own action,
-- the one grant, or (mark_application_viewed) the system's move of an application for a member of the organisation, which
-- reads no candidate data and reaches the share only through the private function that sets its expiry, or
-- (withdraw_application) the candidate's withdrawal, which revokes the share of the own application, or (application_documents,
-- application_profile_changed) the member's reads of the applicant page, which answer only while the share is valid and return
-- no storage path and no live profile data (FR-E2 AC6), or (approve_submission, withdraw_submission) the candidate's own
-- answer to a submission request, which shares the chosen documents of the own passport with the employer and revokes that
-- share again (FR-O4, V48), or (mark_submission_viewed, get_employer_submission, submission_documents) the employer's
-- reads and system's move of a submitted candidate, which answer only for an approved submission of the caller's employer,
-- reach the share only to check it or to set its expiry, and return no storage path (FR-O5, V50), or (set_worker_visibility,
-- set_card_sections, my_card_preview) the worker's own Find Workers card, its opt-in and its sections (FR-Q1, V68), or
-- (search_workers) the Find Workers search of a paid organisation, which reads the listed cards and filters on the lists
-- behind them, and returns the card columns only (FR-Q2, V69). The match is on source text, so a helper two calls away or a dynamic query would not be seen.
select set_eq(
  $$select p.proname::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
      and (p.prosrc ~* '(worker_profiles|worker_skills|worker_languages|worker_preferred_countries|worker_work_authorizations|worker_documents|passport_shares|worker_training|worker_employment_history|worker_preferred_industries|worker_preferred_employment_types)'
        or exists (
          select 1 from pg_proc q
          where q.pronamespace = 'private'::regnamespace
            and q.prosrc ~* '(worker_profiles|worker_skills|worker_languages|worker_preferred_countries|worker_work_authorizations|worker_documents|passport_shares|worker_training|worker_employment_history|worker_preferred_industries|worker_preferred_employment_types)'
            and p.prosrc ~* ('private\.' || q.proname || '\s*\(')))$$,
  $$values ('application_documents'), ('application_profile_changed'), ('apply_to_job'), ('approve_submission'), ('create_worker_passport'), ('delete_worker_document'), ('document_access_grant'), ('get_employer_submission'), ('mark_application_viewed'), ('mark_submission_viewed'), ('my_card_preview'), ('passport_limits'), ('search_workers'), ('set_card_sections'), ('set_worker_visibility'), ('submission_documents'), ('withdraw_application'), ('withdraw_submission')$$,
  'AC10: the functions open to the API roles that read candidate data are on the allow-list'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('apply_to_job', 'create_worker_passport', 'delete_worker_document', 'passport_limits', 'withdraw_application')
     and p.prosrc !~* 'auth\.uid'),
  0::bigint, 'AC10: the allow-listed owner functions act for the caller (auth.uid)'
);

-- No view over candidate data is open to the API roles: there is no listing, and no view is a way around the policies. The
-- Find Workers cards (public.worker_search, V68) are granted to no API role; search_workers is their only reader.
select is_empty(
  $$select distinct c.relname::text
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class c on c.oid = r.ev_class and c.relkind in ('v', 'm')
    where d.refobjid = any (pg_temp.candidate_tables()) and c.relnamespace = 'public'::regnamespace
      and c.relname not in ('v_my_document_access_log', 'worker_search')$$,
  'AC10: no view or materialized view in public reads a candidate table, except the candidate''s own access log (FR-B5) and the ungranted Find Workers cards (FR-Q1)'
);
select is_empty(
  $$select c.relname::text from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' and coalesce(c.reloptions, '{}') @> array['security_invoker=true'] is not true$$,
  'every view in public is security_invoker'
);
select is_empty(
  $$select 'worker_search' where has_table_privilege('anon', 'public.worker_search', 'select')
      or has_table_privilege('authenticated', 'public.worker_search', 'select')$$,
  'FR-Q1 AC4: the Find Workers cards are granted to no API role'
);

-- The policies on candidate tables look at the owner only: a policy for an organisation or staff would fail here.
select is_empty(
  $$select p.polname::text from pg_policy p
    where p.polrelid = any (pg_temp.candidate_tables())
      and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
          !~ 'auth\.uid'$$,
  'AC1, AC2: every policy on a candidate table is decided by the caller being the owner'
);
select is_empty(
  $$select p.polname::text from pg_policy p
    where p.polrelid = any (pg_temp.candidate_tables())
      and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
          ~* '(member_org_ids|is_org_member|platform|organization)'$$,
  'AC1, AC2: no policy on a candidate table mentions an organisation or a platform role'
);
select set_eq(
  $$select polname::text from pg_policy where polrelid = 'storage.objects'::regclass
      and (coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '')) ~ 'passport-documents'$$,
  $$values ('passport_docs_owner_select'), ('passport_docs_owner_insert'), ('passport_docs_owner_delete')$$,
  'AC1: the only storage policies for the bucket are the three owner policies'
);

-- AC10 (profile): a candidate cannot make the profile searchable.
select is(
  pg_temp.state_as(:'wb', format($$update public.worker_profiles set searchable = true where user_id = %L$$, :'wb')),
  '42501', 'AC10: the candidate update of searchable is refused'
);
select is(
  (select searchable from public.worker_profiles where user_id = :'wb'),
  false, 'AC10: and searchable stays false'
);

select * from finish();
rollback;
