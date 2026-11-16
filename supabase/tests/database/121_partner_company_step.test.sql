begin;
select plan(12);

\ir organizations_fixture.inc

-- The Company step of partner onboarding (V05, FR-J1 AC1 and AC12): create_organization takes the description, a partner
-- still needs the identifier and its own type, and the employer call of Phase 1 is unchanged.

create function pg_temp.new_partner(p_id uuid, p_type text) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

\set rc '00000000-0000-0000-0000-0000000c0001'
\set sc '00000000-0000-0000-0000-0000000c0002'

update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(:'rc', 'recruitment_company');
select pg_temp.new_partner(:'sc', 'staffing_company');

select hasnt_function('public', 'create_organization',
  array['organization_type', 'text', 'text', 'text', 'text', 'text', 'text', 'text'],
  'the eight-argument create_organization is gone');
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
   where oid = 'public.create_organization(public.organization_type, text, text, text, text, text, text, text, text)'::regprocedure)
  and has_function_privilege('authenticated',
    'public.create_organization(public.organization_type, text, text, text, text, text, text, text, text)', 'execute')
  and not has_function_privilege('anon',
    'public.create_organization(public.organization_type, text, text, text, text, text, text, text, text)', 'execute')
  and not has_function_privilege('service_role',
    'public.create_organization(public.organization_type, text, text, text, text, text, text, text, text)', 'execute'),
  'create_organization is security definer with an empty search_path and runs for authenticated only'
);

select is(
  pg_temp.call_as(:'rc', 'authenticated',
    $$select public.create_organization('recruitment_company', 'Manila Skills Recruitment Inc.', 'Manila Skills', 'PH', 'N',
      'https://manila-skills.example', 'CS 2019-04512', 'registration_number',
      E'  We place nurses and caregivers.\nSince 2019.  \n')$$, 'aal1'),
  'ok',
  'a recruitment company owner at aal1 creates the organisation with a description'
);
select is(
  (select format('%s|%s|%s|%s|%s', o.type, o.review_status, o.legal_entity_identifier, o.slug, o.description)
   from public.organizations o join public.organization_members m on m.organization_id = o.id
   where m.user_id = :'rc' and m.role = 'owner'),
  E'recruitment_company|onboarding|CS201904512|manila-skills|We place nurses and caregivers.\nSince 2019.',
  'the partner starts in onboarding with the normalised identifier and the trimmed description'
);
select is(
  (select l.metadata::text from audit.log l
   join public.organization_members m on l.entity_id = m.organization_id::text
   where m.user_id = :'rc' and l.action = 'organization_created'),
  (select jsonb_build_object('slug', 'manila-skills', 'type', 'recruitment_company', 'duplicate_legal_name', false,
     'legal_entity_trial_used', false, 'duplicate_identifier_same_type', false)::text),
  'the audit row is the partner row of V03 and carries no description'
);

select is(
  pg_temp.call_as(:'sc', 'authenticated',
    format($$select public.create_organization('staffing_company', 'Long Staffing Ltd', null, 'PH', 'N', null,
      'LONG1234', 'other', %L)$$, repeat('a', 2001)), 'aal1'),
  'P0001|CHARA_INVALID_INPUT|organizations_description_check',
  'a description over 2000 characters is refused with the constraint name'
);
select is(
  pg_temp.call_as(:'sc', 'authenticated',
    $$select public.create_organization('staffing_company', 'Bare Staffing Ltd', null, 'PH', 'N', null, null, null,
      'We staff hotels.')$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|legal_entity_identifier',
  'a partner without an identifier is still refused, description or not'
);
select is(
  pg_temp.call_as(:'sc', 'authenticated',
    $$select public.create_organization('recruitment_company', 'Wrong Type Ltd', null, 'PH', 'N', null, 'WRONG123', 'other',
      'We staff hotels.')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|organization_type_mismatch',
  'the type stays the one chosen at sign-up'
);
select is(
  (select count(*)::integer from public.organization_members where user_id = :'sc'),
  0,
  'the refused calls write no organisation'
);

select is(
  pg_temp.call_as(:'own1', 'authenticated',
    $$select public.create_organization('employer', 'Plain Employer GmbH', null, 'DE', 'F', null, null, null, E' \n ')$$,
    'aal1'),
  'ok',
  'an employer still registers with the Phase 1 arguments'
);
select is(
  (select coalesce(o.description, 'null') from public.organizations o where o.legal_name = 'Plain Employer GmbH'),
  'null',
  'a blank description is stored as none'
);
select is(
  pg_temp.call_as(null, 'anon',
    $$select public.create_organization('recruitment_company', 'Anon Agency', null, 'PH', 'N', null, 'ANON1234', 'other', 'x')$$),
  '42501|permission denied for function create_organization|',
  'anonymous callers have no execute grant'
);

select * from finish();
rollback;
