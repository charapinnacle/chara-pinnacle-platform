begin;
select plan(62);

\ir apply_fixture.inc

-- V58: retention, erasure and export of the job order network (FR-S3 AC1, AC3, AC5, AC7, AC9; SOP P2-43 steps Configure,
-- Apply, Erase, Export, Check), the decisions on deleted items (FR-S1, V57) and the job order metrics of the network
-- statistics (FR-S2 release 2b parts; NFR-S8 with two employers, two partners, two candidates and anonymous).
-- Employers Acme (t.a, owner own1) and Beta (t.b, owner own2) publish requirements; recruitment companies Alpha (owner
-- pa) and Bravo (owner pb) respond and submit the candidates wa (Amina) and wb (Bruno) of the fixture.

\set pa '00000000-0000-0000-0000-000000184001'
\set pb '00000000-0000-0000-0000-000000184002'
\set trust '00000000-0000-0000-0000-000000184003'
\set trust_b '00000000-0000-0000-0000-000000184004'
\set padmin '00000000-0000-0000-0000-000000184005'

update private.settings set value = 'true'
where key in ('release_partner_directories', 'release_job_orders', 'release_candidate_submissions');
update private.settings set value = 'false' where key = 'entitlements_enforced';
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
select pg_temp.doc(:'d1', :'wa', 'clean', 'certificate') as seeded \gset
select pg_temp.new_user(u) from unnest(array[:'pa', :'pb', :'trust', :'trust_b', :'padmin']::uuid[]) u;
update public.profiles set account_kind = intended_account_kind where id in (:'pa', :'pb', :'trust', :'trust_b', :'padmin');
insert into public.platform_staff (user_id, role) values (:'trust', 'trust_safety'), (:'trust_b', 'trust_safety'), (:'padmin', 'admin');

