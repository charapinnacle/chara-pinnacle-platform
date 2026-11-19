begin;
select plan(6);

\ir jobs_fixture.inc

-- The source saved of an invitation (V42 review, FR-O1 step Select, FR-L4): invite_partners takes p_source saved for an
-- invitation sent from the saved partners and stores it without criteria; any other unknown source is still refused,
-- and the check of requirement_invitations.source holds the four values. Acme (t.a: owner own1) is the fixture's
-- employer; the partner is listed and owned by own2.

\set req '00000000-0000-0000-0000-0000000f4301'
\set partner '00000000-0000-0000-0000-0000000f4302'
\set partner2 '00000000-0000-0000-0000-0000000f4303'

update private.settings set value = 'true' where key = 'release_job_orders';
update private.settings set value = 'false' where key = 'entitlements_enforced';

insert into public.workforce_requirements (
  id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
  recruitment_preference, partner_need, status, visibility, published_at, closes_on
) values (:'req', current_setting('t.a')::uuid, 'Saved welders', 10, 'DE', 'Hamburg', 'C', date '2027-03-01', 'full_time',
  'international', 'both', 'open', 'private', now(), date '2027-04-01');

insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, review_status, listed_at, submitted_at)
values
  (:'partner', 'recruitment_company', 'saved-source-partner', 'Saved Source Ltd', 'Saved Source', 'PH', 'listed',
   now() - interval '1 day', now() - interval '2 days'),
  (:'partner2', 'staffing_company', 'saved-source-partner-2', 'Saved Source Two Ltd', 'Saved Source Two', 'PH', 'listed',
   now() - interval '1 day', now() - interval '2 days');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (:'partner', :'own2', 'owner', now()), (:'partner2', :'own2', 'owner', now());

select set_config('t.req', :'req', true) as ignored \gset
select set_config('t.own1', :'own1', true) as ignored \gset

create function pg_temp.invite(p_partner uuid, p_source text) returns text
language sql as $$
  select pg_temp.call_as(current_setting('t.own1')::uuid, 'authenticated', format(
    'select public.invite_partners(%L, %L, array[%L]::uuid[], %L)', current_setting('t.a'), current_setting('t.req'), p_partner, p_source),
    'aal2')
$$;

select is(pg_temp.invite(:'partner', 'saved'), 'ok', 'an owner at aal2 invites a partner from the saved partners');
select is((select source from public.requirement_invitations where requirement_id = :'req' and organization_id = :'partner'), 'saved',
  'the invitation is stored with source saved');
select is((select suggestion_criteria from public.requirement_invitations where requirement_id = :'req' and organization_id = :'partner'),
  null, 'and without suggestion criteria');
select is(pg_temp.invite(:'partner2', 'favourites'), 'P0001|CHARA_INVALID_INPUT|p_source', 'another source is still refused');
select is((select count(*)::integer from public.requirement_invitations where requirement_id = :'req'), 1, 'and writes nothing');
select throws_ok(
  format($$insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source)
    values (%L, %L, %L, 'favourites')$$, :'req', :'partner2', current_setting('t.a')),
  '23514', null, 'the check of requirement_invitations.source refuses an unknown source');

select * from finish();
rollback;
