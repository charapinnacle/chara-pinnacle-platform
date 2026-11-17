begin;
select plan(85);

\ir apply_fixture.inc

-- Conversations and messages, data (V63, FR-P1 AC1 to AC7 and the data of AC11; SOP P2-26 steps Open, Allow, Send, Read,
-- Members, Context link; decisions 5.1, 5.2; NFR-S8, NFR-S10): public.conversations, conversation_participants, messages,
-- conversation_reads, open_conversation, send_message, mark_conversation_read, my_unread_counts, list_conversations,
-- get_conversation, list_messages. Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner own2, admin adm2)
-- are the employers of the fixture; wa (Amina Okafor) and wb (Bruno Silva) the candidates; Rekrut and Second, made below,
-- the partner companies. The calls in parallel of AC1 are in 191.

\set padm '00000000-0000-0000-0000-0000000f6311'
\set radm '00000000-0000-0000-0000-0000000f6312'
\set u2 '00000000-0000-0000-0000-0000000f6313'
\set st_admin '00000000-0000-0000-0000-0000000f6314'
\set st_ts '00000000-0000-0000-0000-0000000f6315'
\set st_vr '00000000-0000-0000-0000-0000000f6316'

-- p_sql as p_user (anonymous when null) at p_aal: the value of its single column, or 'sqlstate|message|detail'.
create function pg_temp.read_as(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text end, true);
  execute format('set local role %I', case when p_user is null then 'anon' else 'authenticated' end);
  begin
    execute p_sql into v_result;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_result := format('%s|%s|%s', v_state, v_message, coalesce(v_detail, ''));
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

create function pg_temp.open(p_user uuid, p_type text, p_id uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select public.open_conversation(%L, %L)::text', p_type, p_id), p_aal)
$$;

create function pg_temp.send(p_user uuid, p_conv uuid, p_body text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select ''ok'' from public.send_message(%L, %L)', p_conv, p_body), p_aal)
$$;

-- The rows p_user reads of the conversation p_conv: conversations, participants and messages, as 'c/p/m'.
create function pg_temp.sees(p_user uuid, p_conv uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format($f$select concat_ws('/',
    (select count(*) from public.conversations where id = %1$L),
    (select count(*) from public.conversation_participants where conversation_id = %1$L),
    (select count(*) from public.messages where conversation_id = %1$L))$f$, p_conv), p_aal)
$$;

create function pg_temp.unread(p_user uuid, p_conv uuid, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format(
    'select coalesce((select unread from public.my_unread_counts() where conversation_id = %L), 0)::text', p_conv), p_aal)
$$;

-- The fixture --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max');
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
update public.profiles set display_name = 'Mia Member' where id = :'mem';
update public.profiles set display_name = 'Ada Admin' where id = :'adm';
select pg_temp.new_user(:'padm') as seeded \gset
select pg_temp.new_user(:'radm') as seeded \gset
select pg_temp.new_user(:'u2') as seeded \gset
select pg_temp.new_user(:'st_admin') as seeded \gset
select pg_temp.new_user(:'st_ts') as seeded \gset
select pg_temp.new_user(:'st_vr') as seeded \gset
update public.profiles set account_kind = intended_account_kind
where id in (:'padm', :'radm', :'u2', :'st_admin', :'st_ts', :'st_vr');
insert into public.platform_staff (user_id, role) values
  (:'st_admin', 'admin'), (:'st_ts', 'trust_safety'), (:'st_vr', 'verification_reviewer');

create function pg_temp.partner(p_slug text, p_name text, p_owner uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'recruitment_company', p_slug, 'Legal ' || p_name || ' Ltd', p_name, 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  return v_id;
end;
$$;

select pg_temp.partner('rekrut-v63', 'Rekrut', :'padm') as rek \gset
select pg_temp.partner('second-v63', 'Second', :'u2') as sec \gset
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'rek', :'radm', 'admin', now());

-- An Acme requirement that does not show the employer's identity: Rekrut is named it by the invitation, Second is not.
insert into public.workforce_requirements (
  organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
  recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on
) values (
  :'acme', 'Acme secret welders', 10, 'DE', 'Hamburg', 'C', current_date + 60, 'full_time', 'both', 'both', 'open',
  'job_order_marketplace', false, now() - interval '10 days', current_date + 90
) returning id as r \gset
insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (:'r', '7212', 10);
insert into public.requirement_countries (requirement_id, country_code) values (:'r', 'DE');
insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, status, source, answered_at)
values (:'r', :'rek', :'acme', 'accepted', 'directory', now()) returning id as inv_rek \gset
insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, source)
values (:'r', :'sec', :'acme', 'directory') returning id as inv_sec \gset
insert into private.requirement_reveals (requirement_id, organization_id, cause) values (:'r', :'rek', 'invitation');
insert into public.partner_responses (
  requirement_id, organization_id, employer_organization_id, capacity, available_from, experience_note, fee_model
) values (:'r', :'sec', :'acme', 5, current_date + 60, 'Twenty welders placed in Hamburg last year.', 'on_request')
returning id as resp \gset

