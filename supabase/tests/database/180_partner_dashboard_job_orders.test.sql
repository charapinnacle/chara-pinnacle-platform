begin;
select plan(38);

\ir organizations_fixture.inc

-- Partner dashboards, release 2b parts (V55, FR-R3 AC3 to AC6, FR-R4 AC3, AC6, AC9, FR-O5 AC10; SOP P2-37 and P2-38 steps
-- Blocks and Grow; NFR-S8 with two employers, two recruitment companies and a staffing company, two candidates and
-- anonymous; NFR-S11): the 2b columns of public.get_partner_dashboard and public.list_partner_submission_outcomes.
-- Recruitment company R serves DE and PL and lists 7212; staffing company S serves DE and lists 7212 and 9329;
-- recruitment company T competes with R. Employers A, B and the suspended employer E publish the requirements.

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

-- An open requirement of p_org (or in p_status) in p_country for p_occupation.
create function pg_temp.req(
  p_org uuid, p_title text, p_visibility text, p_country text, p_occupation text, p_status text default 'open'
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on, close_reason
  ) values (
    v_id, p_org, p_title, 10, p_country, 'Hamburg', 'C', date '2027-06-01', 'full_time', 'both', 'both',
    p_status::public.requirement_status, p_visibility::public.requirement_visibility, true, now() - interval '5 days',
    date '2027-07-01', case when p_status = 'closed' then 'cancelled' end::public.requirement_close_reason
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, p_occupation, 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, p_country);
  return v_id;
end;
$$;

create function pg_temp.invite(p_req uuid, p_partner uuid, p_status text) returns void
language sql as $$
  insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, status, source,
    viewed_at, answered_at, responded_at)
  select p_req, p_partner, r.organization_id, p_status::public.invitation_status, 'directory',
    case when p_status = 'viewed' then now() end,
    case when p_status = 'declined' then now() end,
    case when p_status = 'responded' then now() end
  from public.workforce_requirements r where r.id = p_req
$$;

create function pg_temp.respond(p_req uuid, p_partner uuid, p_status text) returns void
language sql as $$
  insert into public.partner_responses (requirement_id, organization_id, employer_organization_id, status, capacity,
    available_from, experience_note, fee_model, decided_at, withdrawn_at)
  select p_req, p_partner, r.organization_id, p_status::public.response_status, 10, date '2027-05-01',
    'Twelve years of placing certified welders in Germany.', 'on_request',
    case when p_status in ('shortlisted', 'selected', 'declined') then now() end,
    case when p_status = 'withdrawn' then now() end
  from public.workforce_requirements r where r.id = p_req
$$;

-- A submission of p_partner for p_req in p_status, with a candidate of its own; approved from submitted on, with its
-- latest change at p_changed_at.
create function pg_temp.submission(
  p_req uuid, p_partner uuid, p_status text, p_changed_at timestamptz default now() - interval '2 days'
) returns void
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
  if v_approved then
    insert into public.submission_events (submission_id, from_status, to_status, created_at)
    values (v_id, 'awaiting_candidate', 'submitted', p_changed_at);
  end if;
end;
$$;

-- The dashboard row of p_org as p_user (null: anonymous), kept in t.result; returns 'ok' or the refusal.
create function pg_temp.dash(p_user uuid, p_org uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from public.get_partner_dashboard(%L) r)::text, ''[]''), true)', p_org),
    'aal1')
$$;

create function pg_temp.row() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb -> 0 $$;

-- The 2b figures of the row: fitting|employers|awaiting|open|shortlisted|selected|declined, null as '-'.
create function pg_temp.figures() returns text
language sql as $$
  select concat_ws('|', coalesce(r ->> 'fitting_job_orders', '-'), coalesce(r ->> 'matching_employers', '-'),
    coalesce(r ->> 'invitations_awaiting', '-'), coalesce(r ->> 'responses_open', '-'),
    coalesce(r ->> 'responses_shortlisted', '-'), coalesce(r ->> 'responses_selected', '-'),
    coalesce(r ->> 'responses_declined', '-'))
  from (select pg_temp.row() as r) x
$$;

-- list_partner_submission_outcomes of p_org as p_user, kept in t.result.
create function pg_temp.outcomes(p_user uuid, p_org uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from public.list_partner_submission_outcomes(%L) r)::text, ''[]''), true)', p_org),
    'aal1')
$$;

\set rown '00000000-0000-0000-0000-000000180001'
\set rmem '00000000-0000-0000-0000-000000180002'
\set sown '00000000-0000-0000-0000-000000180003'
\set town '00000000-0000-0000-0000-000000180004'
\set aown '00000000-0000-0000-0000-000000180005'
\set bown '00000000-0000-0000-0000-000000180006'
\set eown '00000000-0000-0000-0000-000000180007'
\set cand1 '00000000-0000-0000-0000-000000180008'
\set cand2 '00000000-0000-0000-0000-000000180009'

