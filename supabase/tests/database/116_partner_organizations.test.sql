begin;
select plan(58);

\ir organizations_fixture.inc

-- Partner organisations (V03; docs/phase-2/DATA_MODEL.md sections 2 to 5): FR-J1 AC3, AC4, AC5, FR-J4 AC8 (the listed
-- predicate) and AC9, NFR-S8 for the identifier links and NFR-C7 (legal name, identifier and country before listing).

-- Runs p_sql as the test owner and returns 'ok' or 'sqlstate|message|detail'.
create function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
end;
$$;

-- The name of the constraint that p_sql violates, or 'ok'.
create function pg_temp.violated(p_sql text) returns text
language plpgsql as $$
declare
  v_name text;
begin
  execute p_sql;
  return 'ok';
exception when check_violation then
  get stacked diagnostics v_name = constraint_name;
  return v_name;
end;
$$;

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
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.release(p_on boolean) returns void
language sql as $$
  update private.settings set value = to_jsonb(p_on) where key = 'release_partner_directories'
$$;

create function pg_temp.org_of(p_owner uuid, p_legal text) returns uuid
language sql as $$
  select o.id from public.organizations o join public.organization_members m on m.organization_id = o.id
  where m.user_id = p_owner and m.role = 'owner' and o.legal_name = p_legal
$$;

create function pg_temp.audit_of(p_org uuid, p_action text) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(l.metadata order by l.id), '[]') from audit.log l where l.entity_id = p_org::text and l.action = p_action
$$;

\set p1 '00000000-0000-0000-0000-0000000b0001'
\set p2 '00000000-0000-0000-0000-0000000b0002'
\set p3 '00000000-0000-0000-0000-0000000b0003'
\set p4 '00000000-0000-0000-0000-0000000b0004'
\set p5 '00000000-0000-0000-0000-0000000b0005'
\set pa '00000000-0000-0000-0000-0000000b0006'
\set sadm '00000000-0000-0000-0000-0000000b0007'
\set sts '00000000-0000-0000-0000-0000000b0008'
\set svr '00000000-0000-0000-0000-0000000b0009'

-- Enums --------------------------------------------------------------------------------------------------------------
select is(
  (select string_agg(e::text, ',') from unnest(enum_range(null::public.partner_review_status)) e)
    || ';' || (select string_agg(e::text, ',') from unnest(enum_range(null::public.geography_scope)) e)
    || ';' || (select string_agg(e::text, ',') from unnest(enum_range(null::public.partner_service_type)) e)
    || ';' || (select string_agg(e::text, ',') from unnest(enum_range(null::public.workforce_size_band)) e),
  'onboarding,pending_review,info_requested,listed,re_review,declined;sources_from,serves_market;'
    || 'staffing,temporary,contract,project,permanent;1_49,50_249,250_999,1000_plus',
  'the four partner enums carry the values of DATA_MODEL.md section 5'
);

-- Sign-up with a partner type ------------------------------------------------------------------------------------------
select is(
  (select value #>> '{}' from private.settings where key = 'release_partner_directories'),
  'false',
  'release 2a is off by default'
);
select is(
  pg_temp.try($$select pg_temp.new_partner('00000000-0000-0000-0000-0000000b00f1', 'recruitment_company')$$),
  'P0001|CHARA_FORBIDDEN|organization_type_not_available',
  'while release 2a is off a sign-up that names a partner type is refused'
);

select pg_temp.release(true);
select is(
  pg_temp.try($$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000b00f2',
    'f2@partner.test', '{"intended_account_kind": "worker", "intended_organization_type": "staffing_company"}')$$)
    || ',' ||
  pg_temp.try($$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000b00f3',
    'f3@partner.test', '{"intended_account_kind": "company", "intended_organization_type": "agency"}')$$),
  'P0001|CHARA_INVALID_INPUT|intended_organization_type,P0001|CHARA_INVALID_INPUT|intended_organization_type',
  'a worker cannot name a partner type, and an unknown type is refused'
);
select is(
  pg_temp.try($$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000b00f4',
    'f4@partner.test', '{"intended_account_kind": "company", "intended_organization_type": "employer"}')$$),
  'ok',
  'an employer sign-up may name its type'
);
select is(
  (select coalesce(intended_organization_type::text, 'null') from public.profiles where id = '00000000-0000-0000-0000-0000000b00f4'),
  'null',
  'the employer type is stored as null'
);

