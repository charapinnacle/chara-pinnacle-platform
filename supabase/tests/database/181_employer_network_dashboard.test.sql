begin;
select plan(30);

\ir organizations_fixture.inc

-- Employer dashboard, partner network blocks (V56, FR-R5 AC3, AC4; SOP P2-39 step Blocks; NFR-S8 with two employers, two
-- recruitment companies and a staffing company, two candidates and anonymous; NFR-U4): public.get_employer_network_dashboard.
-- Employer A posts Q1 (invited, answered, selected), Q2 (marketplace, no response), a paused Q5, a draft Q3, a closed Q4
-- and a filled Q6; employer B posts an open requirement of its own.

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_slug text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  if p_type <> 'employer' then
    update public.organizations set review_status = 'listed', listed_at = now() - interval '3 days',
      submitted_at = now() - interval '4 days'
    where id = v_id;
  end if;
  return v_id;
end;
$$;

create function pg_temp.req(p_org uuid, p_title text, p_status text, p_published interval) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on, close_reason
  ) values (
    v_id, p_org, p_title, 10, 'DE', 'Hamburg', 'C', date '2027-06-01', 'full_time', 'both', 'both',
    p_status::public.requirement_status, case when p_status <> 'draft' then 'job_order_marketplace'::public.requirement_visibility end,
    case when p_status <> 'draft' then now() - p_published end, case when p_status <> 'draft' then date '2027-07-01' end,
    case when p_status = 'closed' then 'cancelled' when p_status = 'filled' then 'filled' end::public.requirement_close_reason
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

create function pg_temp.invite(p_req uuid, p_partner uuid, p_status text) returns void
language sql as $$
  insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, status, source,
    viewed_at, answered_at, responded_at, withdrawn_at, expired_at)
  select p_req, p_partner, r.organization_id, p_status::public.invitation_status, 'directory',
    case when p_status = 'viewed' then now() end,
    case when p_status in ('accepted', 'declined') then now() end,
    case when p_status = 'responded' then now() end,
    case when p_status = 'withdrawn' then now() end,
    case when p_status = 'expired' then now() end
  from public.workforce_requirements r where r.id = p_req
$$;

create function pg_temp.respond(p_req uuid, p_partner uuid, p_status text, p_version integer default 1, p_seen integer default 0)
returns void
language sql as $$
  insert into public.partner_responses (requirement_id, organization_id, employer_organization_id, status, version,
    employer_seen_version, capacity, available_from, experience_note, fee_model, decided_at, withdrawn_at)
  select p_req, p_partner, r.organization_id, p_status::public.response_status, p_version, p_seen, 10, date '2027-05-01',
    'Twelve years of placing certified welders in Germany.', 'on_request',
    case when p_status in ('shortlisted', 'selected', 'declined') then now() end,
    case when p_status = 'withdrawn' then now() end
  from public.workforce_requirements r where r.id = p_req
$$;

create function pg_temp.submission(p_req uuid, p_partner uuid, p_status text) returns void
language plpgsql as $$
declare
  v_approved boolean := p_status not in ('awaiting_candidate', 'declined_by_candidate', 'expired');
  v_id uuid := gen_random_uuid();
begin
  insert into public.candidate_submissions (id, requirement_id, organization_id, employer_organization_id, invited_email,
    worker_user_id, status, decided_at, worker_approved_at, passport_share_id, profile_snapshot, withdrawn_at)
  select v_id, p_req, p_partner, r.organization_id, v_id || '@seed.test', case when v_approved then gen_random_uuid() end,
    p_status::public.submission_status, case when p_status <> 'awaiting_candidate' then now() end,
    case when v_approved then now() - interval '2 days' end, case when v_approved then gen_random_uuid() end,
    case when v_approved then '{}'::jsonb end, case when p_status = 'withdrawn' then now() end
  from public.workforce_requirements r where r.id = p_req;
end;
$$;

-- The dashboard row of p_org as p_user (null: anonymous) at p_aal, kept in t.result; returns 'ok' or the refusal.
create function pg_temp.dash(p_user uuid, p_org uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from public.get_employer_network_dashboard(%L) r)::text, ''[]''), true)', p_org),
    p_aal)
$$;

create function pg_temp.row() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb -> 0 $$;

