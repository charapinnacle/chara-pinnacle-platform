begin;
select plan(130);

\ir jobs_fixture.inc

-- Versions of workforce requirements, change notices and closing notices to the partners involved (V43, FR-M2 AC6 partner
-- part, AC8, AC10 closing notice; FR-T1; SOP P2-16 steps Edit and Expire, outputs change notifications and expiry
-- reminders, control versioned edits with notifications; decisions 3.2, 3.5; NFR-S8, NFR-S11, NFR-A3, NFR-O5):
-- public.requirement_versions, the version written by save_requirement, list_requirement_versions,
-- list_invitation_changes, the kinds requirement_changed and requirement_closed, requirement_closing_soon to partners and
-- the setting requirement_change_notice_minutes. Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner own2,
-- admin adm2) are employers of the fixture and wkr is a candidate; the partners are made below.

\set u1 '00000000-0000-0000-0000-0000000f4311'
\set u1a '00000000-0000-0000-0000-0000000f4312'
\set u1m '00000000-0000-0000-0000-0000000f4313'
\set u1s '00000000-0000-0000-0000-0000000f4314'
\set u2 '00000000-0000-0000-0000-0000000f4321'
\set u3 '00000000-0000-0000-0000-0000000f4331'
\set u4 '00000000-0000-0000-0000-0000000f4341'
\set u5 '00000000-0000-0000-0000-0000000f4351'
\set u6 '00000000-0000-0000-0000-0000000f4361'
\set u7 '00000000-0000-0000-0000-0000000f4371'
\set u8 '00000000-0000-0000-0000-0000000f4381'

update private.settings set value = 'true' where key = 'release_job_orders';
update private.settings set value = 'false' where key = 'entitlements_enforced';
select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
update public.profiles set display_name = 'Ada Admin' where id = :'adm';

-- A listed recruitment company owned by p_owner.
create function pg_temp.partner(p_slug text, p_owner uuid) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, 'recruitment_company', p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  return v_id;
end;
$$;

create function pg_temp.member(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql as $$
begin
  perform pg_temp.new_user(p_user);
  update public.profiles set account_kind = intended_account_kind where id = p_user;
  insert into public.organization_members (organization_id, user_id, role, accepted_at)
  values (p_org, p_user, p_role::public.member_role, now());
end;
$$;

-- A requirement of p_org as the lifecycle functions leave it: 100 workers of 7212 from 1 March 2027, salary 2500 to 3400
-- EUR a month, closing on 1 April 2027 unless p_closes says otherwise.
create function pg_temp.req(p_org uuid, p_title text, p_status text default 'open', p_closes date default null) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_published boolean := p_status <> 'draft';
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, skills, start_date,
    duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, recruitment_preference,
    partner_need, status, visibility, published_at, closes_on, close_reason, updated_at
  ) values (
    v_id, p_org, p_title, 100, 'DE', 'Hamburg', 'C', 'MIG/MAG welding', date '2027-03-01', 12, 'full_time', 2500, 3400, 'EUR',
    'month', 'both', 'both', p_status::public.requirement_status,
    case when v_published then 'private'::public.requirement_visibility end,
    case when v_published then now() - interval '10 days' end,
    case when v_published then coalesce(p_closes, date '2027-04-01') end,
    case p_status when 'closed' then 'cancelled' when 'filled' then 'filled' end::public.requirement_close_reason,
    now() - interval '1 day'
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 100);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;

create function pg_temp.seed_inv(p_req uuid, p_partner uuid, p_status text default 'invited', p_at timestamptz default now())
returns uuid
language sql as $$
  insert into public.requirement_invitations (
    requirement_id, organization_id, employer_organization_id, status, source, invited_at, viewed_at, answered_at,
    responded_at, withdrawn_at, expired_at
  )
  select p_req, p_partner, r.organization_id, p_status::public.invitation_status, 'directory', p_at,
    case when p_status <> 'invited' then p_at end,
    case when p_status in ('accepted', 'declined', 'responded') then p_at end,
    case when p_status = 'responded' then p_at end,
    case when p_status = 'withdrawn' then p_at end,
    case when p_status = 'expired' then p_at end
  from public.workforce_requirements r where r.id = p_req
  returning id
$$;

-- save_requirement by p_user on the requirement p_req of Acme with the seeded values, except the ones in p_over
-- (workers, quantity, salary_min, salary_max, title).
create function pg_temp.save(p_user uuid, p_req uuid, p_over jsonb default '{}') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format(
    $f$select public.save_requirement(
      p_org => %L, p_requirement => %L, p_workers_needed => %s, p_country_code => 'DE', p_city_region => 'Hamburg',
      p_industry_code => 'C', p_occupations => %L::jsonb, p_start_date => date '2027-03-01',
      p_employment_type => 'full_time', p_recruitment_preference => 'both', p_partner_need => 'both',
      p_accommodation => false, p_work_permit_support => false, p_visa_support => false, p_title => %L,
      p_skills => 'MIG/MAG welding', p_duration_months => 12::smallint, p_salary_min => %s, p_salary_max => %s,
      p_salary_currency => 'EUR', p_salary_period => 'month', p_expected_updated_at => %L::timestamptz)$f$,
    r.organization_id, r.id, coalesce(p_over ->> 'workers', '100'),
    jsonb_build_array(jsonb_build_object('occupation_id', '7212', 'quantity', coalesce((p_over ->> 'workers')::integer, 100))),
    coalesce(p_over ->> 'title', r.title), coalesce(p_over ->> 'salary_min', '2500'), coalesce(p_over ->> 'salary_max', '3400'),
    r.updated_at))
  from public.workforce_requirements r where r.id = p_req