select pg_temp.new_partner(:'p1', 'recruitment_company');
select pg_temp.new_partner(:'p2', 'staffing_company');
select pg_temp.new_partner(:'p3', 'staffing_company');
select pg_temp.new_partner(:'p4', 'recruitment_company');
select pg_temp.new_partner(:'p5', 'recruitment_company');
select pg_temp.new_partner(:'pa', 'recruitment_company');
select pg_temp.new_user(:'sadm');
select pg_temp.new_user(:'sts');
select pg_temp.new_user(:'svr');
update public.profiles set account_kind = intended_account_kind where id in (:'sadm', :'sts', :'svr');
insert into public.platform_staff (user_id, role) values (:'sadm', 'admin'), (:'sts', 'trust_safety'), (:'svr', 'verification_reviewer');

select is(
  pg_temp.val_as(:'p1', 'aal1', 'select intended_organization_type::text from public.profiles'),
  'recruitment_company',
  'the user reads the partner type of the own profile'
);
select is(
  pg_temp.try(format($$update public.profiles set intended_organization_type = 'staffing_company' where id = %L$$, :'p1')),
  'P0001|CHARA_FORBIDDEN|intended_organization_type cannot be changed',
  'the partner type is frozen once the account kind is committed, even for the table owner'
);
select is(
  pg_temp.call_as(:'p1', 'authenticated', $$update public.profiles set intended_organization_type = 'staffing_company'$$),
  '42501|permission denied for table profiles|',
  'the user has no update grant on the profile'
);

