begin;
select plan(100);

\ir jobs_fixture.inc

-- Contact requests (V70; FR-Q3 AC1 to AC10; NFR-S8, NFR-S9, NFR-A3, NFR-O5): send_contact_request,
-- respond_to_contact_request, withdraw_contact_request, list_contact_requests_sent, list_contact_requests_received,
-- card_contact_requests, private.expire_contact_requests, public.contact_requests, the two notices and the conversation of
-- context contact_request. Acme (t.a: owner own1, admin adm, member mem; based in DE) is on Starter and Beta (t.b: owner
-- own2, admin adm2; based in GB) on Professional; Rekrut (licensed for DE) and Plain are listed recruitment companies on a
-- paid plan, Free an employer without a plan. Workers are written as the database owner with searchable set, as
-- set_worker_visibility (V68) leaves them, and are named by a tag.

\set urb '00000000-0000-0000-0000-0000000f7001'
\set upl '00000000-0000-0000-0000-0000000f7002'
\set ufe '00000000-0000-0000-0000-0000000f7003'
\set mem2 '00000000-0000-0000-0000-0000000f7004'

update private.settings set value = 'true' where key in ('release_find_workers', 'release_messaging');
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (current_setting('t.a')::uuid, 'employer_starter', 'active', 'null'),
  (current_setting('t.b')::uuid, 'employer_professional', 'active', 'null');
select pg_temp.new_user(:'mem2');
update public.profiles set account_kind = intended_account_kind where id = :'mem2';
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.a')::uuid, :'mem2', 'member', now());

create function pg_temp.org(p_slug text, p_owner uuid, p_type text, p_plan text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug, initcap(replace(p_slug, '-', ' ')), 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  if p_type <> 'employer' then
    update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
      submitted_at = now() - interval '31 days'
    where id = v_id;
  end if;
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  end if;
  return v_id;
end;
$$;

select set_config('t.rb', pg_temp.org('v70-rekrut', :'urb', 'recruitment_company', 'recruitment_partner')::text, true);
select set_config('t.pl', pg_temp.org('v70-plain', :'upl', 'recruitment_company', 'recruitment_partner')::text, true);
select set_config('t.fr', pg_temp.org('v70-free', :'ufe', 'employer', null)::text, true);
insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until, confirmed_at,
  partner_terms_version)
values (current_setting('t.rb')::uuid, 'DE', 'Bundesagentur', 'DE-123', current_date + 100, now(), 1);
insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref) values
  ('PH', 'DE', 'blocked', 'Direct hiring from the Philippines to Germany is not allowed.', 'LO-1'),
  ('NP', 'DE', 'licensed_partner_required', 'Hiring from Nepal to Germany needs a licensed recruitment partner.', 'LO-2');

create temp table tags (user_id uuid primary key, tag text unique not null);

create function pg_temp.worker(p_tag text, p_country text default 'NG', p_searchable boolean default true) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(v_id, 'worker');
  update public.profiles set account_kind = 'worker' where id = v_id;
  insert into public.worker_profiles (user_id, first_name, last_name, current_country, occupation_id, headline,
    years_experience, availability, searchable)
  values (v_id, 'Amina', 'Okafor', p_country, '7212', 'Welder ' || p_tag, 5, 'now', p_searchable);
  insert into tags values (v_id, p_tag);
  return v_id;
end;
$$;

create function pg_temp.uid(p_tag text) returns uuid language sql as $$ select user_id from tags where tag = p_tag $$;
create function pg_temp.card(p_tag text) returns uuid
language sql as $$ select w.card_id from public.worker_profiles w join tags t on t.user_id = w.user_id where t.tag = p_tag $$;

-- send_contact_request as p_user: 'ok' with the id in t.req, or 'sqlstate|message|detail'.
create function pg_temp.send(
  p_user uuid, p_org uuid, p_card uuid, p_message text default 'We would like to talk to you about welding work in Hamburg.',
  p_job uuid default null, p_destination text default null
) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.req', public.send_contact_request(%L, %L, %L, %L, %L)::text, true)$f$,
    p_org, p_card, p_message, p_job, p_destination), 'aal1')
$$;

create function pg_temp.respond(p_user uuid, p_request uuid, p_decision text) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select set_config('t.conv', coalesce(public.respond_to_contact_request(%L, %L)::text, ''), true)$f$,
    p_request, p_decision), 'aal1')
$$;

-- A request of p_org to p_tag written as the database owner, p_days ago, in p_status.
create function pg_temp.old_request(p_org uuid, p_tag text, p_days integer, p_status text) returns uuid
language sql as $$
  insert into public.contact_requests (organization_id, worker_user_id, card_id, message, status, created_at, expires_at,
    responded_at, withdrawn_at)
  values (p_org, pg_temp.uid(p_tag), pg_temp.card(p_tag), 'An earlier request.', p_status::public.contact_request_status,
    now() - make_interval(days => p_days), now() - make_interval(days => p_days) + interval '30 days',
    case when p_status in ('accepted', 'declined') then now() - make_interval(days => p_days) end,
    case when p_status = 'withdrawn' then now() - make_interval(days => p_days) end)
  returning id