$$;

-- The users with a row of p_kind about p_inv, sorted, as user:status.
create function pg_temp.told(p_kind text, p_inv uuid) returns text
language sql as $$
  select coalesce(string_agg(n.user_id::text || ':' || n.status, ',' order by n.user_id), '')
  from public.notifications n where n.kind = p_kind and n.payload ->> 'invitation_id' = p_inv::text
$$;

create function pg_temp.kind_count(p_kind text) returns integer
language sql as $$ select count(*)::integer from public.notifications where kind = p_kind $$;

-- A query run as the user: its single value, or 'sqlstate|message|detail' when refused.
create function pg_temp.read_as(p_user uuid, p_sql text) returns text
language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_message text;
  v_detail text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text end, true);
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

select pg_temp.partner('p1-v43', :'u1') as p1 \gset
select pg_temp.member(:'p1', :'u1a', 'admin');
select pg_temp.member(:'p1', :'u1m', 'member');
select pg_temp.member(:'p1', :'u1s', 'admin');
update public.profiles set status = 'suspended' where id = :'u1s';
select pg_temp.partner('p2-v43', :'u2') as p2 \gset
select pg_temp.partner('p3-v43', :'u3') as p3 \gset
select pg_temp.partner('p4-v43', :'u4') as p4 \gset
select pg_temp.partner('p5-v43', :'u5') as p5 \gset
select pg_temp.partner('p6-v43', :'u6') as p6 \gset
select pg_temp.partner('p7-v43', :'u7') as p7 \gset
select pg_temp.partner('p8-v43', :'u8') as p8 \gset
update public.organizations set status = 'suspended' where id = :'p8';

-- Schema ------------------------------------------------------------------------------------------------------------------

select has_table('public', 'requirement_versions', 'public.requirement_versions exists');
select col_is_pk('public', 'requirement_versions', array['requirement_id', 'version'], 'one row per requirement and version');
select is(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.requirement_versions'::regclass), true,
  'NFR-S8: row-level security is enabled and forced');
select is(
  (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'requirement_versions' and grantee in ('anon', 'authenticated')),
  'SELECT', 'authenticated may only select; anon has no grant; nobody writes through the API');
select is(
  (select string_agg(kind || ':' || mandatory || ':' || default_email || ':' || organization_types::text, ',' order by kind)
   from private.notification_kinds where kind in ('requirement_changed', 'requirement_closed', 'requirement_closing_soon')),
  'requirement_changed:false:true:{recruitment_company,staffing_company},requirement_closed:false:true:{recruitment_company,staffing_company},requirement_closing_soon:false:true:{employer,recruitment_company,staffing_company}',
  'the two new kinds are optional with email on for partners; the closing reminder reaches partners too');
