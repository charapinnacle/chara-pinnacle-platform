begin;
select plan(151);

\ir status_fixture.inc

-- Saved partners, follows, the follower count and the follower digest (V24, FR-L4 AC1 to AC8, FR-K5 AC7, FR-P2 AC8 save
-- and follow part; NFR-S8 with two employers, two partners, two candidates and anon; DATA_MODEL.md sections 6, 7, 9, 10).
-- Acme (t.a: owner own1, admin adm, member mem) and Beta (t.b: owner own2, admin adm2) are employers of the fixture; wa
-- and wb are candidates. The partners and the extra followers are made below.

create function pg_temp.result() returns jsonb
language sql as $$ select current_setting('t.result')::jsonb $$;

-- Runs one statement as the user (anonymous when null) and returns 'ok' or 'sqlstate|message|detail'; the rows land in
-- t.result as one JSON array.
create function pg_temp.run(p_user uuid, p_sql text) returns text
language sql as $$
  select pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select jsonb_agg(to_jsonb(r)) from (%s) r)::text, ''[]''), true)', p_sql),
    'aal1')
$$;

create function pg_temp.save_as(p_user uuid, p_partner uuid, p_extra text default '') returns text
language sql as $$ select pg_temp.run(p_user, format('select public.toggle_saved_partner(%L%s) as saved', p_partner, p_extra)) $$;

create function pg_temp.follow_as(p_user uuid, p_org uuid, p_extra text default '') returns text
language sql as $$ select pg_temp.run(p_user, format('select public.toggle_follow(%L%s) as following', p_org, p_extra)) $$;

create function pg_temp.audits(p_org uuid, p_action text) returns bigint
language sql as $$ select count(*) from audit.log where action = p_action and entity_id = p_org::text $$;

-- A recruitment or staffing company with an owner; listed unless p_review says otherwise.
create function pg_temp.partner(p_id uuid, p_owner uuid, p_type text, p_slug text, p_review text default 'listed') returns void
language plpgsql as $$
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (p_id, p_type::public.organization_type, p_slug, initcap(p_slug) || ' Holdings Ltd', initcap(p_slug), 'PH');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_id, p_owner, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code) values (p_id, 'serves_market', 'DE');
  update public.organizations
  set review_status = p_review::public.partner_review_status, submitted_at = now(),
      listed_at = case when p_review = 'listed' then now() end
  where id = p_id;
end;
$$;

-- A candidate account.
create function pg_temp.worker(p_id uuid) returns void
language sql as $$
  select pg_temp.new_user(p_id, 'worker');
  update public.profiles set account_kind = intended_account_kind where id = p_id;
$$;

\set delta '00000000-0000-0000-0000-0000000f2401'
\set gamma '00000000-0000-0000-0000-0000000f2402'
\set kappa '00000000-0000-0000-0000-0000000f2403'
\set lambda '00000000-0000-0000-0000-0000000f2404'
\set zeta '00000000-0000-0000-0000-0000000f2405'
\set dadm '00000000-0000-0000-0000-0000000f2411'
\set gadm '00000000-0000-0000-0000-0000000f2412'
\set kown '00000000-0000-0000-0000-0000000f2413'
\set lown '00000000-0000-0000-0000-0000000f2414'
\set zown '00000000-0000-0000-0000-0000000f2415'
\set w1 '00000000-0000-0000-0000-0000000f2421'
\set w2 '00000000-0000-0000-0000-0000000f2422'

select pg_temp.partner(:'delta', :'dadm', 'recruitment_company', 'delta-recruit');
select pg_temp.partner(:'gamma', :'gadm', 'staffing_company', 'gamma-staffing');
select pg_temp.partner(:'kappa', :'kown', 'recruitment_company', 'kappa-recruit', 'pending_review');
select pg_temp.partner(:'lambda', :'lown', 'recruitment_company', 'lambda-recruit');
update public.organizations set status = 'suspended' where id = :'lambda';
select pg_temp.new_user(:'zown');
update public.profiles set account_kind = intended_account_kind where id = :'zown';
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
values (:'zeta', 'employer', 'zeta-works', 'Zeta Works GmbH', 'Zeta Works', 'DE');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'zeta', :'zown', 'owner', now());
select pg_temp.worker(:'w1');
select pg_temp.worker(:'w2');

select current_setting('t.a') as acme \gset
select current_setting('t.b') as beta \gset
update public.organizations set public_page_enabled = true where id in (:'acme', :'beta');

