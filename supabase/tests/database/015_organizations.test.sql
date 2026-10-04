begin;
select plan(172);

create function pg_temp.new_user(
  p_id uuid, p_kind text default 'company', p_email text default null, p_confirmed boolean default true
) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (
    p_id, coalesce(p_email, p_id || '@example.test'), case when p_confirmed then now() end,
    jsonb_build_object('intended_account_kind', p_kind)
  )
$$;

-- Runs p_sql as p_role with the given user and token level, settles the deferred one-owner check, and returns 'ok'
-- or 'sqlstate|message|detail'. Values are passed between statements through the transaction settings t.*.
create function pg_temp.call_as(p_user uuid, p_role text, p_sql text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
  v_result text := 'ok';
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', p_aal)::text end,
    true
  );
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- Returns the single value of a query that must succeed, read as an authenticated user.
create function pg_temp.val_as(p_user uuid, p_aal text, p_sql text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  set local role authenticated;
  execute p_sql into v_result;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

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

\set own1 '00000000-0000-0000-0000-00000000a001'
\set adm '00000000-0000-0000-0000-00000000b002'
\set mem '00000000-0000-0000-0000-00000000c003'
\set own2 '00000000-0000-0000-0000-00000000d004'
\set wkr '00000000-0000-0000-0000-00000000e005'
\set nul '00000000-0000-0000-0000-00000000f006'
\set inv '00000000-0000-0000-0000-00000000a007'
\set unc '00000000-0000-0000-0000-00000000a008'
\set slg '00000000-0000-0000-0000-00000000a009'
\set adm2 '00000000-0000-0000-0000-00000000a010'
\set oth '00000000-0000-0000-0000-00000000a011'
\set late '00000000-0000-0000-0000-00000000a012'
\set sus '00000000-0000-0000-0000-00000000a013'

select pg_temp.new_user(:'own1');
select pg_temp.new_user(:'adm');
select pg_temp.new_user(:'mem');
select pg_temp.new_user(:'own2');
select pg_temp.new_user(:'wkr', 'worker');
select pg_temp.new_user(:'nul');
select pg_temp.new_user(:'inv', 'company', 'bea@example.test');
select pg_temp.new_user(:'unc', 'company', 'unc@example.test', false);
select pg_temp.new_user(:'slg');
select pg_temp.new_user(:'adm2');
select pg_temp.new_user(:'oth', 'company', 'oth@example.test');
select pg_temp.new_user(:'late', 'company', 'late@example.test');
select pg_temp.new_user(:'sus');
update public.profiles set account_kind = intended_account_kind where id <> :'nul';
update public.profiles set status = 'suspended' where id = :'sus';

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
  and not has_function_privilege('authenticated', 'private.check_one_owner()', 'execute'),
  'the internal helpers are not callable through the API'
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

select is(
  pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'de')$$, 'aal1'),
  'ok', 'a taken slug is not an error'
);
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau!', 'DE')$$), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Mueller und Soehne', 'Müller & Söhne', 'DE')$$), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Hash Co', '###', 'DE')$$), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Gamma Trading Co', '  ', 'DE')$$), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Long Name Co', repeat('a', 200), 'DE')$$), 'ok', 'setup call succeeds');
select is(pg_temp.call_as(:'slg', 'authenticated', $$select public.create_organization('employer', 'Long Name Co', repeat('a', 200), 'DE')$$), 'ok', 'setup call succeeds');
select is(
  (select array_agg(slug::text order by slug) from public.organizations where id in (
     select organization_id from public.organization_members where user_id = :'slg')
   and display_name in ('Acme Bau', 'Acme Bau!', 'Müller & Söhne', 'Gamma Trading Co')),
  array['acme-bau-2', 'acme-bau-3', 'gamma-trading-co', 'muller-sohne'],
  'a taken slug gets -2, -3; punctuation and accents are folded; a blank display name falls back to the legal name'
);
select is(
  (select based_in_country from public.organizations where slug = 'acme-bau-2'),
  'DE', 'the country is stored upper case'
);
select is(
  (select slug = 'org-' || left(id::text, 8) from public.organizations where display_name = '###'),
  true, 'a name without letters or digits gets org- and the first 8 characters of the id'
);
select is(
  (select format('%s|%s|%s|%s', count(*), min(length(slug)), max(length(slug)), count(*) filter (where slug like '%-2'))
   from public.organizations where display_name = repeat('a', 200)),
  '2|60|60|1', 'a 200-character name gives a 60-character slug and a second one stays within 60 with its suffix'
);
select is(
  (select count(*) from public.organizations where slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(slug) > 60),
  0::bigint, 'every slug is lower-case ASCII with single hyphens and at most 60 characters'
);

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

