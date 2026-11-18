begin;
select plan(18);

\ir jobs_fixture.inc

-- An invited partner reads the job order on the marketplace as on its invitation (20270115200200; FR-O1 AC8, FR-N1 AC3,
-- AC5; NFR-S8, NFR-S11): an invitation that is invited, viewed, accepted or responded makes the row of list_job_orders
-- and get_job_order full, eligible and without a reason, whatever the partner's plan, countries or occupations; a
-- declined, withdrawn or expired one grants nothing; another partner with the same facts keeps the reduced row. Acme
-- (t.a: owner own1) is an employer of the fixture.

\set u1 '00000000-0000-0000-0000-0000000f9311'
\set u2 '00000000-0000-0000-0000-0000000f9312'
\set u3 '00000000-0000-0000-0000-0000000f9313'

update private.settings set value = 'true' where key = 'release_job_orders';

-- A listed partner of p_type owned by p_owner, serving p_serves and listing p_occupations, with an active subscription
-- to p_plan (none when null).
create function pg_temp.partner(
  p_slug text, p_owner uuid, p_serves text[], p_occupations text[], p_plan text default 'recruitment_partner',
  p_type text default 'recruitment_company'
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  select v_id, 'serves_market'::public.geography_scope, c from unnest(p_serves) c;
  insert into public.organization_occupations (organization_id, occupation_id) select v_id, o from unnest(p_occupations) o;
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  end if;
  return v_id;
end;
$$;

-- A requirement of p_org written as the lifecycle functions leave it, with the occupations of p_occupations
-- ({"7212": 80, ...}) and the destination p_country.
create function pg_temp.req(
  p_org uuid, p_title text, p_status text, p_visibility text, p_occupations jsonb, p_country text default 'DE',
  p_industry text default 'C', p_start date default '2027-01-15', p_recruitment text default 'both',
  p_show boolean default false, p_published timestamptz default now() - interval '10 days', p_city text default 'Hamburg',
  p_skills text default null, p_id uuid default gen_random_uuid()
) returns uuid
language plpgsql as $$
declare
  v_published boolean := p_status <> 'draft';
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, skills, start_date,
    duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, recruitment_preference,
    partner_need, status, visibility, show_identity, published_at, closes_on, close_reason
  ) values (
    p_id, p_org, p_title, (select sum(value::integer) from jsonb_each_text(p_occupations)), p_country, p_city, p_industry,
    p_skills, p_start, 12, 'full_time', 2500, 3000, 'EUR', 'month', p_recruitment::public.recruitment_preference, 'both',
    p_status::public.requirement_status, case when v_published then p_visibility::public.requirement_visibility end,
    v_published and p_show, case when v_published then p_published end, case when v_published then p_start + 30 end,
    case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select p_id, key, value::integer from jsonb_each_text(p_occupations);
  insert into public.requirement_countries (requirement_id, country_code) values (p_id, p_country);
  return p_id;
end;
$$;

-- list_job_orders as p_user (anonymous when null) for p_org with further arguments p_args: 'ok' with the rows in order
-- as a JSON array in t.result, or 'sqlstate|message|detail'. Each call starts with a fresh rate-limit window.
create function pg_temp.jo(p_user uuid, p_org uuid, p_args text default '') returns text
language sql as $$
  delete from private.rate_limit_hits;
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', coalesce((select jsonb_agg(to_jsonb(r) order by r.n)
       from (select s.*, row_number() over () as n from public.list_job_orders(%L%s) s) r)::text, '[]'), true)$f$,
    p_org, p_args), 'aal1')
$$;

-- get_job_order as p_user for p_org and p_req: 'ok' with the row as JSON in t.result, or 'sqlstate|message|detail'.
create function pg_temp.one(p_user uuid, p_org uuid, p_req uuid) returns text
language sql as $$
  delete from private.rate_limit_hits;
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.result', coalesce((select to_jsonb(s) from public.get_job_order(%L, %L) s)::text, 'null'), true)$f$,
    p_org, p_req), 'aal1')
$$;

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

