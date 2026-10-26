begin;
select plan(52);

\ir status_fixture.inc

-- Public employer company page (V23, FR-K5 AC1, AC2, AC3, AC5, AC6, AC10; NFR-S8; DATA_MODEL.md sections 4 and 10):
-- get_company_page, set_company_page_visibility, list_sitemap_companies, the company page link of get_public_job and
-- the index of the public pages. Acme Bau (t.a: owner own1, admin adm, member mem) and Beta Works (t.b: owner own2, admin
-- adm2) come from the fixture.

-- Runs one statement as the user (anonymous when null) at the given level and returns 'ok' or 'sqlstate|message|detail';
-- the JSON of the rows lands in t.result.
create function pg_temp.run(p_user uuid, p_sql text, p_aal text default 'aal1') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    p_aal)
$$;

create function pg_temp.page_as(p_user uuid, p_slug text) returns text
language sql as $$ select pg_temp.run(p_user, format('select * from public.get_company_page(%L)', p_slug)) $$;

create function pg_temp.switch_as(p_user uuid, p_org uuid, p_enabled boolean, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.run(p_user, format('select public.set_company_page_visibility(%L, %L) as state', p_org, p_enabled), p_aal)
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

create function pg_temp.changes(p_org uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(metadata order by id), '[]'::jsonb) from audit.log
  where action = 'organization.public_page_changed' and entity_id = p_org::text
$$;

create function pg_temp.public_slug(p_job uuid) returns text
language plpgsql as $$
declare
  v_slug text;
begin
  set local role anon;
  select g.employer_company_slug into v_slug from public.get_public_job(p_job) g;
  reset role;
  return v_slug;
end;
$$;

\set pown '00000000-0000-0000-0000-0000000f2301'
select pg_temp.new_user(:'pown');
update public.profiles set account_kind = intended_account_kind where id = :'pown';
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
values ('00000000-0000-0000-0000-0000000f2311', 'recruitment_company', 'manila-partner', 'Manila Partner Holdings Ltd', 'Manila Partner', 'PH');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values ('00000000-0000-0000-0000-0000000f2311', :'pown', 'owner', now());
update public.organizations set review_status = 'listed', listed_at = now(), submitted_at = now()
where id = '00000000-0000-0000-0000-0000000f2311';

select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
select slug as acme_slug from public.organizations where id = :'acme' \gset
update public.organizations set website = 'https://acme-bau.example',
  description = 'We build steel halls in northern Germany.', legal_entity_identifier = 'DE123456789',
  legal_entity_identifier_kind = 'vat_number'
where id = :'acme';
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (:'acme', 'employer_starter', 'active', 'null');

select pg_temp.open_job('Welder one', :'acme', '{"published_at": "2026-10-01 08:00+00"}') as v1 \gset
select pg_temp.open_job('Welder two', :'acme', '{"published_at": "2026-10-03 08:00+00"}') as v2 \gset
select pg_temp.open_job('Welder three', :'acme', '{"published_at": "2026-10-02 08:00+00"}') as v3 \gset
select pg_temp.seed_job('{"title": "Draft welder"}', :'acme') as vd \gset
select pg_temp.seed_job('{"title": "Paused welder", "status": "paused"}', :'acme') as vp \gset
select pg_temp.seed_job('{"title": "Hidden welder", "status": "open", "moderation_state": "hidden"}', :'acme') as vh \gset
select pg_temp.seed_job(format('{"title": "Deleted welder", "status": "open", "deleted_at": "%s"}', now())::jsonb, :'acme') as vx \gset
select pg_temp.seed_job('{"title": "Closed welder", "status": "closed"}', :'acme') as vc \gset
select pg_temp.open_job('Beta welder', :'beta') as vb \gset

-- Grants -------------------------------------------------------------------------------------------------------------------
select ok(
  has_function_privilege('anon', 'public.get_company_page(text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_company_page(text)', 'execute'),
  'get_company_page is executable by anon and authenticated'
);
select ok(
  not has_function_privilege('anon', 'public.set_company_page_visibility(uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.set_company_page_visibility(uuid, boolean)', 'execute')
  and not has_function_privilege('service_role', 'public.set_company_page_visibility(uuid, boolean)', 'execute'),
  'set_company_page_visibility is for signed-in callers only'
);
select ok(
  has_function_privilege('anon', 'public.list_sitemap_companies(text, integer)', 'execute'),
  'list_sitemap_companies is executable by anon'
);
select ok(
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
   where oid in ('public.get_company_page(text)'::regprocedure, 'public.set_company_page_visibility(uuid, boolean)'::regprocedure,
     'public.list_sitemap_companies(text, integer)'::regprocedure, 'public.get_public_job(uuid)'::regprocedure)),
  'the four functions are security definer with an empty search_path'
);
select ok(
  has_function_privilege('anon', 'public.get_public_job(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.get_public_job(uuid)', 'execute'),
  'get_public_job keeps its grants'
);
select has_index('public', 'organizations', 'organizations_company_page_slug_idx', 'the public company pages have an index');

