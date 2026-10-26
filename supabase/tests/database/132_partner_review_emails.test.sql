begin;
select plan(51);

\ir organizations_fixture.inc

-- Partner review, licence and listing-confirmation notifications (V14, FR-T1 AC1, AC2, AC4, AC6 for these kinds; FR-J4 AC6;
-- FR-J2 AC8; FR-K3 AC5; NFR-A3): the six kinds in the catalogue, their payloads, admin_decide_partner, the licence expiry
-- job and the confirmation reminder job, each queuing through private.queue_org_event in its own transaction.

create function pg_temp.new_partner(p_id uuid, p_type text default 'recruitment_company') returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

create function pg_temp.new_org(p_owner uuid, p_status text default 'pending_review') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, legal_entity_identifier,
    legal_entity_identifier_kind)
  values (v_id, 'recruitment_company', 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8) || ' Inc.',
    'Org ' || left(v_id::text, 8), 'PH', 'ID' || upper(left(replace(v_id::text, '-', ''), 10)), 'registration_number');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations
  set review_status = p_status::public.partner_review_status, submitted_at = now() - interval '1 day',
      listed_at = case when p_status in ('listed', 're_review') then now() - interval '1 day' end
  where id = v_id;
  return v_id;
end;
$$;

create function pg_temp.add_member(p_org uuid, p_user uuid, p_role public.member_role) returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

create function pg_temp.decide(p_user uuid, p_org uuid, p_decision text, p_reason text, p_step text default null) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format('select public.admin_decide_partner(%L, %L, %L, %L)', p_org, p_decision, p_reason, p_step))
$$;

-- The rows of a kind per recipient, as user:status:mandatory, ordered by the users given.
create function pg_temp.rows(p_kind text, p_users uuid[]) returns text
language sql as $$
  select coalesce(string_agg(u.ord || ':' || n.status || ':' || n.mandatory, ',' order by u.ord), '')
  from unnest(p_users) with ordinality u (id, ord)
  join public.notifications n on n.user_id = u.id and n.kind = p_kind
$$;

create function pg_temp.messages(p_kind text, p_users uuid[]) returns integer
language sql as $$
  select count(*)::integer from pgmq.q_notifications q
  where q.message ->> 'kind' = p_kind and (q.message ->> 'user_id')::uuid = any (p_users)
$$;

create function pg_temp.payload(p_kind text, p_user uuid) returns jsonb
language sql as $$
  select n.payload from public.notifications n where n.kind = p_kind and n.user_id = p_user order by n.created_at desc, n.id desc limit 1
$$;

create function pg_temp.keys(p_payload jsonb) returns text
language sql as $$ select string_agg(k, ',' order by k) from jsonb_object_keys(p_payload) k $$;

create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'utc')::date $$;

\set ts '00000000-0000-0000-0000-0000000f3001'
\set ow '00000000-0000-0000-0000-0000000f3002'
\set ad '00000000-0000-0000-0000-0000000f3003'
\set mb '00000000-0000-0000-0000-0000000f3004'
\set inv '00000000-0000-0000-0000-0000000f3005'
\set owb '00000000-0000-0000-0000-0000000f3006'
\set owc '00000000-0000-0000-0000-0000000f3007'
\set owd '00000000-0000-0000-0000-0000000f3008'
\set ows '00000000-0000-0000-0000-0000000f3009'

update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(id) from unnest(array[:'ow', :'ad', :'mb', :'inv', :'owb', :'owc', :'owd', :'ows']::uuid[]) id;
select pg_temp.new_user(:'ts', 'company', 'reviewer.name@staff.test');
insert into public.platform_staff (user_id, role) values (:'ts', 'trust_safety');

-- Alpha: owner, admin, member and a pending invitation; Beta, Gamma, Delta: one owner each; Sigma: suspended.
select pg_temp.new_org(:'ow') as alpha \gset
select pg_temp.add_member(:'alpha', :'ad', 'admin');
select pg_temp.add_member(:'alpha', :'mb', 'member');
insert into public.organization_invitations (organization_id, email, role, token_hash)
values (:'alpha', :'inv' || '@partner.test', 'admin', repeat('b', 64));
select pg_temp.new_org(:'owb') as beta \gset
select pg_temp.new_org(:'owc') as gamma \gset
select pg_temp.new_org(:'owd') as delta \gset
select pg_temp.new_org(:'ows') as sigma \gset
update public.organizations set status = 'suspended' where id = :'sigma';

