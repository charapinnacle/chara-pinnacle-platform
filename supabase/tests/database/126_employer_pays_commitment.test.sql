begin;
select plan(41);

\ir organizations_fixture.inc

-- The employer-pays commitment (V08, FR-J3 AC1, AC2; DATA_MODEL.md section 11 point 2; NFR-C6, NFR-S8):
-- accept_employer_pays_commitment, partner_commitment_status, private.partner_commitment_current, and accept_consents
-- refusing the organisation-level documents.

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

-- Calls accept_employer_pays_commitment as the user at aal1 (anonymous for a null user); the result lands in t.result.
create function pg_temp.accept(p_user uuid, p_org uuid, p_version integer) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', public.accept_employer_pays_commitment(%L, %L)::text, true)', p_org, p_version),
    'aal1')
$$;

-- partner_commitment_status as the user, or 'sqlstate|message|detail' when it is refused.
create function pg_temp.status(p_user uuid, p_org uuid) returns text
language plpgsql as $$
declare
  v_call text := pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.status'', public.partner_commitment_status(%L)::text, true)', p_org), 'aal1');
begin
  return case when v_call = 'ok' then current_setting('t.status') else v_call end;
end;
$$;

-- The commitment consents of a user: 'version:action', oldest first.
create function pg_temp.rows(p_user uuid) returns text
language sql as $$
  select coalesce(string_agg(version || ':' || action, ',' order by id), '')
  from public.consents where user_id = p_user and purpose = 'employer-pays-commitment'
$$;

create function pg_temp.audits(p_org uuid) returns text
language sql as $$
  select coalesce(string_agg(actor_id || ':' || (metadata ->> 'version'), ',' order by id), '') from audit.log
  where entity_type = 'organization' and entity_id = p_org::text and action = 'partner.commitment_accepted'
$$;

-- The next version of the commitment, published a second ago (so that it is current within this transaction).
create function pg_temp.publish(p_draft boolean) returns integer
language sql as $$
  insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
  select 'employer-pays-commitment', max(d.version) + 1, 'Employer-pays commitment', 'We charge workers nothing.',
    'A version of the test.', now() - interval '1 second', p_draft
  from public.legal_documents d where d.slug = 'employer-pays-commitment'
  returning version
$$;

-- The commitment consents of the user a caller sees through row level security (null caller: anonymous).
create function pg_temp.seen_by(p_viewer uuid, p_user uuid) returns text
language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    case when p_viewer is null then '' else json_build_object('sub', p_viewer, 'role', 'authenticated', 'aal', 'aal1')::text end,
    true);
  if p_viewer is null then set local role anon; else set local role authenticated; end if;
  begin
    select count(*) into v_count from public.consents where user_id = p_user and purpose = 'employer-pays-commitment';
  exception when insufficient_privilege then
    v_count := -1;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_count::text;
end;
$$;

\set ow '00000000-0000-0000-0000-0000000f0001'
\set ad '00000000-0000-0000-0000-0000000f0002'
\set mb '00000000-0000-0000-0000-0000000f0003'
\set ow2 '00000000-0000-0000-0000-0000000f0004'
\set ow3 '00000000-0000-0000-0000-0000000f0005'
\set ow4 '00000000-0000-0000-0000-0000000f0006'
\set pp '00000000-0000-0000-0000-0000000f0007'
\set pq '00000000-0000-0000-0000-0000000f0008'

