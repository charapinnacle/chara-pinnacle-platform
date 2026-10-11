-- Per-visitor throttling without shared buckets (security review SA-02; OPEN_QUESTIONS.md D79). Until now a visitor was
-- the first 32 bits of the keyed address hash modulo rate_limit_buckets (16,384), so any caller of the public function
-- could pick bucket numbers and, with (limit + 1) x 16,384 calls per window, refuse every visitor. The keyed hash is made
-- by the web tier with a secret the database and the browser never see, so a caller cannot compute the key of another
-- visitor; what made the attack work was the small shared space.
--
-- Now a visitor's counter is the first 31 bits of that hash (a space of 2^31): a caller only ever fills counters of
-- keys it made up and reaches a real visitor's counter by chance alone. Each counter keeps its hard cap (limit + 1).
-- Because every new key is a new row, the number of new counters per action in one window is capped by a separate
-- global counter (rate_limit_visitor_keys_max). Beyond that cap the function degrades to the previous scheme for the
-- rest of the window: a visitor without a running counter is counted in one of rate_limit_buckets shared buckets of
-- the action, so throttling never stops, the table stays bounded, and visitors who already have a counter keep their
-- own budget. The global counter is a row with action 'keys:<action>' and the shared buckets rows with action
-- 'shared:<action>'; rate_limit_attempt cannot name either, because it accepts only actions with settings
-- rate_limit_<action>_max and _seconds.
--
-- Rows per action are bounded by about three times the cap (counters of this and the last window until the purge,
-- which runs every five minutes) plus the shared buckets. A WAF limit on the function stays a release check
-- (docs/runbooks/security-checklist.md); moving the call behind a server-only role was not possible: the web tier holds
-- only the publishable key (ADR 0003), so it has no credential that a direct caller lacks.
insert into private.settings (key, value) values ('rate_limit_visitor_keys_max', '20000');

comment on table private.rate_limit_hits is
  'Attempts of the current window per action and counter (D20, D79): 31 bits of the visitor hash, a shared bucket under '
  'shared:<action> once keys:<action> passes rate_limit_visitor_keys_max, or the per-person counters user:<action>. '
  'Bounded by the global cap and the bucket counts; expired rows are purged by pg_cron.';

create or replace function public.rate_limit_attempt(p_action text, p_key text)
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
  v_counter integer;
  v_hits integer;
  v_expires timestamptz;
begin
  if v_max is null or v_seconds is null then
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

  v_counter := (('x' || left(p_key, 8))::bit(32)::bigint & 2147483647)::integer;
  if exists (select 1 from private.rate_limit_hits h where h.action = p_action and h.bucket = v_counter)
     or (select r.hit_count from private.rate_limit_hit('keys:' || p_action, 0, v_keys_max, v_seconds) r) <= v_keys_max then
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
