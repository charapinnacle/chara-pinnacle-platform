begin;
select plan(216);

\ir jobs_fixture.inc

-- Invitations of partners to workforce requirements, data (V41, FR-O1 AC1 to AC7, AC10 and the data of AC8, AC9, AC12;
-- SOP P2-21 steps Invite, Notify, Answer, Track, Withdraw; controls per-requirement limits, listed partners only, rate
-- limits; FR-M3 AC9 and step Measure; decisions 2.2, 3.1, 3.2; NFR-S8, NFR-S11, NFR-A3, NFR-A4, NFR-O5):
-- public.requirement_invitations, invite_partners, withdraw_invitation, answer_invitation, get_invitation,
-- list_my_invitations, list_requirement_invitations, requirement_invitation_usage, the expiry on close, the kinds
-- invitation_received and invitation_withdrawn and the setting partner_invitations_per_day_max. Acme (t.a: owner own1,
-- admin adm, member mem) and Beta (t.b: owner own2, admin adm2) are employers of the fixture and wkr is a candidate;
-- Gamma, the lapsed Delta, a Platform Administrator and the partners are made below.

\set sadm '00000000-0000-0000-0000-0000000f4100'
\set ug '00000000-0000-0000-0000-0000000f4101'
\set ud '00000000-0000-0000-0000-0000000f4102'
\set u1 '00000000-0000-0000-0000-0000000f4111'
\set u1a '00000000-0000-0000-0000-0000000f4112'
\set u1m '00000000-0000-0000-0000-0000000f4113'
\set u1p '00000000-0000-0000-0000-0000000f4114'
\set u1s '00000000-0000-0000-0000-0000000f4115'
\set us1 '00000000-0000-0000-0000-0000000f4116'
\set u2 '00000000-0000-0000-0000-0000000f4117'
\set u6 '00000000-0000-0000-0000-0000000f4118'
\set cown '00000000-0000-0000-0000-0000000f4190'
\set org_c '00000000-0000-0000-0000-0000000f4191'
\set c_req '00000000-0000-0000-0000-0000000f4192'
\set c_p1 '00000000-0000-0000-0000-0000000f4193'
\set c_p2 '00000000-0000-0000-0000-0000000f4194'
\set c_p3 '00000000-0000-0000-0000-0000000f4195'
\set c_p4 '00000000-0000-0000-0000-0000000f4196'
\set c_p5 '00000000-0000-0000-0000-0000000f4197'
\set pown '00000000-0000-0000-0000-0000000f4198'
\set padm '00000000-0000-0000-0000-0000000f4199'

-- Concurrency (NFR-A4) first, before this transaction writes a settings row that the committed setup changes ----------

create extension if not exists dblink schema extensions;
select extensions.dblink_connect('setup',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select extensions.dblink_exec('setup', format($$
  begin;
  update private.settings set value = 'true' where key = 'release_job_orders';
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%1$L, %1$L || '@employer.test', now(), '{"intended_account_kind": "company"}');
  update public.profiles set account_kind = intended_account_kind where id = %1$L;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (%2$L, 'employer', 'inv-lock-' || left(%2$L, 8), 'Invitation Lock GmbH', 'Invitation Lock', 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (%2$L, %1$L, 'owner', now());
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (%2$L, 'employer_starter', 'active', 'null');
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  select p.id, 'recruitment_company', 'inv-lock-p-' || p.n, 'Lock Partner ' || p.n || ' Ltd', 'Lock Partner ' || p.n, 'PH'
  from (values (1, %4$L::uuid), (2, %5$L::uuid), (3, %6$L::uuid), (4, %7$L::uuid), (5, %8$L::uuid)) p (n, id);
  -- The partners' owner has a suspended account, so no notification of the committed invitations is queued.
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (%9$L, %9$L || '@partner.test', now(), '{"intended_account_kind": "company"}');
  update public.profiles set account_kind = intended_account_kind, status = 'suspended' where id = %9$L;
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  select x, %9$L, 'owner', now() from unnest(array[%4$L, %5$L, %6$L, %7$L, %8$L]::uuid[]) x;
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id in (%4$L, %5$L, %6$L, %7$L, %8$L);
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on
  ) values (%3$L, %2$L, 'Lock welders', 10, 'DE', 'Hamburg', 'C', current_date + 30, 'full_time', 'international', 'both',
    'open', 'private', now(), current_date + 80);
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (%3$L, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (%3$L, 'DE');
  insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source)
  values (%3$L, %4$L, %2$L, 'directory'), (%3$L, %5$L, %2$L, 'directory');
  commit;
$$, :'cown', :'org_c', :'c_req', :'c_p1', :'c_p2', :'c_p3', :'c_p4', :'c_p5', :'pown'));

update private.settings set value = 'true' where key = 'entitlements_enforced';
select is(
  (select t from extensions.dblink('holder', format($$
    begin;
    select set_config('request.jwt.claims', json_build_object('sub', %L, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;
    select string_agg(already_invited::text, ',') from public.invite_partners(%L, %L, array[%L]::uuid[], 'directory');
  $$, :'cown', :'org_c', :'c_req', :'c_p3')) as r (t text)),
  'false',
  'a second session sends the third invitation of a Basic requirement (2 sent) and keeps its transaction open'
);
select is(pg_try_advisory_xact_lock(hashtextextended('partner_invitations:' || :'org_c', 0)), false,
  'NFR-A4: the invitation in progress holds the advisory lock of the employer''s invitations');

-- invite_partners as p_user (anonymous when null) at p_aal: 'ok' with the rows in order as JSON in t.result, or
-- 'sqlstate|message|detail'.
create function pg_temp.inv(
  p_user uuid, p_org uuid, p_req uuid, p_partners uuid[], p_source text default 'directory', p_aal text default 'aal2'
) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', coalesce((select jsonb_agg(to_jsonb(s) order by s.n)
       from (select x.*, row_number() over () as n from public.invite_partners(%L, %L, %L::uuid[], %L) x) s)::text, '[]'), true)$f$,
    p_org, p_req, p_partners, p_source), p_aal)
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

-- The waiting call queues first on the employer's row, which private.assert_org_manager takes for no key update for
-- every manager action; the advisory lock of invite_partners states the same rule explicitly for both counts.
select is(
  split_part(pg_temp.call_as(null, 'postgres', format(
    'select 1 from public.organizations where id = %L for no key update nowait', :'org_c')), '|', 1),
  '55P03', 'the invitation in progress holds the employer''s row through the role check (for no key update)');
set local lock_timeout = '300ms';
select is(split_part(pg_temp.inv(:'cown', :'org_c', :'c_req', array[:'c_p4']::uuid[]), '|', 1), '55P03',
  'NFR-A4: an invitation of the same employer at the same time waits for it');

