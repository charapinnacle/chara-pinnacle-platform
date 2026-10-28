-- A fourth source of an invitation: the saved partners of the employer (V42 review, FR-O1 step Select, FR-L4; release
-- 2b). An invitation sent from the saved partners page is stored with source saved, so the KPI of invitations by source
-- tells it apart from the directory and the profile. The check of requirement_invitations.source and the source check of
-- invite_partners (20261226100000) gain the value; nothing else of either changes.

alter table public.requirement_invitations drop constraint requirement_invitations_source_check;
alter table public.requirement_invitations add constraint requirement_invitations_source_check
  check (source in ('suggestions', 'directory', 'profile', 'saved')) not valid;
alter table public.requirement_invitations validate constraint requirement_invitations_source_check;

comment on column public.requirement_invitations.source is
  'Where the employer chose the partner: suggestions (FR-M3), directory (FR-L1, FR-L2), profile (FR-K4) or saved (the saved partners, FR-L4); the KPI invitations from suggestions.';

-- Invites the partners p_partners (1 to 25 distinct ids) to the requirement p_requirement of p_org, chosen in p_source
-- (suggestions, directory, profile or saved) (FR-O1 AC1 to AC6; FR-M3 AC9). For an owner or admin at aal2 of the
-- active employer (private.assert_requirement_manager: CHARA_FORBIDDEN, aal2_required, release_off, employer_only). Refusals, in this
-- order, each writing nothing: p_partners empty, null, repeated or more than 25, CHARA_INVALID_INPUT p_partners; another
-- source, CHARA_INVALID_INPUT p_source; no such requirement of p_org, CHARA_NOT_FOUND; a requirement that is not open
-- (draft, paused, closed, filled), CHARA_INVALID_STATE requirement_not_open; any partner that cannot be invited (not a
-- recruitment or staffing company, not listed, declined, suspended, hidden, unknown), CHARA_INVALID_INPUT
-- partner_unavailable for the whole call, without saying which or why; more invitations than the plan allows for the
-- requirement (those not withdrawn count, the call as a whole), CHARA_LIMIT_REACHED partner_invitations_per_requirement;
-- more than partner_invitations_per_day_max new invitations of the employer in 24 hours, CHARA_RATE_LIMITED
-- partner_invitations_per_day; the daily quota of audited writes, CHARA_RATE_LIMITED.
--
-- A partner already invited to the requirement (in any status) gets no second row: its invitation is returned with
-- already_invited true and nothing is sent again. Each new invitation is one row (invited, invited_by the caller), one
-- audit row requirement.invitation_sent (the invitation, with the requirement and the partner), one reveal of the employer
-- name (cause invitation) and one invitation_received to the partner's owners and admins, all in this transaction. The
-- answer lists every partner of the call with its invitation, in the order given.
create or replace function public.invite_partners(p_org uuid, p_requirement uuid, p_partners uuid[], p_source text)
returns table (invitation_id uuid, organization_id uuid, status public.invitation_status, already_invited boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.workforce_requirements;
  v_new uuid[];
  v_used integer;
  v_day_max integer := coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,6}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'partner_invitations_per_day_max'), 50);
  v_partner uuid;
  v_id uuid;
begin
  perform private.assert_requirement_manager(p_org);

  if p_partners is null or cardinality(p_partners) not between 1 and 25 or array_position(p_partners, null) is not null
     or (select count(distinct x) from unnest(p_partners) x) <> cardinality(p_partners) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_partners';
  end if;
  if p_source is null or p_source not in ('suggestions', 'directory', 'profile', 'saved') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_source';
  end if;

  -- The requirement is held against a close, fill or pause until this transaction ends, so no invitation is written
  -- after the expiry of a close has run.
  select * into v_row from public.workforce_requirements r
  where r.id = p_requirement and r.organization_id = p_org
  for share;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status <> 'open' then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_not_open';
  end if;

  if exists (select 1 from unnest(p_partners) x where not private.invitable_partner(x)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'partner_unavailable';
  end if;

  -- One lock per employer before both counts: a second call of the same employer waits for this one to commit and then
  -- counts its rows; nothing of another employer waits. private.assert_org_manager already holds the employer's row (for
  -- no key update), which serialises the calls of one employer first; this lock states the rule here, so it does not
  -- rest on a side effect of the role check.
  perform pg_advisory_xact_lock(hashtextextended('partner_invitations:' || p_org::text, 0));

  v_new := array(
    select x from unnest(p_partners) with ordinality u (x, n)
    where not exists (
      select 1 from public.requirement_invitations i where i.requirement_id = v_row.id and i.organization_id = u.x)
    order by u.n);

  if cardinality(v_new) > 0 then
    select count(*)::integer into v_used from public.requirement_invitations i
    where i.requirement_id = v_row.id and i.status <> 'withdrawn';
    perform private.assert_within_limit(p_org, 'partner_invitations_per_requirement', v_used + cardinality(v_new) - 1);
    if (select count(*) from public.requirement_invitations i
        where i.employer_organization_id = p_org and i.invited_at > now() - interval '24 hours') + cardinality(v_new) > v_day_max then
      raise exception 'CHARA_RATE_LIMITED' using detail = 'partner_invitations_per_day';
    end if;
    perform private.count_audited_write(p_org);

    foreach v_partner in array v_new loop
      insert into public.requirement_invitations (
        requirement_id, organization_id, employer_organization_id, source, suggestion_criteria, invited_by
      ) values (
        v_row.id, v_partner, p_org, p_source,
        case when p_source = 'suggestions' then coalesce(private.suggestion_criteria(v_row.id, v_partner), '{}') end,
        v_uid
      )
      returning id into v_id;
      perform audit.record('requirement.invitation_sent', 'requirement_invitation', v_id::text,
        jsonb_build_object('requirement_id', v_row.id, 'organization_id', v_partner, 'employer_organization_id', p_org,
          'source', p_source));
      perform private.record_requirement_reveal(v_row.id, v_partner, 'invitation');
      perform private.queue_invitation_event(v_id, 'invitation_received');
    end loop;
  end if;

  return query
  select i.id, i.organization_id, i.status, not (i.organization_id = any (v_new))
  from unnest(p_partners) with ordinality u (x, n)
  join public.requirement_invitations i on i.requirement_id = v_row.id and i.organization_id = u.x
  order by u.n;
end;
$$;

revoke all on function public.invite_partners(uuid, uuid, uuid[], text) from public, anon, authenticated, service_role;
grant execute on function public.invite_partners(uuid, uuid, uuid[], text) to authenticated;