$$;

select pg_temp.worker('w') as w \gset
select pg_temp.worker('v') as v \gset
select pg_temp.worker('x') as x \gset
select pg_temp.worker('ph', 'PH') as ph \gset
select pg_temp.worker('np', 'NP') as np \gset
select pg_temp.worker('hidden', 'NG', false) as hidden \gset
select pg_temp.worker('susp') as susp \gset
update public.profiles set status = 'suspended' where id = :'susp';

-- Vacancies in each state, moved through the status guard by their owners before the plan limits apply.
create function pg_temp.job_in(p_owner uuid, p_org uuid, p_title text, p_steps text[]) returns void
language plpgsql as $$
declare
  v_id uuid;
  v_step text;
begin
  perform pg_temp.call_as(p_owner, 'authenticated', pg_temp.insert_job(p_org, jsonb_build_object('title', p_title)), 'aal1');
  select id into v_id from public.jobs where title = p_title;
  foreach v_step in array p_steps loop
    perform pg_temp.set_status(p_owner, v_id, v_step);
  end loop;
end;
$$;
select pg_temp.job_in(:'own1', current_setting('t.a')::uuid, 'Welder MIG/MAG', array['open']);
select pg_temp.job_in(:'own1', current_setting('t.a')::uuid, 'Draft welder', array[]::text[]);
select pg_temp.job_in(:'own1', current_setting('t.a')::uuid, 'Paused welder', array['open', 'paused']);
select pg_temp.job_in(:'own1', current_setting('t.a')::uuid, 'Closed welder', array['open', 'closed']);
select pg_temp.job_in(:'own1', current_setting('t.a')::uuid, 'Hidden welder', array['open']);
select pg_temp.job_in(:'own2', current_setting('t.b')::uuid, 'Beta welder', array['open']);
update public.jobs set moderation_state = 'hidden' where title = 'Hidden welder';
update private.settings set value = 'true' where key = 'entitlements_enforced';
create function pg_temp.job(p_title text) returns uuid language sql as $$ select id from public.jobs where title = p_title $$;
select set_config('t.job', pg_temp.job('Welder MIG/MAG')::text, true);
select is(
  (select string_agg(title || ':' || status || ':' || moderation_state, ',' order by title) from public.jobs
   where organization_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid)),
  'Beta welder:open:visible,Closed welder:closed:visible,Draft welder:draft:visible,Hidden welder:open:hidden,Paused welder:paused:visible,Welder MIG/MAG:open:visible',
  'setup: the vacancies are in their states'
);

