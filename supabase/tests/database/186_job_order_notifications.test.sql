begin;
select plan(28);

\ir organizations_fixture.inc

-- Release 2b notification kinds (V59, FR-T1 AC4, AC6 and AC11 for the 2b kinds; NFR-A3, NFR-S8): every 2b kind names its
-- release switch, the preferences catalogue and set_notification_preferences offer it only while that release is on, a
-- recipient with every optional 2b kind off keeps the in-app item without the email, and a kind's dedupe key holds a
-- second run to one row. The producers, payloads and recipients of each kind are tested by their units (157, 165, 166,
-- 169, 170, 173, 174, 175).

create function pg_temp.new_org(p_owner uuid, p_type public.organization_type) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, legal_entity_identifier,
    legal_entity_identifier_kind)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8) || ' Inc.', 'Org ' || left(v_id::text, 8),
    'PH', 'ID' || upper(left(replace(v_id::text, '-', ''), 10)), 'registration_number');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

-- The 2b kinds the user is offered, as kind or kind! for a mandatory one, comma separated.
create function pg_temp.offered(p_user uuid) returns text
language sql as $$
  select coalesce(string_agg(c.kind || case when c.mandatory then '!' else '' end, ',' order by c.kind), '')
  from jsonb_to_recordset(pg_temp.val_as(p_user, 'aal1',
    $q$select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'mandatory', mandatory)), '[]')::text from public.notification_kind_catalogue()$q$)::jsonb)
    as c (kind text, mandatory boolean)
  join private.notification_kinds k on k.kind = c.kind
  where k.release_key in ('release_job_orders', 'release_candidate_submissions')
$$;

create function pg_temp.prefs_as(p_user uuid, p_kinds text) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.set_notification_preferences(%L::jsonb)', p_kinds), 'aal1')
$$;

create function pg_temp.release(p_key text, p_on boolean) returns void
language sql as $$ update private.settings set value = to_jsonb(p_on) where key = p_key $$;

\set rp1 '00000000-0000-0000-0000-000000186001'
\set sp2 '00000000-0000-0000-0000-000000186002'
\set em1 '00000000-0000-0000-0000-000000186003'
\set em2 '00000000-0000-0000-0000-000000186004'
\set wk1 '00000000-0000-0000-0000-000000186005'
\set wk2 '00000000-0000-0000-0000-000000186006'

select pg_temp.new_user(id) from unnest(array[:'rp1', :'sp2', :'em1', :'em2']::uuid[]) id;
select pg_temp.new_user(id, 'worker') from unnest(array[:'wk1', :'wk2']::uuid[]) id;
update public.profiles set account_kind = intended_account_kind where id in (:'rp1', :'sp2', :'em1', :'em2', :'wk1', :'wk2');
select pg_temp.new_org(:'rp1', 'recruitment_company') as alpha \gset
select pg_temp.new_org(:'sp2', 'staffing_company') as beta \gset
select pg_temp.new_org(:'em1', 'employer') as acme \gset
select pg_temp.new_org(:'em2', 'employer') as zeta \gset

update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.release('release_job_orders', false);
select pg_temp.release('release_candidate_submissions', false);

-- Catalogue ------------------------------------------------------------------------------------------------------------
select set_eq(
  $$select kind from private.notification_kinds where release_key = 'release_job_orders'$$,
  $$values ('requirement_closing_soon'), ('job_order_match'), ('invitation_received'), ('invitation_withdrawn'),
    ('requirement_changed'), ('requirement_closed'), ('response_received'), ('response_withdrawn'), ('response_decided')$$,
  'catalogue: the requirement, job order, invitation and response kinds belong to release_job_orders'
);
select set_eq(
  $$select kind from private.notification_kinds where release_key = 'release_candidate_submissions'$$,
  $$values ('submission_request'), ('submission_request_signup'), ('submission_approved'), ('submission_withdrawn'),
    ('submission_stage_changed')$$,
  'catalogue: the submission kinds belong to release_candidate_submissions'
);
select is(
  (select string_agg(concat_ws(':', kind, mandatory, default_email), ',' order by kind) from private.notification_kinds
   where release_key in ('release_job_orders', 'release_candidate_submissions') and (mandatory or not default_email)),
  'job_order_match:f:f,submission_request:t:t,submission_request_signup:t:t',
  'catalogue: of the 2b kinds only the submission requests are mandatory and only job_order_match is off by default (DATA_MODEL.md section 9)'
);
select is(
  (select string_agg(kind || '=' || coalesce(release_key, '-'), ',' order by kind) from private.notification_kinds where kind in (
    'partner_approved', 'licence_expiring', 'listing_confirmation_due', 'followed_company_activity', 'moderation_decision',
    'data_export_ready', 'application_received', 'status_changed')),
  'application_received=-,data_export_ready=release_data_export,followed_company_activity=-,licence_expiring=-,'
  || 'listing_confirmation_due=-,moderation_decision=-,partner_approved=-,status_changed=-',
  'catalogue: the Phase 1 and 2a kinds name no release of their own, except data_export_ready, which waits for release_data_export'
);
select is(
  (select label from private.notification_kinds where kind = 'followed_company_activity'), 'New openings from companies you follow',
  'catalogue: the follower digest label covers the vacancies and the job orders it names'
);
select throws_ok(
  $$update private.notification_kinds set release_key = 'release_nothing' where kind = 'job_order_match'$$, '23503', null,
  'catalogue: a release key is a key of private.settings'
);
select throws_ok(
  $$update private.notification_kinds set release_key = 'job_order_match_daily_max' where kind = 'job_order_match'$$, '23514', null,
  'catalogue: and a release switch, not any setting'
);

