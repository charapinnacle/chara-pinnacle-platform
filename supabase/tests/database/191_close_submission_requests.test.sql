begin;
select plan(47);

\ir apply_fixture.inc

-- Requests end with the partner's permission (20270115200000; FR-O3 step Open submissions, FR-O4 AC4, AC5, AC9, FR-O5;
-- NFR-C4, NFR-S8, NFR-S9): a decline of the partner's response, its withdrawal, or set_submissions_allowed(false)
-- expires the partner's requests still awaiting the candidate (submissions_closed), and approve_submission refuses a
-- request whose partner may no longer submit (CHARA_INVALID_STATE submissions_closed). Approved submissions keep their
-- stage, share and consent. Acme (t.a: owner own1) and Beta (t.b: owner own2) are employers of the fixture; wa and wb are
-- candidates with complete passports.

\set u1 '00000000-0000-0000-0000-0000000f9111'
\set u2 '00000000-0000-0000-0000-0000000f9112'
\set u3 '00000000-0000-0000-0000-0000000f9113'
\set u4 '00000000-0000-0000-0000-0000000f9114'
\set wc '00000000-0000-0000-0000-0000000f9115'

update private.settings set value = 'true' where key in ('release_job_orders', 'release_candidate_submissions');
update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key = 'rate_limit_job_orders_max';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max');
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (:'acme', 'employer_starter', 'active', 'null'), (:'beta', 'employer_starter', 'active', 'null');
select pg_temp.new_user(:'wc', 'worker', 'wc@example.test') as seeded \gset
update public.profiles set account_kind = intended_account_kind where id = :'wc';
select pg_temp.call_as(:'wc', 'authenticated', $$select public.create_worker_passport('Chen', 'Li', 'PH', 'en')$$, 'aal1') as setup_wc \gset
update public.worker_profiles set occupation_id = '7212' where user_id = :'wc';
select pg_temp.doc(:'d1', :'wa', 'clean', 'certificate') as seeded \gset
select pg_temp.doc(:'dx', :'wb', 'clean') as seeded \gset

-- A listed partner serving Germany and listing 7212 on a paid plan, owned by p_owner, with the commitment accepted.
create function pg_temp.partner(p_slug text, p_owner uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'recruitment_company', p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code) values
    (v_id, 'serves_market', 'DE'), (v_id, 'sources_from', 'PH');
  insert into public.organization_occupations (organization_id, occupation_id) values (v_id, '7212');
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, 'recruitment_partner', 'active', 'null');
  insert into public.consents (user_id, purpose, version, action)
  values (p_owner, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
  return v_id;
end;
$$;

create function pg_temp.req(p_org uuid, p_title text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, skills, start_date,
    duration_months, employment_type, recruitment_preference, partner_need, status, visibility, show_identity,
    published_at, closes_on
  ) values (
    v_id, p_org, p_title, 10, 'DE', 'Hamburg', 'C', 'MIG/MAG welding', date '2027-03-01', 12, 'full_time', 'both', 'both',
    'open', 'job_order_marketplace', false, now() - interval '10 days', date '2027-04-01'
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

create function pg_temp.resp(p_req uuid, p_partner uuid, p_status text, p_allowed boolean) returns uuid
language sql as $$
  insert into public.partner_responses (
    requirement_id, organization_id, employer_organization_id, status, capacity, available_from, experience_note, fee_model,
    decided_at, submissions_allowed
  )
  select p_req, p_partner, r.organization_id, p_status::public.response_status, 5, current_date + 30,
    'Twenty welders placed in Hamburg last year.', 'on_request',
    case when p_status in ('shortlisted', 'selected', 'declined') then now() end, p_allowed
  from public.workforce_requirements r where r.id = p_req
  returning id
$$;

-- submit_candidate as p_user for p_org: the id of the request.
create function pg_temp.sub(p_user uuid, p_org uuid, p_req uuid, p_email text) returns uuid
language plpgsql as $$
declare
  v_result text;
begin
  v_result := pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.result', (select s.id::text from public.submit_candidate(%L, %L, %L) s), true)$f$,
    p_org, p_req, p_email), 'aal1');
  if v_result <> 'ok' then
    raise exception 'submit_candidate refused: %', v_result;
  end if;
  return current_setting('t.result')::uuid;
end;
$$;

create function pg_temp.answer(p_user uuid, p_fn text, p_sub uuid, p_docs uuid[] default null) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    case when p_fn = 'approve_submission'
      then format($f$select set_config('t.result', public.approve_submission(%L, %L::uuid[])::text, true)$f$, p_sub, p_docs)
      else format($f$select set_config('t.result', public.%I(%L)::text, true)$f$, p_fn, p_sub) end, 'aal1')