-- Shape ---------------------------------------------------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.send_contact_request(uuid, uuid, text, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.send_contact_request(uuid, uuid, text, uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.respond_to_contact_request(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.respond_to_contact_request(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.withdraw_contact_request(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.withdraw_contact_request(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.list_contact_requests_sent(uuid, text, timestamptz, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.list_contact_requests_sent(uuid, text, timestamptz, uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.list_contact_requests_received(integer)', 'execute')
  and not has_function_privilege('anon', 'public.list_contact_requests_received(integer)', 'execute')
  and has_function_privilege('authenticated', 'public.card_contact_requests(uuid, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.card_contact_requests(uuid, uuid[])', 'execute')
  and not has_function_privilege('service_role', 'public.send_contact_request(uuid, uuid, text, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.expire_contact_requests(timestamptz)', 'execute'),
  'the functions are for signed-in users only; the expiry is for nobody of the API'
);
select is(
  (select row(relrowsecurity, relforcerowsecurity)::text from pg_class where oid = 'public.contact_requests'::regclass), '(t,t)',
  'NFR-S8: row-level security is on and forced'
);
select ok(
  not has_column_privilege('authenticated', 'public.contact_requests', 'worker_user_id', 'select')
  and not has_column_privilege('authenticated', 'public.contact_requests', 'sent_by', 'select')
  and has_column_privilege('authenticated', 'public.contact_requests', 'message', 'select')
  and not has_table_privilege('anon', 'public.contact_requests', 'select')
  and not has_table_privilege('authenticated', 'public.contact_requests', 'insert')
  and not has_table_privilege('authenticated', 'public.contact_requests', 'update')
  and not has_table_privilege('authenticated', 'public.contact_requests', 'delete'),
  'AC7, NFR-S9: the worker''s id and the sender are not granted; nothing is writable through the Data API'
);
select results_eq(
  $$select key, value #>> '{}' from private.settings
    where key in ('contact_requests_per_org_day_max', 'contact_request_repeat_days', 'contact_request_decline_days',
                  'contact_request_expiry_days') order by key$$,
  $$values ('contact_request_decline_days', '90'), ('contact_request_expiry_days', '30'), ('contact_request_repeat_days', '30'),
           ('contact_requests_per_org_day_max', '25')$$,
  'NFR-O5: the limits are settings with their defaults'
);
select is(
  (select count(*)::integer from private.setting_rules
   where key in ('contact_requests_per_org_day_max', 'contact_request_repeat_days', 'contact_request_decline_days',
                 'contact_request_expiry_days')),
  4, 'NFR-O5: each has a rule of the settings editor'
);
select results_eq(
  $$select kind, mandatory, default_email, audience, release_key from private.notification_kinds
    where kind like 'contact\_request\_%' order by kind$$,
  $$values ('contact_request_decided', false, true, 'company', 'release_find_workers'),
           ('contact_request_received', false, true, 'worker', 'release_find_workers')$$,
  'FR-T1: the two notices are optional, emailed by default and follow release_find_workers'
);
select is(
  (select count(*)::integer from cron.job where jobname = 'contact-request-expiry' and command = 'select private.expire_contact_requests()'),
  1, 'AC10: the expiry runs daily'
);

-- AC1: sending ----------------------------------------------------------------------------------------------------------------

select is(pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('w'), repeat('m', 300), current_setting('t.job')::uuid),
  'ok', 'AC1: an Acme member sends W a request with a 300-character message and the open vacancy');
select set_config('t.acme_w', current_setting('t.req'), true);
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s', organization_id = current_setting('t.a')::uuid, worker_user_id = :'w', sent_by = :'mem',
     char_length(message), job_id = current_setting('t.job')::uuid, status, destination_country)
   from public.contact_requests where id = current_setting('t.acme_w')::uuid),
  't|t|t|300|t|pending|DE', 'AC1: one pending row of Acme for W, sent by the member, with the vacancy and its country as destination'
);
select is(
  (select format('%s|%s', expires_at - created_at, responded_at is null) from public.contact_requests where id = current_setting('t.acme_w')::uuid),
  '30 days|t', 'AC10: it waits 30 days for the answer'
);
select is(
  (select format('%s|%s|%s', action, entity_type, metadata ? 'message')
   from audit.log where action = 'contact_request.sent' and entity_id = current_setting('t.acme_w')),
  'contact_request.sent|contact_request|f', 'AC1: one audit row contact_request.sent without the message'
);
select is(
  (select format('%s|%s|%s|%s', n.status, n.payload ->> 'org_name', n.payload ->> 'job_title', n.payload ? 'message')
   from public.notifications n where n.user_id = :'w' and n.kind = 'contact_request_received'),
  'queued|Acme Bau|Welder MIG/MAG|f', 'AC1, NFR-A3: the worker gets contact_request_received with the company and the vacancy, never the message'
);
select is(
  (select count(*)::integer from pgmq.q_notifications where message ->> 'kind' = 'contact_request_received' and message ->> 'user_id' = :'w'),
  1, 'NFR-A3: its email is queued in the same transaction'
);
select is(current_setting('t.req') ~ '^[0-9a-f-]{36}$', true, 'AC1: the function answers the request id and nothing else');

-- AC2: validation -----------------------------------------------------------------------------------------------------------

select is(pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), 'x'), 'ok', 'AC2: one character is accepted');
select is(pg_temp.send(:'adm', current_setting('t.a')::uuid, pg_temp.card('x'), repeat('y', 1000)), 'ok',
  'AC2: 1,000 characters are accepted');
delete from public.contact_requests where worker_user_id in (:'v', :'x');
select is(
  pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), '') || ';'
  || pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), E'  \n\t ') || ';'
  || pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), repeat('y', 1001)) || ';'
  || pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), E'Hello\x07there'),
  'P0001|CHARA_INVALID_INPUT|p_message;P0001|CHARA_INVALID_INPUT|p_message;P0001|CHARA_INVALID_INPUT|p_message;P0001|CHARA_INVALID_INPUT|p_message',
  'AC2: empty, whitespace-only, 1,001 characters and a control character are refused'
);
select is(
  pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), 'Hello', pg_temp.job('Draft welder')) || ';'
  || pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), 'Hello', pg_temp.job('Paused welder')) || ';'
  || pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), 'Hello', pg_temp.job('Closed welder')) || ';'
  || pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), 'Hello', pg_temp.job('Hidden welder')) || ';'
  || pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), 'Hello', gen_random_uuid()),
  'P0001|CHARA_JOB_NOT_OPEN|;P0001|CHARA_JOB_NOT_OPEN|;P0001|CHARA_JOB_NOT_OPEN|;P0001|CHARA_JOB_NOT_OPEN|;P0001|CHARA_JOB_NOT_OPEN|',
  'AC2: a draft, paused, closed, hidden or unknown vacancy fails with CHARA_JOB_NOT_OPEN'
);
select is(pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), 'Hello', pg_temp.job('Beta welder')),
  '42501|CHARA_FORBIDDEN|', 'AC2: a vacancy of Beta fails with CHARA_FORBIDDEN');
select is(pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v'), 'Hello', null, 'XX'),
  'P0001|CHARA_INVALID_INPUT|p_destination', 'NFR-M3: a destination outside the code list is refused');
select is((select count(*)::integer from public.contact_requests where worker_user_id = :'v'), 0, 'AC2: no row is written for a refused call');

-- AC4: one neutral answer ---------------------------------------------------------------------------------------------------

