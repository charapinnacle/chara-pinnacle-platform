begin;
select plan(174);

\ir apply_fixture.inc

-- Candidate submissions, data (V48, FR-O4 AC1 to AC4, AC6 to AC9 and the data of AC5, AC10, AC12; SOP P2-24 steps Request,
-- Invite, Approve, Decline, Deliver, Withdraw; decisions 4.1, 6.3; NFR-S8, NFR-S9, NFR-C4, NFR-A3, NFR-A4):
-- public.candidate_submissions, public.submission_events, submit_candidate, approve_submission, decline_submission,
-- withdraw_submission, the four lists, the share by submission, the consent purpose, the access log purpose
-- submission_review, the monthly count, the four notification kinds and the daily expiry. Acme (t.a: owner own1, admin
-- adm, member mem) and Beta (t.b: owner own2, admin adm2) are employers of the fixture; wa (Amina Okafor) and wb (Bruno
-- Silva) are candidates with complete passports; the partners are made below.

\set u1 '00000000-0000-0000-0000-0000000f4811'
\set u1a '00000000-0000-0000-0000-0000000f4812'
\set u1m '00000000-0000-0000-0000-0000000f4813'
\set u2 '00000000-0000-0000-0000-0000000f4814'
\set padm '00000000-0000-0000-0000-0000000f4815'
\set wclosed '00000000-0000-0000-0000-0000000f4816'
\set wlate '00000000-0000-0000-0000-0000000f4817'
\set wother '00000000-0000-0000-0000-0000000f4818'
\set stf '00000000-0000-0000-0000-0000000f4819'
\set u4 '00000000-0000-0000-0000-0000000f481a'
\set cown '00000000-0000-0000-0000-0000000f4890'
\set org_c '00000000-0000-0000-0000-0000000f4891'
\set c_r '00000000-0000-0000-0000-0000000f4892'
\set c_p '00000000-0000-0000-0000-0000000f4893'
\set pown '00000000-0000-0000-0000-0000000f4894'
\set c_x1 '00000000-0000-0000-0000-0000000f4895'
\set c_x2 '00000000-0000-0000-0000-0000000f4896'

-- Concurrency (NFR-A4, FR-O4 AC3) first, before this transaction writes a settings row the committed setup changes ---------

