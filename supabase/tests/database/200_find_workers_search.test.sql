begin;
select plan(104);

\ir jobs_fixture.inc

-- Find Workers search (V69; FR-Q2 AC1 to AC6, AC8, AC9, AC12; NFR-S8, NFR-S9, NFR-C8): search_workers, worker_search_access,
-- the search log, toggle_saved_worker_card, list_saved_worker_cards and public.saved_worker_cards. Acme (t.a: owner own1,
-- admin adm, member mem; based in DE) is on Starter and Beta (t.b: owner own2, admin adm2; based in GB) on Professional;
-- wkr is a candidate. The other organisations, each with an owner of its own, and the listed workers are made below. The
-- workers are written as the database owner with searchable set, as set_worker_visibility (V68) leaves them, and are
-- named by a tag; a result is read back as the tags of its cards.

\set utr '00000000-0000-0000-0000-0000000f6901'
\set upd '00000000-0000-0000-0000-0000000f6902'
\set ufe '00000000-0000-0000-0000-0000000f6903'
\set ula '00000000-0000-0000-0000-0000000f6904'
\set urb '00000000-0000-0000-0000-0000000f6905'
\set urp '00000000-0000-0000-0000-0000000f6906'
\set use '00000000-0000-0000-0000-0000000f6907'
\set ufr '00000000-0000-0000-0000-0000000f6908'
\set upn '00000000-0000-0000-0000-0000000f6909'
\set w2 '00000000-0000-0000-0000-0000000f6910'
\set lim '00000000-0000-0000-0000-0000000f6911'

update private.settings set value = 'true' where key in ('release_find_workers', 'entitlements_enforced');
select pg_temp.new_user(:'w2', 'worker');
select pg_temp.new_user(:'lim');
update public.profiles set account_kind = intended_account_kind where id in (:'w2', :'lim');
insert into public.organization_members (organization_id, user_id, role, accepted_at)
values (current_setting('t.a')::uuid, :'lim', 'member', now());
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (current_setting('t.a')::uuid, 'employer_starter', 'active', 'null'),
  (current_setting('t.b')::uuid, 'employer_professional', 'active', 'null');

-- An organisation of p_type owned by p_owner with a subscription to p_plan in p_status (none when p_plan is null), listed
-- in the partner directories when it is a partner and p_listed.
create function pg_temp.org(
  p_slug text, p_owner uuid, p_type text, p_plan text, p_status text default 'active', p_listed boolean default true
) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug, initcap(replace(p_slug, '-', ' ')), 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  if p_type <> 'employer' and p_listed then
    update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
      submitted_at = now() - interval '31 days'
    where id = v_id;
  end if;
  if p_plan is not null then
    insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, p_status, 'null');
  end if;
  return v_id;
end;
$$;

select set_config('t.trial', pg_temp.org('v69-trial', :'utr', 'employer', 'employer_starter', 'trialing')::text, true);
select set_config('t.pastdue', pg_temp.org('v69-past-due', :'upd', 'employer', 'employer_starter', 'past_due')::text, true);
select set_config('t.free', pg_temp.org('v69-free', :'ufe', 'employer', null)::text, true);
select set_config('t.lapsed', pg_temp.org('v69-lapsed', :'ula', 'employer', 'employer_starter', 'canceled')::text, true);
select set_config('t.rb', pg_temp.org('v69-rekrut', :'urb', 'recruitment_company', 'recruitment_partner')::text, true);
select set_config('t.rp', pg_temp.org('v69-rekrut-pro', :'urp', 'recruitment_company', 'recruitment_professional')::text, true);
select set_config('t.se', pg_temp.org('v69-staff-ent', :'use', 'staffing_company', 'staffing_enterprise')::text, true);
select set_config('t.fr', pg_temp.org('v69-free-rec', :'ufr', 'recruitment_company', null)::text, true);
select set_config('t.pn', pg_temp.org('v69-pending', :'upn', 'recruitment_company', 'recruitment_professional', 'active', false)::text, true);

create temp table tags (user_id uuid primary key, tag text unique not null);

-- A listed worker named p_tag, written as the database owner.
create function pg_temp.worker(
  p_tag text, p_country text, p_occupation text, p_prefs text[] default '{}', p_availability text default 'now',
  p_years integer default 3, p_headline text default null
) returns void
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(v_id, 'worker');
  update public.profiles set account_kind = 'worker' where id = v_id;
  insert into public.worker_profiles (user_id, first_name, last_name, current_country, occupation_id, headline,
    years_experience, availability, available_from, searchable)
  values (v_id, 'Zebulon', 'Quixote', p_country, p_occupation, coalesce(p_headline, 'Card ' || p_tag), p_years,
    p_availability::public.worker_availability, case when p_availability = 'from_date' then current_date + 30 end, true);
  insert into public.worker_preferred_countries (worker_user_id, country_code) select v_id, c from unnest(p_prefs) c;
  insert into tags values (v_id, p_tag);
end;
$$;

create function pg_temp.uid(p_tag text) returns uuid language sql as $$ select user_id from tags where tag = p_tag $$;
create function pg_temp.card(p_tag text) returns uuid
language sql as $$ select w.card_id from public.worker_profiles w join tags t on t.user_id = w.user_id where t.tag = p_tag $$;

