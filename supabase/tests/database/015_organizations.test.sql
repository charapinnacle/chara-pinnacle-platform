begin;
select plan(86);

\ir organizations_fixture.inc

create function pg_temp.unindexed_policy_columns() returns setof text
language sql as $$
  select format('%s.%s', c.relname, a.attname)
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_depend d on d.classid = 'pg_policy'::regclass and d.objid = p.oid
    and d.refclassid = 'pg_class'::regclass and d.refobjid = c.oid and d.refobjsubid > 0
  join pg_attribute a on a.attrelid = c.oid and a.attnum = d.refobjsubid
  where n.nspname = 'public'
    and c.relname in ('organizations', 'organization_members', 'organization_invitations')
    and not exists (
      select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum and i.indpred is null
    )
  group by 1
  order by 1
$$;

-- Structure and grants
select has_table('public', 'organizations', 'organizations exists');
select has_table('public', 'organization_members', 'organization_members exists');
select has_table('public', 'organization_invitations', 'organization_invitations exists');
select enum_has_labels('public', 'organization_type', array['employer', 'recruitment_company', 'staffing_company'],
  'the organization type keeps all three company types (D7)');
select enum_has_labels('public', 'member_role', array['owner', 'admin', 'member'], 'the member roles exist');
select enum_has_labels('public', 'organization_status', array['active', 'suspended'], 'the organization statuses exist');
select columns_are('public', 'organizations',
  array['id', 'type', 'slug', 'legal_name', 'display_name', 'based_in_country', 'website', 'status', 'created_at'],
  'organizations has the organization columns');
select columns_are('public', 'organization_members',
  array['organization_id', 'user_id', 'role', 'invited_by', 'accepted_at'],
  'organization_members has the membership columns');
select columns_are('public', 'organization_invitations',
  array['id', 'organization_id', 'email', 'role', 'token_hash', 'invited_by', 'created_at', 'expires_at', 'accepted_at'],
  'organization_invitations has the invitation columns');
select is(
  (select count(*) from pg_class
   where oid in ('public.organizations'::regclass, 'public.organization_members'::regclass, 'public.organization_invitations'::regclass)
     and relrowsecurity and relforcerowsecurity),
  3::bigint, 'all three tables have RLS enabled and forced'
);
select ok(
  not has_table_privilege('authenticated', 'public.organizations', 'insert, update, delete, truncate')
  and not has_table_privilege('authenticated', 'public.organization_members', 'insert, update, delete, truncate')
  and not has_table_privilege('authenticated', 'public.organization_invitations', 'insert, update, delete, truncate')
  and not has_any_column_privilege('authenticated', 'public.organizations', 'insert, update')
  and not has_any_column_privilege('authenticated', 'public.organization_members', 'insert, update')
  and not has_any_column_privilege('authenticated', 'public.organization_invitations', 'insert, update'),
  'authenticated cannot write any of the three tables; only the RPCs do'
);
select ok(
  not has_table_privilege('anon', 'public.organizations', 'select')
  and not has_any_column_privilege('anon', 'public.organization_members', 'select')
  and not has_any_column_privilege('anon', 'public.organization_invitations', 'select')
  and not has_any_column_privilege('service_role', 'public.organizations', 'select, insert, update')
  and not has_any_column_privilege('service_role', 'public.organization_members', 'select, insert, update')
  and not has_any_column_privilege('service_role', 'public.organization_invitations', 'select, insert, update'),
  'anon and service_role have no access to the three tables'
);
select ok(
  not has_column_privilege('authenticated', 'public.organization_invitations', 'token_hash', 'select')
  and has_column_privilege('authenticated', 'public.organization_invitations', 'email', 'select'),
  'the token hash of an invitation is not readable through the API'
);
select is_empty($$select * from pg_temp.unindexed_policy_columns()$$, 'every column used in a policy of the three tables leads an index');

create policy probe_unindexed on public.organizations for select to authenticated using (legal_name is not null);
select results_eq($$select * from pg_temp.unindexed_policy_columns()$$, $$values ('organizations.legal_name')$$,
  'detector: a policy on an unindexed column is reported');
drop policy probe_unindexed on public.organizations;

