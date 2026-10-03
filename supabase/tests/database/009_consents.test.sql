begin;
select plan(49);

create function pg_temp.new_user(p_id uuid, p_kind text, p_pending jsonb, p_confirmed boolean default true) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (
    p_id, p_id || '@example.test', case when p_confirmed then now() end,
    jsonb_build_object('intended_account_kind', p_kind, 'pending_consents', p_pending)
  )
$$;

-- Runs p_sql as p_role with the given user and returns 'ok' or 'sqlstate|message|detail'.
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

create function pg_temp.docs(p_user uuid) returns text
language sql as $$
  select coalesce(string_agg(c.purpose || ':' || c.version || ':' || c.action, ',' order by c.id), '')
  from public.consents c where c.user_id = p_user
$$;

\set w '00000000-0000-0000-0000-00000000a001'
\set c '00000000-0000-0000-0000-00000000b002'
\set s '00000000-0000-0000-0000-00000000d004'

select pg_temp.new_user(
  :'w', 'worker',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0},{"purpose":"age-18-plus","version":0}]'
);
select pg_temp.new_user(
  :'c', 'company',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"employer-terms","version":0}]'
);
select pg_temp.new_user(
  :'s', 'worker',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0},{"purpose":"age-18-plus","version":0}]'
);
select ok(
  bool_and(pg_temp.call_as(u, 'authenticated', 'select public.set_account_kind()') = 'ok'),
  'the three users of this file commit their account kind'
)
from (values (:'w'::uuid), (:'c'::uuid), (:'s'::uuid)) v(u);

-- Structure
select has_table('public', 'consents', 'consents exists');
select columns_are(
  'public', 'consents', array['id', 'user_id', 'purpose', 'version', 'action', 'created_at'],
  'consents holds the ledger columns only'
);
select enum_has_labels('public', 'consent_action', array['granted', 'withdrawn'], 'consent actions are granted and withdrawn');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.consents'::regclass),
  'consents has RLS enabled and forced'
);
select is(
  (select array_agg(tgenabled::text order by tgname) from pg_trigger
    where tgrelid = 'public.consents'::regclass and tgname in ('consents_append_only', 'consents_no_truncate')),
  array['A', 'A'],
  'both append-only triggers are ENABLE ALWAYS'
);
select ok(
  not has_any_column_privilege('anon', 'public.consents', 'select, insert, update')
  and not has_any_column_privilege('service_role', 'public.consents', 'select, insert, update')
  and not has_table_privilege('authenticated', 'public.consents', 'insert, update, delete, truncate')
  and not has_any_column_privilege('authenticated', 'public.consents', 'insert, update'),
  'authenticated may only read consents; anon and service_role have no access'
);
select is_definer('public', 'accept_consents', array['jsonb'], 'accept_consents is SECURITY DEFINER');
select is_definer('public', 'withdraw_consent', array['text'], 'withdraw_consent is SECURITY DEFINER');
select is_empty(
  $$select p.oid::regprocedure from pg_proc p
    where p.oid in ('public.accept_consents(jsonb)'::regprocedure, 'public.withdraw_consent(text)'::regprocedure)
      and not ('search_path=""' = any (p.proconfig))$$,
  'the RPCs set search_path to empty'
);
select ok(
  not has_function_privilege('anon', 'public.accept_consents(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.accept_consents(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.accept_consents(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.withdraw_consent(text)', 'execute')
  and not has_function_privilege('service_role', 'public.withdraw_consent(text)', 'execute')
  and has_function_privilege('authenticated', 'public.withdraw_consent(text)', 'execute'),
  'only authenticated may execute the RPCs'
);

select is(
  pg_temp.docs(:'w'),
  'terms-of-service:0:granted,privacy-policy:0:granted,worker-terms:0:granted,age-18-plus:0:granted',
  'the ledger of a committed worker holds one granted row per required document'
);

insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
values ('privacy-policy', 1, 'Privacy Policy', 'Approved text.', 'The first approved version.', now());

