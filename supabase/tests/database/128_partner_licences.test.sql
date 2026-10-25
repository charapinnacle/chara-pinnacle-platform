begin;
select plan(110);

\ir organizations_fixture.inc

-- Partner licences (V10, FR-J2 AC1, AC3 to AC6, AC8; DATA_MODEL.md sections 6, 7 and 10; decisions 2.6, 4.5; NFR-S8):
-- partner_licences, audit.partner_document_access_log, the licence RPCs, the evidence broker and scan result, the staff
-- list, the bucket partner-documents and the expiry job.

create function pg_temp.new_partner(p_id uuid, p_type text) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.add_member(p_org uuid, p_user uuid, p_role public.member_role) returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

-- Runs p_sql as the user (anonymous for a null user) at the level; the result of the statement lands in t.result.
create function pg_temp.run(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', (%s)::text, true)', p_sql), p_aal)
$$;

create function pg_temp.add(
  p_user uuid, p_org uuid, p_country text, p_authority text, p_number text, p_valid date, p_confirmed boolean default true,
  p_aal text default 'aal2'
) returns text
language sql as $$
  select pg_temp.run(p_user, format('public.add_partner_licence(%L, %L, %L, %L, %L, %L)',
    p_org, p_country, p_authority, p_number, p_valid, p_confirmed), p_aal)
$$;

create function pg_temp.today() returns date
language sql as $$ select (now() at time zone 'utc')::date $$;

create function pg_temp.grant_upload(p_user uuid, p_licence uuid, p_mime text, p_size bigint, p_aal text default 'aal2')
returns text
language sql as $$
  select pg_temp.run(p_user, format(
    '(select object_path from public.partner_document_access_grant(%L, ''evidence_upload'', %L, %L))', p_licence, p_mime, p_size),
    p_aal)
$$;

