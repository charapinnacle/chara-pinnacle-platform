begin;
select plan(7);

-- FR-P3 AC1 at the boundary, the sends in parallel (V66, NFR-A4): two members of an employer on employer_starter at 99 of
-- 100 messages this month send at the same time; the second waits on the organisation's advisory lock and is refused
-- once the first is committed, so the organisation never passes 100. The setup is committed through dblink, as the second
-- session must see it, and removed again at the end.

\set m1 '00000000-0000-0000-0000-0000000f6631'
\set m2 '00000000-0000-0000-0000-0000000f6632'
\set wk '00000000-0000-0000-0000-0000000f6633'
\set emp '00000000-0000-0000-0000-0000000f6634'
\set c1 '00000000-0000-0000-0000-0000000f6635'
\set c2 '00000000-0000-0000-0000-0000000f6636'

create extension if not exists dblink schema extensions;
select extensions.dblink_connect('setup',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('blocked',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));

-- Two conversations of the employer with one candidate, written as the database owner (the contexts are not looked up
-- when a message is sent), and 99 messages of the employer's members this month.
select extensions.dblink_exec('setup', format($$
  begin;
  update private.settings set value = 'true' where key in ('release_messaging', 'entitlements_enforced');
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%1$L, %1$L || '@employer.test', now(), '{"intended_account_kind": "company"}'),
         (%2$L, %2$L || '@employer.test', now(), '{"intended_account_kind": "company"}'),
         (%3$L, %3$L || '@worker.test', now(), '{"intended_account_kind": "worker"}');
  update public.profiles set account_kind = intended_account_kind where id in (%1$L, %2$L, %3$L);
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (%4$L, 'employer', 'msg-limit-' || left(%4$L, 8), 'Messaging Limit GmbH', 'Messaging Limit', 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (%4$L, %1$L, 'owner', now()), (%4$L, %2$L, 'member', now());
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (%4$L, 'employer_starter', 'active', 'null');
  insert into public.conversations (id, context_type, context_id) values (%5$L, 'application', gen_random_uuid()),
    (%6$L, 'application', gen_random_uuid());
  insert into public.conversation_participants (conversation_id, organization_id, user_id)
  values (%5$L, %4$L, null), (%5$L, null, %3$L), (%6$L, %4$L, null), (%6$L, null, %3$L);
  insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body)
  select case when g %% 2 = 0 then %5$L::uuid else %6$L::uuid end, %2$L, %4$L, 'Earlier message ' || g from generate_series(1, 99) g;
  commit;
$$, :'m1', :'m2', :'wk', :'emp', :'c1', :'c2'));

create function pg_temp.send_sql(p_user uuid) returns text
language sql as $$
  select format($f$
    begin;
    set local lock_timeout = '5s';
    select set_config('request.jwt.claims', json_build_object('sub', %L, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;
  $f$, p_user)
$$;

select extensions.dblink_exec('holder', pg_temp.send_sql(:'m1')) as began \gset
select t as held from extensions.dblink('holder', format(
  $$select 'ok' from public.send_message(%L, 'The hundredth message')$$, :'c1')) as r (t text) \gset
select is(:'held', 'ok', 'FR-P3 AC1: the owner sends the 100th message and keeps the transaction open');

select extensions.dblink_exec('blocked', pg_temp.send_sql(:'m2')) as began \gset
select extensions.dblink_send_query('blocked', format(
  $$select 'ok'::text from public.send_message(%L, 'One too many')$$, :'c2')) as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1,
  'NFR-A4: a member sending in another conversation at the same time waits on the organisation''s lock');

select extensions.dblink_exec('holder', 'commit') as committed \gset
select count(*) as answered from extensions.dblink_get_result('blocked', false) as r (t text) \gset
select ok(extensions.dblink_error_message('blocked') ~ 'CHARA_LIMIT_REACHED[^|]*messages_per_month',
  'FR-P3 AC1, NFR-A4: once the first is committed, the waiting send is refused with CHARA_LIMIT_REACHED messages_per_month');
select count(*) as drained from extensions.dblink_get_result('blocked', false) as r (t text) \gset
select extensions.dblink_exec('blocked', 'rollback') as ended \gset

select is(
  (select count(*)::integer from public.messages where sender_organization_id = :'emp'), 100,
  'NFR-A4: the organisation stops at 100');
select is(
  (select count(*)::integer from public.messages where body = 'One too many'), 0, 'FR-P3 AC1: the refused message is not stored');
select is(private.monthly_usage(:'emp', 'messages_per_month'), 100, 'FR-P3 AC1: the usage reads 100 of 100');

select extensions.dblink_disconnect('holder');
select extensions.dblink_disconnect('blocked');
select extensions.dblink_exec('setup', format($$
  begin;
  delete from public.conversations where id in (%5$L, %6$L);
  delete from private.rate_limit_hits where action = 'user:message';
  delete from billing.subscriptions where organization_id = %4$L;
  delete from public.organizations where id = %4$L;
  delete from auth.users where id in (%1$L, %2$L, %3$L);
  update private.settings set value = 'false' where key in ('release_messaging', 'entitlements_enforced');
  commit;
$$, :'m1', :'m2', :'wk', :'emp', :'c1', :'c2'));
select extensions.dblink_disconnect('setup');
select is(
  (select count(*)::integer from public.organizations where id = :'emp')
    + (select count(*)::integer from auth.users where id in (:'m1', :'m2', :'wk'))
    + (select count(*)::integer from public.conversations where id in (:'c1', :'c2')),
  0, 'the committed rows of the parallel test are removed again');

select * from finish();
rollback;