-- FR-J1 AC3: create_organization accepts the partner type of the profile and no other ---------------------------------
select is(
  pg_temp.call_as(:'p1', 'authenticated',
    $$select public.create_organization('recruitment_company', 'Manila Skills Recruitment Inc.', 'Manila Skills', 'PH', 'N',
      'https://manila-skills.example', 'CS 2019-04512', 'registration_number')$$, 'aal1'),
  'ok',
  'a recruitment company user at aal1 creates a recruitment company'
);
select pg_temp.org_of(:'p1', 'Manila Skills Recruitment Inc.') as rec1 \gset
select results_eq(
  format($$select type::text, status::text, review_status::text, moderation_state::text, legal_entity_identifier, slug,
      public_page_enabled, listed_at is null, submitted_at is null from public.organizations where id = %L$$, :'rec1'),
  $$values ('recruitment_company', 'active', 'onboarding', 'visible', 'CS201904512', 'manila-skills', false, true, true)$$,
  'the organisation is a recruitment company in onboarding with the normalised identifier, never listed yet'
);
select is(
  (select role::text || ':' || (accepted_at is not null) from public.organization_members where organization_id = :'rec1' and user_id = :'p1'),
  'owner:true',
  'the creator is the accepted owner'
);
select is(
  (select metadata ->> 'type' from audit.log where entity_id = :'rec1' and action = 'organization_created'),
  'recruitment_company',
  'one audit row organization_created names the type'
);
select is(
  pg_temp.call_as(:'p1', 'authenticated',
    $$select public.create_organization('staffing_company', 'Other Staffing Ltd', null, 'PH', 'N', null, 'AB123456', 'other')$$, 'aal1')
    || ',' ||
  pg_temp.call_as(:'p2', 'authenticated',
    $$select public.create_organization('employer', 'Staffing Employer GmbH', null, 'DE', 'F')$$, 'aal1')
    || ',' ||
  pg_temp.call_as(:'own1', 'authenticated',
    $$select public.create_organization('recruitment_company', 'Employer Agency GmbH', null, 'DE', 'F', null, 'AB123456', 'other')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|organization_type_mismatch,P0001|CHARA_FORBIDDEN|organization_type_mismatch,'
    || 'P0001|CHARA_FORBIDDEN|organization_type_mismatch',
  'another type than the one named at sign-up is refused for a partner, and a partner type for an employer user'
);
select is(
  (select count(*) from public.organizations where legal_name in ('Other Staffing Ltd', 'Staffing Employer GmbH', 'Employer Agency GmbH')),
  0::bigint,
  'the refused calls wrote no organisation'
);
select is(
  pg_temp.call_as(:'wkr', 'authenticated',
    $$select public.create_organization('recruitment_company', 'Worker Agency', null, 'DE', 'F', null, 'AB123456', 'other')$$, 'aal1')
    || ',' ||
  pg_temp.call_as(null, 'anon',
    $$select public.create_organization('recruitment_company', 'Anon Agency', null, 'DE', 'F', null, 'AB123456', 'other')$$),
  'P0001|CHARA_FORBIDDEN|company_account_required,42501|permission denied for function create_organization|',
  'a worker is refused and an anonymous caller has no execute grant'
);
select pg_temp.release(false);
select is(
  pg_temp.call_as(:'p2', 'authenticated',
    $$select public.create_organization('staffing_company', 'Closed Staffing', null, 'DE', 'F', null, 'AB123456', 'other')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|organization_type_not_available',
  'while release 2a is off the partner types are refused as in Phase 1'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.create_organization('employer', 'Plain Employer GmbH', null, 'DE', 'F')$$, 'aal1'),
  'ok',
  'an employer still creates an employer organisation without an identifier'
);
select results_eq(
  $$select coalesce(review_status::text, 'null'), coalesce(moderation_state::text, 'null'), public_page_enabled
    from public.organizations where legal_name = 'Plain Employer GmbH'$$,
  $$values ('null', 'null', false)$$,
  'an employer has no review status and no partner moderation state'
);
select pg_temp.release(true);

-- FR-J1 AC5: identifier required, normalised, duplicates linked for staff only -------------------------------------------
select pg_temp.new_org(:'own2', 'employer') as emp_dup \gset
update public.organizations set legal_entity_identifier = 'DE123456789', legal_entity_identifier_kind = 'vat_number'
where id = :'emp_dup';
select is(
  pg_temp.call_as(:'p2', 'authenticated',
    $$select public.create_organization('staffing_company', 'First Staffing GmbH', null, 'DE', 'N', null, 'DE123456789', 'vat_number')$$, 'aal1'),
  'ok',
  'the first staffing company with the identifier is created'
);
select pg_temp.org_of(:'p2', 'First Staffing GmbH') as stf1 \gset
select is(
  pg_temp.call_as(:'p3', 'authenticated',
    $$select public.create_organization('staffing_company', 'Second Staffing GmbH', null, 'DE', 'N')$$, 'aal1')
    || ',' ||
  pg_temp.call_as(:'p3', 'authenticated',
    $$select public.create_organization('staffing_company', 'Second Staffing GmbH', null, 'DE', 'N', null, 'x1', 'other')$$, 'aal1')
    || ',' ||
  pg_temp.call_as(:'p3', 'authenticated',
    $$select public.create_organization('staffing_company', 'Second Staffing GmbH', null, 'DE', 'N', null, 'DE123456789', null)$$, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|legal_entity_identifier,P0001|CHARA_INVALID_INPUT|legal_entity_identifier,'
    || 'P0001|CHARA_INVALID_INPUT|legal_entity_identifier_kind',
  'a partner needs an identifier of 4 to 32 letters and digits with its kind'
);
select is(
  pg_temp.val_as(:'p3', 'aal1',
    $$select public.create_organization('staffing_company', 'Second Staffing GmbH', null, 'DE', 'N', null, 'de 123.456-789', 'vat_number')::text$$),
  pg_temp.val_as(:'p3', 'aal1',
    $$select jsonb_build_object('organization_id', o.id, 'slug', o.slug, 'duplicate_legal_name', false)::text
      from public.organizations o where o.legal_name = 'Second Staffing GmbH'$$),
  'the result holds the new organisation id, its slug and the legal-name flag, nothing about another organisation'
);
select pg_temp.org_of(:'p3', 'Second Staffing GmbH') as stf2 \gset
select is(
  (select legal_entity_identifier from public.organizations where id = :'stf2'),
  'DE123456789',
  'the identifier is stored normalised'
);
select is(
  (select metadata -> 'duplicate_identifier_same_type' from audit.log where entity_id = :'stf2' and action = 'organization_created'),
  'true'::jsonb,
  'the audit row records a same-type duplicate'
);
select results_eq(
  format($$select other_organization_id, same_type from private.organization_identifier_links
    where organization_id = %L order by same_type$$, :'stf2'),
  format($$values (%L::uuid, false), (%L::uuid, true)$$, :'emp_dup', :'stf1'),
  'the staff-only links name the employer (cross-type) and the other staffing company (same type)'
);
select is(
  pg_temp.call_as(:'p4', 'authenticated',
    $$select public.create_organization('recruitment_company', 'Cross Recruitment BV', null, 'NL', 'N', null, 'DE123456789', 'vat_number')$$, 'aal1'),
  'ok',
  'a recruitment company with the same identifier is created'
);
select pg_temp.org_of(:'p4', 'Cross Recruitment BV') as rec2 \gset
select is(
  (select metadata -> 'duplicate_identifier_same_type' from audit.log where entity_id = :'rec2' and action = 'organization_created')
    || (select jsonb_agg(same_type) from private.organization_identifier_links where organization_id = :'rec2'),
  '[false, false, false, false]'::jsonb,
  'the recruitment company records no same-type duplicate and three cross-type links'
);
select is(
  (select count(*) from audit.log where action = 'organization_created' and entity_id = :'rec2'
     and (metadata::text like '%' || :'stf1' || '%' or metadata::text like '%' || :'emp_dup' || '%')),
  0::bigint,
  'the audit row of the creation names no other organisation'
);

-- NFR-S8: the links are never readable through the API -------------------------------------------------------------
select is(
  pg_temp.call_as(:'p2', 'authenticated', 'select count(*) from private.organization_identifier_links')
    || ',' || pg_temp.call_as(null, 'anon', 'select count(*) from private.organization_identifier_links'),
  '42501|permission denied for table organization_identifier_links|,42501|permission denied for table organization_identifier_links|',
  'neither a partner nor a visitor can read the identifier links'
);
select ok(
  not has_table_privilege('authenticated', 'private.organization_identifier_links', 'select')
  and not has_table_privilege('anon', 'private.organization_identifier_links', 'select')
  and not has_table_privilege('service_role', 'private.organization_identifier_links', 'select')
  and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.organization_identifier_links'::regclass),
  'the link table has RLS forced and no grant to an API role'
);
select is(
  pg_temp.val_as(:'p2', 'aal1', 'select string_agg(legal_name, '','' order by legal_name) from public.organizations')
    || ';' || pg_temp.val_as(:'p3', 'aal1', 'select string_agg(legal_name, '','' order by legal_name) from public.organizations')
    || ';' || coalesce(pg_temp.val_as(:'own2', 'aal1', $$select string_agg(legal_name, ',') from public.organizations where type <> 'employer'$$), 'none'),
  'First Staffing GmbH;Second Staffing GmbH;none',
  'each partner reads only its own organisation with its review status, and an employer reads no partner'
);

-- Checks of the partner columns ------------------------------------------------------------------------------------
select is(
  pg_temp.violated(format($$update public.organizations set review_status = 'listed' where id = %L$$, :'emp_dup'))
    || ',' || pg_temp.violated(format($$update public.organizations set moderation_state = 'visible' where id = %L$$, :'emp_dup'))
    || ',' || pg_temp.violated(format($$update public.organizations set listed_at = now() where id = %L$$, :'emp_dup'))
    || ',' || pg_temp.violated(format($$update public.organizations set public_page_enabled = true where id = %L$$, :'rec1'))
    || ',' || pg_temp.violated(format($$update public.organizations set review_status = null where id = %L$$, :'rec1'))
    || ',' || pg_temp.violated(format($$update public.organizations set info_step = 'security' where id = %L$$, :'rec1'))
    || ',' || pg_temp.violated(format($$update public.organizations set founded_year = 1700 where id = %L$$, :'rec1')),
  'organizations_review_status_partner_only,organizations_moderation_state_partner_only,'
    || 'organizations_partner_columns_partner_only,organizations_public_page_employer_only,'
    || 'organizations_review_status_partner_only,organizations_info_step_check,organizations_founded_year_check',
  'review status and partner columns exist only for partners, the company page only for employers, and steps and years are checked'
);
select is(
  pg_temp.violated(format($$select set_config('chara.correct_organization_type', 'on', true);
      update public.profiles set intended_organization_type = 'employer' where id = %L$$, :'unc'))
    || ',' || pg_temp.violated($$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000b00f5',
      'f5@partner.test', '{"intended_account_kind": "worker"}');
      select set_config('chara.correct_organization_type', 'on', true);
      update public.profiles set intended_organization_type = 'staffing_company' where id = '00000000-0000-0000-0000-0000000b00f5'$$),
  'profiles_intended_organization_type_check,profiles_intended_organization_type_check',
  'a profile stores only a partner type, and only for a company'
);
select set_config('chara.correct_organization_type', 'off', true);

-- FR-J4 AC9: a listed partner returns to review when its legal identity changes ----------------------------------------
update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
where id = :'rec1';
select is(
  pg_temp.call_as(:'p1', 'authenticated', format($$select public.update_organization_profile(%L, 'Manila Skills Recruitment Inc.',
    'Manila Skills Group', 'PH', 'N', 'https://manila-skills.example', null)$$, :'rec1'))
    || ',' ||
  pg_temp.call_as(:'p1', 'authenticated', format($$select public.update_organization_profile(%L, 'Manila Skills Recruitment Inc.',
    'Manila Skills Group', 'PH', 'N', 'https://manila.example', null)$$, :'rec1')),
  'ok,ok',
  'the owner at aal2 changes the display name and then the website'
);
select results_eq(
  format($$select review_status::text, jsonb_array_length(pg_temp.audit_of(id, 'partner.returned_to_review'))
    from public.organizations where id = %L$$, :'rec1'),
  $$values ('listed', 0)$$,
  'display name and website leave the partner listed'
);
select is(
  pg_temp.call_as(:'p1', 'authenticated', format($$select public.update_organization_profile(%L, 'Manila Skills Recruitment Corp.',
    'Manila Skills Group', 'PH', 'N', 'https://manila.example', null)$$, :'rec1')),
  'ok',
  'the owner changes the legal name'
);
select results_eq(
  format($$select review_status::text, submitted_at > now() - interval '1 minute', pg_temp.audit_of(id, 'partner.returned_to_review'),
      private.is_listed_partner(id)
    from public.organizations where id = %L$$, :'rec1'),
  $$values ('re_review', true, '[{"fields": ["legal_name"]}]'::jsonb, true)$$,
  'the legal name sends it to re_review at the end of the queue with one audit row naming the field; it stays listed'
);
update public.organizations set review_status = 'listed' where id = :'rec1';
select is(
  pg_temp.call_as(:'p1', 'authenticated', format($$select public.set_legal_entity_identifier(%L, 'CS-2019-04513', 'registration_number')$$, :'rec1')),
  'ok',
  'the owner corrects the identifier'
);
select is(
  (select review_status::text from public.organizations where id = :'rec1')
    || ' ' || (pg_temp.audit_of(:'rec1', 'partner.returned_to_review') -> 1)::text,
  're_review {"fields": ["legal_entity_identifier"]}',
  'the identifier sends it to re_review with one audit row naming the field'
);
update public.organizations set review_status = 'pending_review' where id = :'rec2';
select is(
  pg_temp.call_as(:'p4', 'authenticated', format($$select public.update_organization_profile(%L, 'Cross Recruitment B.V.',
    null, 'NL', 'N', null, null)$$, :'rec2')),
  'ok',
  'the owner of a partner in pending review changes the legal name'
);
select is(
  (select review_status::text from public.organizations where id = :'rec2')
    || ' ' || jsonb_array_length(pg_temp.audit_of(:'rec2', 'partner.returned_to_review')),
  'pending_review 0',
  'a partner that is not listed keeps its review status when the legal name changes'
);

-- FR-J1 AC4: the type is fixed; only a Platform Administrator at aal2 corrects it ----------------------------------------
update public.organizations set review_status = 'listed' where id = :'rec1';
select is(
  pg_temp.call_as(:'p1', 'authenticated', format($$update public.organizations set type = 'staffing_company' where id = %L$$, :'rec1'))
    || ' ' || (select type::text from public.organizations where id = :'rec1'),
  '42501|permission denied for table organizations| recruitment_company',
  'the owner cannot update the type directly (no update grant)'
);
select is(
  pg_temp.call_as(:'p1', 'authenticated', format($$select public.admin_set_organization_type(%L, 'staffing_company', %L)$$,
    :'rec1', 'Registered under the wrong type, confirmed by email'))
    || ',' ||
  pg_temp.call_as(:'sts', 'authenticated', format($$select public.admin_set_organization_type(%L, 'staffing_company', %L)$$,
    :'rec1', 'Registered under the wrong type, confirmed by email'))
    || ',' ||
  pg_temp.call_as(:'svr', 'authenticated', format($$select public.admin_set_organization_type(%L, 'staffing_company', %L)$$,
    :'rec1', 'Registered under the wrong type, confirmed by email'))
    || ',' ||
  pg_temp.call_as(:'sadm', 'authenticated', format($$select public.admin_set_organization_type(%L, 'staffing_company', %L)$$,
    :'rec1', 'Registered under the wrong type, confirmed by email'), 'aal1')
    || ',' ||
  pg_temp.call_as(null, 'anon', format($$select public.admin_set_organization_type(%L, 'staffing_company', %L)$$,
    :'rec1', 'Registered under the wrong type, confirmed by email')),
  'P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|aal2_required,'
    || '42501|permission denied for function admin_set_organization_type|',
  'the owner, Trust & Safety, a Verification Reviewer and an administrator at aal1 are refused; a visitor has no grant'
);
select is(
  pg_temp.call_as(:'sadm', 'authenticated', format($$select public.admin_set_organization_type(%L, 'staffing_company', 'Too short')$$, :'rec1'))
    || ',' ||
  pg_temp.call_as(:'sadm', 'authenticated', format($$select public.admin_set_organization_type(%L, 'recruitment_company', %L)$$,
    :'rec1', 'Registered under the wrong type, confirmed by email'))
    || ',' ||
  pg_temp.call_as(:'sadm', 'authenticated', format($$select public.admin_set_organization_type(%L, 'employer', %L)$$,
    :'rec1', 'Registered under the wrong type, confirmed by email'))
    || ',' ||
  pg_temp.call_as(:'sadm', 'authenticated', format($$select public.admin_set_organization_type(%L, 'staffing_company', %L)$$,
    :'emp_dup', 'Registered under the wrong type, confirmed by email'))
    || ',' ||
  pg_temp.call_as(:'sadm', 'authenticated', format($$select public.admin_set_organization_type(%L, 'staffing_company', %L)$$,
    gen_random_uuid(), 'Registered under the wrong type, confirmed by email')),
  'P0001|CHARA_INVALID_INPUT|reason,P0001|CHARA_INVALID_INPUT|type,P0001|CHARA_INVALID_INPUT|type,'
    || 'P0001|CHARA_INVALID_INPUT|type,P0001|CHARA_NOT_FOUND|',
  'a 9-character reason, the same type, the employer type, an employer organisation and an unknown id are refused'
);
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'rec2', :'sadm', 'member', now());
select is(
  pg_temp.call_as(:'sadm', 'authenticated', format($$select public.admin_set_organization_type(%L, 'staffing_company', %L)$$,
    :'rec2', 'Registered under the wrong type, confirmed by email')),
  'P0001|CHARA_FORBIDDEN|own_organization',
  'an administrator cannot correct an organisation they belong to'
);
select pg_temp.release(false);
select is(
  pg_temp.call_as(:'sadm', 'authenticated', format($$select public.admin_set_organization_type(%L, 'staffing_company', %L)$$,
    :'rec1', 'Registered under the wrong type, confirmed by email')),
  'P0001|CHARA_FORBIDDEN|release_off',
  'the correction answers only while release 2a is on'
);
select pg_temp.release(true);
select is(
  pg_temp.call_as(:'sadm', 'authenticated', format($$select public.admin_set_organization_type(%L, 'staffing_company', %L)$$,
    :'rec1', 'Registered under the wrong type, confirmed by email')),
  'ok',
  'a Platform Administrator at aal2 corrects the type with a 46-character reason'
);
select results_eq(
  format($$select o.type::text, o.review_status::text, pg_temp.audit_of(o.id, 'partner.returned_to_review') -> -1,
      (select l.metadata - 'request_id' from audit.log l where l.entity_id = o.id::text and l.action = 'organization.type_corrected'),
      (select l.actor_id from audit.log l where l.entity_id = o.id::text and l.action = 'organization.type_corrected')
    from public.organizations o where o.id = %L$$, :'rec1'),
  format($$values ('staffing_company', 're_review', '{"fields": ["type"]}'::jsonb,
    '{"from": "recruitment_company", "to": "staffing_company", "reason": "Registered under the wrong type, confirmed by email"}'::jsonb,
    %L::uuid)$$, :'sadm'),
  'the type changes, a listed partner returns to review, and organization.type_corrected names from, to, reason and the administrator'
);
select is(
  (select intended_organization_type::text from public.profiles where id = :'p1'),
  'staffing_company',
  'the owner''s documents follow the corrected type'
);
select is(
  pg_temp.call_as(:'p5', 'authenticated',
    $$select public.create_organization('recruitment_company', 'Link Recruitment Ltd', null, 'GB', 'N', null, 'LINK1234', 'other')$$, 'aal1'),
  'ok',
  'a recruitment company with a fresh identifier is created'
);
select pg_temp.org_of(:'p5', 'Link Recruitment Ltd') as rec3 \gset
select is(
  pg_temp.call_as(:'pa', 'authenticated',
    $$select public.create_organization('recruitment_company', 'Link Recruitment Two', null, 'GB', 'N', null, 'LINK1234', 'other')$$, 'aal1'),
  'ok',
  'a second recruitment company with the same identifier is created'
);
select is(
  (select same_type from private.organization_identifier_links where other_organization_id = :'rec3'),
  true,
  'the two are linked as the same type'
);
update public.organizations set review_status = 'pending_review' where id = :'rec3';
select is(
  pg_temp.call_as(:'sadm', 'authenticated', format($$select public.admin_set_organization_type(%L, 'staffing_company', %L)$$,
    :'rec3', 'Registered under the wrong type, confirmed by email')),
  'ok',
  'the administrator corrects a partner in pending review'
);
select is(
  (select same_type::text from private.organization_identifier_links where other_organization_id = :'rec3')
    || ' ' || (select review_status::text from public.organizations where id = :'rec3'),
  'false pending_review',
  'after a correction the link is re-evaluated; a partner that was not listed keeps its review status'
);

