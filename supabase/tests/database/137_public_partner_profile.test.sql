begin;
select plan(68);

\ir organizations_fixture.inc

-- Public partner profile (V18, FR-K4 AC2, AC3, AC6, AC7, AC9; NFR-C8, NFR-P3, NFR-S8; DATA_MODEL.md section 10):
-- get_partner_profile, preview_partner_profile, list_sitemap_partners, the partner_profile throttle and the index of
-- the public profiles.

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_slug text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug || ' Holdings Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.list(p_org uuid) returns void
language sql as $$
  update public.organizations set review_status = 'listed', listed_at = now() - interval '3 days', submitted_at = now() - interval '4 days'
  where id = p_org
$$;

-- Runs one statement as the user (anonymous when null) and returns 'ok' or 'sqlstate|message|detail'; the JSON of the
-- rows lands in t.result.
create function pg_temp.run(p_user uuid, p_sql text) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    'aal1')
$$;

create function pg_temp.profile_as(p_user uuid, p_slug text, p_key text default repeat('a', 64)) returns text
language sql as $$
  select pg_temp.run(p_user, format('select * from public.get_partner_profile(%L, %L)', p_slug, p_key))
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

\set pow '00000000-0000-0000-0000-0000000f0001'
\set pmb '00000000-0000-0000-0000-0000000f0002'
\set emp '00000000-0000-0000-0000-0000000f0003'
\set wrk '00000000-0000-0000-0000-0000000f0004'
\set rvl '00000000-0000-0000-0000-0000000f0005'
\set oth '00000000-0000-0000-0000-0000000f0006'

select pg_temp.new_user(:'pow', 'company', 'maria.santos@manila-skills.example');
select pg_temp.new_user(:'pmb', 'company', 'jun.reyes@manila-skills.example');
select pg_temp.new_user(:'emp');
select pg_temp.new_user(:'wrk', 'worker');
select pg_temp.new_user(:'rvl');
select pg_temp.new_user(:'oth');
update public.profiles set account_kind = intended_account_kind
where id in (:'pow', :'pmb', :'emp', :'wrk', :'rvl', :'oth');
update public.profiles set display_name = 'Maria Santos' where id = :'pow';
update public.profiles set display_name = 'Jun Reyes' where id = :'pmb';

select pg_temp.new_org(:'pow', 'recruitment_company', 'manila-skills') as manila \gset
select pg_temp.new_org(:'emp', 'employer', 'berlin-builders') as employer \gset
select pg_temp.new_org(:'rvl', 'staffing_company', 'rival-staffing') as rival \gset
select pg_temp.new_org(:'oth', 'recruitment_company', 'onboarding-co') as onboarding \gset
select pg_temp.new_org(:'oth', 'recruitment_company', 'pending-co') as pending \gset
select pg_temp.new_org(:'oth', 'recruitment_company', 'info-co') as info \gset
select pg_temp.new_org(:'oth', 'recruitment_company', 'declined-co') as declined \gset
select pg_temp.new_org(:'oth', 'staffing_company', 'suspended-co') as suspended \gset
select pg_temp.new_org(:'oth', 'staffing_company', 'hidden-co') as hidden \gset
select pg_temp.new_org(:'oth', 'staffing_company', 're-review-co') as rereview \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'manila', :'pmb', 'member', now());

-- Manila Skills: a complete profile with two fresh listings and one stale one, a current commitment, an identifier, a
-- licence and a review decision.
update public.organizations set
  legal_entity_identifier = 'PHSEC2012345', legal_entity_identifier_kind = 'registration_number',
  recruitment_type = 'international', founded_year = 2012, workforce_size_band = '50_249',
  description = 'We recruit skilled welders and electricians from the Philippines for employers in Europe.',
  website = 'https://manila-skills.example', workforce_profile_updated_at = '2026-10-20 08:00+00'
where id = :'manila';
select pg_temp.list(:'manila');
insert into public.organization_geographies (organization_id, scope, country_code)
values (:'manila', 'sources_from', 'PH'), (:'manila', 'sources_from', 'NP'), (:'manila', 'serves_market', 'DE'),
       (:'manila', 'serves_market', 'NL');
