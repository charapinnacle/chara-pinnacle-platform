begin;
select plan(12);

\ir organizations_fixture.inc

-- Ranking transparency of the job order board (V79, NFR-C8; extends 154 of V77): no plan changes the order of the job
-- orders. Identical job orders of employers on no plan, Starter, Professional and Enterprise, published at the same
-- moment, named or not, come back in the order the ranking page describes (publication time newest first, then the
-- fixed random id) for partners on no plan, Basic, Professional and Enterprise, before and after the plans of both sides
-- are turned around and after a name is revealed; a job order hidden by moderation or of a suspended employer is listed
-- for nobody, whatever its employer's plan. The job orders are in Luxembourg, which no other test uses.

update private.settings set value = 'true' where key = 'release_job_orders';

\set owner '00000000-0000-0000-0000-0000000c7900'
select pg_temp.new_user(:'owner');
update public.profiles set account_kind = intended_account_kind where id = :'owner';

create function pg_temp.subscribe(p_org uuid, p_plan text) returns void
language sql as $$
  delete from billing.subscriptions where organization_id = p_org;
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  select p_org, p_plan, 'active', 'null' where p_plan is not null;
$$;

-- The partners: identical listed recruitment companies serving Luxembourg with 7212, on the plan given.
create function pg_temp.partner(p_id uuid, p_slug text, p_plan text) returns uuid
language plpgsql as $$
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, review_status, listed_at,
    submitted_at)
  values (p_id, 'recruitment_company', p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH', 'listed',
    now() - interval '30 days', now() - interval '31 days');
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (p_id, '00000000-0000-0000-0000-0000000c7900', 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code) values (p_id, 'serves_market', 'LU');
  insert into public.organization_occupations (organization_id, occupation_id) values (p_id, '7212');
  perform pg_temp.subscribe(p_id, p_plan);
  return p_id;
end;
$$;

select pg_temp.partner('00000000-0000-0000-0000-0000000c7911', 'rank-jo-free', null);
select pg_temp.partner('00000000-0000-0000-0000-0000000c7912', 'rank-jo-basic', 'recruitment_partner');
select pg_temp.partner('00000000-0000-0000-0000-0000000c7913', 'rank-jo-professional', 'recruitment_professional');
select pg_temp.partner('00000000-0000-0000-0000-0000000c7914', 'rank-jo-enterprise', 'recruitment_enterprise');

-- The employers, on no plan, Starter, Professional and Enterprise.
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country) values
  ('00000000-0000-0000-0000-0000000c7921', 'employer', 'rank-jo-employer-none', 'Rank None GmbH', 'Rank None', 'LU'),
  ('00000000-0000-0000-0000-0000000c7922', 'employer', 'rank-jo-employer-starter', 'Rank Starter GmbH', 'Rank Starter', 'LU'),
  ('00000000-0000-0000-0000-0000000c7923', 'employer', 'rank-jo-employer-professional', 'Rank Professional GmbH', 'Rank Professional', 'LU'),
  ('00000000-0000-0000-0000-0000000c7924', 'employer', 'rank-jo-employer-enterprise', 'Rank Enterprise GmbH', 'Rank Enterprise', 'LU');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
select id, :'owner', 'owner', now() from public.organizations where slug like 'rank-jo-employer-%';
select pg_temp.subscribe('00000000-0000-0000-0000-0000000c7922', 'employer_starter');
select pg_temp.subscribe('00000000-0000-0000-0000-0000000c7923', 'employer_professional');
select pg_temp.subscribe('00000000-0000-0000-0000-0000000c7924', 'employer_enterprise');

-- Two identical job orders per employer: an anonymous one published at 09:00 and a named one at 08:00, with ids that
-- put the Enterprise employer's last and the employer on no plan's first within each moment, so neither the plan nor the
-- name can explain the order; and a hidden one and one of a suspended employer, newest of all.
create temp table rank_orders (id uuid primary key, employer uuid, published_at timestamptz, show_identity boolean,
  moderation text default 'visible');
insert into rank_orders (id, employer, published_at, show_identity) values
  ('00000000-0000-0000-0000-00000c790a04', '00000000-0000-0000-0000-0000000c7921', '2026-11-10 09:00+00', false),
  ('00000000-0000-0000-0000-00000c790a03', '00000000-0000-0000-0000-0000000c7922', '2026-11-10 09:00+00', false),
  ('00000000-0000-0000-0000-00000c790a02', '00000000-0000-0000-0000-0000000c7923', '2026-11-10 09:00+00', false),
  ('00000000-0000-0000-0000-00000c790a01', '00000000-0000-0000-0000-0000000c7924', '2026-11-10 09:00+00', false),
  ('00000000-0000-0000-0000-00000c790b01', '00000000-0000-0000-0000-0000000c7921', '2026-11-10 08:00+00', true),
  ('00000000-0000-0000-0000-00000c790b03', '00000000-0000-0000-0000-0000000c7922', '2026-11-10 08:00+00', true),
  ('00000000-0000-0000-0000-00000c790b02', '00000000-0000-0000-0000-0000000c7923', '2026-11-10 08:00+00', true),
  ('00000000-0000-0000-0000-00000c790b04', '00000000-0000-0000-0000-0000000c7924', '2026-11-10 08:00+00', false);
insert into rank_orders (id, employer, published_at, show_identity, moderation) values
  ('00000000-0000-0000-0000-00000c790c01', '00000000-0000-0000-0000-0000000c7924', '2026-11-10 10:00+00', false, 'hidden');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, status) values
  ('00000000-0000-0000-0000-0000000c7925', 'employer', 'rank-jo-employer-suspended', 'Rank Suspended GmbH', 'Rank Suspended', 'LU',
    'suspended');