-- Grants and shape ---------------------------------------------------------------------------------------------------------
select ok(
  (select bool_and(not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute')
     and not has_function_privilege('service_role', f, 'execute'))
   from unnest(array['public.toggle_saved_partner(uuid, uuid, boolean)', 'public.toggle_follow(uuid, boolean)',
     'public.follower_count(uuid)', 'public.list_saved_partners(uuid, text, integer)',
     'public.list_followed_companies(text, integer)']) f),
  'the five functions are for signed-in callers only'
);
select ok(
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
   where oid in ('public.toggle_saved_partner(uuid, uuid, boolean)'::regprocedure, 'public.toggle_follow(uuid, boolean)'::regprocedure,
     'public.follower_count(uuid)'::regprocedure, 'public.list_saved_partners(uuid, text, integer)'::regprocedure,
     'public.list_followed_companies(text, integer)'::regprocedure, 'private.queue_follower_digests(timestamptz)'::regprocedure,
     'private.jobs_follow_activity()'::regprocedure)),
  'they and the job are security definer with an empty search_path'
);
select ok(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c
   where c.oid in ('public.saved_items'::regclass, 'public.follows'::regclass, 'private.follow_activity_outbox'::regclass)),
  'NFR-S8: row level security is enabled and forced on the three tables'
);
select ok(
  not has_table_privilege('authenticated', 'public.saved_items', 'insert, update, delete')
  and not has_table_privilege('authenticated', 'public.follows', 'insert, update, delete')
  and not has_table_privilege('anon', 'public.saved_items', 'select')
  and not has_table_privilege('anon', 'public.follows', 'select')
  and not has_table_privilege('authenticated', 'private.follow_activity_outbox', 'select'),
  'AC2, AC4: no write grant on saved_items or follows, nothing for anon, the outbox for no API role'
);
select policies_are('public', 'saved_items', array['saved_items_select_member'], 'saved_items has the member read policy only');
select policies_are('public', 'follows', array['follows_select_own'], 'follows has the own-row read policy only');
select is(
  (select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename in ('saved_items', 'follows')),
  'follows_list_idx,follows_organization_idx,follows_pkey,saved_items_list_idx,saved_items_pkey,saved_items_saved_by_idx,saved_items_target_idx',
  'every policy and foreign key column has an index'
);
select is(
  (select row(k.mandatory, k.default_email, k.audience)::text from private.notification_kinds k where k.kind = 'followed_company_activity'),
  '(f,t,all)', 'followed_company_activity is an optional kind for every account, emailed by default'
);
select ok(exists (select 1 from cron.job where jobname = 'follower-digest' and schedule = '20 * * * *'),
  'the follower digest runs hourly');

-- Release off ------------------------------------------------------------------------------------------------------------
select is(pg_temp.save_as(:'adm', :'gamma'), 'P0001|CHARA_FORBIDDEN|release_off', 'release off: saving is refused');
select is(pg_temp.follow_as(:'wa', :'gamma'), 'P0001|CHARA_FORBIDDEN|release_off', 'release off: following is refused');
select is(pg_temp.run(:'wa', 'select * from public.list_followed_companies()'), 'P0001|CHARA_FORBIDDEN|release_off',
  'release off: the follow list is refused');
select is(pg_temp.run(:'gadm', format('select public.follower_count(%L)', :'gamma')), 'P0001|CHARA_FORBIDDEN|release_off',
  'release off: the follower count is refused');
select is(private.queue_follower_digests(), 0, 'release off: the digest queues nothing');
select is(pg_temp.run(:'wa', 'select * from public.connection_target(''gamma-staffing'')') || pg_temp.result()::text, 'ok[]',
  'release off: connection_target names no company');

update private.settings set value = 'true' where key = 'release_partner_directories';

-- connection_target: the id and type behind a public slug, for the buttons -----------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.connection_target(text)', 'execute')
  and has_function_privilege('authenticated', 'public.connection_target(text)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.connection_target(text)'::regprocedure),
  'connection_target is a definer function for signed-in callers only'
);
select is(pg_temp.run(:'wa', 'select * from public.connection_target(''gamma-staffing'')'), 'ok', 'a candidate asks for Gamma');
select is(pg_temp.result(), jsonb_build_array(jsonb_build_object('organization_id', :'gamma', 'organization_type', 'staffing_company')),
  'and gets its id and type');
select is(pg_temp.run(:'wa', 'select * from public.connection_target(''beta-works'')') || pg_temp.result()::text,
  'ok' || jsonb_build_array(jsonb_build_object('organization_id', :'beta', 'organization_type', 'employer'))::text,
  'an employer whose page is on is named');
select is(
  pg_temp.run(:'wa', 'select * from public.connection_target(''kappa-recruit'') union all select * from public.connection_target(''zeta-works'') union all select * from public.connection_target(''lambda-recruit'')')
    || pg_temp.result()::text,
  'ok[]', 'a partner pending review, an employer whose page is off and a suspended partner are not');

