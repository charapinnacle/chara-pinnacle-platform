begin;
select plan(52);

-- An account that signed up with no kind, as a Google sign-up does (Auth gives it provider google in app_metadata).
create function pg_temp.new_oauth_user(p_id uuid, p_confirmed boolean default true) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (
    p_id, p_id || '@example.test', case when p_confirmed then now() end,
    '{"provider":"google","providers":["google"]}',
    '{"iss":"https://accounts.google.com","email_verified":true,"full_name":"Ana Example"}'
  )
$$;

create function pg_temp.new_user(p_id uuid, p_kind text, p_pending jsonb) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@example.test', now(), jsonb_build_object('intended_account_kind', p_kind, 'pending_consents', p_pending))
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


create function pg_temp.audit_count(p_user uuid, p_action text) returns bigint
language sql as $$ select count(*) from audit.log where action = p_action and entity_id = p_user::text $$;

\set w '00000000-0000-0000-0000-00000000a001'
\set c '00000000-0000-0000-0000-00000000b002'
\set u '00000000-0000-0000-0000-00000000c003'
\set s '00000000-0000-0000-0000-00000000d004'
\set e '00000000-0000-0000-0000-00000000e005'
\set n '00000000-0000-0000-0000-00000000f006'
\set x '00000000-0000-0000-0000-00000000a007'
\set y '00000000-0000-0000-0000-00000000a008'

\set worker_docs '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0},{"purpose":"age-18-plus","version":0}]'
\set company_docs '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"employer-terms","version":0}]'

select pg_temp.new_oauth_user(:'w');
select pg_temp.new_oauth_user(:'c');
select pg_temp.new_oauth_user(:'u', false);
select pg_temp.new_oauth_user(:'s');
update public.profiles set status = 'suspended' where id = :'s';
select pg_temp.new_user(:'e', 'worker', '[{"purpose":"terms-of-service","version":0}]');
select pg_temp.new_oauth_user(:'x');

select is_definer('public', 'choose_account_kind', array['account_kind', 'jsonb'], 'choose_account_kind is SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = 'public.choose_account_kind(public.account_kind, jsonb)'::regprocedure),
  array['search_path=""'],
  'choose_account_kind sets search_path to empty'
);
select ok(
  not has_function_privilege('anon', 'public.choose_account_kind(public.account_kind, jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.choose_account_kind(public.account_kind, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.choose_account_kind(public.account_kind, jsonb)', 'execute'),
  'only authenticated may execute choose_account_kind'
);

-- A sign-up that names no kind has a profile without one
select is(
  (select p.intended_account_kind is null and p.account_kind is null and p.pending_consents = '[]'::jsonb and p.status = 'active'
     from public.profiles p where p.id = :'w'),
  true,
  'a Google sign-up has a profile with no intended kind, no committed kind and no pending consents'
);
select is(
  (select count(*) from public.consents where user_id in (:'w', :'c')),
  0::bigint,
  'no consents row exists before the kind is chosen'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', 'select 1 / (case when private.account_kind() is null then 1 else 0 end)'),
  'ok',
  'private.account_kind() is null for a user without a kind'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', 'select * from public.pending_reconsents()'),
  'ok',
  'a user without a kind has no documents to re-accept and gets no error'
);

-- A user without a kind cannot do what a worker or a company user does
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.create_organization('employer', 'Acme GmbH', 'Acme', 'DE', null)$$),
  'P0001|CHARA_FORBIDDEN|company_account_required',
  'a user without a kind cannot create an organization'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.accept_consents('[{"purpose":"terms-of-service","version":0}]')$$),
  'P0001|CHARA_FORBIDDEN|account_kind_not_chosen',
  'a user without a kind cannot record consents'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.accept_consents('[{"purpose":"employer-terms","version":0}]')$$),
  'P0001|CHARA_FORBIDDEN|account_kind_not_chosen',
  'a user without a kind cannot record the consent of a kind they may never choose'
);
select is(pg_temp.docs(:'w'), '', 'the refused consent calls wrote nothing');

