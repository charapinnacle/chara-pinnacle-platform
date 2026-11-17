-- Contact requests (FR-Q3 AC1 to AC10, SOP P2-32 steps Send, Notify, Decide, Reveal, Share; decisions 4.4, 5.1; NFR-S8,
-- NFR-S9, NFR-A3, NFR-A4, NFR-O5, NFR-M3, NFR-U4; DATA_MODEL.md sections 5, 6, 7, 9 and 10; V70, release 2c).
--
-- A member of an organisation that may search Find Workers (private.assert_worker_searcher of V69: an employer on a
-- paid plan, or a listed, visible recruitment or staffing company on a paid partner plan) sends the worker behind a
-- listed card a contact request: a short message and, optionally, one of its open vacancies (decision 4.4). The request
-- names the organisation to the worker; the organisation never reads the worker's id, name or contact detail
-- (worker_user_id is not granted, NFR-S9) until the worker accepts. Acceptance names the worker (first and last name
-- only) to that one organisation in list_contact_requests_sent and opens the conversation of context contact_request
-- (decision 5.1, private.conversation_context_parties); a decline ends the request and keeps the organisation away from
-- the worker for contact_request_decline_days (90). Documents travel only through an application, a submission or a share
-- the worker chooses: nothing here reaches worker_documents or passport_shares.
--
-- Limits, counted under one advisory lock per organisation (NFR-A4): one request per organisation and worker within
-- contact_request_repeat_days (30) of the last one, whichever member sent it, none while one is pending, none after an
-- acceptance, none within contact_request_decline_days of a decline (CHARA_CONFLICT), and at most
-- contact_requests_per_org_day_max (25) requests per organisation and calendar day in Europe/Berlin (CHARA_RATE_LIMITED).
-- The direct-hiring rules shape contact as Find Workers shows them (V69, private.worker_card_contact): a blocked rule or a
-- licensed_partner_required rule the organisation holds no licence for refuses the request (CHARA_FORBIDDEN); V72 extends
-- the rules to the other actions. A pending request expires contact_request_expiry_days (30) after it was sent
-- (private.expire_contact_requests, daily); the organisation may withdraw a pending request. Every setting is in the
-- settings editor (NFR-O5).
--
-- Notices (NFR-A3, in the transaction of the change): contact_request_received to the worker (the organisation and the
-- vacancy, never the message) and contact_request_decided to the member who sent the request, or to the owners and admins
-- when that member has left (accepted or declined, never the worker's name). Every function a user calls answers
-- CHARA_NOT_FOUND while release_find_workers is off; the expiry runs whatever the switch says, so the data stay right.
-- Not here: reports of a request (the contact_request report target, V73), retention, erasure details and export (V74),
-- the connection and the invite_to_job message on acceptance (V71).

insert into private.settings (key, value) values
  ('contact_requests_per_org_day_max', '25'),
  ('contact_request_repeat_days', '30'),
  ('contact_request_decline_days', '90'),
  ('contact_request_expiry_days', '30')
on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('contact_requests_per_org_day_max', 'integer', 1, 1000, 'Contact requests an organisation sends in a day, at most', null),
  ('contact_request_repeat_days', 'integer', 1, 365, 'Days before an organisation may contact the same worker again', null),
  ('contact_request_decline_days', 'integer', 1, 365, 'Days an organisation may not contact a worker who declined', null),
  ('contact_request_expiry_days', 'integer', 7, 90, 'Days a contact request waits for the worker''s answer', null);

create type public.contact_request_status as enum ('pending', 'accepted', 'declined', 'expired', 'withdrawn');

-- The requests ------------------------------------------------------------------------------------------------------------

-- card_id is the pseudonym of V68 the request was sent from; the worker's id stays with the row for the worker's own reads
-- and goes with the profile (erasure). expires_at is fixed when the request is sent.
create table public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  worker_user_id uuid not null references public.profiles (id) on delete cascade,
  card_id uuid not null references public.worker_profiles (card_id) on delete cascade,
  sent_by uuid references public.profiles (id) on delete set null,
  message text not null check (
    message = btrim(message, E' \t\n') and char_length(message) between 1 and 1000 and message !~ '[\x01-\x08\x0b-\x1f\x7f]'
  ),
  job_id uuid references public.jobs (id) on delete set null,
  destination_country text references public.countries (code),
  status public.contact_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  withdrawn_at timestamptz,
  constraint contact_requests_responded_check check ((status in ('accepted', 'declined')) = (responded_at is not null)),
  constraint contact_requests_withdrawn_check check ((status = 'withdrawn') = (withdrawn_at is not null))
);

comment on table public.contact_requests is
  'A company''s request to contact the worker behind a Find Workers card (FR-Q3). Written only by send_contact_request, respond_to_contact_request, withdraw_contact_request and the daily expiry. The organisation''s members read it without worker_user_id; the worker reads the own requests.';
comment on column public.contact_requests.worker_user_id is
  'The worker the card belongs to. Not readable through the Data API (NFR-S9); the worker''s name reaches the organisation only through list_contact_requests_sent once the request is accepted.';
comment on column public.contact_requests.sent_by is
  'The member who sent the request. Not readable through the Data API.';

create index contact_requests_org_worker_idx on public.contact_requests (organization_id, worker_user_id, created_at desc);
create index contact_requests_org_created_idx on public.contact_requests (organization_id, created_at desc, id desc);
create index contact_requests_worker_idx on public.contact_requests (worker_user_id, created_at desc, id desc);
create index contact_requests_card_idx on public.contact_requests (card_id);
create index contact_requests_job_idx on public.contact_requests (job_id) where job_id is not null;
create index contact_requests_sent_by_idx on public.contact_requests (sent_by) where sent_by is not null;
create index contact_requests_destination_idx on public.contact_requests (destination_country) where destination_country is not null;
create index contact_requests_pending_idx on public.contact_requests (expires_at) where status = 'pending';

alter table public.contact_requests enable row level security;
alter table public.contact_requests force row level security;
revoke all on table public.contact_requests from public, anon, authenticated, service_role;
grant select (id, organization_id, card_id, message, job_id, destination_country, status, created_at, expires_at, responded_at,
  withdrawn_at) on public.contact_requests to authenticated;

create policy contact_requests_select_member on public.contact_requests
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

create policy contact_requests_select_worker on public.contact_requests
  for select to authenticated
  using (worker_user_id = (select auth.uid()));

-- Helpers ------------------------------------------------------------------------------------------------------------------

-- An integer setting of this unit; CHARA_SETTING_MISSING when it is missing or not a whole number.
create function private.contact_request_setting(p_key text) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value integer := (
    select case when s.value #>> '{}' ~ '^[0-9]{1,6}$' then (s.value #>> '{}')::integer end
    from private.settings s where s.key = p_key);
