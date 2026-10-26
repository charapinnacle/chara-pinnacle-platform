begin;
select plan(77);

\ir organizations_fixture.inc

-- The team of a recruitment or staffing company (V81, FR-J1 AC9, FR-A5; NFR-S8, NFR-A4): the Phase 1 invitation, role,
-- removal and ownership transfer functions on partner organisations, the release switch on invitations, the type of the
-- inviting organisation in the preview and the email, the members limit of the partner plans with its advisory lock, and
-- the reads of members, invitations and transfers across organisations of every kind.

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
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, review_status)
  values (v_id, p_type, 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8), 'PH',
    case when p_type <> 'employer' then 'onboarding'::public.partner_review_status end);
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.add_member(p_org uuid, p_user uuid, p_role public.member_role) returns void
language sql as $$
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_org, p_user, p_role, now())
$$;

create function pg_temp.subscribe(p_org uuid, p_plan text, p_status text default 'active') returns void
language sql as $$
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  values (p_org, p_plan, p_status, 'null')
$$;

-- Runs one statement as the user (anonymous when null) and returns 'ok' or 'sqlstate|message|detail'; the value of the
-- statement lands in t.result.
create function pg_temp.run(p_user uuid, p_sql text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((%s)::text, ''''), true)', p_sql), p_aal)
$$;

-- An invitation of p_org to p_email by p_user; its token lands in t.result.
create function pg_temp.invite(p_user uuid, p_org uuid, p_email text, p_role text default 'member', p_aal text default 'aal2')
returns text
language sql as $$
  select pg_temp.run(p_user, format('(select token from public.invite_member(%L, %L, %L))', p_org, p_email, p_role), p_aal)
$$;

-- Invites p_count new addresses; 'ok' or the first refusal.
create function pg_temp.fill(p_user uuid, p_org uuid, p_count integer) returns text
language plpgsql as $$
declare
  v_result text;
begin
  for i in 1..p_count loop
    v_result := pg_temp.invite(p_user, p_org, format('fill-%s-%s@example.test', left(p_org::text, 8), gen_random_uuid()));
    if v_result <> 'ok' then
      return v_result;
    end if;
  end loop;
  return 'ok';
end;
$$;

-- The rows of a table of p_org that a caller reads directly (anonymous when null), or the error.
create function pg_temp.seen(p_user uuid, p_table text, p_org uuid, p_aal text default 'aal2') returns text
language plpgsql as $$
declare
  v_result text;
begin
  v_result := pg_temp.run(p_user, format('(select count(*) from public.%I where organization_id = %L)', p_table, p_org), p_aal);
  return case when v_result = 'ok' then current_setting('t.result') else v_result end;
end;
$$;

create function pg_temp.role_of(p_org uuid, p_user uuid) returns text
language sql as $$
  select coalesce((select role::text from public.organization_members where organization_id = p_org and user_id = p_user), 'none')
$$;

\set rown '00000000-0000-0000-0000-0000000f0001'
\set radm '00000000-0000-0000-0000-0000000f0002'
\set rmem '00000000-0000-0000-0000-0000000f0003'
\set rnew '00000000-0000-0000-0000-0000000f0004'
\set rown2 '00000000-0000-0000-0000-0000000f0005'
\set sown '00000000-0000-0000-0000-0000000f0006'
\set snew '00000000-0000-0000-0000-0000000f0007'
\set pown '00000000-0000-0000-0000-0000000f0008'
\set qown '00000000-0000-0000-0000-0000000f0009'
\set fown '00000000-0000-0000-0000-0000000f000a'
\set lown '00000000-0000-0000-0000-0000000f000b'
\set cown '00000000-0000-0000-0000-0000000f000c'
\set wkr2 '00000000-0000-0000-0000-0000000f000d'
\set eown3 '00000000-0000-0000-0000-0000000f000e'

update private.settings set value = 'true' where key = 'release_partner_directories';
update private.settings set value = 'false' where key = 'entitlements_enforced';
select pg_temp.new_partner(:'rown', 'recruitment_company');
select pg_temp.new_partner(:'radm', 'recruitment_company');
select pg_temp.new_partner(:'rmem', 'recruitment_company');
select pg_temp.new_partner(:'rnew', 'recruitment_company');
select pg_temp.new_partner(:'rown2', 'recruitment_company');
select pg_temp.new_partner(:'sown', 'staffing_company');
select pg_temp.new_partner(:'snew', 'staffing_company');
select pg_temp.new_partner(:'pown', 'recruitment_company');
select pg_temp.new_partner(:'qown', 'staffing_company');
select pg_temp.new_partner(:'fown', 'staffing_company');
select pg_temp.new_partner(:'lown', 'recruitment_company');
select pg_temp.new_partner(:'cown', 'recruitment_company');
select pg_temp.new_user(:'wkr2', 'worker');
select pg_temp.new_user(:'eown3');
update public.profiles set account_kind = intended_account_kind where id in (:'own1', :'own2', :'wkr', :'wkr2', :'eown3');

select pg_temp.new_org(:'rown', 'recruitment_company') as org_r \gset
select pg_temp.new_org(:'rown2', 'recruitment_company') as org_r2 \gset
select pg_temp.new_org(:'sown', 'staffing_company') as org_s \gset
select pg_temp.new_org(:'own1', 'employer') as org_e1 \gset
select pg_temp.new_org(:'own2', 'employer') as org_e2 \gset
select pg_temp.add_member(:'org_r', :'radm', 'admin');
select pg_temp.add_member(:'org_r', :'rmem', 'member');

-- Invitations to a partner -----------------------------------------------------------------------------------------
select is(pg_temp.invite(:'rown', :'org_r', :'rnew' || '@partner.test'), 'ok', 'FR-A5: the owner of a recruitment company invites at aal2');
select set_config('t.tok_rnew', current_setting('t.result'), true) is not null as kept \gset
select is(
  (select count(*)::integer from audit.log where action = 'member_invited' and metadata ->> 'organization_id' = :'org_r'),
  1,
  'the invitation is audited with the organisation'
);
select is(
  (select payload ->> 'org_type' from public.notifications
   where kind = 'member_invitation' and payload ->> 'invitation_id' =
     (select id::text from public.organization_invitations where organization_id = :'org_r' and email = :'rnew' || '@partner.test')),
  'recruitment_company',
  'NFR-A3: the invitation email is queued in the same transaction and names the type of the organisation'
);
select is(pg_temp.invite(:'radm', :'org_r', :'snew' || '@partner.test'), 'ok', 'an admin of the partner invites');
select set_config('t.tok_snew', current_setting('t.result'), true) is not null as kept \gset
select is(pg_temp.invite(:'rmem', :'org_r', 'x1@example.test'), 'P0001|CHARA_FORBIDDEN|', 'a member of the partner cannot invite');
select is(
  pg_temp.invite(:'rown', :'org_r', 'x2@example.test', 'member', 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required',
  'FR-J1 AC9: the owner at aal1 is sent to two-step verification'
);
select is(
  pg_temp.invite(:'radm', :'org_r', 'x3@example.test', 'member', 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required',
  'FR-J1 AC9: an admin at aal1 is sent to two-step verification'
);
select is(pg_temp.invite(:'rown2', :'org_r', 'x4@example.test'), 'P0001|CHARA_FORBIDDEN|', 'NFR-S8: a competing partner cannot invite');
select is(pg_temp.invite(:'own1', :'org_r', 'x5@example.test'), 'P0001|CHARA_FORBIDDEN|', 'NFR-S8: an employer cannot invite to a partner');
select is(pg_temp.invite(:'wkr', :'org_r', 'x6@example.test'), 'P0001|CHARA_FORBIDDEN|', 'NFR-S8: a candidate cannot invite');
select is(
  split_part(pg_temp.invite(null, :'org_r', 'x7@example.test'), '|', 1),
  '42501',
  'NFR-S8: an anonymous caller cannot invite'
);
select is(pg_temp.invite(:'sown', :'org_r', 'x8@example.test'), 'P0001|CHARA_FORBIDDEN|', 'NFR-S8: a staffing company cannot invite to a recruitment company');

-- The preview names the type, so sign-up stores it as the intended organisation type.
select is(
  pg_temp.run(null, format('(select organization_type from public.invitation_preview(%L))', current_setting('t.tok_rnew'))) || ':' ||
    current_setting('t.result'),
  'ok:recruitment_company',
  'FR-J1: the preview gives an anonymous visitor the type of the inviting organisation'
);
select is(pg_temp.invite(:'own1', :'org_e1', 'emp1@example.test'), 'ok', 'an employer still invites');
select set_config('t.tok_emp', current_setting('t.result'), true) is not null as kept \gset
select is(
  pg_temp.run(null, format('(select organization_type from public.invitation_preview(%L))', current_setting('t.tok_emp'))) || ':' ||
    current_setting('t.result'),
  'ok:employer',
  'the preview of an employer invitation names the employer type'
);
select is(
  (select payload ->> 'org_type' from public.notifications
   where kind = 'member_invitation' and payload ->> 'invitation_id' =
     (select id::text from public.organization_invitations where organization_id = :'org_e1' and email = 'emp1@example.test')),
  'employer',
  'the email of an employer invitation names the employer type'
);

-- While release 2a is off ------------------------------------------------------------------------------------------
update private.settings set value = 'false' where key = 'release_partner_directories';
select is(
  pg_temp.invite(:'rown', :'org_r', 'off@example.test'),
  'P0001|CHARA_FORBIDDEN|release_off',
  'release 2a off: a partner cannot invite'
);
select is(
  pg_temp.invite(:'rmem', :'org_r', 'off2@example.test'),
  'P0001|CHARA_FORBIDDEN|',
  'release 2a off: a member is refused as a member, before the switch is named'
);
select is(pg_temp.invite(:'own1', :'org_e1', 'emp2@example.test'), 'ok', 'release 2a off: an employer still invites');
select is(
  pg_temp.run(null, format('(select count(*) from public.invitation_preview(%L))', current_setting('t.tok_rnew'))) || ':' ||
    current_setting('t.result'),
  'ok:0',
  'release 2a off: the invitation to a partner is not shown'
);
select is(
  pg_temp.run(null, format('(select count(*) from public.invitation_preview(%L))', current_setting('t.tok_emp'))) || ':' ||
    current_setting('t.result'),
  'ok:1',
  'release 2a off: the invitation of an employer is shown'
);
select is(
  pg_temp.run(:'rnew', format('public.accept_invitation(%L)', current_setting('t.tok_rnew')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|release_off',
  'release 2a off: an invitation to a partner cannot be accepted'
);
update private.settings set value = 'true' where key = 'release_partner_directories';

-- Accepting ---------------------------------------------------------------------------------------------------------
select is(
  pg_temp.run(:'snew', format('public.accept_invitation(%L)', current_setting('t.tok_snew')), 'aal1'),
  'P0001|CHARA_FORBIDDEN|organization_type_mismatch',
  'FR-J1: a staffing company account cannot join a recruitment company'
);
select is(
  pg_temp.run(:'own2', format('public.accept_invitation(%L)', current_setting('t.tok_rnew')), 'aal1'),
  'P0001|CHARA_INVITATION_INVALID|',
  'an invitation is accepted only by the address it was sent to'
);
select is(
  pg_temp.run(:'rnew', format('public.accept_invitation(%L)', current_setting('t.tok_rnew')), 'aal1'),
  'ok',
  'FR-A5: a recruitment company account joins the recruitment company at aal1'
);
select is(pg_temp.role_of(:'org_r', :'rnew'), 'member', 'the invitee is a member of the partner');

-- Role changes, removal and ownership transfer ----------------------------------------------------------------------
select is(
  pg_temp.run(:'rown', format('public.change_member_role(%L, %L, %L)', :'org_r', :'rmem', 'admin')),
  'ok',
  'the owner makes a member of the partner an admin'
);
select is(
  pg_temp.run(:'radm', format('public.change_member_role(%L, %L, %L)', :'org_r', :'rmem', 'member')),
  'ok',
  'an admin makes an admin a member again'
);
select is(
  pg_temp.run(:'rown', format('public.change_member_role(%L, %L, %L)', :'org_r', :'rmem', 'admin'), 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required',
  'FR-J1 AC9: a role change needs aal2'
);
select is(
  pg_temp.run(:'rmem', format('public.change_member_role(%L, %L, %L)', :'org_r', :'rnew', 'admin')),
  'P0001|CHARA_FORBIDDEN|',
  'a member cannot change roles'
);
select is(
  pg_temp.run(:'rown2', format('public.change_member_role(%L, %L, %L)', :'org_r', :'rmem', 'admin')),
  'P0001|CHARA_FORBIDDEN|',
  'NFR-S8: a competing partner cannot change a role'
);
select is(
  pg_temp.run(:'own1', format('public.remove_member(%L, %L)', :'org_r', :'rmem')),
  'P0001|CHARA_FORBIDDEN|',
  'NFR-S8: an employer cannot remove a member of a partner'
);
select is(
  pg_temp.run(:'radm', format('public.remove_member(%L, %L)', :'org_r', :'rown')),
  'P0001|CHARA_FORBIDDEN|cannot_remove_owner',
  'the owner of a partner cannot be removed'
);
select is(pg_temp.run(:'radm', format('public.remove_member(%L, %L)', :'org_r', :'rnew')), 'ok', 'an admin removes a member');
select is(pg_temp.role_of(:'org_r', :'rnew'), 'none', 'the removed member is gone');

select is(
  pg_temp.run(:'rown', format('public.accept_employer_pays_commitment(%L, %s)', :'org_r',
    (select version from public.v_legal_current where slug = 'employer-pays-commitment')), 'aal1'),
  'ok',
  'the owner accepts the employer-pays commitment'
);
select ok(private.partner_commitment_current(:'org_r'), 'the partner holds a current commitment');
select is(
  pg_temp.run(:'radm', format('public.transfer_ownership(%L, %L)', :'org_r', :'rmem')),
  'P0001|CHARA_FORBIDDEN|',
  'an admin cannot transfer the ownership'
);
select is(pg_temp.run(:'rown', format('public.transfer_ownership(%L, %L)', :'org_r', :'radm')), 'ok', 'the owner offers the ownership to an admin');
select is(
  pg_temp.run(:'rown2', format('public.accept_ownership_transfer(%L)', :'org_r')),
  'P0001|CHARA_FORBIDDEN|',
  'NFR-S8: a competing partner cannot accept the transfer'
);
select is(
  pg_temp.run(:'rmem', format('public.accept_ownership_transfer(%L)', :'org_r')),
  'P0001|CHARA_INVALID_INPUT|no_pending_transfer',
  'only the designated member accepts the transfer'
);
select is(pg_temp.run(:'radm', format('public.accept_ownership_transfer(%L)', :'org_r')), 'ok', 'the admin accepts and becomes the owner');
select is(
  pg_temp.role_of(:'org_r', :'radm') || ',' || pg_temp.role_of(:'org_r', :'rown'),
  'owner,admin',
  'the new owner owns the partner and the former owner is an admin'
);
select ok(
  not private.partner_commitment_current(:'org_r'),
  'DATA_MODEL open point 2: after the transfer the new owner must accept the commitment again'
);

-- The members limit of the partner plans (NFR-A4, DATA_MODEL.md section 8) -----------------------------------------
update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.new_org(:'pown', 'recruitment_company') as org_p \gset
select pg_temp.new_org(:'qown', 'staffing_company') as org_q \gset
select pg_temp.new_org(:'fown', 'staffing_company') as org_f \gset
select pg_temp.new_org(:'lown', 'recruitment_company') as org_l \gset
select pg_temp.new_org(:'eown3', 'employer') as org_e3 \gset
select pg_temp.subscribe(:'org_p', 'recruitment_partner');
select pg_temp.subscribe(:'org_q', 'staffing_professional');
select pg_temp.subscribe(:'org_e3', 'employer_starter');

select is(
  pg_temp.invite(:'pown', :'org_p', 'p1@example.test'),
  'P0001|CHARA_LIMIT_REACHED|members',
  'Basic counts the owner as its one team member'
);
select is(
  pg_temp.invite(:'fown', :'org_f', 'f1@example.test'),
  'P0001|CHARA_LIMIT_REACHED|members',
  'the free partner plan has no team members beyond the owner'
);
select is(
  pg_temp.invite(:'eown3', :'org_e3', 'e3@example.test'),
  'P0001|CHARA_LIMIT_REACHED|members',
  'an employer on Starter is refused as before'
);
select is(pg_temp.fill(:'qown', :'org_q', 4), 'ok', 'Professional takes the owner and four more');
select is(
  pg_temp.invite(:'qown', :'org_q', 'q-over@example.test'),
  'P0001|CHARA_LIMIT_REACHED|members',
  'Professional refuses the sixth team member'
);
select is(
  pg_temp.invite(:'qown', :'org_q', (select email::text from public.organization_invitations where organization_id = :'org_q' limit 1)),
  'ok',
  'a new invitation to an address already invited counts once'
);
select is(
  pg_temp.run(:'qown', format('(select member_limit || ''/'' || used from public.team_member_allowance(%L))', :'org_q'))
    || ':' || current_setting('t.result'),
  'ok:5/5',
  'the team page reads the limit and the team size'
);
select is(
  pg_temp.run(:'qown', format('(select used || ''/'' || limit_value || ''/'' || applies from public.org_usage(%L, array[''members'']))', :'org_q'))
    || ':' || current_setting('t.result'),
  'ok:5/5/true',
  'org_usage reports the members of a partner as the check counts them'
);
select is(
  (select count(*)::integer from audit.log where action = 'member_invited' and metadata ->> 'organization_id' = :'org_q'),
  5,
  'a refused invitation leaves no audit row'
);
update private.settings set value = 'false' where key = 'entitlements_enforced';
select pg_temp.subscribe(:'org_l', 'recruitment_partner', 'canceled');
select is(
  pg_temp.invite(:'lown', :'org_l', 'l1@example.test'),
  'P0001|CHARA_LIMIT_REACHED|members',
  'a partner lapsed to its free plan is held to it while limits are not enforced'
);
select is(pg_temp.invite(:'qown', :'org_q', 'q-free@example.test'), 'ok', 'without enforcement a paying partner is not limited');

-- Concurrency at the boundary (NFR-A4) ------------------------------------------------------------------------------
update private.settings set value = 'true' where key = 'entitlements_enforced';
select pg_temp.new_org(:'cown', 'recruitment_company') as org_c \gset
select pg_temp.subscribe(:'org_c', 'recruitment_professional');
select pg_temp.subscribe(:'org_s', 'staffing_enterprise');
-- Open invitations written directly, as invite_member leaves them: an invitation sent through it would hold the members
-- lock of the organisation until the end of this test's transaction.
insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by)
select :'org_c', format('c%s@example.test', n), 'member', encode(sha256(convert_to('c-token-' || n, 'UTF8')), 'hex'), :'cown'
from generate_series(1, 3) n;
select is(private.team_size(:'org_c'), 4, 'the partner holds 4 of its 5 team places');
create extension if not exists dblink schema extensions;
select extensions.dblink_connect('holder',
  format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select is(
  (select l from extensions.dblink('holder',
    format('select pg_advisory_lock(hashtextextended(%L, 0))::text', 'organization_members:' || :'org_c'))
    as t (l text)),
  '',
  'a second session holds the members lock of the partner'
);
set local lock_timeout = '300ms';
select is(
  split_part(pg_temp.invite(:'cown', :'org_c', 'c-wait@example.test'), '|', 1),
  '55P03',
  'NFR-A4: the fifth team member waits for the invitation in progress'
);
select is(pg_temp.invite(:'sown', :'org_s', 's-free@example.test'), 'ok', 'NFR-A4: an invitation of another organisation does not wait');
select l from extensions.dblink('holder',
  format('select pg_advisory_unlock(hashtextextended(%L, 0))::text', 'organization_members:' || :'org_c')) as t (l text);
select extensions.dblink_disconnect('holder');
reset lock_timeout;
select is(
  pg_temp.invite(:'cown', :'org_c', 'c-fifth@example.test') || ',' || pg_temp.invite(:'cown', :'org_c', 'c-sixth@example.test'),
  'ok,P0001|CHARA_LIMIT_REACHED|members',
  'NFR-A4: once the other invitation is over the fifth goes through and the sixth is refused'
);
select is(private.team_size(:'org_c'), 5, 'NFR-A4: the partner ends at its limit of 5, never above');
update private.settings set value = 'false' where key = 'entitlements_enforced';

-- Reads across organisations (NFR-S8): two employers, two partners, two candidates and anonymous -------------------
select is(pg_temp.seen(:'radm', 'organization_members', :'org_r'), '3', 'the owner of the partner reads its members');
select is(pg_temp.seen(:'rmem', 'organization_members', :'org_r', 'aal1'), '3', 'a member of the partner reads its members at aal1');
select is(
  pg_temp.seen(:'rown2', 'organization_members', :'org_r') || ',' || pg_temp.seen(:'sown', 'organization_members', :'org_r')
    || ',' || pg_temp.seen(:'own1', 'organization_members', :'org_r') || ',' || pg_temp.seen(:'own2', 'organization_members', :'org_r')
    || ',' || pg_temp.seen(:'wkr', 'organization_members', :'org_r') || ',' || pg_temp.seen(:'wkr2', 'organization_members', :'org_r'),
  '0,0,0,0,0,0',
  'NFR-S8: no other partner, employer or candidate reads the members of a partner'
);
select is(
  pg_temp.seen(:'rown', 'organization_members', :'org_e1') || ',' || pg_temp.seen(:'sown', 'organization_members', :'org_e2'),
  '0,0',
  'NFR-S8: a partner reads no member of an employer'
);
select is(
  split_part(pg_temp.seen(null, 'organization_members', :'org_r'), '|', 1),
  '42501',
  'NFR-S8: an anonymous caller reads no members'
);
select is(pg_temp.seen(:'radm', 'organization_invitations', :'org_r'), '2', 'the owner reads the invitations of the partner, accepted and open');
select is(pg_temp.seen(:'rmem', 'organization_invitations', :'org_r'), '0', 'a member of the partner reads no invitation');
select is(
  pg_temp.seen(:'rown2', 'organization_invitations', :'org_r') || ',' || pg_temp.seen(:'sown', 'organization_invitations', :'org_r')
    || ',' || pg_temp.seen(:'own1', 'organization_invitations', :'org_r') || ',' || pg_temp.seen(:'own2', 'organization_invitations', :'org_r')
    || ',' || pg_temp.seen(:'wkr', 'organization_invitations', :'org_r') || ',' || pg_temp.seen(:'wkr2', 'organization_invitations', :'org_r'),
  '0,0,0,0,0,0',
  'NFR-S8: nobody outside the partner reads its invitations'
);
select is(
  pg_temp.seen(:'own1', 'organization_invitations', :'org_e1') || ',' || pg_temp.seen(:'rown', 'organization_invitations', :'org_e1'),
  '2,0',
  'NFR-S8: an employer reads its own invitations and a partner none of them'
);
select is(pg_temp.run(:'radm', format('public.transfer_ownership(%L, %L)', :'org_r', :'rown')), 'ok', 'the new owner offers the ownership back');
select is(
  pg_temp.seen(:'radm', 'organization_ownership_transfers', :'org_r') || ',' || pg_temp.seen(:'rown', 'organization_ownership_transfers', :'org_r', 'aal1')
    || ',' || pg_temp.seen(:'rmem', 'organization_ownership_transfers', :'org_r') || ',' || pg_temp.seen(:'rown2', 'organization_ownership_transfers', :'org_r')
    || ',' || pg_temp.seen(:'own1', 'organization_ownership_transfers', :'org_r') || ',' || pg_temp.seen(:'wkr', 'organization_ownership_transfers', :'org_r'),
  '2,1,0,0,0,0',
  'NFR-S8: the transfers of a partner are read by its owner and the designated member only'
);
select is(
  pg_temp.run(:'sown', format('(select count(*) from public.list_organization_members(%L))', :'org_r')),
  'P0001|CHARA_FORBIDDEN|',
  'NFR-S8: another partner cannot list the team'
);
select is(
  pg_temp.run(:'rmem', format('(select count(*) from public.list_organization_members(%L))', :'org_r'), 'aal1') || ':' ||
    current_setting('t.result'),
  'ok:3',
  'a member lists the team of the partner'
);
select is(
  pg_temp.run(:'own1', format('(select count(*) from public.list_organization_invitations(%L))', :'org_r')),
  'P0001|CHARA_FORBIDDEN|',
  'NFR-S8: an employer cannot list the invitations of a partner'
);
select is(
  pg_temp.run(:'rown2', format('(select used from public.team_member_allowance(%L))', :'org_r')),
  'P0001|CHARA_FORBIDDEN|',
  'NFR-S8: a competing partner cannot read the team size'
);
select is(
  pg_temp.run(:'wkr2', format('(select organization_type from public.invitation_preview(%L))', current_setting('t.tok_snew')))
    || ':' || current_setting('t.result'),
  'ok:recruitment_company',
  'the preview needs the token and gives nothing else about the organisation'
);

select * from finish();
rollback;
