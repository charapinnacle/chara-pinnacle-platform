begin;
select plan(67);

\ir jobs_fixture.inc

-- Partner action limits at the boundaries and after a lapse (V51, FR-R1 AC7, AC10 and the data of AC11; SOP P2-35 steps
-- Enforce and Lapse; NFR-A4, NFR-S8): job_order_responses_per_month and candidate_submissions_per_month at the plan's own
-- limits, the month boundary, the lapse to the free partner plan (the limit 0 named as the limit, whatever
-- entitlements_enforced says, nothing deleted), record_limit_prompt for both keys, and the lapse serialised with the
-- partner's responses and submissions. Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner own2, admin
-- adm2) are employers of the fixture and wkr is a candidate; the partners are made below.

\set ra '00000000-0000-0000-0000-0000000f5111'
\set rm '00000000-0000-0000-0000-0000000f5112'
\set sa '00000000-0000-0000-0000-0000000f5113'
\set la '00000000-0000-0000-0000-0000000f5114'
\set lm '00000000-0000-0000-0000-0000000f5115'
\set qa '00000000-0000-0000-0000-0000000f5116'
\set fa '00000000-0000-0000-0000-0000000f5117'
\set cown '00000000-0000-0000-0000-0000000f5190'
\set org_c '00000000-0000-0000-0000-0000000f5191'
\set c_p '00000000-0000-0000-0000-0000000f5192'
\set c_l '00000000-0000-0000-0000-0000000f5193'
\set pown '00000000-0000-0000-0000-0000000f5194'
\set c_r1 '00000000-0000-0000-0000-0000000f5195'
\set c_r2 '00000000-0000-0000-0000-0000000f5196'
\set c_s '00000000-0000-0000-0000-0000000f5197'
\set c_r3 '00000000-0000-0000-0000-0000000f5198'

-- Concurrency at the boundary (NFR-A4) first, before this transaction writes a settings row the committed setup changes ---

create extension if not exists dblink schema extensions;
select extensions.dblink_connect('setup',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('blocked',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
-- An employer with three job orders of the marketplace (R1, R2, R3) and a requirement S on which P's response is selected,
-- and two eligible partners owned by pown, who accepted the commitment: P on recruitment_partner (its own limits, 10
-- responses and 25 submissions, no override) with 8 responses to other requirements plus the selected one (9 this month)
-- and 24 requests this month; L on recruitment_professional with a subscription of the null provider, for the lapse. The
-- employer's owner has a suspended account and the addresses belong to no account, so nothing committed is emailed.
select extensions.dblink_exec('setup', format($$
  begin;
  update private.settings set value = 'true' where key in ('release_job_orders', 'release_candidate_submissions');
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%1$L, %1$L || '@employer.test', now(), '{"intended_account_kind": "company"}'),
         (%5$L, %5$L || '@partner.test', now(), '{"intended_account_kind": "company"}');
  update public.profiles set account_kind = intended_account_kind where id in (%1$L, %5$L);
  update public.profiles set status = 'suspended' where id = %1$L;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (%2$L, 'employer', 'limit-lock-' || left(%2$L, 8), 'Limit Lock GmbH', 'Limit Lock', 'DE'),
         (%3$L, 'recruitment_company', 'limit-lock-p-' || left(%3$L, 8), 'Limit Lock P Ltd', 'Limit Lock P', 'PH'),
         (%4$L, 'recruitment_company', 'limit-lock-l-' || left(%4$L, 8), 'Limit Lock L Ltd', 'Limit Lock L', 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (%2$L, %1$L, 'owner', now()), (%3$L, %5$L, 'owner', now()), (%4$L, %5$L, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  select x, s::public.geography_scope, c from unnest(array[%3$L, %4$L]::uuid[]) x,
    (values ('serves_market', 'DE'), ('sources_from', 'PH')) g (s, c);
  insert into public.organization_occupations (organization_id, occupation_id) select x, '7212' from unnest(array[%3$L, %4$L]::uuid[]) x;
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id in (%3$L, %4$L);
  insert into billing.subscriptions (organization_id, plan_code, status, provider, provider_subscription_ref)
  values (%3$L, 'recruitment_partner', 'active', 'null', null),
         (%4$L, 'recruitment_professional', 'active', 'null', 'sub_' || %4$L);
  insert into public.consents (user_id, purpose, version, action)
  values (%5$L, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on
  ) select x.id, %2$L, x.t, 10, 'DE', 'Hamburg', 'C', current_date + 30, 'full_time', 'international', 'both',
    'open', 'job_order_marketplace', now(), current_date + 80
  from (
    values (%6$L::uuid, 'Lock R1'), (%7$L::uuid, 'Lock R2'), (%8$L::uuid, 'Lock S'), (%9$L::uuid, 'Lock R3')
    union all
    select gen_random_uuid(), 'Lock earlier ' || n from generate_series(1, 8) n
  ) x (id, t);
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select id, '7212', 10 from public.workforce_requirements where organization_id = %2$L;
  insert into public.requirement_countries (requirement_id, country_code)
  select id, 'DE' from public.workforce_requirements where organization_id = %2$L;
  insert into public.partner_responses (
    requirement_id, organization_id, employer_organization_id, status, capacity, available_from, experience_note, fee_model,
    decided_at, submissions_allowed
  ) select r.id, %3$L, %2$L, case when r.id = %8$L then 'selected' else 'submitted' end::public.response_status, 5,
    current_date + 30, 'Twenty welders placed in Hamburg last year.', 'on_request',
    case when r.id = %8$L then now() end, r.id = %8$L
  from public.workforce_requirements r where r.organization_id = %2$L and (r.title like 'Lock earlier %%' or r.id = %8$L);
  insert into public.candidate_submissions (requirement_id, organization_id, employer_organization_id, response_id, invited_email)
  select %8$L, %3$L, %2$L, p.id, 'earlier' || n || '-' || left(%3$L, 8) || '@nobody.test'
  from public.partner_responses p, generate_series(1, 24) n where p.requirement_id = %8$L and p.organization_id = %3$L;
  commit;
$$, :'cown', :'org_c', :'c_p', :'c_l', :'pown', :'c_r1', :'c_r2', :'c_s', :'c_r3'));

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
    %L, 1500, 'EUR') is not null)::text$f$, p_org, p_req,
    case private.org_type(p_org) when 'staffing_company' then 'monthly_rate' else 'fee_per_hire' end)