create function pg_temp.partner(p_slug text, p_owner uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'recruitment_company', p_slug, 'Legal ' || p_slug || ' Ltd', initcap(p_slug), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  return v_id;
end;
$$;

select pg_temp.partner('alpha', :'pa') as alpha \gset
select pg_temp.partner('bravo', :'pb') as bravo \gset

-- A requirement of p_org in p_status, its status changed p_days ago (open ones published p_days ago).
create function pg_temp.req(p_org uuid, p_title text, p_status text, p_days integer, p_by uuid default null) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on, close_reason,
    status_changed_at, created_at, created_by
  ) values (
    v_id, p_org, p_title, 10, 'DE', 'Hamburg', 'C', date '2027-06-01', 'full_time', 'both', 'both',
    p_status::public.requirement_status, 'job_order_marketplace', true,
    now() - make_interval(days => p_days + case when p_status = 'open' then 0 else 30 end),
    current_date + 30,
    case p_status when 'filled' then 'filled' when 'closed' then 'cancelled' end::public.requirement_close_reason,
    now() - make_interval(days => p_days), now() - make_interval(days => p_days + 30), p_by
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

-- A response of p_partner with its first version and one scanned supporting document.
create function pg_temp.respond(p_req uuid, p_partner uuid, p_by uuid default null) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_employer uuid := (select r.organization_id from public.workforce_requirements r where r.id = p_req);
begin
  insert into public.partner_responses (id, requirement_id, organization_id, employer_organization_id, status, capacity,
    available_from, experience_note, fee_model, created_by)
  values (v_id, p_req, p_partner, v_employer, 'submitted', 10, date '2027-05-01',
    'Twelve years of placing certified welders in Germany.', 'on_request', p_by);
  insert into public.partner_response_versions (response_id, version, organization_id, employer_organization_id, payload, changed_fields)
  values (v_id, 1, p_partner, v_employer, '{}', '{}');
  insert into public.partner_response_documents (id, organization_id, requirement_id, employer_organization_id, response_id,
    storage_path, file_name, size_bytes, scan_status, scanned_at)
  values (v_doc, p_partner, p_req, v_employer, v_id, p_partner || '/' || v_doc || '/' || gen_random_uuid(), 'licence.pdf',
    1000, 'clean', now());
  return v_id;
end;
$$;

-- A submission of p_worker (or of the address only) in p_status, answered, approved or withdrawn p_days ago; approved ones
-- with the consent, the share of p_docs and an event.
create function pg_temp.seed(p_req uuid, p_partner uuid, p_worker uuid, p_status text, p_days integer default 0,
  p_docs uuid[] default '{}', p_email text default null, p_by uuid default null) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_share uuid := gen_random_uuid();
  v_employer uuid := (select r.organization_id from public.workforce_requirements r where r.id = p_req);
  v_at timestamptz := now() - make_interval(days => p_days);
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
    id, requirement_id, organization_id, employer_organization_id, invited_email, worker_user_id, submitted_by, status,
    decided_at, worker_approved_at, passport_share_id, profile_snapshot, withdrawn_at, created_at, note
  ) values (
    v_id, p_req, p_partner, v_employer, coalesce(p_email, p_worker || '@example.test'), p_worker, p_by,
    p_status::public.submission_status, case when p_status <> 'awaiting_candidate' then v_at end,
    case when v_approved then v_at end, case when v_approved then v_share end,
    case when v_approved then private.profile_snapshot(p_worker) end, case when p_status = 'withdrawn' then v_at end,
    v_at - interval '1 day', 'Ten years of MIG welding.'
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

create function pg_temp.run(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    p_aal)
$$;
create function pg_temp.result() returns jsonb language sql as $$ select current_setting('t.result')::jsonb $$;

create function pg_temp.exists_row(p_table text, p_id uuid) returns boolean
language plpgsql as $$
declare
  v boolean;
begin
  execute format('select exists (select 1 from %s where id = %L)', p_table, p_id) into v;
  return v;
end;
$$;

-- The data ---------------------------------------------------------------------------------------------------------------------
select pg_temp.req(:'acme', 'Welders for Hamburg yard', 'closed', 731, :'own1') as r_old \gset
select pg_temp.req(:'acme', 'Fitters for Kiel', 'filled', 729) as r_kept \gset
select pg_temp.req(:'acme', 'Painters for Bremen', 'open', 1000) as r_open \gset
select pg_temp.req(:'beta', 'Riggers for Rostock', 'filled', 800) as r_reported \gset
select pg_temp.req(:'beta', 'Electricians for Lübeck', 'closed', 800) as r_moderated \gset

select pg_temp.req(:'beta', 'Scaffolders for Kiel', 'open', 0, :'own2') as r_written \gset
select pg_temp.respond(:'r_old', :'alpha', :'pa') as resp_old \gset
select pg_temp.respond(:'r_written', :'alpha', :'pa') as resp_written \gset
select private.job_order_neutral_title(:'r_moderated') as moderated_title \gset
select pg_temp.respond(:'r_kept', :'bravo') as resp_kept \gset
select pg_temp.respond(:'r_reported', :'alpha') as resp_reported \gset
select pg_temp.respond(:'r_moderated', :'bravo') as resp_moderated \gset
insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source, invited_at)
values (:'r_old', :'alpha', :'acme', 'directory', now() - interval '800 days');
select storage_path as doc_old from public.partner_response_documents where response_id = :'resp_old' \gset

select pg_temp.seed(:'r_old', :'alpha', :'wa', 'hired', 740, array[:'d1']::uuid[], p_by => :'pa') as sub_old \gset
insert into public.submission_notes (submission_id, organization_id, body) values (:'sub_old', :'acme', 'Strong candidate.');
select pg_temp.seed(:'r_kept', :'bravo', :'wb', 'submitted', 740) as sub_kept \gset
select pg_temp.seed(:'r_open', :'bravo', :'wa', 'withdrawn', 731) as sub_withdrawn_old \gset
select pg_temp.seed(:'r_open', :'alpha', :'wa', 'submitted', 10, array[:'d1']::uuid[], p_by => :'pa') as sub_live \gset
select pg_temp.seed(:'r_open', :'bravo', null, 'expired', 731, p_email => 'old.request@example.test') as sub_expired_old \gset
select pg_temp.seed(:'r_open', :'bravo', :'wb', 'declined_by_candidate', 20) as sub_declined_recent \gset