select is(
  pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('hidden')) || ';'
  || pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('susp')) || ';'
  || pg_temp.send(:'mem', current_setting('t.a')::uuid, gen_random_uuid()),
  'P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|',
  'AC4: a hidden worker, a suspended worker and a made-up card get the same answer'
);

-- AC6: rules and plan -------------------------------------------------------------------------------------------------------

select is(
  pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('ph'), 'Hello', null, 'DE') || ';'
  || pg_temp.send(:'urb', current_setting('t.rb')::uuid, pg_temp.card('ph'), 'Hello', null, 'DE') || ';'
  || pg_temp.send(:'upl', current_setting('t.pl')::uuid, pg_temp.card('ph'), 'Hello', null, 'DE'),
  '42501|CHARA_FORBIDDEN|direct_hiring_blocked;42501|CHARA_FORBIDDEN|direct_hiring_blocked;42501|CHARA_FORBIDDEN|direct_hiring_blocked',
  'AC6: every request to W-PH for Germany fails with direct_hiring_blocked'
);
select is(
  pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('np'), 'Hello', null, 'DE') || ';'
  || pg_temp.send(:'upl', current_setting('t.pl')::uuid, pg_temp.card('np'), 'Hello', null, 'DE'),
  '42501|CHARA_FORBIDDEN|licensed_partner_required;42501|CHARA_FORBIDDEN|licensed_partner_required',
  'AC6: Acme and the unlicensed Plain fail on W-NP with licensed_partner_required'
);
select is(pg_temp.send(:'urb', current_setting('t.rb')::uuid, pg_temp.card('np'), 'Hello', null, 'DE'), 'ok',
  'AC6: Rekrut, licensed for Germany, reaches W-NP');
select is(pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('ph')), '42501|CHARA_FORBIDDEN|direct_hiring_blocked',
  'AC6: without a destination the rules read Acme''s based-in country');
select is(pg_temp.send(:'ufe', current_setting('t.fr')::uuid, pg_temp.card('v')), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|worker_search',
  'AC6: an organisation without a paid plan fails with CHARA_FEATURE_NOT_IN_PLAN');

-- NFR-S8: who may send ------------------------------------------------------------------------------------------------------

select is(
  pg_temp.send(:'own2', current_setting('t.a')::uuid, pg_temp.card('v')) || ';'
  || pg_temp.send(:'w', current_setting('t.a')::uuid, pg_temp.card('v')) || ';'
  || pg_temp.call_as(null, 'anon', format($f$select public.send_contact_request(%L, %L, 'Hello')$f$,
       current_setting('t.a'), pg_temp.card('v'))),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|permission denied for function send_contact_request|',
  'NFR-S8: a member of Beta, a worker and an anonymous caller cannot send for Acme'
);

-- AC3: one request per worker in 30 days, and the daily limit -----------------------------------------------------------------

select pg_temp.old_request(current_setting('t.a')::uuid, 'x', 29, 'declined') as x29 \gset
select pg_temp.worker('old') as old \gset
select pg_temp.old_request(current_setting('t.a')::uuid, 'old', 31, 'expired') as old31 \gset
select is(pg_temp.send(:'mem2', current_setting('t.a')::uuid, pg_temp.card('w')), 'P0001|CHARA_CONFLICT|pending',
  'AC3: another Acme member cannot send W a second request while the first waits');
select is(pg_temp.send(:'mem2', current_setting('t.a')::uuid, pg_temp.card('x')), 'P0001|CHARA_CONFLICT|declined',
  'AC3: nor to a worker who declined 29 days ago');
select is(pg_temp.send(:'mem2', current_setting('t.a')::uuid, pg_temp.card('old')), 'ok',
  'AC3: a request to a worker last asked 31 days ago (expired) succeeds');
select is(pg_temp.send(:'own2', current_setting('t.b')::uuid, pg_temp.card('w')), 'ok', 'AC3: Beta is not affected by Acme''s request to W');
select set_config('t.beta_w', current_setting('t.req'), true);

-- The day's requests of Acme: those above and the earlier ones; fill the day up to 25 and send the 26th.
select is(
  (select count(*)::integer from public.contact_requests
   where organization_id = current_setting('t.a')::uuid
     and created_at >= (date_trunc('day', now() at time zone 'Europe/Berlin')) at time zone 'Europe/Berlin'),
  2, 'AC3: Acme has sent two requests today');
create function pg_temp.fill(p_count integer) returns text
language plpgsql as $$
declare
  v_out text := '';
begin
  for i in 1..p_count loop
    perform pg_temp.worker('fill' || i);
    v_out := v_out || pg_temp.send('00000000-0000-0000-0000-00000000c003', current_setting('t.a')::uuid, pg_temp.card('fill' || i)) || ',';
  end loop;
  return v_out;
end;
$$;
select is(pg_temp.fill(23), repeat('ok,', 23), 'AC3: Acme sends 23 more, the 25th of the day included');
select pg_temp.worker('over') as over \gset
select is(pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('over')),
  'P0001|CHARA_RATE_LIMITED|contact_requests_per_day', 'AC3, NFR-A4: the 26th request of the day fails with CHARA_RATE_LIMITED');
