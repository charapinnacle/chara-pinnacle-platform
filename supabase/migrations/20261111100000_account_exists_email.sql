-- Sign-up with an address that already has a confirmed account (FR-A1, FR-I1; OPEN_QUESTIONS.md D89). Auth answers such a
-- sign-up like a new one and sends nothing, so the person saw "check your email" and no email came. The screen must stay the
-- same for every address (account enumeration), so the owner of the address learns it by email instead: the web tier calls
-- notify_existing_account after every sign-up that Auth answered as an existing account, and the function queues one
-- account_exists email (a link to log in and one to reset the password) when the address belongs to a confirmed account.
-- An unconfirmed account needs nothing here: Auth itself sends a new confirmation link on a repeat sign-up.
--
-- The function answers nothing, whatever the address, so it is no lookup of addresses. It is open to the API roles because
-- the sign-up runs without a session; as rate_limit_attempt it asks for the visitor proof of the web tier (an HMAC over
-- account_exists|key|minute with the Vault secret rate_limit_proof_key, not checked while that secret is absent on a local
-- stack), so a direct caller of the Data API cannot mail anybody. The visitor is throttled by the sign-up and resend limits
-- of the web tier before it gets here; one address receives at most one such email per account_exists_email_interval_minutes.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

insert into private.settings (key, value) values ('account_exists_email_interval_minutes', '15');

create function public.notify_existing_account(p_email text, p_key text, p_proof text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_minutes integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'account_exists_email_interval_minutes');
  v_proof_key text := (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'rate_limit_proof_key');
  v_minute bigint := floor(extract(epoch from now()) / 60)::bigint;
  v_uid uuid;
begin
  if v_minutes is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'account_exists_email_interval_minutes';
  end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_email';
  end if;
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_key';
  end if;
  if v_proof_key is not null and not exists (
    select 1 from generate_series(v_minute - 1, v_minute + 1) m
    where encode(extensions.hmac('account_exists|' || p_key || '|' || m, v_proof_key, 'sha256'), 'hex') = p_proof
  ) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501', detail = 'p_proof';
  end if;

  -- Auth stores the address in lower case; the predicate is the one of its unique index users_email_partial_key.
  select u.id into v_uid
  from auth.users u
  where u.email = v_email and u.is_sso_user = false and u.email_confirmed_at is not null and u.deleted_at is null;
  if not found then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account_exists:' || v_uid, 0));
  if exists (
    select 1 from public.notifications n
    where n.user_id = v_uid and n.kind = 'account_exists' and n.created_at > now() - make_interval(mins => v_minutes)
  ) then
    return;
  end if;
  perform pgmq.send('notifications', jsonb_build_object('kind', 'account_exists', 'user_id', v_uid, 'mandatory', true));
end;
$$;

revoke all on function public.notify_existing_account(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.notify_existing_account(text, text, text) to anon, authenticated;