-- invite_member: refusals
select is(
  pg_temp.call_as(:'mem', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$),
  'P0001|CHARA_FORBIDDEN|', 'a plain member cannot invite'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an owner at aal1 cannot invite'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organization cannot invite'
);
select is(
  pg_temp.call_as(:'wkr', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$),
  'P0001|CHARA_FORBIDDEN|', 'a worker cannot invite'
);
select is(
  pg_temp.call_as(null, 'anon', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$),
  '42501|permission denied for function invite_member|', 'an anonymous caller is refused at EXECUTE'
);
update public.organizations set status = 'suspended' where id = current_setting('t.a')::uuid;
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'member')$$),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'the owner of a suspended organization cannot invite'
);
update public.organizations set status = 'active' where id = current_setting('t.a')::uuid;
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'x@example.test', 'owner')$$),
  'P0001|CHARA_INVALID_INPUT|role', 'an invitation cannot carry the owner role'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, 'not-an-email', 'member')$$),
  'P0001|CHARA_INVALID_INPUT|email', 'an invalid email address is refused'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.invite_member(current_setting('t.a')::uuid, null, 'member')$$),
  'P0001|CHARA_INVALID_INPUT|email', 'a missing email address is refused'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    format($$select public.invite_member(current_setting('t.a')::uuid, %L, 'member')$$, upper(:'mem' || '@example.test'))),
  'P0001|CHARA_CONFLICT|already_a_member', 'an existing member cannot be invited, whatever the letter case'
);
select is(
  (select count(*) from public.organization_invitations) + (select count(*) from audit.log where action = 'member_invited'),
  0::bigint, 'refused invitations write no row and no audit entry'
);

-- invite_member: success and re-invitation
select is(
  pg_temp.call_as(:'own2', 'authenticated',
    $$select public.invite_member(current_setting('t.b')::uuid, 'bea@example.test', 'member')$$),
  'ok', 'the owner of another organization invites the same address there'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated',
    $$select set_config('t.tok1', public.invite_member(current_setting('t.a')::uuid, ' Bea@Example.TEST ', 'member'), true)$$),
  'ok', 'an owner at aal2 invites by email'
);
select is(
  (select format('%s|%s|%s|%s|%s', email, role, invited_by = :'own1', accepted_at is null, expires_at = created_at + interval '7 days')
   from public.organization_invitations where organization_id = current_setting('t.a')::uuid),
  'bea@example.test|member|t|t|t', 'the invitation holds the lower-cased email, the role and a 7-day expiry'
);
select ok(current_setting('t.tok1') ~ '^[A-Za-z0-9_-]{43}$', 'the token is 32 random bytes as 43 base64url characters');
select is(
  (select token_hash from public.organization_invitations where organization_id = current_setting('t.a')::uuid),
  encode(extensions.digest(current_setting('t.tok1'), 'sha256'), 'hex'),
  'only the SHA-256 hash of the token is stored'
);
select ok(
  not exists (select 1 from public.organization_invitations i where row_to_json(i)::text like '%' || current_setting('t.tok1') || '%')
  and not exists (select 1 from audit.log where metadata::text like '%' || current_setting('t.tok1') || '%'),
  'the token appears neither in the invitation row nor in the audit log'
);
select is(
  (select format('%s|%s|%s', actor_id, metadata ->> 'organization_id' = current_setting('t.a'), metadata ->> 'role')
   from audit.log where action = 'member_invited' and entity_type = 'organization_invitation'
     and metadata ->> 'organization_id' = current_setting('t.a')),
  format('%s|t|member', :'own1'), 'one member_invited audit row names the actor, the organization and the role'
);
select ok(
  not exists (select 1 from audit.log where metadata::text ilike '%@example.test%'),
  'no audit row holds an email address'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated',
    $$select set_config('t.tok2', public.invite_member(current_setting('t.a')::uuid, 'bea@example.test', 'admin'), true)$$),
  'ok', 'an admin at aal2 re-invites the same address with another role'
);
select ok(current_setting('t.tok1') <> current_setting('t.tok2'), 'the second invitation has a new token');
select is(
  (select format('%s|%s', count(*), min(role::text)) from public.organization_invitations
   where organization_id = current_setting('t.a')::uuid and email = 'bea@example.test' and accepted_at is null),
  '1|admin', 're-inviting replaces the pending invitation'
);
select is(
  (select count(*) from public.organization_invitations where organization_id = current_setting('t.b')::uuid and email = 'bea@example.test'),
  1::bigint, 'an invitation of the same address in another organization is untouched'
);
select is(
  (select count(*) from audit.log where action = 'member_invited' and metadata ->> 'organization_id' = current_setting('t.a')),
  2::bigint, 'both invitations are audited'
);