-- accept_consents
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.accept_consents('[{"purpose":"worker-terms","version":0}]')$$),
  'ok',
  'accepting a version already granted succeeds'
);
select is(
  (select count(*) from public.consents where user_id = :'w' and purpose = 'worker-terms'),
  1::bigint,
  'accepting the same purpose and version twice adds no second row'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.accept_consents('[{"purpose":"privacy-policy","version":0}]')$$),
  'P0001|CHARA_CONSENT_REQUIRED|privacy-policy',
  'a superseded version is refused with CHARA_CONSENT_REQUIRED'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.accept_consents('[{"purpose":"privacy-policy","version":1},{"purpose":"privacy-policy","version":1}]')$$),
  'ok',
  'the current version of a document is accepted'
);
select is(
  (select count(*) from public.consents where user_id = :'w' and purpose = 'privacy-policy' and version = 1),
  1::bigint,
  'a duplicate entry in one call adds one row'
);
select is(
  (select count(*) from audit.log where action = 'consents_accepted' and entity_id = :'w'),
  2::bigint,
  'only a call that recorded something writes an audit row'
);
select is(
  pg_temp.call_as(:'c', 'authenticated', $$select public.accept_consents('[{"purpose":"worker-terms","version":0}]')$$),
  'P0001|CHARA_INVALID_INPUT|worker-terms',
  'a company user cannot accept the worker terms'
);
select is(
  pg_temp.call_as(:'c', 'authenticated', $$select public.accept_consents('[{"purpose":"age-18-plus","version":0}]')$$),
  'P0001|CHARA_INVALID_INPUT|age-18-plus',
  'a company user cannot attest an age'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.accept_consents('[{"purpose":"employer-terms","version":0}]')$$),
  'P0001|CHARA_INVALID_INPUT|employer-terms',
  'a worker cannot accept the employer terms'
);
select is(
  pg_temp.call_as(:'c', 'authenticated', $$select public.accept_consents('[{"purpose":"subscription-and-billing-terms","version":0}]')$$),
  'ok',
  'a company user accepts the subscription and billing terms'
);
select is(
  pg_temp.docs(:'c'),
  'terms-of-service:0:granted,privacy-policy:0:granted,employer-terms:0:granted,subscription-and-billing-terms:0:granted',
  'the billing terms acceptance is appended to the ledger'
);
select is(
  pg_temp.call_as(:'c', 'authenticated', $$select public.accept_consents('[{"purpose":"no-such-document","version":0}]')$$),
  'P0001|CHARA_INVALID_INPUT|no-such-document',
  'an unknown document is refused'
);
select is(
  pg_temp.call_as(:'c', 'authenticated', $$select public.accept_consents('[{"version":0}]')$$),
  'P0001|CHARA_INVALID_INPUT|each entry needs a purpose and an integer version',
  'an entry without a purpose is refused'
);
select is(
  pg_temp.call_as(:'c', 'authenticated', $$select public.accept_consents('[{"purpose":"cookie-policy","version":"x"}]')$$),
  'P0001|CHARA_INVALID_INPUT|each entry needs a purpose and an integer version',
  'an entry with a non-numeric version is refused'
);
select is(
  pg_temp.call_as(:'c', 'authenticated', $$select public.accept_consents('{"purpose":"cookie-policy"}')$$),
  'P0001|CHARA_INVALID_INPUT|p_consents must be an array of at most 20 entries',
  'consents that are not a list are refused'
);
select is(
  pg_temp.call_as(:'c', 'authenticated', $$select public.accept_consents(null)$$),
  'P0001|CHARA_INVALID_INPUT|p_consents must be an array of at most 20 entries',
  'null consents are refused'
);
select is(
  pg_temp.call_as(null, 'anon', $$select public.accept_consents('[]')$$),
  '42501|permission denied for function accept_consents|',
  'an anonymous caller cannot accept consents'
);
select is(
  pg_temp.call_as('00000000-0000-0000-0000-0000000000ff', 'authenticated', $$select public.accept_consents('[]')$$),
  'P0001|CHARA_FORBIDDEN|',
  'a caller without a profile cannot accept consents'
);
select is(
  pg_temp.call_as(:'c', 'service_role', $$select public.accept_consents('[]')$$),
  '42501|permission denied for function accept_consents|',
  'service_role cannot call accept_consents'
);

