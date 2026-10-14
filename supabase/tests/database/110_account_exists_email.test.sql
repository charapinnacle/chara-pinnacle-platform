-- FR-A1, FR-I1, D89: a sign-up with an address that already has a confirmed account queues one account_exists email to that
-- account, at most one per address in account_exists_email_interval_minutes. The function answers the same for every address,
-- asks for the visitor proof of the web tier once the Vault secret exists, and queues nothing for an unconfirmed or unknown one.
begin;
select plan(27);

\set ana '00000000-0000-0000-0000-0000000ae001'
\set una '00000000-0000-0000-0000-0000000ae002'
\set key 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set secret 'test-visitor-hash-secret-0123456789abcdef'

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  (:'ana', 'ana.exists@example.test', now(), '{"intended_account_kind": "worker"}'),
  (:'una', 'una.waiting@example.test', null, '{"intended_account_kind": "worker"}');

-- notify_existing_account as anon: 'ok' or 'sqlstate|message|detail'.
create function pg_temp.notify_as_anon(p_email text, p_key text, p_proof text default null) returns text
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
  v_result text := 'ok';
begin
  set local role anon;
  begin
    perform public.notify_existing_account(p_email, p_key, p_proof);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  return v_result;
end;
$$;

create function pg_temp.proof(p_action text, p_key text) returns text
language sql as $$
  select encode(extensions.hmac(
    p_action || '|' || p_key || '|' || floor(extract(epoch from now()) / 60)::bigint,
    encode(extensions.hmac('rate_limit_attempt', 'test-visitor-hash-secret-0123456789abcdef', 'sha256'), 'hex'),
    'sha256'), 'hex')
$$;

create function pg_temp.emails_of(p_user uuid) returns bigint
language sql as $$ select count(*) from public.notifications where user_id = p_user and kind = 'account_exists' $$;

grant execute on function pg_temp.notify_as_anon(text, text, text), pg_temp.proof(text, text) to anon;

select function_privs_are('public', 'notify_existing_account', array['text', 'text', 'text'], 'anon', array['EXECUTE'],
  'anon may call notify_existing_account: the sign-up runs without a session');
select function_privs_are('public', 'notify_existing_account', array['text', 'text', 'text'], 'authenticated', array['EXECUTE'],
  'authenticated may call it too');
select function_privs_are('public', 'notify_existing_account', array['text', 'text', 'text'], 'service_role', array[]::text[],
  'service_role has no grant');
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.notify_existing_account(text, text, text)'::regprocedure),
  true, 'the function is security definer with an empty search_path'
);
select is(
  (select pg_get_function_result('public.notify_existing_account(text, text, text)'::regprocedure)), 'void',
  'the function answers nothing, so it tells no address from another'
);

-- A confirmed account.
select is(pg_temp.notify_as_anon('  Ana.Exists@Example.TEST ', :'key'), 'ok', 'a confirmed address is answered without error');
select is(pg_temp.emails_of(:'ana'), 1::bigint, 'one account_exists row is queued for the account, found case-insensitively');
select results_eq(
  $$select status, payload, msg_id is not null from public.notifications where user_id = '00000000-0000-0000-0000-0000000ae001'$$,
  $$values ('queued'::text, '{}'::jsonb, true)$$,
  'the row is queued with an empty payload and its queue message'
);
select results_eq(
  $$select q.message ->> 'kind', q.message ->> 'mandatory', q.message ? 'email'
    from pgmq.q_notifications q join public.notifications n on n.msg_id = q.msg_id
    where n.user_id = '00000000-0000-0000-0000-0000000ae001'$$,
  $$values ('account_exists'::text, 'true'::text, false)$$,
  'the queue message is a mandatory account_exists for the user id and carries no address'
);

select is(pg_temp.notify_as_anon('ana.exists@example.test', :'key'), 'ok', 'a second sign-up within 15 minutes is answered alike');
select is(pg_temp.emails_of(:'ana'), 1::bigint, 'but queues no second email');
update public.notifications set created_at = now() - interval '14 minutes' where user_id = :'ana';
select is(pg_temp.notify_as_anon('ana.exists@example.test', :'key'), 'ok', 'after 14 minutes it is answered alike');
select is(pg_temp.emails_of(:'ana'), 1::bigint, 'and still queues nothing');
update public.notifications set created_at = now() - interval '16 minutes' where user_id = :'ana';
select is(pg_temp.notify_as_anon('ana.exists@example.test', :'key'), 'ok', 'after 16 minutes it is answered alike');
select is(pg_temp.emails_of(:'ana'), 2::bigint, 'and queues the next email');

-- Unconfirmed and unknown addresses: Auth resends the confirmation itself; nobody is mailed here.
select is(pg_temp.notify_as_anon('una.waiting@example.test', :'key'), 'ok', 'an unconfirmed address is answered alike');
select is(pg_temp.emails_of(:'una'), 0::bigint, 'and gets no account_exists email');
select is(pg_temp.notify_as_anon('nobody.here@example.test', :'key'), 'ok', 'an unknown address is answered alike');
select is((select count(*) from public.notifications where kind = 'account_exists'), 2::bigint, 'and nothing else was queued');

-- Input the web tier never sends.
select is(pg_temp.notify_as_anon('no-at-sign', :'key'), 'P0001|CHARA_INVALID_INPUT|p_email', 'an address without @ is refused');
select is(pg_temp.notify_as_anon('ana.exists@example.test', 'not-a-key'), 'P0001|CHARA_INVALID_INPUT|p_key', 'a key that is no hash is refused');

-- With the Vault secret (a hosted project) only the web tier's proof for this action is accepted.
select vault.create_secret(encode(extensions.hmac('rate_limit_attempt', :'secret', 'sha256'), 'hex'), 'rate_limit_proof_key') is not null as vault_set \gset
update public.notifications set created_at = now() - interval '1 hour' where user_id = :'ana';
select is(pg_temp.notify_as_anon('ana.exists@example.test', :'key'), '42501|CHARA_FORBIDDEN|p_proof', 'a call without the proof is refused');
select is(
  pg_temp.notify_as_anon('ana.exists@example.test', :'key', pg_temp.proof('signup', :'key')), '42501|CHARA_FORBIDDEN|p_proof',
  'a proof made for another action is refused'
);
select is(pg_temp.emails_of(:'ana'), 2::bigint, 'and neither queued an email');
select is(
  pg_temp.notify_as_anon('ana.exists@example.test', :'key', pg_temp.proof('account_exists', :'key')), 'ok',
  'the proof of the web tier is accepted'
);
select is(pg_temp.emails_of(:'ana'), 3::bigint, 'and the email is queued');

delete from private.settings where key = 'account_exists_email_interval_minutes';
select is(
  pg_temp.notify_as_anon('ana.exists@example.test', :'key', pg_temp.proof('account_exists', :'key')),
  'P0001|CHARA_SETTING_MISSING|account_exists_email_interval_minutes', 'a missing interval setting is a system fault'
);

select * from finish();
rollback;
