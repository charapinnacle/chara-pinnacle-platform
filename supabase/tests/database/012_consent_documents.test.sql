begin;
select plan(38);

create function pg_temp.new_user(p_id uuid, p_kind text, p_pending jsonb) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (
    p_id, p_id || '@example.test', now(),
    jsonb_build_object('intended_account_kind', p_kind, 'pending_consents', p_pending)
  )
$$;

-- Runs p_sql as p_role for p_user (and session p_session) and returns 'ok' or 'sqlstate|message|detail'.
create function pg_temp.call_as(p_user uuid, p_role text, p_sql text, p_session uuid default null) returns text
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
  v_result text := 'ok';
begin
  perform set_config(
    'request.jwt.claims',
    case when p_user is null then ''
      else json_build_object('sub', p_user, 'role', p_role, 'session_id', p_session)::text end,
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

-- The slugs pending_reconsents() returns for p_user in session p_session, in order.
create function pg_temp.pending(p_user uuid, p_session uuid default null) returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
  set local role authenticated;
  select coalesce(string_agg(r.slug || ':' || r.version, ',' order by r.slug), '') into v_result from public.pending_reconsents() r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

\set w '00000000-0000-0000-0000-00000000a001'
\set c '00000000-0000-0000-0000-00000000b002'
\set u '00000000-0000-0000-0000-00000000c003'
\set old_session '00000000-0000-0000-0000-0000000000a1'
\set new_session '00000000-0000-0000-0000-0000000000a2'
\set other_session '00000000-0000-0000-0000-0000000000a3'

select pg_temp.new_user(
  :'w', 'worker',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0},{"purpose":"age-18-plus","version":0}]'
);
select pg_temp.new_user(
  :'c', 'company',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"employer-terms","version":0}]'
);
select pg_temp.new_user(:'u', 'worker', '[]');

-- signup_documents
select is_definer('public', 'signup_documents', array['account_kind'], 'signup_documents is SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = 'public.signup_documents(public.account_kind)'::regprocedure),
  array['search_path=""'],
  'signup_documents sets search_path to empty'
);
select ok(
  has_function_privilege('anon', 'public.signup_documents(public.account_kind)', 'execute')
  and has_function_privilege('authenticated', 'public.signup_documents(public.account_kind)', 'execute')
  and not has_function_privilege('service_role', 'public.signup_documents(public.account_kind)', 'execute'),
  'anon and authenticated may execute signup_documents, service_role may not'
);
select is(
  (select string_agg(slug || ':' || version, ',') from public.signup_documents('worker')),
  'terms-of-service:0,privacy-policy:0,worker-terms:0,age-18-plus:0',
  'a worker is shown the Terms of Service, Privacy Policy, Worker Terms and the age wording, in the configured order'
);
select is(
  (select string_agg(slug || ':' || version, ',') from public.signup_documents('company')),
  'terms-of-service:0,privacy-policy:0,employer-terms:0',
  'an employer is shown the Terms of Service, Privacy Policy and Employer Terms, and no age wording'
);
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.signup_documents('worker')$$),
  'ok',
  'an anonymous visitor reads the sign-up documents'
);
update public.legal_documents set published_at = now() - interval '1 day'
where slug = 'privacy-policy' and version = 0;
insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
values
  ('privacy-policy', 1, 'Privacy Policy', 'Version one.', 'Describes the new retention periods.', now() - interval '1 hour'),
  ('privacy-policy', 2, 'Privacy Policy', 'Version two.', 'A future-dated version.', now() + interval '1 day'),
  ('privacy-policy', 3, 'Privacy Policy', 'Version three.', 'An unpublished draft version.', null);