begin
  if v_value is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = p_key;
  end if;
  return v_value;
end;
$$;

revoke all on function private.contact_request_setting(text) from public, anon, authenticated, service_role;

-- The status a request has now: a pending request past its expiry reads as expired before the daily job marks it.
create function private.contact_request_status_now(p_status public.contact_request_status, p_expires_at timestamptz)
returns public.contact_request_status
language sql
stable
set search_path = ''
as $$
  select case when p_status = 'pending' and p_expires_at < now() then 'expired'::public.contact_request_status else p_status end
$$;

revoke all on function private.contact_request_status_now(public.contact_request_status, timestamptz)
  from public, anon, authenticated, service_role;

-- Why p_org may not send p_worker a request now, or null (AC3, AC5): accepted (the two are in contact already), pending
-- (a request waits for the answer), declined (within contact_request_decline_days of the decline) or recent (any request
-- within contact_request_repeat_days). Whichever member sent the earlier request; another organisation's requests never
-- count.
create function private.contact_request_block(p_org uuid, p_worker uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.contact_requests r
                 where r.organization_id = p_org and r.worker_user_id = p_worker and r.status = 'accepted') then 'accepted'
    when exists (select 1 from public.contact_requests r
                 where r.organization_id = p_org and r.worker_user_id = p_worker and r.status = 'pending'
                   and r.expires_at >= now()) then 'pending'
    when exists (select 1 from public.contact_requests r
                 where r.organization_id = p_org and r.worker_user_id = p_worker and r.status = 'declined'
                   and r.responded_at > now() - make_interval(days => private.contact_request_setting('contact_request_decline_days')))
      then 'declined'
    when exists (select 1 from public.contact_requests r
                 where r.organization_id = p_org and r.worker_user_id = p_worker
                   and r.created_at > now() - make_interval(days => private.contact_request_setting('contact_request_repeat_days')))
      then 'recent'
  end
$$;

revoke all on function private.contact_request_block(uuid, uuid) from public, anon, authenticated, service_role;

-- A signed-in caller while release_find_workers is on, answered with the user id: CHARA_NOT_FOUND while the release is
-- off, CHARA_FORBIDDEN (42501) without a session.
create function private.contact_request_caller() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not private.release_on('release_find_workers') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

revoke all on function private.contact_request_caller() from public, anon, authenticated, service_role;

-- Sending ------------------------------------------------------------------------------------------------------------------

-- A contact request from p_org to the worker behind the card p_card (AC1 to AC6; SOP steps Send and Notify). p_message is
-- taken with CR LF as line feed and trimmed; p_job is null or an open, visible vacancy of p_org; p_destination is the
-- country the rules are read for (an ISO code of the code list), else the vacancy's country, else the organisation's
-- based-in country, as Find Workers reads them. Refusals in order, each writing nothing: those of
-- private.assert_worker_searcher (CHARA_NOT_FOUND while the release is off, CHARA_FORBIDDEN for anyone who is no member,
-- CHARA_FEATURE_NOT_IN_PLAN worker_search); a message empty after trimming, longer than 1,000 characters or with a control
-- character other than line feed and tab, CHARA_INVALID_INPUT p_message; an unknown destination, CHARA_INVALID_INPUT
-- p_destination; another organisation's vacancy, CHARA_FORBIDDEN; a vacancy of p_org that is not open and visible (draft,
-- paused, closed, hidden, deleted) or unknown, CHARA_JOB_NOT_OPEN; a card that is not listed now (hidden, suspended or
-- closing account, unknown), CHARA_NOT_FOUND with one message and no detail, so the answer does not tell why (AC4); a
-- blocked rule, CHARA_FORBIDDEN direct_hiring_blocked; a rule that requires a licensed partner the organisation is not,
-- CHARA_FORBIDDEN licensed_partner_required; private.contact_request_block, CHARA_CONFLICT with its reason; the day's
-- requests of the organisation at contact_requests_per_org_day_max, CHARA_RATE_LIMITED contact_requests_per_day; the daily
-- quota of audited writes, CHARA_RATE_LIMITED. Writes the request (pending), one audit row contact_request.sent (no
-- message, no worker) and contact_request_received to the worker. Answers the request id only.
create function public.send_contact_request(
  p_org uuid, p_card uuid, p_message text, p_job uuid default null, p_destination text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations := private.assert_worker_searcher(p_org);
  v_message text := btrim(replace(coalesce(p_message, ''), E'\r\n', E'\n'), E' \t\n');
  v_destination text := upper(btrim(p_destination));
  v_job public.jobs;
  v_card record;
  v_contact text;
  v_block text;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'Europe/Berlin')) at time zone 'Europe/Berlin';
  v_id uuid;
begin
  if char_length(v_message) not between 1 and 1000 or v_message ~ '[\x01-\x08\x0b-\x1f\x7f]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_message';
  end if;
  if p_destination is not null and not exists (select 1 from public.countries c where c.code = v_destination) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_destination';
  end if;
  if p_job is not null then
    select * into v_job from public.jobs j where j.id = p_job;
    if found and v_job.organization_id <> p_org then
      raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
    end if;
    if not found or v_job.status <> 'open' or v_job.moderation_state <> 'visible' or v_job.deleted_at is not null then
      raise exception 'CHARA_JOB_NOT_OPEN';
    end if;
  end if;

  select c.user_id, c.card_id, c.current_country into v_card
  from private.worker_cards c where c.card_id = p_card and c.listed;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_destination := coalesce(v_destination, v_job.country_code, v_org.based_in_country);
  select d.direct_contact into v_contact
  from private.worker_card_contact(
    v_card.current_country, v_destination, v_org.type <> 'employer' and private.holds_licence_for(p_org, v_destination)) d;
  if v_contact = 'blocked' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'direct_hiring_blocked', errcode = '42501';
  end if;
  if v_contact = 'partner_required' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'licensed_partner_required', errcode = '42501';
  end if;

  -- One lock per organisation before both counts: a second request of the same organisation, to this worker or another,
  -- waits for this one to commit and then counts it; nothing of another organisation waits.
  perform pg_advisory_xact_lock(hashtextextended('contact_requests:' || p_org::text, 0));
  v_block := private.contact_request_block(p_org, v_card.user_id);
  if v_block is not null then
    raise exception 'CHARA_CONFLICT' using detail = v_block;
  end if;
  if (select count(*) from public.contact_requests r where r.organization_id = p_org and r.created_at >= v_day_start)
     >= private.contact_request_setting('contact_requests_per_org_day_max') then
    raise exception 'CHARA_RATE_LIMITED' using detail = 'contact_requests_per_day';
  end if;
  perform private.count_audited_write(p_org);

  insert into public.contact_requests (organization_id, worker_user_id, card_id, sent_by, message, job_id, destination_country,
    expires_at)
  values (p_org, v_card.user_id, v_card.card_id, v_uid, v_message, p_job, v_destination,
    now() + make_interval(days => private.contact_request_setting('contact_request_expiry_days')))
  returning id into v_id;
  perform audit.record('contact_request.sent', 'contact_request', v_id::text, jsonb_strip_nulls(jsonb_build_object(
    'organization_id', p_org, 'job_id', p_job, 'destination_country', v_destination)));
  perform pgmq.send('notifications', jsonb_build_object(
    'kind', 'contact_request_received', 'user_id', v_card.user_id, 'mandatory', false,
    'contact_request_id', v_id, 'dedupe_key', 'contact_request_received:' || v_id));
  return v_id;