select ok(
  (select bool_and(prosecdef and provolatile = 's' and proconfig = array['search_path=""'])
   from pg_proc where oid in ('private.member_org_ids(public.member_role)'::regprocedure,
     'private.is_org_member(uuid, public.member_role)'::regprocedure, 'private.org_type(uuid)'::regprocedure))
  and has_function_privilege('authenticated', 'private.member_org_ids(public.member_role)', 'execute')
  and has_function_privilege('authenticated', 'private.is_org_member(uuid, public.member_role)', 'execute')
  and has_function_privilege('authenticated', 'private.org_type(uuid)', 'execute')
  and has_function_privilege('authenticated', 'private.is_aal2()', 'execute')
  and not has_function_privilege('anon', 'private.member_org_ids(public.member_role)', 'execute')
  and not has_function_privilege('anon', 'private.org_type(uuid)', 'execute'),
  'the membership helpers are stable security definer with an empty search_path and run for authenticated only'
);
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""'])
   from pg_proc where oid in (
     'public.create_organization(public.organization_type, text, text, text, text)'::regprocedure,
     'public.invite_member(uuid, text, public.member_role)'::regprocedure,
     'public.accept_invitation(text)'::regprocedure,
     'public.change_member_role(uuid, uuid, public.member_role)'::regprocedure,
     'public.remove_member(uuid, uuid)'::regprocedure,
     'public.transfer_ownership(uuid, uuid)'::regprocedure))
  and not exists (
    select 1 from pg_proc p
    cross join unnest(array['anon', 'service_role']) r (rolname)
    where p.oid in (
      'public.create_organization(public.organization_type, text, text, text, text)'::regprocedure,
      'public.invite_member(uuid, text, public.member_role)'::regprocedure,
      'public.accept_invitation(text)'::regprocedure,
      'public.change_member_role(uuid, uuid, public.member_role)'::regprocedure,
      'public.remove_member(uuid, uuid)'::regprocedure,
      'public.transfer_ownership(uuid, uuid)'::regprocedure)
      and has_function_privilege(r.rolname, p.oid, 'execute')
  ),
  'the six RPCs are security definer with an empty search_path and not executable by anon or service_role'
);
select ok(
  not has_function_privilege('authenticated', 'private.assert_org_manager(uuid, public.member_role)', 'execute')
  and not has_function_privilege('authenticated', 'private.check_one_owner()', 'execute')
  and not has_function_privilege('authenticated', 'private.role_rank(public.member_role)', 'execute'),
  'the internal helpers are not callable through the API'
);
select is(
  (select prorows from pg_proc where oid = 'private.member_org_ids(public.member_role)'::regprocedure),
  5::real, 'member_org_ids tells the planner to expect a handful of rows, not 1000'
);
select ok(
  exists (select 1 from pg_indexes where tablename = 'organization_members' and indexdef like '%(invited_by)%')
  and exists (select 1 from pg_indexes where tablename = 'organization_invitations' and indexdef like '%(invited_by)%'),
  'invited_by, a foreign key to profiles, is indexed on both tables'
);
select is_empty(
  $$select polname from pg_policy where polrelid = 'public.organization_members'::regclass and polcmd <> 'r'$$,
  'organization_members has no write policy: the table has no write grants and the RPCs check aal2 themselves'
);

-- create_organization
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    $$select set_config('t.a', public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'DE', 'https://acme-bau.example')::text, true)$$,
    'aal1'),
  'ok', 'an employer user at aal1 can create an organization (no aal2 needed for the first step)'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s', type, slug, legal_name, display_name, based_in_country, website, status)
   from public.organizations where id = current_setting('t.a')::uuid),
  'employer|acme-bau|Acme Bau GmbH|Acme Bau|DE|https://acme-bau.example|active',
  'the organization is stored active with a slug from the display name'
);
select is(
  (select format('%s|%s|%s', role, accepted_at is not null, invited_by is null)
   from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id = :'own1'),
  'owner|t|t', 'the registering user is the accepted owner'
);
select is(
  (select count(*) from public.organization_members where organization_id = current_setting('t.a')::uuid),
  1::bigint, 'the organization has exactly one member after creation'
);
select is(
  (select format('%s|%s|%s|%s', actor_id, entity_type, entity_id = current_setting('t.a'), metadata)
   from audit.log where action = 'organization_created' and entity_id = current_setting('t.a')),
  format('%s|organization|t|{"slug": "acme-bau", "type": "employer"}', :'own1'),
  'one organization_created audit row names the actor, the organization, the slug and the type'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated',
    $$select set_config('t.b', public.create_organization('employer', 'Beta Works Ltd', 'Beta Works', 'GB')::text, true)$$,
    'aal1'),
  'ok', 'a second employer creates a second organization without a website'
);