-- A report still in review keeps the requirement of the response it is about.
insert into public.reports (target_type, partner_response_id, category, details, good_faith_confirmed, reporter_user_id, status,
  handled_by, handled_at)
values ('partner_response', :'resp_reported', 'misleading_or_fraud', 'The response claims licences it does not hold.', true, :'own2',
  'in_review', :'trust', now());

-- Trust & Safety hides Bravo's response to the requirement that retention will delete; Bravo's owner appeals.
select is(pg_temp.call_as(:'trust', 'authenticated',
  format($f$select set_config('t.action', d.moderation_action_id::text, true)
            from public.moderation_decide('hide', 'Misleading claims about licences.', null, 'partner_response', %L) d$f$, :'resp_moderated')),
  'ok', 'setup: Trust & Safety hides Bravo''s response');
select current_setting('t.action')::bigint as act \gset
select is(pg_temp.run(:'pb', format('select * from public.submit_appeal(%s, %L)', :act, 'Our licences are valid and registered.')),
  'ok', 'setup: Bravo''s owner appeals');
select (pg_temp.result() -> 0 ->> 'appeal_id')::bigint as appeal \gset

-- The job order metrics: one week and one refusal older than the period, one of each within it.
insert into stats.job_order_partner_weeks (week_start, organization_id) values
  (date_trunc('week', now() - interval '800 days')::date, :'alpha'), (date_trunc('week', now())::date, :'alpha');
insert into stats.job_order_response_refusals (requirement_id, organization_id, reason, first_seen_at, last_seen_at) values
  (:'r_open', :'alpha', 'job_order_access', now() - interval '800 days', now() - interval '800 days'),
  (:'r_open', :'bravo', 'job_order_access', now() - interval '2 days', now() - interval '2 days');

-- AC1: the periods ---------------------------------------------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s', entity, days, editable), ',' order by entity) from private.retention_policies
   where entity in ('candidate_submissions', 'closed_requirements', 'job_order_metrics', 'partner_responses')),
  'candidate_submissions:730:t,closed_requirements:730:t,job_order_metrics:730:t,partner_responses:730:t',
  'AC1: the periods of the job order network are 730 days and editable in the retention editor (NFR-O5)'
);
select is(
  (select count(*)::integer from private.retention_policies
   where entity in ('candidate_submissions', 'closed_requirements', 'partner_responses') and description ~ 'Applies with'),
  0, 'their descriptions no longer say they wait for release 2b'
);

-- AC3: one run -------------------------------------------------------------------------------------------------------------------
select private.apply_retention();

select is(pg_temp.exists_row('public.workforce_requirements', :'r_old'), false, 'AC3: the requirement closed 731 days ago is deleted');
select is(pg_temp.exists_row('public.partner_responses', :'resp_old'), false, 'AC3: with its response');
select is((select count(*)::integer from public.partner_response_versions where response_id = :'resp_old'), 0, 'AC3: and the response versions');
select is((select count(*)::integer from public.partner_response_documents where response_id = :'resp_old'), 0, 'AC3: and the supporting documents');
select ok(
  exists (select 1 from pgmq.q_account_ops q
          where q.message ->> 'action' = 'delete_organization_object' and q.message ->> 'path' = :'doc_old'),
  'AC3: whose file is queued for removal from the private bucket by account-ops'
);
select is((select count(*)::integer from public.requirement_invitations where requirement_id = :'r_old'), 0, 'AC3: and its invitations');
select is(pg_temp.exists_row('public.candidate_submissions', :'sub_old'), false, 'AC3: and its submission');
select is((select count(*)::integer from public.passport_shares where submission_id = :'sub_old'), 0, 'AC3: together with its passport share');
select is((select count(*)::integer from public.submission_events where submission_id = :'sub_old')
  + (select count(*)::integer from public.submission_notes where submission_id = :'sub_old'), 0, 'and its history and notes');
