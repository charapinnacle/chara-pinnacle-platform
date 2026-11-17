begin;
select plan(42);

\ir organizations_fixture.inc

-- The release 2c blocks of the dashboards (V75; FR-R3, FR-R4, FR-R5 release 2c parts, FR-R4 AC6, FR-R5 AC5, FR-Q1 AC10;
-- NFR-S8 with two employers, two recruitment companies and a staffing company, two candidates and anonymous; NFR-S9):
-- the partner requests and matching workers of get_partner_dashboard, the requests and matching workers of
-- get_employer_network_dashboard, private.dashboard_matching_workers and my_contact_request_counts.
-- Employer A (Professional) posts an open requirement for welders (7212) in DE, a draft for PL, an open vacancy for
-- 9329 in NL and a closed one for 7212 in PL; C (Starter) needs 9329 in NL; B (Professional) needs nothing; F has no
-- plan and L a canceled subscription. Recruitment company R lists 7212 and serves DE and PL, R2 nothing; staffing company
-- S lists 5120 and serves DE; P awaits approval. Six listed welders prefer DE, one PL, one 9329 worker NL and one cook DE;
-- a hidden welder and a suspended one prefer DE too.

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_slug text, p_plan text, p_listed boolean default true)
returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  if p_type <> 'employer' and p_listed then
    update public.organizations set review_status = 'listed', listed_at = now() - interval '3 days',
      submitted_at = now() - interval '4 days'
    where id = v_id;
  end if;
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  end if;
  return v_id;
end;
$$;

create function pg_temp.req(p_org uuid, p_status text, p_occupation text, p_country text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on, close_reason
  ) values (
    v_id, p_org, 'Requirement ' || p_occupation, 10, p_country, 'Hamburg', 'C', date '2027-06-01', 'full_time', 'both',
    'both', p_status::public.requirement_status,
    case when p_status <> 'draft' then 'job_order_marketplace'::public.requirement_visibility end,
    case when p_status <> 'draft' then now() - interval '1 day' end, case when p_status <> 'draft' then date '2027-07-01' end,
    case when p_status = 'closed' then 'cancelled' end::public.requirement_close_reason
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, p_occupation, 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, p_country);
  return v_id;
end;
$$;

create function pg_temp.job(p_org uuid, p_status text, p_occupation text, p_country text) returns void
language sql as $$
  insert into public.jobs (organization_id, title, description, occupation_id, industry_code, country_code, city,
    employment_type, recruitment_preference, status, published_at)
  values (p_org, 'Vacancy ' || p_occupation, btrim(repeat('A vacancy of the dashboard test. ', 4)), p_occupation, 'C', p_country, 'Town',
    'full_time', 'both', p_status::public.job_status, now())
$$;

create function pg_temp.worker(p_occupation text, p_countries text[], p_searchable boolean default true) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(v_id, 'worker');
  update public.profiles set account_kind = 'worker' where id = v_id;
  insert into public.worker_profiles (user_id, first_name, last_name, current_country, occupation_id, headline,
    years_experience, availability, searchable)
  values (v_id, 'Amina', 'Okafor', 'NG', p_occupation, 'Worker ' || p_occupation, 5, 'now', p_searchable);
  insert into public.worker_preferred_countries (worker_user_id, country_code) select v_id, c from unnest(p_countries) c;
  return v_id;
end;
$$;

-- A connection of p_kind from p_from to p_to in its own conversation.
create function pg_temp.connection(p_from uuid, p_to uuid, p_kind text, p_status text, p_requirement uuid default null)
returns void
language plpgsql as $$
declare
  v_conversation uuid;
begin
  insert into public.conversations (context_type, context_id, requirement_id)
  values (case when p_kind = 'inquiry' then 'inquiry' else 'requirement_invitation' end::public.conversation_context,
    gen_random_uuid(), p_requirement)
  returning id into v_conversation;
  insert into public.connections (kind, from_organization_id, to_organization_id, conversation_id, requirement_id, status,
    status_changed_at)
  values (p_kind::public.connection_kind, p_from, p_to, v_conversation, p_requirement, p_status::public.connection_status,
    case when p_status <> 'sent' then now() end);