insert into public.organization_occupations (organization_id, occupation_id)
values (:'manila', '7212'), (:'manila', '7411'), (:'manila', '7126');
insert into public.organization_industries (organization_id, industry_code) values (:'manila', 'F'), (:'manila', 'C');
insert into public.organization_languages (organization_id, language_code) values (:'manila', 'en'), (:'manila', 'tl');
insert into public.organization_service_types (organization_id, service) values (:'manila', 'staffing');
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
  available_from, confirmed_at)
values (:'manila', '7212', 'PH', 40, 15, current_date + 14, now() - interval '3 days'),
       (:'manila', '7411', 'NP', 25, 10, current_date + 30, now() - interval '20 days'),
       (:'manila', '7126', 'PH', 99, 33, current_date + 7, now() - interval '61 days');
insert into public.consents (user_id, purpose, version, action)
values (:'pow', 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until,
  confirmed_at, partner_terms_version)
values (:'manila', 'PH', 'Department of Migrant Workers', 'DMW-123-LB-031522-R', current_date + 400, now(), 1);
insert into public.partner_review_decisions (organization_id, decision, reason, from_status, to_status, submitted_at, decided_by)
values (:'manila', 'approve', 'Registry entry matches the company.', 'pending_review', 'listed', now() - interval '4 days', :'oth');

-- The other states of FR-K4 AC2.
update public.organizations set review_status = 'pending_review', submitted_at = now() where id = :'pending';
update public.organizations set review_status = 'info_requested', submitted_at = now(), info_step = 'company' where id = :'info';
update public.organizations set review_status = 'declined', submitted_at = now() where id = :'declined';
select pg_temp.list(:'suspended');
update public.organizations set status = 'suspended' where id = :'suspended';
select pg_temp.list(:'hidden');
update public.organizations set moderation_state = 'hidden' where id = :'hidden';
select pg_temp.list(:'rereview');
update public.organizations set review_status = 're_review' where id = :'rereview';
select pg_temp.list(:'rival');

-- Grants and release switch ----------------------------------------------------------------------------------------------
select ok(
  has_function_privilege('anon', 'public.get_partner_profile(text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_partner_profile(text, text, text)', 'execute'),
  'get_partner_profile is executable by anon and authenticated'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.get_partner_profile(text, text, text)'::regprocedure),
  'get_partner_profile is security definer with an empty search_path'
);
select ok(
  not has_function_privilege('anon', 'public.preview_partner_profile(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.preview_partner_profile(uuid)', 'execute'),
  'preview_partner_profile is for signed-in callers only'
);
select ok(
  has_function_privilege('anon', 'public.list_sitemap_partners(text, integer)', 'execute'),
  'list_sitemap_partners is executable by anon'
);
select ok(
  not has_function_privilege('anon', 'private.partner_profile(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.partner_profile(uuid)', 'execute'),
  'the inner profile read is not executable by the API roles'
);

select is(pg_temp.profile_as(null, 'manila-skills'), 'P0002|CHARA_NOT_FOUND|',
  'release off: an anonymous visitor gets not found for a listed partner');
select is(pg_temp.profile_as(:'emp', 'manila-skills'), 'P0002|CHARA_NOT_FOUND|',
  'release off: a signed-in employer gets not found too');
select is(pg_temp.run(:'pow', format('select * from public.preview_partner_profile(%L)', :'manila')),
  '42501|CHARA_FORBIDDEN|release_off', 'release off: the preview is refused');
select is((select public.list_sitemap_partners()), '[]'::jsonb, 'release off: no partner enters the sitemap');
select is((select count(*)::integer from private.rate_limit_hits where action like '%partner_profile'), 0,
  'release off: nothing is counted');

