begin;
select plan(30);

-- Consents per organisation type (V03; FR-J1 AC7, the per-type parts of FR-S4 AC3, AC6 and AC8;
-- docs/phase-2/DATA_MODEL.md section 4). V04 seeds the partner documents as version 0 drafts; here further versions are
-- inserted by the test so that the lists can be exercised.

create function pg_temp.new_user(p_id uuid, p_kind text, p_type text, p_pending jsonb, p_commit boolean default false)
returns void
language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (
    p_id, p_id || '@example.test', now(),
    jsonb_strip_nulls(jsonb_build_object(
      'intended_account_kind', p_kind, 'intended_organization_type', p_type, 'pending_consents', p_pending))
  );
  if p_commit then
    update public.profiles set account_kind = intended_account_kind where id = p_id;
  end if;
end;
$$;

create function pg_temp.call_as(p_user uuid, p_role text, p_sql text) returns text
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
  v_result text := 'ok';
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role)::text end,
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
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role)::text end,
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

create function pg_temp.publish(p_slug text, p_version integer) returns void
language sql as $$
  insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
  values (p_slug, p_version, initcap(replace(p_slug, '-', ' ')), 'Text of ' || p_slug, 'Version ' || p_version || ' of the text',
    now() - make_interval(secs => 100 - p_version), true)
$$;

-- The current versions of the given slugs as consent entries.
create function pg_temp.entries(p_slugs text[]) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object('purpose', s, 'version', private.current_legal_version(s)) order by n)
  from unnest(p_slugs) with ordinality u (s, n)
$$;

create function pg_temp.release(p_on boolean) returns void
language sql as $$
  update private.settings set value = to_jsonb(p_on) where key = 'release_partner_directories'
$$;

create function pg_temp.slugs(p_kind public.account_kind, p_type public.organization_type) returns text
language sql as $$ select array_to_string(private.required_consents(p_kind, p_type), ',') $$;

\set st1 '00000000-0000-0000-0000-0000000c0001'
\set st2 '00000000-0000-0000-0000-0000000c0002'
\set rc1 '00000000-0000-0000-0000-0000000c0003'
\set emp '00000000-0000-0000-0000-0000000c0004'
\set wkr '00000000-0000-0000-0000-0000000c0005'
\set oau '00000000-0000-0000-0000-0000000c0006'

-- The lists ------------------------------------------------------------------------------------------------------------
select is(
  pg_temp.slugs('company', 'recruitment_company') || ' | ' || pg_temp.slugs('company', 'staffing_company'),
  'terms-of-service,privacy-policy,partner-terms,recruitment-company-terms | terms-of-service,privacy-policy,partner-terms,staffing-company-terms',
  'each partner type has its own list in the setting required_consents'
);
select is(
  pg_temp.slugs('company', null) || ' | ' || pg_temp.slugs('company', 'employer') || ' | ' || pg_temp.slugs('worker', null)
    || ' | ' || array_to_string(private.required_consents('company'), ',') || ' | ' || array_to_string(private.required_consents('worker'), ','),
  'terms-of-service,privacy-policy,employer-terms | terms-of-service,privacy-policy,employer-terms | '
    || 'terms-of-service,privacy-policy,worker-terms,age-18-plus | terms-of-service,privacy-policy,employer-terms | '
    || 'terms-of-service,privacy-policy,worker-terms,age-18-plus',
  'the employer and worker lists are unchanged, through both overloads'
);
select is(
  pg_temp.slugs('worker', 'staffing_company'),
  'terms-of-service,privacy-policy,worker-terms,age-18-plus',
  'a worker never gets a partner list'
);

