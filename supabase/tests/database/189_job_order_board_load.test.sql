begin;
select plan(23);

-- The job order board at 2,000 open requirements (V79, NFR-P3), the light version of scripts/load/job-order-board.mjs
-- that runs in CI: the same seeded marketplace (2,000 open job orders among 8,000 requirements of 400 employers, 5,000
-- listed partners with their responses and reveals) and the same typical calls of the board and the job order page, one
-- warm-up and five timed runs each instead of fifty, without the captured plans. As 155 does for Find Partners, it holds
-- the median under 100 ms and every run under 500 ms (the strict 95th percentile is the script's) and checks the plan
-- shape, which does not depend on the speed of the machine (docs/perf/release-2b.md). 164 measures the list on its own
-- small network (V39); this file is the release 2b load test of the board with the network of NFR-P3.

\ir job_order_board_load_fixture.inc

update private.settings set value = 'true' where key = 'release_job_orders';

select pg_temp.seed_job_order_board(2000, 6000, 5000);

select is(
  (select count(*)::integer from public.workforce_requirements r join public.organizations e on e.id = r.organization_id
   where r.status = 'open' and r.visibility = 'job_order_marketplace' and r.moderation_state = 'visible'
     and e.slug like 'board-employer-%'),
  2000,
  'NFR-P3: the load seeds 2,000 open marketplace job orders'
);
select ok(
  (select count(*) from public.organizations where slug like 'board-partner-%' and listed_at is not null) = 5000
  and (select count(*) from public.partner_responses p join public.organizations o on o.id = p.organization_id
       where o.slug like 'board-partner-%') > 20000
  and (select count(*) from private.requirement_reveals v join public.organizations o on o.id = v.organization_id
       where o.slug like 'board-partner-%') > 5000,
  'NFR-P3: 5,000 listed partners with more than 20,000 responses and 5,000 reveals'
);

select pg_temp.prepare_job_order_board_cases();
select pg_temp.run_job_order_board_load(5);

select ok(
  (select r.p50_ms < 100 and r.max_ms < 500 from load_results r where r.label = c.label),
  format('NFR-P3: %s answers within 100 ms at the median and never takes 500 ms', c.label)
)
from load_cases c order by c.position;

select is(
  (select array_agg(c.label || '=' || r.rows_returned order by c.position) from load_results r join load_cases c using (label)
   where c.label in ('eligible: first page', 'eligible: page of 50', 'eligible: deep page (cursor at 1,900)', 'free: first page',
     'free: hidden-field filter', 'job order: anonymous', 'job order: revealed', 'job order: no longer open')),
  array['eligible: first page=20', 'eligible: page of 50=50', 'eligible: deep page (cursor at 1,900)=50', 'free: first page=20',
    'free: hidden-field filter=0', 'job order: anonymous=1', 'job order: revealed=1', 'job order: no longer open=1'],
  'NFR-P3: the pages are full (no run is timed on an empty answer); the free partner''s hidden-field filter answers none'
);
select ok(
  (select bool_and(rows_returned > 0) from load_results where label like 'eligible: %'),
  'NFR-P3: every filter of the eligible partner finds job orders in the seeded marketplace'
);

-- At this size the board still lists open, visible job orders of active employers only, newest first, and names an
-- employer only where the job order shows it or reveals it to this partner.
delete from private.rate_limit_hits;
create temp table board_page (id uuid, eligible boolean, employer_name text);
grant all on board_page to authenticated;
select pg_temp.board_act_as('00000000-0000-0000-0000-0000000b7901');
insert into board_page select j.id, j.eligible, j.employer_name
from public.list_job_orders('00000000-0000-0000-0000-0000000b7911', p_limit => 50) j;
reset role;
select set_config('request.jwt.claims', '', true) as claims \gset
select is(
  (select count(*)::integer from board_page p join public.workforce_requirements r on r.id = p.id
   join public.organizations e on e.id = r.organization_id
   where r.status <> 'open' or r.visibility <> 'job_order_marketplace' or r.moderation_state <> 'visible' or e.status <> 'active'),
  0,
  'NFR-P3: no closed, private, hidden or suspended employer''s requirement reaches the board at 2,000 job orders'
);
select is(
  (select string_agg(p.id::text, ',') from board_page p),
  (select string_agg(id::text, ',') from (
     select r.id from public.workforce_requirements r join public.organizations e on e.id = r.organization_id
     where r.status = 'open' and r.visibility = 'job_order_marketplace' and r.moderation_state = 'visible' and e.status = 'active'
     order by r.published_at desc, r.id limit 50) x),
  'NFR-P3: the first page of 50 is the 50 newest job orders'
);
select is(
  (select count(*)::integer from board_page p join public.workforce_requirements r on r.id = p.id
   where p.employer_name is not null
     and not ((p.eligible and r.show_identity) or exists (
       select 1 from private.requirement_reveals v
       where v.requirement_id = r.id and v.organization_id = '00000000-0000-0000-0000-0000000b7911'))),
  0,
  'NFR-S11 at volume: no employer is named on the board unless it shows its name or revealed it to this partner'
);

-- The plan shape, independent of the speed of the machine.
create function pg_temp.plan_of(p_sql text) returns text
language plpgsql as $$
declare
  v_plan json;
begin
  execute 'explain (format json) ' || p_sql into v_plan;
  return v_plan::text;
end;
$$;

select ok(
  pg_temp.plan_of($$select r.id from public.workforce_requirements r join public.organizations e on e.id = r.organization_id
    where r.status = 'open' and r.visibility = 'job_order_marketplace' and e.status = 'active' and r.moderation_state = 'visible'
    order by r.published_at desc, r.id limit 51$$) ~ '"Index Name": "workforce_requirements_job_orders_idx"'
  and pg_temp.plan_of($$select r.id from public.workforce_requirements r join public.organizations e on e.id = r.organization_id
    where r.status = 'open' and r.visibility = 'job_order_marketplace' and e.status = 'active' and r.moderation_state = 'visible'
    order by r.published_at desc, r.id limit 51$$) !~ '"Node Type": "Seq Scan", [^}]*"Relation Name": "workforce_requirements"',
  'NFR-P3: the board reads the open marketplace job orders in their order through workforce_requirements_job_orders_idx'
);
select ok(
  pg_temp.plan_of($$select count(*) from public.partner_responses p
    where p.requirement_id = '00000000-0000-0000-0000-000000000000' and p.status <> 'withdrawn'$$)
    ~ '"Index Name": "partner_responses_partner_key"'
  and pg_temp.plan_of($$select 1 from private.requirement_reveals v
    where v.requirement_id = '00000000-0000-0000-0000-000000000000'
      and v.organization_id = '00000000-0000-0000-0000-0000000b7911'$$) ~ '"Index Name": "requirement_reveals_pkey"',
  'NFR-P3: the response count and the reveal of a row are read through the keys of their tables, never by a scan'
);
select ok(
  pg_temp.plan_of($$select 1 from public.requirement_countries rc
    where rc.requirement_id = '00000000-0000-0000-0000-000000000000' and rc.country_code = 'DE'$$)
    ~ '"Index Name": "requirement_countries_pkey"'
  and pg_temp.plan_of($$select 1 from public.requirement_occupations ro
    where ro.requirement_id = '00000000-0000-0000-0000-000000000000' and ro.occupation_id = '7212'$$)
    ~ '"Index Name": "requirement_occupations_pkey"',
  'NFR-P3: the destination and occupation filters of a row are read through the keys of their tables'
);

select * from finish();
rollback;