$$;

create function pg_temp.state(p_sub uuid) returns text
language sql as $$
  select s.status || '|' || s.submissions_closed || '|' || (s.decided_at is not null)
  from public.candidate_submissions s where s.id = p_sub
$$;

-- Everything an approval writes and the notices of a submission, to compare before and after.
create function pg_temp.shared() returns text
language sql as $$
  select (select count(*) from public.passport_shares) || ',' || (select count(*) from public.consents) || ','
      || (select count(*) from pgmq.q_notifications where message ->> 'kind' like 'submission%')
$$;

create function pg_temp.read_as(p_user uuid, p_sql text) returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text end, true);
  execute format('set local role %I', case when p_user is null then 'anon' else 'authenticated' end);
  begin
    execute p_sql into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

select pg_temp.partner('close-p1', :'u1') as p1 \gset
select pg_temp.partner('close-p2', :'u2') as p2 \gset
select pg_temp.partner('close-p3', :'u3') as p3 \gset
select pg_temp.partner('close-p4', :'u4') as p4 \gset
select pg_temp.req(:'acme', 'Acme close welders') as r \gset
select pg_temp.req(:'acme', 'Acme close second') as r2 \gset
select pg_temp.req(:'beta', 'Beta close welders') as rb \gset
select pg_temp.resp(:'r', :'p1', 'shortlisted', true) as r_p1 \gset
select pg_temp.resp(:'r', :'p2', 'shortlisted', true) as r_p2 \gset
select pg_temp.resp(:'r', :'p3', 'selected', true) as r_p3 \gset
select pg_temp.resp(:'r', :'p4', 'selected', true) as r_p4 \gset
select pg_temp.resp(:'r2', :'p1', 'selected', true) as r2_p1 \gset
select pg_temp.resp(:'rb', :'p1', 'shortlisted', true) as rb_p1 \gset
select email as wa_email from auth.users where id = :'wa' \gset
select email as wb_email from auth.users where id = :'wb' \gset

-- Structure ------------------------------------------------------------------------------------------------------------------

select ok(
  exists (select 1 from pg_trigger where tgname = 'partner_responses_close_requests'
          and tgrelid = 'public.partner_responses'::regclass and tgenabled = 'A'),
  'a trigger on partner_responses closes the requests, enabled always');