-- search_workers as p_user (anonymous when null) for p_org: the tags of the cards (sorted, or in the order of the result
-- when p_ordered), with the rows in t.rows, or 'sqlstate|message|detail'. Each call starts a fresh rate-limit window.
create function pg_temp.sw(
  p_user uuid, p_org uuid, p_filters text default '{}', p_cursor text default null, p_limit integer default null,
  p_ordered boolean default false
) returns text
language plpgsql as $$
declare
  v_result text;
begin
  delete from private.rate_limit_hits;
  v_result := pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end, format(
    $f$select set_config('t.rows', coalesce((select jsonb_agg(to_jsonb(s) order by s.n)
       from (select x.*, row_number() over () as n from public.search_workers(%L, %L::jsonb, %L, %s) x) s)::text, '[]'), true)$f$,
    p_org, p_filters, p_cursor, coalesce(p_limit::text, 'null')), 'aal1');
  if v_result <> 'ok' then
    return v_result;
  end if;
  return (
    select coalesce(string_agg(t.tag, ',' order by case when p_ordered then r.n end, t.tag), '')
    from jsonb_array_elements(current_setting('t.rows')::jsonb) with ordinality r (item, n)
    join public.worker_profiles w on w.card_id = (r.item ->> 'card_id')::uuid
    join tags t on t.user_id = w.user_id
  );
end;
$$;

create function pg_temp.row_of(p_tag text) returns jsonb
language sql as $$
  select r from jsonb_array_elements(current_setting('t.rows')::jsonb) r where (r ->> 'card_id')::uuid = pg_temp.card(p_tag)
$$;
create function pg_temp.last_cursor() returns text
language sql as $$ select (current_setting('t.rows')::jsonb -> -1) ->> 'next_cursor' $$;

-- Shape -------------------------------------------------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.search_workers(uuid, jsonb, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.search_workers(uuid, jsonb, text, integer)', 'execute')
  and not has_function_privilege('service_role', 'public.search_workers(uuid, jsonb, text, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.worker_search_access(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.worker_search_access(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.toggle_saved_worker_card(uuid, uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.toggle_saved_worker_card(uuid, uuid, uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.list_saved_worker_cards(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.list_saved_worker_cards(uuid, uuid)', 'execute'),
  'AC1: the four functions are executable by authenticated only'
);
select is(
  (select count(*)::integer from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('assert_worker_searcher', 'holds_licence_for', 'worker_card_contact', 'assert_saved_card_requirement')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'no API role executes the private helpers'
);
select is_definer('public', 'search_workers', array['uuid', 'jsonb', 'text', 'integer'], 'search_workers is SECURITY DEFINER');
select is(
  (select array_agg(n order by o) from pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) with ordinality a (n, m, o)
   where p.oid = 'public.search_workers(uuid, jsonb, text, integer)'::regprocedure and a.m = 't'),
  array['card_id', 'headline', 'occupation_id', 'skills', 'years_experience', 'languages', 'availability', 'available_from',
    'current_country', 'preferred_countries', 'work_authorization_countries', 'training', 'employment_history',
    'preferred_industries', 'preferred_employment_types', 'updated_at', 'direct_contact', 'notice', 'matched_on', 'next_cursor']::text[],
  'AC4: the result is the columns of public.worker_search plus direct_contact, notice, matched_on and next_cursor'
);
select ok(
  (select p.prosrc !~* '\m(gender|age|nationality|religion|ethnicity|marital_status|health|photo|date_of_birth|first_name|last_name|email)\M'
   from pg_proc p where p.oid = 'public.search_workers(uuid, jsonb, text, integer)'::regprocedure),
  'AC5, NFR-S9: no parameter, filter key or term of search_workers names a sensitive characteristic or an identity field'
);
select ok(
  (select p.prosrc ~ 'order by x\.score desc, x\.updated_at desc, x\.card_id'
     and p.prosrc ~ 'order by r\.score desc, r\.updated_at desc, r\.card_id'
     and not exists (
       select 1 from regexp_matches(p.prosrc, 'order by [^;)]*', 'g') m (o)
       where m.o[1] ~* '(billing|subscription|plan|has_feature|paid)')
   from pg_proc p where p.oid = 'public.search_workers(uuid, jsonb, text, integer)'::regprocedure),
  'AC5, NFR-C8: the order is the match score, then updated_at newest first, then card_id, and no order by reads a plan'
);
select is(
  (select string_agg(key || '=' || (value #>> '{}'), ',' order by key) from private.settings where key like 'rate_limit_worker_search_%'),
  'rate_limit_worker_search_max=30,rate_limit_worker_search_seconds=60', 'AC9: the allowance is 30 searches in 60 seconds'
);

-- AC2: basic filters ---------------------------------------------------------------------------------------------------------

select pg_temp.worker('a01', 'NG', '7212', array['DE']);
select pg_temp.worker('a02', 'NG', '7212', array['DE', 'PL'], 'from_date');
select pg_temp.worker('a03', 'PH', '7212', array['DE']);
select pg_temp.worker('a04', 'PH', '7212', array['GB'], 'unavailable');
select pg_temp.worker('a05', 'NG', '7411', array['DE']);
select pg_temp.worker('a06', 'PH', '7411', array['DE']);
select pg_temp.worker('a07', 'NG', '7411', array['GB']);
select pg_temp.worker('a08', 'PL', '7411', array['DE'], 'now', 3, 'Experienced Welder on ships');
select pg_temp.worker('a09', 'PL', '7411', array['GB']);
insert into public.worker_skills (worker_user_id, skill) values (pg_temp.uid('a09'), 'Pipe welder');
select pg_temp.worker('a10', 'GB', '7212', array['DE']);
select pg_temp.worker('a11', 'PL', '7411', '{}', 'from_date');
select pg_temp.worker('a12', 'PL', '7411', array['DE']);
update public.worker_profiles set headline = 'Welder and fitter' where user_id = pg_temp.uid('a03');
update public.worker_profiles w set updated_at = now() - make_interval(mins => substr(t.tag, 2)::integer)
from tags t where t.user_id = w.user_id;

select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid), 'a01,a02,a03,a04,a05,a06,a07,a08,a09,a10,a11,a12',
  'AC2: without filters the Acme admin gets the twelve visible workers');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"q": "welder"}'), 'a01,a02,a03,a04,a08,a09,a10',
  'AC2: the keyword matches the occupation label, the headline and the skills, in any case');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"occupation": "7212"}'), 'a01,a02,a03,a04,a10', 'AC2: occupation 7212');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"current_country": "NG"}'), 'a01,a02,a05,a07', 'AC2: current country NG');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"destination": "DE"}'), 'a01,a02,a03,a05,a06,a08,a10,a12',
  'AC2: destination DE matches DE among the preferred countries');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"availability": "now"}'), 'a01,a03,a05,a06,a07,a08,a09,a10,a12',
  'AC2: available now');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, format('{"available_by": "%s"}', current_date + 30)),
  'a01,a02,a03,a05,a06,a07,a08,a09,a10,a11,a12', 'available by a date keeps those available now and from a date not after it');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"occupation": "7212", "destination": "DE", "availability": "now"}'),
  'a01,a03,a10', 'AC2: the filters combine with AND');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"current_country": "XX"}'), '', 'AC2: an unknown country returns no row and no error');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"current_country": "ng", "destination": null}'), 'a01,a02,a05,a07',
  'a code in lower case is read in upper case, and a null value counts as no filter');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"q": "welder"}', null, null, true), 'a03,a01,a02,a04,a08,a09,a10',
  'AC5: the card the keyword matches in two fields comes first, then the most recently updated');