-- A listed partner of p_type serving p_serves (sourcing from PH) and listing p_occupations, owned by p_owner (by padm, who
-- owns the partners nobody signs in to, when null), with an active subscription to p_plan (none when null).
create function pg_temp.partner(
  p_slug text, p_owner uuid default null, p_type text default 'recruitment_company', p_serves text[] default array['DE'],
  p_occupations text[] default array['7212'], p_plan text default 'recruitment_partner', p_industries text[] default '{}',
  p_recruitment text default null
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_owner is not null then
    perform pg_temp.new_user(p_owner);
    update public.profiles set account_kind = intended_account_kind where id = p_owner;
  end if;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (v_id, coalesce(p_owner, current_setting('t.padm')::uuid), 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  select v_id, 'serves_market'::public.geography_scope, c from unnest(p_serves) c
  union all select v_id, 'sources_from'::public.geography_scope, 'PH';
  insert into public.organization_occupations (organization_id, occupation_id) select v_id, o from unnest(p_occupations) o;
  insert into public.organization_industries (organization_id, industry_code) select v_id, i from unnest(p_industries) i;
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days', recruitment_type = p_recruitment::public.recruitment_preference
  where id = v_id;
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  end if;
  return v_id;
end;
$$;

-- A further member of p_org with p_role, accepted unless p_pending.
create function pg_temp.member(p_org uuid, p_user uuid, p_role text, p_pending boolean default false) returns void
language plpgsql as $$
begin
  perform pg_temp.new_user(p_user);
  update public.profiles set account_kind = intended_account_kind where id = p_user;
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (p_org, p_user, p_role::public.member_role, case when not p_pending then now() end);
end;
$$;

-- A requirement of p_org written as the lifecycle functions leave it (an insert passes no trigger of the status).
create function pg_temp.req(
  p_org uuid, p_title text, p_status text default 'open', p_visibility text default 'private', p_show boolean default false,
  p_recruitment text default 'both'
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_published boolean := p_status <> 'draft';
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, skills, start_date,
    duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, recruitment_preference,
    partner_need, status, visibility, show_identity, published_at, closes_on, close_reason
  ) values (
    v_id, p_org, p_title, 10, 'DE', 'Hamburg', 'C', 'MIG/MAG welding', date '2027-03-01', 12, 'full_time', 2500, 3000, 'EUR',
    'month', p_recruitment::public.recruitment_preference, 'both', p_status::public.requirement_status,
    case when v_published then p_visibility::public.requirement_visibility end, v_published and p_show,
    case when v_published then now() - interval '10 days' end, case when v_published then date '2027-04-01' end,
    case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

-- An invitation written as the database owner in p_status, with the times that status implies.
create function pg_temp.seed_inv(p_req uuid, p_partner uuid, p_status text default 'invited', p_at timestamptz default now())
returns uuid
language sql as $$
  insert into public.requirement_invitations (
    requirement_id, organization_id, employer_organization_id, status, source, invited_at, viewed_at, answered_at,
    responded_at, withdrawn_at, expired_at, decline_reason
  )
  select p_req, p_partner, r.organization_id, p_status::public.invitation_status, 'directory', p_at,
    case when p_status <> 'invited' then p_at end,
    case when p_status in ('accepted', 'declined', 'responded') then p_at end,
    case when p_status = 'responded' then p_at end,
    case when p_status = 'withdrawn' then p_at end,
    case when p_status = 'expired' then p_at end,
    case when p_status = 'declined' then 'Fully booked' end
  from public.workforce_requirements r where r.id = p_req
  returning id
$$;

create function pg_temp.count(p_req uuid) returns integer
language sql as $$ select count(*)::integer from public.requirement_invitations where requirement_id = p_req $$;

create function pg_temp.inv_status(p_id uuid) returns text
language sql as $$ select status::text from public.requirement_invitations where id = p_id $$;

create function pg_temp.inv_of(p_req uuid, p_partner uuid) returns uuid
language sql as $$ select id from public.requirement_invitations where requirement_id = p_req and organization_id = p_partner $$;

-- The users with a row of p_kind about p_inv, sorted, as user:status.
create function pg_temp.told(p_kind text, p_inv uuid) returns text
language sql as $$
  select coalesce(string_agg(n.user_id::text || ':' || n.status, ',' order by n.user_id), '')
  from public.notifications n where n.kind = p_kind and n.payload ->> 'invitation_id' = p_inv::text
$$;

create function pg_temp.audits(p_action text, p_inv uuid) returns integer
language sql as $$ select count(*)::integer from audit.log where action = p_action and entity_id = p_inv::text $$;

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

update public.organizations set display_name = 'Acme Bau', public_page_enabled = true where id = current_setting('t.a')::uuid;
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (current_setting('t.a')::uuid, 'employer_starter', 'active', 'null');
select pg_temp.new_user(:'padm');
update public.profiles set account_kind = intended_account_kind where id = :'padm';
select set_config('t.padm', :'padm', false) as setup_padm \gset
select pg_temp.partner('other-v41', null) as p_other \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Acme lock-free welders') as r_free \gset
select is(pg_temp.inv(:'own1', current_setting('t.a')::uuid, :'r_free', array[:'p_other']::uuid[]), 'ok',
  'NFR-A4: an invitation of another employer does not wait');
select extensions.dblink_exec('holder', 'commit');
reset lock_timeout;
select is(pg_temp.inv(:'cown', :'org_c', :'c_req', array[:'c_p4']::uuid[]), 'P0001|CHARA_LIMIT_REACHED|partner_invitations_per_requirement',
  'NFR-A4, AC2: once the other invitation is committed, this one counts it and is refused at the limit');
select is((select count(*)::integer from public.requirement_invitations where requirement_id = :'c_req'), 3,
  'NFR-A4: the requirement ends at its limit of 3 invitations, never above');
select extensions.dblink_disconnect('holder');
select extensions.dblink_exec('setup', format($$
  begin;
  delete from public.workforce_requirements where organization_id = %2$L;
  delete from private.rate_limit_hits where (action, bucket) in (
    ('user:audited_write', (hashtextextended(%1$L, 0) & 2147483647)::integer),
    ('org:audited_write', (hashtextextended(%2$L, 0) & 2147483647)::integer));
  delete from billing.subscriptions where organization_id = %2$L;
  delete from public.organizations where id in (%2$L, %3$L, %4$L, %5$L, %6$L, %7$L);
  delete from auth.users where id in (%1$L, %8$L);
  update private.settings set value = 'false' where key = 'release_job_orders';
  commit;
$$, :'cown', :'org_c', :'c_p1', :'c_p2', :'c_p3', :'c_p4', :'c_p5', :'pown'));
select extensions.dblink_disconnect('setup');
select is(
  (select count(*)::integer from public.organizations where id in (:'org_c', :'c_p1', :'c_p2', :'c_p3', :'c_p4', :'c_p5'))
    + (select count(*)::integer from auth.users where id in (:'cown', :'pown'))
    + (select count(*)::integer from public.requirement_invitations where employer_organization_id = :'org_c'),
  0,
  'the committed organisations of the concurrency test are removed again');

-- The fixture -------------------------------------------------------------------------------------------------------------

update private.settings set value = 'true' where key = 'release_job_orders';
update private.settings set value = 'false' where key = 'entitlements_enforced';
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
select pg_temp.new_user(:'sadm');
update public.profiles set account_kind = intended_account_kind where id = :'sadm';
insert into public.platform_staff (user_id, role) values (:'sadm', 'admin');
insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'beta', 'employer_professional', 'active', 'null');

select pg_temp.new_user(:'ug');
select pg_temp.new_user(:'ud');
update public.profiles set account_kind = intended_account_kind where id in (:'ug', :'ud');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
values ('00000000-0000-0000-0000-0000000f41a1', 'employer', 'gamma-v41', 'Gamma V41 GmbH', 'Gamma V41', 'DE'),
       ('00000000-0000-0000-0000-0000000f41a2', 'employer', 'delta-v41', 'Delta V41 GmbH', 'Delta V41', 'DE');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  ('00000000-0000-0000-0000-0000000f41a1', :'ug', 'owner', now()),
  ('00000000-0000-0000-0000-0000000f41a2', :'ud', 'owner', now());
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  ('00000000-0000-0000-0000-0000000f41a1', 'employer_enterprise', 'active', 'null'),
  ('00000000-0000-0000-0000-0000000f41a2', 'employer_starter', 'canceled', 'null');
\set gamma '00000000-0000-0000-0000-0000000f41a1'
\set delta '00000000-0000-0000-0000-0000000f41a2'

select pg_temp.partner('p1-v41', :'u1') as p1 \gset
select pg_temp.member(:'p1', :'u1a', 'admin');
select pg_temp.member(:'p1', :'u1m', 'member');
select pg_temp.member(:'p1', :'u1p', 'admin', true);
select pg_temp.member(:'p1', :'u1s', 'admin');
update public.profiles set status = 'suspended' where id = :'u1s';
select pg_temp.partner('s1-v41', :'us1', 'staffing_company', p_plan => 'staffing_partner') as s1 \gset
select pg_temp.partner('p2-v41', :'u2') as p2 \gset
select pg_temp.partner('p5-v41') as p5 \gset
update public.organizations set listed_at = null, review_status = 'pending_review' where id = :'p5';
select pg_temp.partner('p6-v41', :'u6') as p6 \gset
update public.organizations set status = 'suspended' where id = :'p6';
select pg_temp.partner('p7-v41') as p7 \gset
update public.organizations set moderation_state = 'hidden' where id = :'p7';
select pg_temp.partner('p9-v41') as p9 \gset
update public.organizations set review_status = 'declined' where id = :'p9';
select pg_temp.partner('free-v41', null, p_plan => null) as pfree \gset
create temp table bulk (n integer primary key, id uuid not null);
insert into bulk select n, pg_temp.partner('bulk-v41-' || n) from generate_series(1, 30) n;
grant select on bulk to authenticated;

select pg_temp.req(:'acme', 'Acme private welders') as r \gset
select pg_temp.req(:'acme', 'Acme Bau anonymous welders', 'open', 'job_order_marketplace') as rm \gset
select pg_temp.req(:'acme', 'Acme Bau named welders', 'open', 'job_order_marketplace', true) as rs \gset

-- Schema ----------------------------------------------------------------------------------------------------------------

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.requirement_invitations'::regclass),
  'NFR-S8: requirement_invitations has row level security enabled and forced');
select is(
  (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'requirement_invitations' and grantee in ('anon', 'authenticated', 'service_role')),
  null, 'no API role holds a table privilege: authenticated reads named columns only and nobody writes');
select is(
  (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'requirement_invitations' and grantee = 'authenticated'
     and privilege_type = 'SELECT'),
  'answered_at,decline_reason,employer_organization_id,expired_at,id,invited_at,organization_id,requirement_id,responded_at,source,status,viewed_at,withdrawn_at',
  'authenticated reads every column but who invited and the suggestion criteria');
select ok(
  not exists (select 1 from information_schema.column_privileges where table_schema = 'public'
    and table_name = 'requirement_invitations' and grantee = 'anon'),
  'anon reads no column');
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'requirement_invitations'
    and indexdef like 'CREATE UNIQUE INDEX requirement_invitations_partner_key ON public.requirement_invitations USING btree (requirement_id, organization_id)'),
  'AC4: a unique index on (requirement_id, organization_id) exists');
select ok(
  exists (select 1 from pg_indexes where tablename = 'requirement_invitations' and indexdef like '%(organization_id, invited_at DESC, id)%')
    and exists (select 1 from pg_indexes where tablename = 'requirement_invitations' and indexdef like '%(employer_organization_id, invited_at)%'),
  'both policy columns are indexed (the partner and the employer)');
select is(
  (select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = 'public.invitation_status'::regtype),
  'invited,viewed,accepted,declined,responded,withdrawn,expired', 'the statuses of DATA_MODEL.md section 5');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('invite_partners', 'withdraw_invitation', 'answer_invitation', 'get_invitation',
     'list_my_invitations', 'list_requirement_invitations', 'requirement_invitation_usage')),
  'answer_invitation:true:search_path="" get_invitation:true:search_path="" invite_partners:true:search_path="" list_my_invitations:true:search_path="" list_requirement_invitations:true:search_path="" requirement_invitation_usage:true:search_path="" withdraw_invitation:true:search_path=""',
  'the seven functions are security definer with an empty search_path');
