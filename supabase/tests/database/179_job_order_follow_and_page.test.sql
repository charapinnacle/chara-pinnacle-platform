begin;
select plan(45);

\ir jobs_fixture.inc

-- Named job orders on the company page and in the follower digest (V54, FR-K5 AC3, AC4; FR-L4 AC7; decisions 3.1, 3.2;
-- NFR-S8 with two employers, two partners, two candidates and anon; NFR-S11): get_company_page with job_order_count,
-- job_orders and viewer_partner_slug, the trigger workforce_requirements_follow_activity, private.queue_follower_digests
-- and the followed_company_activity payload with job orders. Acme (t.a: owner own1, admin adm, member mem) and Beta
-- (t.b: owner own2, admin adm2) are the employers of the fixture and wkr a candidate; the partners and the second
-- candidate are made below.

\set w2 '00000000-0000-0000-0000-0000000f5401'
\set u1 '00000000-0000-0000-0000-0000000f5402'
\set u1a '00000000-0000-0000-0000-0000000f5403'
\set u2 '00000000-0000-0000-0000-0000000f5404'
\set uk '00000000-0000-0000-0000-0000000f5405'

update private.settings set value = 'true' where key in ('release_job_orders', 'release_partner_directories');
select set_config('t.own1', :'own1', false) as setup_own1 \gset
update public.organizations set public_page_enabled = true where id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid);
select pg_temp.new_user(:'w2', 'worker');
update public.profiles set account_kind = intended_account_kind where id = :'w2';

-- A recruitment company owned by p_owner, listed unless p_review says otherwise.
create function pg_temp.partner(p_slug text, p_owner uuid, p_review text default 'listed') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'recruitment_company', p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations set review_status = p_review::public.partner_review_status, submitted_at = now() - interval '31 days',
    listed_at = case when p_review = 'listed' then now() - interval '30 days' end
  where id = v_id;
  return v_id;
end;
$$;

-- A draft requirement of p_org for 30 welders in Germany.
create function pg_temp.draft(p_org uuid, p_title text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status
  ) values (
    v_id, p_org, p_title, 30, 'DE', 'Hamburg', 'C', date '2027-06-15', 'full_time', 'both', 'both', 'draft'
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 30);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

-- publish_requirement as p_owner of p_org at aal2: 'ok' or 'sqlstate|message|detail'.
create function pg_temp.pub(p_owner uuid, p_org uuid, p_req uuid, p_visibility text, p_show boolean) returns text
language sql as $$
  select pg_temp.call_as(p_owner, 'authenticated', format(
    'select public.publish_requirement(%L, %L, %L::public.requirement_visibility, %L, %L::timestamptz)',
    p_org, p_req, p_visibility, p_show, (select updated_at from public.workforce_requirements where id = p_req)))
$$;

-- set_requirement_status as the owner of Acme at aal2.
create function pg_temp.req_status(p_req uuid, p_status text) returns text
language sql as $$
  select pg_temp.call_as(current_setting('t.own1')::uuid, 'authenticated', format(
    'select public.set_requirement_status(%L, %L, %L::public.requirement_status, %L::timestamptz, %s)',
    current_setting('t.a'), p_req, p_status, (select updated_at from public.workforce_requirements where id = p_req),
    case when p_status = 'closed' then quote_literal('cancelled') || '::public.requirement_close_reason' else 'null' end))
$$;

-- get_company_page of p_slug as p_user (anonymous when null): 'ok' with the row in t.result, or the refusal.
create function pg_temp.page_as(p_user uuid, p_slug text) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', (select to_jsonb(r) from public.get_company_page(%L) r)::text, true)', p_slug), 'aal1')
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

-- The job orders of the page read as p_user: count|ids (or titles when no id is given), sorted, since two publications
-- of one transaction share their time|viewer_partner_slug.
create function pg_temp.seen(p_user uuid, p_slug text) returns text
language plpgsql as $$
begin
  if pg_temp.page_as(p_user, p_slug) <> 'ok' then
    return 'refused';
  end if;
  return concat_ws('|', pg_temp.result() ->> 'job_order_count',
    (select string_agg(x, ',' order by x)
     from jsonb_array_elements(pg_temp.result() -> 'job_orders') e
     cross join lateral (select coalesce(e ->> 'id', 'title:' || (e ->> 'title')) as x) v),
    coalesce(pg_temp.result() ->> 'viewer_partner_slug', '-'));
end;
$$;

