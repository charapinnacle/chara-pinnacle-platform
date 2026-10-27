-- Review fixes of the workforce requirement limits (FR-M4, V34; release 2b). The upgrade prompt of the open-requirements
-- limit is recorded at most once per hour per user (FR-M4 AC9); a lapse takes the advisory lock of the limit trigger, so
-- it waits for a publish or reopen of the same organisation in progress; and org_usage answers in release 2b for
-- employers only, as only employers have workforce requirements.

-- public.record_limit_prompt of 20261125100000_partner_usage_helpers.sql with one addition: for active_requirements a
-- user who already has a limit.prompt_shown row of that key in the last hour gets none (FR-M4 AC9), whichever
-- organisation it was for. Every other key keeps the ceilings as before.
create or replace function public.record_limit_prompt(p_org uuid, p_limit_key text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_user_max integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'limit_prompt_per_hour_max');
  v_key_max integer :=
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'limit_prompt_per_org_key_hour_max');
  v_used integer;
begin
  if v_uid is null or not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if private.org_type(p_org) <> 'employer' and not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if p_limit_key is null or p_limit_key not in (select private.org_usage_keys(p_org)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'limit_key', errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('limit_prompt:' || p_org::text || ':' || p_limit_key, 0));
  if (select count(*) from audit.log l
      where l.action = 'limit.prompt_shown' and l.actor_id = v_uid and l.created_at > now() - interval '1 hour')
     >= coalesce(v_user_max, 0)
     or (select count(*) from audit.log l
         where l.entity_id = p_org::text and l.action = 'limit.prompt_shown' and l.metadata ->> 'limit_key' = p_limit_key
           and l.created_at > now() - interval '1 hour')
     >= coalesce(v_key_max, 0)
     or (p_limit_key = 'active_requirements' and exists (
       select 1 from audit.log l
       where l.action = 'limit.prompt_shown' and l.actor_id = v_uid and l.metadata ->> 'limit_key' = 'active_requirements'
         and l.created_at > now() - interval '1 hour'
     )) then
    return;
  end if;

  v_used := private.limit_usage(p_org, p_limit_key);
  begin
    perform private.assert_within_limit(p_org, p_limit_key, v_used);
    return;
  exception
    when raise_exception then null;
    when insufficient_privilege then return;
  end;

  perform audit.record(
    'limit.prompt_shown', 'organization', p_org::text,
    jsonb_build_object(
      'limit_key', p_limit_key, 'plan_code', private.org_plan_code(p_org),
      'limit', private.org_limit(p_org, p_limit_key), 'used', v_used
    )
  );
end;
$$;

-- private.pause_requirements_on_lapse of 20261217100000_requirement_limits.sql with one addition: the advisory lock of
-- private.requirements_enforce_limits is taken first (the same key), so a lapse and a publish or reopen of the same
-- organisation run one after the other and the pause counts what the other committed.
create or replace function private.pause_requirements_on_lapse(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('active_requirements:' || p_org::text, 0));
  v_limit := private.org_limit(p_org, 'active_requirements');
  if v_limit is null then
    return;
  end if;
  perform set_config('chara.actor_fn', 'pause_requirements_on_lapse', true);
  update public.workforce_requirements r
  set status = 'paused', updated_at = clock_timestamp()
  where r.id in (
    select x.id from public.workforce_requirements x
    where x.organization_id = p_org and x.status = 'open'
    order by x.published_at, x.id
    offset v_limit
  );
  perform set_config('chara.actor_fn', '', true);
end;
$$;

-- public.org_usage of 20261217100000_requirement_limits.sql with one change: release 2b opens it for employers only.
create or replace function public.org_usage(p_org uuid, p_keys text[] default null)
returns table (
  limit_key text, used integer, limit_value integer, applies boolean, period_resets_at timestamptz, plan_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_applies boolean;
  v_plan_name text;
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not (private.release_on('release_partner_directories')
          or (private.release_on('release_job_orders') and private.org_type(p_org) = 'employer')) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;

  v_applies := coalesce((select (s.value #>> '{}')::boolean from private.settings s where s.key = 'entitlements_enforced'), false)
    or private.free_plan_restricted(p_org);
  v_plan_name := (select p.name from billing.plans p where p.code = private.org_plan_code(p_org));

  return query
  select
    k.key,
    private.limit_usage(p_org, k.key),
    private.org_limit(p_org, k.key),
    v_applies,
    case when l.period = 'month' then private.month_start(private.month_start() + interval '32 days') end,
    v_plan_name
  from private.org_usage_keys(p_org) k (key)
  join billing.limit_keys l on l.key = k.key
  where p_keys is null or k.key = any (p_keys)
  order by k.key;
end;
$$;
