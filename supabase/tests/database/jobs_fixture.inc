-- Shared by the vacancy tests: the passport fixture (its company users, one worker and the helpers state_as and
-- affected_as), two organizations (t.a Acme with owner own1, admin adm and member mem; t.b Beta with owner own2 and
-- admin adm2) and insert_job, which builds an insert of a valid vacancy with the given columns replaced (a JSON null
-- inserts NULL). Included with \ir.
\ir passport_fixture.inc

-- \gset keeps the 'ok' answers out of the TAP stream.
select pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.a', (public.create_organization('employer', 'Acme Bau GmbH', 'Acme Bau', 'DE', 'F'))->>'organization_id', true)$$, 'aal1') as setup_a \gset
select pg_temp.call_as(:'own2', 'authenticated',
  $$select set_config('t.b', (public.create_organization('employer', 'Beta Works Ltd', 'Beta Works', 'GB', 'F'))->>'organization_id', true)$$, 'aal1') as setup_b \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  (current_setting('t.a')::uuid, :'adm', 'admin', now()),
  (current_setting('t.a')::uuid, :'mem', 'member', now()),
  (current_setting('t.b')::uuid, :'adm2', 'admin', now());

create function pg_temp.insert_job(p_org uuid, p_over jsonb default '{}') returns text
language sql as $$
  select format(
    'insert into public.jobs (%s) values (%s)',
    string_agg(quote_ident(e.key), ', '), string_agg(quote_nullable(e.value), ', ')
  )
  from jsonb_each_text(jsonb_build_object(
    'organization_id', p_org,
    'title', 'Welder MIG/MAG',
    'description', btrim(repeat('Weld steel frames in our Hamburg workshop. ', 2)),
    'occupation_id', '7212',
    'industry_code', 'C',
    'country_code', 'DE',
    'city', 'Hamburg',
    'employment_type', 'full_time',
    'accommodation', true,
    'visa_support', true,
    'recruitment_preference', 'both'
  ) || p_over) e
$$;

-- Runs the insert of insert_job as an authenticated user of Acme (or p_org) and returns 'ok' or 'sqlstate|message|detail'.
create function pg_temp.insert_as(p_user uuid, p_over jsonb default '{}', p_org uuid default null) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', pg_temp.insert_job(coalesce(p_org, current_setting('t.a')::uuid), p_over), 'aal1')
$$;

-- Changes the status of a vacancy through the guarded update as p_user and returns 'ok' or 'sqlstate|message|detail'.
create function pg_temp.set_status(p_user uuid, p_job uuid, p_status text) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('update public.jobs set status = %L where id = %L', p_status, p_job), 'aal1')
$$;
