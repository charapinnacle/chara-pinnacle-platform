-- SA-02 (security review), D79: an anonymous caller of rate_limit_attempt can no longer refuse other visitors. With the
-- Vault secret set, only a call with the web tier's proof is counted; each visitor has a counter of its own, new counters
-- per window are capped, and beyond the cap the throttle degrades to shared buckets for new visitors only.
begin;
select plan(30);

-- The victim's key and keys whose first 32 bits are the victim's old bucket (modulo 16,384) but another counter.
\set victim '0000400100000000000000000000000000000000000000000000000000000000'
\set secret 'test-visitor-hash-secret-0123456789abcdef'

create function pg_temp.collider(i integer) returns text
language sql as $$ select lpad(to_hex(16385 + i * 16384), 8, '0') || repeat('f', 56) $$;

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

create function pg_temp.counter(p_key text) returns integer
language sql as $$ select (('x' || left(p_key, 8))::bit(32)::bigint & 2147483647)::integer $$;

-- The proof as lib/visitor-address.ts makes it: the key derived from the secret, then action|key|minute.
create function pg_temp.proof(p_action text, p_key text, p_minute_offset integer default 0) returns text
language sql as $$
  select encode(extensions.hmac(
    p_action || '|' || p_key || '|' || (floor(extract(epoch from now()) / 60)::bigint + p_minute_offset),
    encode(extensions.hmac('rate_limit_attempt', 'test-visitor-hash-secret-0123456789abcdef', 'sha256'), 'hex'),
    'sha256'), 'hex')
$$;

-- An anonymous caller's attempts that the database refused, out of p_attempts.
create function pg_temp.refused_of(p_action text, p_key text, p_attempts integer) returns bigint
language plpgsql as $$
declare
  v_refused bigint := 0;
begin
  for i in 1..p_attempts loop
    begin
      perform public.rate_limit_attempt(p_action, p_key);
    exception when insufficient_privilege then
      v_refused := v_refused + 1;
    end;
  end loop;
  return v_refused;
end;
$$;

grant execute on function pg_temp.collider(integer), pg_temp.allowed_of(text, text, integer), pg_temp.refused_of(text, text, integer),
  pg_temp.proof(text, text, integer) to anon;

select is(
  (select count(distinct ((('x' || left(pg_temp.collider(i), 8))::bit(32)::bigint) % 16384)) from generate_series(1, 40) i),
  1::bigint, 'the 40 attacker keys all fall into one old bucket'
);
select is(
  ((('x' || left(:'victim', 8))::bit(32)::bigint) % 16384), ((('x' || left(pg_temp.collider(1), 8))::bit(32)::bigint) % 16384),
  'and it is the victim''s old bucket'
);

-- Without the Vault secret (a local stack) the proof is not checked: the attack of SA-02 fills only made-up counters.
delete from private.rate_limit_hits;
set local role anon;
select is(
  (select sum(pg_temp.allowed_of('login', pg_temp.collider(i), 31)) from generate_series(1, 40) i),
  1200::numeric, 'an anonymous caller spends 31 attempts on each of 40 keys and gets 30 allowed for each'
);
select results_eq(
  $$select allowed, retry_after_seconds from public.rate_limit_attempt('login', '0000400100000000000000000000000000000000000000000000000000000000')$$,
  $$values (true, 0)$$,
  'the victim is still allowed: the attacker cannot reach its counter'
);
select throws_ok(
  $$select * from public.rate_limit_attempt('keys:login', '0000400100000000000000000000000000000000000000000000000000000000')$$,
  'P0001', 'CHARA_INVALID_INPUT', 'the anonymous caller cannot count against the cap of new visitors'
);
select throws_ok(
  $$select * from public.rate_limit_attempt('shared:login', '0000400100000000000000000000000000000000000000000000000000000000')$$,
  'P0001', 'CHARA_INVALID_INPUT', 'nor against the shared buckets'
);
reset role;
select is(
  (select hits from private.rate_limit_hits where action = 'login' and bucket = pg_temp.counter(:'victim')), 1,
  'the victim''s counter holds its one attempt'
);
select is(
  (select hits from private.rate_limit_hits where action = 'keys:login' and bucket = 0), 41,
  'the window counted 41 new visitors'
);