-- accept_invitation: refusals
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select public.accept_invitation(current_setting('t.tok1'))$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'a replaced invitation link no longer works'
);
select is(
  pg_temp.call_as(:'oth', 'authenticated', $$select public.accept_invitation(current_setting('t.tok2'))$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'an invitation addressed to another email cannot be accepted'
);
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select public.accept_invitation('not-a-token')$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'an unknown token answers like a wrong one'
);
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select public.accept_invitation(null)$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'a missing token answers like a wrong one'
);
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.tok3', public.invite_member(current_setting('t.a')::uuid, 'late@example.test', 'member'), true)$$), 'ok', 'setup call succeeds');
update public.organization_invitations
set created_at = now() - interval '8 days', expires_at = now() - interval '1 second'
where email = 'late@example.test';
select is(
  pg_temp.call_as(:'late', 'authenticated', $$select public.accept_invitation(current_setting('t.tok3'))$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'an expired invitation cannot be accepted'
);
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.tok4', public.invite_member(current_setting('t.a')::uuid, 'unc@example.test', 'member'), true)$$), 'ok', 'setup call succeeds');
select is(
  pg_temp.call_as(:'unc', 'authenticated', $$select public.accept_invitation(current_setting('t.tok4'))$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|email_unconfirmed', 'a user with an unconfirmed email cannot accept'
);
select is(pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.tok5', public.invite_member(current_setting('t.a')::uuid, '00000000-0000-0000-0000-00000000e005@example.test', 'member'), true)$$), 'ok', 'setup call succeeds');
select is(
  pg_temp.call_as(:'wkr', 'authenticated', $$select public.accept_invitation(current_setting('t.tok5'))$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|workers_cannot_join_organizations', 'a worker cannot accept, even an invitation to their own address'
);
select is(
  (select count(*) from public.organization_invitations i
   where i.email = (select email from auth.users where id = :'wkr') and i.accepted_at is null),
  1::bigint, 'the invitation stays pending after a worker tried it'
);
select is(
  pg_temp.call_as(:'nul', 'authenticated', $$select public.accept_invitation(current_setting('t.tok2'))$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|', 'a user without a committed account kind cannot accept'
);
select is(
  pg_temp.call_as(null, 'anon', $$select public.accept_invitation(current_setting('t.tok2'))$$),
  '42501|permission denied for function accept_invitation|', 'an anonymous caller is refused at EXECUTE'
);
select is(
  (select count(*) from public.organization_members where organization_id = current_setting('t.a')::uuid),
  3::bigint, 'no refused acceptance created a membership'
);

-- accept_invitation: success and single use
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select set_config('t.joined', public.accept_invitation(current_setting('t.tok2'))::text, true)$$, 'aal1'),
  'ok', 'the matching company user accepts at aal1'
);
select is(current_setting('t.joined'), current_setting('t.a'), 'accepting returns the organization id');
select is(
  (select format('%s|%s|%s', role, accepted_at is not null, invited_by = :'adm')
   from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id = :'inv'),
  'admin|t|t', 'the membership has the invited role, an acceptance time and the inviter'
);
select is(
  (select accepted_at is not null from public.organization_invitations where token_hash = encode(extensions.digest(current_setting('t.tok2'), 'sha256'), 'hex')),
  true, 'the invitation is marked accepted'
);
select is(
  (select count(*) from audit.log where action = 'invitation_accepted' and actor_id = :'inv'
     and metadata ->> 'organization_id' = current_setting('t.a') and metadata ->> 'role' = 'admin'),
  1::bigint, 'acceptance is audited'
);
select is(
  pg_temp.call_as(:'inv', 'authenticated', $$select public.accept_invitation(current_setting('t.tok2'))$$, 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|', 'an invitation works once'
);
select is(
  (select count(*) from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id = :'inv'),
  1::bigint, 'the second attempt created no second membership'
);
select is(
  pg_temp.val_as(:'inv', 'aal1', 'select count(*) from public.organizations'),
  '1', 'the new member reads the organization at aal1'
);
select is(
  pg_temp.call_as(:'oth', 'authenticated',
    format($$select public.accept_invitation(%L)$$, current_setting('t.tok2'))),
  'P0001|CHARA_INVITATION_INVALID|', 'a used token stays invalid for everyone'
);

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

-- Reads: cross-organization negatives and the MFA gate
select is(pg_temp.val_as(:'own2', 'aal2', 'select count(*) from public.organizations'), '1', 'the owner of B sees only organization B');
select is(
  pg_temp.val_as(:'own2', 'aal2', format($$select count(*) from public.organizations where id = %L$$, current_setting('t.a'))),
  '0', 'organization A is invisible to the owner of B'
);
select is(
  pg_temp.val_as(:'own2', 'aal2', format($$select count(*) from public.organization_members where organization_id = %L$$, current_setting('t.a'))),
  '0', 'the members of A are invisible to the owner of B'
);
select is(
  pg_temp.val_as(:'own2', 'aal2', format($$select count(*) from public.organization_invitations where organization_id = %L$$, current_setting('t.a'))),
  '0', 'the invitations of A are invisible to the owner of B'
);
select is(
  pg_temp.val_as(:'mem', 'aal1', format($$select count(*) from public.organization_members where organization_id = %L$$, current_setting('t.a'))),
  '4', 'a plain member lists the members of the organization'
);
select is(
  pg_temp.val_as(:'mem', 'aal2', format($$select count(*) from public.organization_invitations where organization_id = %L$$, current_setting('t.a'))),
  '0', 'a plain member cannot read invitations even at aal2'
);
select is(
  pg_temp.val_as(:'adm', 'aal2', format($$select count(*) from public.organization_invitations where organization_id = %L and accepted_at is null$$, current_setting('t.a'))),
  '3', 'an admin at aal2 reads the pending invitations'
);
select is(
  pg_temp.val_as(:'adm', 'aal1', format($$select count(*) from public.organization_invitations where organization_id = %L$$, current_setting('t.a'))),
  '0', 'an admin at aal1 reads no invitations'
);
select is(
  pg_temp.val_as(:'adm', 'aal1', format($$select count(*) from public.organizations where id = %L$$, current_setting('t.a'))),
  '1', 'an admin at aal1 still reads the organization (D8)'
);
select is(
  pg_temp.val_as(:'adm', 'aal1', format($$select count(*) from public.organization_members where user_id = %L$$, :'adm')),
  '1', 'an admin at aal1 still reads their own membership (D8)'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', 'select token_hash from public.organization_invitations', 'aal2'),
  '42501|permission denied for table organization_invitations|', 'the token hash cannot be selected through the API'
);
select is(
  pg_temp.call_as(null, 'anon', 'select count(*) from public.organizations'),
  '42501|permission denied for table organizations|', 'an anonymous caller cannot read organizations'
);
select is(pg_temp.val_as(:'wkr', 'aal2', 'select count(*) from public.organizations'), '0', 'a worker sees no organization');

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

-- change_member_role
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|', 'a plain member cannot change roles'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.a'), :'mem'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an owner at aal1 cannot change roles'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organization cannot change roles'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'owner')$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_INVALID_INPUT|role', 'a role change cannot create a second owner'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_FORBIDDEN|use_transfer_ownership', 'the owner role changes only through transfer_ownership'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.change_member_role(%L, %L, 'member')$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_FORBIDDEN|use_transfer_ownership', 'an admin cannot touch the owner'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'member')$$, current_setting('t.a'), :'own2')),
  'P0001|CHARA_INVALID_INPUT|not_a_member', 'a user of another organization cannot be given a role here'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.change_member_role(%L, %L, 'admin')$$, current_setting('t.a'), :'mem')),
  'ok', 'the owner promotes a member to admin'
);
select is(
  (select role::text from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id = :'mem'),
  'admin', 'the role is changed'
);
select is(
  (select metadata from audit.log where action = 'member_role_changed' and metadata ->> 'user_id' = :'mem'),
  jsonb_build_object('user_id', :'mem', 'from', 'member', 'to', 'admin'), 'the role change is audited with the old and new role'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.change_member_role(%L, %L, 'member')$$, current_setting('t.a'), :'inv')),
  'ok', 'an admin demotes another admin to member'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.change_member_role(%L, %L, 'member')$$, current_setting('t.a'), :'inv')),
  'ok', 'repeating the same role is accepted'
);
select is(
  (select count(*) from audit.log where action = 'member_role_changed'),
  2::bigint, 'an unchanged role writes no audit row'
);