update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC3, AC6: public fields only ---------------------------------------------------------------------------------------------
select is(pg_temp.profile_as(null, 'manila-skills'), 'ok', 'an anonymous visitor reads the listed profile');
select is(jsonb_array_length(pg_temp.result()), 1, 'one row');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.result() -> 0) k),
  array['based_in_country', 'based_in_country_name', 'commitment_current', 'description', 'display_name', 'founded_year',
    'industries', 'languages', 'listings', 'occupations', 'organization_type', 'profile_updated_at', 'recruitment_type',
    'served_countries', 'service_types', 'slug', 'source_countries', 'viewer_is_member', 'website', 'workforce_size_band'],
  'AC3: exactly the public fields of DATA_MODEL.md section 10, and the viewer flag'
);
select is(
  (select jsonb_build_object('n', r ->> 'display_name', 's', r ->> 'slug', 't', r ->> 'organization_type',
     'b', r ->> 'based_in_country', 'bn', r ->> 'based_in_country_name', 'rt', r ->> 'recruitment_type',
     'fy', r -> 'founded_year', 'sb', r ->> 'workforce_size_band', 'w', r ->> 'website', 'c', r -> 'commitment_current',
     'm', r -> 'viewer_is_member', 'u', (r ->> 'profile_updated_at')::timestamptz = '2026-10-20 08:00+00')
   from jsonb_array_elements(pg_temp.result()) r),
  jsonb_build_object('n', 'Manila Skills', 's', 'manila-skills', 't', 'recruitment_company', 'b', 'PH', 'bn', 'Philippines',
    'rt', 'international', 'fy', 2012, 'sb', '50_249', 'w', 'https://manila-skills.example', 'c', true, 'm', false, 'u', true),
  'the scalar fields: name, slug, type, based-in country, recruitment type, founded year, size band, website, commitment, update time'
);
select is(
  (select r -> 'served_countries' from jsonb_array_elements(pg_temp.result()) r),
  '[{"code": "DE", "name": "Germany"}, {"code": "NL", "name": "Netherlands"}]'::jsonb,
  'served countries with their names, in alphabetical order'
);
select is(
  (select r -> 'source_countries' from jsonb_array_elements(pg_temp.result()) r),
  '[{"code": "NP", "name": "Nepal"}, {"code": "PH", "name": "Philippines"}]'::jsonb,
  'source countries'
);
select is(
  (select jsonb_path_query_array(r -> 'industries', '$[*].code') || jsonb_path_query_array(r -> 'occupations', '$[*].code')
     || jsonb_path_query_array(r -> 'languages', '$[*].code') || (r -> 'service_types')
   from jsonb_array_elements(pg_temp.result()) r),
  '["F", "C", "7411", "7126", "7212", "en", "tl", "staffing"]'::jsonb,
  'industries, occupations and languages by name from the code lists, and the service types'
);
select is(pg_temp.result() -> 0 -> 'listings', 'null'::jsonb,
  'FR-K3 AC4: an anonymous visitor reads no listing (null, not an empty list, so the page asks to sign in)');
select is(pg_temp.profile_as(:'wrk', 'manila-skills'), 'ok', 'a signed-in reader');
select is(
  (select jsonb_agg(jsonb_build_object('o', l ->> 'occupation_code', 'c', l ->> 'source_country', 'a', l -> 'available',
     'm', l -> 'monthly_capacity', 'confirmed', l ? 'confirmed_at') order by l ->> 'occupation_code')
   from jsonb_array_elements(pg_temp.result()) r, jsonb_array_elements(r -> 'listings') l),
  '[{"o": "7212", "c": "PH", "a": 40, "m": 15, "confirmed": true}, {"o": "7411", "c": "NP", "a": 25, "m": 10, "confirmed": true}]'::jsonb,
  'AC1, AC3: the two fresh listings with their confirmation time; the stale listing is absent'
);
select is(
  (select string_agg(v, ', ') from unnest(array['Legal manila-skills Holdings Ltd', 'PHSEC2012345', 'registration_number',
     'DMW-123-LB-031522-R', 'Department of Migrant Workers', 'maria.santos', 'Maria Santos', 'jun.reyes', 'Jun Reyes',
     'Registry entry', 'pending_review', '"listed"', 'free_recruitment_company', 'licen', 'verified', 'approved']) v
   where position(lower(v) in lower(pg_temp.result()::text)) > 0),
  null,
  'AC3, AC6: no legal name, identifier, licence, member name or email, review state or decision, plan or the word verified'
);
select is(
  (select r ->> 'description' from jsonb_array_elements(pg_temp.result()) r),
  'We recruit skilled welders and electricians from the Philippines for employers in Europe.',
  'the description'
);
select is(pg_temp.profile_as(:'pmb', 'manila-skills'), 'ok', 'a member of the partner reads the public profile');
select is((select (r -> 'viewer_is_member')::boolean from jsonb_array_elements(pg_temp.result()) r), true,
  'AC4: and is told that it is a member (Edit profile instead of Report company)');