-- The requirement of the row's list with p_id.
create function pg_temp.listed(p_id uuid) returns jsonb
language sql as $$
  select e from jsonb_array_elements(pg_temp.row() -> 'requirements') e where e ->> 'id' = p_id::text
$$;

\set aown '00000000-0000-0000-0000-000000181001'
\set amem '00000000-0000-0000-0000-000000181002'
\set aadm '00000000-0000-0000-0000-000000181003'
\set bown '00000000-0000-0000-0000-000000181004'
\set rown '00000000-0000-0000-0000-000000181005'
\set r2own '00000000-0000-0000-0000-000000181006'
\set sown '00000000-0000-0000-0000-000000181007'
\set xown '00000000-0000-0000-0000-000000181008'
\set cand1 '00000000-0000-0000-0000-000000181009'
\set cand2 '00000000-0000-0000-0000-000000181010'

select pg_temp.new_user(u) from unnest(array[:'aown', :'amem', :'aadm', :'bown', :'rown', :'r2own', :'sown', :'xown']::uuid[]) u;
select pg_temp.new_user(u, 'worker') from unnest(array[:'cand1', :'cand2']::uuid[]) u;
update public.profiles set account_kind = intended_account_kind
where id in (:'aown', :'amem', :'aadm', :'bown', :'rown', :'r2own', :'sown', :'xown', :'cand1', :'cand2');

select pg_temp.new_org(:'aown', 'employer', 'v56-acme') as a \gset
select pg_temp.new_org(:'bown', 'employer', 'v56-beta') as b \gset
select pg_temp.new_org(:'rown', 'recruitment_company', 'v56-recruit-one') as r \gset
select pg_temp.new_org(:'r2own', 'recruitment_company', 'v56-recruit-two') as r2 \gset
select pg_temp.new_org(:'sown', 'staffing_company', 'v56-staffing') as s \gset
select pg_temp.new_org(:'xown', 'recruitment_company', 'v56-suspended') as x \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (:'a', :'amem', 'member', now()), (:'a', :'aadm', 'admin', now());

select pg_temp.req(:'a', 'Q1 welders Hamburg', 'open', interval '1 day') as q1 \gset
select pg_temp.req(:'a', 'Q2 fitters Bremen', 'open', interval '5 days') as q2 \gset
select pg_temp.req(:'a', 'Q3 draft', 'draft', interval '0 days') as q3 \gset
select pg_temp.req(:'a', 'Q4 closed', 'closed', interval '9 days') as q4 \gset
select pg_temp.req(:'a', 'Q5 paused', 'paused', interval '7 days') as q5 \gset
select pg_temp.req(:'a', 'Q6 filled', 'filled', interval '20 days') as q6 \gset
select pg_temp.req(:'b', 'B1 welders Gdansk', 'open', interval '1 day') as b1 \gset

-- Q1: 3 invitations (two recruitment companies and a staffing company), 2 responses of which 1 selected.
select pg_temp.invite(:'q1', :'r', 'responded');
select pg_temp.invite(:'q1', :'r2', 'viewed');
select pg_temp.invite(:'q1', :'s', 'responded');
select pg_temp.respond(:'q1', :'r', 'selected');
select pg_temp.respond(:'q1', :'s', 'updated', 2, 1);
select pg_temp.invite(:'q5', :'r2', 'declined');
select pg_temp.invite(:'q5', :'x', 'withdrawn');
select pg_temp.invite(:'q4', :'x', 'expired');
select pg_temp.respond(:'q4', :'r2', 'submitted');
select pg_temp.respond(:'q5', :'r2', 'withdrawn');
select pg_temp.respond(:'q6', :'s', 'selected');
select pg_temp.invite(:'b1', :'r', 'invited');
select pg_temp.respond(:'b1', :'r2', 'submitted');

-- A's four saved partners, one of them suspended; B saves one; the owner of A follows R and the suspended X.
insert into public.saved_items (organization_id, target_organization_id, saved_by)
values (:'a', :'r', :'aown'), (:'a', :'r2', :'aown'), (:'a', :'s', :'aown'), (:'a', :'x', :'aown'), (:'b', :'r', :'bown');
insert into public.follows (user_id, organization_id) values (:'aown', :'r'), (:'aown', :'x'), (:'amem', :'s');
update public.organizations set status = 'suspended' where id = :'x';

