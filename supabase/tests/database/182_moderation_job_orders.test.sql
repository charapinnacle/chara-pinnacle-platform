begin;
select plan(109);

\ir organizations_fixture.inc

-- V57: moderation of the job order network (FR-S1 release 2b parts AC1, AC2, AC4, AC5, AC7, AC8, AC9, AC12; FR-J3 AC7 and
-- AC8 from a submission; NFR-C7; NFR-S8 with two employers, two partners, two candidates and anonymous): the report
-- targets requirement, partner_response and candidate_submission, moderation_decide on them, what hiding does, the
-- moderation_decision notice, appeals, item_moderation and the suspension cascade of suspend_organization and
-- reinstate_organization to requirements, responses and submissions.
-- Employers Acme and Delta publish requirements; recruitment companies Alpha and Beta respond and submit; the candidates
-- Cara and Dan are asked for their approval.

\set cow '00000000-0000-0000-0000-000000182001'
\set cmem '00000000-0000-0000-0000-000000182002'
\set dow '00000000-0000-0000-0000-000000182003'
\set aow '00000000-0000-0000-0000-000000182004'
\set aadm '00000000-0000-0000-0000-000000182005'
\set amem '00000000-0000-0000-0000-000000182006'
\set bow '00000000-0000-0000-0000-000000182007'
\set cara '00000000-0000-0000-0000-000000182008'
\set dan '00000000-0000-0000-0000-000000182009'
\set trust '00000000-0000-0000-0000-000000182010'
\set trust_b '00000000-0000-0000-0000-000000182011'
\set padmin '00000000-0000-0000-0000-000000182012'
\set reviewer '00000000-0000-0000-0000-000000182013'
\set trust_delta '00000000-0000-0000-0000-000000182014'

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
create function pg_temp.nextkey() returns text language sql as $$ select encode(sha256(('v57-' || nextval('pg_temp.key_seq'))::bytea), 'hex') $$;

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
     where r.title like 'V57 %'),
    (select string_agg(o.slug || ':' || p.moderation_state, ',' order by o.slug) from public.partner_responses p
     join public.organizations o on o.id = p.organization_id where o.slug like 'v57-%'),
    (select string_agg(o.slug || ':' || s.moderation_state, ',' order by o.slug, s.status) from public.candidate_submissions s
     join public.organizations o on o.id = s.organization_id where o.slug like 'v57-%'))
$$;

select pg_temp.new_org(:'cow', 'employer', 'v57-acme') as acme \gset
select pg_temp.new_org(:'dow', 'employer', 'v57-delta') as delta \gset
select pg_temp.new_org(:'aow', 'recruitment_company', 'v57-alpha') as alpha \gset
select pg_temp.new_org(:'bow', 'recruitment_company', 'v57-beta') as beta \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  (:'acme', :'cmem', 'member', now()), (:'alpha', :'aadm', 'admin', now()), (:'alpha', :'amem', 'member', now()),
  (:'delta', :'trust_delta', 'member', now());

select pg_temp.req(:'acme', 'V57 Acme welders Hamburg', 'job_order_marketplace') as m1 \gset
select pg_temp.req(:'acme', 'V57 Acme private fitters', 'private') as p1 \gset
select pg_temp.req(:'delta', 'V57 Delta welders Bremen', 'job_order_marketplace') as d1 \gset
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

