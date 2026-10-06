begin;
select plan(20);

\ir privacy_fixture.inc

\set d4 '00000000-0000-0000-0000-0000000d0004'
\set d5 '00000000-0000-0000-0000-0000000d0005'

create function pg_temp.o() returns uuid language sql as $$ select current_setting('t.o')::uuid $$;
create function pg_temp.p() returns uuid language sql as $$ select current_setting('t.p')::uuid $$;
create function pg_temp.jobs(p_doc uuid) returns bigint language sql as $$
  select count(*) from pgmq.q_account_ops where message ->> 'action' = 'delete_object' and message ->> 'path' like '%/' || p_doc || '/%'
$$;

-- d1 is in the scope of the shares to O and to P and of an expired one; d2 only in a second share to O; d4 in no share.
select pg_temp.doc(:'d1', :'wa');
select pg_temp.doc(:'d2', :'wa');
select pg_temp.doc(:'d4', :'wa');
select pg_temp.doc(:'d5', :'wa');
select set_config('t.s_o', pg_temp.share(pg_temp.o(), :'wa', array[:'d1', :'d5']::uuid[])::text, true);
select set_config('t.s_p', pg_temp.share(pg_temp.p(), :'wa', array[:'d1']::uuid[])::text, true);
select set_config('t.s_x', pg_temp.share(pg_temp.o(), :'wa', array[:'d1']::uuid[], 'sharing-notice', now() - interval '1 day')::text, true);
select set_config('t.s_2', pg_temp.share(pg_temp.o(), :'wa', array[:'d2']::uuid[])::text, true);

select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'ok', 'setup: O opens d1 before the deletion');
select is(pg_temp.grant_as(:'own2', :'d1'), 'ok', 'setup: P opens d1 before the deletion');
select is(pg_temp.call_as(:'wa', 'authenticated', format('select public.delete_worker_document(%L)', :'d1'), 'aal1'), 'ok', 'the candidate deletes d1');

select is(
  (select string_agg(left(id::text, 8) || ':' || (revoked_at is not null), ',' order by created_at, id)
   from public.passport_shares where scope ? :'d1'),
  (select string_agg(left(id::text, 8) || ':' || (id <> current_setting('t.s_x')::uuid), ',' order by created_at, id)
   from public.passport_shares where scope ? :'d1'),
  'B2 AC9: the shares whose scope holds d1 are revoked, an expired one is left alone'
);
select is(
  (select revoked_at is null from public.passport_shares where id = current_setting('t.s_2')::uuid),
  true, 'B2 AC9: a share whose scope does not hold d1 keeps its access'
);
select is(
  (select count(*) from public.passport_shares where revoked_at = now()), 2::bigint, 'the revocation time is the deletion time'
);
select is(
  (select scope from public.passport_shares where id = current_setting('t.s_o')::uuid), to_jsonb(array[:'d1', :'d5']::uuid[]),
  'the scope of the revoked share is unchanged'
);
select is(pg_temp.grant_as(:'mem', :'d1', p_aal => 'aal1'), 'P0002|CHARA_NOT_FOUND|', 'B2 AC9: the grant for the deleted document is not found');
select is(pg_temp.grant_as(:'mem', :'d5', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'the other document of a revoked share is refused too');
select is(pg_temp.grant_as(:'own2', :'d1'), 'P0002|CHARA_NOT_FOUND|', 'and for the other organisation');
select is(pg_temp.grant_as(:'mem', :'d2', p_aal => 'aal1'), 'ok', 'a document of an untouched share is still served');
select is((select count(*) from audit.document_access_log), 3::bigint, 'only the two openings before the deletion and this one are logged');
select is(pg_temp.jobs(:'d1'), 1::bigint, 'B2 AC9: one removal job is queued');

select is(pg_temp.call_as(:'wa', 'authenticated', format('select public.delete_worker_document(%L)', :'d1'), 'aal1'), 'P0002|CHARA_NOT_FOUND|', 'a second delete finds nothing');
select is(pg_temp.call_as(:'wb', 'authenticated', format('select public.delete_worker_document(%L)', :'d4'), 'aal1'), 'P0002|CHARA_NOT_FOUND|', 'another candidate finds nothing');
select is(pg_temp.call_as(:'own1', 'authenticated', format('select public.delete_worker_document(%L)', :'d4'), 'aal2'), 'P0001|CHARA_FORBIDDEN|worker_account_required', 'a company user is refused');
select is(pg_temp.jobs(:'d1') + pg_temp.jobs(:'d4'), 1::bigint, 'none of them queued another job');

select is(
  (select string_agg(action, ',' order by id) from audit.log where entity_type = 'worker_documents' and entity_id = :'d1'),
  'document.created,document.deleted', 'B2 AC11: the deletion is audited'
);
select is(
  (select array_agg(entity_id order by entity_id) from audit.log where action = 'share.revoked'),
  (select array_agg(x order by x) from unnest(array[current_setting('t.s_o'), current_setting('t.s_p')]) x),
  'B2 AC11: one share.revoked row for each revoked share'
);
select is(
  (select count(*) from audit.log where action = 'share.revoked' and actor_id = :'wa' and metadata ? 'organization_id' and not metadata ? 'scope'),
  2::bigint, 'the revocation rows name the candidate as the actor and no document'
);

select * from finish();
rollback;
