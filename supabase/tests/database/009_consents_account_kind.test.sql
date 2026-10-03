begin;
select plan(96);

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
\set u '00000000-0000-0000-0000-00000000c003'
\set s '00000000-0000-0000-0000-00000000d004'
\set m '00000000-0000-0000-0000-00000000e005'
\set x '00000000-0000-0000-0000-00000000f006'

select pg_temp.new_user(
  :'w', 'worker',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0},{"purpose":"age-18-plus","version":0}]'
);
select pg_temp.new_user(
  :'c', 'company',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"employer-terms","version":0},{"purpose":"age-18-plus","version":0}]'
);
select pg_temp.new_user(:'u', 'worker', '[{"purpose":"terms-of-service","version":0}]', false);
select pg_temp.new_user(:'s', 'worker', '[{"purpose":"terms-of-service","version":0}]');
update public.profiles set status = 'suspended' where id = :'s';

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
select is_definer('public', 'set_account_kind', array['jsonb'], 'set_account_kind is SECURITY DEFINER');
select is_definer('public', 'accept_consents', array['jsonb'], 'accept_consents is SECURITY DEFINER');
select is_definer('public', 'withdraw_consent', array['text'], 'withdraw_consent is SECURITY DEFINER');
select is_empty(
  $$select p.oid::regprocedure from pg_proc p
    where p.oid in ('public.set_account_kind(jsonb)'::regprocedure, 'public.accept_consents(jsonb)'::regprocedure,
                    'public.withdraw_consent(text)'::regprocedure)
      and not ('search_path=""' = any (p.proconfig))$$,
  'the RPCs set search_path to empty'
);
select ok(
  not has_function_privilege('anon', 'public.set_account_kind(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.set_account_kind(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.set_account_kind(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.accept_consents(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.accept_consents(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.withdraw_consent(text)', 'execute')
  and not has_function_privilege('service_role', 'public.withdraw_consent(text)', 'execute'),
  'only authenticated may execute the RPCs'
);
select is(
  private.required_consents('worker'),
  array['terms-of-service', 'privacy-policy', 'worker-terms', 'age-18-plus'],
  'the required consents of a worker come from private.settings'
);
select is(
  private.required_consents('company'),
  array['terms-of-service', 'privacy-policy', 'employer-terms'],
  'the required consents of a company user come from private.settings'
);

-- Nothing is written before the kind is committed
select is(pg_temp.docs(:'w'), '', 'no consents row exists for a worker before the kind is committed');
select is(pg_temp.docs(:'c'), '', 'no consents row exists for a company user before the kind is committed');

-- Refused commits
select is(
  pg_temp.call_as(:'u', 'authenticated', 'select public.set_account_kind()'),
  'P0001|CHARA_FORBIDDEN|email_unconfirmed',
  'a user with an unconfirmed email cannot commit the kind'
);
select is(
  pg_temp.call_as(:'s', 'authenticated', 'select public.set_account_kind()'),
  'P0001|CHARA_FORBIDDEN|profile_not_active',
  'a suspended user cannot commit the kind'
);
select is(
  pg_temp.call_as(null, 'anon', 'select public.set_account_kind()'),
  '42501|permission denied for function set_account_kind|',
  'an anonymous caller is refused at EXECUTE'
);
select is(
  pg_temp.call_as(null, 'authenticated', 'select public.set_account_kind()'),
  'P0001|CHARA_FORBIDDEN|',
  'a caller without a user id is refused'
);
select is(
  pg_temp.call_as('00000000-0000-0000-0000-0000000000ff', 'authenticated', 'select public.set_account_kind()'),
  'P0001|CHARA_FORBIDDEN|',
  'a caller without a profile is refused'
);
select is(
  (select count(*) from public.profiles where id in (:'u', :'s') and account_kind is not null)
  + (select count(*) from public.consents where user_id in (:'u', :'s'))
  + (select count(*) from audit.log where action = 'account_kind_set'),
  0::bigint,
  'refused commits write no kind, no consents and no audit row'
);

