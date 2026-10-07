-- Shared by the application status tests (FR-D2): the apply fixture (Acme t.a with owner own1, admin adm and member mem;
-- Beta t.b with owner own2 and admin adm2; the candidates wa and wb) plus staff users, organisations on plans and the
-- helpers below. Included with \ir.
\ir apply_fixture.inc

\set st_admin '00000000-0000-0000-0000-00000000a021'
\set st_trust '00000000-0000-0000-0000-00000000a022'
\set st_review '00000000-0000-0000-0000-00000000a023'
\set pending '00000000-0000-0000-0000-00000000a024'

select pg_temp.new_user(:'st_admin');
select pg_temp.new_user(:'st_trust');
select pg_temp.new_user(:'st_review');
select pg_temp.new_user(:'pending');
update public.profiles set account_kind = intended_account_kind where id in (:'st_admin', :'st_trust', :'st_review', :'pending');
insert into public.platform_staff (user_id, role) values (:'st_admin', 'admin'), (:'st_trust', 'trust_safety'), (:'st_review', 'verification_reviewer');
insert into public.organization_members (organization_id, user_id, role) values (current_setting('t.a')::uuid, :'pending', 'member');

-- An organisation with a member (role member), on a plan: p_plan null is an organisation that never subscribed, p_status
-- 'canceled' a lapsed one. Returns the organisation id; the member is found with pg_temp.member_of.
create function pg_temp.org_on(p_plan text default null, p_status text default 'active') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(v_user);
  perform pg_temp.new_user(v_owner);
  update public.profiles set account_kind = intended_account_kind where id in (v_user, v_owner);
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'employer', 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (v_id, v_owner, 'owner', now()), (v_id, v_user, 'member', now());
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, p_status, 'null');
  end if;
  return v_id;
end;
$$;

create function pg_temp.member_of(p_org uuid) returns uuid
language sql as $$ select user_id from public.organization_members where organization_id = p_org and role = 'member' limit 1 $$;

-- A paused vacancy (it takes no plan limit and its applications still move: OPEN_QUESTIONS.md P16) of an organisation
-- (Acme when null; p_job names another vacancy instead) and an application of a candidate (wa) to it, written as the database
-- owner in any state with the share and the consent apply_to_job makes, one event (null to applied) by the candidate.
create function pg_temp.seed_app(
  p_status text default 'applied', p_org uuid default null, p_worker uuid default '00000000-0000-0000-0000-00000000a101',
  p_job uuid default null
) returns uuid
language plpgsql as $$
declare
  v_org uuid := coalesce(p_org, current_setting('t.a')::uuid);
  v_job uuid := coalesce(p_job, pg_temp.seed_job('{"title": "Status vacancy", "status": "paused"}', v_org));
  v_app uuid := gen_random_uuid();
  v_share uuid := gen_random_uuid();
  v_consent bigint;
begin
  insert into public.consents (user_id, purpose, version, action)
  values (p_worker, 'share_passport:' || v_org, private.current_legal_version('sharing-notice'), 'granted')
  returning id into v_consent;
  insert into public.job_applications (id, job_id, organization_id, worker_user_id, status, passport_share_id, profile_snapshot)
  values (v_app, v_job, v_org, p_worker, p_status::public.application_status, v_share,
          '{"first_name": "Amina", "last_name": "Okafor"}');
  insert into public.passport_shares (id, worker_user_id, organization_id, application_id, scope, consent_id, revoked_at)
  values (v_share, p_worker, v_org, v_app, '[]', v_consent, case when p_status = 'withdrawn' then now() end);
  insert into public.application_events (application_id, from_status, to_status, actor_id) values (v_app, null, 'applied', p_worker);
  return v_app;
end;
$$;

-- set_application_status as p_user: 'ok' or 'sqlstate|message|detail'.
create function pg_temp.set_as(p_user uuid, p_app uuid, p_status text, p_note text default null, p_aal text default 'aal1') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.set_application_status(%L, %L, %L)', p_app, p_status, p_note), p_aal)
$$;

create function pg_temp.viewed_as(p_user uuid, p_app uuid, p_aal text default 'aal1') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.mark_application_viewed(%L)', p_app), p_aal)
$$;

-- The rows of a query as one jsonb array, for the caller p_user; a refusal is the text 'sqlstate|message|detail'.
create function pg_temp.json_as(p_user uuid, p_sql text) returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  begin
    execute format('select coalesce(jsonb_agg(to_jsonb(s)), ''[]'') from (%s) s', p_sql) into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := to_jsonb(format('%s|%s|%s', v_state, v_message, coalesce(v_detail, '')));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- bulk_set_application_status as p_user: the result rows as jsonb ordered by id, or the refusal text.
create function pg_temp.bulk_as(p_user uuid, p_ids uuid[], p_status text, p_note text default null) returns jsonb
language sql as $$
  select pg_temp.json_as(p_user, format('select * from public.bulk_set_application_status(%L::uuid[], %L, %L) order by application_id', p_ids, p_status, p_note))
$$;

create function pg_temp.status_of(p_app uuid) returns text
language sql as $$ select status::text from public.job_applications where id = p_app $$;

create function pg_temp.event_count(p_app uuid) returns bigint
language sql as $$ select count(*) from public.application_events where application_id = p_app $$;

create function pg_temp.queued_for(p_app uuid) returns bigint
language sql as $$ select count(*) from pgmq.q_notifications where message ->> 'application_id' = p_app::text and message ->> 'kind' = 'status_changed' $$;

create function pg_temp.audit_count(p_app uuid) returns bigint
language sql as $$ select count(*) from audit.log where action = 'application.status_changed' and entity_id = p_app::text $$;

-- Everything a status change writes, as one text, to compare before and after a refused call.
create function pg_temp.status_counts() returns text
language sql as $$
  select (select count(*) from public.application_events) || ',' || (select count(*) from audit.log) || ','
      || (select count(*) from pgmq.q_notifications) || ','
      || (select string_agg(id || ':' || status || ':' || coalesce(expires_at::text, '-'), ',' order by id) from (
            select a.id, a.status, s.expires_at from public.job_applications a join public.passport_shares s on s.application_id = a.id) x)
$$;