-- Submissions of Rekrut for the requirement: wb approved, wnew still asked.
insert into public.candidate_submissions (
  requirement_id, organization_id, employer_organization_id, invited_email, worker_user_id, status, decided_at,
  worker_approved_at, passport_share_id, profile_snapshot
) values (:'r', :'rek', :'acme', 'bruno@seed.test', :'wb', 'submitted', now(), now(), gen_random_uuid(),
  '{"first_name": "Bruno", "last_name": "Silva"}') returning id as sub \gset
insert into public.candidate_submissions (requirement_id, organization_id, employer_organization_id, invited_email, worker_user_id)
values (:'r', :'rek', :'acme', 'new@seed.test', :'wnew') returning id as sub_waiting \gset

-- Applications: wa and wb to Acme, wa to Beta.
select pg_temp.open_job('Welder Hamburg') as job \gset
select pg_temp.open_job('Fitter Bremen') as job2 \gset
select pg_temp.open_job('Beta welder', :'beta') as bjob \gset
select pg_temp.apply_as(:'wa', :'job') as applied \gset
select current_setting('t.app') as app \gset
select pg_temp.apply_as(:'wb', :'job2') as applied \gset
select current_setting('t.app') as app_b \gset
select pg_temp.apply_as(:'wa', :'bjob') as applied \gset
select current_setting('t.app') as app_beta \gset

-- Structure ------------------------------------------------------------------------------------------------------------------

select is(
  (select array_agg(proname::text order by proname) from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('open_conversation', 'send_message', 'mark_conversation_read', 'my_unread_counts', 'list_conversations',
       'get_conversation', 'list_messages')
     and prosecdef and proconfig @> array['search_path=""']
     and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
     and not has_function_privilege('service_role', oid, 'execute')),
  array['get_conversation', 'list_conversations', 'list_messages', 'mark_conversation_read', 'my_unread_counts',
    'open_conversation', 'send_message'],
  'the functions are security definer with an empty search path, for authenticated callers only');
select is(
  (select count(*)::integer from unnest(array['public.conversations', 'public.conversation_participants', 'public.messages',
     'public.conversation_reads']) t
   where has_table_privilege('authenticated', t, 'insert, update, delete, truncate')
      or has_any_column_privilege('authenticated', t, 'insert, update')
      or has_any_column_privilege('anon', t, 'select, insert, update')),
  0, 'FR-P1 AC3, AC4: no write grant on the four tables, and nothing for anonymous callers');
select is(
  (select string_agg(c.relname || '.' || a.attname, ',' order by c.relname, a.attname)
   from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.oid in ('public.conversations'::regclass, 'public.conversation_participants'::regclass, 'public.messages'::regclass)
     and a.attnum > 0 and not a.attisdropped
     and not has_column_privilege('authenticated', c.oid, a.attnum, 'select')),
  'conversation_participants.user_id,conversations.opened_by,messages.sender_user_id',
  'NFR-S9: the candidate''s user id, the opener and the sender''s user id are not readable through the Data API');
select is(
  (select string_agg(k.conrelid::regclass || '.' || a.attname || ':' || k.confdeltype::text, ',' order by k.conrelid::regclass::text, a.attname)
   from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
   where k.contype = 'f' and k.confrelid = 'public.profiles'::regclass
     and k.conrelid in ('public.conversations'::regclass, 'public.conversation_participants'::regclass,
       'public.messages'::regclass, 'public.conversation_reads'::regclass)),
  'conversation_reads.user_id:c,conversations.opened_by:n,messages.sender_user_id:n',
  'FR-P3 AC10: a deleted account leaves its messages with the side and no user and removes its read rows; the candidate''s participant row has no foreign key, as erase_user pseudonymises it (V74)');
select is(pg_temp.open(:'adm', 'application', :'app'), '42501|CHARA_FORBIDDEN|release_off',
  'every function refuses to run while release_messaging is off');

update private.settings set value = 'true' where key = 'release_messaging';

-- AC1: a context action opens exactly one conversation -------------------------------------------------------------------