select is(pg_temp.sw(:'urb', current_setting('t.rb')::uuid, '{"q": "welder"}', null, null, true), 'a03,a01,a02,a04,a08,a09,a10',
  'NFR-C8: a recruitment company on another plan gets the same order');

-- AC1: who may search ---------------------------------------------------------------------------------------------------------

select is(
  (select string_agg(r, ',' order by o) from (values
    (1, pg_temp.sw(:'own1', current_setting('t.a')::uuid, '{"occupation": "7212"}')),
    (2, pg_temp.sw(:'mem', current_setting('t.a')::uuid, '{"occupation": "7212"}')),
    (3, pg_temp.sw(:'own2', current_setting('t.b')::uuid, '{"occupation": "7212"}')),
    (4, pg_temp.sw(:'urb', current_setting('t.rb')::uuid, '{"occupation": "7212"}')),
    (5, pg_temp.sw(:'use', current_setting('t.se')::uuid, '{"occupation": "7212"}')),
    (6, pg_temp.sw(:'utr', current_setting('t.trial')::uuid, '{"occupation": "7212"}')),
    (7, pg_temp.sw(:'upd', current_setting('t.pastdue')::uuid, '{"occupation": "7212"}'))
  ) v (o, r)),
  'a01,a02,a03,a04,a10,a01,a02,a03,a04,a10,a01,a02,a03,a04,a10,a01,a02,a03,a04,a10,a01,a02,a03,a04,a10,a01,a02,a03,a04,a10,a01,a02,a03,a04,a10',
  'AC1: Starter (owner and member), Professional, recruitment Basic, staffing Enterprise, trialing and past_due search'
);
select is(pg_temp.sw(:'ufe', current_setting('t.free')::uuid), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|worker_search', 'AC1: a free employer is refused');
select is(pg_temp.sw(:'ufr', current_setting('t.fr')::uuid), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|worker_search', 'AC1: a free recruitment company is refused');
select is(pg_temp.sw(:'ula', current_setting('t.lapsed')::uuid), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|worker_search', 'AC1: a lapsed employer is refused');
select is(pg_temp.sw(:'upn', current_setting('t.pn')::uuid), '42501|CHARA_FORBIDDEN|not_listed', 'AC1: a partner awaiting approval is refused');
select is(pg_temp.sw(:'wkr', current_setting('t.a')::uuid), '42501|CHARA_FORBIDDEN|', 'AC1: a worker is refused');
select is(split_part(pg_temp.sw(null, current_setting('t.a')::uuid), '|', 2), 'permission denied for function search_workers',
  'AC1: an anonymous caller has no execute grant');
select is(pg_temp.sw(:'own2', current_setting('t.a')::uuid), '42501|CHARA_FORBIDDEN|', 'NFR-S8: a member of Beta cannot search for Acme');
select is(pg_temp.sw(:'urb', current_setting('t.rp')::uuid), '42501|CHARA_FORBIDDEN|', 'NFR-S8: a partner cannot search for another partner');
update public.organizations set status = 'suspended' where id = current_setting('t.trial')::uuid;
select is(pg_temp.sw(:'utr', current_setting('t.trial')::uuid), '42501|CHARA_FORBIDDEN|organization_suspended', 'a suspended employer is refused');
update public.organizations set moderation_state = 'hidden' where id = current_setting('t.se')::uuid;
select is(pg_temp.sw(:'use', current_setting('t.se')::uuid), '42501|CHARA_FORBIDDEN|profile_hidden', 'a partner hidden by moderation is refused');
update public.organizations set moderation_state = 'visible' where id = current_setting('t.se')::uuid;
update private.settings set value = 'false' where key = 'release_find_workers';
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid), 'P0002|CHARA_NOT_FOUND|', 'search_workers is not found while release_find_workers is off');
select is(pg_temp.call_as(:'adm', 'authenticated', format('select * from public.worker_search_access(%L)', current_setting('t.a')), 'aal1'),
  'P0002|CHARA_NOT_FOUND|', 'worker_search_access is not found while the release is off');
update private.settings set value = 'true' where key = 'release_find_workers';
select is(pg_temp.val_as(:'adm', 'aal1', format('select row(advanced, default_destination)::text from public.worker_search_access(%L)', current_setting('t.a'))),
  '(f,DE)', 'worker_search_access: Starter has no advanced filters and its rules are read for DE');
select is(pg_temp.val_as(:'own2', 'aal1', format('select row(advanced, default_destination)::text from public.worker_search_access(%L)', current_setting('t.b'))),
  '(t,GB)', 'worker_search_access: Professional has the advanced filters');
select is(pg_temp.call_as(:'ufe', 'authenticated', format('select * from public.worker_search_access(%L)', current_setting('t.free')), 'aal1'),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|worker_search', 'worker_search_access answers the same refusals');

-- AC5: input --------------------------------------------------------------------------------------------------------------------

select is(
  (select string_agg(pg_temp.sw(:'adm', current_setting('t.a')::uuid, format('{"%s": "x"}', k)), ',' order by o)
   from unnest(array['gender', 'age', 'nationality', 'religion', 'ethnicity', 'marital_status', 'health', 'photo']) with ordinality u (k, o)),
  'P0001|CHARA_INVALID_INPUT|gender,P0001|CHARA_INVALID_INPUT|age,P0001|CHARA_INVALID_INPUT|nationality,P0001|CHARA_INVALID_INPUT|religion,P0001|CHARA_INVALID_INPUT|ethnicity,P0001|CHARA_INVALID_INPUT|marital_status,P0001|CHARA_INVALID_INPUT|health,P0001|CHARA_INVALID_INPUT|photo',
  'AC5: each sensitive key is refused by name'
);
select is(
  (select string_agg(split_part(pg_temp.sw(:'adm', current_setting('t.a')::uuid, f), '|', 3), ',' order by o)
   from unnest(array['[]', '{"q": ""}', '{"q": 5}', '{"occupation": "72"}', '{"destination": "DEU"}', '{"availability": "later"}',
     '{"available_by": "2027-02-30"}', '{"industry": "CC"}']) with ordinality u (f, o)),
  'p_filters,q,q,occupation,destination,availability,available_by,industry',
  'a malformed filter is refused naming its key'
);
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{}', 'not-a-cursor'), 'P0001|CHARA_INVALID_INPUT|p_cursor', 'a malformed cursor is refused');

-- AC3: advanced filters -------------------------------------------------------------------------------------------------------

insert into public.worker_skills (worker_user_id, skill) values (pg_temp.uid('a01'), 'Welding'), (pg_temp.uid('a03'), 'welding'),
  (pg_temp.uid('a03'), 'TIG'), (pg_temp.uid('a05'), 'Wiring');
insert into public.worker_languages (worker_user_id, language_code, cefr_level) values
  (pg_temp.uid('a01'), 'de', 'B1'), (pg_temp.uid('a02'), 'de', 'C2'), (pg_temp.uid('a03'), 'de', 'A2'), (pg_temp.uid('a05'), 'de', 'B2'),
  (pg_temp.uid('a05'), 'en', 'C1');
update public.worker_profiles set years_experience = case user_id when pg_temp.uid('a01') then 5 when pg_temp.uid('a02') then 12
  when pg_temp.uid('a03') then 4 else years_experience end
where user_id in (pg_temp.uid('a01'), pg_temp.uid('a02'), pg_temp.uid('a03'));
insert into public.worker_preferred_industries (worker_user_id, industry_code) values (pg_temp.uid('a01'), 'C'), (pg_temp.uid('a02'), 'C');
insert into public.worker_preferred_employment_types (worker_user_id, employment_type) values
  (pg_temp.uid('a01'), 'full_time'), (pg_temp.uid('a02'), 'full_time');
update public.worker_profiles set card_show_industries = true where user_id = pg_temp.uid('a01');
-- An authorisation that expired yesterday, which the passport no longer accepts as new.
alter table public.worker_work_authorizations disable trigger worker_authorizations_check_expiry;
insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values
  (pg_temp.uid('a01'), 'DE', null), (pg_temp.uid('a02'), 'DE', current_date), (pg_temp.uid('a03'), 'DE', current_date - 1);
alter table public.worker_work_authorizations enable always trigger worker_authorizations_check_expiry;

select is(
  (select string_agg(pg_temp.sw(:'adm', current_setting('t.a')::uuid, f), ',' order by o)
   from unnest(array['{"skills": ["Welding"]}', '{"languages": [{"code": "de", "min_level": "B1"}]}', '{"min_experience": 5}',
     '{"industry": "C"}', '{"employment_type": "full_time"}', '{"work_authorization": "DE"}']) with ordinality u (f, o)),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_worker_search,P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_worker_search,P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_worker_search,P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_worker_search,P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_worker_search,P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_worker_search',
  'AC3: Starter is refused each advanced filter'
);
select is(pg_temp.sw(:'urb', current_setting('t.rb')::uuid, '{"skills": ["Welding"]}'), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|advanced_worker_search',
  'AC3: recruitment Basic is refused an advanced filter');
select is(pg_temp.sw(:'urb', current_setting('t.rb')::uuid, '{"occupation": "7212", "current_country": "NG"}'), 'a01,a02',
  'AC3: and its basic filters still work');
select is(pg_temp.sw(:'own2', current_setting('t.b')::uuid, '{"skills": ["welding"]}'), 'a01,a03', 'AC3: skills match in any case');
select is(pg_temp.sw(:'urp', current_setting('t.rp')::uuid, '{"skills": ["Welding"]}'), 'a01,a03', 'AC3: recruitment Professional uses the skills too');
select is(pg_temp.sw(:'own2', current_setting('t.b')::uuid, '{"skills": ["Welding", "TIG"]}', null, null, true), 'a03,a01',
  'AC5: a card holding more of the chosen skills ranks first');
select is(pg_temp.sw(:'own2', current_setting('t.b')::uuid, '{"languages": [{"code": "de", "min_level": "B1"}]}'), 'a01,a02,a05',
  'AC3: German at least B1 matches B1 to C2 and not A2');
select is(pg_temp.sw(:'own2', current_setting('t.b')::uuid, '{"languages": [{"code": "de", "min_level": "B1"}, {"code": "en", "min_level": "B2"}]}'),
  'a05', 'every language asked for must be held');
select is(pg_temp.sw(:'own2', current_setting('t.b')::uuid, '{"min_experience": 5}'), 'a01,a02', 'AC3: at least 5 years matches 5 and above');
select is(pg_temp.sw(:'own2', current_setting('t.b')::uuid, '{"industry": "C"}'), 'a01',
  'AC3: industry C matches only a worker who shows the preferred industries');
select is(pg_temp.sw(:'own2', current_setting('t.b')::uuid, '{"employment_type": "full_time"}'), 'a01',
  'AC3: employment type full_time likewise');
select is(pg_temp.sw(:'own2', current_setting('t.b')::uuid, '{"work_authorization": "DE"}'), 'a01,a02',
  'AC3: work authorisation DE matches entries without expiry or not expired before today');
select is(
  (select string_agg(split_part(pg_temp.sw(:'own2', current_setting('t.b')::uuid, f), '|', 3), ',' order by o)
   from unnest(array['{"skills": []}', '{"skills": ["a","b","c","d","e","f","g","h","i","j","k"]}', '{"languages": [{"code": "de"}]}',
     '{"languages": [{"code": "de", "min_level": "B1", "x": 1}]}', '{"min_experience": 61}', '{"min_experience": 2.5}',
     '{"employment_type": "gig"}', '{"work_authorization": "D"}']) with ordinality u (f, o)),
  'skills,skills,languages,languages,min_experience,min_experience,employment_type,work_authorization',
  'a malformed advanced filter is refused naming its key'
);
select is(pg_temp.sw(:'own2', current_setting('t.b')::uuid,
  '{"occupation": "7212", "destination": "DE", "skills": ["Welding"], "languages": [{"code": "de", "min_level": "B1"}]}'), 'a01',
  'the matched filters of a card');
select is(pg_temp.row_of('a01') -> 'matched_on', '["occupation", "skills", "destination", "language:de:B1"]'::jsonb,
  'AC7 data: matched_on names the filters in a fixed order, the language with the card''s own level');

-- AC4: only visible workers, and card fields only ---------------------------------------------------------------------------------

select pg_temp.worker('h01', 'NG', '7126');
select pg_temp.worker('h02', 'NG', '7126');
select pg_temp.worker('h03', 'NG', '7126');
select pg_temp.worker('h04', 'NG', '7126');
select pg_temp.worker('h05', 'NG', '7126');
update public.worker_profiles set searchable = false where user_id = pg_temp.uid('h02');
update public.worker_profiles set searchable = false where user_id = pg_temp.uid('h03');
update public.profiles set status = 'suspended' where id = pg_temp.uid('h04');
update public.profiles set deleted_at = now() where id = pg_temp.uid('h05');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"occupation": "7126"}'), 'h01',
  'AC4: hidden, withdrawn, suspended and closing workers are not returned');
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.row_of('h01')) k
   where k ~ '(user_id|name|email|phone|photo|document)'),
  null, 'AC4, NFR-S9: no result field is a user id, a name, a contact detail, a photo or a document'
);
select ok(
  position('Zebulon' in current_setting('t.rows')) = 0 and position('Quixote' in current_setting('t.rows')) = 0 and position(pg_temp.uid('h01')::text in current_setting('t.rows')) = 0,
  'NFR-S9: the worker''s name and user id appear nowhere in the result'
);
select is(pg_temp.row_of('h01') ->> 'training', null, 'AC4: a section the worker did not allow is null');

