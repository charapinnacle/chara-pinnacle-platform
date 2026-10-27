begin;
select plan(8);

-- Partner suggestions at 5,000 partner organisations (V36, FR-M3; NFR-P3 applied to the suggestions as to Find Partners):
-- the seeded network of 155_find_partners_load.test.sql, a requirement for DE with two common occupations and partner
-- need both, one warm-up and five timed runs. As in 155, the median must stay under 100 ms and no run may take 500 ms
-- (the database share of the 500 ms target), and the answer must hold listed, visible partners only.

\ir find_partners_load_fixture.inc

update private.settings set value = 'true' where key in ('release_partner_directories', 'release_job_orders');

select pg_temp.seed_find_partners(5000, 1000);
select pg_temp.load_employer() as employer \gset
select id as org from public.organizations where slug = 'load-employer' \gset

insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
  start_date, employment_type, recruitment_preference, partner_need, status, visibility, published_at, closes_on)
values ('00000000-0000-0000-0000-0000000f3699', :'org', 'Load welders', 120, 'DE', 'Berlin', 'C', current_date + 60,
  'full_time', 'international', 'both', 'open', 'private', now(), current_date + 90);
insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
values ('00000000-0000-0000-0000-0000000f3699', '7212', 100), ('00000000-0000-0000-0000-0000000f3699', '5322', 20);
insert into public.requirement_countries (requirement_id, country_code) values ('00000000-0000-0000-0000-0000000f3699', 'DE');

create temp table suggestion_runs (n integer, ms numeric, row_count integer);
grant all on suggestion_runs to authenticated;

create function pg_temp.time_suggestions(p_user uuid, p_org uuid, p_runs integer) returns void
language plpgsql as $$
declare
  v_start timestamptz;
  v_rows integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  for i in 0 .. p_runs loop
    v_start := clock_timestamp();
    select count(*) into v_rows from public.suggest_partners(p_org, '00000000-0000-0000-0000-0000000f3699');
    if i > 0 then
      insert into suggestion_runs values (i, extract(epoch from clock_timestamp() - v_start) * 1000, v_rows);
    end if;
  end loop;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select pg_temp.time_suggestions(:'employer', :'org', 5);

select diag(format('suggest_partners at 5,000 partners: median %s ms, max %s ms',
  (select round(percentile_cont(0.5) within group (order by ms)::numeric, 1) from suggestion_runs),
  (select round(max(ms), 1) from suggestion_runs)));
select ok(
  (select percentile_cont(0.5) within group (order by ms) < 100 and max(ms) < 500 from suggestion_runs),
  'NFR-P3: suggest_partners answers within 100 ms at the median and never takes 500 ms at 5,000 partners'
);
select is((select min(row_count) from suggestion_runs), 50, 'NFR-P3: every timed run fills the list of 50 (no run is timed on an empty answer)');

create temp table load_suggestions (organization_id uuid, more_partners boolean);
grant all on load_suggestions to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'employer', 'role', 'authenticated', 'aal', 'aal1')::text, true)
  as claims \gset
set local role authenticated;
insert into load_suggestions select s.organization_id, s.more_partners from public.suggest_partners(:'org', '00000000-0000-0000-0000-0000000f3699') s;
reset role;
select set_config('request.jwt.claims', '', true) as claims \gset
select is(
  (select count(*)::integer from load_suggestions s join public.organizations o on o.id = s.organization_id
   where o.listed_at is null or o.moderation_state <> 'visible' or o.review_status = 'declined' or o.status <> 'active'),
  0,
  'NFR-P3: no unlisted, declined, suspended or hidden partner is suggested at 5,000 partners'
);
select ok(
  (select bool_and(more_partners) and count(*) = 50 from load_suggestions),
  'NFR-P3: the broad requirement fills the list and says that more partners exist'
);

-- The plan shape, independent of the speed of the machine: in the selection of suggest_partners (planned for the values
-- of the requirement's destinations and occupations) the partners that serve and list them are read through the indexes
-- of organization_geographies and organization_occupations, never by scanning those tables. Which listed partners
-- remain is the planner's choice: for a destination most partners serve, reading organizations in full is cheaper.
analyze public.organizations, public.organization_geographies, public.organization_occupations, public.workforce_availability;
create function pg_temp.plan_of(p_sql text) returns text
language plpgsql as $$
declare
  v_line text;
  v_plan text := '';
begin
  for v_line in execute 'explain ' || p_sql loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  return v_plan;
end;
$$;
select pg_temp.plan_of($$select o.id from public.organizations o
    where o.type in ('recruitment_company', 'staffing_company')
      and o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active' and o.moderation_state = 'visible'
      and exists (select 1 from public.organization_geographies g
        where g.organization_id = o.id and g.scope = 'serves_market' and g.country_code = any ('{DE}'::text[]))
      and exists (select 1 from public.organization_occupations oo
        where oo.organization_id = o.id and oo.occupation_id = any ('{7212,5322}'::text[]))$$) as selection_plan \gset
select ok(
  :'selection_plan' !~ 'Seq Scan on organization_(geographies|occupations)'
  and :'selection_plan' ~ 'Index[A-Za-z ]* Scan[^\n]* on organization_geographies'
  and :'selection_plan' ~ 'Index[A-Za-z ]* Scan[^\n]* on organization_occupations',
  'NFR-P3: the destination and occupation lookups of suggest_partners read their tables through indexes at 5,000 partners'
);

-- The plan above is that of the function's own predicates: the function still contains them as written.
select ok(
  position($p$and exists ( select 1 from public.organization_geographies g where g.organization_id = o.id and g.scope = 'serves_market' and g.country_code = any (v_destinations) ) and exists ( select 1 from public.organization_occupations oo where oo.organization_id = o.id and oo.occupation_id = any (v_occupations) )$p$
    in regexp_replace(pg_get_functiondef('public.suggest_partners(uuid, uuid)'::regprocedure), '\s+', ' ', 'g')) > 0,
  'NFR-P3: the plan checked above uses the destination and occupation predicates of suggest_partners as defined'
);
select ok(
  position($p$from public.workforce_availability a where a.organization_id = t.id and a.occupation_id = q.occupation_id and a.confirmed_at > v_fresh_since$p$
    in regexp_replace(pg_get_functiondef('public.suggest_partners(uuid, uuid)'::regprocedure), '\s+', ' ', 'g')) > 0,
  'NFR-P3: the availability lookup below is the one suggest_partners makes per partner and occupation'
);
select pg_temp.plan_of(format($$select sum(a.available), max(a.available_from), max(a.confirmed_at) from public.workforce_availability a
    where a.organization_id = %L and a.occupation_id = '7212' and a.confirmed_at > now() - interval '60 days'$$,
    (select organization_id from public.workforce_availability limit 1))) as availability_plan \gset
select ok(
  :'availability_plan' !~ 'Seq Scan on workforce_availability' and :'availability_plan' ~ 'Index[A-Za-z ]* Scan[^\n]* on workforce_availability',
  'NFR-P3: the availability of a partner and an occupation is read through an index of workforce_availability at 5,000 partners'
);

select * from finish();
rollback;