select is(
  (select version from public.signup_documents('worker') where slug = 'privacy-policy'),
  1,
  'the current published version is returned, not a future-dated or unpublished one'
);
select is(
  (select change_summary from public.signup_documents('worker') where slug = 'privacy-policy'),
  'Describes the new retention periods.',
  'the change summary of the current version is returned'
);
update public.legal_documents set published_at = null where slug = 'worker-terms' and version = 0;
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.signup_documents('worker')$$),
  'P0001|CHARA_INVALID_INPUT|a required document has no published version',
  'a required document without a published version stops the sign-up page'
);
update public.legal_documents set published_at = now() where slug = 'worker-terms' and version = 0;
update private.settings set value = '{"worker": []}' where key = 'required_consents';
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.signup_documents('worker')$$),
  'P0001|CHARA_INVALID_INPUT|no required consents are configured',
  'an empty list of required documents stops the sign-up page'
);
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.signup_documents('company')$$),
  'P0001|CHARA_INVALID_INPUT|no required consents are configured',
  'a kind without an entry stops the sign-up page'
);
update private.settings set value = '{
  "worker": ["terms-of-service", "privacy-policy", "worker-terms", "age-18-plus"],
  "company": ["terms-of-service", "privacy-policy", "employer-terms"]
}' where key = 'required_consents';

-- pending_reconsents: function properties
select is_definer('public', 'pending_reconsents', 'pending_reconsents is SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = 'public.pending_reconsents()'::regprocedure),
  array['search_path=""'],
  'pending_reconsents sets search_path to empty'
);
select ok(
  has_function_privilege('authenticated', 'public.pending_reconsents()', 'execute')
  and not has_function_privilege('anon', 'public.pending_reconsents()', 'execute')
  and not has_function_privilege('service_role', 'public.pending_reconsents()', 'execute'),
  'only authenticated may execute pending_reconsents'
);
select is(
  pg_temp.call_as(null, 'anon', 'select * from public.pending_reconsents()'),
  '42501|permission denied for function pending_reconsents|',
  'an anonymous caller is refused at EXECUTE'
);
select is(
  pg_temp.call_as(null, 'authenticated', 'select * from public.pending_reconsents()'),
  'P0001|CHARA_FORBIDDEN|',
  'a caller without a user id is refused'
);

-- Nothing is pending before the kind is committed: the onboarding page records the consents then
select is(pg_temp.pending(:'w'), '', 'a user whose kind is not committed has nothing pending');

-- Commit the kinds (consents at version 0 of privacy-policy are superseded by version 1, so accept it first)
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.set_account_kind('[{"purpose":"privacy-policy","version":1}]')$$),
  'ok',
  'a worker commits the kind with the current privacy policy'
);
select is(
  pg_temp.call_as(:'c', 'authenticated', $$select public.set_account_kind('[{"purpose":"privacy-policy","version":1}]')$$),
  'ok',
  'a company user commits the kind with the current privacy policy'
);
select is(pg_temp.pending(:'w'), '', 'a committed worker with current consents has nothing pending');
select is(
  (select count(*) from public.profiles p
   where p.account_kind = 'worker'
     and not exists (
       select 1 from public.consents k
       where k.user_id = p.id and k.purpose = 'age-18-plus' and k.action = 'granted'
     )),
  0::bigint,
  'no committed worker lacks a granted age attestation'
);

-- A new version gates a session that started after it, not one that started before
update public.legal_documents set published_at = now() - interval '3 days' where slug = 'privacy-policy' and version = 1;
insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
values
  ('terms-of-service', 1, 'Terms of Service', 'Version one.', 'Adds the complaints procedure.', now() - interval '2 days'),
  ('age-18-plus', 1, 'Age confirmation', 'I am 18 or older.', 'Clarifies the wording.', now() - interval '2 days'),
  ('subscription-and-billing-terms', 1, 'Subscription and Billing Terms', 'Version one.', 'First approved text.', now() - interval '2 days');
insert into auth.sessions (id, user_id, created_at) values
  (:'old_session', :'w', now() - interval '5 days'),
  (:'new_session', :'w', now() - interval '1 day'),
  (:'other_session', :'c', now() - interval '1 day');
