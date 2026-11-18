-- The billing page says whether a plan limit is enforced (FR-G5, FR-M4, FR-R1; V79 smoke test). Over a limit, the page
-- told the employer that no more requirements could be published or reopened while entitlements_enforced was off and
-- publishing still succeeded. billing_usage now answers, per key, whether the limit applies, as org_usage does
-- (entitlements_enforced, or an organisation restricted to its free plan): the checks that refuse a change
-- (private.assert_within_limit) apply exactly then. Everything else is unchanged.

drop function public.billing_usage(uuid);

create function public.billing_usage(p_org uuid)
returns table (limit_key text, used integer, limit_value integer, applies boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_applies boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  perform private.assert_billing_manager(p_org);
  v_applies := coalesce((select (s.value #>> '{}')::boolean from private.settings s where s.key = 'entitlements_enforced'), false)
    or private.free_plan_restricted(p_org);

  return query
  select k.key, private.limit_usage(p_org, k.key), private.org_limit(p_org, k.key), v_applies
  from private.org_usage_keys(p_org) k (key)
  order by k.key;
end;
$$;

revoke all on function public.billing_usage(uuid) from public, anon, authenticated, service_role;
grant execute on function public.billing_usage(uuid) to authenticated;