select is(pg_temp.exists_row('public.workforce_requirements', :'r_kept') and pg_temp.exists_row('public.partner_responses', :'resp_kept')
  and pg_temp.exists_row('public.candidate_submissions', :'sub_kept'), true, 'AC3: the requirement filled 729 days ago is kept with its response and submission');
select is(pg_temp.exists_row('public.workforce_requirements', :'r_open'), true, 'AC3: the open requirement is kept whatever its age');
select is(pg_temp.exists_row('public.candidate_submissions', :'sub_withdrawn_old'), false, 'AC3: the submission withdrawn 731 days ago is deleted');
select is(pg_temp.exists_row('public.candidate_submissions', :'sub_expired_old'), false, 'an expired request 731 days old is deleted');
select is(pg_temp.exists_row('public.candidate_submissions', :'sub_live') and pg_temp.exists_row('public.candidate_submissions', :'sub_declined_recent'),
  true, 'a live submission and a recent decline on the open requirement are kept');
select is(pg_temp.exists_row('public.workforce_requirements', :'r_reported') and pg_temp.exists_row('public.partner_responses', :'resp_reported'),
  true, 'a requirement whose response is under a report in review is kept, with the response, until the report closes');
select is(pg_temp.exists_row('public.workforce_requirements', :'r_moderated') or pg_temp.exists_row('public.partner_responses', :'resp_moderated'),
  false, 'the requirement with the hidden response is deleted with it');
select results_eq(
  $$select entity_id, (metadata ->> 'days')::integer, (metadata ->> 'removed')::integer from audit.log
    where action = 'retention.run' and entity_id in ('candidate_submissions', 'partner_responses', 'closed_requirements', 'job_order_metrics')
    order by entity_id$$,
  $$values ('candidate_submissions', 730, 3), ('closed_requirements', 730, 2), ('job_order_metrics', 730, 2), ('partner_responses', 730, 2)$$,
  'AC3: one audit row per entity with its period and count (private.record_retention)'
);
select is(
  (select string_agg(organization_id::text, ',') from stats.job_order_partner_weeks) || '|'
    || (select string_agg(organization_id::text, ',') from stats.job_order_response_refusals),
  :'alpha' || '|' || :'bravo', 'the job order metrics older than their period are deleted, the others kept'
);

select private.apply_retention();
select is(
  (select string_agg(format('%s:%s', entity_id, metadata ->> 'removed'), ',' order by entity_id) from (
     select distinct on (entity_id) entity_id, metadata from audit.log
     where action = 'retention.run' and entity_id in ('candidate_submissions', 'partner_responses', 'closed_requirements', 'job_order_metrics')
     order by entity_id, id desc) l),
  'candidate_submissions:0,closed_requirements:0,job_order_metrics:0,partner_responses:0',
  'AC3: a second run the same day deletes nothing and records count 0'
);