$$;

create function pg_temp.submit_sql(p_org uuid, p_req uuid, p_email text) returns text
language sql as $$
  select format($f$select (select status from public.submit_candidate(%L, %L, %L))::text$f$, p_org, p_req, p_email)
$$;

-- Sends p_sql as pown on a third connection with entitlements_enforced on in its own transaction, without waiting.
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

select set_config('t.pown', :'pown', false) as setup_pown \gset
select is(pg_temp.hold(pg_temp.respond_sql(:'c_p', :'c_r1')), 'true',
  'P at 9 of 10 responses this month: a second session sends the tenth and keeps its transaction open');
select pg_temp.send_blocked(pg_temp.respond_sql(:'c_p', :'c_r2')) as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1, 'NFR-A4: an eleventh response of P at the same time waits for the partner''s lock');
select extensions.dblink_exec('holder', 'commit') as committed \gset
select matches(pg_temp.blocked_result(), 'CHARA_LIMIT_REACHED',
  'NFR-A4, FR-R1 AC7: once the tenth is committed the waiting one counts it and is refused at the plan''s limit of 10');
select is((select count(*)::integer from public.partner_responses where organization_id = :'c_p'), 10,
  'NFR-A4: P holds exactly 10 responses this month, never 11');

select is(pg_temp.hold(pg_temp.submit_sql(:'c_p', :'c_s', 'twenty-fifth-' || left(:'c_p', 8) || '@nobody.test')), 'awaiting_candidate',
  'P at 24 of 25 requests this month: a second session sends the 25th and keeps its transaction open');
select pg_temp.send_blocked(pg_temp.submit_sql(:'c_p', :'c_s', 'twenty-sixth-' || left(:'c_p', 8) || '@nobody.test')) as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1, 'NFR-A4: a 26th request of P at the same time waits for the partner''s lock');
select extensions.dblink_exec('holder', 'commit') as committed \gset
select matches(pg_temp.blocked_result(), 'CHARA_LIMIT_REACHED',
  'NFR-A4, FR-R1 AC7: once the 25th is committed the waiting one counts it and is refused at the plan''s limit of 25');
