begin;
select plan(29);

\ir status_fixture.inc

select pg_temp.doc(:'d1', :'wa');
select pg_temp.doc(:'d2', :'wa', 'skipped', 'certificate');
update private.settings set value = '0' where key = 'document_access_repeat_seconds';

create function pg_temp.withdraw_as(p_user uuid, p_app uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.withdraw_application(%L)', p_app), 'aal1')
$$;

-- The id of the share that the newest access-log row of the document names, or null.
create function pg_temp.logged_share(p_doc uuid) returns uuid
language sql as $$ select share_id from audit.document_access_log where document_id = p_doc order by id desc limit 1 $$;

create function pg_temp.share_of(p_app uuid) returns uuid
language sql as $$ select id from public.passport_shares where application_id = p_app $$;

-- FR-D4 AC10: applying again after a withdrawal does not bring the old share back.
select pg_temp.open_job('Re-apply vacancy') as job \gset
select pg_temp.apply_as(:'wa', :'job', null, array[:'d1', :'d2']::uuid[]) as first_apply \gset
select current_setting('t.app') as app1 \gset
select is(pg_temp.grant_as(:'mem', :'d2'), 'ok', 'AC10: before the withdrawal the member opens the certificate');
select is(pg_temp.withdraw_as(:'wa', :'app1'), 'ok', 'AC10: the candidate withdraws');
select revoked_at as old_revoked from public.passport_shares where application_id = :'app1' \gset
select pg_temp.apply_as(:'wa', :'job', null, array[:'d1']::uuid[]) as second_apply \gset
select current_setting('t.app') as app2 \gset
select is(current_setting('t.outcome'), 'created', 'AC10: applying again creates a new application');
select isnt(:'app2'::uuid, :'app1'::uuid, 'AC10: with a new id');
select is(
  (select count(*) from public.passport_shares s join public.consents c on c.id = s.consent_id
   where s.application_id in (:'app1', :'app2') and c.action = 'granted'),
  2::bigint, 'AC10: and a new share with a new granted consent next to the old one'
);
select is((select revoked_at from public.passport_shares where application_id = :'app1'), :'old_revoked'::timestamptz, 'AC10: the old share keeps its revoked_at');
select is(pg_temp.grant_as(:'mem', :'d2'), '42501|CHARA_FORBIDDEN|', 'AC10: the certificate, which only the old share listed, is refused');
select is(pg_temp.grant_as(:'mem', :'d1'), 'ok', 'AC10: the CV is opened');
select is(pg_temp.logged_share(:'d1'), pg_temp.share_of(:'app2'), 'AC10: through the new share only');

-- FR-D4 AC11: withdrawing one application leaves another one to the same organisation intact.
select pg_temp.open_job('Second vacancy') as job_a \gset
select pg_temp.open_job('Third vacancy') as job_b \gset
select pg_temp.apply_as(:'wa', :'job_a', null, array[:'d1']::uuid[]) as apply_a \gset
select current_setting('t.app') as a1 \gset
select pg_temp.apply_as(:'wa', :'job_b', null, array[:'d1']::uuid[]) as apply_b \gset
select current_setting('t.app') as a2 \gset
select pg_temp.withdraw_as(:'wa', :'app2') as done \gset
select is(pg_temp.withdraw_as(:'wa', :'a1'), 'ok', 'AC11: the candidate withdraws the first of two applications to one organisation');
select is(pg_temp.grant_as(:'mem', :'d1'), 'ok', 'AC11: the member still opens the CV');
select is(pg_temp.logged_share(:'d1'), pg_temp.share_of(:'a2'), 'AC11: through the share of the other application');
select is((select revoked_at is null from public.passport_shares where application_id = :'a2'), true, 'AC11: whose share is not revoked');
select is(pg_temp.status_of(:'a2'), 'applied', 'AC11: and whose application is still applied');
select is(
  (select count(*) from public.consents where user_id = :'wa' and action = 'withdrawn' and purpose = 'share_passport:' || current_setting('t.a') || ':' || :'a2'),
  0::bigint, 'AC11: the other application has no withdrawn consent row'
);
select is(
  (select count(*) from public.consents where user_id = :'wa' and action = 'withdrawn' and purpose = 'share_passport:' || current_setting('t.a') || ':' || :'a1'),
  1::bigint, 'AC11: the withdrawn application has its own'
);

-- The candidate can still withdraw the consent of one application through the ledger, and that cancels that share only.
select is(
  pg_temp.call_as(:'wa', 'authenticated', format('select public.withdraw_consent(%L)', 'share_passport:' || current_setting('t.a') || ':' || :'a2'), 'aal1'),
  'ok', 'the candidate withdraws the consent of the second application through withdraw_consent'
);
select is(pg_temp.grant_as(:'mem', :'d1'), '42501|CHARA_FORBIDDEN|', 'and the ledger cancels its share without a revoked_at');

-- The purpose of a consent may name the application, and nothing else.
select is(
  pg_temp.call_as(null, 'postgres', format($$insert into public.consents (user_id, purpose, version, action) values (%L, 'share_passport:%s:%s', 0, 'granted')$$, :'wb', current_setting('t.a'), gen_random_uuid())),
  'ok', 'a purpose with the organisation and an application id is accepted'
);
select is(
  split_part(pg_temp.call_as(null, 'postgres', format($$insert into public.consents (user_id, purpose, version, action) values (%L, 'share_passport:%s:not-an-application', 0, 'granted')$$, :'wb', current_setting('t.a'))), '|', 1),
  '23503', 'an application part that is not an id is refused'
);
select is(
  split_part(pg_temp.call_as(null, 'postgres', format($$insert into public.consents (user_id, purpose, version, action) values (%L, 'share_passport:%s:%s:%s', 0, 'granted')$$, :'wb', current_setting('t.a'), gen_random_uuid(), gen_random_uuid())), '|', 1),
  '23503', 'a third part is refused'
);

-- The organisation alone is not a purpose any more.
select is(
  split_part(pg_temp.call_as(null, 'postgres', format($$insert into public.consents (user_id, purpose, version, action) values (%L, 'share_passport:%s', 0, 'granted')$$, :'wb', current_setting('t.a'))), '|', 1),
  '23503', 'a purpose that names the organisation and no application is refused'
);

-- A share that was already revoked (a deleted document) is still withdrawn from the ledger.
select pg_temp.open_job('Revoked vacancy') as job_r \gset
select pg_temp.apply_as(:'wa', :'job_r', null, array[:'d2']::uuid[]) as apply_r \gset
select current_setting('t.app') as ar \gset
select pg_temp.call_as(:'wa', 'authenticated', format('select public.delete_worker_document(%L)', :'d2'), 'aal1') as deleted \gset
select revoked_at as first_revoked from public.passport_shares where application_id = :'ar' \gset
select is(:'first_revoked' <> '', true, 'a deleted document revokes the share of an active application');
select is(pg_temp.withdraw_as(:'wa', :'ar'), 'ok', 'and the candidate can still withdraw that application');
select is((select revoked_at from public.passport_shares where application_id = :'ar'), :'first_revoked'::timestamptz, 'whose revoked_at is not moved');
select is(
  (select count(*) from public.consents c join public.passport_shares s on s.consent_id = c.id where s.application_id = :'ar'), 1::bigint,
  'and the withdrawn row is appended next to the granted one'
);

-- FR-D4 KPI and risk: the queries of docs/runbooks/application-withdrawal.md section 3.
create temp table t_cohort as
  select pg_temp.seed_app('applied') as a, pg_temp.seed_app('withdrawn') as b, pg_temp.seed_app('hired') as c, pg_temp.seed_app('withdrawn') as d;
update public.job_applications set created_at = '2026-03-10T10:00:00Z'
  where id in (select a from t_cohort union select b from t_cohort union select c from t_cohort union select d from t_cohort);
select results_eq(
  $$select date_trunc('month', a.created_at)::date as month, count(*) as applications,
           count(*) filter (where a.status = 'withdrawn') as withdrawn,
           round(100.0 * count(*) filter (where a.status = 'withdrawn') / count(*), 1) as rate
    from public.job_applications a where a.created_at < '2026-04-01' group by 1 order by 1$$,
  $$values ('2026-03-01'::date, 4::bigint, 2::bigint, 50.0::numeric)$$,
  'KPI withdrawal rate: the runbook query limited to one month gives the share of the month''s applications that were withdrawn'
);
select is(
  (select count(*) from public.job_applications a join public.passport_shares s on s.application_id = a.id
   where a.status = 'withdrawn' and s.revoked_at is null),
  0::bigint, 'risk lingering access: no withdrawn application has a share that is not revoked'
);
select is(
  (select count(*) from public.job_applications a join public.passport_shares s on s.application_id = a.id
   where a.status = 'withdrawn' and a.id not in (select b from t_cohort union select d from t_cohort)
     and not exists (select 1 from public.consents w join public.consents g on g.id = s.consent_id
                     where w.user_id = g.user_id and w.purpose = g.purpose and w.action = 'withdrawn' and w.id > g.id)),
  0::bigint, 'risk lingering access: every application withdrawn through the function has a withdrawn consent after its granted one'
);

select * from finish();
rollback;