-- remove_member
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.a')::uuid, :'adm2', 'admin', now());
select is(
  pg_temp.call_as(:'inv', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'adm2')),
  'P0001|CHARA_FORBIDDEN|', 'a plain member cannot remove anyone'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'adm2'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an owner at aal1 cannot remove anyone'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'adm2')),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organization cannot remove anyone'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_FORBIDDEN|cannot_remove_owner', 'an admin cannot remove the owner'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_FORBIDDEN|cannot_remove_owner', 'the owner cannot remove themselves, so the last owner is never removed'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'own2')),
  'P0001|CHARA_INVALID_INPUT|not_a_member', 'a user of another organization cannot be removed here'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'wkr')),
  'P0001|CHARA_INVALID_INPUT|not_a_member', 'an unknown member answers not_a_member'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'adm2')),
  'ok', 'an admin removes another admin'
);
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.remove_member(%L, %L)$$, current_setting('t.a'), :'inv')),
  'ok', 'an admin removes a member'
);
select is(
  (select count(*) from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id in (:'adm2', :'inv')),
  0::bigint, 'the removed memberships are gone'
);
select is(
  (select metadata from audit.log where action = 'member_removed' and metadata ->> 'user_id' = :'inv'),
  jsonb_build_object('user_id', :'inv', 'role', 'member'), 'the removal is audited'
);
select is(
  pg_temp.val_as(:'inv', 'aal2', 'select count(*) from public.organizations')
  || '|' || pg_temp.val_as(:'inv', 'aal2', 'select count(*) from private.member_org_ids()'),
  '0|0', 'a removed member loses access in the very next query'
);
select is(
  (select count(*) from public.organization_members where organization_id = current_setting('t.a')::uuid and role = 'owner'),
  1::bigint, 'the organization still has its owner'
);