create function pg_temp.grant_review(p_user uuid, p_licence uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.run(p_user, format(
    '(select bucket_id || '':'' || file_name from public.partner_document_access_grant(%L, ''partner_review''))', p_licence),
    p_aal)
$$;

create function pg_temp.audits(p_licence uuid, p_action text) returns integer
language sql as $$
  select count(*)::integer from audit.log where entity_type = 'partner_licence' and entity_id = p_licence::text and action = p_action
$$;

create function pg_temp.removals(p_path text) returns integer
language sql as $$
  select count(*)::integer from pgmq.q_account_ops
  where message ->> 'action' = 'delete_organization_object' and message ->> 'path' = p_path
    and message ->> 'bucket_id' = 'partner-documents'
$$;

\set ow '00000000-0000-0000-0000-0000000f2001'
\set ad '00000000-0000-0000-0000-0000000f2002'
\set mb '00000000-0000-0000-0000-0000000f2003'
\set ow2 '00000000-0000-0000-0000-0000000f2004'
\set rev '00000000-0000-0000-0000-0000000f2005'
\set ts '00000000-0000-0000-0000-0000000f2006'
\set padm '00000000-0000-0000-0000-0000000f2007'
\set wkr2 '00000000-0000-0000-0000-0000000f2008'

-- Schema ---------------------------------------------------------------------------------------------------------------
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.partner_licences'::regclass)
  and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'audit.partner_document_access_log'::regclass),
  'RLS is enabled and forced on partner_licences and the access log'
);
select is(
  (select string_agg(r || ':' || has_column_privilege(r, 'public.partner_licences', 'evidence_path', 'select'), ',')
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:false',
  'decision 2.6: no API role may read the evidence path'
);
select is(
  (select string_agg(r || ':' || has_any_column_privilege(r, 'public.partner_licences', 'select') || ':'
     || has_any_column_privilege(r, 'public.partner_licences', 'insert, update'), ',')
   from unnest(array['anon', 'authenticated']) r),
  'anon:false:false,authenticated:true:false',
  'members read through a column grant; nobody writes the table directly'
);
select is(
  (select string_agg(r || ':' || has_any_column_privilege(r, 'audit.partner_document_access_log', 'select, insert, update'), ',')
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:false',
  'no API role reads or writes the access log'
);
select is(
  (select string_agg(p.oid::regprocedure::text || ':' || p.prosecdef || ':' || (p.proconfig = array['search_path=""']), ',' order by p.proname)
   from pg_proc p where p.oid in (
     'public.add_partner_licence(uuid, text, text, text, date, boolean)'::regprocedure,
     'public.update_partner_licence(uuid, text, text, text, date, boolean)'::regprocedure,
     'public.delete_partner_licence(uuid)'::regprocedure,
     'public.partner_document_access_grant(uuid, text, text, bigint)'::regprocedure,
     'public.partner_document_set_scan_status(uuid, text, text, text, bigint)'::regprocedure,
     'public.admin_list_partner_licences(uuid)'::regprocedure)),
  'add_partner_licence(uuid,text,text,text,date,boolean):true:true,admin_list_partner_licences(uuid):true:true,delete_partner_licence(uuid):true:true,partner_document_access_grant(uuid,text,text,bigint):true:true,partner_document_set_scan_status(uuid,text,text,text,bigint):true:true,update_partner_licence(uuid,text,text,text,date,boolean):true:true',
  'every licence function is security definer with an empty search_path'
);
select is(
  (select string_agg(f || ':' || has_function_privilege('anon', f, 'execute') || has_function_privilege('authenticated', f, 'execute')
     || has_function_privilege('service_role', f, 'execute'), ',')
   from unnest(array[
     'public.add_partner_licence(uuid, text, text, text, date, boolean)',
     'public.update_partner_licence(uuid, text, text, text, date, boolean)',
     'public.delete_partner_licence(uuid)',
     'public.partner_document_access_grant(uuid, text, text, bigint)',
     'public.admin_list_partner_licences(uuid)',
     'public.partner_document_set_scan_status(uuid, text, text, text, bigint)',
     'private.expire_partner_licences()',
     'private.check_licence_input(text, text, date, boolean, boolean)']) f),
  'public.add_partner_licence(uuid, text, text, text, date, boolean):falsetruefalse,public.update_partner_licence(uuid, text, text, text, date, boolean):falsetruefalse,public.delete_partner_licence(uuid):falsetruefalse,public.partner_document_access_grant(uuid, text, text, bigint):falsetruefalse,public.admin_list_partner_licences(uuid):falsetruefalse,public.partner_document_set_scan_status(uuid, text, text, text, bigint):falsefalsetrue,private.expire_partner_licences():falsefalsefalse,private.check_licence_input(text, text, date, boolean, boolean):falsefalsefalse',
  'the partner and staff RPCs run for authenticated, the scan result for service_role, the helpers for nobody'
);
select is(
  (select public || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'partner-documents'),
  'false:15728640:application/pdf,image/jpeg,image/png',
  'AC5: the bucket partner-documents is private, 15 MB, PDF, JPEG and PNG'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and (qual like '%partner-documents%' or with_check like '%partner-documents%')),
  0,
  'no storage policy opens the bucket to an API role: files move only through URLs signed by document-url'
);
select is(
  (select schedule || ' ' || command from cron.job where jobname = 'partner-licence-expiry'),
  '15 0 * * * select private.expire_partner_licences()',
  'AC8: the daily job partner-licence-expiry runs the expiry'
);
set local role anon;
select is(
  (select string_agg(key || '=' || value, ',' order by key) from public.get_public_settings()
   where key in ('licence_number_patterns', 'licence_valid_until_max_years')),
  'licence_number_patterns={},licence_valid_until_max_years=20',
  'the number formats (empty at launch) and the date bound are public settings the form reads'
);
reset role;

-- Fixture: Manila Skills (owner ow, admin ad, member mb), a rival partner (ow2), the employers of the shared fixture
-- (own1, own2), two candidates (wkr, wkr2), a Verification Reviewer, a Trust & Safety Administrator, a Platform
-- Administrator and anonymous.
update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(id, 'recruitment_company') from unnest(array[:'ow', :'ad', :'mb', :'ow2']::uuid[]) id;
select pg_temp.new_user(:'wkr2', 'worker');
update public.profiles set account_kind = intended_account_kind where id = :'wkr2';
select pg_temp.new_org(:'ow', 'recruitment_company') as manila \gset
select pg_temp.add_member(:'manila', :'ad', 'admin');
select pg_temp.add_member(:'manila', :'mb', 'member');
select pg_temp.new_org(:'ow2', 'recruitment_company') as rival \gset
select pg_temp.new_org(:'own1', 'employer') as emp1 \gset
select pg_temp.new_org(:'own2', 'employer') as emp2 \gset
select pg_temp.new_user(id) from unnest(array[:'rev', :'ts', :'padm']::uuid[]) id;
insert into public.platform_staff (user_id, role) values (:'rev', 'verification_reviewer'), (:'ts', 'trust_safety'), (:'padm', 'admin');

-- Release switch -------------------------------------------------------------------------------------------------------
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.add(:'ow', :'manila', 'PH', 'Department of Migrant Workers', 'DMW-1', pg_temp.today() + 30),
  'P0001|CHARA_FORBIDDEN|release_off', 'while release 2a is off no licence is added');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC1: the owner adds an entry --------------------------------------------------------------------------------------