-- AC11: the preferences page offers nothing of release 2b while it is off -----------------------------------------------
select is(
  concat_ws(';', pg_temp.offered(:'rp1'), pg_temp.offered(:'sp2'), pg_temp.offered(:'em1'), pg_temp.offered(:'em2'),
    pg_temp.offered(:'wk1'), pg_temp.offered(:'wk2')),
  ';;;;;', 'release 2b off: no partner, employer or worker is offered a 2b kind, not even a mandatory one under Always sent'
);
select is(
  pg_temp.prefs_as(:'rp1', '{"invitation_received": false}') || ';' || pg_temp.prefs_as(:'em1', '{"response_received": false}')
    || ';' || pg_temp.prefs_as(:'sp2', '{"licence_expiring": false, "job_order_match": true}'),
  'P0001|CHARA_INVALID_INPUT|p_kinds;P0001|CHARA_INVALID_INPUT|p_kinds;P0001|CHARA_INVALID_INPUT|p_kinds',
  'release 2b off: set_notification_preferences refuses a 2b kind like a kind of another audience, the whole call'
);
select is(
  (select count(*) from public.notification_preferences where user_id in (:'rp1', :'sp2', :'em1') and email_kinds <> '{}'),
  0::bigint, 'release 2b off: the refused calls stored nothing'
);
select is(
  (select count(*) from audit.log where action = 'notification_preferences.changed' and actor_id in (:'rp1', :'sp2', :'em1')),
  0::bigint, 'release 2b off: and audited nothing'
);
select is(
  pg_temp.prefs_as(:'sp2', '{"licence_expiring": false}'), 'ok', 'release 2b off: the 2a kinds are still chosen'
);

-- Job orders on, submissions off --------------------------------------------------------------------------------------
select pg_temp.release('release_job_orders', true);
select is(
  pg_temp.offered(:'rp1') || ';' || pg_temp.offered(:'sp2'),
  'invitation_received,invitation_withdrawn,job_order_match,requirement_changed,requirement_closed,requirement_closing_soon,response_decided;'
  || 'invitation_received,invitation_withdrawn,job_order_match,requirement_changed,requirement_closed,requirement_closing_soon,response_decided',
  'job orders on: a recruitment and a staffing company are offered the job order kinds of partners, no submission kind'
);
select is(
  pg_temp.offered(:'em1') || ';' || pg_temp.offered(:'em2'),
  'requirement_closing_soon,response_received,response_withdrawn;requirement_closing_soon,response_received,response_withdrawn',
  'job orders on: an employer is offered the closing reminder and the response kinds, none of the partners'' kinds'
);
select is(
  pg_temp.offered(:'wk1') || ';' || pg_temp.offered(:'wk2'), ';', 'job orders on: a worker is offered no 2b kind while submissions are off'
);
select is(
  pg_temp.prefs_as(:'rp1', '{"invitation_received": false, "job_order_match": true}') || ';'
    || pg_temp.prefs_as(:'em1', '{"response_received": false}') || ';'
    || pg_temp.prefs_as(:'rp1', '{"submission_approved": false}') || ';'
    || pg_temp.prefs_as(:'em1', '{"invitation_received": false}'),
  'ok;ok;P0001|CHARA_INVALID_INPUT|p_kinds;P0001|CHARA_INVALID_INPUT|p_kinds',
  'job orders on: the released kinds of the caller are chosen; a submission kind and a partner kind of an employer are refused'
);
select is(
  pg_temp.val_as(:'rp1', 'aal1', $q$select string_agg(kind || '=' || email_enabled, ',' order by kind) from public.notification_kind_catalogue()
    where kind in ('invitation_received', 'job_order_match', 'response_decided')$q$),
  'invitation_received=false,job_order_match=true,response_decided=true',
  'job orders on: the catalogue shows the saved choices and the defaults'
);

-- Submissions on ------------------------------------------------------------------------------------------------------
select pg_temp.release('release_candidate_submissions', true);
select is(
  concat_ws(';', pg_temp.offered(:'wk1'), pg_temp.offered(:'em1'), pg_temp.offered(:'sp2')),
  'submission_request!,submission_request_signup!;'
  || 'requirement_closing_soon,response_received,response_withdrawn,submission_approved,submission_withdrawn;'
  || 'invitation_received,invitation_withdrawn,job_order_match,requirement_changed,requirement_closed,requirement_closing_soon,response_decided,submission_approved,submission_stage_changed,submission_withdrawn',
  'submissions on: the worker sees the submission requests as always sent, the employer and the partner their submission kinds'
);
select is(
  pg_temp.prefs_as(:'wk1', '{"submission_request": false}') || ';' || pg_temp.prefs_as(:'sp2', '{"submission_stage_changed": false}'),
  'P0001|CHARA_INVALID_INPUT|mandatory_kind;ok',
  'submissions on: a mandatory submission request cannot be turned off (AC4); an optional submission kind can'
);

