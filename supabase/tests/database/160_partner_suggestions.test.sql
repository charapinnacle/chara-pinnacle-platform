begin;
select plan(73);

\ir jobs_fixture.inc

-- Partner suggestions for a workforce requirement (V36, FR-M3 AC1 to AC6, AC11; SOP P2-17 steps Select, Rank, Explain;
-- controls rule-based criteria, no paid ranking, no verification wording; decisions 1.1, 3.6; NFR-C8, NFR-S8, NFR-S11,
-- NFR-O5): suggest_partners, the setting partner_suggestions_max and stats.requirement_suggestions. Acme (t.a: owner
-- own1, admin adm, member mem) and Beta (t.b: owner own2, admin adm2) are employers of the fixture and wkr is a
-- candidate; the recruitment company Delta, the suspended employer Zeta and the partners are made below.

\set dadm '00000000-0000-0000-0000-0000000f3601'
\set delta '00000000-0000-0000-0000-0000000f3611'
\set zown '00000000-0000-0000-0000-0000000f3602'
\set zeta '00000000-0000-0000-0000-0000000f3612'
\set padm '00000000-0000-0000-0000-0000000f3603'

select pg_temp.new_user(:'dadm');
select pg_temp.new_user(:'zown');
select pg_temp.new_user(:'padm');
update public.profiles set account_kind = intended_account_kind where id in (:'dadm', :'zown', :'padm');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
values (:'delta', 'recruitment_company', 'delta-v36', 'Delta V36 Ltd', 'Delta V36', 'PH');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'delta', :'dadm', 'owner', now());
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, status)
values (:'zeta', 'employer', 'zeta-v36', 'Zeta V36 GmbH', 'Zeta V36', 'DE', 'suspended');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'zeta', :'zown', 'owner', now());

-- Partners of earlier test data must not change the results below: they are hidden for this transaction.
update public.organizations set moderation_state = 'hidden' where type <> 'employer';
update private.settings set value = 'true' where key in ('release_job_orders', 'release_partner_directories');

-- A listed partner of p_type serving p_serves with the occupations given (sourcing from PH), with industries and a
-- recruitment type, its profile last changed at p_updated (set last, after every child row).
create function pg_temp.partner(
  p_slug text, p_type text, p_serves text[], p_occupations text[], p_updated timestamptz default '2026-10-01 08:00+00',
  p_industries text[] default '{}', p_recruitment text default null, p_id uuid default gen_random_uuid()
) returns uuid
language plpgsql as $$
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (p_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (p_id, current_setting('t.padm')::uuid, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  select p_id, 'serves_market'::public.geography_scope, c from unnest(p_serves) c
  union all select p_id, 'sources_from'::public.geography_scope, 'PH';
  insert into public.organization_occupations (organization_id, occupation_id) select p_id, o from unnest(p_occupations) o;
  insert into public.organization_industries (organization_id, industry_code) select p_id, i from unnest(p_industries) i;
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days', recruitment_type = p_recruitment::public.recruitment_preference
  where id = p_id;
  perform pg_temp.touch(p_id, p_updated);
  return p_id;
end;
$$;

create function pg_temp.touch(p_org uuid, p_updated timestamptz) returns void
language sql as $$ update public.organizations set workforce_profile_updated_at = p_updated where id = p_org $$;

create function pg_temp.listing(p_org uuid, p_occupation text, p_available integer, p_from date, p_confirmed timestamptz)
returns void
language plpgsql as $$
declare
  v_updated timestamptz := (select workforce_profile_updated_at from public.organizations where id = p_org);
begin
  insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
    available_from, confirmed_at)
  values (p_org, p_occupation, 'PH', p_available, 10, p_from, p_confirmed);
  perform pg_temp.touch(p_org, v_updated);
end;
$$;

-- A requirement of p_org in p_status for p_country (DE unless given), industry C, international recruitment, starting
-- 1 March 2027, with the occupations of p_occupations ({"7212": 80, ...}), written as the database owner as the lifecycle
-- functions leave it.
create function pg_temp.req(p_org uuid, p_status text, p_need text, p_occupations jsonb, p_country text default 'DE')
returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_published boolean := p_status <> 'draft';
  v_total integer := (select sum(value::integer) from jsonb_each_text(p_occupations));
begin
  insert into public.workforce_requirements (
    organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
    recruitment_preference, partner_need, status, visibility, published_at, closes_on, close_reason
  ) values (
    p_org, 'Workers ' || p_status, v_total, p_country, 'Hamburg', 'C', date '2027-03-01', 'full_time', 'international',
    p_need::public.partner_need, p_status::public.requirement_status,
    case when v_published then 'private'::public.requirement_visibility end,
    case when v_published then now() - interval '10 days' end, case when v_published then date '2027-03-01' + 30 end,
    case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason
  ) returning id into v_id;
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select v_id, key, value::integer from jsonb_each_text(p_occupations);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, p_country);
  return v_id;