select is(pg_temp.send(:'adm2', current_setting('t.b')::uuid, pg_temp.card('over')), 'ok', 'AC3: Beta''s day is its own');
delete from private.rate_limit_hits;

-- AC5: a decline is final for 90 days for that company -----------------------------------------------------------------------

select pg_temp.worker('d') as d \gset
select pg_temp.old_request(current_setting('t.a')::uuid, 'd', 89, 'declined') as d_acme \gset
select pg_temp.old_request(current_setting('t.b')::uuid, 'd', 91, 'declined') as d_beta \gset
select pg_temp.old_request(current_setting('t.rb')::uuid, 'd', 0, 'declined') as d_rekrut \gset
update private.settings set value = '100' where key = 'contact_requests_per_org_day_max';
select is(pg_temp.send(:'adm', current_setting('t.a')::uuid, pg_temp.card('d')), 'P0001|CHARA_CONFLICT|declined',
  'AC5: Acme, declined 89 days ago, fails with CHARA_CONFLICT');
select is(pg_temp.send(:'adm2', current_setting('t.b')::uuid, pg_temp.card('d')), 'ok', 'AC5: Beta, declined 91 days ago, succeeds');
select is(pg_temp.send(:'urb', current_setting('t.rb')::uuid, pg_temp.card('d')), 'P0001|CHARA_CONFLICT|declined',
  'AC5: Rekrut, declined today, fails with CHARA_CONFLICT');
select is(
  pg_temp.val_as(:'adm2', 'aal2', format($f$select string_agg(status::text, ',' order by status) from public.list_contact_requests_sent(%L, null, null, null, 50) where card_id = %L$f$,
    current_setting('t.b'), pg_temp.card('d'))),
  'pending,declined', 'AC5: Beta reads its own decline and its new request, nothing of the others'' answers');

-- AC7: nothing of the worker before acceptance ------------------------------------------------------------------------------------

select is(
  pg_temp.call_as(:'mem', 'authenticated', 'select worker_user_id from public.contact_requests limit 1', 'aal1'),
  '42501|permission denied for table contact_requests|', 'AC7: a member cannot select worker_user_id'
);
select is(
  pg_temp.val_as(:'mem', 'aal1', format($f$select format('%%s|%%s|%%s|%%s|%%s|%%s', status, message is not null, job_title, headline, worker_first_name is null, worker_last_name is null) from public.list_contact_requests_sent(%L, null, null, null, 50) where id = %L$f$,
    current_setting('t.a'), current_setting('t.acme_w'))),
  'pending|t|Welder MIG/MAG|Welder w|t|t', 'AC7: before acceptance the list shows status, message, vacancy and card fields, no name'
);
select is(
  pg_temp.val_as(:'mem', 'aal1', format($f$select (select jsonb_agg(to_jsonb(x)) from public.list_contact_requests_sent(%L, null, null, null, 50) x)::text ~ 'Okafor|Amina|@example\.test'$f$,
    current_setting('t.a'))),
  'false', 'NFR-S9: no name and no address anywhere in the list before acceptance'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format('select * from public.list_contact_requests_sent(%L)', current_setting('t.a')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'an owner at aal1 is sent to two-step verification, as for applicant data'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format('select * from public.list_contact_requests_sent(%L)', current_setting('t.a')), 'aal2')
  || ';' || pg_temp.call_as(:'w', 'authenticated', format('select * from public.list_contact_requests_sent(%L)', current_setting('t.a')), 'aal1'),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|', 'NFR-S8: Beta''s owner and a worker cannot list Acme''s requests'
);

-- NFR-S8: rows ---------------------------------------------------------------------------------------------------------------

select is(
  pg_temp.val_as(:'adm2', 'aal2', format($f$select count(*) from public.contact_requests where organization_id = %L$f$, current_setting('t.a'))),
  '0', 'NFR-S8: Beta reads none of Acme''s rows'
);
select is(
  pg_temp.val_as(:'urb', 'aal2', 'select string_agg(distinct organization_id::text, '','') from public.contact_requests'),
  current_setting('t.rb'), 'NFR-S8: Rekrut reads its own rows only'
);
select is(
  pg_temp.val_as(:'upl', 'aal2', 'select count(*) from public.contact_requests'), '0', 'NFR-S8: Plain, which sent nothing, reads nothing'
);
select is(
  pg_temp.val_as(:'w', 'aal1', 'select string_agg(organization_id::text, '','' order by organization_id) from public.contact_requests'),
  (select string_agg(o::text, ',' order by o) from unnest(array[current_setting('t.a')::uuid, current_setting('t.b')::uuid]) o), 'NFR-S8: W reads the two requests addressed to W'
);
select is(
  pg_temp.val_as(:'v', 'aal1', 'select count(*) from public.contact_requests'), '0', 'NFR-S8: V reads none of W''s requests'
);
select is(
  pg_temp.call_as(null, 'anon', 'select count(*) from public.contact_requests'),
  '42501|permission denied for table contact_requests|', 'NFR-S8: an anonymous caller reads nothing'
);
select is(
  pg_temp.val_as(:'w', 'aal1', $f$select format('%s|%s|%s|%s', count(*), string_agg(organization_name, ',' order by organization_name), bool_and(status = 'pending'), string_agg(coalesce(job_title, '-'), ',' order by organization_name)) from public.list_contact_requests_received()$f$),
  '2|Acme Bau,Beta Works|t|Welder MIG/MAG,-', 'AC11: the worker lists both requests with the company and the vacancy'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', 'select * from public.list_contact_requests_received()', 'aal1'),
  '42501|CHARA_FORBIDDEN|worker_account_required', 'a company account has no received requests'
);

