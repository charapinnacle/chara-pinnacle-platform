begin;
select plan(32);

\ir organizations_fixture.inc

-- V57, second part: a hidden requirement or response is out of its owner's hands (CHARA_INVALID_STATE hidden, as a
-- decision on a hidden item) until it is restored, and the partner (V55) and employer (V56) dashboards count visible
-- items only; the partner's list of submissions carries the moderation state. Employers Acme and Delta, recruitment
-- companies Alpha and Beta, candidates Cara and Dan.

\set cow '00000000-0000-0000-0000-000000183001'
\set cmem '00000000-0000-0000-0000-000000183002'
\set dow '00000000-0000-0000-0000-000000183003'
\set aow '00000000-0000-0000-0000-000000183004'
\set aadm '00000000-0000-0000-0000-000000183005'
\set amem '00000000-0000-0000-0000-000000183006'
\set bow '00000000-0000-0000-0000-000000183007'
\set cara '00000000-0000-0000-0000-000000183008'
\set dan '00000000-0000-0000-0000-000000183009'
\set trust '00000000-0000-0000-0000-000000183010'
\set trust_b '00000000-0000-0000-0000-000000183011'
\set padmin '00000000-0000-0000-0000-000000183012'
\set reviewer '00000000-0000-0000-0000-000000183013'
\set trust_delta '00000000-0000-0000-0000-000000183014'

select pg_temp.new_user(u) from unnest(array[:'cow', :'cmem', :'dow', :'aow', :'aadm', :'amem', :'bow', :'trust', :'trust_b',
  :'padmin', :'reviewer', :'trust_delta']::uuid[]) u;
select pg_temp.new_user(u, 'worker') from unnest(array[:'cara', :'dan']::uuid[]) u;
update public.profiles set account_kind = intended_account_kind
where id in (:'cow', :'cmem', :'dow', :'aow', :'aadm', :'amem', :'bow', :'cara', :'dan', :'trust', :'trust_b', :'padmin',
  :'reviewer', :'trust_delta');
insert into public.platform_staff (user_id, role) values
  (:'trust', 'trust_safety'), (:'trust_b', 'trust_safety'), (:'padmin', 'admin'), (:'reviewer', 'verification_reviewer'),
  (:'trust_delta', 'trust_safety');

create temp sequence key_seq;
create function pg_temp.nextkey() returns text language sql as $$ select encode(sha256(('v57b-' || nextval('pg_temp.key_seq'))::bytea), 'hex') $$;

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
    insert into public.organization_geographies (organization_id, scope, country_code) values (v_id, 'serves_market', 'DE');
    insert into public.organization_occupations (organization_id, occupation_id) values (v_id, '7212');
  end if;
  return v_id;
end;
$$;

