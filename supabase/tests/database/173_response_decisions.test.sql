begin;
select plan(82);

\ir jobs_fixture.inc

-- Response comparison and decisions (V47, FR-O3 AC3 to AC9 and the data of AC1, AC2, AC10, AC11; SOP P2-23 steps Compare,
-- Decide, Reveal, Inform, Open submissions, Record; decisions 3.2, 3.4; NFR-S8, NFR-S11, NFR-A3): decide_response,
-- set_submissions_allowed, compare_responses, private.submissions_allowed_for, the shortlist and selection reveals and the
-- kind response_decided. Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner own2) are employers of the
-- fixture and wkr is a candidate; the partners are made below.

\set u1 '00000000-0000-0000-0000-0000000f4711'
\set u1a '00000000-0000-0000-0000-0000000f4712'
\set u1m '00000000-0000-0000-0000-0000000f4713'
\set u1s '00000000-0000-0000-0000-0000000f4714'
\set u2 '00000000-0000-0000-0000-0000000f4715'
\set us1 '00000000-0000-0000-0000-0000000f4716'
\set padm '00000000-0000-0000-0000-0000000f4717'
\set stf '00000000-0000-0000-0000-0000000f4718'

update private.settings set value = 'true' where key = 'release_job_orders';
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

-- A listed partner of p_type serving Germany, sourcing from the Philippines and listing 7212 on a paid plan, owned by
-- p_owner (padm when null), whose owner accepted the commitment.
create function pg_temp.partner(p_slug text, p_owner uuid default null, p_type text default 'recruitment_company') returns uuid
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
  insert into public.organization_geographies (organization_id, scope, country_code) values
    (v_id, 'serves_market', 'DE'), (v_id, 'serves_market', 'AT'), (v_id, 'sources_from', 'PH');
  insert into public.organization_occupations (organization_id, occupation_id) values (v_id, '7212');
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  values (v_id, case p_type when 'staffing_company' then 'staffing_partner' else 'recruitment_partner' end, 'active', 'null');
  if not private.partner_commitment_current(v_id) then
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

-- A requirement of p_org on the marketplace without the employer's name, as the lifecycle functions leave it.
create function pg_temp.req(p_org uuid, p_title text, p_status text default 'open') returns uuid
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
    p_status::public.requirement_status, 'job_order_marketplace', false, now() - interval '10 days', date '2027-04-01',
    case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

-- A response written as the database owner in p_status.
create function pg_temp.seed_resp(p_req uuid, p_partner uuid, p_status text default 'submitted', p_fee text default 'on_request')
returns uuid
language sql as $$
  insert into public.partner_responses (
    requirement_id, organization_id, employer_organization_id, status, capacity, available_from, experience_note, fee_model,
    fee_amount, fee_currency, decided_at, withdrawn_at
  )
  select p_req, p_partner, r.organization_id, p_status::public.response_status, 5, current_date + 30,
    'Twenty welders placed in Hamburg last year.', p_fee::public.fee_model,
    case when p_fee = 'fee_per_hire' then 1500 end, case when p_fee = 'fee_per_hire' then 'EUR' end,
    case when p_status in ('shortlisted', 'selected', 'declined') then now() end,
    case when p_status = 'withdrawn' then now() end
  from public.workforce_requirements r where r.id = p_req
  returning id
$$;

-- decide_response as p_user (anonymous when null) for p_org: 'ok' with the answer in t.result, or 'sqlstate|message|detail'.
create function pg_temp.dec(p_user uuid, p_org uuid, p_resp uuid, p_decision text, p_note text default null,
  p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', public.decide_response(%L, %L, %L, %L)::text, true)$f$, p_org, p_resp, p_decision, p_note),
    p_aal)
$$;

create function pg_temp.allow(p_user uuid, p_org uuid, p_resp uuid, p_allowed boolean, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.result', public.set_submissions_allowed(%L, %L, %L)::text, true)$f$, p_org, p_resp, p_allowed),
    p_aal)
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