select is((select count(*)::integer from public.candidate_submissions where organization_id = :'c_p'), 25,
  'NFR-A4: P holds exactly 25 requests this month, never 26');

-- The lapse of L in the holder session (the webhook as the service applies it), kept open: a response of L waits for it.
select is(
  (select t from extensions.dblink('holder', format($f$
    begin;
    set local lock_timeout = '2s';
    select public.billing_apply_event(public.billing_ingest_event('null', 'lapse_' || %1$L, 'subscription.canceled',
      jsonb_build_object('orgId', %1$L, 'planCode', 'recruitment_professional', 'status', 'canceled',
        'providerSubscriptionRef', 'sub_' || %1$L), true, now()));
  $f$, :'c_l')) as r (t text)),
  'applied', 'L''s subscription is cancelled by the webhook in a second session, kept open');
select pg_temp.send_blocked(pg_temp.respond_sql(:'c_l', :'c_r3')) as sent \gset
select pg_sleep(0.3) as slept \gset
select is(extensions.dblink_is_busy('blocked'), 1, 'NFR-A4: a response of L during the lapse waits for it');
select extensions.dblink_exec('holder', 'commit') as committed \gset
select matches(pg_temp.blocked_result(), 'CHARA_LIMIT_REACHED',
  'NFR-A4, FR-R1 AC10: once the lapse is committed the response counts against the free plan and is refused');
select is((select count(*)::integer from public.partner_responses where organization_id = :'c_l'), 0, 'L wrote no response');

select extensions.dblink_disconnect('holder');
select extensions.dblink_disconnect('blocked');
select extensions.dblink_exec('setup', format($$
  begin;
  delete from public.workforce_requirements where organization_id = %2$L;
  delete from private.rate_limit_hits where (action, bucket) in (
    ('user:audited_write', (hashtextextended(%5$L, 0) & 2147483647)::integer),
    ('org:audited_write', (hashtextextended(%3$L, 0) & 2147483647)::integer),
    ('org:audited_write', (hashtextextended(%4$L, 0) & 2147483647)::integer));
  delete from billing.provider_events where provider_event_id = 'lapse_' || %4$L;
  delete from billing.subscriptions where organization_id in (%3$L, %4$L);
  delete from public.organizations where id in (%2$L, %3$L, %4$L);
  delete from auth.users where id in (%1$L, %5$L);
  update private.settings set value = 'false' where key in ('release_job_orders', 'release_candidate_submissions');
  commit;
$$, :'cown', :'org_c', :'c_p', :'c_l', :'pown'));
select extensions.dblink_disconnect('setup');
select is(
  (select count(*)::integer from public.organizations where id in (:'org_c', :'c_p', :'c_l'))
    + (select count(*)::integer from auth.users where id in (:'cown', :'pown')),
  0, 'the committed organisations of the concurrency test are removed again');

-- The fixture ---------------------------------------------------------------------------------------------------------------

update private.settings set value = 'true'
where key in ('release_job_orders', 'release_candidate_submissions', 'release_partner_directories');
update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key = 'rate_limit_job_orders_max';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max');
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (:'acme', 'employer_starter', 'active', 'null'), (:'beta', 'employer_starter', 'active', 'null');