select ok(
  (select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
     and not has_function_privilege('service_role', f, 'execute'))
   from unnest(array['public.invite_partners(uuid, uuid, uuid[], text)', 'public.withdraw_invitation(uuid, uuid)',
     'public.answer_invitation(uuid, uuid, text, text)', 'public.get_invitation(uuid, uuid)',
     'public.list_my_invitations(uuid, public.invitation_status, uuid, integer)', 'public.list_requirement_invitations(uuid, uuid)',
     'public.requirement_invitation_usage(uuid, uuid)']) f),
  'AC5: authenticated may call them; anon and service_role may not');
select ok(
  (select bool_and(not has_function_privilege(r, f, 'execute'))
   from unnest(array['private.queue_invitation_event(uuid, text)', 'private.invitable_partner(uuid)',
     'private.suggestion_criteria(uuid, uuid)', 'private.assert_invitation_partner(uuid)', 'private.assert_invitation_employer(uuid)',
     'private.requirements_expire_invitations()', 'private.requirement_invitations_guard()',
     'private.requirement_invitations_immutable()']) f,
   unnest(array['anon', 'authenticated', 'service_role']) r),
  'no API role runs the private helpers or the trigger functions');
select is(
  (select string_agg(tgname || ':' || tgenabled::text, ',' order by tgname) from pg_trigger
   where tgname in ('requirement_invitations_guard', 'requirement_invitations_immutable', 'workforce_requirements_expire_invitations')),
  'requirement_invitations_guard:A,requirement_invitations_immutable:A,workforce_requirements_expire_invitations:A',
  'the guard, the immutable columns and the expiry fire always');