end;
$$;

-- suggest_partners as p_user (anonymous when null) for p_org (Acme unless given): 'ok' with the rows in order as a JSON
-- array in t.result, or 'sqlstate|message|detail'.
create function pg_temp.suggest(p_user uuid, p_req uuid, p_org uuid default null, p_aal text default 'aal1') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', coalesce((select jsonb_agg(to_jsonb(r) order by r.n)
       from (select s.*, row_number() over () as n from public.suggest_partners(%L, %L) s) r)::text, '[]'), true)$f$,
    coalesce(p_org, current_setting('t.a')::uuid), p_req), p_aal)
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

create function pg_temp.slugs() returns text
language sql as $$
  select coalesce(string_agg(e ->> 'slug', ',' order by n), '') from jsonb_array_elements(pg_temp.result()) with ordinality r (e, n)
$$;

create function pg_temp.sorted_slugs() returns text
language sql as $$ select coalesce(string_agg(e ->> 'slug', ',' order by e ->> 'slug'), '') from jsonb_array_elements(pg_temp.result()) e $$;

create function pg_temp.row_of(p_slug text) returns jsonb
language sql as $$ select e from jsonb_array_elements(pg_temp.result()) e where e ->> 'slug' = p_slug $$;

-- Everything a partner (or anybody else) could read about a call: notifications and their queue, audit rows, profile
-- views and the daily analytics.
create function pg_temp.visible_counts() returns text
language sql as $$
  select (select count(*) from public.notifications) || ',' || (select count(*) from pgmq.q_notifications) || ','
      || (select count(*) from audit.log) || ',' || (select count(*) from private.profile_view_events) || ','
      || (select count(*) from private.org_analytics_daily)
$$;

select set_config('t.padm', :'padm', false) as setup_padm \gset

-- The function, its grants and its columns (AC5) -------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.suggest_partners(uuid, uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.suggest_partners(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.suggest_partners(uuid, uuid)', 'execute'),
  'suggest_partners is executable by authenticated only');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.suggest_partners(uuid, uuid)'::regprocedure),
  'suggest_partners is security definer with an empty search_path');
select is(
  (select array_agg(n order by o) from pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) with ordinality a (n, m, o)
   where p.oid = 'public.suggest_partners(uuid, uuid)'::regprocedure and m = 't'),
  array['organization_id', 'slug', 'display_name', 'organization_type', 'also_offers_staffing', 'criteria_met',
        'criteria_not_met', 'served_destinations', 'matching_occupations', 'listing_occupation_id', 'listing_occupation',
        'available', 'available_from', 'confirmed_at', 'profile_updated_at', 'more_partners']::text[],
  'AC5: the columns are the partner, the criteria met and not met and the facts behind them');
select is(
  (select count(*)::integer from pg_proc p, unnest(p.proargnames) n
   where p.oid = 'public.suggest_partners(uuid, uuid)'::regprocedure
     and n ~* '(score|percent|rank|plan|verif|recommend|match_)'),
  0, 'AC5: no score, percentage, rank, plan or verification column');
select ok(
  (select prosrc !~* 'billing' and prosrc !~* 'has_feature' and prosrc !~* 'plan_code'
   from pg_proc where oid = 'public.suggest_partners(uuid, uuid)'::regprocedure),
  'AC3, NFR-C8: nothing in suggest_partners reads billing.* or a plan');