-- transfer_ownership
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|', 'an admin cannot transfer ownership'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an owner at aal1 cannot transfer ownership'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organization cannot transfer ownership'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'own1')),
  'P0001|CHARA_INVALID_INPUT|new_owner', 'ownership cannot be transferred to oneself'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'own2')),
  'P0001|CHARA_INVALID_INPUT|new_owner', 'ownership cannot go to a user outside the organization'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, null)$$, current_setting('t.a'))),
  'P0001|CHARA_INVALID_INPUT|new_owner', 'ownership needs a new owner'
);
select is(
  pg_temp.call_as(null, 'anon', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  '42501|permission denied for function transfer_ownership|', 'an anonymous caller is refused at EXECUTE'
);
select is(
  (select role::text from public.organization_members where organization_id = current_setting('t.a')::uuid and user_id = :'own1'),
  'owner', 'refused transfers changed no role'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'mem')),
  'ok', 'the owner transfers ownership to an admin'
);
select is(
  (select string_agg(user_id || ':' || role, ',' order by user_id) from public.organization_members where organization_id = current_setting('t.a')::uuid),
  format('%s:admin,%s:admin,%s:owner', :'own1', :'adm', :'mem'), 'the old owner is an admin and the new owner is the only owner'
);
select is(
  (select metadata from audit.log where action = 'ownership_transferred'),
  jsonb_build_object('from', :'own1', 'to', :'mem'), 'the transfer is audited with both people'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$select public.transfer_ownership(%L, %L)$$, current_setting('t.a'), :'adm')),
  'P0001|CHARA_FORBIDDEN|', 'the former owner can no longer transfer ownership'
);

select * from finish();
rollback;