-- The global cap: beyond it, a new visitor is counted in a shared bucket of the action, and the cap row is not written.
delete from private.rate_limit_hits;
update private.settings set value = '3' where key = 'rate_limit_visitor_keys_max';
select is(
  (select count(*) from generate_series(1, 3) i, lateral public.rate_limit_attempt('login', pg_temp.collider(i)) r where r.allowed),
  3::bigint, 'three new visitors are allowed'
);
select is((select count(*) from private.rate_limit_hits where action = 'login'), 3::bigint, 'each with a counter of its own');
select ctid::text as cap_row from private.rate_limit_hits where action = 'keys:login' and bucket = 0 \gset
select is(pg_temp.allowed_of('login', :'victim', 31), 30::bigint, 'the fourth new visitor is still throttled: 30 allowed, the 31st refused');
select is(
  (select bucket from private.rate_limit_hits where action = 'shared:login'),
  ((('x' || left(:'victim', 8))::bit(32)::bigint) % 16384)::integer,
  'in its shared bucket'
);
select is((select count(*) from private.rate_limit_hits where action = 'login'), 3::bigint, 'and no counter of its own was created');
select is(
  (select format('%s|%s', ctid, hits) from private.rate_limit_hits where action = 'keys:login'), format('%s|3', :'cap_row'),
  'the calls after the cap left the cap row as it was: read, not written'
);
select is(pg_temp.allowed_of('login', pg_temp.collider(1), 30), 29::bigint, 'a visitor with a counter keeps its own budget: 29 more of 30');
select results_eq(
  $$select allowed from public.rate_limit_attempt('login', pg_temp.collider(1))$$,
  $$values (false)$$,
  'and is refused above it'
);

-- An expired counter is reused, not counted as a new visitor; a new window of the cap gives new visitors counters again.
update private.rate_limit_hits set expires_at = now() - interval '1 second' where action = 'login' and bucket = pg_temp.counter(pg_temp.collider(2));
select results_eq(
  $$select allowed from public.rate_limit_attempt('login', pg_temp.collider(2))$$,
  $$values (true)$$,
  'a visitor whose window ended starts a new one in its own row while the cap is reached'
);
update private.rate_limit_hits set expires_at = now() - interval '1 second' where action = 'keys:login';
select results_eq(
  $$select allowed from public.rate_limit_attempt('login', pg_temp.collider(7))$$,
  $$values (true)$$,
  'after the window of the cap a new visitor is allowed'
);
select is(
  (select count(*) from private.rate_limit_hits where action = 'login' and bucket = pg_temp.counter(pg_temp.collider(7))), 1::bigint,
  'with a counter of its own'
);

-- The proof. lib/visitor-address.ts and pgcrypto compute the same value (the vector of Vitest visitor-address).
select is(
  encode(extensions.hmac('login|' || repeat('a', 64) || '|29000000', encode(extensions.hmac('rate_limit_attempt', :'secret', 'sha256'), 'hex'), 'sha256'), 'hex'),
  '0401f0c986731525401aa92864cdb1f055fcfef17483a440138a7929747bef87',
  'the proof of the database is the proof of the web tier'
);
select vault.create_secret(encode(extensions.hmac('rate_limit_attempt', :'secret', 'sha256'), 'hex'), 'rate_limit_proof_key') is not null as vault_set \gset
delete from private.rate_limit_hits;

-- The attack after the cap: the anonymous caller spends more than the cap on made-up keys and floods the victim's
-- shared bucket; without the proof not one of its calls is counted.
set local role anon;
select is(
  (select sum(pg_temp.refused_of('login', pg_temp.collider(i), 1)) from generate_series(1, 4) i), 4::numeric,
  'the anonymous caller''s calls with four new keys, one more than the cap, are refused'
);
select is(pg_temp.refused_of('login', pg_temp.collider(9), 31), 31::bigint, 'and so are 31 calls into the victim''s shared bucket');
select throws_ok(
  format($$select * from public.rate_limit_attempt('login', %L, %L)$$, :'victim', pg_temp.proof('login', pg_temp.collider(1))),
  '42501', 'CHARA_FORBIDDEN', 'the proof of another key is refused'
);
select throws_ok(
  format($$select * from public.rate_limit_attempt('signup', %L, %L)$$, :'victim', pg_temp.proof('login', :'victim')),
  '42501', 'CHARA_FORBIDDEN', 'the proof of another action is refused'
);
select throws_ok(
  format($$select * from public.rate_limit_attempt('login', %L, %L)$$, :'victim', pg_temp.proof('login', :'victim', -2)),
  '42501', 'CHARA_FORBIDDEN', 'a proof two minutes old is refused'
);
reset role;
select is((select count(*) from private.rate_limit_hits), 0::bigint, 'no refused call created or counted a row');

-- The web tier's calls carry the proof.
select is(
  (select format('%s|%s', allowed, retry_after_seconds) from public.rate_limit_attempt('login', :'victim', pg_temp.proof('login', :'victim'))),
  't|0', 'the victim, through the web tier, is allowed after the attack'
);
select is(
  (select hits from private.rate_limit_hits where action = 'login' and bucket = pg_temp.counter(:'victim')), 1,
  'in a counter of its own'
);
select is(
  (select allowed from public.rate_limit_attempt('login', :'victim', pg_temp.proof('login', :'victim', -1))), true,
  'the proof of the minute before is accepted, for a request across a minute boundary'
);
select is(
  (select allowed from public.rate_limit_attempt('login', :'victim', pg_temp.proof('login', :'victim', 1))), true,
  'and that of the next minute, for a web server whose clock is ahead'
);

select * from finish();
rollback;
