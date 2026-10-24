begin;
select plan(41);

-- Partner legal documents (V04; FR-S4 AC1, AC3, AC9 and the organisation-level consent of the data and validation
-- section; docs/phase-2/DATA_MODEL.md sections 1, 4 and 10).

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

create function pg_temp.read_as(p_user uuid, p_role text, p_sql text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', 'aal2')::text end,
    true
  );
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_result;
  exception when others then
    v_result := sqlstate || '|' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

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

create function pg_temp.new_user(p_id uuid, p_kind text, p_type text default null, p_pending jsonb default null) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@legal.test', now(), jsonb_strip_nulls(jsonb_build_object(
    'intended_account_kind', p_kind, 'intended_organization_type', p_type, 'pending_consents', p_pending)));
$$;

-- The next version of the slug, published a second ago (so that it is current within this transaction).
create function pg_temp.publish(p_slug text, p_draft boolean) returns integer
language sql as $$
  insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
  select p_slug, coalesce(max(d.version), -1) + 1, 'Text of ' || p_slug, 'Body of ' || p_slug, 'A version of the test.',
    now() - interval '1 second', p_draft
  from public.legal_documents d where d.slug = p_slug
  returning version
$$;

create function pg_temp.remove(p_slug text) returns void
language plpgsql as $$
begin
  alter table public.legal_documents disable trigger user;
  delete from public.legal_documents where slug = p_slug;
  alter table public.legal_documents enable trigger user;
end;
$$;

create function pg_temp.gaps(p_feature text) returns text
language sql as $$
  select coalesce(string_agg(g.slug || ':' || g.state, ','), '') from private.legal_release_gaps(p_feature) g
$$;

create function pg_temp.consent(p_user uuid, p_slug text, p_version integer, p_action text default 'granted') returns void
language sql as $$
  insert into public.consents (user_id, purpose, version, action) values (p_user, p_slug, p_version, p_action::public.consent_action)
$$;

create temp table t_slugs (slug text primary key);
insert into t_slugs values ('partner-terms'), ('recruitment-company-terms'), ('staffing-company-terms'),
  ('employer-pays-commitment'), ('partner-dpa'), ('worker-visibility-consent'), ('immigration-disclaimer');

\set admin '00000000-0000-0000-0000-0000000c0001'
\set trust '00000000-0000-0000-0000-0000000c0002'
\set owner '00000000-0000-0000-0000-0000000c0003'
\set padm '00000000-0000-0000-0000-0000000c0004'
\set owner2 '00000000-0000-0000-0000-0000000c0005'
\set rc '00000000-0000-0000-0000-0000000c0006'

-- The drafts ----------------------------------------------------------------------------------------------------------
select is(
  (select count(*) from public.legal_documents d join t_slugs s using (slug)
   where d.version = 0 and d.is_draft and d.published_at <= now() and d.title like 'DRAFT: %'
     and d.body like 'DRAFT placeholder for review by legal counsel.%' and d.body like '%must not be relied on.%'),
  7::bigint,
  'each of the seven partner documents has a published version 0 that is marked as a draft in its flag, title and body'
);
select is(
  (select string_agg(c.slug || ':' || c.version || ':' || c.is_draft, ',' order by c.slug) from public.v_legal_current c join t_slugs using (slug)),
  'employer-pays-commitment:0:true,immigration-disclaimer:0:true,partner-dpa:0:true,partner-terms:0:true,'
    || 'recruitment-company-terms:0:true,staffing-company-terms:0:true,worker-visibility-consent:0:true',
  'the draft placeholder is the current version of every partner document'
);
select is(
  pg_temp.read_as(null, 'anon', $$select count(*)::text from public.v_legal_current where slug in
    ('partner-terms', 'recruitment-company-terms', 'staffing-company-terms', 'employer-pays-commitment', 'partner-dpa',
     'worker-visibility-consent', 'immigration-disclaimer')$$),
  '7',
  'anonymous visitors may read the published drafts'
);