end;
$$;

create function pg_temp.request(p_org uuid, p_worker uuid, p_status text, p_expires interval) returns void
language sql as $$
  insert into public.contact_requests (organization_id, worker_user_id, card_id, message, status, created_at, expires_at,
    responded_at)
  select p_org, p_worker, w.card_id, 'Welding work in Hamburg.', p_status::public.contact_request_status,
    now() - interval '1 day', now() + p_expires, case when p_status in ('accepted', 'declined') then now() end
  from public.worker_profiles w where w.user_id = p_worker
$$;

-- The row of p_fn(p_org) as p_user (null: anonymous) at aal2, kept in t.result; returns 'ok' or the refusal.
create function pg_temp.dash(p_fn text, p_user uuid, p_org uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from public.%I(%L) r)::text, ''[]''), true)',
      p_fn, p_org))
$$;

-- The 2c figures of p_fn(p_org) as its owner p_user, or the refusal.
create function pg_temp.figures(p_fn text, p_user uuid, p_org uuid) returns text
language plpgsql as $$
declare
  v_answer text := pg_temp.dash(p_fn, p_user, p_org);
  v_row jsonb;
begin
  if v_answer <> 'ok' then
    return v_answer;
  end if;
  v_row := current_setting('t.result')::jsonb -> 0;
  return concat_ws('|',
    coalesce(v_row ->> 'partner_requests', v_row ->> 'partner_requests_waiting', 'null'),
    coalesce(v_row ->> 'partner_inquiries', v_row ->> 'partner_requests_answered', 'null'),
    coalesce(v_row ->> 'matching_workers', 'null'), v_row ->> 'matching_workers_suppressed',
    coalesce(v_row ->> 'matching_workers_fewer_than', 'null'), coalesce(v_row ->> 'matching_workers_reason', 'null'));
end;
$$;

create function pg_temp.counts(p_user uuid) returns text
language plpgsql as $$
declare
  v_answer text;
begin
  perform set_config('t.counts', '', true);
  v_answer := pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    $f$select set_config('t.counts', (select pending || '|' || received from public.my_contact_request_counts()), true)$f$);
  return v_answer || coalesce(':' || nullif(current_setting('t.counts'), ''), '');
end;
$$;

\set aown '00000000-0000-0000-0000-000000214001'
\set amem '00000000-0000-0000-0000-000000214002'
\set bown '00000000-0000-0000-0000-000000214003'
\set cown '00000000-0000-0000-0000-000000214004'
\set fown '00000000-0000-0000-0000-000000214005'
\set lown '00000000-0000-0000-0000-000000214006'
\set rown '00000000-0000-0000-0000-000000214007'
\set rmem '00000000-0000-0000-0000-000000214008'
\set r2own '00000000-0000-0000-0000-000000214009'
\set sown '00000000-0000-0000-0000-000000214010'
\set pown '00000000-0000-0000-0000-000000214011'

select pg_temp.new_user(u) from unnest(array[:'aown', :'amem', :'bown', :'cown', :'fown', :'lown', :'rown', :'rmem', :'r2own',
  :'sown', :'pown']::uuid[]) u;
update public.profiles set account_kind = intended_account_kind
where id in (:'aown', :'amem', :'bown', :'cown', :'fown', :'lown', :'rown', :'rmem', :'r2own', :'sown', :'pown');

