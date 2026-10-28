begin;
select plan(33);

\ir jobs_fixture.inc

-- The new job order alert (V40, FR-N1 step Alert, AC10; FR-T1 kind job_order_match, AC2, AC4, AC6 alert part; NFR-S11;
-- DATA_MODEL.md section 9): private.queue_job_order_matches, the trigger workforce_requirements_job_order_alert, the
-- catalogue row, the payload and the setting job_order_match_daily_max. Acme (t.a: owner own1, admin adm, member mem)
-- is the employer of the fixture; the partners, each with an owner of its own, are made below.

\set u1 '00000000-0000-0000-0000-0000000f4001'
\set u1a '00000000-0000-0000-0000-0000000f4002'
\set u1m '00000000-0000-0000-0000-0000000f4003'
\set u1p '00000000-0000-0000-0000-0000000f4004'
\set u2 '00000000-0000-0000-0000-0000000f4005'
\set u3 '00000000-0000-0000-0000-0000000f4006'
\set u3b '00000000-0000-0000-0000-0000000f4007'
\set u4 '00000000-0000-0000-0000-0000000f4008'
\set u5 '00000000-0000-0000-0000-0000000f4009'
\set u6 '00000000-0000-0000-0000-0000000f4010'
\set u7 '00000000-0000-0000-0000-0000000f4011'
\set u8 '00000000-0000-0000-0000-0000000f4012'

update private.settings set value = 'true' where key in ('release_job_orders', 'release_partner_directories');
select set_config('t.own1', :'own1', false) as setup_own1 \gset
update public.organizations set display_name = 'Acme Bau', website = 'https://www.acme-bau.de' where id = current_setting('t.a')::uuid;

-- A listed partner of p_type owned by p_owner, serving p_serves and listing p_occupations, with an active subscription
-- to p_plan (none when null).
create function pg_temp.partner(
  p_slug text, p_owner uuid, p_serves text[], p_occupations text[], p_plan text default 'recruitment_partner',
  p_type text default 'recruitment_company'
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  select v_id, 'serves_market'::public.geography_scope, c from unnest(p_serves) c;
  insert into public.organization_occupations (organization_id, occupation_id) select v_id, o from unnest(p_occupations) o;
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  end if;
  return v_id;
end;
$$;

-- A further member of p_org with p_role, accepted unless p_pending.
create function pg_temp.member(p_org uuid, p_user uuid, p_role text, p_pending boolean default false) returns void
language plpgsql as $$
begin
  perform pg_temp.new_user(p_user);
  update public.profiles set account_kind = intended_account_kind where id = p_user;
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (p_org, p_user, p_role::public.member_role, case when not p_pending then now() end);
end;
$$;

-- The alert switch of p_user as the settings page stores it.
create function pg_temp.alert(p_user uuid, p_on boolean) returns void
language sql as $$
  insert into public.notification_preferences (user_id, email_kinds) values (p_user, jsonb_build_object('job_order_match', p_on))
  on conflict (user_id) do update set email_kinds = public.notification_preferences.email_kinds || excluded.email_kinds
$$;

-- A draft requirement of Acme with the occupations of p_occupations ({"7212": 80, ...}) and the destination p_country.
create function pg_temp.draft(p_title text, p_occupations jsonb, p_country text default 'DE') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status
  ) values (
    v_id, current_setting('t.a')::uuid, p_title, (select sum(value::integer) from jsonb_each_text(p_occupations)), p_country,
    'Hamburg', 'C', date '2027-01-15', 'full_time', 'both', 'both', 'draft'
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select v_id, key, value::integer from jsonb_each_text(p_occupations);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, p_country);
  return v_id;
end;
$$;