select pg_temp.new_user(u) from unnest(array[:'rown', :'rmem', :'sown', :'town', :'aown', :'bown', :'eown']::uuid[]) u;
select pg_temp.new_user(u, 'worker') from unnest(array[:'cand1', :'cand2']::uuid[]) u;
update public.profiles set account_kind = intended_account_kind
where id in (:'rown', :'rmem', :'sown', :'town', :'aown', :'bown', :'eown', :'cand1', :'cand2');

select pg_temp.new_org(:'rown', 'recruitment_company', 'v55-recruiter') as r \gset
select pg_temp.new_org(:'sown', 'staffing_company', 'v55-staffing') as s \gset
select pg_temp.new_org(:'town', 'recruitment_company', 'v55-rival') as t \gset
select pg_temp.new_org(:'aown', 'employer', 'v55-acme') as a \gset
select pg_temp.new_org(:'bown', 'employer', 'v55-beta') as b \gset
select pg_temp.new_org(:'eown', 'employer', 'v55-gone') as e \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'r', :'rmem', 'member', now());
insert into public.organization_geographies (organization_id, scope, country_code)
values (:'r', 'serves_market', 'DE'), (:'r', 'serves_market', 'PL'), (:'s', 'serves_market', 'DE'), (:'t', 'serves_market', 'DE');
insert into public.organization_occupations (organization_id, occupation_id)
values (:'r', '7212'), (:'s', '7212'), (:'s', '9329'), (:'t', '7212');

select pg_temp.req(:'a', 'M1 welders Hamburg', 'job_order_marketplace', 'DE', '7212') as m1 \gset
select pg_temp.req(:'a', 'M2 welders Lyon', 'job_order_marketplace', 'FR', '7212') as m2 \gset
select pg_temp.req(:'a', 'M3 drivers Hamburg', 'job_order_marketplace', 'DE', '5120') as m3 \gset
select pg_temp.req(:'a', 'P1 private welders', 'private', 'DE', '7212') as p1 \gset
select pg_temp.req(:'a', 'I1 invited welders', 'private', 'DE', '7212') as i1 \gset
select pg_temp.req(:'a', 'C1 closed welders', 'job_order_marketplace', 'DE', '7212', 'closed') as c1 \gset
select pg_temp.req(:'b', 'B1 welders Gdansk', 'job_order_marketplace', 'PL', '7212') as b1 \gset
select pg_temp.req(:'b', 'I2 packers private', 'private', 'DE', '9329') as i2 \gset
select pg_temp.req(:'b', 'C2 closed packers', 'private', 'DE', '9329', 'closed') as c2 \gset
select pg_temp.req(:'e', 'E1 welders of a suspended employer', 'job_order_marketplace', 'DE', '7212') as e1 \gset
update public.organizations set status = 'suspended' where id = :'e';
select pg_temp.invite(:'i1', :'s', 'invited');
select pg_temp.invite(:'i2', :'s', 'viewed');
select pg_temp.invite(:'c2', :'s', 'invited');

update private.settings set value = 'true'
where key in ('release_partner_directories', 'release_job_orders', 'release_candidate_submissions');
update private.settings set value = '100000' where key = 'rate_limit_job_orders_max';

-- Shape --------------------------------------------------------------------------------------------------------------------
select is(
  (select string_agg(a.name, ',' order by a.ord)
   from pg_proc p cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality as a (name, mode, ord)
   where p.oid = 'public.get_partner_dashboard(uuid)'::regprocedure and a.mode = 't' and a.ord > 19),
  'fitting_job_orders,matching_employers,invitations_awaiting,responses_open,responses_shortlisted,responses_selected,'
  || 'responses_declined,submission_stages',
  'FR-R3 AC3: the 2b columns are counts only, after the 2a columns'
);
select ok(
  not has_function_privilege('anon', 'public.list_partner_submission_outcomes(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.list_partner_submission_outcomes(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.list_partner_submission_outcomes(uuid)', 'execute')
  and (select prosecdef and provolatile = 's' and proconfig @> array['search_path=""']
       from pg_proc where oid = 'public.list_partner_submission_outcomes(uuid)'::regprocedure),
  'list_partner_submission_outcomes: signed-in callers only, security definer, stable, empty search_path'
);

-- FR-R3 AC4, FR-R4 AC3, AC9: fitting job orders, workforce requests and matching employers -------------------------------------
select is(pg_temp.dash(:'rmem', :'r'), 'ok', 'a member of R reads R''s dashboard');
select is(pg_temp.row() ->> 'fitting_job_orders', '2',
  'FR-R3 AC4: M1 and B1 fit R; another country, another occupation, private, invited to S, closed and a suspended employer''s are not counted');