-- A listed partner of p_type serving DE, sourcing from PH and listing 7212, owned by p_owner, with an active subscription to
-- p_plan (none when null, the provider reference sub_<id>) and the commitment accepted.
create function pg_temp.partner(p_slug text, p_owner uuid, p_plan text, p_type text default 'recruitment_company') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  values (v_id, 'serves_market', 'DE'), (v_id, 'sources_from', 'PH');
  insert into public.organization_occupations (organization_id, occupation_id) values (v_id, '7212');
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider, provider_subscription_ref)
    values (v_id, p_plan, 'active', 'null', 'sub_' || v_id);
  end if;
  insert into public.consents (user_id, purpose, version, action)
  values (p_owner, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
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

-- An open job order of p_org on the marketplace: 10 welders of 7212 to Germany.
create function pg_temp.req(p_org uuid, p_title text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, duration_months,
    employment_type, recruitment_preference, partner_need, status, visibility, published_at, closes_on
  ) values (
    v_id, p_org, p_title, 10, 'DE', 'Hamburg', 'C', date '2027-03-01', 12, 'full_time', 'both', 'both', 'open',
    'job_order_marketplace', now() - interval '10 days', date '2027-04-01'
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

-- p_count responses of p_partner created at p_at, each to a new job order of p_employer.
create function pg_temp.seed_responses(p_partner uuid, p_employer uuid, p_count integer, p_at timestamptz default now())
returns integer
language sql as $$
  with r as (select pg_temp.req(p_employer, 'Earlier ' || n) as id from generate_series(1, p_count) n)
  insert into public.partner_responses (
    requirement_id, organization_id, employer_organization_id, status, capacity, available_from, experience_note, fee_model,
    created_at
  )
  select r.id, p_partner, p_employer, 'submitted', 5, current_date + 30, 'Twenty welders placed in Hamburg last year.',
    'on_request', p_at
  from r;
  select count(*)::integer from public.partner_responses where organization_id = p_partner
$$;

-- A job order of p_employer on which p_partner's response is selected, so that the partner may submit candidates.
create function pg_temp.selected(p_partner uuid, p_employer uuid) returns uuid
language sql as $$
  insert into public.partner_responses (
    requirement_id, organization_id, employer_organization_id, status, capacity, available_from, experience_note, fee_model,
    decided_at, submissions_allowed
  ) values (pg_temp.req(p_employer, 'Selected'), p_partner, p_employer, 'selected', 5, current_date + 30,
    'Twenty welders placed in Hamburg last year.', 'on_request', now(), true)
  returning requirement_id
$$;

-- p_count requests of p_partner for the requirement p_req created this month, to addresses of no account.
create function pg_temp.seed_requests(p_partner uuid, p_req uuid, p_count integer) returns integer
language sql as $$
  insert into public.candidate_submissions (requirement_id, organization_id, employer_organization_id, response_id, invited_email)
  select p.requirement_id, p.organization_id, p.employer_organization_id, p.id, 'seeded' || n || '-' || left(p_partner::text, 8) || '@nobody.test'
  from public.partner_responses p, generate_series(1, p_count) n
  where p.requirement_id = p_req and p.organization_id = p_partner;
  select count(*)::integer from public.candidate_submissions where organization_id = p_partner
$$;

create function pg_temp.resp(p_user uuid, p_org uuid, p_req uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select public.respond_to_invitation(%L, %L, 5, current_date + 30, 'Twenty welders placed in Hamburg last year.',
      %L, 1500, 'EUR')$f$, p_org, p_req,
      case private.org_type(p_org) when 'staffing_company' then 'monthly_rate' else 'fee_per_hire' end), 'aal1')
$$;

create function pg_temp.sub(p_user uuid, p_org uuid, p_req uuid, p_email text) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select * from public.submit_candidate(%L, %L, %L)', p_org, p_req, p_email),
    'aal1')
$$;

create function pg_temp.prompt(p_user uuid, p_org uuid, p_key text) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select public.record_limit_prompt(%L, %L)', p_org, p_key), 'aal1')
$$;

-- The limit.prompt_shown rows of p_org for p_key as 'plan:limit:used', oldest first.
create function pg_temp.prompts(p_org uuid, p_key text) returns text
language sql as $$
  select coalesce(string_agg(format('%s:%s:%s', l.metadata ->> 'plan_code', l.metadata ->> 'limit', l.metadata ->> 'used'), ',' order by l.id), '')
  from audit.log l where l.action = 'limit.prompt_shown' and l.entity_id = p_org::text and l.metadata ->> 'limit_key' = p_key
$$;

-- The rows a partner's work leaves, to compare before and after a refusal or a lapse.
create function pg_temp.footprint(p_org uuid) returns text
language sql as $$
  select concat_ws(',',
    (select count(*) from public.partner_responses where organization_id = p_org),
    (select count(*) from public.candidate_submissions where organization_id = p_org),
    (select count(*) from audit.log))
$$;

-- FR-R1 AC7: the plans' own monthly limits at the boundary --------------------------------------------------------------------

update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.partner('boundary-r', :'ra', 'recruitment_partner') as r \gset
select pg_temp.member(:'r', :'rm', 'member') as seeded \gset
select pg_temp.selected(:'r', :'acme') as rs \gset
select pg_temp.seed_responses(:'r', :'beta', 8) as seeded \gset
select pg_temp.seed_responses(:'r', :'beta', 3, private.month_start() - interval '1 day') as seeded \gset
select is(private.monthly_usage(:'r', 'job_order_responses_per_month'), 9,
  'AC7: R holds 9 responses this calendar month (UTC) to Acme and Beta; the 3 of last month do not count');
