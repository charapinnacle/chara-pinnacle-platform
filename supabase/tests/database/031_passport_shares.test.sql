begin;
select plan(29);

\ir privacy_fixture.inc

select pg_temp.doc(:'d1', :'wa');
select pg_temp.doc(:'d2', :'wa');

-- The SQLSTATE of a statement run as the table owner, or 'ok'; the failed statement is rolled back.
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.new_share(p_scope text, p_application uuid default gen_random_uuid(), p_consent bigint default null) returns text
language sql as $$
  select pg_temp.try(format(
    $f$insert into public.passport_shares (worker_user_id, organization_id, application_id, scope, consent_id)
       values (%L, %L, %L, %L::jsonb, coalesce(%L::bigint, (select max(id) from public.consents)))$f$,
    current_setting('t.a'), current_setting('t.o'), p_application, p_scope, p_consent))
$$;

select set_config('t.a', :'wa', true);
select pg_temp.share(current_setting('t.o')::uuid, :'wa', array[:'d1']::uuid[]);

select set_eq(
  $$select polname::text from pg_policy where polrelid = 'public.passport_shares'::regclass$$,
  $$values ('passport_shares_select_own')$$,
  'the only policy on passport_shares is the owner select; there is none for an organisation, staff or any write'
);
select is(
  (select value from private.settings where key = 'share_expiry_days_after_final'),
  '30'::jsonb, 'AC8: the share expiry after a final state is a setting and its default is 30 days'
);

select is(pg_temp.new_share('[]'), 'ok', 'a share may hold no document');
select is(pg_temp.new_share(format('["%s", "%s"]', :'d1', :'d2')), 'ok', 'a scope of two document ids is accepted');
select is(pg_temp.new_share('"cv"'), '23514', 'a scope that is not an array is refused');
select is(pg_temp.new_share('["cv"]'), '23514', 'D18: a document type in the scope is refused');
select is(pg_temp.new_share('[123]'), '23514', 'a number in the scope is refused');
select is(pg_temp.new_share(format('["%s"]', upper(:'d1'))), '23514', 'a scope id is a lower-case uuid, the form the lookup compares');
select is(pg_temp.new_share(format('[{"id": "%s"}]', :'d1')), '23514', 'an object in the scope is refused');
select is(
  pg_temp.new_share('[]', (select application_id from public.passport_shares limit 1)),
  '23505', 'one application has one share'
);

-- The guard: only the revocation and the expiry may be written, each once.
select set_config('t.s', (select id::text from public.passport_shares where scope = to_jsonb(array[:'d1']::uuid[])), true);
select is(
  pg_temp.try(format($$update public.passport_shares set scope = '[]' where id = %L$$, current_setting('t.s'))),
  'P0001', 'the scope of a share cannot change after it is made'
);
select is(
  pg_temp.try(format($$update public.passport_shares set organization_id = %L where id = %L$$, current_setting('t.p'), current_setting('t.s'))),
  'P0001', 'the organisation of a share cannot change'
);
select is(
  pg_temp.try(format($$update public.passport_shares set consent_id = (select max(id) from public.consents) where id = %L$$, current_setting('t.s'))),
  'ok', 'a consent row that is the same one is no change'
);
select is(
  pg_temp.try(format($$update public.passport_shares set application_id = gen_random_uuid() where id = %L$$, current_setting('t.s'))),
  'P0001', 'the application of a share cannot change'
);
select is(
  pg_temp.try(format($$update public.passport_shares set expires_at = now() + interval '30 days' where id = %L$$, current_setting('t.s'))),
  'ok', 'the expiry is set once'
);
select is(
  pg_temp.try(format($$update public.passport_shares set expires_at = now() + interval '7 days' where id = %L$$, current_setting('t.s'))),
  'P0001', 'the expiry is not changed afterwards'
);
select is(
  pg_temp.try(format($$update public.passport_shares set expires_at = null where id = %L$$, current_setting('t.s'))),
  'P0001', 'the expiry is not cleared'
);
select is(
  pg_temp.try(format($$update public.passport_shares set revoked_at = now() where id = %L$$, current_setting('t.s'))),
  'ok', 'the share is revoked once'
);
select is(
  pg_temp.try(format($$update public.passport_shares set revoked_at = null where id = %L$$, current_setting('t.s'))),
  'P0001', 'a revoked share is not made active again'
);

-- Audit rows: the organisation and the application, never a document or a person.
select is(
  (select string_agg(action, ',' order by id) from audit.log where entity_type = 'passport_shares' and entity_id = current_setting('t.s')),
  'share.created,share.expiry_set,share.revoked', 'the share is audited when it is made, given an expiry and revoked'
);
select is(
  (select string_agg(distinct k, ',' order by k) from audit.log l, jsonb_object_keys(l.metadata) k
   where l.entity_type = 'passport_shares'),
  'application_id,organization_id', 'the share audit rows carry no document id and no person'
);

-- Who can read it: the candidate their own, nobody else, nobody writes.
select is(pg_temp.affected_as(:'wa', 'authenticated', 'select 1 from public.passport_shares', 'aal1'), 3::bigint, 'the candidate reads the own shares');
select is(pg_temp.affected_as(:'wb', 'authenticated', 'select 1 from public.passport_shares', 'aal1'), 0::bigint, 'another candidate reads none');
select is(
  pg_temp.affected_as(:'own1', 'authenticated', 'select 1 from public.passport_shares', 'aal2')
  + pg_temp.affected_as(:'adm', 'authenticated', 'select 1 from public.passport_shares', 'aal2')
  + pg_temp.affected_as(:'mem', 'authenticated', 'select 1 from public.passport_shares', 'aal1'),
  0::bigint, 'the owner, an admin and a member of the organisation that holds the share read none'
);
select is(
  pg_temp.affected_as(:'slg', 'authenticated', 'select 1 from public.passport_shares', 'aal2')
  + pg_temp.affected_as(:'adm2', 'authenticated', 'select 1 from public.passport_shares', 'aal2')
  + pg_temp.affected_as(:'late', 'authenticated', 'select 1 from public.passport_shares', 'aal2'),
  0::bigint, 'no platform staff role reads a share'
);
select is(
  split_part(pg_temp.call_as(null, 'anon', 'select 1 from public.passport_shares'), '|', 1),
  '42501', 'anonymous callers have no grant on passport_shares'
);
select is(
  pg_temp.state_as(:'wa', format($$insert into public.passport_shares (worker_user_id, organization_id, application_id, scope, consent_id)
    values (%L, %L, gen_random_uuid(), '[]', (select max(id) from public.consents))$$, :'wa', current_setting('t.o'))),
  '42501', 'a candidate cannot write a share through the API'
);
select is(
  pg_temp.state_as(:'wa', 'update public.passport_shares set revoked_at = null') || pg_temp.state_as(:'wa', 'delete from public.passport_shares'),
  '4250142501', 'and cannot change or delete one'
);
select is(
  split_part(pg_temp.call_as(null, 'service_role', 'select 1 from public.passport_shares'), '|', 1),
  '42501', 'service_role has no grant on passport_shares'
);

select * from finish();
rollback;
