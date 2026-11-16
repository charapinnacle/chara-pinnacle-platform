begin;
select plan(37);

\ir apply_fixture.inc

-- An outdated employer-pays commitment blocks responses and submissions (V52, FR-S4 AC7, FR-J3 AC3 and the data of AC4;
-- SOP P2-44 step Re-consent, P2-03 step Re-accept; NFR-C6, NFR-S8): after a new version of employer-pays-commitment,
-- respond_to_invitation, update_response and submit_candidate refuse every member of a partner whose owner accepted only
-- the earlier version with CHARA_CONSENT_REQUIRED employer-pays-commitment (DATA_MODEL.md section 2) and write nothing;
-- an admin's or a member's acceptance never counts and is refused; the owner's acceptance of the new version opens both
-- again, for that partner only. Acme (t.a: owner own1) and Beta (t.b) are employers of the fixture, wa and wb candidates;
-- the partners P and Q are made below.

\set pown '00000000-0000-0000-0000-0000000f5201'
\set padm '00000000-0000-0000-0000-0000000f5202'
\set pmem '00000000-0000-0000-0000-0000000f5203'
\set qown '00000000-0000-0000-0000-0000000f5204'

update private.settings set value = 'true'
where key in ('release_partner_directories', 'release_job_orders', 'release_candidate_submissions');
update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key = 'rate_limit_job_orders_max';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max');
delete from public.direct_hiring_rules;
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (:'acme', 'employer_starter', 'active', 'null'), (:'beta', 'employer_starter', 'active', 'null');

-- A listed partner serving Germany, sourcing from the Philippines and listing 7212 on recruitment_partner, owned by
-- p_owner, who accepted the current version of the commitment.
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
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  values (v_id, 'recruitment_partner', 'active', 'null');
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

-- An open job order of p_org on the marketplace.
create function pg_temp.req(p_org uuid, p_title text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, duration_months,
    employment_type, recruitment_preference, partner_need, status, visibility, published_at, closes_on
  ) values (
    v_id, p_org, p_title, 10, 'DE', 'Hamburg', 'C', current_date + 60, 12, 'full_time', 'both', 'both', 'open',
    'job_order_marketplace', now() - interval '10 days', current_date + 90
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

-- A response of p_partner to p_req written as the database owner in p_status, with submissions allowed when selected.
create function pg_temp.seed_response(p_req uuid, p_partner uuid, p_status text) returns uuid
language sql as $$
  insert into public.partner_responses (
    requirement_id, organization_id, employer_organization_id, status, capacity, available_from, experience_note, fee_model,
    decided_at, submissions_allowed
  )
  select p_req, p_partner, r.organization_id, p_status::public.response_status, 5, current_date + 30,
    'Twenty welders placed in Hamburg last year.', 'on_request', case when p_status = 'selected' then now() end,
    p_status = 'selected'
  from public.workforce_requirements r where r.id = p_req
  returning id
$$;

create function pg_temp.respond(p_user uuid, p_org uuid, p_req uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select public.respond_to_invitation(%L, %L, 5, current_date + 30, 'Twenty welders placed in Hamburg last year.',
      'fee_per_hire', 1500, 'EUR')$f$, p_org, p_req), 'aal1')
$$;

create function pg_temp.edit(p_user uuid, p_org uuid, p_response uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select public.update_response(%L, %L, 6, current_date + 30, 'Twenty welders placed in Hamburg last year.',
      'on_request')$f$, p_org, p_response), 'aal1')
$$;

create function pg_temp.sub(p_user uuid, p_org uuid, p_req uuid, p_email text) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format('select * from public.submit_candidate(%L, %L, %L)', p_org, p_req, p_email), 'aal1')
$$;

create function pg_temp.accept(p_user uuid, p_org uuid, p_version integer) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select public.accept_employer_pays_commitment(%L, %L)', p_org, p_version), 'aal1')
$$;

-- partner_commitment_status as p_user: 'accepted|accepted_version'.
create function pg_temp.status(p_user uuid, p_org uuid) returns text
language sql as $$
  select pg_temp.val_as(p_user, 'aal1', format(
    $f$select s ->> 'accepted' || '|' || coalesce(s ->> 'accepted_version', '') from public.partner_commitment_status(%L) s$f$,
    p_org))
$$;