update private.settings set value = 'true'
where key in ('release_partner_directories', 'release_job_orders', 'release_candidate_submissions');

-- Shape --------------------------------------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.get_employer_network_dashboard(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.get_employer_network_dashboard(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.get_employer_network_dashboard(uuid)', 'execute')
  and (select prosecdef and provolatile = 's' and proconfig @> array['search_path=""']
       from pg_proc where oid = 'public.get_employer_network_dashboard(uuid)'::regprocedure),
  'get_employer_network_dashboard: signed-in callers only, security definer, stable, empty search_path'
);

-- FR-R5 AC3: requirements with response counts ----------------------------------------------------------------------------
select is(pg_temp.dash(:'amem', :'a'), 'ok', 'FR-R5 AC3: a member of A reads A''s network figures');
select is(concat_ws('|', pg_temp.row() ->> 'open_requirements', pg_temp.row() ->> 'paused_requirements',
  pg_temp.row() ->> 'draft_requirements'), '2|1|1', 'FR-R5 AC3: two open, one paused and one draft requirement');
select is(
  (select string_agg(e ->> 'title', ',' order by o) from jsonb_array_elements(pg_temp.row() -> 'requirements') with ordinality t (e, o)),
  'Q1 welders Hamburg,Q2 fitters Bremen,Q5 paused',
  'FR-R5 AC3: the open and paused requirements are listed, newest published first; the draft, closed and filled ones are not');
select is(concat_ws('|', pg_temp.listed(:'q1') ->> 'responses', pg_temp.listed(:'q1') ->> 'selected',
  pg_temp.listed(:'q1') ->> 'awaiting_decision', pg_temp.listed(:'q1') ->> 'updated_unseen',
  pg_temp.listed(:'q1') ->> 'invitations_waiting', pg_temp.listed(:'q1') ->> 'status'),
  '2|1|1|1|1|open', 'FR-R5 AC3: Q1 has 2 responses, 1 selected, 1 waiting for a decision with the Updated badge, 1 invitation unanswered');
select is(concat_ws('|', pg_temp.listed(:'q2') ->> 'responses', pg_temp.listed(:'q2') ->> 'selected'), '0|0',
  'FR-R5 AC3: Q2 on the marketplace has no response');
select is(pg_temp.listed(:'q5') ->> 'responses', '0', 'the withdrawn response to Q5 is not counted');
select is((select count(*)::integer from jsonb_object_keys(pg_temp.listed(:'q1'))), 9,
  'each listed requirement carries its id, title, status, closing date and counts only');

-- FR-R5 AC4: partners invited and selected, saved partners -------------------------------------------------------------------
select is(concat_ws('|', pg_temp.row() ->> 'invited_partners', pg_temp.row() ->> 'invited_recruitment',
  pg_temp.row() ->> 'invited_staffing'), '3|2|1',
  'FR-R5 AC4: three partners invited, two recruitment and one staffing; withdrawn, expired and closed-requirement invitations are left out');
select is(concat_ws('|', pg_temp.row() ->> 'invitations_waiting', pg_temp.row() ->> 'invitations_accepted',
  pg_temp.row() ->> 'invitations_responded', pg_temp.row() ->> 'invitations_declined'), '1|0|2|1',
  'the answers of the invitations: one waiting, two responded, one declined');
select is(concat_ws('|', pg_temp.row() ->> 'responses_waiting', pg_temp.row() ->> 'responses_updated',
  pg_temp.row() ->> 'responses_shortlisted'), '1|1|0',
  'one response waits for a decision, updated and not opened; the submitted response to the closed Q4 is not waiting');
select is(pg_temp.row() ->> 'selected_partners', '2', 'FR-R5 AC4: R selected on Q1 and S on the filled Q6');
select is(pg_temp.row() ->> 'saved_partners', '3', 'FR-R5 AC4: the suspended saved partner is not counted');
select ok(pg_temp.row()::text not like '%Suspended%' and pg_temp.row()::text not like '%Recruit One%',
  'FR-R5 AC4: no partner is named');
select is(pg_temp.row() ->> 'followed_companies', '1', 'the member follows S only');
select is(pg_temp.dash(:'aown', :'a') || ':' || (pg_temp.row() ->> 'followed_companies'), 'ok:1',
  'the owner''s follows are their own; the suspended company is not counted');

-- Submissions waiting for review, by stage -------------------------------------------------------------------------------------
select pg_temp.submission(:'q1', :'r', st)
from unnest(array['awaiting_candidate', 'declined_by_candidate', 'expired', 'submitted', 'submitted', 'viewed', 'interview',
  'hired', 'withdrawn']) st;
select pg_temp.submission(:'b1', :'r2', 'submitted');
select is(pg_temp.dash(:'amem', :'a'), 'ok', 'A''s member reads the dashboard with submissions');
select is(pg_temp.row() -> 'submission_stages',
  '{"submitted": 2, "viewed": 1, "shortlisted": 0, "interview": 1, "offer": 0, "hired": 1, "rejected": 0, "withdrawn": 1}'::jsonb,
  'the approved candidates by pipeline stage; requests the worker has not approved and B''s are not counted');

-- NFR-S8: employer B ----------------------------------------------------------------------------------------------------------
select is(pg_temp.dash(:'bown', :'b') || ':' || concat_ws('|', pg_temp.row() ->> 'open_requirements',
  jsonb_array_length(pg_temp.row() -> 'requirements'), pg_temp.row() ->> 'invited_partners', pg_temp.row() ->> 'responses_waiting',
  pg_temp.row() ->> 'saved_partners', pg_temp.row() -> 'submission_stages' ->> 'submitted'),
  'ok:1|1|1|1|1|1', 'NFR-S8: B counts only its own requirement, invitation, response, saved partner and submission');

-- Who may read (NFR-S8, FR-R5 AC3) ------------------------------------------------------------------------------------------------
select is(pg_temp.dash(:'bown', :'a'), '42501|CHARA_FORBIDDEN|', 'FR-R5 AC3: the owner of B is refused A''s figures');
select is(pg_temp.dash(:'aown', :'b'), '42501|CHARA_FORBIDDEN|', 'the owner of A is refused B''s figures');
select is(pg_temp.dash(:'rown', :'a') || ',' || pg_temp.dash(:'sown', :'a'), '42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|',
  'a recruitment and a staffing company are refused A''s figures');
select is(pg_temp.dash(:'rown', :'r') || ',' || pg_temp.dash(:'r2own', :'r2'),
  '42501|CHARA_FORBIDDEN|employer_only,42501|CHARA_FORBIDDEN|employer_only', 'two recruitment companies are refused their own (employer_only)');
select is(pg_temp.dash(:'cand1', :'a') || ',' || pg_temp.dash(:'cand2', :'b'),
  '42501|CHARA_FORBIDDEN|company_account_required,42501|CHARA_FORBIDDEN|company_account_required',
  'two candidates are refused with company_account_required');
select matches(pg_temp.dash(null, :'a'), '^42501\|permission denied for function get_employer_network_dashboard',
  'anonymous has no EXECUTE');
select is(pg_temp.dash(:'aadm', :'a', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'FR-A4: an admin reads the figures at aal2 only');
select is(pg_temp.dash(:'amem', :'a', 'aal1'), 'ok', 'a member reads them at aal1');

-- FR-R5 AC7: release gating ------------------------------------------------------------------------------------------------------
update private.settings set value = 'false' where key = 'release_candidate_submissions';
select is(pg_temp.dash(:'amem', :'a') || ':' || coalesce(pg_temp.row() ->> 'submission_stages', 'null') || ':'
  || (pg_temp.row() ->> 'open_requirements'), 'ok:null:2', 'with submissions off the stages are null, the requirements stay');
update private.settings set value = 'false' where key = 'release_job_orders';
update private.settings set value = 'true' where key = 'release_candidate_submissions';
select is(pg_temp.dash(:'amem', :'a') || ':' || concat_ws('|', coalesce(pg_temp.row() ->> 'requirements', '-'),
  coalesce(pg_temp.row() ->> 'invited_partners', '-'), coalesce(pg_temp.row() ->> 'submission_stages', '-'),
  pg_temp.row() ->> 'saved_partners'),
  'ok:-|-|-|3', 'with job orders off every 2b figure is null, submissions included; saved partners stay');
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.dash(:'amem', :'a'), '42501|CHARA_FORBIDDEN|release_off', 'the read is closed while release 2a is off');

select * from finish();
rollback;
