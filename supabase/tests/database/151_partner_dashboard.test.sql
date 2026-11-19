begin;
select plan(31);

\ir organizations_fixture.inc

-- Partner dashboards, release 2a parts (V30, FR-R3 AC3 and AC10, FR-R4 AC2, AC3 refusals and AC9 views; SOP P2-37 and
-- P2-38 steps Blocks and Grow, control "figures from the database only"; NFR-S8): public.get_partner_dashboard. The
-- figures of release 2b and 2c (FR-R3 AC4 to AC6, FR-R4 AC3 counts and AC6) are V55 and V75.

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type, p_slug text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.add_member(p_org uuid, p_user uuid, p_role public.member_role default 'member') returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

-- The dashboard row of p_org as p_user (null: anonymous) reads it, kept in t.result; returns 'ok' or the refusal.
create function pg_temp.dash(p_user uuid, p_org uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from public.get_partner_dashboard(%L) r)::text, ''[]''), true)', p_org),
    'aal1')
$$;

create function pg_temp.row() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb -> 0 $$;

create function pg_temp.listing(p_org uuid, p_occupation text, p_days_ago integer) returns void
language sql as $$
  insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity, available_from)
  values (p_org, p_occupation, 'PH', 25, 5, current_date);
  update public.workforce_availability set confirmed_at = now() - make_interval(days => p_days_ago)
  where organization_id = p_org and occupation_id = p_occupation;
$$;

create function pg_temp.licence(p_org uuid, p_number text, p_valid_until date, p_status text) returns void
language sql as $$
  insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until,
    confirmed_at, partner_terms_version, status)
  values (p_org, 'PH', 'Department of Migrant Workers', p_number, p_valid_until, now(), 1, p_status)
$$;

create function pg_temp.views(p_org uuid, p_value integer) returns void
language sql as $$
  insert into private.org_analytics_daily (organization_id, day, metric, country_code, value)
  values (p_org, (now() at time zone 'utc')::date - 3, 'profile_views', 'DE', p_value)
$$;

\set rown '00000000-0000-0000-0000-000000151001'
\set radm '00000000-0000-0000-0000-000000151002'
\set rmem '00000000-0000-0000-0000-000000151003'
\set sadm '00000000-0000-0000-0000-000000151004'
\set town '00000000-0000-0000-0000-000000151005'
\set aown '00000000-0000-0000-0000-000000151006'
\set cand '00000000-0000-0000-0000-000000151007'
\set staff '00000000-0000-0000-0000-000000151008'
\set both '00000000-0000-0000-0000-000000151009'

select pg_temp.new_user(u) from unnest(array[:'rown', :'radm', :'rmem', :'sadm', :'town', :'aown', :'staff', :'both']::uuid[]) u;
select pg_temp.new_user(:'cand', 'worker');
update public.profiles set account_kind = intended_account_kind
where id in (:'rown', :'radm', :'rmem', :'sadm', :'town', :'aown', :'cand', :'staff', :'both');
insert into public.platform_staff (user_id, role) values (:'staff', 'admin');

select pg_temp.new_org(:'rown', 'recruitment_company', 'dash-recruiter') as r \gset
select pg_temp.new_org(:'sadm', 'staffing_company', 'dash-staffing') as s \gset
select pg_temp.new_org(:'town', 'recruitment_company', 'dash-viewed') as t \gset
select pg_temp.new_org(:'aown', 'employer', 'dash-employer') as a \gset
select pg_temp.add_member(:'r', :'radm', 'admin');
select pg_temp.add_member(:'r', :'rmem');
select pg_temp.add_member(:'a', :'both', 'admin');
select pg_temp.add_member(:'r', :'both');
insert into public.organization_geographies (organization_id, scope, country_code)
values (:'r', 'sources_from', 'PH'), (:'r', 'serves_market', 'DE');
insert into public.organization_occupations (organization_id, occupation_id)
values (:'r', '7212'), (:'r', '9329'), (:'r', '5120'), (:'r', '7112');
update public.organizations set legal_entity_identifier = 'DASHR151', legal_entity_identifier_kind = 'registration_number'
where id = :'r';
update public.organizations set review_status = 'listed', listed_at = now() - interval '3 days', submitted_at = now() - interval '4 days',
  workforce_profile_updated_at = now() - interval '1 day'
where id in (:'r', :'t');
update public.organizations set review_status = 'pending_review', submitted_at = now() where id = :'s';
update private.settings set value = 'true' where key = 'release_partner_directories';