select pg_temp.new_org(:'aown', 'employer', 'v75-acme', 'employer_professional') as a \gset
select pg_temp.new_org(:'bown', 'employer', 'v75-beta', 'employer_professional') as b \gset
select pg_temp.new_org(:'cown', 'employer', 'v75-cosy', 'employer_starter') as c \gset
select pg_temp.new_org(:'fown', 'employer', 'v75-free', null) as f \gset
select pg_temp.new_org(:'lown', 'employer', 'v75-lapsed', null) as l \gset
select pg_temp.new_org(:'rown', 'recruitment_company', 'v75-recruit-one', 'recruitment_partner') as r \gset
select pg_temp.new_org(:'r2own', 'recruitment_company', 'v75-recruit-two', 'recruitment_partner') as r2 \gset
select pg_temp.new_org(:'sown', 'staffing_company', 'v75-staffing', 'staffing_partner') as s \gset
select pg_temp.new_org(:'pown', 'recruitment_company', 'v75-pending', 'recruitment_partner', false) as p \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'l', 'employer_professional', 'canceled', 'null');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (:'a', :'amem', 'member', now()), (:'r', :'rmem', 'member', now());

select pg_temp.req(:'a', 'open', '7212', 'DE') as q_open \gset
select pg_temp.req(:'a', 'draft', '7212', 'PL') as q_draft \gset
select pg_temp.req(:'a', 'closed', '7212', 'DE') as q_closed \gset
select pg_temp.req(:'c', 'open', '9329', 'NL') as q_c \gset
select pg_temp.job(:'a', 'open', '9329', 'NL');
select pg_temp.job(:'a', 'closed', '7212', 'PL');
insert into public.organization_occupations (organization_id, occupation_id) values (:'r', '7212'), (:'s', '5120'), (:'p', '7212');
insert into public.organization_geographies (organization_id, scope, country_code) values
  (:'r', 'serves_market', 'DE'), (:'r', 'serves_market', 'PL'), (:'r', 'sources_from', 'NG'), (:'s', 'serves_market', 'DE'),
  (:'p', 'serves_market', 'DE');

select pg_temp.worker('7212', array['DE', 'AT']) as w1 \gset
select pg_temp.worker('7212', array['DE']) as w2 \gset
select count(pg_temp.worker('7212', array['DE'])) as extra from generate_series(1, 3) \gset
select pg_temp.worker('7212', array['DE', 'PL']) as w_both \gset
select pg_temp.worker('7212', array['PL']) as w_pl \gset
select pg_temp.worker('9329', array['NL']) as w_nl \gset
select pg_temp.worker('5120', array['DE']) as w_cook \gset
select pg_temp.worker('7212', array['DE'], false) as w_hidden \gset
select pg_temp.worker('7212', array['DE']) as w_susp \gset
update public.profiles set status = 'suspended' where id = :'w_susp';

-- Requests to R: two inquiries waiting (from A and B), one answered, a workforce request waiting on an open requirement,
-- one on a closed requirement and one declined; to S a workforce request waiting on a draft requirement.
select pg_temp.connection(:'a', :'r', 'inquiry', 'sent');
select pg_temp.connection(:'b', :'r', 'inquiry', 'sent');
select pg_temp.connection(:'a', :'r', 'inquiry', 'answered');
select pg_temp.connection(:'a', :'r', 'request_workforce', 'sent', :'q_open');
select pg_temp.connection(:'a', :'r', 'request_workforce', 'sent', :'q_closed');
select pg_temp.connection(:'a', :'r', 'request_workforce', 'declined', :'q_open');
select pg_temp.connection(:'a', :'s', 'request_workforce', 'sent', :'q_draft');

-- w1's requests: one waiting, one waiting past its expiry (expired as read), one accepted, one declined, and one waiting
-- that Trust & Safety hid (V73), which the worker no longer reads.
select pg_temp.request(:'a', :'w1', 'pending', interval '20 days');
select pg_temp.request(:'b', :'w1', 'pending', interval '-1 hour');
select pg_temp.request(:'c', :'w1', 'accepted', interval '20 days');
select pg_temp.request(:'r', :'w1', 'declined', interval '20 days');
select pg_temp.request(:'s', :'w1', 'pending', interval '20 days');
update public.contact_requests set moderation_state = 'hidden' where organization_id = :'s' and worker_user_id = :'w1';

