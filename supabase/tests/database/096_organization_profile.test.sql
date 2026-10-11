begin;
select plan(34);

\ir organizations_fixture.inc

-- FR-A2, FR-A5 (OPEN_QUESTIONS.md D78): an owner or admin at aal2 corrects the organisation profile through
-- update_organization_profile; the legal name follows the lock of the legal-entity identifier.

create function pg_temp.new_org(p_owner uuid, p_legal text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, industry_code, website,
    legal_entity_identifier, legal_entity_identifier_kind)
  values (v_id, 'employer', 'org-' || left(v_id::text, 8), p_legal, p_legal, 'DE', 'F', 'https://before.example',
    'DE123456789', 'vat_number');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.update_as(
  p_user uuid, p_org uuid, p_legal text, p_display text, p_country text, p_industry text, p_website text,
  p_aal text default 'aal2', p_role text default 'authenticated'
) returns text
language sql as $$
  select pg_temp.call_as(p_user, p_role, format(
    $f$select set_config('t.result', public.update_organization_profile(%L, %L, %L, %L, %L, %L)::text, true)$f$,
    p_org, p_legal, p_display, p_country, p_industry, p_website), p_aal)
$$;

create function pg_temp.profile(p_org uuid) returns text
language sql as $$
  select format('%s|%s|%s|%s|%s', legal_name, display_name, based_in_country, industry_code, coalesce(website, '<null>'))
  from public.organizations where id = p_org
$$;

create function pg_temp.updates(p_org uuid) returns bigint
language sql as $$ select count(*) from audit.log where action = 'organization.updated' and entity_id = p_org::text $$;

select pg_temp.new_org(:'own1', 'Acme Bau GmbH') as a \gset
select pg_temp.new_org(:'own2', 'Beta Bau GmbH') as b \gset
select slug as a_slug from public.organizations where id = :'a' \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (:'a', :'adm', 'admin', now()), (:'a', :'mem', 'member', now()), (:'a', :'sus', 'admin', now());

-- Structure and grants
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
   where oid = 'public.update_organization_profile(uuid, text, text, text, text, text)'::regprocedure)
  and has_function_privilege('authenticated', 'public.update_organization_profile(uuid, text, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.update_organization_profile(uuid, text, text, text, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.update_organization_profile(uuid, text, text, text, text, text)', 'execute'),
  'the function is security definer with an empty search_path and runs for authenticated only'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($$update public.organizations set display_name = 'Direct' where id = %L$$, :'a')),
  '42501|permission denied for table organizations|', 'a direct update of the table is still refused'
);

-- The owner corrects every field; the values are normalised as at registration
select is(
  pg_temp.update_as(:'own1', :'a', '  Acme Bau AG ', '', ' at ', 'c', '  '), 'ok',
  'the owner at aal2 updates the profile'
);
select is(pg_temp.profile(:'a'), 'Acme Bau AG|Acme Bau AG|AT|C|<null>',
  'the names are trimmed, an empty display name becomes the legal name, codes are upper case and an empty website is null');
select is(
  current_setting('t.result')::jsonb,
  '{"changed_fields": ["based_in_country", "display_name", "industry_code", "legal_name", "website"], "duplicate_legal_name": false}'::jsonb,
  'the result names the changed fields and no duplicate'
);
select is(
  (select format('%s|%s|%s', actor_id, entity_type, metadata) from audit.log
   where action = 'organization.updated' and entity_id = :'a'),
  format('%s|organization|%s', :'own1',
    '{"changed_fields": ["based_in_country", "display_name", "industry_code", "legal_name", "website"], "duplicate_legal_name": false}'),
  'one organization.updated row names the actor and the changed fields, never their values'
);
select is(
  (select format('%s|%s|%s', slug, legal_entity_identifier, legal_entity_identifier_kind) from public.organizations where id = :'a'),
  format('%s|DE123456789|vat_number', :'a_slug'), 'the slug and the legal-entity identifier are untouched'
);

-- An admin may edit too; an unchanged submission writes nothing
select is(pg_temp.update_as(:'adm', :'a', 'Acme Bau AG', 'Acme', 'AT', 'C', 'https://acme.example/jobs'), 'ok',
  'an admin at aal2 updates the display name and the website');
select is(
  (select metadata -> 'changed_fields' from audit.log where action = 'organization.updated' and entity_id = :'a' order by id desc limit 1),
  '["display_name", "website"]'::jsonb, 'the admin''s audit row names only the two changed fields'
);
select is(pg_temp.update_as(:'adm', :'a', 'Acme Bau AG', 'Acme', 'at', 'c', 'https://acme.example/jobs'), 'ok',
  'the same values again are accepted');
select is(
  format('%s|%s', current_setting('t.result')::jsonb -> 'changed_fields', pg_temp.updates(:'a')),
  '[]|2', 'a submission that changes nothing reports no field and writes no audit row'
);