-- Refused choices
select is(
  pg_temp.call_as(:'u', 'authenticated', format($$select public.choose_account_kind('worker', %L)$$, :'worker_docs')),
  'P0001|CHARA_FORBIDDEN|email_unconfirmed',
  'a user with an unconfirmed email cannot choose a kind'
);
select is(
  pg_temp.call_as(:'s', 'authenticated', format($$select public.choose_account_kind('worker', %L)$$, :'worker_docs')),
  'P0001|CHARA_FORBIDDEN|profile_not_active',
  'a suspended user cannot choose a kind'
);
select is(
  pg_temp.call_as(null, 'anon', format($$select public.choose_account_kind('worker', %L)$$, :'worker_docs')),
  '42501|permission denied for function choose_account_kind|',
  'an anonymous caller is refused at EXECUTE'
);
select is(
  pg_temp.call_as(null, 'service_role', format($$select public.choose_account_kind('worker', %L)$$, :'worker_docs')),
  '42501|permission denied for function choose_account_kind|',
  'service_role is refused at EXECUTE'
);
select is(
  pg_temp.call_as(null, 'authenticated', format($$select public.choose_account_kind('worker', %L)$$, :'worker_docs')),
  'P0001|CHARA_FORBIDDEN|',
  'a caller without a user id is refused'
);
select is(
  pg_temp.call_as('00000000-0000-0000-0000-0000000000ff', 'authenticated', format($$select public.choose_account_kind('worker', %L)$$, :'worker_docs')),
  'P0001|CHARA_FORBIDDEN|',
  'a caller without a profile is refused'
);
select is(
  pg_temp.call_as(:'x', 'authenticated', $$select public.choose_account_kind(null)$$),
  'P0001|CHARA_INVALID_INPUT|p_kind is required',
  'a missing kind is refused'
);
select is(
  (select count(*) from public.profiles where id in (:'u', :'s', :'x') and (account_kind is not null or intended_account_kind is not null))
  + (select count(*) from public.consents where user_id in (:'u', :'s', :'x'))
  + (select count(*) from audit.log where action = 'account_kind_set' and entity_id in (:'u', :'s', :'x')),
  0::bigint,
  'refused choices leave no kind, no consents and no audit row'
);

-- Incomplete or invalid consent sets roll the choice back, so the user can still choose either kind
select is(
  pg_temp.call_as(:'x', 'authenticated', $$select public.choose_account_kind('worker', '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0}]')$$),
  'P0001|CHARA_CONSENT_REQUIRED|age-18-plus',
  'a worker choice without the age attestation is refused'
);
select is(
  pg_temp.call_as(:'x', 'authenticated', $$select public.choose_account_kind('worker', '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"age-18-plus","version":0}]')$$),
  'P0001|CHARA_CONSENT_REQUIRED|worker-terms',
  'a worker choice without the worker terms is refused'
);
select is(
  pg_temp.call_as(:'x', 'authenticated', $$select public.choose_account_kind('worker')$$),
  'P0001|CHARA_CONSENT_REQUIRED|terms-of-service',
  'a choice without any consent is refused'
);
select is(
  pg_temp.call_as(:'x', 'authenticated', $$select public.choose_account_kind('company', '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0}]')$$),
  'P0001|CHARA_CONSENT_REQUIRED|employer-terms',
  'a company choice with the documents of a worker is refused'
);
select is(
  pg_temp.call_as(:'x', 'authenticated', $$select public.choose_account_kind('worker', '[{"purpose":"terms-of-service","version":99},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0},{"purpose":"age-18-plus","version":0}]')$$),
  'P0001|CHARA_INVALID_INPUT|terms-of-service',
  'a version that does not exist is refused'
);
select is(
  (select intended_account_kind is null and account_kind is null from public.profiles where id = :'x')
  and pg_temp.docs(:'x') = '',
  true,
  'after the refusals the user still has no kind and no consents row'
);

-- Worker choice
select is(
  pg_temp.call_as(:'w', 'authenticated', format($$select public.choose_account_kind('worker', %L)$$, :'worker_docs')),
  'ok',
  'a user without a kind chooses worker with the documents of a worker'
);
select is(
  (select p.intended_account_kind::text || '/' || p.account_kind::text || '/' || p.pending_consents::text from public.profiles p where p.id = :'w'),
  'worker/worker/[]',
  'the intended and the committed kind are the chosen kind and no consents stay pending'
);
select is(
  pg_temp.docs(:'w'),
  'terms-of-service:0:granted,privacy-policy:0:granted,worker-terms:0:granted,age-18-plus:0:granted',
  'four consents rows, the age attestation among them, are written with the choice'
);
select is(
  (select metadata ->> 'kind' from audit.log where action = 'account_kind_set' and entity_id = :'w'),
  'worker',
  'the choice is audited with the kind'
);
select is(pg_temp.audit_count(:'w', 'consents_accepted'), 1::bigint, 'one consents_accepted audit row is written');

-- Company choice: the age attestation of a worker is ignored
select is(
  pg_temp.call_as(:'c', 'authenticated', $$select public.choose_account_kind('company', '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"employer-terms","version":0},{"purpose":"age-18-plus","version":0}]')$$),
  'ok',
  'a user without a kind chooses company'
);
select is(
  pg_temp.docs(:'c'),
  'terms-of-service:0:granted,privacy-policy:0:granted,employer-terms:0:granted',
  'three consents rows are written and an age attestation sent with them is ignored'
);