select is(pg_temp.add(:'ow', :'manila', ' ph ', ' Department of Migrant Workers ', ' DMW-123-LB-031522-R ', date '2028-03-15'),
  'ok', 'AC1: the owner at aal2 adds an entry for PH');
select current_setting('t.result')::uuid as lic \gset
select is(
  (select concat_ws('|', country_code, issuing_authority, licence_number, valid_until, confirmed_at = now(),
     partner_terms_version = private.current_legal_version('partner-terms'), created_by = :'ow', status, evidence_path is null)
   from public.partner_licences where id = :'lic'),
  'PH|Department of Migrant Workers|DMW-123-LB-031522-R|2028-03-15|t|t|t|current|t',
  'AC1: the four values trimmed, the statement with the current Partner Terms version, created_by the owner, status current'
);
select is(pg_temp.audits(:'lic', 'partner_licence.created'), 1, 'AC1: one audit row partner_licence.created');
select ok(
  (select metadata::text not like '%DMW-123%' and metadata ->> 'country_code' = 'PH' from audit.log
   where entity_id = :'lic' and action = 'partner_licence.created'),
  'AC1: the audit row names the country, never the licence number'
);

-- AC3: database constraints and duplicates --------------------------------------------------------------------------
select alike(pg_temp.add(:'ow', :'manila', 'XX', 'Some Authority', 'ABC-123', pg_temp.today() + 30), '23503|%',
  'AC3: an unknown country fails on the foreign key');
select alike(pg_temp.add(:'ow', :'manila', 'PH', 'Some Authority', 'ABC-124', null), '23502|%',
  'AC3: a missing valid-until date fails on not null');
select is(pg_temp.add(:'ow', :'manila', 'PH', 'Some Authority', 'ABC-125', pg_temp.today() + 30, false),
  'P0001|CHARA_INVALID_INPUT|confirmation', 'AC3: an entry without the accuracy statement is refused');
select is(pg_temp.add(:'ow', :'manila', 'PH', 'Some Authority', 'ABC-125', pg_temp.today() + 30, null),
  'P0001|CHARA_INVALID_INPUT|confirmation', 'AC3: a missing statement is refused too');
select alike(pg_temp.add(:'ow', :'manila', 'PH', repeat('a', 201), 'ABC-126', pg_temp.today() + 30), '23514|%',
  'AC3: an authority of 201 characters fails on its check');
select is(pg_temp.add(:'ow', :'manila', 'PH', repeat('a', 200), 'ABC-127', pg_temp.today() + 30), 'ok',
  'an authority of 200 characters is accepted');
select alike(pg_temp.add(:'ow', :'manila', 'PH', 'A', 'ABC-128', pg_temp.today() + 30), '23514|%',
  'an authority of one character fails on its check');
