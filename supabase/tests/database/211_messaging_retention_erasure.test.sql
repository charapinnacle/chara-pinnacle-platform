begin;
select plan(56);

\ir apply_fixture.inc

-- V74: retention, erasure and export of messaging and Find Workers (FR-P3 AC9, AC10; FR-S3 AC1, AC2, AC4 to AC7, AC9; SOP
-- P2-28 step Retain, P2-43 steps Apply, Erase, Export, Check; decision 5.4; NFR-C5, NFR-O5, NFR-S8). Employers Acme (t.a:
-- owner own1, admin adm, member mem) and Beta (t.b: owner own2) and the recruitment companies Alpha (owner pa) and Bravo
-- (owner pb) talk to the candidates wa (Amina Okafor) and wb (Bruno Silva) of the fixture. Conversations, messages and
-- contact requests are written as the database owner with their times in the past; decisions on messages and contact
-- requests (V73) are written the same way, with the target check of moderation_actions lifted inside this transaction.

\set pa '00000000-0000-0000-0000-000000211001'
\set pb '00000000-0000-0000-0000-000000211002'
\set w3 '00000000-0000-0000-0000-000000211003'
\set mx '00000000-0000-0000-0000-000000211004'
\set ts '00000000-0000-0000-0000-000000211005'

update private.settings set value = 'true' where key in ('release_messaging', 'release_find_workers');
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
select pg_temp.new_user(u) from unnest(array[:'pa', :'pb', :'mx', :'ts']::uuid[]) u;
select pg_temp.new_user(:'w3', 'worker');
update public.profiles set account_kind = intended_account_kind where id in (:'pa', :'pb', :'mx', :'w3', :'ts');
insert into public.platform_staff (user_id, role) values (:'ts', 'trust_safety');
update public.profiles set display_name = 'Max Member' where id = :'mx';
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'acme', :'mx', 'member', now());
insert into public.worker_profiles (user_id, first_name, last_name, current_country, occupation_id, headline)
values (:'w3', 'Chidi', 'Eze', 'NG', '7212', 'Welder');
alter table public.moderation_actions drop constraint moderation_actions_target_action_check;

create function pg_temp.partner(p_slug text, p_owner uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'recruitment_company', p_slug, 'Legal ' || p_slug || ' Ltd', initcap(p_slug), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  return v_id;
end;
$$;

select pg_temp.partner('v74-alpha', :'pa') as alpha \gset
select pg_temp.partner('v74-bravo', :'pb') as bravo \gset

-- A conversation between p_org and p_worker (or p_other_org), its last message p_days ago.
create function pg_temp.conv(p_type text, p_context uuid, p_org uuid, p_worker uuid, p_other_org uuid, p_days numeric)
returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.conversations (id, context_type, context_id, created_at, last_message_at)
  values (v_id, p_type::public.conversation_context, p_context, now() - make_interval(days => p_days::integer + 5),
    now() - p_days * interval '1 day');
  insert into public.conversation_participants (conversation_id, organization_id) values (v_id, p_org);
  insert into public.conversation_participants (conversation_id, organization_id, user_id)
  values (v_id, p_other_org, p_worker);
  return v_id;
end;
$$;

create function pg_temp.msg(p_conv uuid, p_user uuid, p_org uuid, p_days numeric, p_body text) returns uuid
language sql as $$
  insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body, created_at)
  values (p_conv, p_user, p_org, p_body, now() - p_days * interval '1 day')
  returning id
$$;

-- A contact request of p_org to p_worker in p_status, sent p_days ago and answered, withdrawn or expired p_answered ago.
create function pg_temp.request(p_org uuid, p_worker uuid, p_status text, p_days integer, p_answered integer default null,
  p_by uuid default null) returns uuid