select is((select value #>> '{}' from private.settings where key = 'partner_invitations_per_day_max'), '50',
  'AC4: at most 50 invitations per employer in 24 hours by default');
select ok(exists (select 1 from private.setting_rules where key = 'partner_invitations_per_day_max' and editable and min = 1 and max = 1000),
  'NFR-O5: the daily cap is a setting of the settings editor');
select is(
  (select string_agg(format('%s|%s|%s|%s|%s', kind, mandatory, default_email, audience, organization_types), ' ' order by kind)
   from private.notification_kinds where kind like 'invitation\_%'),
  'invitation_received|f|t|company|{recruitment_company,staffing_company} invitation_withdrawn|f|t|company|{recruitment_company,staffing_company}',
  'FR-T1: both kinds are optional, email on by default, for recruitment and staffing companies');
select is(
  (select string_agg(plan_code || '=' || coalesce(limit_value::text, 'null'), ',' order by limit_value)
   from billing.plan_limits where limit_key = 'partner_invitations_per_requirement'),
  'free_employer=0,employer_starter=3,employer_professional=10,employer_enterprise=25',
  'AC2, decision 2.2: 3 / 10 / 25 invitations per requirement, free 0, as data');

-- AC1: invite two partners to an open private requirement -------------------------------------------------------------

update private.settings set value = 'true' where key = 'entitlements_enforced';
insert into public.notification_preferences (user_id, email_kinds) values (:'us1', '{"invitation_received": false}');
select is(pg_temp.inv(:'own1', :'acme', :'r', array[:'p1', :'s1']::uuid[]), 'ok',
  'AC1: the Acme owner at aal2 invites P1 (recruitment) and S1 (staffing) to the open private requirement R (Basic, enforced)');
select is(
  (select string_agg(format('%s|%s|%s|%s', i.organization_id = any (array[:'p1', :'s1']::uuid[]), i.status, i.invited_by = :'own1',
     i.invited_at is not null), ',')
   from public.requirement_invitations i where i.requirement_id = :'r'),
  't|invited|t|t,t|invited|t|t', 'AC1: two rows, status invited, invited_by the owner and invited_at set');
select is(
  (select string_agg(format('%s|%s', e ->> 'organization_id', e ->> 'already_invited'), ',' order by (e ->> 'n')::integer)
   from jsonb_array_elements(pg_temp.result()) e),
  format('%s|false,%s|false', :'p1', :'s1'), 'AC1: the function answers both partners in the order given, newly invited');
select ok(
  (select bool_and(i.id = (e ->> 'invitation_id')::uuid) from jsonb_array_elements(pg_temp.result()) e
   join public.requirement_invitations i on i.requirement_id = :'r' and i.organization_id = (e ->> 'organization_id')::uuid),
  'AC1: it returns the two invitation ids');
select is(
  (select string_agg(format('%s|%s|%s', l.action, l.metadata ->> 'requirement_id' = :'r', l.metadata ->> 'source'), ',')
   from audit.log l join public.requirement_invitations i on l.entity_id = i.id::text
   where i.requirement_id = :'r' and l.entity_type = 'requirement_invitation'),
  'requirement.invitation_sent|t|directory,requirement.invitation_sent|t|directory',
  'AC1: one audit row requirement.invitation_sent per invitation, entity the invitation, with the requirement');
select ok(
  (select bool_and(l.metadata ->> 'organization_id' = i.organization_id::text and l.actor_id = :'own1')
   from audit.log l join public.requirement_invitations i on l.entity_id = i.id::text where i.requirement_id = :'r'),
  'AC1: the audit row names the partner and the actor');
select is(
  (select string_agg(cause, ',') from private.requirement_reveals where requirement_id = :'r'), 'invitation,invitation',
  'NFR-S11, decision 3.2: each invitation reveals the employer name to that partner (private.record_requirement_reveal)');

-- AC7, FR-T1: the notification to the partner's owners and admins ----------------------------------------------------------

select pg_temp.inv_of(:'r', :'p1') as i_p1 \gset
select pg_temp.inv_of(:'r', :'s1') as i_s1 \gset
select is(pg_temp.told('invitation_received', :'i_p1'),
  (select string_agg(u || ':queued', ',' order by u) from unnest(array[:'u1', :'u1a']) u),
  'AC7: exactly the owner and the accepted admin of P1 get one queued invitation_received each');
select is(
  (select count(*)::integer from public.notifications where kind = 'invitation_received' and user_id in (:'u1m', :'u1p', :'u1s')),
  0, 'AC7: none for the member, the pending admin or an admin whose account is suspended');
select is(
  (select count(*)::integer from pgmq.q_notifications where message ->> 'kind' = 'invitation_received'
     and message ->> 'requirement_invitation_id' in (:'i_p1', :'i_s1')), 2,
  'NFR-A3: the emailed messages are queued in the inviting transaction (S1''s owner turned the email off)');
select is(pg_temp.told('invitation_received', :'i_s1'), :'us1' || ':suppressed',
  'FR-T1 AC4: S1''s owner, who turned the email off, keeps the in-app item without the email');
select is(
  (select email_status from public.notifications where user_id = :'us1' and kind = 'invitation_received'),
  'suppressed_by_preference', 'the item records why it was not emailed');
select ok(
  (select bool_and(read_at is null) from public.notifications where kind = 'invitation_received' and payload ->> 'invitation_id' = :'i_p1'),
  'AC7: the items are unread in the in-app list of both users');
select is(
  (select string_agg(k, ',' order by k) from public.notifications n, jsonb_object_keys(n.payload) k
   where n.user_id = :'u1' and n.kind = 'invitation_received' and n.payload ->> 'invitation_id' = :'i_p1'),
  'country_code,country_name,employer_name,invitation_id,org_slug,start_date,title,workers_needed',
  'AC7, AC11, FR-T1 AC2: the invitation id, the title, the destination, workers, start date, the employer and the recipient''s own slug only');
select is(
  (select format('%s|%s|%s|%s', payload ->> 'title', payload ->> 'employer_name', payload ->> 'org_slug', payload ->> 'workers_needed')
   from public.notifications where user_id = :'u1' and kind = 'invitation_received' and payload ->> 'invitation_id' = :'i_p1'),
  'Acme private welders|Acme Bau|p1-v41|10',
  'AC7, AC11, decision 3.2: the invitation reveals the employer, so the item names the requirement''s own title and the employer');
select ok(
  not exists (select 1 from public.notifications n where n.kind = 'invitation_received'
    and (n.payload::text like '%' || :'acme' || '%' or n.payload::text like '%' || :'own1' || '%'
      or n.payload::text like '%@%' or n.payload::text like '%acme-bau%')),
  'AC11: no item carries the employer''s id or slug, the inviting member or an email address');
select is(pg_temp.inv(:'own1', :'acme', :'rm', array[:'p1']::uuid[]), 'ok', 'Acme invites P1 to its anonymous job order');
select is(
  (select format('%s|%s', payload ->> 'title', payload ->> 'employer_name') from public.notifications
   where user_id = :'u1' and payload ->> 'invitation_id' = pg_temp.inv_of(:'rm', :'p1')::text),
  'Acme Bau anonymous welders|Acme Bau', 'AC11, NFR-S11: an anonymous job order is revealed to the invited partner, in the item too');
select ok(
  not exists (select 1 from public.notifications n where n.kind = 'invitation_received' and n.payload::text ilike '%acme%'
    and n.user_id not in (select m.user_id from public.organization_members m join public.requirement_invitations i
      on i.organization_id = m.organization_id where i.id = (n.payload ->> 'invitation_id')::uuid)),
  'NFR-S11: the name reaches only members of the invited partner');
select is(pg_temp.inv(:'own1', :'acme', :'rs', array[:'p1']::uuid[]), 'ok', 'Acme invites P1 to the job order that shows its name');
select is(
  (select format('%s|%s', payload ->> 'title', payload ->> 'employer_name') from public.notifications
   where user_id = :'u1' and payload ->> 'invitation_id' = pg_temp.inv_of(:'rs', :'p1')::text),
  'Acme Bau named welders|Acme Bau', 'AC7: the same for a job order that shows the name');

-- AC4: a repeated invitation -------------------------------------------------------------------------------------------------

select set_config('t.notes', (select count(*) from public.notifications)::text, false) as setup_notes \gset
select is(pg_temp.inv(:'own1', :'acme', :'r', array[:'p1']::uuid[]), 'ok', 'AC4: inviting P1 again to R is no error');
select is(
  (select format('%s|%s|%s', e ->> 'invitation_id' = :'i_p1', e ->> 'already_invited', e ->> 'status')
   from jsonb_array_elements(pg_temp.result()) e),
  't|true|invited', 'AC4: it returns the existing invitation with already_invited true');
select is(pg_temp.count(:'r'), 2, 'AC4: no second row');
select is((select count(*) from public.notifications)::text, current_setting('t.notes'), 'AC4: nothing is sent again');
select is(pg_temp.audits('requirement.invitation_sent', :'i_p1'), 1, 'AC4: and nothing audited again');
select is(pg_temp.inv(:'adm', :'acme', :'r', array[:'p1', :'p2']::uuid[]), 'ok', 'a call with P1 again and the new P2');
select is(
  (select string_agg(e ->> 'already_invited', ',' order by (e ->> 'n')::integer) from jsonb_array_elements(pg_temp.result()) e),
  'true,false', 'only P2 is new');

-- AC3: listed, active, visible partners only ----------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme second welders') as r2 \gset
select is(pg_temp.inv(:'own1', :'acme', :'r2', array[:'p1', :'p5']::uuid[]), 'P0001|CHARA_INVALID_INPUT|partner_unavailable',
  'AC3: P1 with P5 (review pending) is refused as a whole');
select is(pg_temp.count(:'r2'), 0, 'AC3: no row, not even P1''s');
select is(
  (select string_agg(pg_temp.inv(:'own1', :'acme', :'r2', array[x]::uuid[]), ' / ')
   from unnest(array[:'p6', :'p9', :'p7', :'beta', :'gamma', gen_random_uuid()::text]::uuid[]) x),
  'P0001|CHARA_INVALID_INPUT|partner_unavailable / P0001|CHARA_INVALID_INPUT|partner_unavailable / P0001|CHARA_INVALID_INPUT|partner_unavailable / P0001|CHARA_INVALID_INPUT|partner_unavailable / P0001|CHARA_INVALID_INPUT|partner_unavailable / P0001|CHARA_INVALID_INPUT|partner_unavailable',
  'AC3: listed but suspended, declined, hidden by moderation, an employer and an unknown id: the same refusal, not saying why');
select is(pg_temp.count(:'r2'), 0, 'AC3: none of them writes a row');
select is(pg_temp.inv(:'own1', :'acme', :'r2', array[:'pfree']::uuid[]), 'ok',
  'AC open point: a listed partner on the free fallback plan can be invited (responding needs a paid plan, V44)');

-- AC5: who invites --------------------------------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme third welders') as r3 \gset
select is(pg_temp.inv(:'own1', :'acme', :'r3', array[:'p1']::uuid[], 'directory', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'AC5: the owner at aal1 is refused (aal2_required)');
select is(pg_temp.inv(:'adm', :'acme', :'r3', array[:'p1']::uuid[]), 'ok', 'AC5: an administrator at aal2 invites');
select is(pg_temp.inv(:'mem', :'acme', :'r3', array[:'p2']::uuid[]), 'P0001|CHARA_FORBIDDEN|', 'AC5: a member is refused');
select is(pg_temp.inv(:'own2', :'acme', :'r3', array[:'p2']::uuid[]), 'P0001|CHARA_FORBIDDEN|',
  'AC5: the Beta owner naming Acme is refused');
select is(pg_temp.inv(:'own2', :'beta', :'r3', array[:'p2']::uuid[]), 'P0002|CHARA_NOT_FOUND|',
  'AC5: the Beta owner naming Beta gets CHARA_NOT_FOUND, so Acme''s requirement is not confirmed');
select is(pg_temp.inv(:'u1', :'p1', :'r3', array[:'p2']::uuid[]), 'P0001|CHARA_FORBIDDEN|employer_only',
  'AC5: the owner of the partner P1 inviting for P1 is refused (a partner invites nobody)');
select is(pg_temp.inv(:'u1m', :'acme', :'r3', array[:'p2']::uuid[]), 'P0001|CHARA_FORBIDDEN|', 'AC5: a member of P1 naming Acme is refused');
select is(pg_temp.inv(:'wkr', :'acme', :'r3', array[:'p2']::uuid[]), 'P0001|CHARA_FORBIDDEN|', 'AC5: a candidate is refused');
select is(pg_temp.inv(:'sadm', :'acme', :'r3', array[:'p2']::uuid[]), 'P0001|CHARA_FORBIDDEN|',
  'AC5: a Platform Administrator is refused (no invite function for staff)');
select is(split_part(pg_temp.inv(null, :'acme', :'r3', array[:'p2']::uuid[]), '|', 1), '42501',
  'AC5: an anonymous caller has no EXECUTE');
select is(
  split_part(pg_temp.call_as(:'adm', 'authenticated', format(
    'insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source) values (%L, %L, %L, %L)',
    :'r3', :'p2', :'acme', 'directory')), '|', 1),
  '42501', 'AC5: a direct insert by an Acme administrator is refused');
select is(
  split_part(pg_temp.call_as(:'u1', 'authenticated', format(
    'update public.requirement_invitations set status = ''accepted'' where id = %L', pg_temp.inv_of(:'r3', :'p1'))), '|', 1),
  '42501', 'NFR-S8: a direct update by the invited partner is refused');
select is(pg_temp.count(:'r3'), 1, 'AC5: only the administrator''s invitation exists');

-- AC6: requirement states -------------------------------------------------------------------------------------------------------

select is(
  (select string_agg(s || '=' || pg_temp.inv(:'own1', :'acme', pg_temp.req(:'acme', 'Acme ' || s || ' welders', s), array[:'p2']::uuid[]), ' ')
   from unnest(array['draft', 'paused', 'closed', 'filled']) s),
  'draft=P0001|CHARA_INVALID_STATE|requirement_not_open paused=P0001|CHARA_INVALID_STATE|requirement_not_open closed=P0001|CHARA_INVALID_STATE|requirement_not_open filled=P0001|CHARA_INVALID_STATE|requirement_not_open',
  'AC6: draft, paused, closed and filled requirements take no invitation');
select is(
  (select count(*)::integer from public.requirement_invitations i join public.workforce_requirements w on w.id = i.requirement_id
   where w.title in ('Acme draft welders', 'Acme paused welders', 'Acme closed welders', 'Acme filled welders')),
  0, 'AC6: and nothing is written');

-- Input and release ----------------------------------------------------------------------------------------------------------

select is(pg_temp.inv(:'own1', :'acme', :'r3', '{}'::uuid[]), 'P0001|CHARA_INVALID_INPUT|p_partners', 'no partner');
select is(pg_temp.inv(:'own1', :'acme', :'r3', null), 'P0001|CHARA_INVALID_INPUT|p_partners', 'a null list');
select is(pg_temp.inv(:'own1', :'acme', :'r3', array[:'p2', :'p2']::uuid[]), 'P0001|CHARA_INVALID_INPUT|p_partners', 'a repeated partner');
select is(pg_temp.inv(:'own1', :'acme', :'r3', array[:'p2', null]::uuid[]), 'P0001|CHARA_INVALID_INPUT|p_partners', 'a null partner');
select is(pg_temp.inv(:'own1', :'acme', :'r3', (select array_agg(id) from bulk where n <= 26)), 'P0001|CHARA_INVALID_INPUT|p_partners',
  'more than 25 partners in one call');
select is(pg_temp.inv(:'own1', :'acme', :'r3', array[:'p2']::uuid[], 'email'), 'P0001|CHARA_INVALID_INPUT|p_source', 'an unknown source');
select is(pg_temp.inv(:'own1', :'acme', gen_random_uuid(), array[:'p2']::uuid[]), 'P0002|CHARA_NOT_FOUND|', 'an unknown requirement');
update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.inv(:'own1', :'acme', :'r3', array[:'p2']::uuid[]), 'P0001|CHARA_FORBIDDEN|release_off',
  'release_job_orders off: nobody invites');
update private.settings set value = 'true' where key = 'release_job_orders';

-- AC2: the per-requirement limit of the plan ---------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme Basic limit') as ls \gset
select pg_temp.seed_inv(:'ls', id) from bulk where n in (1, 2);
select pg_temp.req(:'beta', 'Beta Professional limit') as lp \gset
select pg_temp.seed_inv(:'lp', id) from bulk where n between 1 and 9;
select pg_temp.req(:'gamma', 'Gamma Enterprise limit') as le \gset
select pg_temp.seed_inv(:'le', id) from bulk where n between 1 and 24;
select is(pg_temp.inv(:'own1', :'acme', :'ls', array[(select id from bulk where n = 3)]), 'ok',
  'AC2: Basic with 2 sent: the third invitation succeeds');
select is(pg_temp.inv(:'own1', :'acme', :'ls', array[(select id from bulk where n = 4)]),
  'P0001|CHARA_LIMIT_REACHED|partner_invitations_per_requirement', 'AC2: the fourth is refused');
select is(pg_temp.inv(:'own2', :'beta', :'lp', array[(select id from bulk where n = 10)]), 'ok',
  'AC2: Professional with 9 sent: the tenth succeeds');
select is(pg_temp.inv(:'own2', :'beta', :'lp', array[(select id from bulk where n = 11)]),
  'P0001|CHARA_LIMIT_REACHED|partner_invitations_per_requirement', 'AC2: the eleventh is refused');
select is(pg_temp.inv(:'ug', :'gamma', :'le', array[(select id from bulk where n = 25)]), 'ok',
  'AC2: Enterprise with 24 sent: the 25th succeeds');
select is(pg_temp.inv(:'ug', :'gamma', :'le', array[(select id from bulk where n = 26)]),
  'P0001|CHARA_LIMIT_REACHED|partner_invitations_per_requirement', 'AC2: the 26th is refused');
select is(format('%s,%s,%s', pg_temp.count(:'ls'), pg_temp.count(:'lp'), pg_temp.count(:'le')), '3,10,25',
  'AC2: the refused invitations write no row');
select pg_temp.req(:'acme', 'Acme Basic with a withdrawn invitation') as lw \gset
select pg_temp.seed_inv(:'lw', id, case when n = 3 then 'withdrawn' else 'invited' end) from bulk where n in (1, 2, 3);
select is(pg_temp.inv(:'own1', :'acme', :'lw', (select array_agg(id order by n) from bulk where n in (4, 5))),
  'P0001|CHARA_LIMIT_REACHED|partner_invitations_per_requirement', 'AC2: 2 sent and 1 withdrawn: a call of 2 fails as a whole');
select is(pg_temp.count(:'lw'), 3, 'AC2: and writes nothing');
select is(pg_temp.inv(:'own1', :'acme', :'lw', array[(select id from bulk where n = 4)]), 'ok',
  'AC2: the withdrawn invitation does not count, so 1 more fits');
select pg_temp.req(:'acme', 'Acme Basic with declined invitations') as ld \gset
select pg_temp.seed_inv(:'ld', id, 'declined') from bulk where n in (1, 2, 3);
select is(pg_temp.inv(:'own1', :'acme', :'ld', array[(select id from bulk where n = 4)]),
  'P0001|CHARA_LIMIT_REACHED|partner_invitations_per_requirement', 'AC open point: declined invitations count');
select is(
  pg_temp.read_as(:'mem', format('select row(used, limit_value, applies, plan_name)::text from public.requirement_invitation_usage(%L, %L)', :'acme', :'ls')),
  '(3,3,t,Basic)', 'AC9, AC12: a member reads "3 of 3 invitations used" with the plan name for the upgrade prompt');
select is(
  pg_temp.read_as(:'own2', format('select row(used, limit_value, applies)::text from public.requirement_invitation_usage(%L, %L)', :'beta', :'lp')),
  '(10,10,t)', 'AC9: Professional, 10 of 10');
select is(
  pg_temp.read_as(:'own1', format('select row(used, limit_value)::text from public.requirement_invitation_usage(%L, %L)', :'acme', :'lw')),
  '(3,3)', 'AC9: the withdrawn invitation is not counted');
select is(
  pg_temp.read_as(:'own2', format('select used from public.requirement_invitation_usage(%L, %L)', :'beta', :'ls')),
  'P0002|CHARA_NOT_FOUND|', 'another employer''s requirement is not found');
select is(
  pg_temp.read_as(:'u1', format('select used from public.requirement_invitation_usage(%L, %L)', :'acme', :'ls')),
  '42501|CHARA_FORBIDDEN|', 'a partner reads no usage of Acme');

update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(pg_temp.inv(:'own1', :'acme', :'ls', array[(select id from bulk where n = 4)]), 'ok',
  'AC2: entitlements_enforced off: the fourth invitation of the Basic requirement is not refused');
select is(pg_temp.inv(:'own2', :'beta', :'lp', array[(select id from bulk where n = 11)]), 'ok',
  'AC2: nor the eleventh of the Professional one');
select is(
  pg_temp.read_as(:'own1', format('select applies::text from public.requirement_invitation_usage(%L, %L)', :'acme', :'ls')),
  'false', 'the usage says the limit does not apply');
select pg_temp.req(:'delta', 'Delta lapsed welders') as lx \gset
select is(pg_temp.inv(:'ud', :'delta', :'lx', array[:'p1']::uuid[]), 'P0001|CHARA_LIMIT_REACHED|partner_invitations_per_requirement',
  'entitlements_enforced off: an employer that lapsed to the free plan (0 invitations) is still refused');

-- AC4: the daily cap per employer ------------------------------------------------------------------------------------------

-- Acme's earlier invitations are moved out of the last 24 hours, so the cap set for Beta below leaves Acme room (the
-- time of an invitation is immutable, so the test owner lifts that trigger for its own back-dating).
alter table public.requirement_invitations disable trigger requirement_invitations_immutable;
update public.requirement_invitations set invited_at = invited_at - interval '2 days' where employer_organization_id = :'acme';
alter table public.requirement_invitations enable always trigger requirement_invitations_immutable;
select pg_temp.req(:'beta', 'Beta cap one') as c1 \gset
select pg_temp.req(:'beta', 'Beta cap two') as c2 \gset
select set_config('t.beta_day', (select count(*) from public.requirement_invitations
  where employer_organization_id = :'beta' and invited_at > now() - interval '24 hours')::text, false) as setup_day \gset
