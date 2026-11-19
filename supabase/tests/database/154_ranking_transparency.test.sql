begin;
select plan(31);

\ir organizations_fixture.inc

-- Ranking transparency (V77, NFR-C8; decision 1.1): paying never changes the order of Find Partners. Partners that are
-- identical except for their plan (none, Free, Basic, Professional, Enterprise) come back in the same order from
-- search_partners (recruitment and staffing) and search_available_workforce, before and after their plans are turned
-- around, whatever the plan of the organisation that searches; a hidden, suspended, unlisted or declined partner never
-- comes back, on any plan. The order by clauses checked at the end are the ones the public page /[lang]/legal/ranking
-- describes (apps/web/lib/partners/ranking.ts, guarded by tests/unit/ranking-transparency.test.tsx).

create function pg_temp.partner(p_owner uuid, p_type public.organization_type, p_slug text, p_id uuid) returns uuid
language plpgsql as $$
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, review_status, listed_at,
    submitted_at, workforce_profile_updated_at)
  values (p_id, p_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH', 'listed',
    now() - interval '30 days', now() - interval '31 days', '2026-10-01 08:00+00');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_id, p_owner, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  values (p_id, 'serves_market', 'DE'), (p_id, 'sources_from', 'PH');
  insert into public.organization_occupations (organization_id, occupation_id) values (p_id, '7212');
  insert into public.organization_languages (organization_id, language_code) values (p_id, 'tl');
  insert into public.organization_service_types (organization_id, service)
  select p_id, 'temporary' where p_type = 'staffing_company';
  insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
    available_from, confirmed_at)
  values (p_id, '7212', 'PH', 120, 40, current_date, now() - interval '10 days');
  return p_id;
end;
$$;

create function pg_temp.subscribe(p_org uuid, p_plan text) returns void
language sql as $$
  delete from billing.subscriptions where organization_id = p_org;
  insert into billing.subscriptions (organization_id, plan_code, status, provider)
  select p_org, p_plan, 'active', 'null' where p_plan is not null;
$$;