select pg_temp.open(:'adm', 'application', :'app') as c_app \gset
select ok(:'c_app' ~ '^[0-9a-f-]{36}$', 'FR-P1 AC1: an admin of Acme opens the conversation of an application');
select is(pg_temp.open(:'adm', 'application', :'app'), :'c_app', 'FR-P1 AC1: a second call answers the same conversation');
select is(pg_temp.open(:'mem', 'application', :'app', 'aal1'), :'c_app', 'FR-P1 AC1: so does another member of Acme');
select is(pg_temp.open(:'wa', 'application', :'app', 'aal1'), :'c_app', 'FR-P1 AC1: and the candidate');
select is(
  (select count(*)::integer from public.conversations where context_type = 'application' and context_id = :'app'),
  1, 'FR-P1 AC1: one conversations row for the context');
select is(
  (select string_agg(coalesce(organization_id::text, user_id::text), ',' order by organization_id nulls last)
   from public.conversation_participants where conversation_id = :'c_app'),
  :'acme' || ',' || :'wa', 'FR-P1 AC1: two participants, Acme and the candidate');
select is(
  (select format('%s|%s|%s', count(*), max(metadata ->> 'context_type'), max(metadata ->> 'context_id'))
   from audit.log where action = 'conversation.opened' and entity_id = :'c_app'),
  '1|application|' || :'app', 'FR-P1 AC1: one audit row conversation.opened with the context type and id');

select pg_temp.open(:'radm', 'requirement_invitation', :'inv_rek') as c_inv \gset
select is(
  (select string_agg(organization_id::text, ',' order by organization_id = :'acme' desc)
   from public.conversation_participants where conversation_id = :'c_inv'),
  :'acme' || ',' || :'rek', 'FR-P1 AC1: an admin of Rekrut opens the conversation of its accepted invitation, Acme and Rekrut');
select pg_temp.open(:'mem', 'partner_response', :'resp', 'aal1') as c_resp \gset
select ok(:'c_resp' ~ '^[0-9a-f-]{36}$', 'a member of Acme opens the conversation of a response');
select pg_temp.open(:'adm', 'candidate_submission', :'sub') as c_sub \gset
select is(
  (select string_agg(coalesce(organization_id::text, user_id::text), ',' order by organization_id nulls last)
   from public.conversation_participants where conversation_id = :'c_sub'),
  :'acme' || ',' || :'wb', 'FR-P1 AC2: the employer opens the conversation of an approved submission, Acme and the candidate');
select is(
  (select requirement_id::text from public.conversations where id = :'c_sub'), :'r',
  'a conversation of the requirement names it');

-- AC2: contact only in the contexts of decision 5.1 --------------------------------------------------------------------

select is(
  pg_temp.open(:'adm', 'candidate_submission', :'sub_waiting') || ';' || pg_temp.open(:'adm', 'application', gen_random_uuid())
    || ';' || pg_temp.open(:'adm', 'requirement_invitation', :'app'),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|',
  'FR-P1 AC2: a submission the candidate has not approved, a made-up id and an id of another context are refused alike');
select is(
  pg_temp.open(:'wnew', 'application', :'app', 'aal1') || ';' || pg_temp.open(:'adm2', 'application', :'app')
    || ';' || pg_temp.open(:'own2', 'requirement_invitation', :'inv_rek') || ';' || pg_temp.open(:'u2', 'requirement_invitation', :'inv_rek'),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|',
  'FR-P1 AC2: another candidate, another employer and another partner are no party and are refused');
select is(pg_temp.open(:'wa', 'application', :'app_b', 'aal1'), '42501|CHARA_FORBIDDEN|',
  'FR-P1 AC2: a candidate opens nothing towards an employer through another candidate''s application');
select is(pg_temp.open(:'u2', 'requirement_invitation', :'inv_sec'), '42501|CHARA_FORBIDDEN|context_closed',
  'FR-P1 AC2: an invitation the partner has not accepted opens nothing');
select is(
  pg_temp.open(:'adm', 'contact_request', gen_random_uuid()) || ';' || pg_temp.open(:'adm', 'inquiry', gen_random_uuid()),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|',
  'contact requests (V70) and inquiries (V71) open nothing yet');