-- Structure ----------------------------------------------------------------------------------------------------------------
select ok(
  (select enum_range(null::public.report_target_type)::text[] @> array['requirement', 'partner_response', 'candidate_submission']),
  'the report targets requirement, partner_response and candidate_submission exist'
);
select ok(
  (select bool_and(has_column_privilege('authenticated', t, 'moderation_state', 'select')
                   and not has_column_privilege('authenticated', t, 'moderation_state', 'update')
                   and not has_column_privilege('anon', t, 'moderation_state', 'select'))
   from unnest(array['public.workforce_requirements', 'public.partner_responses', 'public.candidate_submissions']) t),
  'AC5: members read moderation_state of requirements, responses and submissions; nobody may write it'
);
select ok(
  has_function_privilege('authenticated', 'public.item_moderation(uuid, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.item_moderation(uuid, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.set_item_moderation(text, uuid, boolean, text, bigint, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'private.moderated_item(text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.cascade_item_suspension(uuid, boolean, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.reportable_item(text, uuid, uuid)', 'execute'),
  'item_moderation is for signed-in callers; the private helpers are executable by nobody'
);
select throws_ok(
  format($$insert into public.reports (target_type, requirement_id, organization_id, category, details, good_faith_confirmed, reporter_user_id)
           values ('requirement', %L, %L, 'other', 'Twenty characters at least.', true, %L)$$, :'m1', :'acme', :'aow'),
  '23514', null, 'reports_target_check: a requirement report holds the requirement id and nothing else'
);
select throws_ok(
  format($$insert into public.reports (target_type, partner_response_id, category, details, good_faith_confirmed)
           values ('partner_response', %L, 'other', 'Twenty characters at least.', true)$$, :'resp_a'),
  '23514', null, 'reports_target_check: only a signed-in participant reports an item'
);

-- AC1, AC2: who may report what ---------------------------------------------------------------------------------------------
select is(pg_temp.report(:'amem', 'requirement', :'m1'), 'ok', 'AC1: a member of a listed partner reports a job order it sees');
select is(
  (select format('%s|%s|%s|%s|%s', target_type, requirement_id, coalesce(organization_id::text, '-'),
     coalesce(partner_response_id::text, '-'), status) from public.reports where id = pg_temp.report_id()),
  format('requirement|%s|-|-|new', :'m1'), 'AC1: the report holds the requirement id only, status new'
);
select ok(current_setting('t.ref') ~ '^R-\d{6,}$' and current_setting('t.dup') = 'false', 'AC1: the reference is R- and six digits');
select current_setting('t.ref') as ref_m1 \gset
select is(pg_temp.report(:'amem', 'requirement', :'m1') || ':' || current_setting('t.ref') || ':' || current_setting('t.dup'),
  'ok:' || :'ref_m1' || ':true', 'AC1: the same report within 24 hours answers the first reference, nothing stored');
select is(pg_temp.report(:'aadm', 'requirement', :'p1'), 'ok', 'a partner reports a private requirement it was invited to');
select pg_temp.writes() as w0 \gset
select is(pg_temp.report(:'bow', 'requirement', :'p1'), 'P0002|CHARA_NOT_FOUND|', 'AC2: a partner not invited cannot report a private requirement');
select is(pg_temp.report(:'cmem', 'requirement', :'m1'), 'P0002|CHARA_NOT_FOUND|', 'the employer does not report its own requirement');
select is(pg_temp.report(:'dow', 'requirement', :'p1'), 'P0002|CHARA_NOT_FOUND|', 'AC2: another employer cannot report Acme''s private requirement');
select is(pg_temp.report(:'cara', 'requirement', :'m1'), 'P0002|CHARA_NOT_FOUND|', 'a candidate does not report a job order');
select is(pg_temp.report(:'amem', 'requirement', gen_random_uuid()), 'P0002|CHARA_NOT_FOUND|', 'AC2: an unknown requirement gives the same answer');
select is(pg_temp.report(null, 'requirement', :'m1'), 'P0001|CHARA_FORBIDDEN|sign_in_required', 'AC1: a visitor cannot report a requirement');
select is(pg_temp.report(null, 'partner_response', :'resp_a'), 'P0001|CHARA_FORBIDDEN|sign_in_required', 'AC1: nor a response');
select is(pg_temp.report(null, 'candidate_submission', :'sub_a'), 'P0001|CHARA_FORBIDDEN|sign_in_required', 'AC1: nor a submission');
select is(pg_temp.report(:'dow', 'partner_response', :'resp_a'), 'P0002|CHARA_NOT_FOUND|', 'AC2: another employer cannot report Alpha''s response');
select is(pg_temp.report(:'aow', 'partner_response', :'resp_a'), 'P0002|CHARA_NOT_FOUND|', 'the partner does not report its own response');
select is(pg_temp.report(:'bow', 'partner_response', :'resp_a'), 'P0002|CHARA_NOT_FOUND|', 'a competing partner cannot report it');
select is(pg_temp.report(:'dan', 'candidate_submission', :'sub_a'), 'P0002|CHARA_NOT_FOUND|', 'another candidate cannot report Cara''s submission');
select is(pg_temp.report(:'amem', 'candidate_submission', :'sub_a'), 'P0002|CHARA_NOT_FOUND|', 'the partner cannot report its own submission');
select is(pg_temp.report(:'cow', 'candidate_submission', gen_random_uuid()), 'P0002|CHARA_NOT_FOUND|', 'AC2: an unknown submission gives the same answer');
select is(pg_temp.writes(), :'w0', 'AC2: no report, audit or notification row is written for a refused report');

select is(pg_temp.report(:'cmem', 'partner_response', :'resp_a'), 'ok', 'AC1: a member of the employer reports a response it received');
select pg_temp.report_id() as rep_resp \gset
select is(pg_temp.report(:'cara', 'candidate_submission', :'sub_a', 'fee_demanded_from_worker'), 'ok',
  'FR-J3 AC7, AC8: the candidate reports a fee demand from the submission');
select pg_temp.report_id() as rep_sub \gset
select is((select priority from public.reports where id = :rep_sub), 1::smallint, 'FR-J3 AC7: the fee demand from a submission comes first');
select is(
  (select metadata - 'request_id' from audit.log where action = 'report.submitted' and entity_id = :rep_sub::text),
  jsonb_build_object('target_type', 'candidate_submission', 'category', 'fee_demanded_from_worker', 'candidate_submission_id', :'sub_a'),
  'the audit row names the submission, never the candidate or the text'
);

update private.settings set value = 'false' where key = 'release_candidate_submissions';
select is(pg_temp.report(:'dan', 'candidate_submission', :'sub_b'), 'P0002|CHARA_NOT_FOUND|', 'a submission is not reported while its release is off');
update private.settings set value = 'true' where key = 'release_candidate_submissions';
update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.report(:'cmem', 'partner_response', :'resp_b'), 'P0002|CHARA_NOT_FOUND|', 'nor a response while release 2b is off');
update private.settings set value = 'true' where key = 'release_job_orders';

-- The queue and the report in context ---------------------------------------------------------------------------------------
select is(pg_temp.run(:'trust', 'select * from public.admin_list_reports()'), 'ok', 'Trust & Safety reads the queue');
select is(
  (select e ->> 'target_label' from jsonb_array_elements(pg_temp.result()) e where (e ->> 'id')::bigint = :rep_sub),
  'V57 Alpha', 'the queue names a submission by its partner, never the candidate'
);
select is(
  (select e ->> 'target_label' from jsonb_array_elements(pg_temp.result()) e where e ->> 'reference' = :'ref_m1'),
  'V57 Acme welders Hamburg', 'and a requirement by its own title'
);
select is(pg_temp.run(:'padmin', 'select * from public.admin_get_report(' || :rep_resp || ')'), 'ok', 'AC5: the Platform Administrator reads a report');
select is(
  (select format('%s|%s|%s|%s', r ->> 'organization_name', r ->> 'item_id', r ->> 'item_moderation_state', r -> 'item_context' ->> 'experience_note')
   from (select pg_temp.result() -> 0 as r) x),
  format('V57 Alpha|%s|visible|Twelve years of placing certified welders in Germany.', :'resp_a'),
  'Review: a response report shows the partner and the proposal in context'
);
select is(pg_temp.run(:'trust', 'select * from public.admin_get_report(' || :rep_sub || ')'), 'ok', 'a submission report is read');
select ok(
  (select not (r -> 'item_context' ?| array['invited_email', 'worker_user_id', 'profile_snapshot'])
     and (r -> 'item_context' ->> 'note') = 'Strong welder, ten years.' and (r ->> 'organization_name') = 'V57 Alpha'
   from (select pg_temp.result() -> 0 as r) x),
  'FR-F3: a submission report never shows the candidate''s address, account or profile'
);
select is(pg_temp.run(:'cara', 'select * from public.list_my_reports()', 'aal1'), 'ok', 'the candidate reads her own reports');
select is(pg_temp.result() -> 0 ->> 'target_label', 'V57 Alpha', 'labelled by the partner it is about');
select is(pg_temp.run(:'amem', 'select * from public.list_my_reports()', 'aal1'), 'ok', 'the partner member reads its reports');
select ok(
  not exists (select 1 from jsonb_array_elements(pg_temp.result()) e where e ->> 'target_label' like '%Acme%'),
  'NFR-S11: a requirement report is labelled with the generated title, never the employer the partner was not told'
);

-- AC4, AC5: deciding --------------------------------------------------------------------------------------------------------
select pg_temp.writes() as w1 \gset
select is(pg_temp.decide(:'padmin', 'hide', 'Misleading claims in the response.', :rep_resp), 'P0001|CHARA_FORBIDDEN|', 'AC5: the Platform Administrator may not decide');
select is(pg_temp.decide(:'reviewer', 'hide', 'Misleading claims in the response.', :rep_resp), 'P0001|CHARA_FORBIDDEN|', 'AC5: a Verification Reviewer may not decide');
select is(pg_temp.decide(:'trust', 'hide', 'Misleading claims in the response.', :rep_resp, p_aal => 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'AC5: aal1 is refused');
select is(pg_temp.decide(:'aow', 'hide', 'Misleading claims in the response.', :rep_resp), 'P0001|CHARA_FORBIDDEN|', 'AC5: the owner of Alpha may not decide');
select is(pg_temp.decide(:'trust', 'hide', 'Nine char', :rep_resp), 'P0001|CHARA_INVALID_INPUT|reason', 'AC4: nine characters are refused');
select is(
  pg_temp.call_as(:'aow', 'authenticated', format('update public.partner_responses set moderation_state = ''visible'' where id = %L', :'resp_a')),
  '42501|permission denied for table partner_responses|', 'AC5: the partner cannot change moderation_state directly'
);
select is(pg_temp.writes(), :'w1', 'AC4, AC5: nothing is written by a refused decision');

select is(pg_temp.decide(:'trust', 'hide', 'The response claims licences Alpha does not hold.', :rep_resp), 'ok', 'AC4: Trust & Safety hides the response');
select current_setting('t.action') as act_resp \gset
select is(
  (select format('%s|%s|%s|%s', a.target_type, a.action, a.report_id, r.status) from public.moderation_actions a
   join public.reports r on r.id = a.report_id where a.id = :act_resp),
  format('partner_response|content_hidden|%s|actioned', :rep_resp), 'AC4: one decision row, the report closed actioned'
);
select is(
  (select metadata ->> 'report_id' from audit.log where action = 'partner_response.hide' and entity_id = :'resp_a'),
  :rep_resp::text, 'AC4: the audit row names the report'
);
select is(
  (select string_agg(q ->> 'title' || '|' || (q ->> 'decision') || '|' || (q ->> 'moderation_action_id'), ',') from jsonb_array_elements(pg_temp.queued(:'aow')) q),
  format('Germany, 10 Welders and flame cutters|hide|%s', :act_resp),
  'AC8: Alpha''s owner is told the response was hidden, by the title Alpha knows, with the decision for the appeal'
);
select is(jsonb_array_length(pg_temp.queued(:'aadm')) || ',' || jsonb_array_length(pg_temp.queued(:'amem')), '1,0',
  'AC8: the admin too, a plain member not');
select is((select queued -> 0 ->> 'outcome' from (select pg_temp.queued(:'cmem') as queued) x), 'actioned', 'the reporting employer member learns the outcome');

-- Effect of a hidden response
select is(pg_temp.ids(:'cow', format('select * from public.list_requirement_responses(%L, %L)', :'acme', :'m1')), :'resp_b',
  'AC7: the hidden response leaves the employer''s list');
select is(pg_temp.ids(:'cow', format('select * from public.compare_responses(%L, %L)', :'acme', :'m1')), :'resp_b', 'and the comparison');
select is(pg_temp.ids(:'cow', format('select * from public.get_response(%L, %L)', :'acme', :'resp_a')), 'P0002|CHARA_NOT_FOUND|', 'and its page');
select is(pg_temp.ids(:'amem', format('select * from public.get_response(%L, %L)', :'alpha', :'resp_a'), 'aal1'), :'resp_a', 'the partner still reads its own response');
select is(pg_temp.run(:'amem', format('select * from public.item_moderation(%L, ''partner_response'', %L)', :'alpha', :'resp_a'), 'aal1'), 'ok', 'AC12: every member reads the decision');
select is(
  (select format('%s|%s|%s', r ->> 'moderation_state', r ->> 'moderation_action_id', r ->> 'reasons') from (select pg_temp.result() -> 0 as r) x),
  format('hidden|%s|The response claims licences Alpha does not hold.', :act_resp), 'AC12: the badge state, the decision and its reasons'
);
select is(pg_temp.run(:'cow', format('select * from public.item_moderation(%L, ''partner_response'', %L)', :'acme', :'resp_a')),
  'P0002|CHARA_NOT_FOUND|', 'the employer reads no decision about the partner''s response');
select is(pg_temp.run(:'bow', format('select * from public.item_moderation(%L, ''partner_response'', %L)', :'beta', :'resp_a')),
  'P0002|CHARA_NOT_FOUND|', 'nor does another partner');
select is(pg_temp.run(null, format('select * from public.item_moderation(%L, ''partner_response'', %L)', :'alpha', :'resp_a')),
  '42501|permission denied for function item_moderation|', 'nor anonymous');

-- A requirement on a report, and a second report on what is in effect
select id as rep_m1 from public.reports where target_type = 'requirement' and requirement_id = :'m1' \gset
select is(pg_temp.ids(:'aow', format('select * from public.list_job_orders(%L) where id in (%L, %L)', :'alpha', :'m1', :'d1')), (select string_agg(x::text, ',' order by x::text) from unnest(array[:'m1', :'d1']::uuid[]) x),
  'before the decision both job orders are listed');
select is(pg_temp.decide(:'trust', 'hide', 'Discriminatory wording in the job order.', :rep_m1), 'ok', 'Trust & Safety hides the job order');
select current_setting('t.action') as act_m1 \gset
select is(
  (select string_agg(q ->> 'target_type' || '|' || (q ->> 'title') || '|' || (q ->> 'reasons'), ',') from jsonb_array_elements(pg_temp.queued(:'cow')) q),
  'requirement|V57 Acme welders Hamburg|Discriminatory wording in the job order.', 'AC8: Acme''s owner reads the decision with its own title'
);
select is(pg_temp.ids(:'aow', format('select * from public.list_job_orders(%L) where id in (%L, %L)', :'alpha', :'m1', :'d1')), :'d1', 'AC7: the hidden requirement leaves the job order list');
select is(pg_temp.run(:'aow', format('select * from public.get_job_order(%L, %L)', :'alpha', :'m1')) || ':' || (pg_temp.result() -> 0 ->> 'open'),
  'ok:false', 'its page says it is no longer open');
select is((select r.detail from private.response_refusal(:'beta', (select w from public.workforce_requirements w where w.id = :'m1')) r),
  'requirement_not_open', 'nobody responds to it');
select is(pg_temp.report(:'bow', 'requirement', :'m1'), 'P0002|CHARA_NOT_FOUND|', 'a hidden job order is out of sight and cannot be reported');
insert into public.reports (target_type, requirement_id, category, details, good_faith_confirmed, reporter_user_id)
values ('requirement', :'m1', 'discrimination', 'The wording excludes older workers.', true, :'bow') returning id as rep_m1b \gset
select is(pg_temp.decide(:'trust', 'hide', 'Already hidden for the same wording.', :rep_m1b) || ':' || current_setting('t.action'),
  'ok:' || :act_m1, 'a second report on a hidden job order is closed actioned on the decision in effect');
select is((select count(*) from public.moderation_actions where target_id = :'m1'), 1::bigint, 'without a second decision');

-- Own finding: a submission, and the own organisation
select is(pg_temp.decide(:'trust_delta', 'hide', 'Hidden on own finding of the reviewer.', null, 'requirement', :'d1'),
  'P0001|CHARA_FORBIDDEN|own_organization', 'nobody decides on the requirement of their own organisation');
select is(pg_temp.ids(:'cow', format('select * from public.list_requirement_submissions(%L, %L)', :'acme', :'m1')), :'sub_a', 'Acme sees Alpha''s submission');
select is(pg_temp.decide(:'trust', 'hide', 'The submission note asks for a placement fee.', null, 'candidate_submission', :'sub_a'), 'ok',
  'Trust & Safety hides a submission on its own finding');
select current_setting('t.action') as act_sub \gset
select is(pg_temp.ids(:'cow', format('select * from public.list_requirement_submissions(%L, %L)', :'acme', :'m1')), '',
  'the hidden submission leaves the employer''s list');
select is(pg_temp.ids(:'cow', format('select * from public.list_employer_submissions(%L)', :'acme')), '', 'and the pipeline');
select is(pg_temp.ids(:'cow', format('select * from public.get_employer_submission(%L)', :'sub_a')), 'P0002|CHARA_NOT_FOUND|', 'and its page');
select ok(
  (select q ->> 'title' is not null and q::text !~ 'Cara|Lim' from jsonb_array_elements(pg_temp.queued(:'aow')) q
   where q ->> 'target_type' = 'candidate_submission'),
  'AC8: Alpha is told the submission was hidden, never with the candidate''s name'
);
select is(pg_temp.decide(:'trust', 'hide', 'Hidden again on the same finding.', null, 'candidate_submission', :'sub_a'),
  'P0001|CHARA_INVALID_STATE|hidden', 'a hidden submission is not hidden twice');

-- AC9: appeal and restore
select is(pg_temp.run(:'aow', format('select * from public.list_my_appeals(%s)', :act_resp)), 'ok', 'Alpha''s owner finds the decision on the response');
select is((select format('%s|%s|%s', r ->> 'target_type', r ->> 'can_appeal', r ->> 'title') from (select pg_temp.result() -> 0 as r) x),
  'partner_response|true|Germany, 10 Welders and flame cutters', 'AC9: the owner may appeal it, under the title Alpha knows');
select is(pg_temp.run(:'amem', format('select * from public.list_my_appeals(%s)', :act_resp), 'aal1') || ':' || (pg_temp.result() -> 0 ->> 'can_appeal'),
  'ok:false', 'a plain member reads it without the appeal');
select is(pg_temp.run(:'aow', format('select * from public.submit_appeal(%s, %L)', :act_resp, 'We hold the licences; the register shows them clearly.')),
  'ok', 'AC9: the owner appeals');
select (pg_temp.result() -> 0 ->> 'appeal_id')::bigint as appeal \gset
select is(pg_temp.run(:'trust', format('select * from public.decide_appeal(%s, ''restore'', %L)', :appeal, 'The licences are valid, restored.')),
  'P0001|CHARA_FORBIDDEN|same_reviewer', 'AC9: the deciding administrator does not decide the appeal');
select is(pg_temp.run(:'trust_b', format('select * from public.decide_appeal(%s, ''restore'', %L)', :appeal, 'The licences are valid, restored.')),
  'ok', 'AC9: a second administrator restores');
select is((select moderation_state::text from public.partner_responses where id = :'resp_a'), 'visible', 'AC9: the response is visible again');
select is(
  (select format('%s|%s', a.action, a.target_type) from public.moderation_actions a where a.id = (pg_temp.result() -> 0 ->> 'reversal_action_id')::bigint),
  'content_unhidden|partner_response', 'AC9: the restore is a decision of its own'
);
select is(
  (select string_agg(q ->> 'appeal_outcome' || '|' || (q ->> 'title'), ',') from jsonb_array_elements(pg_temp.queued(:'aow')) q where q ? 'appeal_outcome'),
  'restored|Germany, 10 Welders and flame cutters', 'AC9: one notice to the appellant with the outcome and the title'
);

-- AC7: the suspension cascade -------------------------------------------------------------------------------------------------
select pg_temp.states() as before_suspension \gset
select is(:'before_suspension'::text,
  'V57 Acme private fitters:visible,V57 Acme welders Hamburg:hidden,V57 Delta welders Bremen:visible|v57-alpha:visible,v57-alpha:visible,v57-beta:visible|v57-alpha:hidden,v57-beta:visible',
  'the states before the suspensions');
select (select count(*) from public.workforce_requirements) || ',' || (select count(*) from public.partner_responses) || ','
  || (select count(*) from public.candidate_submissions) as rows_before \gset
select is(pg_temp.decide(:'trust', 'suspend_organization', 'Alpha demanded placement fees from workers.', :rep_sub), 'ok',
  'AC7: a report about a submission suspends the partner that made it');
select is((select status::text from public.organizations where id = :'alpha'), 'suspended', 'Alpha is suspended');
select is(pg_temp.call_as(:'trust', 'authenticated', format('select public.suspend_organization(%L, %L)', :'delta', 'Delta published discriminatory job orders.')),
  'ok', 'AC7: the employer Delta is suspended with suspend_organization');
select is(pg_temp.states(),
  'V57 Acme private fitters:visible,V57 Acme welders Hamburg:hidden,V57 Delta welders Bremen:org_suspended|v57-alpha:org_suspended,v57-alpha:org_suspended,v57-beta:visible|v57-alpha:hidden,v57-beta:visible',
  'AC7: Delta''s requirement and Alpha''s responses are out of sight; Alpha''s hidden submission stays hidden');
select is(
  (select string_agg(action || ':' || entity_type, ',' order by action, entity_id) from audit.log
   where action like '%.org_suspend' and entity_type in ('requirement', 'partner_response', 'candidate_submission')),
  'partner_response.org_suspend:partner_response,partner_response.org_suspend:partner_response,requirement.org_suspend:requirement',
  'each moved row is audited with the reasons'
);
select is(pg_temp.ids(:'cow', format('select * from public.list_requirement_responses(%L, %L)', :'acme', :'m1')), :'resp_b',
  'AC7: the suspended partner''s response leaves Acme''s list');
select is(pg_temp.ids(:'bow', format('select * from public.list_job_orders(%L) where id in (%L, %L)', :'beta', :'m1', :'d1')), '',
  'AC7: Delta''s job order leaves the list (Acme''s is still hidden)');
select is(pg_temp.report(:'cmem', 'partner_response', :'resp_b'), 'ok', 'reports about others still work');
select is(
  (select count(*) from public.workforce_requirements) || ',' || (select count(*) from public.partner_responses) || ','
    || (select count(*) from public.candidate_submissions), :'rows_before', 'AC7: no row is deleted');

select is(pg_temp.call_as(:'trust', 'authenticated', format('select public.reinstate_organization(%L, %L)', :'alpha', 'The fee claim was not substantiated.')),
  'ok', 'Alpha is reinstated');
select is(pg_temp.call_as(:'trust', 'authenticated', format('select public.reinstate_organization(%L, %L)', :'delta', 'The job orders were corrected.')),
  'ok', 'Delta is reinstated');
select is(pg_temp.states(), :'before_suspension', 'AC7: everything the suspension moved is back; items hidden by their own decision stay hidden');
select is(
  (select count(*) from audit.log where action like '%.org_reinstate' and entity_type in ('requirement', 'partner_response', 'candidate_submission')),
  3::bigint, 'each row moved back is audited'
);

-- AC8: a dismissal tells the reported party nothing ------------------------------------------------------------------------
delete from pgmq.q_notifications;
select id as rep_b from public.reports where partner_response_id = :'resp_b' \gset
select is(pg_temp.decide(:'trust', 'dismiss', 'Nothing in the response breaks the rules.', :rep_b), 'ok', 'a report about a response is dismissed');
select is(jsonb_array_length(pg_temp.queued(:'bow')), 0, 'AC8: a dismissal queues nothing to the reported partner');
select is(pg_temp.decide(:'trust', 'unhide', 'Shown again after the correction.', null, 'requirement', :'m1'), 'ok', 'an unhide on own finding');
select is((select moderation_state::text from public.workforce_requirements where id = :'m1'), 'visible', 'the job order is visible again');
select is((select q -> 0 ->> 'decision' from (select pg_temp.queued(:'cow') as q) x), 'unhide', 'and Acme is told');

select * from finish();
rollback;