end;
$$;

revoke all on function public.send_contact_request(uuid, uuid, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.send_contact_request(uuid, uuid, text, uuid, text) to authenticated;

-- Answering -----------------------------------------------------------------------------------------------------------------

-- The worker's answer to the own request p_request (AC7, AC8; SOP steps Decide and Reveal): 'accept' or 'decline'.
-- Refusals, each writing nothing: CHARA_NOT_FOUND while the release is off; no session, a request of another worker, an
-- unknown id or a caller who is a member of the organisation, CHARA_FORBIDDEN (the same answer); another decision,
-- CHARA_INVALID_INPUT p_decision; a request that is not pending, or pending past its expiry, CHARA_INVALID_TRANSITION with
-- its status. Writes the status and responded_at, one audit row contact_request.accepted or contact_request.declined and
-- contact_request_decided to the member who sent it (or, when that member has left, to the owners and admins of the
-- organisation). An acceptance then opens the conversation of context contact_request (FR-P1 open_conversation) while
-- messaging is released and the organisation is active, and answers its id; otherwise null, and either side opens it
-- later.
create function public.respond_to_contact_request(p_request uuid, p_decision text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.contact_request_caller();
  v_row public.contact_requests;
  v_status public.contact_request_status;
  v_sender_active boolean;
  v_decided text := case p_decision when 'accept' then 'accepted' when 'decline' then 'declined' end;
begin
  select * into v_row from public.contact_requests r where r.id = p_request and r.worker_user_id = v_uid for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if v_decided is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_decision';
  end if;
  v_status := private.contact_request_status_now(v_row.status, v_row.expires_at);
  if v_status <> 'pending' then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = v_status::text;
  end if;
  perform private.count_audited_write(null);

  update public.contact_requests r
  set status = v_decided::public.contact_request_status,
      responded_at = now()
  where r.id = v_row.id;
  perform audit.record(
    case when p_decision = 'accept' then 'contact_request.accepted' else 'contact_request.declined' end,
    'contact_request', v_row.id::text, jsonb_build_object('organization_id', v_row.organization_id));

  v_sender_active := exists (
    select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
    where m.organization_id = v_row.organization_id and m.user_id = v_row.sent_by and m.accepted_at is not null
      and o.status = 'active');
  if v_sender_active then
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'contact_request_decided', 'user_id', v_row.sent_by, 'organization_id', v_row.organization_id,
      'mandatory', false, 'contact_request_id', v_row.id, 'decision', v_decided,
      'dedupe_key', 'contact_request_decided:' || v_row.id));
  else
    perform private.queue_org_event(v_row.organization_id, 'contact_request_decided',
      jsonb_build_object('contact_request_id', v_row.id, 'decision', v_decided),
      'contact_request_decided:' || v_row.id);
  end if;

  if p_decision = 'accept' and private.release_on('release_messaging')
     and exists (select 1 from public.organizations o where o.id = v_row.organization_id and o.status = 'active') then
    return public.open_conversation('contact_request', v_row.id);
  end if;
  return null;
end;
$$;

revoke all on function public.respond_to_contact_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.respond_to_contact_request(uuid, text) to authenticated;