-- Grants and shape -----------------------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.get_partner_dashboard(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.get_partner_dashboard(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.get_partner_dashboard(uuid)', 'execute')
  and (select prosecdef and provolatile = 's' and proconfig @> array['search_path=""']
       from pg_proc where oid = 'public.get_partner_dashboard(uuid)'::regprocedure),
  'get_partner_dashboard: signed-in callers only, security definer, stable (writes nothing), empty search_path'
);

-- AC3: the columns are counts, dates, states and flags; none names an employer, requirement, worker, viewer or follower.
select is(
  (select string_agg(a.name, ',' order by a.ord)
   from pg_proc p cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality as a (name, mode, ord)
   where p.oid = 'public.get_partner_dashboard(uuid)'::regprocedure and a.mode = 't'),
  'organization_type,review_status,listed,profile_hidden,profile_missing,profile_updated_at,listings_total,listings_due,'
  || 'listings_stale,oldest_listing_confirmed_at,licences_current,licences_expiring,licences_expired,next_licence_expiry,'
  || 'profile_views_30d,profile_views_suppressed,profile_views_fewer_than,profile_views_in_plan',
  'AC3: the result columns are counts, dates and states only'
);

-- Who may read (AC3, FR-R4 AC2, AC3) ------------------------------------------------------------------------------------
select is(pg_temp.dash(:'rmem', :'r') || ':' || jsonb_array_length(current_setting('t.result')::jsonb), 'ok:1',
  'AC3: a member of R receives one row');
select is(pg_temp.dash(:'rown', :'r'), 'ok', 'the owner of R reads it at aal1 too');
select is(pg_temp.dash(:'radm', :'r'), 'ok', 'an admin of R reads it');
select is(pg_temp.dash(:'both', :'r'), 'ok', 'a user of an employer who is also a member of R reads R''s dashboard');
select is(pg_temp.dash(:'sadm', :'r'), '42501|CHARA_FORBIDDEN|', 'AC3: the admin of staffing company S is refused for R');
select is(pg_temp.dash(:'town', :'r'), '42501|CHARA_FORBIDDEN|', 'NFR-S8: the owner of a competing recruitment company is refused');
select is(pg_temp.dash(:'rmem', :'s'), '42501|CHARA_FORBIDDEN|', 'FR-R4 AC3: a member of R is refused for S');
select is(pg_temp.dash(:'cand', :'r'), '42501|CHARA_FORBIDDEN|company_account_required',
  'AC3: a candidate is refused with company_account_required');
select is(pg_temp.dash(:'staff', :'r'), '42501|CHARA_FORBIDDEN|', 'platform staff have no access to organisation dashboards');
select matches(pg_temp.dash(null, :'r'), '^42501\|permission denied for function get_partner_dashboard',
  'AC3: anonymous has no EXECUTE');
select is(pg_temp.dash(:'aown', :'a'), '42501|CHARA_FORBIDDEN|wrong_org_type',
  'AC3: the owner of employer A calling it for A is refused with wrong_org_type');
select is(pg_temp.dash(:'both', :'a'), '42501|CHARA_FORBIDDEN|wrong_org_type',
  'the user of both organisations is refused for the employer');
select is(pg_temp.dash(:'rmem', null), '42501|CHARA_FORBIDDEN|', 'a missing organisation is refused');

update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.dash(:'rmem', :'r'), '42501|CHARA_FORBIDDEN|release_off', 'the dashboard is closed while release 2a is off');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- Review, listing and profile state --------------------------------------------------------------------------------------
select pg_temp.dash(:'rmem', :'r') as quiet \gset
select is(
  (select format('%s|%s|%s|%s', r ->> 'organization_type', r ->> 'review_status', r ->> 'listed', r ->> 'profile_hidden')
   from pg_temp.row() r),
  'recruitment_company|listed|true|false', 'a listed recruitment company reads its type, review state and listing');
select is(pg_temp.row() ->> 'profile_missing', 'recruitment_type', 'the first missing part of the workforce profile is named');
select pg_temp.dash(:'sadm', :'s') as quiet \gset
select is(
  (select format('%s|%s|%s', r ->> 'organization_type', r ->> 'review_status', r ->> 'listed') from pg_temp.row() r),
  'staffing_company|pending_review|false', 'a staffing company waiting for review is not listed');
select is(pg_temp.row() ->> 'profile_missing', 'legal_entity_identifier', 'a profile without an identifier names it first');

update public.organizations set moderation_state = 'hidden' where id = :'r';
select pg_temp.dash(:'rmem', :'r') as quiet \gset
select is(pg_temp.row() ->> 'profile_hidden', 'true', 'a profile hidden by moderation says so');
update public.organizations set moderation_state = 'visible' where id = :'r';