select is(
  (select value #>> '{}' from private.settings where key = 'partner_suggestions_max'), '50',
  'NFR-O5: the list size is the setting partner_suggestions_max, 50');
select ok(
  exists (select 1 from private.setting_rules where key = 'partner_suggestions_max' and editable and min = 10 and max = 100),
  'NFR-O5: an administrator changes the list size in the settings editor (10 to 100)');

-- AC1: selection -----------------------------------------------------------------------------------------------------------

select pg_temp.partner('v36-p1', 'recruitment_company', '{DE}', '{7212}') as p1 \gset
select pg_temp.partner('v36-p2', 'recruitment_company', '{DE}', '{7411}') as p2 \gset
select pg_temp.partner('v36-p3', 'recruitment_company', '{NL}', '{7212}') as p3 \gset
select pg_temp.partner('v36-p4', 'staffing_company', '{DE}', '{7214}', '2026-09-01 08:00+00') as p4 \gset
select pg_temp.partner('v36-p5', 'recruitment_company', '{DE}', '{7212}') as p5 \gset
update public.organizations set status = 'suspended' where id = :'p5';
select pg_temp.partner('v36-p6', 'recruitment_company', '{DE}', '{7212}') as p6 \gset
update public.organizations set review_status = 'pending_review', listed_at = null where id = :'p6';
select pg_temp.partner('v36-declined', 'recruitment_company', '{DE}', '{7212}') as pdecl \gset
update public.organizations set review_status = 'declined' where id = :'pdecl';
select pg_temp.partner('v36-hidden', 'recruitment_company', '{DE}', '{7212}') as phid \gset
update public.organizations set moderation_state = 'hidden' where id = :'phid';
-- P7: an employer serving DE with 7212 (employers cannot be listed; only its type keeps it out).
insert into public.organization_geographies (organization_id, scope, country_code) values (:'zeta', 'serves_market', 'DE');
insert into public.organization_occupations (organization_id, occupation_id) values (:'zeta', '7212');

select pg_temp.req(current_setting('t.a')::uuid, 'open', 'both', '{"7212": 80, "7214": 20}') as r1 \gset

select is(pg_temp.suggest(:'adm', :'r1'), 'ok', 'AC1: an admin of Acme gets suggestions');
select is(pg_temp.sorted_slugs(), 'v36-p1,v36-p4',
  'AC1: exactly P1 and P4; no partner without the occupations, outside the destination, suspended, pending, declined, hidden or an employer');
select is(pg_temp.slugs(), 'v36-p1,v36-p4', 'AC1: equal on criteria, the newer profile first');
select is(pg_temp.row_of('v36-p4') -> 'matching_occupations', '[{"code": "7214", "name": "Structural-metal preparers and erectors"}]'::jsonb,
  'AC5: the matching occupations are the requested ones the partner lists');
select is(pg_temp.row_of('v36-p1') -> 'served_destinations', '[{"code": "DE", "name": "Germany"}]'::jsonb,
  'AC5: the served destination is named');

-- AC2: partner types follow the partner need --------------------------------------------------------------------------------

select pg_temp.partner('v36-r8', 'recruitment_company', '{DE}', '{7212}', '2026-08-01 08:00+00') as r8 \gset
insert into public.organization_service_types (organization_id, service) values (:'r8', 'staffing');
select pg_temp.touch(:'r8', '2026-08-01 08:00+00');

select pg_temp.req(current_setting('t.a')::uuid, 'open', 'recruitment', '{"7212": 80, "7214": 20}') as rrec \gset
select pg_temp.req(current_setting('t.a')::uuid, 'open', 'staffing', '{"7212": 80, "7214": 20}') as rsta \gset
select pg_temp.req(current_setting('t.a')::uuid, 'open', 'none', '{"7212": 80, "7214": 20}') as rnone \gset

select pg_temp.suggest(:'adm', :'rrec') as ignored \gset
select is(pg_temp.slugs(), 'v36-p1,v36-r8', 'AC2: recruitment returns recruitment companies, P1 and R8');
select pg_temp.suggest(:'adm', :'rsta') as ignored \gset
select is(pg_temp.slugs(), 'v36-p4,v36-r8', 'AC2: staffing returns P4 and the recruitment company offering staffing, R8');
select is((pg_temp.row_of('v36-r8') ->> 'also_offers_staffing')::boolean, true, 'AC2: R8 is marked also_offers_staffing');
select is((pg_temp.row_of('v36-p4') ->> 'also_offers_staffing')::boolean, false, 'AC2: a staffing company is not marked');
select pg_temp.suggest(:'adm', :'r1') as ignored \gset
select is(pg_temp.slugs(), 'v36-p1,v36-p4,v36-r8', 'AC2: both returns P1, P4 and R8 once each');
select is(pg_temp.suggest(:'adm', :'rnone'), 'P0001|CHARA_INVALID_STATE|partners_not_needed',
  'AC2: partner need none is refused, partners_not_needed');

-- AC4, AC5: how each criterion is decided ----------------------------------------------------------------------------------

update public.organizations set moderation_state = 'hidden' where slug like 'v36-%';

select pg_temp.partner('v36-q1', 'recruitment_company', '{DE}', '{7212}', '2026-10-05 08:00+00', '{C}', 'both') as q1 \gset
select pg_temp.listing(:'q1', '7212', 120, date '2027-02-01', now() - interval '10 days');
select pg_temp.partner('v36-q2', 'recruitment_company', '{DE}', '{7212}', '2026-10-04 08:00+00', '{F}', 'local') as q2 \gset
select pg_temp.listing(:'q2', '7212', 80, date '2026-11-01', now() - interval '5 days');
select pg_temp.partner('v36-q3', 'recruitment_company', '{DE}', '{7212}', '2026-10-03 08:00+00', '{C}') as q3 \gset
select pg_temp.listing(:'q3', '7212', 150, date '2026-11-01', now() - interval '61 days');
select pg_temp.partner('v36-q4', 'recruitment_company', '{DE}', '{7212}', '2026-10-02 08:00+00') as q4 \gset
select pg_temp.listing(:'q4', '7212', 120, date '2027-04-01', now() - interval '3 days');

select pg_temp.req(current_setting('t.a')::uuid, 'open', 'recruitment', '{"7212": 100}') as r4 \gset
select is(pg_temp.suggest(:'mem', :'r4'), 'ok', 'AC6: a member of Acme gets the list');
select is(pg_temp.slugs(), 'v36-q1,v36-q3,v36-q4,v36-q2', 'AC3, AC4: 4 criteria, then the two with 1 by profile time, then 0');
select is(pg_temp.row_of('v36-q1') -> 'criteria_met', '["industry", "recruitment_type", "capacity", "available_before_start"]'::jsonb,
  'AC4: Q1 meets industry, recruitment_type, capacity and available_before_start');
select is(pg_temp.row_of('v36-q1') -> 'criteria_not_met', '[]'::jsonb, 'AC4: Q1 misses nothing');
select is(pg_temp.row_of('v36-q2') -> 'criteria_met', '[]'::jsonb,
  'AC4: Q2 meets none (industry F, local for international, 80 below 100)');
select is(pg_temp.row_of('v36-q2') -> 'criteria_not_met', '["industry", "recruitment_type", "capacity", "available_before_start"]'::jsonb,
  'AC4: Q2 names every criterion it misses');
select is(pg_temp.row_of('v36-q3') -> 'criteria_met', '["industry"]'::jsonb,
  'AC4: Q3 meets industry only; its stale listing counts for neither capacity nor timing');
select is(pg_temp.row_of('v36-q4') -> 'criteria_met', '["capacity"]'::jsonb, 'AC4: Q4 meets capacity, not available_before_start');
select is(pg_temp.row_of('v36-q4') -> 'criteria_not_met', '["industry", "recruitment_type", "available_before_start"]'::jsonb,
  'AC4: Q4 misses industry, recruitment_type and available_before_start');
select is(
  (select jsonb_build_object('occ', e ->> 'listing_occupation_id', 'label', e ->> 'listing_occupation', 'available', e -> 'available',
     'from', e ->> 'available_from', 'confirmed', (e ->> 'confirmed_at')::timestamptz > now() - interval '11 days')
   from jsonb_array_elements(pg_temp.result()) e where e ->> 'slug' = 'v36-q1'),
  '{"occ": "7212", "label": "Welders and flame cutters", "available": 120, "from": "2027-02-01", "confirmed": true}'::jsonb,
  'AC5: Q1 carries the facts of its listing: occupation, 120 available from 1 February 2027 and the confirmation');
select is(
  (select jsonb_build_object('occ', e -> 'listing_occupation_id', 'available', e -> 'available', 'confirmed', e -> 'confirmed_at')
   from jsonb_array_elements(pg_temp.result()) e where e ->> 'slug' = 'v36-q3'),
  '{"occ": null, "available": null, "confirmed": null}'::jsonb,
  'AC4, AC5: a stale listing is not shown');
select is((pg_temp.row_of('v36-q2') ->> 'available')::integer, 80, 'AC5: a fresh listing below the quantity is still shown with its number');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.result()) e where (e ->> 'more_partners')::boolean), 0,
  'AC11: with fewer partners than the list size, more_partners is false');
