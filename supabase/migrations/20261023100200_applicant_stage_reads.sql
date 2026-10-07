-- What the employer's applicant page needs to move an application (FR-D2): the application with the plan facts that
-- decide what to offer, and its history. The full applicant view (snapshot, documents, notes) is FR-E2, and the
-- employer's row-level read of the tables is FR-D5; both stay out of this migration. Both functions return no row for an
-- application the caller cannot see, whatever the reason, so the page answers it as it answers an unknown id.

-- organization_id lets the page refuse an application that is not of the organisation in its address. stage_change_blocked
-- is null when the caller may change the stage, organization_suspended or read_only_free_plan otherwise (the same refusals
-- set_application_status gives). applicant_name is the name in the snapshot, null once the candidate has been erased.
-- note_max_chars is the limit set_application_status enforces, for the form to quote.
create function public.get_applicant(p_application_id uuid) returns table (
  id uuid,
  organization_id uuid,
  job_id uuid,
  job_title text,
  applicant_name text,
  status public.application_status,
  applied_at timestamptz,
  shortlisting_available boolean,
  stage_change_blocked text,
  note_max_chars integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  return query
  select
    a.id, a.organization_id, a.job_id, j.title,
    nullif(btrim(concat_ws(' ', a.profile_snapshot ->> 'first_name', a.profile_snapshot ->> 'last_name')), ''),
    a.status, a.created_at,
    private.has_feature(a.organization_id, 'shortlisting'),
    case
      when o.status <> 'active' then 'organization_suspended'
      when private.free_plan_restricted(a.organization_id) then 'read_only_free_plan'
    end,
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'application_status_note_max_chars')
  from public.job_applications a
  join public.jobs j on j.id = a.job_id
  join public.organizations o on o.id = a.organization_id
  where a.id = p_application_id and a.organization_id in (select private.member_org_ids());
end;
$$;

revoke all on function public.get_applicant(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_applicant(uuid) to authenticated;

-- The events of one application, oldest first. actor_kind is candidate, employer or system; actor_name is the display
-- name of the employer member (null when the member set none), never an id or an address.
create function public.list_applicant_events(p_application_id uuid) returns table (
  id bigint,
  from_status public.application_status,
  to_status public.application_status,
  actor_kind text,
  actor_name text,
  note text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  return query
  select
    e.id, e.from_status, e.to_status,
    case when e.actor_id is null then 'system' when e.actor_id = a.worker_user_id then 'candidate' else 'employer' end,
    case when e.actor_id is distinct from a.worker_user_id then p.display_name end,
    e.note, e.created_at
  from public.job_applications a
  join public.application_events e on e.application_id = a.id
  left join public.profiles p on p.id = e.actor_id
  where a.id = p_application_id and a.organization_id in (select private.member_org_ids())
  order by e.created_at, e.id
  limit 100;
end;
$$;

revoke all on function public.list_applicant_events(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_applicant_events(uuid) to authenticated;
