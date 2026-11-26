-- A recruitment company also names a current licence before staff review it: placing workers with employers needs one
-- in most source and destination countries (in Pakistan the Overseas Employment Promoter licence of the Bureau of
-- Emigration, in the Philippines the DMW licence, in India registration on eMigrate). Until now only a staffing company
-- had to. The workforce listing stays a staffing requirement: a recruitment company's recruiting capacity is optional.
create or replace function private.partner_profile_missing(p_org uuid) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when o.legal_entity_identifier is null then 'legal_entity_identifier'
    when not exists (
      select 1 from public.organization_geographies g where g.organization_id = o.id and g.scope = 'sources_from'
    ) then 'sources_from'
    when not exists (
      select 1 from public.organization_geographies g where g.organization_id = o.id and g.scope = 'serves_market'
    ) then 'serves_market'
    when not exists (select 1 from public.organization_occupations c where c.organization_id = o.id) then 'occupations'
    when o.recruitment_type is null then 'recruitment_type'
    -- A staffing company names a staffing type; a recruitment company that adds the service staffing names one too.
    when (o.type = 'staffing_company' or exists (
      select 1 from public.organization_service_types s where s.organization_id = o.id and s.service = 'staffing'
    )) and not exists (
      select 1 from public.organization_service_types s where s.organization_id = o.id and s.service <> 'staffing'
    ) then 'staffing_types'
    when not private.partner_commitment_current(o.id) then 'employer_pays_commitment'
    when not exists (
      select 1 from public.partner_licences l
      where l.organization_id = o.id and l.status = 'current' and l.valid_until >= (now() at time zone 'utc')::date
    ) then 'agency_licence'
    when o.type = 'staffing_company' and not exists (
      select 1 from public.workforce_availability w where w.organization_id = o.id
    ) then 'workforce_listing'
  end
  from public.organizations o
  where o.id = p_org
$$;