-- Catalogue ------------------------------------------------------------------------------------------------------------
select is(
  (select string_agg(concat_ws(':', kind, mandatory, default_email, audience), ',' order by kind) from private.notification_kinds
   where kind in ('partner_approved', 'partner_info_requested', 'partner_declined', 'licence_expiring', 'partner_licence_expired',
     'listing_confirmation_due')),
  'licence_expiring:f:t:company,listing_confirmation_due:f:t:company,partner_approved:t:t:company,'
  || 'partner_declined:t:t:company,partner_info_requested:t:t:company,partner_licence_expired:f:t:company',
  'DATA_MODEL section 9: the review kinds are mandatory, the licence and listing kinds optional with email on, all for companies'
);
select ok(
  (select pg_get_constraintdef(c.oid) like '%listing_confirmation_due%' and convalidated from pg_constraint c
   where c.conname = 'notifications_kind_check' and c.conrelid = 'public.notifications'::regclass),
  'the kind check accepts the new kinds and is validated'
);
select is((select value #>> '{}' from private.settings where key = 'licence_expiry_reminder_days'), '30',
  'the licence reminder lead time is the setting licence_expiry_reminder_days, 30');
select is(
  pg_temp.call_as(:'owb', 'authenticated', $$select public.set_notification_preferences('{"partner_declined": false}'::jsonb)$$),
  'P0001|CHARA_INVALID_INPUT|mandatory_kind', 'AC4: a mandatory review kind cannot be turned off'
);
select is(
  pg_temp.call_as(:'owb', 'authenticated', $$select public.set_notification_preferences('{"licence_expiring": false}'::jsonb)$$),
  'ok', 'AC4: an optional licence kind can be turned off by a company user'
);
update public.notification_preferences set email_kinds = '{"licence_expiring": true}' where user_id = :'owb';

-- FR-J4 AC6: the decisions --------------------------------------------------------------------------------------------
select is(pg_temp.decide(:'ts', :'alpha', 'approve', 'Registry entry and website match'), 'ok', 'staff approve Alpha');
select is(pg_temp.rows('partner_approved', array[:'ow', :'ad', :'mb', :'inv', :'owb']::uuid[]), '1:queued:true,2:queued:true',
  'AC1: partner_approved is queued, mandatory, for the owner and the admin; not the member, the invitee or another partner');
select is(pg_temp.messages('partner_approved', array[:'ow', :'ad', :'mb', :'inv']::uuid[]), 2, 'AC1: with one pgmq message each');
select is(pg_temp.keys(pg_temp.payload('partner_approved', :'ow')), 'decided_at,decision_id,org_name,org_slug',
  'AC2: the approval payload holds the decision id, the display name, the slug and the date; no reason');
select is(
  pg_temp.payload('partner_approved', :'ow') ->> 'decision_id',
  (select id::text from public.partner_review_decisions where organization_id = :'alpha'),
  'AC2: the payload names the decision row'
);
select ok(
  (select bool_and(n.payload::text not like '%' || :'ts' || '%' and n.payload::text not like '%reviewer.name%'
     and n.payload::text not ilike '%@%')
   from public.notifications n where n.kind = 'partner_approved'),
  'FR-J4 AC6: no payload holds the staff member, by id or by email, nor any address'
);

update public.notification_preferences set email_kinds = '{"partner_info_requested": false}' where user_id = :'owb';
insert into public.notification_preferences (user_id, email_kinds) values (:'owc', '{"partner_declined": false}')
on conflict (user_id) do update set email_kinds = excluded.email_kinds;
select is(pg_temp.decide(:'ts', :'beta', 'request_info', 'Please add the registration number of the company.', 'company'), 'ok',
  'staff ask Beta for information');
select is(pg_temp.decide(:'ts', :'gamma', 'decline', 'The website does not belong to the company named.'), 'ok', 'staff decline Gamma');
select is(
  pg_temp.rows('partner_info_requested', array[:'owb']::uuid[]) || ';' || pg_temp.rows('partner_declined', array[:'owc']::uuid[])
    || ';' || pg_temp.messages('partner_info_requested', array[:'owb']::uuid[]) || pg_temp.messages('partner_declined', array[:'owc']::uuid[]),
  '1:queued:true;1:queued:true;11',
  'AC4: the information request and the decline are queued and emailed although the stored choices say off'
);
select is(
  pg_temp.keys(pg_temp.payload('partner_info_requested', :'owb')) || '|' || (pg_temp.payload('partner_info_requested', :'owb') ->> 'reason')
    || '|' || (pg_temp.payload('partner_info_requested', :'owb') ->> 'info_step'),
  'decided_at,decision_id,info_step,org_name,org_slug,reason|Please add the registration number of the company.|company',
  'FR-J4 AC6: the information request carries the staff message and the step to reopen'
);
select is(
  pg_temp.keys(pg_temp.payload('partner_declined', :'owc')) || '|' || (pg_temp.payload('partner_declined', :'owc') ->> 'reason'),
  'decided_at,decision_id,org_name,org_slug,reason|The website does not belong to the company named.',
  'FR-J4 AC6: the decline carries the reason'
);
select is((select count(*)::integer from public.notifications where user_id = :'owb' and kind in ('partner_approved', 'partner_declined')),
  0, 'one kind per decision: Beta gets no approval or decline');

-- NFR-A3: a rolled-back decision queues nothing; a refused one neither.
savepoint before_delta;
select is(pg_temp.decide(:'ts', :'delta', 'approve', 'Registry entry and website match'), 'ok', 'Delta is approved in a savepoint');
select is(pg_temp.messages('partner_approved', array[:'owd']::uuid[]), 1, 'NFR-A3: the message is queued in the transaction');
rollback to savepoint before_delta;
select is(
  (select count(*)::integer from public.notifications where user_id = :'owd') || ',' || pg_temp.messages('partner_approved', array[:'owd']::uuid[])
    || ',' || (select review_status::text from public.organizations where id = :'delta'),
  '0,0,pending_review', 'NFR-A3: rolled back, the decision leaves no notification row, no message and no state change'
);
select is(pg_temp.decide(:'ts', :'alpha', 'decline', 'A second decision is not allowed now.'), 'P0001|CHARA_INVALID_TRANSITION|listed',
  'a decision on a listed partner is refused');
select is((select count(*)::integer from public.notifications where user_id = :'ow' and kind = 'partner_declined'), 0,
  'NFR-A3: and queues nothing');
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(pg_temp.decide(:'ts', :'delta', 'approve', 'Registry entry and website match'), 'P0001|CHARA_FORBIDDEN|release_off',
  'release switch: while release 2a is off no decision is taken');
update private.settings set value = 'true' where key = 'release_partner_directories';
select is((select count(*)::integer from public.notifications where user_id = :'owd'), 0, 'release switch: and nothing is queued');

-- Re-review: each decision row is its own event; the same row is queued once.
update public.organizations set review_status = 're_review', submitted_at = now() where id = :'beta';
select is(pg_temp.decide(:'ts', :'beta', 'approve', 'The registration number now matches the registry.'), 'ok',
  'Beta is approved after the re-review');
select is(pg_temp.rows('partner_approved', array[:'owb']::uuid[]), '1:queued:true', 'a later decision row queues its own kind');
select is(
  private.queue_org_event(:'beta', 'partner_approved',
    jsonb_build_object('decision_id', (select max(id) from public.partner_review_decisions where organization_id = :'beta')),
    'partner_review_decision:' || (select max(id) from public.partner_review_decisions where organization_id = :'beta')),
  0, 'dedupe: the same decision row queues nothing a second time'
);
select is(pg_temp.decide(:'ts', :'sigma', 'approve', 'Registry entry and website match'), 'ok', 'a suspended partner may be decided on');
select is((select count(*)::integer from public.notifications where user_id = :'ows'), 0, 'and its owner is not notified');

-- FR-J2 AC8: licence expiry ---------------------------------------------------------------------------------------------
\set lo '00000000-0000-0000-0000-0000000f3010'
\set la '00000000-0000-0000-0000-0000000f3011'
\set lm '00000000-0000-0000-0000-0000000f3012'
select pg_temp.new_partner(id) from unnest(array[:'lo', :'la', :'lm']::uuid[]) id;
select pg_temp.new_org(:'lo', 'listed') as lic_org \gset
select pg_temp.add_member(:'lic_org', :'la', 'admin');
select pg_temp.add_member(:'lic_org', :'lm', 'member');
insert into public.notification_preferences (user_id, email_kinds) values (:'la', '{"partner_licence_expired": false}')
on conflict (user_id) do update set email_kinds = excluded.email_kinds;
insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until, confirmed_at, partner_terms_version)
values (:'lic_org', 'DE', 'Agency', 'E-30', pg_temp.today() + 30, now(), 1),
       (:'lic_org', 'DE', 'Agency', 'E-31', pg_temp.today() + 31, now(), 1),
       (:'lic_org', 'DE', 'Agency', 'E-YESTERDAY', pg_temp.today() - 1, now(), 1),
       (:'sigma', 'DE', 'Agency', 'S-10', pg_temp.today() + 10, now(), 1),
       (:'sigma', 'DE', 'Agency', 'S-YESTERDAY', pg_temp.today() - 1, now(), 1);
