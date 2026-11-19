-- The upgrade prompt of the invitation limit (FR-O1 AC12; FR-R1 KPI limit prompts leading to upgrades; release 2b). The
-- invitation pages of V42 show the upgrade prompt of V13 when an employer reaches partner_invitations_per_requirement on
-- one requirement, or tries to invite more partners than it has left. public.record_limit_prompt records only the limits
-- of the organisation as a whole (private.org_usage_keys leaves the per-requirement key out, 20261125100000), so the
-- prompt of this limit is recorded here, for the requirement it was shown on, with the same ceilings and audit action.

-- Records one limit.prompt_shown row for an owner or admin of the employer p_org who was shown the upgrade prompt of the
-- invitation limit on its open requirement p_requirement while trying to invite p_attempted partners (1 to 25; 1 for the
-- prompt of a page at the limit), only when they do not fit: the invitations that are not withdrawn plus p_attempted
-- pass the plan's limit (private.assert_within_limit refuses them). At most one row per user and requirement an hour,
-- within the hourly ceilings of record_limit_prompt (limit_prompt_per_hour_max per user, limit_prompt_per_org_key_hour_max
-- per organisation and key), so reloading a page or retrying does not inflate the KPI. CHARA_FORBIDDEN (42501) for
-- anyone else, a partner (employer_only) and while release_job_orders is off (release_off); no such requirement of
-- p_org, CHARA_NOT_FOUND; p_attempted out of bounds, CHARA_INVALID_INPUT. A requirement that is not open records nothing.
-- Best effort for the page: nothing else is written.
create function public.record_invitation_limit_prompt(p_org uuid, p_requirement uuid, p_attempted integer) returns void
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
  v_status public.requirement_status;
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
  select r.status into v_status from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_attempted is null or p_attempted not between 1 and 25 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_attempted';
  end if;
  if v_status <> 'open' then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('limit_prompt:' || p_org::text || ':' || v_key, 0));
  if (select count(*) from audit.log l
      where l.action = 'limit.prompt_shown' and l.actor_id = v_uid and l.created_at > now() - interval '1 hour')
     >= coalesce(v_user_max, 0)
     or (select count(*) from audit.log l
         where l.entity_id = p_org::text and l.action = 'limit.prompt_shown' and l.metadata ->> 'limit_key' = v_key
           and l.created_at > now() - interval '1 hour')
     >= coalesce(v_key_max, 0)
     or exists (
       select 1 from audit.log l
       where l.action = 'limit.prompt_shown' and l.actor_id = v_uid and l.metadata ->> 'limit_key' = v_key
         and l.metadata ->> 'requirement_id' = p_requirement::text and l.created_at > now() - interval '1 hour'
     ) then
    return;
  end if;

  select count(*)::integer into v_used from public.requirement_invitations i
  where i.requirement_id = p_requirement and i.status <> 'withdrawn';
  begin
    perform private.assert_within_limit(p_org, v_key, v_used + p_attempted - 1);
    return;
  exception
    when raise_exception then null;
    when insufficient_privilege then return;
  end;

  perform audit.record(
    'limit.prompt_shown', 'organization', p_org::text,
    jsonb_build_object(
      'limit_key', v_key, 'plan_code', private.org_plan_code(p_org), 'limit', private.org_limit(p_org, v_key),
      'used', v_used, 'attempted', p_attempted, 'requirement_id', p_requirement
    )
  );
end;
$$;

revoke all on function public.record_invitation_limit_prompt(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.record_invitation_limit_prompt(uuid, uuid, integer) to authenticated;
