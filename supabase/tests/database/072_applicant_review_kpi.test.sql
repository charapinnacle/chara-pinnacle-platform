begin;
select plan(1);

\ir status_fixture.inc

-- The SOP KPI "applicants reviewed within 7 days (%)": the query of docs/runbooks/applicant-detail.md, on written events.
-- Reviewed in 2 days (Viewed), reviewed after 10 days, never reviewed, withdrawn before any review (left out), too recent to
-- judge (left out), shortlisted straight from Applied in 1 day.
create temp table t_k as select
  pg_temp.seed_app('viewed') as fast, pg_temp.seed_app('viewed') as late, pg_temp.seed_app('applied') as never,
  pg_temp.seed_app('withdrawn') as gone, pg_temp.seed_app('applied') as recent, pg_temp.seed_app('shortlisted') as direct;
update public.job_applications set created_at = now() - interval '20 days'
where id in (select fast from t_k union select late from t_k union select never from t_k union select gone from t_k union select direct from t_k);
update public.job_applications set created_at = now() - interval '3 days' where id = (select recent from t_k);
insert into public.application_events (application_id, from_status, to_status, actor_id, created_at) values
  ((select fast from t_k), 'applied', 'viewed', null, now() - interval '18 days'),
  ((select late from t_k), 'applied', 'viewed', null, now() - interval '10 days'),
  ((select gone from t_k), 'applied', 'withdrawn', :'wa', now() - interval '19 days'),
  ((select direct from t_k), 'applied', 'shortlisted', :'mem', now() - interval '19 days');

select results_eq(
  $$select count(*) as applications,
           count(*) filter (where r.reviewed_at <= a.created_at + interval '7 days') as reviewed_within_7_days,
           round(100.0 * count(*) filter (where r.reviewed_at <= a.created_at + interval '7 days') / nullif(count(*), 0), 1) as percent
    from public.job_applications a
    left join lateral (
      select min(e.created_at) as reviewed_at from public.application_events e
      where e.application_id = a.id and e.from_status = 'applied' and e.to_status <> 'withdrawn'
    ) r on true
    where a.created_at >= date_trunc('month', now()) - interval '1 month'
      and a.created_at < now() - interval '7 days'
      and (r.reviewed_at is not null or a.status <> 'withdrawn')$$,
  $$values (4::bigint, 2::bigint, 50.0::numeric)$$,
  'KPI: of 4 applications whose 7 days are over, 2 were reviewed in time (50 %); a withdrawal is no review'
);
select * from finish();
rollback;
