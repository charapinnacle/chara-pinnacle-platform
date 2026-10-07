begin;
select plan(2);

\ir status_fixture.inc

-- The two KPI queries of docs/runbooks/application-status.md run on the tables this unit stores. Events are written as
-- the database owner with fixed offsets from the transaction time: one application waited two hours in Applied and then
-- six in Viewed, one waited four hours in Applied and is Shortlisted since, one is still Applied after 20 days.
create temp table t_k as select pg_temp.seed_app('applied') as slow, pg_temp.seed_app('applied') as quick, pg_temp.seed_app('applied') as waiting;
update public.job_applications set created_at = now() - interval '20 days' where id = (select waiting from t_k);
insert into public.application_events (application_id, from_status, to_status, actor_id, created_at) values
  ((select slow from t_k), 'applied', 'viewed', null, now() + interval '2 hours'),
  ((select slow from t_k), 'viewed', 'interview', :'mem', now() + interval '8 hours'),
  ((select quick from t_k), 'applied', 'shortlisted', :'mem', now() + interval '4 hours');

select results_eq(
  $$select stage::text, moves, avg_hours from (
      select e.to_status as stage, count(*) as moves, round(avg(extract(epoch from (e.next_at - e.created_at)) / 3600)::numeric, 1) as avg_hours
      from (select x.to_status, x.created_at,
                   lead(x.created_at) over (partition by x.application_id order by x.created_at, x.id) as next_at
            from public.application_events x
            where x.application_id in (select slow from t_k union select quick from t_k)) e
      where e.next_at is not null
      group by e.to_status) t
    order by stage$$,
  $$values ('applied', 2::bigint, 3.0::numeric), ('viewed', 1::bigint, 6.0::numeric)$$,
  'time in each stage: Applied 2 h and 4 h, Viewed 6 h; the stage an application is in now has no end yet'
);
select is(
  (select count(*) from public.job_applications a
   where a.status = 'applied' and a.created_at < now() - interval '14 days' and a.id in (select slow from t_k union select quick from t_k union select waiting from t_k)),
  1::bigint, 'applications left in Applied for more than 14 days'
);

select * from finish();
rollback;
