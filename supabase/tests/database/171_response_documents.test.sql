begin;
select plan(145);

\ir jobs_fixture.inc

-- Supporting documents of partner responses (V45, FR-O2 step Attach, AC5, AC6 and the documents of AC7; SOP P2-22 output
-- "private supporting documents"; decision 3.3; NFR-S8, NFR-S11, NFR-A4): public.partner_response_documents, the bucket
-- partner-response-documents, register_response_document, response_document_set_scan_status,
-- response_document_access_grant, remove_response_document, respond_to_invitation with staged files, the clean-up job
-- and the removal of the files. Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner own2) are employers of
-- the fixture and wkr is a candidate; the partners are made below.

\set p1o '00000000-0000-0000-0000-0000000f4511'
\set p1m '00000000-0000-0000-0000-0000000f4512'
\set p2o '00000000-0000-0000-0000-0000000f4513'
\set p3o '00000000-0000-0000-0000-0000000f4514'
\set stf '00000000-0000-0000-0000-0000000f4515'
\set cown '00000000-0000-0000-0000-0000000f4590'
\set org_c '00000000-0000-0000-0000-0000000f4591'
\set c_r '00000000-0000-0000-0000-0000000f4592'
\set c_p '00000000-0000-0000-0000-0000000f4593'
\set pown '00000000-0000-0000-0000-0000000f4594'

-- Concurrency (NFR-A4) first, on committed data: four files of P for R, a fifth reserved by a second session kept open,
-- a sixth at the same time by a third session.