-- FR-S1: the decision on the deleted response stays listed -------------------------------------------------------------------------
select is(
  (select format('%s|%s|%s', target_type, organization_id, title) from private.moderated_item_tombstones where target_id = :'resp_moderated'),
  format('partner_response|%s|%s', :'bravo', :'moderated_title'),
  'V57: the deleted response keeps its organisation and the title Bravo knew'
);
select is(pg_temp.run(:'trust', 'select * from public.admin_list_appeals(''open'')'), 'ok', 'Trust & Safety lists the open appeals');
select is(
  (select format('%s|%s|%s', r ->> 'target_type', r ->> 'organization_id', r ->> 'title') from jsonb_array_elements(pg_temp.result()) r
   where (r ->> 'id')::bigint = :appeal),
  format('partner_response|%s|%s', :'bravo', :'moderated_title'),
  'V57: the appeal of a decision whose item retention deleted stays in the appeal list with its title'
);
select is(pg_temp.run(:'pb', format('select * from public.list_my_appeals(%s)', :act)), 'ok', 'Bravo''s owner reads the decision');
select is(
  (select format('%s|%s|%s|%s', r ->> 'in_effect', r ->> 'can_appeal', r ->> 'appeal_id', r ->> 'organization_id')
   from jsonb_array_elements(pg_temp.result()) r),
  format('false|false|%s|%s', :appeal, :'bravo'), 'and its appeal, no longer in effect, with nothing left to appeal'
);
select is(pg_temp.run(:'pa', format('select * from public.list_my_appeals(%s)', :act)) || ':' || jsonb_array_length(pg_temp.result()),
  'ok:0', 'NFR-S8: Alpha reads nothing of Bravo''s decision');
select is(pg_temp.run(:'trust_b', format('select * from public.decide_appeal(%s, ''restore'', %L)', :appeal, 'The licences were valid after all.')),
  'ok', 'a second reviewer decides the appeal');
select is(
  (select format('%s|%s', a.status, a.reversal_action_id is null) from public.appeals a where a.id = :appeal), 'restored|t',
  'the appeal is restored with nothing to undo'
);
select is(
  (select metadata ->> 'target_deleted' from audit.log where action = 'appeal.restored' and entity_id = :appeal::text), 'true',
  'and its audit row says the item was deleted'
);

-- AC5: erasure of the candidate ---------------------------------------------------------------------------------------------------
select pg_temp.seed(:'r_kept', :'alpha', :'wb', 'awaiting_candidate') as sub_wb_awaiting \gset
select pg_temp.seed(:'r_open', :'alpha', null, 'awaiting_candidate', p_email => :'wb' || '@example.test') as sub_wb_unclaimed \gset
select pg_temp.seed(:'r_kept', :'bravo', :'wa', 'awaiting_candidate') as sub_wa_kept \gset
select passport_share_id as share_wb from public.candidate_submissions where id = :'sub_kept' \gset
update public.profiles set deleted_at = now() - interval '40 days' where id = :'wb';

select is(public.erase_user(:'wb'), true, 'AC5: erase_user runs for the candidate');
select is(
  (select count(*)::integer from public.candidate_submissions
   where id in (:'sub_kept', :'sub_wb_awaiting', :'sub_wb_unclaimed', :'sub_declined_recent')),
  0, 'AC5: the approved submission, the request awaiting the candidate, a request still waiting for the address and a declined one are deleted'
);
select is((select count(*)::integer from public.passport_shares where id = :'share_wb'), 0, 'AC5: with the passport share by submission');
select is(
  (select count(*)::integer from public.candidate_submissions where id in (:'sub_wa_kept', :'sub_live')), 2,
  'another candidate''s submissions are untouched'
);
select is(
  (select metadata -> 'deleted' from audit.log where action = 'account.erased'),
  '{"candidate_submissions": 4, "submission_passport_shares": 1, "contact_requests": 0, "messages": 0}'::jsonb,
  'AC5: the audit row counts what was deleted, without the candidate''s name or address'
);
select is((select count(*)::integer from audit.log where action = 'account.erased' and metadata::text ~ (:'wb' || '|Bruno|Silva')), 0,
  'and names neither the candidate nor the address');
select is(public.erase_user(:'wb'), false, 'AC5: a second run changes nothing');

-- AC7: the export -----------------------------------------------------------------------------------------------------------------
insert into public.data_export_requests (id, user_id) values
  ('00000000-0000-0000-0000-000000184101', :'wa'), ('00000000-0000-0000-0000-000000184102', :'pa'),
  ('00000000-0000-0000-0000-000000184103', :'own1'), ('00000000-0000-0000-0000-000000184104', :'own2');
