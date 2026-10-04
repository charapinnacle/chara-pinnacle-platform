begin;
select plan(50);

\set a 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set b 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

create function pg_temp.bucket(p_key text) returns integer
language sql as $$
  select (('x' || left(p_key, 8))::bit(32)::bigint % (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_buckets'))::integer
$$;

create function pg_temp.hits(p_action text, p_key text) returns integer
language sql as $$
  select h.hits from private.rate_limit_hits h where h.action = p_action and h.bucket = pg_temp.bucket(p_key)
$$;

create function pg_temp.allowed_of(p_action text, p_key text, p_attempts integer) returns bigint
language plpgsql as $$
declare
  v_allowed bigint := 0;
  v_ok boolean;
begin
  for i in 1..p_attempts loop
    select r.allowed into v_ok from public.rate_limit_attempt(p_action, p_key) r;
    if v_ok then v_allowed := v_allowed + 1; end if;
  end loop;
  return v_allowed;
end;
$$;

-- Settings
select results_eq(
  $$select key, value #>> '{}' from private.settings where key like 'rate_limit\_%' order by key$$,
  $$values
    ('rate_limit_buckets', '16384'),
    ('rate_limit_forgot_password_max', '10'), ('rate_limit_forgot_password_seconds', '300'),
    ('rate_limit_login_max', '30'), ('rate_limit_login_seconds', '300'),
    ('rate_limit_resend_max', '10'), ('rate_limit_resend_seconds', '300'),
    ('rate_limit_reset_password_max', '10'), ('rate_limit_reset_password_seconds', '300'),
    ('rate_limit_signup_max', '30'), ('rate_limit_signup_seconds', '300')$$,
  'the limits of the five actions and the bucket count are settings with their defaults'
);

-- Shape and privileges
select is_definer('public', 'rate_limit_attempt', array['text', 'text'], 'the function is SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = 'public.rate_limit_attempt(text, text)'::regprocedure),
  array['search_path=""'],
  'the function sets search_path to empty'
);
select ok(
  has_function_privilege('anon', 'public.rate_limit_attempt(text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.rate_limit_attempt(text, text)', 'execute'),
  'anon and authenticated can count an attempt'
);
select ok(
  not has_function_privilege('service_role', 'public.rate_limit_attempt(text, text)', 'execute'),
  'service_role has no use for the function and no grant'
);
select columns_are('private', 'rate_limit_hits', array['action', 'bucket', 'hits', 'expires_at'], 'the table holds no address, no hash and no account');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.rate_limit_hits'::regclass),
  'the table has RLS enabled and forced'
);
select ok(
  not has_table_privilege('anon', 'private.rate_limit_hits', 'select, insert, update, delete, truncate')
  and not has_table_privilege('authenticated', 'private.rate_limit_hits', 'select, insert, update, delete, truncate')
  and not has_table_privilege('service_role', 'private.rate_limit_hits', 'select, insert, update, delete, truncate')
  and not has_any_column_privilege('anon', 'private.rate_limit_hits', 'select, insert, update')
  and not has_any_column_privilege('authenticated', 'private.rate_limit_hits', 'select, insert, update'),
  'no API role has any privilege on the table'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = 'private.rate_limit_hits'::regclass and i.indisprimary),
  array['action', 'bucket'],
  'the primary key is the action and the bucket: one row each'
);
select has_index('private', 'rate_limit_hits', 'rate_limit_hits_expires_at_idx', 'the purge reads an index');