language sql as $$
  insert into public.contact_requests (organization_id, worker_user_id, card_id, sent_by, message, status, created_at,
    expires_at, responded_at, withdrawn_at)
  select p_org, p_worker, w.card_id, p_by, 'We would like to talk to you about welding work.', p_status::public.contact_request_status,
    now() - make_interval(days => p_days),
    case when p_status = 'expired' then now() - make_interval(days => coalesce(p_answered, p_days))
         else now() - make_interval(days => p_days) + interval '30 days' end,
    case when p_status in ('accepted', 'declined') then now() - make_interval(days => coalesce(p_answered, p_days)) end,
    case when p_status = 'withdrawn' then now() - make_interval(days => coalesce(p_answered, p_days)) end
  from public.worker_profiles w where w.user_id = p_worker
  returning id
$$;

create function pg_temp.decide(p_type text, p_id uuid) returns void
language sql as $$
  insert into public.moderation_actions (target_type, target_id, action, statement_of_reasons)
  values (p_type, p_id, 'content_hidden', 'Hidden after a report: fee demand.')
$$;

create function pg_temp.exists_row(p_table text, p_id uuid) returns boolean
language plpgsql as $$
declare
  v boolean;
begin
  execute format('select exists (select 1 from %s where id = %L)', p_table, p_id) into v;
  return v;
end;
$$;

-- AC1: the periods ---------------------------------------------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s', entity, days, editable), ',' order by entity) from private.retention_policies
   where entity in ('contact_request_declines', 'contact_requests', 'conversations', 'saved_worker_cards', 'worker_search_log')),
  'contact_request_declines:90:t,contact_requests:365:t,conversations:730:t,saved_worker_cards:365:t,worker_search_log:90:t',
  'AC1: conversations 730 days (decision 5.4), contact requests 365, declines 90, saved cards 365 and the search log 90 (V69), each editable (NFR-O5)'
);
select is(
  (select count(*)::integer from private.retention_policies where entity in ('conversations', 'contact_requests') and description ~ 'Applies with'),
  0, 'their descriptions no longer say they wait for release 2c'
);

-- FR-P3 AC9, FR-S3 AC2: conversations ---------------------------------------------------------------------------------------
select pg_temp.conv('requirement_invitation', gen_random_uuid(), :'acme', null, :'alpha', 731) as c_731 \gset
select pg_temp.msg(:'c_731', :'mem', :'acme', 740, 'Can you send twelve welders?') as m_731_acme \gset
select pg_temp.msg(:'c_731', :'pa', :'alpha', 731, 'Yes, from March.') as m_731_alpha \gset
insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (:'c_731', :'mem', now() - interval '731 days');
insert into public.conversation_blocks (conversation_id, blocked_by_user_id, blocked_by_organization_id) values (:'c_731', :'pa', :'alpha');
select pg_temp.conv('requirement_invitation', gen_random_uuid(), :'beta', null, :'bravo', 729.9) as c_730 \gset
select pg_temp.msg(:'c_730', :'own2', :'beta', 729.9, 'Still interested?') as m_730 \gset
select pg_temp.conv('partner_response', gen_random_uuid(), :'beta', null, :'alpha', 10) as c_10 \gset
select pg_temp.msg(:'c_10', :'own2', :'beta', 10, 'Thanks for the proposal.') as m_10 \gset
select pg_temp.conv('partner_response', gen_random_uuid(), :'acme', null, :'bravo', 800) as c_reported \gset
select pg_temp.msg(:'c_reported', :'pb', :'bravo', 800, 'Pay us 500 EUR per worker first.') as m_reported \gset
select pg_temp.conv('partner_response', gen_random_uuid(), :'beta', null, :'bravo', 800) as c_dismissed \gset
select pg_temp.msg(:'c_dismissed', :'pb', :'bravo', 800, 'Our fees are on the proposal.') as m_dismissed \gset
select pg_temp.conv('requirement_invitation', gen_random_uuid(), :'acme', null, :'bravo', 731) as c_empty \gset
insert into public.reports (target_type, message_id, category, details, good_faith_confirmed, reporter_user_id, status,
  handled_by, handled_at, resolution_note)