select is(pg_temp.row() ->> 'matching_employers', '2', 'FR-R3: the employers A and B have fitting job orders');
select is(pg_temp.dash(:'sown', :'s') || ':' || (pg_temp.row() ->> 'fitting_job_orders'), 'ok:3',
  'FR-R4 AC3: S''s workforce requests are its two open invitations and the fitting marketplace request M1');
select is(pg_temp.row() ->> 'invitations_awaiting', '2', 'FR-R4 AC3: two invitations await S''s answer; the one on a closed requirement does not');
select is(pg_temp.row() ->> 'matching_employers', '1',
  'FR-R4 AC9: only A counts for S; B''s private requirement S was invited to is not hinted at');
select is(pg_temp.dash(:'town', :'t') || ':' || pg_temp.figures(), 'ok:1|1|0|0|0|0|0',
  'NFR-S8: T fits M1 only and sees nothing of the invitations of S');

-- FR-R3 AC5: invitations awaiting an answer ----------------------------------------------------------------------------------
select pg_temp.invite(:'m1', :'r', 'invited');
select pg_temp.invite(:'c1', :'r', 'invited');
select pg_temp.invite(:'p1', :'r', 'viewed');
select pg_temp.invite(:'m2', :'r', 'responded');
select pg_temp.invite(:'m3', :'r', 'declined');
select is(pg_temp.dash(:'rmem', :'r') || ':' || (pg_temp.row() ->> 'invitations_awaiting'), 'ok:2',
  'FR-R3 AC5: invited or viewed on open requirements: 2 (the invited one on a closed requirement, responded and declined are not)');
select is(pg_temp.row() ->> 'fitting_job_orders', '3',
  'the private requirement R was invited to and may answer joins its fitting job orders; responded and declined ones do not');
select is(pg_temp.dash(:'sown', :'s') || ':' || (pg_temp.row() ->> 'invitations_awaiting'), 'ok:2', 'S''s count is unchanged by R''s invitations');

-- FR-R4 AC6: responses by decision, projects ---------------------------------------------------------------------------------
select pg_temp.respond(:'m1', :'s', 'selected');
select pg_temp.respond(:'b1', :'s', 'selected');
select pg_temp.respond(:'m2', :'s', 'submitted');
select pg_temp.respond(:'m3', :'s', 'declined');
select pg_temp.respond(:'p1', :'s', 'withdrawn');
select pg_temp.respond(:'m1', :'r', 'shortlisted');
select is(pg_temp.dash(:'sown', :'s') || ':' || pg_temp.figures(), 'ok:3|1|2|1|0|2|1',
  'FR-R4 AC6: projects (selected) 2, open 1, not selected 1; the withdrawn response is not counted');
select is(pg_temp.dash(:'rown', :'r') || ':' || pg_temp.figures(), 'ok:3|2|2|0|1|0|0', 'R counts its own shortlisted response only');

-- FR-R3 AC5: submissions by status ----------------------------------------------------------------------------------------------
select pg_temp.submission(:'m1', :'r', st)
from unnest(array['awaiting_candidate', 'awaiting_candidate', 'declined_by_candidate', 'expired', 'submitted', 'viewed',
  'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']) st;
select pg_temp.submission(:'b1', :'r', 'hired', now() - interval '1 hour');
select pg_temp.submission(:'m1', :'t', 'hired');
select pg_temp.submission(:'m1', :'t', 'rejected');
select is(pg_temp.dash(:'rmem', :'r'), 'ok', 'R''s member reads the dashboard with submissions');
select is(pg_temp.row() -> 'submission_stages',
  '{"awaiting_candidate": 2, "declined_by_candidate": 1, "expired": 1, "submitted": 1, "viewed": 1, "shortlisted": 1,
    "interview": 1, "offer": 1, "hired": 2, "rejected": 1, "withdrawn": 1}'::jsonb,
  'FR-R3 AC5: one count per status, the two unapproved under awaiting_candidate (waiting for the worker''s agreement)');
select is((select sum(value::integer) from jsonb_each_text(pg_temp.row() -> 'submission_stages'))::integer,
  (select count(*)::integer from public.candidate_submissions where organization_id = :'r'),
  'FR-R3 AC5: no submission is counted twice');
select is(pg_temp.dash(:'town', :'t') || ':' || (pg_temp.row() -> 'submission_stages' ->> 'hired') || ',' || (pg_temp.row() -> 'submission_stages' ->> 'rejected'),
  'ok:1,1', 'NFR-S8: T counts its own submissions only');
select is(pg_temp.dash(:'sown', :'s') || ':' || (select sum(value::integer) from jsonb_each_text(pg_temp.row() -> 'submission_stages')),
  'ok:0', 'S without submissions has every status at 0');