create extension if not exists dblink schema extensions;
select extensions.dblink_connect('setup',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('blocked',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_exec('setup', format($$
  begin;
  update private.settings set value = 'true' where key = 'release_job_orders';
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%1$L, %1$L || '@employer.test', now(), '{"intended_account_kind": "company"}'),
         (%5$L, %5$L || '@partner.test', now(), '{"intended_account_kind": "company"}');
  update public.profiles set account_kind = intended_account_kind where id in (%1$L, %5$L);
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (%2$L, 'employer', 'doc-lock-' || left(%2$L, 8), 'Document Lock GmbH', 'Document Lock', 'DE'),
         (%4$L, 'recruitment_company', 'doc-lock-p-' || left(%4$L, 8), 'Document Lock Partner Ltd', 'Document Lock Partner', 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (%2$L, %1$L, 'owner', now()), (%4$L, %5$L, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  values (%4$L, 'serves_market', 'DE'), (%4$L, 'sources_from', 'PH');
  insert into public.organization_occupations (organization_id, occupation_id) values (%4$L, '7212');
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = %4$L;
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  values (%4$L, 'recruitment_enterprise', 'active', 'null');
  insert into public.consents (user_id, purpose, version, action)
  values (%5$L, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on
  ) values (%3$L, %2$L, 'Lock welders', 10, 'DE', 'Hamburg', 'C', current_date + 30, 'full_time', 'international', 'both',
    'open', 'job_order_marketplace', now(), current_date + 80);
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (%3$L, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (%3$L, 'DE');
  insert into public.partner_response_documents (
    id, organization_id, requirement_id, employer_organization_id, storage_path, file_name, size_bytes, scan_status, scanned_at
  ) select x.id, %4$L, %3$L, %2$L, %4$L || '/' || x.id || '/' || gen_random_uuid(), 'File.pdf', 1000, 'skipped', now()
  from (select gen_random_uuid() as id from generate_series(1, 4)) x;
  commit;
$$, :'cown', :'org_c', :'c_r', :'c_p', :'pown'));

create function pg_temp.register_sql(p_org uuid, p_req uuid) returns text
language sql as $$
  select format($f$select ((select document_id from public.register_response_document(%L, %L, 'Profile.pdf',
    'application/pdf', 1000)) is not null)::text$f$, p_org, p_req)
$$;

select is((select t from extensions.dblink('holder', format($f$
    begin;
    set local lock_timeout = '2s';
    select set_config('request.jwt.claims', json_build_object('sub', %L, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
    %s;
  $f$, :'pown', pg_temp.register_sql(:'c_p', :'c_r'))) as r (t text)), 'true',
  'a second session reserves the fifth file of P for R and keeps its transaction open');
select is(pg_try_advisory_xact_lock(hashtextextended('partner_responses:' || :'c_p', 0)), false,
  'NFR-A4: the reservation in progress holds the advisory lock of the partner''s responses');
select extensions.dblink_exec('blocked', format($f$
    begin;
    select set_config('request.jwt.claims', json_build_object('sub', %L, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
  $f$, :'pown')) as began \gset
select extensions.dblink_send_query('blocked', pg_temp.register_sql(:'c_p', :'c_r')) as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1, 'NFR-A4: a sixth reservation of the same partner at the same time waits');
select extensions.dblink_exec('holder', 'commit') as committed \gset

create function pg_temp.blocked_result() returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config('client_min_messages', 'warning', true);
  select r into v_result from extensions.dblink_get_result('blocked', false) as t (r text);
  if v_result is null then
    v_result := extensions.dblink_error_message('blocked');
  end if;
  perform r from extensions.dblink_get_result('blocked', false) as t (r text);
  perform extensions.dblink_exec('blocked', 'rollback');
  return v_result;
end;
$$;

select matches(pg_temp.blocked_result(), 'CHARA_LIMIT_REACHED',
  'NFR-A4, FR-O2 AC5: once the fifth is committed, the waiting sixth counts it and is refused at the limit');
select is((select count(*)::integer from public.partner_response_documents where organization_id = :'c_p'), 5,
  'NFR-A4: five files of P for R, never six');
select extensions.dblink_disconnect('holder');
select extensions.dblink_disconnect('blocked');
select extensions.dblink_exec('setup', format($$
  begin;
  delete from public.workforce_requirements where organization_id = %2$L;
  delete from pgmq.q_account_ops where message ->> 'bucket_id' = 'partner-response-documents' and message ->> 'organization_id' = %3$L;
  delete from private.rate_limit_hits where (action, bucket) in (
    ('user:audited_write', (hashtextextended(%4$L, 0) & 2147483647)::integer),
    ('org:audited_write', (hashtextextended(%3$L, 0) & 2147483647)::integer),
    ('user:document_access', ((hashtextextended(%4$L, 0) & 2147483647)
      %% (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_user_buckets'))::integer));
  delete from billing.subscriptions where organization_id = %3$L;
  delete from public.organizations where id in (%2$L, %3$L);
  delete from auth.users where id in (%1$L, %4$L);
  update private.settings set value = 'false' where key = 'release_job_orders';
  commit;
$$, :'cown', :'org_c', :'c_p', :'pown'));
select extensions.dblink_disconnect('setup');
select is(
  (select count(*)::integer from public.organizations where id in (:'org_c', :'c_p'))
    + (select count(*)::integer from public.partner_response_documents where organization_id = :'c_p'),
  0, 'the committed data of the concurrency test are removed again');

-- Structure ----------------------------------------------------------------------------------------------------------------

select is(
  (select relrowsecurity::text || relforcerowsecurity::text from pg_class where oid = 'public.partner_response_documents'::regclass),
  'truetrue', 'NFR-S8: RLS is enabled and forced on partner_response_documents');
select is(
  (select string_agg(r || ':' || p, ',' order by r, p) from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
   where has_table_privilege(r, 'public.partner_response_documents', p)),
  null, 'no API role may write the table: files are added and removed through the functions only');
select is(
  (select string_agg(column_name::text, ',' order by column_name) from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'partner_response_documents' and grantee = 'authenticated'
     and privilege_type = 'SELECT'),
  'created_at,file_name,id,organization_id,requirement_id,response_id,scan_status,scanned_at,size_bytes',
  'NFR-S11: the readable columns leave out the employer''s id, the object name and the uploader');
select ok(
  (select bool_and(exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                           where i.indrelid = 'public.partner_response_documents'::regclass and a.attname = c))
   from unnest(array['organization_id', 'employer_organization_id', 'response_id', 'requirement_id', 'storage_path']) c),
  'every column of the policy, the count and the lookups leads an index');
select is(
  (select public || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',') from storage.buckets
   where id = 'partner-response-documents'),
  'false:15728640:application/pdf', 'FR-O2 AC5: the bucket partner-response-documents is private, 15 MB, PDF only');
select is(
  (select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and (qual like '%partner-response-documents%' or with_check like '%partner-response-documents%')),
  0, 'FR-O2 AC5, AC6: no storage policy opens the bucket: files move only through URLs signed by document-url');
select is(
  (select string_agg(f || ':' || has_function_privilege('anon', f, 'execute') || has_function_privilege('authenticated', f, 'execute')
     || has_function_privilege('service_role', f, 'execute'), ',' order by f)
   from unnest(array['public.register_response_document(uuid, uuid, text, text, bigint)',
     'public.response_document_access_grant(uuid)', 'public.remove_response_document(uuid, uuid)',
     'public.response_document_set_scan_status(uuid, text, text, text, bigint)', 'private.drop_stale_response_documents()',
     'private.queue_response_document_removal(uuid, text)']) f),
  'private.drop_stale_response_documents():falsefalsefalse,private.queue_response_document_removal(uuid, text):falsefalsefalse,'
  || 'public.register_response_document(uuid, uuid, text, text, bigint):falsetruefalse,public.remove_response_document(uuid, uuid):falsetruefalse,'
  || 'public.response_document_access_grant(uuid):falsetruefalse,public.response_document_set_scan_status(uuid, text, text, text, bigint):falsefalsetrue',
  'the partner and party functions run for authenticated, the scan result for service_role, the helpers for nobody');
select ok(exists (select 1 from private.setting_rules r join private.settings s using (key)
                  where r.key = 'response_documents_max' and r.editable and r.min = 1 and r.max = 20 and s.value #>> '{}' = '5'),
  'decision 3.3: five documents per response, an editable setting (1 to 20)');
select is((select schedule || ' ' || command from cron.job where jobname = 'response-documents-clean-up'),
  '25 0 * * * select private.drop_stale_response_documents()', 'the clean-up runs daily');
select ok(pg_get_functiondef('private.rescan_pending_documents()'::regprocedure) ~ 'partner-response-documents'
  and pg_get_functiondef('private.rescan_pending_documents()'::regprocedure) ~ 'partner-documents'
  and pg_get_functiondef('private.rescan_pending_documents()'::regprocedure) ~ 'worker_documents',
  'the rescan announces pending response documents again, besides candidate documents and licence evidence');

-- The fixture --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'true' where key = 'release_job_orders';
update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key = 'rate_limit_document_access_max';
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (:'acme', 'employer_starter', 'active', 'null'), (:'beta', 'employer_starter', 'active', 'null');

-- A listed partner serving DE, sourcing from PH and listing 7212, owned by p_owner, on p_plan (none when null), with the
-- commitment accepted.
create function pg_temp.partner(p_slug text, p_owner uuid, p_plan text default 'recruitment_partner') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'recruitment_company', p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  values (v_id, 'serves_market', 'DE'), (v_id, 'sources_from', 'PH');
  insert into public.organization_occupations (organization_id, occupation_id) values (v_id, '7212');
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  end if;
  insert into public.consents (user_id, purpose, version, action)
  values (p_owner, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
  return v_id;
end;
$$;

create function pg_temp.req(p_org uuid, p_status text default 'open', p_visibility text default 'job_order_marketplace')
returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on, close_reason
  ) values (
    v_id, p_org, 'Welders', 10, 'DE', 'Hamburg', 'C', date '2027-03-01', 'full_time', 'both', 'both',
    p_status::public.requirement_status, p_visibility::public.requirement_visibility, now() - interval '10 days',
    date '2027-04-01', case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

-- register_response_document as p_user for p_org and p_req: 'ok' with the id in t.result and the object name in t.path,
-- or 'sqlstate|message|detail'.
create function pg_temp.reg(
  p_user uuid, p_org uuid, p_req uuid, p_name text default 'Company profile.pdf', p_mime text default 'application/pdf',
  p_size bigint default 2000000
) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', g.document_id::text, true), set_config('t.path', g.object_path, true)
       from public.register_response_document(%L, %L, %L, %L, %s) g$f$,
    p_org, p_req, p_name, p_mime, coalesce(p_size::text, 'null')), 'aal1')
$$;

create function pg_temp.result() returns text
language sql as $$ select current_setting('t.result', true) $$;

-- response_document_access_grant as p_user: 'ok' with the object name in t.result, or the error.
create function pg_temp.open(p_user uuid, p_doc uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', g.bucket_id || ':' || g.object_path || ':' || g.file_name, true)
       from public.response_document_access_grant(%L) g$f$, p_doc), 'aal1')
$$;

create function pg_temp.respond(p_user uuid, p_org uuid, p_req uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.result', public.respond_to_invitation(%L, %L, 5, current_date + 30,
      'Twenty welders placed in Hamburg last year.', 'fee_per_hire', 1500, 'EUR')::text, true)$f$, p_org, p_req), 'aal1')
$$;

create function pg_temp.scan(p_doc uuid, p_status text, p_mime text default 'application/pdf', p_size bigint default 2000000)
returns text
language plpgsql as $$
declare
  v_path text := (select storage_path from public.partner_response_documents where id = p_doc);
  v_result text;
begin
  set local role service_role;
  v_result := public.response_document_set_scan_status(p_doc, v_path, p_status, p_mime, p_size);
  reset role;
  return v_result;
end;
$$;

create function pg_temp.close(p_req uuid, p_status text) returns text
language sql as $$
  select pg_temp.call_as(current_setting('t.own1')::uuid, 'authenticated', format(
    'select public.set_requirement_status(%L, %L, %L, %L::timestamptz, %L)', r.organization_id, r.id, p_status, r.updated_at,
    case p_status when 'closed' then 'cancelled' else 'filled' end), 'aal2')
  from public.workforce_requirements r where r.id = p_req
$$;

create function pg_temp.n_as(p_user uuid, p_sql text) returns integer
language sql as $$ select pg_temp.val_as(p_user, 'aal1', 'select count(*) from (' || p_sql || ') x')::integer $$;

create function pg_temp.removals(p_path text) returns integer
language sql as $$
  select count(*)::integer from pgmq.q_account_ops
  where message ->> 'action' = 'delete_organization_object' and message ->> 'bucket_id' = 'partner-response-documents'
    and message ->> 'path' = p_path
$$;

select set_config('t.own1', :'own1', false) as setup_own1 \gset
select pg_temp.partner('doc-partner-one', :'p1o') as p1 \gset
select pg_temp.partner('doc-partner-two', :'p2o') as p2 \gset
select pg_temp.partner('doc-partner-free', :'p3o', null) as p3 \gset
select pg_temp.new_user(:'p1m') as seeded \gset
update public.profiles set account_kind = intended_account_kind where id = :'p1m';
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'p1', :'p1m', 'member', now());
select pg_temp.new_user(:'stf') as seeded \gset
insert into public.platform_staff (user_id, role) values (:'stf', 'admin');
select pg_temp.req(:'acme') as r \gset
select pg_temp.req(:'acme', 'open', 'private') as r_priv \gset
select pg_temp.req(:'acme', 'closed') as r_closed \gset
select pg_temp.req(:'beta') as rb \gset

-- Reserving a file (FR-O2 step Attach, AC5) ------------------------------------------------------------------------------------

select is(pg_temp.reg(:'p1m', :'p1', :'r'), 'ok', 'AC5: a member of P1 reserves a PDF of 2 MB before responding');
select pg_temp.result() as d1 \gset
select current_setting('t.path') as d1_path \gset
select is(
  (select format('%s|%s|%s|%s|%s', response_id is null, scan_status, size_bytes, file_name, uploaded_by = :'p1m')
   from public.partner_response_documents where id = :'d1'),
  't|pending|2000000|Company profile.pdf|t', 'the file waits staged on the requirement, pending its scan');
select matches(:'d1_path'::text, '^' || :'p1' || '/' || :'d1' || '/[0-9a-f-]{36}$',
  'the object name is <partner>/<document>/<uuid>, never the file name or the employer');
select is(
  (select metadata - 'size_bytes' from audit.log where action = 'response_document.added' and entity_id = :'d1'),
  jsonb_build_object('organization_id', :'p1', 'requirement_id', :'r'),
  'one audit row response_document.added with the partner and the requirement (never the employer)');
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Big.pdf', 'application/pdf', 15728640), 'ok', 'AC5: a PDF of exactly 15 MB is accepted');
select pg_temp.result() as d_big \gset
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Big.pdf', 'application/pdf', 15728641), 'P0001|CHARA_INVALID_INPUT|file',
  'AC5: 15 MB plus 1 byte is refused');
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Scan.pdf', 'image/png', 1000), 'P0001|CHARA_INVALID_INPUT|file',
  'AC5: a declared PNG is refused');
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Scan.png', 'application/pdf', 1000), 'P0001|CHARA_INVALID_INPUT|file',
  'a name that does not end in .pdf is refused');
select is(pg_temp.reg(:'p1m', :'p1', :'r', '../x.pdf', 'application/pdf', 1000), 'P0001|CHARA_INVALID_INPUT|file',
  'a name with a slash is refused');
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Scan.pdf', 'application/pdf', 0), 'P0001|CHARA_INVALID_INPUT|file',
  'an empty file is refused');
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Scan.pdf', 'application/pdf', null), 'P0001|CHARA_INVALID_INPUT|file',
  'a missing size is refused');