select alike(pg_temp.add(:'ow', :'manila', 'PH', 'Some Authority', 'AB', pg_temp.today() + 30), '23514|%',
  'a number of two characters fails on its check');
select alike(pg_temp.add(:'ow', :'manila', 'PH', 'Some Authority', repeat('9', 65), pg_temp.today() + 30), '23514|%',
  'a number of 65 characters fails on its check');
select is(pg_temp.add(:'ow', :'manila', 'PH', 'Other Authority', 'DMW-123-LB-031522-R', pg_temp.today() + 90),
  'P0001|CHARA_CONFLICT|licence_number', 'AC3: the same country and number twice raises CHARA_CONFLICT licence_number');
select is(pg_temp.add(:'ow', :'manila', 'PH', 'Department of Migrant Workers', 'DMW-999-LB-031522-R', pg_temp.today() + 90),
  'ok', 'AC3: a second PH entry with another number succeeds');
select is(pg_temp.add(:'ow2', :'rival', 'PH', 'Department of Migrant Workers', 'DMW-123-LB-031522-R', pg_temp.today() + 90),
  'ok', 'the uniqueness is per organisation: another partner may declare the same number');
select is(pg_temp.add(:'ow', :'manila', 'DE', 'Bundesagentur', 'BA-1', pg_temp.today() - 1),
  'P0001|CHARA_INVALID_INPUT|valid_until', 'a valid-until date in the past is refused at entry');
select is(pg_temp.add(:'ow', :'manila', 'DE', 'Bundesagentur', 'BA-2', pg_temp.today()), 'ok', 'today is accepted');
select is(pg_temp.add(:'ow', :'manila', 'DE', 'Bundesagentur', 'BA-3', (pg_temp.today() + interval '20 years')::date), 'ok',
  'today + 20 years is accepted');
select is(pg_temp.add(:'ow', :'manila', 'DE', 'Bundesagentur', 'BA-4', (pg_temp.today() + interval '20 years')::date + 1),
  'P0001|CHARA_INVALID_INPUT|valid_until', 'today + 20 years + 1 day is refused');
update private.settings set value = '{"PH": "^DMW-[0-9A-Z-]{6,30}$"}' where key = 'licence_number_patterns';
select is(pg_temp.add(:'ow', :'manila', 'PH', 'Department of Migrant Workers', '123', pg_temp.today() + 30),
  'P0001|CHARA_INVALID_INPUT|licence_number', 'AC2: a number that does not match the configured PH format is refused');
select is(pg_temp.add(:'ow', :'manila', 'PH', 'Department of Migrant Workers', 'DMW-555-LB-R', pg_temp.today() + 30), 'ok',
  'a number that matches the format is accepted');
select is(pg_temp.add(:'ow', :'manila', 'FR', 'Prefecture', '123', pg_temp.today() + 30), 'ok',
  'AC2: a country without a pattern accepts any 3 to 64 characters');
update private.settings set value = '{}' where key = 'licence_number_patterns';

-- AC4: who writes and who reads ---------------------------------------------------------------------------------------
select is(pg_temp.add(:'ad', :'manila', 'GB', 'Gangmasters Authority', 'GLAA-1', pg_temp.today() + 60), 'ok',
  'AC4: the admin at aal2 adds an entry');