update private.settings set value = '20' where key = 'organizations_per_user_max';
select is(
  pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'de')$$, 'aal1'),
  'ok', 'a taken slug is not an error'
);
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Acme Bau AG', 'Acme Bau!', 'DE')$$), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Mueller und Soehne', 'Müller & Söhne', 'DE')$$), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Hash Co', '###', 'DE')$$), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Gamma Trading Co', '  ', 'DE')$$), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Long Name Co', repeat('a', 200), 'DE')$$), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Long Name Co Two', repeat('a', 200), 'DE')$$), 'ok', 'setup call succeeds');
select is(
  (select array_agg(slug::text order by slug) filter (where display_name = 'Müller & Söhne' or display_name = 'Gamma Trading Co')
   from public.organizations where id in (select organization_id from public.organization_members where user_id = :'slg')),
  array['gamma-trading-co', 'muller-sohne'],
  'punctuation and accents are folded; a blank display name falls back to the legal name'
);
select is(
  (select format('%s|%s', count(*), count(distinct slug))
   from public.organizations
   where display_name in ('Acme Bau', 'Acme Bau!') and slug ~ '^acme-bau-[0-9a-f]{6}$'
     and id in (select organization_id from public.organization_members where user_id = :'slg')),
  '2|2', 'a taken slug gets a short random suffix, and the suffixes differ'
);
select is(
  (select based_in_country from public.organizations where display_name = 'Acme Bau' and slug <> 'acme-bau'),
  'DE', 'the country is stored upper case'
);
select is(
  (select slug = 'org-' || left(id::text, 8) from public.organizations where display_name = '###'),
  true, 'a name without letters or digits gets org- and the first 8 characters of the id'
);
select is(
  (select format('%s|%s|%s|%s', count(*), min(length(slug)), max(length(slug)), count(*) filter (where slug ~ '^a{51}-[0-9a-f]{6}$'))
   from public.organizations where display_name = repeat('a', 200)),
  '2|58|60|1', 'a 200-character name gives a 60-character slug and a taken one stays within 60 with its suffix'
);
select is(
  (select count(*) from public.organizations where slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(slug) > 60),
  0::bigint, 'every slug is lower-case ASCII with single hyphens and at most 60 characters'
);

select is(
  pg_temp.call_as(:'late', 'authenticated', $$select set_config('t.d1', public.create_organization('employer', 'Delta Co', 'Delta', 'DE')::text, true)$$, 'aal1'),
  'ok', 'a user creates an organization'
);
select is(
  pg_temp.call_as(:'late', 'authenticated', $$select set_config('t.d2', public.create_organization('employer', ' DELTA co ', 'Delta Again', 'DE')::text, true)$$, 'aal1'),
  'ok', 'the same request repeated at once (a double click or a retry) is accepted'
);
select is(
  (current_setting('t.d1') = current_setting('t.d2'))::text
  || '|' || (select count(*) from public.organizations where legal_name ilike 'delta co')
  || '|' || (select count(*) from audit.log where action = 'organization_created' and entity_id = current_setting('t.d1')),
  'true|1|1', 'the repeat returns the organization already created, whatever the letter case, and writes nothing more'
);
update public.organizations set created_at = now() - interval '2 minutes' where id = current_setting('t.d1')::uuid;
select is(
  pg_temp.call_as(:'late', 'authenticated', $$select set_config('t.d3', public.create_organization('employer', 'Delta Co', 'Delta', 'DE')::text, true)$$, 'aal1'),
  'ok', 'the same name a minute later is a new organization'
);
select isnt(current_setting('t.d3'), current_setting('t.d1'), 'a name used before the last minute creates a second organization');

update private.settings set value = '2' where key = 'organizations_per_user_max';
select is(
  pg_temp.call_as(:'late', 'authenticated', $$select public.create_organization('employer', 'Epsilon Co', 'Epsilon', 'DE')$$, 'aal1'),
  'P0001|CHARA_LIMIT_REACHED|organizations', 'a user who owns organizations_per_user_max organizations cannot create another'
);
select is(
  (select count(*) from public.organization_members where user_id = :'late' and role = 'owner')
  || '|' || (select count(*) from public.organizations where legal_name = 'Epsilon Co'),
  '2|0', 'the refused creation left no organization behind'
);
select is(
  pg_temp.call_as(:'late', 'authenticated', $$select public.create_organization('employer', 'Delta Co', 'Delta', 'DE')$$, 'aal1'),
  'ok', 'the repeat of a recent creation is answered even at the limit'
);
update private.settings set value = '3' where key = 'organizations_per_user_max';