create function pg_temp.follow_as(p_user uuid, p_org uuid) returns text
language sql as $$ select pg_temp.call_as(p_user, 'authenticated', format('select public.toggle_follow(%L, true)', p_org), 'aal1') $$;

select pg_temp.partner('p1-v54', :'u1') as p1 \gset
select pg_temp.new_user(:'u1a');
update public.profiles set account_kind = intended_account_kind where id = :'u1a';
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'p1', :'u1a', 'admin', now());
select pg_temp.partner('p2-v54', :'u2') as p2 \gset
select pg_temp.partner('pk-v54', :'uk', 'pending_review') as pk \gset
select slug as acme_slug from public.organizations where id = current_setting('t.a')::uuid \gset
select slug as beta_slug from public.organizations where id = current_setting('t.b')::uuid \gset
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset

-- Objects ------------------------------------------------------------------------------------------------------------------
select ok(exists (
    select 1 from pg_trigger where tgname = 'workforce_requirements_follow_activity'
      and tgrelid = 'public.workforce_requirements'::regclass and tgenabled = 'A'),
  'the follow trigger on requirements fires always');
select ok(
  not has_function_privilege('authenticated', 'private.job_order_partner_of(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.requirements_follow_activity()', 'execute'),
  'the helpers are not callable through the API');
select ok(has_function_privilege('anon', 'public.get_company_page(text)', 'execute'), 'the company page stays public');

-- Followers of Acme: the candidate wkr, the owner of P1 and the owner of P2; the second candidate follows Beta.
select is(pg_temp.follow_as(:'wkr', :'acme') || pg_temp.follow_as(:'u1', :'acme') || pg_temp.follow_as(:'u2', :'acme')
  || pg_temp.follow_as(:'w2', :'beta'), 'okokokok', 'two candidates and two partner owners follow the employers');

select is(pg_temp.seen(:'u1', :'acme_slug'), '0|p1-v54', 'no job order yet: the page names none and the count is 0');

-- FR-L4 AC7: only a named marketplace job order enters the outbox -------------------------------------------------------------
select pg_temp.draft(:'acme', 'Welders for the Hamburg yard') as rn \gset
select pg_temp.draft(:'acme', 'Secret welders for Acme') as ra \gset
select pg_temp.draft(:'acme', 'Private welders') as rp \gset
select pg_temp.draft(:'acme', 'Draft welders') as rd \gset
select pg_temp.draft(:'acme', 'Welders closed early') as rc \gset
select pg_temp.draft(:'beta', 'Beta fitters') as rb \gset
select is(
  pg_temp.pub(:'own1', :'acme', :'rn', 'job_order_marketplace', true) || pg_temp.pub(:'own1', :'acme', :'ra', 'job_order_marketplace', false)
  || pg_temp.pub(:'own1', :'acme', :'rp', 'private', false) || pg_temp.pub(:'own1', :'acme', :'rc', 'job_order_marketplace', true)
  || pg_temp.pub(:'own2', :'beta', :'rb', 'job_order_marketplace', true),
  'okokokokok', 'Acme publishes a named, an anonymous and a private requirement and a second named one; Beta a named one');
select is(
  (select string_agg(entity_type || ':' || entity_id, ',' order by entity_id) from private.follow_activity_outbox),
  (select string_agg('job_order:' || r, ',' order by r) from unnest(array[:'rn', :'rc', :'rb']::uuid[]) r),
  'AC7: only the named job orders enter the outbox; the anonymous and the private requirement do not');
select is(pg_temp.req_status(:'rn', 'paused') || pg_temp.req_status(:'rn', 'open'), 'okok', 'Acme pauses and reopens the named job order');
select is((select count(*) from private.follow_activity_outbox where entity_id = :'rn'), 1::bigint, 'reopening adds nothing');

-- FR-K5 AC3, AC4: the page names the open named job orders only --------------------------------------------------------------
select is(pg_temp.page_as(null, :'acme_slug'), 'ok', 'AC3: an anonymous visitor reads the page');
select is(pg_temp.result() ->> 'job_order_count', '2', 'AC3: two named job orders are open');
select is(
  (select e from jsonb_array_elements(pg_temp.result() -> 'job_orders') e where e ->> 'title' = 'Welders closed early'),
  jsonb_build_object('title', 'Welders closed early', 'country_code', 'DE', 'country', 'Germany', 'workers_needed', 30,
    'published_on', (select (published_at at time zone 'utc')::date from public.workforce_requirements where id = :'rc')),
  'AC3: title, destination, workers and the date; no id, no detail for a visitor');