select public.account_ops_export_data('00000000-0000-0000-0000-000000184101') -> 'sections' as wa_data \gset
select public.account_ops_export_data('00000000-0000-0000-0000-000000184102') -> 'sections' as pa_data \gset

select is(
  (select string_agg(format('%s|%s|%s|%s', s ->> 'side', s ->> 'partner', s ->> 'status', s -> 'shared_documents'), ',' order by s ->> 'status')
   from jsonb_array_elements((:'wa_data'::jsonb) -> 'submissions') s),
  'candidate|Bravo|awaiting_candidate|[],candidate|Alpha|submitted|["' || (select title from public.worker_documents where id = :'d1') || '"]',
  'AC7: the candidate''s submissions.json holds each submission with the partner, the status and the shared document names'
);
select is(
  (select format('%s|%s|%s', s ->> 'job_order', s ->> 'requested_at' is not null, jsonb_array_length(s -> 'history'))
   from jsonb_array_elements((:'wa_data'::jsonb) -> 'submissions') s where s ->> 'status' = 'submitted'),
  'Painters for Bremen|t|1', 'AC7: with the job order as the candidate may read it, the dates and the history'
);
select is(
  (select string_agg(format('%s|%s|%s', s ->> 'side', s ->> 'organization', s ->> 'status'), ',' order by s ->> 'status')
   from jsonb_array_elements((:'pa_data'::jsonb) -> 'submissions') s),
  'partner|Alpha|submitted', 'AC7: a partner member''s copy holds the requests they sent for the company'
);
select ok(((:'pa_data'::jsonb) -> 'submissions')::text !~ ('@example\.test|Amina|Okafor|' || :'wa'),
  'AC7: never the candidate''s address, account or name');

select is(
  (select string_agg(format('%s|%s', r ->> 'organization', r ->> 'title'), ',')
   from jsonb_array_elements((public.account_ops_export_data('00000000-0000-0000-0000-000000184103') -> 'sections') -> 'requirements') r),
  null, 'the requirement own1 wrote went with retention too'
);
select is(
  (select string_agg(format('%s|%s|%s', r ->> 'organization', r ->> 'title', r ->> 'status'), ',')
   from jsonb_array_elements((public.account_ops_export_data('00000000-0000-0000-0000-000000184104') -> 'sections') -> 'requirements') r),
  'Beta Works|Scaffolders for Kiel|open', 'AC7: an employer member''s copy holds the requirements they wrote'
);
select is(
  (select string_agg(format('%s|%s|%s', r ->> 'organization', r ->> 'job_order', r ->> 'status'), ',')
   from jsonb_array_elements((public.account_ops_export_data('00000000-0000-0000-0000-000000184102') -> 'sections') -> 'partner_responses') r),
  'Alpha|' || private.job_order_neutral_title(:'r_written') || '|submitted',
  'AC7: a partner member''s copy holds the responses they sent (the one to a deleted requirement went with it), with the job order as the company knows it'
);
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(:'wa_data'::jsonb) k where k in ('submissions', 'requirements', 'partner_responses')),
  'partner_responses,requirements,submissions', 'AC7: the three sections are written for every account (empty lists when none)'
);

-- FR-S2: job order metrics ------------------------------------------------------------------------------------------------------
create function pg_temp.counts(p_metrics text[]) returns text
language plpgsql as $$
begin
  if pg_temp.run(current_setting('t.padmin')::uuid,
       format('select * from public.admin_network_counts(%L, %L, ''month'')', date_trunc('month', now())::date, current_date)) <> 'ok' then
    return 'refused';
  end if;
  return coalesce((select string_agg(format('%s:%s', r ->> 'metric', coalesce(r ->> 'count', 'null')), ',' order by (r ->> 'metric'))
    from jsonb_array_elements(pg_temp.result()) r where r ->> 'metric' = any (p_metrics)), '');
end;
$$;
select set_config('t.padmin', :'padmin', true);