-- AC1: saving toggles one row and is audited ---------------------------------------------------------------------------------
select is(pg_temp.save_as(:'adm', :'delta'), 'ok', 'AC1: the Acme admin saves Delta');
select is(pg_temp.result() -> 0 -> 'saved', 'true'::jsonb, 'and the answer is saved');
select is(
  (select jsonb_agg(jsonb_build_object('org', organization_id, 'target', target_organization_id, 'by', saved_by, 'kind', kind))
   from public.saved_items),
  jsonb_build_array(jsonb_build_object('org', :'acme', 'target', :'delta', 'by', :'adm', 'kind', 'partner')),
  'AC1: exactly one row, saved by the admin, kind partner'
);
select is(pg_temp.audits(:'acme', 'saved_partner.added'), 1::bigint, 'AC1: one audit row saved_partner.added');
select is(pg_temp.save_as(:'adm', :'delta'), 'ok', 'AC1: the second call');
select is(pg_temp.result() -> 0 -> 'saved', 'false'::jsonb, 'answers not saved');
select is((select count(*) from public.saved_items), 0::bigint, 'AC1: and removes the row');
select is(pg_temp.audits(:'acme', 'saved_partner.removed'), 1::bigint, 'AC1: one audit row saved_partner.removed');
select is(pg_temp.save_as(:'mem', :'delta'), 'ok', 'AC1: a member of Acme saves Delta again');
select is((select saved_by from public.saved_items where organization_id = :'acme'), :'mem'::uuid, 'the row names the member');
select is(pg_temp.save_as(:'mem', :'delta', ', p_saved => true'), 'ok', 'FR-P2 AC8: saving what is saved');
select is(
  (select count(*) from public.saved_items) || ':' || pg_temp.audits(:'acme', 'saved_partner.added'), '1:2',
  'changes nothing and writes no audit row'
);

-- AC2: who may save and what -------------------------------------------------------------------------------------------------
select is(pg_temp.save_as(:'mem', :'gamma'), 'ok', 'AC2: the Acme member saves the staffing company Gamma');
select is(pg_temp.save_as(:'wa', :'gamma'), 'P0001|CHARA_FORBIDDEN|', 'AC2, FR-P2 AC8: a candidate is refused');
select is(pg_temp.save_as(:'dadm', :'gamma'), 'P0001|CHARA_FORBIDDEN|', 'AC2: a partner admin is refused');
select matches(pg_temp.save_as(null, :'gamma'), '^42501\|permission denied for function toggle_saved_partner',
  'AC2: the anonymous caller is refused at the EXECUTE grant');
select is(pg_temp.save_as(:'mem', :'beta'), 'P0001|CHARA_INVALID_INPUT|not_a_partner', 'AC2: an employer is not a partner');
select is(pg_temp.save_as(:'mem', :'kappa'), 'P0002|CHARA_NOT_FOUND|', 'AC2: a partner pending review is not found');
select is(pg_temp.save_as(:'mem', :'lambda'), 'P0002|CHARA_NOT_FOUND|', 'AC2: a suspended partner is not found');
select is(pg_temp.save_as(:'mem', gen_random_uuid()), 'P0002|CHARA_NOT_FOUND|', 'an unknown id is not found');
select matches(
  pg_temp.call_as(:'mem', 'authenticated', format('insert into public.saved_items (organization_id, target_organization_id) values (%L, %L)', :'acme', :'kappa'), 'aal1'),
  '^42501\|', 'AC2: a direct insert is refused'
);
select is(pg_temp.save_as(:'mem', :'gamma', format(', p_org => %L', :'beta')), 'P0001|CHARA_FORBIDDEN|',
  'saving for an employer the caller is no member of is refused');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'beta', :'mem', 'member', now());
select is(pg_temp.save_as(:'mem', :'gamma'), 'P0001|CHARA_INVALID_INPUT|p_org',
  'a member of two employers names the one that saves');
select is(pg_temp.save_as(:'mem', :'gamma', format(', p_org => %L', :'beta')), 'ok', 'and then saves for it');
delete from public.saved_items where organization_id = :'beta';
delete from public.organization_members where organization_id = :'beta' and user_id = :'mem';
select is(pg_temp.save_as(:'mem', :'gamma', format(', p_org => %L', :'delta')), 'P0001|CHARA_FORBIDDEN|',
  'a partner organisation cannot be the saving organisation');
select is(pg_temp.save_as(:'mem', :'acme'), 'P0001|CHARA_INVALID_INPUT|not_a_partner', 'an employer cannot save itself');

-- AC3: saved partners stay within the organisation (NFR-S8) --------------------------------------------------------------------
select is(pg_temp.save_as(:'adm2', :'gamma'), 'ok', 'Beta saves Gamma');
select is(pg_temp.json_as(:'mem', 'select target_organization_id from public.saved_items order by target_organization_id'),
  jsonb_build_array(jsonb_build_object('target_organization_id', :'delta'), jsonb_build_object('target_organization_id', :'gamma')),
  'AC3: the Acme member reads the two Acme rows');
select is(pg_temp.json_as(:'adm2', 'select organization_id from public.saved_items'),
  jsonb_build_array(jsonb_build_object('organization_id', :'beta')), 'AC3: the Beta admin reads only Beta''s row');
