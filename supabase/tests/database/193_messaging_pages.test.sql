begin;
select plan(17);

\ir apply_fixture.inc

-- The messaging pages, data (V65, FR-P1 AC10, AC11; NFR-P4, NFR-S8, NFR-O5): list_conversations by context and page, the
-- rows named for the page only, and message_body_max_chars among the public settings. Acme (t.a: owner own1, admin adm,
-- member mem) and Beta (t.b: owner own2, admin adm2) are the employers of the fixture; wa and wb the candidates; Rekrut
-- and Second, made below, the partner companies.

\set padm '00000000-0000-0000-0000-0000000f6511'
\set u2 '00000000-0000-0000-0000-0000000f6512'
\set st_admin '00000000-0000-0000-0000-0000000f6513'

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

-- The ids p_user lists (p_args after p_org, as SQL), in the order answered.
create function pg_temp.ids(p_user uuid, p_org uuid, p_args text default '', p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.read_as(p_user, format('select coalesce(string_agg(id::text, '','' order by n), '''') from public.list_conversations(%L%s) with ordinality t(id, a, b, c, d, e, f, g, h, i, j, n)',
    p_org, p_args), p_aal)
$$;

-- The fixture --------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'entitlements_enforced';
update private.settings set value = '100000' where key in ('rate_limit_audited_write_max', 'rate_limit_org_audited_write_max');
update private.settings set value = 'true' where key = 'release_messaging';
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
select pg_temp.new_user(:'padm') as seeded \gset
select pg_temp.new_user(:'u2') as seeded \gset
select pg_temp.new_user(:'st_admin') as seeded \gset
update public.profiles set account_kind = intended_account_kind where id in (:'padm', :'u2', :'st_admin');
insert into public.platform_staff (user_id, role) values (:'st_admin', 'admin');

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

select pg_temp.partner('rekrut-v65', 'Rekrut', :'padm') as rek \gset
select pg_temp.partner('second-v65', 'Second', :'u2') as sec \gset

insert into public.workforce_requirements (
  organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, employment_type,
  recruitment_preference, partner_need, status, visibility, show_identity, published_at, closes_on
) values (
  :'acme', 'Acme welders', 10, 'DE', 'Hamburg', 'C', current_date + 60, 'full_time', 'both', 'both', 'open',
  'job_order_marketplace', true, now() - interval '10 days', current_date + 90
) returning id as r \gset
insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (:'r', '7212', 10);
insert into public.requirement_countries (requirement_id, country_code) values (:'r', 'DE');
insert into public.requirement_invitations (requirement_id, organization_id, employer_organization_id, status, source, answered_at)
values (:'r', :'rek', :'acme', 'accepted', 'directory', now()) returning id as inv_rek \gset
insert into public.partner_responses (
  requirement_id, organization_id, employer_organization_id, capacity, available_from, experience_note, fee_model
) values (:'r', :'sec', :'acme', 5, current_date + 60, 'Twenty welders placed in Hamburg last year.', 'on_request')
returning id as resp \gset
insert into public.candidate_submissions (
  requirement_id, organization_id, employer_organization_id, invited_email, worker_user_id, status, decided_at,
  worker_approved_at, passport_share_id, profile_snapshot
) values (:'r', :'rek', :'acme', 'bruno@seed.test', :'wb', 'submitted', now(), now(), gen_random_uuid(),
  '{"first_name": "Bruno", "last_name": "Silva"}') returning id as sub \gset

select pg_temp.open_job('Welder Hamburg') as job \gset
select pg_temp.open_job('Beta welder', :'beta') as bjob \gset
select pg_temp.apply_as(:'wa', :'job') as applied \gset
select current_setting('t.app') as app \gset
select pg_temp.apply_as(:'wa', :'bjob') as applied \gset
select current_setting('t.app') as app_beta \gset

select pg_temp.open(:'adm', 'application', :'app') as c_app \gset
select pg_temp.open(:'padm', 'requirement_invitation', :'inv_rek') as c_inv \gset
select pg_temp.open(:'u2', 'partner_response', :'resp') as c_resp \gset
select pg_temp.open(:'adm', 'candidate_submission', :'sub') as c_sub \gset
select pg_temp.open(:'adm2', 'application', :'app_beta') as c_beta \gset
update public.conversations set last_message_at = now() - interval '1 hour' * x.n
from (values (:'c_sub'::uuid, 1), (:'c_resp'::uuid, 2), (:'c_inv'::uuid, 3), (:'c_app'::uuid, 4), (:'c_beta'::uuid, 5)) x(id, n)
where conversations.id = x.id;
insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body, created_at)
values (:'c_app', :'wa', null, 'Can I start in March?', now() - interval '4 hours'),
  (:'c_inv', :'padm', :'rek', 'Twenty welders are ready.', now() - interval '3 hours');

-- Structure ------------------------------------------------------------------------------------------------------------------

select is(
  (select string_agg(p.oid::regprocedure::text, ',') from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'list_conversations'
     and p.prosecdef and p.proconfig @> array['search_path=""']
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute')),
  'list_conversations(uuid,timestamp with time zone,uuid,integer,conversation_context)',
  'one list_conversations, with the context filter, security definer with an empty search path, for authenticated callers only');
select is(
  (select value from public.get_public_settings() where key = 'message_body_max_chars'), '4000',
  'NFR-O5: the composer reads the length of a message from the public settings');

-- The context filter and the page ------------------------------------------------------------------------------------------

select is(pg_temp.ids(:'adm', :'acme'), concat_ws(',', :'c_sub', :'c_resp', :'c_inv', :'c_app'),
  'FR-P1 AC10: the inbox of Acme, latest message first');
select is(
  pg_temp.ids(:'adm', :'acme', ', null, null, 20, ''application''') || ';'
    || pg_temp.ids(:'adm', :'acme', ', null, null, 20, ''requirement_invitation''') || ';'
    || pg_temp.ids(:'adm', :'acme', ', null, null, 20, ''partner_response''') || ';'
    || pg_temp.ids(:'adm', :'acme', ', null, null, 20, ''candidate_submission''') || ';'
    || pg_temp.ids(:'adm', :'acme', ', null, null, 20, ''inquiry'''),
  concat_ws(';', :'c_app', :'c_inv', :'c_resp', :'c_sub', ''),
  'the inbox filters by context, and a context without conversations lists none');
select is(
  pg_temp.ids(:'adm', :'acme', ', null, null, 2') || ';'
    || pg_temp.ids(:'adm', :'acme', format(', %L, %L, 2', (select last_message_at from public.conversations where id = :'c_resp'), :'c_resp')),
  concat_ws(',', :'c_sub', :'c_resp') || ';' || concat_ws(',', :'c_inv', :'c_app'),
  'the next page starts after the last row of the page before');
select is(
  pg_temp.ids(:'adm', :'acme', format(', %L, %L, 20, ''application''', (select last_message_at from public.conversations where id = :'c_sub'), :'c_sub')),
  :'c_app', 'the filter and the page combine');
select is(
  pg_temp.read_as(:'adm', format($$select string_agg(concat_ws('|', id, context_type, organization_id, counterpart_kind, counterpart_name,
      context_title, unread, coalesce(read_only_reason, '-')), ';' order by id) from public.list_conversations(%L)$$, :'acme')),
  pg_temp.read_as(:'adm', format($$select string_agg(concat_ws('|', g.id, g.context_type, g.organization_id, g.counterpart_kind,
      g.counterpart_name, g.context_title, g.unread, coalesce(g.read_only_reason, '-')), ';' order by g.id)
    from unnest(array[%L, %L, %L, %L]::uuid[]) c(id) cross join lateral public.get_conversation(c.id) g$$,
    :'c_app', :'c_inv', :'c_resp', :'c_sub')),
  'FR-P1 AC11: each row of the list is the header get_conversation answers for it');
select is(
  pg_temp.read_as(:'adm', format($$select concat_ws('|', counterpart_name, context_title, unread) from public.list_conversations(%L, null, null, 20, 'application')$$, :'acme')),
  'Amina Okafor|Welder Hamburg|1', 'FR-P1 AC11: the candidate by name, the vacancy and the unread message');
select is(
  pg_temp.ids(:'wa', null, '', 'aal1') || ';' || pg_temp.ids(:'wb', null, ', null, null, 20, ''candidate_submission''', 'aal1')
    || ';' || pg_temp.ids(:'wb', null, ', null, null, 20, ''application''', 'aal1'),
  concat_ws(',', :'c_app', :'c_beta') || ';' || :'c_sub' || ';',
  'a candidate lists the own conversations, by context too');
select is(pg_temp.ids(:'padm', :'rek') || ';' || pg_temp.ids(:'u2', :'sec'), :'c_inv' || ';' || :'c_resp',
  'each partner company lists its own conversation');

-- Who lists what (NFR-S8) -----------------------------------------------------------------------------------------------------

select is(
  pg_temp.ids(:'adm2', :'acme', ', null, null, 20, ''application''') || ';' || pg_temp.ids(:'own2', :'beta')
    || ';' || pg_temp.ids(:'u2', :'rek') || ';' || pg_temp.ids(:'padm', :'sec'),
  '42501|CHARA_FORBIDDEN|;' || :'c_beta' || ';42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|',
  'NFR-S8: another employer and another partner list nothing of Acme or of each other, with the filter too');
select is(
  pg_temp.ids(:'own2', null) || ';' || pg_temp.ids(:'padm', null) || ';' || pg_temp.ids(:'st_admin', null) || ';'
    || pg_temp.ids(:'st_admin', :'acme'),
  ';;;42501|CHARA_FORBIDDEN|',
  'NFR-S8: a company user and staff list no candidate conversations, and staff none of an organisation');
select is(pg_temp.ids(null, null), '42501|permission denied for function list_conversations|',
  'NFR-S8: an anonymous caller is refused for lack of grants');
select is(pg_temp.ids(:'adm', :'acme', ', null, null, 20, ''application''', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'an admin at aal1 is sent to two-step verification, as for applicant data');

-- NFR-P4: the list stays fast with many conversations --------------------------------------------------------------------------

insert into public.conversations (id, context_type, context_id, requirement_id, created_at, last_message_at)
select gen_random_uuid(), 'partner_response', gen_random_uuid(), :'r', now() - interval '2 days', now() - interval '1 day' - interval '1 second' * g
from generate_series(1, 10000) g;
insert into public.conversation_participants (conversation_id, organization_id)
select c.id, :'acme' from public.conversations c where c.context_type = 'partner_response' and c.id <> :'c_resp';
analyze public.conversations;
analyze public.conversation_participants;
select is(
  pg_temp.read_as(:'adm', format($$select count(*) from public.list_conversations(%L, %L, %L)$$, :'acme',
    (select last_message_at from public.conversations where id = :'c_app'), :'c_app')),
  '20', 'NFR-P4: with 10,000 conversations a page after the cursor holds 20 rows');

create function pg_temp.list_ms() returns numeric
language plpgsql as $$
declare
  v_start timestamptz;
  v_count integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.adm'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;
  v_start := clock_timestamp();
  select count(*) into v_count from public.list_conversations(current_setting('t.acme')::uuid);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return extract(epoch from clock_timestamp() - v_start) * 1000;
end;
$$;
select set_config('t.adm', :'adm', true), set_config('t.acme', :'acme', true);
select cmp_ok(pg_temp.list_ms(), '<', 500::numeric, 'NFR-P4: the first page of an inbox of 10,000 conversations within 500 ms of server time');

-- The switch -------------------------------------------------------------------------------------------------------------

update private.settings set value = 'false' where key = 'release_messaging';
select is(pg_temp.ids(:'adm', :'acme', ', null, null, 20, ''application'''), '42501|CHARA_FORBIDDEN|release_off',
  'with release_messaging off the list refuses');

select * from finish();
rollback;