-- AC9: documents are not shared by accepting -------------------------------------------------------------------------------------

insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes, scan_status)
values ('00000000-0000-0000-0000-0000000f70d1', :'w', 'cv', 'CV', :'w' || '/00000000-0000-0000-0000-0000000f70d1/cv.pdf', 'cv.pdf',
  'application/pdf', 10, 'clean');

-- AC8: answering ----------------------------------------------------------------------------------------------------------------

select is(pg_temp.respond(:'mem', current_setting('t.acme_w')::uuid, 'accept'), '42501|CHARA_FORBIDDEN|',
  'AC8: Acme cannot accept its own request');
select is(pg_temp.respond(:'v', current_setting('t.acme_w')::uuid, 'accept'), '42501|CHARA_FORBIDDEN|',
  'NFR-S8: another worker cannot answer W''s request');
select is(pg_temp.respond(:'w', current_setting('t.acme_w')::uuid, 'maybe'), 'P0001|CHARA_INVALID_INPUT|p_decision',
  'AC8: only accept and decline are answers');
select is(pg_temp.respond(:'w', current_setting('t.acme_w')::uuid, 'accept'), 'ok', 'AC8: W accepts Acme''s request');
select is(
  (select format('%s|%s', status, responded_at is not null) from public.contact_requests where id = current_setting('t.acme_w')::uuid),
  'accepted|t', 'AC8: the request is accepted with responded_at'
);
select is(
  (select format('%s|%s', c.context_type, c.id::text = current_setting('t.conv'))
   from public.conversations c where c.context_id = current_setting('t.acme_w')::uuid),
  'contact_request|t', 'AC8: one conversation of context contact_request is opened and answered'
);
select set_config('t.acme_conv', current_setting('t.conv'), true);
select is(
  (select string_agg(coalesce(p.organization_id::text, 'worker:' || (p.user_id = :'w')::text), ',' order by p.organization_id nulls last)
   from public.conversation_participants p where p.conversation_id = current_setting('t.conv')::uuid),
  current_setting('t.a') || ',worker:true', 'AC8: its participants are Acme and W'
);
select is(
  (select format('%s|%s|%s', n.user_id = :'mem', n.payload ->> 'decision', n.payload::text ~ 'Okafor|Amina')
   from public.notifications n where n.kind = 'contact_request_decided'
     and n.payload ->> 'contact_request_id' = current_setting('t.acme_w')),
  't|accepted|f', 'AC8: the member who sent it gets contact_request_decided, without the worker''s name'
);
select is(
  (select count(*)::integer from audit.log where entity_id = current_setting('t.acme_w') and action = 'contact_request.accepted'),
  1, 'AC8: one audit row contact_request.accepted'
);
select is(
  pg_temp.val_as(:'mem', 'aal1', format($f$select format('%%s|%%s|%%s|%%s', status, worker_first_name, worker_last_name, conversation_id::text = %L) from public.list_contact_requests_sent(%L, null, null, null, 50) where id = %L$f$,
    current_setting('t.conv'), current_setting('t.a'), current_setting('t.acme_w'))),
  'accepted|Amina|Okafor|t', 'AC7: after acceptance the list names W by first and last name, with the conversation'
);
select is(
  pg_temp.val_as(:'mem', 'aal1', format($f$select (select jsonb_agg(to_jsonb(x)) from public.list_contact_requests_sent(%L, null, null, null, 50) x)::text ~ '@example\.test'$f$,
    current_setting('t.a'))),
  'false', 'AC7: W''s address is never returned'
);
select is(
  pg_temp.val_as(:'w', 'aal2', format($f$select counterpart_name || '|' || counterpart_kind from public.get_conversation(%L)$f$, current_setting('t.conv'))),
  'Acme Bau|organization', 'the worker reads the conversation with Acme''s display name'
);
select is(
  pg_temp.val_as(:'mem', 'aal1', format($f$select counterpart_name || '|' || counterpart_kind || '|' || context_title from public.get_conversation(%L)$f$, current_setting('t.conv'))),
  'Amina Okafor|worker|Welder MIG/MAG', 'Acme reads the conversation with the worker''s name and the vacancy'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', format($f$select public.open_conversation('contact_request', %L)$f$, current_setting('t.acme_w')), 'aal2'),
  'ok', 'AC7: FR-P1 open_conversation for the request succeeds for Acme'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format($f$select public.open_conversation('contact_request', %L)$f$, current_setting('t.acme_w')), 'aal2'),
  '42501|CHARA_FORBIDDEN|', 'NFR-S8: Beta opens nothing through Acme''s request'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format($f$select public.open_conversation('contact_request', %L)$f$, current_setting('t.beta_w')), 'aal2'),
  '42501|CHARA_FORBIDDEN|', 'decision 5.1: a pending request opens no conversation'
);