update private.settings set value = to_jsonb(current_setting('t.beta_day')::integer + 3) where key = 'partner_invitations_per_day_max';
select is(pg_temp.inv(:'own2', :'beta', :'c1', (select array_agg(id order by n) from bulk where n in (1, 2))), 'ok',
  'AC4: Beta sends invitations across several requirements up to its cap (lowered for the test) ...');
select is(pg_temp.inv(:'adm2', :'beta', :'c2', array[(select id from bulk where n = 1)]), 'ok', '... from either of its managers');
select is(pg_temp.inv(:'own2', :'beta', :'c2', array[(select id from bulk where n = 2)]),
  'P0001|CHARA_RATE_LIMITED|partner_invitations_per_day', 'AC4: one more within 24 hours is refused');
select is(pg_temp.count(:'c2'), 1, 'AC4: and writes nothing');
select is(pg_temp.inv(:'own2', :'beta', :'c2', array[(select id from bulk where n = 1)]), 'ok',
  'AC4: a repeated invitation is no new invitation and passes the cap');
select is(pg_temp.inv(:'own1', :'acme', :'c2', array[(select id from bulk where n = 2)]), 'P0002|CHARA_NOT_FOUND|',
  'the cap of Beta is not Acme''s business: Acme reaches no requirement of Beta');
select is(pg_temp.inv(:'own1', :'acme', :'r3', array[(select id from bulk where n = 2)]), 'ok',
  'AC4: the cap counts per employer: Acme still invites');
alter table public.requirement_invitations disable trigger requirement_invitations_immutable;
update public.requirement_invitations set invited_at = now() - interval '25 hours'
where employer_organization_id = :'beta' and requirement_id in (:'c1');
alter table public.requirement_invitations enable always trigger requirement_invitations_immutable;
select is(pg_temp.inv(:'own2', :'beta', :'c2', array[(select id from bulk where n = 2)]), 'ok',
  'AC4: invitations older than 24 hours no longer count');
update private.settings set value = '50' where key = 'partner_invitations_per_day_max';

-- AC10: withdrawing before a response ----------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme withdrawals') as rw \gset
select pg_temp.seed_inv(:'rw', :'p1', 'invited') as w_inv \gset
select pg_temp.seed_inv(:'rw', :'s1', 'viewed') as w_view \gset
select pg_temp.seed_inv(:'rw', :'p2', 'accepted') as w_acc \gset
select pg_temp.seed_inv(:'rw', (select id from bulk where n = 1), 'responded') as w_resp \gset
select pg_temp.seed_inv(:'rw', (select id from bulk where n = 2), 'declined') as w_decl \gset

