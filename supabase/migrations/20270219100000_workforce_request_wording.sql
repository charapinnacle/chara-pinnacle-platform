-- The message a workforce request writes said "in Bremen, DE, from 2027-04-01" next to a card that reads "Germany" and
-- "From 1 April 2027". public.request_workforce of 20270211100000_connection_actions.sql with one change: the
-- country's name and the date as the card writes it. Grants and the revoke are kept by create or replace.

create or replace function public.request_workforce(
  p_org uuid, p_partner uuid, p_occupation text, p_quantity integer, p_destination text, p_start_date date,
  p_city_region text, p_body text default null, p_industry text default null,
  p_employment_type public.employment_type default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.connection_caller();
  v_org public.organizations;
  v_partner public.organizations;
  v_body text;
  v_city text := btrim(coalesce(p_city_region, ''));
  v_destination text := upper(btrim(p_destination));
  v_industry text;
  v_requirement uuid;
  v_invitation uuid;
  v_conversation uuid;
  v_id uuid;
  v_label text;
  v_day_max integer := private.connection_setting('partner_invitations_per_day_max');
begin
  if not private.release_on('release_job_orders') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_org := private.assert_connection_employer(p_org);
  perform private.assert_org_manager(p_org, 'admin');
  v_partner := private.assert_connection_partner(p_partner);
  if v_partner.type = 'recruitment_company' and not exists (
    select 1 from public.organization_service_types s where s.organization_id = p_partner and s.service = 'staffing'
  ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'not_staffing', errcode = '22023';
  end if;

  if p_quantity is null or p_quantity not between 1 and 10000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_quantity', errcode = '22023';
  end if;
  select o.label into v_label from public.occupations o where o.code = p_occupation;
  if not found then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_occupation', errcode = '22023';
  end if;
  if not exists (select 1 from public.countries c where c.code = v_destination) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_destination', errcode = '22023';
  end if;
  if p_start_date is null or p_start_date < (now() at time zone 'utc')::date then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_start_date', errcode = '22023';
  end if;
  if char_length(v_city) not between 1 and 100 or v_city ~ '[[:cntrl:]]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_city_region', errcode = '22023';
  end if;
  v_industry := coalesce(p_industry, v_org.industry_code);
  if v_industry is null or not exists (select 1 from public.industries i where i.code = v_industry) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_industry', errcode = '22023';
  end if;
  v_body := coalesce(
    private.connection_body(p_body, 0, 2000),
    format('Workforce request: %s × %s in %s, %s, from %s.', p_quantity, v_label, v_city,
      (select c.name from public.countries c where c.code = v_destination), to_char(p_start_date, 'FMDD FMMonth YYYY')));

  v_requirement := public.save_requirement(
    p_org, p_quantity, v_destination, v_city, v_industry,
    jsonb_build_array(jsonb_build_object('occupation_id', p_occupation, 'quantity', p_quantity)),
    p_start_date, coalesce(p_employment_type, 'temporary'), 'both', 'staffing', false, false, false);

  perform pg_advisory_xact_lock(hashtextextended('partner_invitations:' || p_org::text, 0));
  perform private.assert_within_limit(p_org, 'partner_invitations_per_requirement', 0);
  if (select count(*) from public.requirement_invitations i
      where i.employer_organization_id = p_org and i.invited_at > now() - interval '24 hours') >= v_day_max then
    raise exception 'CHARA_RATE_LIMITED' using detail = 'partner_invitations_per_day';
  end if;
  insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source, invited_by)
  values (v_requirement, p_partner, p_org, 'profile', v_uid)
  returning id into v_invitation;
  perform audit.record('requirement.invitation_sent', 'requirement_invitation', v_invitation::text,
    jsonb_build_object('requirement_id', v_requirement, 'organization_id', p_partner, 'employer_organization_id', p_org,
      'source', 'profile'));
  perform private.record_requirement_reveal(v_requirement, p_partner, 'invitation');

  perform private.lock_organization_messages(p_org);
  v_conversation := private.open_organization_conversation('requirement_invitation', v_invitation, v_requirement, p_org,
    p_partner);
  insert into public.connections (kind, from_organization_id, to_organization_id, conversation_id, requirement_id, created_by)
  values ('request_workforce', p_org, p_partner, v_conversation, v_requirement, v_uid)
  returning id into v_id;
  perform private.write_typed_message(v_conversation, p_org, 'request_workforce', v_body, v_id);
  perform audit.record('connection.created', 'connection', v_id::text, jsonb_build_object(
    'kind', 'request_workforce', 'organization_id', p_org, 'to_organization_id', p_partner,
    'conversation_id', v_conversation, 'requirement_id', v_requirement));
  perform private.queue_org_event(p_partner, 'workforce_request_received', jsonb_build_object('connection_id', v_id),
    'workforce_request_received:' || v_id);
  return v_conversation;
end;
$$;