-- Listings by freshness (FR-R3 AC8, FR-R4 AC4 data: 59 current, 61 stale) ------------------------------------------------
select pg_temp.dash(:'rmem', :'r') as quiet \gset
select is(
  (select format('%s|%s|%s|%s', r ->> 'listings_total', r ->> 'listings_due', r ->> 'listings_stale',
     r ->> 'oldest_listing_confirmed_at') from pg_temp.row() r),
  '0|0|0|', 'without listings every count is 0 and there is no oldest confirmation');
select pg_temp.listing(:'r', '7212', 2);
select pg_temp.listing(:'r', '9329', 59);
select pg_temp.listing(:'r', '5120', 61);
select pg_temp.listing(:'r', '7112', 35);
select pg_temp.dash(:'rmem', :'r') as quiet \gset
select is(
  (select format('%s|%s|%s', r ->> 'listings_total', r ->> 'listings_due', r ->> 'listings_stale') from pg_temp.row() r),
  '4|2|1', 'four listings: confirmed 35 and 59 days ago are due, 61 days ago is stale, 2 days ago is fresh');
select ok(
  (pg_temp.row() ->> 'oldest_listing_confirmed_at')::timestamptz between now() - interval '61 days 1 minute' and now() - interval '60 days 23 hours',
  'the oldest confirmation is the 61-day listing');
update private.settings set value = '90' where key = 'workforce_listing_stale_days';
select pg_temp.dash(:'rmem', :'r') as quiet \gset
select is(
  (select format('%s|%s', r ->> 'listings_due', r ->> 'listings_stale') from pg_temp.row() r),
  '3|0', 'NFR-O5: the staleness period is the setting workforce_listing_stale_days, read on each call');
update private.settings set value = '60' where key = 'workforce_listing_stale_days';

-- Licences by expiry ------------------------------------------------------------------------------------------------------
select pg_temp.licence(:'r', 'DMW-0001', current_date + 10, 'current');
select pg_temp.licence(:'r', 'DMW-0002', current_date + 200, 'current');
select pg_temp.licence(:'r', 'DMW-0003', current_date - 5, 'expired');
select pg_temp.dash(:'rmem', :'r') as quiet \gset
select is(
  (select format('%s|%s|%s|%s', r ->> 'licences_current', r ->> 'licences_expiring', r ->> 'licences_expired',
     (r ->> 'next_licence_expiry')::date - current_date) from pg_temp.row() r),
  '2|1|1|10', 'two current licences, one expiring within licence_expiry_reminder_days, one expired, next expiry in 10 days');

-- Profile views (FR-R3 AC10, FR-R4 AC9) ------------------------------------------------------------------------------------
select pg_temp.views(:'r', 3);
select pg_temp.views(:'t', 7);
select pg_temp.dash(:'rmem', :'r') as quiet \gset
select is(
  (select format('%s|%s|%s|%s', coalesce(r ->> 'profile_views_30d', 'null'), r ->> 'profile_views_suppressed',
     r ->> 'profile_views_fewer_than', r ->> 'profile_views_in_plan') from pg_temp.row() r),
  'null|true|5|true', 'AC10: 3 views in 30 days are null with the suppressed flag and the threshold 5');
select pg_temp.dash(:'town', :'t') as quiet \gset
select is(
  (select format('%s|%s|%s', r ->> 'profile_views_30d', r ->> 'profile_views_suppressed',
     coalesce(r ->> 'profile_views_fewer_than', 'null')) from pg_temp.row() r),
  '7|false|null', 'AC10: 7 views are returned as 7');
select pg_temp.dash(:'sadm', :'s') as quiet \gset
select is(
  (select format('%s|%s', r ->> 'profile_views_30d', r ->> 'profile_views_suppressed') from pg_temp.row() r),
  '0|false', 'AC7: a company without any view reads 0, not suppressed (the page shows guidance instead of a bare 0)');

-- FR-R6 AC6: with the plan limits enforced, a free plan has no analytics level, so no count is returned.
update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.dash(:'town', :'t') as quiet \gset
select is(
  (select format('%s|%s|%s', coalesce(r ->> 'profile_views_30d', 'null'), r ->> 'profile_views_suppressed',
     r ->> 'profile_views_in_plan') from pg_temp.row() r),
  'null|false|false', 'a free plan with limits enforced reads no view count and profile_views_in_plan false');
insert into billing.subscriptions (organization_id, plan_code, status, provider, current_period_end)
values (:'t', 'recruitment_partner', 'active', 'null', now() + interval '20 days');
select pg_temp.dash(:'town', :'t') as quiet \gset
select is(
  (select format('%s|%s', r ->> 'profile_views_30d', r ->> 'profile_views_in_plan') from pg_temp.row() r),
  '7|true', 'the Partner plan (analytics_basic) reads the count');
update private.settings set value = 'false' where key = 'entitlements_enforced';

update private.settings set value = 'false' where key = 'release_partner_directories';

select * from finish();
rollback;