values ('message', :'m_reported', 'fee_demanded_from_worker', 'The partner asks for money before any work.', true, :'own1',
        'in_review', :'ts', now(), null),
       ('message', :'m_dismissed', 'other', 'The partner mentions fees in the conversation.', true, :'own2',
        'dismissed', :'ts', now(), 'Fees between companies are allowed.');
-- Trust & Safety hid Acme's message in the conversation retention deletes; a decision on Alpha's side stays as well.
select pg_temp.decide('message', :'m_731_acme');

select private.apply_retention();

select is(pg_temp.exists_row('public.conversations', :'c_731'), false, 'FR-P3 AC9: the conversation whose last message is 731 days old is deleted');
select is(
  (select count(*)::integer from public.messages where conversation_id = :'c_731')
    + (select count(*)::integer from public.conversation_participants where conversation_id = :'c_731')
    + (select count(*)::integer from public.conversation_reads where conversation_id = :'c_731')
    + (select count(*)::integer from public.conversation_blocks where conversation_id = :'c_731'),
  0, 'FR-P3 AC9: with its messages, participants, read rows and block');
select is(pg_temp.exists_row('public.conversations', :'c_730') and pg_temp.exists_row('public.messages', :'m_730'), true,
  'FR-S3 AC2: the conversation of 730 days is kept');
select is(pg_temp.exists_row('public.conversations', :'c_10'), true, 'FR-P3 AC9: the conversation of 10 days is kept');
select is(pg_temp.exists_row('public.conversations', :'c_reported') and pg_temp.exists_row('public.messages', :'m_reported'), true,
  'FR-P3 AC9: the conversation with a message under a report in review is kept until the report closes');
select is(pg_temp.exists_row('public.conversations', :'c_dismissed'), false, 'a dismissed report holds nothing back');
select is(pg_temp.exists_row('public.conversations', :'c_empty'), false, 'FR-S3 AC2: the empty conversation opened 731 days ago is deleted');
select is(
  (select format('%s|%s', target_type, organization_id) from private.moderated_item_tombstones where target_id = :'m_731_acme'),
  format('message|%s', :'acme'), 'FR-S1: the hidden message leaves its tombstone with the organisation that sent it, so the decision stays listed'
);
select is((select count(*)::integer from public.reports where message_id in (:'m_reported', :'m_dismissed')), 2,
  'the reports keep their message id (no foreign key)');

-- Contact requests (FR-S3 AC4) ---------------------------------------------------------------------------------------------
select pg_temp.request(:'acme', :'wa', 'accepted', 400, 366) as r_acc_366 \gset
select pg_temp.request(:'beta', :'wa', 'accepted', 420, 400, :'own2') as r_acc_conv \gset
select pg_temp.request(:'alpha', :'wa', 'expired', 400, 366) as r_exp_366 \gset
select pg_temp.request(:'bravo', :'wa', 'withdrawn', 370, 364) as r_wd_364 \gset
select pg_temp.request(:'acme', :'w3', 'declined', 85, 80) as r_dec_80 \gset
select pg_temp.request(:'beta', :'w3', 'declined', 95, 91) as r_dec_91 \gset
select pg_temp.request(:'alpha', :'w3', 'pending', 400) as r_pend_400 \gset
select pg_temp.conv('contact_request', :'r_acc_conv', :'beta', :'wa', null, 3) as c_cr \gset
select pg_temp.msg(:'c_cr', :'wa', null, 3, 'Hello, I am interested.') as m_cr_wa \gset
select pg_temp.msg(:'c_cr', :'own2', :'beta', 3, 'Great, when can you start?') as m_cr_beta \gset
select pg_temp.decide('contact_request', :'r_exp_366');

