-- The upgrade prompt of the invitation limit (FR-O1 AC12; FR-R1 KPI limit prompts leading to upgrades; release 2b). The
-- invitation pages of V42 show the upgrade prompt of V13 when an employer reaches partner_invitations_per_requirement on
-- one requirement. public.record_limit_prompt records only the limits of the organisation as a whole
-- (private.org_usage_keys leaves the per-requirement key out, 20261125100000), so the prompt of this limit is recorded
-- here, for the requirement it was shown on, with the same ceilings and the same audit action.

-- Records one limit.prompt_shown row for an owner or admin of the employer p_org who was shown the upgrade prompt of the
-- invitation limit on its requirement p_requirement, only when that requirement really is at the limit (the invitations
-- that are not withdrawn, private.assert_within_limit refuses one more) and within the hourly ceilings of
-- record_limit_prompt (limit_prompt_per_hour_max per user, limit_prompt_per_org_key_hour_max per organisation and key).
-- CHARA_FORBIDDEN (42501) for anyone else, a partner (employer_only) and while release_job_orders is off (release_off);
-- no such requirement of p_org, CHARA_NOT_FOUND. Best effort for the page: nothing else is written.
create function public.record_invitation_limit_prompt(p_org uuid, p_requirement uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_key constant text := 'partner_invitations_per_requirement';
  v_user_max integer := (select (s.value #>> '{}')::integer from private.settings s where s.key = 'limit_prompt_per_hour_max');
  v_key_max integer :=
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'limit_prompt_per_org_key_hour_max');
  v_used integer;
begin
  if v_uid is null or not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_job_orders') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if private.org_type(p_org) <> 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'employer_only', errcode = '42501';
  end if;
  if not exists (select 1 from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('limit_prompt:' || p_org::text || ':' || v_key, 0));
  if (select count(*) from audit.log l
      where l.action = 'limit.prompt_shown' and l.actor_id = v_uid and l.created_at > now() - interval '1 hour')
     >= coalesce(v_user_max, 0)
     or (select count(*) from audit.log l
         where l.entity_id = p_org::text and l.action = 'limit.prompt_shown' and l.metadata ->> 'limit_key' = v_key
           and l.created_at > now() - interval '1 hour')
     >= coalesce(v_key_max, 0) then
    return;
  end if;

  select count(*)::integer into v_used from public.requirement_invitations i
  where i.requirement_id = p_requirement and i.status <> 'withdrawn';
  begin
    perform private.assert_within_limit(p_org, v_key, v_used);
    return;
  exception
    when raise_exception then null;
    when insufficient_privilege then return;
  end;

  perform audit.record(
    'limit.prompt_shown', 'organization', p_org::text,
    jsonb_build_object(
      'limit_key', v_key, 'plan_code', private.org_plan_code(p_org), 'limit', private.org_limit(p_org, v_key),
      'used', v_used, 'requirement_id', p_requirement
    )
  );
end;
$$;

revoke all on function public.record_invitation_limit_prompt(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_invitation_limit_prompt(uuid, uuid) to authenticated;