select is(pg_temp.json_as(:'gadm', 'select * from public.saved_items'), '[]'::jsonb, 'AC3: the saved partner reads no row');
select is(pg_temp.json_as(:'dadm', 'select * from public.saved_items'), '[]'::jsonb, 'NFR-S8: the other partner reads no row');
select is(pg_temp.json_as(:'wa', 'select * from public.saved_items'), '[]'::jsonb, 'AC3: a candidate reads no row');
select is(pg_temp.json_as(:'wb', 'select * from public.saved_items'), '[]'::jsonb, 'NFR-S8: the second candidate reads no row');
select matches(pg_temp.run(null, 'select * from public.saved_items'), '^42501\|', 'AC3: the anonymous caller reads nothing');
select is(pg_temp.run(:'mem', format('select partner_id, slug, organization_type, based_in_country_name, served_countries, total from public.list_saved_partners(%L)', :'acme')), 'ok',
  'AC10: the Acme member lists the saved partners');
select is(pg_temp.result(), jsonb_build_array(
    jsonb_build_object('partner_id', :'gamma', 'slug', 'gamma-staffing', 'organization_type', 'staffing_company',
      'based_in_country_name', 'Philippines', 'served_countries', '[{"code": "DE", "name": "Germany"}]'::jsonb, 'total', 2),
    jsonb_build_object('partner_id', :'delta', 'slug', 'delta-recruit', 'organization_type', 'recruitment_company',
      'based_in_country_name', 'Philippines', 'served_countries', '[{"code": "DE", "name": "Germany"}]'::jsonb, 'total', 2)),
  'newest first, with the display fields and the total');
update public.saved_items set created_at = now() - interval '1 hour' where target_organization_id = :'delta';
select is(pg_temp.run(:'mem', format('select slug, next_cursor is not null as more from public.list_saved_partners(%L, null, 1)', :'acme')), 'ok',
  'a page of one');
select is(pg_temp.result(), '[{"slug": "gamma-staffing", "more": true}]'::jsonb, 'has a cursor to the next page');
select is(pg_temp.run(:'mem', format(
  'select slug from public.list_saved_partners(%L, (select next_cursor from public.list_saved_partners(%L, null, 1)), 1)', :'acme', :'acme')), 'ok',
  'the next page');
select is(pg_temp.result(), '[{"slug": "delta-recruit"}]'::jsonb, 'holds the older partner');
select is(pg_temp.run(:'mem', format('select * from public.list_saved_partners(%L, %L)', :'acme', 'nope')), 'P0001|CHARA_INVALID_INPUT|p_cursor',
  'a malformed cursor is refused');
select is(pg_temp.run(:'adm2', format('select * from public.list_saved_partners(%L)', :'acme')), 'P0001|CHARA_FORBIDDEN|',
  'AC3: another employer cannot list Acme''s saved partners');
select is(pg_temp.run(:'gadm', format('select * from public.list_saved_partners(%L)', :'acme')), 'P0001|CHARA_FORBIDDEN|',
  'AC3: the saved partner cannot list who saved it');
update public.organizations set status = 'suspended' where id = :'delta';
select is(pg_temp.run(:'mem', format('select slug, total from public.list_saved_partners(%L)', :'acme')), 'ok', 'Delta is suspended');
select is(pg_temp.result(), '[{"slug": "gamma-staffing", "total": 1}]'::jsonb, 'AC10: a suspended partner leaves the list');
select is((select count(*) from public.saved_items where target_organization_id = :'delta'), 1::bigint, 'while its row is kept');
select is(pg_temp.save_as(:'mem', :'delta', ', p_saved => false'), 'ok', 'a saved partner that left the directory can be unsaved');
update public.organizations set status = 'active' where id = :'delta';

-- AC4, FR-K5 AC7: following toggles one personal row -------------------------------------------------------------------------
select is(pg_temp.follow_as(:'wa', :'gamma'), 'ok', 'AC4: the candidate follows Gamma');
select is(pg_temp.result() -> 0 -> 'following', 'true'::jsonb, 'and the answer is following');
select is((select count(*) from public.follows where user_id = :'wa' and organization_id = :'gamma'), 1::bigint, 'one follows row');
select is(pg_temp.follow_as(:'wa', :'gamma'), 'ok', 'AC4: the second call');
select is((select count(*) || ':' || (pg_temp.result() -> 0 ->> 'following') from public.follows where user_id = :'wa'), '0:false',
  'removes it');
select is(pg_temp.follow_as(:'mem', :'gamma') || pg_temp.follow_as(:'dadm', :'gamma'), 'okok',
  'AC4: an employer member and a partner admin follow Gamma');
select is(pg_temp.follow_as(:'wa', :'beta'), 'ok', 'AC4: the candidate follows Beta, whose page is on');
select is(pg_temp.follow_as(:'wa', :'zeta'), 'P0002|CHARA_NOT_FOUND|', 'AC4: Zeta, whose page is off, cannot be followed');
select is(pg_temp.follow_as(:'wa', :'kappa'), 'P0002|CHARA_NOT_FOUND|', 'a partner pending review cannot be followed');
select throws_ok(format('insert into public.follows (user_id, organization_id) values (%L, %L)', :'wa', :'beta'), '23505', null,
  'AC4: a second follows row for the same user and company cannot exist');