-- Saved cards: wa is listed, wb hid the card 100 days ago, w3 is hidden and never withdrew after the saving.
update public.worker_profiles set searchable = true where user_id = :'wa';
insert into public.consents (user_id, purpose, version, action, created_at)
values (:'wb', 'worker-visibility-consent', 0, 'withdrawn', now() - interval '100 days');
insert into public.saved_worker_cards (organization_id, card_id, created_at) select :'acme', card_id, now() - interval '400 days'
from public.worker_profiles where user_id = :'wa' returning id as s_listed \gset
insert into public.saved_worker_cards (organization_id, card_id, created_at) select :'acme', card_id, now() - interval '400 days'
from public.worker_profiles where user_id = :'wb' returning id as s_recent_hide \gset
insert into public.saved_worker_cards (organization_id, card_id, created_at) select :'beta', card_id, now() - interval '400 days'
from public.worker_profiles where user_id = :'w3' returning id as s_hidden \gset
insert into public.saved_worker_cards (organization_id, card_id, created_at) select :'alpha', card_id, now() - interval '10 days'
from public.worker_profiles where user_id = :'w3' returning id as s_new \gset

select private.apply_retention();

select is(pg_temp.exists_row('public.contact_requests', :'r_acc_366'), false, 'FR-S3 AC4: the request accepted 366 days ago is deleted');
select is(pg_temp.exists_row('public.contact_requests', :'r_acc_conv'), true, 'an older accepted request stays while its conversation does');
select is(pg_temp.exists_row('public.contact_requests', :'r_exp_366'), false, 'FR-S3 AC4: a request expired 366 days ago is deleted');
select is(pg_temp.exists_row('public.contact_requests', :'r_wd_364'), true, 'FR-S3 AC4: one withdrawn 364 days ago is kept');
select is(pg_temp.exists_row('public.contact_requests', :'r_dec_80'), true, 'FR-S3 AC4: the decline of 80 days, inside the 90-day block, is kept');
select is(pg_temp.exists_row('public.contact_requests', :'r_dec_91'), false, 'a decline of 91 days is deleted (contact_request_declines, 90)');
select is(pg_temp.exists_row('public.contact_requests', :'r_pend_400'), false, 'FR-S3 AC4: a request still pending 400 days after its sending is deleted');
select is(
  (select format('%s|%s', target_type, organization_id) from private.moderated_item_tombstones where target_id = :'r_exp_366'),
  format('contact_request|%s', :'alpha'), 'FR-S1: a contact request named by a decision leaves its tombstone with the sending organisation'
);
select is(
  (select string_agg(organization_id::text, ',' order by created_at) from public.saved_worker_cards where id in (:'s_listed', :'s_recent_hide', :'s_hidden', :'s_new')),
  format('%s,%s,%s', :'acme', :'acme', :'alpha'),
  'a saved card is deleted 365 days after the saving once its worker no longer shows it; a listed card, a card hidden 100 days ago and a recent save stay'
);
select results_eq(
  $$select entity_id, (metadata ->> 'days')::integer, (metadata ->> 'removed')::integer from audit.log
    where action = 'retention.run' and entity_id in ('conversations', 'contact_requests', 'contact_request_declines', 'saved_worker_cards')
      and created_at = now()
    order by id$$,
  $$values ('conversations', 730, 3), ('contact_requests', 365, 0), ('contact_request_declines', 90, 0), ('saved_worker_cards', 365, 0),
           ('conversations', 730, 0), ('contact_requests', 365, 3), ('contact_request_declines', 90, 1), ('saved_worker_cards', 365, 1)$$,
  'FR-S3 AC2: each run writes one audit row per entity with its period and count; a second run deletes no conversation'
);

-- A shorter period never goes below the blocks of FR-Q3: the repeat block (30 days) and the decline block (90 days).
update private.retention_policies set days = 5 where entity in ('contact_requests', 'contact_request_declines');
select pg_temp.request(:'acme', :'wb', 'withdrawn', 25, 20) as r_wd_20 \gset
select pg_temp.request(:'bravo', :'wb', 'withdrawn', 40, 35) as r_wd_35 \gset
select private.apply_retention();
select is(
  format('%s|%s|%s', pg_temp.exists_row('public.contact_requests', :'r_wd_20'), pg_temp.exists_row('public.contact_requests', :'r_wd_35'),
    pg_temp.exists_row('public.contact_requests', :'r_dec_80')),
  't|f|t', 'NFR-O5: at 5 days a withdrawal of 20 days stays for the 30-day repeat block, one of 35 goes, the decline of 80 days stays'
);
update private.retention_policies set days = 365 where entity = 'contact_requests';
update private.retention_policies set days = 90 where entity = 'contact_request_declines';