select is(pg_temp.row_of('v36-q1') ->> 'profile_updated_at', '2026-10-05T08:00:00+00:00', 'AC5: the profile time is returned');

-- Q2 confirms a listing that covers the quantity but only after the start: capacity, not timing.
update public.workforce_availability set available = 100, available_from = date '2027-03-02', confirmed_at = now() - interval '1 day'
where organization_id = :'q2';
select pg_temp.suggest(:'adm', :'r4') as ignored \gset
select is(pg_temp.row_of('v36-q2') -> 'criteria_met', '["capacity"]'::jsonb, 'AC4: exactly the quantity counts; a day after the start does not');
update public.workforce_availability set available_from = date '2027-03-01' where organization_id = :'q2';
select pg_temp.suggest(:'adm', :'r4') as ignored \gset
select is(pg_temp.row_of('v36-q2') -> 'criteria_met', '["capacity", "available_before_start"]'::jsonb,
  'AC4: available on the start date counts as before the start');
-- The stale-days setting decides freshness (NFR-O5): at 70 days Q3's listing counts.
update private.settings set value = '70' where key = 'workforce_listing_stale_days';
select pg_temp.suggest(:'adm', :'r4') as ignored \gset
select is(pg_temp.row_of('v36-q3') -> 'criteria_met', '["industry", "capacity", "available_before_start"]'::jsonb,
  'NFR-O5: freshness follows workforce_listing_stale_days');