update private.settings set value = 'true'
where key in ('release_partner_directories', 'release_job_orders', 'release_messaging', 'release_find_workers',
  'entitlements_enforced');

-- Shape --------------------------------------------------------------------------------------------------------------------
select is(
  (select string_agg(a.name, ',' order by a.ord)
   from pg_proc p cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality as a (name, mode, ord)
   where p.oid = 'public.get_partner_dashboard(uuid)'::regprocedure and a.mode = 't' and a.ord > 27),
  'partner_requests,partner_inquiries,matching_workers,matching_workers_suppressed,matching_workers_fewer_than,'
  || 'matching_workers_reason',
  'FR-R4 AC6, NFR-S9: the 2c columns of the partner dashboard are counts and flags after the earlier ones, no card or worker'
);
select is(
  (select string_agg(a.name, ',' order by a.ord)
   from pg_proc p cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality as a (name, mode, ord)
   where p.oid = 'public.get_employer_network_dashboard(uuid)'::regprocedure and a.mode = 't' and a.ord > 19),
  'partner_requests_waiting,partner_requests_answered,matching_workers,matching_workers_suppressed,'
  || 'matching_workers_fewer_than,matching_workers_reason',
  'FR-R5 AC5, NFR-S9: the 2c columns of the employer dashboard are counts and flags after the earlier ones, no card or worker'
);
select ok(
  not has_function_privilege('anon', 'public.my_contact_request_counts()', 'execute')
  and not has_function_privilege('service_role', 'public.my_contact_request_counts()', 'execute')
  and has_function_privilege('authenticated', 'public.my_contact_request_counts()', 'execute')
  and not has_function_privilege('authenticated', 'private.dashboard_matching_workers(uuid)', 'execute')
  and (select bool_and(prosecdef and provolatile = 's' and proconfig @> array['search_path=""']) from pg_proc
       where oid in ('public.my_contact_request_counts()'::regprocedure, 'public.get_partner_dashboard(uuid)'::regprocedure,
         'public.get_employer_network_dashboard(uuid)'::regprocedure, 'private.dashboard_matching_workers(uuid)'::regprocedure)),
  'the counts are for signed-in users only, the helper for nobody of the API; all are stable security definers'
);

-- Partner requests (FR-R4 AC6) -----------------------------------------------------------------------------------------------
select is(pg_temp.figures('get_partner_dashboard', :'rown', :'r'), '3|2|7|false|null|null',
  'FR-R4 AC6: R has 3 requests waiting (2 inquiries and the request on an open requirement); answered, declined and a closed requirement''s are not counted; 7 workers match');
select is(pg_temp.figures('get_partner_dashboard', :'rmem', :'r'), '3|2|7|false|null|null', 'a member of R reads the same figures');
select is(pg_temp.figures('get_partner_dashboard', :'sown', :'s'), '1|0|null|true|5|null',
  'FR-R4 AC6: S has the workforce request on a draft; its one matching cook is fewer than 5 and suppressed');
select is(pg_temp.figures('get_partner_dashboard', :'r2own', :'r2'), '0|0|0|false|null|null',
  'NFR-S8: R2 sees none of R''s requests; no listed occupation or country matches nobody (0, not suppressed)');

-- Matching workers (FR-R5 AC5) -----------------------------------------------------------------------------------------------
select is(pg_temp.figures('get_employer_network_dashboard', :'aown', :'a'), '3|1|7|false|null|null',
  'FR-R5 AC5: A counts the 6 listed welders for DE and the NL worker of its vacancy; hidden, suspended, PL-only (draft and closed needs) and the cook are not counted; 3 of its requests wait (not the one on the closed requirement) and 1 was answered');
select is(pg_temp.figures('get_employer_network_dashboard', :'amem', :'a'), '3|1|7|false|null|null', 'a member of A reads the same figures');
select is(pg_temp.figures('get_employer_network_dashboard', :'cown', :'c'), '0|0|null|true|5|null',
  'FR-R5 AC5: C''s one fitting worker is fewer than 5: null with the suppressed flag');