-- FR-S3 AC5, AC6, FR-P3 AC10: erasure of a worker ------------------------------------------------------------------------------
select pg_temp.open_job('Welder for Hamburg') as job \gset
select pg_temp.apply_as(:'wb', :'job') as applied \gset
select current_setting('t.app') as app_wb \gset
select pg_temp.request(:'alpha', :'wb', 'accepted', 20, 18, :'pa') as r_wb_acc \gset
select pg_temp.request(:'beta', :'wb', 'declined', 20, 19) as r_wb_dec \gset
select pg_temp.request(:'acme', :'wb', 'pending', 2) as r_wb_pend \gset
select pg_temp.conv('application', :'app_wb', :'acme', :'wb', null, 1) as c_wb_app \gset
select pg_temp.conv('contact_request', :'r_wb_acc', :'alpha', :'wb', null, 1) as c_wb_cr \gset
select pg_temp.msg(:'c_wb_app', :'wb', null, 2, 'When does the job start?') as m_wb1 \gset
select pg_temp.msg(:'c_wb_app', :'mem', :'acme', 1.5, 'On 1 June.') as m_acme1 \gset
select pg_temp.msg(:'c_wb_app', :'wb', null, 1, 'Thank you.') as m_wb2 \gset
select pg_temp.msg(:'c_wb_cr', :'wb', null, 1.2, 'Hello Alpha.') as m_wb3 \gset
select pg_temp.msg(:'c_wb_cr', :'pa', :'alpha', 1.1, 'Hello Bruno.') as m_alpha1 \gset
insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (:'c_wb_app', :'wb', now());
insert into public.conversation_blocks (conversation_id, blocked_by_user_id) values (:'c_wb_cr', :'wb');
insert into public.connections (kind, from_organization_id, to_user_id, conversation_id, job_id, created_by)
values ('invite_to_job', :'acme', :'wb', :'c_wb_app', :'job', :'mem') returning id as con_wb \gset
update public.profiles set deleted_at = now() - interval '40 days' where id = :'wb';

select is(public.erase_user(:'wb'), true, 'FR-S3 AC5: erase_user runs for the worker');
select (select entity_id from audit.log where action = 'account.erased' order by id desc limit 1) as pseudonym \gset
select is((select count(*)::integer from public.contact_requests where id in (:'r_wb_acc', :'r_wb_dec', :'r_wb_pend', :'r_wd_20', :'r_wd_35')), 0,
  'FR-S3 AC5: the accepted, declined, pending and withdrawn contact requests are deleted');
select is((select count(*)::integer from public.messages where id in (:'m_wb1', :'m_wb2', :'m_wb3')), 0,
  'FR-S3 AC6: every message the worker sent is deleted');
select is((select count(*)::integer from public.messages where id in (:'m_acme1', :'m_alpha1')), 2, 'FR-S3 AC6: the companies'' own messages stay');
select is((select count(*)::integer from public.connections where id = :'con_wb' or to_user_id = :'wb'), 0,
  'FR-S3 AC5: the invitation to apply sent to the worker (V71) is deleted');