update private.settings set value = '60' where key = 'workforce_listing_stale_days';

-- AC3: order by criteria met, then profile time, never by plan ----------------------------------------------------------------

update public.organizations set moderation_state = 'hidden' where slug like 'v36-%';
select pg_temp.partner('v36-s4', 'recruitment_company', '{DE}', '{7213}', '2026-07-01 08:00+00', '{C}', 'international') as s4 \gset
select pg_temp.listing(:'s4', '7213', 50, date '2027-01-01', now() - interval '2 days');
select pg_temp.partner('v36-s2new', 'recruitment_company', '{DE}', '{7213}', '2026-10-10 08:00+00', '{C}', 'both') as s2new \gset
select pg_temp.partner('v36-s2old', 'recruitment_company', '{DE}', '{7213}', '2026-10-09 08:00+00', '{C}', 'international') as s2old \gset
select pg_temp.partner('v36-s0', 'recruitment_company', '{DE}', '{7213}', '2026-10-20 08:00+00', '{F}', 'local') as s0 \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (:'s2new', 'recruitment_partner', 'active', 'null'), (:'s2old', 'recruitment_enterprise', 'active', 'null'),
       (:'s0', 'recruitment_enterprise', 'active', 'null');
select pg_temp.req(current_setting('t.a')::uuid, 'open', 'recruitment', '{"7213": 40}') as r3 \gset

select pg_temp.suggest(:'adm', :'r3') as ignored \gset
select is(pg_temp.slugs(), 'v36-s4,v36-s2new,v36-s2old,v36-s0', 'AC3: 4 criteria, the newer 2, the older 2, then 0');
update billing.subscriptions set plan_code = case plan_code when 'recruitment_partner' then 'recruitment_enterprise' else 'recruitment_partner' end
where organization_id in (:'s2new', :'s2old');
select pg_temp.suggest(:'adm', :'r3') as ignored \gset
select is(pg_temp.slugs(), 'v36-s4,v36-s2new,v36-s2old,v36-s0', 'AC3: the same order after the plans are swapped');
update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.suggest(:'adm', :'r3') as ignored \gset
select is(pg_temp.slugs(), 'v36-s4,v36-s2new,v36-s2old,v36-s0', 'AC3: the same order with entitlements enforced');
update private.settings set value = 'false' where key = 'entitlements_enforced';
-- An equal profile time falls back to the id.
select pg_temp.touch(:'s2old', '2026-10-10 08:00+00');
select pg_temp.suggest(:'adm', :'r3') as ignored \gset
select is(pg_temp.slugs(),
  'v36-s4,' || (select string_agg(s, ',' order by id) from (values ('v36-s2new', :'s2new'::uuid), ('v36-s2old', :'s2old'::uuid)) v (s, id)) || ',v36-s0',
  'AC3: equal criteria and profile time are ordered by id');