-- AC1: off by default, and nothing while the release is off --------------------------------------------------------------
select is((select public_page_enabled from public.organizations where id = :'acme'), false, 'AC1: a new employer''s page is off');
update public.organizations set public_page_enabled = true where id = :'beta';
select is(pg_temp.page_as(null, 'beta-works'), 'P0002|CHARA_NOT_FOUND|', 'release off: a page that is on is not found');
select is(pg_temp.switch_as(:'own1', :'acme', true), '42501|CHARA_FORBIDDEN|release_off', 'release off: the switch is refused');
select is((select public.list_sitemap_companies()), '[]'::jsonb, 'release off: no company enters the sitemap');
select is(pg_temp.public_slug(:'vb'), null, 'release off: the vacancy page has no company link');
update public.organizations set public_page_enabled = false where id = :'beta';

update private.settings set value = 'true' where key = 'release_partner_directories';

select is(pg_temp.page_as(null, :'acme_slug'), 'P0002|CHARA_NOT_FOUND|', 'AC1: the page that is off is not found');

-- AC2: owner or admin at aal2 --------------------------------------------------------------------------------------------
select is(pg_temp.switch_as(:'own1', :'acme', true), 'ok', 'AC2: the owner at aal2 turns the page on');
select is(pg_temp.result() -> 0 -> 'state', jsonb_build_object('enabled', true, 'slug', :'acme_slug'), 'and gets the state and the slug');
select is(pg_temp.changes(:'acme'), '[{"from": false, "to": true}]'::jsonb, 'AC2: one audit row with from and to');
select is(pg_temp.switch_as(:'own1', :'acme', true), 'ok', 'turning it on again is accepted');
select is(jsonb_array_length(pg_temp.changes(:'acme')), 1, 'and writes no second audit row');
select is(pg_temp.switch_as(:'adm', :'acme', false), 'ok', 'AC2: the admin at aal2 turns it off');
select is(pg_temp.changes(:'acme') -> 1, '{"from": true, "to": false}'::jsonb, 'with its own audit row');
select is(pg_temp.switch_as(:'adm', :'acme', true, 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'AC2: the admin at aal1 is refused');
select is(pg_temp.switch_as(:'mem', :'acme', true), 'P0001|CHARA_FORBIDDEN|', 'AC2: a member is refused');
select is(pg_temp.switch_as(:'own2', :'acme', true), 'P0001|CHARA_FORBIDDEN|', 'AC2: the owner of another employer is refused');
select is(pg_temp.switch_as(:'pown', :'acme', true), 'P0001|CHARA_FORBIDDEN|', 'AC2: a partner owner is refused');
select is(pg_temp.switch_as(:'pown', '00000000-0000-0000-0000-0000000f2311', true), '42501|CHARA_FORBIDDEN|not_employer',
  'a partner cannot turn on a company page of its own');
select matches(pg_temp.switch_as(null, :'acme', true), '^42501\|permission denied for function set_company_page_visibility',
  'AC2: the anonymous caller is refused at the EXECUTE grant');
select is(pg_temp.switch_as(:'own1', :'acme', null), 'P0001|CHARA_INVALID_INPUT|p_enabled', 'a missing value is refused');
select matches(pg_temp.call_as(:'own1', 'authenticated', format('update public.organizations set public_page_enabled = true where id = %L', :'acme')),
  '^42501\|', 'AC2: a direct update of the column is refused');
select is(
  (select public_page_enabled::text || ',' || jsonb_array_length(pg_temp.changes(:'acme')) from public.organizations where id = :'acme'),
  'false,2', 'the refused calls changed nothing and wrote no audit row'
);

-- AC3: the public fields and the public vacancies only ------------------------------------------------------------------
select is(pg_temp.switch_as(:'own1', :'acme', true), 'ok', 'the owner turns the page on again');
select is(pg_temp.page_as(null, :'acme_slug'), 'ok', 'AC3: an anonymous visitor reads the page');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.result() -> 0) k),
  array['based_in_country', 'based_in_country_name', 'description', 'display_name', 'industry_code', 'industry_name',
    'open_vacancy_count', 'slug', 'vacancies', 'viewer_role', 'website'],
  'AC3: exactly the public fields of FR-K5 and the viewer role'
);
select is(
  (select jsonb_build_object('n', r ->> 'display_name', 's', r ->> 'slug', 'b', r ->> 'based_in_country',
     'bn', r ->> 'based_in_country_name', 'i', r ->> 'industry_code', 'in', r ->> 'industry_name', 'w', r ->> 'website',
     'd', r ->> 'description', 'c', r -> 'open_vacancy_count', 'v', r -> 'viewer_role')
   from jsonb_array_elements(pg_temp.result()) r),
  jsonb_build_object('n', 'Acme Bau', 's', :'acme_slug', 'b', 'DE', 'bn', 'Germany', 'i', 'F', 'in', 'Construction',
    'w', 'https://acme-bau.example', 'd', 'We build steel halls in northern Germany.', 'c', 3, 'v', null),
  'AC3: display name, country, industry, website, description and the number of open vacancies'
);
select is(
  (select jsonb_agg(v ->> 'title') from jsonb_array_elements(pg_temp.result() -> 0 -> 'vacancies') v),
  '["Welder two", "Welder three", "Welder one"]'::jsonb,
  'AC3: the three open vacancies, newest first; draft, paused, hidden, deleted, closed and other companies'' vacancies are absent'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.result() -> 0 -> 'vacancies' -> 0) k),
  array['city', 'country', 'country_code', 'employment_type', 'id', 'published_at', 'salary_currency', 'salary_max',
    'salary_min', 'salary_period', 'title'],
  'a vacancy carries its public summary only'
);
select is(
  (select string_agg(v, ', ') from unnest(array['Acme Bau GmbH', 'DE123456789', 'vat_number', '@example.test',
     'employer_starter', 'Beta', :'acme']) v
   where position(lower(v) in lower(pg_temp.result()::text)) > 0),
  null,
  'AC3, NFR-S8: no legal name, identifier, member email, plan, organisation id or other company'
);
select is(
  (select string_agg(coalesce(pg_temp.page_as(u, :'acme_slug'), '') || ':' || coalesce(pg_temp.result() -> 0 ->> 'viewer_role', '-'), ', ')
   from unnest(array[:'own1', :'adm', :'mem', :'own2', :'wa', :'pown']::uuid[]) with ordinality as x (u, n)),
  'ok:owner, ok:admin, ok:member, ok:-, ok:-, ok:-',
  'AC8: every signed-in caller reads the page; only a member of the company is told its own role'
);
update public.organizations set public_page_enabled = true where id = :'beta';
select is(pg_temp.page_as(null, 'beta-works'), 'ok', 'another employer''s page that is on is public');
select ok(position('Welder' in pg_temp.result()::text) = 0 and position('Acme' in pg_temp.result()::text) = 0,
  'NFR-S8: and holds nothing of Acme Bau');