-- Incomplete or invalid consent sets leave the account uncommitted
select pg_temp.new_user(:'x', 'worker', '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0}]');
select is(
  pg_temp.call_as(:'x', 'authenticated', 'select public.set_account_kind()'),
  'P0001|CHARA_CONSENT_REQUIRED|age-18-plus',
  'a worker without the age attestation cannot commit the kind'
);
select is(
  pg_temp.call_as(:'x', 'authenticated', $$select public.set_account_kind('{"a":1}')$$),
  'P0001|CHARA_INVALID_INPUT|p_consents must be an array of at most 20 entries',
  'submitted consents that are not a list are refused'
);
select is(
  pg_temp.call_as(
    :'x', 'authenticated',
    format($$select public.set_account_kind(%L)$$, (select jsonb_agg('{"purpose":"x","version":0}'::jsonb) from generate_series(1, 21)))
  ),
  'P0001|CHARA_INVALID_INPUT|p_consents must be an array of at most 20 entries',
  'more than 20 submitted consent entries are refused'
);
select is(
  pg_temp.call_as(:'x', 'authenticated', $$select public.set_account_kind('[{"purpose":"age-18-plus","version":99}]')$$),
  'P0001|CHARA_INVALID_INPUT|age-18-plus',
  'a version that does not exist is refused'
);
select is(
  pg_temp.call_as(:'x', 'authenticated', $$select public.set_account_kind('[{"purpose":"age-18-plus","version":"1.5"}]')$$),
  'P0001|CHARA_INVALID_INPUT|age-18-plus',
  'a version that is not an integer is refused'
);
insert into public.legal_documents (slug, version, title, body, change_summary)
values ('age-18-plus', 1, 'Age confirmation', 'I am 18 or older.', 'An unpublished draft version.');
select is(
  pg_temp.call_as(:'x', 'authenticated', $$select public.set_account_kind('[{"purpose":"age-18-plus","version":1}]')$$),
  'P0001|CHARA_INVALID_INPUT|age-18-plus',
  'an unpublished draft version is refused'
);
update public.profiles set pending_consents = '[]' where id = :'x';
select is(
  pg_temp.call_as(:'x', 'authenticated', 'select public.set_account_kind()'),
  'P0001|CHARA_CONSENT_REQUIRED|terms-of-service',
  'empty pending consents are refused with the first required purpose'
);
select is(
  (select account_kind from public.profiles where id = :'x') is null
  and pg_temp.docs(:'x') = '',
  true,
  'after the refusals the kind is still null and no consents row exists'
);

-- A failing consent write rolls the kind commit back
update public.profiles set pending_consents = '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0},{"purpose":"age-18-plus","version":0}]'
where id = :'x';
create function pg_temp.fail_insert() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
create trigger fail_insert before insert on public.consents for each row execute function pg_temp.fail_insert();
select is(
  pg_temp.call_as(:'x', 'authenticated', 'select public.set_account_kind()'),
  'P0001|boom|',
  'the commit fails when the consent write fails'
);
drop trigger fail_insert on public.consents;
select is(
  (select account_kind from public.profiles where id = :'x') is null
  and (select count(*) from audit.log where action = 'account_kind_set' and entity_id = :'x') = 0,
  true,
  'the kind and its audit row are rolled back with the failed consent write'
);

-- Commit for a worker
select is(
  pg_temp.call_as(:'w', 'authenticated', 'select public.set_account_kind()'),
  'ok',
  'a confirmed worker commits the kind'
);
select is(
  (select account_kind::text || '/' || pending_consents::text from public.profiles where id = :'w'),
  'worker/[]',
  'the kind is committed and the pending consents are cleared'
);
select is(
  pg_temp.docs(:'w'),
  'terms-of-service:0:granted,privacy-policy:0:granted,worker-terms:0:granted,age-18-plus:0:granted',
  'four granted consents are written for a worker, including the age attestation'
);
select is(
  (select count(*) from audit.log where action = 'account_kind_set' and entity_id = :'w' and metadata = '{"kind":"worker"}'),
  1::bigint,
  'one account_kind_set audit row exists'
);
select is(
  (select count(*) from audit.log where action = 'consents_accepted' and entity_id = :'w'
     and jsonb_array_length(metadata -> 'consents') = 4),
  1::bigint,
  'one consents_accepted audit row lists the four consents'
);
select is(
  (select count(*) from public.consents where user_id = :'w' and created_at = now()),
  4::bigint,
  'created_at is set by the database'
);
select is(
  pg_temp.call_as(:'w', 'authenticated', 'select public.set_account_kind()'),
  'ok',
  'a repeat call succeeds'
);
select is(
  (select count(*) from public.consents where user_id = :'w')
  + (select count(*) from audit.log where entity_id = :'w' and action in ('account_kind_set', 'consents_accepted')),
  6::bigint,
  'a repeat call writes nothing'
);

-- Commit for a company user: own documents only, extra entries ignored
select is(
  pg_temp.call_as(:'c', 'authenticated', 'select public.set_account_kind()'),
  'ok',
  'a confirmed company user commits the kind'
);
select is(
  pg_temp.docs(:'c'),
  'terms-of-service:0:granted,privacy-policy:0:granted,employer-terms:0:granted',
  'three consents are written for a company user, and the age attestation in their metadata is ignored'
);