-- FR-J4 AC8 (database part): the one listed predicate ------------------------------------------------------------------
create temp table t_listed (label text, id uuid);
insert into t_listed
select s.label, pg_temp.new_org(:'own2', 'recruitment_company')
from (values ('onboarding'), ('pending_review'), ('info_requested'), ('listed'), ('re_review'), ('info_after_listing'),
  ('declined_after_listing'), ('listed_suspended')) s (label);
update public.organizations o set
  review_status = case t.label when 'info_after_listing' then 'info_requested' when 'declined_after_listing' then 'declined'
    when 'listed_suspended' then 'listed' else t.label end::public.partner_review_status,
  listed_at = case when t.label in ('listed', 're_review', 'info_after_listing', 'declined_after_listing', 'listed_suspended')
    then now() end,
  status = case t.label when 'listed_suspended' then 'suspended' else 'active' end::public.organization_status
from t_listed t where t.id = o.id;
grant select on t_listed to anon, authenticated;
select is(
  (select string_agg(t.label, ',' order by t.label) from t_listed t where t.id in (select private.public_partner_ids())),
  'info_after_listing,listed,re_review',
  'listed means listed_at set, not declined and active: listed, re_review and an information request during re-review'
);
select is(
  (select string_agg(t.label, ',' order by t.label) from t_listed t where private.is_listed_partner(t.id)),
  'info_after_listing,listed,re_review',
  'private.is_listed_partner agrees with private.public_partner_ids'
);
select is(
  pg_temp.call_as(null, 'anon', 'select private.is_listed_partner(gen_random_uuid())')
    || ',' || pg_temp.call_as(:'own2', 'authenticated', 'select count(*) from private.public_partner_ids()')
    || ',' || coalesce(pg_temp.val_as(:'own2', 'aal1', format('select private.is_listed_partner(%L)::text', :'emp_dup')), 'null'),
  'ok,ok,false',
  'the helpers are executable by the API roles for the read policies, and an employer is never a listed partner'
);
select ok(
  exists (select 1 from pg_indexes where indexname = 'organizations_listed_partners_idx'
    and indexdef like '%WHERE ((listed_at IS NOT NULL) AND (review_status <> ''declined''::partner_review_status) AND (status = ''active''::organization_status))'),
  'a partial index serves the listed partners'
);

select * from finish();
rollback;