select is(
  pg_temp.call_as(:'wkr', 'authenticated', $$select public.create_organization('employer', 'Worker Co', 'Worker Co', 'DE')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|company_account_required', 'a worker account cannot create an organization'
);
select is(
  pg_temp.call_as(:'nul', 'authenticated', $$select public.create_organization('employer', 'Null Co', 'Null Co', 'DE')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|company_account_required', 'a user whose account kind is not committed cannot create an organization'
);
select is(
  pg_temp.call_as(:'sus', 'authenticated', $$select public.create_organization('employer', 'Sus Co', 'Sus Co', 'DE')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|profile_not_active', 'a suspended user cannot create an organization'
);
select is(
  pg_temp.call_as(null, 'anon', $$select public.create_organization('employer', 'Anon Co', 'Anon Co', 'DE')$$),
  '42501|permission denied for function create_organization|', 'an anonymous caller is refused at EXECUTE'
);
select is(
  pg_temp.call_as(null, 'authenticated', $$select public.create_organization('employer', 'Anon Co', 'Anon Co', 'DE')$$),
  'P0001|CHARA_FORBIDDEN|', 'a caller without a user id is refused'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('recruitment_company', 'Rec Co', 'Rec Co', 'DE')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|organization_type_not_available', 'a recruitment company is refused in Phase 1 (D7)'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('staffing_company', 'Staff Co', 'Staff Co', 'DE')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|organization_type_not_available', 'a staffing company is refused in Phase 1 (D7)'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('employer', 'Bad Country', 'Bad Country', 'ZZ')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|organizations_based_in_country_fkey', 'an unknown country is refused'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('employer', 'Bad Site', 'Bad Site', 'DE', 'javascript:alert(1)')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|organizations_website_check', 'a website that is not http or https is refused'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('employer', 'A', 'Short Name', 'DE')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|organizations_legal_name_check', 'a legal name of one character is refused'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('employer', 'Long Display', repeat('d', 201), 'DE')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|organizations_display_name_check', 'a display name of 201 characters is refused'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.create_organization('employer', null, 'No Legal', 'DE')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|legal_name', 'a missing legal name is refused'
);
select is(
  (select count(*) from public.organizations where display_name in ('Worker Co', 'Null Co', 'Sus Co', 'Rec Co', 'Staff Co', 'Bad Country', 'Bad Site', 'No Legal', 'Short Name')
     or legal_name in ('Worker Co', 'Null Co', 'Sus Co', 'Rec Co', 'Staff Co', 'Bad Country', 'Bad Site', 'No Legal', 'A', 'Long Display')),
  0::bigint, 'refused creations leave no organization behind'
);

select throws_ok(
  $$insert into public.organizations (type, slug, legal_name, display_name, based_in_country) values ('employer', 'acme-bau', 'Dup', 'Dup', 'DE')$$,
  '23505', null, 'a duplicate slug is refused'
);
select throws_ok(
  $$insert into public.organizations (type, slug, legal_name, display_name, based_in_country) values ('employer', 'ACME-BAU', 'Dup', 'Dup', 'DE')$$,
  '23514', null, 'a slug in upper case is refused, so uniqueness holds in any letter case'
);

-- Exactly one owner, and workers cannot join
select throws_ok(
  format($$insert into public.organization_members (organization_id, user_id, role, accepted_at) values (%L, %L, 'owner', now())$$,
    current_setting('t.a'), :'adm'),
  '23505', null, 'a second owner row is refused by the unique index'
);
select throws_ok(
  format($$delete from public.organization_members where organization_id = %L and role = 'owner'; set constraints all immediate$$, current_setting('t.a')),
  'P0001', 'CHARA_FORBIDDEN', 'deleting the owner row leaves no owner and is refused at the end of the transaction'
);
select throws_ok(
  format($$update public.organization_members set role = 'admin' where organization_id = %L and role = 'owner'; set constraints all immediate$$, current_setting('t.a')),
  'P0001', 'CHARA_FORBIDDEN', 'demoting the owner row leaves no owner and is refused at the end of the transaction'
);
select throws_ok(
  $$insert into public.organizations (type, slug, legal_name, display_name, based_in_country) values ('employer', 'ownerless', 'Ownerless', 'Ownerless', 'DE'); set constraints all immediate$$,
  'P0001', 'CHARA_FORBIDDEN', 'an organization inserted without an owner is refused at the end of the transaction'
);
select throws_ok(
  format($$insert into public.organization_members (organization_id, user_id, role, accepted_at) values (%L, %L, 'member', now())$$,
    current_setting('t.a'), :'wkr'),
  'P0001', 'CHARA_FORBIDDEN', 'a worker cannot be inserted as a member even by the table owner'
);
select throws_ok(
  format($$insert into public.organization_members (organization_id, user_id, role, accepted_at) values (%L, %L, 'member', now())$$,
    current_setting('t.a'), :'nul'),
  'P0001', 'CHARA_FORBIDDEN', 'a user without a committed account kind cannot be inserted as a member'
);

insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.a')::uuid, :'adm', 'admin', now()), (current_setting('t.a')::uuid, :'mem', 'member', now());

-- Helpers
select is(pg_temp.val_as(:'mem', 'aal1', 'select count(*) from private.member_org_ids()'), '1', 'member_org_ids lists the organizations of a member');
select is(pg_temp.val_as(:'mem', 'aal1', $$select count(*) from private.member_org_ids('admin')$$), '0', 'member_org_ids respects the minimum role');
select is(pg_temp.val_as(:'adm', 'aal1', $$select count(*) from private.member_org_ids('admin')$$), '1', 'an admin passes the admin minimum');
select is(pg_temp.val_as(:'adm', 'aal1', $$select count(*) from private.member_org_ids('owner')$$), '0', 'an admin does not pass the owner minimum');
select is(pg_temp.val_as(:'wkr', 'aal1', 'select count(*) from private.member_org_ids()'), '0', 'a worker has no organizations');
select is(
  pg_temp.val_as(:'adm', 'aal1', format($$select private.is_org_member(%L, 'admin')$$, current_setting('t.a'))),
  'true', 'is_org_member is true for an admin of the organization'
);
select is(
  pg_temp.val_as(:'mem', 'aal1', format($$select private.is_org_member(%L, 'admin')$$, current_setting('t.a'))),
  'false', 'is_org_member is false for a member asked for admin'
);
select is(
  pg_temp.val_as(:'own2', 'aal1', format($$select private.is_org_member(%L)$$, current_setting('t.a'))),
  'false', 'is_org_member is false for another organization'
);
select is(
  pg_temp.val_as(:'own2', 'aal1', format($$select private.org_type(%L)$$, current_setting('t.a'))),
  'employer', 'org_type returns the type'
);
select is(pg_temp.val_as(:'mem', 'aal2', 'select private.is_aal2()'), 'true', 'is_aal2 reads the aal claim');
select is(pg_temp.val_as(:'mem', 'aal1', 'select private.is_aal2()'), 'false', 'is_aal2 is false at aal1');
insert into public.organization_members (organization_id, user_id, role) values (current_setting('t.a')::uuid, :'unc', 'member');
select is(
  pg_temp.val_as(:'unc', 'aal1', 'select count(*) from private.member_org_ids()'),
  '0', 'a membership that is not accepted gives no access'
);
delete from public.organization_members where user_id = :'unc';

-- Direct writes are refused for the API roles
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    format($$insert into public.organization_members (organization_id, user_id, role, accepted_at) values (%L, %L, 'member', now())$$, current_setting('t.b'), :'own1')),
  '42501|permission denied for table organization_members|', 'a user cannot add themselves to another organization'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated',
    format($$update public.organization_members set role = 'owner' where user_id = %L$$, :'adm')),
  '42501|permission denied for table organization_members|', 'a user cannot change a role directly'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$delete from public.organization_members$$),
  '42501|permission denied for table organization_members|', 'a user cannot delete memberships directly'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$update public.organizations set status = 'suspended'$$),
  '42501|permission denied for table organizations|', 'an owner cannot change the organization directly'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    format($$insert into public.organization_invitations (organization_id, email, role, token_hash) values (%L, 'z@example.test', 'member', repeat('a', 64))$$, current_setting('t.a'))),
  '42501|permission denied for table organization_invitations|', 'a user cannot write an invitation directly'
);

select * from finish();
rollback;