select id as e30 from public.partner_licences where licence_number = 'E-30' \gset
select id as e31 from public.partner_licences where licence_number = 'E-31' \gset
select id as ey from public.partner_licences where licence_number = 'E-YESTERDAY' \gset

savepoint before_expiry;
select is(private.expire_partner_licences(), 2, 'NFR-A3: the job runs in a savepoint');
rollback to savepoint before_expiry;
select is(
  (select count(*)::integer from public.notifications where user_id in (:'lo', :'la')) || ','
    || (select count(*)::integer from public.partner_licences where expiry_notified_on is not null or status = 'expired'),
  '0,0', 'NFR-A3: rolled back, the job leaves no notification and no stamp'
);

select is(private.expire_partner_licences(), 2, 'AC8: the job marks the two entries valid until yesterday expired');
select is(
  pg_temp.rows('licence_expiring', array[:'lo', :'la', :'lm']::uuid[]) || ';'
    || pg_temp.messages('licence_expiring', array[:'lo', :'la', :'lm']::uuid[]),
  '1:queued:false,2:queued:false;2',
  'AC8: licence_expiring is queued for the owner and the admin of the entry valid until today + 30, not the member'
);
select is(
  (select string_agg(pg_temp.payload('licence_expiring', :'lo') ->> 'licence_id', ',')),
  :'e30'::text, 'AC8: the reminder names the entry valid until today + 30 only, not the one valid until today + 31'
);
select is(
  pg_temp.rows('partner_licence_expired', array[:'lo', :'la', :'lm']::uuid[]) || ';'
    || (select email_status from public.notifications where user_id = :'la' and kind = 'partner_licence_expired') || ';'
    || pg_temp.messages('partner_licence_expired', array[:'lo', :'la']::uuid[]),
  '1:queued:false,2:suppressed:false;suppressed_by_preference;1',
  'AC8: partner_licence_expired goes to the owner, and to the admin in the app only because they turned its email off'
);
select is(
  pg_temp.keys(pg_temp.payload('licence_expiring', :'lo')) || '|' || (pg_temp.payload('licence_expiring', :'lo') ->> 'country_name')
    || '|' || (pg_temp.payload('licence_expiring', :'lo') ->> 'valid_until'),
  'country_code,country_name,licence_id,org_name,org_slug,valid_until|Germany|' || (pg_temp.today() + 30)::text,
  'AC2: the licence payload holds ids, the country, the date and the organisation; never the licence number'
);
select is(
  (select string_agg(licence_number || ':' || coalesce((expiry_notified_on = pg_temp.today())::text, 'null'), ',' order by licence_number)
   from public.partner_licences where organization_id in (:'lic_org', :'sigma')),
  'E-30:true,E-31:null,E-YESTERDAY:true,S-10:null,S-YESTERDAY:true',
  'AC8: expiry_notified_on is written for the reminded and the expired entries; a suspended partner is not reminded (its expiry is stamped as handled)'
);
select is((select count(*)::integer from public.notifications where user_id = :'ows'), 0,
  'a suspended partner gets no licence notice');