-- The next version of the commitment, published a second ago so that it is current within this transaction.
create function pg_temp.publish(p_draft boolean) returns integer
language sql as $$
  insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
  select 'employer-pays-commitment', max(d.version) + 1, 'Employer-pays commitment', 'We charge workers nothing.',
    'Fees for travel are named.', now() - interval '1 second', p_draft
  from public.legal_documents d where d.slug = 'employer-pays-commitment'
  returning version
$$;

-- What P wrote: responses, response versions, submissions.
create function pg_temp.written(p_org uuid) returns text
language sql as $$
  select (select count(*) from public.partner_responses where organization_id = p_org) || '|'
    || (select count(*) from public.partner_response_versions where organization_id = p_org) || '|'
    || (select count(*) from public.candidate_submissions where organization_id = p_org)
$$;

select pg_temp.partner('reconsent-p-v52', :'pown') as p \gset
select pg_temp.member(:'p', :'padm', 'admin') as seeded \gset
select pg_temp.member(:'p', :'pmem', 'member') as seeded \gset
select pg_temp.partner('reconsent-q-v52', :'qown') as q \gset
select pg_temp.req(:'acme', 'Reconsent R1') as r1 \gset
select pg_temp.req(:'acme', 'Reconsent R2') as r2 \gset
select pg_temp.req(:'beta', 'Reconsent QR') as qr \gset
select pg_temp.req(:'acme', 'Reconsent S') as s \gset
select pg_temp.req(:'acme', 'Reconsent E') as e \gset
select pg_temp.req(:'acme', 'Reconsent E2') as e2 \gset
select pg_temp.seed_response(:'s', :'p', 'selected') as ps \gset
select pg_temp.seed_response(:'e', :'p', 'submitted') as pe \gset
select pg_temp.seed_response(:'s', :'q', 'selected') as qs \gset
select private.current_legal_version('employer-pays-commitment') as v1 \gset

-- Before the new version -------------------------------------------------------------------------------------------------

select is(private.partner_commitment_current(:'p') and private.partner_commitment_current(:'q'), true,
  'P and Q hold an acceptance of the current version by their owners');
select is(pg_temp.status(:'pmem', :'p'), 'true|' || :'v1', 'a member of P reads the commitment as accepted');

-- A new version ----------------------------------------------------------------------------------------------------------

select pg_temp.publish(false) as v2 \gset
select is(private.partner_commitment_current(:'p'), false, 'FR-S4 AC7: the new version makes P''s acceptance outdated');
select is(pg_temp.status(:'padm', :'p'), 'false|' || :'v1',
  'FR-J3 AC4 data: an admin of P reads the commitment as outdated (an earlier version accepted)');
select is(pg_temp.status(:'pmem', :'p'), 'false|' || :'v1', 'and so does a member');
select pg_temp.written(:'p') as before \gset

