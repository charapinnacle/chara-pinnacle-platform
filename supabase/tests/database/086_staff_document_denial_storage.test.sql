-- FR-F3 AC2: no platform staff role sees, adds, changes or removes an object of the private bucket. Every staff role is
-- tried at aal1 and at aal2; the owner is the positive control.
begin;
select plan(10);

\ir privacy_fixture.inc

create temp table staff (name text primary key, uid uuid not null, aal text not null);
insert into staff values
  ('admin at aal2', :'slg', 'aal2'), ('admin at aal1', :'slg', 'aal1'),
  ('verification_reviewer at aal2', :'adm2', 'aal2'), ('verification_reviewer at aal1', :'adm2', 'aal1'),
  ('trust_safety at aal2', :'late', 'aal2'), ('trust_safety at aal1', :'late', 'aal1');

select pg_temp.doc(:'d1', :'wa');
select pg_temp.doc(:'d2', :'wa', 'skipped', 'certificate');
select set_config('t.path', :'wa' || '/' || :'d1' || '/cv.pdf', true), set_config('t.free', :'wa' || '/' || :'d2' || '/cv.pdf', true);
insert into storage.objects (bucket_id, name) values ('passport-documents', current_setting('t.path'));
select md5(string_agg(o::text, '|' order by o.name)) as objects_before from storage.objects o where o.bucket_id = 'passport-documents' \gset

select is(
  pg_temp.affected_as(:'wa', 'authenticated', $$select * from storage.objects where bucket_id = 'passport-documents'$$), 1::bigint,
  'AC2: W reads the own object, so the zero rows below are an answer of the policy'
);
select is_empty(
  $$select s.name from staff s
    where pg_temp.affected_as(s.uid, 'authenticated', $q$select * from storage.objects where bucket_id = 'passport-documents'$q$, s.aal) <> 0$$,
  'AC2: the SELECT on the bucket returns no object to any staff role at either assurance level'
);
select is_empty(
  $$select s.name from staff s
    where pg_temp.affected_as(s.uid, 'authenticated', format($q$select * from storage.objects where name = %L$q$, current_setting('t.path')), s.aal) <> 0$$,
  'AC2: nor does a SELECT by the exact name of the object of W'
);
select is_empty(
  $$select s.name, s.aal, r.outcome
    from staff s
    cross join lateral (select pg_temp.call_as(s.uid, 'authenticated',
      format($q$insert into storage.objects (bucket_id, name) values ('passport-documents', %L)$q$, current_setting('t.free')), s.aal) as outcome) r
    where r.outcome !~ '^42501\|new row violates row-level security policy for table "objects"\|'$$,
  'AC2: an INSERT under the folder of W, with the id of a row of W, is a row-level security violation (SQLSTATE 42501) for every staff role'
);
select is_empty(
  $$select s.name, s.aal, r.outcome
    from staff s
    cross join lateral (select pg_temp.call_as(s.uid, 'authenticated',
      format($q$insert into storage.objects (bucket_id, name) values ('passport-documents', %L)$q$, s.uid || '/' || gen_random_uuid() || '/cv.pdf'), s.aal) as outcome) r
    where r.outcome !~ '^42501\|new row violates row-level security policy for table "objects"\|'$$,
  'AC2: and so is an INSERT under the own folder of the staff member, which has no row of the uploader'
);
select is_empty(
  $$select s.name from staff s
    where pg_temp.affected_as(s.uid, 'authenticated', format($q$update storage.objects set name = name || 'x' where name = %L$q$, current_setting('t.path')), s.aal) <> 0$$,
  'AC2: an UPDATE of the object of W affects 0 rows'
);
-- The Storage API sets this switch before it deletes in the name of a user, so the policies decide; the trigger refuses a plain statement.
select set_config('storage.allow_delete_query', 'true', true);
select is_empty(
  $$select s.name from staff s
    where pg_temp.affected_as(s.uid, 'authenticated', format($q$delete from storage.objects where name = %L$q$, current_setting('t.path')), s.aal) <> 0$$,
  'AC2: a DELETE of the object of W affects 0 rows'
);
select is(
  (select md5(string_agg(o::text, '|' order by o.name)) from storage.objects o where o.bucket_id = 'passport-documents'), :'objects_before',
  'AC2: after all of them the object exists and is unchanged, and no other object was added'
);
select is(
  pg_temp.affected_as(null, 'anon', $$select * from storage.objects where bucket_id = 'passport-documents'$$), 0::bigint,
  'AC2: anon sees no object either'
);
select is(
  pg_temp.affected_as(:'wa', 'authenticated', format($$delete from storage.objects where name = %L$$, current_setting('t.path'))), 1::bigint,
  'AC2: the same DELETE removes the object when W runs it, so the 0 rows of the staff roles are the policy and not the switch'
);

select * from finish();
rollback;
