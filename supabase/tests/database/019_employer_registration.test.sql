begin;
select plan(67);

\ir organizations_fixture.inc

-- FR-A2: the organization created at employer registration, its legal-entity identifier and the duplicate warning.

select pg_temp.new_user('00000000-0000-0000-0000-00000000a020', 'company', 'third@example.test');
update public.profiles set account_kind = intended_account_kind where id = '00000000-0000-0000-0000-00000000a020';
\set third '00000000-0000-0000-0000-00000000a020'

update private.settings set value = '30' where key = 'organizations_per_user_max';

-- Structure, grants and indexes
select hasnt_function('public', 'create_organization',
  array['organization_type', 'text', 'text', 'text', 'text'], 'the five-argument create_organization is gone');
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""'])
   from pg_proc where oid in (
     'public.create_organization(public.organization_type, text, text, text, text, text, text, text)'::regprocedure,
     'public.set_legal_entity_identifier(uuid, text, text)'::regprocedure))
  and has_function_privilege('authenticated', 'public.create_organization(public.organization_type, text, text, text, text, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_legal_entity_identifier(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.create_organization(public.organization_type, text, text, text, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.set_legal_entity_identifier(uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.create_organization(public.organization_type, text, text, text, text, text, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.set_legal_entity_identifier(uuid, text, text)', 'execute'),
  'both RPCs are security definer with an empty search_path and run for authenticated only'
);
select ok(
  not has_function_privilege('authenticated', 'private.legal_entity_identifier(text, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.legal_entity_trial_used(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.legal_entity_locked(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.legal_name_key(text)', 'execute'),
  'the helpers are not callable through the API'
);
select ok(
  exists (select 1 from pg_indexes where tablename = 'organizations' and indexdef like '%private.legal_name_key(legal_name)%')
  and exists (select 1 from pg_indexes where tablename = 'organizations' and indexdef like '%(legal_entity_identifier)%')
  and exists (select 1 from pg_indexes where tablename = 'organizations' and indexdef like '%(industry_code)%'),
  'the legal name key, the identifier and the industry are indexed'
);
select is(
  (select count(*) from information_schema.table_constraints
   where table_schema = 'public' and table_name = 'organizations' and constraint_name = 'organizations_industry_code_fkey'),
  1::bigint, 'the industry is a foreign key to the reference list'
);

-- Registration: organization X with no identifier yet
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    $$select set_config('t.x', public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'DE', 'F', 'https://acme-bau.example')::text, true)$$,
    'aal1'),
  'ok', 'an employer user at aal1 registers an organization with an industry'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(current_setting('t.x')::jsonb) k),
  array['duplicate_legal_name', 'organization_id', 'slug'],
  'the result holds the organization id, its slug and the duplicate flag, and no trial information'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s', o.type, o.status, o.based_in_country, o.industry_code, o.legal_entity_identifier is null,
     (select count(*) from public.organization_members m where m.organization_id = o.id and m.role = 'owner' and m.user_id = :'own1'
        and m.accepted_at is not null and m.invited_by is null))
   from public.organizations o where o.id = (current_setting('t.x')::jsonb ->> 'organization_id')::uuid),
  'employer|active|DE|F|t|1', 'the organization is active with its industry and no identifier, with one accepted owner'
);
select is(
  (select format('%s|%s|%s|%s|%s', actor_id, entity_type, entity_id = current_setting('t.x')::jsonb ->> 'organization_id',
     metadata ->> 'duplicate_legal_name', metadata ->> 'legal_entity_trial_used')
   from audit.log where action = 'organization_created' and entity_id = current_setting('t.x')::jsonb ->> 'organization_id'),
  format('%s|organization|t|false|false', :'own1'),
  'one organization_created audit row names the actor, the organization and both flags'
);
select is(
  (select count(*) from audit.log where action = 'organization_created' and entity_id = current_setting('t.x')::jsonb ->> 'organization_id'),
  1::bigint, 'the registration wrote exactly one audit row'
);