-- FR-O5 AC10: outcomes per requirement --------------------------------------------------------------------------------------------
select is(pg_temp.outcomes(:'rmem', :'r') || ':' || jsonb_array_length(current_setting('t.result')::jsonb), 'ok:2',
  'FR-O5 AC10: R''s member reads one row per requirement with approved submissions');
select is(
  (select concat_ws('|', e ->> 'submitted', e ->> 'in_progress', e ->> 'hired', e ->> 'not_selected', e ->> 'withdrawn')
   from jsonb_array_elements(current_setting('t.result')::jsonb) e where e ->> 'requirement_id' = :'m1'),
  '8|5|1|1|1',
  'FR-O5 AC10: for M1, 1 hired and 1 not selected among 8 approved; T''s submissions to M1 are not counted');
select is(current_setting('t.result')::jsonb -> 0 ->> 'requirement_id', :'b1', 'the requirement with the latest change comes first');
select is(
  (select e ->> 'title' from jsonb_array_elements(current_setting('t.result')::jsonb) e where e ->> 'requirement_id' = :'m1'),
  private.job_order_neutral_title(:'m1'),
  'NFR-S11: the employer''s title is not shown to a partner it was not named to');
select private.record_requirement_reveal(:'m1', :'r', 'shortlist');
select is(pg_temp.outcomes(:'rmem', :'r') || ':'
  || (select e ->> 'title' from jsonb_array_elements(current_setting('t.result')::jsonb) e where e ->> 'requirement_id' = :'m1'),
  'ok:M1 welders Hamburg', 'once the employer was revealed to R, its title is shown');
select is(pg_temp.outcomes(:'town', :'t') || ':' || (current_setting('t.result')::jsonb -> 0 ->> 'title'),
  'ok:' || private.job_order_neutral_title(:'m1'), 'T reads its own outcome for M1, without the title revealed to R');

-- Who may read (NFR-S8) ---------------------------------------------------------------------------------------------------------
select is(pg_temp.dash(:'town', :'r'), '42501|CHARA_FORBIDDEN|', 'the owner of competing recruitment company T is refused R''s figures');
select is(pg_temp.dash(:'sown', :'r'), '42501|CHARA_FORBIDDEN|', 'FR-R4 AC3: the owner of S is refused R''s figures');
select is(pg_temp.dash(:'aown', :'r') || ',' || pg_temp.dash(:'bown', :'r'), '42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|',
  'neither employer reads R''s figures');
select is(pg_temp.dash(:'cand1', :'r') || ',' || pg_temp.dash(:'cand2', :'s'),
  '42501|CHARA_FORBIDDEN|company_account_required,42501|CHARA_FORBIDDEN|company_account_required',
  'two candidates are refused with company_account_required');
select is(pg_temp.outcomes(:'town', :'r') || ',' || pg_temp.outcomes(:'sown', :'r'), '42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|',
  'other partners are refused R''s outcomes');
select is(pg_temp.outcomes(:'aown', :'r') || ',' || pg_temp.outcomes(:'aown', :'a'), '42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|partner_only',
  'an employer is refused R''s outcomes and its own (partner_only)');
select is(pg_temp.outcomes(:'cand1', :'r') || ',' || pg_temp.outcomes(:'cand2', :'r'), '42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|',
  'the candidates are refused R''s outcomes');
select matches(pg_temp.outcomes(null, :'r'), '^42501\|permission denied for function list_partner_submission_outcomes',
  'anonymous has no EXECUTE on the outcomes');
select matches(pg_temp.dash(null, :'r'), '^42501\|permission denied for function get_partner_dashboard', 'anonymous has no EXECUTE on the dashboard');

-- FR-R3 AC6: release gating -----------------------------------------------------------------------------------------------------
update private.settings set value = 'false' where key = 'release_candidate_submissions';
select is(pg_temp.dash(:'rmem', :'r') || ':' || coalesce(pg_temp.row() ->> 'submission_stages', 'null') || ':' || pg_temp.figures(),
  'ok:null:3|2|2|0|1|0|0', 'FR-R3 AC6: with submissions off the stages are null, the job order figures stay');
select is(pg_temp.outcomes(:'rmem', :'r'), '42501|CHARA_FORBIDDEN|release_off', 'the outcomes are closed while submissions are off');
update private.settings set value = 'false' where key = 'release_job_orders';
update private.settings set value = 'true' where key = 'release_candidate_submissions';
select is(pg_temp.dash(:'rmem', :'r') || ':' || coalesce(pg_temp.row() ->> 'submission_stages', 'null') || ':' || pg_temp.figures(),
  'ok:null:-|-|-|-|-|-|-', 'FR-R3 AC6: with job orders off every 2b figure is null, submissions included');
select is(pg_temp.row() ->> 'listings_total', '0', 'the 2a figures are still returned');

select * from finish();
rollback;
