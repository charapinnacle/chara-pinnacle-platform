begin;
select plan(196);

\ir jobs_fixture.inc

-- Partner responses, data (V44, FR-N2 AC2, AC3, AC5 to AC8, AC10 and the data of AC1, AC4, AC9, AC12; FR-O2 AC1, AC3, AC4,
-- AC7, AC8 and the data of AC9; FR-J2 AC9; FR-O1 step Track (accepted -> responded); FR-M2 AC6 P5 and FR-T1 AC1, AC2, AC4,
-- AC6 for the responders; SOP P2-20 and P2-22; decisions 2.2, 2.6, 3.2, 3.3, 3.6, 4.5; NFR-S8, NFR-S11, NFR-A3, NFR-A4):
-- public.partner_responses, public.partner_response_versions, respond_to_invitation, update_response, withdraw_response,
-- get_response_eligibility, list_my_responses, get_response, list_requirement_responses, list_response_versions,
-- list_response_changes, set_requirement_capacity_tolerance, the monthly count, the response count of the job orders, the
-- kinds response_received and response_withdrawn, and the marketplace responders as recipients of the notices of V43.
-- Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner own2, admin adm2) are employers of the fixture and
-- wkr is a candidate; the partners are made below.

\set u1 '00000000-0000-0000-0000-0000000f4411'
\set u1a '00000000-0000-0000-0000-0000000f4412'
\set u1m '00000000-0000-0000-0000-0000000f4413'
\set u2 '00000000-0000-0000-0000-0000000f4414'
\set uq2 '00000000-0000-0000-0000-0000000f4415'
\set us1 '00000000-0000-0000-0000-0000000f4416'
\set u1s '00000000-0000-0000-0000-0000000f4417'
\set adms '00000000-0000-0000-0000-0000000f4418'
\set padm '00000000-0000-0000-0000-0000000f4419'
\set cown '00000000-0000-0000-0000-0000000f4490'
\set org_c '00000000-0000-0000-0000-0000000f4491'
\set c_r1 '00000000-0000-0000-0000-0000000f4492'
\set c_r2 '00000000-0000-0000-0000-0000000f4493'
\set c_p '00000000-0000-0000-0000-0000000f4494'
\set c_q '00000000-0000-0000-0000-0000000f4495'
\set pown '00000000-0000-0000-0000-0000000f4496'
\set c_r3 '00000000-0000-0000-0000-0000000f4497'

-- Concurrency (NFR-A4, FR-N2 AC5, AC12) first, before this transaction writes a settings row the committed setup changes --

create extension if not exists dblink schema extensions;
select extensions.dblink_connect('setup',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('blocked',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
-- An employer with two job orders of the marketplace and a private requirement R3, and two eligible partners whose owner
-- pown accepted the commitment (a consent row cannot be deleted, so that one row of the committed owner stays); Q holds
-- an invitation to R3 it has seen. The employer's owner has a suspended account, so no notification of the committed
-- responses is queued. P (Enterprise) has a monthly limit of 1 by an override.
select extensions.dblink_exec('setup', format($$
  begin;
  update private.settings set value = 'true' where key = 'release_job_orders';
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%1$L, %1$L || '@employer.test', now(), '{"intended_account_kind": "company"}'),
         (%7$L, %7$L || '@partner.test', now(), '{"intended_account_kind": "company"}');
  update public.profiles set account_kind = intended_account_kind where id in (%1$L, %7$L);
  update public.profiles set status = 'suspended' where id = %1$L;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (%2$L, 'employer', 'resp-lock-' || left(%2$L, 8), 'Response Lock GmbH', 'Response Lock', 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (%2$L, %1$L, 'owner', now());
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  select p.id, 'recruitment_company', 'resp-lock-p-' || p.n, 'Resp Lock Partner ' || p.n || ' Ltd', 'Resp Lock Partner ' || p.n, 'PH'
  from (values (1, %5$L::uuid), (2, %6$L::uuid)) p (n, id);
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  select x, %7$L, 'owner', now() from unnest(array[%5$L, %6$L]::uuid[]) x;
  insert into public.organization_geographies (organization_id, scope, country_code)
  select x, s::public.geography_scope, c from unnest(array[%5$L, %6$L]::uuid[]) x,
    (values ('serves_market', 'DE'), ('sources_from', 'PH')) g (s, c);
  insert into public.organization_occupations (organization_id, occupation_id) select x, '7212' from unnest(array[%5$L, %6$L]::uuid[]) x;
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id in (%5$L, %6$L);
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  select x, 'recruitment_enterprise', 'active', 'null' from unnest(array[%5$L, %6$L]::uuid[]) x;
  insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value)
  values (%5$L, 'job_order_responses_per_month', 1);
  insert into public.consents (user_id, purpose, version, action)
  values (%7$L, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on
  ) select x.id, %2$L, 'Lock welders', 10, 'DE', 'Hamburg', 'C', current_date + 30, 'full_time', 'international', 'both',
    'open', x.v::public.requirement_visibility, now(), current_date + 80
  from (values (%3$L::uuid, 'job_order_marketplace'), (%4$L::uuid, 'job_order_marketplace'), (%8$L::uuid, 'private')) x (id, v);
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select x, '7212', 10 from unnest(array[%3$L, %4$L, %8$L]::uuid[]) x;
  insert into public.requirement_countries (requirement_id, country_code) select x, 'DE' from unnest(array[%3$L, %4$L, %8$L]::uuid[]) x;
  insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source, status, viewed_at, answered_at)
  values (%8$L, %6$L, %2$L, 'directory', 'viewed', now(), null);
  commit;
$$, :'cown', :'org_c', :'c_r1', :'c_r2', :'c_p', :'c_q', :'pown', :'c_r3'));

-- p_sql as pown in the holder session, its transaction kept open: the single value answered.
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

create function pg_temp.respond_sql(p_org uuid, p_req uuid) returns text
language sql as $$
  select format($f$select (public.respond_to_invitation(%L, %L, 5, current_date + 30, 'Twenty welders placed in Hamburg last year.',
    'fee_per_hire', 1500, 'EUR') is not null)::text$f$, p_org, p_req)
$$;

-- Sends respond_to_invitation as pown for p_org to p_req on a third connection with entitlements_enforced on in its own
-- transaction, without waiting for the answer.
create function pg_temp.send_blocked(p_org uuid, p_req uuid) returns integer
language sql as $$
  select extensions.dblink_exec('blocked', format($f$
    begin;
    update private.settings set value = 'true' where key = 'entitlements_enforced';
    select set_config('request.jwt.claims', json_build_object('sub', %L, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
  $f$, current_setting('t.pown'))) is not null;
  select extensions.dblink_send_query('blocked', pg_temp.respond_sql(p_org, p_req));
$$;

-- The answer of the sent call: its value, or the error message; the third connection's transaction is rolled back.
create function pg_temp.blocked_result() returns text
language plpgsql as $$
declare
  v_result text;
begin
  -- The remote error comes back as a notice; its text is read from the connection instead.
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

-- respond_to_invitation as p_user (anonymous when null) for p_org to p_req with the proposal p_over (named arguments that
-- replace the defaults): 'ok' with the id in t.result, or 'sqlstate|message|detail'.
create function pg_temp.resp(p_user uuid, p_org uuid, p_req uuid, p_over jsonb default '{}', p_aal text default 'aal1')
returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', public.respond_to_invitation(p_org => %L, p_requirement => %L, p_capacity => %s,
      p_available_from => %L::date, p_experience_note => %L, p_fee_model => %L, p_fee_amount => %s, p_fee_currency => %L,
      p_timeline_note => %L, p_notes => %L)::text, true)$f$,
    p_org, p_req, coalesce(o ->> 'capacity', '5'), coalesce(o ->> 'available_from', (current_date + 30)::text),
    coalesce(o ->> 'experience', 'Twenty welders placed in Hamburg last year.'), coalesce(o ->> 'fee_model', 'fee_per_hire'),
    case when o ? 'fee_amount' then coalesce(o ->> 'fee_amount', 'null') else '1500' end,
    case when o ? 'fee_currency' then o ->> 'fee_currency' else 'EUR' end, o ->> 'timeline', o ->> 'notes'), p_aal)
  from (select p_over as o) x
$$;

create function pg_temp.result() returns text
language sql as $$ select current_setting('t.result', true) $$;

select set_config('t.pown', :'pown', false) as setup_pown \gset
select is(pg_temp.hold(pg_temp.respond_sql(:'c_p', :'c_r1')), 'true',
  'a second session responds for P (limit 1 by override) and keeps its transaction open');
select is(pg_try_advisory_xact_lock(hashtextextended('partner_responses:' || :'c_p', 0)), false,
  'NFR-A4: the response in progress holds the advisory lock of the partner''s responses');
select pg_temp.send_blocked(:'c_p', :'c_r2') as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1, 'NFR-A4: a third session''s response of the same partner at the same time waits');
select extensions.dblink_exec('holder', 'commit') as committed \gset
select matches(pg_temp.blocked_result(), 'CHARA_LIMIT_REACHED',
  'NFR-A4, FR-N2 AC6: once the first response is committed, the waiting one counts it and is refused at the limit');
select is(pg_temp.hold(pg_temp.respond_sql(:'c_q', :'c_r1')), 'true', 'FR-N2 AC5: Q responds to R1 in a second session, kept open');
select pg_temp.send_blocked(:'c_q', :'c_r1') as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1, 'FR-N2 AC5, AC12: the parallel response of Q to R1 waits');
select extensions.dblink_exec('holder', 'commit') as committed \gset
select matches(pg_temp.blocked_result(), 'already_responded|CHARA_CONFLICT',
  'FR-N2 AC5, AC12: then it is refused as already responded and counts nothing');
select is(pg_temp.hold(format($f$select public.answer_invitation(%L, (select id from public.requirement_invitations where requirement_id = %L), 'declined')::text$f$,
    :'c_q', :'c_r3')), 'declined', 'Q declines its invitation to R3 in a second session, kept open');
select pg_temp.send_blocked(:'c_q', :'c_r3') as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1, 'a response through that invitation at the same time waits for the invitation');
select extensions.dblink_exec('holder', 'commit') as committed \gset
select matches(pg_temp.blocked_result(), 'CHARA_NOT_FOUND',
  'once the decline is committed the response sees it: the private requirement is no longer Q''s to answer');
select is(
  (select count(*)::integer from public.partner_responses where requirement_id in (:'c_r1', :'c_r2', :'c_r3')) || ','
    || (select count(*)::integer from public.partner_responses where organization_id = :'c_q'),
  '2,1', 'NFR-A4: one response of P and one of Q, never more');