create extension if not exists dblink schema extensions;
select extensions.dblink_connect('setup',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('blocked',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
-- An employer with one open requirement and a selected partner P (Enterprise, a monthly limit of 1 by an override) whose
-- owner pown accepted the commitment. The employer's owner has a suspended account, and the two addresses proposed belong
-- to company accounts, so no notification is queued by the committed requests.
select extensions.dblink_exec('setup', format($$
  begin;
  update private.settings set value = 'true' where key in ('release_job_orders', 'release_candidate_submissions');
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%1$L, %1$L || '@employer.test', now(), '{"intended_account_kind": "company"}'),
         (%5$L, %5$L || '@partner.test', now(), '{"intended_account_kind": "company"}'),
         (%6$L, %6$L || '@other.test', now(), '{"intended_account_kind": "company"}'),
         (%7$L, %7$L || '@other.test', now(), '{"intended_account_kind": "company"}');
  update public.profiles set account_kind = intended_account_kind where id in (%1$L, %5$L, %6$L, %7$L);
  update public.profiles set status = 'suspended' where id = %1$L;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (%2$L, 'employer', 'sub-lock-' || left(%2$L, 8), 'Submission Lock GmbH', 'Submission Lock', 'DE'),
         (%4$L, 'recruitment_company', 'sub-lock-p-' || left(%4$L, 8), 'Sub Lock Partner Ltd', 'Sub Lock Partner', 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (%2$L, %1$L, 'owner', now()), (%4$L, %5$L, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  values (%4$L, 'serves_market', 'DE'), (%4$L, 'sources_from', 'PH');
  insert into public.organization_occupations (organization_id, occupation_id) values (%4$L, '7212');
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = %4$L;
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  values (%4$L, 'recruitment_enterprise', 'active', 'null');
  insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value)
  values (%4$L, 'candidate_submissions_per_month', 1);
  insert into public.consents (user_id, purpose, version, action)
  values (%5$L, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on
  ) values (%3$L, %2$L, 'Lock welders', 10, 'DE', 'Hamburg', 'C', current_date + 30, 'full_time', 'international', 'both',
    'open', 'job_order_marketplace', now(), current_date + 80);
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (%3$L, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (%3$L, 'DE');
  insert into public.partner_responses (
    requirement_id, organization_id, employer_organization_id, status, capacity, available_from, experience_note, fee_model,
    decided_at, submissions_allowed
  ) values (%3$L, %4$L, %2$L, 'selected', 5, current_date + 30, 'Twenty welders placed in Hamburg last year.', 'on_request',
    now(), true);
  commit;
$$, :'cown', :'org_c', :'c_r', :'c_p', :'pown', :'c_x1', :'c_x2'));

create function pg_temp.hold(p_sql text) returns text
language sql as $$
  select t from extensions.dblink('holder', format($f$
    begin;
    set local lock_timeout = '2s';
    select set_config('request.jwt.claims', json_build_object('sub', %L, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
    %s;
  $f$, current_setting('t.pown'), p_sql)) as r (t text)
$$;

create function pg_temp.submit_sql(p_org uuid, p_req uuid, p_email text) returns text
language sql as $$
  select format($f$select (select status from public.submit_candidate(%L, %L, %L))::text$f$, p_org, p_req, p_email)
$$;

create function pg_temp.send_blocked(p_sql text) returns integer
language sql as $$
  select extensions.dblink_exec('blocked', format($f$
    begin;
    update private.settings set value = 'true' where key = 'entitlements_enforced';
    select set_config('request.jwt.claims', json_build_object('sub', %L, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
  $f$, current_setting('t.pown'))) is not null;
  select extensions.dblink_send_query('blocked', p_sql);
$$;

create function pg_temp.blocked_result() returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config('client_min_messages', 'warning', true);
  select r into v_result from extensions.dblink_get_result('blocked', false) as t (r text);
  if v_result is null then
    v_result := extensions.dblink_error_message('blocked');
  end if;
  perform r from extensions.dblink_get_result('blocked', false) as t (r text);
  perform extensions.dblink_exec('blocked', 'rollback');
  return v_result;
end;
$$;

select set_config('t.pown', :'pown', false) as setup_pown \gset
select is(pg_temp.hold(pg_temp.submit_sql(:'c_p', :'c_r', :'c_x1' || '@other.test')), 'awaiting_candidate',
  'a second session sends a request for P (limit 1 by override) and keeps its transaction open');
select is(pg_try_advisory_xact_lock(hashtextextended('candidate_submissions:' || :'c_p', 0)), false,
  'NFR-A4: the request in progress holds the advisory lock of the partner''s submissions');
select pg_temp.send_blocked(pg_temp.submit_sql(:'c_p', :'c_r', :'c_x2' || '@other.test')) as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1, 'NFR-A4: a third session''s request of the same partner at the same time waits');
select extensions.dblink_exec('holder', 'commit') as committed \gset
select matches(pg_temp.blocked_result(), 'CHARA_LIMIT_REACHED',
  'NFR-A4, FR-O4 AC3: once the first request is committed, the waiting one counts it and is refused at the limit');
select is(pg_temp.hold(pg_temp.submit_sql(:'c_p', :'c_r', :'c_x1' || '@other.test')), 'awaiting_candidate',
  'FR-O4 AC8: the same address again, at the limit, answers the committed request');
select extensions.dblink_exec('holder', 'rollback') as rolled_back \gset
select is(
  (select count(*)::integer from public.candidate_submissions where organization_id = :'c_p'),
  1, 'NFR-A4: one request of P, never more');
select extensions.dblink_disconnect('holder');
select extensions.dblink_disconnect('blocked');
select extensions.dblink_exec('setup', format($$
  begin;
  delete from public.workforce_requirements where organization_id = %2$L;
  delete from private.rate_limit_hits where (action, bucket) in (
    ('user:audited_write', (hashtextextended(%4$L, 0) & 2147483647)::integer),
    ('org:audited_write', (hashtextextended(%3$L, 0) & 2147483647)::integer));
  delete from billing.organization_limit_overrides where organization_id = %3$L;
  delete from billing.subscriptions where organization_id = %3$L;
  delete from public.organizations where id in (%2$L, %3$L);
  delete from auth.users where id in (%1$L, %4$L, %5$L, %6$L);
  update private.settings set value = 'false' where key in ('release_job_orders', 'release_candidate_submissions');
  commit;
$$, :'cown', :'org_c', :'c_p', :'pown', :'c_x1', :'c_x2'));
select extensions.dblink_disconnect('setup');
select is(
  (select count(*)::integer from public.organizations where id in (:'org_c', :'c_p'))
    + (select count(*)::integer from auth.users where id in (:'cown', :'pown', :'c_x1', :'c_x2')),
  0, 'the committed organisations of the concurrency test are removed again');

-- The fixture --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'true' where key in ('release_job_orders', 'release_candidate_submissions');
update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key = 'rate_limit_job_orders_max';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max');
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
update public.organizations set display_name = 'Acme Bau' where id = :'acme';
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (:'acme', 'employer_starter', 'active', 'null'), (:'beta', 'employer_starter', 'active', 'null');
select pg_temp.new_user(:'padm') as seeded \gset
update public.profiles set account_kind = intended_account_kind where id = :'padm';
select set_config('t.padm', :'padm', false) as setup_padm \gset
select pg_temp.new_user(:'stf') as seeded \gset
insert into public.platform_staff (user_id, role) values (:'stf', 'admin');
select pg_temp.new_user(:'wclosed', 'worker', 'closed@example.test') as seeded \gset
select pg_temp.new_user(:'wother', 'worker', 'other@example.test') as seeded \gset
update public.profiles set account_kind = intended_account_kind where id in (:'wclosed', :'wother');
update public.profiles set deleted_at = now() where id = :'wclosed';
select pg_temp.doc(:'d1', :'wa', 'clean', 'certificate') as seeded \gset
select pg_temp.doc(:'d2', :'wa', 'clean', 'cv') as seeded \gset
select pg_temp.doc(:'d3', :'wa', 'pending') as seeded \gset
select pg_temp.doc(:'dx', :'wb', 'clean') as seeded \gset

-- A listed partner serving Germany, sourcing from the Philippines and listing 7212 on p_plan, owned by p_owner (padm when
-- null); its owner accepted the commitment unless p_commit is false.
create function pg_temp.partner(p_slug text, p_owner uuid default null, p_plan text default 'recruitment_partner',
  p_commit boolean default true) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_owner uuid := coalesce(p_owner, current_setting('t.padm')::uuid);
begin
  if p_owner is not null then
    perform pg_temp.new_user(p_owner);
    update public.profiles set account_kind = intended_account_kind where id = p_owner;
  end if;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'recruitment_company', p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, v_owner, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code) values
    (v_id, 'serves_market', 'DE'), (v_id, 'sources_from', 'PH');
  insert into public.organization_occupations (organization_id, occupation_id) values (v_id, '7212');
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  end if;
  if p_commit and not private.partner_commitment_current(v_id) then
    insert into public.consents (user_id, purpose, version, action)
    values (v_owner, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
  end if;
  return v_id;
end;
$$;

create function pg_temp.member(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql as $$
begin
  perform pg_temp.new_user(p_user);
  update public.profiles set account_kind = intended_account_kind where id = p_user;
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (p_org, p_user, p_role::public.member_role, now());
end;
$$;

-- An open requirement of p_org on the marketplace, without the employer's name unless p_show.
create function pg_temp.req(p_org uuid, p_title text, p_status text default 'open', p_show boolean default false) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, skills, start_date,
    duration_months, employment_type, recruitment_preference, partner_need, status, visibility, show_identity,
    published_at, closes_on, close_reason
  ) values (
    v_id, p_org, p_title, 10, 'DE', 'Hamburg', 'C', 'MIG/MAG welding', date '2027-03-01', 12, 'full_time', 'both', 'both',
    p_status::public.requirement_status, 'job_order_marketplace', p_show, now() - interval '10 days', date '2027-04-01',
    case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

-- A response of p_partner to p_req in p_status, with submissions allowed when p_allowed.
create function pg_temp.resp(p_req uuid, p_partner uuid, p_status text, p_allowed boolean default false) returns uuid
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

-- submit_candidate as p_user for p_org: 'ok' with 'id|status|existing' in t.result, or 'sqlstate|message|detail'.
create function pg_temp.sub(p_user uuid, p_org uuid, p_req uuid, p_email text, p_note text default null) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', (select s.id || '|' || s.status || '|' || s.existing
       from public.submit_candidate(%L, %L, %L, %L) s), true)$f$, p_org, p_req, p_email, p_note), 'aal1')
$$;

create function pg_temp.result_id() returns uuid
language sql as $$ select split_part(current_setting('t.result'), '|', 1)::uuid $$;

-- A worker's answer as p_user: 'ok' with the status in t.result, or 'sqlstate|message|detail'.
create function pg_temp.answer(p_user uuid, p_fn text, p_sub uuid, p_docs uuid[] default null) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    case when p_fn = 'approve_submission'
      then format($f$select set_config('t.result', public.approve_submission(%L, %L::uuid[])::text, true)$f$, p_sub, p_docs)
      else format($f$select set_config('t.result', public.%I(%L)::text, true)$f$, p_fn, p_sub) end, 'aal1')
$$;

create function pg_temp.read_as(p_user uuid, p_sql text, p_aal text default 'aal1') returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text end, true);
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

-- An approved submission written as the database owner in p_status, with its granted consent and its share of p_docs.
create function pg_temp.seed_approved(p_req uuid, p_partner uuid, p_worker uuid, p_status text, p_docs uuid[]) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_share uuid := gen_random_uuid();
  v_employer uuid := (select r.organization_id from public.workforce_requirements r where r.id = p_req);
  v_consent bigint;
begin
  insert into public.consents (user_id, purpose, version, action)
  values (p_worker, 'share_passport:' || v_employer || ':submission:' || v_id, private.current_legal_version('sharing-notice'),
    'granted')
  returning id into v_consent;
  insert into public.candidate_submissions (
    id, requirement_id, organization_id, employer_organization_id, invited_email, worker_user_id, status, decided_at,
    worker_approved_at, passport_share_id, profile_snapshot
  ) values (
    v_id, p_req, p_partner, v_employer, v_id || '@seed.test', p_worker, p_status::public.submission_status, now(), now(),
    v_share, private.profile_snapshot(p_worker)
  );
  insert into public.passport_shares (id, worker_user_id, organization_id, submission_id, scope, consent_id)
  values (v_share, p_worker, v_employer, v_id, to_jsonb(p_docs), v_consent);
  return v_id;
end;
$$;

create function pg_temp.told(p_kind text, p_sub uuid) returns text
language sql as $$
  select coalesce(string_agg(n.user_id::text, ',' order by n.user_id), '')
  from public.notifications n where n.kind = p_kind and n.payload ->> 'submission_id' = p_sub::text
$$;

-- The row counts of everything a request or an answer writes, as one text, to compare before and after.
create function pg_temp.sub_counts() returns text
language sql as $$
  select (select count(*) from public.candidate_submissions) || ',' || (select count(*) from public.submission_events) || ','
      || (select count(*) from public.passport_shares) || ',' || (select count(*) from public.consents) || ','
      || (select count(*) from audit.log) || ',' || (select count(*) from pgmq.q_notifications)
$$;

select pg_temp.partner('s1-v48', :'u1') as s1 \gset
select pg_temp.member(:'s1', :'u1a', 'admin') as seeded \gset
select pg_temp.member(:'s1', :'u1m', 'member') as seeded \gset
select pg_temp.partner('s2-v48', :'u2') as s2 \gset
select pg_temp.partner('p1-v48') as p1 \gset
select pg_temp.partner('p2-v48') as p2 \gset
select pg_temp.partner('p3-v48') as p3 \gset
select pg_temp.partner('p4-v48', :'u4', p_commit => false) as p4 \gset
select pg_temp.partner('pf-v48', p_plan => null) as pf \gset
select pg_temp.partner('sl-v48') as sl \gset
select pg_temp.req(:'acme', 'Acme Hamburg welders') as r \gset
select pg_temp.req(:'acme', 'Acme second requirement') as r2 \gset
select pg_temp.req(:'beta', 'Beta welders', p_show => true) as rb \gset
select pg_temp.resp(:'r', :'s1', 'selected', true) as r_s1 \gset
select pg_temp.resp(:'r', :'s2', 'selected', true) as r_s2 \gset
select pg_temp.resp(:'r', :'p1', 'shortlisted') as r_p1 \gset
select pg_temp.resp(:'r', :'p2', 'declined') as r_p2 \gset
select pg_temp.resp(:'r', :'p4', 'selected', true) as r_p4 \gset
select pg_temp.resp(:'r', :'sl', 'selected', true) as r_sl \gset
select pg_temp.resp(:'r2', :'pf', 'selected', true) as r2_pf \gset
select pg_temp.resp(:'rb', :'s1', 'shortlisted', true) as rb_s1 \gset
select pg_temp.resp(:'rb', :'s2', 'selected', true) as rb_s2 \gset

\set wa_email '00000000-0000-0000-0000-00000000a101@example.test'
\set wb_email '00000000-0000-0000-0000-00000000a102@example.test'
\set own2_email '00000000-0000-0000-0000-00000000d004@example.test'

-- Structure ------------------------------------------------------------------------------------------------------------------

select is(
  (select array_agg(proname::text order by proname) from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('submit_candidate', 'approve_submission', 'decline_submission', 'withdraw_submission',
       'list_my_submission_requests', 'list_my_submissions', 'list_partner_submissions', 'list_requirement_submissions')
     and prosecdef and proconfig @> array['search_path=""']
     and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
     and not has_function_privilege('service_role', oid, 'execute')),
  array['approve_submission', 'decline_submission', 'list_my_submission_requests', 'list_my_submissions',
    'list_partner_submissions', 'list_requirement_submissions', 'submit_candidate', 'withdraw_submission'],
  'the functions are security definer with an empty search path, for authenticated callers only');
select is(
  (select string_agg(p.proname::text, ',' order by p.proname) from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('submission_transition_allowed', 'candidate_submissions_guard', 'candidate_submissions_immutable',
       'submission_history_reader', 'submission_events_append_only', 'submission_events_no_delete', 'queue_submission_event',
       'submission_candidate_title', 'assert_submitting_partner', 'submission_caller', 'submission_worker_for',
       'claim_submission_requests', 'pending_submission', 'expire_submission_requests')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  'submission_history_reader',
  'no API role executes the private helpers, except the check the policy of the history runs as the caller');
select is(
  (select string_agg(relname || ':' || relrowsecurity || ':' || relforcerowsecurity, ',' order by relname) from pg_class
   where oid in ('public.candidate_submissions'::regclass, 'public.submission_events'::regclass)),
  'candidate_submissions:true:true,submission_events:true:true', 'NFR-S8: RLS is enabled and forced on both tables');
select is(
  (select string_agg(attname::text, ',' order by attname) from pg_attribute
   where attrelid = 'public.candidate_submissions'::regclass and attnum > 0 and not attisdropped
     and has_column_privilege('authenticated', attrelid, attnum, 'select')),
  'created_at,decided_at,id,note,organization_id,requirement_id,response_id,status,updated_at,withdrawn_at,worker_approved_at',
  'NFR-S9: the address, the worker id, the employer, the member, the share and the snapshot are not readable through the Data API');
select is(
  (select string_agg(attname::text, ',' order by attname) from pg_attribute
   where attrelid = 'public.submission_events'::regclass and attnum > 0 and not attisdropped
     and has_column_privilege('authenticated', attrelid, attnum, 'select')),
  'created_at,from_status,id,submission_id,to_status', 'NFR-S9: nor who moved a submission');
select ok(
  not has_any_column_privilege('anon', 'public.candidate_submissions', 'select')
    and not has_any_column_privilege('anon', 'public.submission_events', 'select')
    and not has_table_privilege('authenticated', 'public.candidate_submissions', 'insert, update, delete')
    and not has_table_privilege('authenticated', 'public.submission_events', 'insert, update, delete')
    and not has_any_column_privilege('service_role', 'public.candidate_submissions', 'select, insert, update'),
  'NFR-S8: anonymous reads nothing, and no API role writes either table');
select is(
  (select string_agg(c.relname::text, ',' order by c.relname) from pg_index i join pg_class c on c.oid = i.indexrelid
   where i.indrelid = 'public.candidate_submissions'::regclass and i.indisunique and i.indpred is not null),
  'candidate_submissions_active_request_key,candidate_submissions_one_per_candidate',
  'FR-O4 AC8: one active request per partner, requirement and address, and one submission per candidate and requirement');
select is(
  (select pg_get_indexdef(i.indexrelid) ~ '\(requirement_id, worker_user_id\) WHERE .*awaiting_candidate.*declined_by_candidate.*expired.*withdrawn'
   from pg_index i where i.indexrelid = 'public.candidate_submissions_one_per_candidate'::regclass),
  true, 'FR-O4 AC8: the unique partial index on (requirement_id, worker_user_id) covers submitted and every later state but withdrawn');
select is(enum_range(null::public.submission_status)::text,
  '{awaiting_candidate,declined_by_candidate,expired,submitted,viewed,shortlisted,interview,offer,hired,rejected,withdrawn}',
  'DATA_MODEL.md section 5: the states of a submission, with the stages of an application after submitted');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'passport_shares_one_source'),
  'CHECK ((num_nonnulls(application_id, submission_id) = 1))', 'a share names exactly one of an application and a submission');
