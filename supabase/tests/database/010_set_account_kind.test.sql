begin;
select plan(43);

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

select pg_temp.new_user(
  '00000000-0000-0000-0000-000000000a07', 'worker',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"worker-terms","version":0},{"purpose":"age-18-plus","version":0},{"purpose":"employer-terms","version":0}]'
);

select is_definer('public', 'set_account_kind', array['jsonb'], 'set_account_kind is SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = 'public.set_account_kind(jsonb)'::regprocedure),
  array['search_path=""'],
  'set_account_kind sets search_path to empty'
);
select ok(
  not has_function_privilege('anon', 'public.set_account_kind(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.set_account_kind(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.set_account_kind(jsonb)', 'execute'),
  'only authenticated may execute set_account_kind'
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
  + (select count(*) from audit.log where action = 'account_kind_set' and entity_id in (:'u', :'s')),
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
  'P0001|CHARA_INVALID_INPUT|each entry needs a purpose and an integer version',
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

-- A worker's extra entry for the other kind's document is ignored
select is(
  pg_temp.call_as('00000000-0000-0000-0000-000000000a07', 'authenticated', 'select public.set_account_kind()'),
  'ok',
  'a worker whose entries include an employer document commits the kind'
);
select is(
  pg_temp.docs('00000000-0000-0000-0000-000000000a07'),
  'terms-of-service:0:granted,privacy-policy:0:granted,worker-terms:0:granted,age-18-plus:0:granted',
  'a worker whose entries include employer-terms gets the four worker rows and no employer-terms row'
);
select is_empty(
  $$select 1 from public.profiles p
    where p.account_kind = 'worker'
      and not exists (
        select 1 from public.consents c
        where c.user_id = p.id and c.purpose = 'age-18-plus' and c.action = 'granted'
      )$$,
  'no committed worker lacks a granted age-18-plus row'
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

-- Without configured required consents the commit is refused, never made with none
select pg_temp.new_user(
  '00000000-0000-0000-0000-000000000b08', 'company',
  '[{"purpose":"terms-of-service","version":0},{"purpose":"privacy-policy","version":0},{"purpose":"employer-terms","version":0}]'
);
update private.settings set value = '{}' where key = 'required_consents';
select is(
  pg_temp.call_as('00000000-0000-0000-0000-000000000b08', 'authenticated', 'select public.set_account_kind()'),
  'P0001|CHARA_INVALID_INPUT|no required consents are configured',
  'an empty required_consents setting refuses the commit'
);
delete from private.settings where key = 'required_consents';
select is(
  pg_temp.call_as('00000000-0000-0000-0000-000000000b08', 'authenticated', 'select public.set_account_kind()'),
  'P0001|CHARA_INVALID_INPUT|no required consents are configured',
  'a missing required_consents setting refuses the commit'
);
select is(
  (select account_kind from public.profiles where id = '00000000-0000-0000-0000-000000000b08') is null
  and pg_temp.docs('00000000-0000-0000-0000-000000000b08') = '',
  true,
  'nothing is written when no required consents are configured'
);

select * from finish();
rollback;