create function pg_temp.wd(p_user uuid, p_org uuid, p_inv uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.withdraw_invitation(%L, %L)', p_org, p_inv), p_aal)
$$;

select is(pg_temp.wd(:'mem', :'acme', :'w_inv'), 'P0001|CHARA_FORBIDDEN|', 'AC10: an Acme member cannot withdraw');
select is(pg_temp.wd(:'own1', :'acme', :'w_inv', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'the owner at aal1 cannot');
select is(pg_temp.wd(:'own2', :'beta', :'w_inv'), 'P0002|CHARA_NOT_FOUND|', 'Beta''s owner does not reach Acme''s invitation');
select is(pg_temp.wd(:'u1', :'p1', :'w_inv'), 'P0001|CHARA_FORBIDDEN|employer_only', 'the invited partner cannot withdraw it');
select is(
  (select string_agg(pg_temp.wd(:'own1', :'acme', x), ',' order by n)
   from unnest(array[:'w_inv', :'w_view', :'w_acc']::uuid[]) with ordinality u (x, n)),
  'ok,ok,ok', 'AC10: the owner withdraws the invited, viewed and accepted invitations');
select is(
  (select string_agg(status::text || ':' || (withdrawn_at is not null), ',' order by id) from public.requirement_invitations
   where id in (:'w_inv', :'w_view', :'w_acc')),
  'withdrawn:true,withdrawn:true,withdrawn:true', 'AC10: all three become withdrawn with the time');
select is(
  (select string_agg(x::text, ',') from unnest(array[pg_temp.audits('requirement.invitation_withdrawn', :'w_inv'),
     pg_temp.audits('requirement.invitation_withdrawn', :'w_view'), pg_temp.audits('requirement.invitation_withdrawn', :'w_acc')]) x),
  '1,1,1', 'AC10: one audit row each');
select is(pg_temp.told('invitation_withdrawn', :'w_inv'),
  (select string_agg(u || ':queued', ',' order by u) from unnest(array[:'u1', :'u1a']) u),
  'AC10: one queued invitation_withdrawn per owner and admin of P1 (none for its member)');
select is(pg_temp.told('invitation_withdrawn', :'w_view'), :'us1' || ':queued', 'AC10: S1''s owner is told too');
select is(
  (select string_agg(k, ',' order by k) from public.notifications n, jsonb_object_keys(n.payload) k
   where n.user_id = :'u1' and n.kind = 'invitation_withdrawn' and n.payload ->> 'invitation_id' = :'w_inv'),
  'employer_name,invitation_id,org_slug,title', 'the withdrawal names the invitation, the title, the employer and the recipient''s slug only');
select is(pg_temp.wd(:'own1', :'acme', :'w_resp'), 'P0001|CHARA_INVALID_STATE|responded', 'AC10: a responded invitation stays');
select is(pg_temp.wd(:'own1', :'acme', :'w_decl'), 'P0001|CHARA_INVALID_STATE|declined', 'AC10: a declined invitation stays');
select is(pg_temp.wd(:'own1', :'acme', :'w_inv'), 'P0001|CHARA_INVALID_STATE|withdrawn', 'a withdrawn invitation cannot be withdrawn again');
select is(pg_temp.wd(:'own1', :'acme', gen_random_uuid()), 'P0002|CHARA_NOT_FOUND|', 'an unknown invitation');
select is(pg_temp.inv(:'own1', :'acme', :'rw', array[:'p1']::uuid[]), 'ok', 'decided: a withdrawn partner invited again ...');
select is(
  (select format('%s|%s', e ->> 'already_invited', e ->> 'status') from jsonb_array_elements(pg_temp.result()) e),
  'true|withdrawn', '... gets its withdrawn invitation back, no second row (withdrawn is final)');

-- AC10: expiry with the requirement ------------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme closing') as t \gset
select pg_temp.seed_inv(:'t', :'p1', 'invited') as t_inv \gset
select pg_temp.seed_inv(:'t', :'s1', 'viewed') as t_view \gset
select pg_temp.seed_inv(:'t', :'p2', 'accepted') as t_acc \gset
select pg_temp.seed_inv(:'t', (select id from bulk where n = 1), 'responded') as t_resp \gset
select pg_temp.seed_inv(:'t', (select id from bulk where n = 2), 'declined') as t_decl \gset
select pg_temp.seed_inv(:'t', (select id from bulk where n = 3), 'withdrawn') as t_wd \gset
select set_config('t.notes', (select count(*) from public.notifications)::text, false) as setup_notes2 \gset
update public.workforce_requirements set closes_on = (now() at time zone 'utc')::date - 1 where id = :'t';
select is(private.close_expired_requirements() >= 1, true, 'the daily close of FR-M2 closes T (its date has passed)');
select is(
  (select string_agg(status::text || ':' || (expired_at is not null), ',' order by array_position(
     array[:'t_inv', :'t_view', :'t_acc', :'t_resp', :'t_decl', :'t_wd']::uuid[], id))
   from public.requirement_invitations where requirement_id = :'t'),
  'expired:true,expired:true,expired:true,responded:false,declined:false,withdrawn:false',
  'AC10: invited, viewed and accepted expire; responded, declined and withdrawn keep their state');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.invitation_expired'
     and entity_id in (:'t_inv', :'t_view', :'t_acc') and metadata ->> 'requirement_status' = 'closed'),
  3, 'one audit row requirement.invitation_expired each, with the requirement''s status');
select is((select count(*) from public.notifications where kind <> 'requirement_closed')::text, current_setting('t.notes'),
  'AC10: no notification on expiry beyond the closing notice of V43');
select pg_temp.req(:'acme', 'Acme filling') as tf \gset
select pg_temp.seed_inv(:'tf', :'p1', 'accepted') as tf_acc \gset
select is(
  pg_temp.call_as(:'own1', 'authenticated', format(
    'select public.set_requirement_status(%L, %L, ''filled'', %L::timestamptz)', :'acme', :'tf',
    (select updated_at from public.workforce_requirements where id = :'tf'))),
  'ok', 'the owner fills a requirement');
select is(pg_temp.inv_status(:'tf_acc'), 'expired', 'AC10: filling expires its accepted invitation');
select pg_temp.req(:'acme', 'Acme cancelling') as tc \gset
select pg_temp.seed_inv(:'tc', :'p1', 'invited') as tc_inv \gset
select is(
  pg_temp.call_as(:'own1', 'authenticated', format(
    'select public.set_requirement_status(%L, %L, ''closed'', %L::timestamptz, ''cancelled'')', :'acme', :'tc',
    (select updated_at from public.workforce_requirements where id = :'tc'))),
  'ok', 'the owner closes a requirement as cancelled');
select is(pg_temp.inv_status(:'tc_inv'), 'expired', 'AC10: closing by the employer expires it too');
select pg_temp.req(:'acme', 'Acme pausing') as tp \gset
select pg_temp.seed_inv(:'tp', :'p1', 'viewed') as tp_inv \gset
select is(
  pg_temp.call_as(:'own1', 'authenticated', format(
    'select public.set_requirement_status(%L, %L, ''paused'', %L::timestamptz)', :'acme', :'tp',
    (select updated_at from public.workforce_requirements where id = :'tp'))),
  'ok', 'the owner pauses a requirement');
select is(pg_temp.inv_status(:'tp_inv'), 'viewed', 'AC open point: a paused requirement keeps its invitations');
select is(
  pg_temp.call_as(null, 'postgres', format('update public.requirement_invitations set status = ''invited'' where id = %L', :'t_inv')),
  'P0001|CHARA_INVALID_TRANSITION|expired to invited', 'the guard keeps expired final, even for the table owner');
select is(
  pg_temp.call_as(null, 'postgres', format('update public.requirement_invitations set status = ''accepted'' where id = %L', :'t_decl')),
  'P0001|CHARA_INVALID_TRANSITION|declined to accepted', 'the guard keeps declined final');

-- AC8 (data): the invited partner reads the requirement, even private, and answers ---------------------------------------

create function pg_temp.get(p_user uuid, p_org uuid, p_inv uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', coalesce((select to_jsonb(s) from public.get_invitation(%L, %L) s)::text, 'null'), true)$f$,
    p_org, p_inv), 'aal1')
$$;

create function pg_temp.answer(p_user uuid, p_org uuid, p_inv uuid, p_answer text, p_reason text default null) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format('select public.answer_invitation(%L, %L, %L, %L)', p_org, p_inv, p_answer, p_reason), 'aal1')
$$;

select is(pg_temp.get(:'u1m', :'p1', :'i_p1'), 'ok', 'AC8: a member of P1 opens its invitation to the private requirement R');
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s', r ->> 'status', r ->> 'title', r ->> 'employer_name', r ->> 'employer_company_slug',
     r ->> 'city_region', r ->> 'skills', r ->> 'salary_min', jsonb_array_length(r -> 'occupations'))
   from pg_temp.result() r),
  'viewed|Acme private welders|Acme Bau|acme-bau|Hamburg|MIG/MAG welding|2500.00|1',
  'AC8: every requirement field and the employer display name (the invitation reveals it); the first open sets viewed');
select ok((select viewed_at is not null from public.requirement_invitations where id = :'i_p1'), 'AC8: viewed_at is set');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.employer_revealed' and entity_id = :'r'
     and metadata ->> 'organization_id' = :'p1'),
  1, 'the first sight of the name is audited once (requirement.employer_revealed)');
select is(pg_temp.get(:'u1', :'p1', :'i_p1'), 'ok', 'the owner opens it again');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.employer_revealed' and entity_id = :'r'
     and metadata ->> 'organization_id' = :'p1'),
  1, 'no second audit row of the reveal');
select is(pg_temp.result() ->> 'status', 'viewed', 'the status stays viewed');
select is(pg_temp.get(:'u2', :'p2', :'i_p1'), 'P0002|CHARA_NOT_FOUND|',
  'AC8: the competing partner P2 gets not found for P1''s invitation (the neutral 404)');
select is(pg_temp.get(:'u2', :'p1', :'i_p1'), '42501|CHARA_FORBIDDEN|', 'P2''s owner naming P1 is refused');
select is(pg_temp.get(:'own1', :'acme', :'i_p1'), '42501|CHARA_FORBIDDEN|partner_only', 'the employer reads through its own list');
select is(pg_temp.get(:'wkr', :'p1', :'i_p1'), '42501|CHARA_FORBIDDEN|', 'a candidate is refused');
select is(split_part(pg_temp.get(null, :'p1', :'i_p1'), '|', 1), '42501', 'anon has no EXECUTE');
select is(pg_temp.get(:'u1m', :'p1', :'w_inv'), 'ok', 'P1 opens its withdrawn invitation');
select is(
  (select format('%s|%s|%s|%s', r ->> 'status', r ->> 'title', r ->> 'city_region', r ->> 'country_code') from pg_temp.result() r),
  'withdrawn|Acme withdrawals||', 'a withdrawn invitation shows its status and title, not the requirement''s details');