select alike(pg_temp.reg(null, :'p1', :'r'), '42501|%', 'anonymous is refused at the EXECUTE grant');
select is(pg_temp.reg(:'wkr', :'p1', :'r'), '42501|CHARA_FORBIDDEN|', 'a candidate is refused');
select is(pg_temp.reg(:'mem', :'p1', :'r'), '42501|CHARA_FORBIDDEN|', 'an employer member cannot add a file for P1');
select is(pg_temp.reg(:'own1', :'acme', :'r'), '42501|CHARA_FORBIDDEN|partner_only', 'an employer cannot add files to its own requirement');
select is(pg_temp.reg(:'p2o', :'p2', :'r_priv'), 'P0002|CHARA_NOT_FOUND|', 'a partner not invited to a private requirement learns nothing');
select is(pg_temp.reg(:'p1m', :'p1', :'r_closed'), 'P0001|CHARA_INVALID_STATE|requirement_not_open',
  'no file for a closed requirement without a response');
select is(pg_temp.reg(:'p3o', :'p3', :'r'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|job_order_access',
  'a partner that could not respond (no paid plan) cannot stage a file either');
select is(pg_temp.reg(:'p1m', :'p1', gen_random_uuid()), 'P0002|CHARA_NOT_FOUND|', 'an unknown requirement is not found');
update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.reg(:'p1m', :'p1', :'r'), '42501|CHARA_FORBIDDEN|release_off', 'release gate: nothing while release_job_orders is off');
update private.settings set value = 'true' where key = 'release_job_orders';

