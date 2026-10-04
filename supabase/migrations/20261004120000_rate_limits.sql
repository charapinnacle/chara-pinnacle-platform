-- Per-visitor throttling of sign-up, resend, login and recovery (OPEN_QUESTIONS.md D20; FR-A1 AC10 and AC11, FR-A3 AC5).
-- The web tier calls Auth from one address, so Auth's per-IP limits count every visitor together. The web tier therefore
-- counts attempts per visitor here, before it calls Auth.

-- Per action: the attempts allowed in one window and the window length. An action without both settings does not exist
-- for the function below, so a caller cannot create counters for names of its own.
insert into private.settings (key, value) values
  ('rate_limit_signup_max', '30'),
  ('rate_limit_signup_seconds', '300'),
  ('rate_limit_resend_max', '10'),
  ('rate_limit_resend_seconds', '300'),
  ('rate_limit_login_max', '30'),
  ('rate_limit_login_seconds', '300'),
  ('rate_limit_forgot_password_max', '10'),
  ('rate_limit_forgot_password_seconds', '300'),
  ('rate_limit_reset_password_max', '10'),
  ('rate_limit_reset_password_seconds', '300'),
  ('rate_limit_buckets', '16384');

-- One row per action and bucket, never more: a visitor is a bucket number (the first 32 bits of the keyed hash of the
-- address, modulo rate_limit_buckets), not an address and not the hash. The table can therefore not grow beyond
-- actions x buckets rows whatever a caller sends, and holds nothing that identifies a visitor. A window starts with the
-- first attempt and ends expires_at later; a later attempt starts a new window in the same row. Unlogged: every
-- attempt writes here, and a crash only gives visitors a fresh window, so the counters need no WAL, backup or replica.
create unlogged table private.rate_limit_hits (
  action text not null,
  bucket integer not null check (bucket >= 0),
  hits integer not null check (hits > 0),
  expires_at timestamptz not null,
  primary key (action, bucket)
);

comment on table private.rate_limit_hits is
  'Attempts of the current window per action and visitor bucket (D20). Bounded by design: one row per action and bucket; expired rows are purged by pg_cron.';

create index rate_limit_hits_expires_at_idx on private.rate_limit_hits (expires_at);

alter table private.rate_limit_hits enable row level security;
alter table private.rate_limit_hits force row level security;
revoke all on table private.rate_limit_hits from public, anon, authenticated, service_role;

-- Counts one attempt and says whether it may go on. p_key is the keyed hash (hex SHA-256) of the visitor address made
-- by the web tier with a secret the browser never sees. A direct caller of this function can only add attempts to
-- buckets: it cannot read a count, cannot name a visitor (it cannot compute a victim's hash) and cannot add rows beyond
-- the bound above. It can still fill buckets at random: (limit + 1) x buckets calls per window refuse every visitor, so
-- a WAF rate limit on this function is a release check (docs/ARCHITECTURE.md section 15.1).
create function public.rate_limit_attempt(p_action text, p_key text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_max');
  v_seconds integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_seconds');
  v_buckets integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_buckets');
  v_hits integer;
  v_expires timestamptz;
begin
  if v_max is null or v_seconds is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_action';
  end if;
  if v_buckets is null or v_buckets < 1 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'rate_limit_buckets';
  end if;
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_key';
  end if;

  insert into private.rate_limit_hits as h (action, bucket, hits, expires_at)
  values (
    p_action,
    (('x' || left(p_key, 8))::bit(32)::bigint % v_buckets)::integer,
    1,
    now() + make_interval(secs => v_seconds)
  )
  on conflict (action, bucket) do update set
    hits = case when h.expires_at <= now() then 1 else least(h.hits + 1, v_max + 1) end,
    expires_at = case when h.expires_at <= now() then now() + make_interval(secs => v_seconds) else h.expires_at end
  returning h.hits, h.expires_at into v_hits, v_expires;

  allowed := v_hits <= v_max;
  retry_after_seconds := case when allowed then 0 else greatest(1, ceil(extract(epoch from v_expires - now()))::integer) end;
  return next;
end;
$$;

revoke all on function public.rate_limit_attempt(text, text) from public, anon, authenticated, service_role;
grant execute on function public.rate_limit_attempt(text, text) to anon, authenticated;

create function private.purge_rate_limit_hits() returns bigint
language sql
security definer
set search_path = ''
as $$
  with purged as (
    delete from private.rate_limit_hits where expires_at <= now() returning 1
  )
  select count(*) from purged
$$;

revoke all on function private.purge_rate_limit_hits() from public, anon, authenticated, service_role;

select cron.schedule('purge-rate-limit-hits', '*/5 * * * *', 'select private.purge_rate_limit_hits()');