select is(pg_temp.prompt(:'ra', :'r', 'job_order_responses_per_month') || ':' || pg_temp.prompts(:'r', 'job_order_responses_per_month'), 'ok:',
  'FR-R1 AC11: below the limit no prompt is recorded');
select pg_temp.req(:'acme', 'Boundary 1') as b1 \gset
select pg_temp.req(:'acme', 'Boundary 2') as b2 \gset
select is(pg_temp.resp(:'rm', :'r', :'b1'), 'ok', 'AC7: R''s tenth response succeeds');
select pg_temp.footprint(:'r') as before_refusal \gset
select is(pg_temp.resp(:'rm', :'r', :'b2'), 'P0001|CHARA_LIMIT_REACHED|job_order_responses_per_month',
  'AC7: the eleventh fails with CHARA_LIMIT_REACHED and detail job_order_responses_per_month');
select is(pg_temp.footprint(:'r'), :'before_refusal', 'AC7: the refused response leaves no row and no audit entry');
select is(pg_temp.val_as(:'rm', 'aal1', format(
    $$select used || '/' || limit_value || '/' || applies || '/' || period_resets_at || '/' || plan_name
      from public.org_usage(%L, array['job_order_responses_per_month'])$$, :'r')),
  (select '10/10/true/' || (private.month_start() + interval '1 month') || '/' || name from billing.plans where code = 'recruitment_partner'),
  'FR-R1 AC11: a member reads 10 of 10, the reset on the first of next month and the plan name of billing.plans');
select is(pg_temp.prompt(:'rm', :'r', 'job_order_responses_per_month'), '42501|CHARA_FORBIDDEN|',
  'FR-R1 AC11: a member is shown the usage, but only an owner or admin records the upgrade prompt');
select is(pg_temp.prompt(:'ra', :'r', 'job_order_responses_per_month') || ':' || pg_temp.prompts(:'r', 'job_order_responses_per_month'),
  'ok:recruitment_partner:10:10', 'FR-R1 AC11: the owner''s prompt at the limit is recorded with the plan, the limit and the use');

select is(pg_temp.seed_requests(:'r', :'rs', 24), 24, 'AC7: R holds 24 candidate requests this month');
select is(split_part(pg_temp.sub(:'rm', :'r', :'rs', 'twenty-fifth@nobody.test'), '|', 1), 'ok', 'AC7: the 25th submission succeeds');
select pg_temp.footprint(:'r') as before_refusal \gset
select is(pg_temp.sub(:'rm', :'r', :'rs', 'twenty-sixth@nobody.test'), 'P0001|CHARA_LIMIT_REACHED|candidate_submissions_per_month',
  'AC7: the 26th fails with detail candidate_submissions_per_month');
select is(pg_temp.footprint(:'r'), :'before_refusal', 'AC7: the refused request leaves no row and no audit entry');
select is(split_part(pg_temp.sub(:'rm', :'r', :'rs', 'twenty-fifth@nobody.test'), '|', 1), 'ok',
  'FR-O4 AC8: the address already asked is answered at the limit and counts nothing');
select is(pg_temp.prompt(:'ra', :'r', 'candidate_submissions_per_month') || ':' || pg_temp.prompts(:'r', 'candidate_submissions_per_month'),
  'ok:recruitment_partner:25:25', 'FR-R1 AC11: the submissions prompt at the limit is recorded too');

select pg_temp.partner('boundary-s', :'sa', 'staffing_professional', 'staffing_company') as s \gset
select is(pg_temp.seed_responses(:'s', :'acme', 49), 49, 'AC7: staffing company S on staffing_professional holds 49 responses');
select pg_temp.req(:'beta', 'Staffing 1') as s1 \gset
select pg_temp.req(:'beta', 'Staffing 2') as s2 \gset
select is(pg_temp.resp(:'sa', :'s', :'s1'), 'ok', 'AC7: S''s 50th response succeeds');
select is(pg_temp.resp(:'sa', :'s', :'s2'), 'P0001|CHARA_LIMIT_REACHED|job_order_responses_per_month',
  'AC7: the 51st fails under the one key of both partner types');