-- Wrong callers change nothing
select is(pg_temp.update_as(:'own1', :'a', 'Acme Bau AG', 'Owner aal1', 'AT', 'C', null, 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'the owner at aal1 is sent to two-step verification');
select is(pg_temp.update_as(:'mem', :'a', 'Acme Bau AG', 'Member', 'AT', 'C', null),
  'P0001|CHARA_FORBIDDEN|', 'a member is refused');
select is(pg_temp.update_as(:'own2', :'a', 'Acme Bau AG', 'Other owner', 'AT', 'C', null),
  'P0001|CHARA_FORBIDDEN|', 'the owner of another organisation is refused');
select is(pg_temp.update_as(:'wkr', :'a', 'Acme Bau AG', 'Worker', 'AT', 'C', null),
  'P0001|CHARA_FORBIDDEN|', 'a candidate is refused');
select is(pg_temp.update_as(:'sus', :'a', 'Acme Bau AG', 'Suspended admin', 'AT', 'C', null),
  'P0001|CHARA_FORBIDDEN|profile_suspended', 'a suspended admin is refused');
select is(pg_temp.update_as(null, :'a', 'Acme Bau AG', 'Anonymous', 'AT', 'C', null, 'aal1', 'anon'),
  '42501|permission denied for function update_organization_profile|', 'an anonymous caller has no execute grant');
select is(pg_temp.profile(:'a'), 'Acme Bau AG|Acme|AT|C|https://acme.example/jobs', 'the refused calls changed nothing');
select is(pg_temp.updates(:'a'), 2::bigint, 'the refused calls wrote no audit row');

-- Validation at the boundary of the database
select is(pg_temp.update_as(:'own1', :'a', '   ', 'Acme', 'AT', 'C', null),
  'P0001|CHARA_INVALID_INPUT|legal_name', 'an empty legal name is refused');
select is(pg_temp.update_as(:'own1', :'a', 'A', 'Acme', 'AT', 'C', null),
  'P0001|CHARA_INVALID_INPUT|organizations_legal_name_check', 'a one-character legal name is refused');
select is(pg_temp.update_as(:'own1', :'a', 'Acme Bau AG', repeat('d', 201), 'AT', 'C', null),
  'P0001|CHARA_INVALID_INPUT|organizations_display_name_check', 'a display name of 201 characters is refused');
select is(pg_temp.update_as(:'own1', :'a', 'Acme Bau AG', 'Acme', 'AT', 'C', 'javascript:alert(1)'),
  'P0001|CHARA_INVALID_INPUT|organizations_website_check', 'a website that is not http or https is refused');
select is(pg_temp.update_as(:'own1', :'a', 'Acme Bau AG', 'Acme', 'XX', 'C', null),
  '23503|insert or update on table "organizations" violates foreign key constraint "organizations_based_in_country_fkey"|Key (based_in_country)=(XX) is not present in table "countries".',
  'an unknown country fails on the reference list');
select alike(pg_temp.update_as(:'own1', :'a', 'Acme Bau AG', 'Acme', 'AT', 'ZZ', null),
  '23503|%organizations_industry_code_fkey%', 'an unknown industry fails on the reference list');
select is(pg_temp.update_as(:'own1', :'a', 'Acme Bau AG', 'Acme', 'AT', '', null),
  'P0001|CHARA_INVALID_INPUT|industry_code', 'an empty industry is refused');
select is(
  format('%s|%s', pg_temp.profile(:'a'), pg_temp.updates(:'a')), 'Acme Bau AG|Acme|AT|C|https://acme.example/jobs|2',
  'the refused values changed nothing and wrote no audit row'
);

-- A name another organisation uses is reported, not refused
select is(pg_temp.update_as(:'own1', :'a', 'BETA   bau gmbh', 'Acme', 'AT', 'C', null), 'ok',
  'the owner renames the organisation to the legal name of another one');
select is(
  format('%s|%s', current_setting('t.result')::jsonb ->> 'duplicate_legal_name',
    (select metadata ->> 'duplicate_legal_name' from audit.log where action = 'organization.updated' and entity_id = :'a' order by id desc limit 1)),
  'true|true', 'the result and the audit row flag the duplicate, and nothing about the other organisation is returned'
);

-- The legal name is locked once a payment has been started; the other fields stay editable
insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'a', 'employer_starter', 'trialing', 'null');
select is(pg_temp.update_as(:'own1', :'a', 'Acme Renamed GmbH', 'Acme', 'AT', 'C', null),
  'P0001|CHARA_FORBIDDEN|legal_name_locked', 'the legal name cannot change once a subscription exists');
select is(pg_temp.update_as(:'adm', :'a', 'BETA   bau gmbh', 'Acme Hamburg', 'DE', 'F', null), 'ok',
  'with the same legal name the admin still changes the display name, country and industry');
select is(pg_temp.profile(:'a'), 'BETA   bau gmbh|Acme Hamburg|DE|F|<null>', 'the locked legal name is unchanged');

insert into billing.customers (organization_id, provider, customer_ref, billing_country, vat_id)
values (:'b', 'null', 'cus_beta', 'DE', 'DE123456789');
select is(pg_temp.update_as(:'own2', :'b', 'Beta Renamed GmbH', 'Beta', 'DE', 'F', null),
  'P0001|CHARA_FORBIDDEN|legal_name_locked', 'a linked billing customer locks the legal name too');

-- A suspended organisation is not edited
update public.organizations set status = 'suspended' where id = :'b';
select is(pg_temp.update_as(:'own2', :'b', 'Beta Bau GmbH', 'Beta suspended', 'DE', 'F', null),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'the owner of a suspended organisation is refused');

select * from finish();
rollback;
