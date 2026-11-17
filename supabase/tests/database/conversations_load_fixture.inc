-- The conversation list load (V80, NFR-P4): an employer with 10,000 conversations and 50,000 messages among 2,000
-- listed partners and 3,000 workers, and the timing helper. Included with \ir by 221_conversations_load.test.sql (the
-- light CI check) and read into the psql input of scripts/load/conversations.mjs (the runbook check with query plans and
-- the table sizes of the capacity review, docs/perf/release-2c.md). Everything it writes is rolled back with the
-- transaction that runs it. setseed makes every run seed the same inbox.

-- The measured employer (Professional, owner at aal2, a member) talks with 2,000 listed partners: one inquiry
-- conversation each, and 5,000 conversations about 200 of its requirements (invitations and responses, two to three
-- per partner); and with 3,000 workers who accepted its contact requests. Each conversation has one to nine messages (50,000 in
-- all, five in ten written by the employer's side, 20 to 600 characters), the last of them in the past 90 days; the owner
-- has read seven conversations in ten up to their last message and three in ten earlier, so about 3,000 hold unread
-- messages. The messages are written while release_messaging is off, so nothing is broadcast; the caller switches it on.
create function pg_temp.seed_conversations(p_partners integer, p_workers integer, p_requirement_conversations integer)
returns void
language plpgsql as $$
declare
  v_owner uuid := '00000000-0000-0000-0000-0000000b8003';
  v_member uuid := '00000000-0000-0000-0000-0000000b8004';
  v_partner_owner uuid := gen_random_uuid();
  v_employer uuid := '00000000-0000-0000-0000-0000000b8021';
  v_text text := 'Thank you for the details. We can send the documents of the welders this week and confirm the start '
    || 'date with the crew. Please tell us whether the accommodation near the yard is arranged, how the shifts are planned '
    || 'and when the medical checks take place, so that every worker arrives prepared. The contracts will follow in English '
    || 'and in the language of each worker, as the rules of the destination country require, and we will keep you informed.';
begin
  perform setseed(0.81);
  update private.settings set value = 'false' where key = 'release_messaging';

  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (v_owner, 'inbox-owner@load.test', now(), jsonb_build_object('intended_account_kind', 'company')),
    (v_member, 'inbox-member@load.test', now(), jsonb_build_object('intended_account_kind', 'company')),
    (v_partner_owner, 'inbox-partners@load.test', now(), jsonb_build_object('intended_account_kind', 'company'));
  update public.profiles set account_kind = 'company' where id in (v_owner, v_member, v_partner_owner);
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_employer, 'employer', 'inbox-employer', 'Inbox Employer GmbH', 'Inbox Employer', 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values
    (v_employer, v_owner, 'owner', now()), (v_employer, v_member, 'member', now());
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  values (v_employer, 'employer_professional', 'active', 'null');

  create temp table inbox_partners on commit drop as
  select gen_random_uuid() as id, n from generate_series(1, p_partners) n;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, review_status, listed_at,
    submitted_at)
  select id, case when n % 10 < 7 then 'recruitment_company' else 'staffing_company' end::public.organization_type,
    'inbox-partner-' || n, 'Inbox Partner ' || n || ' Ltd', 'Inbox Partner ' || lpad(n::text, 5, '0'), 'PH', 'listed',
    now() - interval '60 days', now() - interval '61 days'
  from inbox_partners;
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  select id, v_partner_owner, 'owner', now() from inbox_partners;

  create temp table inbox_requirements on commit drop as
  select gen_random_uuid() as id, n from generate_series(1, 200) n;
  insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region,
    industry_code, start_date, employment_type, recruitment_preference, partner_need, status, visibility, show_identity,
    published_at, closes_on, created_by)
  select id, v_employer, 'Inbox requirement ' || n, 20, 'DE', 'Hamburg', 'C', current_date + 60, 'full_time', 'international',
    'both', 'open', 'job_order_marketplace', n % 2 = 0, now() - interval '30 days', current_date + 30, v_owner
  from inbox_requirements;

  create temp table inbox_workers on commit drop as
  select gen_random_uuid() as id, gen_random_uuid() as request, n from generate_series(1, p_workers) n;
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  select id, 'inbox-worker-' || n || '@load.test', now(), jsonb_build_object('intended_account_kind', 'worker')
  from inbox_workers;
  update public.profiles p set account_kind = 'worker' from inbox_workers w where p.id = w.id;
  insert into public.worker_profiles (user_id, first_name, last_name, current_country, occupation_id, headline)
  select id, 'Inboxfirst', 'Inboxlast', 'PH', '7212', 'Welder' from inbox_workers;
  insert into public.contact_requests (id, organization_id, worker_user_id, card_id, sent_by, message, destination_country,
    status, created_at, expires_at, responded_at)
  select w.request, v_employer, w.id, p.card_id, v_owner, 'We are hiring welders in Hamburg.', 'DE', 'accepted',
    now() - interval '100 days', now() - interval '70 days', now() - interval '99 days'
  from inbox_workers w join public.worker_profiles p on p.user_id = w.id;

  -- The conversations: an inquiry with each partner, the requirement conversations, a contact request with each worker.
  create temp table inbox_conversations on commit drop as
  select gen_random_uuid() as id, 'inquiry'::public.conversation_context as context_type, gen_random_uuid() as context_id,
    null::uuid as requirement_id, p.id as partner, null::uuid as worker
  from inbox_partners p
  union all
  select gen_random_uuid(),
    case when n % 2 = 0 then 'requirement_invitation' else 'partner_response' end::public.conversation_context,
    gen_random_uuid(), (select r.id from inbox_requirements r where r.n = 1 + n % 200),
    (select p.id from inbox_partners p where p.n = 1 + (n * 7) % p_partners), null
  from generate_series(1, p_requirement_conversations) n
  union all
  select gen_random_uuid(), 'contact_request', w.request, null, null, w.id from inbox_workers w;
  alter table inbox_conversations add column messages integer, add column last_at timestamptz;
  update inbox_conversations set messages = 1 + floor(random() * 9)::integer,
    last_at = now() - make_interval(secs => random() * 90 * 86400);
  analyze inbox_partners, inbox_workers, inbox_requirements, inbox_conversations;

  insert into public.conversations (id, context_type, context_id, requirement_id, opened_by, created_at, last_message_at)
  select id, context_type, context_id, requirement_id, v_owner, last_at - interval '10 days', last_at from inbox_conversations;
  insert into public.conversation_participants (conversation_id, organization_id, user_id)
  select id, v_employer, null::uuid from inbox_conversations
  union all
  select id, partner, null from inbox_conversations where partner is not null
  union all
  select id, null, worker from inbox_conversations where worker is not null;

  insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body, created_at)
  select c.id,
    case when (c.messages - k) % 2 = 0 then v_owner else coalesce(c.worker, v_partner_owner) end,
    case when (c.messages - k) % 2 = 0 then v_employer else c.partner end,
    btrim(left(v_text, 20 + floor(random() * 380)::integer)),
    c.last_at - make_interval(hours => (c.messages - k) * 5)
  from inbox_conversations c cross join lateral generate_series(1, c.messages) k;

  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  select id, v_owner, case when random() < 0.7 then last_at else last_at - interval '6 hours' end
  from inbox_conversations;

  analyze public.conversations, public.conversation_participants, public.messages, public.conversation_reads,
    public.contact_requests, public.worker_profiles, public.profiles, public.organizations, public.workforce_requirements;