-- The clock moved to the first day of the next month, 00:00 UTC: this month's rows become last month's.
alter table public.partner_responses disable trigger partner_responses_immutable;
update public.partner_responses set created_at = private.month_start() - interval '1 microsecond' where organization_id = :'r';
alter table public.partner_responses enable always trigger partner_responses_immutable;
alter table public.candidate_submissions disable trigger candidate_submissions_immutable;
update public.candidate_submissions set created_at = private.month_start() - interval '1 microsecond' where organization_id = :'r';
alter table public.candidate_submissions enable always trigger candidate_submissions_immutable;
select is(private.monthly_usage(:'r', 'job_order_responses_per_month') || ',' || private.monthly_usage(:'r', 'candidate_submissions_per_month'),
  '0,0', 'AC7: a row of the last microsecond of the month does not count in the next');
select is(pg_temp.resp(:'rm', :'r', :'b2'), 'ok', 'AC7: in the new month R''s response succeeds');
select is(split_part(pg_temp.sub(:'rm', :'r', :'rs', 'new-month@nobody.test'), '|', 1), 'ok', 'AC7: and so does its request');

-- NFR-S8: the count is the partner's own, whichever employer, and no one else records its prompt ------------------------------

select pg_temp.partner('boundary-q', :'qa', 'recruitment_partner') as q \gset
select is(pg_temp.resp(:'qa', :'q', :'s2'), 'ok', 'NFR-S8: S''s use does not count against Q, which responds to the same job order');
select is(private.monthly_usage(:'q', 'job_order_responses_per_month') || ',' || private.monthly_usage(:'s', 'job_order_responses_per_month'),
  '1,50', 'NFR-S8: each partner counts its own responses only');
select is(pg_temp.prompt(:'qa', :'s', 'job_order_responses_per_month'), '42501|CHARA_FORBIDDEN|',
  'NFR-S8: the owner of another partner cannot record S''s prompt');
select is(pg_temp.prompt(:'own1', :'s', 'job_order_responses_per_month'), '42501|CHARA_FORBIDDEN|', 'NFR-S8: nor an employer''s owner');
select is(pg_temp.prompt(:'own2', :'s', 'job_order_responses_per_month'), '42501|CHARA_FORBIDDEN|', 'NFR-S8: nor the other employer''s');
select is(split_part(pg_temp.prompt(:'wkr', :'s', 'job_order_responses_per_month'), '|', 1), '42501', 'NFR-S8: nor a candidate');
select is(split_part(pg_temp.prompt(null, :'s', 'job_order_responses_per_month'), '|', 1), '42501', 'NFR-S8: nor an anonymous caller');
select is(split_part(pg_temp.resp(:'qa', :'s', :'s1'), '|', 1), '42501', 'NFR-S8: Q''s owner cannot respond for S');
select is(split_part(pg_temp.call_as(:'qa', 'authenticated', format('select count(*) from public.org_usage(%L)', :'s'), 'aal1'), '|', 1),
  '42501', 'NFR-S8: nor read S''s usage');

-- FR-R1 AC10: the lapse to the free partner plan keeps everything and stops new work -------------------------------------------

update private.settings set value = 'false' where key = 'entitlements_enforced';
select pg_temp.partner('lapsing-l', :'la', 'recruitment_professional') as l \gset
select pg_temp.member(:'l', :'lm', 'member') as seeded \gset
select pg_temp.member(:'l', gen_random_uuid(), 'admin') as seeded \gset
select pg_temp.member(:'l', gen_random_uuid(), 'member') as seeded \gset
insert into public.organization_geographies (organization_id, scope, country_code)
select :'l', 'serves_market', c from unnest(array['AT', 'NL', 'BE', 'FR', 'IT']) c;
insert into public.organization_occupations (organization_id, occupation_id)
select :'l', code from public.occupations where code > '7212' order by code limit 19;
update public.organizations set description = 'Welders and pipe fitters from the Philippines.' where id = :'l';
select pg_temp.selected(:'l', :'acme') as ls \gset
select is(pg_temp.seed_responses(:'l', :'beta', 11), 12, 'AC10: L on recruitment_professional holds 12 responses this month');
select is(pg_temp.seed_requests(:'l', :'ls', 30), 30, 'AC10: and 30 candidate requests');
select is(
  (select count(*) from public.organization_geographies where organization_id = :'l' and scope = 'serves_market') || ','
    || (select count(*) from public.organization_occupations where organization_id = :'l') || ','
    || (select count(*) from public.organization_members where organization_id = :'l'),
  '6,20,4', 'AC10: 6 served countries, 20 occupations and 4 members');