select is(pg_temp.figures('get_employer_network_dashboard', :'fown', :'f'), '0|0|null|false|null|feature_not_in_plan',
  'FR-R5 AC5: F without a plan has no count, with the reason feature_not_in_plan');
select is(pg_temp.figures('get_employer_network_dashboard', :'lown', :'l'), '0|0|null|false|null|feature_not_in_plan',
  'FR-R5 states: a lapsed employer falls back to the free plan, not in plan');
select is(pg_temp.figures('get_employer_network_dashboard', :'bown', :'b'), '1|0|0|false|null|null',
  'NFR-S8: B counts its own inquiry only; with no open need no worker matches');
select is(pg_temp.figures('get_partner_dashboard', :'pown', :'p'), '0|0|null|false|null|not_listed',
  'a recruitment company awaiting approval cannot search, so it gets the reason not_listed');
update public.organizations set moderation_state = 'hidden' where id = :'r2';
select is(pg_temp.figures('get_partner_dashboard', :'r2own', :'r2'), '0|0|null|false|null|profile_hidden',
  'a partner hidden by moderation gets the reason profile_hidden');
update public.organizations set moderation_state = 'visible' where id = :'r2';

update private.settings set value = '8' where key = 'stats_min_count';
select is(pg_temp.figures('get_partner_dashboard', :'rown', :'r'), '3|2|null|true|8|null',
  'the small-count threshold is the setting stats_min_count');
update private.settings set value = '5' where key = 'stats_min_count';

update public.worker_profiles set searchable = false where user_id = :'w2';
select is(pg_temp.figures('get_employer_network_dashboard', :'aown', :'a'), '3|1|6|false|null|null',
  'FR-Q1: a worker who withdraws is not counted at the next read');
update public.profiles set deleted_at = now() where id = :'w1';
select is(pg_temp.figures('get_employer_network_dashboard', :'aown', :'a'), '3|1|5|false|null|null',
  'FR-Q1 AC7: a worker whose deletion was requested is not counted');
update public.profiles set deleted_at = null where id = :'w1';
update public.worker_profiles set searchable = true where user_id = :'w2';

-- Release switches (FR-R3 AC6, FR-R5 AC7) ------------------------------------------------------------------------------------
update private.settings set value = 'false' where key = 'release_messaging';
select is(pg_temp.figures('get_partner_dashboard', :'rown', :'r'), 'null|null|7|false|null|null',
  'FR-R3 AC6: with messaging off the requests are null, the matching workers stay');
select is(pg_temp.figures('get_employer_network_dashboard', :'aown', :'a'), 'null|null|7|false|null|null',
  'FR-R5 AC7: with messaging off the employer''s requests are null');
update private.settings set value = 'true' where key = 'release_messaging';
update private.settings set value = 'false' where key = 'release_find_workers';
select is(pg_temp.figures('get_partner_dashboard', :'rown', :'r'), '3|2|null|false|null|null',
  'FR-R3 AC6: with Find Workers off matching workers is null without a reason');
select is(pg_temp.figures('get_employer_network_dashboard', :'fown', :'f'), '0|0|null|false|null|null',
  'FR-R5 AC7: with Find Workers off not even the plan notice shows');
select is(pg_temp.counts(:'w1'), 'P0002|CHARA_NOT_FOUND|', 'FR-Q1: with Find Workers off the worker''s counts are not found');
update private.settings set value = 'true' where key = 'release_find_workers';

-- Who may read (NFR-S8) ------------------------------------------------------------------------------------------------------
select is(pg_temp.dash('get_partner_dashboard', :'sown', :'r'), '42501|CHARA_FORBIDDEN|',
  'NFR-S8: the owner of staffing company S is refused for R');
