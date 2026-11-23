-- What sets a recruitment company apart from a staffing company (research of November 2026). A recruitment company finds
-- candidates whom the employer hires onto its own payroll; it is paid once per hire and guarantees the hire for a period.
-- A staffing company keeps the workers on its own payroll and leases them for an assignment; it is paid per hour or month
-- worked. A recruitment company that also supplies staff (service 'staffing') does both.

-- 'recruitment', 'staffing' or 'both' for a partner organisation; null for any other.
create function private.partner_kind(p_org uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when o.type = 'staffing_company' then 'staffing'
    when o.type <> 'recruitment_company' then null
    when exists (
      select 1 from public.organization_service_types s where s.organization_id = o.id and s.service = 'staffing'
    ) then 'both'
    else 'recruitment'
  end
  from public.organizations o
  where o.id = p_org
$$;

revoke all on function private.partner_kind(uuid) from public, anon, authenticated, service_role;

-- The fee models a kind of partner may quote: a placement fee for recruitment, a rate for staffing, on request for both.
create function private.partner_fee_models(p_kind text) returns public.fee_model[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'recruitment' then array['fee_per_hire', 'percent_first_year_salary', 'on_request']::public.fee_model[]
    when 'staffing' then array['hourly_rate', 'monthly_rate', 'on_request']::public.fee_model[]
    else enum_range(null::public.fee_model)
  end
$$;

revoke all on function private.partner_fee_models(text) from public, anon, authenticated, service_role;

create function private.partner_responses_fee_for_kind() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.fee_model = any (private.partner_fee_models(private.partner_kind(new.organization_id))) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'fee_model_for_kind';
  end if;
  return new;
end;
$$;

revoke all on function private.partner_responses_fee_for_kind() from public, anon, authenticated, service_role;

create trigger partner_responses_fee_for_kind
  before insert or update of fee_model on public.partner_responses
  for each row execute function private.partner_responses_fee_for_kind();

-- A permanent hire is recruitment, so it is no longer a staffing type; recruitment_type says whom a company recruits.
alter table public.organization_service_types
  add constraint organization_service_types_not_permanent check (service <> 'permanent');

-- The terms a kind of partner must give: a guarantee period with a placement fee, the length of the assignment with a
-- rate. On request asks for the one of the partner's kind, and nothing of a company that does both.
alter table public.response_terms
  add column assignment_weeks smallint check (assignment_weeks between 1 and 260);

create function private.response_terms_needed(p_kind text, p_fee public.fee_model) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_fee in ('fee_per_hire', 'percent_first_year_salary') then 'guarantee_days'
    when p_fee in ('hourly_rate', 'monthly_rate') then 'assignment_weeks'
    when p_kind = 'recruitment' then 'guarantee_days'
    when p_kind = 'staffing' then 'assignment_weeks'
  end
$$;

revoke all on function private.response_terms_needed(text, public.fee_model) from public, anon, authenticated, service_role;

drop function public.set_response_terms(uuid, uuid, text, text, integer, text, text[], integer, integer);

create function public.set_response_terms(
  p_org uuid,
  p_response uuid,
  p_language_code text default null,
  p_language_level text default null,
  p_min_experience_years integer default null,
  p_certificates text default null,
  p_fee_includes text[] default '{}',
  p_guarantee_days integer default null,
  p_lead_time_weeks integer default null,
  p_assignment_weeks integer default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response public.partner_responses;
  v_certificates text := nullif(btrim(p_certificates), '');
  v_needed text;
begin
  perform private.assert_responding_partner(p_org);
  select * into v_response from public.partner_responses p where p.id = p_response and p.organization_id = p_org for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_response.moderation_state = 'hidden' then
    raise exception 'CHARA_INVALID_STATE' using detail = 'hidden';
  end if;
  if v_response.status not in ('submitted', 'updated') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_response.status::text;
  end if;
  if exists (
    select 1 from public.workforce_requirements r where r.id = v_response.requirement_id and r.status in ('closed', 'filled')
  ) then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_closed';
  end if;
  v_needed := private.response_terms_needed(private.partner_kind(p_org), v_response.fee_model);
  if (v_needed = 'guarantee_days' and p_guarantee_days is null) or (v_needed = 'assignment_weeks' and p_assignment_weeks is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = v_needed;
  end if;

  begin
    insert into public.response_terms (
      response_id, language_code, language_level, min_experience_years, certificates, fee_includes, guarantee_days,
      lead_time_weeks, assignment_weeks
    ) values (
      p_response, nullif(lower(btrim(p_language_code)), ''), nullif(upper(btrim(p_language_level)), ''), p_min_experience_years,
      v_certificates, (select coalesce(array_agg(distinct i order by i), '{}') from unnest(coalesce(p_fee_includes, '{}')) i),
      p_guarantee_days, p_lead_time_weeks, p_assignment_weeks
    )
    on conflict (response_id) do update
    set language_code = excluded.language_code, language_level = excluded.language_level,
        min_experience_years = excluded.min_experience_years, certificates = excluded.certificates,
        fee_includes = excluded.fee_includes, guarantee_days = excluded.guarantee_days,
        lead_time_weeks = excluded.lead_time_weeks, assignment_weeks = excluded.assignment_weeks, updated_at = now();
  exception
    when check_violation or foreign_key_violation then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'response_terms';
  end;
end;
$$;

revoke all on function public.set_response_terms(uuid, uuid, text, text, integer, text, text[], integer, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.set_response_terms(uuid, uuid, text, text, integer, text, text[], integer, integer, integer)
  to authenticated;