create temporary table l_before on commit drop as
  select 'geo' as t, md5(string_agg(country_code || scope, ',' order by country_code, scope)) as h from public.organization_geographies where organization_id = :'l'
  union all select 'occ', md5(string_agg(occupation_id, ',' order by occupation_id)) from public.organization_occupations where organization_id = :'l'
  union all select 'mem', md5(string_agg(user_id || role::text, ',' order by user_id)) from public.organization_members where organization_id = :'l'
  union all select 'resp', md5(string_agg(to_jsonb(p)::text, ',' order by p.id)) from public.partner_responses p where organization_id = :'l'
  union all select 'sub', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.candidate_submissions s where organization_id = :'l'
  union all select 'list', md5(coalesce(string_agg(to_jsonb(w)::text, ',' order by w.id), '')) from public.workforce_availability w where organization_id = :'l';

select is(
  public.billing_apply_event(public.billing_ingest_event('null', 'v51_lapse_l', 'subscription.canceled',
    jsonb_build_object('orgId', :'l', 'planCode', 'recruitment_professional', 'status', 'canceled', 'providerSubscriptionRef', 'sub_' || :'l'),
    true, now())),
  'applied', 'AC10: the webhook applies the cancellation of L''s subscription');
select is(private.org_plan_code(:'l'), 'free_recruitment_company', 'AC10: L falls back to free_recruitment_company');
select is(private.partner_lapsed(:'l') || ',' || private.partner_lapsed(:'q'), 'true,false', 'L lapsed; Q, still paying, did not');
select is((select count(*)::integer from audit.log where action = 'billing.event_applied' and entity_id = :'l'), 1,
  'AC10: one billing.event_applied audit row for the event');
select pg_temp.req(:'acme', 'After the lapse') as al \gset
select pg_temp.footprint(:'l') as before_refusal \gset
select is(pg_temp.resp(:'lm', :'l', :'al'), 'P0001|CHARA_LIMIT_REACHED|job_order_responses_per_month',
  'AC10: a response fails with CHARA_LIMIT_REACHED although entitlements_enforced is off');
select is(pg_temp.sub(:'lm', :'l', :'ls', 'after-lapse@nobody.test'), 'P0001|CHARA_LIMIT_REACHED|candidate_submissions_per_month',
  'AC10: and so does a submission');
select is(pg_temp.footprint(:'l'), :'before_refusal', 'AC10: neither leaves a row or an audit entry');
select is(pg_temp.val_as(:'lm', 'aal1', format(
    $$select string_agg(limit_key || '=' || used || '/' || limit_value || '/' || applies, ',' order by limit_key)
      from public.org_usage(%L, array['candidate_submissions_per_month', 'job_order_responses_per_month'])$$, :'l')),
  'candidate_submissions_per_month=30/0/true,job_order_responses_per_month=12/0/true',
  'AC10: the members read the free plan''s limit of 0, applied, for both keys');
select is(pg_temp.val_as(:'lm', 'aal1', format(
    $$select refusal || ':' || detail || ':' || used || '/' || limit_value from public.get_response_eligibility(%L, %L)$$, :'l', :'al')),
  'CHARA_LIMIT_REACHED:job_order_responses_per_month:12/0', 'AC10: the eligibility read names the limit, for the upgrade prompt');
select is(pg_temp.prompt(:'la', :'l', 'job_order_responses_per_month') || ',' || pg_temp.prompt(:'la', :'l', 'candidate_submissions_per_month')
    || ':' || pg_temp.prompts(:'l', 'job_order_responses_per_month') || ';' || pg_temp.prompts(:'l', 'candidate_submissions_per_month'),
  'ok,ok:free_recruitment_company:0:12;free_recruitment_company:0:30',
  'AC10: the owner''s prompts after the lapse are recorded with the free plan and its limit of 0');