select is(pg_temp.profile_as(:'emp', 'manila-skills'), 'ok', 'a signed-in employer reads it');
select is((select (r -> 'viewer_is_member')::boolean from jsonb_array_elements(pg_temp.result()) r), false,
  'and is not a member');
select is(pg_temp.profile_as(:'wrk', 'manila-skills'), 'ok', 'a worker reads it');
select is(pg_temp.profile_as(:'rvl', 'manila-skills'), 'ok', 'a member of a competing partner reads it');
select is((select (r -> 'viewer_is_member')::boolean from jsonb_array_elements(pg_temp.result()) r), false,
  'and is not a member either');

-- AC2: not public means not found, the same for every reason ---------------------------------------------------------------
select is(
  (select string_agg(s || '=' || pg_temp.profile_as(null, s), ', ' order by s)
   from unnest(array['onboarding-co', 'pending-co', 'info-co', 'declined-co', 'suspended-co', 'hidden-co', 'berlin-builders',
     'no-such-partner', 'MANILA-SKILLS']) s),
  'berlin-builders=P0002|CHARA_NOT_FOUND|, declined-co=P0002|CHARA_NOT_FOUND|, hidden-co=P0002|CHARA_NOT_FOUND|, '
  'info-co=P0002|CHARA_NOT_FOUND|, MANILA-SKILLS=P0002|CHARA_NOT_FOUND|, no-such-partner=P0002|CHARA_NOT_FOUND|, '
  'onboarding-co=P0002|CHARA_NOT_FOUND|, pending-co=P0002|CHARA_NOT_FOUND|, suspended-co=P0002|CHARA_NOT_FOUND|',
  'AC2: onboarding, pending, info requested, declined, suspended, hidden by moderation, an employer and an unknown slug: the same error for a visitor'
);
select is(
  (select string_agg(distinct pg_temp.profile_as(:'emp', s), ', ')
   from unnest(array['onboarding-co', 'pending-co', 'info-co', 'declined-co', 'suspended-co', 'hidden-co', 'berlin-builders',
     'no-such-partner']) s),
  'P0002|CHARA_NOT_FOUND|', 'AC2: and for a signed-in employer'
);
select is(pg_temp.profile_as(:'oth', 'pending-co'), 'P0002|CHARA_NOT_FOUND|',
  'AC2: the partner''s own owner gets not found from the public read too (the preview is the way)');
select is(pg_temp.profile_as(null, 're-review-co'), 'ok', 'a listed partner in re-review stays public');
select is(pg_temp.profile_as(null, 'rival-staffing'), 'ok', 'a listed staffing company is public');
update public.organizations set status = 'active' where id = :'suspended';
select is(pg_temp.profile_as(null, 'suspended-co'), 'ok', 'a reinstated partner is public again');
update public.organizations set status = 'suspended' where id = :'suspended';

-- The other partner's data never enters this one --------------------------------------------------------------------------
insert into public.organization_occupations (organization_id, occupation_id) values (:'rival', '9313');
insert into public.organization_geographies (organization_id, scope, country_code) values (:'rival', 'sources_from', 'IN');
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
  available_from, confirmed_at)
values (:'rival', '9313', 'IN', 500, 100, current_date, now());
select is(pg_temp.profile_as(null, 'manila-skills'), 'ok', 'read again');
select ok(
  position('9313' in pg_temp.result()::text) = 0 and position('"IN"' in pg_temp.result()::text) = 0,
  'NFR-S8: no occupation, country or listing of another partner appears'
);

-- Anonymous calls need the visitor key; the proof is checked once the Vault secret is set ----------------------------------
select is(pg_temp.profile_as(null, 'manila-skills', null), 'P0001|CHARA_INVALID_INPUT|p_key',
  'an anonymous call without a visitor key is refused');
select is(pg_temp.profile_as(:'emp', 'manila-skills', null), 'ok', 'a signed-in call needs no visitor key');
select vault.create_secret(encode(extensions.hmac('rate_limit_attempt', 'test-visitor-hash-secret-0123456789abcdef', 'sha256'), 'hex'),
  'rate_limit_proof_key') is not null as vault_set \gset