select throws_ok(
  format($$insert into public.passport_shares (worker_user_id, organization_id, scope, consent_id) values (%L, %L, '[]', 1)$$,
    :'wa', :'acme'),
  '23514', null, 'a share for neither is refused');
select is(
  (select string_agg(kind || ':' || mandatory || ':' || default_email || ':' || audience || ':'
     || coalesce(organization_types::text, '-'), ',' order by kind)
   from private.notification_kinds where kind like 'submission\_%' and kind <> 'submission_stage_changed'),
  'submission_approved:false:true:company:{employer,recruitment_company,staffing_company},'
    || 'submission_request:true:true:worker:-,submission_request_signup:true:true:worker:-,'
    || 'submission_withdrawn:false:true:company:{employer,recruitment_company,staffing_company}',
  'FR-O4, FR-T1: the request and its no-account variant are mandatory; the approval and the withdrawal optional with email on');
select is(
  (select string_agg(r.key || '=' || (s.value #>> '{}') || ':' || r.min || '..' || r.max, ',' order by r.key)
   from private.setting_rules r join private.settings s on s.key = r.key
   where r.key in ('candidate_submission_expiry_days', 'submission_signup_email_interval_days')),
  'candidate_submission_expiry_days=14:1..60,submission_signup_email_interval_days=7:1..30',
  'NFR-O5: the expiry (14 days) and the sign-up invitation interval (7 days) are settings with rules');
select is(
  (select string_agg(plan_code || ':' || limit_value, ',' order by limit_value) from billing.plan_limits
   where limit_key = 'candidate_submissions_per_month' and plan_code like 'recruitment\_%'),
  'recruitment_partner:25,recruitment_professional:100,recruitment_enterprise:500',
  'FR-O4 AC3: billing.plan_limits holds candidate_submissions_per_month 25, 100 and 500 for the three recruitment plans');
select is((select schedule || ' ' || command from cron.job where jobname = 'expire-submission-requests'),
  '30 0 * * * select private.expire_submission_requests()', 'the daily expiry job runs at 00:30 UTC');

-- AC1: a request ------------------------------------------------------------------------------------------------------------

select private.monthly_usage(:'s1', 'candidate_submissions_per_month') as used_before \gset
select is(pg_temp.sub(:'u1m', :'s1', :'r', :'wa_email', repeat('n', 300)), 'ok',
  'FR-O4 AC1: a member of S1 sends a request for W with a note of 300 characters');
select pg_temp.result_id() as sub_w \gset
select is(split_part(current_setting('t.result'), '|', 2) || '|' || split_part(current_setting('t.result'), '|', 3),
  'awaiting_candidate|false', 'the reply is the new request, awaiting the candidate');
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s', status, organization_id = :'s1', requirement_id = :'r', worker_user_id = :'wa',
     submitted_by = :'u1m', worker_approved_at is null, employer_organization_id = :'acme', response_id = :'r_s1')
   from public.candidate_submissions where id = :'sub_w'),
  'awaiting_candidate|t|t|t|t|t|t|t',
  'FR-O4 AC1: one row awaiting the candidate for S1 and R, with W, the member and no approval');
