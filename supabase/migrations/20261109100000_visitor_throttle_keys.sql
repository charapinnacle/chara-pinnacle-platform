-- Per-visitor throttling that only the web tier can count (security review SA-02; OPEN_QUESTIONS.md D79). Until now a
-- visitor was the first 32 bits of the keyed address hash modulo rate_limit_buckets (16,384), and the function was open
-- to every anonymous caller, so (limit + 1) x 16,384 calls per window with made-up keys refused every visitor.
--
-- Proof. The web tier sends with each attempt an HMAC-SHA256 over action|key|minute (Unix time divided by 60), keyed
-- with the Vault secret rate_limit_proof_key. That key is derived from VISITOR_HASH_SECRET (lib/visitor-address.ts), so
-- the database can check a proof but still cannot compute the key of an address. A call without a valid proof for this
-- minute or the one before or after (clock skew, a request across a minute boundary) is refused with CHARA_FORBIDDEN
-- before anything is counted, so a direct caller of the Data API cannot touch a counter. While the Vault secret is not
-- set (local stacks) the proof is not checked; the go-live gate fails until it is (docs/runbooks/security-checklist.md).
-- Only the six actions of the web tier are accepted, so the settings of internal counters (document_access, the quotas
-- of 20261109120000) never become public actions.
--
-- Counters. A visitor's counter is the first 31 bits of the keyed hash (a space of 2^31), with its hard cap (limit + 1).
-- Every new key is a new row, so the new counters per action and window are capped by rate_limit_visitor_keys_max
-- (row 'keys:<action>', bucket 0). The cap row is read before it is written, so once it is reached the calls of new
-- visitors leave it alone instead of queueing on its row lock. Beyond the cap a visitor without a running counter is
-- counted in one of rate_limit_buckets shared buckets ('shared:<action>') for the rest of the window: throttling never
-- stops and the table stays bounded (about three times the cap per action, counters of this and the last window until
-- the five-minute purge, plus the buckets). With the proof the cap can only be spent through the web tier, one key per
-- client address (IPv4 address or IPv6 /64): the residual risk is a client with more than about 180,000 such networks
-- that fills the shared buckets during one window, for which the WAF rule stays a release check.
insert into private.settings (key, value) values ('rate_limit_visitor_keys_max', '20000');

comment on table private.rate_limit_hits is
  'Attempts of the current window per action and counter (D20, D79): 31 bits of the visitor hash, a shared bucket under '
  'shared:<action> once keys:<action> reaches rate_limit_visitor_keys_max, or the per-person counters user:<action> and '
  'org:<action>. Bounded by the global cap and the bucket counts; expired rows are purged by pg_cron.';

drop function public.rate_limit_attempt(text, text);

create function public.rate_limit_attempt(p_action text, p_key text, p_proof text default null)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_max');
  v_seconds integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_' || p_action || '_seconds');
  v_buckets integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_buckets');
  v_keys_max integer := (select (value #>> '{}')::integer from private.settings where key = 'rate_limit_visitor_keys_max');
  v_proof_key text := (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'rate_limit_proof_key');
  v_minute bigint := floor(extract(epoch from now()) / 60)::bigint;
  v_counter integer;
  v_own boolean := true;
  v_new_visitors integer;
  v_hits integer;
  v_expires timestamptz;
begin
  if p_action is null or p_action not in ('signup', 'resend', 'login', 'forgot_password', 'reset_password', 'mfa_code')
     or v_max is null or v_seconds is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_action';
  end if;
  if v_buckets is null or v_buckets < 1 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'rate_limit_buckets';
  end if;
  if v_keys_max is null or v_keys_max < 1 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'rate_limit_visitor_keys_max';
  end if;
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_key';
  end if;
  if v_proof_key is not null and not exists (
    select 1 from generate_series(v_minute - 1, v_minute + 1) m
    where encode(extensions.hmac(p_action || '|' || p_key || '|' || m, v_proof_key, 'sha256'), 'hex') = p_proof
  ) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501', detail = 'p_proof';
  end if;

  v_counter := (('x' || left(p_key, 8))::bit(32)::bigint & 2147483647)::integer;
  if not exists (select 1 from private.rate_limit_hits h where h.action = p_action and h.bucket = v_counter) then
    select h.hits into v_new_visitors
    from private.rate_limit_hits h
    where h.action = 'keys:' || p_action and h.bucket = 0 and h.expires_at > now();
    v_own := coalesce(v_new_visitors, 0) < v_keys_max;
    if v_own then
      perform private.rate_limit_hit('keys:' || p_action, 0, v_keys_max, v_seconds);
    end if;
  end if;

  if v_own then
    select r.hit_count, r.window_end into v_hits, v_expires
    from private.rate_limit_hit(p_action, v_counter, v_max, v_seconds) r;
  else
    select r.hit_count, r.window_end into v_hits, v_expires
    from private.rate_limit_hit('shared:' || p_action, (('x' || left(p_key, 8))::bit(32)::bigint % v_buckets)::integer, v_max, v_seconds) r;
  end if;

  allowed := v_hits <= v_max;
  retry_after_seconds := case when allowed then 0 else greatest(1, ceil(extract(epoch from v_expires - now()))::integer) end;
  return next;
end;
$$;

revoke all on function public.rate_limit_attempt(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.rate_limit_attempt(text, text, text) to anon, authenticated;