select pg_temp.subscribe('00000000-0000-0000-0000-0000000c7925', 'employer_enterprise');
insert into rank_orders (id, employer, published_at, show_identity) values
  ('00000000-0000-0000-0000-00000c790c02', '00000000-0000-0000-0000-0000000c7925', '2026-11-10 10:00+00', true);

insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
  start_date, employment_type, recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on,
  moderation_state)
select id, employer, 'Ranked welders', 30, 'LU', 'Esch-sur-Alzette', 'C', date '2027-03-01', 'full_time', 'international',
  'recruitment', 'open', 'job_order_marketplace', show_identity, published_at, date '2027-02-01',
  moderation::public.job_moderation_state
from rank_orders;
insert into public.requirement_occupations (requirement_id, occupation_id, quantity) select id, '7212', 30 from rank_orders;
insert into public.requirement_countries (requirement_id, country_code) select id, 'LU' from rank_orders;

-- The ids of the Luxembourg job orders a partner's board lists, in its order.
create function pg_temp.board(p_org uuid) returns text
language plpgsql as $$
declare
  v_ids text;
begin
  delete from private.rate_limit_hits;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000c7900', 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select string_agg(right(j.id::text, 4), ',' order by n) into v_ids
  from public.list_job_orders(p_org, p_destination => 'LU', p_limit => 50) with ordinality j (id, eligible, reasons, title,
    country_code, workers_needed, countries, city_region, industry_code, occupations, start_date, employment_type,
    recruitment_preference, published_on, response_count, responses_fewer_than, employer_name, employer_company_slug,
    next_cursor, n);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_ids;
end;
$$;

\set expected '''0a01,0a02,0a03,0a04,0b01,0b02,0b03,0b04'''

select is(pg_temp.board('00000000-0000-0000-0000-0000000c7912'), :expected,
  'NFR-C8: a Basic partner reads the job orders newest first, then by id, whatever the employers'' plans and names');
select is(pg_temp.board('00000000-0000-0000-0000-0000000c7913'), :expected, 'NFR-C8: a Professional partner reads the same order');
select is(pg_temp.board('00000000-0000-0000-0000-0000000c7914'), :expected, 'NFR-C8: an Enterprise partner reads the same order');
select is(pg_temp.board('00000000-0000-0000-0000-0000000c7911'), :expected,
  'NFR-C8: a partner on no plan reads the same order (titles only)');

-- The employers' plans turned around.
select pg_temp.subscribe('00000000-0000-0000-0000-0000000c7921', 'employer_enterprise');
select pg_temp.subscribe('00000000-0000-0000-0000-0000000c7922', 'employer_professional');
select pg_temp.subscribe('00000000-0000-0000-0000-0000000c7923', 'employer_starter');
select pg_temp.subscribe('00000000-0000-0000-0000-0000000c7924', null);
select is(pg_temp.board('00000000-0000-0000-0000-0000000c7912'), :expected,
  'NFR-C8: turning the employers'' plans around does not move a job order');
select is(pg_temp.board('00000000-0000-0000-0000-0000000c7911'), :expected,
  'NFR-C8: nor for a partner on no plan');

-- The partners' plans turned around.
select pg_temp.subscribe('00000000-0000-0000-0000-0000000c7911', 'recruitment_enterprise');
select pg_temp.subscribe('00000000-0000-0000-0000-0000000c7914', null);
select is(pg_temp.board('00000000-0000-0000-0000-0000000c7911'), :expected,
  'NFR-C8: a partner moved from no plan to Enterprise reads the same order');
select is(pg_temp.board('00000000-0000-0000-0000-0000000c7914'), :expected,
  'NFR-C8: a partner moved from Enterprise to no plan reads the same order');

-- A name revealed to one partner (an invitation) changes what it reads, never the order.
insert into private.requirement_reveals (requirement_id, organization_id, cause)
values ('00000000-0000-0000-0000-00000c790a04', '00000000-0000-0000-0000-0000000c7912', 'invitation');
select is(pg_temp.board('00000000-0000-0000-0000-0000000c7912'), :expected,
  'NFR-C8: a revealed employer name does not move its job order');

select is(
  (select count(*)::integer from private.requirement_reveals
   where requirement_id = '00000000-0000-0000-0000-00000c790a04' and seen_at is not null),
  1,
  'the board still marks the revealed name as seen'
);

select ok(
  (select bool_and(position(x in pg_temp.board(p)) = 0)
   from unnest('{0c01,0c02}'::text[]) x,
     unnest('{00000000-0000-0000-0000-0000000c7911,00000000-0000-0000-0000-0000000c7912,00000000-0000-0000-0000-0000000c7913,00000000-0000-0000-0000-0000000c7914}'::uuid[]) p),
  'NFR-C8: a job order hidden by moderation or of a suspended employer is listed for no partner, though its employer is on Enterprise'
);

select ok(
  (select prosrc ~ 'r\.moderation_state = ''visible''' and prosrc ~ 'order by r\.published_at desc, r\.id\s+limit v_limit \+ 1'
     and prosrc !~* 'order by[^;]*(billing|plan_code|has_feature|subscription)'
   from pg_proc where oid = 'public.list_job_orders(uuid, text, text, text, text, integer, integer, date, date, public.recruitment_preference, uuid, integer)'::regprocedure),
  'NFR-C8: the selection and the order checked above are those of list_job_orders as defined, and no order by reads a plan'
);

select * from finish();
rollback;