select is(
  (select string_agg(s || '=' || pg_temp.page_as(null, s), ', ' order by s)
   from unnest(array['manila-partner', 'no-such-company', upper(:'acme_slug')]) s),
  format('%s=P0002|CHARA_NOT_FOUND|, manila-partner=P0002|CHARA_NOT_FOUND|, no-such-company=P0002|CHARA_NOT_FOUND|', upper(:'acme_slug')),
  'a partner, an unknown slug and a slug in capitals answer the same not found'
);

-- AC5: the vacancy page links the company only while the page is on ---------------------------------------------------
select is(pg_temp.public_slug(:'v1'), :'acme_slug', 'AC5: with the page on, the vacancy carries the slug of the page');
select is(pg_temp.switch_as(:'own1', :'acme', false), 'ok', 'the owner turns the page off');
select is(pg_temp.public_slug(:'v1'), null, 'AC5: the vacancy has no company link at once');
select is(pg_temp.page_as(null, :'acme_slug'), 'P0002|CHARA_NOT_FOUND|', 'AC5: and the page is not found at once');
select is(pg_temp.switch_as(:'own1', :'acme', true), 'ok', 'the owner turns the page on again');

-- AC10: the sitemap ------------------------------------------------------------------------------------------------------
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, public_page_enabled)
values ('00000000-0000-0000-0000-0000000f2321', 'employer', 'empty-employer', 'Empty Employer GmbH', 'Empty Employer', 'DE', true);
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values ('00000000-0000-0000-0000-0000000f2321', :'own2', 'owner', now());
select is(
  (select jsonb_agg(e ->> 'slug') from jsonb_array_elements(public.list_sitemap_companies()) e),
  jsonb_build_array(:'acme_slug', 'beta-works'),
  'AC10: the pages that are on with an open vacancy, by slug; the page without a vacancy is left out'
);
select is(
  (select (e ->> 'updated_at')::timestamptz from jsonb_array_elements(public.list_sitemap_companies()) e where e ->> 'slug' = :'acme_slug'),
  (select max(updated_at) from public.jobs where id in (:'v1', :'v2', :'v3')),
  'AC10: an entry carries the last change of an open vacancy'
);
select is(public.list_sitemap_companies(:'acme_slug', 10) -> 0 ->> 'slug', 'beta-works', 'the sitemap is paged after a slug');

-- AC6: suspension and reinstatement --------------------------------------------------------------------------------------
select is(pg_temp.call_as(:'st_trust', 'authenticated',
  format('select public.suspend_organization(%L, %L)', :'acme', 'The company details are false and misleading.')), 'ok',
  'AC6: trust and safety suspends Acme Bau');
select is(pg_temp.page_as(null, :'acme_slug'), 'P0002|CHARA_NOT_FOUND|', 'AC6: the page of a suspended employer is not found');
select ok(
  not (public.list_sitemap_companies() @> jsonb_build_array(jsonb_build_object('slug', :'acme_slug'))),
  'AC6: and leaves the sitemap'
);
select is(pg_temp.call_as(:'st_trust', 'authenticated',
  format('select public.reinstate_organization(%L, %L)', :'acme', 'Documents checked, the company is genuine.')), 'ok',
  'AC6: the organisation is reinstated');
select is(pg_temp.page_as(null, :'acme_slug') || ',' || (select public_page_enabled from public.organizations where id = :'acme'),
  'ok,true', 'AC6: the page is public again, public_page_enabled kept');

select * from finish();
rollback;