select is(pg_temp.respond(:'padm', :'p', :'r1'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'FR-S4 AC7, FR-J3 AC3: an admin''s response is refused (detail as DATA_MODEL.md section 2)');
select is(pg_temp.respond(:'pmem', :'p', :'r1'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'a member''s response is refused');
select is(pg_temp.respond(:'pown', :'p', :'r1'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'the owner''s own response is refused until the owner accepts');
select is(pg_temp.sub(:'padm', :'p', :'s', 'first-v52@nobody.test'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'FR-S4 AC7, FR-J3 AC3: an admin''s candidate submission is refused');
select is(pg_temp.sub(:'pmem', :'p', :'s', 'first-v52@nobody.test'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'a member''s candidate submission is refused');
select is(pg_temp.edit(:'padm', :'p', :'pe'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'V52: the edit of a live response, a new version of the offer, is refused too');
select is(pg_temp.written(:'p'), :'before', 'the refused calls wrote no response, response version or submission');
select is((select version from public.partner_responses where id = :'pe'), 1, 'the live response keeps its version');
select is(
  pg_temp.val_as(:'pmem', 'aal1', format(
    'select e.refusal || ''|'' || e.detail || ''|'' || e.can_respond from public.get_response_eligibility(%L, %L) e', :'p', :'r2')),
  'CHARA_CONSENT_REQUIRED|employer-pays-commitment|false',
  'FR-J3 AC4 data: the eligibility panel names the commitment as what stops the partner');
select is(
  pg_temp.call_as(:'pmem', 'authenticated', format('select count(*) from public.list_job_orders(%L)', :'p'), 'aal1'), 'ok',
  'FR-J3 AC3: browsing job orders stays possible');
select is(
  pg_temp.call_as(:'padm', 'authenticated', format('select public.withdraw_response(%L, %L)', :'p', :'pe'), 'aal1'), 'ok',
  'withdrawing a response stays possible');
select pg_temp.seed_response(:'e2', :'p', 'submitted') as pe \gset

-- Who may accept ---------------------------------------------------------------------------------------------------------

select is(pg_temp.accept(:'padm', :'p', :'v2'), 'P0001|CHARA_FORBIDDEN|',
  'FR-S4 AC7, FR-J3 AC2: the admin cannot accept the new version for the organisation');
select is(pg_temp.accept(:'pmem', :'p', :'v2'), 'P0001|CHARA_FORBIDDEN|', 'nor can a member');
select is(pg_temp.accept(:'qown', :'p', :'v2'), 'P0001|CHARA_FORBIDDEN|', 'NFR-S8: nor the owner of another partner');
select is(pg_temp.accept(:'own1', :'p', :'v2'), 'P0001|CHARA_FORBIDDEN|', 'NFR-S8: nor an employer''s owner');
select is(pg_temp.accept(:'wa', :'p', :'v2'), 'P0001|CHARA_FORBIDDEN|', 'NFR-S8: nor a candidate');
select is(pg_temp.accept(null, :'p', :'v2'), '42501|permission denied for function accept_employer_pays_commitment|',
  'NFR-S8: nor anonymous');
select is(pg_temp.accept(:'pown', :'p', :'v1'), 'P0001|CHARA_INVALID_INPUT|version',
  'the owner cannot accept the earlier version again');
select is((select count(*)::integer from public.consents where purpose = 'employer-pays-commitment' and version = :'v2'), 0,
  'the refused acceptances wrote no consents row');
select is(pg_temp.sub(:'padm', :'p', :'s', 'first-v52@nobody.test'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'FR-S4 AC7: after the admin''s attempt P is still blocked');

-- The owner accepts ------------------------------------------------------------------------------------------------------

select is(pg_temp.accept(:'pown', :'p', :'v2'), 'ok', 'FR-S4 AC7, FR-J3 AC3: the owner accepts the new version');
select is(
  (select string_agg(user_id || ':' || version, ',') from public.consents
   where purpose = 'employer-pays-commitment' and version = :'v2'),
  :'pown' || ':' || :'v2', 'one consents row of the owner with the new version');
select is(pg_temp.status(:'pmem', :'p'), 'true|' || :'v2', 'a member reads the commitment as accepted again');
select is(pg_temp.respond(:'padm', :'p', :'r1'), 'ok', 'FR-S4 AC7, FR-J3 AC3: after the owner''s acceptance the admin responds');
select is(pg_temp.sub(:'padm', :'p', :'s', 'first-v52@nobody.test'), 'ok', 'and submits a candidate');
select is(pg_temp.edit(:'pmem', :'p', :'pe'), 'ok', 'and a member changes a live response');

-- Another partner --------------------------------------------------------------------------------------------------------

select is(private.partner_commitment_current(:'q'), false, 'NFR-S8: P''s owner''s acceptance does nothing for Q');
select is(pg_temp.sub(:'qown', :'q', :'s', 'q-v52@nobody.test'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'Q is still refused a submission');
select is(pg_temp.respond(:'qown', :'q', :'qr'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'and a response to another employer''s job order');
select is(pg_temp.call_as(:'padm', 'authenticated', format('select public.partner_commitment_status(%L)', :'q'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|', 'NFR-S8: a member of P cannot read Q''s commitment state');

-- A draft version ---------------------------------------------------------------------------------------------------------

select pg_temp.publish(true) as v3 \gset
select is(pg_temp.respond(:'padm', :'p', :'r2'), 'P0001|CHARA_CONSENT_REQUIRED|employer-pays-commitment',
  'a version published as a draft asks again too: it is the current version until counsel''s text replaces it');
select is(pg_temp.accept(:'pown', :'p', :'v3'), 'ok', 'and the owner accepts it like any version');

select * from finish();
rollback;
