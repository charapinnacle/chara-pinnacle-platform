begin;
select plan(5);

-- FR-P2 AC2 with FR-P3 at the boundary, the sends in parallel (V71, NFR-A4): the owner and a member of an employer whose monthly
-- message limit is 1 send inquiries to two different partners at the same time; the second waits on the organisation's
-- lock messages:<org> and is refused once the first is committed, so a typed message never passes the limit. The setup
-- is committed through dblink, as the second session must see it, and removed again at the end.

\set m1 '00000000-0000-0000-0000-0000000f7131'
\set m2 '00000000-0000-0000-0000-0000000f7132'
\set o1 '00000000-0000-0000-0000-0000000f7133'
\set o2 '00000000-0000-0000-0000-0000000f7134'
\set emp '00000000-0000-0000-0000-0000000f7135'
\set p1 '00000000-0000-0000-0000-0000000f7136'
\set p2 '00000000-0000-0000-0000-0000000f7137'

create extension if not exists dblink schema extensions;
select extensions.dblink_connect('setup',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('blocked',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));

select extensions.dblink_exec('setup', format($$
  begin;
  update private.settings set value = 'true' where key in ('release_messaging', 'entitlements_enforced');
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%1$L, %1$L || '@employer.test', now(), '{"intended_account_kind": "company"}'),
         (%2$L, %2$L || '@employer.test', now(), '{"intended_account_kind": "company"}'),
         (%3$L, %3$L || '@partner.test', now(), '{"intended_account_kind": "company"}'),
         (%4$L, %4$L || '@partner.test', now(), '{"intended_account_kind": "company"}');
  update public.profiles set account_kind = intended_account_kind where id in (%1$L, %2$L, %3$L, %4$L);
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (%5$L, 'employer', 'inquiry-limit-' || left(%5$L, 8), 'Inquiry Limit GmbH', 'Inquiry Limit', 'DE'),
         (%6$L, 'recruitment_company', 'inquiry-partner-' || right(%6$L, 4), 'Partner One Ltd', 'Partner One', 'PH'),
         (%7$L, 'recruitment_company', 'inquiry-partner-' || right(%7$L, 4), 'Partner Two Ltd', 'Partner Two', 'PH');
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id in (%6$L, %7$L);
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (%5$L, %1$L, 'owner', now()), (%5$L, %2$L, 'member', now()), (%6$L, %3$L, 'owner', now()),
         (%7$L, %4$L, 'owner', now());
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  values (%5$L, 'employer_enterprise', 'active', 'null');
  insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value)
  values (%5$L, 'messages_per_month', 1);
  commit;
$$, :'m1', :'m2', :'o1', :'o2', :'emp', :'p1', :'p2'));

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
  $$select 'ok' from public.send_inquiry(%L, %L, 'We need twenty welders for Hamburg in spring.')$$, :'emp', :'p1')) as r (t text) \gset
select is(:'held'::text, 'ok', 'FR-P2 AC2: the owner sends the last message of the month as an inquiry and keeps the transaction open');

select extensions.dblink_exec('blocked', pg_temp.send_sql(:'m2')) as began \gset
select extensions.dblink_send_query('blocked', format(
  $$select 'ok'::text from public.send_inquiry(%L, %L, 'We need twenty welders for Hamburg in spring.')$$, :'emp', :'p2')) as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1,
  'NFR-A4: a member sending an inquiry to another partner at the same time waits on the organisation''s lock');

select extensions.dblink_exec('holder', 'commit') as committed \gset
select count(*) as answered from extensions.dblink_get_result('blocked', false) as r (t text) \gset
select ok(extensions.dblink_error_message('blocked') ~ 'CHARA_LIMIT_REACHED',
  'FR-P3, NFR-A4: once the first is committed, the waiting inquiry is refused with CHARA_LIMIT_REACHED');
select count(*) as drained from extensions.dblink_get_result('blocked', false) as r (t text) \gset
select extensions.dblink_exec('blocked', 'rollback') as ended \gset

select is(
  (select count(*)::integer from public.messages where sender_organization_id = :'emp')
    + (select count(*)::integer from public.connections where from_organization_id = :'emp'),
  2, 'NFR-A4: the organisation stops at its limit; the refused inquiry stores no message and no connection');

select extensions.dblink_disconnect('holder');
select extensions.dblink_disconnect('blocked');
select extensions.dblink_exec('setup', format($$
  begin;
  delete from public.notifications where user_id in (%3$L, %4$L);
  delete from pgmq.q_notifications where message ->> 'user_id' in (%3$L, %4$L);
  delete from public.conversations where id in (select conversation_id from public.connections where from_organization_id = %5$L);
  delete from private.rate_limit_hits where action in ('user:audited_write', 'org:audited_write', 'user:inquiry');
  delete from billing.organization_limit_overrides where organization_id = %5$L;
  delete from billing.subscriptions where organization_id = %5$L;
  delete from public.organizations where id in (%5$L, %6$L, %7$L);
  delete from auth.users where id in (%1$L, %2$L, %3$L, %4$L);
  update private.settings set value = 'false' where key in ('release_messaging', 'entitlements_enforced');
  commit;
$$, :'m1', :'m2', :'o1', :'o2', :'emp', :'p1', :'p2'));
select extensions.dblink_disconnect('setup');
select is(
  (select count(*)::integer from public.organizations where id in (:'emp', :'p1', :'p2'))
    + (select count(*)::integer from auth.users where id in (:'m1', :'m2', :'o1', :'o2')),
  0, 'the committed rows of the parallel test are removed again');

select * from finish();
rollback;