-- signup_documents ------------------------------------------------------------------------------------------------------
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.signup_documents('company', 'staffing_company')$$),
  'P0001|CHARA_FORBIDDEN|release_off',
  'the partner lists are closed while release 2a is off'
);
select pg_temp.release(true);
select is(
  pg_temp.read_as(null, 'anon', $$select string_agg(slug || ':' || version, ',') from public.signup_documents('company', 'staffing_company')$$),
  'terms-of-service:0,privacy-policy:0,partner-terms:0,staffing-company-terms:0',
  'with release 2a on, the partner list returns the draft placeholders that V04 seeds'
);
select pg_temp.publish('partner-terms', 1);
select pg_temp.publish('recruitment-company-terms', 1);
select pg_temp.publish('staffing-company-terms', 1);
select is(
  pg_temp.read_as(null, 'anon', $$select string_agg(slug || ':' || version, ',') from public.signup_documents('company', 'staffing_company')$$),
  'terms-of-service:0,privacy-policy:0,partner-terms:1,staffing-company-terms:1',
  'signup_documents for the staffing type returns exactly its four documents with their current versions'
);
select is(
  pg_temp.read_as(null, 'anon', $$select string_agg(slug, ',') from public.signup_documents('company')$$)
    || ' | ' || pg_temp.read_as(null, 'anon', $$select string_agg(slug, ',') from public.signup_documents('company', 'employer')$$)
    || ' | ' || pg_temp.read_as(null, 'anon', $$select string_agg(slug, ',') from public.signup_documents('worker')$$),
  'terms-of-service,privacy-policy,employer-terms | terms-of-service,privacy-policy,employer-terms | '
    || 'terms-of-service,privacy-policy,worker-terms,age-18-plus',
  'the employer and worker sign-up documents are unchanged'
);
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.signup_documents('worker', 'recruitment_company')$$),
  'P0001|CHARA_INVALID_INPUT|organization_type',
  'a worker cannot ask for a partner list'
);

-- FR-J1 AC7: set_account_kind and accept_consents --------------------------------------------------------------------
select pg_temp.new_user(:'st1', 'company', 'staffing_company',
  pg_temp.entries(array['terms-of-service', 'privacy-policy', 'partner-terms', 'staffing-company-terms']));
select pg_temp.new_user(:'st2', 'company', 'staffing_company',
  pg_temp.entries(array['terms-of-service', 'privacy-policy', 'staffing-company-terms']));
select pg_temp.new_user(:'emp', 'company', null, pg_temp.entries(array['terms-of-service', 'privacy-policy', 'employer-terms']));
select pg_temp.new_user(:'wkr', 'worker', null,
  pg_temp.entries(array['terms-of-service', 'privacy-policy', 'worker-terms', 'age-18-plus']));
select is(
  pg_temp.read_as(:'st1', 'authenticated', 'select public.set_account_kind()::text'),
  'company',
  'the staffing user commits the account kind'
);
select is(
  (select string_agg(purpose || ':' || version || ':' || action, ',' order by purpose) from public.consents where user_id = :'st1'),
  'partner-terms:1:granted,privacy-policy:0:granted,staffing-company-terms:1:granted,terms-of-service:0:granted',
  'four granted consent rows with the current versions are written'
);
select is(
  pg_temp.call_as(:'st1', 'authenticated', format('select public.accept_consents(%L)', pg_temp.entries(array['recruitment-company-terms'])))
    || ',' ||
  pg_temp.call_as(:'st1', 'authenticated', format('select public.accept_consents(%L)', pg_temp.entries(array['employer-terms']))),
  'P0001|CHARA_INVALID_INPUT|recruitment-company-terms,P0001|CHARA_INVALID_INPUT|employer-terms',
  'a staffing company cannot accept the documents of the other partner type or of employers'
);
select is(
  pg_temp.call_as(:'st2', 'authenticated', 'select public.set_account_kind()'),
  'P0001|CHARA_CONSENT_REQUIRED|partner-terms',
  'without partner-terms the staffing user cannot commit the kind'
);
select is(
  coalesce((select account_kind::text from public.profiles where id = :'st2'), 'null')
    || ' ' || (select count(*) from public.consents where user_id = :'st2'),
  'null 0',
  'the refused commit wrote nothing'
);
select is(
  pg_temp.read_as(:'emp', 'authenticated', 'select public.set_account_kind()::text')
    || ',' || pg_temp.read_as(:'wkr', 'authenticated', 'select public.set_account_kind()::text'),
  'company,worker',
  'employer and worker sign-ups commit as before'
);
select is(
  pg_temp.call_as(:'emp', 'authenticated', format('select public.accept_consents(%L)', pg_temp.entries(array['partner-terms'])))
    || ',' ||
  pg_temp.call_as(:'wkr', 'authenticated', format('select public.accept_consents(%L)', pg_temp.entries(array['staffing-company-terms']))),
  'P0001|CHARA_INVALID_INPUT|partner-terms,P0001|CHARA_INVALID_INPUT|staffing-company-terms',
  'an employer and a worker cannot accept partner documents'
);
select is(
  pg_temp.call_as(:'emp', 'authenticated', format('select public.accept_consents(%L)', pg_temp.entries(array['employer-terms']))),
  'ok',
  'an employer still accepts its own documents'
);
select is(
  (select metadata ->> 'organization_type' from audit.log where entity_id = :'st1' and action = 'account_kind_set')
    || ',' || coalesce((select metadata ->> 'organization_type' from audit.log where entity_id = :'emp' and action = 'account_kind_set'), 'none'),
  'staffing_company,none',
  'the audit row of the commit names the partner type, and the employer row is unchanged'
);

