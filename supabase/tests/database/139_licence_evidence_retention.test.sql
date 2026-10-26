begin;
select plan(21);

\ir status_fixture.inc

-- The retention of replaced licence evidence and of the evidence access log (V19; FR-S3 AC4 licence part; SOP P2-43
-- steps Configure and Apply, output "deleted expired data with audit counts", KPI "retention job runs without error",
-- controls daily job with audit; NFR-O5, NFR-S8).

\set reason 'Shorter period agreed with CHARA.'

create function pg_temp.last_run(p_entity text) returns text
language sql as $$
  select metadata::text from audit.log where action = 'retention.run' and entity_id = p_entity order by id desc limit 1
$$;

create function pg_temp.removals(p_path text) returns integer
language sql as $$
  select count(*)::integer from pgmq.q_account_ops
  where message ->> 'action' = 'delete_organization_object' and message ->> 'path' = p_path
    and message ->> 'bucket_id' = 'partner-documents'
$$;

-- A partner organisation of p_type with an owner, whose id is returned in t.owner.
create function pg_temp.partner(p_type public.organization_type) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (v_owner, v_owner || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = v_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Partner ' || left(v_id::text, 8), 'Partner ' || left(v_id::text, 8), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, v_owner, 'owner', now());
  perform set_config('t.owner', v_owner::text, true);
  return v_id;
end;
$$;

select is(
  (select days || ':' || editable from private.retention_policies where entity = 'partner_document_access_log'), '730:true',
  'the access log of licence evidence has a period of 730 days, editable'
);

-- AC4 (licence evidence) and the Apply step --------------------------------------------------------------------------
update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.partner('recruitment_company') as pa \gset
select current_setting('t.owner') as pa_owner \gset
select pg_temp.partner('staffing_company') as pb \gset
select current_setting('t.owner') as pb_owner \gset

insert into public.partner_licences (id, organization_id, country_code, issuing_authority, licence_number, valid_until,
  evidence_path, evidence_mime, evidence_size_bytes, evidence_scan_status, evidence_requested_at, confirmed_at, partner_terms_version)
values
  ('00000000-0000-0000-0000-0000000e1901', :'pa', 'PH', 'Department of Migrant Workers', 'DMW-1901', current_date + 200,
   :'pa' || '/00000000-0000-0000-0000-0000000e1901/' || '11111111-1111-1111-1111-111111111901', 'application/pdf', 1000, 'clean', now(), now(), 1),
  ('00000000-0000-0000-0000-0000000e1902', :'pa', 'NP', 'Department of Foreign Employment', 'DOFE-1902', current_date - 1,
   :'pa' || '/00000000-0000-0000-0000-0000000e1902/' || '11111111-1111-1111-1111-111111111902', 'application/pdf', 1000, 'clean', now(), now(), 1);
update public.partner_licences set status = 'expired' where id = '00000000-0000-0000-0000-0000000e1902';

select is(
  pg_temp.call_as(:'pa_owner', 'authenticated', $$select public.delete_partner_licence('00000000-0000-0000-0000-0000000e1901')$$),
  'ok', 'the partner removes a licence entry with a scanned file'
);
select is(
  (select cause || ':' || (retired_at > now() - interval '1 minute') from private.retired_licence_evidence
   where licence_id = '00000000-0000-0000-0000-0000000e1901'),
  'removed:true', 'AC4: its evidence is retired from the moment of the removal'
);
select is(pg_temp.removals(:'pa' || '/00000000-0000-0000-0000-0000000e1901/11111111-1111-1111-1111-111111111901'), 0,
  'AC4: and not removed from the bucket yet');

insert into private.retired_licence_evidence (licence_id, organization_id, storage_path, cause, retired_at) values
  ('00000000-0000-0000-0000-0000000e1903', :'pa', :'pa' || '/00000000-0000-0000-0000-0000000e1903/22222222-2222-2222-2222-222222221931', 'replaced', now() - interval '31 days'),
  ('00000000-0000-0000-0000-0000000e1904', :'pb', :'pb' || '/00000000-0000-0000-0000-0000000e1904/22222222-2222-2222-2222-222222221929', 'replaced', now() - interval '29 days');
select throws_ok(
  format($$insert into private.retired_licence_evidence (licence_id, organization_id, storage_path, cause)
    values ('00000000-0000-0000-0000-0000000e1905', %L, %L, 'replaced')$$, :'pa', :'pb' || '/00000000-0000-0000-0000-0000000e1905/22222222-2222-2222-2222-222222221905'),
  '23514', null, 'a retired file must lie in the folder of its own organisation and licence'
);

insert into audit.partner_document_access_log (licence_id, organization_id, accessed_by, staff_role, purpose, accessed_at) values
  ('00000000-0000-0000-0000-0000000e1902', :'pa', :'st_review', 'verification_reviewer', 'partner_review', now() - interval '731 days'),
  ('00000000-0000-0000-0000-0000000e1902', :'pa', :'st_review', 'verification_reviewer', 'partner_review', now() - interval '729 days');

select lives_ok($$select private.apply_retention()$$, 'KPI: the daily retention job runs without error');
select is(
  (select string_agg(right(storage_path, 4), ',' order by storage_path) from private.retired_licence_evidence
   where licence_id in ('00000000-0000-0000-0000-0000000e1903', '00000000-0000-0000-0000-0000000e1904')),
  '1929', 'AC4: the file replaced 31 days ago leaves the table, the one replaced 29 days ago is kept'
);
select is(
  pg_temp.removals(:'pa' || '/00000000-0000-0000-0000-0000000e1903/22222222-2222-2222-2222-222222221931') || ':'
    || pg_temp.removals(:'pb' || '/00000000-0000-0000-0000-0000000e1904/22222222-2222-2222-2222-222222221929'),
  '1:0', 'AC4: the 31-day file is queued for removal from the private bucket through account-ops, the 29-day one is not'
);
select is(pg_temp.last_run('licence_evidence'), '{"days": 30, "removed": 1}', 'Apply: the run records the entity, the period and the count');
select is(
  (select concat_ws('|', status, evidence_scan_status) from public.partner_licences where id = '00000000-0000-0000-0000-0000000e1902')
    || '|' || pg_temp.removals(:'pa' || '/00000000-0000-0000-0000-0000000e1902/11111111-1111-1111-1111-111111111902'),
  'expired|clean|0', 'AC4: an expired entry still in place keeps its evidence'
);
select is(
  (select count(*)::integer from audit.partner_document_access_log where licence_id = '00000000-0000-0000-0000-0000000e1902'), 1,
  'the access log of licence evidence keeps 730 days: the 731-day row is deleted, the 729-day row kept'
);
select is(pg_temp.last_run('partner_document_access_log'), '{"days": 730, "removed": 1}', 'and that run is audited too');
select is(current_setting('chara.retention_run'), 'off', 'the deletion exception of the access log ends with the run');
select throws_ok(
  $$delete from audit.partner_document_access_log$$, '42501', null, 'outside the run the access log stays append-only'
);

select private.apply_retention();
select is(
  pg_temp.last_run('licence_evidence') || pg_temp.last_run('partner_document_access_log'),
  '{"days": 30, "removed": 0}{"days": 730, "removed": 0}', 'a second run the same day deletes nothing and records count 0'
);

select is(
  pg_temp.val_as(:'st_admin', 'aal2', format($$select public.admin_set_retention_policy('licence_evidence', 28, %L)::text$$, :'reason')),
  'true', 'NFR-O5: the administrator shortens the evidence period without a deployment'
);
select private.apply_retention();
select is(
  (select count(*)::integer from private.retired_licence_evidence where licence_id = '00000000-0000-0000-0000-0000000e1904')
    || ':' || pg_temp.last_run('licence_evidence'),
  '0:{"days": 28, "removed": 1}', 'the next run reads the new period'
);

-- NFR-S8: no API role reaches the retired files -----------------------------------------------------------------------
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.retired_licence_evidence'::regclass),
  'RLS is enabled and forced on retired_licence_evidence'
);
select is(
  (select count(*)::integer from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
   where has_table_privilege(r.rol, 'private.retired_licence_evidence', 'select, insert, update, delete, truncate, references, trigger')),
  0, 'NFR-S8: no API role holds a privilege on it'
);
create temp table readers (label text primary key, uid uuid, db_role text);
insert into readers values
  ('anonymous', null, 'anon'), ('partner A owner', :'pa_owner', 'authenticated'), ('partner B owner', :'pb_owner', 'authenticated'),
  ('employer A owner', :'own1', 'authenticated'), ('employer B owner', :'own2', 'authenticated'),
  ('candidate A', :'wa', 'authenticated'), ('candidate B', :'wb', 'authenticated');
select is(
  (select count(*)::integer from readers r
   where pg_temp.call_as(r.uid, r.db_role, 'select * from private.retired_licence_evidence') ~ '^42501\|'),
  7, 'NFR-S8: two partners, two employers, two candidates and the anonymous caller are all refused the retired files'
);
select is(
  (select string_agg(p.oid::regprocedure::text || ':' || has_function_privilege('authenticated', p.oid, 'execute')
     || has_function_privilege('service_role', p.oid, 'execute'), ',')
   from pg_proc p where p.oid = 'private.retire_licence_evidence(uuid, uuid, text, text)'::regprocedure),
  'private.retire_licence_evidence(uuid,uuid,text,text):falsefalse', 'only the definer functions retire a file'
);

update private.settings set value = 'false' where key = 'release_partner_directories';

select * from finish();
rollback;
