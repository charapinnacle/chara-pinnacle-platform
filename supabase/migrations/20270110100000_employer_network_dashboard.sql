-- The partner network figures of the employer dashboard, release 2a and 2b parts (FR-R5 AC3, AC4, AC9; SOP P2-39 step
-- Blocks; NFR-S8, NFR-U4).
--
-- get_employer_network_dashboard(p_org) answers the members of an employer organisation while release_partner_directories
-- is on, with one row of counts and the employer's own requirement titles; owners and admins read it at aal2, as the
-- other figures of the employer dashboard (FR-A4). Each part is null while its release is off, so the page never shows a
-- switched-off figure as zero:
--   always: saved_partners (saved_items of the organisation whose partner is public; a suspended or unlisted partner is
--     neither counted nor named, FR-R5 AC4) and followed_companies (the caller's own follows of companies still public).
--   while release_job_orders is on
--     open_requirements, paused_requirements, draft_requirements: the requirements by state.
--     requirements: the open and paused requirements, newest published first, at most 10, each with its id, title,
--       status, closing date, responses (not withdrawn), selected, responses waiting for a decision (submitted or
--       updated), updated_unseen (an edit the employer has not opened: the Updated badge of FR-O2 AC9) and invitations
--       still waiting for the partner's answer.
--     invited_partners and its split invited_recruitment / invited_staffing: distinct partners invited to an open or
--       paused requirement, the withdrawn and expired invitations left out (FR-R5 AC4).
--     invitations_waiting (invited or viewed), invitations_accepted, invitations_responded, invitations_declined: the
--       answers of those invitations.
--     responses_waiting (submitted or updated), responses_updated (the Updated badge) and responses_shortlisted on open
--       and paused requirements; selected_partners: distinct partners with a selected response on a requirement that
--       is open, paused or filled.
--   while release_candidate_submissions and release_job_orders are on (the submission pages need both)
--     submission_stages: the candidates the workers approved, one count per stage of the employer's pipeline (FR-O5);
--       submitted is a candidate nobody has opened yet, waiting for review.
-- No partner, candidate or worker is named (FR-R5 open point: partner names stay on the requirement page).

create function public.get_employer_network_dashboard(p_org uuid)
returns table (
  saved_partners integer,
  followed_companies integer,
  open_requirements integer,
  paused_requirements integer,
  draft_requirements integer,
  requirements jsonb,
  invited_partners integer,
  invited_recruitment integer,
  invited_staffing integer,
  invitations_waiting integer,
  invitations_accepted integer,
  invitations_responded integer,
  invitations_declined integer,
  responses_waiting integer,
  responses_updated integer,
  responses_shortlisted integer,
  selected_partners integer,
  submission_stages jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_job_orders boolean;
  v_submissions boolean;
  v_saved integer;
  v_followed integer;
  v_open integer;
  v_paused integer;
  v_draft integer;
  v_requirements jsonb;
  v_invited integer;
  v_invited_recruitment integer;
  v_invited_staffing integer;
  v_waiting integer;
  v_accepted integer;
  v_responded integer;
  v_declined integer;
  v_responses_waiting integer;
  v_responses_updated integer;
  v_shortlisted integer;
  v_selected integer;
  v_stages jsonb;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required', errcode = '42501';
  end if;
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if private.org_type(p_org) <> 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'employer_only', errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.assert_member_aal2(p_org);
  v_job_orders := private.release_on('release_job_orders');
  v_submissions := v_job_orders and private.release_on('release_candidate_submissions');

  select count(*)::integer into v_saved
  from public.saved_items s
  where s.organization_id = p_org and private.is_public_partner(s.target_organization_id);

  select count(*)::integer into v_followed
  from public.follows f
  where f.user_id = v_uid and private.is_followable(f.organization_id);

  if v_job_orders then
    select
      (count(*) filter (where r.status = 'open'))::integer,
      (count(*) filter (where r.status = 'paused'))::integer,
      (count(*) filter (where r.status = 'draft'))::integer
    into v_open, v_paused, v_draft
    from public.workforce_requirements r
    where r.organization_id = p_org;

    select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb) into v_requirements
    from (
      select
        row_number() over (order by r.published_at desc nulls last, r.id) as ord,
        r.id, r.title, r.status, r.closes_on,
        (select count(*) from public.partner_responses p where p.requirement_id = r.id and p.status <> 'withdrawn')::integer
          as responses,
        (select count(*) from public.partner_responses p where p.requirement_id = r.id and p.status = 'selected')::integer
          as selected,
        (select count(*) from public.partner_responses p
         where p.requirement_id = r.id and p.status in ('submitted', 'updated'))::integer as awaiting_decision,
        (select count(*) from public.partner_responses p
         where p.requirement_id = r.id and p.status = 'updated' and p.employer_seen_version < p.version)::integer
          as updated_unseen,
        (select count(*) from public.requirement_invitations i
         where i.requirement_id = r.id and i.status in ('invited', 'viewed'))::integer as invitations_waiting
      from public.workforce_requirements r
      where r.organization_id = p_org and r.status in ('open', 'paused')
      order by r.published_at desc nulls last, r.id
      limit 10
    ) x;

    select
      (count(distinct i.organization_id))::integer,
      (count(distinct i.organization_id) filter (where o.type = 'recruitment_company'))::integer,
      (count(distinct i.organization_id) filter (where o.type = 'staffing_company'))::integer,
      (count(*) filter (where i.status in ('invited', 'viewed')))::integer,
      (count(*) filter (where i.status = 'accepted'))::integer,
      (count(*) filter (where i.status = 'responded'))::integer,
      (count(*) filter (where i.status = 'declined'))::integer
    into v_invited, v_invited_recruitment, v_invited_staffing, v_waiting, v_accepted, v_responded, v_declined
    from public.requirement_invitations i
    join public.workforce_requirements r on r.id = i.requirement_id
    join public.organizations o on o.id = i.organization_id
    where r.organization_id = p_org and r.status in ('open', 'paused') and i.status not in ('withdrawn', 'expired');

    select
      (count(*) filter (where p.status in ('submitted', 'updated') and r.status in ('open', 'paused')))::integer,
      (count(*) filter (where p.status = 'updated' and p.employer_seen_version < p.version and r.status in ('open', 'paused')))::integer,
      (count(*) filter (where p.status = 'shortlisted' and r.status in ('open', 'paused')))::integer,
      (count(distinct p.organization_id) filter (where p.status = 'selected'))::integer
    into v_responses_waiting, v_responses_updated, v_shortlisted, v_selected
    from public.partner_responses p
    join public.workforce_requirements r on r.id = p.requirement_id
    where r.organization_id = p_org and r.status in ('open', 'paused', 'filled');
  end if;

  if v_submissions then
    select jsonb_object_agg(st.status, coalesce(n.total, 0) order by st.ord) into v_stages
    from unnest(array['submitted', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']::public.submission_status[])
      with ordinality as st (status, ord)
    left join (
      select s.status, count(*)::integer as total
      from public.candidate_submissions s
      where s.employer_organization_id = p_org and s.worker_approved_at is not null
      group by s.status
    ) n on n.status = st.status;
  end if;

  return query
  select v_saved, v_followed, v_open, v_paused, v_draft, v_requirements, v_invited, v_invited_recruitment, v_invited_staffing,
    v_waiting, v_accepted, v_responded, v_declined, v_responses_waiting, v_responses_updated, v_shortlisted, v_selected,
    v_stages;
end;
$$;

comment on function public.get_employer_network_dashboard(uuid) is
  'The partner network figures of an employer dashboard (FR-R5) for its members: saved partners and followed companies; with release 2b the requirements by state with the open and paused ones listed (own titles, response, selected, waiting and Updated counts), partners invited and their answers, responses waiting for a decision, selected partners, and approved submissions by pipeline stage (null while off). No partner or candidate is named.';

revoke all on function public.get_employer_network_dashboard(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_employer_network_dashboard(uuid) to authenticated;