select ok(
  position(:'ra' in pg_temp.result()::text) = 0 and position('Secret' in pg_temp.result()::text) = 0
  and position(:'rp' in pg_temp.result()::text) = 0 and position('Private welders' in pg_temp.result()::text) = 0
  and position('Draft welders' in pg_temp.result()::text) = 0 and position('Beta fitters' in pg_temp.result()::text) = 0,
  'AC4, NFR-S11: the anonymous, private and draft requirements and Beta''s job order are in no field of the page');
select is(pg_temp.result() ->> 'viewer_partner_slug', null, 'a visitor gets no partner slug');
select is(pg_temp.seen(:'u1', :'acme_slug'), format('2|%s,%s|p1-v54', least(:'rc', :'rn'), greatest(:'rc', :'rn')),
  'a partner owner gets the ids and the slug of its own company for the links');
select is(pg_temp.seen(:'u1a', :'acme_slug'), format('2|%s,%s|p1-v54', least(:'rc', :'rn'), greatest(:'rc', :'rn')), 'and so does its admin');
select is(pg_temp.seen(:'u2', :'acme_slug'), format('2|%s,%s|p2-v54', least(:'rc', :'rn'), greatest(:'rc', :'rn')), 'NFR-S8: the second partner gets its own slug');
select is(pg_temp.seen(:'uk', :'acme_slug'), '2|title:Welders closed early,title:Welders for the Hamburg yard|-',
  'a partner that is not listed gets no id and no slug');
select is(pg_temp.seen(:'wkr', :'acme_slug'), '2|title:Welders closed early,title:Welders for the Hamburg yard|-',
  'decision 3.1: a candidate gets no link to a job order');
select is(pg_temp.seen(:'w2', :'acme_slug'), '2|title:Welders closed early,title:Welders for the Hamburg yard|-',
  'NFR-S8: nor does the second candidate');
select is(pg_temp.seen(:'adm', :'acme_slug'), '2|title:Welders closed early,title:Welders for the Hamburg yard|-',
  'the employer''s own admin reads the titles');
select is(pg_temp.result() ->> 'viewer_role', 'admin', 'with its role');
select is(pg_temp.seen(:'adm2', :'acme_slug'), '2|title:Welders closed early,title:Welders for the Hamburg yard|-',
  'NFR-S8: the other employer''s admin reads the titles only');
select is(pg_temp.seen(null, :'beta_slug'), '1|title:Beta fitters|-', 'Beta''s page names only Beta''s job order');

insert into private.requirement_reveals (requirement_id, organization_id, cause) values (:'ra', :'p1', 'invitation');
select is(pg_temp.seen(:'u1', :'acme_slug'), format('2|%s,%s|p1-v54', least(:'rc', :'rn'), greatest(:'rc', :'rn')),
  'NFR-S11: an anonymous job order revealed to the partner stays off the page');

update public.organizations set status = 'suspended' where id = :'p1';
select is(pg_temp.seen(:'u1', :'acme_slug'), '2|title:Welders closed early,title:Welders for the Hamburg yard|-',
  'a suspended partner''s member gets no link');
update public.organizations set status = 'active' where id = :'p1';

select is(pg_temp.req_status(:'rc', 'paused'), 'ok', 'Acme pauses the second job order');
select is(pg_temp.seen(null, :'acme_slug'), '1|title:Welders for the Hamburg yard|-', 'a paused job order leaves the page');
select is(pg_temp.req_status(:'rc', 'open'), 'ok', 'and reopens it');

update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.seen(:'u1', :'acme_slug'), '0|-', 'release 2b off: the job orders leave the page at once');
update private.settings set value = 'true' where key = 'release_job_orders';

update public.organizations set public_page_enabled = false where id = :'acme';
select is(pg_temp.page_as(:'u1', :'acme_slug'), 'P0002|CHARA_NOT_FOUND|', 'a page that is off names no job order');
update public.organizations set public_page_enabled = true where id = :'acme';

-- FR-L4 AC7: the digest -----------------------------------------------------------------------------------------------------
select date_trunc('day', now()) + interval '8 hours' as base \gset
update public.follows set created_at = :'base'::timestamptz - interval '1 day';
select is(pg_temp.insert_as(:'adm', '{"title": "Yard welder"}'), 'ok', 'Acme writes a vacancy');
select id as vd from public.jobs where title = 'Yard welder' \gset
select is(pg_temp.set_status(:'adm', :'vd', 'open'), 'ok', 'and publishes it');
select is(pg_temp.req_status(:'rc', 'closed'), 'ok', 'and closes the second job order before the digest');
update private.follow_activity_outbox set created_at = :'base'::timestamptz + interval '1 hour';
update private.follow_activity_outbox set created_at = :'base'::timestamptz + interval '90 minutes' where entity_id = :'vd';
select is(private.queue_follower_digests(:'base'::timestamptz + interval '2 hours'), 4,
  'one digest for each of the three followers of Acme and one for the follower of Beta');