-- Once committed, the kind cannot be chosen again
select is(
  pg_temp.call_as(:'w', 'authenticated', format($$select public.choose_account_kind('worker', %L)$$, :'worker_docs')),
  'ok',
  'repeating the same choice is accepted'
);
select is(
  pg_temp.docs(:'w') = 'terms-of-service:0:granted,privacy-policy:0:granted,worker-terms:0:granted,age-18-plus:0:granted'
  and pg_temp.audit_count(:'w', 'account_kind_set') = 1,
  true,
  'repeating the same choice writes no second consents row and no second audit row'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', format($$select public.choose_account_kind('company', %L)$$, :'company_docs')),
  'P0001|CHARA_FORBIDDEN|account_kind is committed',
  'a committed worker cannot choose company'
);
select is(
  (select account_kind::text from public.profiles where id = :'w'),
  'worker',
  'the kind is still worker'
);

-- A user who named the kind at sign-up cannot choose another one
select is(
  pg_temp.call_as(:'e', 'authenticated', format($$select public.choose_account_kind('company', %L)$$, :'company_docs')),
  'P0001|CHARA_FORBIDDEN|intended_account_kind cannot be changed',
  'a user who signed up as a worker cannot choose company'
);
select is(
  pg_temp.call_as(:'e', 'authenticated', format($$select public.choose_account_kind('worker', %L)$$, :'worker_docs')),
  'ok',
  'a user who signed up as a worker may choose worker with the documents'
);

-- The kind of a user who chose it is as immutable as any other
select throws_ok(
  $$update public.profiles set intended_account_kind = 'company' where id = '00000000-0000-0000-0000-00000000a001'$$,
  'P0001', 'CHARA_FORBIDDEN', 'the table owner cannot change a chosen kind'
);
select throws_ok(
  $$update public.profiles set account_kind = 'company' where id = '00000000-0000-0000-0000-00000000a001'$$,
  'P0001', 'CHARA_FORBIDDEN', 'the table owner cannot change a committed kind'
);
select pg_temp.new_oauth_user(:'n');
select throws_ok(
  $$update public.profiles set account_kind = 'worker' where id = '00000000-0000-0000-0000-00000000f006'$$,
  'P0001', 'CHARA_FORBIDDEN', 'a kind cannot be committed while none is intended'
);
select lives_ok(
  $$update public.profiles set intended_account_kind = 'worker' where id = '00000000-0000-0000-0000-00000000f006'$$,
  'the intended kind can be set once from null'
);
select throws_ok(
  $$update public.profiles set intended_account_kind = 'company' where id = '00000000-0000-0000-0000-00000000f006'$$,
  'P0001', 'CHARA_FORBIDDEN', 'the intended kind cannot be set twice'
);
select throws_ok(
  $$update public.profiles set intended_account_kind = null where id = '00000000-0000-0000-0000-00000000f006'$$,
  'P0001', 'CHARA_FORBIDDEN', 'the intended kind cannot be cleared'
);
select throws_ok(
  $$select pg_temp.new_user('00000000-0000-0000-0000-00000000c0c0', 'admin', '[]')$$,
  'P0001', 'CHARA_INVALID_INPUT', 'a sign-up that names another kind than worker or company is still refused'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', $$update public.profiles set intended_account_kind = 'company' where id = auth.uid()$$),
  '42501|permission denied for table profiles|',
  'authenticated has no grant to update the kind'
);
select is(
  pg_temp.call_as(:'n', 'authenticated', $$update public.profiles set intended_account_kind = 'company' where id = auth.uid()$$),
  '42501|permission denied for table profiles|',
  'authenticated has no grant to set the intended kind of an account without one'
);

select pg_temp.new_oauth_user(:'y');
-- A superseded version is refused until the current one is accepted
insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
values ('privacy-policy', 1, 'Privacy Policy', 'Text of version 1', 'The wording of the policy changed.', now());
select is(
  pg_temp.call_as(:'y', 'authenticated', format($$select public.choose_account_kind('company', %L)$$, :'company_docs')),
  'P0001|CHARA_CONSENT_REQUIRED|privacy-policy',
  'a superseded version is refused'
);
select is(
  pg_temp.call_as(
    :'y', 'authenticated',
    $$select public.choose_account_kind('company', '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":1},{"purpose":"employer-terms","version":0}]')$$
  ),
  'ok',
  'the current version is accepted and the kind is committed'
);
select is(pg_temp.docs(:'y'), 'terms-of-service:0:granted,privacy-policy:1:granted,employer-terms:0:granted', 'the consent rows carry the current version');

-- The table itself also refuses a committed kind that is not the intended one, with the trigger out of the way
alter table public.profiles disable trigger profiles_guard_account_kind;
select throws_ok(
  $$update public.profiles set account_kind = 'worker' where id = '00000000-0000-0000-0000-00000000c003'$$,
  '23514', null, 'the check constraint refuses a committed kind when no kind is intended'
);
select throws_ok(
  $$update public.profiles set account_kind = 'company' where id = '00000000-0000-0000-0000-00000000a001'$$,
  '23514', null, 'the check constraint refuses a committed kind that differs from the intended one'
);
alter table public.profiles enable always trigger profiles_guard_account_kind;

select * from finish();
rollback;
