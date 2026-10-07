begin;
select plan(12);

\ir privacy_fixture.inc

-- FR-E2 AC5: the allowance of document_access_grant is 30 requests per person in 60 seconds. The repeat window is set
-- to zero so that every granted request leaves one log row to count.
create function pg_temp.o() returns uuid language sql as $$ select current_setting('t.o')::uuid $$;

update private.settings set value = '0' where key = 'document_access_repeat_seconds';
select set_config('t.d1', :'d1', true) as keep_d1 \gset
select pg_temp.doc(:'d1', :'wa');
select pg_temp.share(pg_temp.o(), :'wa', array[:'d1']::uuid[]);

create function pg_temp.opened(p_user uuid, p_times integer) returns text
language sql as $$
  select string_agg(distinct pg_temp.grant_as(p_user, current_setting('t.d1')::uuid), ',') from generate_series(1, p_times)
$$;

select is(pg_temp.opened(:'mem', 30), 'ok', 'AC5: 30 requests in a window are granted');
select is((select count(*) from audit.document_access_log where accessed_by = :'mem'), 30::bigint, 'AC5: with one log row each');
select is(pg_temp.grant_as(:'mem', :'d1'), 'P0001|CHARA_RATE_LIMITED|', 'AC5: the 31st request is refused with CHARA_RATE_LIMITED');
select is(pg_temp.grant_as(:'mem', :'d1'), 'P0001|CHARA_RATE_LIMITED|', 'and so is the next one, the refusal does not reset the window');
select is((select count(*) from audit.document_access_log where accessed_by = :'mem'), 30::bigint, 'AC5: no log row was written for a refused request');
select is(pg_temp.grant_as(:'own1', :'d1'), 'ok', 'another person has an allowance of their own');
update private.rate_limit_hits set expires_at = now() - interval '1 second' where action = 'document_access';
select is(pg_temp.grant_as(:'mem', :'d1'), 'ok', 'a new window starts when the old one has ended');

-- A refused request does not use up the allowance: its increment is rolled back with the refusal.
create function pg_temp.refused(p_user uuid, p_times integer) returns text
language sql as $$
  select string_agg(distinct pg_temp.grant_as(p_user, '00000000-0000-0000-0000-0000000d0fff'), ',') from generate_series(1, p_times)
$$;
update private.rate_limit_hits set expires_at = now() - interval '1 second' where action = 'document_access';
select is(pg_temp.refused(:'adm', 40), 'P0002|CHARA_NOT_FOUND|', 'forty requests for a document that does not exist are refused as not found, not as too many');
select is(pg_temp.grant_as(:'adm', :'d1', 'application_review', 'aal2'), 'ok', 'and the allowance is still whole');
select is(pg_temp.grant_as(:'wa', :'d1', 'owner_download', 'aal1'), 'ok', 'the owner of the document is counted too, and is within the allowance');

-- The function is the database's own: no API role can call it or read the counters.
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($f$select private.check_rate_limit('document_access', %L)$f$, :'mem'), 'aal1'),
  '42501|permission denied for function check_rate_limit|', 'an API role cannot call private.check_rate_limit'
);
select throws_ok(
  $$select private.check_rate_limit('no_such_action', gen_random_uuid())$$, 'P0001', 'CHARA_SETTING_MISSING',
  'an action without settings is a configuration error, not a free pass'
);

select * from finish();
rollback;