-- Withdraws the pending request p_request of p_org (SOP step Send, NFR-U4: the next action of a request waiting for the
-- worker). Any member of the organisation. Refusals: CHARA_NOT_FOUND while the release is off; no session or no member of
-- p_org, CHARA_FORBIDDEN; no such request of p_org, CHARA_NOT_FOUND; a request that is not pending (or pending past its
-- expiry), CHARA_INVALID_TRANSITION with its status; the daily quota of audited writes, CHARA_RATE_LIMITED. Writes the
-- status, withdrawn_at and one audit row contact_request.withdrawn; the worker is not notified and reads it as withdrawn.
-- A withdrawn request still counts for the repeat rule, so withdrawing never makes room for another request.
create function public.withdraw_contact_request(p_org uuid, p_request uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.contact_request_caller();
  v_row public.contact_requests;
  v_status public.contact_request_status;
begin
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_row from public.contact_requests r where r.id = p_request and r.organization_id = p_org for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_status := private.contact_request_status_now(v_row.status, v_row.expires_at);
  if v_status <> 'pending' then
    raise exception 'CHARA_INVALID_TRANSITION' using detail = v_status::text;
  end if;
  perform private.count_audited_write(p_org);
  update public.contact_requests r set status = 'withdrawn', withdrawn_at = now() where r.id = v_row.id;
  perform audit.record('contact_request.withdrawn', 'contact_request', v_row.id::text,
    jsonb_build_object('organization_id', p_org, 'withdrawn_by', v_uid));
end;
$$;

revoke all on function public.withdraw_contact_request(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_contact_request(uuid, uuid) to authenticated;

-- Reading -------------------------------------------------------------------------------------------------------------------

-- The requests of p_org, newest first, keyset (p_before_at, p_before_id) over (created_at, id), p_limit 1 to 50 (20), of
-- the status p_status (as status_now reads it) when given (AC7; SOP step Reveal). For every accepted member; an owner or
-- admin at aal2, as for applicant data. Each row: the request, its status now, whether the caller sent it, the vacancy's
-- title, the card fields of public.worker_search while the card is listed (headline, occupation, current country), and,
-- only once the worker accepted, the worker's first and last name and the conversation. Never the worker's id, address,
-- telephone or documents (NFR-S9). Refusals: CHARA_NOT_FOUND while the release is off; CHARA_FORBIDDEN for a caller who is
-- no member; aal2_required; CHARA_INVALID_INPUT p_limit or p_status.
create function public.list_contact_requests_sent(
  p_org uuid, p_status text default null, p_before_at timestamptz default null, p_before_id uuid default null,
  p_limit integer default 20
)
returns table (
  id uuid, card_id uuid, status public.contact_request_status, message text, job_id uuid, job_title text,
  destination_country text, created_at timestamptz, expires_at timestamptz, responded_at timestamptz,
  withdrawn_at timestamptz, sent_by_me boolean, card_listed boolean, headline text, occupation_id text,
  current_country text, worker_first_name text, worker_last_name text, conversation_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.contact_request_caller();
begin
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  perform private.assert_member_aal2(p_org);
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_limit', errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'accepted', 'declined', 'expired', 'withdrawn') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_status', errcode = '22023';
  end if;
  return query
  select r.id, r.card_id, private.contact_request_status_now(r.status, r.expires_at), r.message, r.job_id, j.title,
    r.destination_country, r.created_at, r.expires_at, r.responded_at, r.withdrawn_at, r.sent_by = v_uid,
    coalesce(c.listed, false),
    case when c.listed or r.status = 'accepted' then c.headline end,
    case when c.listed or r.status = 'accepted' then c.occupation_id end,
    case when c.listed or r.status = 'accepted' then c.current_country end,
    case when r.status = 'accepted' then w.first_name end,
    case when r.status = 'accepted' then w.last_name end,
    case when r.status = 'accepted' then (
      select v.id from public.conversations v where v.context_type = 'contact_request' and v.context_id = r.id) end
  from public.contact_requests r
  left join public.jobs j on j.id = r.job_id
  left join private.worker_cards c on c.card_id = r.card_id
  left join public.worker_profiles w on w.user_id = r.worker_user_id
  where r.organization_id = p_org
    and (p_status is null or private.contact_request_status_now(r.status, r.expires_at)::text = p_status)
    and (p_before_at is null
      or (r.created_at, r.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff')))
  order by r.created_at desc, r.id desc
  limit p_limit;
end;
$$;

revoke all on function public.list_contact_requests_sent(uuid, text, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_contact_requests_sent(uuid, text, timestamptz, uuid, integer) to authenticated;

-- The caller's own requests as a worker, pending ones first (oldest expiry first), then the others newest first, at most
-- p_limit (1 to 100, 50) (AC10, AC11; SOP step Decide): the request, its status now, the organisation (display name,
-- type, based-in country), the vacancy (id, title, country) and the conversation once accepted. Never the member who sent
-- it. Refusals: CHARA_NOT_FOUND while the release is off; CHARA_FORBIDDEN without a session; a company account,
-- CHARA_FORBIDDEN worker_account_required; CHARA_INVALID_INPUT p_limit.
create function public.list_contact_requests_received(p_limit integer default 50)
returns table (
  id uuid, status public.contact_request_status, message text, organization_name text,
  organization_type public.organization_type, organization_country text, job_id uuid, job_title text, job_country text,
  destination_country text, created_at timestamptz, expires_at timestamptz, responded_at timestamptz,
  withdrawn_at timestamptz, conversation_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.contact_request_caller();
begin
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.account_kind = 'worker') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required', errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_limit', errcode = '22023';
  end if;
  return query
  select x.id, x.status_now, x.message, x.display_name, x.type, x.based_in_country, x.job_id, x.title, x.country_code,
    x.destination_country, x.created_at, x.expires_at, x.responded_at, x.withdrawn_at, x.conversation_id
  from (
    select r.id, private.contact_request_status_now(r.status, r.expires_at) as status_now, r.message, o.display_name, o.type,
      o.based_in_country, r.job_id, j.title, j.country_code, r.destination_country, r.created_at, r.expires_at,
      r.responded_at, r.withdrawn_at,
      case when r.status = 'accepted' then (
        select v.id from public.conversations v where v.context_type = 'contact_request' and v.context_id = r.id) end
        as conversation_id
    from public.contact_requests r
    join public.organizations o on o.id = r.organization_id
    left join public.jobs j on j.id = r.job_id
    where r.worker_user_id = v_uid
  ) x
  order by x.status_now <> 'pending', case when x.status_now = 'pending' then x.expires_at end, x.created_at desc, x.id desc
  limit p_limit;
end;
$$;

revoke all on function public.list_contact_requests_received(integer) from public, anon, authenticated, service_role;
grant execute on function public.list_contact_requests_received(integer) to authenticated;

-- For the cards p_cards (at most 50, a page of Find Workers), the latest request of p_org to each card's worker, if any,
-- and whether p_org may send another now (AC12: "Request sent on <date>" instead of the Send button). Needs the right to
-- search (private.assert_worker_searcher); cards without a request are left out. CHARA_INVALID_INPUT p_cards for more than
-- 50 or a null element.
create function public.card_contact_requests(p_org uuid, p_cards uuid[])
returns table (card_id uuid, request_id uuid, status public.contact_request_status, created_at timestamptz, can_send boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations := private.assert_worker_searcher(p_org);
begin
  if p_cards is null or cardinality(p_cards) > 50 or array_position(p_cards, null) is not null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cards', errcode = '22023';
  end if;
  return query
  select w.card_id, l.id, private.contact_request_status_now(l.status, l.expires_at), l.created_at,
    private.contact_request_block(v_org.id, w.user_id) is null
  from private.worker_cards w
  cross join lateral (
    select r.id, r.status, r.expires_at, r.created_at from public.contact_requests r
    where r.organization_id = v_org.id and r.worker_user_id = w.user_id
    order by r.created_at desc, r.id desc
    limit 1
  ) l
  where w.card_id = any (p_cards);
end;
$$;

revoke all on function public.card_contact_requests(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.card_contact_requests(uuid, uuid[]) to authenticated;

-- Expiry (AC10) -------------------------------------------------------------------------------------------------------------

-- Marks expired every pending request whose expiry is before p_now and answers how many; a second run changes nothing.
-- Runs whatever the release switch says, so the data stay right. No notice: the worker no longer sees the request as open
-- and the organisation reads "No answer".
create function private.expire_contact_requests(p_now timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.contact_requests r set status = 'expired'
  where r.status = 'pending' and r.expires_at < p_now;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.expire_contact_requests(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('contact-request-expiry', '50 1 * * *', 'select private.expire_contact_requests()');

-- Conversations (decision 5.1) ----------------------------------------------------------------------------------------------

-- private.conversation_context_parties of 20270203100000_messaging_core.sql with the branch of an accepted contact request:
-- the organisation (in employer_id, whatever its type, as the one organisation side) and the worker, while the worker's
-- account exists.
create or replace function private.conversation_context_parties(p_type public.conversation_context, p_id uuid)
returns table (employer_id uuid, partner_id uuid, worker_user_id uuid, requirement_id uuid, allows_contact boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.organization_id, null::uuid, a.worker_user_id, null::uuid,
    a.status <> 'withdrawn' and exists (select 1 from public.profiles u where u.id = a.worker_user_id and u.deleted_at is null)
  from public.job_applications a
  where p_type = 'application' and a.id = p_id
  union all
  select s.employer_organization_id, null, s.worker_user_id, s.requirement_id,
    s.status <> 'withdrawn'
      and exists (select 1 from public.profiles u where u.id = s.worker_user_id and u.deleted_at is null)
  from public.candidate_submissions s
  where p_type = 'candidate_submission' and s.id = p_id and s.worker_approved_at is not null
  union all
  select i.employer_organization_id, i.organization_id, null, i.requirement_id, i.status in ('accepted', 'responded')
  from public.requirement_invitations i
  where p_type = 'requirement_invitation' and i.id = p_id
  union all
  select r.employer_organization_id, r.organization_id, null, r.requirement_id, r.status <> 'withdrawn'
  from public.partner_responses r
  where p_type = 'partner_response' and r.id = p_id
  union all
  select c.organization_id, null, c.worker_user_id, null,
    exists (select 1 from public.profiles u where u.id = c.worker_user_id and u.deleted_at is null)
  from public.contact_requests c
  where p_type = 'contact_request' and c.id = p_id and c.status = 'accepted'
$$;

revoke all on function private.conversation_context_parties(public.conversation_context, uuid)
  from public, anon, authenticated, service_role;

-- private.conversation_closed_reason of 20270206100100_messaging_limits_safety.sql with contact_request among the contexts
-- that end for good once the worker's account is gone.
create or replace function private.conversation_closed_reason(p_conversation public.conversations) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.conversation_participants p join public.organizations o on o.id = p.organization_id
      where p.conversation_id = p_conversation.id and o.status <> 'active'
    ) then 'org_suspended'
    when p_conversation.context_type in ('application', 'candidate_submission', 'contact_request') and (
      not exists (
        select 1 from public.conversation_participants p
        join public.profiles u on u.id = p.user_id and u.deleted_at is null
        where p.conversation_id = p_conversation.id
      )
      or exists (
        select 1 from public.job_applications a
        where p_conversation.context_type = 'application' and a.id = p_conversation.context_id and a.status = 'withdrawn'
      )
      or exists (
        select 1 from public.candidate_submissions s
        where p_conversation.context_type = 'candidate_submission' and s.id = p_conversation.context_id
          and s.status = 'withdrawn'
      )
    ) then 'context_closed'
    when exists (select 1 from public.conversation_blocks b where b.conversation_id = p_conversation.id) then 'blocked'
  end
$$;

revoke all on function private.conversation_closed_reason(public.conversations) from public, anon, authenticated, service_role;

-- private.conversation_labels of 20270203100000_messaging_core.sql with the branch of a contact request.
create or replace function private.conversation_labels(p_conversation public.conversations, p_side uuid)
returns table (counterpart_kind text, counterpart_name text, context_title text, counterpart_named boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_org uuid;
  v_title text;
  v_requirement public.workforce_requirements;
  v_named boolean := true;
begin
  -- V70: the worker of an accepted contact request is named to the organisation by the passport's first and last name
  -- (the reveal of FR-Q3), the organisation to the worker by its display name; the vacancy of the request is the title.
  if p_conversation.context_type = 'contact_request' then
    return query
    select case when p_side is null then 'organization' else 'worker' end,
      case when p_side is null then o.display_name
           else nullif(btrim(concat_ws(' ', w.first_name, w.last_name)), '') end,
      j.title, true
    from public.contact_requests r
    join public.organizations o on o.id = r.organization_id
    left join public.worker_profiles w on w.user_id = r.worker_user_id and r.status = 'accepted'
    left join public.jobs j on j.id = r.job_id
    where r.id = p_conversation.context_id;
    if not found then
      return query select case when p_side is null then 'organization' else 'worker' end, null::text, null::text, true;
    end if;
    return;
  end if;

  if p_conversation.context_type = 'application' then
    select a.profile_snapshot, a.organization_id, j.title into v_snapshot, v_org, v_title
    from public.job_applications a join public.jobs j on j.id = a.job_id
    where a.id = p_conversation.context_id;
  elsif p_conversation.context_type = 'candidate_submission' then
    select s.profile_snapshot, s.employer_organization_id into v_snapshot, v_org
    from public.candidate_submissions s where s.id = p_conversation.context_id;
    select * into v_requirement from public.workforce_requirements r where r.id = p_conversation.requirement_id;
    if p_side is null then
      v_named := coalesce(v_requirement.show_identity, false);
      v_title := private.submission_candidate_title(v_requirement);
    else
      v_title := v_requirement.title;
    end if;
  else
    select * into v_requirement from public.workforce_requirements r where r.id = p_conversation.requirement_id;
    if p_side = v_requirement.organization_id then
      select p.organization_id into v_org from public.conversation_participants p
      where p.conversation_id = p_conversation.id and p.organization_id <> p_side;
      v_title := v_requirement.title;
    else
      v_org := v_requirement.organization_id;
      v_named := private.requirement_named_to(v_requirement.id, p_side);
      v_title := case when v_named then v_requirement.title else private.job_order_neutral_title(v_requirement.id) end;
    end if;
  end if;

  if p_side is not null and p_conversation.context_type in ('application', 'candidate_submission') then
    return query select 'worker'::text,
      nullif(btrim(concat_ws(' ', v_snapshot ->> 'first_name', v_snapshot ->> 'last_name')), ''), v_title, true;
  else
    return query select 'organization'::text,
      case when v_named then (select o.display_name from public.organizations o where o.id = v_org) end, v_title, v_named;
  end if;
end;
$$;

revoke all on function private.conversation_labels(public.conversations, uuid) from public, anon, authenticated, service_role;

-- Notices (FR-T1) ----------------------------------------------------------------------------------------------------------

insert into private.notification_kinds (kind, mandatory, default_email, audience, label, organization_types, release_key) values
  ('contact_request_received', false, true, 'worker', 'Contact requests from companies', null, 'release_find_workers'),
  ('contact_request_decided', false, true, 'company', 'Answers to your contact requests', null, 'release_find_workers');

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity',
  'moderation_decision', 'data_export_ready', 'requirement_closing_soon', 'job_order_match', 'invitation_received',
  'invitation_withdrawn', 'requirement_changed', 'requirement_closed', 'response_received', 'response_withdrawn',
  'response_decided', 'submission_request', 'submission_request_signup', 'submission_approved', 'submission_withdrawn',
  'submission_stage_changed', 'new_message', 'visibility_confirmation', 'contact_request_received', 'contact_request_decided'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- notification_payload_core of 20270208200000_worker_visibility.sql with the branches of the two contact request kinds.
-- The wrapper private.notification_payload of V67 keeps answering new_message.
create or replace function private.notification_payload_core(p_kind text, p_message jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_title text;
  v_slug text;
  v_org_name text;
  v_invitation_id uuid;
  v_role public.member_role;
  v_expires timestamptz;
  v_org_type public.organization_type;
  v_decision public.partner_review_decisions;
  v_licence_id uuid;
  v_country_code text;
  v_country_name text;
  v_valid_until date;
begin
  if p_message ->> 'job_id' is not null then
    select j.id, j.title, o.slug, o.display_name into v_job_id, v_title, v_slug, v_org_name
    from public.jobs j join public.organizations o on o.id = j.organization_id
    where j.id = (p_message ->> 'job_id')::uuid;
  end if;
  if p_message ->> 'organization_id' is not null then
    select o.slug, o.display_name into v_slug, v_org_name
    from public.organizations o where o.id = (p_message ->> 'organization_id')::uuid;
  end if;
  if p_message ->> 'invitation_id' is not null then
    select i.id, i.role, i.expires_at, o.display_name, o.type into v_invitation_id, v_role, v_expires, v_org_name, v_org_type
    from public.organization_invitations i join public.organizations o on o.id = i.organization_id
    where i.id = (p_message ->> 'invitation_id')::uuid;
  end if;
  if p_message ->> 'decision_id' is not null then
    select * into v_decision from public.partner_review_decisions d where d.id = (p_message ->> 'decision_id')::bigint;
  end if;
  if p_message ->> 'licence_id' is not null then
    select l.id, l.country_code, c.name, l.valid_until into v_licence_id, v_country_code, v_country_name, v_valid_until
    from public.partner_licences l join public.countries c on c.code = l.country_code
    where l.id = (p_message ->> 'licence_id')::uuid;
  end if;

  return jsonb_strip_nulls(case p_kind
    when 'application_received' then case
      when p_message ? 'vacancies' then jsonb_build_object(
        'total', p_message -> 'total',
        'vacancies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'job_id', j.id, 'job_title', j.title, 'org_name', o.display_name, 'org_slug', o.slug, 'count', v.item -> 'count'
          ) order by v.position)
          from jsonb_array_elements(p_message -> 'vacancies') with ordinality as v(item, position)
          join public.jobs j on j.id = (v.item ->> 'job_id')::uuid
          join public.organizations o on o.id = j.organization_id
        ), '[]'::jsonb))
      else jsonb_build_object(
        'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name, 'org_slug', v_slug)
    end
    -- V50: a submission's stage names the requirement as the candidate may read it, the partner that proposed the
    -- candidate and the employer only when it shows its name; never the note (FR-O5 AC9).
    when 'status_changed' then case
      when p_message ? 'submission_id' then coalesce((
        select jsonb_build_object('submission_id', s.id, 'job_title', private.submission_candidate_title(r),
          'org_name', case when r.show_identity then e.display_name end, 'partner_name', o.display_name,
          'status', p_message -> 'status')
        from public.candidate_submissions s
        join public.organizations o on o.id = s.organization_id
        join public.workforce_requirements r on r.id = s.requirement_id
        join public.organizations e on e.id = r.organization_id
        where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
      else jsonb_build_object(
        'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name,
        'status', p_message -> 'status')
    end
    when 'vacancy_hidden' then jsonb_build_object(
      'job_id', v_job_id, 'job_title', v_title, 'org_slug', v_slug, 'reasons', p_message -> 'reasons',
      'moderation_action_id', p_message -> 'moderation_action_id')
    when 'trial_ending' then jsonb_build_object(
      'org_slug', v_slug, 'trial_ends_at', p_message -> 'trial_ends_at', 'plan_code', p_message -> 'plan_code',
      'plan_name', p_message -> 'plan_name',
      'amount_minor', p_message -> 'amount_minor', 'currency', p_message -> 'currency')
    when 'payment_failed' then jsonb_build_object('org_slug', v_slug)
    when 'legal_version' then jsonb_build_object(
      'document_slug', p_message -> 'document_slug', 'version', p_message -> 'version',
      'change_summary', p_message -> 'change_summary')
    when 'account_suspended' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug,
      'moderation_action_id', p_message -> 'moderation_action_id')
    when 'account_reinstated' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug)
    when 'member_invitation' then jsonb_build_object(
      'invitation_id', v_invitation_id, 'org_name', v_org_name, 'role', v_role, 'expires_at', v_expires, 'org_type', v_org_type)
    when 'deletion_requested' then jsonb_build_object('erases_on', p_message -> 'erases_on')
    when 'erasure_paused' then jsonb_build_object('account_id', p_message -> 'user_id')
    -- The reason of an approval stays in the staff record, as in partner_review_outcome.
    when 'partner_approved' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at)
    when 'partner_info_requested' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at,
      'info_step', v_decision.info_step, 'reason', v_decision.reason)
    when 'partner_declined' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at,
      'reason', v_decision.reason)
    when 'licence_expiring' then jsonb_build_object(
      'licence_id', v_licence_id, 'country_code', v_country_code, 'country_name', v_country_name,
      'valid_until', v_valid_until, 'org_name', v_org_name, 'org_slug', v_slug)
    when 'partner_licence_expired' then jsonb_build_object(
      'licence_id', v_licence_id, 'country_code', v_country_code, 'country_name', v_country_name,
      'valid_until', v_valid_until, 'org_name', v_org_name, 'org_slug', v_slug)
    -- The ten listings confirmed longest ago are named; total says how many are due.
    when 'listing_confirmation_due' then jsonb_build_object(
      'org_name', v_org_name, 'org_slug', v_slug,
      'total', jsonb_array_length(coalesce(p_message -> 'listing_ids', '[]'::jsonb)),
      'stale_days', (select (s.value #>> '{}')::integer from private.settings s where s.key = 'workforce_listing_stale_days'),
      'listings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'listing_id', x.id, 'occupation', x.label, 'country_name', x.name, 'confirmed_at', x.confirmed_at
        ) order by x.confirmed_at, x.id)
        from (
          select w.id, oc.label, c.name, w.confirmed_at
          from jsonb_array_elements_text(coalesce(p_message -> 'listing_ids', '[]'::jsonb)) e(id)
          join public.workforce_availability w on w.id = e.id::uuid
          join public.occupations oc on oc.code = w.occupation_id
          join public.countries c on c.code = w.source_country
          order by w.confirmed_at, w.id
          limit 10
        ) x
      ), '[]'::jsonb))
    -- V54: the named job orders of the digest follow the vacancies, by their current title, the ten oldest with how many
    -- there are; a partner follower's items carry the requirement id and the slug of the follower's own company for the
    -- link, a candidate's the title only (decision 3.1). Absent when the digest holds no job order.
    when 'followed_company_activity' then jsonb_build_object(
      'organization_id', p_message -> 'organization_id', 'org_name', v_org_name, 'org_slug', v_slug,
      'total', jsonb_array_length(coalesce(p_message -> 'job_ids', '[]'::jsonb)),
      'vacancies', coalesce((
        select jsonb_agg(jsonb_build_object('job_id', x.id, 'job_title', x.title) order by x.position)
        from (
          select j.id, j.title, e.position
          from jsonb_array_elements_text(coalesce(p_message -> 'job_ids', '[]'::jsonb)) with ordinality e(id, position)
          join public.jobs j on j.id = e.id::uuid
          order by e.position
          limit 10
        ) x
      ), '[]'::jsonb),
      'job_order_total', case when p_message ? 'requirement_ids' then jsonb_array_length(p_message -> 'requirement_ids') end,
      'partner_slug', (select o.slug from public.organizations o where o.id = (p_message ->> 'partner_id')::uuid),
      'job_orders', case when p_message ? 'requirement_ids' then coalesce((
        select jsonb_agg(jsonb_build_object(
          'requirement_id', case when p_message ? 'partner_id' then x.id end, 'title', x.title) order by x.position)
        from (
          select r.id, r.title, e.position
          from jsonb_array_elements_text(p_message -> 'requirement_ids') with ordinality e(id, position)
          join public.workforce_requirements r on r.id = e.id::uuid
          order by e.position
          limit 10
        ) x
      ), '[]'::jsonb) end)
    when 'moderation_decision' then case
      when p_message ? 'report_id' then jsonb_build_object(
        'reference', private.report_reference((p_message ->> 'report_id')::bigint), 'outcome', p_message -> 'outcome')
      when p_message ? 'appeal_id' then jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case
          when p_message ->> 'target_type' = 'job' then v_title
          when p_message ->> 'target_type' in ('requirement', 'partner_response', 'candidate_submission') then p_message ->> 'title'
          else v_org_name
        end,
        'org_slug', v_slug, 'appeal_id', p_message -> 'appeal_id', 'appeal_outcome', p_message -> 'appeal_outcome',
        'reasons', p_message -> 'reasons', 'moderation_action_id', p_message -> 'moderation_action_id')
      else jsonb_build_object(
        'target_type', p_message -> 'target_type', 'target_id', p_message -> 'target_id',
        'title', case
          when p_message ->> 'target_type' = 'partner_profile' then v_org_name
          when p_message ->> 'target_type' in ('requirement', 'partner_response', 'candidate_submission') then p_message ->> 'title'
        end,
        'org_slug', v_slug, 'decision', p_message -> 'decision', 'reasons', p_message -> 'reasons',
        'moderation_action_id', p_message -> 'moderation_action_id')
    end
    when 'data_export_ready' then jsonb_build_object('export_id', p_message -> 'export_id', 'expires_at', p_message -> 'expires_at')
    -- The recipient's own organisation names the link; never the employer to a partner. A partner's reminder (V43) names
    -- its invitation for the link to its invitation page.
    when 'requirement_closing_soon' then case
      when p_message ? 'requirement_invitation_id' then coalesce((
        select jsonb_build_object('requirement_id', r.id, 'invitation_id', i.id, 'title', r.title, 'closes_on', r.closes_on,
          'org_slug', v_slug)
        from public.requirement_invitations i join public.workforce_requirements r on r.id = i.requirement_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
      -- V44: a marketplace responder, which the requirement's own title names only when the employer is named to it.
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('requirement_id', r.id, 'response_id', p.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'closes_on', r.closes_on, 'org_slug', v_slug)
        from public.partner_responses p join public.workforce_requirements r on r.id = p.requirement_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('requirement_id', r.id, 'title', r.title, 'closes_on', r.closes_on, 'org_slug', v_slug)
        from public.workforce_requirements r where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    end
    -- NFR-S11: the generated title and the destination only, whatever the employer chose to show; the slug is the
    -- recipient partner's own, for the link to its job order page.
    when 'job_order_match' then coalesce((
      select jsonb_build_object('requirement_id', r.id, 'title', private.job_order_neutral_title(r.id),
        'country_code', r.country_code, 'country_name', c.name, 'org_slug', v_slug)
      from public.workforce_requirements r join public.countries c on c.code = r.country_code
      where r.id = (p_message ->> 'requirement_id')::uuid), '{}'::jsonb)
    -- An invitation reveals the employer to the invited partner (decision 3.2; NFR-S11 protects the partners that are
    -- not invited or selected), so the item and the email name the requirement's own title and the employer (FR-O1
    -- AC7, AC11), and nothing else of the employer: no member, no address. The slug is the recipient partner's own.
    when 'invitation_received' then coalesce((
      select jsonb_build_object('invitation_id', i.id, 'title', r.title,
        'country_code', r.country_code, 'country_name', c.name, 'workers_needed', r.workers_needed,
        'start_date', r.start_date, 'employer_name', e.display_name, 'org_slug', v_slug)
      from public.requirement_invitations i
      join public.workforce_requirements r on r.id = i.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    when 'invitation_withdrawn' then coalesce((
      select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name, 'org_slug', v_slug)
      from public.requirement_invitations i
      join public.workforce_requirements r on r.id = i.requirement_id
      join public.organizations e on e.id = r.organization_id
      where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    -- V43: the invitation reveals the requirement's own title and the employer to the invited partner (as
    -- invitation_received); the change notice names the fields changed in the versions from_version to to_version, in
    -- the order of the form, never their values, who changed them or anything the invitation did not show.
    when 'requirement_changed' then case
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
          'changed_fields', (
            select coalesce(jsonb_agg(f.name order by f.position), '[]')
            from unnest(private.requirement_change_fields()) with ordinality f(name, position)
            where exists (
              select 1 from public.requirement_versions v
              where v.requirement_id = r.id and f.name = any (v.changed_fields)
                and v.version between (p_message ->> 'from_version')::integer and (p_message ->> 'to_version')::integer)),
          'from_version', (p_message ->> 'from_version')::integer, 'to_version', (p_message ->> 'to_version')::integer,
          'org_slug', v_slug)
        from public.partner_responses p
        join public.workforce_requirements r on r.id = p.requirement_id
        join public.organizations e on e.id = r.organization_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name,
          'changed_fields', (
            select coalesce(jsonb_agg(f.name order by f.position), '[]')
            from unnest(private.requirement_change_fields()) with ordinality f(name, position)
            where exists (
              select 1 from public.requirement_versions v
              where v.requirement_id = r.id and f.name = any (v.changed_fields)
                and v.version between (p_message ->> 'from_version')::integer and (p_message ->> 'to_version')::integer)),
          'from_version', (p_message ->> 'from_version')::integer, 'to_version', (p_message ->> 'to_version')::integer,
          'org_slug', v_slug)
        from public.requirement_invitations i
        join public.workforce_requirements r on r.id = i.requirement_id
        join public.organizations e on e.id = r.organization_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    end
    when 'requirement_closed' then case
      when p_message ? 'partner_response_id' then coalesce((
        select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
          'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
            else private.job_order_neutral_title(r.id) end,
          'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
          'close_reason', r.close_reason, 'org_slug', v_slug)
        from public.partner_responses p
        join public.workforce_requirements r on r.id = p.requirement_id
        join public.organizations e on e.id = r.organization_id
        where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
      else coalesce((
        select jsonb_build_object('invitation_id', i.id, 'title', r.title, 'employer_name', e.display_name,
          'close_reason', r.close_reason, 'org_slug', v_slug)
        from public.requirement_invitations i
        join public.workforce_requirements r on r.id = i.requirement_id
        join public.organizations e on e.id = r.organization_id
        where i.id = (p_message ->> 'requirement_invitation_id')::uuid), '{}'::jsonb)
    end
    -- V44: to the employer's owners and admins, the requirement's own title and the partner's display name; never the
    -- statement, the fee or the withdrawal reason of the response (FR-T1 AC2). The slug is the employer's own.
    when 'response_received' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id, 'title', r.title,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations o on o.id = p.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
    when 'response_withdrawn' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id, 'title', r.title,
        'partner_name', o.display_name, 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations o on o.id = p.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid), '{}'::jsonb)
    -- V47: to the partner's owners and admins, its own decision only; the requirement's own title and the employer's name
    -- once the employer is named to the partner, the generated title otherwise (NFR-S11). Never the note or anything of
    -- another partner (FR-O3 AC7). The slug is the partner's own.
    when 'response_decided' then coalesce((
      select jsonb_build_object('response_id', p.id, 'requirement_id', r.id,
        'title', case when private.requirement_named_to(r.id, p.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'employer_name', case when private.requirement_named_to(r.id, p.organization_id) then e.display_name end,
        'decision', p_message ->> 'decision', 'org_slug', v_slug)
      from public.partner_responses p
      join public.workforce_requirements r on r.id = p.requirement_id
      join public.organizations e on e.id = r.organization_id
      where p.id = (p_message ->> 'partner_response_id')::uuid
        and p_message ->> 'decision' in ('shortlisted', 'selected', 'declined', 'submissions_allowed')), '{}'::jsonb)
    -- V48: to the candidate, the partner and the requirement as the candidate may read it (the employer's own title and
    -- name only when the employer shows its name, NFR-S11), destination and start date, for the request page; to an
    -- address without an account the same without the id (the page needs an account). Never the address or another
    -- partner (FR-O4 AC1, AC2, AC10).
    when 'submission_request' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'partner_name', o.display_name,
        'title', private.submission_candidate_title(r), 'country_code', r.country_code, 'country_name', c.name,
        'start_date', r.start_date, 'employer_name', case when r.show_identity then e.display_name end)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    when 'submission_request_signup' then coalesce((
      select jsonb_build_object('partner_name', o.display_name, 'title', private.submission_candidate_title(r),
        'country_code', r.country_code, 'country_name', c.name, 'start_date', r.start_date,
        'employer_name', case when r.show_identity then e.display_name end)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      join public.countries c on c.code = r.country_code
      join public.organizations e on e.id = r.organization_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    -- V48: to the owners and admins of the partner and of the employer, the requirement as the recipient knows it (the
    -- generated title to a partner the employer is not named to) and the partner's name; never the candidate, the address
    -- or the documents (FR-O4 AC5, AC9). The slug is the recipient's own.
    when 'submission_approved' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when (p_message ->> 'organization_id')::uuid = s.employer_organization_id
                        or private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'partner_name', o.display_name, 'org_slug', v_slug,
        'to_partner', (p_message ->> 'organization_id')::uuid = s.organization_id)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    when 'submission_withdrawn' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when (p_message ->> 'organization_id')::uuid = s.employer_organization_id
                        or private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'partner_name', o.display_name, 'org_slug', v_slug,
        'to_partner', (p_message ->> 'organization_id')::uuid = s.organization_id)
      from public.candidate_submissions s
      join public.organizations o on o.id = s.organization_id
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid), '{}'::jsonb)
    -- V50: to the partner's owners and admins, the stage its candidate reached and the requirement as the partner knows it
    -- (the generated title until the employer is named to it); never the candidate's name, the note or the reason (FR-O5
    -- AC5, AC10). The slug is the partner's own.
    when 'submission_stage_changed' then coalesce((
      select jsonb_build_object('submission_id', s.id, 'requirement_id', r.id,
        'title', case when private.requirement_named_to(r.id, s.organization_id) then r.title
          else private.job_order_neutral_title(r.id) end,
        'status', p_message ->> 'status', 'org_slug', v_slug)
      from public.candidate_submissions s
      join public.workforce_requirements r on r.id = s.requirement_id
      where s.id = (p_message ->> 'submission_id')::uuid
        and p_message ->> 'status' in ('shortlisted', 'interview', 'offer', 'hired', 'rejected')), '{}'::jsonb)
    -- V68: to the worker, the end of the answer period of the yearly confirmation only; the card, the name and the
    -- consent stay out (NFR-S9).
    when 'visibility_confirmation' then jsonb_build_object('respond_by', p_message -> 'respond_by')
    -- V70: to the worker, the organisation that asks (display name, type, based-in country) and the vacancy offered, never
    -- the message or the member who sent it; to the organisation, the answer and the slug for the link, never the worker's
    -- name or anything of the passport (NFR-S9).
    when 'contact_request_received' then coalesce((
      select jsonb_build_object('contact_request_id', r.id, 'org_name', o.display_name, 'org_type', o.type,
        'country_code', o.based_in_country, 'country_name', c.name, 'job_title', j.title)
      from public.contact_requests r
      join public.organizations o on o.id = r.organization_id
      left join public.countries c on c.code = o.based_in_country
      left join public.jobs j on j.id = r.job_id
      where r.id = (p_message ->> 'contact_request_id')::uuid), '{}'::jsonb)
    when 'contact_request_decided' then coalesce((
      select jsonb_build_object('contact_request_id', r.id, 'decision', p_message ->> 'decision', 'org_slug', v_slug)
      from public.contact_requests r
      where r.id = (p_message ->> 'contact_request_id')::uuid
        and p_message ->> 'decision' in ('accepted', 'declined')), '{}'::jsonb)
    else '{}'::jsonb
  end);
end;

$$;