-- The bucket and the scan ---------------------------------------------------------------------------------------------------------

select throws_ok(format('insert into storage.objects (bucket_id, name) values (''partner-response-documents'', %L)',
  :'p1' || '/' || :'d1' || '/' || gen_random_uuid()), '42501', 'CHARA_NOT_FOUND', 'the bucket refuses a name nobody reserved');
select lives_ok(format('insert into storage.objects (bucket_id, name, metadata) values (''partner-response-documents'', %L, ''{"mimetype": "application/pdf", "size": 2000000}'')', :'d1_path'),
  'the reserved name accepts the file');
select is(pg_temp.open(:'p1m', :'d1'), 'P0001|CHARA_DOCUMENT_NOT_SCANNED|', 'AC5: a file not yet scanned is never opened, even by its partner');
select is(pg_temp.respond(:'p1m', :'p1', :'r'), 'P0001|CHARA_DOCUMENT_NOT_SCANNED|scanning',
  'AC5: responding while a file is still being checked is refused with CHARA_DOCUMENT_NOT_SCANNED');
select is((select count(*)::integer from public.partner_responses where organization_id = :'p1'), 0, 'and writes no response');

select alike(pg_temp.call_as(:'p1m', 'authenticated', format(
  'select public.response_document_set_scan_status(%L, %L, ''skipped'', ''application/pdf'', 2000000)', :'d1', :'d1_path')),
  '42501|%', 'a partner cannot report a scan result');
set local role service_role;
select throws_ok(format('select public.response_document_set_scan_status(%L, %L, ''skipped'', ''application/pdf'', 2000000)',
  :'d1', :'p1' || '/' || :'d1' || '/' || gen_random_uuid()), 'P0002', 'CHARA_NOT_FOUND', 'another object name is not the file of the row');
select throws_ok(format('select public.response_document_set_scan_status(%L, %L, ''infected'', ''application/pdf'', 2000000)',
  :'d1', :'d1_path'), 'P0001', 'CHARA_INVALID_INPUT', 'an unknown verdict is refused');
