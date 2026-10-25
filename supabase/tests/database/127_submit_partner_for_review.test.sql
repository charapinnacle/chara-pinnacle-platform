begin;
select plan(40);

\ir organizations_fixture.inc

-- Submission of a partner for review (V09, FR-J1 AC10, the Ready step; FR-J4 AC7 resubmission; DATA_MODEL.md sections 4,
-- 5 and 7; NFR-S8): submit_partner_for_review, private.partner_profile_missing and the public review target setting.

create function pg_temp.new_partner(p_id uuid, p_type text) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.add_member(p_org uuid, p_user uuid, p_role public.member_role) returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

-- A complete profile: identifier, a source and a served country, an occupation, the recruitment type, a staffing type for
-- a staffing company, and the owner's acceptance of the current commitment.
create function pg_temp.complete(p_org uuid) returns void
language plpgsql as $$
declare
  v_owner uuid := (select user_id from public.organization_members where organization_id = p_org and role = 'owner');
begin
  update public.organizations set legal_entity_identifier = 'ID' || upper(left(replace(p_org::text, '-', ''), 10)),
    legal_entity_identifier_kind = 'registration_number', recruitment_type = 'international' where id = p_org;
  insert into public.organization_geographies (organization_id, scope, country_code)
  values (p_org, 'sources_from', 'PH'), (p_org, 'serves_market', 'DE');
  insert into public.organization_occupations (organization_id, occupation_id) values (p_org, '7212');
  if private.org_type(p_org) = 'staffing_company' then
    insert into public.organization_service_types (organization_id, service) values (p_org, 'temporary');
  end if;
  insert into public.consents (user_id, purpose, version, action)
  values (v_owner, 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
end;
$$;

-- Calls submit_partner_for_review as the user (anonymous for a null user); the result lands in t.result.
create function pg_temp.submit(p_user uuid, p_org uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', public.submit_partner_for_review(%L)::text, true)', p_org), p_aal)
$$;

create function pg_temp.audits(p_org uuid) returns text
language sql as $$
  select coalesce(string_agg(actor_id || ':' || (metadata ->> 'from') || '>' || (metadata ->> 'to'), ',' order by id), '')
  from audit.log
  where entity_type = 'organization' and entity_id = p_org::text and action = 'partner.submitted_for_review'
$$;

create function pg_temp.state(p_org uuid) returns text
language sql as $$
  select concat_ws('|', coalesce(review_status::text, 'null'), coalesce((submitted_at = now())::text, 'null'), coalesce(info_step, '-'))
  from public.organizations where id = p_org
$$;

\set ow '00000000-0000-0000-0000-0000000f1001'
\set ad '00000000-0000-0000-0000-0000000f1002'
\set mb '00000000-0000-0000-0000-0000000f1003'
\set ow2 '00000000-0000-0000-0000-0000000f1004'
\set ow3 '00000000-0000-0000-0000-0000000f1005'
\set ow4 '00000000-0000-0000-0000-0000000f1006'
\set ow5 '00000000-0000-0000-0000-0000000f1007'
\set ow6 '00000000-0000-0000-0000-0000000f1008'