select is(
  (select count(*)::integer from pg_proc p where p.pronamespace = 'private'::regnamespace
     and p.proname in ('close_submission_requests', 'partner_responses_close_requests')
     and p.prosecdef and p.proconfig @> array['search_path=""']
     and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute')),
  2, 'the helpers are security definer with an empty search path and executed by no API role');
select ok(
  not has_column_privilege('authenticated', 'public.candidate_submissions', 'submissions_closed', 'select')
    and not has_column_privilege('anon', 'public.candidate_submissions', 'submissions_closed', 'select'),
  'NFR-S9: submissions_closed is read through the functions only');

-- Decline: P1 shortlisted with submissions open, declined by the employer -----------------------------------------------

select pg_temp.sub(:'u1', :'p1', :'r', :'wa_email') as p1_wa \gset
select pg_temp.sub(:'u1', :'p1', :'r', 'nobody-close@example.test') as p1_new \gset
select pg_temp.sub(:'u1', :'p1', :'r', :'wb_email') as p1_wb \gset
select pg_temp.sub(:'u1', :'p1', :'r2', :'wa_email') as p1_r2 \gset
select pg_temp.sub(:'u1', :'p1', :'rb', :'wa_email') as p1_rb \gset
select pg_temp.sub(:'u3', :'p3', :'r', 'wc@example.test') as p3_wc \gset
select is(pg_temp.answer(:'wb', 'approve_submission', :'p1_wb', array[:'dx']::uuid[]), 'ok',
  'wb approves P1''s request while P1 may submit');
select private.monthly_usage(:'p1', 'candidate_submissions_per_month') as usage_before \gset
select pg_temp.shared() as shared_before \gset
select count(*) as events_before from public.submission_events \gset

select is(pg_temp.call_as(:'own1', 'authenticated',
  format($$select public.decide_response(%L, %L, 'declined')$$, :'acme', :'r_p1')), 'ok',
  'Acme''s owner declines P1''s shortlisted response');
select is(pg_temp.state(:'p1_wa'), 'expired|true|true', 'the request to wa awaiting the candidate is closed at once');
select is(pg_temp.state(:'p1_new'), 'expired|true|true', 'so is the request to an address without an account');
select is(
  (select count(*)::integer from public.submission_events e
   where e.submission_id in (:'p1_wa', :'p1_new') and e.from_status = 'awaiting_candidate' and e.to_status = 'expired'
     and e.actor_id is null),
  2, 'one event without actor each');
select is(
  (select count(*)::integer from audit.log l
   where l.action = 'submission.expired' and l.entity_id in (:'p1_wa', :'p1_new')
     and l.metadata ->> 'reason' = 'submissions_closed' and l.metadata ->> 'organization_id' = :'p1'),
  2, 'one audit row submission.expired with the reason each');
select is(pg_temp.state(:'p1_wb'), 'submitted|false|true', 'FR-O5: the submission wb approved keeps its stage');
select is(
  (select (s.revoked_at is null)::text || ',' || (s.expires_at is null)::text from public.passport_shares s
   where s.submission_id = :'p1_wb'),
  'true,true', 'FR-O4 AC9: its share is neither revoked nor given an expiry');
select is(
  (select count(*)::integer from public.consents c
   where c.user_id = :'wb' and c.purpose like '%:submission:' || :'p1_wb' and c.action = 'withdrawn'),
  0, 'and no consent is withdrawn for it: only the candidate withdraws');
select is(pg_temp.state(:'p1_r2'), 'awaiting_candidate|false|false', 'P1''s request for another requirement stays open');
select is(pg_temp.state(:'p1_rb'), 'awaiting_candidate|false|false', 'so does P1''s request to another employer''s requirement');
select is(pg_temp.state(:'p3_wc'), 'awaiting_candidate|false|false', 'another partner''s request for the same requirement stays open');
select is(private.monthly_usage(:'p1', 'candidate_submissions_per_month'), :'usage_before'::integer,
  'the closed requests still count in their month');
select is(pg_temp.shared(), :'shared_before', 'nothing is shared, no consent is written and no submission notice is queued');

-- The candidate's answer and lists after the decline --------------------------------------------------------------------

select is(pg_temp.answer(:'wa', 'approve_submission', :'p1_wa', array[:'d1']::uuid[]),
  'P0001|CHARA_INVALID_STATE|submissions_closed', 'wa''s approval of the closed request is refused with submissions_closed');
select is(pg_temp.answer(:'wa', 'decline_submission', :'p1_wa'),
  'P0001|CHARA_INVALID_STATE|submissions_closed', 'and so is a decline: the request is no longer open');
select is(pg_temp.state(:'p1_wa'), 'expired|true|true', 'the refused answers change nothing');
select is(pg_temp.shared(), :'shared_before', 'and share nothing');
select is(pg_temp.read_as(:'wa', format(
  'select count(*)::text from public.list_my_submission_requests() where id = %L', :'p1_wa')),
  '0', 'the request leaves wa''s pending requests');
select is(pg_temp.read_as(:'wa', format(
  'select status || ''|'' || submissions_closed from public.list_my_submissions() where id = %L', :'p1_wa')),
  'expired|true', 'list_my_submissions tells wa that it was closed, not that wa did not answer');
select is(pg_temp.read_as(:'wb', format(
  'select count(*)::text from public.list_my_submissions() where id = %L', :'p1_wa')),
  '0', 'NFR-S8: another candidate does not read it');
select is(pg_temp.read_as(:'u1', format(
  'select string_agg(id || '':'' || submissions_closed, '','' order by id) from public.list_partner_submissions(%L, %L) where id in (%L, %L)',
  :'p1', :'r', :'p1_wa', :'p1_wb')),
  (select string_agg(x, ',' order by x) from unnest(array[:'p1_wa' || ':true', :'p1_wb' || ':false']) x),
  'P1''s list tells it which request was closed');
select is(pg_temp.read_as(:'u3', format(
  'select count(*)::text from public.list_partner_submissions(%L, %L) where id = %L', :'p3', :'r', :'p1_wa')),
  '0', 'NFR-S8: another partner does not read it');
select is(pg_temp.read_as(:'u1', format(
  'select submissions_closed::text from public.candidate_submissions where id = %L', :'p1_wa')),
  '42501|permission denied for table candidate_submissions|', 'NFR-S9: nor does the partner read the column directly');
select is(pg_temp.read_as(:'own2', format(
  'select count(*)::text from public.candidate_submissions where id in (%L, %L)', :'p1_wa', :'p1_wb')),
  '0', 'NFR-S8: another employer reads none of them');
select is(pg_temp.read_as(null, 'select count(*)::text from public.list_my_submissions()'),
  '42501|permission denied for function list_my_submissions|', 'NFR-S8: the anonymous caller is refused');

-- set_submissions_allowed(false): P2 shortlisted with submissions open ----------------------------------------------------

select pg_temp.sub(:'u2', :'p2', :'r', :'wa_email') as p2_wa \gset
select pg_temp.sub(:'u2', :'p2', :'r', 'wc@example.test') as p2_wc \gset
select is(pg_temp.answer(:'wc', 'approve_submission', :'p2_wc'), 'ok', 'wc approves P2''s request while P2 may submit');
select is(pg_temp.call_as(:'own1', 'authenticated',
  format($$select public.set_submissions_allowed(%L, %L, false)$$, :'acme', :'r_p2')), 'ok',
  'Acme''s owner closes submissions for P2');
select is(pg_temp.state(:'p2_wa'), 'expired|true|true', 'P2''s request awaiting wa is closed');
select is(pg_temp.state(:'p2_wc'), 'submitted|false|true', 'FR-O5: the submission wc approved keeps its stage');
select is(pg_temp.answer(:'wa', 'approve_submission', :'p2_wa'),
  'P0001|CHARA_INVALID_STATE|submissions_closed', 'wa cannot approve it');
select is(pg_temp.call_as(:'own1', 'authenticated',
  format($$select public.set_submissions_allowed(%L, %L, true)$$, :'acme', :'r_p2')), 'ok',
  'reopening submissions for P2');
select is(pg_temp.state(:'p2_wa'), 'expired|true|true', 'does not reopen a closed request');
select is(pg_temp.call_as(:'own1', 'authenticated',
  format($$select public.set_submissions_allowed(%L, %L, true)$$, :'acme', :'rb_p1')),
  'P0002|CHARA_NOT_FOUND|', 'NFR-S8: Acme cannot close submissions on Beta''s requirement');
select is(pg_temp.state(:'p1_rb'), 'awaiting_candidate|false|false', 'and P1''s request there stays open');

-- approve_submission checks the permission itself ----------------------------------------------------------------------------

-- A request left open while P4's permission ended without the trigger (as before 20270115200000); the guard of the
-- response's states is off for this one write of the database owner.
select pg_temp.sub(:'u4', :'p4', :'r', :'wa_email') as p4_wa \gset
alter table public.partner_responses disable trigger partner_responses_close_requests;
alter table public.partner_responses disable trigger partner_responses_guard;
update public.partner_responses set status = 'declined', submissions_allowed = false where id = :'r_p4';
alter table public.partner_responses enable always trigger partner_responses_close_requests;
alter table public.partner_responses enable always trigger partner_responses_guard;
select pg_temp.shared() as shared_before \gset
select is(pg_temp.answer(:'wa', 'approve_submission', :'p4_wa', array[:'d1']::uuid[]),
  'P0001|CHARA_INVALID_STATE|submissions_closed', 'approve_submission refuses when the partner may no longer submit');
select is(pg_temp.state(:'p4_wa'), 'awaiting_candidate|false|false', 'the request is unchanged');
select is(pg_temp.shared(), :'shared_before', 'no consent, no share and no notice are written');
select is(private.close_submission_requests(:'r', :'p4'), 1, 'close_submission_requests closes such a request, as the migration did');
select is(pg_temp.state(:'p4_wa'), 'expired|true|true', 'it is then closed');

-- Withdrawal: a response withdrawn closes any request left of its partner ---------------------------------------------------

select pg_temp.sub(:'u1', :'p1', :'r2', :'wb_email') as p1_r2_wb \gset
alter table public.partner_responses disable trigger partner_responses_close_requests;
alter table public.partner_responses disable trigger partner_responses_guard;
update public.partner_responses set status = 'submitted', decided_at = null, submissions_allowed = false where id = :'r2_p1';
alter table public.partner_responses enable always trigger partner_responses_close_requests;
alter table public.partner_responses enable always trigger partner_responses_guard;
select is(pg_temp.call_as(:'u1', 'authenticated',
  format($$select public.withdraw_response(%L, %L)$$, :'p1', :'r2_p1'), 'aal2'), 'ok', 'P1 withdraws its response to the second requirement');
select is(pg_temp.state(:'p1_r2') || ',' || pg_temp.state(:'p1_r2_wb'), 'expired|true|true,expired|true|true',
  'its requests left there are closed');

-- A selection keeps the requests ---------------------------------------------------------------------------------------------

select pg_temp.sub(:'u3', :'p3', :'r', :'wb_email') as p3_wb \gset
select is(pg_temp.call_as(:'own1', 'authenticated',
  format($$select public.decide_response(%L, %L, 'shortlisted')$$, :'beta', :'rb_p1')),
  'P0001|CHARA_FORBIDDEN|', 'NFR-S8: Acme''s owner cannot decide on Beta''s response');
select is(pg_temp.state(:'p3_wc') || ',' || pg_temp.state(:'p3_wb'), 'awaiting_candidate|false|false,awaiting_candidate|false|false',
  'the requests of a selected partner stay open');

select * from finish();
rollback;
