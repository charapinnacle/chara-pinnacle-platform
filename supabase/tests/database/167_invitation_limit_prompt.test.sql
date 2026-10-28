begin;
select plan(17);

\ir jobs_fixture.inc

-- The upgrade prompt of the invitation limit (V42, FR-O1 AC12; FR-R1 KPI limit prompts leading to upgrades):
-- public.record_invitation_limit_prompt records one limit.prompt_shown row for an owner or admin of the employer whose
-- requirement is at partner_invitations_per_requirement (withdrawn invitations do not count), within the hourly ceilings
-- of record_limit_prompt; nobody else, no partner, no other employer and nothing while release 2b is off. Acme (t.a:
-- owner own1, admin adm, member mem) and Beta (t.b: owner own2) are the employers of the fixture.

\set req '00000000-0000-0000-0000-0000000f4201'
\set other '00000000-0000-0000-0000-0000000f4202'
\set partner '00000000-0000-0000-0000-0000000f4203'

select set_config('t.req', :'req', true) as ignored \gset

insert into billing.subscriptions (organization_id, plan_code, status, provider)
values (current_setting('t.a')::uuid, 'employer_starter', 'active', 'null');
update private.settings set value = 'true' where key = 'entitlements_enforced';
update private.settings set value = 'false' where key = 'release_job_orders';

insert into public.workforce_requirements (
  id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
  recruitment_preference, partner_need, status, visibility, published_at, closes_on
) values
  (:'req', current_setting('t.a')::uuid, 'Prompt welders', 10, 'DE', 'Hamburg', 'C', date '2027-03-01', 'full_time',
   'international', 'both', 'open', 'private', now(), date '2027-04-01'),
  (:'other', current_setting('t.b')::uuid, 'Beta welders', 10, 'GB', 'Leeds', 'C', date '2027-03-01', 'full_time',
   'international', 'both', 'open', 'private', now(), date '2027-04-01');

-- Four partners invited by Acme's requirement: three count, the fourth is withdrawn below.
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
select gen_random_uuid(), 'recruitment_company', 'prompt-partner-' || n, 'Prompt Partner ' || n || ' Ltd', 'Prompt Partner ' || n, 'PH'
from generate_series(1, 4) n;
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
values (:'partner', 'recruitment_company', 'prompt-partner-own', 'Prompt Partner Own Ltd', 'Prompt Partner Own', 'PH');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
select id, :'own2', 'owner', now() from public.organizations where slug like 'prompt-partner-%';

create function pg_temp.prompt(p_user uuid, p_org uuid default current_setting('t.a')::uuid,
  p_req uuid default current_setting('t.req')::uuid, p_role text default 'authenticated') returns text
language sql as $$
  select pg_temp.call_as(p_user, p_role, format('select public.record_invitation_limit_prompt(%L, %L)', p_org, p_req), 'aal1')
$$;

create function pg_temp.prompts() returns integer
language sql as $$
  select count(*)::integer from audit.log
  where action = 'limit.prompt_shown' and entity_id = current_setting('t.a') and metadata ->> 'limit_key' = 'partner_invitations_per_requirement'
$$;

-- Grants and the release switch ---------------------------------------------------------------------------------------------

select is(has_function_privilege('anon', 'public.record_invitation_limit_prompt(uuid, uuid)', 'execute'), false,
  'anonymous callers may not execute the function');
select is(has_function_privilege('authenticated', 'public.record_invitation_limit_prompt(uuid, uuid)', 'execute'), true,
  'signed-in users may (the function checks the role)');
select is(pg_temp.prompt(:'own1'), '42501|CHARA_FORBIDDEN|release_off', 'release_job_orders off: refused with release_off');
update private.settings set value = 'true' where key = 'release_job_orders';

-- Who may record ------------------------------------------------------------------------------------------------------------

select is(pg_temp.prompt(:'mem'), '42501|CHARA_FORBIDDEN|', 'an Acme member is refused (members see no upgrade way)');
select is(pg_temp.prompt(:'own2'), '42501|CHARA_FORBIDDEN|', 'the Beta owner naming Acme is refused');
select is(pg_temp.prompt(:'own2', current_setting('t.b')::uuid), 'P0002|CHARA_NOT_FOUND|',
  'the Beta owner naming Beta with Acme''s requirement learns nothing of it');
select is(pg_temp.prompt(:'own2', :'partner', :'other'), '42501|CHARA_FORBIDDEN|employer_only',
  'the owner of a recruitment company is refused with employer_only');
select is(pg_temp.prompt(:'wa'), '42501|CHARA_FORBIDDEN|', 'a candidate is refused');

-- Below and at the limit ----------------------------------------------------------------------------------------------------

insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source)
select :'req', o.id, current_setting('t.a')::uuid, 'directory'
from public.organizations o where o.slug in ('prompt-partner-1', 'prompt-partner-2', 'prompt-partner-4');
update public.requirement_invitations set status = 'withdrawn', withdrawn_at = now()
where requirement_id = :'req' and organization_id = (select id from public.organizations where slug = 'prompt-partner-4');

select is(pg_temp.prompt(:'own1'), 'ok', 'below the limit (2 of 3, a withdrawn one not counted) the owner''s call');
select is(pg_temp.prompts(), 0, 'records nothing below the limit');

insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source)
select :'req', o.id, current_setting('t.a')::uuid, 'profile' from public.organizations o where o.slug = 'prompt-partner-3';

select is(pg_temp.prompt(:'own1'), 'ok', 'AC12: at the limit (3 of 3) the owner''s call');
select is(
  (select metadata from audit.log where action = 'limit.prompt_shown' and entity_id = current_setting('t.a')),
  jsonb_build_object('limit_key', 'partner_invitations_per_requirement', 'plan_code', 'employer_starter', 'limit', 3,
    'used', 3, 'requirement_id', :'req'),
  'AC12: one limit.prompt_shown row with the key, the plan, the limit, the usage and the requirement');
select is((select actor_id from audit.log where action = 'limit.prompt_shown' and entity_id = current_setting('t.a')), :'own1'::uuid,
  'the row names the owner who saw the prompt');

-- The ceilings of record_limit_prompt -----------------------------------------------------------------------------------

update private.settings set value = '1' where key = 'limit_prompt_per_org_key_hour_max';
select is(pg_temp.prompt(:'adm'), 'ok', 'an admin''s call within the hour');
select is(pg_temp.prompts(), 1, 'records nothing over limit_prompt_per_org_key_hour_max for the organisation and key');
update private.settings set value = '10' where key = 'limit_prompt_per_org_key_hour_max';

-- Without enforcement nothing is at a limit ------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'entitlements_enforced';
select is(pg_temp.prompt(:'adm'), 'ok', 'with entitlements_enforced off the admin''s call');
select is(pg_temp.prompts(), 1, 'records nothing: the limit does not apply');

select * from finish();
rollback;
