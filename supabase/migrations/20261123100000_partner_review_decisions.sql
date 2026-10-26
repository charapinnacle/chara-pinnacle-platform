-- Staff review of partners (FR-J4; docs/phase-2/DATA_MODEL.md sections 4, 5, 6 Release 2a and 7; decisions 2.5, 7.2;
-- NFR-C7). A recruitment or staffing company that was submitted for review (V09) waits in the queue "Partners to review",
-- oldest first, with the time its review is due (the setting partner_review_target_working_days, in working days). A
-- Trust & Safety Administrator at aal2 approves it, asks for more information about one onboarding step or declines it,
-- always with a statement of reasons of 10 to 2,000 characters, never for an organisation they belong to; a Verification
-- Reviewer and a Platform Administrator read the queue and the review page only. Each decision is one row of the
-- append-only public.partner_review_decisions and one audit row partner.review_decided. The first approval sets listed_at,
-- which makes the partner listed (private.is_listed_partner); a decline takes it out of the directories; a request for
-- information reopens the step it names, and the partner stays listed meanwhile when it was listed before (re-review).
--
-- The partner is told by email once V14 adds the kinds partner_approved, partner_info_requested and partner_declined and
-- their templates (DATA_MODEL.md section 9): admin_decide_partner queues nothing until then. Members read the outcome and,
-- for a request for information or a decline, the reason on their dashboard and the Ready step through
-- partner_review_outcome. Everything here belongs to release 2a and is refused while release_partner_directories is false.

create table public.partner_review_decisions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id),
  decision text not null check (decision in ('approve', 'request_info', 'decline')),
  reason text not null check (char_length(reason) between 10 and 2000 and reason = btrim(reason, E' \t\r\n')),
  info_step text check (info_step in ('company', 'where_you_serve', 'commitments')),
  from_status public.partner_review_status not null check (from_status in ('pending_review', 're_review')),
  to_status public.partner_review_status not null check (to_status in ('listed', 'info_requested', 'declined')),
  -- The time the decided submission joined the queue: decided_at minus this is the time to decision (SOP KPI).
  submitted_at timestamptz not null,
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  check ((decision = 'request_info') = (info_step is not null)),
  check (to_status = case decision when 'approve' then 'listed'::public.partner_review_status
    when 'request_info' then 'info_requested'::public.partner_review_status else 'declined'::public.partner_review_status end)
);

comment on table public.partner_review_decisions is
  'Append-only record of the staff decisions on partners (FR-J4), with the statement of reasons. Written only by admin_decide_partner; read by staff through admin_get_partner_review and by members through partner_review_outcome. decided_by has no foreign key: the record outlives an erased account.';

create index partner_review_decisions_org_idx on public.partner_review_decisions (organization_id, id desc);
create index partner_review_decisions_decided_by_idx on public.partner_review_decisions (decided_by);
create index partner_review_decisions_decided_at_idx on public.partner_review_decisions (decided_at);

alter table public.partner_review_decisions enable row level security;
alter table public.partner_review_decisions force row level security;
revoke all on table public.partner_review_decisions from public, anon, authenticated, service_role;

create trigger partner_review_decisions_append_only
  before update or delete on public.partner_review_decisions
  for each row execute function private.refuse_change();

create trigger partner_review_decisions_no_truncate
  before truncate on public.partner_review_decisions
  for each statement execute function private.refuse_change();

alter table public.partner_review_decisions enable always trigger partner_review_decisions_append_only;
alter table public.partner_review_decisions enable always trigger partner_review_decisions_no_truncate;

-- The queue reads the partners waiting for a decision in the order they joined it.
create index organizations_review_queue_idx on public.organizations (submitted_at, id)
  where review_status in ('pending_review', 're_review');

-- Working days ----------------------------------------------------------------------------------------------------------

