begin;
select plan(76);

\ir apply_fixture.inc

-- Submission review pipeline (V50, FR-O5 AC2 to AC4, AC6, AC7, AC11 and the data of AC1, AC5, AC8 to AC10; SOP P2-25;
-- NFR-S8, NFR-A3): the stages of an approved submission, set_submission_status, bulk_set_submission_status,
-- mark_submission_viewed, public.submission_notes and add_submission_note, the reads list_employer_submissions,
-- get_employer_submission, submission_documents, list_submission_notes, list_submission_events and the stages of
-- list_partner_submissions, the share expiry, the candidate's status_changed and the partner's submission_stage_changed.
-- Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner own2, admin adm2) are the employers of the fixture;
-- wa (Amina Okafor) and wb (Bruno Silva) the candidates with passports, wnew a candidate without a submission (W4).

\set u1 '00000000-0000-0000-0000-0000000f5011'
\set u1m '00000000-0000-0000-0000-0000000f5012'
\set padm '00000000-0000-0000-0000-0000000f5013'
\set dy '00000000-0000-0000-0000-0000000d00b2'

update private.settings set value = 'true' where key in ('release_job_orders', 'release_candidate_submissions');
update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key = 'rate_limit_job_orders_max';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max');
update private.settings set value = '30' where key = 'share_expiry_days_after_final';
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (:'acme', 'employer_starter', 'active', 'null'), (:'beta', 'employer_starter', 'active', 'null');
select pg_temp.doc(:'d1', :'wa', 'clean', 'certificate') as seeded \gset
select pg_temp.doc(:'d2', :'wa', 'clean', 'cv') as seeded \gset
select pg_temp.doc(:'d3', :'wa', 'clean') as seeded \gset
select pg_temp.doc(:'dx', :'wb', 'clean') as seeded \gset
select pg_temp.doc(:'dy', :'wb', 'clean') as seeded \gset
select pg_temp.new_user(:'padm') as seeded \gset
select pg_temp.new_user(:'u1') as seeded \gset
select pg_temp.new_user(:'u1m') as seeded \gset
update public.profiles set account_kind = intended_account_kind where id in (:'padm', :'u1', :'u1m');