select matches(pg_temp.follow_as(null, :'gamma'), '^42501\|permission denied for function toggle_follow',
  'AC4, FR-K5 AC7: the anonymous caller is refused');
select is(pg_temp.follow_as(:'gadm', :'gamma'), 'P0001|CHARA_INVALID_INPUT|own_organization', 'a member cannot follow its own company');
select is(pg_temp.follow_as(:'adm', :'beta'), 'P0001|CHARA_FORBIDDEN|employer_follows_employer',
  'an employer member does not follow another employer');
select is(pg_temp.follow_as(:'wsus', :'gamma'), 'P0001|CHARA_FORBIDDEN|account_suspended', 'a suspended account cannot follow');
select is(pg_temp.save_as(:'wsus', :'gamma'), 'P0001|CHARA_FORBIDDEN|', 'a suspended account cannot save');
select is(pg_temp.follow_as(:'dadm', :'beta') || pg_temp.follow_as(:'dadm', :'beta', ', p_following => true'), 'okok',
  'FR-K5 AC7: the partner admin follows the company page, and following it again');
select is((select count(*) from public.follows where user_id = :'dadm' and organization_id = :'beta'), 1::bigint, 'changes nothing');
update public.organizations set public_page_enabled = false where id = :'beta';
select is((select count(*) from public.follows where organization_id = :'beta'), 2::bigint, 'FR-K5 AC7: turning the page off keeps the follows');
select is(pg_temp.follow_as(:'wb', :'beta'), 'P0002|CHARA_NOT_FOUND|', 'but no follow is possible until it is on again');
select is(pg_temp.run(:'wa', 'select slug from public.list_followed_companies()'), 'ok', 'the candidate lists the companies followed');
select is(pg_temp.result(), '[]'::jsonb, 'a company whose page is off is hidden from the list');
update public.organizations set public_page_enabled = true where id = :'beta';
select is(pg_temp.run(:'wa', 'select slug, organization_type, based_in_country_name, total from public.list_followed_companies()'), 'ok', 'the page is on again');
select is(pg_temp.result(), jsonb_build_array(jsonb_build_object('slug', 'beta-works', 'organization_type', 'employer',
  'based_in_country_name', 'United Kingdom', 'total', 1)), 'and the company is back in the list');
select is(pg_temp.follow_as(:'dadm', :'beta', ', p_following => false'), 'ok', 'FR-K5 AC7: unfollow removes the row');

-- AC5: the followed company sees a count, never the followers ----------------------------------------------------------------
select is(pg_temp.follow_as(:'wa', :'gamma'), 'ok', 'Gamma now has three followers');
select is(pg_temp.json_as(:'gadm', 'select * from public.follows'), '[]'::jsonb, 'AC5: Gamma''s admin reads no follows rows');
select is(pg_temp.run(:'gadm', format('select public.follower_count(%L) as c', :'gamma')), 'ok', 'AC5: Gamma''s admin asks for the count');
select is(pg_temp.result() -> 0 -> 'c', '{"count": null, "fewer_than": 5}'::jsonb, 'AC5: fewer than 5, without a number');
select pg_temp.worker(('00000000-0000-0000-0000-0000000f243' || n)::uuid) from generate_series(1, 6) n;
insert into public.follows (user_id, organization_id)
select ('00000000-0000-0000-0000-0000000f243' || n)::uuid, :'beta' from generate_series(1, 6) n;
select is((select count(*) from public.follows where organization_id = :'beta'), 7::bigint, 'Beta has seven followers');
select is(pg_temp.run(:'adm2', format('select public.follower_count(%L) as c', :'beta')), 'ok', 'AC5: Beta''s admin asks');
select is(pg_temp.result() -> 0 -> 'c', '{"count": 7}'::jsonb, 'AC5: and gets 7');
select is(pg_temp.run(:'wa', format('select public.follower_count(%L)', :'gamma')), 'P0001|CHARA_FORBIDDEN|',
  'a follower who is no member cannot read the count');
select is(pg_temp.json_as(:'wa', 'select organization_id from public.follows order by organization_id'),
  (select jsonb_agg(jsonb_build_object('organization_id', o) order by o) from unnest(array[:'gamma', :'beta']::uuid[]) o),
  'AC5, NFR-S8: the candidate reads only their own rows');
select is(pg_temp.json_as(:'wb', format('select * from public.follows where user_id = %L', :'wa')), '[]'::jsonb,
  'NFR-S8: the second candidate reads none of them');

-- AC6: a new vacancy of a followed company notifies its followers -------------------------------------------------------------
\set p1 :dadm
delete from public.follows where organization_id in (:'beta', :'gamma');
select is(pg_temp.follow_as(:'w1', :'acme') || pg_temp.follow_as(:'w2', :'acme') || pg_temp.follow_as(:'p1', :'acme'), 'okokok',
  'W1, W2 and P1 follow Acme');
