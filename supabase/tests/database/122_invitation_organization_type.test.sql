begin;
select plan(6);

\ir organizations_fixture.inc

-- Partners join only organisations of their own type (V05, FR-J1, FR-A5): accept_invitation refuses an invitation of
-- another organisation type than the intended type of the account.

create function pg_temp.new_partner(p_id uuid, p_type text) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', p_type));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

-- An open invitation of p_org by its owner for the address of p_user; the token is p_token.
create function pg_temp.invite(p_org uuid, p_owner uuid, p_user uuid, p_token text) returns void
language sql as $$
  insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by)
  select p_org, u.email, 'member', encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), p_owner
  from auth.users u where u.id = p_user
$$;


\set rc1 '00000000-0000-0000-0000-0000000d0001'
\set rc2 '00000000-0000-0000-0000-0000000d0002'
\set sc1 '00000000-0000-0000-0000-0000000d0003'

update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(:'rc1', 'recruitment_company');
select pg_temp.new_partner(:'rc2', 'recruitment_company');
select pg_temp.new_partner(:'sc1', 'staffing_company');

select pg_temp.call_as(:'own1', 'authenticated',
  $$select set_config('t.emp', (public.create_organization('employer', 'Boundary Employer GmbH', null, 'DE', 'F'))->>'organization_id', true)$$,
  'aal1') as setup_emp \gset
select pg_temp.call_as(:'rc1', 'authenticated',
  $$select set_config('t.rec', (public.create_organization('recruitment_company', 'Boundary Recruitment Ltd', null, 'PH', 'N',
    null, 'BOUND1234', 'other', p_description => 'We recruit welders and electricians from the Philippines for employers in Germany.'))->>'organization_id', true)$$, 'aal1') as setup_rec \gset

-- Invitations ------------------------------------------------------------------------------------------------------
select pg_temp.invite(current_setting('t.emp')::uuid, :'own1', :'rc2', 'token-partner-to-employer');
select pg_temp.invite(current_setting('t.rec')::uuid, :'rc1', :'own2', 'token-employer-to-partner');
select pg_temp.invite(current_setting('t.rec')::uuid, :'rc1', :'sc1', 'token-staffing-to-recruitment');
select pg_temp.invite(current_setting('t.rec')::uuid, :'rc1', :'rc2', 'token-recruitment-to-recruitment');

select is(
  pg_temp.call_as(:'rc2', 'authenticated', $$select public.accept_invitation('token-partner-to-employer')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|organization_type_mismatch',
  'a recruitment company account cannot join an employer'
);
select is(
  pg_temp.call_as(:'own2', 'authenticated', $$select public.accept_invitation('token-employer-to-partner')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|organization_type_mismatch',
  'an employer account cannot join a recruitment company'
);
select is(
  pg_temp.call_as(:'sc1', 'authenticated', $$select public.accept_invitation('token-staffing-to-recruitment')$$, 'aal1'),
  'P0001|CHARA_FORBIDDEN|organization_type_mismatch',
  'a staffing company account cannot join a recruitment company'
);
select is(
  (select count(*)::integer from public.organization_members where user_id in (:'rc2', :'own2', :'sc1')
     and organization_id in (current_setting('t.emp')::uuid, current_setting('t.rec')::uuid)),
  0,
  'the refused invitations add no member'
);
select is(
  pg_temp.call_as(:'rc2', 'authenticated', $$select public.accept_invitation('token-recruitment-to-recruitment')$$, 'aal1'),
  'ok',
  'a recruitment company account joins a recruitment company'
);
select is(
  (select count(*)::integer from public.organization_invitations
   where accepted_at is null and token_hash = encode(sha256(convert_to('token-partner-to-employer', 'UTF8')), 'hex')),
  1,
  'a refused invitation stays open'
);

select * from finish();
rollback;