select is(
  (select string_agg(coalesce(p.organization_id::text, 'user:' || p.user_id::text), ',' order by p.organization_id nulls last)
   from public.conversation_participants p where p.conversation_id = :'c_wb_app'),
  format('%s,user:%s', :'acme', :'pseudonym'), 'FR-S3 AC6: the worker''s participant row is replaced by the pseudonym of the erasure'
);
select is(
  (select count(*)::integer from public.conversations where opened_by = :'wb')
    + (select count(*)::integer from public.conversation_participants where user_id = :'wb')
    + (select count(*)::integer from public.messages where sender_user_id = :'wb')
    + (select count(*)::integer from public.conversation_reads where user_id = :'wb')
    + (select count(*)::integer from public.conversation_blocks where blocked_by_user_id = :'wb'),
  0, 'FR-S3 AC6: no row of conversations, participants, messages, reads or blocks holds the worker''s user id'
);
select is(
  pg_temp.val_as(:'mem', 'aal1', format($f$select coalesce(counterpart_name, '-') || '|' || read_only_reason from public.get_conversation(%L)$f$, :'c_wb_app')),
  '-|context_closed', 'FR-P3 AC10: the company reads a conversation that names nobody and is closed for messages'
);
select is(
  pg_temp.val_as(:'mem', 'aal1', format($f$select string_agg(body, ',') from public.list_messages(%L)$f$, :'c_wb_app')),
  'On 1 June.', 'FR-P3 AC10: and keeps its own messages only'
);
select is(
  (select (metadata -> 'deleted') || (metadata -> 'pseudonymised') from audit.log where action = 'account.erased' and entity_id = :'pseudonym'),
  '{"candidate_submissions": 0, "submission_passport_shares": 0, "contact_requests": 4, "messages": 3, "connections": 1, "conversation_participants": 2}'::jsonb,
  'FR-S3 AC5: the audit row counts the requests and messages deleted and the participant rows pseudonymised'
);
select is((select count(*)::integer from audit.log where action = 'account.erased' and metadata::text ~ (:'wb' || '|Bruno|Silva')), 0,
  'and names neither the worker nor the address');
select is(public.erase_user(:'wb'), false, 'FR-S3 AC5: a second run changes nothing');

-- A company member's account goes: the messages stay with the organisation as from a former member.
select pg_temp.msg(:'c_10', :'mx', :'acme', 0.5, 'Message from Max.') as m_mx \gset
update public.conversation_participants set organization_id = :'acme' where conversation_id = :'c_10' and organization_id = :'alpha';
delete from auth.users where id = :'mx';
select is(
  (select format('%s|%s', sender_user_id is null, sender_organization_id) from public.messages where id = :'m_mx'),
  format('t|%s', :'acme'), 'FR-P3 AC10: a former member''s message stays an organisation record without the user'
);
select is(
  pg_temp.val_as(:'adm', 'aal2', format($f$select format('%%s|%%s|%%s', coalesce(sender_name, '-'), sender_organization_name, sender_erased)
    from public.list_messages(%L) where body = 'Message from Max.'$f$, :'c_10')),
  '-|Acme Bau|t', 'FR-P3 AC10: list_messages marks it erased with the organisation, so the thread reads "Former member, Acme Bau"'
);

-- FR-S3 AC7: the export --------------------------------------------------------------------------------------------------------
insert into public.connections (kind, from_organization_id, to_user_id, conversation_id, job_id, created_by)
values ('invite_to_job', :'beta', :'wa', :'c_cr', :'job', :'own2');
select pg_temp.decide('message', :'m_cr_wa');
insert into public.appeals (moderation_action_id, organization_id, appellant_user_id, grounds, due_at)
select max(a.id), null, :'wa', 'My message asked about the start date only.', now() + interval '14 days'
from public.moderation_actions a where a.target_type = 'message' and a.target_id = :'m_cr_wa';
insert into public.data_export_requests (id, user_id) values
  ('00000000-0000-0000-0000-000000211101', :'wa'), ('00000000-0000-0000-0000-000000211102', :'mem'),
  ('00000000-0000-0000-0000-000000211103', :'own2'), ('00000000-0000-0000-0000-000000211104', :'w3');
select public.account_ops_export_data('00000000-0000-0000-0000-000000211101') -> 'sections' as wa_data \gset
select public.account_ops_export_data('00000000-0000-0000-0000-000000211102') -> 'sections' as mem_data \gset
select public.account_ops_export_data('00000000-0000-0000-0000-000000211103') -> 'sections' as own2_data \gset

