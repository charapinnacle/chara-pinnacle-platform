begin;
select plan(8);

-- The users on the current version of each required legal document, for the administration page (V04; FR-S4 AC11 and
-- the KPI "users on the current versions"). The counts are compared before and after the users of the test are added,
-- so that rows another fixture left do not matter.

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
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- The counts as the administrator sees them, one 'slug audience accepted/total' entry per row.
create function pg_temp.counts() returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000d0001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
  select string_agg(a.slug || ' ' || a.audience || ' ' || a.accepted || '/' || a.total, ', ') into v_result
  from public.admin_legal_acceptance() a;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- The change of each row between two snapshots, leaving out the rows that did not change.
create function pg_temp.delta(p_before text, p_after text) returns text
language sql as $$
  select coalesce(string_agg(a.k || ' +' || (split_part(a.v, '/', 1)::int - split_part(b.v, '/', 1)::int)
      || '/+' || (split_part(a.v, '/', 2)::int - split_part(b.v, '/', 2)::int), ', ' order by a.k), '')
  from (select regexp_replace(e, ' [0-9]+/[0-9]+$', '') k, substring(e from '[0-9]+/[0-9]+$') v from unnest(string_to_array(p_after, ', ')) e) a
  join (select regexp_replace(e, ' [0-9]+/[0-9]+$', '') k, substring(e from '[0-9]+/[0-9]+$') v from unnest(string_to_array(p_before, ', ')) e) b using (k)
  where a.v <> b.v
$$;

create function pg_temp.new_user(p_id uuid, p_kind text, p_type text default null) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@counts.test', now(), jsonb_strip_nulls(jsonb_build_object(
    'intended_account_kind', p_kind, 'intended_organization_type', p_type)));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

create function pg_temp.grant_current(p_user uuid, p_slug text) returns void
language sql as $$
  insert into public.consents (user_id, purpose, version, action)
  values (p_user, p_slug, private.current_legal_version(p_slug), 'granted')
$$;

\set admin '00000000-0000-0000-0000-0000000d0001'
\set trust '00000000-0000-0000-0000-0000000d0002'
\set r1 '00000000-0000-0000-0000-0000000d0003'
\set r2 '00000000-0000-0000-0000-0000000d0004'
\set s1 '00000000-0000-0000-0000-0000000d0005'
\set w1 '00000000-0000-0000-0000-0000000d0006'
\set w2 '00000000-0000-0000-0000-0000000d0007'

select pg_temp.new_user(:'admin', 'company');
select pg_temp.new_user(:'trust', 'company');
insert into public.platform_staff (user_id, role) values (:'admin', 'admin'), (:'trust', 'trust_safety');

update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.counts() as before \gset

select pg_temp.new_user(:'r1', 'company', 'recruitment_company');
select pg_temp.new_user(:'r2', 'company', 'recruitment_company');
select pg_temp.new_user(:'s1', 'company', 'staffing_company');
select pg_temp.new_user(:'w1', 'worker');
select pg_temp.new_user(:'w2', 'worker');
select pg_temp.grant_current(u, s) from unnest(array[:'r1', :'r2']::uuid[]) u, unnest(array['terms-of-service', 'partner-terms']) s;
select pg_temp.grant_current(:'r1', 'recruitment-company-terms');
select pg_temp.grant_current(:'w1', 'worker-terms');
insert into public.consents (user_id, purpose, version, action) values (:'w2', 'worker-terms', 0, 'granted'), (:'w2', 'worker-terms', 0, 'withdrawn');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, review_status) values
  ('00000000-0000-0000-0000-0000000d0a01', 'recruitment_company', 'counts-org-one', 'Counts Org One', 'Counts Org One', 'DE', 'onboarding'),
  ('00000000-0000-0000-0000-0000000d0a02', 'recruitment_company', 'counts-org-two', 'Counts Org Two', 'Counts Org Two', 'DE', 'onboarding');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  ('00000000-0000-0000-0000-0000000d0a01', :'r1', 'owner', now()),
  ('00000000-0000-0000-0000-0000000d0a02', :'r2', 'owner', now());