-- The sign-up lists reference exactly the seeded slugs (V03 lists, FR-S4 AC3) -----------------------------------------
select is_empty(
  $$select l.key, e from private.settings s, jsonb_each(s.value) l, jsonb_array_elements_text(l.value) e
    where s.key = 'required_consents' and private.current_legal_version(e) is null$$,
  'every document of every sign-up list has a published version'
);
select is(
  (select string_agg(distinct e, ',' order by e) from private.settings s, jsonb_each(s.value) l, jsonb_array_elements_text(l.value) e
   where s.key = 'required_consents' and l.key in ('recruitment_company', 'staffing_company') and e in (select slug from t_slugs)),
  'partner-terms,recruitment-company-terms,staffing-company-terms',
  'the partner lists name the three seeded partner terms and no other partner document'
);
select is_empty(
  $$select l.key from private.settings s, jsonb_each(s.value) l
    where s.key = 'required_consents' and l.value ?| array['employer-pays-commitment', 'partner-dpa', 'worker-visibility-consent', 'immigration-disclaimer']$$,
  'the commitment and the DPA (organisation level, V08), the visibility consent (its own purpose) and the disclaimer (shown, not accepted) are in no sign-up list'
);

update private.settings set value = 'true' where key = 'release_partner_directories';
select is(
  pg_temp.read_as(null, 'anon', $$select string_agg(slug || ':' || version, ',') from public.signup_documents('company', 'recruitment_company')$$),
  'terms-of-service:0,privacy-policy:0,partner-terms:0,recruitment-company-terms:0',
  'AC3: with release 2a on, the recruitment list is the terms, the privacy policy and its two partner documents'
);
select is(
  pg_temp.read_as(null, 'anon', $$select string_agg(slug, ',') from public.signup_documents('company', 'staffing_company')$$),
  'terms-of-service,privacy-policy,partner-terms,staffing-company-terms',
  'AC3: the staffing list names staffing-company-terms and not recruitment-company-terms'
);

