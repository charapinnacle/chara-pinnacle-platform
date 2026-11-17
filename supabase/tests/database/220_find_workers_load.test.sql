begin;
select plan(28);

-- Find Workers at 100,000 visible profiles (V80, NFR-P3), the light version of scripts/load/find-workers.mjs that runs
-- in CI: the same seeded passports (100,000 listed cards among 110,000) and the same typical calls of the Find Workers
-- page, one warm-up and five timed runs each instead of fifty, without the captured plans. It holds every run under the
-- 500 ms of NFR-P3 and the median under 300 ms, a margin over the slowest call (two common skills, 100 to 200 ms) that a
-- slower runner still keeps while V69's full scan (0.5 to 1.5 s) fails it; the database budget of 200 ms at the 95th
-- percentile is the script's. It checks that the narrower first step of 20270217100000_find_workers_load.sql answers
-- exactly what V69's definition answers at this size, and the plan shape, which does not depend on the speed of the
-- machine (docs/perf/release-2c.md). 200 tests the search itself on its small set of cards (V69).

\ir find_workers_load_fixture.inc

update private.settings set value = 'true' where key = 'release_find_workers';

select pg_temp.seed_find_workers(100000, 10000);

select is(
  (select count(*)::integer from private.worker_cards c join auth.users u on u.id = c.user_id
   where c.listed and u.email like 'load-worker-%@load.test'),
  100000,
  'NFR-P3: the load seeds 100,000 visible worker cards'
);
select is(
  (select count(*)::integer from private.worker_cards c join auth.users u on u.id = c.user_id
   where not c.listed and u.email like 'load-worker-%@load.test'),
  10000,
  'NFR-P3: and 10,000 passports that are not listed (not opted in, suspended, closing)'
);

select pg_temp.prepare_find_workers_cases();
select pg_temp.run_find_workers_load(5);

select ok(
  (select r.p50_ms < 300 and r.max_ms < 500 from load_results r where r.label = c.label),
  format('NFR-P3: %s never takes 500 ms and answers within 300 ms at the median', c.label)
)
from load_cases c order by c.position;

select is(
  (select array_agg(c.label || '=' || r.rows_returned order by c.position) from load_results r join load_cases c using (label)
   where c.label in ('basic: first page', 'basic: keyword "welder"', 'basic: available by, page of 50',
     'basic: deep page (cursor at 2,000)', 'advanced: two skills', 'advanced: five filters, page of 50',
     'page: requests of 20 cards', 'page: saved workers')),
  array['basic: first page=20', 'basic: keyword "welder"=20', 'basic: available by, page of 50=50',
    'basic: deep page (cursor at 2,000)=20', 'advanced: two skills=20', 'advanced: five filters, page of 50=50',
    'page: requests of 20 cards=20', 'page: saved workers=100'],
  'NFR-P3: the pages are full, so no run is timed on an empty answer'
);

-- At this size the search answers what V69's definition answers: the listed cards, scored by the keyword in the
-- occupation, the headline and the skills (strpos, any case) and by the chosen skills, in the order of the ranking page.
delete from private.rate_limit_hits;
create temp table found_page (search text, n integer, card_id uuid, matched_on text[], row_text text);
grant all on found_page to authenticated;
select pg_temp.workers_act_as('00000000-0000-0000-0000-0000000b8001');
insert into found_page select 'first', row_number() over (), s.card_id, s.matched_on, to_jsonb(s)::text
from public.search_workers('00000000-0000-0000-0000-0000000b8011', '{}', p_limit => 50) s;
insert into found_page select 'welder', row_number() over (), s.card_id, s.matched_on, to_jsonb(s)::text
from public.search_workers('00000000-0000-0000-0000-0000000b8011', '{"q": "welder"}', p_limit => 50) s;
insert into found_page select 'skills', row_number() over (), s.card_id, s.matched_on, to_jsonb(s)::text
from public.search_workers('00000000-0000-0000-0000-0000000b8011', '{"skills": ["TIG welding", "Pipe welding"]}', p_limit => 50) s;
reset role;
select set_config('request.jwt.claims', '', true) as claims \gset