select is(private.monthly_usage(:'s1', 'candidate_submissions_per_month'), :used_before + 1, 'FR-O4 AC1: the usage grows by one');
select is(
  (select count(*)::integer from audit.log where action = 'submission.requested' and entity_id = :'sub_w' and actor_id = :'u1m'),
  1, 'FR-O4 AC1: one audit row submission.requested');
select is(
  (select string_agg(to_status::text || ':' || (actor_id = :'u1m'), ',') from public.submission_events where submission_id = :'sub_w'),
  'awaiting_candidate:true', 'the request is the first event');
select is(
  (select string_agg(user_id::text || ':' || mandatory, ',') from public.notifications
   where kind = 'submission_request' and payload ->> 'submission_id' = :'sub_w'),
  :'wa' || ':true', 'FR-O4 AC1, NFR-A3: one mandatory submission_request for W, in the same transaction');
select is(
  (select format('%s|%s|%s|%s', payload ->> 'partner_name', payload ->> 'title' = private.job_order_neutral_title(:'r'),
     payload ->> 'country_name', payload ? 'employer_name')
   from public.notifications where kind = 'submission_request' and payload ->> 'submission_id' = :'sub_w'),
  'S1 V48|t|Germany|f',
  'FR-O4 AC10, NFR-S11: it names the partner and the destination, and the generated title without the employer that hides its name');
select is(pg_temp.read_as(:'mem', format('select count(*) from public.candidate_submissions where requirement_id = %L', :'r')),
  '0', 'FR-O4 AC1: Acme''s members read 0 rows of it');
select is(pg_temp.read_as(:'own1', format('select count(*) from public.candidate_submissions where requirement_id = %L', :'r'), 'aal2'),
  '0', 'nor does the Acme owner at aal2');
select is(pg_temp.read_as(:'wa', format('select count(*) from public.candidate_submissions where id = %L', :'sub_w')), '1',
  'W reads its own request');
select matches(pg_temp.read_as(:'wa', format('select invited_email from public.candidate_submissions where id = %L', :'sub_w')),
  '^42501\|permission denied', 'NFR-S9: but not the address through the Data API');

-- AC2: the same reply whatever the address ------------------------------------------------------------------------------------

select is(pg_temp.sub(:'u1', :'s1', :'r', ' Nobody@Example.TEST '), 'ok', 'FR-O4 AC2: a request to an address with no account');
select pg_temp.result_id() as sub_none \gset
select split_part(current_setting('t.result'), '|', 2) || '|' || split_part(current_setting('t.result'), '|', 3) as reply_none \gset
select is(pg_temp.sub(:'u1', :'s1', :'r', :'own2_email'), 'ok', 'FR-O4 AC2: a request to the address of an employer owner');
select pg_temp.result_id() as sub_co \gset
select split_part(current_setting('t.result'), '|', 2) || '|' || split_part(current_setting('t.result'), '|', 3) as reply_co \gset
select is(pg_temp.sub(:'u1', :'s1', :'r', 'closed@example.test'), 'ok', 'FR-O4 AC2: a request to the address of a closed account');
select pg_temp.result_id() as sub_cl \gset
select split_part(current_setting('t.result'), '|', 2) || '|' || split_part(current_setting('t.result'), '|', 3) as reply_cl \gset
select is(:'reply_none' || ',' || :'reply_co' || ',' || :'reply_cl',
  'awaiting_candidate|false,awaiting_candidate|false,awaiting_candidate|false',
  'FR-O4 AC2: every call returns the same reply as the request for W: Request sent');
select is(
  (select array_agg(a order by n)::text from pg_proc p cross join unnest(p.proargnames) with ordinality x (a, n)
   where p.oid = 'public.submit_candidate(uuid, uuid, text, text)'::regprocedure),
  '{p_org,p_requirement,p_email,p_note,id,status,existing}',
  'FR-O4 AC2: the reply has no field that tells whether the address has an account, or of which kind');
select is(
  (select string_agg(coalesce(c.worker_user_id::text, '-'), ',' order by x.n) from public.candidate_submissions c
   join unnest(array[:'sub_w', :'sub_none', :'sub_co', :'sub_cl']::uuid[]) with ordinality x (id, n) on x.id = c.id),
  :'wa' || ',-,-,-', 'FR-O4 AC2: the worker id is filled for W only');
select is((select invited_email from public.candidate_submissions where id = :'sub_none'), 'nobody@example.test',
  'the address is stored trimmed and lower-cased');
select is(
  (select count(*)::integer from public.notifications n
   where n.kind = 'submission_request_signup' and n.user_id is null and n.dedupe_key = 'submission_request_signup:' || :'sub_none'),
  1, 'FR-O4 AC2, AC10: the address without an account receives an invitation to create a worker account');
select is(
  (select q.message ->> 'email' from pgmq.q_notifications q where q.message ->> 'dedupe_key' = 'submission_request_signup:' || :'sub_none'),
  'nobody@example.test', 'the invitation is queued to the address');
select is(
  (select format('%s|%s|%s', payload ->> 'partner_name', payload ->> 'country_name', payload ? 'submission_id')
   from public.notifications where dedupe_key = 'submission_request_signup:' || :'sub_none'),
  'S1 V48|Germany|f', 'FR-O4 AC10: it names the partner and the destination, and no request id (the page needs an account)');
select is(
  (select count(*)::integer from public.notifications n
   where n.dedupe_key like '%' || :'sub_co' or n.dedupe_key like '%' || :'sub_cl'
      or (n.user_id in (:'own2', :'wclosed') and n.kind like 'submission\_%')),
  0, 'FR-O4 AC2: the company and the closed account receive nothing');
select is(
  (select string_agg((c.invitation_emailed_at is not null)::text, ',' order by x.n) from public.candidate_submissions c
   join unnest(array[:'sub_w', :'sub_none', :'sub_co', :'sub_cl']::uuid[]) with ordinality x (id, n) on x.id = c.id),
  'false,true,false,false', 'the invitation is recorded on the request that sent it');
select is(pg_temp.sub(:'u2', :'s2', :'r', 'nobody@example.test'), 'ok', 'S2 sends a request to the same address');
select pg_temp.result_id() as sub_none2 \gset
select is(
  (select count(*)::integer from public.notifications where kind = 'submission_request_signup')
    || ':' || (select (invitation_emailed_at is null)::text from public.candidate_submissions where id = :'sub_none2'),
  '1:true', 'an address is invited at most once per submission_signup_email_interval_days, whichever partner asks');
select ok(
  not exists (select 1 from pg_proc p cross join unnest(p.proargnames) a
              where p.oid = 'public.list_partner_submissions(uuid, uuid, uuid, integer)'::regprocedure and a ~ 'user_id'),
  'FR-O4 AC2: the partner''s list has no worker id');

select pg_temp.sub_counts() as counts_before \gset
select is(pg_temp.sub(:'u1', :'s1', :'r', 'not-an-email'), 'P0001|CHARA_INVALID_INPUT|p_email', 'FR-O4 AC12: not an address');
select is(pg_temp.sub(:'u1', :'s1', :'r', repeat('a', 242) || '@example.test'), 'P0001|CHARA_INVALID_INPUT|p_email',
  'FR-O4 AC12: an address of 255 characters');
