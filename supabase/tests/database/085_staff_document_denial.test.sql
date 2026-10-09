-- FR-F3 AC1, AC3, AC4: no platform staff role reads or changes the document metadata or the shares of a candidate, opens a
-- document through document_access_grant or reads the access log. Every staff role is tried at aal1 and at aal2, none of
-- them a member of the sharing organisation. The positive controls prove that the statements are able to see the rows.
begin;
select plan(27);

\ir privacy_fixture.inc

\set newdoc '00000000-0000-0000-0000-0000000d0099'

select set_config('t.w', :'wa', true), set_config('t.d1', :'d1', true);

create function pg_temp.o() returns uuid language sql as $$ select current_setting('t.o')::uuid $$;
create function pg_temp.logged() returns bigint language sql as $$ select count(*) from audit.document_access_log $$;

create temp table staff (name text primary key, uid uuid not null, aal text not null);
insert into staff values
  ('admin at aal2', :'slg', 'aal2'), ('admin at aal1', :'slg', 'aal1'),
  ('verification_reviewer at aal2', :'adm2', 'aal2'), ('verification_reviewer at aal1', :'adm2', 'aal1'),
  ('trust_safety at aal2', :'late', 'aal2'), ('trust_safety at aal1', :'late', 'aal1');

-- Candidate W (wa): a cv that is shared with O, a certificate, and an expired certificate. Candidate B has one more.
select pg_temp.doc(:'d1', :'wa');
select pg_temp.doc(:'d2', :'wa', 'skipped', 'certificate');
select pg_temp.doc(:'d3', :'wa', 'skipped', 'certificate');
update public.worker_documents set expires_on = current_date - 30 where id = :'d3';
select pg_temp.doc(:'dc', :'wb');
select pg_temp.share(pg_temp.o(), :'wa', array[:'d1']::uuid[]);

select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'ok', 'setup: a member of O opens the shared cv, so the log has a row of W');

select md5(string_agg(t::text, '|' order by t.id)) as docs_before from public.worker_documents t \gset
select md5(string_agg(t::text, '|' order by t.id)) as shares_before from public.passport_shares t \gset
select pg_temp.logged() as log_before \gset

-- AC1: reads
select is(pg_temp.affected_as(:'wa', 'authenticated', 'select * from public.worker_documents'), 3::bigint, 'AC1: W reads the own three document rows');
select is(pg_temp.affected_as(:'wa', 'authenticated', 'select * from public.passport_shares'), 1::bigint, 'AC1: and the own share');
select is(
  pg_temp.val_as(:'wa', 'aal1', format('select count(*) from public.worker_documents where worker_user_id = %L', :'wa')), '3',
  'AC1: the count of W for W is 3, so a count of 0 below is an answer of the policy'
);
select is_empty(
  $$select s.name, t.tbl, pg_temp.affected_as(s.uid, 'authenticated', format('select * from public.%I', t.tbl), s.aal) as n
    from staff s cross join (values ('worker_documents'), ('passport_shares')) t (tbl)
    where pg_temp.affected_as(s.uid, 'authenticated', format('select * from public.%I', t.tbl), s.aal) <> 0$$,
  'AC1: select * returns no row of either table for any staff role at either assurance level'
);
select is_empty(
  $$select s.name, t.tbl from staff s cross join (values ('worker_documents'), ('passport_shares')) t (tbl)
    where pg_temp.val_as(s.uid, s.aal, format('select count(*) from public.%I where worker_user_id = %L', t.tbl, current_setting('t.w'))) <> '0'$$,
  'AC1: and the count of the rows of W is 0 for each of them'
);

-- AC1: writes
create temp table writes as
select s.name, t.tbl, t.verb,
  case when t.verb = 'update' and t.tbl = 'worker_documents'
       then pg_temp.affected_as(s.uid, 'authenticated', t.sql, s.aal)::text
       else pg_temp.call_as(s.uid, 'authenticated', t.sql, s.aal) end as outcome
from staff s cross join (values
  ('worker_documents', 'insert', format($$insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes)
     values (%L, %L, 'cv', 'Planted', %L, 'cv.pdf', 'application/pdf', 10)$$, :'newdoc', :'wa', :'wa' || '/' || :'newdoc' || '/cv.pdf')),
  ('worker_documents', 'update', format($$update public.worker_documents set title = 'Changed' where worker_user_id = %L$$, :'wa')),
  ('worker_documents', 'delete', format($$delete from public.worker_documents where worker_user_id = %L$$, :'wa')),
  ('passport_shares', 'insert', format($$insert into public.passport_shares (worker_user_id, organization_id, application_id, scope, consent_id)
     values (%L, %L, gen_random_uuid(), '[]', 1)$$, :'wa', current_setting('t.o'))),
  ('passport_shares', 'update', format($$update public.passport_shares set revoked_at = now() where worker_user_id = %L$$, :'wa')),
  ('passport_shares', 'delete', format($$delete from public.passport_shares where worker_user_id = %L$$, :'wa'))
) t (tbl, verb, sql);

