begin;
select plan(9);

\ir privacy_fixture.inc

create function pg_temp.candidate_tables() returns regclass[] language sql as $$
  select array['public.worker_profiles', 'public.worker_skills', 'public.worker_languages', 'public.worker_preferred_countries',
               'public.worker_work_authorizations', 'public.worker_documents', 'public.passport_shares']::regclass[]
$$;

-- AC10: the functions the API roles can run that read candidate data, directly or through one private helper, are exactly
-- the ones below; a new one makes this test fail until it is reviewed and added. Each is either the owner's own action
-- or the one grant. The match is on source text, so a helper two calls away or a dynamic query would not be seen.
select set_eq(
  $$select p.proname::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
      and (p.prosrc ~* '(worker_profiles|worker_skills|worker_languages|worker_preferred_countries|worker_work_authorizations|worker_documents|passport_shares)'
        or exists (
          select 1 from pg_proc q
          where q.pronamespace = 'private'::regnamespace
            and q.prosrc ~* '(worker_profiles|worker_skills|worker_languages|worker_preferred_countries|worker_work_authorizations|worker_documents|passport_shares)'
            and p.prosrc ~* ('private\.' || q.proname || '\s*\(')))$$,
  $$values ('apply_to_job'), ('create_worker_passport'), ('delete_worker_document'), ('document_access_grant'), ('passport_limits')$$,
  'AC10: the functions open to the API roles that read candidate data are on the allow-list'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('apply_to_job', 'create_worker_passport', 'delete_worker_document', 'passport_limits')
     and p.prosrc !~* 'auth\.uid'),
  0::bigint, 'AC10: the allow-listed owner functions act for the caller (auth.uid)'
);

-- No view over candidate data is open to the API roles: there is no listing, and no view is a way around the policies.
select is_empty(
  $$select distinct c.relname::text
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class c on c.oid = r.ev_class and c.relkind in ('v', 'm')
    where d.refobjid = any (pg_temp.candidate_tables()) and c.relnamespace = 'public'::regnamespace
      and c.relname <> 'v_my_document_access_log'$$,
  'AC10: no view or materialized view in public reads a candidate table, except the candidate''s own access log (FR-B5)'
);
select is_empty(
  $$select c.relname::text from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' and coalesce(c.reloptions, '{}') @> array['security_invoker=true'] is not true$$,
  'every view in public is security_invoker'
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