insert into public.notification_preferences (user_id, email_kinds) values (:'w2', '{"followed_company_activity": false}');
select date_trunc('day', now()) + interval '8 hours' as base \gset
update public.follows set created_at = :'base'::timestamptz - interval '1 day' where organization_id = :'acme';
select pg_temp.seed_job('{"title": "Draft welder"}', :'acme') as vd \gset
select pg_temp.seed_job('{"title": "Paused welder", "status": "paused", "published_at": "2026-10-01 08:00+00"}', :'acme') as vp \gset
select is(pg_temp.set_status(:'adm', :'vd', 'open') || pg_temp.set_status(:'adm', :'vp', 'open'), 'okok',
  'the Acme admin publishes the draft and reopens the paused vacancy');
select is((select string_agg(entity_id::text, ',') from private.follow_activity_outbox), :'vd',
  'AC6: only the first publication enters the outbox; reopening queues nothing');
update private.follow_activity_outbox set created_at = :'base'::timestamptz + interval '1 hour';
select is((select count(*) from pgmq.q_notifications where message ->> 'kind' = 'followed_company_activity'), 0::bigint,
  'nothing is sent before the digest runs');
select is(private.queue_follower_digests(:'base'::timestamptz + interval '2 hours'), 3, 'AC6: the digest queues one message per follower');
select is(
  (select string_agg(message ->> 'user_id', ',' order by message ->> 'user_id') from pgmq.q_notifications
   where message ->> 'kind' = 'followed_company_activity'),
  (select string_agg(u::text, ',' order by u::text) from unnest(array[:'w1', :'p1']::uuid[]) u),
  'AC6: exactly one email each for W1 and P1, none for W2'
);
select is(
  (select string_agg(user_id || ':' || status || ':' || coalesce(email_status, '-'), ',' order by user_id) from public.notifications
   where kind = 'followed_company_activity'),
  (select string_agg(u || ':' || s, ',' order by u) from (values
     (:'w1', 'queued:-'), (:'w2', 'suppressed:suppressed_by_preference'), (:'p1', 'queued:-')) v (u, s)),
  'AC6: one in-app item for each of W1, W2 and P1; W2''s is not emailed'
);
select is(
  (select payload from public.notifications where kind = 'followed_company_activity' and user_id = :'w1'),
  jsonb_build_object('organization_id', :'acme', 'org_name', 'Acme Bau', 'org_slug', (select slug from public.organizations where id = :'acme'),
    'total', 1, 'vacancies', jsonb_build_array(jsonb_build_object('job_id', :'vd', 'job_title', 'Draft welder'))),
  'AC6: the payload holds the organisation, the vacancy id and title only'
);

-- AC8: volume, suspension and erasure ------------------------------------------------------------------------------------------
select pg_temp.seed_job('{"title": "Second welder"}', :'acme') as v2 \gset
select pg_temp.seed_job('{"title": "Third welder"}', :'acme') as v3 \gset
select pg_temp.seed_job('{"title": "Fourth welder"}', :'acme') as v4 \gset
select is(pg_temp.set_status(:'adm', :'v2', 'open') || pg_temp.set_status(:'adm', :'v3', 'open') || pg_temp.set_status(:'adm', :'v4', 'open'),
  'okokok', 'Acme publishes three more vacancies the same day');
update private.follow_activity_outbox set created_at = :'base'::timestamptz + interval '3 hours' where entity_id <> :'vd';
select is(private.queue_follower_digests(:'base'::timestamptz + interval '4 hours'), 0,
  'AC8: a follower already notified today gets nothing more today');
select is(private.queue_follower_digests(:'base'::timestamptz + interval '1 day'), 3, 'the next day each follower gets one digest');
select is(
  (select (payload ->> 'total') || ':' || jsonb_path_query_array(payload, '$.vacancies[*].job_title')::text from public.notifications
   where kind = 'followed_company_activity' and user_id = :'w1'
     and dedupe_key = format('followed_company_activity:%s:%s', :'acme', ((:'base'::timestamptz + interval '1 day') at time zone 'utc')::date)),
  '3:["Second welder", "Third welder", "Fourth welder"]', 'AC8: listing the three vacancies'
);
select is(
  (select count(*) from public.notifications where kind = 'followed_company_activity' and user_id = :'w1'), 2::bigint,
  'AC8: one notification per followed company per day'
);
select is(private.queue_follower_digests(:'base'::timestamptz + interval '1 day 1 hour'), 0, 'a later run that day queues nothing');