select is(private.expire_partner_licences(), 0, 'AC8: a second run on the same day marks nothing');
select is(
  (select count(*)::integer from public.notifications where kind in ('licence_expiring', 'partner_licence_expired'))
    || ',' || pg_temp.messages('licence_expiring', array[:'lo', :'la']::uuid[]),
  '4,2', 'AC8: and queues nothing new'
);
update public.partner_licences set valid_until = pg_temp.today() + 20, expiry_notified_on = null where id = :'e30';
select private.expire_partner_licences();
select is((select count(*)::integer from public.notifications where user_id = :'lo' and kind = 'licence_expiring'), 2,
  'a new valid-until date (which clears the stamp) is reminded again');
update private.settings set value = 'false' where key = 'release_partner_directories';
update public.partner_licences set valid_until = pg_temp.today() - 1 where id = :'e31';
select is(private.expire_partner_licences(), 1, 'release switch: while release 2a is off the job still marks expiry');
select is(
  (select count(*)::integer from public.notifications where user_id = :'lo') || ','
    || (select coalesce(expiry_notified_on::text, 'null') from public.partner_licences where id = :'e31'),
  '3,null', 'release switch: but queues and stamps nothing'
);
update private.settings set value = 'true' where key = 'release_partner_directories';

-- FR-K3 AC5: confirmation reminders ------------------------------------------------------------------------------------
\set wo '00000000-0000-0000-0000-0000000f3020'
\set wa '00000000-0000-0000-0000-0000000f3021'
\set wm '00000000-0000-0000-0000-0000000f3022'
select pg_temp.new_partner(id) from unnest(array[:'wo', :'wa', :'wm']::uuid[]) id;
select pg_temp.new_org(:'wo', 'listed') as w_org \gset
select pg_temp.add_member(:'w_org', :'wa', 'admin');
select pg_temp.add_member(:'w_org', :'wm', 'member');
insert into public.organization_occupations (organization_id, occupation_id)
select o, c from unnest(array[:'w_org', :'sigma']::uuid[]) o, unnest(array['7212', '7213', '7215']) c;
insert into public.organization_geographies (organization_id, scope, country_code)
select o, 'sources_from', 'PH' from unnest(array[:'w_org', :'sigma']::uuid[]) o;
insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
  available_from, confirmed_at)