-- Atomicity: a failure after the organization row leaves nothing behind
create function public.fail_member_insert() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$;
create trigger fail_member_insert before insert on public.organization_members
  for each row execute function public.fail_member_insert();
select is(
  pg_temp.call_as(:'oth', 'authenticated', $$select public.create_organization('employer', 'Atomic Co', 'Atomic Co', 'DE', 'F')$$, 'aal1'),
  'P0001|forced failure|', 'a failure while the owner membership is written fails the whole call'
);
select is(
  (select count(*) from public.organizations where legal_name = 'Atomic Co')
  || '|' || (select count(*) from public.organization_members where user_id = :'oth')
  || '|' || (select count(*) from audit.log where action = 'organization_created' and actor_id = :'oth'),
  '0|0|0', 'no organization, membership or audit row remains from the failed call'
);
drop trigger fail_member_insert on public.organization_members;
select is(
  pg_temp.call_as(:'oth', 'authenticated', $$select public.create_organization('employer', 'Atomic Co', 'Atomic Co', 'DE', 'F')$$, 'aal1'),
  'ok', 'the same call succeeds once the failure is gone'
);
select is(
  (select count(*) from public.organizations where legal_name = 'Atomic Co')
  || '|' || (select count(*) from public.organization_members where user_id = :'oth' and role = 'owner')
  || '|' || (select count(*) from audit.log where action = 'organization_created' and actor_id = :'oth'),
  '1|1|1', 'the call leaves one organization, one owner membership and one audit row'
);

-- Duplicate legal name warns and never blocks
select is(
  pg_temp.call_as(:'own2', 'authenticated',
    $$select set_config('t.dup', public.create_organization('employer', 'ACME   Bau GmbH', 'Acme Two', 'DE', 'F')::text, true)$$, 'aal1'),
  'ok', 'a second company creates an organization with the same legal name apart from case and spacing'
);
select is(
  (current_setting('t.dup')::jsonb ->> 'duplicate_legal_name') || '|'
  || (select array_agg(k order by k)::text from jsonb_object_keys(current_setting('t.dup')::jsonb) k)
  || '|' || ((current_setting('t.dup')::jsonb ->> 'organization_id') <> (current_setting('t.x')::jsonb ->> 'organization_id')),
  'true|{duplicate_legal_name,organization_id,slug}|true',
  'the result says the name is in use and carries nothing about the other organization'
);
select is(
  (select metadata ->> 'duplicate_legal_name' from audit.log
   where action = 'organization_created' and entity_id = current_setting('t.dup')::jsonb ->> 'organization_id'),
  'true', 'the audit row records the duplicate'
);
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select set_config('t.nodup', public.create_organization('employer', 'Acme Bau AG', 'Acme Bau AG', 'DE', 'F')::text, true)$$, 'aal1'),
  'ok', 'a different legal name is created'
);
select is(current_setting('t.nodup')::jsonb ->> 'duplicate_legal_name', 'false', 'a different legal name is not a duplicate');
select is(
  (select count(*) from public.organizations where private.legal_name_key(legal_name) = 'acme bau gmbh'),
  2::bigint, 'both organizations with the duplicated name exist'
);