-- Counting and the limit
select is(
  pg_temp.allowed_of('login', :'a', 30),
  30::bigint,
  'the first 30 login attempts of one visitor are allowed'
);
select results_eq(
  $$select allowed, retry_after_seconds between 1 and 300 from public.rate_limit_attempt('login', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  $$values (false, true)$$,
  'the 31st is refused with 1 to 300 seconds to wait'
);
select results_eq(
  $$select allowed from public.rate_limit_attempt('login', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  $$values (false)$$,
  'and so is the 32nd'
);
select is(pg_temp.hits('login', :'a'), 31, 'a refused attempt is counted but the count stops one above the limit');
select results_eq(
  $$select allowed, retry_after_seconds from public.rate_limit_attempt('login', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')$$,
  $$values (true, 0)$$,
  'another visitor still has its whole budget and is told to wait 0 seconds'
);
select is(pg_temp.hits('login', :'b'), 1, 'the other visitor''s count moved by its own attempt only');
select results_eq(
  $$select allowed from public.rate_limit_attempt('signup', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  $$values (true)$$,
  'the budget of one action is not the budget of another'
);
select is(pg_temp.hits('login', :'a'), 31, 'a sign-up attempt left the login count alone');

-- Window rollover
update private.rate_limit_hits set expires_at = now() - interval '1 second' where action = 'login';
select results_eq(
  $$select allowed from public.rate_limit_attempt('login', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  $$values (true)$$,
  'after the window ends the visitor is allowed again'
);
select is(pg_temp.hits('login', :'a'), 1, 'a new window starts at one attempt');
select is(
  (select expires_at from private.rate_limit_hits where action = 'login' and bucket = pg_temp.bucket(:'a')),
  now() + interval '300 seconds',
  'and lasts the full window from the first attempt'
);
update private.rate_limit_hits set expires_at = now() + interval '40 seconds' where action = 'login';
select is(
  pg_temp.allowed_of('login', :'a', 29),
  29::bigint,
  'attempts inside a running window do not move its end: 29 more fill the limit of 30'
);
select results_eq(
  $$select allowed, retry_after_seconds from public.rate_limit_attempt('login', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  $$values (false, 40)$$,
  'the wait is what is left of the running window'
);

-- The limit and the window are settings
update private.settings set value = '2' where key = 'rate_limit_resend_max';
update private.settings set value = '60' where key = 'rate_limit_resend_seconds';
select results_eq(
  $$select allowed from public.rate_limit_attempt('resend', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') union all
    select allowed from public.rate_limit_attempt('resend', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') union all
    select allowed from public.rate_limit_attempt('resend', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')$$,
  $$values (true), (true), (false)$$,
  'a changed limit applies at once: 2 allowed, the 3rd refused'
);
select is(
  (select expires_at - now() from private.rate_limit_hits where action = 'resend' limit 1),
  interval '60 seconds',
  'a changed window length applies to the next window'
);

-- Every action has its own limits
select results_eq(
  $$select a, pg_temp.allowed_of(a, 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 40)
    from unnest(array['signup', 'forgot_password', 'reset_password']) a order by a$$,
  $$values ('forgot_password', 10::bigint), ('reset_password', 10::bigint), ('signup', 30::bigint)$$,
  'forgot_password and reset_password allow 10, sign-up allows 30 (FR-A1 AC11)'
);

-- Refusals write nothing
select throws_ok(
  $$select * from public.rate_limit_attempt('login', 'short')$$, 'P0001', 'CHARA_INVALID_INPUT', 'a malformed key is refused'
);
select throws_ok(
  $$select * from public.rate_limit_attempt('login', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')$$,
  'P0001', 'CHARA_INVALID_INPUT', 'a key that is not lower-case hex is refused'
);
select throws_ok(
  $$select * from public.rate_limit_attempt('login', null)$$, 'P0001', 'CHARA_INVALID_INPUT', 'a missing key is refused'
);
select throws_ok(
  $$select * from public.rate_limit_attempt('logout', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  'P0001', 'CHARA_INVALID_INPUT', 'an action without limits is refused'
);
select throws_ok(
  $$select * from public.rate_limit_attempt(null, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  'P0001', 'CHARA_INVALID_INPUT', 'a missing action is refused'
);
select is(
  (select count(*) from private.rate_limit_hits where action not in ('login', 'signup', 'resend', 'forgot_password', 'reset_password')),
  0::bigint,
  'no refused call created a counter'
);

-- The bound: whatever keys a caller sends, a bucket is a row
delete from private.rate_limit_hits;
update private.settings set value = '8' where key = 'rate_limit_buckets';
select is(
  (select count(*) from generate_series(1, 500) i,
     lateral public.rate_limit_attempt('login', md5(i::text) || md5((i + 1000)::text))),
  500::bigint,
  'a caller sends 500 different keys'
);
select cmp_ok(
  (select count(*) from private.rate_limit_hits), '<=', 8::bigint, 'and the table holds at most one row per bucket: 8 rows'
);
select cmp_ok((select max(bucket) from private.rate_limit_hits), '<', 8, 'every row is a bucket below the setting');
select cmp_ok(
  (select count(*) from generate_series(1, 5) i, lateral public.rate_limit_attempt('resend', md5(i::text) || md5((i + 7)::text))),
  '=', 5::bigint, 'another action takes its own 8 rows at most'
);
select cmp_ok((select count(*) from private.rate_limit_hits), '<=', 16::bigint, 'two actions, 16 rows at most');
update private.settings set value = '16384' where key = 'rate_limit_buckets';

-- Anonymous and signed-in callers, and nothing else
delete from private.rate_limit_hits;
set local role anon;
select results_eq(
  $$select allowed from public.rate_limit_attempt('login', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd')$$,
  $$values (true)$$,
  'an anonymous visitor can count an attempt'
);
select throws_ok(
  $$select * from private.rate_limit_hits$$, '42501', null, 'an anonymous visitor cannot read the counters'
);
select throws_ok(
  $$update private.rate_limit_hits set hits = 1$$, '42501', null, 'an anonymous visitor cannot reset a counter'
);
select throws_ok(
  $$select private.purge_rate_limit_hits()$$, '42501', null, 'an anonymous visitor cannot run the purge'
);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e001', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  $$select allowed from public.rate_limit_attempt('login', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd')$$,
  $$values (true)$$,
  'a signed-in visitor can count an attempt'
);
select is(
  (select count(*) from public.rate_limit_attempt('login', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd')),
  1::bigint,
  'the answer is one row and carries no count of other visitors'
);
select throws_ok(
  $$select * from private.rate_limit_hits$$, '42501', null, 'a signed-in visitor cannot read the counters'
);
reset role;
select is(pg_temp.hits('login', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'), 3, 'both callers counted into the same visitor bucket');

-- Cleaning
insert into private.rate_limit_hits (action, bucket, hits, expires_at)
values ('login', 1, 5, now() - interval '1 second'), ('login', 2, 5, now() + interval '1 minute');
select is(private.purge_rate_limit_hits(), 1::bigint, 'the purge removes the one expired window');
select is(
  (select count(*) from private.rate_limit_hits where bucket in (1, 2)),
  1::bigint,
  'and keeps the running one'
);
select is(
  (select count(*) from cron.job where jobname = 'purge-rate-limit-hits' and schedule = '*/5 * * * *'
     and command = 'select private.purge_rate_limit_hits()'),
  1::bigint,
  'pg_cron runs the purge every 5 minutes'
);
select ok(
  not has_function_privilege('anon', 'private.purge_rate_limit_hits()', 'execute')
  and not has_function_privilege('authenticated', 'private.purge_rate_limit_hits()', 'execute')
  and not has_function_privilege('service_role', 'private.purge_rate_limit_hits()', 'execute'),
  'no API role can run the purge'
);
select is(
  (select proconfig from pg_proc where oid = 'private.purge_rate_limit_hits()'::regprocedure),
  array['search_path=""'],
  'the purge sets search_path to empty'
);

select * from finish();
rollback;
