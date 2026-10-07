-- Journey tracker (FR-D3; ARCHITECTURE.md section 4; OPEN_QUESTIONS.md D54). The candidate's list of applications and the
-- timeline of one application, without any employer identity. my_applications replaces list_my_applications (FR-D1): it
-- filters by stage, orders by the latest event and returns what the list shows for a vacancy that has left the public
-- site. v_my_application_timeline is the candidate's reading of application_events: the grant on the table leaves out
-- actor_id, so the actor is told as you, employer or system by a helper that reads the id for the caller's own events only.

drop function public.list_my_applications(text, integer);

create function private.application_event_actor_role(p_event_id bigint) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when e.actor_id is null then 'system'
    when e.actor_id = a.worker_user_id then 'you'
    else 'employer'
  end
  from public.application_events e
  join public.job_applications a on a.id = e.application_id
  where e.id = p_event_id and a.worker_user_id = (select auth.uid())
$$;

revoke all on function private.application_event_actor_role(bigint) from public, anon, authenticated, service_role;
grant execute on function private.application_event_actor_role(bigint) to authenticated;

-- The row policy of application_events limits the rows to the caller's own applications. The view has no id and no user id:
-- the events of one application are read by application_id and ordered by created_at.
create view public.v_my_application_timeline with (security_invoker = true) as
select
  e.application_id,
  e.created_at,
  e.from_status,
  e.to_status,
  e.note,
  private.application_event_actor_role(e.id) as actor_role
from public.application_events e;

revoke all on public.v_my_application_timeline from public, anon, authenticated, service_role;
grant select on public.v_my_application_timeline to authenticated;

-- The candidate's applications, one page: a security_invoker view over public.jobs would hide a Paused, Closed, hidden or
-- suspended vacancy from the candidate, so the function reads it as the owner and returns only the columns the list shows.
-- p_stage null means every stage. The newest latest event comes first; equal times are ordered by the newer application,
-- then by id. p_limit is 20 when null and at most 50. Errors: CHARA_FORBIDDEN (not a candidate), CHARA_INVALID_INPUT
-- (detail p_offset).
create function public.my_applications(
  p_stage public.application_status default null, p_limit integer default null, p_offset integer default null
) returns table (
  id uuid,
  job_title text,
  employer_display_name text,
  job_status public.job_status,
  moderation_state public.job_moderation_state,
  status public.application_status,
  applied_at timestamptz,
  last_event_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := coalesce(p_offset, 0);
begin
  if v_uid is null or private.account_kind() is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if v_offset < 0 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_offset';
  end if;

  return query
  select a.id, j.title, o.display_name, j.status, j.moderation_state, a.status, a.created_at, last.at
  from public.job_applications a
  join public.jobs j on j.id = a.job_id
  join public.organizations o on o.id = j.organization_id
  cross join lateral (select max(e.created_at) as at from public.application_events e where e.application_id = a.id) last
  where a.worker_user_id = v_uid and (p_stage is null or a.status = p_stage)
  order by last.at desc, a.created_at desc, a.id desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.my_applications(public.application_status, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.my_applications(public.application_status, integer, integer) to authenticated;