-- publish_requirement as the owner of Acme at aal2: 'ok' or 'sqlstate|message|detail'.
create function pg_temp.pub(p_req uuid, p_visibility text, p_show boolean default false) returns text
language sql as $$
  select pg_temp.call_as(current_setting('t.own1')::uuid, 'authenticated', format(
    'select public.publish_requirement(%L, %L, %L::public.requirement_visibility, %L, %L::timestamptz)',
    current_setting('t.a'), p_req, p_visibility, p_show,
    (select updated_at from public.workforce_requirements where id = p_req)))
$$;

-- The users with a job_order_match row for p_req, sorted, as text.
create function pg_temp.alerted(p_req uuid) returns text
language sql as $$
  select coalesce(string_agg(n.user_id::text || ':' || n.status, ',' order by n.user_id), '')
  from public.notifications n where n.kind = 'job_order_match' and n.payload ->> 'requirement_id' = p_req::text
$$;

create function pg_temp.alert_count(p_user uuid) returns integer
language sql as $$ select count(*)::integer from public.notifications where user_id = p_user and kind = 'job_order_match' $$;

select pg_temp.partner('p1-alert', :'u1', array['DE'], array['7212']) as p1 \gset
select pg_temp.member(:'p1', :'u1a', 'admin');
select pg_temp.member(:'p1', :'u1m', 'member');
select pg_temp.member(:'p1', :'u1p', 'admin', true);
select pg_temp.partner('p2-alert', :'u2', array['PL'], array['7212']) as p2 \gset
select pg_temp.partner('p3-alert', :'u3', array['DE'], array['7212']) as p3 \gset
select pg_temp.member(:'p3', :'u3b', 'admin');
select pg_temp.partner('p4-alert', :'u4', array['DE'], array['7212'], null) as p4 \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'p4', 'recruitment_partner', 'canceled', 'null');
select pg_temp.partner('p5-alert', :'u5', array['DE'], array['7212']) as p5 \gset
update public.organizations set listed_at = null, review_status = 'pending_review' where id = :'p5';
select pg_temp.partner('p6-alert', :'u6', array['DE'], array['7212']) as p6 \gset
update public.organizations set status = 'suspended' where id = :'p6';
select pg_temp.partner('p7-alert', :'u7', array['DE'], array['7212']) as p7 \gset
update public.organizations set moderation_state = 'hidden' where id = :'p7';
select pg_temp.partner('p8-alert', :'u8', array['DE', 'NL'], array['7214'], 'staffing_partner', 'staffing_company') as p8 \gset
select pg_temp.alert(u, true) from unnest(array[:'u1', :'u1a', :'u1m', :'u1p', :'u2', :'u4', :'u5', :'u6', :'u7', :'u8']::uuid[]) u;
select pg_temp.alert(:'u3', false);

-- Catalogue and settings -------------------------------------------------------------------------------------------------

select is(
  (select format('%s|%s|%s|%s|%s', mandatory, default_email, audience, label, organization_types)
   from private.notification_kinds where kind = 'job_order_match'),
  'f|f|company|New job orders that fit|{recruitment_company,staffing_company}',
  'FR-T1: job_order_match is optional, off by default, offered to recruitment and staffing companies only');
