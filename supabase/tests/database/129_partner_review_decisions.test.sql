begin;
select plan(82);

\ir organizations_fixture.inc

-- Staff review of partners (V11, FR-J4 AC1 to AC9; DATA_MODEL.md sections 4 to 7; decisions 2.5, 7.2; NFR-C7, NFR-S8):
-- public.partner_review_decisions, admin_list_partner_reviews, admin_get_partner_review, admin_decide_partner,
-- partner_review_outcome and the helpers private.add_working_days and private.partner_review_target_days.

create function pg_temp.new_partner(p_id uuid, p_type text) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

-- A partner with an identifier, in the review state given, submitted at the time given.
create function pg_temp.new_org(
  p_owner uuid, p_type public.organization_type, p_status text default 'pending_review', p_submitted timestamptz default now(),
  p_identifier text default null
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, website,
    legal_entity_identifier, legal_entity_identifier_kind)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8) || ' Inc.', 'Org ' || left(v_id::text, 8),
    'PH', 'https://' || left(v_id::text, 8) || '.example',
    case when p_type = 'employer' then null else coalesce(p_identifier, 'ID' || upper(left(replace(v_id::text, '-', ''), 10))) end,
    case when p_type = 'employer' then null else 'registration_number' end);
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  if p_type <> 'employer' then
    update public.organizations
    set review_status = p_status::public.partner_review_status,
        submitted_at = case when p_status = 'onboarding' then null else p_submitted end,
        listed_at = case when p_status in ('listed', 're_review') then p_submitted end
    where id = v_id;
  end if;
  return v_id;
end;
$$;

create function pg_temp.add_member(p_org uuid, p_user uuid, p_role public.member_role) returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

create function pg_temp.decide(p_user uuid, p_org uuid, p_decision text, p_reason text, p_step text default null,
  p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', public.admin_decide_partner(%L, %L, %L, %L)::text, true)',
      p_org, p_decision, p_reason, p_step), p_aal)
$$;

-- The queue as the user reads it: the ids in order, joined by commas, limited to the organisations given.
create function pg_temp.queue(p_user uuid, p_orgs uuid[], p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format($q$select set_config('t.result', coalesce((select string_agg(id::text, ',' order by submitted_at, id)
      from public.admin_list_partner_reviews(100) where id = any (%L::uuid[])), ''), true)$q$, p_orgs), p_aal)
$$;

create function pg_temp.review(p_user uuid, p_org uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format($q$select set_config('t.result', (select to_jsonb(r)::text from public.admin_get_partner_review(%L) r), true)$q$,
      p_org), p_aal)
$$;

create function pg_temp.outcome(p_user uuid, p_org uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format($q$select set_config('t.result', coalesce((select concat_ws('|', decision, coalesce(reason, '-'),
      coalesce(info_step, '-')) from public.partner_review_outcome(%L)), 'none'), true)$q$, p_org))
$$;

create function pg_temp.state(p_org uuid) returns text
language sql as $$
  select concat_ws('|', review_status, coalesce(info_step, '-'), (listed_at is not null)::text) from public.organizations where id = p_org
$$;

create function pg_temp.decisions(p_org uuid) returns integer
language sql as $$ select count(*)::integer from public.partner_review_decisions where organization_id = p_org $$;

create function pg_temp.audits(p_org uuid) returns integer
language sql as $$
  select count(*)::integer from audit.log where entity_id = p_org::text and action = 'partner.review_decided'
$$;

\set ts '00000000-0000-0000-0000-0000000f2001'
\set ts2 '00000000-0000-0000-0000-0000000f2002'
\set rev '00000000-0000-0000-0000-0000000f2003'
\set padm '00000000-0000-0000-0000-0000000f2004'
\set ow '00000000-0000-0000-0000-0000000f2005'
\set mb '00000000-0000-0000-0000-0000000f2006'
\set ow2 '00000000-0000-0000-0000-0000000f2007'
\set ow3 '00000000-0000-0000-0000-0000000f2008'
\set ow4 '00000000-0000-0000-0000-0000000f2009'
\set ow5 '00000000-0000-0000-0000-0000000f2010'
\set ow6 '00000000-0000-0000-0000-0000000f2011'