select is(pg_temp.profile_as(null, 'manila-skills', repeat('c', 64)), '42501|CHARA_FORBIDDEN|p_proof',
  'with the Vault secret set, a direct call without the proof of the web tier is refused');
select is(
  pg_temp.run(null, format('select * from public.get_partner_profile(%L, %L, %L)', 'manila-skills', repeat('c', 64),
    encode(extensions.hmac('partner_profile|' || repeat('c', 64) || '|' || floor(extract(epoch from now()) / 60)::bigint,
      encode(extensions.hmac('rate_limit_attempt', 'test-visitor-hash-secret-0123456789abcdef', 'sha256'), 'hex'), 'sha256'), 'hex'))),
  'ok', 'and a call with the proof of this minute is served'
);
delete from vault.secrets where name = 'rate_limit_proof_key';

-- AC9: 120 reads per visitor key and minute, then CHARA_RATE_LIMITED ---------------------------------------------------------
delete from private.rate_limit_hits;
create function pg_temp.reads_as(p_user uuid, p_key text, p_count integer) returns text
language plpgsql as $$
declare
  v_result text;
  v_ok integer := 0;
begin
  for i in 1..p_count loop
    v_result := pg_temp.profile_as(p_user, 'manila-skills', p_key);
    exit when v_result <> 'ok';
    v_ok := v_ok + 1;
  end loop;
  return v_ok || ':' || v_result;
end;
$$;
select is(pg_temp.reads_as(null, repeat('d', 64), 120), '120:ok', 'AC9: one visitor key reads 120 profiles');
select matches(pg_temp.profile_as(null, 'manila-skills', repeat('d', 64)), '^P0001\|CHARA_RATE_LIMITED\|[1-9][0-9]*$',
  'AC9: the 121st within the window is refused with the seconds to wait');
select matches(pg_temp.profile_as(null, 'no-such-partner', repeat('d', 64)), '^P0001\|CHARA_RATE_LIMITED\|',
  'unknown slugs count against the same budget (no free enumeration)');
select is(pg_temp.profile_as(null, 'manila-skills', repeat('e', 64)), 'ok', 'another visitor key is not affected');
select is(pg_temp.reads_as(:'wrk', null, 120), '120:ok', 'a signed-in user reads 120 profiles');
select is(pg_temp.profile_as(:'wrk', 'manila-skills', null), 'P0001|CHARA_RATE_LIMITED|',
  'the 121st read of the signed-in user is refused (check_rate_limit)');