select pg_temp.req(:'acme', 'Requirement ' || n, 'open', 0) from generate_series(1, 5) n;
insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source)
select r.id, :'alpha', :'acme', 'directory' from public.workforce_requirements r where r.title like 'Requirement %';

select is(
  pg_temp.counts(array['requirements', 'job_orders', 'invitations', 'responses', 'selections', 'submissions', 'hires']),
  (select string_agg(format('%s:%s', m, coalesce(case when n >= 5 then n::text end, 'null')), ',' order by m)
   from (select m.metric as m, (select count(*) from stats.network_events e
                              where e.metric = m.metric and e.occurred_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc') as n
         from unnest(array['requirements', 'job_orders', 'invitations', 'responses', 'selections', 'submissions', 'hires']) m (metric)) x),
  'FR-S2: each job order metric counts its events of the month, null below the threshold'
);
select ok(pg_temp.counts(array['requirements']) = 'requirements:' || (select count(*) from public.workforce_requirements
  where published_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'), 'FR-S2: requirements published this month are counted');
select ok(pg_temp.counts(array['selections', 'hires']) = 'hires:null,selections:null', 'FR-S2: fewer than five selections and hires are hidden');
select ok((select count(*) from stats.network_events e where e.metric in ('selections', 'hires')) < 5, 'and there are fewer than five');
update private.settings set value = 'false' where key = 'release_candidate_submissions';
select ok(pg_temp.counts(array['submissions', 'hires', 'responses']) ~ '^responses:', 'FR-S2: submissions and hires are not listed while their release is off');
select is(pg_temp.counts(array['submissions', 'hires']), '', 'nor counted');
update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.counts(array['requirements', 'job_orders', 'invitations', 'responses', 'selections']), '',
  'FR-S2: no job order metric while release 2b is off');
select ok(pg_temp.counts(array['partner_follows']) ~ '^partner_follows:', 'the partner metrics stay');
update private.settings set value = 'true' where key in ('release_job_orders', 'release_candidate_submissions');
select is(pg_temp.call_as(:'trust', 'authenticated',
  format('select public.admin_network_counts(%L, %L)', date_trunc('month', now())::date, current_date)),
  'P0001|CHARA_FORBIDDEN|', 'FR-S2 AC4: Trust & Safety reads no counts');
select is(pg_temp.call_as(:'padmin', 'authenticated',
  format('select public.admin_network_counts(%L, %L)', date_trunc('month', now())::date, current_date), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'FR-S2 AC4: the administrator at aal1 is sent to two-step verification');

-- NFR-S8: the tombstones are read by no API role ----------------------------------------------------------------------------------
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.moderated_item_tombstones'::regclass),
  'NFR-S8: RLS is enabled and forced on the tombstones'
);
select is(
  (select string_agg(r, ',' order by r) from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_table_privilege(r, 'private.moderated_item_tombstones', 'select, insert, update, delete')),
  null, 'NFR-S8: no API role holds a privilege on them'
);
select is(
  (select string_agg(pg_temp.call_as(u, case when u is null then 'anon' else 'authenticated' end,
      'select count(*) from private.moderated_item_tombstones'), ',')
   from unnest(array[:'own1', :'own2', :'pa', :'pb', :'wa', :'wb', null]::uuid[]) u),
  rtrim(repeat('42501|permission denied for table moderated_item_tombstones|,', 7), ','),
  'NFR-S8: neither employer, partner, candidate nor a visitor reads them'
);
select is(
  (select string_agg(pg_temp.call_as(u, 'authenticated', 'select private.moderated_item_owner(''partner_response'', gen_random_uuid())'), ',')
   from unnest(array[:'own1', :'pb']::uuid[]) u),
  rtrim(repeat('42501|permission denied for function moderated_item_owner|,', 2), ','),
  'and nobody calls the lookup'
);
select is(
  (select string_agg(r, ',') from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_table_privilege(r, 'stats.network_events', 'select')),
  null, 'FR-S2 AC4: the view of the events stays closed to the API roles'
);

select * from finish();
rollback;
