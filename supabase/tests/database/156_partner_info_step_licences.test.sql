begin;
select plan(7);

\ir organizations_fixture.inc

-- A request for information about the licences (V78, FR-J4 with FR-J2): admin_decide_partner accepts the step licences,
-- stores it on the organisation and the decision, and partner_review_outcome returns it to the partner's members.

create function pg_temp.new_partner(p_id uuid) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (p_id, p_id || '@partner.test', now(),
    jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', 'recruitment_company'));
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

create function pg_temp.new_org(p_owner uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, website,
    legal_entity_identifier, legal_entity_identifier_kind)
  values (v_id, 'recruitment_company', 'org-' || left(v_id::text, 8), 'Org ' || left(v_id::text, 8) || ' Inc.',
    'Org ' || left(v_id::text, 8), 'PH', 'https://' || left(v_id::text, 8) || '.example',
    'ID' || upper(left(replace(v_id::text, '-', ''), 10)), 'registration_number');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations set review_status = 'pending_review', submitted_at = now() - interval '1 day' where id = v_id;
  return v_id;
end;
$$;

create function pg_temp.decide(p_user uuid, p_org uuid, p_step text) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format('select set_config(''t.result'', public.admin_decide_partner(%L, %L, %L, %L)::text, true)',
      p_org, 'request_info', 'Please add the licence you hold for Germany.', p_step))
$$;

create function pg_temp.outcome(p_user uuid, p_org uuid) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format($q$select set_config('t.result', coalesce((select concat_ws('|', decision, coalesce(info_step, '-'))
      from public.partner_review_outcome(%L)), 'none'), true)$q$, p_org))
$$;

\set ts '00000000-0000-0000-0000-0000000f5601'
\set ow '00000000-0000-0000-0000-0000000f5602'
\set ow2 '00000000-0000-0000-0000-0000000f5603'

update private.settings set value = 'true' where key = 'release_partner_directories';
select pg_temp.new_partner(id) from unnest(array[:'ow', :'ow2']::uuid[]) id;
select pg_temp.new_user(:'ts');
insert into public.platform_staff (user_id, role) values (:'ts', 'trust_safety');
select pg_temp.new_org(:'ow') as p1 \gset
select pg_temp.new_org(:'ow2') as p2 \gset

select is(pg_temp.decide(:'ts', :'p1', 'licences'), 'ok', 'a Trust & Safety Administrator requests information about the licences');
select is(
  (select concat_ws('|', review_status, info_step) from public.organizations where id = :'p1'),
  'info_requested|licences',
  'the organisation is info_requested with the step licences'
);
select is(
  (select concat_ws('|', decision, info_step) from public.partner_review_decisions where organization_id = :'p1'),
  'request_info|licences',
  'the decision records the step licences'
);
select is(pg_temp.outcome(:'ow', :'p1'), 'ok', 'the owner reads the outcome');
select is(current_setting('t.result'), 'request_info|licences', 'and it names the step licences');
select is(pg_temp.decide(:'ts', :'p2', 'security'), 'P0001|CHARA_INVALID_INPUT|info_step',
  'any other unknown step is still refused');
select throws_ok(
  format('update public.organizations set info_step = %L where id = %L', 'payment', :'p2'),
  '23514', null, 'the column accepts company, where_you_serve, commitments and licences only'
);

select * from finish();
rollback;