select is(
  pg_temp.pending(:'w', :'old_session'),
  '',
  'a session that started before the publication is not gated'
);
select is(
  pg_temp.pending(:'w', :'new_session'),
  'terms-of-service:1',
  'a session that started after the publication is gated on the changed document only'
);
select is(
  pg_temp.pending(:'w'),
  'terms-of-service:1',
  'a call without a session row is treated as a new session'
);
select is(
  pg_temp.pending(:'w', :'other_session'),
  'terms-of-service:1',
  'a session id that belongs to another user does not open the gate'
);
select is(
  pg_temp.pending(:'c', :'other_session'),
  'terms-of-service:1',
  'a company user is gated on the changed Terms of Service and not on the worker terms'
);
select ok(
  pg_temp.pending(:'w', :'new_session') not like '%age-18-plus%'
  and pg_temp.pending(:'w', :'new_session') not like '%subscription%',
  'a new age wording and the billing terms never gate the login'
);

-- Accepting the current version clears the gate
select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.accept_consents('[{"purpose":"terms-of-service","version":1}]')$$, :'new_session'),
  'ok',
  'the worker accepts the new Terms of Service'
);
select is(pg_temp.pending(:'w', :'new_session'), '', 'nothing is pending after the acceptance');

-- Withdrawal gates the next sign-in, not the session that withdrew
insert into public.consents (user_id, purpose, version, action, created_at)
values (:'w', 'worker-terms', 0, 'withdrawn', now() - interval '12 hours');
insert into auth.sessions (id, user_id, created_at) values ('00000000-0000-0000-0000-0000000000a5', :'w', now() - interval '6 hours');
select is(
  pg_temp.pending(:'w', :'new_session'),
  '',
  'a session that was open at the withdrawal is not gated'
);
select is(
  pg_temp.pending(:'w', '00000000-0000-0000-0000-0000000000a5'),
  'worker-terms:0',
  'a session that started after the withdrawal is gated on the withdrawn document'
);

select is(
  pg_temp.call_as(:'w', 'authenticated', $$select public.accept_consents('[{"purpose":"worker-terms","version":0}]')$$, :'new_session'),
  'ok',
  'accepting again after the withdrawal adds a granted row'
);
select is(
  pg_temp.pending(:'w', '00000000-0000-0000-0000-0000000000a5'),
  '',
  'the withdrawal no longer gates once accepted again'
);

-- A committed user with no consent row at all is gated whatever the age of the session
update public.profiles set account_kind = 'worker' where id = :'u';
insert into auth.sessions (id, user_id, created_at) values ('00000000-0000-0000-0000-0000000000a4', :'u', now() - interval '10 days');
select is(
  pg_temp.pending(:'u', '00000000-0000-0000-0000-0000000000a4'),
  'privacy-policy:1,terms-of-service:1,worker-terms:0',
  'a committed worker without consent rows is gated on all three documents even in an old session'
);

-- A profile that is not active is never sent to a form that accept_consents would refuse
update public.profiles set status = 'suspended' where id = :'u';
select is(
  pg_temp.pending(:'u', '00000000-0000-0000-0000-0000000000a4'),
  '',
  'a suspended user with missing consents is not gated'
);
update public.profiles set status = 'deletion_pending' where id = :'u';
select is(
  pg_temp.pending(:'u'),
  '',
  'a user whose deletion is pending is not gated'
);

-- A change older than 7 days gates every session, however long the session has lasted (FR-A8)
insert into auth.sessions (id, user_id, created_at) values ('00000000-0000-0000-0000-0000000000a6', :'w', now() - interval '20 days');
insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
values ('terms-of-service', 2, 'Terms of Service', 'Version two.', 'Changes the governing law.', now() - interval '6 days');
select is(
  pg_temp.pending(:'w', '00000000-0000-0000-0000-0000000000a6'),
  '',
  'a session that started before a change of 6 days ago is not gated'
);
update public.legal_documents set published_at = now() - interval '8 days' where slug = 'terms-of-service' and version = 2;
select is(
  pg_temp.pending(:'w', '00000000-0000-0000-0000-0000000000a6'),
  'terms-of-service:2',
  'a session that started before a change of 8 days ago is gated all the same'
);

select * from finish();
rollback;
