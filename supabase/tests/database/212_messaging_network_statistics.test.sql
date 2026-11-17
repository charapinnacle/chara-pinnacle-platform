begin;
select plan(11);

\ir apply_fixture.inc

-- V74: the messaging and Find Workers metrics of the network statistics (FR-S2 release 2c parts: AC1 to AC4 and AC10 for
-- conversations, messages, Find Workers searches and contact requests; SOP P2-42 steps Aggregate, Suppress, Show). In
-- the month two months ago: 6 conversations between Acme (t.a) and the recruitment company Alpha with 7 messages, 5 Find
-- Workers searches by Acme's member and 6 contact requests of Acme to the candidates wa and wb, 3 of them accepted.

\set pa '00000000-0000-0000-0000-000000212001'
\set padmin '00000000-0000-0000-0000-000000212002'
\set trust '00000000-0000-0000-0000-000000212003'

update private.settings set value = 'true'
where key in ('release_partner_directories', 'release_messaging', 'release_find_workers');
select current_setting('t.a') as acme \gset
select pg_temp.new_user(u) from unnest(array[:'pa', :'padmin', :'trust']::uuid[]) u;
update public.profiles set account_kind = intended_account_kind where id in (:'pa', :'padmin', :'trust');
insert into public.platform_staff (user_id, role) values (:'padmin', 'admin'), (:'trust', 'trust_safety');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
values ('00000000-0000-0000-0000-000000212101', 'recruitment_company', 'v74-stats-alpha', 'Alpha Stats Ltd', 'Alpha Stats', 'PH');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values ('00000000-0000-0000-0000-000000212101', :'pa', 'owner', now());
select (date_trunc('month', now() at time zone 'utc') - interval '2 months')::date as month \gset

with c as (
  insert into public.conversations (context_type, context_id, created_at, last_message_at)
  select 'partner_response', gen_random_uuid(), :'month'::timestamp at time zone 'utc' + make_interval(days => n, hours => 9),
    :'month'::timestamp at time zone 'utc' + make_interval(days => n, hours => 10)
  from generate_series(1, 6) n
  returning id, created_at
)
insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body, created_at)
select c.id, :'mem'::uuid, :'acme'::uuid, 'Hello from Acme.', c.created_at + interval '1 hour' from c
union all
select (select id from c order by created_at limit 1), :'pa'::uuid, '00000000-0000-0000-0000-000000212101'::uuid, 'Hello back.',
  (select min(created_at) from c) + interval '2 hours';

insert into private.worker_search_log (organization_id, user_id, filter_names, result_count, created_at)
select :'acme', :'mem', '{occupation}', 12, :'month'::timestamp at time zone 'utc' + make_interval(days => n)
from generate_series(1, 5) n;

insert into public.contact_requests (organization_id, worker_user_id, card_id, sent_by, message, status, created_at, expires_at,
  responded_at)
select :'acme', w.user_id, w.card_id, :'mem', 'We would like to talk to you.',
  case when n <= 3 then 'accepted' else 'declined' end::public.contact_request_status,
  :'month'::timestamp at time zone 'utc' + make_interval(days => n), :'month'::timestamp at time zone 'utc' + make_interval(days => n + 30),
  :'month'::timestamp at time zone 'utc' + make_interval(days => n + 1)
from generate_series(1, 6) n
join public.worker_profiles w on w.user_id = case when n % 2 = 0 then :'wa'::uuid else :'wb'::uuid end;

create function pg_temp.counts(p_user uuid, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_result text;
begin
  v_result := pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.counts', coalesce((select string_agg(format('%%s:%%s', metric, coalesce(count::text, 'null')), ',' order by metric)
         from public.admin_network_counts(%L, %L, 'month')
         where period_start = %L and metric in ('conversations', 'messages', 'worker_searches', 'contact_requests',
           'contact_requests_accepted')), ''), true)$f$,
    current_setting('t.month'), current_date, current_setting('t.month')), p_aal);
  return case when v_result = 'ok' then current_setting('t.counts') else v_result end;
end;
$$;
select set_config('t.month', :'month', true);

select is(pg_temp.counts(:'padmin'),
  'contact_requests:6,contact_requests_accepted:null,conversations:6,messages:7,worker_searches:5',
  'FR-S2 AC1, AC2: conversations, messages, searches and contact requests of the month; the 3 acceptances are fewer than five');
select is(
  (select array_agg(metric order by pos) from private.network_count_metrics()
   where metric in ('conversations', 'messages', 'worker_searches', 'contact_requests', 'contact_requests_accepted')),
  array['conversations', 'messages', 'worker_searches', 'contact_requests', 'contact_requests_accepted'],
  'the metrics come after the job order metrics, in the order of the console'
);
update private.settings set value = 'false' where key = 'release_messaging';
select is(pg_temp.counts(:'padmin'), 'contact_requests:6,contact_requests_accepted:null,worker_searches:5',
  'release_messaging off: no conversation or message metric');
update private.settings set value = 'false' where key = 'release_find_workers';
select is(pg_temp.counts(:'padmin'), '', 'release_find_workers off too: no Find Workers metric');
update private.settings set value = 'true' where key in ('release_messaging', 'release_find_workers');

-- AC4: only a Platform Administrator at aal2.
select is(pg_temp.counts(:'trust'), 'P0001|CHARA_FORBIDDEN|', 'FR-S2 AC4: Trust & Safety reads no counts');
select is(pg_temp.counts(:'padmin', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'FR-S2 AC4: the administrator at aal1 is sent to two-step verification');
select is(
  (select string_agg(pg_temp.counts(u), ',') from unnest(array[:'own1', :'own2', :'pa', :'wa', :'wb']::uuid[]) u),
  rtrim(repeat('P0001|CHARA_FORBIDDEN|,', 5), ','), 'FR-S2 AC4: neither employer, partner nor candidate reads them'
);
select is(pg_temp.call_as(null, 'anon', format('select public.admin_network_counts(%L, %L)', :'month', current_date)),
  '42501|permission denied for function admin_network_counts|', 'FR-S2 AC4: an anonymous caller lacks EXECUTE');
select is(
  (select string_agg(r, ',') from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_table_privilege(r, 'stats.network_events', 'select')),
  null, 'FR-S2 AC4: the view of the events stays closed to the API roles'
);

-- AC3: counts only; the messages branch reads the time and nothing of the text or the sender.
select ok(pg_get_viewdef('stats.network_events'::regclass) !~ '(body|sender_user_id|message\M|worker_user_id|sent_by)',
  'FR-S2 AC3: the view reads no message text, sender, worker or member');

-- AC10: every new branch reads the index of its time column.
select is(
  (select string_agg(indexname, ',' order by indexname) from pg_indexes
   where indexname in ('conversations_created_at_idx', 'messages_created_at_idx', 'contact_requests_created_at_idx',
     'contact_requests_accepted_at_idx', 'worker_search_log_created_at_idx')),
  'contact_requests_accepted_at_idx,contact_requests_created_at_idx,conversations_created_at_idx,messages_created_at_idx,worker_search_log_created_at_idx',
  'FR-S2 AC10: conversations, messages, contact requests, acceptances and the search log have an index on the time counted'
);

select * from finish();
rollback;