values (:'w_org', '7212', 'PH', 10, 5, pg_temp.today(), now() - interval '29 days'),
       (:'w_org', '7213', 'PH', 10, 5, pg_temp.today(), now() - interval '30 days'),
       (:'w_org', '7215', 'PH', 10, 5, pg_temp.today(), now() - interval '45 days'),
       (:'sigma', '7212', 'PH', 10, 5, pg_temp.today(), now() - interval '45 days');
select id as l30 from public.workforce_availability where organization_id = :'w_org' and occupation_id = '7213' \gset
select id as l45 from public.workforce_availability where organization_id = :'w_org' and occupation_id = '7215' \gset

savepoint before_reminder;
select is(private.mark_workforce_confirmations_due(), 2, 'NFR-A3: the job runs in a savepoint');
rollback to savepoint before_reminder;
select is(
  (select count(*)::integer from public.notifications where user_id in (:'wo', :'wa')) || ','
    || (select count(*)::integer from public.workforce_availability where reminded_at is not null),
  '0,0', 'NFR-A3: rolled back, the job leaves no notification and no stamp'
);

select is(private.mark_workforce_confirmations_due(), 2, 'AC5: the job finds the 30- and 45-day listings of the active partner');
select is(
  pg_temp.rows('listing_confirmation_due', array[:'wo', :'wa', :'wm', :'ows']::uuid[]) || ';'
    || pg_temp.messages('listing_confirmation_due', array[:'wo', :'wa', :'wm', :'ows']::uuid[]),
  '1:queued:false,2:queued:false;2',
  'AC5: one listing_confirmation_due per organisation for the owner and the admin; not the member, not a suspended partner'
);
select is(
  (select string_agg(l ->> 'listing_id', ',' order by o) from jsonb_array_elements(pg_temp.payload('listing_confirmation_due', :'wo') -> 'listings')
     with ordinality e (l, o))
    || '|' || (pg_temp.payload('listing_confirmation_due', :'wo') ->> 'total'),
  :'l45' || ',' || :'l30' || '|2',
  'AC5: it names the 45- and 30-day listings, confirmed longest ago first; the 29-day listing is not included'
);
select is(
  pg_temp.keys(pg_temp.payload('listing_confirmation_due', :'wo')) || '|'
    || (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.payload('listing_confirmation_due', :'wo') -> 'listings' -> 0) k),
  'listings,org_name,org_slug,stale_days,total|confirmed_at,country_name,listing_id,occupation',
  'AC2: the payload holds ids, occupation and country names, dates and the organisation'
);
select is(private.mark_workforce_confirmations_due(), 0, 'AC5: the second run on the same day finds nothing');
update public.workforce_availability set reminded_at = null where organization_id = :'w_org';
select is(
  private.mark_workforce_confirmations_due() || ',' || (select count(*) from public.notifications where kind = 'listing_confirmation_due'),
  '2,2', 'dedupe: listings found due again the same day queue no second reminder for the day'
);

select * from finish();
rollback;