-- AC6: direct-hiring rules shape the cards ------------------------------------------------------------------------------------------

insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref) values
  ('PH', 'DE', 'blocked', 'Direct hiring from the Philippines to Germany is not allowed.', 'LO-1'),
  ('NP', null, 'licensed_partner_required', 'Hiring from Nepal needs a licensed recruitment partner.', 'LO-2');
select pg_temp.worker('r-ph', 'PH', '5120', array['DE']);
select pg_temp.worker('r-np', 'NP', '5120', array['DE']);
select pg_temp.worker('r-ng', 'NG', '5120', array['DE']);
insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until, confirmed_at,
  partner_terms_version)
values (current_setting('t.rb')::uuid, 'DE', 'Bundesagentur', 'DE-123', current_date + 100, now(), 1);

create function pg_temp.contacts() returns text
language sql as $$
  select coalesce(string_agg(t.tag || ':' || (r ->> 'direct_contact'), ',' order by t.tag), '')
  from jsonb_array_elements(current_setting('t.rows')::jsonb) r
  join public.worker_profiles w on w.card_id = (r ->> 'card_id')::uuid join tags t on t.user_id = w.user_id
$$;

select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"occupation": "5120", "destination": "DE"}'), 'r-ng,r-np,r-ph',
  'AC6: every card is still listed');