select is(pg_temp.respond(:'w', current_setting('t.beta_w')::uuid, 'decline'), 'ok', 'AC8: W declines Beta''s request');
select is(
  (select format('%s|%s', status, (select count(*) from public.conversations c where c.context_id = current_setting('t.beta_w')::uuid))
   from public.contact_requests where id = current_setting('t.beta_w')::uuid),
  'declined|0', 'AC8: the declined request opens no conversation'
);
select is(current_setting('t.conv'), '', 'AC8: a decline answers no conversation');
select is(
  pg_temp.val_as(:'own2', 'aal2', format($f$select format('%%s|%%s|%%s', status, worker_first_name is null, headline is not null) from public.list_contact_requests_sent(%L, null, null, null, 50) where id = %L$f$,
    current_setting('t.b'), current_setting('t.beta_w'))),
  'declined|t|t', 'AC8: Beta sees Declined, no reason and no worker data beyond the card'
);
select is(
  (select format('%s|%s', n.user_id = :'own2', n.payload ->> 'decision') from public.notifications n
   where n.kind = 'contact_request_decided' and n.payload ->> 'contact_request_id' = current_setting('t.beta_w')),
  't|declined', 'AC8: Beta''s sender gets contact_request_decided declined'
);
select is(pg_temp.respond(:'w', current_setting('t.beta_w')::uuid, 'accept'), 'P0001|CHARA_INVALID_TRANSITION|declined',
  'AC8: declined -> accepted fails with CHARA_INVALID_TRANSITION');
select is(
  (select count(*)::integer from audit.log where entity_id in (current_setting('t.acme_w'), current_setting('t.beta_w'))
     and action in ('contact_request.accepted', 'contact_request.declined')),
  2, 'AC8: each answer writes one audit row'
);

select is(
  split_part(pg_temp.call_as(:'adm', 'authenticated',
    $f$select * from public.document_access_grant('00000000-0000-0000-0000-0000000f70d1', 'application_review')$f$, 'aal2'), '|', 2),
  'CHARA_FORBIDDEN', 'AC9: accepting shares no document: the grant is refused'
);
select is(
  pg_temp.val_as(:'adm', 'aal2', format($f$select (select count(*) from public.worker_documents where worker_user_id = %L) + (select count(*) from public.passport_shares where worker_user_id = %L)$f$, :'w', :'w')),
  '0', 'AC9: and the admin reads no document and no share of W'
);

-- A member who left: the owners and admins are told.
select pg_temp.worker('left') as wleft \gset
select is(pg_temp.send(:'mem2', current_setting('t.a')::uuid, pg_temp.card('left')), 'ok', 'a member who will leave sends a request');
select set_config('t.left_req', current_setting('t.req'), true);
delete from public.organization_members where user_id = :'mem2';
select is(pg_temp.respond(:'wleft', current_setting('t.left_req')::uuid, 'decline'), 'ok', 'the worker declines it after the member left');
select is(
  (select string_agg(n.user_id::text, ',' order by n.user_id) from public.notifications n
   where n.kind = 'contact_request_decided' and n.payload ->> 'contact_request_id' = current_setting('t.left_req')),
  (select string_agg(u::text, ',' order by u) from unnest(array[:'own1', :'adm']::uuid[]) u),
  'the answer goes to the owner and the admin of Acme instead'
);

-- Withdrawal ----------------------------------------------------------------------------------------------------------------

select pg_temp.worker('wd') as wd \gset
select is(pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('wd')), 'ok', 'Acme sends a request it will withdraw');
select set_config('t.wd_req', current_setting('t.req'), true);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format('select public.withdraw_contact_request(%L, %L)', current_setting('t.b'), current_setting('t.wd_req')), 'aal1')
  || ';' || pg_temp.call_as(:'own2', 'authenticated', format('select public.withdraw_contact_request(%L, %L)', current_setting('t.a'), current_setting('t.wd_req')), 'aal1'),
  'P0002|CHARA_NOT_FOUND|;42501|CHARA_FORBIDDEN|', 'NFR-S8: Beta cannot withdraw Acme''s request'
);
select is(pg_temp.call_as(:'adm', 'authenticated', format('select public.withdraw_contact_request(%L, %L)', current_setting('t.a'), current_setting('t.wd_req')), 'aal1'),
  'ok', 'any Acme member withdraws a pending request');
select is(
  (select format('%s|%s', status, withdrawn_at is not null) from public.contact_requests where id = current_setting('t.wd_req')::uuid)
  || '|' || (select count(*) from audit.log where action = 'contact_request.withdrawn' and entity_id = current_setting('t.wd_req')),
  'withdrawn|t|1', 'the request is withdrawn with one audit row'
);
select is(pg_temp.respond(:'wd', current_setting('t.wd_req')::uuid, 'accept'), 'P0001|CHARA_INVALID_TRANSITION|withdrawn',
  'the worker can no longer accept a withdrawn request');
