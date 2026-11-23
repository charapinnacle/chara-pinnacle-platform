-- What a partner adds to its response so employers compare quotes fairly (research of November 2026): the skills of the
-- workers it offers (a language and its CEFR level, the minimum years of experience, certificates and tests) and the terms
-- of its fee (what the fee includes, the guarantee period, the lead time from selection to arrival). They sit beside the
-- response, not in it: the response keeps its versions and its comparison as they are, and these terms are read by whoever
-- may read the response, through its own policy. All of it is optional.
create table public.response_terms (
  response_id uuid primary key references public.partner_responses (id) on delete cascade,
  language_code text references public.languages (code),
  language_level text check (language_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  min_experience_years smallint check (min_experience_years between 0 and 50),
  certificates text check (char_length(certificates) between 1 and 300 and certificates !~ '[[:cntrl:]]'),
  fee_includes text[] not null default '{}' check (
    fee_includes <@ array['trade_test', 'medical_check', 'visa_and_permit_fees', 'flights', 'first_month_accommodation',
      'pre_departure_training', 'insurance']::text[]
  ),
  guarantee_days smallint check (guarantee_days between 0 and 365),
  lead_time_weeks smallint check (lead_time_weeks between 1 and 104),
  updated_at timestamptz not null default now(),
  constraint response_terms_level_needs_language check (language_level is null or language_code is not null)
);

alter table public.response_terms enable row level security;
alter table public.response_terms force row level security;
revoke all on public.response_terms from public, anon, authenticated, service_role;
grant select on public.response_terms to authenticated;
-- Whoever reads the response reads its terms: the policy of partner_responses applies inside the subquery.
create policy response_terms_select on public.response_terms for select to authenticated
  using (exists (select 1 from public.partner_responses r where r.id = response_terms.response_id));

-- Sets the terms of a live response of the caller's organisation, with the checks of update_response: a responding
-- partner, its own response, not hidden, submitted or updated, on a requirement that is not closed or filled.
create function public.set_response_terms(
  p_org uuid,
  p_response uuid,
  p_language_code text default null,
  p_language_level text default null,
  p_min_experience_years integer default null,
  p_certificates text default null,
  p_fee_includes text[] default '{}',
  p_guarantee_days integer default null,
  p_lead_time_weeks integer default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response public.partner_responses;
  v_certificates text := nullif(btrim(p_certificates), '');
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

  begin
    insert into public.response_terms (
      response_id, language_code, language_level, min_experience_years, certificates, fee_includes, guarantee_days,
      lead_time_weeks
    ) values (
      p_response, nullif(lower(btrim(p_language_code)), ''), nullif(upper(btrim(p_language_level)), ''), p_min_experience_years,
      v_certificates, (select coalesce(array_agg(distinct i order by i), '{}') from unnest(coalesce(p_fee_includes, '{}')) i),
      p_guarantee_days, p_lead_time_weeks
    )
    on conflict (response_id) do update
    set language_code = excluded.language_code, language_level = excluded.language_level,
        min_experience_years = excluded.min_experience_years, certificates = excluded.certificates,
        fee_includes = excluded.fee_includes, guarantee_days = excluded.guarantee_days,
        lead_time_weeks = excluded.lead_time_weeks, updated_at = now();
  exception
    when check_violation or foreign_key_violation then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'response_terms';
  end;
end;
$$;
revoke all on function public.set_response_terms(uuid, uuid, text, text, integer, text, text[], integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.set_response_terms(uuid, uuid, text, text, integer, text, text[], integer, integer)
  to authenticated;