-- Identifier normalisation and validation
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select set_config('t.i1', public.create_organization('employer', 'Id Co One', 'Id Co One', 'DE', 'F', null, 'DE 123.456-789', 'vat_number')::text, true)$$, 'aal1'),
  'ok', 'an identifier with spaces, a dot and a hyphen is accepted'
);
select is(
  (select format('%s|%s', legal_entity_identifier, legal_entity_identifier_kind)
   from public.organizations where id = (current_setting('t.i1')::jsonb ->> 'organization_id')::uuid),
  'DE123456789|vat_number', 'it is stored upper case without the separators, with its kind'
);
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select set_config('t.i2', public.create_organization('employer', 'Id Co Two', 'Id Co Two', 'DE', 'F', null, 'ab/12', 'registration_number')::text, true)$$, 'aal1'),
  'ok', 'a short identifier with a slash is accepted at four characters'
);
select is(
  (select legal_entity_identifier from public.organizations where id = (current_setting('t.i2')::jsonb ->> 'organization_id')::uuid),
  'AB12', 'the slash is removed and the letters are upper case'
);
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select public.create_organization('employer', 'Id Co Three', 'Id Co Three', 'DE', 'F', null, 'x1', 'other')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|legal_entity_identifier', 'an identifier of two characters is refused'
);
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select public.create_organization('employer', 'Id Co Four', 'Id Co Four', 'DE', 'F', null, repeat('A', 33), 'other')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|legal_entity_identifier', 'an identifier of 33 characters is refused'
);
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select public.create_organization('employer', 'Id Co Five', 'Id Co Five', 'DE', 'F', null, repeat('A', 32), 'other')$$, 'aal1'),
  'ok', 'an identifier of 32 characters is accepted'
);
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select public.create_organization('employer', 'Id Co Six', 'Id Co Six', 'DE', 'F', null, 'AB#1234', 'other')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|legal_entity_identifier', 'an identifier with a character other than a letter or digit is refused'
);
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select public.create_organization('employer', 'Id Co Seven', 'Id Co Seven', 'DE', 'F', null, 'DE123456789', 'passport')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|legal_entity_identifier_kind', 'the kind passport is refused'
);
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select public.create_organization('employer', 'Id Co Eight', 'Id Co Eight', 'DE', 'F', null, 'DE123456789', null)$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|legal_entity_identifier_kind', 'an identifier without a kind is refused'
);
select is(
  (select count(*) from public.organizations where legal_name in ('Id Co Three', 'Id Co Four', 'Id Co Six', 'Id Co Seven', 'Id Co Eight')),
  0::bigint, 'the refused calls created no organization'
);
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select set_config('t.i3', public.create_organization('employer', 'Id Co Nine', 'Id Co Nine', 'DE', 'F', null, '  ', 'passport')::text, true)$$, 'aal1'),
  'ok', 'an empty identifier is accepted whatever the kind says'
);
select is(
  (select format('%s|%s', legal_entity_identifier is null, legal_entity_identifier_kind is null)
   from public.organizations where id = (current_setting('t.i3')::jsonb ->> 'organization_id')::uuid),
  't|t', 'an empty identifier stores null for both columns'
);
select throws_ok(
  $$insert into public.organizations (type, slug, legal_name, display_name, based_in_country, legal_entity_identifier)
    values ('employer', 'half-set', 'Half Set', 'Half Set', 'DE', 'DE123456789')$$,
  '23514', null, 'an identifier without a kind cannot be stored'
);

