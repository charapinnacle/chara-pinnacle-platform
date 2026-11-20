begin;
select plan(5);

-- FR-Q3 AC3 at the boundary, the sends in parallel (V70, NFR-A4): two members of an employer on employer_starter, with
-- contact_requests_per_org_day_max at 1, send requests to two different workers at the same time; the second waits on the
-- organisation's advisory lock and is refused once the first is committed, so the organisation never passes its daily
-- limit. The setup is committed through dblink, as the second session must see it, and removed again at the end.

\set m1 '00000000-0000-0000-0000-0000000f7031'
\set m2 '00000000-0000-0000-0000-0000000f7032'
\set w1 '00000000-0000-0000-0000-0000000f7033'
\set w2 '00000000-0000-0000-0000-0000000f7034'
\set emp '00000000-0000-0000-0000-0000000f7035'

create extension if not exists dblink schema extensions;
select extensions.dblink_connect('setup',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('blocked',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));

select extensions.dblink_exec('setup', format($$
  begin;
  update private.settings set value = 'true' where key in ('release_find_workers', 'entitlements_enforced');
  update private.settings set value = '1' where key = 'contact_requests_per_org_day_max';
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%1$L, %1$L || '@employer.test', now(), '{"intended_account_kind": "company"}'),
         (%2$L, %2$L || '@employer.test', now(), '{"intended_account_kind": "company"}'),
         (%3$L, %3$L || '@worker.test', now(), '{"intended_account_kind": "worker"}'),
         (%4$L, %4$L || '@worker.test', now(), '{"intended_account_kind": "worker"}');
  update public.profiles set account_kind = intended_account_kind where id in (%1$L, %2$L, %3$L, %4$L);
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (%5$L, 'employer', 'contact-limit-' || left(%5$L, 8), 'Contact Limit GmbH', 'Contact Limit', 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (%5$L, %1$L, 'owner', now()), (%5$L, %2$L, 'member', now());
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (%5$L, 'employer_starter', 'active', 'null');
  insert into public.worker_profiles (user_id, first_name, last_name, current_country, occupation_id, headline, years_experience,
    availability, searchable)
  values (%3$L, 'Amina', 'Okafor', 'NG', '7212', 'Welder', 5, 'now', true),
         (%4$L, 'Bruno', 'Silva', 'NG', '7212', 'Welder', 5, 'now', true);
  commit;
$$, :'m1', :'m2', :'w1', :'w2', :'emp'));

-- The cards are read here, as the database owner: inside the sessions below the employer's members cannot read the
-- workers' passports.
select card_id as c1 from public.worker_profiles where user_id = :'w1' \gset
select card_id as c2 from public.worker_profiles where user_id = :'w2' \gset

create function pg_temp.send_sql(p_user uuid) returns text
language sql as $$
  select format($f$
    begin;
    set local lock_timeout = '5s';
    select set_config('request.jwt.claims', json_build_object('sub', %L, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
  $f$, p_user)
$$;

select extensions.dblink_exec('holder', pg_temp.send_sql(:'m1')) as began \gset
select t as held from extensions.dblink('holder', format(
  $$select 'ok' from public.send_contact_request(%L, %L, 'The first request of the day')$$,
  :'emp', :'c1')) as r (t text) \gset
select is(:'held'::text, 'ok', 'FR-Q3 AC3: the owner sends the last request of the day and keeps the transaction open');

select extensions.dblink_exec('blocked', pg_temp.send_sql(:'m2')) as began \gset
select extensions.dblink_send_query('blocked', format(
  $$select 'ok'::text from public.send_contact_request(%L, %L, 'One too many')$$,
  :'emp', :'c2')) as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1,
  'NFR-A4: a member sending to another worker at the same time waits on the organisation''s lock');

select extensions.dblink_exec('holder', 'commit') as committed \gset
select count(*) as answered from extensions.dblink_get_result('blocked', false) as r (t text) \gset
select ok(extensions.dblink_error_message('blocked') ~ 'CHARA_RATE_LIMITED',
  'FR-Q3 AC3, NFR-A4: once the first is committed, the waiting request is refused with CHARA_RATE_LIMITED');
select count(*) as drained from extensions.dblink_get_result('blocked', false) as r (t text) \gset
select extensions.dblink_exec('blocked', 'rollback') as ended \gset

select is(
  (select count(*)::integer from public.contact_requests where organization_id = :'emp'), 1,
  'NFR-A4: the organisation stops at its daily limit; the refused request is not stored');

select extensions.dblink_disconnect('holder');
select extensions.dblink_disconnect('blocked');
select extensions.dblink_exec('setup', format($$
  begin;
  delete from public.contact_requests where organization_id = %5$L;
  delete from private.rate_limit_hits where action in ('user:audited_write', 'org:audited_write');
  delete from billing.subscriptions where organization_id = %5$L;
  delete from public.organizations where id = %5$L;
  delete from auth.users where id in (%1$L, %2$L, %3$L, %4$L);
  update private.settings set value = '25' where key = 'contact_requests_per_org_day_max';
  update private.settings set value = 'false' where key in ('release_find_workers', 'entitlements_enforced');
  commit;
$$, :'m1', :'m2', :'w1', :'w2', :'emp'));
select extensions.dblink_disconnect('setup');
select is(
  (select count(*)::integer from public.organizations where id = :'emp')
    + (select count(*)::integer from auth.users where id in (:'m1', :'m2', :'w1', :'w2')),
  0, 'the committed rows of the parallel test are removed again');

select * from finish();
rollback;