-- A listed recruitment company owned by p_owner, as in 174.
create function pg_temp.partner(p_slug text, p_owner uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'recruitment_company', p_slug, 'Legal ' || p_slug || ' Ltd', upper(split_part(p_slug, '-', 1)), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  values (v_id, 'recruitment_partner', 'active', 'null');
  return v_id;
end;
$$;

create function pg_temp.req(p_org uuid, p_title text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on
  ) values (
    v_id, p_org, p_title, 10, 'DE', 'Hamburg', 'C', date '2027-03-01', 'full_time', 'both', 'both', 'open',
    'job_order_marketplace', true, now() - interval '10 days', date '2027-04-01'
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

-- A submission of p_worker by p_partner for p_req, written as the database owner in p_status: approved (consent, share of
-- p_docs, snapshot) from submitted on, a plain request before.
create function pg_temp.seed(p_req uuid, p_partner uuid, p_worker uuid, p_status text, p_docs uuid[] default '{}')
returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_share uuid := gen_random_uuid();
  v_employer uuid := (select r.organization_id from public.workforce_requirements r where r.id = p_req);
  v_consent bigint;
  v_approved boolean := p_status not in ('awaiting_candidate', 'declined_by_candidate', 'expired');
begin
  if v_approved then
    insert into public.consents (user_id, purpose, version, action)
    values (p_worker, 'share_passport:' || v_employer || ':submission:' || v_id,
      private.current_legal_version('sharing-notice'), 'granted')
    returning id into v_consent;
  end if;
  insert into public.candidate_submissions (
    id, requirement_id, organization_id, employer_organization_id, invited_email, worker_user_id, status, decided_at,
    worker_approved_at, passport_share_id, profile_snapshot, withdrawn_at
  ) values (
    v_id, p_req, p_partner, v_employer, v_id || '@seed.test', p_worker, p_status::public.submission_status,
    case when p_status <> 'awaiting_candidate' then now() end, case when v_approved then now() end,
    case when v_approved then v_share end, case when v_approved then private.profile_snapshot(p_worker) end,
    case when p_status = 'withdrawn' then now() end
  );
  if v_approved then
    insert into public.passport_shares (id, worker_user_id, organization_id, submission_id, scope, consent_id)
    values (v_share, p_worker, v_employer, v_id, to_jsonb(p_docs), v_consent);
    insert into public.submission_events (submission_id, from_status, to_status, actor_id)
    values (v_id, 'awaiting_candidate', 'submitted', p_worker);
  end if;
  return v_id;
end;
$$;

-- p_sql as p_user at p_aal: the value of its single column, or 'sqlstate|message|detail'.
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

-- set_submission_status as p_user: 'ok' or 'sqlstate|message|detail'.
create function pg_temp.move(p_user uuid, p_sub uuid, p_to text, p_note text default null, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format('select public.set_submission_status(%L, %L, %L)', p_sub, p_to, p_note), p_aal)
$$;

create function pg_temp.status(p_sub uuid) returns text
language sql as $$ select status::text from public.candidate_submissions where id = p_sub $$;

\set reason '''The position was filled by another candidate.'''

select pg_temp.partner('s1-v50', :'u1') as s1 \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'s1', :'u1m', 'member', now());
select pg_temp.partner('p1-v50', :'padm') as p1 \gset
select pg_temp.req(:'acme', 'Acme pipeline welders') as r \gset
select pg_temp.req(:'beta', 'Beta pipeline welders') as t \gset
select pg_temp.seed(:'r', :'s1', :'wa', 'submitted', array[:'d1', :'d2']::uuid[]) as w1 \gset
select pg_temp.seed(:'r', :'p1', :'wb', 'submitted', array[:'dx']::uuid[]) as w3 \gset
select pg_temp.seed(:'t', :'s1', :'wa', 'submitted', array[:'d1']::uuid[]) as wt \gset
select pg_temp.seed(:'r', :'s1', :'wnew', 'awaiting_candidate') as waiting \gset

-- Structure ------------------------------------------------------------------------------------------------------------------

select is(
  (select array_agg(proname::text order by proname) from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('set_submission_status', 'bulk_set_submission_status', 'mark_submission_viewed', 'add_submission_note',
       'list_employer_submissions', 'get_employer_submission', 'submission_documents', 'list_submission_notes',
       'list_submission_events', 'list_partner_submissions')
     and prosecdef and proconfig @> array['search_path=""']
     and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
     and not has_function_privilege('service_role', oid, 'execute')),
  array['add_submission_note', 'bulk_set_submission_status', 'get_employer_submission', 'list_employer_submissions',
    'list_partner_submissions', 'list_submission_events', 'list_submission_notes', 'mark_submission_viewed',
    'set_submission_status', 'submission_documents'],
  'the functions are security definer with an empty search path, for authenticated callers only');
select is(
  (select count(*)::integer from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('submission_stage_as_application', 'submission_move_allowed', 'employer_submission',
       'submission_status_note', 'move_submission', 'change_submission_status')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'no API role executes the private helpers');
select is(
  (select relrowsecurity || ':' || relforcerowsecurity from pg_class where oid = 'public.submission_notes'::regclass),
  'true:true', 'NFR-S8: RLS is enabled and forced on submission_notes');
select ok(
  not has_table_privilege('authenticated', 'public.submission_notes', 'insert')
    and not has_table_privilege('authenticated', 'public.submission_notes', 'update')
    and not has_table_privilege('authenticated', 'public.submission_notes', 'delete')
    and not has_table_privilege('anon', 'public.submission_notes', 'select'),
  'notes are written by add_submission_note only, and never read anonymously');
select ok(
  not has_column_privilege('authenticated', 'public.submission_events', 'note', 'select')
    and not has_column_privilege('authenticated', 'public.submission_events', 'actor_id', 'select'),
  'FR-O5 AC3, AC5: the note of a move is read through list_submission_events only, never by the partner');
select is(
  (select kind || ':' || mandatory || ':' || default_email || ':' || audience || ':' || organization_types::text
   from private.notification_kinds where kind = 'submission_stage_changed'),
  'submission_stage_changed:false:true:company:{recruitment_company,staffing_company}',
  'FR-O5, FR-T1: the partner''s stage notice is optional with email on');
select is(
  (select (s.value #>> '{}') || ':' || r.min || '..' || r.max from private.setting_rules r
   join private.settings s on s.key = r.key where r.key = 'submission_decline_reason_min_chars'),
  '10:1..200', 'NFR-O5: the minimum length of a decline reason is a setting with a rule');

-- AC2: every pair of stages --------------------------------------------------------------------------------------------------

create temp table pairs (from_status text, to_status text, sub uuid, result text);
insert into pairs (from_status, to_status)
select f, t
from unnest(array['submitted', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']) f
cross join unnest(array['submitted', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']) t;
update pairs set sub = pg_temp.seed(pg_temp.req(:'acme', 'Pair ' || from_status || ' ' || to_status), :'s1', :'wb', from_status);
update pairs set result = pg_temp.move(:'mem', sub, to_status, case when to_status = 'rejected' then 'A reason of enough length.' end, 'aal1');

select is(
  (select string_agg(from_status || '>' || to_status, ',' order by from_status, to_status) from pairs where result = 'ok'),
  (select string_agg(f::text || '>' || t::text, ',' order by f::text, t::text)
   from unnest(enum_range(null::public.submission_status)) f, unnest(enum_range(null::public.submission_status)) t
   where f::text in ('submitted', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')
     and t::text in ('submitted', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')
     and private.application_transition_allowed(
       private.submission_stage_as_application(f), private.submission_stage_as_application(t), 'set_application_status')),
  'FR-O5 AC2: exactly the pairs set_application_status allows, with submitted in place of applied, are accepted');
select is(
  (select count(*)::integer from pairs where result = 'ok'), 13, 'FR-O5 AC2: thirteen moves of the employer');
select is(
  (select count(*)::integer from pairs where result <> 'ok' and result not like 'P0001|CHARA_INVALID_TRANSITION|%'), 0,
  'FR-O5 AC2: every other pair fails with CHARA_INVALID_TRANSITION');
select is(
  (select count(*)::integer from pairs where result <> 'ok' and pg_temp.status(sub) <> from_status), 0,
  'FR-O5 AC2: a refused move changes nothing');
select is(
  (select count(*)::integer from pairs where to_status = 'withdrawn' and result = 'ok'), 0,
  'FR-O5 AC2: only the candidate moves a submission to withdrawn');
select is(
  (select count(*)::integer from pairs p where p.result = 'ok'
     and (select count(*) from public.submission_events e where e.submission_id = p.sub and e.actor_id = :'mem'
            and e.from_status::text = p.from_status and e.to_status::text = p.to_status) = 1
     and (select count(*) from audit.log a where a.action = 'submission.status_changed' and a.entity_id = p.sub::text
            and a.metadata ->> 'from' = p.from_status and a.metadata ->> 'to' = p.to_status) = 1),
  13, 'FR-O5 AC2: each accepted move writes one event (from, to, actor) and one audit row submission.status_changed');
select is(
  (select string_agg(distinct a.metadata::text, '') from audit.log a
   where a.action = 'submission.status_changed' and a.metadata::text like '%reason of enough%'), null,
  'the audit row never holds the note');

-- AC3: the reason of a decline -----------------------------------------------------------------------------------------------

select pg_temp.seed(pg_temp.req(:'acme', 'Decline reasons'), :'s1', :'wa', 'interview', array[:'d1']::uuid[]) as dec \gset
select is(pg_temp.move(:'mem', :'dec', 'rejected', null, 'aal1'), 'P0001|CHARA_INVALID_INPUT|p_note', 'FR-O5 AC3: no reason is refused');
select is(pg_temp.move(:'mem', :'dec', 'rejected', '   ', 'aal1'), 'P0001|CHARA_INVALID_INPUT|p_note', 'FR-O5 AC3: an empty reason is refused');
select is(pg_temp.move(:'mem', :'dec', 'rejected', '123456789', 'aal1'), 'P0001|CHARA_INVALID_INPUT|p_note',
  'FR-O5 AC3: a reason of 9 characters is refused');
select is(pg_temp.move(:'mem', :'dec', 'rejected', repeat('x', 1001), 'aal1'), 'P0001|CHARA_INVALID_INPUT|p_note',
  'FR-O5 AC3: a reason of 1,001 characters is refused');
select is(pg_temp.status(:'dec'), 'interview', 'FR-O5 AC3: the refused declines changed nothing');
select is(pg_temp.move(:'mem', :'dec', 'rejected', ' 1234567890 ', 'aal1'), 'ok', 'FR-O5 AC3: a reason of 10 characters is accepted');
select is(
  pg_temp.read_as(:'wa', format($$select string_agg(to_status || ':' || actor_role || ':' || coalesce(note, '-'), ',')
    from public.list_submission_events(%L)$$, :'dec')),
  'submitted:candidate:-,rejected:employer:1234567890',
  'FR-O5 AC3, AC9: the candidate reads the trimmed reason in the history, with the role, never the person');

-- AC4: who reads what --------------------------------------------------------------------------------------------------------

select is(pg_temp.call_as(:'mem', 'authenticated', format('select public.add_submission_note(%L, %L)', :'w1',
  'Strong welding test result'), 'aal1'), 'ok', 'FR-O5 AC5: an Acme member adds an internal note');
select is(pg_temp.call_as(:'own2', 'authenticated', format('select public.add_submission_note(%L, %L)', :'wt',
  'Beta note'), 'aal2'), 'ok', 'a Beta owner at aal2 adds a note to its own submission');
select is(pg_temp.read_as(:'u1', format('select string_agg(id::text, '','' order by id) from public.candidate_submissions where id in (%L, %L, %L)',
  :'w1', :'w3', :'wt')), (select string_agg(x, ',' order by x) from unnest(array[:'w1', :'wt']) x),
  'FR-O5 AC4: the S1 member reads its submissions for R and T, not P1''s');
select is(pg_temp.read_as(:'u1', format('select count(*)::text from public.list_partner_submissions(%L, %L) where id = %L and jsonb_array_length(stages) = 1',
  :'s1', :'r', :'w1')), '1', 'FR-O5 AC4: and the stage history of W1''s submission (the stage and its time)');
select is(pg_temp.read_as(:'padm', format('select string_agg(id::text, '','') from public.candidate_submissions where id in (%L, %L, %L)',
  :'w1', :'w3', :'wt')), :'w3', 'FR-O5 AC4: the P1 member reads W3''s only');
select is(pg_temp.read_as(:'mem', format('select string_agg(id::text, '','' order by id) from public.candidate_submissions where id in (%L, %L, %L)',
  :'w1', :'w3', :'wt')), (select string_agg(x, ',' order by x) from unnest(array[:'w1', :'w3']) x),
  'FR-O5 AC4: the Acme member reads W1 and W3, not Beta''s');
select is(pg_temp.read_as(:'mem', format('select count(*)::text from public.submission_events where submission_id in (%L, %L)', :'w1', :'w3')),
  '2', 'FR-O5 AC4: and their events');
select is(pg_temp.read_as(:'wb', format('select string_agg(id::text, '','') from public.candidate_submissions where id in (%L, %L, %L)',
  :'w1', :'w3', :'wt')), :'w3', 'FR-O5 AC4: W3 reads the own submission');
select is(pg_temp.read_as(:'wb', format('select count(*)::text from public.submission_events where submission_id = %L', :'w3')),
  '1', 'FR-O5 AC4: and its events');
select is(pg_temp.read_as(:'wnew', 'select count(*)::text from public.candidate_submissions where worker_approved_at is not null'),
  '0', 'FR-O5 AC4: W4 reads no submission');
select is(pg_temp.read_as(:'wnew', 'select count(*)::text from public.submission_events'), '0', 'FR-O5 AC4: and no event');
select is(pg_temp.read_as(null, 'select count(*)::text from public.candidate_submissions'), '42501|permission denied for table candidate_submissions|',
  'FR-O5 AC4: the anonymous caller is refused');
select is(pg_temp.read_as(null, 'select count(*)::text from public.submission_notes'), '42501|permission denied for table submission_notes|',
  'FR-O5 AC4: the anonymous caller is refused the notes');
select is(
  (select string_agg(coalesce(pg_temp.read_as(u, 'select count(*)::text from public.submission_notes'), '?'), ',' order by u)
   from unnest(array[:'u1', :'u1m', :'padm', :'wa', :'wb', :'wnew']::uuid[]) u),
  '0,0,0,0,0,0', 'FR-O5 AC4: no partner and no candidate reads any submission_notes row');
select is(pg_temp.read_as(:'mem', 'select string_agg(body, '','') from public.submission_notes'), 'Strong welding test result',
  'FR-O5 AC5: the Acme member reads Acme''s note only');
select is(pg_temp.read_as(:'u1', format('select count(*)::text from public.list_submission_notes(%L)', :'w1')),
  'P0002|CHARA_NOT_FOUND|', 'FR-O5 AC5: the partner cannot read the employer''s notes through the function');
select is(pg_temp.read_as(:'u1', format('select count(*)::text from public.list_submission_events(%L)', :'w1')),
  'P0002|CHARA_NOT_FOUND|', 'FR-O5 AC5: nor the history with its notes');
select is(pg_temp.read_as(:'own2', format('select count(*)::text from public.get_employer_submission(%L)', :'w1'), 'aal2'),
  'P0002|CHARA_NOT_FOUND|', 'NFR-S8: a Beta owner does not read Acme''s submission');
select is(pg_temp.read_as(:'wnew', format('select count(*)::text from public.list_submission_events(%L)', :'w1')),
  'P0002|CHARA_NOT_FOUND|', 'NFR-S8: another candidate does not read the history');
select is(pg_temp.read_as(:'u1', format('select count(*)::text from public.list_employer_submissions(%L)', :'acme')),
  '42501|CHARA_FORBIDDEN|', 'NFR-S8: a partner member does not list the employer''s submissions');
select is(pg_temp.read_as(:'mem', format('select string_agg(partner_name, '','' order by partner_name) from public.list_employer_submissions(%L, %L)',
  :'acme', :'r')), 'P1,S1', 'FR-O5 AC1: the employer lists the approved submissions of R with the partner, never the waiting one');
select is(pg_temp.read_as(:'mem', format('select count(*)::text from public.list_employer_submissions(%L, %L, %L)', :'acme', :'r', 'submitted')),
  '2', 'FR-O5 AC1: filtered by stage');

-- AC7: aal2 for owners and admins -----------------------------------------------------------------------------------------------

select is(pg_temp.read_as(:'own1', format('select count(*)::text from public.get_employer_submission(%L)', :'w1'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'FR-O5 AC7: the owner at aal1 is refused the detail');
select is(pg_temp.read_as(:'adm', format('select count(*)::text from public.list_employer_submissions(%L, %L)', :'acme', :'r'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'FR-O5 AC7: the administrator at aal1 is refused the pipeline data');
select is(pg_temp.read_as(:'adm', format('select count(*)::text from public.list_submission_notes(%L)', :'w1'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'FR-O5 AC7: and the notes');
select is(pg_temp.read_as(:'adm', format('select count(*)::text from public.list_submission_notes(%L)', :'w1'), 'aal2'),
  '1', 'FR-O5 AC7: the administrator at aal2 is served');
select is(pg_temp.read_as(:'mem', format('select candidate_name from public.get_employer_submission(%L)', :'w1'), 'aal1'),
  'Amina Okafor', 'FR-O5 AC7: the member at aal1 is served');

-- Viewed ----------------------------------------------------------------------------------------------------------------------

select is(pg_temp.call_as(:'mem', 'authenticated', format('select public.mark_submission_viewed(%L)', :'w3'), 'aal1')
  || ':' || pg_temp.status(:'w3'), 'ok:viewed', 'FR-O5: the first open by a member moves submitted to viewed');
select is(
  (select count(*)::integer from public.submission_events where submission_id = :'w3' and to_status = 'viewed' and actor_id is null)
    + (select count(*)::integer from pgmq.q_notifications where message ->> 'submission_id' = :'w3'),
  1, 'FR-O5: the system''s move has no actor and tells nobody');
select is(pg_temp.call_as(:'mem', 'authenticated', format('select public.mark_submission_viewed(%L)', :'w3'), 'aal1'),
  'ok', 'a later open changes nothing and raises nothing');

-- AC9, AC10: the candidate's and the partner's notices -----------------------------------------------------------------------

select is(pg_temp.move(:'mem', :'w1', 'interview', 'We would like to meet you.', 'aal1'), 'ok', 'W1 moves to interview with a note');
select is(
  (select string_agg(n.kind || ':' || n.user_id, ',' order by n.kind) from public.notifications n
   where n.payload ->> 'submission_id' = :'w1'),
  'status_changed:' || :'wa' || ',submission_stage_changed:' || :'u1',
  'FR-O5 AC9, AC10, NFR-A3: the candidate''s status_changed and the partner owner''s submission_stage_changed are queued in the move''s transaction (no plain member)');
select is(
  (select n.payload::text from public.notifications n where n.kind = 'status_changed' and n.payload ->> 'submission_id' = :'w1'),
  jsonb_build_object('submission_id', :'w1', 'job_title', 'Acme pipeline welders', 'org_name', 'Acme Bau',
    'partner_name', 'S1', 'status', 'interview')::text,
  'FR-O5 AC9: the candidate''s notice names the requirement, the employer and the partner, never the note');
select is(
  (select n.payload - 'title' from public.notifications n where n.kind = 'submission_stage_changed' and n.payload ->> 'submission_id' = :'w1'),
  jsonb_build_object('submission_id', :'w1', 'requirement_id', :'r', 'status', 'interview', 'org_slug', 's1-v50'),
  'FR-O5 AC10: the partner''s notice holds the stage only, never the candidate or the note');

-- AC6: documents ---------------------------------------------------------------------------------------------------------------

select is(pg_temp.read_as(:'mem', format('select string_agg(id::text, '','' order by id) from public.submission_documents(%L)', :'w1')),
  (select string_agg(x, ',' order by x) from unnest(array[:'d1', :'d2']) x), 'FR-O5 AC6: the employer lists the two shared documents');
select is(pg_temp.call_as(:'mem', 'authenticated', format('select * from public.document_access_grant(%L, %L)', :'d1', 'submission_review'), 'aal1')
  || pg_temp.call_as(:'mem', 'authenticated', format('select * from public.document_access_grant(%L, %L)', :'d2', 'submission_review'), 'aal1'),
  'okok', 'FR-O5 AC6: both shared documents are granted');
select is(
  (select count(*)::integer from audit.document_access_log l
   where l.share_id = (select passport_share_id from public.candidate_submissions where id = :'w1')
     and l.accessed_by = :'mem' and l.purpose = 'submission_review' and l.organization_id = :'acme'),
  2, 'FR-O5 AC6: one access row each, with share, organisation, member and purpose');
select is(pg_temp.call_as(:'mem', 'authenticated', format('select * from public.document_access_grant(%L, %L)', :'d3', 'submission_review'), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'FR-O5 AC6: a document W1 did not select is refused');
select is(pg_temp.call_as(:'u1', 'authenticated', format('select * from public.document_access_grant(%L, %L)', :'d1', 'submission_review'), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'FR-O5 AC6: the partner is refused (the share is the employer''s)');

-- AC8: bulk ------------------------------------------------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Bulk requirement') as rbulk \gset
create temp table bulk (sub uuid, start text);
insert into bulk select pg_temp.seed(:'rbulk', :'s1', w, s), s
from (values (:'wa'::uuid, 'submitted'), (:'wb'::uuid, 'submitted'), (:'wa'::uuid, 'withdrawn')) v (w, s);
insert into bulk select pg_temp.seed(pg_temp.req(:'acme', 'Bulk extra ' || n), :'s1', :'wa', s), s
from (values (1, 'submitted'), (2, 'interview'), (3, 'interview')) v (n, s);
select is(pg_temp.read_as(:'own1', format(
  $$select string_agg(ok::text || coalesce(':' || error_code, ''), ',' order by ok desc, error_code)
    from public.bulk_set_submission_status(%L::uuid[], 'shortlisted')$$, (select array_agg(sub) from bulk)), 'aal2'),
  'true,true,true,false:CHARA_INVALID_TRANSITION,false:CHARA_INVALID_TRANSITION,false:CHARA_INVALID_TRANSITION',
  'FR-O5 AC8: of six, the three submitted move and the two in interview and the withdrawn one are skipped');
select is((select string_agg(start || '>' || pg_temp.status(sub), ',' order by start, sub) from bulk where start = 'submitted'),
  'submitted>shortlisted,submitted>shortlisted,submitted>shortlisted', 'FR-O5 AC8: the three are shortlisted');
select is(pg_temp.read_as(:'own1', format($$select count(*)::text from public.bulk_set_submission_status(%L::uuid[], 'rejected')$$,
  (select array_agg(sub) from bulk where start = 'interview')), 'aal2'),
  'P0001|CHARA_INVALID_INPUT|p_note', 'FR-O5 AC8: a bulk decline needs the reason');
select is(pg_temp.read_as(:'own1', format($$select string_agg(ok::text, ',') from public.bulk_set_submission_status(%L::uuid[], 'rejected', %L)$$,
  (select array_agg(sub) from bulk where start = 'interview'), :reason), 'aal2'),
  'true,true', 'FR-O5 AC8: the two in interview are declined with one reason');
select is(
  (select count(*)::integer from public.submission_events e join bulk b on b.sub = e.submission_id
   where b.start = 'interview' and e.to_status = 'rejected' and e.note = :reason)
    || ':' || (select count(*)::integer from public.notifications n join bulk b on n.payload ->> 'submission_id' = b.sub::text
               where b.start = 'interview' and n.kind = 'status_changed' and n.payload ->> 'status' = 'rejected'),
  '2:2', 'FR-O5 AC8: one event and one status email per declined submission');
select is(pg_temp.read_as(:'adm', format($$select count(*)::text from public.bulk_set_submission_status(%L::uuid[], 'offer')$$,
  (select array_agg(sub) from bulk where start = 'submitted')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'FR-O5 AC7: an administrator at aal1 is refused a bulk call');

-- AC11: share expiry and the lapsed employer -----------------------------------------------------------------------------------

select pg_temp.req(:'acme', 'Expiry requirement') as rexp \gset
select pg_temp.seed(:'rexp', :'s1', :'wa', 'offer', array[:'d1']::uuid[]) as e1 \gset
select pg_temp.seed(:'rexp', :'s1', :'wb', 'interview', array[:'dx']::uuid[]) as e2 \gset
select is(pg_temp.move(:'mem', :'e1', 'hired', null, 'aal1') || pg_temp.move(:'mem', :'e2', 'rejected', :reason, 'aal1'), 'okok',
  'FR-O5 AC11: W1 is hired and W2 not selected with a reason');
select is(
  (select string_agg((s.revoked_at is null)::text || ':' || (s.expires_at between now() + interval '30 days' - interval '1 minute'
     and now() + interval '30 days' + interval '1 minute')::text, ',')
   from public.passport_shares s where s.submission_id in (:'e1', :'e2')),
  'true:true,true:true', 'FR-O5 AC11: both shares expire in 30 days and stay unrevoked');
select pg_temp.seed(pg_temp.req(:'acme', 'Expired share'), :'s1', :'wb', 'offer', array[:'dy']::uuid[]) as e3 \gset
update public.passport_shares set expires_at = now() - interval '1 second' where submission_id = :'e3';
select is(pg_temp.read_as(:'mem', format('select count(*)::text from public.submission_documents(%L)', :'e3')), '0',
  'FR-O5 AC11: after the expiry the employer lists no document of the share');
select is(pg_temp.call_as(:'mem', 'authenticated', format('select * from public.document_access_grant(%L, %L)', :'dy', 'submission_review'), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'FR-O5 AC11: and document_access_grant refuses its document');
select pg_temp.seed(pg_temp.req(:'acme', 'Lapsed requirement'), :'p1', :'wa', 'interview') as lapsed \gset
update billing.subscriptions set status = 'canceled' where organization_id = :'acme';
select is(pg_temp.move(:'mem', :'lapsed', 'offer', null, 'aal1'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan',
  'FR-O5 AC11: a lapsed employer cannot move a stage');
select is(pg_temp.call_as(:'mem', 'authenticated', format('select public.add_submission_note(%L, %L)', :'lapsed', 'Note'), 'aal1'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'FR-O5 AC11: nor add a note');
select is(pg_temp.call_as(:'wb', 'authenticated', format('select public.withdraw_submission(%L)', :'e2'), 'aal1')
  || ':' || pg_temp.status(:'e2'), 'ok:withdrawn', 'FR-O5 AC11: the candidate''s withdrawal still succeeds');
select is(pg_temp.read_as(:'mem', format('select count(*)::text from public.list_submission_notes(%L)', :'w1')), '1',
  'a lapsed employer still reads its notes');
update billing.subscriptions set status = 'active' where organization_id = :'acme';

-- Release switch ---------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_candidate_submissions';
select is(pg_temp.move(:'mem', :'w3', 'interview', null, 'aal1'), '42501|CHARA_FORBIDDEN|release_off',
  'the stage change is not available while the release is off');
select is(pg_temp.read_as(:'mem', format('select count(*)::text from public.list_employer_submissions(%L)', :'acme')),
  '42501|CHARA_FORBIDDEN|release_off', 'nor the pipeline');

select * from finish();
rollback;