create function pg_temp.v69_order(p_q text, p_skills text[]) returns text
language sql as $$
  select string_agg(card_id::text, ',' order by n) from (
    select x.card_id, row_number() over (order by x.score desc, x.updated_at desc, x.card_id) as n
    from (
      select c.card_id, c.updated_at,
        coalesce(c.occupation_id = any (array(
          select o.code from public.occupations o
          where strpos(lower(o.label), p_q) > 0 or exists (select 1 from unnest(o.synonyms) y where strpos(lower(y), p_q) > 0))), false)::integer
        + (p_q is not null and strpos(lower(coalesce(c.headline, '')), p_q) > 0)::integer
        + (p_q is not null and exists (
            select 1 from public.worker_skills s where s.worker_user_id = c.user_id and strpos(lower(s.skill), p_q) > 0))::integer
        + coalesce((select count(*)::integer from public.worker_skills s
                    where s.worker_user_id = c.user_id and lower(s.skill) = any (p_skills)), 0) as score,
        p_q is null or c.occupation_id = any (array(
          select o.code from public.occupations o
          where strpos(lower(o.label), p_q) > 0 or exists (select 1 from unnest(o.synonyms) y where strpos(lower(y), p_q) > 0)))
          or strpos(lower(coalesce(c.headline, '')), p_q) > 0
          or exists (select 1 from public.worker_skills s where s.worker_user_id = c.user_id and strpos(lower(s.skill), p_q) > 0)
          as q_match,
        p_skills is null or exists (
          select 1 from public.worker_skills s where s.worker_user_id = c.user_id and lower(s.skill) = any (p_skills)) as skill_match
      from private.worker_cards c
      where c.listed
    ) x
    where x.q_match and x.skill_match
  ) y where n <= 50
$$;

select is((select string_agg(card_id::text, ',' order by n) from found_page where search = 'first'), pg_temp.v69_order(null, null),
  'NFR-P3: without a filter the first 50 cards are the 50 last changed, as V69 orders them');
select is((select string_agg(card_id::text, ',' order by n) from found_page where search = 'welder'), pg_temp.v69_order('welder', null),
  'NFR-P3: a keyword answers the cards and the order V69''s match score gives at 100,000 cards');
select is((select string_agg(card_id::text, ',' order by n) from found_page where search = 'skills'),
  pg_temp.v69_order(null, array['tig welding', 'pipe welding']),
  'NFR-P3: two skills answer the cards and the order V69''s match score gives at 100,000 cards');
select ok(
  (select bool_and('headline' = any (matched_on) or 'occupation' = any (matched_on) or 'skills' = any (matched_on))
   from found_page where search = 'welder')
  and (select bool_and(matched_on = array['skills']) from found_page where search = 'skills'),
  'NFR-P3: matched_on still names what each card matched'
);
select is(
  (select count(*)::integer from found_page p join public.worker_profiles w on w.card_id = p.card_id
   join public.profiles pr on pr.id = w.user_id
   where not w.searchable or pr.status <> 'active' or pr.deleted_at is not null),
  0,
  'NFR-S9 at volume: no card that is not listed (not opted in, suspended, closing) is found'
);
select is(
  (select count(*)::integer from found_page p
   where p.row_text ~ '(Loadfirst|Loadlast|@load\.test)'
      or exists (select 1 from public.worker_profiles w where w.card_id = p.card_id and strpos(p.row_text, w.user_id::text) > 0)),
  0,
  'NFR-S9 at volume: no card holds the name, the address or the user id of its worker'
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
  pg_temp.plan_of($$select c.card_id from private.worker_cards c where c.listed order by c.updated_at desc, c.card_id limit 21$$)
    ~ '"Index Name": "worker_profiles_search_updated_idx"',
  'NFR-P3: a search without a keyword or skills reads the cards in their order through worker_profiles_search_updated_idx'
);
select ok(
  pg_temp.plan_of($$select w.user_id from public.worker_profiles w where w.searchable and lower(w.headline) like '%welder%'$$)
    ~ '"Index Name": "worker_profiles_search_headline_trgm_idx"'
  and pg_temp.plan_of($$select s.worker_user_id from public.worker_skills s where lower(s.skill) like '%dementia%'$$)
    ~ '"Index Name": "worker_skills_lower_skill_trgm_idx"',
  'NFR-P3: the keyword finds its headlines and skills through the trigram indexes, never by reading every card'
);
select ok(
  pg_temp.plan_of($$select s.worker_user_id from public.worker_skills s where lower(s.skill) = any (array['tig welding', 'pipe welding'])$$)
    ~ '"Index Name": "worker_skills_lower_skill_idx"',
  'NFR-P3: the chosen skills are found through worker_skills_lower_skill_idx'
);

select * from finish();
rollback;