select is((select value #>> '{}' from private.settings where key = 'job_order_match_daily_max'), '10',
  'NFR-O5: at most 10 alerts per person and day by default');
select ok(
  exists (select 1 from private.setting_rules where key = 'job_order_match_daily_max' and editable and min = 1 and max = 100),
  'NFR-O5: the cap is a setting of the settings editor, 1 to 100');
select ok(
  not has_function_privilege('anon', 'private.queue_job_order_matches(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.queue_job_order_matches(uuid)', 'execute')
    and not has_function_privilege('service_role', 'private.queue_job_order_matches(uuid)', 'execute'),
  'no API role queues alerts');

-- AC10: one alert per owner and admin of each eligible partner that switched it on ------------------------------------------

select pg_temp.draft('Hamburg yard welders by Acme Bau', '{"7212": 80, "7214": 20}') as r \gset
select is(pg_temp.pub(:'r', 'job_order_marketplace'), 'ok', 'Acme publishes an anonymous job order (DE, 7212 and 7214)');
select is(pg_temp.alerted(:'r'),
  (select string_agg(u || ':queued', ',' order by u) from unnest(array[:'u1', :'u1a', :'u8']) u),
  'AC10: exactly the owner and admin of P1 and the owner of the eligible staffing company P8 get one queued row each');
select is(
  (select count(*)::integer from pgmq.q_notifications where message ->> 'kind' = 'job_order_match'
     and message ->> 'requirement_id' = :'r'), 3,
  'NFR-A3: one queue message each, in the publishing transaction');
select is(pg_temp.alert_count(:'u1m') + pg_temp.alert_count(:'u1p'), 0, 'AC10: none for the member or the pending admin of P1');
select is(pg_temp.alert_count(:'u2'), 0, 'AC10: none for P2, which serves only Poland');
select is(pg_temp.alert_count(:'u3') + pg_temp.alert_count(:'u3b'), 0,
  'AC10: none for P3, eligible with the alert off (and its admin who never chose: the alert is off by default), not even an in-app row');
select is(pg_temp.alert_count(:'u4'), 0, 'none for P4, whose subscription lapsed to the free plan (titles only)');
select is(pg_temp.alert_count(:'u5') + pg_temp.alert_count(:'u6') + pg_temp.alert_count(:'u7'), 0,
  'none for a partner not listed, suspended or hidden by moderation');

-- FR-T1 AC2, NFR-S11: the payload --------------------------------------------------------------------------------------------

select is(
  (select string_agg(k, ',' order by k) from public.notifications n, jsonb_object_keys(n.payload) k
   where n.user_id = :'u1' and n.kind = 'job_order_match'),
  'country_code,country_name,org_slug,requirement_id,title',
  'AC10, FR-T1 AC2: the payload holds the requirement id, the title, the destination and the recipient''s own slug only');
select is(
  (select payload ->> 'title' from public.notifications where user_id = :'u1' and kind = 'job_order_match'),
  'Germany, 100 Welders and flame cutters', 'NFR-S11: the title is the generated one, not the employer''s own');
select is(
  (select string_agg(n.payload ->> 'org_slug', ',' order by n.user_id) from public.notifications n
   where n.kind = 'job_order_match' and n.payload ->> 'requirement_id' = :'r'),
  'p1-alert,p1-alert,p8-alert', 'the link of each alert is the recipient partner''s own job order page');
select ok(
  not exists (select 1 from public.notifications n where n.kind = 'job_order_match'
    and (n.payload::text ilike '%acme%' or n.payload::text like '%' || current_setting('t.a') || '%' or n.payload::text like '%Hamburg%')),
  'NFR-S11: no alert names the employer, its id or the city');

select pg_temp.draft('Acme Bau named welders', '{"7212": 10}') as named \gset
select is(pg_temp.pub(:'named', 'job_order_marketplace', true), 'ok', 'Acme publishes a job order showing its name');
select is(
  (select string_agg(n.payload ->> 'title', ',') from public.notifications n where n.user_id = :'u1' and n.payload ->> 'requirement_id' = :'named'),
  'Germany, 10 Welders and flame cutters', 'NFR-S11: even then the email carries the generated title and no name');

-- Not a marketplace publication ------------------------------------------------------------------------------------------------

select pg_temp.draft('Private welders', '{"7212": 10}') as priv \gset
select is(pg_temp.pub(:'priv', 'private'), 'ok', 'Acme publishes a private requirement with the same fields');
select is(pg_temp.alerted(:'priv'), '', 'AC10: it alerts nobody');

-- Once per job order -----------------------------------------------------------------------------------------------------------

-- set_requirement_status as the owner of Acme at aal2 with the requirement's current version.
create function pg_temp.st(p_req uuid, p_status text) returns text
language sql as $$
  select pg_temp.call_as(current_setting('t.own1')::uuid, 'authenticated', format(
    'select public.set_requirement_status(%L, %L, %L::public.requirement_status, %L::timestamptz)',
    current_setting('t.a'), p_req, p_status, (select updated_at from public.workforce_requirements where id = p_req)))
$$;
select is(pg_temp.st(:'r', 'paused'), 'ok', 'the owner pauses the first job order');
select is(pg_temp.st(:'r', 'open'), 'ok', 'and reopens it');
select is(private.queue_job_order_matches(:'r'), 0, 'a second run for the same job order queues nothing (dedupe key per job order)');
select is(pg_temp.alert_count(:'u1'), 2, 'P1''s owner still has one alert per job order');

-- Preferences through the settings RPC ----------------------------------------------------------------------------------------

select is(
  pg_temp.call_as(:'u3', 'authenticated', $$select public.set_notification_preferences('{"job_order_match": true}'::jsonb)$$),
  'ok', 'P3''s owner switches the alert on in the settings');
select is(
  pg_temp.call_as(:'u1', 'authenticated', $$select public.set_notification_preferences('{"job_order_match": false}'::jsonb)$$),
  'ok', 'P1''s owner switches it off');
select pg_temp.draft('Third welders', '{"7212": 5}') as third \gset
select is(pg_temp.pub(:'third', 'job_order_marketplace'), 'ok', 'Acme publishes a third job order');
select is(pg_temp.alerted(:'third'),
  (select string_agg(u || ':queued', ',' order by u) from unnest(array[:'u1a', :'u3']) u),
  'the switch decides: P3''s owner now gets the alert, P1''s owner no longer; P8 lists no 7212');

-- The daily cap ----------------------------------------------------------------------------------------------------------------

update private.settings set value = to_jsonb(pg_temp.alert_count(:'u1a')) where key = 'job_order_match_daily_max';
select pg_temp.draft('Fourth welders', '{"7212": 5}') as fourth \gset
select is(pg_temp.pub(:'fourth', 'job_order_marketplace'), 'ok', 'Acme publishes a fourth job order');
select is(pg_temp.alerted(:'fourth'), :'u3' || ':queued',
  'NFR-O5: P1''s admin, at the cap for today, gets no further alert; P3''s owner, below it, does');
update private.settings set value = '10' where key = 'job_order_match_daily_max';

-- Release and suspended employer ----------------------------------------------------------------------------------------------

-- Written open as the database owner (an insert passes no guard), so the alert is queued here by hand.
select gen_random_uuid() as fifth \gset
insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
  start_date, employment_type, recruitment_preference, partner_need, status, visibility, published_at, closes_on)
values (:'fifth', current_setting('t.a')::uuid, 'Fifth welders', 5, 'DE', 'Hamburg', 'C', date '2027-01-15', 'full_time', 'both',
  'both', 'open', 'job_order_marketplace', now(), date '2027-02-14');
insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (:'fifth', '7212', 5);
insert into public.requirement_countries (requirement_id, country_code) values (:'fifth', 'DE');
update private.settings set value = 'false' where key = 'release_job_orders';
select is(private.queue_job_order_matches(:'fifth'), 0, 'release_job_orders off: an open job order alerts nobody');
update private.settings set value = 'true' where key = 'release_job_orders';
update public.organizations set status = 'suspended' where id = current_setting('t.a')::uuid;
select is(private.queue_job_order_matches(:'fifth'), 0, 'a job order of a suspended employer alerts nobody');
update public.organizations set status = 'active' where id = current_setting('t.a')::uuid;
select is(private.queue_job_order_matches(:'fifth'), 2, 'with the release on and the employer active it alerts P1''s admin and P3''s owner');

update private.settings set value = 'false' where key in ('release_job_orders', 'release_partner_directories');

select * from finish();
rollback;