select is(pg_temp.sub(:'u1', :'s1', :'r', '  '), 'P0001|CHARA_INVALID_INPUT|p_email', 'no address');
select is(pg_temp.sub(:'u1', :'s1', :'r', 'note@example.test', repeat('x', 1001)), 'P0001|CHARA_INVALID_INPUT|p_note',
  'FR-O4 AC12: a note of 1,001 characters');
select is(pg_temp.sub(:'u1', :'s1', :'r', 'note@example.test', E'Hello\u0007'), 'P0001|CHARA_INVALID_INPUT|p_note',
  'a control character in the note');
select is(pg_temp.sub_counts(), :'counts_before', 'the refused requests write nothing');

-- AC3: the monthly limit ----------------------------------------------------------------------------------------------------------

-- SL has 24 requests this month: 19 awaiting, 3 declined by the candidate and 2 withdrawn.
insert into public.candidate_submissions (
  requirement_id, organization_id, employer_organization_id, invited_email, status, decided_at, worker_user_id,
  worker_approved_at, passport_share_id, profile_snapshot, withdrawn_at
)
select :'r2', :'sl', :'acme', 'seed' || g || '@limit.test',
  (case when g <= 19 then 'awaiting_candidate' when g <= 22 then 'declined_by_candidate' else 'withdrawn' end)::public.submission_status,
  case when g > 19 then now() end, case when g > 22 then gen_random_uuid() end, case when g > 22 then now() end,
  case when g > 22 then gen_random_uuid() end, case when g > 22 then '{}'::jsonb end, case when g > 22 then now() end
from generate_series(1, 24) g;
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(private.monthly_usage(:'sl', 'candidate_submissions_per_month'), 24,
  'FR-O4 AC3: declined and withdrawn requests still count');
select is(split_part(pg_temp.sub(:'padm', :'sl', :'r', 'limit25@example.test'), '|', 1), 'ok', 'FR-O4 AC3: the 25th succeeds');
select pg_temp.sub_counts() as counts_before \gset
select is(pg_temp.sub(:'padm', :'sl', :'r', 'limit26@example.test'), 'P0001|CHARA_LIMIT_REACHED|candidate_submissions_per_month',
  'FR-O4 AC3: the 26th fails with CHARA_LIMIT_REACHED');
select is(pg_temp.sub_counts(), :'counts_before', 'and writes and counts nothing');
select is(pg_temp.sub(:'padm', :'sl', :'r', 'limit25@example.test') || ':' || split_part(current_setting('t.result'), '|', 3), 'ok:true',
  'FR-O4 AC8: at the limit, the same address again answers the existing request');
