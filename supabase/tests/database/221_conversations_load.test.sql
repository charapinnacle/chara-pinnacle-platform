begin;
select plan(18);

-- The conversation list at 10,000 conversations (V80, NFR-P4 and the message write of NFR-P5), the light version of
-- scripts/load/conversations.mjs that runs in CI: the same seeded inbox (an employer with 10,000 conversations and 50,000
-- messages with 2,000 partners and 3,000 workers) and the same calls of the inbox and conversation pages, one warm-up and
-- five timed runs each instead of fifty, without the captured plans. The list holds 100 ms at the median (the database
-- share of NFR-P4's 500 ms, as for the searches of NFR-P3) and every call 500 ms in every run; the plan shape does not
-- depend on the speed of the machine (docs/perf/release-2c.md). 193 tests the list itself (V65).

\ir conversations_load_fixture.inc

select pg_temp.seed_conversations(2000, 3000, 5000);
update private.settings set value = 'true' where key = 'release_messaging';

select is(
  (select count(*)::integer from public.conversation_participants where organization_id = '00000000-0000-0000-0000-0000000b8021'),
  10000,
  'NFR-P4: the load seeds an organisation with 10,000 conversations'
);
select ok(
  (select count(*) from public.messages m join public.conversation_participants p
     on p.conversation_id = m.conversation_id and p.organization_id = '00000000-0000-0000-0000-0000000b8021') between 45000 and 55000,
  'NFR-P4: with about 50,000 messages'
);

select pg_temp.prepare_conversations_cases();
select pg_temp.run_conversations_load(5);

select ok(
  (select r.max_ms < 500 and (c.label not like 'inbox: %' and c.label not like 'member: %' or r.p50_ms < 100)
   from load_results r where r.label = c.label),
  format('NFR-P4: %s never takes 500 ms%s', c.label,
    case when c.label like 'inbox: %' or c.label like 'member: %' then ' and answers within 100 ms at the median' else '' end)
)
from load_cases c order by c.position;

select is(
  (select array_agg(c.label || '=' || r.rows_returned order by c.position) from load_results r join load_cases c using (label)
   where c.label in ('inbox: first page', 'inbox: page of 50', 'inbox: inquiries', 'inbox: deep page (cursor at 9,000)',
     'member: first page')),
  array['inbox: first page=20', 'inbox: page of 50=50', 'inbox: inquiries=20', 'inbox: deep page (cursor at 9,000)=20',
    'member: first page=20'],
  'NFR-P4: the pages are full, so no run is timed on an empty answer'
);

-- At this size the list still answers the newest conversations of the organisation first, and the unread counts are those
-- of the conversations with messages of the other side after the owner's last read.
create temp table inbox_page (n integer, id uuid, unread integer);
create temp table inbox_unread (conversation_id uuid, unread integer);
grant all on inbox_page, inbox_unread to authenticated;
select pg_temp.inbox_act_as('00000000-0000-0000-0000-0000000b8003');
insert into inbox_page select row_number() over (), l.id, l.unread
from public.list_conversations('00000000-0000-0000-0000-0000000b8021', p_limit => 50) l;
insert into inbox_unread select u.conversation_id, u.unread from public.my_unread_counts() u;
reset role;
select set_config('request.jwt.claims', '', true) as claims \gset

select is(
  (select string_agg(id::text, ',' order by n) from inbox_page),
  (select string_agg(id::text, ',' order by last_message_at desc, id desc) from (
     select c.id, c.last_message_at from public.conversations c
     join public.conversation_participants p on p.conversation_id = c.id and p.organization_id = '00000000-0000-0000-0000-0000000b8021'
     order by c.last_message_at desc, c.id desc limit 50) x),
  'NFR-P4: the first page of 50 is the 50 conversations with the latest messages'
);
select is(
  (select string_agg(conversation_id || ':' || unread, ',' order by conversation_id) from inbox_unread),
  (select string_agg(p.conversation_id || ':' || u.unread, ',' order by p.conversation_id)
   from public.conversation_participants p
   join public.conversation_reads r on r.conversation_id = p.conversation_id and r.user_id = '00000000-0000-0000-0000-0000000b8003'
   cross join lateral (
     select count(*)::integer as unread from public.messages m
     where m.conversation_id = p.conversation_id and m.moderation_state = 'visible' and m.created_at > r.last_read_at
       and m.sender_organization_id is distinct from p.organization_id) u
   where p.organization_id = '00000000-0000-0000-0000-0000000b8021' and u.unread > 0),
  'NFR-P4: the unread counts are, for every conversation and only those, the messages of the other side after the last read'
);

-- The plan shape, independent of the speed of the machine.
create function pg_temp.plan_of(p_sql text) returns text
language plpgsql as $$
declare
  v_plan json;
begin
  execute 'explain (format json) ' || p_sql into v_plan;
  return v_plan::text;
end;
$$;

select ok(
  pg_temp.plan_of($$select c.id from public.conversation_participants p join public.conversations c on c.id = p.conversation_id
    where p.organization_id = '00000000-0000-0000-0000-0000000b8021' order by c.last_message_at desc, c.id desc limit 20$$)
    !~ '"Node Type": "Seq Scan"',
  'NFR-P4: the page of an inbox reads the participants and the conversations through their indexes, never by a scan'
);
select ok(
  pg_temp.plan_of($$select count(*) from public.messages m where m.conversation_id = '00000000-0000-0000-0000-000000000000'
    and m.created_at > now() - interval '1 day'$$) ~ '"Index Name": "messages_conversation_idx"'
  and pg_temp.plan_of($$select r.last_read_at from public.conversation_reads r
    where r.conversation_id = '00000000-0000-0000-0000-000000000000' and r.user_id = '00000000-0000-0000-0000-0000000b8003'$$)
    ~ '"Index Name": "conversation_reads_pkey"',
  'NFR-P4: the unread count of a row of the list reads its messages after the last read through messages_conversation_idx'
);

select * from finish();
rollback;