select extensions.dblink_disconnect('holder');
select extensions.dblink_disconnect('blocked');
select extensions.dblink_exec('setup', format($$
  begin;
  delete from public.workforce_requirements where organization_id = %2$L;
  delete from private.rate_limit_hits where (action, bucket) in (
    ('user:audited_write', (hashtextextended(%5$L, 0) & 2147483647)::integer),
    ('org:audited_write', (hashtextextended(%3$L, 0) & 2147483647)::integer),
    ('org:audited_write', (hashtextextended(%4$L, 0) & 2147483647)::integer));
  delete from billing.subscriptions where organization_id in (%3$L, %4$L);
  delete from public.organizations where id in (%2$L, %3$L, %4$L);
  delete from auth.users where id in (%1$L, %5$L);
  update private.settings set value = 'false' where key = 'release_job_orders';
  commit;
$$, :'cown', :'org_c', :'c_p', :'c_q', :'pown'));
select extensions.dblink_disconnect('setup');
select is(
  (select count(*)::integer from public.organizations where id in (:'org_c', :'c_p', :'c_q'))
    + (select count(*)::integer from auth.users where id in (:'cown', :'pown')),
  0, 'the committed organisations of the concurrency test are removed again');

-- The fixture -------------------------------------------------------------------------------------------------------------

update private.settings set value = 'true' where key = 'release_job_orders';
update private.settings set value = 'false' where key = 'entitlements_enforced';
-- The reads count against the job order allowance; it is raised for the many reads below and tested on its own at the end.
update private.settings set value = '100000' where key = 'rate_limit_job_orders_max';
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
update public.organizations set display_name = 'Acme Bau' where id = :'acme';
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (:'acme', 'employer_starter', 'active', 'null'), (:'beta', 'employer_starter', 'active', 'null');
select pg_temp.new_user(:'padm') as seeded \gset
update public.profiles set account_kind = intended_account_kind where id = :'padm';
select set_config('t.padm', :'padm', false) as setup_padm \gset

-- A listed partner of p_type serving p_serves, sourcing from p_sources and listing 7212, owned by p_owner (padm when null),
-- with an active subscription to p_plan (none when null); its owner accepted the commitment unless p_commit is false.
create function pg_temp.partner(
  p_slug text, p_owner uuid default null, p_type text default 'recruitment_company', p_serves text[] default array['DE'],
  p_plan text default 'recruitment_partner', p_commit boolean default true, p_sources text[] default array['PH']
) returns uuid
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
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, v_owner, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  select v_id, 'serves_market'::public.geography_scope, c from unnest(p_serves) c
  union all select v_id, 'sources_from'::public.geography_scope, c from unnest(p_sources) c;
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

-- A requirement of p_org as the lifecycle functions leave it, p_workers welders of 7212 to p_country.
create function pg_temp.req(
  p_org uuid, p_title text, p_status text default 'open', p_visibility text default 'job_order_marketplace',
  p_workers integer default 10, p_country text default 'DE', p_show boolean default false
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_published boolean := p_status <> 'draft';
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, skills, start_date,
    duration_months, employment_type, recruitment_preference, partner_need, status, visibility, show_identity,
    published_at, closes_on, close_reason
  ) values (
    v_id, p_org, p_title, p_workers, p_country, 'Hamburg', 'C', 'MIG/MAG welding', date '2027-03-01', 12, 'full_time',
    'both', 'both', p_status::public.requirement_status,
    case when v_published then p_visibility::public.requirement_visibility end, v_published and p_show,
    case when v_published then now() - interval '10 days' end, case when v_published then date '2027-04-01' end,
    case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', p_workers);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, p_country);
  return v_id;
end;
$$;

create function pg_temp.seed_inv(p_req uuid, p_partner uuid, p_status text default 'invited') returns uuid
language sql as $$
  insert into public.requirement_invitations (
    requirement_id, organization_id, employer_organization_id, status, source, viewed_at, answered_at, withdrawn_at
  )
  select p_req, p_partner, r.organization_id, p_status::public.invitation_status, 'directory',
    case when p_status <> 'invited' then now() end,
    case when p_status in ('accepted', 'declined') then now() end,
    case when p_status = 'withdrawn' then now() end
  from public.workforce_requirements r where r.id = p_req
  returning id
$$;

-- A response written as the database owner in p_status, created at p_at.
create function pg_temp.seed_resp(p_req uuid, p_partner uuid, p_status text default 'submitted', p_at timestamptz default now())
returns uuid
language sql as $$
  insert into public.partner_responses (
    requirement_id, organization_id, employer_organization_id, status, capacity, available_from, experience_note, fee_model,
    created_at, decided_at, withdrawn_at
  )
  select p_req, p_partner, r.organization_id, p_status::public.response_status, 5, current_date + 30,
    'Twenty welders placed in Hamburg last year.', 'on_request', p_at,
    case when p_status in ('shortlisted', 'selected', 'declined') then p_at end,
    case when p_status = 'withdrawn' then p_at end
  from public.workforce_requirements r where r.id = p_req
  returning id
$$;

create function pg_temp.upd(p_user uuid, p_org uuid, p_resp uuid, p_over jsonb default '{}') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.result', public.update_response(p_org => %L, p_response => %L, p_capacity => %s,
      p_available_from => %L::date, p_experience_note => %L, p_fee_model => %L, p_fee_amount => %s, p_fee_currency => %L,
      p_expected_version => %s)::text, true)$f$,
    p_org, p_resp, coalesce(o ->> 'capacity', '5'), coalesce(o ->> 'available_from', (current_date + 30)::text),
    coalesce(o ->> 'experience', 'Twenty welders placed in Hamburg last year.'), coalesce(o ->> 'fee_model', 'fee_per_hire'),
    coalesce(o ->> 'fee_amount', '1500'), coalesce(o ->> 'fee_currency', 'EUR'), coalesce(o ->> 'expected', 'null')), 'aal1')
  from (select p_over as o) x
$$;

create function pg_temp.wd(p_user uuid, p_org uuid, p_resp uuid, p_reason text default null) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', public.withdraw_response(%L, %L, %L)::text, true)$f$, p_org, p_resp, p_reason), 'aal1')
$$;

-- A query run as the user: its single value, or 'sqlstate|message|detail' when refused.
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

-- The users with a row of p_kind whose payload names p_key = p_id, sorted, as user:status.
create function pg_temp.told(p_kind text, p_key text, p_id uuid) returns text
language sql as $$
  select coalesce(string_agg(n.user_id::text || ':' || n.status, ',' order by n.user_id), '')
  from public.notifications n where n.kind = p_kind and n.payload ->> p_key = p_id::text
$$;

create function pg_temp.audits(p_action text, p_id uuid) returns integer
language sql as $$ select count(*)::integer from audit.log where action = p_action and entity_id = p_id::text $$;

select pg_temp.partner('alpha-v44', :'u1') as p1 \gset
select pg_temp.member(:'p1', :'u1a', 'admin') as seeded \gset
select pg_temp.member(:'p1', :'u1m', 'member') as seeded \gset
select pg_temp.member(:'p1', :'u1s', 'admin') as seeded \gset
update public.profiles set status = 'suspended' where id = :'u1s';
select pg_temp.partner('bravo-v44', :'u2') as p2 \gset
select pg_temp.partner('no-commitment-v44', :'uq2', p_commit => false) as q2 \gset
select pg_temp.partner('free-v44', null, p_plan => null) as q3 \gset
select pg_temp.partner('netherlands-v44', null, p_serves => array['NL']) as q4 \gset
select pg_temp.partner('hidden-v44') as q5 \gset
update public.organizations set moderation_state = 'hidden' where id = :'q5';
select pg_temp.partner('suspended-v44') as q6 \gset
update public.organizations set status = 'suspended' where id = :'q6';
select pg_temp.partner('staffing-v44', :'us1', 'staffing_company', p_plan => 'staffing_enterprise') as s1 \gset
select pg_temp.partner('limits-v44', p_plan => 'recruitment_enterprise') as lm \gset
select pg_temp.partner('expired-licence-v44', null, p_serves => array['DE', 'NL']) as l1 \gset
select pg_temp.partner('today-licence-v44', null, p_serves => array['DE', 'NL']) as l2 \gset
select pg_temp.partner('no-licence-v44', null, p_serves => array['DE', 'NL']) as l3 \gset
select pg_temp.partner('nl-licence-v44', null, p_serves => array['DE', 'NL']) as l4 \gset
select pg_temp.new_user(:'adms') as seeded \gset
update public.profiles set account_kind = intended_account_kind where id = :'adms';
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'acme', :'adms', 'admin', now());
update public.profiles set status = 'suspended' where id = :'adms';

select pg_temp.req(:'acme', 'Acme welders R') as r \gset
select pg_temp.req(:'acme', 'Acme private V', p_visibility => 'private') as v \gset
select pg_temp.req(:'beta', 'Beta welders B') as rb \gset

-- Structure, grants and functions -------------------------------------------------------------------------------------------

select ok(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c
   where c.oid in ('public.partner_responses'::regclass, 'public.partner_response_versions'::regclass,
     'stats.job_order_response_refusals'::regclass)),
  'NFR-S8: row level security is enabled and forced on the new tables');
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'partner_responses'
    and indexdef like 'CREATE UNIQUE INDEX partner_responses_partner_key ON public.partner_responses USING btree (requirement_id, organization_id)'),
  'FR-N2 AC5: a unique index on (requirement_id, organization_id) exists');