select is(pg_temp.answer(:'u1m', :'p1', :'i_p1', 'accepted'), 'ok', 'AC8: a member of P1 accepts');
select is(
  (select format('%s|%s', status, answered_at is not null) from public.requirement_invitations where id = :'i_p1'),
  'accepted|t', 'AC8: the invitation is accepted with the time of the answer');
select is(pg_temp.audits('requirement.invitation_accepted', :'i_p1'), 1, 'AC8: one audit row requirement.invitation_accepted');
select is(pg_temp.answer(:'u1m', :'p1', :'i_p1', 'declined'), 'P0001|CHARA_INVALID_STATE|accepted', 'an accepted invitation is not declined');
select pg_temp.inv_of(:'rm', :'p1') as i_rm \gset
select is(pg_temp.answer(:'u1m', :'p1', :'i_rm', 'declined', repeat('x', 501)), 'P0001|CHARA_INVALID_INPUT|p_reason',
  'AC8: a reason over 500 characters is refused');
select is(pg_temp.answer(:'u1m', :'p1', :'i_rm', 'accepted', 'Glad to'), 'P0001|CHARA_INVALID_INPUT|p_reason',
  'a reason belongs to a decline only');
select is(pg_temp.answer(:'u1m', :'p1', :'i_rm', 'maybe'), 'P0001|CHARA_INVALID_INPUT|p_answer', 'an unknown answer');
select is(pg_temp.answer(:'u1m', :'p1', :'i_rm', 'declined', E'Line\x01break'), 'P0001|CHARA_INVALID_INPUT|p_reason',
  'a reason with a control character');
select is(pg_temp.answer(:'u1m', :'p1', :'i_rm', 'declined', '  No welders available before March  '), 'ok',
  'AC8: a member declines the second invitation with a reason, without viewing it first');
select is(
  (select format('%s|%s|%s', status, decline_reason, viewed_at is not null) from public.requirement_invitations where id = :'i_rm'),
  'declined|No welders available before March|t', 'AC8: declined with the trimmed reason');
select is(pg_temp.audits('requirement.invitation_declined', :'i_rm'), 1, 'AC8: one audit row requirement.invitation_declined');
select is(
  (select metadata::text from audit.log where action = 'requirement.invitation_declined' and entity_id = :'i_rm')
    like '%No welders%', false, 'the audit row does not copy the reason');
select pg_temp.inv_of(:'rs', :'p1') as i_rs \gset
select is(pg_temp.answer(:'u1', :'p1', :'i_rs', 'declined', '   '), 'ok', 'an empty reason is no reason');
select is((select decline_reason is null from public.requirement_invitations where id = :'i_rs'), true, 'stored as none');
select is(pg_temp.answer(:'u2', :'p2', :'i_rs', 'accepted'), 'P0002|CHARA_NOT_FOUND|', 'a competing partner cannot answer P1''s invitation');
select is(pg_temp.answer(:'own1', :'acme', :'i_rs', 'accepted'), '42501|CHARA_FORBIDDEN|partner_only', 'nor the employer');
select is(pg_temp.answer(:'u1', :'p1', :'w_inv', 'accepted'), 'P0001|CHARA_INVALID_STATE|withdrawn', 'a withdrawn invitation takes no answer');
select is(pg_temp.answer(:'u1', :'p1', :'t_inv', 'accepted'), 'P0001|CHARA_INVALID_STATE|expired', 'nor an expired one');
select pg_temp.req(:'acme', 'Acme suspended partner') as rsp \gset
select pg_temp.seed_inv(:'rsp', :'p6', 'invited') as i_p6 \gset
select is(pg_temp.answer(:'u6', :'p6', :'i_p6', 'accepted'), '42501|CHARA_FORBIDDEN|organization_suspended',
  'a suspended partner answers nothing');
update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.answer(:'u1', :'s1', :'i_s1', 'accepted'), '42501|CHARA_FORBIDDEN|', 'a member of P1 naming S1 is refused before anything else');
select is(pg_temp.answer(:'us1', :'s1', :'i_s1', 'accepted'), '42501|CHARA_FORBIDDEN|release_off', 'release_job_orders off: no answer');
update private.settings set value = 'true' where key = 'release_job_orders';
select is(pg_temp.answer(:'us1', :'s1', :'i_s1', 'accepted'), 'ok', 'the staffing company accepts');

-- Distinct times, so the order of the list is the order of the invitations.
alter table public.requirement_invitations disable trigger requirement_invitations_immutable;
update public.requirement_invitations set invited_at = now() - interval '4 hours' where id = :'i_p1';
alter table public.requirement_invitations enable always trigger requirement_invitations_immutable;
alter table public.requirement_invitations disable trigger requirement_invitations_immutable;
update public.requirement_invitations set invited_at = now() - interval '3 hours' where id = :'i_rm';
alter table public.requirement_invitations enable always trigger requirement_invitations_immutable;
alter table public.requirement_invitations disable trigger requirement_invitations_immutable;
update public.requirement_invitations set invited_at = now() - interval '2 hours' where id = :'i_rs';
alter table public.requirement_invitations enable always trigger requirement_invitations_immutable;
alter table public.requirement_invitations disable trigger requirement_invitations_immutable;
update public.requirement_invitations set invited_at = now() - interval '1 hour' where id = pg_temp.inv_of(:'r3', :'p1');
alter table public.requirement_invitations enable always trigger requirement_invitations_immutable;

-- The lists ---------------------------------------------------------------------------------------------------------------------

select is(
  pg_temp.read_as(:'u1m', format($f$select string_agg(i.title || ':' || i.status || ':' || i.employer_name, ',' order by n)
    from (select l.*, row_number() over () n from public.list_my_invitations(%L, p_limit => 50) l) i
    where i.title like 'Acme%%welders'$f$, :'p1')),
  'Acme third welders:invited:Acme Bau,Acme Bau named welders:declined:Acme Bau,Acme Bau anonymous welders:declined:Acme Bau,Acme private welders:accepted:Acme Bau',
  'P1''s members list its invitations newest first with the title and employer the invitation reveals');
select is(
  pg_temp.read_as(:'u1m', format('select count(*)::text from public.list_my_invitations(%L, %L)', :'p1', 'declined')),
  '2', 'a status filter');
select is(
  pg_temp.read_as(:'u1m', format('select (next_cursor is not null)::text from public.list_my_invitations(%L, p_limit => 1)', :'p1')),
  'true', 'a page with a next one carries the cursor');
select is(
  pg_temp.read_as(:'u1m', format('select count(*)::text from public.list_my_invitations(%L, p_cursor => %L, p_limit => 50)', :'p1',
    (select id from public.requirement_invitations where organization_id = :'p1' order by invited_at desc, id limit 1))),
  ((select count(*) from public.requirement_invitations where organization_id = :'p1') - 1)::text, 'the next page follows the cursor');
select is(
  pg_temp.read_as(:'u1m', format('select count(*)::text from public.list_my_invitations(%L, p_cursor => %L)', :'p1', :'i_s1')),
  'P0001|CHARA_INVALID_INPUT|p_cursor', 'another partner''s invitation is no cursor');
select is(
  pg_temp.read_as(:'u2', format('select count(*)::text from public.list_my_invitations(%L) where requirement_id = %L', :'p2', :'r')),
  '1', 'P2 lists its own invitation to R only');
select is(
  pg_temp.read_as(:'u2', format('select count(*)::text from public.list_my_invitations(%L)', :'p1')), '42501|CHARA_FORBIDDEN|',
  'P2 cannot list P1''s invitations');
select is(
  pg_temp.read_as(:'own1', format('select count(*)::text from public.list_my_invitations(%L)', :'acme')),
  '42501|CHARA_FORBIDDEN|partner_only', 'an employer has no partner inbox');

select is(
  pg_temp.read_as(:'mem', format($f$select string_agg(partner_name || ':' || status || ':' || coalesce(decline_reason, '-'), ',' order by partner_name)
    from public.list_requirement_invitations(%L, %L)$f$, :'acme', :'rw')),
  'Bulk V41 1:responded:-,Bulk V41 2:declined:Fully booked,P1 V41:withdrawn:-,P2 V41:withdrawn:-,S1 V41:withdrawn:-',
  'AC9 (data): an Acme member reads each partner''s name and status, the decline reason included');
select is(
  pg_temp.read_as(:'mem', format('select string_agg(distinct source, '','') from public.list_requirement_invitations(%L, %L)', :'acme', :'r')),
  'directory', 'the source of each invitation');
select is(
  pg_temp.read_as(:'own2', format('select count(*)::text from public.list_requirement_invitations(%L, %L)', :'beta', :'r')),
  'P0002|CHARA_NOT_FOUND|', 'Beta does not reach Acme''s requirement');
select is(
  pg_temp.read_as(:'u1', format('select count(*)::text from public.list_requirement_invitations(%L, %L)', :'acme', :'r')),
  '42501|CHARA_FORBIDDEN|', 'an invited partner does not see the other invitations of the requirement');
select is(
  pg_temp.read_as(:'u1', format('select count(*)::text from public.list_requirement_invitations(%L, %L)', :'p1', :'r')),
  '42501|CHARA_FORBIDDEN|employer_only', 'nor through its own organisation');