select is(pg_temp.call_as(:'la', 'authenticated', format('select public.set_organization_geographies(%L, %L, %L)', :'l',
    array['PH'], array['DE', 'AT', 'NL', 'BE', 'FR', 'IT', 'PL'])),
  'P0001|CHARA_LIMIT_REACHED|markets', 'AC10: a new served country fails with detail markets');
select is(pg_temp.call_as(:'la', 'authenticated', format(
    'select public.update_organization_profile(%L, %L, %L, %L, %L, null, %L)', :'l', 'Legal lapsing-l Ltd', 'Lapsing L', 'PH', 'N',
    'Welders, pipe fitters and riggers from the Philippines.')),
  'ok', 'AC10: the description edit succeeds');
select is(
  (select string_agg(t || '=' || (h = (select b.h from l_before b where b.t = x.t))::text, ',' order by t) from (
    select 'geo' as t, md5(string_agg(country_code || scope, ',' order by country_code, scope)) as h from public.organization_geographies where organization_id = :'l'
    union all select 'occ', md5(string_agg(occupation_id, ',' order by occupation_id)) from public.organization_occupations where organization_id = :'l'
    union all select 'mem', md5(string_agg(user_id || role::text, ',' order by user_id)) from public.organization_members where organization_id = :'l'
    union all select 'resp', md5(string_agg(to_jsonb(p)::text, ',' order by p.id)) from public.partner_responses p where organization_id = :'l'
    union all select 'sub', md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.candidate_submissions s where organization_id = :'l'
    union all select 'list', md5(coalesce(string_agg(to_jsonb(w)::text, ',' order by w.id), '')) from public.workforce_availability w where organization_id = :'l'
  ) x),
  'geo=true,list=true,mem=true,occ=true,resp=true,sub=true',
  'AC10: no geography, occupation, member, response, submission or listing row is deleted or changed');
delete from private.rate_limit_hits;
select is(pg_temp.call_as(:'own1', 'authenticated',
    $$select set_config('t.found', (select count(*)::text from public.search_partners('recruitment', p_destination => 'NL') s
      where s.slug = 'lapsing-l'), true)$$, 'aal1') || ':' || current_setting('t.found', true),
  'ok:1', 'AC10: L is still returned by search_partners for one of its served countries');

-- What the lapse does not change: a partner that never paid, and a lapsed one below its free plan's limit -----------------

select pg_temp.partner('never-paid-f', :'fa', null) as f \gset
select is(pg_temp.resp(:'fa', :'f', :'al'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|job_order_access',
  'decision 3.6: a partner that never subscribed is told the plan, not a limit, with enforcement off');
update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(pg_temp.resp(:'fa', :'f', :'al'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|job_order_access', 'decision 3.6: and on');
update private.settings set value = 'false' where key = 'entitlements_enforced';
-- As the plan editor (FR-R2) could set them: the free plan's limits above L's use.
update billing.plan_limits set limit_value = 20 where plan_code = 'free_recruitment_company' and limit_key = 'job_order_responses_per_month';
update billing.plan_limits set limit_value = 40 where plan_code = 'free_recruitment_company' and limit_key = 'candidate_submissions_per_month';
select is(pg_temp.resp(:'lm', :'l', :'al'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|job_order_access',
  'a free plan limit above the lapsed partner''s use leaves the plan as the refusal: job order access needs a paid plan');
select is(pg_temp.sub(:'lm', :'l', :'ls', 'after-lapse@nobody.test'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|job_order_access',
  'and so for a submission');
update billing.plan_limits set limit_value = 0 where plan_code = 'free_recruitment_company'
  and limit_key in ('job_order_responses_per_month', 'candidate_submissions_per_month');

-- A new subscription ends the lapse without a code change ------------------------------------------------------------------------

insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'l', 'recruitment_enterprise', 'active', 'null');
select is(private.partner_lapsed(:'l'), false, 'a partner that subscribes again is no longer lapsed');
select is(pg_temp.resp(:'lm', :'l', :'al'), 'ok', 'it responds again: 13 of 200 this month');
select is(split_part(pg_temp.sub(:'lm', :'l', :'ls', 'after-lapse@nobody.test'), '|', 1), 'ok', 'and submits: 31 of 500');

-- Privileges -------------------------------------------------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'private.partner_lapsed(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.partner_lapsed(uuid)', 'execute'),
  'private.partner_lapsed is not callable through the API');

select * from finish();
rollback;
