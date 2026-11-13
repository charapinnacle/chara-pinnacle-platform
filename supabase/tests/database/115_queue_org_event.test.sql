begin;
select plan(20);

\ir organizations_fixture.inc

-- Acme: owner own1, admin adm, member mem, invitee inv (not accepted). Beta (suspended): owner own2, admin adm2. oth is the
-- admin of a third organisation.
\set acme '00000000-0000-0000-0000-0000000a0c01'
\set beta '00000000-0000-0000-0000-0000000a0c02'
\set gamma '00000000-0000-0000-0000-0000000a0c03'
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country) values
  (:'acme', 'employer', 'qoe-acme', 'Acme GmbH', 'Acme', 'DE'),
  (:'beta', 'employer', 'qoe-beta', 'Beta GmbH', 'Beta', 'DE'),
  (:'gamma', 'employer', 'qoe-gamma', 'Gamma GmbH', 'Gamma', 'DE');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  (:'acme', :'own1', 'owner', now()), (:'acme', :'adm', 'admin', now()), (:'acme', :'mem', 'member', now()),
  (:'acme', :'inv', 'admin', null),
  (:'beta', :'own2', 'owner', now()), (:'beta', :'adm2', 'admin', now()),
  (:'gamma', :'slg', 'owner', now()), (:'gamma', :'oth', 'admin', now());
update public.organizations set status = 'suspended' where id = :'beta';
select pgmq.purge_queue('notifications');
delete from public.notifications;

create function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare v_state text; v_message text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
end;
$$;

select is(
  private.queue_org_event(:'acme', 'vacancy_hidden', jsonb_build_object('job_id', gen_random_uuid()), 'vacancy_hidden:job-1'), 2,
  'one message for each accepted owner and admin'
);
select set_eq(
  $$select user_id from public.notifications where kind = 'vacancy_hidden'$$,
  format($$values (%L::uuid), (%L::uuid)$$, :'own1', :'adm'),
  'the owner and the admin have a row'
);
select is(
  (select count(*) from public.notifications where user_id in (:'mem', :'inv', :'oth', :'slg')), 0::bigint,
  'the member, the invitee who has not accepted and the admins of another organisation get nothing'
);
select is(
  (select count(*) from public.notifications n join pgmq.q_notifications q on q.msg_id = n.msg_id
   where q.message ->> 'user_id' = n.user_id::text and q.message ->> 'organization_id' = :'acme'
     and q.message ->> 'dedupe_key' = 'vacancy_hidden:job-1'),
  2::bigint, 'each row has its own message with the recipient, the organisation and the dedupe key'
);
select is(
  (select array_agg(row(status, mandatory, dedupe_key)::text) from public.notifications),
  array['(queued,t,vacancy_hidden:job-1)', '(queued,t,vacancy_hidden:job-1)'],
  'the rows are queued, mandatory from the catalogue, with the key'
);
select is(
  private.queue_org_event(:'acme', 'vacancy_hidden', '{}', 'vacancy_hidden:job-1'), 0, 'a repeated call with the same key queues nothing'
);
select is(
  (select row((select count(*) from public.notifications), (select count(*) from pgmq.q_notifications))::text), '(2,2)',
  'and adds no row and no message'
);
select is(private.queue_org_event(:'acme', 'vacancy_hidden', '{}', 'vacancy_hidden:job-2'), 2, 'another key is another event');
select is(private.queue_org_event(:'acme', 'payment_failed', '{}', 'vacancy_hidden:job-1'), 2, 'the key is per kind');
select is(private.queue_org_event(:'acme', 'payment_failed', '{}'), 2, 'without a key every call queues');
select is(private.queue_org_event(:'beta', 'vacancy_hidden', '{}'), 0, 'a suspended organisation gets nothing');
select is(
  (select count(*) from public.notifications where user_id in (:'own2', :'adm2')), 0::bigint, 'no row for its owner or admin'
);

savepoint before_event;
select private.queue_org_event(:'gamma', 'payment_failed', '{}');
rollback to savepoint before_event;
select is((select count(*) from public.notifications where user_id in (:'slg', :'oth')), 0::bigint, 'NFR-A3: a rolled-back caller leaves nothing');

select is(pg_temp.try($$select private.queue_org_event(null, 'payment_failed', '{}')$$), 'P0001|CHARA_INVALID_INPUT|p_org', 'an organisation is required');
select is(
  pg_temp.try(format($$select private.queue_org_event(%L, 'newsletter', '{}')$$, :'acme')), 'P0001|CHARA_INVALID_INPUT|p_kind',
  'a kind outside the catalogue is refused'
);
select is(
  pg_temp.try(format($$select private.queue_org_event(%L, 'payment_failed', '[]')$$, :'acme')), 'P0001|CHARA_INVALID_INPUT|p_message',
  'a message that is not an object is refused'
);
select ok(
  not has_function_privilege('authenticated', 'private.queue_org_event(uuid, text, jsonb, text)', 'execute')
    and not has_function_privilege('anon', 'private.queue_org_event(uuid, text, jsonb, text)', 'execute')
    and not has_function_privilege('service_role', 'private.queue_org_event(uuid, text, jsonb, text)', 'execute'),
  'no API role may call it'
);
select is(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'private.queue_org_event(uuid, text, jsonb, text)'::regprocedure),
  true, 'it is security definer with an empty search_path'
);

-- The dedupe index treats a missing user as equal, so an email to an address is de-duplicated too.
select pgmq.send('notifications', jsonb_build_object('kind', 'deletion_completed', 'email', 'gone@example.test', 'dedupe_key', 'erasure:1'))
from generate_series(1, 2);
select is(
  (select count(*) from public.notifications where kind = 'deletion_completed' and dedupe_key = 'erasure:1'), 1::bigint,
  'a key de-duplicates rows without a user'
);
select is(
  (select count(*) from pgmq.q_notifications where message ->> 'dedupe_key' = 'erasure:1'), 1::bigint, 'and the second message is dropped'
);

select * from finish();
rollback;