select current_setting('t.result')::uuid as lic_ad \gset
select is(pg_temp.audits(:'lic_ad', 'partner_licence.created'), 1, 'AC4: the admin''s change writes one audit row');
select is(pg_temp.add(:'ad', :'manila', 'GB', 'Gangmasters Authority', 'GLAA-2', pg_temp.today() + 60, true, 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'AC4: the admin at aal1 gets aal2_required');
select is(pg_temp.add(:'mb', :'manila', 'GB', 'Gangmasters Authority', 'GLAA-3', pg_temp.today() + 60),
  'P0001|CHARA_FORBIDDEN|', 'AC4: the member may not add');
select is(pg_temp.add(:'ow2', :'manila', 'GB', 'Gangmasters Authority', 'GLAA-4', pg_temp.today() + 60),
  'P0001|CHARA_FORBIDDEN|', 'AC4: the other partner may not add');
select is(pg_temp.add(:'own1', :'manila', 'GB', 'Gangmasters Authority', 'GLAA-5', pg_temp.today() + 60),
  'P0001|CHARA_FORBIDDEN|', 'AC4: an employer admin may not add');
select is(pg_temp.add(:'wkr', :'manila', 'GB', 'Gangmasters Authority', 'GLAA-6', pg_temp.today() + 60),
  'P0001|CHARA_FORBIDDEN|', 'AC4: a worker may not add');
select alike(pg_temp.add(null, :'manila', 'GB', 'Gangmasters Authority', 'GLAA-7', pg_temp.today() + 60), '42501|%',
  'AC4: anonymous is refused at the EXECUTE grant');
select is(pg_temp.add(:'own1', :'emp1', 'GB', 'Gangmasters Authority', 'GLAA-8', pg_temp.today() + 60),
  'P0001|CHARA_FORBIDDEN|partner_only', 'an employer cannot declare licences for its own organisation');

select is(pg_temp.run(:'ad', format('public.update_partner_licence(%L, ''GB'', ''Gangmasters and Labour Abuse Authority'', ''GLAA-1'', %L, true)',
  :'lic_ad', pg_temp.today() + 60)), 'ok', 'AC4: the admin at aal2 updates an entry');
select is(
  (select metadata -> 'changed' from audit.log where entity_id = :'lic_ad' and action = 'partner_licence.updated'),
  '["issuing_authority"]'::jsonb, 'AC4: one audit row names the changed field, never the number'
);
select is(pg_temp.run(:'mb', format('public.update_partner_licence(%L, ''GB'', ''X Authority'', ''GLAA-1'', %L, true)',
  :'lic_ad', pg_temp.today() + 60)), 'P0001|CHARA_FORBIDDEN|', 'AC4: the member may not update');
select is(pg_temp.run(:'ow2', format('public.update_partner_licence(%L, ''GB'', ''X Authority'', ''GLAA-1'', %L, true)',
  :'lic_ad', pg_temp.today() + 60)), 'P0001|CHARA_FORBIDDEN|', 'AC4: the other partner may not update');
select is(pg_temp.run(:'ow', format('public.update_partner_licence(%L, ''GB'', ''X Authority'', ''GLAA-1'', %L, false)',
  :'lic_ad', pg_temp.today() + 60)), 'P0001|CHARA_INVALID_INPUT|confirmation', 'an update needs a new statement');
select is(pg_temp.run(:'ow', format('public.update_partner_licence(%L, ''PH'', ''X Authority'', ''DMW-999-LB-031522-R'', %L, true)',
  :'lic_ad', pg_temp.today() + 60)), 'P0001|CHARA_CONFLICT|licence_number', 'an update onto another entry''s number conflicts');
select is(pg_temp.run(:'ow', format('public.update_partner_licence(%L, ''GB'', ''X Authority'', ''GLAA-1'', %L, true)',
  gen_random_uuid(), pg_temp.today() + 60)), 'P0002|CHARA_NOT_FOUND|', 'an unknown entry is not found');

select is(pg_temp.run(:'mb', format('public.delete_partner_licence(%L)', :'lic_ad')), 'P0001|CHARA_FORBIDDEN|',
  'AC4: the member may not delete');
select is(pg_temp.run(:'own1', format('public.delete_partner_licence(%L)', :'lic_ad')), 'P0001|CHARA_FORBIDDEN|',
  'AC4: an employer may not delete');
select is(pg_temp.run(:'ad', format('public.delete_partner_licence(%L)', :'lic_ad')), 'ok', 'AC4: the admin at aal2 deletes');
select is(pg_temp.audits(:'lic_ad', 'partner_licence.deleted'), 1, 'the deletion writes one audit row');
select is(pg_temp.run(:'ad', format('public.delete_partner_licence(%L)', :'lic_ad')), 'P0002|CHARA_NOT_FOUND|',
  'a second deletion finds nothing');

select is(pg_temp.val_as(:'mb', 'aal1', format('select count(*) from public.partner_licences where organization_id = %L', :'manila')),
  (select count(*)::text from public.partner_licences where organization_id = :'manila'),
  'AC4: the member reads every entry of the own organisation');
select alike(pg_temp.call_as(:'mb', 'authenticated', 'select evidence_path from public.partner_licences'), '42501|%',
  'AC4: the member cannot read the evidence path');
select alike(pg_temp.call_as(null, 'anon', 'select id from public.partner_licences'), '42501|%',
  'AC4: anonymous is refused at the SELECT grant');

-- NFR-S8: cross-tenant reads, with two employers, two partners, two candidates and anonymous.
select is(
  (select string_agg(u.label || '=' || pg_temp.val_as(u.id, 'aal2', 'select count(*) from public.partner_licences'), ',' order by u.label)
   from (values ('a_own1', :'own1'::uuid), ('b_own2', :'own2'::uuid), ('c_wkr', :'wkr'::uuid), ('d_wkr2', :'wkr2'::uuid),
                ('e_rev', :'rev'::uuid)) u (label, id)),
  'a_own1=0,b_own2=0,c_wkr=0,d_wkr2=0,e_rev=0',
  'NFR-S8, AC4: employers, candidates and staff read no entry directly'
);
select is(pg_temp.val_as(:'ow2', 'aal2', 'select string_agg(distinct organization_id::text, '','') from public.partner_licences'),
  :'rival', 'NFR-S8: a competing partner reads only its own entries');
select is(pg_temp.val_as(:'ow', 'aal2', format('select count(*) from public.partner_licences where organization_id = %L', :'rival')),
  '0', 'NFR-S8: and Manila Skills none of the rival''s');

-- AC5: evidence upload ------------------------------------------------------------------------------------------------
select is(pg_temp.grant_upload(:'ow', :'lic', 'application/pdf', 15728640), 'ok', 'AC5: a 15 MB PDF gets an upload grant');
select current_setting('t.result') as path1 \gset
select ok(:'path1' ~ ('^' || :'manila' || '/' || :'lic' || '/[0-9a-f-]{36}$'), 'AC1: the file goes under the organisation and licence id');
select is(
  (select concat_ws('|', evidence_mime, evidence_size_bytes, evidence_scan_status) from public.partner_licences where id = :'lic'),
  'application/pdf|15728640|pending', 'the entry waits for the file'
);
select is(pg_temp.grant_upload(:'ow', :'lic', 'application/pdf', 15728641), 'P0001|CHARA_INVALID_INPUT|file',
  'AC5: a file of 15 MB + 1 byte is refused');
select is(pg_temp.grant_upload(:'ow', :'lic', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000),
  'P0001|CHARA_INVALID_INPUT|file', 'AC5: a DOCX is refused');
select is(pg_temp.grant_upload(:'ow', :'lic', 'image/svg+xml', 1000), 'P0001|CHARA_INVALID_INPUT|file', 'AC5: an SVG is refused');
select is(pg_temp.grant_upload(:'ow', :'lic', 'application/pdf', 15728640), 'ok', 'a new upload grant replaces the reserved file');
select current_setting('t.result') as path2 \gset
select is(pg_temp.removals(:'path1'), 1, 'a replaced file is queued for removal through account-ops');
select is(pg_temp.grant_upload(:'ad', :'lic', 'image/jpeg', 2000000), 'ok', 'AC5: a JPG gets an upload grant');
select is(pg_temp.grant_upload(:'ad', :'lic', 'image/png', 2000000), 'ok', 'AC5: a PNG gets an upload grant');
select current_setting('t.result') as path_png \gset
select is(pg_temp.grant_upload(:'ad', :'lic', 'image/png', 2000, 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'the admin at aal1 gets aal2_required');
select is(pg_temp.grant_upload(:'mb', :'lic', 'image/png', 2000), 'P0001|CHARA_FORBIDDEN|', 'AC4: the member cannot upload');
select is(pg_temp.grant_upload(:'ow2', :'lic', 'image/png', 2000), 'P0002|CHARA_NOT_FOUND|', 'AC5: another partner gets not found');
select is(pg_temp.grant_review(:'own1', :'lic'), 'P0002|CHARA_NOT_FOUND|', 'AC5: an employer admin gets not found for a read');
select alike(pg_temp.grant_review(null, :'lic'), '42501|%', 'AC5: anonymous is refused at the EXECUTE grant');
select is(pg_temp.run(:'ow', format('(select count(*) from public.partner_document_access_grant(%L, ''owner_download''))', :'lic')),
  'P0001|CHARA_INVALID_INPUT|purpose', 'an unknown purpose is refused');

-- The bucket accepts an object only at the name the entry waits for.
select throws_ok(format('insert into storage.objects (bucket_id, name) values (''partner-documents'', %L)', :'path1'),
  '42501', 'CHARA_NOT_FOUND', 'a replaced reservation no longer accepts a file');
select lives_ok(format('insert into storage.objects (bucket_id, name, metadata) values (''partner-documents'', %L, ''{"mimetype": "image/png", "size": 2000000}'')', :'path_png'),
  'the reserved name accepts the file');

-- AC5: a file not yet scanned cannot be opened by staff.
select is(pg_temp.grant_review(:'rev', :'lic'), 'P0001|CHARA_DOCUMENT_NOT_SCANNED|', 'AC5: staff cannot open an unscanned file');

-- The scan result (service role).
select alike(pg_temp.call_as(:'ow', 'authenticated', format(
  'select public.partner_document_set_scan_status(%L, %L, ''skipped'', ''image/png'', 2000000)', :'lic', :'path_png')), '42501|%',
  'a partner cannot report a scan result');
set local role service_role;
select throws_ok(format('select public.partner_document_set_scan_status(%L, %L, ''skipped'', ''image/png'', 2000000)', :'lic', :'path1'),
  'P0002', 'CHARA_NOT_FOUND', 'a stale object name is not the entry''s file');
reset role;
set local role service_role;
select is(public.partner_document_set_scan_status(:'lic', :'path_png', 'skipped', 'image/png', 2000000), 'skipped',
  'scan-document clears the reserved file whose type and size match');
select is(public.partner_document_set_scan_status(:'lic', :'path_png', 'rejected', 'image/png', 2000000), 'skipped',
  'a repeat leaves the entry as it is');
reset role;
select is(pg_temp.audits(:'lic', 'partner_licence.evidence_scanned'), 1, 'the verdict is audited once');

-- AC6: staff open the evidence and read the entries --------------------------------------------------------------------
select is(pg_temp.grant_review(:'rev', :'lic'), 'ok', 'AC6: the Verification Reviewer at aal2 gets the file');
select is(current_setting('t.result'), 'partner-documents:licence-ph.png', 'the file downloads under a neutral name');
select is(pg_temp.grant_review(:'ts', :'lic'), 'ok', 'AC6: the Trust & Safety Administrator at aal2 gets the file');
select is(
  (select string_agg(concat_ws(':', accessed_by, staff_role, organization_id = :'manila', purpose), ',' order by id)
   from audit.partner_document_access_log where licence_id = :'lic'),
  :'rev' || ':verification_reviewer:t:partner_review,' || :'ts' || ':trust_safety:t:partner_review',
  'AC6: each URL writes one access-log row with staff user, role, licence and purpose'
);
select is(pg_temp.grant_review(:'padm', :'lic'), 'P0002|CHARA_NOT_FOUND|', 'AC6: the Platform Administrator gets no evidence');
select is(pg_temp.grant_review(:'rev', :'lic', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'AC6: the reviewer at aal1 gets aal2_required');
select is(pg_temp.grant_review(:'ow', :'lic'), 'P0002|CHARA_NOT_FOUND|', 'the owner does not open the file through the staff purpose');
select is((select count(*)::integer from audit.partner_document_access_log where licence_id = :'lic'), 2,
  'refused requests write no log row');
select is(pg_temp.val_as(:'padm', 'aal2', format('select count(*) from public.admin_list_partner_licences(%L)', :'manila')),
  (select count(*)::text from public.partner_licences where organization_id = :'manila'),
  'AC6: the Platform Administrator reads the entries');
select is(pg_temp.val_as(:'rev', 'aal2', format('select string_agg(evidence_scan_status, '','') from public.admin_list_partner_licences(%L) where id = %L', :'manila', :'lic')),
  'skipped', 'AC6: the reviewer reads the entry with its evidence state');
select is(pg_temp.run(:'rev', format('(select count(*) from public.admin_list_partner_licences(%L))', :'manila'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'AC6: the reviewer at aal1 gets aal2_required on the list');
select is(pg_temp.run(:'ow', format('(select count(*) from public.admin_list_partner_licences(%L))', :'manila')),
  'P0001|CHARA_FORBIDDEN|', 'a partner cannot use the staff list');
select throws_ok('update audit.partner_document_access_log set purpose = purpose', '42501', null, 'AC6: the log refuses UPDATE');
select throws_ok('delete from audit.partner_document_access_log', '42501', null, 'AC6: the log refuses DELETE');

-- Deleting an entry with a file queues the file's removal.
select is(pg_temp.run(:'ow', format('public.delete_partner_licence(%L)', :'lic')), 'ok', 'the owner deletes the entry with its file');
select is(pg_temp.removals(:'path_png'), 1, 'the file is queued for removal through account-ops');
select is((select count(*)::integer from audit.partner_document_access_log where licence_id = :'lic'), 2,
  'the access log outlives the entry');

-- AC8: expiry ----------------------------------------------------------------------------------------------------------
insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until, confirmed_at, partner_terms_version)
values (:'rival', 'DE', 'Agency', 'E-30', pg_temp.today() + 30, now(), 1),
       (:'rival', 'DE', 'Agency', 'E-31', pg_temp.today() + 31, now(), 1),
       (:'rival', 'DE', 'Agency', 'E-YESTERDAY', pg_temp.today() - 1, now(), 1),
       (:'rival', 'DE', 'Agency', 'E-TODAY', pg_temp.today(), now(), 1);
select is(private.expire_partner_licences(), 1, 'AC8: the job marks one entry');
select is(
  (select string_agg(licence_number || ':' || status, ',' order by licence_number) from public.partner_licences
   where organization_id = :'rival' and country_code = 'DE'),
  'E-30:current,E-31:current,E-TODAY:current,E-YESTERDAY:expired',
  'AC8: the entry valid until yesterday is expired, the one valid until today is still current'
);
select is(private.expire_partner_licences(), 0, 'AC8: a second run on the same day changes nothing');
select is(
  (select count(*)::integer from audit.log where action = 'partner_licence.expired'
     and entity_id = (select id::text from public.partner_licences where licence_number = 'E-YESTERDAY')),
  1, 'the expiry is audited once'
);
select is(pg_temp.val_as(:'ow2', 'aal2', 'select status from public.partner_licences where licence_number = ''E-YESTERDAY'''),
  'expired', 'AC8: the expired entry stays visible to the owner');
select is(pg_temp.val_as(:'rev', 'aal2', format('select status from public.admin_list_partner_licences(%L) where licence_number = ''E-YESTERDAY''', :'rival')),
  'expired', 'AC8: and to staff');
select is(pg_temp.run(:'ow2', format('public.update_partner_licence(%L, ''DE'', ''Agency'', ''E-YESTERDAY'', %L, true)',
  (select id from public.partner_licences where licence_number = 'E-YESTERDAY'), pg_temp.today() + 365)), 'ok',
  'Expired -> Current: the owner renews the date with a new statement');
select is((select status from public.partner_licences where licence_number = 'E-YESTERDAY'), 'current', 'the renewed entry is current again');

select * from finish();
rollback;