-- AC3: acceptance writes one row per document; a document of the other type is refused and writes nothing.
select pg_temp.new_user(:'rc', 'company', 'recruitment_company');
-- The call runs in a statement of its own: a subquery in the same statement would be evaluated before it.
select pg_temp.call_as(:'rc', 'authenticated', $$select public.accept_consents('[{"purpose": "staffing-company-terms", "version": 0}]')$$) as r \gset
select is(
  :'r' || ' / ' || (select count(*) from public.consents where user_id = :'rc'),
  'P0001|CHARA_INVALID_INPUT|staffing-company-terms / 0',
  'AC3: a recruitment company cannot accept the staffing terms, and nothing is written'
);
select pg_temp.call_as(:'rc', 'authenticated', $$select public.set_account_kind('[
    {"purpose": "terms-of-service", "version": 0}, {"purpose": "privacy-policy", "version": 0},
    {"purpose": "partner-terms", "version": 0}]')$$) as r \gset
select is(
  :'r' || ' / ' || (select count(*) from public.consents where user_id = :'rc'),
  'P0001|CHARA_CONSENT_REQUIRED|recruitment-company-terms / 0',
  'AC3: a sign-up without the document of its type is refused, and nothing is written'
);
select pg_temp.call_as(:'rc', 'authenticated', $$select public.set_account_kind('[
    {"purpose": "terms-of-service", "version": 0}, {"purpose": "privacy-policy", "version": 0},
    {"purpose": "partner-terms", "version": 0}, {"purpose": "recruitment-company-terms", "version": 0}]')$$) as r \gset
select is(
  :'r' || ' / ' || (select string_agg(purpose || ':' || version || ':' || action, ',' order by id) from public.consents where user_id = :'rc'),
  'ok / terms-of-service:0:granted,privacy-policy:0:granted,partner-terms:0:granted,recruitment-company-terms:0:granted',
  'AC3: full acceptance writes one granted row per document with its current version'
);

-- AC1: the Phase 1 publishing function -------------------------------------------------------------------------------
select pg_temp.new_user(:'admin', 'company');
select pg_temp.new_user(:'trust', 'company');
insert into public.platform_staff (user_id, role) values (:'admin', 'admin'), (:'trust', 'trust_safety');
select set_config('request.headers', json_build_object('x-request-id', '3f1d2c4b-5a69-4e7f-8a1b-2c3d4e5f6a7b')::text, true);
select (select count(*) from audit.log where action = 'legal_document.publish') as audit_before \gset

select is(
  pg_temp.call_as(:'trust', 'authenticated', $$select public.publish_legal_document('partner-terms', 'Partner Terms', 'Text.', 'A draft for counsel.', true)$$)
    || ' / ' || pg_temp.call_as(:'admin', 'authenticated', $$select public.publish_legal_document('partner-terms', 'Partner Terms', 'Text.', 'A draft for counsel.', true)$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN| / P0001|CHARA_FORBIDDEN|aal2_required',
  'AC1: another staff role and an administrator at aal1 cannot publish'
);
select is(
  (select string_agg(pg_temp.read_as(:'admin', 'authenticated',
     format('select public.publish_legal_document(%L, %L, %L, %L, true)::text', s.slug, 'Draft of ' || s.slug, 'Draft text of ' || s.slug, 'First draft for review by counsel.')),
     ',' order by s.slug) from t_slugs s),
  '1,1,1,1,1,1,1',
  'AC1: publishing each of the seven slugs as a draft writes version 1 after the seeded placeholder'
);
select is(
  (select count(*) from public.legal_documents d join t_slugs using (slug) where d.version = 1 and d.is_draft and d.published_at = now()),
  7::bigint,
  'AC1: each version 1 is a draft published at the transaction time'
);
select is(
  (select count(*) from audit.log where action = 'legal_document.publish') - :audit_before,
  7::bigint,
  'AC1: one legal_document.publish audit row per call'
);
select pg_temp.read_as(:'admin', 'authenticated', $$select public.publish_legal_document('partner-terms', 'Partner Terms', 'Approved text.', 'Approved by legal counsel.', false)::text$$) as r \gset
select is(
  :'r' || ' / ' || (select version || ':' || is_draft from public.v_legal_current where slug = 'partner-terms'),
  '2 / 2:false',
  'AC1: publishing partner-terms as approved writes version 2, which v_legal_current returns'
);
select is(
  pg_temp.try($$update public.legal_documents set body = 'Changed.' where slug = 'partner-terms' and version = 2$$)
    || ' / ' || pg_temp.call_as(:'admin', 'authenticated', $$delete from public.legal_documents where slug = 'partner-terms'$$),
  '42501|a published version of a legal document cannot be changed; publish a new version| / 42501|permission denied for table legal_documents|',
  'AC1: versions stay immutable (legal_documents_immutable for the owner, no privilege for the administrator)'
);

-- AC9: the release gate ---------------------------------------------------------------------------------------------
select is(
  (select value #>> '{}' from private.settings where key = 'partner_dpa_required'),
  'false',
  'partner_dpa_required is false until counsel decides (decision 6.3)'
);
select is(
  pg_temp.gaps('partner_accounts') || ' | ' || pg_temp.gaps('job_orders') || ' | ' || pg_temp.gaps('find_workers'),
  'privacy-policy:draft,acceptable-use-policy:draft,recruitment-company-terms:draft,staffing-company-terms:draft,'
    || 'employer-pays-commitment:draft,immigration-disclaimer:draft | worker-terms:draft,immigration-disclaimer:draft | '
    || 'worker-terms:draft,worker-visibility-consent:draft,immigration-disclaimer:draft',
  'AC9: each feature lists its documents whose current version is a draft, in the order of the setting (partner-terms is approved now)'
);
select pg_temp.publish(s, false) from unnest(array['privacy-policy', 'acceptable-use-policy', 'recruitment-company-terms',
  'staffing-company-terms', 'employer-pays-commitment', 'immigration-disclaimer', 'worker-terms', 'worker-visibility-consent']) s;
select is(
  pg_temp.gaps('partner_accounts') || '|' || pg_temp.gaps('job_orders') || '|' || pg_temp.gaps('find_workers'),
  '||',
  'AC9: no row for any feature when all its documents are approved'
);
select pg_temp.publish('partner-terms', true);
select is(
  pg_temp.gaps('partner_accounts') || ' | ' || pg_temp.gaps('job_orders'),
  'partner-terms:draft | ',
  'AC9: a draft on top of an approved version is a gap of the feature that needs the document, and of no other'
);
select pg_temp.remove('worker-visibility-consent');
select is(
  pg_temp.gaps('find_workers') || ' | ' || pg_temp.gaps('job_orders'),
  'worker-visibility-consent:missing | ',
  'AC9: a document without a published version is reported as missing'
);
select pg_temp.remove('partner-dpa');
update private.settings set value = 'true' where key = 'partner_dpa_required';
select is(
  pg_temp.gaps('job_orders') || ' | ' || pg_temp.gaps('find_workers') || ' | ' || pg_temp.gaps('partner_accounts'),
  'partner-dpa:missing | worker-visibility-consent:missing,partner-dpa:missing | partner-terms:draft',
  'AC9: with partner_dpa_required true and no partner-dpa, the job orders board and Find Workers report it'
);
select pg_temp.publish('partner-dpa', false);
select is(
  pg_temp.gaps('job_orders'),
  '',
  'AC9: an approved partner-dpa closes that gap'
);
update private.settings set value = 'false' where key = 'partner_dpa_required';
select is(
  pg_temp.try($$select * from private.legal_release_gaps('messaging')$$) || ' / ' || pg_temp.try($$select * from private.legal_release_gaps(null)$$),
  'P0001|CHARA_INVALID_INPUT|feature / P0001|CHARA_INVALID_INPUT|feature',
  'an unknown feature is refused'
);
delete from private.settings where key = 'legal_release_documents';
select is(
  pg_temp.try($$select * from private.legal_release_gaps('partner_accounts')$$),
  'P0001|CHARA_SETTING_MISSING|legal_release_gaps',
  'a missing setting is an error, never an empty (releasable) answer'
);
select ok(
  exists (select 1 from private.missing_reference_data() where kind = 'setting' and name = 'legal_release_documents'),
  'the deployment check names the missing setting of the gate'
);
select is_empty(
  $$select 1 from private.missing_reference_data() where kind = 'legal_document'
      and name in ('worker-visibility-consent', 'partner-terms', 'recruitment-company-terms', 'staffing-company-terms',
                   'employer-pays-commitment', 'partner-dpa', 'immigration-disclaimer')$$,
  'a missing Phase 2 document is not a Phase 1 deployment gap: legal_release_gaps reports it'
);
select is(
  (select string_agg(r.role || ':' || has_function_privilege(r.role, 'private.legal_release_gaps(text)', 'execute'), ',')
   from unnest(array['anon', 'authenticated', 'service_role']) r (role)),
  'anon:false,authenticated:false,service_role:false',
  'no API role may run the gate'
);

-- The organisation-level consent ------------------------------------------------------------------------------------
select pg_temp.new_user(:'owner', 'company', 'staffing_company');
select pg_temp.new_user(:'padm', 'company', 'staffing_company');
select pg_temp.new_user(:'owner2', 'company', 'staffing_company');
update public.profiles set account_kind = intended_account_kind where id in (:'owner', :'padm', :'owner2');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, review_status) values
  ('00000000-0000-0000-0000-0000000c0a01', 'staffing_company', 'legal-org-one', 'Legal Org One', 'Legal Org One', 'DE', 'onboarding'),
  ('00000000-0000-0000-0000-0000000c0a02', 'staffing_company', 'legal-org-two', 'Legal Org Two', 'Legal Org Two', 'DE', 'onboarding');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  ('00000000-0000-0000-0000-0000000c0a01', :'owner', 'owner', now()),
  ('00000000-0000-0000-0000-0000000c0a01', :'padm', 'admin', now()),
  ('00000000-0000-0000-0000-0000000c0a02', :'owner2', 'owner', now());
\set org1 '00000000-0000-0000-0000-0000000c0a01'
\set org2 '00000000-0000-0000-0000-0000000c0a02'
select private.current_legal_version('employer-pays-commitment') as commitment_v \gset

select is(
  private.org_consent_current(:'org1', 'employer-pays-commitment'),
  false,
  'an organisation whose owner accepted nothing has not accepted the commitment'
);
select pg_temp.consent(:'padm', 'employer-pays-commitment', :commitment_v);
select is(
  private.org_consent_current(:'org1', 'employer-pays-commitment'),
  false,
  'an admin''s acceptance does not count for the organisation'
);
select pg_temp.consent(:'owner', 'employer-pays-commitment', :commitment_v);
select is(
  private.org_consent_current(:'org1', 'employer-pays-commitment') || ',' || private.org_consent_current(:'org2', 'employer-pays-commitment'),
  'true,false',
  'the owner''s acceptance of the current version counts for that organisation only'
);
select pg_temp.publish('employer-pays-commitment', false);
select is(
  private.org_consent_current(:'org1', 'employer-pays-commitment'),
  false,
  'a new version of the commitment is not accepted until the owner accepts it'
);
select pg_temp.consent(:'owner', 'employer-pays-commitment', :commitment_v + 1);
select is(private.org_consent_current(:'org1', 'employer-pays-commitment'), true, 'the owner''s acceptance of the new version counts');
select pg_temp.consent(:'owner', 'employer-pays-commitment', :commitment_v + 1, 'withdrawn');
select is(private.org_consent_current(:'org1', 'employer-pays-commitment'), false, 'only the latest consent counts: a withdrawal ends it');
select pg_temp.consent(:'owner', 'employer-pays-commitment', :commitment_v + 1);
update public.organization_members set role = 'admin' where organization_id = :'org1' and user_id = :'owner';
update public.organization_members set role = 'owner' where organization_id = :'org1' and user_id = :'padm';
select is(
  private.org_consent_current(:'org1', 'employer-pays-commitment'),
  false,
  'after a transfer of ownership the new owner must accept again (DATA_MODEL.md section 11, point 2)'
);
select is(
  private.org_consent_current(:'org1', 'no-such-document') || ',' || private.org_consent_current(gen_random_uuid(), 'employer-pays-commitment'),
  'false,false',
  'a slug without a published version and an unknown organisation are never accepted'
);
select is(
  (select string_agg(r.role || ':' || has_function_privilege(r.role, 'private.org_consent_current(uuid, text)', 'execute'), ',')
   from unnest(array['anon', 'authenticated', 'service_role']) r (role)),
  'anon:false,authenticated:false,service_role:false',
  'no API role may run the organisation consent helper'
);
select is(
  pg_temp.read_as(:'owner2', 'authenticated', $$select private.org_consent_current('00000000-0000-0000-0000-0000000c0a01', 'employer-pays-commitment')::text$$),
  '42501|permission denied for function org_consent_current',
  'the owner of another organisation cannot read the consent state of this one'
);
select is(
  pg_temp.read_as(null, 'anon', $$select count(*)::text from public.consents$$),
  '42501|permission denied for table consents',
  'anonymous visitors cannot read consents'
);
select is(
  pg_temp.read_as(:'owner2', 'authenticated', $$select count(*)::text from public.consents where purpose = 'employer-pays-commitment'$$),
  '0',
  'the owner of another organisation sees none of this organisation''s commitment consents'
);

select * from finish();
rollback;