end;
$$;

create temp table load_cases (
  position integer primary key,
  label text not null unique,
  caller uuid not null,
  sql text not null
);

create temp table load_results (
  label text primary key,
  runs integer not null,
  rows_returned integer not null,
  p50_ms numeric not null,
  p95_ms numeric not null,
  max_ms numeric not null
);

-- Sets the claims (at aal2: the owner reads the organisation's inbox) and the API role of the caller; the caller resets
-- them inline (the API roles cannot call a pg_temp function).
create function pg_temp.inbox_act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
end;
$$;

-- The calls of the inbox and the conversation pages, after the seed: the first page, a page of 50, each context filter,
-- a deep page through the cursor, the unread counts the inbox and the header badge read, and a conversation with its
-- latest messages; for the member (not an owner or admin) the first page as well; and the owner sending a message (the
-- write of NFR-P5: the checks, the locks, the row, the broadcast signal).
create function pg_temp.prepare_conversations_cases() returns void
language plpgsql as $$
declare
  v_owner uuid := '00000000-0000-0000-0000-0000000b8003';
  v_member uuid := '00000000-0000-0000-0000-0000000b8004';
  v_org text := '00000000-0000-0000-0000-0000000b8021';
  v_deep record;
  v_busy uuid;
  v_open uuid;
begin
  select c.last_message_at, c.id into v_deep
  from public.conversations c join public.conversation_participants p on p.conversation_id = c.id and p.organization_id = v_org::uuid
  order by c.last_message_at desc, c.id desc offset 8999 limit 1;
  select m.conversation_id into v_busy
  from public.messages m join public.conversation_participants p on p.conversation_id = m.conversation_id and p.organization_id = v_org::uuid
  group by m.conversation_id order by count(*) desc, m.conversation_id limit 1;
  select c.id into v_open
  from public.conversations c join public.conversation_participants p on p.conversation_id = c.id and p.organization_id = v_org::uuid
  where c.context_type = 'contact_request' order by c.id limit 1;

  insert into load_cases (position, label, caller, sql) values
  (1, 'inbox: first page', v_owner, format('select * from public.list_conversations(%L)', v_org)),
  (2, 'inbox: page of 50', v_owner, format('select * from public.list_conversations(%L, p_limit => 50)', v_org)),
  (3, 'inbox: inquiries', v_owner, format('select * from public.list_conversations(%L, p_context_type => %L)', v_org, 'inquiry')),
  (4, 'inbox: contact requests', v_owner,
    format('select * from public.list_conversations(%L, p_context_type => %L)', v_org, 'contact_request')),
  (5, 'inbox: responses', v_owner,
    format('select * from public.list_conversations(%L, p_context_type => %L)', v_org, 'partner_response')),
  (6, 'inbox: deep page (cursor at 9,000)', v_owner,
    format('select * from public.list_conversations(%L, %L, %L)', v_org, v_deep.last_message_at, v_deep.id)),
  (7, 'member: first page', v_member, format('select * from public.list_conversations(%L)', v_org)),
  (8, 'unread counts', v_owner, 'select * from public.my_unread_counts()'),
  (9, 'conversation: header', v_owner, format('select * from public.get_conversation(%L)', v_busy)),
  (10, 'conversation: latest messages', v_owner, format('select * from public.list_messages(%L)', v_busy)),
  (11, 'send a message', v_owner,
    format('select * from public.send_message(%L, %L)', v_open, 'Could you start on the first Monday of next month?'));
end;
$$;

-- Runs every case once untimed (a warm-up) and then p_runs times, as run_find_partners_load does; the rate-limit window
-- is emptied before each run, so the message throttle never stops the load.
create function pg_temp.run_conversations_load(p_runs integer) returns void
language plpgsql as $$
declare
  v_case record;
  v_times numeric[];
  v_started timestamptz;
  v_rows integer;
begin
  for v_case in select * from load_cases order by position loop
    v_times := '{}';
    for i in 0..p_runs loop
      delete from private.rate_limit_hits;
      perform pg_temp.inbox_act_as(v_case.caller);
      v_started := clock_timestamp();
      execute format('select count(*) from (%s) r', v_case.sql) into v_rows;
      if i > 0 then
        v_times := v_times || (extract(epoch from clock_timestamp() - v_started) * 1000)::numeric;
      end if;
      reset role;
      perform set_config('request.jwt.claims', '', true);
    end loop;
    insert into load_results
    select v_case.label, p_runs, v_rows,
      round(percentile_cont(0.5) within group (order by t)::numeric, 1),
      round(percentile_cont(0.95) within group (order by t)::numeric, 1),
      round(max(t), 1)
    from unnest(v_times) t;
  end loop;
end;
$$;