-- Schema ---------------------------------------------------------------------------------------------------------------
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.partner_review_decisions'::regclass),
  'partner_review_decisions has RLS enabled and forced'
);
select is(
  (select string_agg(r || ':' || has_table_privilege(r, 'public.partner_review_decisions', 'select, insert, update, delete'), ',')
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:false',
  'NFR-S8: no API role has any grant on partner_review_decisions; staff and members read through the RPCs'
);
select is(
  (select string_agg(p || ':' || (select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = p::regprocedure), ',' order by p)
   from unnest(array['public.admin_decide_partner(uuid,text,text,text)', 'public.admin_get_partner_review(uuid)',
     'public.admin_list_partner_reviews(integer,timestamptz,uuid)', 'public.partner_review_outcome(uuid)']) p),
  'public.admin_decide_partner(uuid,text,text,text):true,public.admin_get_partner_review(uuid):true,public.admin_list_partner_reviews(integer,timestamptz,uuid):true,public.partner_review_outcome(uuid):true',
  'the four RPCs are security definer with an empty search_path'
);
select is(
  (select string_agg(f || '=' || (select string_agg(r || ':' || has_function_privilege(r, f, 'execute'), ',')
     from unnest(array['anon', 'authenticated', 'service_role']) r), ' ' order by f)
   from unnest(array['public.admin_decide_partner(uuid,text,text,text)', 'public.admin_get_partner_review(uuid)',
     'public.admin_list_partner_reviews(integer,timestamptz,uuid)', 'public.partner_review_outcome(uuid)',
     'private.add_working_days(timestamptz,integer)', 'private.partner_review_target_days()']) f),
  'private.add_working_days(timestamptz,integer)=anon:false,authenticated:false,service_role:false '
  || 'private.partner_review_target_days()=anon:false,authenticated:false,service_role:false '
  || 'public.admin_decide_partner(uuid,text,text,text)=anon:false,authenticated:true,service_role:false '
  || 'public.admin_get_partner_review(uuid)=anon:false,authenticated:true,service_role:false '
  || 'public.admin_list_partner_reviews(integer,timestamptz,uuid)=anon:false,authenticated:true,service_role:false '
  || 'public.partner_review_outcome(uuid)=anon:false,authenticated:true,service_role:false',
  'the RPCs run for authenticated only, the helpers for nobody'
);

-- Working days (decision 7.2: the due time) ---------------------------------------------------------------------------
select is(
  (select string_agg(to_char(private.add_working_days(t::timestamptz, d) at time zone 'Europe/Berlin', 'Dy DD HH24:MI'), ',')
   from (values ('2026-10-22 15:00 Europe/Berlin', 1), ('2026-10-23 10:00 Europe/Berlin', 1),
     ('2026-10-24 10:00 Europe/Berlin', 1), ('2026-10-22 15:00 Europe/Berlin', 2), ('2026-10-21 09:00 Europe/Berlin', 0)) v (t, d)),
  'Fri 23 15:00,Mon 26 10:00,Tue 27 00:00,Mon 26 15:00,Wed 21 09:00',
  'working days skip Saturday and Sunday in Europe/Berlin; a weekend start counts from the Monday'
);
select is(private.partner_review_target_days(), 1, 'the target is the setting partner_review_target_working_days, 1');

-- Fixture: three submitted partners (09:00, 10:00, 11:00 yesterday), one in onboarding, partners in the other states, a
-- partner whose identifier an employer also names, staff of the three roles, a Trust & Safety Administrator who is a
-- member of a partner (ts2), the employers of the shared fixture (own1 with admin adm), a candidate (wkr) and anonymous.
update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(id, 'recruitment_company') from unnest(array[:'ow', :'mb', :'ow2', :'ow3', :'ow4', :'ow5']::uuid[]) id;
select pg_temp.new_partner(:'ow6', 'staffing_company');
select pg_temp.new_user(id) from unnest(array[:'ts', :'ts2', :'rev', :'padm']::uuid[]) id;
update public.profiles set account_kind = 'company' where id = :'ts2';
insert into public.platform_staff (user_id, role)
values (:'ts', 'trust_safety'), (:'ts2', 'trust_safety'), (:'rev', 'verification_reviewer'), (:'padm', 'admin');

select pg_temp.new_org(:'own1', 'employer') as emp1 \gset
select pg_temp.add_member(:'emp1', :'adm', 'admin');
update public.organizations set legal_entity_identifier = 'CS201904512', legal_entity_identifier_kind = 'registration_number'
where id = :'emp1';
select pg_temp.new_org(:'ow', 'recruitment_company', 'pending_review', date_trunc('day', now()) - interval '15 hours', 'CS201904512') as a9 \gset
select pg_temp.add_member(:'a9', :'mb', 'member');
select pg_temp.add_member(:'a9', :'ts2', 'admin');
select pg_temp.new_org(:'ow2', 'recruitment_company', 'pending_review', date_trunc('day', now()) - interval '14 hours') as a10 \gset
select pg_temp.new_org(:'ow3', 'recruitment_company', 'pending_review', date_trunc('day', now()) - interval '13 hours') as a11 \gset
select pg_temp.new_org(:'ow4', 'recruitment_company', 'onboarding') as onb \gset
select pg_temp.new_org(:'ow5', 'recruitment_company', 'info_requested', now() - interval '3 days') as inf \gset
select pg_temp.new_org(:'ow5', 'recruitment_company', 'listed', now() - interval '3 days') as lst \gset
select pg_temp.new_org(:'ow5', 'recruitment_company', 're_review', date_trunc('day', now()) - interval '12 hours') as rer \gset
select pg_temp.new_org(:'ow5', 'recruitment_company', 'declined', now() - interval '3 days') as dec \gset
select pg_temp.new_org(:'ow6', 'staffing_company', 'pending_review', now() - interval '2 days') as stf \gset
insert into public.organization_geographies (organization_id, scope, country_code)
values (:'a9', 'sources_from', 'PH'), (:'a9', 'serves_market', 'DE');
insert into public.organization_occupations (organization_id, occupation_id) values (:'a9', '7212');
insert into public.consents (user_id, purpose, version, action)
values (:'ow', 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');

-- Release switch -------------------------------------------------------------------------------------------------------
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(
  pg_temp.queue(:'ts', array[:'a9']::uuid[]) || ',' || pg_temp.review(:'ts', :'a9') || ','
    || pg_temp.decide(:'ts', :'a9', 'approve', 'Registry entry and website match'),
  'P0001|CHARA_FORBIDDEN|release_off,P0001|CHARA_FORBIDDEN|release_off,P0001|CHARA_FORBIDDEN|release_off',
  'while release 2a is off the queue, the review page and the decision are refused'
);
select is(pg_temp.outcome(:'ow', :'a9'), 'P0001|CHARA_FORBIDDEN|release_off', 'and the outcome for the partner');
update private.settings set value = 'true' where key = 'release_partner_directories';

-- AC1: the queue, oldest first -----------------------------------------------------------------------------------------
select is(pg_temp.queue(:'ts', array[:'a9', :'a10', :'a11', :'onb', :'inf', :'lst', :'rer', :'dec']::uuid[]), 'ok',
  'AC1: a Trust & Safety Administrator at aal2 reads the queue');
select is(current_setting('t.result'), concat_ws(',', :'a9', :'a10', :'a11', :'rer'),
  'AC1: the submitted partners from 09:00 to 11:00, then the re-review; onboarding, info_requested, listed and declined are absent');
select is(
  pg_temp.call_as(:'rev', 'authenticated', format($q$select set_config('t.result', (select concat_ws('|', legal_name,
    display_name, type, based_in_country, legal_entity_identifier, legal_entity_identifier_kind, website, review_status,
    submitted_at = date_trunc('day', now()) - interval '15 hours',
    due_at, same_identifier)
    from public.admin_list_partner_reviews(100) where id = %L), true)$q$, :'a9')),
  'ok', 'AC1: a Verification Reviewer at aal2 reads the queue'
);
select is(current_setting('t.result'),
  (select concat_ws('|', legal_name, display_name, 'recruitment_company', 'PH', 'CS201904512', 'registration_number', website,
    'pending_review', 't', private.add_working_days(submitted_at, 1), 't')
   from public.organizations where id = :'a9'),
  'AC1: legal name, type, country, identifier, website, waiting since, due time and the same-identifier flag; no personal data'
);
select is(
  pg_temp.val_as(:'padm', 'aal2',
    format('select same_identifier::text from public.admin_list_partner_reviews(100) where id = %L', :'a11')),
  'false', 'AC1: a Platform Administrator at aal2 reads it too; a partner whose identifier nobody else names has no flag'
);
-- A link is stored from the organisation that named the identifier last: an employer created after a10 with its
-- identifier is read from a10's side too.
select pg_temp.new_org(:'own2', 'employer') as emp2 \gset
update public.organizations set legal_entity_identifier = (select legal_entity_identifier from public.organizations where id = :'a10'),
  legal_entity_identifier_kind = 'registration_number' where id = :'emp2';
select is(
  pg_temp.val_as(:'ts', 'aal2',
    format('select same_identifier::text from public.admin_list_partner_reviews(100) where id = %L', :'a10'))
  || ',' || (select count(*)::text from private.organization_identifier_links where organization_id = :'emp2' and other_organization_id = :'a10'),
  'true,1', 'the flag reads a link stored from the other organisation'
);
select pg_temp.review(:'ts', :'a10') as ignored \gset
select is(
  (select string_agg((l ->> 'id') || ':' || (l ->> 'same_type'), ',') from jsonb_array_elements(current_setting('t.result')::jsonb -> 'identifier_links') l),
  :'emp2' || ':false', 'AC2: and the review page names that organisation once'
);
select is(
  pg_temp.queue(:'ts', array[:'a9']::uuid[], 'aal1') || ',' || pg_temp.queue(:'ow', array[:'a9']::uuid[]) || ','
    || pg_temp.queue(:'adm', array[:'a9']::uuid[]) || ',' || pg_temp.queue(:'wkr', array[:'a9']::uuid[]) || ','
    || pg_temp.queue(null, array[:'a9']::uuid[]),
  'P0001|CHARA_FORBIDDEN|aal2_required,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,'
  || '42501|permission denied for function admin_list_partner_reviews|',
  'the queue: staff at aal1 must step up; a partner, an employer and a candidate are refused; anonymous has no grant'
);
select submitted_at as a9_at from public.organizations where id = :'a9' \gset
select is(
  pg_temp.val_as(:'ts', 'aal2', format($q$select string_agg(id::text, ',' order by submitted_at, id) from
    public.admin_list_partner_reviews(2, %L, %L)
    where id = any (%L::uuid[])$q$, :'a9_at', :'a9', array[:'a9', :'a10', :'a11', :'rer']::uuid[])),
  concat_ws(',', :'a10', :'a11'),
  'keyset: the page after the cursor (submitted_at, id) of 09:00 starts at 10:00'
);
select is(
  pg_temp.call_as(:'ts', 'authenticated', format('select * from public.admin_list_partner_reviews(10, now(), null)')),
  'P0001|CHARA_INVALID_INPUT|cursor', 'a cursor needs both of its values'
);

-- AC2: the review page -------------------------------------------------------------------------------------------------
select is(pg_temp.review(:'ts', :'a9'), 'ok', 'AC2: a Trust & Safety Administrator opens the review page');
select is(
  (select concat_ws('|', r ->> 'legal_name', r ->> 'legal_entity_identifier', r ->> 'legal_entity_identifier_kind',
     r ->> 'website', r ->> 'owner_email', r -> 'identifier_links' -> 0 ->> 'id', r -> 'identifier_links' -> 0 ->> 'same_type',
     r -> 'identifier_links' -> 0 ->> 'type', jsonb_array_length(r -> 'geographies'), r -> 'occupations' -> 0 ->> 'code',
     r -> 'commitment' ->> 'current', jsonb_array_length(r -> 'decisions'), (r ->> 'due_at') is not null)
   from (select current_setting('t.result')::jsonb r) x),
  (select concat_ws('|', legal_name, 'CS201904512', 'registration_number', website, :'ow' || '@partner.test') from public.organizations where id = :'a9')
    || '|' || :'emp1' || '|false|employer|2|7212|true|0|t',
  'AC2: identifier and kind, website, owner email, the linked employer with the same-type flag false, countries, occupations, commitment'
);
select ok(
  current_setting('t.result') !~* 'passport|"members"|first_name|phone' and current_setting('t.result') !~ (:'mb' || '@partner.test'),
  'AC2: no worker data and no member contact details other than the owner email'
);
select is(
  pg_temp.review(:'rev', :'a9') || ',' || pg_temp.review(:'padm', :'a9') || ',' || pg_temp.review(:'ts', :'a9', 'aal1') || ','
    || pg_temp.review(:'ow', :'a9') || ',' || pg_temp.review(:'adm', :'a9') || ',' || pg_temp.review(null, :'a9'),
  'ok,ok,P0001|CHARA_FORBIDDEN|aal2_required,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,'
  || '42501|permission denied for function admin_get_partner_review|',
  'AC2: the reviewer and the administrator read it; staff at aal1, the partner, an employer and anonymous do not'
);
select is(
  pg_temp.review(:'ts', :'emp1') || ',' || pg_temp.review(:'ts', gen_random_uuid()),
  'P0002|CHARA_NOT_FOUND|,P0002|CHARA_NOT_FOUND|', 'an employer and an unknown organisation are not found'
);
select pg_temp.review(:'ts', :'a10') as ignored \gset
select is(
  current_setting('t.result')::jsonb -> 'commitment' ->> 'current',
  'false', 'AC2: a partner whose owner holds no current commitment is shown so'
);

-- AC4: who decides -----------------------------------------------------------------------------------------------------
select is(
  pg_temp.decide(:'ts', :'a9', 'approve', 'Registry entry and website match', null, 'aal1') || ','
    || pg_temp.decide(:'rev', :'a9', 'approve', 'Registry entry and website match') || ','
    || pg_temp.decide(:'padm', :'a9', 'approve', 'Registry entry and website match') || ','
    || pg_temp.decide(:'ow', :'a9', 'approve', 'Registry entry and website match') || ','
    || pg_temp.decide(:'adm', :'a9', 'approve', 'Registry entry and website match') || ','
    || pg_temp.decide(:'ts2', :'a9', 'approve', 'Registry entry and website match') || ','
    || pg_temp.decide(null, :'a9', 'approve', 'Registry entry and website match'),
  'P0001|CHARA_FORBIDDEN|aal2_required,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,'
  || 'P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|own_organization,42501|permission denied for function admin_decide_partner|',
  'AC4: T&S at aal1 must step up; the reviewer, the administrator, the owner and the employer are refused; staff of the partner get own_organization; anonymous has no grant'
);
select is(pg_temp.state(:'a9') || ',' || pg_temp.decisions(:'a9') || ',' || pg_temp.audits(:'a9'),
  'pending_review|-|false,0,0', 'AC4: the refused calls changed nothing and wrote nothing');

-- AC4: a reviewer invited to the partner, or a member of an organisation with the same identifier, is refused too.
\set ts3 '00000000-0000-0000-0000-0000000f2012'
\set ts4 '00000000-0000-0000-0000-0000000f2013'
select pg_temp.new_user(:'ts3', 'company', 'Invited.Reviewer@Example.TEST');
select pg_temp.new_user(:'ts4');
update public.profiles set account_kind = 'company' where id in (:'ts3', :'ts4');
insert into public.platform_staff (user_id, role) values (:'ts3', 'trust_safety'), (:'ts4', 'trust_safety');
insert into public.organization_invitations (organization_id, email, role, token_hash)
values (:'inf', 'invited.reviewer@example.test', 'member', repeat('a', 64));
select pg_temp.add_member(:'emp1', :'ts4', 'member');
select is(
  pg_temp.decide(:'ts3', :'inf', 'approve', 'Registry entry and website match') || ','
    || pg_temp.decide(:'ts4', :'a9', 'approve', 'Registry entry and website match'),
  'P0001|CHARA_FORBIDDEN|own_organization,P0001|CHARA_FORBIDDEN|own_organization',
  'AC4: a reviewer with a pending invitation to the partner (address in another case) and a member of the employer with the same identifier get own_organization'
);
update public.organization_invitations set expires_at = now() - interval '1 second', created_at = now() - interval '8 days'
where organization_id = :'inf';
select is(
  pg_temp.decide(:'ts3', :'inf', 'approve', 'Registry entry and website match'),
  'P0001|CHARA_INVALID_TRANSITION|info_requested', 'an expired invitation no longer counts: the call reaches the state check'
);
select is(pg_temp.state(:'a9') || ',' || pg_temp.decisions(:'a9'), 'pending_review|-|false,0', 'and nothing was decided');

-- AC3: approve, request information, decline ---------------------------------------------------------------------------
select is(pg_temp.decide(:'ts', :'a9', 'approve', '  Registry entry and website match  '), 'ok',
  'AC3: the Trust & Safety Administrator at aal2 approves with a 32-character reason');
select is(current_setting('t.result')::jsonb ->> 'review_status', 'listed', 'AC3: the result names the new state');
select is(
  (select concat_ws('|', review_status, (listed_at = now())::text, (info_step is null)::text) from public.organizations where id = :'a9'),
  'listed|true|true', 'AC3: the approval sets review_status listed and listed_at to now'
);
select is(
  (select concat_ws('|', decision, reason, coalesce(info_step, '-'), from_status, to_status, (decided_by = :'ts')::text,
     (submitted_at = date_trunc('day', now()) - interval '15 hours')::text, (decided_at = now())::text)
   from public.partner_review_decisions where organization_id = :'a9'),
  'approve|Registry entry and website match|-|pending_review|listed|true|true|true',
  'AC3: one decision row with the trimmed reason, the states, the staff user and the submission time (KPI time to decision)'
);
select is(
  (select concat_ws('|', count(*), max(actor_id::text), max(metadata ->> 'decision'), max(metadata ->> 'reason'),
     max(metadata ->> 'from'), max(metadata ->> 'to'))
   from audit.log where entity_id = :'a9' and action = 'partner.review_decided'),
  '1|' || :'ts' || '|approve|Registry entry and website match|pending_review|listed',
  'AC3: one audit row partner.review_decided with decision, reason and the staff user'
);
select ok(private.is_listed_partner(:'a9'), 'AC8: the approved partner is listed');

select is(pg_temp.decide(:'ts', :'a10', 'request_info', 'Too short', 'company'), 'P0001|CHARA_INVALID_INPUT|reason',
  'AC3: a 9-character reason raises CHARA_INVALID_INPUT reason');
select is(pg_temp.decide(:'ts', :'a10', 'request_info', 'Please send the registry extract of 2026.'), 'P0001|CHARA_INVALID_INPUT|info_step',
  'a request for information needs the step to reopen');
select is(pg_temp.decide(:'ts', :'a10', 'request_info', 'Please send the registry extract of 2026.', 'security'),
  'P0001|CHARA_INVALID_INPUT|info_step', 'and only company, where_you_serve or commitments');
select is(pg_temp.decide(:'ts', :'a10', 'approve', 'Please send the registry extract of 2026.', 'company'),
  'P0001|CHARA_INVALID_INPUT|info_step', 'an approval names no step');
select is(pg_temp.decide(:'ts', :'a10', 'suspend', 'Please send the registry extract of 2026.'),
  'P0001|CHARA_INVALID_INPUT|decision', 'an unknown decision is refused');
select is(pg_temp.decide(:'ts', :'a10', 'request_info', repeat('x', 40), 'company'), 'ok',
  'AC3: request_info with step company and a 40-character reason succeeds');
select is(pg_temp.state(:'a10'), 'info_requested|company|false', 'AC3: review_status info_requested and info_step company');
select is(pg_temp.decisions(:'a10') || ',' || pg_temp.audits(:'a10'), '1,1', 'AC3: one decision row and one audit row');

select is(pg_temp.decide(:'ts', :'a11', 'decline', repeat('y', 2001)), 'P0001|CHARA_INVALID_INPUT|reason',
  'AC3: a 2,001-character reason raises CHARA_INVALID_INPUT reason');
select is(pg_temp.decide(:'ts', :'a11', 'decline', repeat('y', 2000)), 'ok', 'a 2,000-character reason is accepted');
select is(pg_temp.state(:'a11') || ',' || pg_temp.decisions(:'a11') || ',' || pg_temp.audits(:'a11'), 'declined|-|false,1,1',
  'AC3: the decline sets declined with one decision row and one audit row');
select ok(not private.is_listed_partner(:'a11'), 'AC8: a declined partner is not listed');

-- AC6 (deferred to V14): no notification is queued until the kinds exist
select is(
  (select count(*)::integer from public.notifications where user_id in (:'ow', :'ow2', :'ow3')),
  0, 'AC6 deferred to V14: the decisions queue no notification until the kinds partner_approved, partner_info_requested and partner_declined exist'
);

-- AC5: only open decisions ---------------------------------------------------------------------------------------------
select is(
  pg_temp.decide(:'ts', :'onb', 'approve', 'Registry entry and website match') || ','
    || pg_temp.decide(:'ts', :'inf', 'approve', 'Registry entry and website match') || ','
    || pg_temp.decide(:'ts', :'lst', 'approve', 'Registry entry and website match') || ','
    || pg_temp.decide(:'ts', :'dec', 'approve', 'Registry entry and website match') || ','
    || pg_temp.decide(:'ts', :'lst', 'request_info', 'Please check the company details.', 'company'),
  'P0001|CHARA_INVALID_TRANSITION|onboarding,P0001|CHARA_INVALID_TRANSITION|info_requested,P0001|CHARA_INVALID_TRANSITION|listed,'
  || 'P0001|CHARA_INVALID_TRANSITION|declined,P0001|CHARA_INVALID_TRANSITION|listed',
  'AC5: onboarding, info_requested, listed and declined raise CHARA_INVALID_TRANSITION, as does request_info on the listed partner'
);
select is(
  (select string_agg(pg_temp.state(o) || ':' || pg_temp.decisions(o), ',') from unnest(array[:'onb', :'inf', :'lst', :'dec']::uuid[]) o),
  'onboarding|-|false:0,info_requested|-|false:0,listed|-|true:0,declined|-|false:0', 'AC5: and change nothing'
);
select is(pg_temp.decide(:'ts', :'a9', 'decline', 'A second decision on the same partner.'), 'P0001|CHARA_INVALID_TRANSITION|listed',
  'a decided partner cannot be decided again');
select is(pg_temp.decide(:'ts', :'emp1', 'approve', 'Registry entry and website match') || ','
    || pg_temp.decide(:'ts', gen_random_uuid(), 'approve', 'Registry entry and website match'),
  'P0002|CHARA_NOT_FOUND|,P0002|CHARA_NOT_FOUND|', 'an employer and an unknown organisation are not found');

-- Re-review: a listed partner stays listed while asked for information, keeps its first listing time when approved again
-- and leaves the directories when declined.
select listed_at as rer_listed from public.organizations where id = :'rer' \gset
select is(pg_temp.decide(:'ts', :'rer', 'request_info', 'Please confirm the new legal name.', 'company'), 'ok',
  'AC5: request_info on a re-review succeeds');
select ok(private.is_listed_partner(:'rer'), 'the partner asked for information during a re-review stays listed');
update public.organizations set review_status = 're_review', info_step = null where id = :'rer';
select is(pg_temp.decide(:'ts', :'rer', 'approve', 'The new legal name matches the register.'), 'ok', 'AC5: approve succeeds for re_review');
select is((select listed_at = :'rer_listed'::timestamptz from public.organizations where id = :'rer'), true,
  'listed_at is set at the first approval only');
update public.organizations set review_status = 're_review' where id = :'rer';
select is(pg_temp.decide(:'ts', :'rer', 'decline', 'The company is no longer registered.'), 'ok', 'a re-review can end in a decline');
select ok(not private.is_listed_partner(:'rer'), 'and the declined partner leaves the directories');
select is(
  (select string_agg(from_status || '>' || to_status, ',' order by id) from public.partner_review_decisions where organization_id = :'rer'),
  're_review>info_requested,re_review>listed,re_review>declined', 'each re-review decision is recorded with its states'
);

-- AC9 with V03: a change of legal name sends the listed partner back to the end of the queue, still listed
update public.organizations set legal_name = 'Manila Skills Recruitment Corp.' where id = :'a9';
select is(pg_temp.state(:'a9'), 're_review|-|true', 'AC9: the legal name change of a listed partner sets re_review');
select is(
  pg_temp.val_as(:'ts', 'aal2', format($q$select (array_agg(id::text order by submitted_at desc, id desc))[1]
    from public.admin_list_partner_reviews(100)$q$)),
  :'a9', 'AC9: and it is at the end of the queue'
);
select ok(private.is_listed_partner(:'a9'), 'AC9: it stays listed while in re-review');

-- AC7: the partner reads the outcome and resubmits ---------------------------------------------------------------------
select is(pg_temp.outcome(:'ow2', :'a10'), 'ok', 'AC7: the owner reads the outcome');
select is(current_setting('t.result'), 'request_info|' || repeat('x', 40) || '|company',
  'AC7: the request for information with the staff message and the step to reopen');
select is(pg_temp.outcome(:'ow3', :'a11') || ':' || current_setting('t.result'), 'ok:decline|' || repeat('y', 2000) || '|-',
  'NFR-C7: the declined partner reads the statement of reasons');
select is(pg_temp.outcome(:'ow', :'a9') || ':' || current_setting('t.result'), 'ok:approve|-|-',
  'the reason of an approval stays in the staff record');
select is(pg_temp.outcome(:'mb', :'a9'), 'ok', 'a member of the partner reads the outcome');
select is(pg_temp.outcome(:'ow6', :'stf') || ':' || current_setting('t.result'), 'ok:none', 'no row before the first decision');
select is(
  pg_temp.outcome(:'ow2', :'a11') || ',' || pg_temp.outcome(:'own1', :'a11') || ',' || pg_temp.outcome(:'ts', :'a11') || ','
    || pg_temp.outcome(:'wkr', :'a11') || ',' || pg_temp.outcome(null, :'a11'),
  'P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,P0001|CHARA_FORBIDDEN|,'
  || '42501|permission denied for function partner_review_outcome|',
  'NFR-S8: another partner, an employer, staff, a candidate and anonymous do not read the outcome'
);
select pg_temp.outcome(:'ow2', :'a10') as ignored \gset
select ok(current_setting('t.result') !~ (:'ts' || '|example'), 'the outcome never names the staff member');

update public.organizations set submitted_at = now() - interval '1 minute' where id = :'a9';
-- The resubmission (V09) returns the partner to the end of the queue, and the decision history keeps the request.
insert into public.organization_geographies (organization_id, scope, country_code)
values (:'a10', 'sources_from', 'PH'), (:'a10', 'serves_market', 'DE');
insert into public.organization_occupations (organization_id, occupation_id) values (:'a10', '7212');
update public.organizations set recruitment_type = 'international' where id = :'a10';
insert into public.consents (user_id, purpose, version, action)
values (:'ow2', 'employer-pays-commitment', private.current_legal_version('employer-pays-commitment'), 'granted');
select is(
  pg_temp.call_as(:'ow2', 'authenticated', format('select public.submit_partner_for_review(%L)', :'a10')),
  'ok', 'AC7: the owner resubmits after the request for information'
);
select is(
  (select concat_ws('|', review_status, (submitted_at = now())::text, coalesce(info_step, '-')) from public.organizations where id = :'a10'),
  'pending_review|true|-', 'AC7: review_status pending_review, submitted_at the new time, the step answered'
);
select is(
  pg_temp.val_as(:'ts', 'aal2', format($q$select (array_agg(id::text order by submitted_at desc, id desc))[1]
    from public.admin_list_partner_reviews(100)$q$)),
  :'a10', 'AC7: the resubmitted partner is at the end of the queue'
);
select pg_temp.review(:'rev', :'a10') as ignored \gset
select is(
  (select jsonb_array_length(r -> 'decisions') || ':' || (r -> 'decisions' -> 0 ->> 'decision') || ':' || (r -> 'decisions' -> 0 ->> 'decided_by_email')
   from (select current_setting('t.result')::jsonb r) x),
  '1:request_info:' || :'ts' || '@example.test', 'the review page lists the decisions so far, with the staff member for staff'
);

-- NFR-S8: nobody reads or changes the decisions directly ---------------------------------------------------------------
select is(
  (select string_agg(pg_temp.call_as(u, case when u is null then 'anon' else 'authenticated' end,
     'select count(*) from public.partner_review_decisions'), ',')
   from unnest(array[:'ow', :'ow2', :'own1', :'own2', :'wkr', :'ts', null]::uuid[]) u),
  rtrim(repeat('42501|permission denied for table partner_review_decisions|,', 7), ','),
  'NFR-S8: two partners, two employers, a candidate, staff and anonymous cannot select from partner_review_decisions'
);
select throws_ok(
  format('update public.partner_review_decisions set reason = %L where organization_id = %L', 'A changed reason text.', :'a9'),
  '42501', 'partner_review_decisions is append-only', 'the record is append-only: no update'
);
select throws_ok(
  format('delete from public.partner_review_decisions where organization_id = %L', :'a9'),
  '42501', 'partner_review_decisions is append-only', 'no delete'
);
select throws_ok('truncate public.partner_review_decisions', '42501', 'partner_review_decisions is append-only', 'no truncate');
select throws_ok(
  format($q$insert into public.partner_review_decisions (organization_id, decision, reason, from_status, to_status,
    submitted_at, decided_by) values (%L, 'approve', 'Registry entry matches.', 'pending_review', 'declined', now(), %L)$q$, :'stf', :'ts'),
  '23514', null, 'the state reached must be the one of the decision'
);

-- Concurrency: decisions on one partner are serialised with each other and with a resubmission ------------------------
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select is(
  (select l from extensions.dblink('holder',
    format('select pg_advisory_lock(hashtextextended(%L, 0))::text', 'partner_review_submission:' || :'stf')) as t (l text)),
  '', 'a second session holds the submission lock of a partner, as a decision or a resubmission in progress would'
);
set local lock_timeout = '300ms';
select is(split_part(pg_temp.decide(:'ts', :'stf', 'approve', 'Registry entry and website match'), '|', 1), '55P03',
  'a decision on the same partner waits for it');
reset lock_timeout;
select l from extensions.dblink('holder',
  format('select pg_advisory_unlock(hashtextextended(%L, 0))::text', 'partner_review_submission:' || :'stf')) as t (l text);
select extensions.dblink_disconnect('holder');
select is(pg_temp.decide(:'ts', :'stf', 'approve', 'Registry entry and website match') || ',' || pg_temp.decisions(:'stf'),
  'ok,1', 'once the other is over the decision goes through, once');

select * from finish();
rollback;