create function pg_temp.row_of(p_id uuid) returns jsonb
language sql as $$ select e from jsonb_array_elements(pg_temp.result()) e where e ->> 'id' = p_id::text $$;

-- The employers' own titles (from the table, whatever title the row shows) of the rows in order, only those starting
-- with p_prefix.
create function pg_temp.invite(p_req uuid, p_partner uuid, p_status text) returns void
language plpgsql as $$
begin
  insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, status, source,
    viewed_at, answered_at)
  select p_req, p_partner, r.organization_id, p_status::public.invitation_status, 'profile',
    case when p_status <> 'invited' then now() end, case when p_status = 'accepted' then now() end
  from public.workforce_requirements r where r.id = p_req;
  perform private.record_requirement_reveal(p_req, p_partner, 'invitation');
end;
$$;

-- Free partners that serve neither the destination nor list the occupation: titles only on their own.
select pg_temp.partner('inv-free', :'u1', array['NL'], array['8160'], null) as pi \gset
select pg_temp.partner('inv-other', :'u2', array['NL'], array['8160'], null) as po \gset
select pg_temp.partner('inv-declined', :'u3', array['NL'], array['8160'], null) as pd \gset
select pg_temp.req(current_setting('t.a')::uuid, 'Invited Hamburg welders', 'open', 'job_order_marketplace', '{"7212": 20}',
  p_skills => 'MIG/MAG') as r \gset
select pg_temp.invite(:'r', :'pi', 'viewed');
select pg_temp.invite(:'r', :'pd', 'viewed');
update public.requirement_invitations set status = 'declined', answered_at = now(), decline_reason = 'No capacity now'
where requirement_id = :'r' and organization_id = :'pd';

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
   from pg_proc p where p.oid = 'private.job_order_invited(uuid, uuid)'::regprocedure),
  'private.job_order_invited is security definer with an empty search path, executed by no API role');

-- get_job_order --------------------------------------------------------------------------------------------------------------

select is(pg_temp.one(:'u1', :'pi', :'r'), 'ok', 'the invited partner reads the job order');
select is(pg_temp.result() ->> 'eligible', 'true', 'its row is full');
select is(pg_temp.result() -> 'reasons', '[]'::jsonb, 'with no reason');
select is(pg_temp.result() ->> 'title', 'Invited Hamburg welders', 'with the employer''s own title, as the invitation shows');
select is(pg_temp.result() ->> 'employer_name', 'Acme Bau', 'and the employer''s name the invitation revealed');
select is(pg_temp.result() ->> 'skills', 'MIG/MAG', 'and the fields only a full row has');
select is(pg_temp.one(:'u2', :'po', :'r'), 'ok', 'a partner with the same facts and no invitation reads it too');
select is((pg_temp.result() ->> 'eligible') || ' ' || (pg_temp.result() ->> 'reasons'), 'false ["plan_required"]',
  'NFR-S11: but reduced, with its reason');
select ok(pg_temp.result() ->> 'skills' is null and pg_temp.result() ->> 'employer_name' is null,
  'NFR-S11: without the hidden fields or the employer''s name');
select is(pg_temp.one(:'u3', :'pd', :'r'), 'ok', 'the partner that declined its invitation reads it');
select is(pg_temp.result() ->> 'eligible', 'false', 'a declined invitation grants nothing: the row is reduced');

-- list_job_orders ------------------------------------------------------------------------------------------------------------

select is(pg_temp.jo(:'u1', :'pi'), 'ok', 'the invited partner lists the job orders');
select is(pg_temp.row_of(:'r') ->> 'eligible', 'true', 'the invited requirement is a full row in the list too');
select is(pg_temp.jo(:'u1', :'pi', $$, p_occupation => '7212'$$), 'ok', 'a filter on a hidden field');
select ok(pg_temp.row_of(:'r') is not null, 'finds the invited requirement');
select is(pg_temp.jo(:'u2', :'po', $$, p_occupation => '7212'$$), 'ok', 'the same filter for the partner without an invitation');
select ok(pg_temp.row_of(:'r') is null, 'NFR-S11: finds nothing about it');

select * from finish();
rollback;
