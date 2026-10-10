begin;
select plan(37);

\ir status_fixture.inc

-- The value of a query that must succeed, as p_user at p_aal; a refusal is 'sqlstate|message|detail' (call_as answers 'ok').
create function pg_temp.value_as(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  set local role authenticated;
  begin
    execute p_sql into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- An organisation whose only member is its owner, with no vacancy, invitation or subscription.
create function pg_temp.lone_org() returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(v_owner);
  update public.profiles set account_kind = intended_account_kind where id = v_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'employer', 'lone-' || left(v_id::text, 8), 'Lone ' || left(v_id::text, 8), 'Lone ' || left(v_id::text, 8), 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, v_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.owner_of(p_org uuid) returns uuid
language sql as $$ select user_id from public.organization_members where organization_id = p_org and role = 'owner' $$;

create function pg_temp.steps(p_user uuid, p_org uuid) returns jsonb
language sql as $$
  select pg_temp.json_as(p_user, format('select * from public.get_dashboard_first_steps(%L)', p_org))
$$;

-- my_application_stage_counts: the candidate's own applications, every stage present.
create function pg_temp.my_stages(p_user uuid) returns jsonb
language sql as $$ select pg_temp.json_as(p_user, 'select status, total from public.my_application_stage_counts()') $$;

select is(
  pg_temp.my_stages(:'wb'),
  '[{"status": "applied", "total": 0}, {"status": "viewed", "total": 0}, {"status": "shortlisted", "total": 0}, {"status": "interview", "total": 0},
    {"status": "offer", "total": 0}, {"status": "hired", "total": 0}, {"status": "rejected", "total": 0}, {"status": "withdrawn", "total": 0}]'::jsonb,
  'a candidate without applications gets the eight stages, each 0, in the order of the pipeline'
);

select pg_temp.seed_app('applied', null, :'wb') is not null as s1 \gset
select pg_temp.seed_app('applied', null, :'wb') is not null as s2 \gset
select pg_temp.seed_app('interview', null, :'wb') is not null as s3 \gset
select pg_temp.seed_app('withdrawn', null, :'wb') is not null as s4 \gset
select pg_temp.seed_app('hired', null, :'wa') is not null as s5 \gset

select is(
  (select jsonb_object_agg(e ->> 'status', (e ->> 'total')::int) from jsonb_array_elements(pg_temp.my_stages(:'wb')) e),
  '{"applied": 2, "viewed": 0, "shortlisted": 0, "interview": 1, "offer": 0, "hired": 0, "rejected": 0, "withdrawn": 1}'::jsonb,
  'the counts are the candidate''s own applications by stage, withdrawn included'
);
select is(
  (select sum((e ->> 'total')::int) from jsonb_array_elements(pg_temp.my_stages(:'wa')) e), 1::bigint,
  'another candidate''s applications are never counted'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', 'select * from public.my_application_stage_counts()', 'aal2'),
  'P0001|CHARA_FORBIDDEN|', 'an employer is refused'
);
select is(
  pg_temp.call_as(:'st_admin', 'authenticated', 'select * from public.my_application_stage_counts()', 'aal2'),
  'P0001|CHARA_FORBIDDEN|', 'a platform administrator is refused'
);
select is(
  pg_temp.call_as(null, 'anon', 'select * from public.my_application_stage_counts()'),
  '42501|permission denied for function my_application_stage_counts|', 'the anonymous role is refused at the privilege check'
);

-- get_dashboard_first_steps: each step follows the database.
select pg_temp.lone_org() as lone \gset
select pg_temp.owner_of(:'lone') as lone_owner \gset

select is(
  pg_temp.steps(:'lone_owner', :'lone'),
  '[{"plan_chosen": false, "team_invited": false, "vacancy_published": false}]'::jsonb,
  'a new organisation has done none of the three steps'
);
select pg_temp.seed_job('{"title": "Draft only"}', :'lone') is not null as draft \gset
select is(
  pg_temp.steps(:'lone_owner', :'lone') -> 0 -> 'vacancy_published', 'false'::jsonb,
  'a draft vacancy is not a published one'
);
select pg_temp.seed_job('{"title": "Deleted open", "status": "open", "deleted_at": "2026-01-01T00:00:00Z"}', :'lone') is not null as gone_job \gset
select is(
  pg_temp.steps(:'lone_owner', :'lone') -> 0 -> 'vacancy_published', 'false'::jsonb,
  'a deleted vacancy does not count'
);
select pg_temp.seed_job('{"title": "Closed after publishing", "status": "closed"}', :'lone') is not null as closed_job \gset
select is(
  pg_temp.steps(:'lone_owner', :'lone') -> 0 -> 'vacancy_published', 'true'::jsonb,
  'a vacancy that has left draft (here closed again) counts as the first vacancy published'
);

insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by, created_at, expires_at)
values (:'lone', 'lapsed@example.test', 'member', repeat('b', 64), :'lone_owner', now() - interval '10 days', now() - interval '3 days');
select is(
  pg_temp.steps(:'lone_owner', :'lone') -> 0 -> 'team_invited', 'false'::jsonb,
  'an invitation that expired unaccepted is not the team step done'
);
insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by, expires_at)
values (:'lone', 'invitee@example.test', 'member', repeat('a', 64), :'lone_owner', now() + interval '7 days');
select is(
  pg_temp.steps(:'lone_owner', :'lone') -> 0 -> 'team_invited', 'true'::jsonb,
  'a sent invitation is the team step done'
);

select pg_temp.lone_org() as lone2 \gset
select pg_temp.owner_of(:'lone2') as lone2_owner \gset
select pg_temp.new_user('00000000-0000-0000-0000-0000000e0001');
update public.profiles set account_kind = intended_account_kind where id = '00000000-0000-0000-0000-0000000e0001';
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (:'lone2', '00000000-0000-0000-0000-0000000e0001', 'member', now());
select is(
  pg_temp.steps(:'lone2_owner', :'lone2') -> 0 -> 'team_invited', 'true'::jsonb,
  'a second member, without an invitation row, is the team step done as well'
);

insert into billing.subscriptions (organization_id, plan_code, status, provider) values (:'lone', 'employer_starter', 'canceled', 'null');
select is(
  pg_temp.steps(:'lone_owner', :'lone') -> 0 -> 'plan_chosen', 'false'::jsonb,
  'a canceled subscription is no plan chosen'
);
insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at)
values (:'lone', 'employer_starter', 'trialing', 'null', now() + interval '10 days');
select is(
  pg_temp.steps(:'lone_owner', :'lone') -> 0 -> 'plan_chosen', 'true'::jsonb,
  'a trial is a plan chosen'
);