reset role;
select is(pg_temp.scan(:'d1', 'skipped'), 'skipped', 'scan-document clears the file whose type and size match');
select is(pg_temp.scan(:'d1', 'rejected'), 'skipped', 'a repeated verdict leaves the row as it is');
select is(pg_temp.scan(:'d_big', 'skipped', 'image/png', 15728640), 'rejected',
  'AC5: a stored type that is not application/pdf (a renamed PNG) becomes rejected');
select is(pg_temp.removals((select storage_path from public.partner_response_documents where id = :'d_big')), 1,
  'the rejected file is queued for removal from the bucket');
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Wrong size.pdf'), 'ok', 'a third file');
select pg_temp.result() as d3 \gset
select current_setting('t.path') as d3_path \gset
select is(pg_temp.scan(:'d3', 'skipped', 'application/pdf', 1999999), 'rejected', 'a stored size other than the one declared becomes rejected');
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Brochure.pdf'), 'ok', 'a fourth file');
select pg_temp.result() as d4 \gset
select is(pg_temp.scan(:'d4', 'clean'), 'clean', 'a vendor verdict clean is kept');
select is(
  (select string_agg(metadata ->> 'scan_status', ',' order by id) from audit.log where action = 'response_document.scanned'
   and entity_id in (:'d1', :'d_big', :'d3', :'d4')),
  'skipped,rejected,rejected,clean', 'each verdict is audited once (the repeat writes nothing)');

-- Responding attaches the staged files ----------------------------------------------------------------------------------------------

select is(pg_temp.respond(:'p1m', :'p1', :'r'), 'ok', 'AC1, AC5: once every file is scanned P1 responds');
select pg_temp.result() as resp1 \gset
select is(
  (select string_agg(case when id = :'d1' then 'd1' when id = :'d4' then 'd4' end || ':' || (response_id = :'resp1'), ',' order by file_name)
   from public.partner_response_documents where organization_id = :'p1'),
  'd4:true,d1:true', 'the scanned files belong to the response; the rejected ones are gone');
select is((select metadata ->> 'documents' from audit.log where action = 'response.created' and entity_id = :'resp1'), '2',
  'response.created counts the files attached');
select is(pg_temp.removals(:'d3_path'), 1, 'the rejected file was queued once, at its rejection; deleting its row queues nothing more');

select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Later.pdf'), 'ok', 'a file added after responding');
select pg_temp.result() as d5 \gset
select is((select response_id::text from public.partner_response_documents where id = :'d5'), :'resp1',
  'belongs to the live response at once');
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Four.pdf'), 'ok', 'a fourth live file');
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Five.pdf'), 'ok', 'a fifth live file');
select pg_temp.result() as d7 \gset
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Six.pdf'), 'P0001|CHARA_LIMIT_REACHED|response_documents_max',
  'AC5: the sixth file is refused');
update private.settings set value = '6' where key = 'response_documents_max';
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Six.pdf'), 'ok', 'the limit is the setting response_documents_max');
select pg_temp.result() as d8 \gset
update private.settings set value = '5' where key = 'response_documents_max';
select is(pg_temp.scan(:'d8', 'rejected'), 'rejected', 'a rejected file');
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'Six again.pdf'), 'P0001|CHARA_LIMIT_REACHED|response_documents_max',
  'five files that are not rejected: still full');
select is(pg_temp.scan(:'d5', 'skipped'), 'skipped', 'the later file is scanned');

-- Who reads the metadata (AC7, NFR-S8, NFR-S11) ----------------------------------------------------------------------------------

select is(pg_temp.reg(:'p2o', :'p2', :'r', 'P2 profile.pdf'), 'ok', 'P2 stages a file for the same requirement');
select pg_temp.result() as d_p2 \gset
select is(pg_temp.scan(:'d_p2', 'skipped'), 'skipped', 'and it is scanned');
select is(
  pg_temp.n_as(:'p1m', 'select 1 from public.partner_response_documents') || ',' ||
  pg_temp.n_as(:'p1m', format('select 1 from public.partner_response_documents where organization_id = %L', :'p2')),
  '6,0', 'AC7: a member of P1 reads its six files, staged, pending and rejected included, and none of P2''s');
select is(pg_temp.n_as(:'p2o', 'select 1 from public.partner_response_documents'), 1, 'AC7: P2 reads only its own file');
select is(
  pg_temp.val_as(:'mem', 'aal1', format(
    'select string_agg(case id when %L then ''d1'' when %L then ''d4'' when %L then ''d5'' end, '','' order by created_at) from public.partner_response_documents',
    :'d1', :'d4', :'d5')),
  'd1,d4,d5', 'AC7: an Acme member reads the scanned files of the responses to its requirement only (no staged, pending or rejected file)');
select is(pg_temp.n_as(:'own2', 'select 1 from public.partner_response_documents'), 0, 'NFR-S8: another employer reads nothing');
select is(pg_temp.n_as(:'wkr', 'select 1 from public.partner_response_documents'), 0, 'NFR-S8: a candidate reads nothing');
select alike(pg_temp.call_as(null, 'anon', 'select count(*) from public.partner_response_documents'), '42501|%',
  'AC7: anonymous is refused');
select alike(pg_temp.call_as(:'p1m', 'authenticated', 'select employer_organization_id from public.partner_response_documents', 'aal1'),
  '42501|%', 'NFR-S11: a partner selecting the employer''s id is refused');
select alike(pg_temp.call_as(:'mem', 'authenticated', 'select storage_path from public.partner_response_documents', 'aal1'),
  '42501|%', 'the object name is not readable: files open only through document-url');