select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.accept_consents('[{"purpose":"privacy-policy","version":7}]')$$),
  'P0001|CHARA_INVALID_INPUT|privacy-policy',
  'a version that does not exist is refused with CHARA_INVALID_INPUT'
);
insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
values ('privacy-policy', 2, 'Privacy Policy', 'Future text.', 'A version dated in the future.', now() + interval '1 day');
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.accept_consents('[{"purpose":"privacy-policy","version":2}]')$$),
  'P0001|CHARA_INVALID_INPUT|privacy-policy',
  'a future-dated version cannot be accepted yet'
);

-- withdraw_consent
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.withdraw_consent('worker-terms')$$),
  'ok',
  'a worker withdraws the worker terms'
);
select is(
  pg_temp.docs(:'w'),
  'terms-of-service:0:granted,privacy-policy:0:granted,worker-terms:0:granted,age-18-plus:0:granted,privacy-policy:1:granted,worker-terms:0:withdrawn',
  'a withdrawal appends a row for the last granted version and leaves the old row'
);
select is(
  (select count(*) from audit.log where action = 'consent_withdrawn' and entity_id = :'w'
     and metadata = '{"purpose":"worker-terms","version":0}'),
  1::bigint,
  'a consent_withdrawn audit row exists'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.withdraw_consent('worker-terms')$$),
  'P0001|CHARA_INVALID_INPUT|no granted consent for worker-terms',
  'a consent whose latest row is withdrawn cannot be withdrawn again'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.withdraw_consent('cookie-policy')$$),
  'P0001|CHARA_INVALID_INPUT|no granted consent for cookie-policy',
  'a purpose with no granted row cannot be withdrawn'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', 'select public.withdraw_consent(null)'),
  'P0001|CHARA_INVALID_INPUT|no granted consent for null',
  'a null purpose cannot be withdrawn'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.withdraw_consent('age-18-plus')$$),
  'P0001|CHARA_INVALID_INPUT|age-18-plus',
  'the age attestation cannot be withdrawn'
);
select is(
  (select count(*) from public.consents where user_id = :'w' and purpose = 'age-18-plus'),
  1::bigint,
  'the ledger is unchanged after the refused age withdrawal'
);
select is(
  pg_temp.call_as(null, 'anon', $$select public.withdraw_consent('worker-terms')$$),
  '42501|permission denied for function withdraw_consent|',
  'an anonymous caller cannot withdraw a consent'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.accept_consents('[{"purpose":"worker-terms","version":0}]')$$),
  'ok',
  'accepting again after a withdrawal is allowed'
);
select is(
  (select string_agg(action::text, ',' order by id) from public.consents where user_id = :'w' and purpose = 'worker-terms'),
  'granted,withdrawn,granted',
  'the worker terms ledger reads granted, withdrawn, granted in order'
);

-- A suspended user cannot accept, but may withdraw
select is(
  pg_temp.docs(:'s'),
  'terms-of-service:0:granted,privacy-policy:0:granted,worker-terms:0:granted,age-18-plus:0:granted',
  'the user to be suspended holds four granted rows'
);
update public.profiles set status = 'suspended' where id = :'s';
select is(
  pg_temp.call_as(:'s', 'authenticated', $$select public.accept_consents('[{"purpose":"cookie-policy","version":0}]')$$),
  'P0001|CHARA_FORBIDDEN|profile_not_active',
  'a suspended user cannot accept consents'
);
update public.profiles set status = 'deletion_pending' where id = :'s';
select is(
  pg_temp.call_as(:'s', 'authenticated', $$select public.accept_consents('[{"purpose":"cookie-policy","version":0}]')$$),
  'P0001|CHARA_FORBIDDEN|profile_not_active',
  'a user whose deletion is pending cannot accept consents'
);
update public.profiles set status = 'suspended' where id = :'s';
select is(
  pg_temp.call_as(:'s', 'authenticated', $$select public.withdraw_consent('worker-terms')$$),
  'ok',
  'a suspended user may still withdraw a consent'
);
select is(
  (select count(*) from public.consents where user_id = :'s' and purpose = 'worker-terms' and action = 'withdrawn'),
  1::bigint,
  'the withdrawal of the suspended user is on the ledger'
);

select * from finish();
rollback;