select is(
  (select string_agg(message ->> 'user_id' || ':' || coalesce(message ->> 'partner_id', '-'), ',' order by message ->> 'user_id')
   from pgmq.q_notifications where message ->> 'kind' = 'followed_company_activity' and message ->> 'organization_id' = :'acme'),
  (select string_agg(u || ':' || p, ',' order by u) from (values (:'wkr', '-'), (:'u1', :'p1'), (:'u2', :'p2')) v (u, p)),
  'each partner owner''s message names its own company for the links, the candidate''s none');
select is(
  (select payload from public.notifications where kind = 'followed_company_activity' and user_id = :'u1'),
  jsonb_build_object('organization_id', :'acme', 'org_name', 'Acme Bau', 'org_slug', :'acme_slug',
    'total', 1, 'vacancies', jsonb_build_array(jsonb_build_object('job_id', :'vd', 'job_title', 'Yard welder')),
    'job_order_total', 1, 'partner_slug', 'p1-v54',
    'job_orders', jsonb_build_array(jsonb_build_object('requirement_id', :'rn', 'title', 'Welders for the Hamburg yard'))),
  'AC7: one message lists the vacancy and the open named job order with its link; the closed one is left out');
select is(
  (select payload from public.notifications where kind = 'followed_company_activity' and user_id = :'wkr'),
  jsonb_build_object('organization_id', :'acme', 'org_name', 'Acme Bau', 'org_slug', :'acme_slug',
    'total', 1, 'vacancies', jsonb_build_array(jsonb_build_object('job_id', :'vd', 'job_title', 'Yard welder')),
    'job_order_total', 1, 'job_orders', jsonb_build_array(jsonb_build_object('title', 'Welders for the Hamburg yard'))),
  'AC7, decision 3.1: the candidate gets the title and no link to the job order');
select is(
  (select payload from public.notifications where kind = 'followed_company_activity' and user_id = :'w2'),
  jsonb_build_object('organization_id', :'beta', 'org_name', 'Beta Works', 'org_slug', :'beta_slug',
    'total', 0, 'vacancies', '[]'::jsonb, 'job_order_total', 1,
    'job_orders', jsonb_build_array(jsonb_build_object('title', 'Beta fitters'))),
  'NFR-S8: the follower of Beta gets Beta''s job order only, as a digest of job orders alone');
select is(
  (select count(*) from public.notifications n where n.kind = 'followed_company_activity'
     and (n.payload::text like '%' || :'ra' || '%' or n.payload::text like '%Secret%' or n.payload::text like '%Private welders%')),
  0::bigint, 'NFR-S11: no digest mentions the anonymous or the private requirement');
select is(private.queue_follower_digests(:'base'::timestamptz + interval '3 hours'), 0, 'at most one digest a day per company');

-- The next day: a job order published while release 2b is switched off before the digest is not sent.
select pg_temp.draft(:'acme', 'Night shift welders') as rx \gset
select is(pg_temp.pub(:'own1', :'acme', :'rx', 'job_order_marketplace', true), 'ok', 'Acme publishes another named job order');
update private.follow_activity_outbox set created_at = :'base'::timestamptz + interval '1 day 1 hour' where entity_id = :'rx';
update private.settings set value = 'false' where key = 'release_job_orders';
select is(private.queue_follower_digests(:'base'::timestamptz + interval '1 day 2 hours'), 0,
  'release 2b off: a digest of job orders alone is not sent');
update private.settings set value = 'true' where key = 'release_job_orders';
select is(private.queue_follower_digests(:'base'::timestamptz + interval '1 day 3 hours'), 3,
  'release 2b on again: the job order reaches the three followers');
select is(
  (select string_agg(n.payload -> 'job_orders' -> 0 ->> 'title', ',') from public.notifications n
   where n.kind = 'followed_company_activity' and n.created_at = now() and n.payload ->> 'job_order_total' = '1'
     and n.payload -> 'job_orders' -> 0 ->> 'title' = 'Night shift welders'),
  'Night shift welders,Night shift welders,Night shift welders', 'each digest names it');

select * from finish();
rollback;
