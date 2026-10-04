-- Login, logout and recovery (FR-A3; OPEN_QUESTIONS.md D22).
-- Failed password checks arrive through the Auth password-verification-attempt hook; every password change is audited by a
-- trigger on auth.users; a recovery link is held to 1 hour here because Auth has one link lifetime for all emails.

insert into private.settings (key, value) values
  ('login_failure_threshold', '5'),
  ('login_failure_window_minutes', '15'),
  ('recovery_link_minutes', '60');

-- Actor-aware audit rows from code that runs without the user's JWT (an Auth hook, a trigger on auth.users): audit.record
-- takes the actor from auth.uid(), so the claim is set for the one call and then put back.
create function private.record_as(
  p_actor uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_metadata jsonb default '{}'
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_id bigint;
begin
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  v_id := audit.record(p_action, p_entity_type, p_entity_id, p_metadata);
  perform set_config('request.jwt.claim.sub', v_previous, true);
  return v_id;
end;
$$;

revoke all on function private.record_as(uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;

-- One row per account for the current failure window. audited is set when the window has written its audit row, so
-- a window writes at most one.
create table private.login_failures (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null,
  failures integer not null check (failures > 0),
  audited boolean not null default false
);

comment on table private.login_failures is
  'Failed password checks of the current window per account (FR-A3). A window starts with its first failure; no lockout is built.';

alter table private.login_failures enable row level security;
alter table private.login_failures force row level security;
revoke all on table private.login_failures from public, anon, authenticated, service_role;

-- Password checks per day, the source of the login success rate. The counts are spread over 16 rows per day, chosen by
-- the account, so concurrent checks (credential stuffing) do not queue on one row lock inside the Auth request;
-- the KPI sums them.
create table stats.login_attempts_daily (
  day date not null,
  shard smallint not null check (shard between 0 and 15),
  successes integer not null default 0 check (successes >= 0),
  failures integer not null default 0 check (failures >= 0),
  primary key (day, shard)
);

comment on table stats.login_attempts_daily is
  'Correct and failed password checks per UTC day and shard (FR-A3 KPI: login success rate = sum(successes) / sum(successes + failures)). Existing, usable accounts only: Auth does not call the hook for an unknown address, a banned or an unconfirmed account, and a correct password for an unconfirmed account is still counted as correct.';

alter table stats.login_attempts_daily enable row level security;
alter table stats.login_attempts_daily force row level security;
revoke all on table stats.login_attempts_daily from public, anon, authenticated, service_role;

create function private.hook_password_verification_attempt(event jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_threshold integer := (select (value #>> '{}')::integer from private.settings where key = 'login_failure_threshold');
  v_window integer := (select (value #>> '{}')::integer from private.settings where key = 'login_failure_window_minutes');
  v_failures integer;
  v_audited boolean;
begin
  if (event ->> 'valid')::boolean then
    insert into stats.login_attempts_daily as d (day, shard, successes)
    values ((now() at time zone 'utc')::date, (hashtext(v_user::text) & 15)::smallint, 1)
    on conflict (day, shard) do update set successes = d.successes + 1;
    return jsonb_build_object('decision', 'continue');
  end if;

  insert into private.login_failures as f (user_id, window_started_at, failures)
  values (v_user, now(), 1)
  on conflict (user_id) do update set
    window_started_at = case when f.window_started_at <= now() - make_interval(mins => v_window)
                             then now() else f.window_started_at end,
    failures = case when f.window_started_at <= now() - make_interval(mins => v_window)
                    then 1 else f.failures + 1 end,
    audited = f.audited and f.window_started_at > now() - make_interval(mins => v_window)
  returning f.failures, f.audited into v_failures, v_audited;

  insert into stats.login_attempts_daily as d (day, shard, failures)
  values ((now() at time zone 'utc')::date, (hashtext(v_user::text) & 15)::smallint, 1)
  on conflict (day, shard) do update set failures = d.failures + 1;

  if v_failures >= v_threshold and not v_audited then
    perform private.record_as(
      v_user, 'login_failures_threshold', 'user', v_user::text,
      jsonb_build_object('failures', v_failures, 'window_minutes', v_window)
    );
    update private.login_failures set audited = true where user_id = v_user;
  end if;

  return jsonb_build_object('decision', 'continue');
end;
$$;

revoke all on function private.hook_password_verification_attempt(jsonb) from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.hook_password_verification_attempt(jsonb) to supabase_auth_admin;

create function private.audit_password_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_as(new.id, 'password_changed', 'user', new.id::text);
  return new;
end;
$$;

revoke all on function private.audit_password_changed() from public, anon, authenticated, service_role;

create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.audit_password_changed();

-- True while the recovery link with this token hash is unused, not superseded by a newer request, and younger than
-- recovery_link_minutes. The web tier asks before it opens or spends a link; the token hash is the secret and the
-- answer is only yes or no.
create function public.recovery_link_is_fresh(p_token_hash text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.one_time_tokens t
    where t.token_hash = p_token_hash
      and t.token_type = 'recovery_token'
      and (t.created_at at time zone 'utc') > now() - make_interval(
        mins => (select (value #>> '{}')::integer from private.settings where key = 'recovery_link_minutes')
      )
  )
$$;

revoke all on function public.recovery_link_is_fresh(text) from public, anon, authenticated, service_role;
grant execute on function public.recovery_link_is_fresh(text) to anon, authenticated;

-- Auth keeps a recovery token for otp_expiry (24 hours, the sign-up link lifetime) and accepts it at its verify endpoint
-- whatever the web tier thinks, so the 1-hour lifetime of FR-A3 is enforced where Auth reads the token: a minute job
-- removes recovery tokens older than recovery_link_minutes. recovery_link_is_fresh stays as the exact, immediate check.
create function private.expire_recovery_tokens() returns bigint
language sql
security definer
set search_path = ''
as $$
  with expired as (
    delete from auth.one_time_tokens t
    where t.token_type = 'recovery_token'
      and (t.created_at at time zone 'utc') <= now() - make_interval(
        mins => (select (value #>> '{}')::integer from private.settings where key = 'recovery_link_minutes')
      )
    returning 1
  )
  select count(*) from expired
$$;

revoke all on function private.expire_recovery_tokens() from public, anon, authenticated, service_role;

create extension pg_cron with schema pg_catalog;

select cron.schedule('expire-recovery-tokens', '* * * * *', 'select private.expire_recovery_tokens()');