select is((select count(*) from writes), 36::bigint, 'AC1: six staff callers tried six statements');
select is_empty(
  $$select name, outcome from writes where tbl = 'worker_documents' and verb = 'insert'
      and outcome !~ '^42501\|new row violates row-level security policy for table "worker_documents"\|'$$,
  'AC1: an INSERT with the id of W is a row-level security violation (SQLSTATE 42501) for every staff caller'
);
select is_empty(
  $$select name, outcome from writes where tbl = 'worker_documents' and verb = 'update' and outcome <> '0'$$,
  'AC1: an UPDATE of the rows of W affects 0 rows'
);
select is_empty(
  $$select name, tbl, verb, outcome from writes
    where (tbl, verb) in (('worker_documents', 'delete'), ('passport_shares', 'insert'), ('passport_shares', 'update'), ('passport_shares', 'delete'))
      and outcome !~ ('^42501\|permission denied for table ' || tbl || '\|')$$,
  'AC1: the DELETE of a document and every write to a share is refused by the missing grant (SQLSTATE 42501)'
);
select is(
  (select md5(string_agg(t::text, '|' order by t.id)) from public.worker_documents t), :'docs_before',
  'AC1: after all of them the document rows are unchanged'
);
select is(
  (select md5(string_agg(t::text, '|' order by t.id)) from public.passport_shares t), :'shares_before',
  'AC1: and so are the shares'
);
select is_empty(
  $$select r.role_name, t.tbl, call.outcome
    from (values ('anon'), ('service_role')) r (role_name)
    cross join (values ('worker_documents'), ('passport_shares')) t (tbl)
    cross join lateral (select pg_temp.call_as(null, r.role_name, format('select * from public.%I', t.tbl)) as outcome) call
    where call.outcome !~ ('^42501\|permission denied for table ' || t.tbl || '\|')$$,
  'AC1: anon and service_role get permission denied on both tables, because neither has a grant'
);

-- AC3: the access function
create temp table opens as
select s.name, d.doc, p.purpose, pg_temp.call_as(s.uid, 'authenticated', format('select * from public.document_access_grant(%L, %L)', d.doc, p.purpose), s.aal) as outcome
from staff s
cross join (values (:'d1'::uuid), (:'d2'::uuid)) d (doc)
cross join (values ('application_review'), ('owner_download')) p (purpose);

select is((select count(*) from opens), 24::bigint, 'AC3: six staff callers asked for the shared cv and for the unshared certificate, for each of the two purposes');
select is_empty(
  $$select * from opens where outcome <> '42501|CHARA_FORBIDDEN|'$$,
  'AC3: every call raises CHARA_FORBIDDEN (SQLSTATE 42501), so none returns a bucket or a path'
);
select is(pg_temp.logged(), :'log_before'::bigint, 'AC3: the access log has the same number of rows after all of them');

-- AC3: a staff user who is also a member is treated as a member, never as staff
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (pg_temp.o(), :'late', 'member', now());
select is(pg_temp.grant_as(:'late', :'d1'), 'ok', 'AC3: a Trust & Safety Administrator who is a member of O opens the cv shared with O, as a member');
select is(pg_temp.grant_as(:'late', :'d2'), '42501|CHARA_FORBIDDEN|', 'AC3: and still gets nothing for the certificate that is shared with nobody');
select is(
  (select accessed_by from audit.document_access_log order by id desc limit 1), :'late'::uuid, 'AC3: the opening is logged with the person as accessor'
);
select is(pg_temp.logged(), :'log_before'::bigint + 1, 'AC3: and is the only row that was added');

-- AC4: the log
select is_empty(
  $$select name, outcome from (
      select s.name, pg_temp.call_as(s.uid, 'authenticated', 'select * from audit.document_access_log', s.aal) as outcome from staff s
    ) q where outcome !~ '^42501\|permission denied for table document_access_log\|'$$,
  'AC4: select * from the log is refused for every staff role, there is no table grant'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', 'select id, document_id from audit.document_access_log'), 2::bigint,
  'AC4: W reads the own two rows of the log through the column grant'
);
select is_empty(
  $$select s.name from staff s
    where pg_temp.affected_as(s.uid, 'authenticated', 'select id, document_id, worker_user_id, organization_id from audit.document_access_log', s.aal) <> 0$$,
  'AC4: the granted columns show no row to any staff role, not even the row that the staff member made as a member'
);
select is(pg_temp.affected_as(:'wa', 'authenticated', 'select 1 from public.v_my_document_access_log'), 2::bigint, 'AC4: W sees both openings in the view');
select is_empty(
  $$select s.name from staff s
    where pg_temp.affected_as(s.uid, 'authenticated', 'select 1 from public.v_my_document_access_log', s.aal) <> 0$$,
  'AC4: the view returns no row to any staff role, because it is filtered on the candidate'
);
select is_empty(
  $$select s.name, s.aal from staff s cross join (values ('insert'), ('update'), ('delete')) v (verb)
    where pg_temp.call_as(s.uid, 'authenticated', case v.verb
      when 'insert' then format('insert into audit.document_access_log (document_id, worker_user_id, accessed_by, purpose) values (%L, %L, %L, ''application_review'')', current_setting('t.d1'), current_setting('t.w'), s.uid)
      when 'update' then 'update audit.document_access_log set purpose = ''owner_download'''
      else 'delete from audit.document_access_log' end, s.aal) !~ '^42501\|'$$,
  'AC4: no staff role can write the log: insert, update and delete are refused'
);
select is(pg_temp.logged(), :'log_before'::bigint + 1, 'AC4: and the log still has its two rows');

select * from finish();
rollback;