-- p_from plus p_days working days, Monday to Friday in Europe/Berlin, at the same local time; no holiday calendar
-- (DATA_MODEL.md section 4, the due time of reports). A start on a weekend counts from the Monday after it.
create function private.add_working_days(p_from timestamptz, p_days integer) returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_from at time zone 'Europe/Berlin';
  v_left integer := greatest(coalesce(p_days, 0), 0);
begin
  while extract(isodow from v_local) > 5 loop
    v_local := date_trunc('day', v_local) + interval '1 day';
  end loop;
  while v_left > 0 loop
    v_local := v_local + interval '1 day';
    if extract(isodow from v_local) <= 5 then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_local at time zone 'Europe/Berlin';
end;
$$;

revoke all on function private.add_working_days(timestamptz, integer) from public, anon, authenticated, service_role;

-- The review target of decision 7.2, one working day unless the setting says otherwise.
create function private.partner_review_target_days() returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,2}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'partner_review_target_working_days'),
    1
  )
$$;

revoke all on function private.partner_review_target_days() from public, anon, authenticated, service_role;

-- Queue -----------------------------------------------------------------------------------------------------------------

-- The partners waiting for a decision (pending_review and re_review), oldest submission first, a page after the cursor
-- (submitted_at, id) of the last row shown. Trust & Safety, Verification Reviewer or Platform Administrator at aal2. The
-- only personal data is the owner's email; same_identifier says that another organisation names the same identifier,
-- without naming it.
create function public.admin_list_partner_reviews(
  p_limit integer default 25, p_after_at timestamptz default null, p_after_id uuid default null
) returns table (
  id uuid,
  legal_name text,
  display_name text,
  type public.organization_type,
  based_in_country text,
  legal_entity_identifier text,
  legal_entity_identifier_kind text,
  website text,
  review_status public.partner_review_status,
  submitted_at timestamptz,
  due_at timestamptz,
  same_identifier boolean,
  owner_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_days integer;
begin
  perform private.assert_staff(array['trust_safety', 'verification_reviewer', 'admin']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if (p_after_at is null) <> (p_after_id is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'cursor';
  end if;
  v_days := private.partner_review_target_days();

  return query
  select o.id, o.legal_name, o.display_name, o.type, o.based_in_country, o.legal_entity_identifier,
    o.legal_entity_identifier_kind, o.website, o.review_status, o.submitted_at,
    private.add_working_days(o.submitted_at, v_days),
    exists (
      select 1 from private.organization_identifier_links l where l.organization_id = o.id or l.other_organization_id = o.id
    ),
    (select u.email::text from public.organization_members m join auth.users u on u.id = m.user_id
     where m.organization_id = o.id and m.role = 'owner')
  from public.organizations o
  where o.review_status in ('pending_review', 're_review')
    and (p_after_at is null or (o.submitted_at, o.id) > (p_after_at, p_after_id))
  order by o.submitted_at, o.id
  limit v_limit;
end;
$$;

revoke all on function public.admin_list_partner_reviews(integer, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_partner_reviews(integer, timestamptz, uuid) to authenticated;

-- Review page -----------------------------------------------------------------------------------------------------------

-- What staff check about one partner, in any review state (AC2): the company details and identifier, the organisations
-- that name the same identifier (staff only, with the same-type flag; a link is stored once, from the organisation that
-- named the identifier last, so both directions are read), where it serves, what it offers, whether its owner
-- holds the current employer-pays commitment and the decisions so far with their reasons. The licences come from
-- admin_list_partner_licences. No worker data and no member contact details other than the owner's email; the staff
-- member of a decision is named by email for traceability, to staff only. CHARA_NOT_FOUND for an unknown organisation or
-- an employer.
create function public.admin_get_partner_review(p_org uuid) returns table (
  id uuid,
  legal_name text,
  display_name text,
  type public.organization_type,
  status public.organization_status,
  based_in_country text,
  industry_code text,
  website text,
  description text,
  legal_entity_identifier text,
  legal_entity_identifier_kind text,
  recruitment_type public.recruitment_preference,
  founded_year smallint,
  workforce_size_band public.workforce_size_band,
  review_status public.partner_review_status,
  submitted_at timestamptz,
  due_at timestamptz,
  listed_at timestamptz,
  info_step text,
  created_at timestamptz,
  owner_email text,
  identifier_links jsonb,
  geographies jsonb,
  occupations jsonb,
  industries jsonb,
  languages jsonb,
  service_types jsonb,
  commitment jsonb,
  decisions jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_version integer := private.current_legal_version('employer-pays-commitment');
begin
  perform private.assert_staff(array['trust_safety', 'verification_reviewer', 'admin']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if not exists (
    select 1 from public.organizations o where o.id = p_org and o.type in ('recruitment_company', 'staffing_company')
  ) then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select o.id, o.legal_name, o.display_name, o.type, o.status, o.based_in_country, o.industry_code, o.website,
    o.description, o.legal_entity_identifier, o.legal_entity_identifier_kind, o.recruitment_type, o.founded_year,
    o.workforce_size_band, o.review_status, o.submitted_at,
    case when o.review_status in ('pending_review', 're_review')
      then private.add_working_days(o.submitted_at, private.partner_review_target_days()) end,
    o.listed_at, o.info_step, o.created_at,
    (select u.email::text from public.organization_members m join auth.users u on u.id = m.user_id
     where m.organization_id = o.id and m.role = 'owner'),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'legal_name', x.legal_name, 'display_name', x.display_name, 'type', x.type, 'status', x.status,
        'review_status', x.review_status, 'same_type', x.same_type) order by x.same_type desc, x.legal_name, x.id)
      from (
        select distinct on (y.id) y.id, y.legal_name, y.display_name, y.type, y.status, y.review_status, l.same_type
        from private.organization_identifier_links l
        join public.organizations y
          on y.id = case when l.organization_id = o.id then l.other_organization_id else l.organization_id end
        where l.organization_id = o.id or l.other_organization_id = o.id
        order by y.id
      ) x
    ), '[]'),
    coalesce((
      select jsonb_agg(jsonb_build_object('scope', g.scope, 'country_code', g.country_code, 'name', c.name)
        order by g.scope, c.name)
      from public.organization_geographies g join public.countries c on c.code = g.country_code
      where g.organization_id = o.id
    ), '[]'),
    coalesce((
      select jsonb_agg(jsonb_build_object('code', x.code, 'label', x.label) order by x.label)
      from public.organization_occupations oc join public.occupations x on x.code = oc.occupation_id
      where oc.organization_id = o.id
    ), '[]'),
    coalesce((
      select jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name) order by x.name)
      from public.organization_industries oi join public.industries x on x.code = oi.industry_code
      where oi.organization_id = o.id
    ), '[]'),
    coalesce((
      select jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name) order by x.name)
      from public.organization_languages ol join public.languages x on x.code = ol.language_code
      where ol.organization_id = o.id
    ), '[]'),
    coalesce((
      select jsonb_agg(s.service order by s.service) from public.organization_service_types s where s.organization_id = o.id
    ), '[]'),
    jsonb_build_object(
      'current', private.partner_commitment_current(o.id),
      'current_version', v_version,
      'accepted_version', (
        select latest.version
        from public.organization_members m
        cross join lateral (
          select c.action, c.version from public.consents c
          where c.user_id = m.user_id and c.purpose = 'employer-pays-commitment'
          order by c.id desc limit 1
        ) latest
        where m.organization_id = o.id and m.role = 'owner' and latest.action = 'granted'
      )
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'decision', d.decision, 'reason', d.reason, 'info_step', d.info_step, 'from_status', d.from_status,
        'to_status', d.to_status, 'decided_at', d.decided_at, 'decided_by_email', u.email) order by d.id desc)
      from public.partner_review_decisions d left join auth.users u on u.id = d.decided_by
      where d.organization_id = o.id
    ), '[]')
  from public.organizations o
  where o.id = p_org;