select ok(
  not has_table_privilege('authenticated', 'public.partner_responses', 'insert, update, delete')
    and not has_table_privilege('authenticated', 'public.partner_response_versions', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.partner_responses', 'select')
    and not has_table_privilege('anon', 'public.partner_response_versions', 'select')
    and not has_table_privilege('authenticated', 'stats.job_order_response_refusals', 'select'),
  'NFR-S8: no API role writes the responses or versions; anonymous callers read nothing; the refusal record is not granted');
select ok(
  not has_column_privilege('authenticated', 'public.partner_responses', 'created_by', 'select')
    and not has_column_privilege('authenticated', 'public.partner_responses', 'employer_seen_version', 'select')
    and not has_column_privilege('authenticated', 'public.partner_responses', 'decided_by', 'select')
    and not has_column_privilege('authenticated', 'public.partner_response_versions', 'created_by', 'select'),
  'the members who wrote or decided and the seen version are not readable through the Data API');
select ok(
  not has_column_privilege('authenticated', 'public.partner_responses', 'employer_organization_id', 'select')
    and not has_column_privilege('authenticated', 'public.partner_response_versions', 'employer_organization_id', 'select'),
  'NFR-S11: no party reads the employer''s organisation id from a response or a version (the policy uses it internally)');
select is(pg_temp.read_as(:'u1', 'select count(employer_organization_id) from public.partner_responses'),
  '42501|permission denied for table partner_responses|', 'NFR-S11: a partner selecting it is refused');
select is(
  (select array_agg(proname::text order by proname) from pg_proc
   where pronamespace = 'public'::regnamespace and proname in ('respond_to_invitation', 'update_response',
     'withdraw_response', 'get_response_eligibility', 'list_my_responses', 'get_response', 'list_requirement_responses',
     'list_response_versions', 'list_response_changes', 'set_requirement_capacity_tolerance')
     and prosecdef and proconfig @> array['search_path=""']
     and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')),
  array['get_response', 'get_response_eligibility', 'list_my_responses', 'list_requirement_responses', 'list_response_changes',
    'list_response_versions', 'respond_to_invitation', 'set_requirement_capacity_tolerance', 'update_response',
    'withdraw_response'],
  'the functions are security definer with an empty search path, for authenticated callers only');
select is(
  (select count(*)::integer from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('response_refusal', 'raise_response_refusal', 'response_proposal', 'response_payload',
       'response_capacity_max', 'response_licence_missing', 'requirement_named_to', 'assert_responding_partner',
       'queue_response_message', 'queue_response_employer_event', 'partner_response_fields')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'no API role executes the private helpers');
select is(
  (select string_agg(kind || ':' || mandatory || ':' || default_email || ':' || organization_types::text, ',' order by kind)
   from private.notification_kinds where kind in ('response_received', 'response_withdrawn')),
  'response_received:false:true:{employer},response_withdrawn:false:true:{employer}',
  'FR-T1: response_received and response_withdrawn are optional with email on, for employers');

-- FR-O2 AC1 and FR-O1 step Track: an invited partner responds -------------------------------------------------------------

select pg_temp.seed_inv(:'v', :'p1', 'accepted') as inv_v \gset
select private.record_requirement_reveal(:'v', :'p1', 'invitation') as seeded \gset
select is(pg_temp.resp(:'u1m', :'p1', :'v', '{"capacity": "8", "timeline": "First four in January, the rest by March", "notes": "Trade-tested welders."}'),
  'ok', 'FR-O2 AC1: a member of P1 (no two-step verification) responds to the private requirement it is invited to');
select pg_temp.result() as resp_v \gset
select is(
  (select status || ':' || version || ':' || capacity || ':' || fee_model || ':' || fee_amount || ':' || fee_currency || ':'
     || (invitation_id = :'inv_v') || ':' || (employer_organization_id = :'acme') || ':' || (created_by = :'u1m')
   from public.partner_responses where id = :'resp_v'),
  'submitted:1:8:fee_per_hire:1500.00:EUR:true:true:true',
  'FR-O2 AC1: one response, submitted, version 1, with the invitation, the employer and the member who sent it');
select is(
  (select version || ':' || cardinality(changed_fields) || ':' || (payload ->> 'capacity') || ':' || (payload ->> 'timeline_note')
   from public.partner_response_versions where response_id = :'resp_v'),
  '1:0:8:First four in January, the rest by March', 'FR-O2 AC1: version 1 is kept with its proposal');
select is(
  (select status || ':' || (responded_at is not null) || ':' || (answered_at is not null) from public.requirement_invitations where id = :'inv_v'),
  'responded:true:true', 'FR-O1 step Track: the accepted invitation becomes responded');
select is(pg_temp.audits('response.created', :'resp_v'), 1, 'FR-O2 AC1: one audit row response.created');
select is(pg_temp.told('response_received', 'response_id', :'resp_v'),
  :'own1' || ':queued,' || :'adm' || ':queued',
  'FR-O2 AC1, FR-T1 AC1: response_received to the owner and the admin of Acme; none to the member, the suspended admin or the partner');
select is(
  (select string_agg(k, ',' order by k) from public.notifications n, jsonb_object_keys(n.payload) k
   where n.kind = 'response_received' and n.payload ->> 'response_id' = :'resp_v' and n.user_id = :'own1'),
  'org_slug,partner_name,requirement_id,response_id,title', 'FR-T1 AC2: the payload holds ids, the title and the partner''s name only');
select ok(
  not exists (select 1 from public.notifications n where n.kind = 'response_received' and n.payload ->> 'response_id' = :'resp_v'
    and (n.payload::text like '%1500%' or n.payload::text ilike '%trade-tested%')),
  'FR-T1 AC2: no fee amount and no statement of the response in the payload');
select is((select count(*)::integer from pgmq.q_notifications where message ->> 'kind' = 'response_received'
    and message ->> 'partner_response_id' = :'resp_v'), 2, 'NFR-A3: one queued message per recipient in the same transaction');
select is(pg_temp.resp(:'u1', :'p1', :'v'), 'P0001|CHARA_CONFLICT|already_responded',
  'FR-N2 AC5: a second member of P1 is refused; the responded invitation does not hide the answer');
select is(pg_temp.resp(:'u2', :'p2', :'v'), 'P0002|CHARA_NOT_FOUND|',
  'FR-N2 AC11: an uninvited partner cannot respond to a private requirement and learns nothing');

-- FR-N2 AC2: each missing condition named; nothing written --------------------------------------------------------------

update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.partner('used-up-v44', p_plan => 'recruitment_enterprise') as q1 \gset
insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value) values (:'q1', 'job_order_responses_per_month', 2);
select pg_temp.seed_resp(pg_temp.req(:'beta', 'Q1 earlier 1'), :'q1') as seeded \gset
select pg_temp.seed_resp(pg_temp.req(:'beta', 'Q1 earlier 2'), :'q1') as seeded \gset
create temporary table counts_before on commit drop as
  select (select count(*) from public.partner_responses) as responses, (select count(*) from audit.log) as audits,
    (select count(*) from public.notifications) as notes;
grant select on counts_before to authenticated, anon;
select is(pg_temp.resp(:'padm', :'q1', :'r'), 'P0001|CHARA_LIMIT_REACHED|job_order_responses_per_month',
  'FR-N2 AC2: Q1 has used its responses this month');
select is(pg_temp.resp(:'uq2', :'q2', :'r'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'FR-N2 AC2: Q2 has not accepted the current employer-pays commitment (detail as DATA_MODEL.md section 2)');
select is(pg_temp.resp(:'padm', :'q3', :'r'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|job_order_access',
  'FR-N2 AC2: Q3 is on the free plan');
select is(pg_temp.resp(:'padm', :'q4', :'r'), '42501|CHARA_FORBIDDEN|served_country_missing',
  'FR-N2 AC2: Q4 does not serve DE');
select is(
  (select count(*) from public.partner_responses) || ',' || (select count(*) from audit.log) || ',' || (select count(*) from public.notifications),
  (select responses || ',' || audits || ',' || notes from counts_before),
  'FR-N2 AC2: no response, no audit row and no notification for any of them');
update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(pg_temp.resp(:'padm', :'q3', :'r'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|job_order_access',
  'decision 3.6: the free plan is refused with entitlements_enforced off too');
select is(pg_temp.resp(:'uq2', :'q2', :'r'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'FR-J3: the commitment is required whatever entitlements_enforced says');
select is(pg_temp.resp(:'padm', :'q1', :'r'), 'ok', 'FR-N2 AC6: with entitlements_enforced off the limit refuses nothing');
select is(pg_temp.resp(:'padm', :'q5', :'r'), '42501|CHARA_FORBIDDEN|profile_hidden', 'a partner hidden by moderation cannot respond');
select is(pg_temp.resp(:'padm', :'q6', :'r'), '42501|CHARA_FORBIDDEN|organization_suspended', 'a suspended partner cannot respond');
select is(pg_temp.resp(:'own1', :'acme', :'r'), '42501|CHARA_FORBIDDEN|partner_only', 'an employer cannot respond');
select is(split_part(pg_temp.resp(:'wkr', :'p1', :'r'), '|', 1), '42501', 'a candidate is refused');
select is(split_part(pg_temp.resp(null, :'p1', :'r'), '|', 1), '42501', 'an anonymous caller is refused');
select is(split_part(pg_temp.resp(:'u2', :'p1', :'r'), '|', 1), '42501', 'a member of P2 cannot respond for P1');
select is(pg_temp.resp(:'u1', :'p1', gen_random_uuid()), 'P0002|CHARA_NOT_FOUND|', 'an unknown requirement is not found');

-- FR-N2 AC3, FR-J2 AC9: the licence rule ---------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme Dutch T', p_country => 'NL') as t \gset
insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until,
  confirmed_at, partner_terms_version, status) values
  (:'l1', 'DE', 'Bundesagentur', 'DE-0001', (now() at time zone 'utc')::date - 1, now(), 1, 'expired'),
  (:'l2', 'DE', 'Bundesagentur', 'DE-0002', (now() at time zone 'utc')::date, now(), 1, 'current'),
  (:'l4', 'NL', 'Inspectie', 'NL-0001', (now() at time zone 'utc')::date + 300, now(), 1, 'current');
select pg_temp.req(:'acme', 'Acme licence R1') as lr1 \gset
select is(pg_temp.resp(:'padm', :'l3', :'lr1'), 'ok', 'FR-J2 AC9: while no rule exists, no response is refused for a missing licence');
insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref)
values ('PH', 'DE', 'licensed_partner_required', 'Workers from the Philippines to Germany need a licensed partner.', 'LO-2026-01');
select pg_temp.req(:'acme', 'Acme licence R') as lr \gset
select is(pg_temp.resp(:'padm', :'l1', :'lr'), 'P0001|CHARA_LICENCE_REQUIRED|DE', 'FR-N2 AC3: L1''s DE licence ended yesterday');
select is(pg_temp.resp(:'padm', :'l3', :'lr'), 'P0001|CHARA_LICENCE_REQUIRED|DE', 'FR-N2 AC3: L3 has no licence');
select is(pg_temp.resp(:'padm', :'l4', :'lr'), 'P0001|CHARA_LICENCE_REQUIRED|DE', 'FR-N2 AC3: L4 has a licence for NL only');
select is((select count(*)::integer from public.partner_responses where requirement_id = :'lr'), 0, 'FR-N2 AC3: nothing is written');
select is(pg_temp.resp(:'padm', :'l2', :'lr'), 'ok', 'FR-N2 AC3: a licence valid until today is current');
select is(pg_temp.resp(:'padm', :'l3', :'t'), 'ok', 'FR-N2 AC3: L3 responds to the NL job order without a rule');
select pg_temp.req(:'acme', 'Acme licence invited private', p_visibility => 'private') as lv \gset
select pg_temp.seed_inv(:'lv', :'l3', 'viewed') as seeded \gset
select is(pg_temp.resp(:'padm', :'l3', :'lv'), 'P0001|CHARA_LICENCE_REQUIRED|DE', 'FR-N2 open point: the rule applies to invited responses too');
select is(
  pg_temp.read_as(:'mem', format('select count(*) || '':'' || (select count(*) from public.list_requirement_responses(%L, %L)) from jsonb_object_keys((select to_jsonb(x) from public.list_requirement_responses(%L, %L) x limit 1)) k where k ilike ''%%licen%%''', :'acme', :'lr', :'acme', :'lr')),
  '0:1', 'FR-N2 AC3: no licence detail of any partner is returned to the employer');
delete from public.direct_hiring_rules where destination_country = 'DE';
-- The rule of each source the partner lists, as private.direct_hiring_rule resolves it (review decision 2).
insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref)
values ('KE', 'DE', 'licensed_partner_required', 'Workers from Kenya to Germany need a licensed partner here.', 'LO-2026-02');
select pg_temp.req(:'acme', 'Acme Kenya rule') as kr \gset
select pg_temp.partner('domestic-v44', null, p_sources => array['DE']) as sd \gset
select pg_temp.partner('kenya-v44', null, p_sources => array['KE', 'PH']) as sk \gset
select pg_temp.partner('no-sources-v44', null, p_sources => '{}') as sn \gset
select is(pg_temp.resp(:'padm', :'sd', :'kr'), 'ok', 'licence rule: a partner recruiting in Germany only is not held to the KE -> DE rule (domestic hiring)');
select is(pg_temp.resp(:'padm', :'sk', :'kr'), 'P0001|CHARA_LICENCE_REQUIRED|DE', 'licence rule: a partner sourcing from Kenya needs a German licence');
select is(pg_temp.resp(:'padm', :'l3', :'kr'), 'ok', 'licence rule: a partner sourcing from the Philippines only is not held to the Kenyan rule');
select is(pg_temp.resp(:'padm', :'sn', :'kr'), 'P0001|CHARA_LICENCE_REQUIRED|DE',
  'licence rule: a partner listing no source country falls back to any rule naming the destination');
update public.direct_hiring_rules set destination_country = null where source_country = 'KE';
select pg_temp.req(:'acme', 'Acme Kenya any') as ka \gset
select is(pg_temp.resp(:'padm', :'sk', :'ka') || ',' || pg_temp.resp(:'padm', :'sn', :'ka'), 'P0001|CHARA_LICENCE_REQUIRED|DE,ok',
  'licence rule: a Kenyan rule for any destination holds the Kenya-sourcing partner; it names no destination for the fallback');
delete from public.direct_hiring_rules where source_country = 'KE';

-- FR-N2 AC5: one response per partner; a withdrawn one is not replaced ---------------------------------------------------

select is(pg_temp.resp(:'u1', :'p1', :'r', '{"capacity": "6"}'), 'ok', 'FR-N2 AC5: a member of P1 responds to job order R');
select pg_temp.result() as resp_r \gset
select is(pg_temp.resp(:'u1a', :'p1', :'r'), 'P0001|CHARA_CONFLICT|already_responded', 'FR-N2 AC5: a second member is refused');
select is(pg_temp.wd(:'u1', :'p1', :'resp_r', 'Capacity no longer available') || ':' || pg_temp.result(), 'ok:withdrawn',
  'FR-N2 AC8: P1 withdraws with a reason');
select is(pg_temp.resp(:'u1', :'p1', :'r'), 'P0001|CHARA_CONFLICT|already_responded',
  'FR-N2 AC5: a response after the withdrawal is refused');
select is(
  (select count(*)::integer || ':' || min(status::text) || ':' || min(withdrawal_reason) from public.partner_responses
   where requirement_id = :'r' and organization_id = :'p1'),
  '1:withdrawn:Capacity no longer available', 'FR-N2 AC5: exactly one row, the withdrawn response unchanged');

-- FR-N2 AC6, AC7: the monthly count, withdrawals count, earlier months never; one key for both partner types ---------------

update private.settings set value = 'true' where key = 'entitlements_enforced';
insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value) values (:'lm', 'job_order_responses_per_month', 3);
select pg_temp.seed_resp(pg_temp.req(:'beta', 'LM this month 1'), :'lm') as seeded \gset
select pg_temp.seed_resp(pg_temp.req(:'beta', 'LM this month 2'), :'lm', 'withdrawn') as seeded \gset
select count(pg_temp.seed_resp(pg_temp.req(:'beta', 'LM last month ' || n), :'lm', 'submitted',
  private.month_start() - interval '1 second' * n)) as seeded
from generate_series(1, 4) n \gset
select is(private.monthly_usage(:'lm', 'job_order_responses_per_month'), 2,
  'FR-N2 AC6: two responses this calendar month (UTC), one withdrawn; the four of last month do not count');
select pg_temp.req(:'acme', 'Acme limit 1') as m1 \gset
select pg_temp.req(:'acme', 'Acme limit 2') as m2 \gset
select pg_temp.req(:'acme', 'Acme limit 3') as m3 \gset
select is(pg_temp.resp(:'padm', :'lm', :'m1'), 'ok', 'FR-N2 AC6: the third response of a limit of 3 succeeds');
select is(pg_temp.wd(:'padm', :'lm', pg_temp.result()::uuid), 'ok', 'FR-N2 AC6: it is withdrawn');
select is(pg_temp.resp(:'padm', :'lm', :'m2'), 'P0001|CHARA_LIMIT_REACHED|job_order_responses_per_month',
  'FR-N2 AC6: the withdrawal frees no place');
-- The clock moved to the next month: this month's responses become last month's (the trigger holding created_at is off).
alter table public.partner_responses disable trigger partner_responses_immutable;
update public.partner_responses set created_at = private.month_start() - interval '1 hour' where organization_id = :'lm';
alter table public.partner_responses enable always trigger partner_responses_immutable;
select is(pg_temp.resp(:'padm', :'lm', :'m2'), 'ok', 'FR-N2 AC6: from the first day of the next month (UTC) the partner responds again');
insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value) values (:'s1', 'job_order_responses_per_month', 1);
select pg_temp.seed_resp(pg_temp.req(:'beta', 'S1 earlier'), :'s1') as seeded \gset
select is(pg_temp.resp(:'us1', :'s1', :'m3'), 'P0001|CHARA_LIMIT_REACHED|job_order_responses_per_month',
  'FR-N2 AC7 (one key, DATA_MODEL.md section 2): a staffing company at its limit is refused');
select is(
  (select string_agg(plan_code || '=' || coalesce(limit_value::text, 'null'), ',' order by plan_code) from billing.plan_limits
   where limit_key = 'job_order_responses_per_month'),
  'free_recruitment_company=0,free_staffing_company=0,recruitment_enterprise=200,recruitment_partner=10,recruitment_professional=50,staffing_enterprise=200,staffing_partner=10,staffing_professional=50',
  'FR-N2 AC7: 10, 50 and 200 for the paid plans of both types and 0 for both free plans');
select is(pg_temp.resp(:'u1', :'p1', :'m3'), 'ok', 'FR-N2 AC7: a recruitment company with room responds');
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- FR-N2 AC8: withdrawal until the employer decides ------------------------------------------------------------------------

create temporary table wd_rows on commit drop as
  select s, pg_temp.seed_resp(pg_temp.req(:'acme', 'WD ' || s), :'p1', s) as id
  from unnest(array['submitted', 'updated', 'shortlisted', 'selected', 'declined', 'withdrawn']) s;
select is(pg_temp.wd(:'u2', :'p2', (select id from wd_rows where s = 'submitted')), 'P0002|CHARA_NOT_FOUND|',
  'FR-N2 AC8: a member of P2 is refused');
select is(pg_temp.wd(:'own1', :'acme', (select id from wd_rows where s = 'submitted')), '42501|CHARA_FORBIDDEN|partner_only',
  'FR-N2 AC8: the Acme owner is refused (departure: CHARA_FORBIDDEN partner_only for the own organisation)');
select is(
  (select string_agg(s || '=' || pg_temp.wd(:'u1m', :'p1', id, 'Capacity no longer available'), ',' order by s) from wd_rows),
  'declined=P0001|CHARA_INVALID_STATE|declined,selected=P0001|CHARA_INVALID_STATE|selected,shortlisted=P0001|CHARA_INVALID_STATE|shortlisted,submitted=ok,updated=ok,withdrawn=P0001|CHARA_INVALID_STATE|withdrawn',
  'FR-N2 AC8: submitted and updated are withdrawn; shortlisted, selected, declined and withdrawn are refused');
select is(
  (select string_agg(w.s || ':' || p.status || ':' || (p.withdrawn_at is not null) || ':' || coalesce(p.withdrawal_reason, '-') || ':'
     || pg_temp.audits('response.withdrawn', p.id), ',' order by w.s)
   from wd_rows w join public.partner_responses p on p.id = w.id where w.s in ('submitted', 'updated')),
  'submitted:withdrawn:true:Capacity no longer available:1,updated:withdrawn:true:Capacity no longer available:1',
  'FR-N2 AC8: withdrawn_at, the reason and one audit row response.withdrawn each');
select is(pg_temp.told('response_withdrawn', 'response_id', (select id from wd_rows where s = 'submitted')),
  :'own1' || ':queued,' || :'adm' || ':queued', 'FR-N2 AC8: response_withdrawn to each owner and admin of Acme');
select is(pg_temp.wd(:'u1', :'p1', (select id from wd_rows where s = 'submitted'), repeat('x', 501)), 'P0001|CHARA_INVALID_INPUT|p_reason',
  'FR-N2 data: a reason over 500 characters is refused');

-- FR-N2 AC10: closed, paused and draft requirements --------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme pausing R10') as r10 \gset
select is(pg_temp.resp(:'u1', :'p1', :'r10'), 'ok', 'FR-N2 AC10: P1 responds while R10 is open');
select pg_temp.result() as resp_10 \gset
select (select updated_at from public.workforce_requirements where id = :'r10') as r10_at \gset
select is(pg_temp.call_as(:'own1', 'authenticated', format('select public.set_requirement_status(%L, %L, ''paused'', %L::timestamptz)',
  :'acme', :'r10', :'r10_at')), 'ok', 'the owner pauses R10');
select is(pg_temp.resp(:'u2', :'p2', :'r10'), 'P0001|CHARA_INVALID_STATE|requirement_not_open', 'FR-N2 AC10: P2 is refused while paused');
select is(pg_temp.upd(:'u1', :'p1', :'resp_10', '{"capacity": "4"}'), 'ok', 'a paused requirement keeps its responses and their edits');
select (select updated_at from public.workforce_requirements where id = :'r10') as r10_at \gset
select is(pg_temp.call_as(:'own1', 'authenticated', format('select public.set_requirement_status(%L, %L, ''open'', %L::timestamptz)',
  :'acme', :'r10', :'r10_at')), 'ok', 'the owner reopens R10');
select (select updated_at from public.workforce_requirements where id = :'r10') as r10_at \gset
select is(pg_temp.call_as(:'own1', 'authenticated', format('select public.set_requirement_status(%L, %L, ''closed'', %L::timestamptz, ''cancelled'')',
  :'acme', :'r10', :'r10_at')), 'ok', 'the owner closes R10');
select is(pg_temp.resp(:'u2', :'p2', :'r10'), 'P0001|CHARA_INVALID_STATE|requirement_not_open', 'FR-N2 AC10: P2 is refused once closed');
select is(pg_temp.upd(:'u1', :'p1', :'resp_10', '{"capacity": "3"}'), 'P0001|CHARA_INVALID_STATE|requirement_closed',
  'an edit on a closed requirement is refused');
select is(pg_temp.wd(:'u1', :'p1', :'resp_10'), 'ok', 'FR-N2 AC10: P1 withdraws on the closed requirement');
select is(pg_temp.read_as(:'u1', format('select status::text from public.get_response(%L, %L)', :'p1', :'resp_10'))
  || ',' || pg_temp.read_as(:'mem', format('select status::text from public.get_response(%L, %L)', :'acme', :'resp_10')),
  'withdrawn,withdrawn', 'FR-N2 AC10: the response stays readable to P1 and to Acme');
select is(pg_temp.resp(:'u2', :'p2', pg_temp.req(:'acme', 'Acme draft', 'draft')), 'P0002|CHARA_NOT_FOUND|',
  'a draft is no job order: not found');
select is(pg_temp.resp(:'u2', :'p2', pg_temp.req(:'acme', 'Acme filled', 'filled')), 'P0001|CHARA_INVALID_STATE|requirement_not_open',
  'a filled job order is refused');
update public.organizations set status = 'suspended' where id = :'beta';
select is(pg_temp.resp(:'u2', :'p2', :'rb'), 'P0001|CHARA_INVALID_STATE|requirement_not_open',
  'the job order of a suspended employer is refused');
update public.organizations set status = 'active' where id = :'beta';

-- FR-O2 AC3: fee models ---------------------------------------------------------------------------------------------------

select is(
  (select string_agg(x.name || '=' || pg_temp.resp(:'u2', :'p2', pg_temp.req(:'acme', 'Fee ' || x.name), x.o::jsonb), ',' order by x.n)
   from (values
     (1, 'per hire EUR', '{"fee_model": "fee_per_hire", "fee_amount": "1500", "fee_currency": "EUR"}'),
     (2, 'percent', '{"fee_model": "percent_first_year_salary", "fee_amount": "12.5", "fee_currency": null}'),
     (3, 'hourly', '{"fee_model": "hourly_rate", "fee_amount": "18.50", "fee_currency": "usd"}'),
     (4, 'on request', '{"fee_model": "on_request", "fee_amount": null, "fee_currency": null}')
   ) x (n, name, o)),
  'per hire EUR=ok,percent=ok,hourly=ok,on request=ok',
  'FR-O2 AC3: fee per hire in EUR, 12.5 per cent without currency, 18.50 USD an hour and on request without amount succeed');
select pg_temp.req(:'acme', 'Fee refusals') as fr \gset
select is(
  (select string_agg(x.name || '=' || split_part(pg_temp.resp(:'u2', :'p2', :'fr', x.o::jsonb), '|', 1), ',' order by x.n)
   from (values
     (1, 'per hire no currency', '{"fee_model": "fee_per_hire", "fee_amount": "1500", "fee_currency": null}'),
     (2, 'percent 0', '{"fee_model": "percent_first_year_salary", "fee_amount": "0", "fee_currency": null}'),
     (3, 'percent 100.01', '{"fee_model": "percent_first_year_salary", "fee_amount": "100.01", "fee_currency": null}'),
     (4, 'percent EUR', '{"fee_model": "percent_first_year_salary", "fee_amount": "12.5", "fee_currency": "EUR"}'),
     (5, 'on request amount', '{"fee_model": "on_request", "fee_amount": "100", "fee_currency": null}'),
     (6, 'minus 1', '{"fee_model": "monthly_rate", "fee_amount": "-1", "fee_currency": "EUR"}'),
     (7, 'ten million', '{"fee_model": "monthly_rate", "fee_amount": "10000000", "fee_currency": "EUR"}'),
     (8, 'ABC', '{"fee_model": "monthly_rate", "fee_amount": "3200", "fee_currency": "ABC"}')
   ) x (n, name, o)),
  'per hire no currency=23514,percent 0=23514,percent 100.01=23514,percent EUR=23514,on request amount=23514,minus 1=23514,ten million=23514,ABC=23503',
  'FR-O2 AC3: the fee rules fail with 23514 and an unknown currency with 23503');
select is((select count(*)::integer from public.partner_responses where requirement_id = :'fr'), 0, 'FR-O2 AC3: no failing call writes a row');
select is(
  (select fee_currency from public.partner_responses p join public.workforce_requirements r on r.id = p.requirement_id
   where r.title = 'Fee hourly'), 'USD', 'the currency is stored in upper case');

-- FR-O2 AC4 and data: capacity and the other fields -------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme hundred R0', p_workers => 100) as c0 \gset
select pg_temp.req(:'acme', 'Acme hundred S10', p_workers => 100) as c10 \gset
select is(pg_temp.call_as(:'own1', 'authenticated', format('select set_config(''t.result'', public.set_requirement_capacity_tolerance(%L, %L, 10)::text, true)',
  :'acme', :'c10'), 'aal2') || ':' || pg_temp.result(), 'ok:true', 'FR-O2 AC4: the owner at aal2 allows 10 per cent more on S');
select is(pg_temp.call_as(:'own1', 'authenticated', format('select set_config(''t.result'', public.set_requirement_capacity_tolerance(%L, %L, 10)::text, true)',
  :'acme', :'c10'), 'aal2') || ':' || pg_temp.result(), 'ok:false', 'the same value again writes nothing');
select is(
  (select count(*)::integer || ':' || min(metadata ->> 'from') || ':' || min(metadata ->> 'to') from audit.log
   where action = 'requirement.capacity_tolerance_set' and entity_id = :'c10'),
  '1:0:10', 'one audit row with the old and the new value');
select is(
  pg_temp.call_as(:'own1', 'authenticated', format('select public.set_requirement_capacity_tolerance(%L, %L, 10)', :'acme', :'c0'), 'aal1')
  || ',' || pg_temp.call_as(:'mem', 'authenticated', format('select public.set_requirement_capacity_tolerance(%L, %L, 10)', :'acme', :'c0'))
  || ',' || pg_temp.call_as(:'own1', 'authenticated', format('select public.set_requirement_capacity_tolerance(%L, %L, 101)', :'acme', :'c0'))
  || ',' || pg_temp.call_as(:'own2', 'authenticated', format('select public.set_requirement_capacity_tolerance(%L, %L, 10)', :'beta', :'c0')),
  'P0001|CHARA_FORBIDDEN|aal2_required,P0001|CHARA_FORBIDDEN|,P0001|CHARA_INVALID_INPUT|p_percent,P0002|CHARA_NOT_FOUND|',
  'only an owner or admin at aal2 of the employer sets 0 to 100');
select is(
  pg_temp.resp(:'u2', :'p2', :'c0', '{"capacity": "101"}') || ',' || pg_temp.resp(:'u2', :'p2', :'c10', '{"capacity": "111"}'),
  'P0001|CHARA_INVALID_INPUT|capacity_above_allowed:100,P0001|CHARA_INVALID_INPUT|capacity_above_allowed:110',
  'FR-O2 AC4: 101 on R and 111 on S are refused with the allowed maximum');
select is(
  pg_temp.resp(:'u2', :'p2', :'c0', '{"capacity": "100"}') || ',' || pg_temp.resp(:'u2', :'p2', :'c10', '{"capacity": "110"}'),
  'ok,ok', 'FR-O2 AC4: 100 on R and 110 on S succeed');
select pg_temp.req(:'acme', 'Acme input') as ci \gset
select is(
  (select string_agg(x.name || '=' || pg_temp.resp(:'u2', :'p2', :'ci', x.o::jsonb), ',' order by x.n)
   from (values
     (1, 'capacity 0', '{"capacity": "0"}'),
     (2, 'yesterday', format('{"available_from": "%s"}', (now() at time zone 'utc')::date - 1)),
     (3, 'three years and a day', format('{"available_from": "%s"}', ((now() at time zone 'utc')::date + interval '3 years' + interval '1 day')::date)),
     (4, 'experience 19', '{"experience": "Nineteen chars here"}'),
     (5, 'experience spaces', format('{"experience": "%s"}', repeat(' ', 30))),
     (6, 'timeline 1001', format('{"timeline": "%s"}', repeat('t', 1001))),
     (7, 'notes 2001', format('{"notes": "%s"}', repeat('n', 2001))),
     (8, 'fee model', '{"fee_model": "commission"}')
   ) x (n, name, o)),
  'capacity 0=P0001|CHARA_INVALID_INPUT|capacity,yesterday=P0001|CHARA_INVALID_INPUT|available_from,three years and a day=P0001|CHARA_INVALID_INPUT|available_from,experience 19=P0001|CHARA_INVALID_INPUT|experience_note,experience spaces=P0001|CHARA_INVALID_INPUT|experience_note,timeline 1001=P0001|CHARA_INVALID_INPUT|timeline_note,notes 2001=P0001|CHARA_INVALID_INPUT|notes,fee model=22P02|invalid input value for enum fee_model: "commission"|',
  'FR-O2 data: capacity at least 1, available from today to three years, experience 20 to 4,000, timeline 1,000, notes 2,000, a listed fee model');
select is(pg_temp.resp(:'u2', :'p2', :'ci', format('{"available_from": "%s", "experience": "%s", "timeline": "%s", "notes": "%s"}',
    ((now() at time zone 'utc')::date + interval '3 years')::date, repeat('e', 4000), repeat('t', 1000), repeat('n', 2000))::jsonb),
  'ok', 'FR-O2 data: the bounds themselves are accepted');

-- FR-O2 AC8: edits write versions ----------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme edit R8') as r8 \gset
select is(pg_temp.resp(:'u1', :'p1', :'r8', '{"capacity": "8"}'), 'ok', 'P1 responds with 1500 EUR and capacity 8');
select pg_temp.result() as resp_8 \gset
select is(pg_temp.upd(:'u1m', :'p1', :'resp_8', '{"capacity": "9", "fee_amount": "1400", "expected": "1"}') || ':' || pg_temp.result(),
  'ok:2', 'FR-O2 AC8: a member changes the fee to 1400 and the capacity to 9: version 2');
select is(
  (select status || ':' || version || ':' || capacity || ':' || fee_amount from public.partner_responses where id = :'resp_8')
  || '|' || (select string_agg(version || ':' || (payload ->> 'capacity') || ':' || (payload ->> 'fee_amount') || ':' || array_to_string(changed_fields, '+'), ',' order by version)
             from public.partner_response_versions where response_id = :'resp_8'),
  'updated:2:9:1400.00|1:8:1500.00:,2:9:1400.00:capacity+fee_amount',
  'FR-O2 AC8: the response holds the current values, versions 1 and 2 are kept with the fields changed');
select is(
  (select metadata -> 'changed_fields' from audit.log where action = 'response.updated' and entity_id = :'resp_8'),
  '["capacity", "fee_amount"]'::jsonb, 'FR-O2 AC8: one audit row response.updated naming the fields');
select is(pg_temp.upd(:'u1', :'p1', :'resp_8', '{"capacity": "9", "fee_amount": "1400.00"}') || ':' || pg_temp.result()
  || ':' || (select count(*) from public.partner_response_versions where response_id = :'resp_8')
  || ':' || pg_temp.audits('response.updated', :'resp_8'),
  'ok:2:2:1', 'FR-O2 AC8: a call with no change writes nothing');
select pg_temp.req(:'acme', 'Acme shrinking R5') as r5 \gset
select is(pg_temp.resp(:'u1', :'p1', :'r5', '{"capacity": "10"}'), 'ok', 'P1 offers all 10 workers of R5');
select pg_temp.result() as resp_5 \gset
update public.workforce_requirements set workers_needed = 5 where id = :'r5';
select is(pg_temp.upd(:'u1', :'p1', :'resp_5', '{"capacity": "10", "fee_amount": "1400"}') || ':' || pg_temp.result(), 'ok:2',
  'review decision 5: after the employer lowers the workers, an unchanged capacity is kept and the fee can still be edited');
select is(pg_temp.upd(:'u1', :'p1', :'resp_5', '{"capacity": "9", "fee_amount": "1400"}'), 'P0001|CHARA_INVALID_INPUT|capacity_above_allowed:5',
  'review decision 5: a changed capacity must fit the new maximum');
select is(pg_temp.upd(:'u1', :'p1', :'resp_8', '{"capacity": "7", "expected": "1"}'), 'P0001|CHARA_CONFLICT|stale',
  'an edit from an old version is refused');
select is(pg_temp.told('response_received', 'response_id', :'resp_8') || '|' ||
  (select count(*) from public.notifications where payload ->> 'response_id' = :'resp_8' and kind <> 'response_received'),
  :'own1' || ':queued,' || :'adm' || ':queued|0', 'FR-O2 AC9: an edit sends no notification');
select is(pg_temp.upd(:'u2', :'p2', :'resp_8'), 'P0002|CHARA_NOT_FOUND|', 'P2 cannot edit P1''s response');
select is(pg_temp.upd(:'own1', :'acme', :'resp_8'), '42501|CHARA_FORBIDDEN|partner_only', 'the employer cannot edit a response');
select is(split_part(pg_temp.call_as(:'u1', 'authenticated', format('update public.partner_responses set capacity = 1 where id = %L', :'resp_8'), 'aal2'), '|', 1),
  '42501', 'no member updates a response directly');
update public.partner_responses set status = 'shortlisted', decided_at = now() where id = :'resp_8';
select is(pg_temp.upd(:'u1', :'p1', :'resp_8', '{"capacity": "5"}'), 'P0001|CHARA_INVALID_STATE|shortlisted',
  'FR-O2 AC8: an edit after shortlisting is refused');
select is(
  pg_temp.call_as(:'u1', 'authenticated', format('update public.partner_response_versions set payload = ''{}'' where response_id = %L', :'resp_8'))
  || ',' || pg_temp.call_as(:'own1', 'authenticated', format('delete from public.partner_response_versions where response_id = %L', :'resp_8')),
  '42501|permission denied for table partner_response_versions|,42501|permission denied for table partner_response_versions|',
  'FR-O2 AC8: the versions reject UPDATE and DELETE from the API roles');
select throws_ok(format('update public.partner_response_versions set payload = ''{}'' where response_id = %L', :'resp_8'),
  'P0001', 'CHARA_INVALID_INPUT', 'FR-O2 AC8: and from the database owner (append-only trigger)');
select throws_ok(format('update public.partner_responses set status = ''submitted'' where id = %L', :'resp_8'),
  'P0001', 'CHARA_INVALID_TRANSITION', 'DATA_MODEL.md section 5: shortlisted cannot go back');
select throws_ok(format('update public.partner_responses set organization_id = %L where id = %L', :'p2', :'resp_8'),
  'P0001', 'CHARA_INVALID_INPUT', 'the partner of a response never changes');

-- FR-O2 AC7, NFR-S8: who reads responses, versions and the employer views -------------------------------------------------

select pg_temp.seed_resp(:'rb', :'p2') as resp_b \gset
select is(
  pg_temp.read_as(:'u1m', 'select string_agg(distinct organization_id::text, '','') from public.partner_responses')
  || '|' || pg_temp.read_as(:'u1m', 'select string_agg(distinct organization_id::text, '','') from public.partner_response_versions'),
  :'p1' || '|' || :'p1', 'FR-O2 AC7: a member of P1 reads only P1''s responses and versions');
select is(
  pg_temp.read_as(:'u2', 'select string_agg(distinct organization_id::text, '','') from public.partner_responses'),
  :'p2', 'FR-O2 AC7: a member of P2 reads only P2''s responses');
select is(
  pg_temp.read_as(:'mem', format('select count(*) filter (where organization_id = %L) || '','' || count(*) filter (where organization_id = %L) || '','' || (select count(*) from public.partner_responses where requirement_id = %L) from public.partner_responses where requirement_id in (%L, %L)', :'p1', :'p2', :'rb', :'r', :'c0'))
  || '|' || pg_temp.read_as(:'mem', format('select count(*) from public.partner_response_versions where response_id = %L', :'resp_8')),
  '1,1,0|2', 'FR-O2 AC7: an Acme member reads both partners'' responses and every version of its requirements, nothing of Beta''s');
select is(
  pg_temp.read_as(:'own2', format('select count(*) from public.partner_responses where requirement_id in (%L, %L)', :'r', :'c0'))
  || ',' || pg_temp.read_as(:'own1', format('select count(*) from public.partner_responses where id = %L', :'resp_b'))
  || ',' || pg_temp.read_as(:'wkr', 'select count(*) from public.partner_responses')
  || ',' || pg_temp.read_as(:'wkr', 'select count(*) from public.partner_response_versions'),
  '0,0,0,0', 'NFR-S8: Beta reads nothing of Acme''s responses, Acme nothing of Beta''s, a candidate nothing');
select is(split_part(pg_temp.read_as(null, 'select count(*) from public.partner_responses'), '|', 1)
  || ',' || split_part(pg_temp.read_as(null, 'select count(*) from public.partner_response_versions'), '|', 1),
  '42501,42501', 'FR-O2 AC7: an anonymous caller is refused');
select is(
  pg_temp.read_as(:'u2', format('select id::text from public.get_response(%L, %L)', :'p2', :'resp_8'))
  || ',' || pg_temp.read_as(:'u2', format('select count(*) from public.list_response_versions(%L, %L)', :'p2', :'resp_8'))
  || ',' || pg_temp.read_as(:'u2', format('select count(*) from public.list_response_changes(%L, %L)', :'p2', :'resp_8'))
  || ',' || pg_temp.read_as(:'u2', format('select count(*) from public.list_requirement_responses(%L, %L)', :'p2', :'r8')),
  'P0002|CHARA_NOT_FOUND|,P0002|CHARA_NOT_FOUND|,P0002|CHARA_NOT_FOUND|,42501|CHARA_FORBIDDEN|employer_only',
  'FR-O2 AC7: no function returns P1''s response to P2');
select is(
  pg_temp.read_as(:'own2', format('select id::text from public.get_response(%L, %L)', :'beta', :'resp_8'))
  || ',' || pg_temp.read_as(:'own2', format('select count(*) from public.list_requirement_responses(%L, %L)', :'beta', :'r8'))
  || ',' || split_part(pg_temp.read_as(:'wkr', format('select count(*) from public.list_requirement_responses(%L, %L)', :'acme', :'r8')), '|', 1)
  || ',' || split_part(pg_temp.read_as(null, format('select count(*) from public.list_my_responses(%L)', :'p1')), '|', 1),
  'P0002|CHARA_NOT_FOUND|,P0002|CHARA_NOT_FOUND|,42501,42501', 'NFR-S8: other employers, candidates and anonymous callers get nothing');

-- FR-O2 AC9 and FR-N2 AC9 data: Updated until opened, Withdrawn with date and reason ---------------------------------------

select pg_temp.req(:'acme', 'Acme seen R9') as r9 \gset
select is(pg_temp.resp(:'u1', :'p1', :'r9'), 'ok', 'P1 responds to R9');
select pg_temp.result() as resp_9 \gset
select is(pg_temp.upd(:'u1', :'p1', :'resp_9', '{"capacity": "4"}'), 'ok', 'and edits it');
select is(pg_temp.read_as(:'mem', format('select status || '':'' || updated_unseen || '':'' || partner_name from public.list_requirement_responses(%L, %L)', :'acme', :'r9')),
  'updated:true:Alpha V44', 'FR-O2 AC9: the list shows Updated until the employer opens the response');
select is(pg_temp.read_as(:'mem', format('select updated_unseen::text || '':'' || partner_slug || '':'' || coalesce(employer_name, ''-'') from public.get_response(%L, %L)', :'acme', :'resp_9')),
  'true:alpha-v44:-', 'opening it answers that it was unseen, with the partner''s name and slug');
select is(pg_temp.read_as(:'mem', format('select updated_unseen::text from public.list_requirement_responses(%L, %L)', :'acme', :'r9')),
  'false', 'FR-O2 AC9: once opened the badge goes');
select is(pg_temp.read_as(:'mem', format('select string_agg(version || '':'' || array_to_string(changed_fields, ''+''), '','') from public.list_response_versions(%L, %L)', :'acme', :'resp_9')),
  '2:capacity,1:', 'FR-O2 AC9: the employer reads the history, newest first, with the fields changed');
select is(pg_temp.read_as(:'mem', format('select status || '':'' || (withdrawn_at is not null) || '':'' || withdrawal_reason from public.list_requirement_responses(%L, %L) where organization_id = %L', :'acme', :'r', :'p1')),
  'withdrawn:true:Capacity no longer available', 'FR-N2 AC9: the employer sees Withdrawn with its date and reason');

-- The partner's reads; NFR-S11 ------------------------------------------------------------------------------------------------

select is(pg_temp.read_as(:'u1m', format('select title || '':'' || coalesce(employer_name, ''-'') from public.list_my_responses(%L) where requirement_id = %L', :'p1', :'r9')),
  'Germany, 10 Welders and flame cutters:-', 'NFR-S11: a marketplace response shows the generated title and no employer');
select is(pg_temp.read_as(:'u1m', format('select title || '':'' || coalesce(employer_name, ''-'') from public.list_my_responses(%L) where requirement_id = %L', :'p1', :'v')),
  'Acme private V:Acme Bau', 'decision 3.2: an invited partner reads the title and the employer the invitation revealed');
select is(pg_temp.read_as(:'u1m', format('select title || '':'' || coalesce(employer_name, ''-'') || '':'' || max_capacity from public.get_response(%L, %L)', :'p1', :'resp_9')),
  'Germany, 10 Welders and flame cutters:-:10', 'get_response gives the partner the same view and the most it may offer');
select is(pg_temp.read_as(:'u1', format('select count(*) || '':'' || count(next_cursor) from public.list_my_responses(%L, null, 2)', :'p1')),
  '2:1', 'list_my_responses pages with a cursor on the last row');
select is(split_part(pg_temp.read_as(:'u1', format('select count(*) from public.list_my_responses(%L, %L)', :'p1', :'resp_b')), '|', 3),
  'p_cursor', 'a cursor of another partner is refused');
select pg_temp.req(:'acme', 'Acme named SI', p_show => true) as si \gset
select pg_temp.partner('named-v44') as pn \gset
select is(pg_temp.resp(:'padm', :'pn', :'si'), 'ok', 'an eligible partner responds to a job order whose employer shows its name');
select is(pg_temp.read_as(:'padm', format('select title || '':'' || coalesce(employer_name, ''-'') from public.list_my_responses(%L)', :'pn')),
  'Acme named SI:Acme Bau', 'review item 11: while it is fully eligible, show_identity names the employer, as get_job_order does');
delete from billing.subscriptions where organization_id = :'pn';
select is(pg_temp.read_as(:'padm', format('select title || '':'' || coalesce(employer_name, ''-'') from public.list_my_responses(%L)', :'pn')),
  'Germany, 10 Welders and flame cutters:-', 'review item 11: once it is no longer eligible (no paid plan) the employer is not named');

-- Eligibility panel (FR-N2 AC1, AC4 data) and the refusal record (KPI) -------------------------------------------------------

update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.req(:'acme', 'Acme eligibility E') as e \gset
select pg_temp.partner('eligible-v44') as pe \gset
select count(pg_temp.seed_resp(pg_temp.req(:'beta', 'PE earlier ' || n), :'pe')) as seeded from generate_series(1, 3) n \gset
select is(pg_temp.read_as(:'padm', format('select can_respond || '':'' || used || '':'' || limit_value || '':'' || applies || '':'' || max_capacity || '':'' || invited || '':'' || (period_resets_at = %L::timestamptz) from public.get_response_eligibility(%L, %L)', private.month_start(private.month_start() + interval '32 days'), :'pe', :'e')),
  'true:3:10:true:10:false:true', 'FR-N2 AC1: a partner with 3 of 10 responses used may respond, with the limit, the reset and the most it may offer');
select is(pg_temp.read_as(:'padm', format('select can_respond || '':'' || refusal || '':'' || detail from public.get_response_eligibility(%L, %L)', :'q1', :'e')),
  'false:CHARA_LIMIT_REACHED:job_order_responses_per_month', 'FR-N2 AC4: Q1 is told its limit is used up');
select is(pg_temp.read_as(:'padm', format('select refusal || '':'' || detail from public.get_response_eligibility(%L, %L)', :'q4', :'e')),
  'CHARA_FORBIDDEN:served_country_missing', 'FR-N2 AC4: Q4 is told it does not serve the destination');
select is(pg_temp.read_as(:'u1', format('select refusal || '':'' || detail || '':'' || response_status from public.get_response_eligibility(%L, %L)', :'p1', :'r')),
  'CHARA_CONFLICT:already_responded:withdrawn', 'once it responded the panel names its response');
select is(pg_temp.read_as(:'u2', format('select refusal from public.get_response_eligibility(%L, %L)', :'p2', :'v')),
  'P0002|CHARA_NOT_FOUND|', 'FR-N2 AC11: the private requirement is not found for an uninvited partner');
select is(pg_temp.read_as(:'padm', format('select refusal || '':'' || detail from public.get_response_eligibility(%L, %L)', :'q4', :'e')),
  'CHARA_FORBIDDEN:served_country_missing', 'Q4 reads its eligibility a second time');
select is(pg_temp.read_as(:'padm', format('select refusal || '':'' || detail from public.get_response_eligibility(%L, %L)', :'pe', pg_temp.req(:'acme', 'Acme paused P', 'paused'))),
  'CHARA_INVALID_STATE:requirement_not_open', 'a paused job order answers requirement_not_open');
select is(
  (select count(*)::integer from stats.job_order_response_refusals where organization_id = :'pe'),
  0, 'review decision 6: requirement_not_open is not recorded as a refusal');
select is(
  (select string_agg(organization_id::text || ':' || reason || ':' || (last_seen_at >= first_seen_at), ',' order by reason) from stats.job_order_response_refusals
   where requirement_id = :'e' and organization_id in (:'q1', :'q4')),
  :'q1' || ':job_order_responses_per_month:true,' || :'q4' || ':served_country_missing:true',
  'SOP P2-20 KPI responses refused by reason: each refusal shown is recorded once (two reads, one row), no user');
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- Carry-overs: the response count of the job orders (V39) and the KPIs (V36, V41) --------------------------------------------

select is(private.requirement_response_count(:'r') || ',' || private.requirement_response_count(:'c0'), '1,1',
  'V39: the response count is real: R has P1''s withdrawn response and Q1''s, only Q1''s counts');
update private.settings set value = '1' where key = 'job_order_response_count_min';
select is(pg_temp.read_as(:'u2', format('select response_count || '':'' || coalesce(responses_fewer_than::text, ''-'') from public.get_job_order(%L, %L)', :'p2', :'c0')),
  '1:-', 'V39: get_job_order shows the count from job_order_response_count_min on');
update private.settings set value = '5' where key = 'job_order_response_count_min';
select is(pg_temp.read_as(:'u2', format('select coalesce(response_count::text, ''-'') || '':'' || responses_fewer_than from public.get_job_order(%L, %L)', :'p2', :'c0')),
  '-:5', 'V39: below the threshold it shows Fewer than 5');
select ok(
  (select p.created_at >= i.invited_at and i.source = 'directory' from public.partner_responses p
   join public.requirement_invitations i on i.id = p.invitation_id where p.id = :'resp_v'),
  'KPIs median time to first response, responses per (suggestion) invitation: the response names its invitation and its time');

-- Review item 3: an invited responder that withdrew gets no further notice through its invitation ---------------------------

insert into public.requirement_versions (requirement_id, version, organization_id, status, changed_fields, old_values, new_values)
values (:'v', 1, :'acme', 'open', array['workers_needed'], '{"workers_needed": 12}', '{"workers_needed": 10}');
select is(private.queue_requirement_change(:'v', 1), 2, 'P1''s owner and admin are told of a change through the responded invitation');
select is(pg_temp.wd(:'u1', :'p1', :'resp_v'), 'ok', 'P1 withdraws its invited response');
select is(
  (select string_agg(distinct status || ':' || coalesce(email_status, '-'), ',') from public.notifications
   where kind = 'requirement_changed' and payload ->> 'invitation_id' = :'inv_v'),
  'suppressed:suppressed_superseded', 'review item 3: its waiting change emails through the invitation are dropped');
insert into public.requirement_versions (requirement_id, version, organization_id, status, changed_fields, old_values, new_values)
values (:'v', 2, :'acme', 'open', array['start_date'], '{"start_date": "2027-03-01"}', '{"start_date": "2027-04-01"}');
select is(private.queue_requirement_change(:'v', 2), 0, 'review item 3: a later change is not sent to it');
update public.workforce_requirements set closes_on = (now() at time zone 'utc')::date + 3, closing_reminder_for = null where id = :'v';
select ok(private.remind_closing_requirements() >= 1, 'the daily reminder runs');
select (select updated_at from public.workforce_requirements where id = :'v') as v_at \gset
select is(pg_temp.call_as(:'own1', 'authenticated', format('select public.set_requirement_status(%L, %L, ''closed'', %L::timestamptz, ''cancelled'')',
  :'acme', :'v', :'v_at')), 'ok', 'the owner closes V');
select is(
  (select count(*)::integer from public.notifications where kind in ('requirement_closing_soon', 'requirement_closed')
   and payload ->> 'invitation_id' = :'inv_v'),
  0, 'review item 3: no closing reminder and no closing notice through the invitation of a withdrawn response');

-- Review item 9: inviting a partner that already responded links its response; one notice per event -------------------------

select pg_temp.req(:'acme', 'Acme invite after response N9') as n9 \gset
select is(pg_temp.resp(:'u2', :'p2', :'n9'), 'ok', 'P2 responds to N9 on the marketplace');
select pg_temp.result() as resp_n9 \gset
select is(pg_temp.call_as(:'own1', 'authenticated', format(
    'select set_config(''t.result'', (select status::text from public.invite_partners(%L, %L, array[%L]::uuid[], ''directory'')), true)',
    :'acme', :'n9', :'p2'), 'aal2') || ':' || pg_temp.result(), 'ok:responded',
  'review item 9: the invitation of a partner that already responded is created as responded');
select is(
  (select (p.invitation_id = i.id)::text || ':' || (i.responded_at is not null) from public.partner_responses p
   join public.requirement_invitations i on i.requirement_id = p.requirement_id and i.organization_id = p.organization_id
   where p.id = :'resp_n9'),
  'true:true', 'review item 9: the response is linked to the invitation');
select is(pg_temp.told('invitation_received', 'invitation_id', (select invitation_id from public.partner_responses where id = :'resp_n9')),
  :'u2' || ':queued', 'the invitation still reveals the employer and is announced once');
insert into public.requirement_versions (requirement_id, version, organization_id, status, changed_fields, old_values, new_values)
values (:'n9', 1, :'acme', 'open', array['workers_needed'], '{"workers_needed": 12}', '{"workers_needed": 10}');
select is(private.queue_requirement_change(:'n9', 1), 1, 'review item 9: one change notice for P2''s owner');
select is(
  (select string_agg(coalesce(payload ->> 'invitation_id', '-') || ':' || coalesce(payload ->> 'response_id', '-'), ',')
   from public.notifications where kind = 'requirement_changed' and user_id = :'u2'
     and (payload ->> 'response_id' = :'resp_n9' or payload ->> 'invitation_id' = (select invitation_id::text from public.partner_responses where id = :'resp_n9'))),
  (select invitation_id::text from public.partner_responses where id = :'resp_n9') || ':-',
  'review item 9: through the invitation only, never twice');

-- Carry-over V43: the marketplace responders get the change, closing-soon and closed notices ---------------------------------

select pg_temp.req(:'acme', 'Acme notices N') as n \gset
select pg_temp.seed_inv(:'n', :'q4', 'invited') as inv_n \gset
select is(pg_temp.resp(:'u2', :'p2', :'n'), 'ok', 'P2 responds to N on the marketplace');
select pg_temp.result() as resp_n2 \gset
select is(pg_temp.resp(:'u1', :'p1', :'n'), 'ok', 'P1 responds to N on the marketplace');
select pg_temp.result() as resp_n1 \gset
select pg_temp.seed_resp(:'n', :'l3', 'withdrawn') as resp_nw \gset
insert into public.requirement_versions (requirement_id, version, organization_id, status, changed_fields, old_values, new_values)
values (:'n', 1, :'acme', 'open', array['workers_needed'], '{"workers_needed": 12}', '{"workers_needed": 10}');
select is(private.queue_requirement_change(:'n', 1), 4,
  'FR-M2 AC6 P5: the change notice goes to the owners and admins with an active account of each responder (P1: owner and admin, P2: owner) and of the invited Q4, not to the withdrawn responder');
select is(pg_temp.told('requirement_changed', 'response_id', :'resp_n2'), :'u2' || ':queued',
  'the responder P2 is told, keyed by its response');
select is(
  (select title || ':' || coalesce(payload ->> 'employer_name', '-') || ':' || (payload -> 'changed_fields')::text || ':' || (payload ->> 'org_slug')
   from (select n.payload, n.payload ->> 'title' as title from public.notifications n
         where n.kind = 'requirement_changed' and n.payload ->> 'response_id' = :'resp_n2') x),
  'Germany, 10 Welders and flame cutters:-:["workers_needed"]:bravo-v44',
  'NFR-S11: an anonymous requirement is named by its generated title, never the employer, in a responder''s notice');
select is(pg_temp.told('requirement_changed', 'response_id', :'resp_nw'), '', 'a withdrawn response gets no notice');
insert into public.requirement_versions (requirement_id, version, organization_id, status, changed_fields, old_values, new_values)
values (:'n', 2, :'acme', 'open', array['start_date'], '{"start_date": "2027-03-01"}', '{"start_date": "2027-04-01"}');
select is(private.queue_requirement_change(:'n', 2), 0, 'a second edit while the notices wait widens them instead');
select is(
  (select (payload -> 'changed_fields')::text || ':' || (payload ->> 'to_version') from public.notifications
   where kind = 'requirement_changed' and payload ->> 'response_id' = :'resp_n2'),
  '["workers_needed", "start_date"]:2', 'the responder''s waiting notice names both edits');
select is(pg_temp.wd(:'u1', :'p1', :'resp_n1'), 'ok', 'P1 withdraws while its change notice waits');
select is(
  (select string_agg(status || ':' || coalesce(email_status, '-'), ',') from public.notifications
   where kind = 'requirement_changed' and payload ->> 'response_id' = :'resp_n1'),
  'suppressed:suppressed_superseded,suppressed:suppressed_superseded', 'its change emails are dropped, the in-app items stay');
select is(pg_temp.read_as(:'u2', format('select string_agg(version || '':'' || array_to_string(changed_fields, ''+'') || '':'' || coalesce(new_values ->> ''title'', ''-''), '','') from public.list_response_changes(%L, %L)', :'p2', :'resp_n2')),
  '2:start_date:-,1:workers_needed:-', 'the responder reads the changes since its response');
insert into public.requirement_versions (requirement_id, version, organization_id, status, changed_fields, old_values, new_values)
values (:'n', 3, :'acme', 'open', array['title'], '{"title": "Acme old"}', '{"title": "Acme notices N"}');
select is(pg_temp.read_as(:'u2', format('select array_to_string(changed_fields, ''+'') || '':'' || coalesce(old_values ->> ''title'', ''-'') || '':'' || coalesce(new_values ->> ''title'', ''-'') from public.list_response_changes(%L, %L) where version = 3', :'p2', :'resp_n2')),
  'title:-:-', 'NFR-S11: without a reveal the values of the title are left out, the field name stays');
update public.workforce_requirements set closes_on = (now() at time zone 'utc')::date + 3, closing_reminder_for = null where id = :'n';
select ok(private.remind_closing_requirements() >= 1, 'the daily reminder runs');
select is(pg_temp.told('requirement_closing_soon', 'response_id', :'resp_n2') || '|' || pg_temp.told('requirement_closing_soon', 'response_id', :'resp_n1'),
  :'u2' || ':queued|', 'FR-M2 AC6 P5: the live responder is reminded; the withdrawn one is not');
select (select updated_at from public.workforce_requirements where id = :'n') as n_at \gset
select is(pg_temp.call_as(:'own1', 'authenticated', format('select public.set_requirement_status(%L, %L, ''filled'', %L::timestamptz)',
  :'acme', :'n', :'n_at')), 'ok', 'the owner fills N');
select is(
  (select string_agg(n.user_id::text || ':' || (n.payload ->> 'close_reason') || ':' || coalesce(n.payload ->> 'employer_name', '-'), ',')
   from public.notifications n where n.kind = 'requirement_closed' and n.payload ->> 'response_id' = :'resp_n2'),
  :'u2' || ':filled:-', 'FR-M2 AC10: the responder gets the closing notice with the reason and no employer name');
select is(pg_temp.told('requirement_closed', 'response_id', :'resp_n1'), '', 'the withdrawn responder gets no closing notice');
select is((select count(*)::integer from public.notifications where kind = 'requirement_closed' and payload ->> 'invitation_id' = :'inv_n'), 1,
  'the invited partner still gets its closing notice through the invitation');

-- FR-T1 AC4: preferences; release switch ----------------------------------------------------------------------------------

insert into public.notification_preferences (user_id, email_kinds) values (:'adm', '{"response_received": false}')
on conflict (user_id) do update set email_kinds = excluded.email_kinds;
select is(pg_temp.resp(:'u2', :'p2', pg_temp.req(:'acme', 'Acme preference'), '{}'), 'ok', 'P2 responds once more');
select is(pg_temp.told('response_received', 'response_id', pg_temp.result()::uuid),
  :'own1' || ':queued,' || :'adm' || ':suppressed', 'FR-T1 AC4: the admin who turned the email off keeps the in-app item only');
-- Review item 7: versions are deleted only with their response -----------------------------------------------------------

select throws_ok(format('delete from public.partner_response_versions where response_id = %L', :'resp_9'),
  'P0001', 'CHARA_INVALID_INPUT', 'review item 7: a direct delete of a version is refused, even for the database owner');
delete from public.partner_responses where id = :'resp_9';
select is((select count(*)::integer from public.partner_response_versions where response_id = :'resp_9'), 0,
  'review item 7: deleting the response (retention, V58) removes its versions by cascade');

-- Review decision 6: the reads count against the job order allowance -------------------------------------------------------

update private.settings set value = '2' where key = 'rate_limit_job_orders_max';
delete from private.rate_limit_hits;
select is(
  pg_temp.read_as(:'u2', format('select count(*) from public.list_my_responses(%L)', :'p2')) ~ '^[0-9]+$'
  and pg_temp.read_as(:'u2', format('select count(*) from public.get_response_eligibility(%L, %L)', :'p2', :'e')) = '1',
  true, 'two reads within the allowance of 2 are answered');
select is(pg_temp.read_as(:'u2', format('select count(*) from public.get_response(%L, %L)', :'p2', :'resp_n2')),
  'P0001|CHARA_RATE_LIMITED|', 'review decision 6: the third read is refused');
update private.settings set value = '100000' where key = 'rate_limit_job_orders_max';
delete from private.rate_limit_hits;

update private.settings set value = 'false' where key = 'release_job_orders';
select is(
  pg_temp.resp(:'u2', :'p2', :'e') || ',' || pg_temp.wd(:'u2', :'p2', :'resp_n2')
  || ',' || pg_temp.read_as(:'mem', format('select count(*) from public.list_requirement_responses(%L, %L)', :'acme', :'r'))
  || ',' || pg_temp.read_as(:'u2', format('select count(*) from public.get_response_eligibility(%L, %L)', :'p2', :'e')),
  '42501|CHARA_FORBIDDEN|release_off,42501|CHARA_FORBIDDEN|release_off,42501|CHARA_FORBIDDEN|release_off,42501|CHARA_FORBIDDEN|release_off',
  'release 2b: every function refuses while release_job_orders is off');

delete from private.rate_limit_hits;
select * from finish();
rollback;