-- Schema ---------------------------------------------------------------------------------------------------------------
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
   where oid = 'public.submit_partner_for_review(uuid)'::regprocedure),
  'submit_partner_for_review is security definer with an empty search_path'
);
select is(
  (select string_agg(r || ':' || has_function_privilege(r, 'public.submit_partner_for_review(uuid)', 'execute'), ',')
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:true,service_role:false',
  'submit_partner_for_review runs for authenticated only'
);
select is(
  (select string_agg(r || ':' || has_function_privilege(r, 'private.partner_profile_missing(uuid)', 'execute'), ',')
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:false',
  'no API role may run the helper private.partner_profile_missing'
);
set local role anon;
select is(
  (select value from public.get_public_settings() where key = 'partner_review_target_working_days'),
  '1',
  'decision 7.2: the review target of one working day is a public setting the Ready screen reads'
);
reset role;

-- Fixture: Manila Skills (owner ow, admin ad, member mb), a rival recruitment company (ow2), a staffing company (ow3), a
-- company submitted by its admin (ow4), a company in the closed states (ow5), a company for the lock test (ow6), the
-- employer of the shared fixture (own1), a worker (wkr) and anonymous.
update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(id, 'recruitment_company')
from unnest(array[:'ow', :'ad', :'mb', :'ow2', :'ow4', :'ow5', :'ow6']::uuid[]) id;
select pg_temp.new_partner(:'ow3', 'staffing_company');
select pg_temp.new_org(:'ow', 'recruitment_company') as manila \gset
select pg_temp.add_member(:'manila', :'ad', 'admin');
select pg_temp.add_member(:'manila', :'mb', 'member');
select pg_temp.new_org(:'ow2', 'recruitment_company') as rival \gset
select pg_temp.new_org(:'ow3', 'staffing_company') as staffing \gset
select pg_temp.new_org(:'ow4', 'recruitment_company') as by_admin \gset
select pg_temp.add_member(:'by_admin', :'ad', 'admin');
select pg_temp.new_org(:'ow5', 'recruitment_company') as closed \gset
select pg_temp.new_org(:'ow6', 'recruitment_company') as org_lock \gset
select pg_temp.new_org(:'own1', 'employer') as emp1 \gset

-- Release switch -------------------------------------------------------------------------------------------------------
select pg_temp.complete(:'rival');
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.submit(:'ow2', :'rival'), 'P0001|CHARA_FORBIDDEN|release_off', 'while release 2a is off the submission is refused');
select is(pg_temp.state(:'rival'), 'onboarding|null|-', 'and nothing changed');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC10: the profile must be complete, the first missing field is named ------------------------------------------------
select is(pg_temp.submit(:'ow', :'manila'), 'P0001|CHARA_PROFILE_INCOMPLETE|legal_entity_identifier',
  'a partner without an identifier is told so first');
update public.organizations set legal_entity_identifier = 'CS201904512', legal_entity_identifier_kind = 'registration_number'
where id = :'manila';
select is(pg_temp.submit(:'ow', :'manila'), 'P0001|CHARA_PROFILE_INCOMPLETE|sources_from',
  'AC10: with no source country the owner at aal2 gets CHARA_PROFILE_INCOMPLETE detail sources_from');
insert into public.organization_geographies (organization_id, scope, country_code) values (:'manila', 'sources_from', 'PH');
select is(pg_temp.submit(:'ow', :'manila'), 'P0001|CHARA_PROFILE_INCOMPLETE|serves_market', 'then a served country');
insert into public.organization_geographies (organization_id, scope, country_code) values (:'manila', 'serves_market', 'DE');
select is(pg_temp.submit(:'ow', :'manila'), 'P0001|CHARA_PROFILE_INCOMPLETE|occupations', 'then an occupation');
insert into public.organization_occupations (organization_id, occupation_id) values (:'manila', '7212');
select is(pg_temp.submit(:'ow', :'manila'), 'P0001|CHARA_PROFILE_INCOMPLETE|recruitment_type', 'then the recruitment type');
update public.organizations set recruitment_type = 'international' where id = :'manila';
insert into public.organization_service_types (organization_id, service) values (:'manila', 'staffing');
select is(pg_temp.submit(:'ow', :'manila'), 'P0001|CHARA_PROFILE_INCOMPLETE|staffing_types',
  'a recruitment company that adds the service staffing names a staffing type [d2.4]');
delete from public.organization_service_types where organization_id = :'manila';
select is(pg_temp.submit(:'ow', :'manila'), 'P0001|CHARA_PROFILE_INCOMPLETE|employer_pays_commitment',
  'AC10: with a source country, a served country and an occupation but no commitment, detail employer_pays_commitment');
select is(pg_temp.state(:'manila') || '/' || pg_temp.audits(:'manila'), 'onboarding|null|-/',
  'the refused calls changed nothing and wrote no audit row');

select pg_temp.complete(:'staffing');
delete from public.organization_service_types where organization_id = :'staffing';
select is(pg_temp.submit(:'ow3', :'staffing'), 'P0001|CHARA_PROFILE_INCOMPLETE|staffing_types',
  'a staffing company without a staffing type is incomplete');
insert into public.organization_service_types (organization_id, service) values (:'staffing', 'contract');

-- AC10: roles ----------------------------------------------------------------------------------------------------------
select is(
  pg_temp.call_as(:'ow', 'authenticated', format('select public.accept_employer_pays_commitment(%L, 0)', :'manila'), 'aal1'),
  'ok',
  'the owner accepts the commitment'
);
select is(
  concat_ws(',',
    pg_temp.submit(null, :'manila'),
    pg_temp.submit(:'mb', :'manila'),
    pg_temp.submit(:'ow', :'manila', 'aal1'),
    pg_temp.submit(:'ad', :'manila', 'aal1'),
    pg_temp.submit(:'ow2', :'manila'),
    pg_temp.submit(:'own1', :'manila'),
    pg_temp.submit(:'wkr', :'manila')),
  '42501|permission denied for function submit_partner_for_review|,P0001|CHARA_FORBIDDEN|,'
    || 'P0001|CHARA_FORBIDDEN|aal2_required,P0001|CHARA_FORBIDDEN|aal2_required,P0001|CHARA_FORBIDDEN|,'
    || 'P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|',
  'AC10: anonymous has no grant; the member, a competing partner, an employer and a worker get CHARA_FORBIDDEN; the owner and the admin at aal1 aal2_required'
);
select is(pg_temp.state(:'manila') || '/' || pg_temp.audits(:'manila'), 'onboarding|null|-/', 'the refused calls changed nothing');

-- AC10: the owner submits; a repeat is a no-op ------------------------------------------------------------------------
select is(pg_temp.submit(:'ow', :'manila'), 'ok', 'AC10: the owner at aal2 submits the complete profile');
select is(
  current_setting('t.result')::jsonb - 'submitted_at',
  '{"review_status": "pending_review", "changed": true}'::jsonb,
  'the result names the new state'
);
select is(pg_temp.state(:'manila'), 'pending_review|true|-', 'AC10: review_status pending_review and submitted_at now');
select is(pg_temp.audits(:'manila'), :'ow' || ':onboarding>pending_review', 'AC10: one audit row partner.submitted_for_review');
select is(
  pg_temp.submit(:'ow', :'manila') || ',' || (current_setting('t.result')::jsonb - 'submitted_at')::text
    || ',' || pg_temp.submit(:'ad', :'manila') || ',' || pg_temp.audits(:'manila'),
  'ok,{"changed": false, "review_status": "pending_review"},ok,' || :'ow' || ':onboarding>pending_review',
  'AC10: a repeated submission, by the owner or the admin, is a no-op without a second audit row'
);
select is(private.is_listed_partner(:'manila'), false, 'a partner waiting for review is not listed');

select pg_temp.complete(:'by_admin');
select is(pg_temp.submit(:'ad', :'by_admin') || ',' || pg_temp.state(:'by_admin') || ',' || pg_temp.audits(:'by_admin'),
  'ok,pending_review|true|-,' || :'ad' || ':onboarding>pending_review',
  'AC10: an admin at aal2 may submit');
select is(pg_temp.submit(:'ow3', :'staffing') || ',' || pg_temp.state(:'staffing'), 'ok,pending_review|true|-',
  'a staffing company with a staffing type submits');

-- NFR-S8: a submission of one partner leaves the other untouched
select is(pg_temp.state(:'rival') || '/' || pg_temp.audits(:'rival'), 'onboarding|null|-/', 'NFR-S8: the rival is still in onboarding');

-- FR-J4 AC7: resubmission after a request for information --------------------------------------------------------------
select pg_temp.complete(:'closed');
update public.organizations set review_status = 'info_requested', info_step = 'where_you_serve', submitted_at = now() - interval '2 days'
where id = :'closed';
select is(pg_temp.submit(:'ow5', :'closed') || ',' || pg_temp.state(:'closed'), 'ok,pending_review|true|-',
  'after a request for information the partner returns to pending_review with a new submitted_at and info_step cleared');
select is(
  (select metadata from audit.log where entity_id = :'closed' and action = 'partner.submitted_for_review'),
  '{"from": "info_requested", "to": "pending_review", "info_step": "where_you_serve"}'::jsonb,
  'the audit row names the state left and the step that was reopened'
);
update public.organizations set review_status = 'info_requested', info_step = 'company', listed_at = now() - interval '30 days'
where id = :'closed';
select is(pg_temp.submit(:'ow5', :'closed') || ',' || pg_temp.state(:'closed'), 'ok,re_review|true|-',
  'a partner listed before returns to re_review (DATA_MODEL.md section 5)');

-- Closed states --------------------------------------------------------------------------------------------------------
update public.organizations set review_status = 'listed' where id = :'closed';
select is(pg_temp.submit(:'ow5', :'closed'), 'P0001|CHARA_INVALID_TRANSITION|listed', 'a listed partner has nothing to submit');
update public.organizations set review_status = 'declined' where id = :'closed';
select is(pg_temp.submit(:'ow5', :'closed'), 'P0001|CHARA_INVALID_TRANSITION|declined', 'nor has a declined one');
update public.organizations set review_status = 'onboarding', listed_at = null, status = 'suspended' where id = :'closed';
select is(pg_temp.submit(:'ow5', :'closed'), 'P0001|CHARA_FORBIDDEN|organization_suspended', 'a suspended partner cannot submit');
update public.organizations set status = 'active' where id = :'closed';
update public.profiles set status = 'suspended' where id = :'ow5';
select is(pg_temp.submit(:'ow5', :'closed'), 'P0001|CHARA_FORBIDDEN|profile_suspended', 'a suspended owner cannot submit');
select is(pg_temp.submit(:'own1', :'emp1'), 'P0001|CHARA_FORBIDDEN|partner_only', 'an employer has no review to submit to');
select is(pg_temp.state(:'emp1'), 'null|null|-', 'and keeps review_status null');

-- Concurrency: submissions of one organisation are serialised --------------------------------------------------------
-- A second session holds the lock of a partner, as a submission in progress would: without it a double click could pass
-- the state check twice and audit twice. Another partner is not held up.
select pg_temp.complete(:'org_lock');
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select is(
  (select l from extensions.dblink('holder',
    format('select pg_advisory_lock(hashtextextended(%L, 0))::text', 'partner_review_submission:' || :'org_lock'))
    as t (l text)),
  '',
  'a second session holds the submission lock of a partner'
);
set local lock_timeout = '300ms';
select is(split_part(pg_temp.submit(:'ow6', :'org_lock'), '|', 1), '55P03',
  'a submission of the same partner waits for the one in progress');
select is(pg_temp.submit(:'ow2', :'rival'), 'ok', 'a submission of another partner does not wait');
reset lock_timeout;
select l from extensions.dblink('holder',
  format('select pg_advisory_unlock(hashtextextended(%L, 0))::text', 'partner_review_submission:' || :'org_lock')) as t (l text);
select extensions.dblink_disconnect('holder');
select is(pg_temp.submit(:'ow6', :'org_lock') || ',' || pg_temp.audits(:'org_lock'),
  'ok,' || :'ow6' || ':onboarding>pending_review',
  'once the other submission is over this one goes through with one audit row');

select * from finish();
rollback;