end;
$$;

revoke all on function public.admin_get_partner_review(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_partner_review(uuid) to authenticated;

-- Decision --------------------------------------------------------------------------------------------------------------

-- A Trust & Safety Administrator at aal2 decides on a partner in the queue (AC3 to AC5): approve (to listed, listed_at set
-- at the first approval), request_info with the step to reopen (to info_requested) or decline (to declined, final), with a
-- statement of reasons of 10 to 2,000 characters. Every other role gets CHARA_FORBIDDEN, a session at aal1 detail
-- aal2_required, a reviewer who belongs to the organisation detail own_organization. Only pending_review and re_review are
-- open (CHARA_INVALID_TRANSITION otherwise, with the state as detail). The submission lock of the organisation serialises
-- a decision with another decision and with a resubmission, so of two simultaneous decisions the second finds the new
-- state. One decision row and one audit row partner.review_decided (decision, from, to, info_step, reason). The email to
-- the partner is queued here once V14 adds its kinds.
create function public.admin_decide_partner(
  p_org uuid, p_decision text, p_reason text, p_info_step text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_reason text;
  v_org public.organizations;
  v_to public.partner_review_status;
begin
  v_uid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if p_decision is null or p_decision not in ('approve', 'request_info', 'decline') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'decision';
  end if;
  v_reason := private.statement_of_reasons(p_reason);
  if (p_decision = 'request_info') <> (p_info_step is not null)
     or (p_info_step is not null and p_info_step not in ('company', 'where_you_serve', 'commitments')) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'info_step';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('partner_review_submission:' || p_org::text, 0));
  select * into v_org from public.organizations o where o.id = p_org for update;
  if not found or v_org.type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = v_uid) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'own_organization';
  end if;
  if v_org.review_status not in ('pending_review', 're_review') then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = v_org.review_status::text;
  end if;

  v_to := case p_decision when 'approve' then 'listed' when 'request_info' then 'info_requested' else 'declined'
    end::public.partner_review_status;
  update public.organizations
  set review_status = v_to,
      listed_at = case when p_decision = 'approve' then coalesce(listed_at, now()) else listed_at end,
      info_step = p_info_step
  where id = p_org;

  insert into public.partner_review_decisions (
    organization_id, decision, reason, info_step, from_status, to_status, submitted_at, decided_by
  )
  values (p_org, p_decision, v_reason, p_info_step, v_org.review_status, v_to, v_org.submitted_at, v_uid);

  perform private.audit_admin('partner.review_decided', 'organization', p_org::text, v_reason,
    jsonb_build_object('decision', p_decision, 'from', v_org.review_status, 'to', v_to, 'info_step', p_info_step));

  return jsonb_build_object(
    'review_status', v_to,
    'listed_at', case when p_decision = 'approve' then coalesce(v_org.listed_at, now()) else v_org.listed_at end
  );
end;
$$;

revoke all on function public.admin_decide_partner(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_decide_partner(uuid, text, text, text) to authenticated;

-- Outcome for the partner -----------------------------------------------------------------------------------------------

-- The latest decision on the organisation for its accepted members (FR-J4 AC7, NFR-C7 statement of reasons): the decision,
-- the step reopened and when. The reason is the partner's to read for a request for information and a decline; the reason
-- of an approval stays in the staff record. Never the staff member. No row before the first decision; CHARA_FORBIDDEN for
-- anyone else, detail release_off while release 2a is off.
create function public.partner_review_outcome(p_org uuid)
returns table (decision text, reason text, info_step text, decided_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  return query
  select d.decision, case when d.decision = 'approve' then null else d.reason end, d.info_step, d.decided_at
  from public.partner_review_decisions d
  where d.organization_id = p_org
  order by d.id desc
  limit 1;
end;
$$;

revoke all on function public.partner_review_outcome(uuid) from public, anon, authenticated, service_role;
grant execute on function public.partner_review_outcome(uuid) to authenticated;