select is(
  pg_temp.steps('00000000-0000-0000-0000-0000000e0001', :'lone2'), '[]'::jsonb,
  'a plain member gets no row (only owners and admins see the checklist)'
);
select is(pg_temp.steps(:'lone2_owner', :'lone'), '[]'::jsonb, 'the owner of another organisation gets no row');
select is(pg_temp.steps(:'pending', current_setting('t.a')::uuid), '[]'::jsonb, 'a person whose invitation is not accepted gets no row');
select is(
  pg_temp.value_as(:'lone_owner', format('select count(*) from public.get_dashboard_first_steps(%L)', :'lone'), 'aal1'), '1',
  'an owner at aal1 reads the steps (they lead to two-step verification)'
);
select is(
  pg_temp.call_as(:'wb', 'authenticated', format('select * from public.get_dashboard_first_steps(%L)', :'lone'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|company_account_required', 'a candidate is refused'
);
select is(
  pg_temp.call_as(null, 'anon', format('select * from public.get_dashboard_first_steps(%L)', :'lone')),
  '42501|permission denied for function get_dashboard_first_steps|', 'the anonymous role is refused at the privilege check'
);
update public.profiles set status = 'suspended' where id = :'lone_owner';
select is(pg_temp.steps(:'lone_owner', :'lone'), '[]'::jsonb, 'a suspended user is a member of nothing and gets no row');
update public.profiles set status = 'active' where id = :'lone_owner';

-- admin_staff_count: the people with an active platform role, for an administrator at aal2 only.
create function pg_temp.staff_count() returns int
language sql as $$ select pg_temp.value_as(current_setting('t.st_admin')::uuid, 'select public.admin_staff_count()')::int $$;
select set_config('t.st_admin', :'st_admin', false) is not null as cfg \gset
select pg_temp.staff_count() as staff0 \gset

insert into public.platform_staff (user_id, role) values (:'st_admin', 'trust_safety');
select is(pg_temp.staff_count(), :staff0, 'a person with a second active role is counted once');
update public.platform_staff set revoked_at = now() where user_id = :'st_admin' and role = 'trust_safety';
select is(pg_temp.staff_count(), :staff0, 'revoking that second role leaves the person counted');
select is(pg_temp.value_as(:'st_review', 'select public.admin_staff_count()'), 'P0001|CHARA_FORBIDDEN|', 'a Verification Reviewer is refused');
select is(
  pg_temp.value_as(:'st_review', 'select (c.*)::text from public.admin_moderation_counts() c'), 'P0001|CHARA_FORBIDDEN|',
  'a Verification Reviewer is refused the moderation counts too'
);
update public.platform_staff set revoked_at = now() where user_id = :'st_review';
select is(pg_temp.staff_count(), :staff0 - 1, 'a person whose only role is revoked is no longer counted');
select is(pg_temp.value_as(:'st_admin', 'select public.admin_staff_count()', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'an administrator at aal1 is refused');
select is(pg_temp.value_as(:'st_trust', 'select public.admin_staff_count()'), 'P0001|CHARA_FORBIDDEN|', 'a Trust & Safety Administrator is refused');
select is(
  pg_temp.call_as(null, 'anon', 'select public.admin_staff_count()'),
  '42501|permission denied for function admin_staff_count|', 'the anonymous role is refused at the privilege check'
);

-- admin_moderation_counts: suspended accounts and organisations and hidden live vacancies, for Trust & Safety at aal2 only.
create function pg_temp.moderation(p_user uuid, p_aal text default 'aal2') returns text
language sql as $$ select pg_temp.value_as(p_user, 'select row_to_json(c)::text from public.admin_moderation_counts() c', p_aal) $$;
select pg_temp.moderation(:'st_trust') as mod0 \gset

update public.profiles set status = 'suspended' where id = :'wa';
update public.organizations set status = 'suspended' where id = :'lone2';
select pg_temp.seed_job('{"title": "Hidden one", "status": "open", "moderation_state": "hidden"}', :'lone') is not null as hidden_job \gset
select is(
  pg_temp.moderation(:'st_trust')::jsonb,
  (select jsonb_build_object(
    'suspended_users', (m ->> 'suspended_users')::int + 1,
    'suspended_organizations', (m ->> 'suspended_organizations')::int + 1,
    'hidden_vacancies', (m ->> 'hidden_vacancies')::int + 1) from (select :'mod0'::jsonb as m) b),
  'one more suspended account, suspended organisation and hidden vacancy each add exactly one'
);
select pg_temp.moderation(:'st_trust') as mod1 \gset
select pg_temp.seed_job(
  '{"title": "Hidden and deleted", "status": "closed", "moderation_state": "hidden", "deleted_at": "2026-01-01T00:00:00Z"}', :'lone'
) is not null as hidden_gone \gset
select is(
  pg_temp.moderation(:'st_trust')::jsonb, :'mod1'::jsonb,
  'a deleted hidden vacancy is not counted (the moderation page cannot show it)'
);
select is(pg_temp.moderation(:'st_trust', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'a Trust & Safety Administrator at aal1 is refused');
select is(pg_temp.moderation(:'st_admin'), 'P0001|CHARA_FORBIDDEN|', 'a Platform Administrator is refused');
select is(
  pg_temp.call_as(null, 'anon', 'select * from public.admin_moderation_counts()'),
  '42501|permission denied for function admin_moderation_counts|', 'the anonymous role is refused at the privilege check'
);
update public.platform_staff set revoked_at = now() where user_id in (:'st_admin', :'st_trust');
select is(pg_temp.moderation(:'st_trust'), 'P0001|CHARA_FORBIDDEN|', 'a Trust & Safety Administrator whose role is revoked is refused');
select is(pg_temp.value_as(:'st_admin', 'select public.admin_staff_count()'), 'P0001|CHARA_FORBIDDEN|', 'an administrator whose role is revoked is refused');

select * from finish();
rollback;