select is(pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('wd')), 'P0001|CHARA_CONFLICT|recent',
  'a withdrawn request still counts for the 30 days');

-- Find Workers: the cards' request state (AC12) -------------------------------------------------------------------------------

select is(
  pg_temp.call_as(:'mem', 'authenticated', format(
    $f$select set_config('t.rows', (select jsonb_agg(to_jsonb(c)) from public.card_contact_requests(%L, array[%L, %L, %L, %L]::uuid[]) c)::text, true)$f$,
    current_setting('t.a'), pg_temp.card('w'), pg_temp.card('old'), pg_temp.card('v'), pg_temp.card('wd')), 'aal1'),
  'ok', 'AC12: a member reads the request state of a page of cards'
);
select is(
  (select string_agg(t.tag || ':' || (r ->> 'status') || ':' || (r ->> 'can_send'), ',' order by t.tag)
   from jsonb_array_elements(current_setting('t.rows')::jsonb) r
   join public.worker_profiles w on w.card_id = (r ->> 'card_id')::uuid join tags t on t.user_id = w.user_id),
  'old:pending:false,w:accepted:false,wd:withdrawn:false',
  'AC12: the latest request of each card with whether another may be sent; a card never asked is left out'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', format('select * from public.card_contact_requests(%L, array[]::uuid[])', current_setting('t.a')), 'aal1')
  || ';' || pg_temp.call_as(:'ufe', 'authenticated', format('select * from public.card_contact_requests(%L, array[]::uuid[])', current_setting('t.fr')), 'aal1'),
  '42501|CHARA_FORBIDDEN|;P0001|CHARA_FEATURE_NOT_IN_PLAN|worker_search', 'NFR-S8: only a searcher of the organisation reads it'
);

-- AC10: expiry ------------------------------------------------------------------------------------------------------------------

select pg_temp.worker('e29') as e29 \gset
select pg_temp.worker('e30') as e30 \gset
select pg_temp.worker('e31') as e31 \gset
select pg_temp.old_request(current_setting('t.b')::uuid, 'e29', 29, 'pending') as r29 \gset
select pg_temp.old_request(current_setting('t.b')::uuid, 'e30', 30, 'pending') as r30 \gset
select pg_temp.old_request(current_setting('t.b')::uuid, 'e31', 31, 'pending') as r31 \gset
select is(
  pg_temp.val_as(:'e31', 'aal1', 'select status::text from public.list_contact_requests_received()'),
  'expired', 'AC10: a request past its expiry reads as expired before the job runs'
);
select is(pg_temp.respond(:'e31', :'r31', 'accept'), 'P0001|CHARA_INVALID_TRANSITION|expired', 'AC10: and can no longer be accepted');
select is(private.expire_contact_requests(now()), 1, 'AC10: the job expires one request');
select is(
  (select string_agg(status::text, ',' order by created_at desc) from public.contact_requests where id in (:'r29', :'r30', :'r31')),
  'pending,pending,expired', 'AC10: only the 31-day request becomes expired'
);
select is(private.expire_contact_requests(now()), 0, 'AC10: a second run changes nothing');

-- The release switch --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_find_workers';
select is(
  pg_temp.send(:'mem', current_setting('t.a')::uuid, pg_temp.card('v')) || ';'
  || pg_temp.respond(:'e29', :'r29', 'accept') || ';'
  || pg_temp.call_as(:'mem', 'authenticated', format('select * from public.list_contact_requests_sent(%L)', current_setting('t.a')), 'aal1') || ';'
  || pg_temp.call_as(:'w', 'authenticated', 'select * from public.list_contact_requests_received()', 'aal1') || ';'
  || pg_temp.call_as(:'mem', 'authenticated', format('select * from public.card_contact_requests(%L, array[]::uuid[])', current_setting('t.a')), 'aal1') || ';'
  || pg_temp.call_as(:'mem', 'authenticated', format('select public.withdraw_contact_request(%L, %L)', current_setting('t.a'), :'r29'), 'aal1'),
  'P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|;P0002|CHARA_NOT_FOUND|',
  'every function answers CHARA_NOT_FOUND while release_find_workers is off'
);
select is(private.expire_contact_requests(now() + interval '2 days'), 2, 'AC10: the expiry runs whatever the switch says');
update private.settings set value = 'true' where key = 'release_find_workers';

-- Erasure: the worker's requests go with the profile; the conversation stays closed.
update public.profiles set status = 'deletion_pending', deleted_at = now() - interval '400 days' where id = :'w';
select public.erase_user(:'w') as erased \gset
select is((select count(*)::integer from public.contact_requests where id = current_setting('t.acme_w')::uuid), 0,
  'the erased worker''s requests are deleted');
select is(
  pg_temp.val_as(:'mem', 'aal1', format($f$select coalesce(counterpart_name, '-') || '|' || read_only_reason from public.get_conversation(%L)$f$, current_setting('t.acme_conv'))),
  '-|context_closed', 'the conversation of the erased worker names nobody and is closed for messages'
);

select * from finish();
rollback;