select is((select value #>> '{}' from private.settings where key = 'requirement_change_notice_minutes'), '15',
  'NFR-O5: the change notice waits 15 minutes by default (settings editor)');
select is((select format('%s..%s', min, max) from private.setting_rules where key = 'requirement_change_notice_minutes'), '0..1440',
  'with its bounds in the settings editor');

-- AC8: an edit of an open requirement is versioned and announced -----------------------------------------------------------

select pg_temp.req(:'acme', 'Acme welders') as r \gset
select pg_temp.seed_inv(:'r', :'p1', 'invited') as i1 \gset
select pg_temp.seed_inv(:'r', :'p2', 'accepted') as i2 \gset
select pg_temp.seed_inv(:'r', :'p3', 'declined') as i3 \gset
select pg_temp.seed_inv(:'r', :'p4', 'withdrawn') as i4 \gset
select pg_temp.seed_inv(:'r', :'p7', 'responded') as i7 \gset
select pg_temp.seed_inv(:'r', :'p8', 'viewed') as i8 \gset
select pg_temp.seed_inv(:'r', :'p6', 'viewed', now() + interval '1 minute') as i6 \gset

select is(pg_temp.save(:'adm', :'r', '{"workers": 120, "salary_max": 3600}'), 'ok',
  'AC8: the admin changes workers_needed 100 -> 120 (with the quantity) and salary_max 3400 -> 3600');
select is(
  (select format('%s|%s|%s|%s', version, changed_fields, status, changed_by) from public.requirement_versions where requirement_id = :'r'),
  format('1|{workers_needed,occupations,salary_max}|open|%s', :'adm'),
  'AC8: one version names the changed fields in the order of the form, the status and who saved it');
select is(
  (select old_values from public.requirement_versions where requirement_id = :'r'),
  jsonb_build_object('workers_needed', 100, 'salary_max', 3400,
    'occupations', jsonb_build_array(jsonb_build_object('code', '7212', 'name', (select label from public.occupations where code = '7212'), 'quantity', 100))),
  'AC8: it holds the old values (the occupations with their names)');
select is(
  (select new_values -> 'workers_needed' || (new_values -> 'salary_max') from public.requirement_versions where requirement_id = :'r'),
  '[120, 3600]'::jsonb, 'and the new values');
select is(
  (select metadata -> 'changed_fields' from audit.log where action = 'requirement.updated' and entity_id = :'r'),
  '["salary_max", "workers_needed", "occupations"]'::jsonb, 'the requirement.updated audit row of V32 is unchanged');
select is(pg_temp.told('requirement_changed', :'i1'), format('%s:queued,%s:queued', :'u1', :'u1a'),
  'AC8: one requirement_changed for the owner and the admin of the invited P1 (not its member, not its suspended admin)');
select is(pg_temp.told('requirement_changed', :'i2'), :'u2' || ':queued', 'AC8: and for the owner of the accepted P2');
select is(pg_temp.told('requirement_changed', :'i7'), :'u7' || ':queued', 'and for the owner of P7, which responded');
select is(pg_temp.told('requirement_changed', :'i3') || '|' || pg_temp.told('requirement_changed', :'i4'), '|',
  'AC8: none for the declined P3 or the withdrawn P4');
select is(pg_temp.told('requirement_changed', :'i8'), '', 'none for a suspended partner');
select is(
  (select count(*)::integer from public.notifications where kind = 'requirement_changed'
     and user_id in (:'own1', :'adm', :'mem', :'own2', :'adm2', :'u5', :'wkr')),
  0, 'none for the employer, another employer, a partner that is not invited or a candidate');
select is(
  (select string_agg(k, ',' order by k) from public.notifications n, jsonb_object_keys(n.payload) k
   where n.user_id = :'u1' and n.kind = 'requirement_changed'),
  'changed_fields,employer_name,from_version,invitation_id,org_slug,title,to_version',
  'NFR-S11: the payload names the invitation, the title and the employer it revealed, the fields and the versions only');
select is(
  (select payload -> 'changed_fields' from public.notifications where user_id = :'u1' and kind = 'requirement_changed'),
  '["workers_needed", "occupations", "salary_max"]'::jsonb, 'AC8: naming the changed fields, never their values');
select is(
  (select format('%s|%s|%s', payload ->> 'title', payload ->> 'employer_name', payload ->> 'org_slug')
   from public.notifications where user_id = :'u1' and kind = 'requirement_changed'),
  'Acme welders|Acme Bau|p1-v43', 'the requirement''s own title, the employer and the recipient''s own slug');
select is(
  (select count(*)::integer from pgmq.q_notifications
   where message ->> 'kind' = 'requirement_changed' and vt > now() + interval '14 minutes'),
  5, 'NFR-A3: five messages (P1 twice, P2, P7, P6) queued in the transaction, held back by requirement_change_notice_minutes');

-- Coalescing --------------------------------------------------------------------------------------------------------------

select is(pg_temp.save(:'adm', :'r', '{"workers": 120, "salary_max": 3600, "salary_min": 2600}'), 'ok',
  'a second edit within the window changes salary_min');
select is((select string_agg(version || ':' || changed_fields::text, ',' order by version) from public.requirement_versions
           where requirement_id = :'r'), '1:{workers_needed,occupations,salary_max},2:{salary_min}', 'it is version 2');
select is(pg_temp.kind_count('requirement_changed'), 5, 'coalescing: no new notice while the first one waits');
select is((select count(*)::integer from pgmq.q_notifications where message ->> 'kind' = 'requirement_changed'), 5,
  'and no new message');
select is(
  (select format('%s|%s|%s', payload -> 'changed_fields', payload ->> 'from_version', payload ->> 'to_version')
   from public.notifications where user_id = :'u1' and kind = 'requirement_changed'),
  '["workers_needed", "occupations", "salary_min", "salary_max"]|1|2',
  'coalescing: the waiting notice now names every field of versions 1 and 2, which its email will carry');
update public.notifications set read_at = now() where user_id = :'u1' and kind = 'requirement_changed';
select is(pg_temp.save(:'adm', :'r', '{"workers": 120, "salary_max": 3600, "salary_min": 2600, "title": "Acme welders 2027"}'),
  'ok', 'a third edit changes the title');
select is(
  (select string_agg(payload ->> 'from_version' || '-' || (payload ->> 'to_version'), ',' order by payload ->> 'from_version')
   from public.notifications where user_id = :'u1' and kind = 'requirement_changed'),
  '1-2,3-3', 'coalescing: a recipient who read the waiting notice gets a new one');
select is(
  (select payload ->> 'to_version' from public.notifications where user_id = :'u1a' and kind = 'requirement_changed'), '3',
  'the others'' waiting notices widen to version 3');
-- A message the notify function may already hold is never widened: its visibility time has passed (or it was read).
update pgmq.q_notifications set vt = clock_timestamp() - interval '1 minute' where message ->> 'kind' = 'requirement_changed';
select is(pg_temp.save(:'adm', :'r', '{"workers": 120, "salary_max": 3700, "salary_min": 2600, "title": "Acme welders 2027"}'),
  'ok', 'a fourth edit once the waiting emails are visible to the notify function ...');
select is(pg_temp.kind_count('requirement_changed'), 11, '... is a new notice for each recipient, none widened');
select is(
  (select count(*)::integer from pgmq.q_notifications
   where message ->> 'kind' = 'requirement_changed' and message ->> 'to_version' = '4' and vt > now() + interval '14 minutes'),
  5, 'and those emails are held back again');
update private.settings set value = '0' where key = 'requirement_change_notice_minutes';
update public.notifications set read_at = now() where kind = 'requirement_changed';
select is(pg_temp.save(:'adm', :'r', '{"workers": 120, "salary_max": 3800, "salary_min": 2600, "title": "Acme welders 2027"}'),
  'ok', 'with requirement_change_notice_minutes 0 a fifth edit ...');
select is(
  (select count(*)::integer from pgmq.q_notifications
   where message ->> 'kind' = 'requirement_changed' and message ->> 'to_version' = '5' and vt <= clock_timestamp()),
  5, '... sends its emails without holding them back');
update private.settings set value = '15' where key = 'requirement_change_notice_minutes';
update public.notifications set read_at = now() where kind = 'requirement_changed';
insert into public.notification_preferences (user_id, email_kinds) values (:'u2', '{"requirement_changed": false}')
on conflict (user_id) do update set email_kinds = excluded.email_kinds;
select is(pg_temp.save(:'adm', :'r', '{"workers": 120, "salary_max": 3900, "salary_min": 2600, "title": "Acme welders 2027"}'),
  'ok', 'a sixth edit ...');
select is(
  (select string_agg(status || ':' || coalesce(email_status, '-'), ',') from public.notifications
   where user_id = :'u2' and kind = 'requirement_changed' and payload ->> 'from_version' = '6'),
  'suppressed:suppressed_by_preference', '... reaches P2''s owner, who turned the email off, in the app only');
select is(pg_temp.save(:'adm', :'r', '{"workers": 120, "salary_max": 4000, "salary_min": 2600, "title": "Acme welders 2027"}'),
  'ok', 'a seventh edit within the window ...');
select is(
  (select string_agg(payload ->> 'from_version' || '-' || (payload ->> 'to_version'), ',') from public.notifications
   where user_id = :'u2' and kind = 'requirement_changed' and read_at is null),
  '6-7', '... widens P2''s in-app notice too');
update public.notifications set created_at = now() - interval '16 minutes'
where user_id = :'u2' and kind = 'requirement_changed' and read_at is null;
select is(pg_temp.save(:'adm', :'r', '{"workers": 120, "salary_max": 4100, "salary_min": 2600, "title": "Acme welders 2027"}'),
  'ok', 'an eighth edit once that window has passed ...');
select is(
  (select string_agg(payload ->> 'from_version' || '-' || (payload ->> 'to_version'), ',' order by payload ->> 'from_version')
   from public.notifications where user_id = :'u2' and kind = 'requirement_changed' and read_at is null),
  '6-7,8-8', '... is a new notice for P2''s owner');
select is(
  (select payload ->> 'from_version' || '-' || (payload ->> 'to_version') from public.notifications
   where user_id = :'u1' and kind = 'requirement_changed' and read_at is null),
  '6-8', 'while the others'' emails still wait and carry versions 6 to 8');

-- Edits that write no version ------------------------------------------------------------------------------------------------

select is(pg_temp.save(:'adm', :'r', '{"workers": 120, "salary_max": 4100, "salary_min": 2600, "title": "Acme welders 2027"}'),
  'ok', 'a save that changes nothing ...');
select is((select max(version) from public.requirement_versions where requirement_id = :'r'), 8, '... writes no version');
select pg_temp.req(:'acme', 'Acme draft', 'draft') as rd \gset
select is(pg_temp.save(:'adm', :'rd', '{"workers": 120}'), 'ok', 'AC8: the admin edits a draft');
select is((select count(*)::integer from public.requirement_versions where requirement_id = :'rd'), 0,
  'AC8: a draft edit writes no version (and so no notice)');
select pg_temp.req(:'acme', 'Acme filled', 'filled') as rf \gset
select pg_temp.req(:'acme', 'Acme closed', 'closed') as rc \gset
select is(pg_temp.save(:'adm', :'rf', '{"workers": 120}'), 'P0001|CHARA_INVALID_STATE|filled',
  'AC8: editing a filled requirement fails with CHARA_INVALID_STATE');
select is(pg_temp.save(:'adm', :'rc', '{"workers": 120}'), 'P0001|CHARA_INVALID_STATE|closed',
  'AC8: editing a closed requirement fails with CHARA_INVALID_STATE');
select is((select count(*)::integer from public.requirement_versions where requirement_id in (:'rf', :'rc')), 0, 'and writes nothing');
select is(pg_temp.save(:'mem', :'r', '{"workers": 130}'), 'P0001|CHARA_FORBIDDEN|', 'a member cannot edit');
select is(pg_temp.save(:'adm2', :'r', '{"workers": 130}'), 'P0001|CHARA_FORBIDDEN|', 'nor can an admin of Beta');
select is((select max(version) from public.requirement_versions where requirement_id = :'r'), 8, 'no version from a refused edit');
select pg_temp.req(:'acme', 'Acme paused', 'paused') as rp \gset
select pg_temp.seed_inv(:'rp', :'p1', 'accepted') as ip1 \gset
select is(pg_temp.save(:'adm', :'rp', '{"workers": 110}'), 'ok', 'an edit of a paused requirement ...');
select is(
  (select format('%s|%s', status, changed_fields) from public.requirement_versions where requirement_id = :'rp'),
  'paused|{workers_needed,occupations}', '... is versioned with the status paused');
select is(pg_temp.told('requirement_changed', :'ip1'), format('%s:queued,%s:queued', :'u1', :'u1a'), '... and announced');
update private.settings set value = 'false' where key = 'release_job_orders';
select is(private.queue_requirement_change(:'r', 1), 0, 'release 2b off: no change notice is queued');
update private.settings set value = 'true' where key = 'release_job_orders';

-- Who reads the versions (NFR-S8) ------------------------------------------------------------------------------------------

select is(pg_temp.read_as(:'mem', format('select count(*)::text from public.requirement_versions where requirement_id = %L', :'r')),
  '8', 'NFR-S8: a member of Acme reads the eight versions');
select is(pg_temp.read_as(:'adm2', 'select count(*)::text from public.requirement_versions'), '0',
  'NFR-S8: an admin of Beta reads none of Acme''s versions');
select is(pg_temp.read_as(:'u1', 'select count(*)::text from public.requirement_versions'), '0',
  'NFR-S8: the invited partner reads no version through the table');
select is(pg_temp.read_as(:'u5', 'select count(*)::text from public.requirement_versions'), '0',
  'NFR-S8: a partner that is not invited reads none');
select is(pg_temp.read_as(:'wkr', 'select count(*)::text from public.requirement_versions'), '0', 'NFR-S8: a candidate reads none');
select alike(pg_temp.read_as(null, 'select count(*)::text from public.requirement_versions'), '42501|%',
  'NFR-S8: anonymous has no grant (42501)');
select alike(
  pg_temp.call_as(:'adm', 'authenticated', format(
    $$insert into public.requirement_versions (requirement_id, version, organization_id, status, changed_fields, old_values, new_values)
      values (%L, 9, %L, 'open', '{title}', '{}', '{}')$$, :'r', :'acme')),
  '42501|%', 'append-only: an admin of Acme cannot insert');
select alike(
  pg_temp.call_as(:'adm', 'authenticated', format('delete from public.requirement_versions where requirement_id = %L', :'r')),
  '42501|%', 'append-only: nor delete');
select is(
  pg_temp.call_as(null, 'postgres', format(
    $$update public.requirement_versions set old_values = '{}' where requirement_id = %L and version = 1$$, :'r')),
  'P0001|CHARA_INVALID_INPUT|append_only', 'append-only: even the table owner cannot change a version');
select is(
  pg_temp.call_as(null, 'postgres', format(
    'update public.requirement_versions set changed_by = null where requirement_id = %L and version = 8', :'r')),
  'ok', 'only changed_by may become null (the erasure of the member)');

-- list_requirement_versions ---------------------------------------------------------------------------------------------------

select is(
  pg_temp.read_as(:'mem', format(
    $$select string_agg(version || ':' || changed_by_member || ':' || coalesce(changed_by_name, '-'), ',' order by n)
      from (select *, row_number() over () as n from public.list_requirement_versions(%L, %L)) s$$, :'acme', :'r')),
  '8:false:-,7:true:Ada Admin,6:true:Ada Admin,5:true:Ada Admin,4:true:Ada Admin,3:true:Ada Admin,2:true:Ada Admin,1:true:Ada Admin',
  'a member of Acme reads every version, newest first, with the name of who saved it (none once erased)');
update public.profiles set display_name = null where id = :'adm';
select email as adm_email from auth.users where id = :'adm' \gset
select is(
  pg_temp.read_as(:'mem', format($$select coalesce(changed_by_name, '-') from public.list_requirement_versions(%L, %L) where version = 7$$, :'acme', :'r'))
    || ';' || pg_temp.read_as(:'adm', format($$select changed_by_name = %L
      from public.list_requirement_versions(%L, %L) where version = 7$$, :'adm_email', :'acme', :'r')),
  '-;true', 'a colleague without a name: a plain member reads none, an owner or admin reads the email the team page shows them');
update public.profiles set display_name = 'Ada Admin' where id = :'adm';
select is(
  pg_temp.read_as(:'mem', format(
    $$select old_values::text from public.list_requirement_versions(%L, %L) where version = 2$$, :'acme', :'r')),
  '{"salary_min": 2500.00}', 'with the old values');
select is(pg_temp.read_as(:'adm2', format('select count(*)::text from public.list_requirement_versions(%L, %L)', :'acme', :'r')),
  '42501|CHARA_FORBIDDEN|', 'an admin of Beta naming Acme is refused');
select is(pg_temp.read_as(:'adm2', format('select count(*)::text from public.list_requirement_versions(%L, %L)', :'beta', :'r')),
  'P0002|CHARA_NOT_FOUND|', 'naming Beta with Acme''s requirement finds nothing');
select is(pg_temp.read_as(:'u1', format('select count(*)::text from public.list_requirement_versions(%L, %L)', :'acme', :'r')),
  '42501|CHARA_FORBIDDEN|', 'the invited partner is refused');
select is(pg_temp.read_as(:'u1', format('select count(*)::text from public.list_requirement_versions(%L, %L)', :'p1', :'r')),
  '42501|CHARA_FORBIDDEN|employer_only', 'even naming its own company');
select is(pg_temp.read_as(:'wkr', format('select count(*)::text from public.list_requirement_versions(%L, %L)', :'acme', :'r')),
  '42501|CHARA_FORBIDDEN|', 'a candidate is refused');
select alike(pg_temp.read_as(null, format('select count(*)::text from public.list_requirement_versions(%L, %L)', :'acme', :'r')),
  '42501|%', 'anonymous has no execute grant');
update private.settings set value = 'false' where key = 'release_job_orders';
select is(pg_temp.read_as(:'mem', format('select count(*)::text from public.list_requirement_versions(%L, %L)', :'acme', :'r')),
  '42501|CHARA_FORBIDDEN|release_off', 'release 2b off: refused');
update private.settings set value = 'true' where key = 'release_job_orders';

-- list_invitation_changes -------------------------------------------------------------------------------------------------------

select is(
  pg_temp.read_as(:'u1m', format(
    $$select string_agg(version::text, ',' order by n) from (select *, row_number() over () as n
      from public.list_invitation_changes(%L, %L)) s$$, :'p1', :'i1')),
  '8,7,6,5,4,3,2,1', 'a member of the invited P1 reads the changes since the invitation, newest first');
select is(
  pg_temp.read_as(:'u1m', format(
    $$select new_values::text from public.list_invitation_changes(%L, %L) where version = 1$$, :'p1', :'i1')),
  (select new_values::text from public.requirement_versions where requirement_id = :'r' and version = 1),
  'with the old and new values');
select is(
  (select string_agg(a, ',' order by a) from unnest(
    (select proargnames from pg_proc where oid = 'public.list_invitation_changes(uuid, uuid)'::regprocedure)) a
   where a not like 'p\_%'),
  'changed_fields,created_at,new_values,old_values,version', 'never who changed it (no member data to a partner)');
select is(pg_temp.read_as(:'u6', format('select count(*)::text from public.list_invitation_changes(%L, %L)', :'p6', :'i6')),
  '0', 'a partner invited after the edits reads none of them');
select is(pg_temp.read_as(:'u3', format('select count(*)::text from public.list_invitation_changes(%L, %L)', :'p3', :'i3')),
  '0', 'the declined P3 reads no change');
select is(pg_temp.read_as(:'u4', format('select count(*)::text from public.list_invitation_changes(%L, %L)', :'p4', :'i4')),
  '0', 'nor does the withdrawn P4');
select is(pg_temp.read_as(:'u5', format('select count(*)::text from public.list_invitation_changes(%L, %L)', :'p5', :'i1')),
  'P0002|CHARA_NOT_FOUND|', 'a competing partner naming P1''s invitation finds nothing');
select is(pg_temp.read_as(:'u5', format('select count(*)::text from public.list_invitation_changes(%L, %L)', :'p1', :'i1')),
  '42501|CHARA_FORBIDDEN|', 'and is refused naming P1');
select is(pg_temp.read_as(:'adm', format('select count(*)::text from public.list_invitation_changes(%L, %L)', :'acme', :'i1')),
  '42501|CHARA_FORBIDDEN|partner_only', 'the employer reads its history through its own function');
select is(pg_temp.read_as(:'wkr', format('select count(*)::text from public.list_invitation_changes(%L, %L)', :'p1', :'i1')),
  '42501|CHARA_FORBIDDEN|', 'a candidate is refused');
select alike(pg_temp.read_as(null, format('select count(*)::text from public.list_invitation_changes(%L, %L)', :'p1', :'i1')),
  '42501|%', 'anonymous has no execute grant');

-- AC10: the closing notice, on every close path ----------------------------------------------------------------------------

select is(
  pg_temp.call_as(:'own1', 'authenticated', format(
    'select public.set_requirement_status(%L, %L, ''closed'', %L::timestamptz, ''cancelled'')', :'acme', :'r',
    (select updated_at from public.workforce_requirements where id = :'r'))),
  'ok', 'the owner closes the requirement as cancelled');
select is(pg_temp.told('requirement_closed', :'i1'), format('%s:queued,%s:queued', :'u1', :'u1a'),
  'AC10: requirement_closed for the owner and the admin of the invited P1');
select is(
  (select string_agg(status || ':' || coalesce(email_status, '-'), ',') from public.notifications
   where user_id = :'u1' and kind = 'requirement_changed' and read_at is null and payload ->> 'invitation_id' = :'i1'),
  'suppressed:suppressed_superseded', 'the change notice still waiting for its email is not emailed after the close (in the app it stays)');
select is(
  (select count(*)::integer from public.notifications where kind = 'requirement_changed' and status = 'queued'
     and payload ->> 'invitation_id' in (:'i1', :'i2', :'i6')),
  0, 'no change email is left to send for the invitations that expired with the close');
select is(
  (select count(*)::integer > 0 from public.notifications where kind = 'requirement_changed' and status = 'queued'
     and payload ->> 'invitation_id' = :'i7'),
  true, 'P7, which responded, keeps its change emails: its invitation does not expire');
select ok(position('v_row.status <> ''queued''' in pg_get_functiondef('public.notify_dequeue(integer)'::regprocedure)) > 0,
  'notify_dequeue sends only queued rows, so a suppressed one is dropped');
select is(pg_temp.told('requirement_closed', :'i2') || '|' || pg_temp.told('requirement_closed', :'i7') || '|'
    || pg_temp.told('requirement_closed', :'i6'),
  format('%s:queued|%s:queued|%s:queued', :'u2', :'u7', :'u6'), 'for the accepted, the responded and the viewed partners');
select is(pg_temp.told('requirement_closed', :'i3') || '|' || pg_temp.told('requirement_closed', :'i4'), '|',
  'none for the declined or withdrawn partners');
select is(
  (select string_agg(k || '=' || coalesce(n.payload ->> k, ''), ',' order by k) from public.notifications n,
     jsonb_object_keys(n.payload) k where n.user_id = :'u1' and n.kind = 'requirement_closed'),
  format('close_reason=cancelled,employer_name=Acme Bau,invitation_id=%s,org_slug=p1-v43,title=Acme welders 2027', :'i1'),
  'the payload: the invitation, the title, the employer, the reason and the recipient''s slug');
select is((select status::text from public.requirement_invitations where id = :'i1'), 'expired',
  'the invitation itself expired (V41)');
select is(pg_temp.read_as(:'u1', format('select count(*)::text from public.list_invitation_changes(%L, %L)', :'p1', :'i1')),
  '0', 'an expired invitation shows no change any more');
select is(pg_temp.read_as(:'mem', format('select count(*)::text from public.list_requirement_versions(%L, %L)', :'acme', :'r')),
  '8', 'the employer still reads the history of a closed requirement');

select pg_temp.req(:'acme', 'Acme withdrawing') as rw \gset
select pg_temp.seed_inv(:'rw', :'p1', 'invited') as iw \gset
select is(pg_temp.save(:'adm', :'rw', '{"workers": 90}'), 'ok', 'an edit of a requirement with an invitation to P1 ...');
select is(pg_temp.told('requirement_changed', :'iw'), format('%s:queued,%s:queued', :'u1', :'u1a'), '... queues its change notice');
select is(
  pg_temp.call_as(:'own1', 'authenticated', format('select public.withdraw_invitation(%L, %L)', :'acme', :'iw')),
  'ok', 'the owner withdraws the invitation within the window');
select is(pg_temp.told('requirement_changed', :'iw'),
  format('%s:suppressed,%s:suppressed', :'u1', :'u1a'), 'its waiting change notice is not emailed');
select is(pg_temp.told('invitation_withdrawn', :'iw'), format('%s:queued,%s:queued', :'u1', :'u1a'),
  'the withdrawal notice is queued instead');
select pg_temp.req(:'acme', 'Acme filling') as rfi \gset
select pg_temp.seed_inv(:'rfi', :'p1', 'accepted') as ifi \gset
select is(
  pg_temp.call_as(:'own1', 'authenticated', format(
    'select public.set_requirement_status(%L, %L, ''filled'', %L::timestamptz)', :'acme', :'rfi',
    (select updated_at from public.workforce_requirements where id = :'rfi'))),
  'ok', 'the owner marks a requirement filled');
select is(
  (select string_agg(payload ->> 'close_reason', ',') from public.notifications where kind = 'requirement_closed'
     and payload ->> 'invitation_id' = :'ifi'),
  'filled,filled', 'its partners are told it was filled');

select pg_temp.req(:'acme', 'Acme expiring', 'open', (now() at time zone 'utc')::date - 1) as rx \gset
select pg_temp.seed_inv(:'rx', :'p2', 'invited') as ix \gset
select pg_temp.req(:'acme', 'Acme paused expiring', 'paused', (now() at time zone 'utc')::date - 1) as rpx \gset
select pg_temp.seed_inv(:'rpx', :'p2', 'accepted') as ipx \gset
select is(private.close_expired_requirements() >= 2, true, 'the daily close closes the open and the paused requirement past their date');
select is(
  (select string_agg(payload ->> 'close_reason', ',') from public.notifications where kind = 'requirement_closed'
     and payload ->> 'invitation_id' in (:'ix', :'ipx')),
  'expired,expired', 'the partners of both are told they closed (expired)');
select is(private.close_expired_requirements(), 0, 'a second run closes nothing ...');
select is(pg_temp.kind_count('requirement_closed'), 9, '... and tells nobody again');

update private.settings set value = 'false' where key = 'release_job_orders';
select pg_temp.req(:'acme', 'Acme off') as roff \gset
select pg_temp.seed_inv(:'roff', :'p2', 'invited') as ioff \gset
select set_config('chara.actor_fn', 'close_expired_requirements', true) as actor \gset
update public.workforce_requirements set status = 'closed' where id = :'roff';
select set_config('chara.actor_fn', '', true) as actor \gset
select is(pg_temp.told('requirement_closed', :'ioff'), '', 'release 2b off: no closing notice');
update private.settings set value = 'true' where key = 'release_job_orders';

-- AC6 (partner part): the closing reminder ----------------------------------------------------------------------------------

delete from public.notifications where kind = 'requirement_closing_soon';
select pg_temp.req(:'acme', 'Acme closing soon', 'open', (now() at time zone 'utc')::date + 7) as rs \gset
select pg_temp.seed_inv(:'rs', :'p1', 'invited') as s1 \gset
select pg_temp.seed_inv(:'rs', :'p2', 'accepted') as s2 \gset
select pg_temp.seed_inv(:'rs', :'p3', 'declined') as s3 \gset
select pg_temp.seed_inv(:'rs', :'p4', 'withdrawn') as s4 \gset
select pg_temp.req(:'acme', 'Acme paused closing soon', 'paused', (now() at time zone 'utc')::date + 3) as rsp \gset
select pg_temp.seed_inv(:'rsp', :'p7', 'responded') as s7 \gset
select is(private.remind_closing_requirements(), 2, 'AC6: the reminder finds the open and the paused requirement');
select is(pg_temp.told('requirement_closing_soon', :'s1'), format('%s:queued,%s:queued', :'u1', :'u1a'),
  'AC6: the owner and the admin of the invited P1 are reminded');
select is(pg_temp.told('requirement_closing_soon', :'s2') || '|' || pg_temp.told('requirement_closing_soon', :'s7'),
  format('%s:queued|%s:queued', :'u2', :'u7'), 'AC6: so are the accepted P2 and P7, which responded (paused requirement)');
select is(pg_temp.told('requirement_closing_soon', :'s3') || '|' || pg_temp.told('requirement_closing_soon', :'s4'), '|',
  'AC6: the declined P3 and the withdrawn P4 receive nothing');
select is(
  (select count(*)::integer from public.notifications where kind = 'requirement_closing_soon' and user_id in (:'own1', :'adm')),
  4, 'the employer''s owner and admin are reminded of both, as before');
select is(
  (select string_agg(k || '=' || coalesce(n.payload ->> k, ''), ',' order by k) from public.notifications n,
     jsonb_object_keys(n.payload) k where n.user_id = :'u1' and n.kind = 'requirement_closing_soon'),
  format('closes_on=%s,invitation_id=%s,org_slug=p1-v43,requirement_id=%s,title=Acme closing soon',
    (now() at time zone 'utc')::date + 7, :'s1', :'rs'),
  'AC6: the partner''s payload holds the requirement id, its title, closes_on and the link to its invitation; no employer name');
select is(private.remind_closing_requirements(), 0, 'AC6: a second run the same day queues nothing');
select is(pg_temp.kind_count('requirement_closing_soon'), 8, 'AC6: no new row');

-- Paused by a lapse: kept open by the daily job and not reminded; the backlog of employer pauses -----------------------------

select pg_temp.req(:'beta', 'Beta lapse', 'open', (now() at time zone 'utc')::date - 1) as rlap \gset
select pg_temp.seed_inv(:'rlap', :'p1', 'invited') as ilap \gset
select pg_temp.req(:'beta', 'Beta lapse soon', 'open', (now() at time zone 'utc')::date + 3) as rlaps \gset
select pg_temp.req(:'beta', 'Beta employer paused', 'paused', (now() at time zone 'utc')::date - 1) as remp \gset
select pg_temp.req(:'beta', 'Beta employer paused soon', 'paused', (now() at time zone 'utc')::date + 3) as remps \gset
select private.pause_requirements_on_lapse(:'beta');
select is(
  (select string_agg(title || ':' || status, ',' order by title) from public.workforce_requirements where id in (:'rlap', :'rlaps')),
  'Beta lapse:paused,Beta lapse soon:paused', 'the lapse pauses Beta''s open requirements');
select is(private.requirement_paused_by_lapse(:'rlap') || ',' || private.requirement_paused_by_lapse(:'remp'), 'true,false',
  'the newest status change tells a lapse pause from the employer''s');
select is(private.close_expired_requirements(), 1, 'the daily close closes the employer-paused requirement past its date ...');
select is(
  (select string_agg(title || ':' || status, ',' order by title) from public.workforce_requirements where id in (:'rlap', :'remp')),
  'Beta employer paused:closed,Beta lapse:paused', '... and keeps the one paused by the lapse');
select is((select status::text from public.requirement_invitations where id = :'ilap'), 'invited',
  'the invitation of the lapse-paused requirement stays (the employer may extend and reopen after subscribing again)');
select is(private.remind_closing_requirements(), 1, 'the reminder finds the employer-paused requirement closing in 3 days only');
select is(
  (select string_agg(payload ->> 'title', ',') from public.notifications where kind = 'requirement_closing_soon' and user_id = :'own2'),
  'Beta employer paused soon', 'the lapse-paused one closing in 3 days is not reminded');
select pg_temp.req(:'beta', 'Beta backlog', 'paused', (now() at time zone 'utc')::date - 5) as rbl \gset
update public.workforce_requirements set closes_on = (now() at time zone 'utc')::date - 5 where id = :'rlap';
select is(private.shift_paused_close_backlog(), 1, 'the backlog shift moves the employer-paused requirement past its date ...');
select is(
  (select string_agg(title || ':' || (closes_on - (now() at time zone 'utc')::date), ',' order by title)
   from public.workforce_requirements where id in (:'rbl', :'rlap')),
  'Beta backlog:7,Beta lapse:-5', '... to today plus requirement_closing_reminder_days, and leaves the lapse-paused one');
select is(
  (select format('%s|%s|%s', count(*), bool_and(actor_id is null), min(metadata ->> 'reason'))
   from audit.log where action = 'requirement.extended' and entity_id = :'rbl'),
  '1|t|paused_close_introduced', 'one audit row requirement.extended with the reason paused_close_introduced');
select is(private.shift_paused_close_backlog(), 0, 'a second run moves nothing');

select * from finish();
rollback;