select alike(pg_temp.call_as(:'p1m', 'authenticated', format(
  'insert into public.partner_response_documents (organization_id, requirement_id, employer_organization_id, storage_path, file_name, size_bytes) values (%L, %L, %L, ''x'', ''x.pdf'', 1)',
  :'p1', :'r', :'acme'), 'aal1'), '42501|%', 'a member cannot insert a row');
select alike(pg_temp.call_as(:'p1m', 'authenticated', format(
  'update public.partner_response_documents set file_name = ''Renamed.pdf'' where id = %L', :'d1'), 'aal1'), '42501|%',
  'a member cannot change a row');
select alike(pg_temp.call_as(:'own1', 'authenticated', format(
  'delete from public.partner_response_documents where id = %L', :'d1'), 'aal1'), '42501|%', 'the employer cannot delete a row');
select throws_ok(format('update public.partner_response_documents set file_name = ''Renamed.pdf'' where id = %L', :'d1'),
  '42501', 'CHARA_INVALID_STATE', 'even the owner cannot change what a file is');
select throws_ok(format('update public.partner_response_documents set scan_status = ''pending'', scanned_at = null where id = %L', :'d1'),
  '42501', 'CHARA_INVALID_STATE', 'a scanned file never goes back to pending');
select is(
  pg_temp.n_as(:'p1m', 'select 1 from storage.objects where bucket_id = ''partner-response-documents''') +
  pg_temp.n_as(:'mem', 'select 1 from storage.objects where bucket_id = ''partner-response-documents''') +
  pg_temp.n_as(:'p2o', 'select 1 from storage.objects where bucket_id = ''partner-response-documents''') +
  pg_temp.n_as(:'own2', 'select 1 from storage.objects where bucket_id = ''partner-response-documents''') +
  pg_temp.n_as(:'wkr', 'select 1 from storage.objects where bucket_id = ''partner-response-documents''') +
  pg_temp.n_as(:'stf', 'select 1 from storage.objects where bucket_id = ''partner-response-documents'''),
  0, 'AC6: the direct storage reads return 0 objects for every user');
select ok((select count(*) from storage.objects where bucket_id = 'partner-response-documents') > 0,
  'while the object exists for the owner');
select alike(pg_temp.call_as(:'p1m', 'authenticated', format(
  'insert into storage.objects (bucket_id, name) values (''partner-response-documents'', %L)', :'p1' || '/x/y'), 'aal1'),
  '42501|%', 'AC5: no user writes to the bucket directly');

-- Opening a file (AC6) ---------------------------------------------------------------------------------------------------------------

select is(pg_temp.open(:'mem', :'d1'), 'ok', 'AC6: an Acme member receives a link to a scanned file of P1''s response');
select is(pg_temp.result(), 'partner-response-documents:' || :'d1_path' || ':Company profile.pdf',
  'for the object of the file, downloaded under its name');
select is(pg_temp.open(:'p1m', :'d1'), 'ok', 'AC6: a P1 member receives a link');
select is(
  (select string_agg(format('%s:%s:%s', actor_id = :'mem', metadata ->> 'side', metadata ->> 'organization_id' = :'p1'), ',' order by id)
   from audit.log where action = 'response_document.opened' and entity_id = :'d1'),
  't:employer:t,f:partner:t', 'AC6: one audit row response_document.opened per opening, with the document, partner, actor and side');
select ok(not exists (select 1 from audit.log where action like 'response_document.%' and metadata ? 'employer_organization_id'),
  'NFR-S11: no document audit row names the employer');
select is(pg_temp.open(:'p2o', :'d1'), '42501|CHARA_FORBIDDEN|', 'AC6: a member of P2 is refused');
select is(pg_temp.open(:'own2', :'d1'), '42501|CHARA_FORBIDDEN|', 'AC6: an owner of Beta is refused');
select is(pg_temp.open(:'wkr', :'d1'), '42501|CHARA_FORBIDDEN|', 'AC6: a candidate is refused');
select is(pg_temp.open(:'stf', :'d1'), '42501|CHARA_FORBIDDEN|', 'AC6: a Platform Administrator is refused');
select alike(pg_temp.open(null, :'d1'), '42501|%', 'anonymous is refused at the EXECUTE grant');
select is(pg_temp.open(:'mem', gen_random_uuid()), '42501|CHARA_FORBIDDEN|', 'an unknown id answers as a refusal');
select is((select count(*)::integer from audit.log where action = 'response_document.opened'), 2, 'AC6: no refusal writes a log row');
select is(pg_temp.open(:'mem', :'d_p2'), '42501|CHARA_FORBIDDEN|', 'a staged file of another response is not the employer''s yet');
select is(pg_temp.open(:'p2o', :'d_p2'), 'ok', 'P2 opens its own staged file');
select is(pg_temp.open(:'mem', :'d7'), 'P0001|CHARA_DOCUMENT_NOT_SCANNED|', 'a pending file of the response is not opened');
select is(pg_temp.open(:'p1m', :'d8'), 'P0001|CHARA_DOCUMENT_NOT_SCANNED|', 'a rejected file is never opened');
update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.open(:'mem', :'d1'), '42501|CHARA_FORBIDDEN|release_off', 'release gate: no link while release_job_orders is off');
update private.settings set value = 'true' where key = 'release_job_orders';