-- Wrong caller, wrong type, unknown reference data
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('employer', 'Bad Industry', 'Bad Industry', 'DE', 'ZZ')$$, 'aal1'),
  '23503|insert or update on table "organizations" violates foreign key constraint "organizations_industry_code_fkey"|Key (industry_code)=(ZZ) is not present in table "industries".',
  'an unknown industry is refused with a foreign-key violation'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('employer', 'No Industry', 'No Industry', 'DE', null)$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|industry_code', 'a missing industry is refused'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('employer', 'Lower Industry', 'Lower Industry', 'DE', ' f ')$$, 'aal1'),
  'ok', 'the industry code is trimmed and upper-cased'
);
select is(
  (select count(*) from public.organizations where legal_name in ('Bad Industry', 'No Industry')),
  0::bigint, 'the refused industries left no organization behind'
);
select is(
  pg_temp.call_as(:'wkr', 'authenticated', $$select public.create_organization('employer', 'Wk Co', 'Wk Co', 'DE', 'F')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|company_account_required', 'a worker is refused'
);
select is(
  pg_temp.call_as(:'sus', 'authenticated', $$select public.create_organization('employer', 'Su Co', 'Su Co', 'DE', 'F')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|profile_not_active', 'a suspended user is refused'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('recruitment_company', 'Rc Co', 'Rc Co', 'DE', 'F')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|organization_type_not_available', 'a recruitment company is refused in Phase 1'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('staffing_company', 'Sc Co', 'Sc Co', 'DE', 'F')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|organization_type_not_available', 'a staffing company is refused in Phase 1'
);

-- No subscription is created and no billing table is involved yet
select is(
  (select count(*) from information_schema.tables where table_schema = 'billing' and table_name = 'subscriptions'),
  0::bigint, 'the billing schema holds no subscription table that registration could fill (it arrives with FR-G1)'
);

-- Cross-tenant reads and direct writes
select is(
  pg_temp.val_as(:'own2', 'aal2', format($$select count(*) from public.organizations where id = %L$$, current_setting('t.x')::jsonb ->> 'organization_id')),
  '0', 'the owner of another organization cannot read organization X'
);
select is(
  pg_temp.val_as(:'nul', 'aal2', 'select count(*) from public.organizations'), '0', 'a user with no membership reads no organization'
);
select is(
  pg_temp.call_as(null, 'anon', 'select * from public.organizations'),
  '42501|permission denied for table organizations|', 'an anonymous caller cannot read organizations'
);
select is(
  pg_temp.call_as(null, 'anon', 'select * from public.organization_members'),
  '42501|permission denied for table organization_members|', 'an anonymous caller cannot read memberships'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated',
    format($$update public.organizations set legal_entity_identifier = 'ZZ999999', legal_entity_identifier_kind = 'other' where id = %L$$, current_setting('t.x')::jsonb ->> 'organization_id')),
  '42501|permission denied for table organizations|', 'an identifier cannot be written directly'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    $$insert into public.organizations (type, slug, legal_name, display_name, based_in_country) values ('employer', 'direct', 'Direct', 'Direct', 'DE')$$),
  '42501|permission denied for table organizations|', 'an organization cannot be inserted directly'
);

-- set_legal_entity_identifier: the owner at aal2 only, and only until billing exists
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values ((current_setting('t.x')::jsonb ->> 'organization_id')::uuid, :'adm', 'admin', now()),
       ((current_setting('t.x')::jsonb ->> 'organization_id')::uuid, :'mem', 'member', now());

select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.set_legal_entity_identifier(%L, 'DE 123 456 789', 'vat_number')$$, current_setting('t.x')::jsonb ->> 'organization_id')),
  'P0001|CHARA_FORBIDDEN|', 'an admin cannot set the identifier'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select public.set_legal_entity_identifier(%L, 'DE 123 456 789', 'vat_number')$$, current_setting('t.x')::jsonb ->> 'organization_id')),
  'P0001|CHARA_FORBIDDEN|', 'a member cannot set the identifier'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format($$select public.set_legal_entity_identifier(%L, 'DE 123 456 789', 'vat_number')$$, current_setting('t.x')::jsonb ->> 'organization_id')),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organization cannot set it'
);
select is(
  pg_temp.call_as(null, 'anon', format($$select public.set_legal_entity_identifier(%L, 'DE 123 456 789', 'vat_number')$$, current_setting('t.x')::jsonb ->> 'organization_id')),
  '42501|permission denied for function set_legal_entity_identifier|', 'an anonymous caller is refused at EXECUTE'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.set_legal_entity_identifier(%L, 'DE 123 456 789', 'vat_number')$$, current_setting('t.x')::jsonb ->> 'organization_id'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'the owner at aal1 is refused'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.set_legal_entity_identifier(%L, '  ', 'vat_number')$$, current_setting('t.x')::jsonb ->> 'organization_id')),
  'P0001|CHARA_INVALID_INPUT|legal_entity_identifier', 'an empty identifier cannot be set'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.set_legal_entity_identifier(%L, 'DE123456789', 'passport')$$, current_setting('t.x')::jsonb ->> 'organization_id')),
  'P0001|CHARA_INVALID_INPUT|legal_entity_identifier_kind', 'the kind passport cannot be set'
);
select is(
  (select legal_entity_identifier is null from public.organizations where id = (current_setting('t.x')::jsonb ->> 'organization_id')::uuid)
  || '|' || (select count(*) from audit.log where action = 'legal_entity_identifier_set'),
  'true|0', 'the refused calls changed nothing and wrote no audit row'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.set_legal_entity_identifier(%L, 'DE 123 456 789', 'vat_number')$$, current_setting('t.x')::jsonb ->> 'organization_id')),
  'ok', 'the owner at aal2 sets the identifier'
);
select is(
  (select format('%s|%s', legal_entity_identifier, legal_entity_identifier_kind)
   from public.organizations where id = (current_setting('t.x')::jsonb ->> 'organization_id')::uuid),
  'DE123456789|vat_number', 'it is stored normalised'
);
select is(
  (select format('%s|%s|%s', actor_id, metadata ->> 'kind', metadata::text like '%DE123456789%')
   from audit.log where action = 'legal_entity_identifier_set' and entity_id = current_setting('t.x')::jsonb ->> 'organization_id'),
  format('%s|vat_number|f', :'own1'), 'one audit row names the actor and the kind, and never the value'
);