select is(pg_temp.profile_as(:'emp', 'manila-skills', null), 'ok', 'another signed-in user is not affected');
update private.rate_limit_hits set expires_at = now() - interval '1 second';
select is(pg_temp.profile_as(:'wrk', 'manila-skills', null), 'ok', 'after the window the user reads again');
select is(
  (select value #>> '{}' from private.settings where key = 'rate_limit_partner_profile_max') || '/'
  || (select value #>> '{}' from private.settings where key = 'rate_limit_partner_profile_seconds'),
  '120/60', 'the limit is a setting: 120 per 60 seconds'
);
select is((select count(*)::integer from private.missing_reference_data() where name like 'rate_limit_partner_profile%'), 0,
  'the deployment check finds both throttle settings');
delete from private.settings where key = 'rate_limit_partner_profile_seconds';
select is((select string_agg(name, ',') from private.missing_reference_data() where name like 'rate_limit_partner_profile%'),
  'rate_limit_partner_profile_seconds', 'and reports a missing one');
insert into private.settings (key, value) values ('rate_limit_partner_profile_seconds', '60');

-- AC2: the preview of a member -----------------------------------------------------------------------------------------------
select is(pg_temp.run(:'oth', format('select * from public.preview_partner_profile(%L)', :'pending')), 'ok',
  'AC2: the owner of a pending partner previews its profile');
select is((select (r -> 'is_public')::boolean from jsonb_array_elements(pg_temp.result()) r), false, 'which is not public');
select is(pg_temp.run(:'pmb', format('select * from public.preview_partner_profile(%L)', :'manila')), 'ok',
  'a plain member of a listed partner previews it');
select is(
  (select jsonb_build_object('p', r -> 'is_public', 'l', jsonb_array_length(r -> 'listings'))
   from jsonb_array_elements(pg_temp.result()) r),
  '{"p": true, "l": 2}'::jsonb, 'which is public, with the same fresh listings the public sees'
);
select is(pg_temp.run(:'oth', format('select * from public.preview_partner_profile(%L)', :'hidden')), 'ok',
  'the owner of a profile hidden by moderation previews it');
select is((select (r -> 'is_public')::boolean from jsonb_array_elements(pg_temp.result()) r), false, 'as not public');
select is(pg_temp.run(:'emp', format('select * from public.preview_partner_profile(%L)', :'pending')), '42501|CHARA_FORBIDDEN|',
  'an employer cannot preview another organisation''s profile');
select is(pg_temp.run(:'rvl', format('select * from public.preview_partner_profile(%L)', :'manila')), '42501|CHARA_FORBIDDEN|',
  'nor can a competing partner');
select is(pg_temp.run(:'emp', format('select * from public.preview_partner_profile(%L)', :'employer')), '42501|CHARA_FORBIDDEN|',
  'an employer has no partner profile to preview');
select is(pg_temp.run(null, format('select * from public.preview_partner_profile(%L)', :'manila')),
  '42501|permission denied for function preview_partner_profile|', 'an anonymous caller is refused at the grant');

-- AC7: the sitemap lists the public profiles only -----------------------------------------------------------------------------
select is(
  (select string_agg(e ->> 'slug', ',' order by e ->> 'slug') from jsonb_array_elements(public.list_sitemap_partners()) e
   where e ->> 'slug' in ('manila-skills', 'rival-staffing', 're-review-co', 'onboarding-co', 'pending-co', 'info-co',
     'declined-co', 'suspended-co', 'hidden-co', 'berlin-builders')),
  'manila-skills,re-review-co,rival-staffing',
  'AC7: listed partners enter the sitemap; unlisted, declined, suspended, hidden partners and employers do not'
);
select is(
  (select (e ->> 'updated_at')::timestamptz from jsonb_array_elements(public.list_sitemap_partners()) e where e ->> 'slug' = 'manila-skills'),
  '2026-10-20 08:00+00'::timestamptz, 'AC7: lastmod is workforce_profile_updated_at'
);
select is(
  (select string_agg(e ->> 'slug', ',') from jsonb_array_elements(public.list_sitemap_partners('manila-skills', 1)) e),
  (select min(slug) from public.organizations where slug > 'manila-skills' and status = 'active' and listed_at is not null
     and review_status <> 'declined' and moderation_state = 'visible'),
  'the next page starts after the slug given and holds at most p_limit entries'
);

-- NFR-P3 groundwork: the reads use indexes ------------------------------------------------------------------------------------
create function pg_temp.explain_lines(p_sql text) returns setof text
language plpgsql as $$
declare
  v_line text;
begin
  for v_line in execute 'explain ' || p_sql loop
    return next v_line;
  end loop;
end;
$$;
set local enable_seqscan = off;
select ok(
  (select string_agg(l, ' ') from pg_temp.explain_lines($$select o.slug from public.organizations o
     where o.status = 'active' and o.listed_at is not null and o.review_status <> 'declined' and o.moderation_state = 'visible'
       and o.slug > 'a' order by o.slug limit 50$$) l) like '%organizations_public_profile_slug_idx%',
  'the sitemap page reads the partial index of the public profiles'
);
select ok(
  (select string_agg(l, ' ') from pg_temp.explain_lines($$select o.id from public.organizations o where o.slug = 'manila-skills'$$) l)
    like '%organizations_slug_key%',
  'the profile is found through the unique slug index'
);
select ok(
  (select string_agg(l, ' ') from pg_temp.explain_lines(format($$select a.id from public.workforce_availability a
     where a.organization_id = %L and a.confirmed_at > now() - interval '60 days'$$, :'manila')) l) ~ 'workforce_availability_(listing_key|source_idx)',
  'the listings of the partner are read through an index that leads with the organisation'
);
reset enable_seqscan;

select * from finish();
rollback;