select is(
  (select string_agg(format('%s|%s|%s', c ->> 'side', c ->> 'context', c ->> 'with'), ',') from jsonb_array_elements((:'wa_data'::jsonb) -> 'conversations') c),
  'candidate|contact_request|Beta Works', 'FR-S3 AC7: the worker''s conversations.json holds the own conversation with the other party'
);
select is(
  (select string_agg(format('%s|%s|%s', m ->> 'conversation_id', m ->> 'text', m ->> 'organization'), ',')
   from jsonb_array_elements((:'wa_data'::jsonb) -> 'messages') m),
  format('%s|Hello, I am interested.|', :'c_cr'), 'FR-S3 AC7: messages.json holds the messages the worker sent, with the conversation'
);
select is(
  (select string_agg(format('%s|%s|%s|%s', r ->> 'side', r ->> 'organization', r ->> 'status', r ->> 'message' is not null), ',' order by r ->> 'organization')
   from jsonb_array_elements((:'wa_data'::jsonb) -> 'contact_requests') r),
  'worker|Beta Works|accepted|t',
  'FR-S3 AC7: contact_requests.json holds the requests the worker received, with the company, the message and the status'
);
select is(
  (select string_agg(format('%s|%s|%s', i ->> 'organization', i ->> 'vacancy', i ->> 'status'), ',')
   from jsonb_array_elements((:'wa_data'::jsonb) -> 'job_invitations') i),
  'Beta Works|Welder for Hamburg|sent', 'FR-S3 AC7: job_invitations.json holds the invitations to apply sent to the worker (V71)'
);
select is(
  (select string_agg(format('%s|%s', coalesce(a ->> 'organization', '-'), a ->> 'status'), ',')
   from jsonb_array_elements((:'wa_data'::jsonb) -> 'appeals') a),
  '-|open', 'FR-S3 AC7: appeals.json keeps the appeal of the worker''s own message, which has no organisation (V73)'
);
select is(
  ((:'wa_data'::jsonb) #> '{passport,find_workers}') ->> 'visible', 'true', 'passport.json says whether the card is shown in Find Workers'
);
select is(
  (select string_agg(format('%s|%s|%s', c ->> 'side', c ->> 'organization', coalesce(c ->> 'with', '-')), ',' order by c ->> 'opened_at')
   from jsonb_array_elements((:'mem_data'::jsonb) -> 'conversations') c),
  'organization|Acme Bau|-', 'FR-S3 AC7: a member''s copy holds the conversations they wrote in for the organisation, never naming the candidate'
);
select is(
  (select string_agg(format('%s|%s', m ->> 'text', m ->> 'organization'), ',') from jsonb_array_elements((:'mem_data'::jsonb) -> 'messages') m),
  'On 1 June.|Acme Bau', 'FR-S3 AC7: and the messages they sent with the organisation name'
);
select is(
  (select string_agg(format('%s|%s|%s', r ->> 'side', r ->> 'organization', r ->> 'status'), ',') from jsonb_array_elements((:'own2_data'::jsonb) -> 'contact_requests') r),
  'organization|Beta Works|accepted', 'FR-S3 AC7: a member''s copy holds the contact requests they sent'
);
select ok(((:'own2_data'::jsonb) -> 'contact_requests')::text || ((:'mem_data'::jsonb) -> 'conversations')::text
  || ((:'mem_data'::jsonb) -> 'messages')::text !~ ('Amina|Okafor|Bruno|Silva|' || :'wa' || '|' || :'wb'),
  'FR-S3 AC7: never a worker''s name or id in a company member''s copy');
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(public.account_ops_export_data('00000000-0000-0000-0000-000000211104') -> 'sections') k
   where k in ('conversations', 'messages', 'contact_requests')),
  'contact_requests,conversations,messages', 'the three sections are written for every account (empty lists when none)'
);
select is(
  (select jsonb_array_length((public.account_ops_export_data('00000000-0000-0000-0000-000000211104') -> 'sections') -> 'contact_requests')),
  1, 'w3''s copy holds the own decline only, no other worker''s request'
);