-- The slugs that one search function call returns as the user (anonymous when null), in their order, with a fresh limit.
create function pg_temp.order_of(p_user uuid, p_call text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  delete from private.rate_limit_hits;
  perform set_config('t.result', '', true);
  v_result := pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select string_agg(s.slug, '','' order by s.ordinality) from %s with ordinality s), ''''), true)', p_call),
    'aal1');
  return case when v_result = 'ok' then current_setting('t.result') else v_result end;
end;
$$;

-- One directory search; a visitor passes a visitor key.
create function pg_temp.directory(p_user uuid, p_args text) returns text
language sql as $$
  select pg_temp.order_of(p_user, format('public.search_partners(%s%s)', p_args,
    case when p_user is null then format(', p_key => %L', repeat('a', 64)) else '' end))
$$;

\set own '00000000-0000-0000-0000-0000003f0001'
\set fre '00000000-0000-0000-0000-0000003f0002'
\set pro '00000000-0000-0000-0000-0000003f0003'

select pg_temp.new_user(:'own');
select pg_temp.new_user(:'fre');
select pg_temp.new_user(:'pro');
update public.profiles set account_kind = intended_account_kind where id in (:'own', :'fre', :'pro');

-- Partners of earlier test data must not change the results below: they are hidden for this transaction.
update public.organizations set moderation_state = 'hidden' where type <> 'employer';
update private.settings set value = 'true' where key = 'release_partner_directories';

insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country) values
  ('00000000-0000-0000-0000-0000003fe001', 'employer', 'rank-free-employer', 'Rank Free Employer GmbH', 'Rank Free Employer', 'DE'),
  ('00000000-0000-0000-0000-0000003fe002', 'employer', 'rank-pro-employer', 'Rank Pro Employer GmbH', 'Rank Pro Employer', 'DE');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values
  ('00000000-0000-0000-0000-0000003fe001', :'fre', 'owner', now()),
  ('00000000-0000-0000-0000-0000003fe002', :'pro', 'owner', now());
select pg_temp.subscribe('00000000-0000-0000-0000-0000003fe001', 'free_employer');
select pg_temp.subscribe('00000000-0000-0000-0000-0000003fe002', 'employer_professional');

-- Five identical recruitment companies and five identical staffing companies, ids rising in slug order: the only order
-- left is the id. The lowest id starts without a plan and the highest on Enterprise, so an order by plan would differ.
select pg_temp.partner(:'own', 'recruitment_company', 'rank-r1', '00000000-0000-0000-0000-0000003fa001');
select pg_temp.partner(:'own', 'recruitment_company', 'rank-r2', '00000000-0000-0000-0000-0000003fa002');
select pg_temp.partner(:'own', 'recruitment_company', 'rank-r3', '00000000-0000-0000-0000-0000003fa003');
select pg_temp.partner(:'own', 'recruitment_company', 'rank-r4', '00000000-0000-0000-0000-0000003fa004');
select pg_temp.partner(:'own', 'recruitment_company', 'rank-r5', '00000000-0000-0000-0000-0000003fa005');
select pg_temp.partner(:'own', 'staffing_company', 'rank-s1', '00000000-0000-0000-0000-0000003fb001');
select pg_temp.partner(:'own', 'staffing_company', 'rank-s2', '00000000-0000-0000-0000-0000003fb002');
select pg_temp.partner(:'own', 'staffing_company', 'rank-s3', '00000000-0000-0000-0000-0000003fb003');
select pg_temp.partner(:'own', 'staffing_company', 'rank-s4', '00000000-0000-0000-0000-0000003fb004');
select pg_temp.partner(:'own', 'staffing_company', 'rank-s5', '00000000-0000-0000-0000-0000003fb005');
select pg_temp.subscribe(id, plan) from (values
  ('00000000-0000-0000-0000-0000003fa001'::uuid, null), ('00000000-0000-0000-0000-0000003fa002', 'free_recruitment_company'),
  ('00000000-0000-0000-0000-0000003fa003', 'recruitment_partner'), ('00000000-0000-0000-0000-0000003fa004', 'recruitment_professional'),
  ('00000000-0000-0000-0000-0000003fa005', 'recruitment_enterprise'),
  ('00000000-0000-0000-0000-0000003fb001', null), ('00000000-0000-0000-0000-0000003fb002', 'free_staffing_company'),
  ('00000000-0000-0000-0000-0000003fb003', 'staffing_partner'), ('00000000-0000-0000-0000-0000003fb004', 'staffing_professional'),
  ('00000000-0000-0000-0000-0000003fb005', 'staffing_enterprise')
) p (id, plan);

-- The same partners on Enterprise, each kept out of the directories by one state.
select pg_temp.partner(:'own', 'recruitment_company', 'rank-hidden', '00000000-0000-0000-0000-0000003fc001');
select pg_temp.partner(:'own', 'recruitment_company', 'rank-suspended', '00000000-0000-0000-0000-0000003fc002');
select pg_temp.partner(:'own', 'staffing_company', 'rank-unlisted', '00000000-0000-0000-0000-0000003fc003');
select pg_temp.partner(:'own', 'staffing_company', 'rank-declined', '00000000-0000-0000-0000-0000003fc004');
update public.organizations set moderation_state = 'hidden' where slug = 'rank-hidden';
update public.organizations set status = 'suspended' where slug = 'rank-suspended';
update public.organizations set listed_at = null, review_status = 'pending_review' where slug = 'rank-unlisted';
update public.organizations set review_status = 'declined' where slug = 'rank-declined';
select pg_temp.subscribe(id, 'recruitment_enterprise') from public.organizations where slug in ('rank-hidden', 'rank-suspended');
select pg_temp.subscribe(id, 'staffing_enterprise') from public.organizations where slug in ('rank-unlisted', 'rank-declined');

\set recruitment 'rank-r1,rank-r2,rank-r3,rank-r4,rank-r5'
\set staffing 'rank-s1,rank-s2,rank-s3,rank-s4,rank-s5'
\set everyone 'rank-r1,rank-r2,rank-r3,rank-r4,rank-r5,rank-s1,rank-s2,rank-s3,rank-s4,rank-s5'
\set filters '''recruitment'', p_destination => ''DE'', p_occupation => ''7212'', p_based_in => ''PH'', p_language => ''tl'''
\set staffing_filters '''staffing'', p_destination => ''DE'', p_staffing_types => ''{temporary}'', p_based_in => ''PH'''
\set workforce 'public.search_available_workforce(''DE'', ''7212'', 100, 60)'

-- Plans rising with the id ----------------------------------------------------------------------------------------------------
select is(pg_temp.directory(null, '''recruitment'''), :'recruitment',
  'NFR-C8: a visitor sees the five recruitment companies in id order, the one without a plan first and Enterprise last');
select is(pg_temp.directory(null, :'filters'), :'recruitment',
  'NFR-C8: with four filters that every one matches, the same order');
select is(pg_temp.directory(:'fre', :'filters'), :'recruitment', 'NFR-C8: the same order for an employer on Free');
select is(pg_temp.directory(:'pro', :'filters'), :'recruitment', 'NFR-C8: and for an employer on Professional');
select is(pg_temp.directory(:'pro', :'filters' || ', p_capacity => 100, p_within_days => 60'), :'recruitment',
  'NFR-C8: with the advanced filters, which every one matches, still the same order');
select is(pg_temp.directory(null, '''staffing'''), :'staffing', 'NFR-C8: a visitor sees the five staffing companies in id order');
select is(pg_temp.directory(null, :'staffing_filters'), :'staffing', 'NFR-C8: with filters that every one matches, the same order');
select is(pg_temp.directory(:'fre', :'staffing_filters'), :'staffing', 'NFR-C8: the same order for an employer on Free');
select is(pg_temp.directory(:'pro', :'staffing_filters'), :'staffing', 'NFR-C8: and for an employer on Professional');
select is(pg_temp.order_of(:'fre', :'workforce'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|available_workforce_search',
  'the available workforce search itself is not in the Free employer plan, which only decides who may search');
select pg_temp.subscribe('00000000-0000-0000-0000-0000003fe001', 'employer_starter');
select is(pg_temp.order_of(:'fre', :'workforce'), :'everyone',
  'NFR-C8: the available workforce of the ten partners, in id order, for an employer on Basic');
select is(pg_temp.order_of(:'pro', :'workforce'), :'everyone', 'NFR-C8: and for an employer on Professional');

-- Plans turned around ---------------------------------------------------------------------------------------------------------
select pg_temp.subscribe(id, plan) from (values
  ('00000000-0000-0000-0000-0000003fa001'::uuid, 'recruitment_enterprise'), ('00000000-0000-0000-0000-0000003fa002', 'recruitment_professional'),
  ('00000000-0000-0000-0000-0000003fa003', 'recruitment_partner'), ('00000000-0000-0000-0000-0000003fa004', 'free_recruitment_company'),
  ('00000000-0000-0000-0000-0000003fa005', null),
  ('00000000-0000-0000-0000-0000003fb001', 'staffing_enterprise'), ('00000000-0000-0000-0000-0000003fb002', 'staffing_professional'),
  ('00000000-0000-0000-0000-0000003fb003', 'staffing_partner'), ('00000000-0000-0000-0000-0000003fb004', 'free_staffing_company'),
  ('00000000-0000-0000-0000-0000003fb005', null)
) p (id, plan);
select pg_temp.subscribe('00000000-0000-0000-0000-0000003fe001', 'employer_enterprise');
select pg_temp.subscribe('00000000-0000-0000-0000-0000003fe002', 'employer_starter');

select is(pg_temp.directory(null, '''recruitment'''), :'recruitment',
  'NFR-C8: Enterprise now on the lowest id and no plan on the highest: the recruitment order does not change');
select is(pg_temp.directory(null, :'filters'), :'recruitment', 'NFR-C8: nor with the filters');
select is(pg_temp.directory(:'fre', :'filters'), :'recruitment', 'NFR-C8: nor for the searcher now on Enterprise');
select is(pg_temp.directory(:'pro', :'filters'), :'recruitment', 'NFR-C8: nor for the searcher now on Basic');
select is(pg_temp.directory(null, '''staffing'''), :'staffing', 'NFR-C8: the staffing order does not change');
select is(pg_temp.directory(null, :'staffing_filters'), :'staffing', 'NFR-C8: nor with the filters');
select is(pg_temp.directory(:'fre', :'staffing_filters'), :'staffing', 'NFR-C8: nor for the searcher now on Enterprise');
select is(pg_temp.order_of(:'fre', :'workforce'), :'everyone', 'NFR-C8: the available workforce order does not change');
select is(pg_temp.order_of(:'pro', :'workforce'), :'everyone', 'NFR-C8: nor for the searcher now on Basic');

-- Two identical partners are told apart by the profile time first ---------------------------------------------------------------
update public.organizations set workforce_profile_updated_at = '2026-10-02 08:00+00' where slug in ('rank-r5', 'rank-s5');
select is(pg_temp.directory(null, '''recruitment'''), 'rank-r5,rank-r1,rank-r2,rank-r3,rank-r4',
  'NFR-C8: the profile changed most recently comes first, whatever its plan (none)');
update public.workforce_availability set confirmed_at = now() - interval '1 day'
where organization_id = '00000000-0000-0000-0000-0000003fb005';
select is(pg_temp.order_of(:'pro', :'workforce'), 'rank-s5,rank-r1,rank-r2,rank-r3,rank-r4,rank-r5,rank-s1,rank-s2,rank-s3,rank-s4',
  'NFR-C8: the most recently confirmed availability comes first, whatever its plan (none)');

-- Never shown, whatever the plan -------------------------------------------------------------------------------------------------
select ok(pg_temp.directory(null, '''recruitment''') !~ 'rank-(hidden|suspended|unlisted|declined)'
  and pg_temp.directory(null, '''staffing''') !~ 'rank-(hidden|suspended|unlisted|declined)',
  'NFR-C8: a hidden, suspended, unlisted or declined partner on Enterprise is in neither directory');
select ok(pg_temp.order_of(:'pro', :'workforce') !~ 'rank-(hidden|suspended|unlisted|declined)',
  'NFR-C8: nor in the available workforce');

-- What the functions read ---------------------------------------------------------------------------------------------------------
select ok(
  (select bool_and(prosrc !~* '\m(billing|subscriptions?|plan_code|plans|entitlements_enforced)\M') from pg_proc
   where proname in ('search_partners', 'search_available_workforce') and pronamespace = 'public'::regnamespace),
  'NFR-C8: neither search names billing, a subscription, a plan or the entitlement switch'
);
select is(
  (select count(*)::integer from pg_proc p, regexp_matches(p.prosrc, 'has_feature', 'g')
   where p.proname = 'search_partners' and p.pronamespace = 'public'::regnamespace),
  1,
  'NFR-C8: search_partners asks for a feature once, to allow the advanced filters, never to order'
);
select ok(
  (select prosrc ~ 'if v_listing_filter or cardinality\(v_sources\) > 1 then\s+if v_uid is null then\s+raise exception ''CHARA_UNAUTHENTICATED''[^;]*;\s+end if;\s+if not exists \(\s+select 1 from private\.member_org_ids\(\) m \(organization_id\) where private\.has_feature\(m\.organization_id, ''advanced_partner_search''\)'
   from pg_proc where proname = 'search_partners' and pronamespace = 'public'::regnamespace),
  'NFR-C8: and that one check refuses the capacity, the timeframe and several source countries without the feature'
);
select is(
  (select count(*)::integer from pg_proc p, regexp_matches(p.prosrc, 'has_feature', 'g')
   where p.proname = 'search_available_workforce' and p.pronamespace = 'public'::regnamespace),
  1,
  'NFR-C8: search_available_workforce asks for a feature once, whether the employer may search'
);
select ok(
  (select prosrc like '%order by cardinality(m.matched) desc, m.updated_at desc, m.id%'
     and prosrc like '%row_number() over (order by p.matched_count desc, p.updated_at desc, p.id)%'
   from pg_proc where proname = 'search_partners' and pronamespace = 'public'::regnamespace),
  'NFR-C8: search_partners orders by the matched filters, the profile time and the id, as the ranking page says'
);
select ok(
  (select prosrc like '%order by r.covers desc, r.confirmed_at desc, r.organization_id%'
     and prosrc like '%row_number() over (order by p.covers desc, p.confirmed_at desc, p.organization_id)%'
   from pg_proc where proname = 'search_available_workforce' and pronamespace = 'public'::regnamespace),
  'NFR-C8: search_available_workforce orders by cover now, the latest confirmation and the id, as the ranking page says'
);

select * from finish();
rollback;