-- A partner whose profile never changed is ordered by its listing time.
update public.organizations set workforce_profile_updated_at = null, listed_at = '2026-10-15 08:00+00' where id = :'s2old';
select pg_temp.suggest(:'adm', :'r3') as ignored \gset
select is(pg_temp.slugs(), 'v36-s4,v36-s2old,v36-s2new,v36-s0', 'AC3: before any change the listing time stands in for the profile time');
select is(pg_temp.row_of('v36-s2old') -> 'profile_updated_at', 'null'::jsonb, 'AC3: profile_updated_at stays null before any change');

-- AC11: list size and stable ties -----------------------------------------------------------------------------------------

update public.organizations set moderation_state = 'hidden' where slug like 'v36-%';
create temp table ties as
select pg_temp.partner('v36-tie-' || lpad(n::text, 2, '0'), 'recruitment_company', '{AT}', '{7115}', '2026-10-01 08:00+00') as id
from generate_series(1, 70) n;
select pg_temp.req(current_setting('t.a')::uuid, 'open', 'recruitment', '{"7115": 10}', 'AT') as r11 \gset

select pg_temp.suggest(:'adm', :'r11') as ignored \gset
select is(jsonb_array_length(pg_temp.result()), 50, 'AC11: at most 50 partners');
select is(
  (select string_agg(e ->> 'organization_id', ',' order by n) from jsonb_array_elements(pg_temp.result()) with ordinality r (e, n)),
  (select string_agg(id::text, ',' order by id) from (select id from ties order by id limit 50) t),
  'AC11: equal partners come by id, the first 50');
select pg_temp.slugs() as first_run \gset
select pg_temp.suggest(:'adm', :'r11') as ignored \gset
select is(pg_temp.slugs(), :'first_run', 'AC11: a second run returns the same 50 in the same order');
select is((select bool_and((e ->> 'more_partners')::boolean) from jsonb_array_elements(pg_temp.result()) e), true,
  'AC11: the result states that more partners exist');
update private.settings set value = '20' where key = 'partner_suggestions_max';
select pg_temp.suggest(:'adm', :'r11') as ignored \gset
select is(jsonb_array_length(pg_temp.result()), 20, 'NFR-O5: the list size follows partner_suggestions_max');
update private.settings set value = '50' where key = 'partner_suggestions_max';

-- AC6: who may see suggestions, and the states ---------------------------------------------------------------------------------

select is(pg_temp.suggest(:'own1', :'r11', null, 'aal2'), 'ok', 'AC6: the owner of Acme at aal2 gets the list');
select is(pg_temp.suggest(:'adm', :'r11', null, 'aal2'), 'ok', 'AC6: an admin of Acme at aal2 gets the list');
select is(pg_temp.suggest(:'adm2', :'r11', current_setting('t.b')::uuid), 'P0002|CHARA_NOT_FOUND|',
  'AC6: an admin of Beta naming Beta is refused, CHARA_NOT_FOUND');
select is(pg_temp.suggest(:'adm2', :'r11'), '42501|CHARA_FORBIDDEN|', 'AC6: an admin of Beta naming Acme is refused, CHARA_FORBIDDEN');
select is(pg_temp.suggest(:'dadm', :'r11'), '42501|CHARA_FORBIDDEN|', 'AC6: an admin of the recruitment company Delta is refused');
select is(pg_temp.suggest(:'dadm', :'r11', :'delta'), '42501|CHARA_FORBIDDEN|employer_only',
  'AC6: Delta naming itself is refused, employer_only');
select is(pg_temp.suggest(:'wkr', :'r11'), '42501|CHARA_FORBIDDEN|', 'AC6: a candidate is refused');
select is(pg_temp.suggest(:'padm', :'r11'), '42501|CHARA_FORBIDDEN|', 'the owner of the suggested partners is refused');
select is(pg_temp.suggest(null, :'r11'), '42501|permission denied for function suggest_partners|', 'AC6: an anonymous caller is refused (42501)');
select is(pg_temp.suggest(:'zown', :'r11', :'zeta'), '42501|CHARA_FORBIDDEN|organization_suspended', 'a suspended employer is refused');
select is(pg_temp.suggest(:'p1', :'r11'), '42501|CHARA_FORBIDDEN|', 'an id that is no user is refused');