create function pg_temp.req(p_org uuid, p_title text, p_visibility text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on
  ) values (
    v_id, p_org, p_title, 10, 'DE', 'Hamburg', 'C', date '2027-06-01', 'full_time', 'both', 'both', 'open',
    p_visibility::public.requirement_visibility, false, now() - interval '5 days', date '2027-07-01'
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

create function pg_temp.respond(p_req uuid, p_partner uuid) returns uuid
language sql as $$
  insert into public.partner_responses (requirement_id, organization_id, employer_organization_id, status, capacity,
    available_from, experience_note, fee_model)
  select p_req, p_partner, r.organization_id, 'submitted', 10, date '2027-05-01',
    'Twelve years of placing certified welders in Germany.', 'on_request'
  from public.workforce_requirements r where r.id = p_req
  returning id
$$;

create function pg_temp.submission(p_req uuid, p_partner uuid, p_worker uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.candidate_submissions (id, requirement_id, organization_id, employer_organization_id, invited_email,
    worker_user_id, status, decided_at, worker_approved_at, passport_share_id, profile_snapshot, note)
  select v_id, p_req, p_partner, r.organization_id, p_worker || '@example.test', p_worker, 'submitted', now(),
    now() - interval '2 days', gen_random_uuid(), '{"first_name": "Cara", "last_name": "Lim"}', 'Strong welder, ten years.'
  from public.workforce_requirements r where r.id = p_req;
  return v_id;
end;
$$;

-- submit_report of an item as p_user (anonymous when null): 'ok' with the reference and the duplicate flag in t.ref and
-- t.dup, or 'sqlstate|message|detail'.
create function pg_temp.report(p_user uuid, p_type text, p_id uuid, p_category text default 'misleading_or_fraud') returns text
language sql as $$
  select pg_temp.call_as(
    p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format($f$select set_config('t.ref', r.reference, true), set_config('t.dup', r.is_duplicate::text, true)
         from public.submit_report(p_target_type => %L, p_category => %L,
           p_details => 'The company asked for money before the interview.', p_good_faith => true, p_key => %L,
           p_requirement => %L, p_response => %L, p_submission => %L) r$f$,
      p_type, p_category, pg_temp.nextkey(),
      case when p_type = 'requirement' then p_id end, case when p_type = 'partner_response' then p_id end,
      case when p_type = 'candidate_submission' then p_id end),
    'aal1')
$$;

create function pg_temp.report_id() returns bigint
language sql as $$ select substr(current_setting('t.ref'), 3)::bigint $$;

create function pg_temp.decide(p_user uuid, p_decision text, p_reasons text, p_report bigint default null,
  p_target_type text default null, p_target uuid default null, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(
    p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format($f$select set_config('t.action', coalesce(d.moderation_action_id::text, ''), true),
                     set_config('t.status', coalesce(d.report_status::text, ''), true)
              from public.moderation_decide(%L, %L, %s, %L, %L) d$f$,
           p_decision, p_reasons, coalesce(p_report::text, 'null'), p_target_type, p_target),
    p_aal)
$$;

create function pg_temp.run(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    p_aal)
$$;

create function pg_temp.result() returns jsonb language sql as $$ select current_setting('t.result')::jsonb $$;

create function pg_temp.ids(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v text;
begin
  delete from private.rate_limit_hits;
  v := pg_temp.run(p_user, p_sql, p_aal);
  if v <> 'ok' then return v; end if;
  return (select coalesce(string_agg(e ->> 'id', ',' order by e ->> 'id'), '') from jsonb_array_elements(pg_temp.result()) e);
end;
$$;

create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.reports) || ',' || (select count(*) from audit.log) || ','
      || (select count(*) from public.moderation_actions) || ',' || (select count(*) from pgmq.q_notifications)
$$;

create function pg_temp.queued(p_user uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(private.notification_payload('moderation_decision', q.message) order by q.msg_id), '[]')
  from pgmq.q_notifications q where q.message ->> 'kind' = 'moderation_decision' and q.message ->> 'user_id' = p_user::text
$$;

create function pg_temp.states() returns text
language sql as $$
  select concat_ws('|',
    (select string_agg(r.title || ':' || r.moderation_state, ',' order by r.title) from public.workforce_requirements r
     where r.title like 'V57b %'),
    (select string_agg(o.slug || ':' || p.moderation_state, ',' order by o.slug) from public.partner_responses p
     join public.organizations o on o.id = p.organization_id where o.slug like 'v57b-%'),
    (select string_agg(o.slug || ':' || s.moderation_state, ',' order by o.slug, s.status) from public.candidate_submissions s
     join public.organizations o on o.id = s.organization_id where o.slug like 'v57b-%'))
$$;

select pg_temp.new_org(:'cow', 'employer', 'v57b-acme') as acme \gset
select pg_temp.new_org(:'dow', 'employer', 'v57b-delta') as delta \gset
select pg_temp.new_org(:'aow', 'recruitment_company', 'v57b-alpha') as alpha \gset
select pg_temp.new_org(:'bow', 'recruitment_company', 'v57b-beta') as beta \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  (:'acme', :'cmem', 'member', now()), (:'alpha', :'aadm', 'admin', now()), (:'alpha', :'amem', 'member', now()),
  (:'delta', :'trust_delta', 'member', now());

select pg_temp.req(:'acme', 'V57b Acme welders Hamburg', 'job_order_marketplace') as m1 \gset
select pg_temp.req(:'acme', 'V57b Acme private fitters', 'private') as p1 \gset
select pg_temp.req(:'delta', 'V57b Delta welders Bremen', 'job_order_marketplace') as d1 \gset
insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, status, source)
values (:'p1', :'alpha', :'acme', 'invited', 'directory');
select pg_temp.respond(:'m1', :'alpha') as resp_a \gset
select pg_temp.respond(:'m1', :'beta') as resp_b \gset
select pg_temp.respond(:'d1', :'alpha') as resp_ad \gset
select pg_temp.submission(:'m1', :'alpha', :'cara') as sub_a \gset
select pg_temp.submission(:'d1', :'beta', :'dan') as sub_b \gset

update private.settings set value = 'true'
where key in ('release_partner_directories', 'release_job_orders', 'release_candidate_submissions');
update private.settings set value = '100000' where key = 'rate_limit_job_orders_max';
delete from pgmq.q_notifications;


-- Who acts as whom, and the figures read.
create function pg_temp.as_cow(p_sql text) returns text language sql as $$ select pg_temp.call_as(current_setting('t.cow')::uuid, 'authenticated', p_sql) $$;
create function pg_temp.as_aow(p_sql text) returns text language sql as $$ select pg_temp.call_as(current_setting('t.aow')::uuid, 'authenticated', p_sql) $$;
select set_config('t.cow', :'cow', false), set_config('t.aow', :'aow', false);
create function pg_temp.stamp(p_req uuid) returns text language sql as $$ select updated_at::text from public.workforce_requirements where id = p_req $$;
create function pg_temp.pdash() returns jsonb language plpgsql as $$
begin
  delete from private.rate_limit_hits;
  perform pg_temp.run(current_setting('t.aow')::uuid, format('select * from public.get_partner_dashboard(%L)', current_setting('t.alpha')), 'aal1');
  return pg_temp.result() -> 0;
end;
$$;
create function pg_temp.edash() returns jsonb language plpgsql as $$
begin
  perform pg_temp.run(current_setting('t.cow')::uuid, format('select * from public.get_employer_network_dashboard(%L)', current_setting('t.acme')));
  return pg_temp.result() -> 0;
end;
$$;
select set_config('t.alpha', :'alpha', false), set_config('t.acme', :'acme', false);

insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
  start_date, employment_type, recruitment_preference, partner_need, status)
values (gen_random_uuid(), :'acme', 'V57b Acme draft', 10, 'DE', 'Hamburg', 'C', date '2027-06-01', 'full_time', 'both', 'both', 'draft')
returning id as draft \gset
insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (:'draft', '7212', 10);
select gen_random_uuid() as doc \gset
insert into public.partner_response_documents (id, organization_id, requirement_id, employer_organization_id, response_id, storage_path,
  file_name, size_bytes, scan_status, scanned_at)
values (:'doc', :'alpha', :'m1', :'acme', :'resp_a', :'alpha' || '/' || :'doc' || '/' || gen_random_uuid(), 'licence.pdf', 1000, 'clean', now());
update public.candidate_submissions set status = 'submitted' where id = :'sub_a';

-- The figures before any decision.
select pg_temp.pdash() as pd0 \gset
select pg_temp.edash() as ed0 \gset

select private.set_item_moderation('requirement', :'m1', true, 'Discriminatory wording in the job order.', null, false) as act_m1 \gset
select private.set_item_moderation('requirement', :'draft', true, 'Discriminatory wording in the draft.', null, false) as act_draft \gset
select private.set_item_moderation('partner_response', :'resp_a', true, 'The response claims licences it does not hold.', null, false) as act_resp \gset
select private.set_item_moderation('candidate_submission', :'sub_a', true, 'The note asks the candidate for a fee.', null, false) as act_sub \gset
select pg_temp.writes() as w0 \gset

-- A hidden requirement is out of its employer's hands ----------------------------------------------------------------------
select is(pg_temp.as_cow(format('select public.set_requirement_status(%L, %L, ''paused'', %L)', :'acme', :'m1', pg_temp.stamp(:'m1'))),
  'P0001|CHARA_INVALID_STATE|hidden', 'a hidden requirement is not paused');
select is(pg_temp.as_cow(format('select public.set_requirement_status(%L, %L, ''closed'', %L, ''cancelled'')', :'acme', :'m1', pg_temp.stamp(:'m1'))),
  'P0001|CHARA_INVALID_STATE|hidden', 'nor closed');
select is(pg_temp.as_cow(format('select public.set_requirement_status(%L, %L, ''filled'', %L, ''filled'')', :'acme', :'m1', pg_temp.stamp(:'m1'))),
  'P0001|CHARA_INVALID_STATE|hidden', 'nor filled');
select is(pg_temp.as_cow(format('select public.extend_requirement(%L, %L, %L)', :'acme', :'m1', pg_temp.stamp(:'m1'))),
  'P0001|CHARA_INVALID_STATE|hidden', 'nor extended');
select is(pg_temp.as_cow(format('select public.set_requirement_capacity_tolerance(%L, %L, 10)', :'acme', :'m1')),
  'P0001|CHARA_INVALID_STATE|hidden', 'nor its capacity tolerance set');
select is(pg_temp.as_cow(format('select public.create_vacancies_from_requirement(%L, %L, %L, 0)', :'acme', :'m1', pg_temp.stamp(:'m1'))),
  'P0001|CHARA_INVALID_STATE|hidden', 'nor copied to vacancies');
select is(pg_temp.as_cow(format(
  $f$select public.save_requirement(p_org => %L, p_requirement => %L, p_workers_needed => 10, p_country_code => 'DE',
       p_city_region => 'Hamburg', p_industry_code => 'C', p_occupations => '[{"occupation_id": "7212", "quantity": 10}]',
       p_start_date => date '2027-06-01', p_employment_type => 'full_time', p_recruitment_preference => 'both',
       p_partner_need => 'both', p_accommodation => false, p_work_permit_support => false, p_visa_support => false,
       p_title => 'Reworded welders', p_expected_updated_at => %L)$f$, :'acme', :'m1', pg_temp.stamp(:'m1'))),
  'P0001|CHARA_INVALID_STATE|hidden', 'nor edited');
select is(pg_temp.as_cow(format('select public.publish_requirement(%L, %L, ''private'', false, %L)', :'acme', :'draft', pg_temp.stamp(:'draft'))),
  'P0001|CHARA_INVALID_STATE|hidden', 'a hidden draft is not published');

-- A hidden response is out of its partner's hands --------------------------------------------------------------------------
select is(pg_temp.as_aow(format(
  $f$select public.update_response(%L, %L, 12, date '2027-05-01', 'Fifteen years of placing certified welders in Germany.', 'on_request', p_expected_version => 1)$f$,
  :'alpha', :'resp_a')), 'P0001|CHARA_INVALID_STATE|hidden', 'a hidden response is not changed');
select is(pg_temp.as_aow(format('select public.withdraw_response(%L, %L, ''No longer available.'')', :'alpha', :'resp_a')),
  'P0001|CHARA_INVALID_STATE|hidden', 'nor withdrawn');
select is(pg_temp.as_aow(format('select public.register_response_document(%L, %L, ''permit.pdf'', ''application/pdf'', 1000)', :'alpha', :'m1')),
  'P0001|CHARA_INVALID_STATE|hidden', 'nor given a document');
select is(pg_temp.as_aow(format('select public.remove_response_document(%L, %L)', :'alpha', :'doc')),
  'P0001|CHARA_INVALID_STATE|hidden', 'nor relieved of one');
select is(pg_temp.writes(), :'w0', 'the refused calls write nothing');
select is(
  (select format('%s|%s', r.status, p.status) from public.workforce_requirements r, public.partner_responses p
   where r.id = :'m1' and p.id = :'resp_a'),
  'open|submitted', 'the requirement and the response are unchanged');
select is(pg_temp.as_cow(format('select public.set_requirement_status(%L, %L, ''paused'', %L)', :'acme', :'p1', pg_temp.stamp(:'p1'))),
  'ok', 'a visible requirement of the same employer is paused as before');
select is(pg_temp.as_aow(format('select public.withdraw_response(%L, %L, ''No longer available.'')', :'alpha', :'resp_ad')),
  'ok', 'a visible response of the same partner is withdrawn as before');

-- The dashboards count visible items only ------------------------------------------------------------------------------------
select pg_temp.pdash() as pd1 \gset
select is((:'pd0'::jsonb ->> 'fitting_job_orders')::integer - (:'pd1'::jsonb ->> 'fitting_job_orders')::integer, 2,
  'V55: the hidden job order leaves the partner''s fitting job orders, as the paused invitation does');
select is(
  format('%s|%s', :'pd0'::jsonb ->> 'responses_open', :'pd1'::jsonb ->> 'responses_open'), '2|0',
  'V55: the hidden response and the withdrawn one leave the open responses');
select is((:'pd1'::jsonb -> 'submission_stages' ->> 'submitted')::integer, (:'pd0'::jsonb -> 'submission_stages' ->> 'submitted')::integer - 1,
  'V55: the hidden submission leaves the stages');
select is(pg_temp.run(:'aow', format('select * from public.list_partner_submission_outcomes(%L)', :'alpha'), 'aal1'), 'ok', 'the outcomes are read');
select is(jsonb_array_length(pg_temp.result()), 0, 'V55: the hidden submission is in no outcome');
select pg_temp.edash() as ed1 \gset
select is(
  format('%s>%s', :'ed0'::jsonb ->> 'open_requirements', :'ed1'::jsonb ->> 'open_requirements'), '2>0',
  'V56: the hidden requirement and the paused one leave the open requirements');
select is(format('%s>%s', :'ed0'::jsonb ->> 'draft_requirements', :'ed1'::jsonb ->> 'draft_requirements'), '1>0',
  'V56: the hidden draft is not counted');
select ok(
  not exists (select 1 from jsonb_array_elements(:'ed1'::jsonb -> 'requirements') e where e ->> 'id' = :'m1'),
  'V56: nor listed');
select is(format('%s>%s', :'ed0'::jsonb ->> 'responses_waiting', :'ed1'::jsonb ->> 'responses_waiting'), '2>0',
  'V56: the responses to the hidden requirement leave the responses waiting');
select is((:'ed1'::jsonb -> 'submission_stages' ->> 'submitted')::integer, 0, 'V56: the hidden submission leaves the stages');

-- The partner's list of submissions carries the badge -------------------------------------------------------------------------
select is(pg_temp.run(:'aow', format('select * from public.list_partner_submissions(%L)', :'alpha'), 'aal1'), 'ok', 'the partner lists its submissions');
select is(
  (select format('%s|%s', e ->> 'moderation_state', e ->> 'moderation_action_id') from jsonb_array_elements(pg_temp.result()) e
   where e ->> 'id' = :'sub_a'),
  format('hidden|%s', :act_sub), 'the hidden submission carries its state and the decision an appeal names');

-- Restored, the items are the owner's again --------------------------------------------------------------------------------
select ok(private.set_item_moderation('requirement', :'m1', false, 'Restored after the wording was explained.', null, false) > 0, 'the requirement is shown again');
select ok(private.set_item_moderation('partner_response', :'resp_a', false, 'Restored after the licences were shown.', null, false) > 0, 'and the response');
select is(pg_temp.as_cow(format('select public.extend_requirement(%L, %L, %L)', :'acme', :'m1', pg_temp.stamp(:'m1'))), 'ok',
  'the employer extends the requirement again');
select is(pg_temp.as_aow(format('select public.withdraw_response(%L, %L, ''No longer available.'')', :'alpha', :'resp_a')), 'ok',
  'the partner withdraws the response again');

select * from finish();
rollback;