-- Superseded versions
insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
values ('privacy-policy', 1, 'Privacy Policy', 'Approved text.', 'The first approved version.', now());
select pg_temp.new_user(:'m', 'worker', '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0},{"purpose":"age-18-plus","version":0}]');
select is(
  pg_temp.call_as(:'m', 'authenticated', 'select public.set_account_kind()'),
  'P0001|CHARA_CONSENT_REQUIRED|privacy-policy',
  'a superseded version from sign-up is refused'
);
select is(
  (select account_kind from public.profiles where id = :'m') is null and pg_temp.docs(:'m') = '',
  true,
  'nothing is written for the superseded version'
);
select is(
  pg_temp.call_as(:'m', 'authenticated', $$select public.set_account_kind('[{"purpose":"privacy-policy","version":1}]')$$),
  'ok',
  'accepting the current version on the onboarding page lets the commit pass'
);
select is(
  pg_temp.docs(:'m'),
  'terms-of-service:0:granted,privacy-policy:1:granted,worker-terms:0:granted,age-18-plus:0:granted',
  'the consent row holds the accepted version and never the superseded one'
);

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
  'P0001|CHARA_INVALID_INPUT|privacy-policy',
  'a version that is not the current one is refused'
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

-- Visibility
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'w'), true);
set local role authenticated;
select is(
  (select count(*) from public.consents),
  (select count(*) from public.consents where user_id = :'w'),
  'a user reads only their own consent rows'
);
select cmp_ok((select count(*) from public.consents), '>', 0::bigint, 'a user reads their own consent rows');
select is_empty(
  format($$select 1 from public.consents where user_id = %L$$, :'c'),
  'another user''s consent rows are not readable'
);
select throws_ok(
  $$insert into public.consents (user_id, purpose, version, action) values (gen_random_uuid(), 'cookie-policy', 0, 'granted')$$,
  '42501', null, 'authenticated cannot insert a consent row directly'
);
select throws_ok($$update public.consents set action = 'granted'$$, '42501', null, 'authenticated cannot update consents');
select throws_ok($$delete from public.consents$$, '42501', null, 'authenticated cannot delete consents');
select throws_ok($$truncate public.consents$$, '42501', null, 'authenticated cannot truncate consents');
reset role;
set local role anon;
select throws_ok($$select * from public.consents$$, '42501', null, 'anon cannot read consents');
reset role;
set local role service_role;
select throws_ok($$select * from public.consents$$, '42501', null, 'service_role cannot read consents');
select throws_ok($$delete from public.consents$$, '42501', null, 'service_role cannot delete consents');
reset role;

-- Append-only for the table owner, in normal and replica mode
select throws_ok(
  $$update public.consents set action = 'withdrawn' where user_id = '00000000-0000-0000-0000-00000000a001'$$,
  '42501', 'consents is append-only', 'update is refused for the table owner'
);
select throws_ok($$delete from public.consents$$, '42501', 'consents is append-only', 'delete is refused for the table owner');
select throws_ok($$truncate public.consents$$, '42501', 'consents is append-only', 'truncate is refused for the table owner');
set local session_replication_role = replica;
select throws_ok($$delete from public.consents$$, '42501', 'consents is append-only', 'delete is refused in replica mode');
select throws_ok($$truncate public.consents$$, '42501', 'consents is append-only', 'truncate is refused in replica mode');
set local session_replication_role = origin;

-- Version and purpose are mandatory and must exist
select throws_ok(
  $$insert into public.consents (user_id, purpose, version, action)
    values ('00000000-0000-0000-0000-00000000a001', 'terms-of-service', 99, 'granted')$$,
  '23503', null, 'a consent for an unknown version is refused'
);
select throws_ok(
  $$insert into public.consents (user_id, purpose, version, action)
    values ('00000000-0000-0000-0000-00000000a001', 'terms-of-service', null, 'granted')$$,
  '23502', null, 'a consent without a version is refused'
);
select throws_ok(
  $$insert into public.consents (user_id, purpose, version, action)
    values ('00000000-0000-0000-0000-00000000a001', 'no-such-document', 0, 'granted')$$,
  '23503', null, 'a consent for an unknown document is refused'
);

-- The lookups the RPCs and the own-rows policy make use the index at volume
insert into public.consents (user_id, purpose, version, action)
select gen_random_uuid(), (array['terms-of-service', 'privacy-policy', 'cookie-policy', 'worker-terms'])[1 + g % 4], 0, 'granted'
from generate_series(1, 50000) g;
analyze public.consents;
create function pg_temp.plan_of(p_sql text) returns text
language plpgsql as $$
declare
  v_line text;
  v_plan text := '';
begin
  for v_line in execute 'explain ' || p_sql loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  return v_plan;
end;
$$;
select ok(
  pg_temp.plan_of(format(
    $$select action, version from public.consents where user_id = %L and purpose = 'worker-terms' order by id desc limit 1$$, :'w'
  )) like '%consents_user_purpose_idx%',
  'the latest-row lookup per user and purpose uses the ledger index'
);
select ok(
  pg_temp.plan_of(format($$select * from public.consents where user_id = %L$$, :'w')) like '%consents_user_purpose_idx%',
  'reading a user''s own rows uses the ledger index'
);

-- The ledger outlives the account
delete from auth.users where id = :'m';
select is(
  (select count(*) from public.consents where user_id = :'m'),
  4::bigint,
  'consent rows stay after the account is deleted'
);

select * from finish();
rollback;