-- Cross-tenant, both directions (NFR-S8) ---------------------------------------------------------------------------------------------

select is(pg_temp.reg(:'p2o', :'p2', :'rb', 'For Beta.pdf'), 'ok', 'P2 stages a file for Beta''s requirement');
select pg_temp.result() as d_b \gset
select is(pg_temp.scan(:'d_b', 'skipped'), 'skipped', 'scanned');
select is(pg_temp.respond(:'p2o', :'p2', :'rb'), 'ok', 'and responds to Beta');
select is(
  pg_temp.n_as(:'own2', 'select 1 from public.partner_response_documents') || ',' ||
  pg_temp.n_as(:'mem', format('select 1 from public.partner_response_documents where id = %L', :'d_b')),
  '1,0', 'NFR-S8: Beta reads its one file and Acme none of Beta''s; Beta none of Acme''s');
select is(pg_temp.open(:'own1', :'d_b') || ' ' || pg_temp.open(:'own2', :'d1'), '42501|CHARA_FORBIDDEN| 42501|CHARA_FORBIDDEN|',
  'NFR-S8: neither employer opens the other''s files');

-- Removing a file -------------------------------------------------------------------------------------------------------------------

select is(pg_temp.call_as(:'p2o', 'authenticated', format('select public.remove_response_document(%L, %L)', :'p2', :'d1'), 'aal1'),
  'P0002|CHARA_NOT_FOUND|', 'another partner cannot remove P1''s file');
select is(pg_temp.call_as(:'mem', 'authenticated', format('select public.remove_response_document(%L, %L)', :'acme', :'d1'), 'aal1'),
  '42501|CHARA_FORBIDDEN|partner_only', 'the employer cannot remove a file');
select is(pg_temp.call_as(:'p1m', 'authenticated', format('select public.remove_response_document(%L, %L)', :'p1', :'d4'), 'aal1'),
  'ok', 'a P1 member removes a file of its live response');
select is(
  (select count(*)::integer from public.partner_response_documents where id = :'d4') || ':'
    || (select count(*)::integer from audit.log where action = 'response_document.removed' and entity_id = :'d4'),
  '0:1', 'the row goes and one audit row response_document.removed is written');
select ok(exists (select 1 from pgmq.q_account_ops where message ->> 'bucket_id' = 'partner-response-documents'
                  and message ->> 'path' like :'p1' || '/' || :'d4' || '/%'),
  'its file is queued for removal from the bucket');
select is(pg_temp.call_as(:'p1m', 'authenticated', format('select public.withdraw_response(%L, %L)', :'p1', :'resp1'), 'aal1'),
  'ok', 'P1 withdraws its response');
select is(pg_temp.call_as(:'p1m', 'authenticated', format('select public.remove_response_document(%L, %L)', :'p1', :'d1'), 'aal1'),
  'P0001|CHARA_INVALID_STATE|withdrawn', 'a file of a withdrawn response stays');
select is(pg_temp.reg(:'p1m', :'p1', :'r', 'After.pdf'), 'P0001|CHARA_INVALID_STATE|withdrawn', 'and none is added');
select is(pg_temp.open(:'mem', :'d1'), 'ok', 'the employer still opens the files of the withdrawn response');

select pg_temp.req(:'acme') as r2 \gset
select is(pg_temp.reg(:'p1m', :'p1', :'r2', 'Staged.pdf'), 'ok', 'a file staged for a second requirement');
select pg_temp.result() as d_s \gset
select is(pg_temp.call_as(:'p1m', 'authenticated', format('select public.remove_response_document(%L, %L)', :'p1', :'d_s'), 'aal1'),
  'ok', 'a staged file is removed at any time');
select is(pg_temp.reg(:'p1m', :'p1', :'r2', 'Staged.pdf'), 'ok', 'another one');
select pg_temp.result() as d_s2 \gset
select is(pg_temp.scan(:'d_s2', 'skipped'), 'skipped', 'scanned');
select is(pg_temp.respond(:'p1m', :'p1', :'r2'), 'ok', 'P1 responds to the second requirement');
select pg_temp.result() as resp2 \gset
select is(pg_temp.close(:'r2', 'closed'), 'ok', 'Acme closes the second requirement');
select is(pg_temp.call_as(:'p1m', 'authenticated', format('select public.remove_response_document(%L, %L)', :'p1', :'d_s2'), 'aal1'),
  'P0001|CHARA_INVALID_STATE|requirement_closed', 'a file of a response to a closed requirement stays');
select is(pg_temp.reg(:'p1m', :'p1', :'r2', 'Closed.pdf'), 'P0001|CHARA_INVALID_STATE|requirement_closed',
  'and no file is added to it');

-- Stranded reservations (review M1) -----------------------------------------------------------------------------------------------

select pg_temp.req(:'acme') as r5 \gset
select is(pg_temp.reg(:'p2o', :'p2', :'r5', 'Stranded.pdf'), 'ok', 'a reservation whose upload never happens');
select pg_temp.result() as d_str \gset
select current_setting('t.path') as d_str_path \gset
alter table public.partner_response_documents disable trigger partner_response_documents_immutable;
update public.partner_response_documents set created_at = now() - interval '11 minutes' where id = :'d_str';
alter table public.partner_response_documents enable always trigger partner_response_documents_immutable;
update private.settings set value = '1' where key = 'response_documents_max';
select is(pg_temp.reg(:'p2o', :'p2', :'r5', 'Real.pdf'), 'ok',
  'a reservation without its file for more than 10 minutes does not count against the limit');