select is(pg_temp.follow_as(:'w1', :'beta'), 'ok', 'W1 also follows Beta');
update public.follows set created_at = :'base'::timestamptz - interval '1 day' where organization_id = :'beta';
select pg_temp.seed_job('{"title": "Beta welder"}', :'beta') as vb \gset
select is(pg_temp.set_status(:'own2', :'vb', 'open'), 'ok', 'Beta publishes a vacancy');
update private.follow_activity_outbox set created_at = :'base'::timestamptz + interval '2 days 1 hour' where entity_id = :'vb';
update public.organizations set status = 'suspended' where id = :'beta';
select is(private.queue_follower_digests(:'base'::timestamptz + interval '2 days 2 hours'), 0,
  'AC8: a suspended company''s activity queues nothing');
select is(pg_temp.run(:'w1', 'select slug from public.list_followed_companies() order by slug'), 'ok', 'W1 lists the companies followed');
select is(pg_temp.result(), jsonb_build_array(jsonb_build_object('slug', (select slug from public.organizations where id = :'acme'))),
  'AC8: the suspended company is not in the list');
select is((select count(*) from public.follows where user_id = :'w1' and organization_id = :'beta'), 1::bigint, 'while the follows row is kept');
select is(private.queue_follower_digests(:'base'::timestamptz + interval '5 days'), 0, 'entries older than two days have left the outbox');
select is((select count(*) from private.follow_activity_outbox), 0::bigint, 'and the outbox is empty');


-- The filters of the digest ------------------------------------------------------------------------------------------------
-- Omega Works (employer, page on) with owner oown; followers fa (active candidate), fs (suspended), fd (deletion
-- pending) and fj (a company user who joins Omega after following it). base2 lies ten days after base.
\set omega '00000000-0000-0000-0000-0000000f2501'
\set oown '00000000-0000-0000-0000-0000000f2511'
\set fa '00000000-0000-0000-0000-0000000f2521'
\set fs '00000000-0000-0000-0000-0000000f2522'
\set fd '00000000-0000-0000-0000-0000000f2523'
\set fj '00000000-0000-0000-0000-0000000f2524'
select pg_temp.new_user(:'oown');
select pg_temp.new_user(:'fj');
update public.profiles set account_kind = intended_account_kind where id in (:'oown', :'fj');
select pg_temp.worker(:'fa');
select pg_temp.worker(:'fs');
select pg_temp.worker(:'fd');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, public_page_enabled)
values (:'omega', 'employer', 'omega-works', 'Omega Works GmbH', 'Omega Works', 'DE', true);
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'omega', :'oown', 'owner', now());
select (:'base'::timestamptz + interval '10 days') as base2 \gset
select is(pg_temp.follow_as(:'fa', :'omega') || pg_temp.follow_as(:'fj', :'omega'), 'okok', 'fa and fj follow Omega');
insert into public.follows (user_id, organization_id) values (:'fs', :'omega'), (:'fd', :'omega');
update public.profiles set status = 'suspended' where id = :'fs';
update public.profiles set status = 'deletion_pending' where id = :'fd';
update public.follows set created_at = :'base2'::timestamptz - interval '1 day' where organization_id = :'omega';

update private.settings set value = 'false' where key = 'release_partner_directories';
select pg_temp.seed_job('{"title": "Release off welder"}', :'omega') as vr \gset
select is(pg_temp.set_status(:'oown', :'vr', 'open'), 'ok', 'Omega publishes while the release is off');
update private.settings set value = 'true' where key = 'release_partner_directories';
select is((select count(*) from private.follow_activity_outbox where entity_id = :'vr'), 0::bigint,
  'a publication while the release is off leaves the outbox empty');
select pg_temp.seed_job('{"title": "Hidden welder", "moderation_state": "hidden"}', :'omega') as vh \gset
select is(pg_temp.set_status(:'oown', :'vh', 'open'), 'ok', 'Omega publishes a vacancy that moderation hid');
select is((select count(*) from private.follow_activity_outbox where entity_id = :'vh'), 0::bigint,
  'a hidden vacancy does not enter the outbox');

select pg_temp.seed_job('{"title": "Paused later"}', :'omega') as vp1 \gset
select pg_temp.seed_job('{"title": "Hidden later"}', :'omega') as vp2 \gset
select pg_temp.seed_job('{"title": "Deleted later"}', :'omega') as vp3 \gset
select is(pg_temp.set_status(:'oown', :'vp1', 'open') || pg_temp.set_status(:'oown', :'vp2', 'open') || pg_temp.set_status(:'oown', :'vp3', 'open'),
  'okokok', 'Omega publishes three vacancies');
select is(pg_temp.set_status(:'oown', :'vp1', 'paused'), 'ok', 'then pauses the first');
update public.jobs set moderation_state = 'hidden' where id = :'vp2';
update public.jobs set deleted_at = now() where id = :'vp3';
update private.follow_activity_outbox set created_at = :'base2'::timestamptz + interval '1 hour' where organization_id = :'omega';
select is(private.queue_follower_digests(:'base2'::timestamptz + interval '2 hours'), 0,
  'a paused, a hidden and a deleted vacancy are not listed');
select is((select count(*) from public.follows where organization_id = :'omega' and last_digest_at is not null), 0::bigint,
  'and no follow is stamped');

insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'omega', :'fj', 'member', now());
select pg_temp.seed_job('{"title": "Original welder"}', :'omega') as vok \gset
select is(pg_temp.set_status(:'oown', :'vok', 'open'), 'ok', 'Omega publishes a visible vacancy');
update private.follow_activity_outbox set created_at = :'base2'::timestamptz + interval '1 hour' where entity_id = :'vok';
update public.jobs set title = 'Renamed welder' where id = :'vok';
select is(private.queue_follower_digests(:'base2'::timestamptz + interval '2 hours'), 1,
  'only the active follower who is no member gets a digest');
select is(
  (select string_agg(user_id::text, ',') from public.notifications where kind = 'followed_company_activity' and payload ->> 'org_slug' = 'omega-works'),
  :'fa', 'the suspended, the deletion-pending follower and the follower who joined Omega get nothing'
);
select is(
  (select payload -> 'vacancies' from public.notifications where kind = 'followed_company_activity' and user_id = :'fa'),
  jsonb_build_array(jsonb_build_object('job_id', :'vok', 'job_title', 'Renamed welder')),
  'the digest names the vacancy by its current title, and not the withdrawn ones'
);
select is((select last_digest_at from public.follows where user_id = :'fa' and organization_id = :'omega'),
  :'base2'::timestamptz + interval '2 hours' - interval '5 minutes', 'the follow is stamped with the five-minute bound');
select is(private.queue_follower_digests(:'base2'::timestamptz + interval '2 hours'), 0,
  'a second run in the same transaction queues nothing');

select pg_temp.seed_job('{"title": "Late welder"}', :'omega') as vlate \gset
select is(pg_temp.set_status(:'oown', :'vlate', 'open'), 'ok', 'Omega publishes a vacancy just before the next day''s run');
update private.follow_activity_outbox set created_at = :'base2'::timestamptz + interval '1 day 2 hours' - interval '2 minutes'
where entity_id = :'vlate';
select is(private.queue_follower_digests(:'base2'::timestamptz + interval '1 day 2 hours'), 0,
  'an entry younger than five minutes waits for a later run');
select is(private.queue_follower_digests(:'base2'::timestamptz + interval '1 day 2 hours 10 minutes'), 1,
  'and the next run lists it');
select is(
  (select jsonb_path_query_array(payload, '$.vacancies[*].job_title') from public.notifications
   where kind = 'followed_company_activity' and user_id = :'fa'
     and dedupe_key = format('followed_company_activity:%s:%s', :'omega', ((:'base2'::timestamptz + interval '1 day') at time zone 'utc')::date)),
  '["Late welder"]'::jsonb, 'with nothing but the late vacancy'
);

select pg_temp.seed_job('{"title": "Before suspension"}', :'omega') as vs1 \gset
select is(pg_temp.set_status(:'oown', :'vs1', 'open'), 'ok', 'Omega publishes before it is suspended');
update private.follow_activity_outbox set created_at = :'base2'::timestamptz + interval '3 days 1 hour' where entity_id = :'vs1';
update public.organizations set status = 'suspended' where id = :'omega';
select pg_temp.seed_job('{"title": "During suspension"}', :'omega') as vs2 \gset
select pg_temp.set_status(:'oown', :'vs2', 'open') as during \gset
select is((select count(*) from private.follow_activity_outbox where entity_id = :'vs2'), 0::bigint,
  'AC8: a vacancy cannot be published into the outbox while the company is suspended');
select is(pg_temp.save_as(:'oown', :'gamma'), 'P0001|CHARA_FORBIDDEN|', 'a member of a suspended employer cannot save');
select is(private.queue_follower_digests(:'base2'::timestamptz + interval '3 days 2 hours'), 0,
  'AC8: nothing is delivered while the company is suspended');
update public.organizations set status = 'active' where id = :'omega';
select is(private.queue_follower_digests(:'base2'::timestamptz + interval '3 days 3 hours'), 1,
  'AC8: after reinstatement the vacancy published before the suspension is delivered');
select is(
  (select payload -> 'vacancies' -> 0 ->> 'job_title' from public.notifications
   where kind = 'followed_company_activity' and user_id = :'fa'
     and dedupe_key = format('followed_company_activity:%s:%s', :'omega', ((:'base2'::timestamptz + interval '3 days 3 hours') at time zone 'utc')::date)),
  'Before suspension', 'and only that one'
);

update public.profiles set deleted_at = now() - interval '31 days' where id = :'w1';
select is(pg_temp.call_as(null, 'service_role', format('select public.erase_user(%L)', :'w1')), 'ok', 'W1 is erased');
select is((select count(*) from public.follows where user_id = :'w1'), 0::bigint, 'AC8: the erased user''s follows rows are deleted');
delete from public.profiles where id = :'mem';
select is((select saved_by from public.saved_items where organization_id = :'acme' and target_organization_id = :'gamma'), null::uuid,
  'AC8: the saved partner of a deleted account is kept with saved_by null');

select * from finish();
rollback;