select pg_temp.grant_current(:'r1', 'employer-pays-commitment');
select pg_temp.grant_current(:'r2', 'employer-pays-commitment');
select pg_temp.grant_current(:'r1', 'partner-dpa');
select pg_temp.new_user('00000000-0000-0000-0000-0000000d0008', 'company', 'recruitment_company');
update public.profiles set status = 'suspended' where id = '00000000-0000-0000-0000-0000000d0008';

select is(
  pg_temp.delta(:'before', pg_temp.counts()),
  'employer-pays-commitment org:recruitment_company +2/+2, partner-dpa org:recruitment_company +1/+2, '
    || 'partner-terms recruitment_company +2/+2, partner-terms staffing_company +0/+1, '
    || 'privacy-policy recruitment_company +0/+2, privacy-policy staffing_company +0/+1, privacy-policy worker +0/+2, '
    || 'recruitment-company-terms recruitment_company +1/+2, staffing-company-terms staffing_company +0/+1, '
    || 'terms-of-service recruitment_company +2/+2, terms-of-service staffing_company +0/+1, terms-of-service worker +0/+2, '
    || 'worker-terms worker +1/+2',
  'each list counts its active users and those on the current version; a withdrawal and a suspended user do not count; '
    || 'organisation-level documents count the organisations whose owner accepted'
);
select ok(
  :'before' like '%partner-terms recruitment_company %' and :'before' like '%employer-terms company %'
    and :'before' not like '%age-18-plus%' and :'before' not like '%immigration-disclaimer%',
  'every document of every list has a row (the age attestation is left out); a document of no list has none'
);

select (select max(version) from public.legal_documents where slug = 'partner-terms') as pt \gset
insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
values ('partner-terms', :pt + 1, 'Partner Terms', 'A new version.', 'A new version of the test.', now() - interval '1 second', false);
select pg_temp.counts() as after_new \gset
select is(
  pg_temp.delta(:'before', :'after_new') like '%partner-terms recruitment_company +0/+2%',
  true,
  'a new version of a document puts its earlier acceptances off the current version'
);

select is(
  pg_temp.call_as(:'trust', 'authenticated', 'select * from public.admin_legal_acceptance()')
    || ' / ' || pg_temp.call_as(:'admin', 'authenticated', 'select * from public.admin_legal_acceptance()', 'aal1')
    || ' / ' || pg_temp.call_as(:'w1', 'authenticated', 'select * from public.admin_legal_acceptance()'),
  'P0001|CHARA_FORBIDDEN| / P0001|CHARA_FORBIDDEN|aal2_required / P0001|CHARA_FORBIDDEN|',
  'only an administrator at aal2 reads the counts'
);
select is(
  pg_temp.call_as(null, 'anon', 'select * from public.admin_legal_acceptance()'),
  '42501|permission denied for function admin_legal_acceptance|',
  'anonymous visitors cannot call it'
);
select ok(
  not has_function_privilege('service_role', 'public.admin_legal_acceptance()', 'execute')
    and has_function_privilege('authenticated', 'public.admin_legal_acceptance()', 'execute'),
  'service_role has no grant; authenticated has one and the function checks the role'
);
select is(
  (select count(*) from pg_proc p where p.oid = 'public.admin_legal_acceptance()'::regprocedure and p.prosecdef
     and 'search_path=""' = any (p.proconfig)),
  1::bigint,
  'the function is a security definer with an empty search path'
);
select is(
  (select string_agg(pa.parameter_name, ',' order by pa.ordinal_position) from information_schema.routines r
   join information_schema.parameters pa on pa.specific_name = r.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'admin_legal_acceptance' and pa.parameter_mode = 'OUT'),
  'slug,audience,accepted,total',
  'the counts carry no user or organisation identifier'
);

select * from finish();
rollback;