-- A contact request under a report that is not closed (V73's target contact_request) waits for it.
select pg_temp.request(:'acme', :'w3', 'expired', 400, 366) as r_reported \gset
insert into public.reports (target_type, contact_request_id, category, details, good_faith_confirmed, reporter_user_id)
values ('contact_request', :'r_reported', 'fee_demanded_from_worker', 'The company asked me to pay before the job.', true, :'w3')
returning id as cr_report \gset
select private.apply_retention();
select is(pg_temp.exists_row('public.contact_requests', :'r_reported'), true,
  'FR-S3 AC4: an expired request under a new report is kept until the report closes');
update public.reports set status = 'dismissed', handled_by = :'ts', handled_at = now(), resolution_note = 'No fee was asked.'
where id = :cr_report;
select private.apply_retention();
select is(pg_temp.exists_row('public.contact_requests', :'r_reported'), false, 'and is deleted once the report is closed');

-- NFR-S8: erasure, retention and the export stay closed to every API caller -----------------------------------------------------
select is(
  (select string_agg(pg_temp.call_as(u, case when u is null then 'anon' else 'authenticated' end,
      'select public.account_ops_export_data(''00000000-0000-0000-0000-000000211101'')'), ',')
   from unnest(array[:'own1', :'own2', :'pa', :'pb', :'wa', :'w3', null]::uuid[]) u),
  rtrim(repeat('42501|permission denied for function account_ops_export_data|,', 7), ','),
  'NFR-S8: neither employer, partner, candidate nor a visitor reads an export'
);
select is(
  (select string_agg(pg_temp.call_as(u, case when u is null then 'anon' else 'authenticated' end, 'select private.apply_retention()'), ',')
   from unnest(array[:'own1', :'own2', :'pa', :'pb', :'wa', :'w3', null]::uuid[]) u),
  rtrim(repeat('42501|permission denied for function apply_retention|,', 7), ','),
  'NFR-S8: nor runs the retention job'
);
select is(
  (select string_agg(pg_temp.call_as(u, case when u is null then 'anon' else 'authenticated' end, format('select public.erase_user(%L)', :'wa')), ',')
   from unnest(array[:'own1', :'own2', :'pa', :'pb', :'wa', :'w3', null]::uuid[]) u),
  rtrim(repeat('42501|permission denied for function erase_user|,', 7), ','),
  'NFR-S8: nor erases an account'
);
select is(
  (select string_agg(pg_temp.call_as(u, case when u is null then 'anon' else 'authenticated' end,
      format('select count(*) from public.conversation_participants where user_id = %L', :'pseudonym')), ',')
   from unnest(array[:'own1', :'own2', :'pa', :'pb', :'wa', :'w3', null]::uuid[]) u),
  rtrim(repeat('42501|permission denied for table conversation_participants|,', 7), ','),
  'NFR-S9: the pseudonymised user_id stays unreadable through the Data API'
);
select ok(
  (select pg_get_triggerdef(t.oid) ~ 'BEFORE DELETE' and t.tgenabled = 'A' from pg_trigger t where t.tgname = 'messages_keep_moderated')
  and (select pg_get_triggerdef(t.oid) ~ 'BEFORE DELETE' and t.tgenabled = 'A' from pg_trigger t where t.tgname = 'contact_requests_keep_moderated'),
  'the tombstone triggers on messages and contact requests fire always, also under replication'
);
select is(
  (select count(*)::integer from pg_constraint where conrelid = 'public.conversation_participants'::regclass and contype = 'f'
     and confrelid = 'public.profiles'::regclass),
  0, 'the participant''s user id carries no foreign key, as the worker ids of applications and shares'
);

select * from finish();
rollback;