select is(pg_temp.dash('get_partner_dashboard', :'r2own', :'r'), '42501|CHARA_FORBIDDEN|',
  'NFR-S8: the owner of the other recruitment company is refused for R');
select is(pg_temp.dash('get_partner_dashboard', :'aown', :'r'), '42501|CHARA_FORBIDDEN|',
  'NFR-S8: the employer that sent R requests does not read R''s dashboard');
select is(pg_temp.dash('get_employer_network_dashboard', :'bown', :'a'), '42501|CHARA_FORBIDDEN|',
  'NFR-S8: the owner of employer B is refused for A');
select is(pg_temp.dash('get_employer_network_dashboard', :'rown', :'a'), '42501|CHARA_FORBIDDEN|',
  'NFR-S8: the partner A sent requests to does not read A''s dashboard');
select is(pg_temp.dash('get_employer_network_dashboard', :'w1', :'a'), '42501|CHARA_FORBIDDEN|company_account_required',
  'NFR-S8: a candidate is refused for the employer');
select is(pg_temp.dash('get_partner_dashboard', :'w2', :'r'), '42501|CHARA_FORBIDDEN|company_account_required',
  'NFR-S8: a second candidate is refused for the partner');
select matches(pg_temp.dash('get_partner_dashboard', null, :'r'), '^42501\|permission denied for function get_partner_dashboard',
  'anonymous has no EXECUTE on the partner dashboard');
select matches(pg_temp.dash('get_employer_network_dashboard', null, :'a'),
  '^42501\|permission denied for function get_employer_network_dashboard', 'anonymous has no EXECUTE on the employer dashboard');

-- The worker's contact requests (FR-Q1 AC10) -----------------------------------------------------------------------------------
select is(pg_temp.counts(:'w1'), 'ok:1|4',
  'FR-Q1 AC10: one request waits (a pending one past its expiry does not), four were received; the hidden one counts in neither');
select is(pg_temp.counts(:'w2'), 'ok:0|0', 'NFR-S8: another worker counts only their own requests');
select is(pg_temp.counts(:'aown'), '42501|CHARA_FORBIDDEN|worker_account_required', 'a company account has no contact requests to count');
select is(pg_temp.counts(:'rown'), '42501|CHARA_FORBIDDEN|worker_account_required', 'a partner account neither');
select matches(pg_temp.counts(null), '^42501\|permission denied for function my_contact_request_counts', 'anonymous has no EXECUTE');
select is(
  (select count(*)::integer from public.contact_requests where worker_user_id = :'w1' and status = 'pending'), 3,
  'reading the counts writes nothing: the stored statuses are unchanged'
);

-- Isolation --------------------------------------------------------------------------------------------------------------------
select is(pg_temp.figures('get_partner_dashboard', :'sown', :'s'), '1|0|null|true|5|null', 'S still reads only its own request');
select is(
  (select count(*)::integer from public.connections where to_organization_id = :'r'), 6,
  'the six connections to R are all there, read through the dashboard only as counts'
);

-- Needs that stop being open ------------------------------------------------------------------------------------------------
select set_config('chara.actor_fn', 'pause_requirements_on_lapse', true) as actor \gset
update public.workforce_requirements set status = 'paused' where id = :'q_open';
select set_config('chara.actor_fn', '', true) as actor \gset
select is(pg_temp.figures('get_employer_network_dashboard', :'aown', :'a'), '3|1|null|true|5|null',
  'a paused requirement is not a need: only the NL vacancy''s worker matches, fewer than 5');
select set_config('chara.actor_fn', 'pause_jobs_on_lapse', true) as actor \gset
update public.jobs set status = 'paused' where organization_id = :'a' and occupation_id = '9329';
select set_config('chara.actor_fn', '', true) as actor \gset
select is(pg_temp.figures('get_employer_network_dashboard', :'aown', :'a'), '3|1|0|false|null|null',
  'nothing open, nothing matches (0, not suppressed)');

select * from finish();
rollback;