-- A choice survives the release going off and back on.
select pg_temp.release('release_job_orders', false);
select is(
  (select email_kinds -> 'invitation_received' from public.notification_preferences where user_id = :'rp1')::text
    || ',' || pg_temp.val_as(:'rp1', 'aal1', $q$select count(*)::text from public.notification_kind_catalogue() where kind = 'invitation_received'$q$),
  'false,0', 'release off again: the stored choice stays and the kind is no longer offered'
);
select pg_temp.release('release_job_orders', true);
select is(
  pg_temp.val_as(:'rp1', 'aal1', $q$select email_enabled::text from public.notification_kind_catalogue() where kind = 'invitation_received'$q$),
  'false', 'release on again: the stored choice applies'
);

-- AC4 for the 2b kinds: every optional 2b kind off keeps the in-app row without the email; the mandatory one is sent. ---
select pg_temp.prefs_as(:'sp2', (select jsonb_object_agg(kind, false)::text from private.notification_kinds
  where release_key is not null and not mandatory and organization_types @> array['staffing_company']::public.organization_type[]))
  as prefs_off \gset
select is(:'prefs_off'::text, 'ok', 'AC4: the staffing company owner turns off every optional 2b kind offered');
select pgmq.send('notifications', jsonb_build_object('kind', k.kind, 'user_id', :'sp2', 'dedupe_key', k.kind || ':v59'))
from private.notification_kinds k
where k.release_key is not null and not k.mandatory and k.organization_types @> array['staffing_company']::public.organization_type[];
select pgmq.send('notifications', jsonb_build_object('kind', 'submission_request', 'user_id', :'wk1', 'dedupe_key', 'submission_request:v59'));
select is(
  (select string_agg(distinct n.status || ':' || coalesce(n.email_status, '-') || ':' || n.mandatory, ',') from public.notifications n
   where n.user_id = :'sp2' and n.dedupe_key like '%:v59')
    || ';' || (select count(*) from public.notifications n where n.user_id = :'sp2' and n.dedupe_key like '%:v59')
    || ';' || (select count(*) from pgmq.q_notifications q where q.message ->> 'user_id' = :'sp2' and q.message ->> 'dedupe_key' like '%:v59'),
  'suppressed:suppressed_by_preference:false;10;0',
  'AC4: each of the ten optional 2b kinds keeps its in-app row, suppressed by preference, and sends no email'
);
select is(
  (select n.status || ':' || coalesce(n.email_status, '-') || ':' || n.mandatory from public.notifications n
   where n.user_id = :'wk1' and n.kind = 'submission_request')
    || ';' || (select count(*) from pgmq.q_notifications q where q.message ->> 'user_id' = :'wk1' and q.message ->> 'kind' = 'submission_request'),
  'queued:-:true;1', 'AC4: the mandatory submission request is queued with its message'
);

-- AC6: a second run of a job the same day queues nothing (the dedupe key of the kind). ---------------------------------
select pgmq.send('notifications', jsonb_build_object('kind', 'requirement_closing_soon', 'user_id', :'em1', 'dedupe_key', 'requirement_closing_soon:v59'))
from generate_series(1, 2);
select is(
  (select count(*) from public.notifications where user_id = :'em1' and kind = 'requirement_closing_soon')
    || ',' || (select count(*) from pgmq.q_notifications q where q.message ->> 'user_id' = :'em1' and q.message ->> 'kind' = 'requirement_closing_soon'),
  '1,1', 'AC6: the same key twice is one row and one message'
);

-- data_export_ready: listed under Always sent only while release_data_export is on.
select pg_temp.release('release_data_export', false);
select is(
  pg_temp.val_as(:'wk1', 'aal1', $q$select count(*)::text from public.notification_kind_catalogue() where kind = 'data_export_ready'$q$),
  '0', 'release_data_export off: the data export notice is not listed'
);
select pg_temp.release('release_data_export', true);
select is(
  pg_temp.val_as(:'wk1', 'aal1', $q$select kind || ':' || mandatory from public.notification_kind_catalogue() where kind = 'data_export_ready'$q$),
  'data_export_ready:true', 'release_data_export on: the data export notice is listed as always sent'
);

-- Anonymous ------------------------------------------------------------------------------------------------------------
select is(
  pg_temp.call_as(null, 'anon', 'select public.notification_kind_catalogue()') || ';'
    || pg_temp.call_as(null, 'anon', $$select public.set_notification_preferences('{"invitation_received": true}'::jsonb)$$),
  '42501|permission denied for function notification_kind_catalogue|;42501|permission denied for function set_notification_preferences|',
  'anonymous: neither function may be called'
);

select * from finish();
rollback;
