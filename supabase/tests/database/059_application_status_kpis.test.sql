begin;
select plan(5);

\ir status_fixture.inc

-- The queries of section 3 of docs/runbooks/application-status.md, as written there, run on the tables this unit stores.
-- Events are written as the database owner with fixed offsets from the transaction time: one application waited two hours
-- in Applied and then six in Viewed, one waited four hours in Applied and is Shortlisted since, one is still Applied
-- after 20 days.
create temp table t_k as select pg_temp.seed_app('applied') as slow, pg_temp.seed_app('applied') as quick, pg_temp.seed_app('applied') as waiting;
update public.job_applications set created_at = now() - interval '20 days' where id = (select waiting from t_k);
insert into public.application_events (application_id, from_status, to_status, actor_id, created_at) values
  ((select slow from t_k), 'applied', 'viewed', null, now() + interval '2 hours'),
  ((select slow from t_k), 'viewed', 'interview', :'mem', now() + interval '8 hours'),
  ((select quick from t_k), 'applied', 'shortlisted', :'mem', now() + interval '4 hours');

select results_eq(
  $$select stage::text, moves, avg_hours from (
      select stage, count(*) as moves, round(avg(extract(epoch from (next_at - created_at)) / 3600)::numeric, 1) as avg_hours
      from (
        select x.to_status as stage, x.created_at,
               lead(x.created_at) over (partition by x.application_id order by x.created_at, x.id) as next_at
        from public.application_events x
        where x.created_at >= date_trunc('month', now()) - interval '1 month'
      ) e
      where next_at is not null
      group by stage order by stage
    ) t order by stage$$,
  $$values ('applied', 2::bigint, 3.0::numeric), ('viewed', 1::bigint, 6.0::numeric)$$,
  'time in each stage: Applied 2 h and 4 h, Viewed 6 h; the stage an application is in now has no end yet'
);
select is(
  (select count(*) from public.job_applications where status = 'applied' and created_at < now() - interval '14 days'),
  1::bigint, 'applications left in Applied for more than 14 days'
);
select results_eq(
  $$select o.display_name::text, count(*) as waiting
    from public.job_applications a join public.organizations o on o.id = a.organization_id
    where a.status = 'applied' and a.created_at < now() - interval '14 days'
    group by o.display_name order by waiting desc limit 20$$,
  $$select o.display_name::text, 1::bigint from public.organizations o where o.id = current_setting('t.a')::uuid$$,
  'and by organisation'
);

-- The silent-changes risk: moves through the functions leave no application without an event naming its status; a status
-- set without an event is counted.
create temp table t_s as select pg_temp.seed_app('applied') as moved, pg_temp.seed_app('applied') as opened, pg_temp.seed_app('applied') as forced;
select pg_temp.set_as(:'mem', (select moved from t_s), 'interview') as r1 \gset
select pg_temp.viewed_as(:'mem', (select opened from t_s)) as r2 \gset
select is(
  (select count(*) from public.job_applications a
   where a.status <> 'applied'
     and not exists (select 1 from public.application_events e where e.application_id = a.id and e.to_status = a.status)),
  0::bigint, 'silent changes: none after a move and a first open through the functions'
);
select pg_temp.force_status((select forced from t_s), 'offer');
select is(
  (select count(*) from public.job_applications a
   where a.status <> 'applied'
     and not exists (select 1 from public.application_events e where e.application_id = a.id and e.to_status = a.status)),
  1::bigint, 'silent changes: a status set with no event is counted'
);

select * from finish();
rollback;