select is(pg_temp.open(:'adm', 'application', :'app_b', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'an admin of Acme at aal1 is sent to two-step verification, as for applicant data');
select is(
  (select count(*)::integer from public.conversations) || '/' || (select count(*)::integer from public.conversation_participants),
  '4/8', 'FR-P1 AC2: the refused attempts wrote no conversation and no participant');

-- AC3: the text rules -----------------------------------------------------------------------------------------------------

select is(pg_temp.send(:'adm', :'c_app', 'x') || ';' || pg_temp.send(:'adm', :'c_app', repeat('y', 4000)), 'ok;ok',
  'FR-P1 AC3: bodies of 1 and 4,000 characters are stored');
select is(
  pg_temp.send(:'adm', :'c_app', repeat('y', 4001)) || ';' || pg_temp.send(:'adm', :'c_app', '') || ';'
    || pg_temp.send(:'adm', :'c_app', '      ') || ';' || pg_temp.send(:'adm', :'c_app', E'bell\x07') || ';'
    || pg_temp.send(:'adm', :'c_app', E'carriage\rreturn') || ';' || pg_temp.send(:'adm', :'c_app', null),
  '22023|CHARA_INVALID_INPUT|p_body;22023|CHARA_INVALID_INPUT|p_body;22023|CHARA_INVALID_INPUT|p_body;22023|CHARA_INVALID_INPUT|p_body;22023|CHARA_INVALID_INPUT|p_body;22023|CHARA_INVALID_INPUT|p_body',
  'FR-P1 AC3: 4,001 characters, empty, whitespace only, a control character, a bare carriage return and no body are refused');
select is(pg_temp.send(:'adm', :'c_app', ' Hello '), 'ok', 'FR-P1 AC3: a body with spaces around it is accepted');
select is(pg_temp.send(:'adm', :'c_app', E'Line one\r\n\tLine two\n'), 'ok', 'a body with line breaks and a tab is accepted');
select is(
  (select string_agg(char_length(body)::text, ',' order by created_at) from public.messages where conversation_id = :'c_app'),
  '1,4000,5,18', 'FR-P1 AC3: four messages stored, the refused bodies none');
select is(
  (select string_agg(body, '|' order by created_at) from public.messages where conversation_id = :'c_app' and body !~ '^[xy]+$'),
  E'Hello|Line one\n\tLine two', 'FR-P1 AC3: '' Hello '' is stored as ''Hello'', CR LF as line feed, inner tabs kept');
select throws_ok(
  format('insert into public.messages (conversation_id, sender_organization_id, body) values (%L, %L, '' Hello '')', :'c_app', :'acme'),
  '23514', null, 'FR-P1 AC3: the check constraint refuses an untrimmed body when written as the database owner');
select throws_ok(
  format('insert into public.messages (conversation_id, sender_organization_id, body) values (%L, %L, %L)',
    :'c_app', :'acme', repeat('z', 4001)),
  '23514', null, 'FR-P1 AC3: and 4,001 characters');
select throws_ok(
  format('insert into public.messages (conversation_id, sender_organization_id, body) values (%L, %L, %L)',
    :'c_app', :'acme', E'a\x01b'),
  '23514', null, 'FR-P1 AC3: and a control character');
select is(
  split_part(pg_temp.read_as(:'adm', format(
    'insert into public.messages (conversation_id, sender_organization_id, body) values (%L, %L, ''Direct'') returning 1', :'c_app', :'acme')), '|', 1)
  || ';' || split_part(pg_temp.read_as(:'adm', format('update public.messages set body = ''Changed'' where conversation_id = %L returning 1', :'c_app')), '|', 1),
  '42501;42501', 'FR-P1 AC3: a direct insert or update by a participant is refused for lack of grants');
update private.settings set value = '10' where key = 'message_body_max_chars';
select is(pg_temp.send(:'adm', :'c_app', 'eleven char') || ';' || pg_temp.send(:'adm', :'c_app', 'ten chars!'),
  '22023|CHARA_INVALID_INPUT|p_body;ok', 'NFR-S10: the length limit is the setting message_body_max_chars');
delete from public.messages where conversation_id = :'c_app' and body = 'ten chars!';
delete from private.settings where key = 'message_body_max_chars';
select is(pg_temp.send(:'adm', :'c_app', 'no setting'), 'P0001|CHARA_SETTING_MISSING|message_body_max_chars',
  'a missing length setting refuses the message rather than lifting the limit');
insert into private.settings (key, value) values ('message_body_max_chars', '4000');
insert into private.setting_rules (key, value_type, min, max, label) values
  ('message_body_max_chars', 'integer', 1, 4000, 'Most characters in one message') on conflict (key) do nothing;
select is(
  (select count(*)::integer from audit.log where metadata::text like '%Hello%' or metadata::text like '%Line one%'),
  0, 'FR-P1 data: no message body reaches audit.log');

-- AC4: participants and their members only -------------------------------------------------------------------------------

select is(
  pg_temp.sees(:'own1', :'c_app') || ';' || pg_temp.sees(:'adm', :'c_app') || ';' || pg_temp.sees(:'mem', :'c_app', 'aal1')
    || ';' || pg_temp.sees(:'wa', :'c_app', 'aal1'),
  '1/2/4;1/2/4;1/2/4;1/2/4', 'FR-P1 AC4: the owner, admin and member of Acme and the candidate read every row');
select is(
  pg_temp.sees(:'adm2', :'c_app') || ';' || pg_temp.sees(:'own2', :'c_app') || ';' || pg_temp.sees(:'wb', :'c_app', 'aal1')
    || ';' || pg_temp.sees(:'padm', :'c_app') || ';' || pg_temp.sees(:'u2', :'c_app'),
  '0/0/0;0/0/0;0/0/0;0/0/0;0/0/0', 'FR-P1 AC4, NFR-S8: the other employer, the other candidate and both partners read nothing');
select is(
  pg_temp.sees(:'st_admin', :'c_app') || ';' || pg_temp.sees(:'st_ts', :'c_app') || ';' || pg_temp.sees(:'st_vr', :'c_app'),
  '0/0/0;0/0/0;0/0/0', 'FR-P1 AC4: a Platform Administrator, a Trust & Safety Administrator and a Verification Reviewer read nothing');
select is(
  pg_temp.send(:'adm2', :'c_app', 'Hi') || ';' || pg_temp.send(:'wb', :'c_app', 'Hi', 'aal1') || ';'
    || pg_temp.send(:'st_ts', :'c_app', 'Hi') || ';' || pg_temp.send(:'st_admin', :'c_app', 'Hi') || ';'
    || pg_temp.send(:'padm', :'c_app', 'Hi'),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|',
  'FR-P1 AC4: none of them can send');
select is(
  split_part(pg_temp.read_as(null, 'select count(*) from public.conversations'), '|', 1) || ';'
    || split_part(pg_temp.read_as(null, 'select count(*) from public.messages'), '|', 1) || ';'
    || split_part(pg_temp.read_as(null, 'select count(*) from public.conversation_participants'), '|', 1) || ';'
    || split_part(pg_temp.read_as(null, format('select public.open_conversation(''application'', %L)', :'app')), '|', 1),
  '42501;42501;42501;42501', 'FR-P1 AC4: an anonymous caller is refused for lack of grants');
select is(
  pg_temp.sees(:'own1', :'c_app', 'aal1') || ';' || pg_temp.send(:'own1', :'c_app', 'Hi', 'aal1') || ';'
    || pg_temp.read_as(:'own1', format('select count(*) from public.list_messages(%L)', :'c_app'), 'aal1'),
  '0/0/0;P0001|CHARA_FORBIDDEN|aal2_required;P0001|CHARA_FORBIDDEN|aal2_required',
  'the owner at aal1 reads nothing and is sent to two-step verification');
select is(
  split_part(pg_temp.read_as(:'wa', format('select user_id::text from public.conversation_participants where conversation_id = %L limit 1', :'c_app'), 'aal1'), '|', 1)
  || ';' || split_part(pg_temp.read_as(:'adm', format('select sender_user_id::text from public.messages where conversation_id = %L limit 1', :'c_app')), '|', 1),
  '42501;42501', 'NFR-S9: user ids are not selectable, even by participants');
select is(pg_temp.read_as(:'adm', format('select count(*) from public.conversations where id in (%L, %L, %L, %L)',
    :'c_app', :'c_inv', :'c_resp', :'c_sub')), '4', 'an Acme admin reads the four conversations of Acme');
select is(pg_temp.read_as(:'radm', format('select string_agg(id::text, '','') from public.conversations')), :'c_inv',
  'NFR-S8: Rekrut reads only the conversation of its invitation, not the submission of its candidate to Acme');
select is(pg_temp.read_as(:'u2', format('select string_agg(id::text, '','') from public.conversations')), :'c_resp',
  'NFR-S8: Second reads only the conversation of its response');
select is(pg_temp.read_as(:'wb', format('select string_agg(id::text, '','') from public.conversations'), 'aal1'), :'c_sub',
  'NFR-S8: the second candidate reads only the conversation of the own submission');

-- AC7: read state per user (Acme and Second) ---------------------------------------------------------------------------

select is(
  pg_temp.send(:'u2', :'c_resp', 'One') || pg_temp.send(:'u2', :'c_resp', 'Two') || pg_temp.send(:'u2', :'c_resp', 'Three')
    || pg_temp.send(:'u2', :'c_resp', 'Four') || pg_temp.send(:'own1', :'c_resp', 'Answer from Acme'),
  'okokokokok', 'Second sends four messages and the Acme owner one');
select is(pg_temp.read_as(:'mem', format('select public.mark_conversation_read(%L) is not null', :'c_resp'), 'aal1'), 'true',
  'FR-P1 AC7: a member marks the conversation read');
select is(
  (select string_agg(user_id::text, ',') from public.conversation_reads where conversation_id = :'c_resp'), :'mem',
  'FR-P1 AC7: the read state is recorded for that member only');
select is(
  pg_temp.unread(:'mem', :'c_resp', 'aal1') || ';' || pg_temp.unread(:'adm', :'c_resp') || ';' || pg_temp.unread(:'own1', :'c_resp'),
  '0;4;4', 'FR-P1 AC7: the member has 0 unread, the admin 4, and the owner''s own message is never unread for any member of Acme');
select is(pg_temp.unread(:'u2', :'c_resp'), '1', 'the partner has the one message of Acme unread');
select is(pg_temp.send(:'u2', :'c_resp', 'Five') || ';' || pg_temp.unread(:'mem', :'c_resp', 'aal1'), 'ok;1',
  'FR-P1 AC7: a later message of Second makes the member''s count 1');
select is(
  pg_temp.read_as(:'adm', format('select count(*) from public.conversation_reads where conversation_id = %L', :'c_resp'))
    || ';' || pg_temp.read_as(:'adm2', format('select public.mark_conversation_read(%L)', :'c_resp')),
  '0;42501|CHARA_FORBIDDEN|', 'another member does not read the member''s read row; a non-participant cannot mark read');
select is(pg_temp.read_as(:'adm2', 'select count(*) from public.my_unread_counts()'), '0',
  'NFR-S8: another employer''s admin counts nothing of Acme');
select is(
  pg_temp.read_as(:'mem', format(
    'select string_agg(organization_id::text || '':'' || unread, '','') from public.my_unread_counts() where conversation_id = %L', :'c_resp'), 'aal1'),
  :'acme' || ':1', 'the unread count names the side it is for');

-- AC11 data: labels of the other party and of the context -------------------------------------------------------------

select is(
  pg_temp.read_as(:'adm', format($$select concat_ws('|', counterpart_kind, counterpart_name, context_title, organization_id)
    from public.get_conversation(%L)$$, :'c_app')),
  'worker|Amina Okafor|Welder Hamburg|' || :'acme', 'FR-P1 AC11: Acme sees the candidate by name and the vacancy');
select is(
  pg_temp.read_as(:'wa', format($$select concat_ws('|', counterpart_kind, counterpart_name, context_title, coalesce(organization_id::text, 'own'))
    from public.get_conversation(%L)$$, :'c_app'), 'aal1'),
  'organization|Acme Bau|Welder Hamburg|own', 'FR-P1 AC11: the candidate sees Acme''s display name and the vacancy title');
select is(
  pg_temp.read_as(:'adm', format($$select concat_ws('|', counterpart_kind, counterpart_name, context_title)
    from public.get_conversation(%L)$$, :'c_inv')),
  'organization|Rekrut|Acme secret welders', 'FR-P1 AC11: Acme sees Rekrut by display name, never a legal name');
select is(
  pg_temp.read_as(:'radm', format($$select concat_ws('|', counterpart_name, context_title) from public.get_conversation(%L)$$, :'c_inv')),
  'Acme Bau|Acme secret welders', 'FR-P1 AC11: Rekrut, named the employer by its invitation, sees Acme and the title');
select is(
  pg_temp.read_as(:'u2', format($$select concat_ws('|', coalesce(counterpart_name, 'unnamed'), context_title)
    from public.get_conversation(%L)$$, :'c_resp')),
  'unnamed|' || private.job_order_neutral_title(:'r'), 'FR-P1 AC11: Second, not named the employer, sees neither Acme nor its title, only the generated label');
select is(
  pg_temp.read_as(:'wb', format($$select concat_ws('|', coalesce(counterpart_name, 'unnamed'), context_title)
    from public.get_conversation(%L)$$, :'c_sub'), 'aal1'),
  'unnamed|' || private.job_order_neutral_title(:'r'), 'the candidate of a submission sees the employer only when the requirement shows its identity');
select is(
  pg_temp.read_as(:'u2', format($$select string_agg(concat_ws('|', mine, sender_kind, coalesce(sender_name, '-'),
    coalesce(sender_organization_name, '-'), sender_erased), ',' order by created_at) from public.list_messages(%L)
    where body in ('Four', 'Answer from Acme')$$, :'c_resp')),
  't|organization|-|Second|f,f|organization|-|-|f',
  'NFR-S11: Second reads its own message as its own, and Acme''s without the member''s or the employer''s name');
select is(
  pg_temp.read_as(:'wa', format($$select string_agg(concat_ws('|', mine, sender_kind, sender_name, sender_organization_name), ','
    order by created_at) from public.list_messages(%L) where body = 'Hello'$$, :'c_app'), 'aal1'),
  'f|organization|Ada Admin|Acme Bau', 'the candidate reads who of Acme wrote');
select is(
  pg_temp.read_as(:'wa', format($$select string_agg(id::text, ',' order by created_at desc) from public.list_messages(%L, null, null, 2)$$, :'c_app'), 'aal1'),
  (select string_agg(id::text, ',' order by created_at desc) from (select id, created_at from public.messages where conversation_id = :'c_app'
     order by created_at desc, id desc limit 2) x),
  'a thread is read newest first, a page at a time');
select is(
  pg_temp.read_as(:'wa', format($$select string_agg(id::text, ',' order by created_at desc) from public.list_messages(%L, %L, %L, 50)$$,
    :'c_app', (select created_at from public.messages where conversation_id = :'c_app' order by created_at desc, id desc offset 1 limit 1),
    (select id from public.messages where conversation_id = :'c_app' order by created_at desc, id desc offset 1 limit 1)), 'aal1'),
  (select string_agg(id::text, ',' order by created_at desc) from (select id, created_at from public.messages where conversation_id = :'c_app'
     order by created_at desc, id desc offset 2) x),
  'the next page starts after the cursor');
select is(
  pg_temp.read_as(:'adm', format($$select string_agg(id::text, ',') from public.list_conversations(%L)$$, :'acme')),
  (select string_agg(id::text, ',' order by last_message_at desc, id desc) from public.conversations where id in (:'c_app', :'c_inv', :'c_resp', :'c_sub')),
  'the conversation list of Acme, latest message first');
select is(
  pg_temp.read_as(:'adm', format($$select string_agg(id::text, ',') from public.list_conversations(%L, null, null, 1)$$, :'acme'))
    || ';' || pg_temp.read_as(:'adm', format($$select count(*) from public.list_conversations(%L, %L, %L)$$, :'acme',
       (select last_message_at from public.conversations where id = :'c_resp'), :'c_resp')),
  :'c_resp' || ';3', 'the list pages by the last message');
select is(
  pg_temp.read_as(:'wa', 'select string_agg(id::text, '','') from public.list_conversations()', 'aal1')
    || ';' || pg_temp.read_as(:'radm', format('select string_agg(id::text, '','') from public.list_conversations(%L)', :'rek')),
  :'c_app' || ';' || :'c_inv', 'the candidate lists the own conversations, Rekrut its own');
select is(
  pg_temp.read_as(:'adm2', format('select count(*) from public.list_conversations(%L)', :'acme')) || ';'
    || pg_temp.read_as(:'adm2', format('select count(*) from public.get_conversation(%L)', :'c_app')) || ';'
    || pg_temp.read_as(:'adm2', format('select count(*) from public.list_messages(%L)', :'c_app')) || ';'
    || pg_temp.read_as(:'adm', format('select count(*) from public.list_conversations(%L, null, null, 51)', :'acme')),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;22023|CHARA_INVALID_INPUT|p_limit',
  'NFR-S8: another employer lists, opens and reads nothing of Acme; a page over 50 is refused');
select is(pg_temp.read_as(:'own2', 'select count(*) from public.list_conversations()'), '0',
  'a company user without a p_org lists no candidate conversations');

-- AC6: sending stops when the context no longer allows contact ----------------------------------------------------------

select pg_temp.open(:'adm', 'application', :'app_b') as c_app_b \gset
select is(pg_temp.send(:'wb', :'c_app_b', 'Can I start in March?', 'aal1'), 'ok', 'the candidate writes in the own application''s conversation');
select pg_temp.force_status(:'app_b', 'withdrawn') as forced \gset
select is(
  pg_temp.send(:'adm', :'c_app_b', 'Still there?') || ';' || pg_temp.send(:'wb', :'c_app_b', 'Bye', 'aal1'),
  '42501|CHARA_FORBIDDEN|context_closed;42501|CHARA_FORBIDDEN|context_closed',
  'FR-P1 AC6: after the candidate withdrew the application both sides are refused');
select is(
  pg_temp.read_as(:'adm', format('select count(*) from public.list_messages(%L)', :'c_app_b')) || ';'
    || pg_temp.read_as(:'wb', format('select count(*) from public.list_messages(%L)', :'c_app_b'), 'aal1') || ';'
    || pg_temp.read_as(:'adm', format('select read_only_reason from public.get_conversation(%L)', :'c_app_b')) || ';'
    || pg_temp.open(:'adm', 'application', :'app_b'),
  '1;1;context_closed;' || :'c_app_b', 'FR-P1 AC6: the history stays readable to both, marked read-only, and opening answers it');
select pg_temp.force_status(:'app_beta', 'withdrawn') as forced \gset
select is(pg_temp.open(:'own2', 'application', :'app_beta'), '42501|CHARA_FORBIDDEN|context_closed',
  'a withdrawn application opens no new conversation');

select set_config('request.jwt.claims', json_build_object('sub', :'own1', 'role', 'authenticated')::text, true) as as_owner \gset
update public.workforce_requirements set status = 'closed', close_reason = 'cancelled' where id = :'r';
select set_config('request.jwt.claims', '', true) as reset_claims \gset
select is(
  (select status::text from public.requirement_invitations where id = :'inv_rek') || ';'
    || pg_temp.send(:'adm', :'c_inv', 'The requirement is closed, thank you') || ';' || pg_temp.send(:'radm', :'c_inv', 'Thanks')
    || ';' || pg_temp.send(:'u2', :'c_resp', 'Noted'),
  'expired;ok;ok;ok', 'FR-P1 AC6: closing the requirement expires the invitation but ends neither conversation');

update public.candidate_submissions set status = 'withdrawn', withdrawn_at = now() where id = :'sub';
select is(pg_temp.send(:'adm', :'c_sub', 'Hello?') || ';' || pg_temp.send(:'wb', :'c_sub', 'Bye', 'aal1'),
  '42501|CHARA_FORBIDDEN|context_closed;42501|CHARA_FORBIDDEN|context_closed',
  'a withdrawn submission closes its conversation for both sides');

update public.organizations set status = 'suspended' where id = :'acme';
select is(
  pg_temp.send(:'adm', :'c_inv', 'Anyone?') || ';' || pg_temp.send(:'radm', :'c_inv', 'Anyone?') || ';'
    || pg_temp.send(:'wa', :'c_app', 'Anyone?', 'aal1') || ';' || pg_temp.sees(:'adm', :'c_inv') || ';'
    || pg_temp.open(:'adm', 'application', :'app'),
  '42501|CHARA_FORBIDDEN|org_suspended;42501|CHARA_FORBIDDEN|org_suspended;42501|CHARA_FORBIDDEN|org_suspended;1/2/2;' || :'c_app',
  'FR-P1 AC6: while Acme is suspended its conversations are read-only for both sides, and still read');
update public.organizations set status = 'active' where id = :'acme';
select is(pg_temp.send(:'adm', :'c_inv', 'Back again'), 'ok', 'FR-P1 states: reinstated, Acme sends again');

-- AC5: a removed member loses access at once ---------------------------------------------------------------------------

select is(pg_temp.send(:'mem', :'c_app', 'Message from Mia', 'aal1'), 'ok', 'a member writes to the candidate');
delete from public.organization_members where organization_id = :'acme' and user_id = :'mem';
select is(
  pg_temp.sees(:'mem', :'c_app', 'aal1') || ';' || pg_temp.send(:'mem', :'c_app', 'Still here', 'aal1') || ';'
    || pg_temp.read_as(:'mem', format('select count(*) from public.list_messages(%L)', :'c_app'), 'aal1') || ';'
    || pg_temp.read_as(:'mem', format('select count(*) from public.list_conversations(%L)', :'acme'), 'aal1'),
  '0/0/0;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|',
  'FR-P1 AC5: once removed, the member reads nothing and cannot send');
select is(
  pg_temp.read_as(:'wa', format($$select concat_ws('|', sender_name, sender_erased) from public.list_messages(%L) where body = 'Message from Mia'$$, :'c_app'), 'aal1')
    || ';' || pg_temp.read_as(:'own1', format($$select sender_name from public.list_messages(%L) where body = 'Message from Mia'$$, :'c_app')),
  'Mia Member|f;Mia Member', 'FR-P1 AC5: the messages of the former member stay and still show the name to the candidate and to Acme');
update public.messages set sender_user_id = null where body = 'Message from Mia';
select is(
  pg_temp.read_as(:'wa', format($$select concat_ws('|', coalesce(sender_name, '-'), sender_organization_name, sender_erased) from public.list_messages(%L) where body = 'Message from Mia'$$, :'c_app'), 'aal1'),
  '-|Acme Bau|t', 'FR-P3 AC10 (room for V74): a message whose sender''s account is gone stays with the organisation, marked erased');

update public.profiles set deleted_at = now() where id = :'wa';
select is(pg_temp.send(:'adm', :'c_app', 'Are you there?'), '42501|CHARA_FORBIDDEN|context_closed',
  'FR-P1 states: once the candidate''s account is closed the conversation is read-only');
update public.profiles set deleted_at = null where id = :'wa';

-- The switch -------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_messaging';
select is(
  pg_temp.send(:'adm', :'c_inv', 'Off') || ';' || pg_temp.read_as(:'adm', format('select count(*) from public.list_conversations(%L)', :'acme'))
    || ';' || pg_temp.read_as(:'adm', 'select count(*) from public.my_unread_counts()') || ';'
    || pg_temp.read_as(:'adm', format('select public.mark_conversation_read(%L)', :'c_inv')),
  '42501|CHARA_FORBIDDEN|release_off;42501|CHARA_FORBIDDEN|release_off;42501|CHARA_FORBIDDEN|release_off;42501|CHARA_FORBIDDEN|release_off',
  'with release_messaging off every function refuses');

select * from finish();
rollback;
