begin;
select plan(7);

-- FR-P1 AC1, the calls in parallel (V63): two sessions open the conversation of one context at the same time, an owner of
-- the employer and an owner of the partner company, and get the one conversation. The setup is committed through dblink,
-- as the second session must see it, and removed again at the end; the audit row of the opening stays, as audit.log is
-- append-only.

\set eown '00000000-0000-0000-0000-0000000f6301'
\set pown '00000000-0000-0000-0000-0000000f6302'
\set emp '00000000-0000-0000-0000-0000000f6303'
\set par '00000000-0000-0000-0000-0000000f6304'
\set req '00000000-0000-0000-0000-0000000f6305'
\set resp '00000000-0000-0000-0000-0000000f6306'

create extension if not exists dblink schema extensions;
select extensions.dblink_connect('setup',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('blocked',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));

select extensions.dblink_exec('setup', format($$
  begin;
  update private.settings set value = 'true' where key = 'release_messaging';
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%1$L, %1$L || '@employer.test', now(), '{"intended_account_kind": "company"}'),
         (%2$L, %2$L || '@partner.test', now(), '{"intended_account_kind": "company"}');
  update public.profiles set account_kind = intended_account_kind where id in (%1$L, %2$L);
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (%3$L, 'employer', 'msg-par-' || left(%3$L, 8), 'Messaging Parallel GmbH', 'Messaging Parallel', 'DE'),
         (%4$L, 'recruitment_company', 'msg-par-p-' || left(%4$L, 8), 'Messaging Partner Ltd', 'Messaging Partner', 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (%3$L, %1$L, 'owner', now()), (%4$L, %2$L, 'owner', now());
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on
  ) values (%5$L, %3$L, 'Parallel welders', 10, 'DE', 'Hamburg', 'C', current_date + 30, 'full_time', 'international',
    'both', 'open', 'job_order_marketplace', now(), current_date + 80);
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (%5$L, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (%5$L, 'DE');
  insert into public.partner_responses (
    id, requirement_id, organization_id, employer_organization_id, capacity, available_from, experience_note, fee_model
  ) values (%6$L, %5$L, %4$L, %3$L, 5, current_date + 30, 'Twenty welders placed in Hamburg last year.', 'on_request');
  commit;
$$, :'eown', :'pown', :'emp', :'par', :'req', :'resp'));

create function pg_temp.open_sql(p_user uuid, p_context uuid) returns text
language sql as $$
  select format($f$
    begin;
    set local lock_timeout = '5s';
    select set_config('request.jwt.claims', json_build_object('sub', %L, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;
  $f$, p_user)
$$;

select extensions.dblink_exec('holder', pg_temp.open_sql(:'eown', :'resp')) as began \gset
select t as held from extensions.dblink('holder', format(
  $$select public.open_conversation('partner_response', %L)::text$$, :'resp')) as r (t text) \gset
select ok(:'held' ~ '^[0-9a-f-]{36}$', 'FR-P1 AC1: the employer''s owner opens the conversation and keeps the transaction open');

select extensions.dblink_exec('blocked', pg_temp.open_sql(:'pown', :'resp')) as began \gset
select extensions.dblink_send_query('blocked', format(
  $$select public.open_conversation('partner_response', %L)::text$$, :'resp')) as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1,
  'FR-P1 AC1: the partner''s owner opening the same context at the same time waits on the unique context key');

select extensions.dblink_exec('holder', 'commit') as committed \gset
select t as waited from extensions.dblink_get_result('blocked') as r (t text) \gset
select count(*) as drained from extensions.dblink_get_result('blocked') as r (t text) \gset
select is(:'waited'::text, :'held', 'FR-P1 AC1: once the first opening is committed, the waiting call answers the same conversation');
select extensions.dblink_exec('blocked', 'commit') as committed \gset

select is(
  (select count(*)::integer from public.conversations where context_type = 'partner_response' and context_id = :'resp'),
  1, 'FR-P1 AC1: one conversation for the context, never two');
select is(
  (select string_agg(coalesce(organization_id::text, 'user'), ',' order by organization_id)
   from public.conversation_participants where conversation_id = :'held'),
  :'emp' || ',' || :'par', 'FR-P1 AC1: its two participants, the employer and the partner company, once each');
select is(
  (select count(*)::integer from audit.log where action = 'conversation.opened' and entity_id = :'held'),
  1, 'FR-P1 AC1: one audit row conversation.opened for the conversation');

select extensions.dblink_disconnect('holder');
select extensions.dblink_disconnect('blocked');
select extensions.dblink_exec('setup', format($$
  begin;
  delete from public.conversations where context_type = 'partner_response' and context_id = %5$L;
  delete from private.rate_limit_hits where (action, bucket) in (
    ('user:audited_write', (hashtextextended(%1$L, 0) & 2147483647)::integer),
    ('user:audited_write', (hashtextextended(%2$L, 0) & 2147483647)::integer),
    ('org:audited_write', (hashtextextended(%3$L, 0) & 2147483647)::integer),
    ('org:audited_write', (hashtextextended(%4$L, 0) & 2147483647)::integer));
  delete from public.workforce_requirements where organization_id = %3$L;
  delete from public.organizations where id in (%3$L, %4$L);
  delete from auth.users where id in (%1$L, %2$L);
  update private.settings set value = 'false' where key = 'release_messaging';
  commit;
$$, :'eown', :'pown', :'emp', :'par', :'resp'));
select extensions.dblink_disconnect('setup');
select is(
  (select count(*)::integer from public.organizations where id in (:'emp', :'par'))
    + (select count(*)::integer from auth.users where id in (:'eown', :'pown'))
    + (select count(*)::integer from public.conversations where context_id = :'resp'),
  0, 'the committed rows of the parallel test are removed again');

select * from finish();
rollback;
