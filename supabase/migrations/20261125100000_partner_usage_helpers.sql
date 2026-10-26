-- Usage against the plan limits (FR-R1; docs/phase-2/DATA_MODEL.md sections 2, 4 and 8, release 2a). One place counts
-- what each limit key of billing.limit_keys counts, so the member read of usage (org_usage), the billing page
-- (billing_usage) and the upgrade prompt event (record_limit_prompt) say the same as the checks that refuse a change.
-- Monthly keys count rows created since the first day of the calendar month in UTC. The limit checks themselves stay
-- where V06, V07 and V12 put them (in the same transaction as the change, NFR-A4).

insert into private.settings (key, value) values ('limit_prompt_per_org_key_hour_max', '10') on conflict (key) do nothing;

-- The start of the calendar month in UTC that contains p_at; the next month starts one month later.
create function private.month_start(p_at timestamptz default now()) returns timestamptz
language sql
immutable
parallel safe
set search_path = ''
as $$ select date_trunc('month', p_at at time zone 'UTC') at time zone 'UTC' $$;

revoke all on function private.month_start(timestamptz) from public, anon, authenticated, service_role;

-- The rows a monthly key counts in the current month. The tables do not exist yet: partner responses arrive with V44,
-- candidate submissions with V48 and messages with V66, and each of those units replaces this function to count its
-- rows with created_at >= private.month_start(). Until then no row can exist, so the count is 0. A key that is not
-- monthly is refused, so a caller cannot mistake a missing count for an empty month.
create function private.monthly_usage(p_org uuid, p_limit_key text) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from billing.limit_keys k where k.key = p_limit_key and k.period = 'month') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'limit_key', errcode = '22023';
  end if;
  return 0;
end;
$$;

revoke all on function private.monthly_usage(uuid, text) from public, anon, authenticated, service_role;

-- The limit keys that apply to the organisation as a whole, for its type. partner_invitations_per_requirement is counted
-- per requirement, not per organisation, and partner plans carry active_jobs 0 only because vacancies are an employer
-- function, so neither is usage of a partner.
create function private.org_usage_keys(p_org uuid) returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select k.key
  from billing.limit_keys k
  join public.organizations o on o.id = p_org
  where o.type = any (k.org_types)
    and k.key <> 'partner_invitations_per_requirement'
    and (k.key <> 'active_jobs' or o.type = 'employer')
  order by k.key
$$;

revoke all on function private.org_usage_keys(uuid) from public, anon, authenticated, service_role;

-- What one limit key counts now, as the check that refuses the next change counts it: open vacancies as the vacancy
-- trigger (status open, not deleted), members as private.team_size (accepted members and invitations that can still be
-- accepted), served countries only (source countries are not limited), every listed occupation, every availability
-- listing. Active requirements arrive with V32 and count 0 until then. Monthly keys go to private.monthly_usage, which
-- refuses any other key. One statement per key, so a count locks and waits for its own table only.
create function private.limit_usage(p_org uuid, p_limit_key text) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit_key = 'active_jobs' then
    return (select count(*)::integer from public.jobs j
            where j.organization_id = p_org and j.status = 'open' and j.deleted_at is null);
  elsif p_limit_key = 'members' then
    return private.team_size(p_org);
  elsif p_limit_key = 'markets' then
    return (select count(*)::integer from public.organization_geographies g
            where g.organization_id = p_org and g.scope = 'serves_market');
  elsif p_limit_key = 'listed_occupations' then
    return (select count(*)::integer from public.organization_occupations o where o.organization_id = p_org);
  elsif p_limit_key = 'workforce_listings' then
    return (select count(*)::integer from public.workforce_availability w where w.organization_id = p_org);
  elsif p_limit_key = 'active_requirements' then
    return 0;
  end if;
  return private.monthly_usage(p_org, p_limit_key);
end;
$$;

revoke all on function private.limit_usage(uuid, text) from public, anon, authenticated, service_role;

-- Usage and limits for every accepted member of an organisation, without aal2: the profile forms say "2 of 3 countries
-- served" and the upgrade prompt names the plan and the reset date. limit_value is the limit of the plan (an override
-- wins; null is unlimited; an unknown plan reads 0) whether or not it is enforced; applies says whether the database
-- refuses the next change at the limit (entitlements_enforced, or the organisation lapsed to its free plan).
-- period_resets_at is the start of the next calendar month in UTC for monthly keys, null for the others. p_keys narrows
-- the keys (null for all), so a page section counts only its own table. Members of another organisation, workers, staff
-- who are not members and anonymous callers are refused (NFR-S8). Release 2a only.
create function public.org_usage(p_org uuid, p_keys text[] default null)
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
  if not private.release_on('release_partner_directories') then
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
    case when l.period = 'month' then private.month_start() + interval '1 month' end,
    v_plan_name
  from private.org_usage_keys(p_org) k (key)
  join billing.limit_keys l on l.key = k.key
  where p_keys is null or k.key = any (p_keys)
  order by k.key;
end;
$$;

revoke all on function public.org_usage(uuid, text[]) from public, anon, authenticated, service_role;
grant execute on function public.org_usage(uuid, text[]) to authenticated;

-- The billing page reads the same keys and counts, still for owners and admins at aal2 only (the gate of the portal).
-- The keys follow the organisation's type: an employer gets the Phase 2 employer keys as well, a partner its own.
create or replace function public.billing_usage(p_org uuid) returns table (limit_key text, used integer, limit_value integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  perform private.assert_billing_manager(p_org);

  return query
  select k.key, private.limit_usage(p_org, k.key), private.org_limit(p_org, k.key)
  from private.org_usage_keys(p_org) k (key)
  order by k.key;
end;
$$;

-- The KPI "limit prompts leading to upgrades" needs every prompt shown, and a refusal rolls its own audit row back, so the
-- web reports each prompt here. The facts are re-derived: one row only when the organisation really is at the limit of
-- that key (and the limit applies), only from an owner or admin, at most limit_prompt_per_hour_max per user and
-- limit_prompt_per_org_key_hour_max per organisation and key in an hour, so the append-only log cannot be filled through
-- it. Calls for one organisation and key are serialised so two at once cannot both pass a ceiling. A key that does not
-- apply to the organisation's type is refused; a partner organisation needs release 2a. Beyond a ceiling, below the
-- limit or with an unknown plan the call does nothing.
create function public.record_limit_prompt(p_org uuid, p_limit_key text) returns void
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
     >= coalesce(v_key_max, 0) then
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

revoke all on function public.record_limit_prompt(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.record_limit_prompt(uuid, text) to authenticated;

-- The vacancy pages of Phase 1 call the old name; it is the open-vacancy case of the general function. Vacancies are an
-- employer function, so for another type there is no prompt to record and the call does nothing, as before.
create or replace function public.record_job_limit_prompt(p_org uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if private.org_type(p_org) = 'employer' then
    perform public.record_limit_prompt(p_org, 'active_jobs');
  end if;
end;
$$;