select is(pg_temp.contacts(), 'r-ng:allowed,r-np:partner_required,r-ph:blocked',
  'AC6: Acme with destination DE: PH blocked, NP partner required, NG allowed');
select is(
  (pg_temp.row_of('r-ph') ->> 'notice') || ' | ' || (pg_temp.row_of('r-np') ->> 'notice') || ' | '
    || ((pg_temp.row_of('r-ng') ->> 'notice') = (select value #>> '{}' from private.settings where key = 'direct_hiring_general_notice'))::text,
  'Direct hiring from the Philippines to Germany is not allowed. | Hiring from Nepal needs a licensed recruitment partner. | true',
  'AC6: each with its rule''s notice, NG with the general notice'
);
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"occupation": "5120"}') || ' ' || pg_temp.contacts(),
  'r-ng,r-np,r-ph r-ng:allowed,r-np:partner_required,r-ph:blocked',
  'AC6: without a destination the rules are read for Acme''s based-in country DE');
select is(pg_temp.sw(:'urb', current_setting('t.rb')::uuid, '{"occupation": "5120", "destination": "DE"}') || ' ' || pg_temp.contacts(),
  'r-ng,r-np,r-ph r-ng:allowed,r-np:allowed,r-ph:blocked',
  'AC6: Rekrut, licensed for DE, may contact NP directly; PH stays blocked');