-- choose_account_kind (an OAuth sign-up chooses a partner type) ---------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (:'oau', 'oau@example.test', now(), '{}');
select is(
  pg_temp.call_as(:'oau', 'authenticated', format($$select public.choose_account_kind('worker', %L, 'recruitment_company')$$,
    pg_temp.entries(array['terms-of-service'])))
    || ',' ||
  pg_temp.call_as(:'oau', 'authenticated', format($$select public.choose_account_kind('company', %L, 'recruitment_company')$$,
    pg_temp.entries(array['terms-of-service', 'privacy-policy', 'employer-terms']))),
  'P0001|CHARA_INVALID_INPUT|organization_type,P0001|CHARA_CONSENT_REQUIRED|partner-terms',
  'a worker cannot choose a partner type, and a recruitment company must accept its own documents'
);
select is(
  coalesce((select account_kind::text from public.profiles where id = :'oau'), 'null')
    || ' ' || coalesce((select intended_organization_type::text from public.profiles where id = :'oau'), 'null'),
  'null null',
  'the refused choice changed nothing'
);
select pg_temp.release(false);
select is(
  pg_temp.call_as(:'oau', 'authenticated', format($$select public.choose_account_kind('company', %L, 'recruitment_company')$$,
    pg_temp.entries(array['terms-of-service', 'privacy-policy', 'partner-terms', 'recruitment-company-terms']))),
  'P0001|CHARA_FORBIDDEN|organization_type_not_available',
  'a partner type cannot be chosen while release 2a is off'
);
select pg_temp.release(true);
select is(
  pg_temp.call_as(:'oau', 'authenticated', format($$select public.choose_account_kind('company', %L, 'recruitment_company')$$,
    pg_temp.entries(array['terms-of-service', 'privacy-policy', 'partner-terms', 'recruitment-company-terms']))),
  'ok',
  'the OAuth user chooses a recruitment company with its four documents'
);
select is(
  (select account_kind || ' ' || intended_organization_type from public.profiles where id = :'oau')
    || ' ' || (select count(*) from public.consents where user_id = :'oau'),
  'company recruitment_company 4',
  'the kind is committed with the partner type and the four consents'
);
select is(
  pg_temp.call_as(:'oau', 'authenticated', $$select public.choose_account_kind('company')$$)
    || ',' ||
  pg_temp.read_as(:'oau', 'authenticated', $$select public.choose_account_kind('company', '[]', 'recruitment_company')::text$$),
  'P0001|CHARA_FORBIDDEN|account_kind is committed,company',
  'a committed partner cannot become an employer, and the same choice again is answered with the kind'
);
select pg_temp.new_user(:'rc1', 'company', 'recruitment_company', '[]');
select is(
  pg_temp.call_as(:'rc1', 'authenticated', format($$select public.choose_account_kind('company', %L, 'staffing_company')$$,
    pg_temp.entries(array['terms-of-service', 'privacy-policy', 'partner-terms', 'staffing-company-terms']))),
  'P0001|CHARA_FORBIDDEN|intended_account_kind cannot be changed',
  'a user who named a partner type at sign-up cannot choose the other one'
);