select is(pg_temp.sub(:'padm', :'pf', :'r2', 'free@example.test'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|job_order_access',
  'FR-O4 AC3: P on free_recruitment_company, selected on another requirement, fails with CHARA_FEATURE_NOT_IN_PLAN');
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(split_part(pg_temp.sub(:'padm', :'sl', :'r', 'limit26@example.test'), '|', 1), 'ok',
  'FR-O4 AC3: with entitlements_enforced false no request is refused for the limit');
select is(pg_temp.sub(:'padm', :'pf', :'r2', 'free@example.test'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|job_order_access',
  'decision 3.6: a free partner plan is refused in both states of entitlements_enforced');

-- AC4: who may send ---------------------------------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme closed requirement', 'closed') as rc \gset
select pg_temp.resp(:'rc', :'s1', 'selected', true) as rc_s1 \gset
select pg_temp.sub_counts() as counts_before \gset
select is(pg_temp.sub(:'padm', :'p1', :'r', 'ac4@example.test'), '42501|CHARA_FORBIDDEN|submissions_not_open',
  'FR-O4 AC4: P1, shortlisted without submissions allowed, is refused');
select is(pg_temp.sub(:'padm', :'p2', :'r', 'ac4@example.test'), '42501|CHARA_FORBIDDEN|submissions_not_open',
  'FR-O4 AC4: P2, declined, is refused');
select is(pg_temp.sub(:'padm', :'p3', :'r', 'ac4@example.test'), '42501|CHARA_FORBIDDEN|submissions_not_open',
  'FR-O4 AC4: P3, without a response, is refused');
select is(pg_temp.sub(:'u4', :'p4', :'r', 'ac4@example.test'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'FR-O4 AC4: P4, selected without the current employer-pays commitment, is refused');
select is(pg_temp.sub(:'u1', :'s1', :'rc', 'ac4@example.test'), 'P0001|CHARA_INVALID_STATE|requirement_not_open',
  'FR-O4 AC4: S1 on the closed requirement is refused');
select is(pg_temp.sub(:'u1', :'s1', gen_random_uuid(), 'ac4@example.test'), 'P0002|CHARA_NOT_FOUND|', 'an unknown requirement');
select is(pg_temp.sub(:'own1', :'acme', :'r', 'ac4@example.test'), '42501|CHARA_FORBIDDEN|partner_only',
  'the employer cannot submit candidates');
select is(split_part(pg_temp.sub(:'u2', :'s1', :'r', 'ac4@example.test'), '|', 2), 'CHARA_FORBIDDEN',
  'NFR-S8: the owner of S2 cannot send for S1');
select is(split_part(pg_temp.sub(:'wa', :'s1', :'r', 'ac4@example.test'), '|', 2), 'CHARA_FORBIDDEN', 'nor can a candidate');
select is(pg_temp.sub(null, :'s1', :'r', 'ac4@example.test'), '42501|permission denied for function submit_candidate|',
  'nor an anonymous caller');
select is(pg_temp.sub_counts(), :'counts_before', 'FR-O4 AC4: nothing is written or counted for the refused calls');
update public.partner_responses set submissions_allowed = true where id = :'r_p1';
select is(split_part(pg_temp.sub(:'padm', :'p1', :'r', 'ac4@example.test'), '|', 1), 'ok',
  'FR-O3 step Open submissions: once the employer allows them, P1 submits');

-- AC5: the candidate approves ---------------------------------------------------------------------------------------------------

select private.job_order_neutral_title(:'r') as neutral_r \gset
select is(
  pg_temp.read_as(:'wa', format($$select format('%%s|%%s|%%s|%%s|%%s', partner_name, title = %L,
      country_name, coalesce(employer_name, '-'), char_length(note))
    from public.list_my_submission_requests() where id = %L$$, :'neutral_r', :'sub_w')),
  'S1 V48|t|Germany|-|300',
  'FR-O4 AC5: the request names the partner, the requirement, the destination and the note; no employer that hides its name');
select pg_temp.sub_counts() as counts_before \gset
select is(pg_temp.answer(:'wa', 'approve_submission', :'sub_w', array[:'d3']::uuid[]), 'P0001|CHARA_DOCUMENT_NOT_SCANNED|',
  'a document not scanned clean cannot be shared');
select is(pg_temp.answer(:'wa', 'approve_submission', :'sub_w', array[:'dx']::uuid[]), 'P0002|CHARA_NOT_FOUND|',
  'nor another candidate''s document');
select is(pg_temp.answer(:'wa', 'approve_submission', :'sub_w', array[null]::uuid[]), 'P0001|CHARA_INVALID_INPUT|p_document_ids',
  'nor a null id');
select is(pg_temp.answer(:'wb', 'approve_submission', :'sub_w', array[:'dx']::uuid[]), 'P0002|CHARA_NOT_FOUND|',
  'another worker cannot approve W''s request');
select is(pg_temp.answer(:'u1', 'approve_submission', :'sub_w'), 'P0002|CHARA_NOT_FOUND|', 'nor can the partner');
select is(pg_temp.sub_counts(), :'counts_before', 'the refused approvals write nothing');
select is(pg_temp.answer(:'wa', 'approve_submission', :'sub_w', array[:'d2', :'d1', :'d1']::uuid[]) || ':' || current_setting('t.result'),
  'ok:submitted', 'FR-O4 AC5: W approves with the welding certificate and the reference letter');
select is(
  (select format('%s|%s|%s|%s', status, worker_approved_at is not null and decided_at is not null,
     profile_snapshot ->> 'first_name', passport_share_id is not null)
   from public.candidate_submissions where id = :'sub_w'),
  'submitted|t|Amina|t', 'FR-O4 AC5: the status is submitted, worker_approved_at is set and a profile snapshot is stored');
select is(
  (select format('%s|%s|%s', count(*), max(action::text), bool_and(version = private.current_legal_version('sharing-notice')))
   from public.consents where user_id = :'wa' and purpose = 'share_passport:' || :'acme' || ':submission:' || :'sub_w'),
  '1|granted|t', 'FR-O4 AC5: one consents row share_passport:<org>:submission:<id>, granted, at the version of the sharing notice');
select is(
  (select format('%s|%s|%s|%s|%s', s.organization_id = :'acme', s.submission_id = :'sub_w', s.application_id is null,
     s.scope = to_jsonb(array(select unnest(array[:'d1', :'d2']::uuid[]) order by 1)), s.id = c.passport_share_id)
   from public.passport_shares s join public.candidate_submissions c on c.id = s.submission_id where s.submission_id = :'sub_w'),
  't|t|t|t|t', 'FR-O4 AC5: one passport_shares row for Acme with the submission id and the two documents');
select is(
  (select metadata::text from audit.log where action = 'share.created'
   and entity_id = (select passport_share_id::text from public.candidate_submissions where id = :'sub_w')),
  jsonb_build_object('organization_id', :'acme', 'submission_id', :'sub_w')::text,
  'NFR-C1: the share''s audit row names the organisation and the submission, never a document or a person');
select is(
  (select count(*)::integer from audit.log where action = 'submission.approved' and entity_id = :'sub_w' and actor_id = :'wa'),
  1, 'one audit row submission.approved');
select is(pg_temp.told('submission_approved', :'sub_w'),
  (select string_agg(x::text, ',' order by x) from unnest(array[:'u1', :'u1a', :'own1', :'adm']::uuid[]) x),
  'FR-O4 AC5, NFR-A3: submission_approved is queued for the owner and admins of S1 and of Acme, not their members');
select is(
  (select string_agg((user_id = :'own1')::text || ':' || (payload ->> 'title'), ',' order by user_id = :'own1')
   from public.notifications where kind = 'submission_approved' and payload ->> 'submission_id' = :'sub_w'
     and user_id in (:'u1', :'own1')),
  'false:' || private.job_order_neutral_title(:'r') || ',true:Acme Hamburg welders',
  'NFR-S11: the employer reads its own title, the partner the title it knows');
select is(
  (select string_agg((user_id = :'own1')::text || ':' || (payload ->> 'to_partner'), ',' order by user_id = :'own1')
   from public.notifications where kind = 'submission_approved' and payload ->> 'submission_id' = :'sub_w'
     and user_id in (:'u1', :'own1')),
  'false:true,true:false',
  'FR-O4 AC5: the partner''s notice says it is to the partner, so it reads "a candidate you proposed"');
select ok(
  not exists (select 1 from public.notifications where kind = 'submission_approved'
              and payload ?| array['candidate_name', 'first_name', 'invited_email', 'email', 'worker_user_id']),
  'NFR-S9: the notice names no candidate and no address');
select is(pg_temp.answer(:'wa', 'approve_submission', :'sub_w'), 'P0001|CHARA_INVALID_STATE|submitted', 'an answered request cannot be approved again');

-- AC6: the employer sees approved submissions only --------------------------------------------------------------------------------

select is(pg_temp.sub(:'u2', :'s2', :'r', :'wb_email'), 'ok', 'S2 sends a request for W2');
select pg_temp.result_id() as sub_wb_s2 \gset
select is(pg_temp.read_as(:'mem', format('select string_agg(id::text, '','') from public.candidate_submissions where requirement_id = %L', :'r')),
  :'sub_w', 'FR-O4 AC6: an Acme member reads only the submitted row');
select is(pg_temp.read_as(:'mem', format('select count(*) from public.passport_shares where submission_id = %L', :'sub_w')), '0',
  'FR-O4 AC6: and no passport share');
select is(pg_temp.read_as(:'mem', format('select count(*) from public.submission_events where submission_id in (%L, %L)', :'sub_w', :'sub_none')),
  '2', 'the history of the approved submission only');
select is(pg_temp.read_as(:'own1', format('select count(*) from public.candidate_submissions where requirement_id = %L', :'r'), 'aal1'),
  '0', 'the Acme owner at aal1 reads none, as for applicants');
select is(pg_temp.read_as(:'mem', format($$select format('%%s|%%s|%%s|%%s', partner_name, candidate_name, profile_snapshot ->> 'last_name', status)
    from public.list_requirement_submissions(%L, %L)$$, :'acme', :'r')),
  'S1 V48|Amina Okafor|Okafor|submitted', 'FR-O4 step Deliver: the pipeline lists the approved candidate with the partner''s name');
select ok(
  not exists (select 1 from pg_proc p cross join unnest(p.proargnames) a
              where p.oid = 'public.list_requirement_submissions(uuid, uuid)'::regprocedure and a ~ 'email|user_id'),
  'NFR-S9: the employer''s list has no address and no worker id');
select is(pg_temp.read_as(:'own1', format('select count(*) from public.list_requirement_submissions(%L, %L)', :'acme', :'r'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'the Acme owner at aal1 is sent to two-step verification');
select is(pg_temp.read_as(:'own2', format('select count(*) from public.list_requirement_submissions(%L, %L)', :'beta', :'r'), 'aal2'),
  'P0002|CHARA_NOT_FOUND|', 'NFR-S8: Beta cannot list Acme''s requirement');
select is(pg_temp.read_as(:'u1', format('select count(*) from public.list_requirement_submissions(%L, %L)', :'s1', :'r')),
  '42501|CHARA_FORBIDDEN|employer_only', 'the partner has no employer list');
select count(*)::integer as log_before from audit.document_access_log \gset
select is(pg_temp.call_as(:'mem', 'authenticated', format($$select * from public.document_access_grant(%L, 'submission_review')$$, :'d1'), 'aal1'),
  'ok', 'an Acme member opens a shared document of the approved submission');
select is(
  (select format('%s|%s|%s', purpose, organization_id = :'acme', share_id = (select passport_share_id from public.candidate_submissions where id = :'sub_w'))
   from audit.document_access_log where accessed_by = :'mem' and document_id = :'d1'),
  'submission_review|t|t', 'DATA_MODEL.md section 4: the opening is logged as submission_review for the employer''s share');
select is(pg_temp.call_as(:'mem', 'authenticated', format($$select * from public.document_access_grant(%L, 'application_review')$$, :'d1'), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'a submission share is not an application share');
select is(pg_temp.call_as(:'mem', 'authenticated', format($$select * from public.document_access_grant(%L, 'submission_review')$$, :'d3'), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'a document W did not choose is not opened');
select is(pg_temp.call_as(:'mem', 'authenticated', format($$select * from public.document_access_grant(%L, 'submission_review')$$, :'dx'), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'FR-O4 AC6: nor a document of the awaiting candidate W2');
select is(pg_temp.call_as(:'u1', 'authenticated', format($$select * from public.document_access_grant(%L, 'submission_review')$$, :'d1'), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'DATA_MODEL.md section 10: the partner never opens candidate documents');
select is(pg_temp.call_as(:'own2', 'authenticated', format($$select * from public.document_access_grant(%L, 'submission_review')$$, :'d1'), 'aal2'),
  '42501|CHARA_FORBIDDEN|', 'NFR-S8: nor does Beta');
select is((select count(*)::integer from audit.document_access_log), :log_before + 1, 'FR-O4 AC6: the refusals write no access-log row');

-- AC7: the candidate declines ------------------------------------------------------------------------------------------------

select is(pg_temp.sub(:'u1', :'s1', :'rb', :'wb_email'), 'ok', 'S1 sends a request for W2 to Beta''s requirement');
select pg_temp.result_id() as sub_wb \gset
select pg_temp.sub_counts() as counts_before \gset
select is(pg_temp.answer(:'wother', 'decline_submission', :'sub_wb'), 'P0002|CHARA_NOT_FOUND|',
  'FR-O4 AC7: another worker is refused with CHARA_NOT_FOUND');
select is(pg_temp.answer(:'u1m', 'decline_submission', :'sub_wb'), 'P0002|CHARA_NOT_FOUND|',
  'FR-O4 AC7: a member of S1 is refused with CHARA_NOT_FOUND');
select is(pg_temp.answer(null, 'decline_submission', :'sub_wb'), '42501|permission denied for function decline_submission|',
  'an anonymous caller lacks EXECUTE');
select is(pg_temp.sub_counts(), :'counts_before', 'the refusals write nothing');
select is(pg_temp.answer(:'wb', 'decline_submission', :'sub_wb') || ':' || current_setting('t.result'), 'ok:declined_by_candidate',
  'FR-O4 AC7: W2 declines');
select is(pg_temp.sub_counts(),
  (select string_agg(case when n = 2 or n = 5 then (v::bigint + 1)::text else v end, ',' order by n)
   from unnest(string_to_array(:'counts_before', ',')) with ordinality x (v, n)),
  'FR-O4 AC7: one event and one audit row; no consent, share or notification');
select is((select format('%s|%s', status, decided_at is not null) from public.candidate_submissions where id = :'sub_wb'),
  'declined_by_candidate|t', 'the status is declined_by_candidate with the time');
select is(pg_temp.read_as(:'u1', format('select format(''%%s|%%s|%%s'', status, invited_email, coalesce(candidate_name, ''-'')) from public.list_partner_submissions(%L) where id = %L', :'s1', :'sub_wb')),
  'declined_by_candidate|' || :'wb_email' || '|-', 'FR-O4 AC7, AC12: S1''s list shows Declined by candidate and the address entered');
select is(pg_temp.read_as(:'mem', format('select count(*) from public.candidate_submissions where id = %L', :'sub_wb')), '0',
  'FR-O4 AC6: nothing of a declined request reaches the employer');
select is(pg_temp.answer(:'wb', 'decline_submission', :'sub_wb'), 'P0001|CHARA_INVALID_STATE|declined_by_candidate',
  'a declined request is final');

-- AC8: one submission per candidate and requirement ------------------------------------------------------------------------

select is(pg_temp.sub(:'u2', :'s2', :'r', :'wa_email'), 'ok', 'FR-O4 AC8: S2 sends a request for W''s address');
select pg_temp.result_id() as sub_w_s2 \gset
select is(split_part(current_setting('t.result'), '|', 2) || '|' || split_part(current_setting('t.result'), '|', 3),
  'awaiting_candidate|false', 'FR-O4 AC8: S2 gets the same neutral reply as any other and learns nothing of S1''s submission');
select is(pg_temp.read_as(:'wa', format('select submitted_by_partner from public.list_my_submission_requests() where id = %L', :'sub_w_s2')),
  'S1 V48', 'FR-O4 AC8: W reads that S1 already proposed it for this requirement');
select is(pg_temp.answer(:'wa', 'approve_submission', :'sub_w_s2'), 'P0001|CHARA_CONFLICT|already_submitted',
  'FR-O4 AC8: W''s approval of S2''s request is refused with CHARA_CONFLICT');
select private.monthly_usage(:'s1', 'candidate_submissions_per_month') as used_before \gset
select is(pg_temp.sub(:'u1', :'s1', :'r', upper(:'wa_email')) || ':' || current_setting('t.result'), 'ok:' || :'sub_w' || '|submitted|true',
  'FR-O4 AC8: S1''s second request for the same address and requirement returns the existing submission');
select is(private.monthly_usage(:'s1', 'candidate_submissions_per_month'), :used_before, 'and counts nothing');
select is(pg_temp.answer(:'wa', 'decline_submission', :'sub_w_s2'), 'ok', 'FR-O4 AC8: W declines S2''s request');

-- AC9: the candidate withdraws ----------------------------------------------------------------------------------------------

select pg_temp.seed_approved(:'r2', :'s2', :'wb', 'interview', array[:'dx']::uuid[]) as sub_int \gset
select pg_temp.seed_approved(:'r', :'s1', :'wb', 'hired', array[:'dx']::uuid[]) as sub_hired \gset
select is(pg_temp.call_as(:'mem', 'authenticated', format($$select * from public.document_access_grant(%L, 'submission_review')$$, :'dx'), 'aal1'),
  'ok', 'Acme reads W2''s shared document while the submissions in interview and hired stand');
select is(pg_temp.answer(:'u1m', 'withdraw_submission', :'sub_w'), 'P0002|CHARA_NOT_FOUND|',
  'FR-O4 AC9: a member of S1 calling withdraw_submission is refused with CHARA_NOT_FOUND');
select is(pg_temp.answer(:'wb', 'withdraw_submission', :'sub_w'), 'P0002|CHARA_NOT_FOUND|', 'so is another candidate');
select count(*)::integer as log_before from audit.document_access_log \gset
select is(
  pg_temp.answer(:'wa', 'withdraw_submission', :'sub_w') || pg_temp.answer(:'wb', 'withdraw_submission', :'sub_int')
    || pg_temp.answer(:'wb', 'withdraw_submission', :'sub_hired'),
  'okokok', 'FR-O4 AC9: the candidates withdraw the submissions in submitted, interview and hired');
select is(
  (select string_agg(format('%s|%s|%s', c.status, c.withdrawn_at is not null, s.revoked_at is not null), ',')
   from public.candidate_submissions c join public.passport_shares s on s.submission_id = c.id
   where c.id in (:'sub_w', :'sub_int', :'sub_hired')),
  'withdrawn|t|t,withdrawn|t|t,withdrawn|t|t',
  'FR-O4 AC9: each becomes withdrawn and passport_shares.revoked_at is set at once');
select is(
  (select count(*)::integer from public.consents w join public.passport_shares s on true
   join public.consents g on g.id = s.consent_id
   where s.submission_id in (:'sub_w', :'sub_int', :'sub_hired') and w.user_id = g.user_id and w.purpose = g.purpose
     and w.version = g.version and w.action = 'withdrawn' and w.id > g.id),
  3, 'FR-O4 AC9, NFR-C4: a withdrawn consents row is written for each');
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$select * from public.document_access_grant(%L, 'submission_review')$$, :'d1'), 'aal1')
    || ',' || pg_temp.call_as(:'mem', 'authenticated', format($$select * from public.document_access_grant(%L, 'submission_review')$$, :'dx'), 'aal1'),
  '42501|CHARA_FORBIDDEN|,42501|CHARA_FORBIDDEN|', 'FR-O4 AC9: document_access_grant then refuses with CHARA_FORBIDDEN');
select is((select count(*)::integer from audit.document_access_log), :log_before, 'FR-O4 AC9: and writes no access-log row');
select is(pg_temp.told('submission_withdrawn', :'sub_w'),
  (select string_agg(x::text, ',' order by x) from unnest(array[:'u1', :'u1a', :'own1', :'adm']::uuid[]) x),
  'FR-O4 AC9, NFR-A3: the owners and admins of Acme and S1 are told (submission_withdrawn)');
select is(pg_temp.read_as(:'mem', format($$select format('%%s|%%s', status, profile_snapshot is null)
    from public.list_requirement_submissions(%L, %L) where id = %L$$, :'acme', :'r', :'sub_w')),
  'withdrawn|t', 'FR-O4 AC9: the employer''s pipeline shows Withdrawn, without the snapshot');
select is(
  (select string_agg(from_status || '>' || to_status, ',' order by id) from public.submission_events where submission_id = :'sub_w'),
  'awaiting_candidate>submitted,submitted>withdrawn', 'the history holds the approval and the withdrawal');
select is(pg_temp.answer(:'wa', 'withdraw_submission', :'sub_w'), 'P0001|CHARA_INVALID_STATE|withdrawn', 'a withdrawal is final');
select is(pg_temp.sub(:'u1', :'s1', :'rb', 'other@example.test'), 'ok', 'S1 sends a request to another worker');
select pg_temp.result_id() as sub_other \gset
select is(pg_temp.answer(:'wother', 'withdraw_submission', :'sub_other'), 'P0001|CHARA_INVALID_STATE|awaiting_candidate',
  'a request not approved is declined, not withdrawn');
select is(pg_temp.read_as(:'wa', format('select format(''%%s|%%s'', status, partner_name) from public.list_my_submissions() where id = %L', :'sub_w')),
  'withdrawn|S1 V48', 'the candidate''s own list shows the withdrawal');

-- The guard of the states -------------------------------------------------------------------------------------------------

select throws_ok(format($$update public.candidate_submissions set status = 'interview' where id = %L$$, :'sub_other'),
  'CHARA_INVALID_TRANSITION', 'a request cannot jump to a stage');
select throws_ok(format($$update public.candidate_submissions set status = 'submitted' where id = %L$$, :'sub_w'),
  'CHARA_INVALID_TRANSITION', 'a withdrawn submission is final');
select throws_ok(format($$update public.candidate_submissions set invited_email = 'x@example.test' where id = %L$$, :'sub_other'),
  'CHARA_INVALID_INPUT', 'the address never changes');
select throws_ok(format($$update public.submission_events set to_status = 'hired' where submission_id = %L$$, :'sub_w'),
  'CHARA_INVALID_INPUT', 'the history is append-only');
select throws_ok(format($$delete from public.submission_events where submission_id = %L$$, :'sub_w'),
  'CHARA_INVALID_INPUT', 'and no event is deleted on its own');

-- AC10: an address that becomes an account; the expiry ------------------------------------------------------------------------

select pg_temp.new_user(:'wlate', 'worker', 'nobody@example.test') as seeded \gset
update public.profiles set account_kind = intended_account_kind where id = :'wlate';
select is(pg_temp.read_as(:'wother', 'select count(*) from public.list_my_submission_requests()'), '1',
  'FR-O4 AC10: a person with another address sees only the request to its own');
select is(pg_temp.read_as(:'wlate', 'select string_agg(partner_name, '','' order by partner_name) from public.list_my_submission_requests()'),
  'S1 V48,S2 V48', 'FR-O4 AC10: after confirming the account the pending requests to the address appear');
select is((select count(*)::integer from public.candidate_submissions where id in (:'sub_none', :'sub_none2') and worker_user_id = :'wlate'),
  2, 'and are linked to the account');

insert into public.candidate_submissions (id, requirement_id, organization_id, employer_organization_id, invited_email, worker_user_id, created_at)
values (gen_random_uuid(), :'r', :'s1', :'acme', 'other@example.test', :'wother', now() - interval '15 days');
select id as sub_old from public.candidate_submissions where worker_user_id = :'wother' and created_at < now() - interval '14 days' \gset
select is(pg_temp.answer(:'wother', 'approve_submission', :'sub_old'), 'P0001|CHARA_INVALID_STATE|expired',
  'a request older than candidate_submission_expiry_days cannot be approved before the job runs');
select is(pg_temp.read_as(:'wother', format('select count(*) from public.list_my_submission_requests() where id = %L', :'sub_old')), '0',
  'nor is it listed');
select is(private.expire_submission_requests(), 1, 'the daily job expires the one request older than 14 days');
select is(
  (select format('%s|%s', c.status, c.decided_at is not null) || '|'
     || (select string_agg(coalesce(e.actor_id::text, 'system') || ':' || e.to_status, ',') from public.submission_events e where e.submission_id = c.id)
     || '|' || (select count(*) from audit.log a where a.action = 'submission.expired' and a.entity_id = c.id::text)
   from public.candidate_submissions c where c.id = :'sub_old'),
  'expired|t|system:expired|1', 'it becomes expired with an event without actor and one audit row');
select is((select status::text from public.candidate_submissions where id = :'sub_other'), 'awaiting_candidate',
  'a recent request keeps waiting');

-- NFR-S8: two employers, two partners, two candidates and anonymous ------------------------------------------------------------

select is(pg_temp.read_as(:'u2', format('select count(*) from public.candidate_submissions where organization_id = %L', :'s1')), '0',
  'NFR-S8: S2 reads none of S1''s submissions');
select is(pg_temp.read_as(:'u2', format('select count(*) from public.list_partner_submissions(%L) where id = %L', :'s2', :'sub_w')), '0',
  'NFR-S8: nor through its own list');
select is(split_part(pg_temp.read_as(:'u2', format('select count(*) from public.list_partner_submissions(%L)', :'s1')), '|', 2),
  'CHARA_FORBIDDEN', 'NFR-S8: nor S1''s list');
select is(pg_temp.read_as(:'u1', format('select count(*) from public.submission_events where submission_id = %L', :'sub_w')), '0',
  'DATA_MODEL.md section 6: the partner reads the stages through its list, not the history');
select is(pg_temp.read_as(:'own2', format('select count(*) from public.candidate_submissions where requirement_id in (%L, %L)', :'r', :'r2'), 'aal2'),
  '0', 'NFR-S8: Beta reads none of Acme''s submissions');
select is(pg_temp.read_as(:'own2', format('select count(*) from public.submission_events where submission_id = %L', :'sub_hired'), 'aal2'), '0',
  'NFR-S8: nor their history');
select is(pg_temp.read_as(:'wb', format('select count(*) from public.candidate_submissions where id in (%L, %L)', :'sub_w', :'sub_w_s2')), '0',
  'NFR-S8: W2 reads none of W''s submissions');
select is(pg_temp.read_as(:'wb', 'select count(*) from public.list_my_submissions()'), '3',
  'W2''s own list holds its own three answered submissions');
select is(pg_temp.read_as(:'stf', 'select count(*) from public.candidate_submissions'), '0',
  'FR-O4: platform staff have no read path to submissions');
select matches(pg_temp.read_as(null, 'select count(*) from public.candidate_submissions'), '^42501\|permission denied',
  'NFR-S8: anonymous reads nothing');
select matches(pg_temp.read_as(null, 'select count(*) from public.submission_events'), '^42501\|permission denied',
  'NFR-S8: nor the history');
select is(pg_temp.read_as(:'u1', format($$select format('%%s|%%s', coalesce(invited_email, '-'), candidate_name)
    from public.list_partner_submissions(%L, %L) where id = %L$$, :'s1', :'r', :'sub_w')),
  '-|Amina Okafor', 'FR-O4 AC12: after approval the partner reads the candidate''s name, no longer the address');
select is(pg_temp.read_as(:'u1', format($$select string_agg(id::text, ',' order by created_at desc, id) from public.list_partner_submissions(%L, p_limit => 2)$$, :'s1'))
    = pg_temp.read_as(:'u1', format($$select string_agg(id::text, ',') from (select id from public.candidate_submissions where organization_id = %L order by created_at desc, id limit 2) x$$, :'s1')),
  true, 'the partner''s list pages newest first');

-- The release switch --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_candidate_submissions';
select is(pg_temp.sub(:'u1', :'s1', :'r', 'release@example.test'), '42501|CHARA_FORBIDDEN|release_off',
  'nothing is sent while release_candidate_submissions is off');
select is(pg_temp.answer(:'wother', 'decline_submission', :'sub_other'), '42501|CHARA_FORBIDDEN|release_off', 'nor answered');
select is(pg_temp.read_as(:'wother', 'select count(*) from public.list_my_submission_requests()'), '42501|CHARA_FORBIDDEN|release_off',
  'nor listed');
select is(pg_temp.read_as(:'mem', format('select count(*) from public.list_requirement_submissions(%L, %L)', :'acme', :'r')),
  '42501|CHARA_FORBIDDEN|release_off', 'nor read by the employer');
update private.settings set value = 'true' where key = 'release_candidate_submissions';

select * from finish();
rollback;