create function pg_temp.told(p_kind text, p_id uuid) returns text
language sql as $$
  select coalesce(string_agg(n.user_id::text || ':' || (n.payload ->> 'decision'), ',' order by n.user_id, n.payload ->> 'decision'), '')
  from public.notifications n where n.kind = p_kind and n.payload ->> 'response_id' = p_id::text
$$;

create function pg_temp.audits(p_action text, p_id uuid) returns integer
language sql as $$ select count(*)::integer from audit.log where action = p_action and entity_id = p_id::text $$;

select pg_temp.partner('alpha-v47', :'u1') as p1 \gset
select pg_temp.member(:'p1', :'u1a', 'admin') as seeded \gset
select pg_temp.member(:'p1', :'u1m', 'member') as seeded \gset
select pg_temp.member(:'p1', :'u1s', 'admin') as seeded \gset
update public.profiles set status = 'suspended' where id = :'u1s';
select pg_temp.partner('bravo-v47', :'u2') as p2 \gset
select pg_temp.partner('staffing-v47', :'us1', 'staffing_company') as s1 \gset
select pg_temp.partner('moves-v47') as p3 \gset

-- Structure ------------------------------------------------------------------------------------------------------------------

select is(
  (select array_agg(proname::text order by proname) from pg_proc
   where pronamespace = 'public'::regnamespace and proname in ('decide_response', 'set_submissions_allowed', 'compare_responses')
     and prosecdef and proconfig @> array['search_path=""']
     and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')),
  array['compare_responses', 'decide_response', 'set_submissions_allowed'],
  'the functions are security definer with an empty search path, for authenticated callers only');
select is(
  (select count(*)::integer from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('response_decision_allowed', 'submissions_allowed_for', 'queue_response_decision', 'decided_response')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'no API role executes the private helpers');
select is(
  (select kind || ':' || mandatory || ':' || default_email || ':' || organization_types::text
   from private.notification_kinds where kind = 'response_decided'),
  'response_decided:false:true:{recruitment_company,staffing_company}',
  'FR-O3 AC7: response_decided is optional with email on, for recruitment and staffing companies');
select ok(
  not exists (select 1 from pg_proc p cross join unnest(p.proargnames) a
              where p.oid = 'public.compare_responses(uuid, uuid)'::regprocedure and a ilike '%licence%'),
  'FR-O3 AC1: the comparison has no licence field');

-- AC3: the moves -----------------------------------------------------------------------------------------------------------

create temporary table moves (from_status text, to_status text, req uuid, resp uuid, outcome text) on commit drop;
grant all on moves to authenticated;
insert into moves (from_status, to_status, req)
select f.s, t.s, pg_temp.req(:'acme', 'Move ' || f.s || ' to ' || t.s)
from unnest(array['submitted', 'updated', 'shortlisted', 'selected', 'declined', 'withdrawn']) with ordinality f (s, fn)
cross join unnest(array['shortlisted', 'selected', 'declined']) with ordinality t (s, tn);
update moves set resp = pg_temp.seed_resp(req, :'p3', from_status);
update moves set outcome = split_part(pg_temp.dec(:'own1', :'acme', resp, to_status), '|', 2);

select is(
  (select string_agg(from_status || '>' || to_status, ',' order by from_status, to_status) from moves where outcome = ''),
  'shortlisted>declined,shortlisted>selected,submitted>declined,submitted>selected,submitted>shortlisted,updated>declined,updated>selected,updated>shortlisted',
  'FR-O3 AC3: submitted and updated accept all three decisions, shortlisted accepts selected and declined');
select is(
  (select count(*)::integer from moves where outcome = 'CHARA_INVALID_TRANSITION'), 10,
  'FR-O3 AC3: shortlisted again, and every decision on selected, declined and withdrawn, is CHARA_INVALID_TRANSITION');
select is(
  (select count(*)::integer from moves m join public.partner_responses p on p.id = m.resp
   where m.outcome = '' and p.status::text = m.to_status and p.decided_by = :'own1' and p.decided_at > now() - interval '1 minute'),
  8, 'FR-O3 AC3: each accepted decision sets the status, decided_at and decided_by');
select is(
  (select count(*)::integer from moves m join audit.log a on a.entity_id = m.resp::text and a.action = 'response.decided'
   where m.outcome = '' and a.metadata ->> 'from' = m.from_status and a.metadata ->> 'to' = m.to_status
     and a.actor_id = :'own1'),
  8, 'FR-O3 AC3: each accepted decision writes one audit row response.decided with from and to');
select is(
  (select count(*)::integer from moves m join public.partner_responses p on p.id = m.resp
   where m.outcome <> '' and (p.status::text <> m.from_status or pg_temp.audits('response.decided', m.resp) > 0)),
  0, 'FR-O3 AC3: a refused call changes and audits nothing');
select is(pg_temp.dec(:'own1', :'acme', (select resp from moves where from_status = 'submitted' limit 1), 'withdrawn'),
  'P0001|CHARA_INVALID_INPUT|p_decision', 'withdrawn, submitted or updated is no decision');
select is(pg_temp.dec(:'own1', :'acme', (select resp from moves where from_status = 'selected' limit 1), 'declined'),
  'P0001|CHARA_INVALID_TRANSITION|selected to declined', 'FR-O3 open point: selected is final');

-- AC4: who decides ---------------------------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme welders R') as r \gset
select pg_temp.seed_resp(:'r', :'p1') as r_p1 \gset
select is(pg_temp.dec(:'own1', :'acme', :'r_p1', 'shortlisted', p_aal => 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'FR-O3 AC4: the Acme owner at aal1 is refused, aal2_required');
select is(split_part(pg_temp.dec(:'mem', :'acme', :'r_p1', 'shortlisted'), '|', 2), 'CHARA_FORBIDDEN',
  'FR-O3 AC4: an Acme member is refused');
select is(pg_temp.dec(:'own2', :'beta', :'r_p1', 'shortlisted'), 'P0002|CHARA_NOT_FOUND|',
  'FR-O3 AC4: the owner of Beta, for Beta, gets CHARA_NOT_FOUND');
select is(split_part(pg_temp.dec(:'own2', :'acme', :'r_p1', 'shortlisted'), '|', 2), 'CHARA_FORBIDDEN',
  'the owner of Beta naming Acme is no member of it');
select is(split_part(pg_temp.dec(:'u1m', :'p1', :'r_p1', 'shortlisted'), '|', 2), 'CHARA_FORBIDDEN',
  'FR-O3 AC4: a member of P1 cannot decide (refused before any lookup, departure 1)');
select is(pg_temp.dec(:'u1', :'p1', :'r_p1', 'selected'), 'P0001|CHARA_FORBIDDEN|employer_only',
  'the owner of P1 at aal2 cannot decide its own response');
select is(split_part(pg_temp.dec(:'wkr', :'acme', :'r_p1', 'shortlisted'), '|', 2), 'CHARA_FORBIDDEN',
  'FR-O3 AC4: a candidate is refused');
select is(split_part(pg_temp.dec(:'stf', :'acme', :'r_p1', 'shortlisted'), '|', 2), 'CHARA_FORBIDDEN',
  'FR-O3 AC4: a Platform Administrator has no decision function');
select is(pg_temp.dec(null, :'acme', :'r_p1', 'shortlisted'), '42501|permission denied for function decide_response|',
  'FR-O3 AC4: an anonymous caller is refused for lack of EXECUTE');
select is(
  pg_temp.call_as(:'adm', 'authenticated', format($$update public.partner_responses set status = 'shortlisted' where id = %L$$, :'r_p1')),
  '42501|permission denied for table partner_responses|', 'FR-O3 AC4: an Acme admin cannot update the status directly');
select is((select status::text from public.partner_responses where id = :'r_p1'), 'submitted', 'nothing was decided so far');
update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.dec(:'adm', :'acme', :'r_p1', 'shortlisted'), 'P0001|CHARA_FORBIDDEN|release_off',
  'nothing is decided while release_job_orders is off');
update private.settings set value = 'true' where key = 'release_job_orders';
select is(pg_temp.dec(:'adm', :'acme', :'r_p1', 'shortlisted') || ':' || current_setting('t.result'), 'ok:shortlisted',
  'FR-O3 AC4: an Acme admin at aal2 shortlists');

-- AC5: the note ------------------------------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme notes N') as n \gset
select pg_temp.seed_resp(:'n', :'p1') as n_a \gset
select pg_temp.seed_resp(:'n', :'p2') as n_b \gset
select pg_temp.seed_resp(:'n', :'s1') as n_c \gset
select pg_temp.seed_resp(:'n', :'p3') as n_d \gset
select is(pg_temp.dec(:'own1', :'acme', :'n_b', 'declined', repeat('x', 1001)), 'P0001|CHARA_INVALID_INPUT|p_note',
  'FR-O3 AC5: a note of 1,001 characters is refused');
select is(pg_temp.dec(:'own1', :'acme', :'n_b', 'declined', E'Fee\u0007 above'), 'P0001|CHARA_INVALID_INPUT|p_note',
  'a control character in the note is refused');
select is((select status::text || coalesce(decision_note, '-') from public.partner_responses where id = :'n_b'), 'submitted-',
  'a refused note writes nothing');
select is(pg_temp.dec(:'own1', :'acme', :'n_a', 'declined'), 'ok', 'FR-O3 AC5: a decline without a note is accepted');
select is(pg_temp.dec(:'own1', :'acme', :'n_b', 'declined', repeat('x', 1000)), 'ok', 'FR-O3 AC5: a note of 1,000 characters is accepted');
select is(pg_temp.dec(:'own1', :'acme', :'n_c', 'shortlisted', '  ' || repeat('y', 200) || ' '), 'ok',
  'FR-O3 AC5: a shortlist with a note of 200 characters is accepted');
select is(
  (select string_agg(coalesce(char_length(decision_note)::text, 'null'), ',' order by id = :'n_a' desc, id = :'n_b' desc)
   from public.partner_responses where id in (:'n_a', :'n_b', :'n_c')),
  'null,1000,200', 'FR-O3 AC5: the notes are stored trimmed, none as null');
select is(pg_temp.dec(:'own1', :'acme', :'n_d', 'shortlisted', '   '), 'ok', 'a blank note is none');
select is(pg_temp.read_as(:'u2', format('select decision_note from public.get_response(%L, %L)', :'p2', :'n_b')), repeat('x', 1000),
  'FR-O3 AC5: the partner of the response reads its note');
select is(pg_temp.read_as(:'u2', format('select count(*) from public.partner_responses where id in (%L, %L)', :'n_a', :'n_c')), '0',
  'FR-O3 AC5: another partner reads no row of the others');
select is(pg_temp.read_as(:'u2', format('select decision_note from public.get_response(%L, %L)', :'p2', :'n_c')), 'P0002|CHARA_NOT_FOUND|',
  'FR-O3 AC5, NFR-S11: nor their notes through get_response');

-- AC6: the reveal ---------------------------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme anonymous A') as ra \gset
select pg_temp.seed_resp(:'ra', :'p1') as ra_p1 \gset
select pg_temp.seed_resp(:'ra', :'p2') as ra_p2 \gset
select is(pg_temp.read_as(:'u1', format('select coalesce(employer_name, ''none'') from public.get_job_order(%L, %L)', :'p1', :'ra')),
  'none', 'FR-O3 AC6: before the decision P1 reads no employer on the anonymous job order');
select pg_temp.read_as(:'u2', format('select row_to_json(j)::text from public.get_job_order(%L, %L) j', :'p2', :'ra')) as p2_before \gset
select pg_temp.read_as(:'u2', format('select string_agg(row_to_json(j)::text, '','' order by j.id) from public.list_my_responses(%L) j', :'p2')) as p2_list_before \gset
select is(pg_temp.dec(:'own1', :'acme', :'ra_p1', 'shortlisted') || pg_temp.dec(:'own1', :'acme', :'ra_p2', 'declined'), 'okok',
  'the owner shortlists P1 and declines P2');
select is(
  (select string_agg(organization_id::text || ':' || cause || ':' || (seen_at is null), ',') from private.requirement_reveals
   where requirement_id = :'ra'),
  :'p1' || ':shortlist:true', 'FR-O3 step Reveal: one reveal for P1 (cause shortlist), none for the declined P2');
select is(pg_temp.read_as(:'u1', format('select employer_name from public.get_job_order(%L, %L)', :'p1', :'ra')), 'Acme Bau',
  'FR-O3 AC6: P1 now reads the Acme display name');
select is(
  (select count(*)::integer from audit.log where action = 'requirement.employer_revealed' and entity_id = :'ra'
     and metadata ->> 'organization_id' = :'p1' and metadata ->> 'cause' = 'shortlist'),
  1, 'FR-O3 AC6: one audit row requirement.employer_revealed with the cause shortlist');
select is(pg_temp.read_as(:'u2', format('select row_to_json(j)::text from public.get_job_order(%L, %L) j', :'p2', :'ra')), :'p2_before',
  'FR-O3 AC6, NFR-S11: P2 reads the job order exactly as before ("Company not named", the same count): it learns nothing of P1');
select is(pg_temp.dec(:'own1', :'acme', :'ra_p1', 'selected'), 'ok', 'the owner then selects P1');
select is(pg_temp.read_as(:'u1', format('select employer_name from public.get_job_order(%L, %L)', :'p1', :'ra')), 'Acme Bau',
  'P1 still reads the name');
select is(
  (select count(*)::integer from private.requirement_reveals where requirement_id = :'ra')
    || ':' || (select cause from private.requirement_reveals where requirement_id = :'ra')
    || ':' || (select count(*) from audit.log where action = 'requirement.employer_revealed' and entity_id = :'ra'),
  '1:shortlist:1', 'FR-O3 AC6: a later selection writes no second reveal row and no second audit row');
select is(pg_temp.read_as(:'u2', format('select row_to_json(j)::text from public.get_job_order(%L, %L) j', :'p2', :'ra')), :'p2_before',
  'NFR-S11: nor does P2 learn of the selection');
select is(
  pg_temp.read_as(:'u2', format('select string_agg(row_to_json(j)::text, '','' order by j.id) from public.list_my_responses(%L) j', :'p2')),
  replace(replace(:'p2_list_before', '"status":"submitted"', '"status":"declined"'), '"decided_at":null',
    '"decided_at":"' || (select to_json(decided_at) #>> '{}' from public.partner_responses where id = :'ra_p2') || '"'),
  'NFR-S11: P2''s own list shows only its own decision, the generated title and no employer');

-- The reveal is audited the first time the name is shown anywhere, not only on the job order page -------------------------

select pg_temp.req(:'acme', 'Acme shown G') as g \gset
select pg_temp.seed_resp(:'g', :'p3') as g_p3 \gset
select pg_temp.seed_resp(:'g', :'s1') as g_s1 \gset
select is(pg_temp.dec(:'own1', :'acme', :'g_p3', 'selected') || pg_temp.dec(:'own1', :'acme', :'g_s1', 'shortlisted'), 'okok',
  'the owner selects P3 and shortlists S1');
select is(
  pg_temp.read_as(:'padm', format('select employer_name from public.get_response(%L, %L)', :'p3', :'g_p3')) || ':'
    || pg_temp.read_as(:'padm', format('select employer_name from public.get_response(%L, %L)', :'p3', :'g_p3')),
  'Acme Bau:Acme Bau', 'a partner that only opens its response after the selection reads the employer''s name');
select is(
  (select count(*)::integer || ':' || min(metadata ->> 'cause') || ':' || min(metadata ->> 'organization_id') from audit.log
   where action = 'requirement.employer_revealed' and entity_id = :'g'),
  '1:selection:' || :'p3', 'exactly one requirement.employer_revealed row (cause selection), though the job order was never opened');
-- A read's audit row is invisible to the statement that made the read (it keeps its start snapshot), so the counts below
-- are taken by the next statement.
select pg_temp.read_as(:'us1', format('select count(*) from public.list_my_responses(%L) where requirement_id = %L and employer_name = %L', :'s1', :'g', 'Acme Bau')) as g_s1_listed \gset
select is(
  :'g_s1_listed' || ':' || (select count(*) from audit.log where action = 'requirement.employer_revealed' and entity_id = :'g'
               and metadata ->> 'organization_id' = :'s1'),
  '1:1', 'the shortlisted S1 sees the name in its response list, and that first showing is audited once');
select pg_temp.read_as(:'us1', format('select employer_name from public.get_response(%L, %L)', :'s1', :'g_s1')) as g_s1_read \gset
select is(
  :'g_s1_read' || ':' || (select count(*) from audit.log where action = 'requirement.employer_revealed' and entity_id = :'g'),
  'Acme Bau:2', 'a later read writes no second row for S1');

-- AC7: the partners are told -------------------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme told T') as t \gset
select pg_temp.seed_resp(:'t', :'p1') as t_p1 \gset
select pg_temp.seed_resp(:'t', :'s1') as t_s1 \gset
select pg_temp.seed_resp(:'t', :'p2') as t_p2 \gset
insert into public.notification_preferences (user_id, email_kinds) values (:'u2', '{"response_decided": false}');
select is(
  pg_temp.dec(:'own1', :'acme', :'t_p1', 'shortlisted') || pg_temp.dec(:'own1', :'acme', :'t_s1', 'selected')
    || pg_temp.dec(:'own1', :'acme', :'t_p2', 'declined', 'Fee above budget'),
  'okokok', 'the owner shortlists P1, selects S1 and declines P2 with a note');
select is(pg_temp.told('response_decided', :'t_p1'), :'u1' || ':shortlisted,' || :'u1a' || ':shortlisted',
  'FR-O3 AC7: one response_decided to each owner and admin of P1 with an active account; none to its member');
select is(pg_temp.told('response_decided', :'t_s1') || '/' || pg_temp.told('response_decided', :'t_p2'),
  :'us1' || ':selected/' || :'u2' || ':declined', 'FR-O3 AC7: S1 is told of its selection and P2 of its decline');
select is(
  (select string_agg(k, ',' order by k) from public.notifications n cross join jsonb_object_keys(n.payload) k
   where n.kind = 'response_decided' and n.payload ->> 'response_id' = :'t_p2'),
  'decision,org_slug,requirement_id,response_id,title',
  'FR-O3 AC7: the decline names the requirement and the decision only: no note, no employer, no other partner, no count');
select is(
  (select (payload ->> 'title') || '|' || (payload ->> 'org_slug') from public.notifications
   where kind = 'response_decided' and payload ->> 'response_id' = :'t_p2'),
  private.job_order_neutral_title(:'t') || '|bravo-v47', 'NFR-S11: P2 is not named the employer; the generated title and its own slug');
select is(
  (select (payload ->> 'title') || '|' || (payload ->> 'employer_name') from public.notifications
   where kind = 'response_decided' and payload ->> 'response_id' = :'t_p1' limit 1),
  'Acme told T|Acme Bau', 'FR-O3 AC6, AC7: the shortlisted P1 is told the requirement''s own title and the employer');
select is(
  (select string_agg(mandatory::text || ':' || coalesce(email_status, 'email'), ',') from public.notifications
   where kind = 'response_decided' and payload ->> 'response_id' = :'t_p2'),
  'false:suppressed_by_preference', 'FR-O3 AC7: response_decided is not mandatory and follows the email preference');
select is(pg_temp.read_as(:'u2', format('select status || '':'' || decision_note from public.get_response(%L, %L)', :'p2', :'t_p2')),
  'declined:Fee above budget', 'FR-O3 AC7: P2 reads its decision and note');
select is(
  pg_temp.read_as(:'u2', format('select count(*) from public.partner_responses where requirement_id = %L', :'t')) || ':'
    || (select count(*) from public.notifications n join public.organization_members m on m.user_id = n.user_id
        where m.organization_id = :'p2' and n.kind = 'response_decided' and n.payload ->> 'response_id' in (:'t_p1', :'t_s1')),
  '1:0', 'FR-O3 AC7: P2 reads only its own response of T and is told nothing of P1 or S1');
select is(split_part(pg_temp.read_as(:'u2', format('select count(*) from public.compare_responses(%L, %L)', :'p2', :'t')), '|', 3),
  'employer_only', 'FR-O3 AC7: a partner cannot compare the responses');

-- AC8: submissions -----------------------------------------------------------------------------------------------------------

select is(
  (select string_agg(organization_id::text || ':' || submissions_allowed, ',' order by organization_id = :'s1' desc, organization_id = :'p1' desc)
   from public.partner_responses where requirement_id = :'t'),
  :'s1' || ':true,' || :'p1' || ':false,' || :'p2' || ':false',
  'FR-O3 AC8: the selection opened submissions for S1; the shortlisted P1 and the declined P2 have none');
select is(
  private.submissions_allowed_for(:'t', :'s1')::text || private.submissions_allowed_for(:'t', :'p1')::text
    || private.submissions_allowed_for(:'t', :'p2')::text,
  'truefalsefalse', 'FR-O3 AC8: private.submissions_allowed_for (read by V48) answers the same');
select is(split_part(pg_temp.allow(:'mem', :'acme', :'t_p1', true), '|', 2), 'CHARA_FORBIDDEN',
  'an Acme member cannot open submissions');
select is(pg_temp.allow(:'own1', :'acme', :'t_p1', true) || ':' || current_setting('t.result'), 'ok:true',
  'FR-O3 AC8: the owner opens submissions for the shortlisted P1');
select is(private.submissions_allowed_for(:'t', :'p1'), true, 'FR-O3 AC8: P1 may now submit');
select is(pg_temp.allow(:'own1', :'acme', :'t_p1', true) || ':' || current_setting('t.result'), 'ok:false',
  'a second call with the same value changes nothing');
select is(
  pg_temp.audits('response.submissions_allowed', :'t_p1') || ':'
    || (select metadata ->> 'from' || '>' || (metadata ->> 'to') from audit.log
        where action = 'response.submissions_allowed' and entity_id = :'t_p1'),
  '1:false>true', 'FR-O3 AC8: one audit row for the change, none for the repeated call');
select is(pg_temp.told('response_decided', :'t_p1'),
  :'u1' || ':shortlisted,' || :'u1' || ':submissions_allowed,' || :'u1a' || ':shortlisted,' || :'u1a' || ':submissions_allowed',
  'P1''s owners and admins are told that they may submit candidates');
select is(pg_temp.allow(:'own1', :'acme', :'t_p2', true), 'P0001|CHARA_INVALID_STATE|declined',
  'FR-O3 AC8: set_submissions_allowed on the declined response fails with CHARA_INVALID_STATE');
select is(pg_temp.allow(:'own1', :'acme', :'t_s1', false), 'P0001|CHARA_INVALID_STATE|selected',
  'a selected response keeps its submissions open');
select pg_temp.allow(:'own1', :'acme', :'t_p1', false) as t_p1_closed \gset
select is(:'t_p1_closed' || ':' || private.submissions_allowed_for(:'t', :'p1')::text, 'ok:false',
  'the owner can close them again for a shortlisted partner');
select pg_temp.allow(:'own1', :'acme', :'t_p1', true) || pg_temp.dec(:'own1', :'acme', :'t_p1', 'declined') as t_p1_declined \gset
select is(
  :'t_p1_declined' || ':' || (select submissions_allowed::text from public.partner_responses where id = :'t_p1'),
  'okok:false', 'declining a shortlisted partner closes its submissions');

-- AC9: closed and filled requirements ----------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme closed C', 'closed') as c \gset
select pg_temp.seed_resp(:'c', :'p1') as c_p1 \gset
select pg_temp.req(:'acme', 'Acme filled F', 'filled') as f \gset
select pg_temp.seed_resp(:'f', :'p1', 'shortlisted') as f_p1 \gset
select is(pg_temp.dec(:'own1', :'acme', :'c_p1', 'shortlisted'), 'P0001|CHARA_INVALID_STATE|requirement_not_open',
  'FR-O3 AC9: shortlisting on a closed requirement fails');
select is(pg_temp.dec(:'own1', :'acme', :'f_p1', 'selected'), 'P0001|CHARA_INVALID_STATE|requirement_not_open',
  'FR-O3 AC9: selecting on a filled requirement fails');
select is(pg_temp.allow(:'own1', :'acme', :'f_p1', true), 'P0001|CHARA_INVALID_STATE|requirement_not_open',
  'nor are submissions opened on a filled requirement');
select is(
  pg_temp.read_as(:'own1', format('select status from public.get_response(%L, %L)', :'acme', :'f_p1'), 'aal2') || ':'
    || pg_temp.read_as(:'u1', format('select status from public.get_response(%L, %L)', :'p1', :'c_p1')),
  'shortlisted:submitted', 'FR-O3 AC9: the responses stay readable to the employer and the partner');
select pg_temp.req(:'acme', 'Acme paused P', 'paused') as pz \gset
select pg_temp.seed_resp(:'pz', :'p1') as pz_p1 \gset
select is(pg_temp.dec(:'own1', :'acme', :'pz_p1', 'selected'), 'ok', 'FR-O3 open point: a paused requirement still accepts decisions');

-- The comparison -------------------------------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Acme compare K') as k \gset
select pg_temp.seed_resp(:'k', :'p1', 'submitted', 'fee_per_hire') as k_p1 \gset
select pg_temp.seed_resp(:'k', :'s1') as k_s1 \gset
select pg_temp.seed_resp(:'k', :'p3', 'withdrawn') as k_p3 \gset
select is(
  pg_temp.read_as(:'mem', format($$select string_agg(partner_name || ':' || status || ':' || fee_model || ':'
      || coalesce(fee_amount::text, '-') || ':' || array_to_string(served_countries, '+'), ',' order by partner_name)
    from public.compare_responses(%L, %L)$$, :'acme', :'k')),
  'Alpha V47:submitted:fee_per_hire:1500.00:AT+DE,Moves V47:withdrawn:on_request:-:AT+DE,Staffing V47:submitted:on_request:-:AT+DE',
  'FR-O3 AC1: a member compares every response with the same fields, the served countries, and the withdrawn one with its status');
select is(pg_temp.read_as(:'own2', format('select count(*) from public.compare_responses(%L, %L)', :'beta', :'k'), 'aal2'),
  'P0002|CHARA_NOT_FOUND|', 'NFR-S8: Beta cannot compare Acme''s responses');
select is(split_part(pg_temp.read_as(:'wkr', format('select count(*) from public.compare_responses(%L, %L)', :'acme', :'k')), '|', 2),
  'CHARA_FORBIDDEN', 'a candidate cannot compare');
select is(pg_temp.read_as(null, format('select count(*) from public.compare_responses(%L, %L)', :'acme', :'k')),
  '42501|permission denied for function compare_responses|', 'an anonymous caller cannot compare');

select * from finish();
rollback;