select is(
  pg_temp.read_as(:'u1m', format($f$select format('%%s|%%s|%%s|%%s|%%s|%%s', title, status, country_code is null, workers_needed is null,
    start_date is null, requirement_status is null) from public.list_my_invitations(%L, p_limit => 50) where id = %L$f$, :'p1', :'w_inv')),
  'Acme withdrawals|withdrawn|t|t|t|t',
  'a withdrawn invitation in the list keeps its title and status, without destination, workers, start date or the requirement''s status');
select is(
  pg_temp.read_as(:'u1m', format($f$select (country_code is not null and requirement_status is not null)::text
    from public.list_my_invitations(%L, p_limit => 50) where id = %L$f$, :'p1', :'i_p1')),
  'true', 'an accepted invitation keeps them');
update public.organizations set moderation_state = 'hidden' where id = :'p2';
select is(
  pg_temp.read_as(:'mem', format($f$select string_agg(partner_name || ':' || coalesce(partner_slug, 'none'), ',' order by partner_name)
    from public.list_requirement_invitations(%L, %L) where partner_name in ('P1 V41', 'P2 V41')$f$, :'acme', :'rw')),
  'P1 V41:p1-v41,P2 V41:none', 'a partner hidden since the invitation is listed by name without the slug of a profile that is gone');
update public.organizations set moderation_state = 'visible' where id = :'p2';

-- The columns that never change ---------------------------------------------------------------------------------------------

select is(
  pg_temp.call_as(null, 'postgres', format('update public.requirement_invitations set organization_id = %L where id = %L', :'p2', :'i_p1')),
  'P0001|CHARA_INVALID_INPUT|immutable', 'the partner of an invitation never changes, whatever the status does');
select is(
  pg_temp.call_as(null, 'postgres', format('update public.requirement_invitations set requirement_id = %L where id = %L', :'r2', :'i_p1')),
  'P0001|CHARA_INVALID_INPUT|immutable', 'nor its requirement');
select is(
  pg_temp.call_as(null, 'postgres', format('update public.requirement_invitations set employer_organization_id = %L where id = %L', :'beta', :'i_p1')),
  'P0001|CHARA_INVALID_INPUT|immutable', 'nor its employer');
select is(
  pg_temp.call_as(null, 'postgres', format('update public.requirement_invitations set source = ''profile'' where id = %L', :'i_p1')),
  'P0001|CHARA_INVALID_INPUT|immutable', 'nor its source');
select is(
  pg_temp.call_as(null, 'postgres', format('update public.requirement_invitations set invited_at = now() - interval ''1 day'', status = ''responded'', responded_at = now() where id = %L', :'i_p1')),
  'P0001|CHARA_INVALID_INPUT|immutable', 'nor the time of the invitation, also with a status change');
select is(
  pg_temp.call_as(null, 'postgres', format('update public.requirement_invitations set invited_by = %L where id = %L', :'adm', :'i_p1')),
  'P0001|CHARA_INVALID_INPUT|immutable', 'who invited is not rewritten');
select is(
  pg_temp.call_as(null, 'postgres', format('update public.requirement_invitations set invited_by = null where id = %L', :'i_p1')),
  'ok', 'who invited is cleared (the erasure of the member, on delete set null)');

-- NFR-S8: reads of the table from both sides -------------------------------------------------------------------------------

select is(
  pg_temp.read_as(:'u1m', format('select (bool_and(organization_id = %L) and count(*) > 0)::text from public.requirement_invitations', :'p1')),
  'true', 'NFR-S8: a member of P1 reads P1''s invitations only');
select is(
  pg_temp.read_as(:'u1m', format('select count(*)::text from public.requirement_invitations where organization_id = %L', :'p2')),
  '0', 'NFR-S8: and none of the competing partner P2, of the same requirement');
select is(
  pg_temp.read_as(:'u2', format('select (bool_and(organization_id = %L))::text from public.requirement_invitations', :'p2')),
  'true', 'NFR-S8: P2 reads its own only');
select is(
  pg_temp.read_as(:'mem', format('select (bool_and(employer_organization_id = %L) and count(*) > 0)::text from public.requirement_invitations', :'acme')),
  'true', 'NFR-S8: an Acme member reads Acme''s invitations only');
select is(
  pg_temp.read_as(:'own2', format('select count(*)::text from public.requirement_invitations where employer_organization_id = %L', :'acme')),
  '0', 'NFR-S8: the other employer Beta reads none of Acme''s');
select is(pg_temp.read_as(:'wkr', 'select count(*)::text from public.requirement_invitations'), '0', 'NFR-S8: a candidate reads none');
select is(pg_temp.read_as(:'sadm', 'select count(*)::text from public.requirement_invitations'), '0',
  'staff read none through the table');
select is(split_part(pg_temp.read_as(null, 'select count(*)::text from public.requirement_invitations'), '|', 1), '42501',
  'NFR-S8: anon reads nothing');
select is(split_part(pg_temp.read_as(:'mem', 'select count(invited_by)::text from public.requirement_invitations'), '|', 1), '42501',
  'who invited is not readable, not even by the employer');
select is(split_part(pg_temp.read_as(:'u1', 'select count(suggestion_criteria)::text from public.requirement_invitations'), '|', 1),
  '42501', 'the suggestion criteria are not readable through the table');
select is(pg_temp.read_as(:'u1', format('select count(*)::text from public.workforce_requirements where id = %L', :'r')), '0',
  'NFR-S8: the invited partner still reads no requirement through the table (only get_invitation)');
select is(
  pg_temp.read_as(:'u1', format('select count(*)::text from public.notifications where kind = ''invitation_received'' and user_id = %L', :'u1a')),
  '0', 'a partner owner does not read another member''s notifications');

-- FR-M3 AC9, step Measure: the criteria of partners invited from the suggestions ----------------------------------------

update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.req(:'acme', 'Acme suggested welders', p_recruitment => 'international') as q \gset
select pg_temp.partner('q1-v41', null, p_industries => array['C'], p_recruitment => 'international') as q1 \gset
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity, available_from, confirmed_at)
values (:'q1', '7212', 'PH', 20, 5, date '2027-02-01', now() - interval '1 day');
select pg_temp.partner('q4-v41', null, p_recruitment => 'local') as q4 \gset
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity, available_from, confirmed_at)
values (:'q4', '7212', 'PH', 12, 5, date '2027-04-01', now() - interval '1 day');
select pg_temp.partner('dir-v41', null) as qd \gset
delete from private.rate_limit_hits;
select is(
  pg_temp.read_as(:'own1', format($f$select string_agg(organization_id::text || '=' || array_to_string(criteria_met, '+'), ',' order by organization_id)
    from public.suggest_partners(%L, %L) where organization_id in (%L, %L)$f$, :'acme', :'q', :'q1', :'q4'), 'aal2'),
  (select string_agg(x::text || '=' || array_to_string(private.suggestion_criteria(:'q', x), '+'), ',' order by x)
   from unnest(array[:'q1', :'q4']::uuid[]) x),
  'FR-M3 AC9: the criteria recorded are those suggest_partners shows for the same partners');
select is(array_to_string(private.suggestion_criteria(:'q', :'q1'), '+'), 'industry+recruitment_type+capacity+available_before_start',
  'Q1 meets the four criteria');
select is(array_to_string(private.suggestion_criteria(:'q', :'q4'), '+'), 'capacity',
  'Q4 meets capacity only (its workers are available after the start)');
select is(pg_temp.inv(:'adm', :'acme', :'q', array[:'q1', :'q4']::uuid[], 'suggestions'), 'ok',
  'FR-M3 AC9: an Acme admin at aal2 invites Q1 and Q4 from the suggestions');
select is(pg_temp.inv(:'adm', :'acme', :'q', array[:'qd']::uuid[], 'directory'), 'ok', '... and Delta from the directory');
select is(
  (select string_agg(format('%s|%s|%s', o.slug, i.source, coalesce(array_to_string(i.suggestion_criteria, '+'), 'null')), ',' order by o.slug)
   from public.requirement_invitations i join public.organizations o on o.id = i.organization_id where i.requirement_id = :'q'),
  'dir-v41|directory|null,q1-v41|suggestions|industry+recruitment_type+capacity+available_before_start,q4-v41|suggestions|capacity',
  'FR-M3 AC9: the rows from the suggestions hold the criteria met at that moment and source suggestions; Delta''s row source directory and none');
update public.workforce_availability set available = 1 where organization_id = :'q1';
select is(
  (select array_to_string(suggestion_criteria, '+') from public.requirement_invitations where requirement_id = :'q' and organization_id = :'q1'),
  'industry+recruitment_type+capacity+available_before_start', 'the record keeps the moment of the invitation when the listing changes');
select is(
  pg_temp.read_as(:'mem', format($f$select string_agg(array_to_string(suggestion_criteria, '+'), ',' order by partner_name)
    from public.list_requirement_invitations(%L, %L) where source = 'suggestions'$f$, :'acme', :'q')),
  'industry+recruitment_type+capacity+available_before_start,capacity', 'the employer reads the recorded criteria');
select is(
  (select format('%s of %s', count(*) filter (where source = 'suggestions'), count(*)) from public.requirement_invitations
   where requirement_id = :'q'),
  '2 of 3', 'KPI invitations sent from suggestions: stored as requirement_invitations.source');
select is(
  split_part(pg_temp.call_as(null, 'postgres', format(
    'insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source) values (%L, %L, %L, %L)',
    :'q', :'p2', :'acme', 'suggestions')), '|', 1), '23514',
  'an invitation from the suggestions without criteria cannot be stored');

select * from finish();
rollback;