select is(pg_temp.sw(:'urp', current_setting('t.rp')::uuid, '{"occupation": "5120", "destination": "DE"}') || ' ' || pg_temp.contacts(),
  'r-ng,r-np,r-ph r-ng:allowed,r-np:partner_required,r-ph:blocked', 'a partner without a licence for DE is not');
select is(pg_temp.sw(:'own2', current_setting('t.b')::uuid, '{"occupation": "5120"}') || ' ' || pg_temp.contacts(),
  'r-ng,r-np,r-ph r-ng:allowed,r-np:partner_required,r-ph:allowed',
  'Beta (based in GB): the PH to DE rule does not apply, the NP rule for any destination does');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"occupation": "5120", "destination": "PH"}') || ' ' || pg_temp.contacts(),
  ' ', 'a destination among nobody''s preferred countries lists nobody');

-- AC8: paging -------------------------------------------------------------------------------------------------------------------------

select pg_temp.worker('p' || lpad(i::text, 2, '0'), 'NG', '8322') from generate_series(1, 45) i;
update public.worker_profiles w set updated_at = now() - make_interval(mins => (t.n % 7)::integer)
from (select user_id, row_number() over (order by tag) as n from tags where tag ~ '^p[0-9]') t where t.user_id = w.user_id;

select set_config('t.page1', pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"occupation": "8322"}', null, null, true), true);
select set_config('t.cursor1', pg_temp.last_cursor(), true);
select is(cardinality(string_to_array(current_setting('t.page1'), ',')), 20, 'AC8: page 1 holds 20 cards');
select pg_temp.worker('p99', 'NG', '8322');
update public.worker_profiles set updated_at = now() + interval '1 minute' where user_id = pg_temp.uid('p99');
select set_config('t.page2', pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"occupation": "8322"}', current_setting('t.cursor1'), null, true), true);
select set_config('t.cursor2', pg_temp.last_cursor(), true);
select set_config('t.page3', pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"occupation": "8322"}', current_setting('t.cursor2'), null, true), true);
select is(
  cardinality(string_to_array(current_setting('t.page2'), ',')) || ',' || cardinality(string_to_array(current_setting('t.page3'), ',')),
  '20,5', 'AC8: pages 2 and 3 hold 20 and 5 cards after a new matching worker opted in'
);
select is(pg_temp.last_cursor(), null, 'AC8: the last page has no next cursor');
select is(
  (select string_agg(x, ',' order by x) from unnest(string_to_array(
     current_setting('t.page1') || ',' || current_setting('t.page2') || ',' || current_setting('t.page3'), ',')) x),
  (select string_agg(tag, ',' order by tag) from tags where tag ~ '^p[0-4][0-9]$'),
  'AC8: the three pages hold each of the original 45 exactly once'
);
select is(cardinality(string_to_array(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{}', null, 500), ',')), 50,
  'AC8: a limit of 500 is capped at 50');
select is(cardinality(string_to_array(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"occupation": "8322"}', null, 0), ',')), 1,
  'a limit below 1 is raised to 1');
select is(
  (select count(*)::integer from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
   and p.proname ~ '(worker|card)' and p.proname ~ '(export|csv|download)'),
  0, 'AC8: no export function exists for worker cards'
);

-- AC9: the throttle and the log ---------------------------------------------------------------------------------------------------

delete from private.worker_search_log;
delete from private.rate_limit_hits;
create function pg_temp.burst(p_user uuid, p_org uuid, p_times integer) returns text
language plpgsql as $$
declare
  v_last text;
begin
  for i in 1..p_times loop
    v_last := pg_temp.call_as(p_user, 'authenticated',
      format($f$select count(*) from public.search_workers(%L, '{"occupation": "7212"}'::jsonb)$f$, p_org), 'aal1');
  end loop;
  return v_last;
end;
$$;
select is(pg_temp.burst(:'lim', current_setting('t.a')::uuid, 30), 'ok', 'AC9: thirty searches within a minute succeed');
select is(pg_temp.burst(:'lim', current_setting('t.a')::uuid, 1), 'P0001|CHARA_RATE_LIMITED|', 'AC9: the 31st is refused');
select is(
  (select count(*) || ':' || count(distinct (organization_id, user_id, filter_names, result_count)) from private.worker_search_log),
  '30:1', 'AC9: each successful search wrote one log row, all alike'
);
select is(
  (select row(organization_id = current_setting('t.a')::uuid, user_id = :'lim', filter_names, result_count)::text
   from private.worker_search_log limit 1),
  '(t,t,{occupation},5)', 'AC9: the row holds the organisation, the user, the filter names and the number of results'
);
select columns_are('private', 'worker_search_log', array['id', 'organization_id', 'user_id', 'filter_names', 'result_count', 'created_at'],
  'AC9: the log has no column for a card, a filter value or worker data');
select is(pg_temp.sw(:'adm', current_setting('t.a')::uuid, '{"occupation": "8322"}', current_setting('t.cursor1')) <> '', true,
  'a next page is a page of the same search');
select is((select count(*)::integer from private.worker_search_log where user_id = :'adm'), 0, 'and is not logged again');
select ok(
  not exists (
    select 1 from (values ('anon'), ('authenticated'), ('service_role')) r (rol)
    where has_table_privilege(r.rol, 'private.worker_search_log', 'select, insert, update, delete, truncate, references, trigger'))
  and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.worker_search_log'::regclass),
  'AC9, NFR-S8: the log is readable by no API role, with RLS enabled and forced'
);
select is(pg_temp.call_as(:'own1', 'authenticated', 'select count(*) from private.worker_search_log', 'aal1'),
  '42501|permission denied for table worker_search_log|', 'NFR-S8: an owner cannot read the log');
select is((select days from private.retention_policies where entity = 'worker_search_log'), 90, 'AC9: the log is kept 90 days');
insert into private.worker_search_log (organization_id, user_id, filter_names, result_count, created_at)
values (current_setting('t.a')::uuid, :'adm', '{}', 0, now() - interval '91 days');
select private.apply_retention();
select is(
  (select count(*) filter (where created_at < now() - interval '90 days') || ':' || count(*) from private.worker_search_log),
  '0:30', 'AC9: the daily retention removes the rows older than 90 days and keeps the others'
);

-- AC12: saved cards -----------------------------------------------------------------------------------------------------------------

create function pg_temp.req(p_org uuid, p_status text default 'open') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.workforce_requirements (
    id, organization_id, title, workers_needed, country_code, city_region, industry_code, start_date, duration_months,
    employment_type, recruitment_preference, partner_need, status, close_reason, visibility, show_identity, published_at, closes_on
  ) values (
    v_id, p_org, 'Welders ' || p_status, 10, 'DE', 'Hamburg', 'C', '2027-03-01', 12, 'full_time', 'both', 'both',
    p_status::public.requirement_status, case when p_status = 'closed' then 'cancelled'::public.requirement_close_reason end,
    'private', false, now(), '2027-04-01'
  );
  insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (v_id, '7212', 10);
  insert into public.requirement_countries (requirement_id, country_code) values (v_id, 'DE');
  return v_id;
end;
$$;
select set_config('t.req', pg_temp.req(current_setting('t.a')::uuid)::text, true);
select set_config('t.closed', pg_temp.req(current_setting('t.a')::uuid, 'closed')::text, true);
select set_config('t.breq', pg_temp.req(current_setting('t.b')::uuid)::text, true);

create function pg_temp.save(p_user uuid, p_org text, p_tag text, p_req text, p_saved text default 'true') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select set_config(''t.saved'', public.toggle_saved_worker_card(%L, %L, %L, %s)::text, true)',
    p_org, pg_temp.card(p_tag), p_req, p_saved), 'aal1')
$$;

select is(pg_temp.save(:'mem', current_setting('t.a'), 'a01', current_setting('t.req')), 'ok', 'AC12: an Acme member saves a card for the requirement');
select is(pg_temp.save(:'mem', current_setting('t.a'), 'a01', current_setting('t.req')), 'ok', 'AC12: and saves it again');
select is(
  (select count(*) || ':' || bool_and(organization_id = current_setting('t.a')::uuid and saved_by = :'mem'
     and requirement_id = current_setting('t.req')::uuid and card_id = pg_temp.card('a01'))
   from public.saved_worker_cards),
  '1:true', 'AC12: one saved row holds the organisation, the card, the requirement and who saved it'
);
select is((select count(*)::integer from audit.log where action = 'saved_worker_card.added' and entity_id = current_setting('t.a')), 1,
  'one audit row for the one save');
select is(pg_temp.save(:'mem', current_setting('t.a'), 'a02', null), 'ok', 'a card can be saved for the organisation');
select is(pg_temp.save(:'mem', current_setting('t.a'), 'h02', current_setting('t.req')), 'P0002|CHARA_NOT_FOUND|',
  'a card that is not listed cannot be saved');
select is(pg_temp.save(:'mem', current_setting('t.a'), 'a01', current_setting('t.closed')), 'P0001|CHARA_INVALID_STATE|requirement_closed',
  'nor saved for a closed requirement');
select is(pg_temp.save(:'mem', current_setting('t.a'), 'a01', current_setting('t.breq')), 'P0002|CHARA_NOT_FOUND|',
  'NFR-S8: nor for another organisation''s requirement');
select is(pg_temp.save(:'own2', current_setting('t.a'), 'a01', null), '42501|CHARA_FORBIDDEN|', 'NFR-S8: Beta cannot save for Acme');
select is(pg_temp.save(:'ufe', current_setting('t.free'), 'a01', null), 'P0001|CHARA_FEATURE_NOT_IN_PLAN|worker_search',
  'a free employer cannot save');

select is(
  (select string_agg(r.rol || ':' || r.n, ',' order by r.rol) from (
    select 'beta-owner' as rol, pg_temp.val_as(:'own2', 'aal1', 'select count(*)::text from public.saved_worker_cards') as n
    union all select 'beta-admin', pg_temp.val_as(:'adm2', 'aal1', 'select count(*)::text from public.saved_worker_cards')
    union all select 'partner-1', pg_temp.val_as(:'urb', 'aal1', 'select count(*)::text from public.saved_worker_cards')
    union all select 'partner-2', pg_temp.val_as(:'urp', 'aal1', 'select count(*)::text from public.saved_worker_cards')
    union all select 'worker-1', pg_temp.val_as(:'wkr', 'aal1', 'select count(*)::text from public.saved_worker_cards')
    union all select 'worker-2', pg_temp.val_as(pg_temp.uid('a01'), 'aal1', 'select count(*)::text from public.saved_worker_cards')
    union all select 'zacme', pg_temp.val_as(:'own1', 'aal1', 'select count(*)::text from public.saved_worker_cards')
  ) r),
  'beta-admin:0,beta-owner:0,partner-1:0,partner-2:0,worker-1:0,worker-2:0,zacme:2',
  'AC12, NFR-S8: two employers, two partners and two candidates read none of Acme''s saved cards; Acme reads its two'
);
select is(split_part(pg_temp.call_as(null, 'anon', 'select count(*) from public.saved_worker_cards'), '|', 1), '42501',
  'NFR-S8: an anonymous caller is refused');
select ok(
  not has_table_privilege('authenticated', 'public.saved_worker_cards', 'insert, update, delete')
  and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.saved_worker_cards'::regclass),
  'NFR-S8: no write grant, RLS enabled and forced'
);

select is(
  pg_temp.val_as(:'mem', 'aal1', format(
    $$select string_agg(row(visible, occupation_id, direct_contact)::text, ',') from public.list_saved_worker_cards(%L, %L)$$,
    current_setting('t.a'), current_setting('t.req'))),
  '(t,7212,allowed)', 'AC12: the saved card is listed with its card fields'
);
update public.worker_profiles set searchable = false where user_id = pg_temp.uid('a01');
select is(
  pg_temp.val_as(:'mem', 'aal1', format(
    $$select string_agg(row(card_id is not null, visible, headline, occupation_id, skills, languages, direct_contact)::text, ',')
      from public.list_saved_worker_cards(%L, %L)$$,
    current_setting('t.a'), current_setting('t.req'))),
  '(t,f,,,,,)', 'AC12: after the withdrawal the saved card shows no card field'
);
select is(
  pg_temp.val_as(:'mem', 'aal1', format($$select count(*)::text from public.list_saved_worker_cards(%L)$$, current_setting('t.a'))),
  '1', 'the cards saved for the organisation are a list of their own'
);
select is(pg_temp.call_as(:'own2', 'authenticated', format('select * from public.list_saved_worker_cards(%L)', current_setting('t.a')), 'aal1'),
  '42501|CHARA_FORBIDDEN|', 'NFR-S8: Beta cannot list Acme''s saved cards');
select is(pg_temp.save(:'mem', current_setting('t.a'), 'a01', current_setting('t.req'), 'false'), 'ok',
  'a card that is no longer listed can still be removed');
select is(current_setting('t.saved') || ':' || (select count(*) from public.saved_worker_cards where requirement_id = current_setting('t.req')::uuid),
  'false:0', 'and is gone');
select is((select count(*)::integer from audit.log where action = 'saved_worker_card.removed' and entity_id = current_setting('t.a')), 1,
  'one audit row for the removal');
delete from public.worker_profiles where user_id = pg_temp.uid('a02');
select is((select count(*)::integer from public.saved_worker_cards where organization_id = current_setting('t.a')::uuid), 0,
  'an erased passport takes its saved cards with it');

select * from finish();
rollback;