-- FR-S4 AC6 (per-type part): a new version of the type's document asks only that type again ----------------------------
select pg_temp.publish('staffing-company-terms', 2);
select is(
  pg_temp.read_as(:'st1', 'authenticated', $$select string_agg(slug || ':' || version, ',') from public.pending_reconsents()$$),
  'staffing-company-terms:2',
  'a staffing company is asked to accept the new version of the staffing terms'
);
select is(
  coalesce(pg_temp.read_as(:'oau', 'authenticated', $$select string_agg(slug, ',') from public.pending_reconsents()$$), 'none')
    || ',' || coalesce(pg_temp.read_as(:'emp', 'authenticated', $$select string_agg(slug, ',') from public.pending_reconsents()$$), 'none'),
  'none,none',
  'a recruitment company and an employer are not asked'
);

-- FR-S4 AC8 (per-type part): only the users of the type are told of a new version ---------------------------------------
create temp table t_users (id uuid, kind text, type text);
insert into t_users
select gen_random_uuid(), k, t from (values
  ('company', 'recruitment_company'), ('company', 'recruitment_company'), ('company', 'recruitment_company'),
  ('company', 'recruitment_company'), ('company', 'staffing_company'), ('company', 'staffing_company'),
  ('company', 'staffing_company'), ('worker', null), ('worker', null), ('worker', null), ('worker', null), ('worker', null),
  ('company', null), ('company', null)) v (k, t);
select pg_temp.new_user(id, kind, type, '[]', true) from t_users;
insert into public.consents (user_id, purpose, version, action)
select u.id, s, case when s in ('partner-terms', 'recruitment-company-terms', 'staffing-company-terms') then 1 else 0 end, 'granted'
from t_users u, unnest(private.required_consents(u.kind::public.account_kind, u.type::public.organization_type)) s
where s <> 'staffing-company-terms';
select pg_temp.publish('recruitment-company-terms', 2);
select pg_temp.publish('worker-terms', 1);
select pg_temp.publish('partner-terms', 2);
select pg_temp.publish('immigration-disclaimer', 1);
select is(
  (select sum(queued) from public.account_ops_fan_out_legal_version('recruitment-company-terms', 2))::integer,
  5,
  'the recruitment company terms reach the 4 recruitment companies of the table and the OAuth recruitment company'
);
select is(
  (select sum(queued) from public.account_ops_fan_out_legal_version('worker-terms', 1))::integer
    || ',' || (select sum(queued) from public.account_ops_fan_out_legal_version('partner-terms', 2))::integer
    || ',' || (select sum(queued) from public.account_ops_fan_out_legal_version('employer-terms', 0))::integer,
  '6,9,0',
  'the worker terms reach the 6 workers, the partner terms both partner types (7 in the table, the staffing and the OAuth user)'
);
select is(
  (select count(*) from public.account_ops_fan_out_legal_version('immigration-disclaimer', 1)),
  0::bigint,
  'a document no list requires queues nothing'
);
select is(
  (select count(*) from pgmq.q_notifications q where q.message ->> 'kind' = 'legal_version'
     and q.message ->> 'document_slug' = 'recruitment-company-terms'
     and (q.message ->> 'user_id')::uuid in (select id from t_users where type = 'recruitment_company')),
  4::bigint,
  'the 4 messages are addressed to the recruitment companies'
);

select * from finish();
rollback;