select pg_temp.result() as d_real \gset
select current_setting('t.path') as d_real_path \gset
select is(pg_temp.reg(:'p2o', :'p2', :'r5', 'Third.pdf'), 'P0001|CHARA_LIMIT_REACHED|response_documents_max',
  'a reservation younger than 10 minutes counts');
update private.settings set value = '5' where key = 'response_documents_max';
select is(pg_temp.respond(:'p2o', :'p2', :'r5'), 'P0001|CHARA_DOCUMENT_NOT_SCANNED|upload_missing',
  'a reservation younger than 10 minutes whose file has not arrived holds up the response, naming nothing');
insert into storage.objects (bucket_id, name, metadata)
values ('partner-response-documents', :'d_real_path', '{"mimetype": "application/pdf", "size": 2000000}');
select is(pg_temp.respond(:'p2o', :'p2', :'r5'), 'P0001|CHARA_DOCUMENT_NOT_SCANNED|scanning',
  'a file that arrived and is being scanned holds up the response with detail scanning');
select is(pg_temp.scan(:'d_real', 'skipped'), 'skipped', 'it is scanned');
select is(pg_temp.respond(:'p2o', :'p2', :'r5'), 'ok', 'the stranded reservation does not hold up the response');
select is(
  (select count(*)::integer from public.partner_response_documents where id = :'d_str') || ':' || pg_temp.removals(:'d_str_path')
    || ':' || (select (response_id is not null)::text from public.partner_response_documents where id = :'d_real'),
  '0:0:true', 'responding drops the stranded reservation without queueing a removal (there is no file) and attaches the scanned one');
select ok(pg_get_functiondef('private.rescan_pending_documents()'::regprocedure) ~ '30 days',
  'a pending response document with its file is announced again for 30 days, as long as it can hold up a response');
select ok(
  pg_get_functiondef('public.register_response_document(uuid, uuid, text, text, bigint)'::regprocedure) ~ 'p\.organization_id = p_org\s+for share'
  and pg_get_functiondef('public.remove_response_document(uuid, uuid)'::regprocedure) ~ 'p\.id = v_doc\.response_id for share'
  and pg_get_functiondef('private.partner_response_documents_reserved()'::regprocedure) ~ 'for share',
  'registration and removal hold the response row, the reservation trigger holds the pending row');
select ok(pg_get_functiondef('private.drop_stale_response_documents()'::regprocedure) ~ 'pg_try_advisory_xact_lock',
  'the clean-up skips a partner whose response lock is held');

-- Deletion and clean-up ------------------------------------------------------------------------------------------------------------------

select is(pg_temp.reg(:'p1m', :'p1', pg_temp.req(:'acme')), 'ok', 'a reservation whose file never arrives');
select pg_temp.result() as d_abandoned \gset
alter table public.partner_response_documents disable trigger partner_response_documents_immutable;
update public.partner_response_documents set created_at = now() - interval '3 hours' where id = :'d_abandoned';
alter table public.partner_response_documents enable always trigger partner_response_documents_immutable;
select pg_temp.req(:'acme') as r3 \gset
select is(pg_temp.reg(:'p1m', :'p1', :'r3', 'Old.pdf'), 'ok', 'a staged file left for a month');
select pg_temp.result() as d_old \gset
select is(pg_temp.scan(:'d_old', 'skipped'), 'skipped', 'scanned');
select is(pg_temp.reg(:'p1m', :'p1', :'r3', 'Fresh.pdf'), 'ok', 'a fresh staged file');
select pg_temp.result() as d_fresh \gset
alter table public.partner_response_documents disable trigger partner_response_documents_immutable;
update public.partner_response_documents set created_at = now() - interval '31 days' where id = :'d_old';
alter table public.partner_response_documents enable always trigger partner_response_documents_immutable;
select pg_temp.req(:'acme') as r4 \gset
select is(pg_temp.reg(:'p2o', :'p2', :'r4', 'Closing.pdf'), 'ok', 'a staged file of a requirement that then closes');
select pg_temp.result() as d_closing \gset
select is(pg_temp.close(:'r4', 'filled'), 'ok', 'Acme fills that requirement');
select is(private.drop_stale_response_documents(), 3, 'the clean-up drops the abandoned reservation, the old staged file and the staged file of the filled requirement');
select is(
  (select string_agg(case id when :'d_fresh' then 'fresh' when :'d_s2' then 'attached' end, ',' order by file_name)
   from public.partner_response_documents where id in (:'d_abandoned', :'d_old', :'d_closing', :'d_fresh', :'d_s2')),
  'fresh,attached', 'the fresh staged file and the file of a response stay');
select is((select count(*)::integer from audit.log where action = 'response_document.dropped'), 3, 'each drop is audited');
select is(private.drop_stale_response_documents(), 0, 'a second run finds nothing');

delete from public.partner_responses where id = :'resp2';
select is(
  (select count(*)::integer from public.partner_response_documents where id = :'d_s2') || ':'
    || (select count(*)::integer from pgmq.q_account_ops where message ->> 'path' like :'p1' || '/' || :'d_s2' || '/%'),
  '0:1', 'a response deleted (the retention of V58, an organisation) takes its files, whose removal is queued');

select * from finish();
rollback;