select pg_temp.req(current_setting('t.a')::uuid, 'draft', 'recruitment', '{"7115": 10}', 'AT') as rdraft \gset
select pg_temp.req(current_setting('t.a')::uuid, 'paused', 'recruitment', '{"7115": 10}', 'AT') as rpaused \gset
select pg_temp.req(current_setting('t.a')::uuid, 'closed', 'recruitment', '{"7115": 10}', 'AT') as rclosed \gset
select pg_temp.req(current_setting('t.a')::uuid, 'filled', 'recruitment', '{"7115": 10}', 'AT') as rfilled \gset
select is(pg_temp.suggest(:'adm', :'rdraft'), 'ok', 'AC6: a draft returns the list as a preview');
select is(jsonb_array_length(pg_temp.result()), 50, 'AC6: the preview lists the partners');
select is(pg_temp.suggest(:'adm', :'rpaused'), 'ok', 'a paused requirement returns the list');
select is(pg_temp.suggest(:'adm', :'rclosed'), 'P0001|CHARA_INVALID_STATE|closed', 'AC6: a closed requirement is refused');
select is(pg_temp.suggest(:'adm', :'rfilled'), 'P0001|CHARA_INVALID_STATE|filled', 'a filled requirement is refused');

update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.suggest(:'adm', :'r11'), '42501|CHARA_FORBIDDEN|release_off', 'release 2b off: refused');
update private.settings set value = 'true' where key = 'release_job_orders';
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.suggest(:'adm', :'r11'), '42501|CHARA_FORBIDDEN|release_off', 'release 2a off: refused');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- The KPI record and what a partner can learn (NFR-S8, NFR-S11) ----------------------------------------------------------

select is(
  (select jsonb_build_object('count', suggested_count, 'max', max_suggested_count) from stats.requirement_suggestions
   where requirement_id = :'r11'),
  '{"count": 50, "max": 50}'::jsonb,
  'KPI: the suggestions shown for an open requirement are recorded (the last 50, at most 50)');
select is((select count(*)::integer from stats.requirement_suggestions where requirement_id in (:'rdraft', :'rpaused')), 0,
  'KPI: a draft preview and a paused requirement are not recorded');
update public.organizations set moderation_state = 'hidden' where id in (select id from ties order by id limit 68);
select pg_temp.suggest(:'adm', :'r11') as ignored \gset
select is(
  (select jsonb_build_object('count', suggested_count, 'max', max_suggested_count, 'later', last_shown_at >= first_shown_at)
   from stats.requirement_suggestions where requirement_id = :'r11'),
  '{"count": 2, "max": 50, "later": true}'::jsonb,
  'KPI: a later run records its count and keeps the largest');
select ok(
  not has_table_privilege('anon', 'stats.requirement_suggestions', 'select')
  and not has_table_privilege('authenticated', 'stats.requirement_suggestions', 'select')
  and not has_table_privilege('service_role', 'stats.requirement_suggestions', 'select')
  and not has_table_privilege('authenticated', 'stats.requirement_suggestions', 'insert'),
  'NFR-S8: no API role reads or writes the KPI record');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'stats.requirement_suggestions'::regclass),
  'NFR-S8: the KPI record has row level security, forced');
select is(pg_temp.call_as(:'own1', 'authenticated', 'select * from stats.requirement_suggestions'), '42501|permission denied for schema stats|',
  'NFR-S8: the employer itself cannot read the record');
select is(pg_temp.call_as(:'dadm', 'authenticated', 'select * from stats.requirement_suggestions'), '42501|permission denied for schema stats|',
  'NFR-S8: a partner cannot read the record');

select pg_temp.visible_counts() as before_counts \gset
select pg_temp.suggest(:'adm', :'r4') as ignored \gset
select pg_temp.suggest(:'mem', :'r11') as ignored \gset
select is(pg_temp.visible_counts(), :'before_counts',
  'NFR-S11: a suggestion writes no notification, queued email, audit row, profile view or analytics row a partner could see');

delete from public.workforce_requirements where id = :'r11';
select is((select count(*)::integer from stats.requirement_suggestions where requirement_id = :'r11'), 0,
  'the record goes with the requirement');

select * from finish();
rollback;