-- Schema ---------------------------------------------------------------------------------------------------------------
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
   where oid in ('public.accept_employer_pays_commitment(uuid, integer)'::regprocedure,
                 'public.partner_commitment_status(uuid)'::regprocedure)),
  'both functions are security definer with an empty search_path'
);
select is(
  (select string_agg(f || ':' || r || ':' || has_function_privilege(r, f, 'execute'), ',' order by f, r)
   from unnest(array['public.accept_employer_pays_commitment(uuid, integer)', 'public.partner_commitment_status(uuid)']) f
   cross join unnest(array['anon', 'authenticated', 'service_role']) r),
  'public.accept_employer_pays_commitment(uuid, integer):anon:false,public.accept_employer_pays_commitment(uuid, integer):authenticated:true,'
    || 'public.accept_employer_pays_commitment(uuid, integer):service_role:false,public.partner_commitment_status(uuid):anon:false,'
    || 'public.partner_commitment_status(uuid):authenticated:true,public.partner_commitment_status(uuid):service_role:false',
  'both functions run for authenticated only'
);
select is(
  (select string_agg(r || ':' || has_function_privilege(r, 'private.partner_commitment_current(uuid)', 'execute'), ',')
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:false',
  'no API role may run the helper private.partner_commitment_current'
);
select is(
  (select format('%s|%s', version, is_draft::text) from public.v_legal_current where slug = 'employer-pays-commitment'),
  '0|true',
  'the commitment starts as the draft version 0 of V04, which counts as published'
);

-- Fixture: Manila Skills (owner ow, admin ad, member mb), a rival recruitment company (ow2), two staffing companies (ow3,
-- ow4), a company for the lock test (pp), the employers of the shared fixture (own1 with admin adm, own2), a worker (wkr)
-- and anonymous.
update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(id, 'recruitment_company') from unnest(array[:'ow', :'ad', :'mb', :'ow2', :'pp', :'pq']::uuid[]) id;
select pg_temp.new_partner(id, 'staffing_company') from unnest(array[:'ow3', :'ow4']::uuid[]) id;
select pg_temp.new_org(:'ow', 'recruitment_company') as manila \gset
select pg_temp.add_member(:'manila', :'ad', 'admin');
select pg_temp.add_member(:'manila', :'mb', 'member');
select pg_temp.new_org(:'ow2', 'recruitment_company') as rival \gset
select pg_temp.new_org(:'ow3', 'staffing_company') as staffing \gset
select pg_temp.new_org(:'ow4', 'staffing_company') as staffing2 \gset
select pg_temp.new_org(:'pp', 'recruitment_company') as org_lock \gset
select pg_temp.new_org(:'pq', 'recruitment_company') as org_free \gset
select pg_temp.new_org(:'own1', 'employer') as emp1 \gset
select pg_temp.add_member(:'emp1', :'adm', 'admin');

-- Release switch -------------------------------------------------------------------------------------------------------
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(
  pg_temp.accept(:'ow', :'manila', 0) || ',' || pg_temp.status(:'ow', :'manila'),
  'P0001|CHARA_FORBIDDEN|release_off,P0001|CHARA_FORBIDDEN|release_off',
  'while release 2a is off both functions refuse'
);
select is(pg_temp.rows(:'ow'), '', 'nothing was recorded while the release is off');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC2: only the owner of the partner accepts ----------------------------------------------------------------------------
select is(
  concat_ws(',',
    pg_temp.accept(null, :'manila', 0),
    pg_temp.accept(:'ad', :'manila', 0),
    pg_temp.accept(:'mb', :'manila', 0),
    pg_temp.accept(:'own1', :'manila', 0),
    pg_temp.accept(:'wkr', :'manila', 0),
    pg_temp.accept(:'ow2', :'manila', 0)),
  '42501|permission denied for function accept_employer_pays_commitment|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,'
    || 'P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|',
  'AC2: anonymous, the admin, the member, an employer owner, a worker and the owner of a competing partner are refused'
);
select is(
  pg_temp.rows(:'ad') || '/' || pg_temp.rows(:'mb') || '/' || pg_temp.rows(:'own1') || '/' || pg_temp.rows(:'wkr')
    || '/' || pg_temp.rows(:'ow2') || '/' || pg_temp.audits(:'manila'),
  '/////',
  'AC2: the refused calls wrote no consent and no audit row'
);
select is(
  pg_temp.accept(:'own1', :'emp1', 0),
  'P0001|CHARA_FORBIDDEN|partner_only',
  'an employer owner cannot accept the commitment for an employer'
);
select is(
  pg_temp.accept(:'ow', :'manila', null) || ',' || pg_temp.accept(:'ow', :'manila', 1) || ',' || pg_temp.accept(:'ow', :'manila', -1),
  'P0001|CHARA_INVALID_INPUT|version,P0001|CHARA_INVALID_INPUT|version,P0001|CHARA_INVALID_INPUT|version',
  'AC2: a missing, an unpublished and a negative version raise CHARA_INVALID_INPUT detail version'
);
select is(
  pg_temp.status(:'mb', :'manila')::jsonb,
  '{"version": 0, "is_draft": true, "accepted": false, "accepted_version": null}'::jsonb,
  'a member reads that the draft commitment is not accepted yet'
);

-- AC1, AC2: the owner accepts the current version (the draft while counsel's text is not published).
select is(pg_temp.accept(:'ow', :'manila', 0), 'ok', 'AC2: the owner at aal1 accepts the current version');
select is(current_setting('t.result')::jsonb, '{"version": 0, "changed": true}'::jsonb, 'the result names the version');
select is(pg_temp.rows(:'ow'), '0:granted', 'AC1: one consents row of the owner, purpose employer-pays-commitment, the version, granted');
select is(pg_temp.audits(:'manila'), :'ow' || ':0', 'AC2: one audit row partner.commitment_accepted with the version');
select is(
  private.partner_commitment_current(:'manila') || ',' || private.partner_commitment_current(:'rival'),
  'true,false',
  'the acceptance counts for this partner only'
);
select is(
  pg_temp.accept(:'ow', :'manila', 0)
    || ',' || (current_setting('t.result')::jsonb = '{"version": 0, "changed": false}'::jsonb)::text
    || ',' || pg_temp.rows(:'ow') || ',' || pg_temp.audits(:'manila'),
  'ok,true,0:granted,' || :'ow' || ':0',
  'a repeated acceptance records nothing and says so'
);
select is(
  pg_temp.status(:'ad', :'manila')::jsonb || '{}'::jsonb,
  '{"version": 0, "is_draft": true, "accepted": true, "accepted_version": 0}'::jsonb,
  'the admin reads that the owner accepted the current version'
);

-- NFR-S8: the state of one partner stays inside it -----------------------------------------------------------------------
select is(
  concat_ws(',',
    pg_temp.status(null, :'manila'),
    pg_temp.status(:'ow2', :'manila'),
    pg_temp.status(:'own1', :'manila'),
    pg_temp.status(:'wkr', :'manila'),
    pg_temp.status(:'own1', :'emp1')),
  '42501|permission denied for function partner_commitment_status|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,'
    || 'P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|partner_only',
  'NFR-S8: anonymous, a competing partner, an employer and a worker cannot read the commitment state; an employer has none'
);
select is(
  concat_ws(',', pg_temp.seen_by(:'ow', :'ow'), pg_temp.seen_by(:'ad', :'ow'), pg_temp.seen_by(:'mb', :'ow'),
    pg_temp.seen_by(:'ow2', :'ow'), pg_temp.seen_by(:'own1', :'ow'), pg_temp.seen_by(:'wkr', :'ow'), pg_temp.seen_by(null, :'ow')),
  '1,0,0,0,0,0,-1',
  'NFR-S8: only the owner reads their consent row; members, other partners, employers and workers see none, anonymous no table'
);

-- A new version needs a new acceptance --------------------------------------------------------------------------------
select is(pg_temp.publish(false), 1, 'counsel''s text is published as version 1');
select is(private.partner_commitment_current(:'manila'), false, 'the acceptance of the draft is outdated by version 1');
select is(
  pg_temp.status(:'mb', :'manila')::jsonb,
  '{"version": 1, "is_draft": false, "accepted": false, "accepted_version": 0}'::jsonb,
  'the status tells an outdated commitment (accepted version 0) from one never accepted'
);
select is(
  pg_temp.accept(:'ow', :'manila', 0) || ',' || pg_temp.accept(:'ad', :'manila', 1),
  'P0001|CHARA_INVALID_INPUT|version,P0001|CHARA_FORBIDDEN|',
  'AC2: the owner cannot accept the draft version 0 once version 1 is published; the admin cannot accept version 1'
);
select is(pg_temp.accept(:'ow', :'manila', 1), 'ok', 'the owner accepts version 1');
select is(pg_temp.publish(false), 2, 'version 2 is published');
select is(
  pg_temp.accept(:'ow', :'manila', 1) || ',' || pg_temp.accept(:'ow', :'manila', 3),
  'P0001|CHARA_INVALID_INPUT|version,P0001|CHARA_INVALID_INPUT|version',
  'AC2: an older and a newer version than the current one are refused'
);
select is(
  pg_temp.accept(:'ow', :'manila', 2) || ',' || pg_temp.rows(:'ow') || ',' || pg_temp.audits(:'manila'),
  'ok,0:granted,1:granted,2:granted,' || :'ow' || ':0,' || :'ow' || ':1,' || :'ow' || ':2',
  'each version accepted is one consent and one audit row'
);

-- A staffing company and the closed states -------------------------------------------------------------------------------
select is(pg_temp.accept(:'ow3', :'staffing', 2), 'ok', 'the owner of a staffing company accepts too');
update public.organizations set status = 'suspended' where id = :'staffing2';
select is(pg_temp.accept(:'ow4', :'staffing2', 2), 'P0001|CHARA_FORBIDDEN|organization_suspended',
  'the owner of a suspended partner cannot accept');
update public.profiles set status = 'suspended' where id = :'pq';
select is(pg_temp.accept(:'pq', :'org_free', 2), 'P0001|CHARA_FORBIDDEN|profile_suspended', 'a suspended owner cannot accept');

-- DATA_MODEL.md section 11 point 2: after a transfer of ownership the new owner accepts again --------------------------
update public.organization_members set role = 'admin' where organization_id = :'manila' and user_id = :'ow';
update public.organization_members set role = 'owner' where organization_id = :'manila' and user_id = :'ad';
select is(
  pg_temp.status(:'mb', :'manila')::jsonb,
  '{"version": 2, "is_draft": false, "accepted": false, "accepted_version": null}'::jsonb,
  'after a transfer the commitment is not accepted and the new owner has accepted no version'
);
select is(
  pg_temp.accept(:'ow', :'manila', 2) || ',' || pg_temp.accept(:'ad', :'manila', 2),
  'P0001|CHARA_FORBIDDEN|,ok',
  'the former owner can no longer accept; the new owner does'
);
select is(private.partner_commitment_current(:'manila'), true, 'the new owner''s acceptance counts for the partner');

-- accept_consents refuses the organisation-level documents -------------------------------------------------------------
select is(
  pg_temp.call_as(:'mb', 'authenticated',
    'select public.accept_consents(''[{"purpose": "employer-pays-commitment", "version": 2}]'')', 'aal1')
    || ',' || pg_temp.call_as(:'mb', 'authenticated',
    format('select public.accept_consents(%L)', jsonb_build_array(jsonb_build_object(
      'purpose', 'partner-dpa', 'version', private.current_legal_version('partner-dpa'))))::text, 'aal1'),
  'P0001|CHARA_INVALID_INPUT|employer-pays-commitment,P0001|CHARA_INVALID_INPUT|partner-dpa',
  'no user accepts the commitment or the partner DPA for themselves through accept_consents'
);
select is(pg_temp.rows(:'mb'), '', 'so a member who later becomes owner holds no acceptance from before');
select is(
  pg_temp.call_as(:'mb', 'authenticated',
    format('select public.accept_consents(%L)', jsonb_build_array(jsonb_build_object(
      'purpose', 'partner-terms', 'version', private.current_legal_version('partner-terms'))))::text, 'aal1'),
  'ok',
  'accept_consents still records a document of the user''s own list'
);

-- NFR-A4: acceptances of one partner are serialised -----------------------------------------------------------------------
-- A second session holds the lock of a partner, as an acceptance in progress would: without the lock two acceptances at
-- the same moment could both find none and record two rows. Another partner is not held up.
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select is(
  (select l from extensions.dblink('holder',
    format('select pg_advisory_lock(hashtextextended(%L, 0))::text', 'employer_pays_commitment:' || :'org_lock'))
    as t (l text)),
  '',
  'a second session holds the acceptance lock of a partner'
);
set local lock_timeout = '300ms';
select is(
  split_part(pg_temp.accept(:'pp', :'org_lock', 2), '|', 1),
  '55P03',
  'an acceptance for the same partner waits for the one in progress'
);
select is(pg_temp.accept(:'ow2', :'rival', 2), 'ok', 'an acceptance for another partner does not wait');
select l from extensions.dblink('holder',
  format('select pg_advisory_unlock(hashtextextended(%L, 0))::text', 'employer_pays_commitment:' || :'org_lock')) as t (l text);
select extensions.dblink_disconnect('holder');
select is(
  pg_temp.accept(:'pp', :'org_lock', 2) || ',' || pg_temp.rows(:'pp'),
  'ok,2:granted',
  'once the other acceptance is over this one goes through with one row'
);
reset lock_timeout;

select * from finish();
rollback;