-- Trial flag: replaced the way the billing migration will replace it
create or replace function private.legal_entity_trial_used(p_identifier text) returns boolean
language sql stable as $$ select coalesce(p_identifier = 'DE123456789', false) $$;
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select set_config('t.b1', public.create_organization('employer', 'Trial Co One', 'Trial Co One', 'DE', 'F', null, 'de 123 456 789', 'vat_number')::text, true)$$, 'aal1'),
  'ok', 'an organization naming a legal entity that had a trial is created, never blocked'
);
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select set_config('t.b2', public.create_organization('employer', 'Trial Co Two', 'Trial Co Two', 'FR', 'F', null, 'fr 999 999 999', 'vat_number')::text, true)$$, 'aal1'),
  'ok', 'an organization naming another legal entity is created'
);
select is(
  pg_temp.call_as(:'third', 'authenticated',
    $$select set_config('t.b3', public.create_organization('employer', 'Trial Co Three', 'Trial Co Three', 'DE', 'F')::text, true)$$, 'aal1'),
  'ok', 'an organization without an identifier is created'
);
select is(
  (select format('%s|%s|%s', max(metadata ->> 'legal_entity_trial_used') filter (where entity_id = current_setting('t.b1')::jsonb ->> 'organization_id'),
     max(metadata ->> 'legal_entity_trial_used') filter (where entity_id = current_setting('t.b2')::jsonb ->> 'organization_id'),
     max(metadata ->> 'legal_entity_trial_used') filter (where entity_id = current_setting('t.b3')::jsonb ->> 'organization_id'))
   from audit.log where action = 'organization_created'),
  'true|false|false', 'the audit rows flag the legal entity that had a trial, and an empty identifier never matches'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(current_setting('t.b1')::jsonb) k),
  array['duplicate_legal_name', 'organization_id', 'slug'], 'the result of the flagged call holds no trial information'
);

-- Locked after billing exists
create or replace function private.legal_entity_locked(p_org uuid) returns boolean
language sql stable as $$ select true $$;
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.set_legal_entity_identifier(%L, 'FR 999 999 999', 'vat_number')$$, current_setting('t.x')::jsonb ->> 'organization_id')),
  'P0001|CHARA_FORBIDDEN|legal_entity_identifier_locked', 'the owner cannot change the identifier once the lock applies'
);
select is(
  (select legal_entity_identifier from public.organizations where id = (current_setting('t.x')::jsonb ->> 'organization_id')::uuid),
  'DE123456789', 'the locked value is unchanged'
);

select * from finish();
rollback;
