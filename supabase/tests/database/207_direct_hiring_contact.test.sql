begin;
select plan(29);

\ir jobs_fixture.inc

-- Direct-hiring rules in contact started by an organisation and in the licence prompt (V72; FR-Q5 AC5, AC9; FR-K1 AC8;
-- NFR-S8): private.direct_hiring_rule_for is the one rule behind the cards of search_workers, the refusals of
-- send_contact_request and private.assert_direct_hiring_allowed (invite to job, V71); licence_required_destinations names
-- the served countries a partner needs a licence for. Acme (t.a, employer, DE) is on Starter and Beta (t.b, employer, GB)
-- on Professional; Rekrut (licensed for DE) and Plain are listed recruitment companies based in DE on a paid plan. Workers
-- are written as the database owner with searchable set and named by a tag; their headline holds "Zyx72" so a search
-- finds them only.

\set urb '00000000-0000-0000-0000-0000000f7301'
\set upl '00000000-0000-0000-0000-0000000f7302'

-- The settings this file depends on are set here, not assumed: the parallel tests commit theirs through dblink and leave
-- them behind when they stop early.
update private.settings set value = 'true' where key in ('release_find_workers', 'release_messaging');
update private.settings set value = 'false' where key in ('release_job_orders', 'entitlements_enforced');
update private.settings set value = '25' where key = 'contact_requests_per_org_day_max';
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (current_setting('t.a')::uuid, 'employer_starter', 'active', 'null'),
  (current_setting('t.b')::uuid, 'employer_professional', 'active', 'null');

create function pg_temp.org(p_slug text, p_owner uuid, p_type text, p_plan text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(p_owner);
  update public.profiles set account_kind = intended_account_kind where id = p_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug, initcap(replace(p_slug, '-', ' ')), 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
    submitted_at = now() - interval '31 days'
  where id = v_id;
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  return v_id;
end;
$$;

select set_config('t.rb', pg_temp.org('v72-rekrut', :'urb', 'recruitment_company', 'recruitment_partner')::text, true);
select set_config('t.pl', pg_temp.org('v72-plain', :'upl', 'recruitment_company', 'recruitment_partner')::text, true);
insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until, confirmed_at,
  partner_terms_version)
values (current_setting('t.rb')::uuid, 'DE', 'Bundesagentur', 'DE-123', current_date + 100, now(), 1);
insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref) values
  ('PH', 'DE', 'blocked', 'Direct hiring from the Philippines to Germany is not allowed.', 'LO-1'),
  ('NP', 'DE', 'licensed_partner_required', 'Hiring from Nepal to Germany needs a licensed recruitment partner.', 'LO-2');

create temp table tags (user_id uuid primary key, tag text unique not null);

create function pg_temp.worker(p_tag text, p_country text default 'NG') returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(v_id, 'worker');
  update public.profiles set account_kind = 'worker' where id = v_id;
  insert into public.worker_profiles (user_id, first_name, last_name, current_country, occupation_id, headline,
    years_experience, availability, searchable)
  values (v_id, 'Amina', 'Okafor', p_country, '7212', 'Zyx72 welder ' || p_tag, 5, 'now', true);
  insert into tags values (v_id, p_tag);
  return v_id;
end;
$$;

create function pg_temp.card(p_tag text) returns uuid
language sql as $$ select w.card_id from public.worker_profiles w join tags t on t.user_id = w.user_id where t.tag = p_tag $$;

-- The direct_contact of each tagged card in the search of p_user for p_org (destination: the organisation's based-in
-- country), as 'tag:value' in tag order.
create function pg_temp.search_contact(p_user uuid, p_org uuid) returns text
language plpgsql as $$
declare
  v_cards jsonb;
begin
  v_cards := pg_temp.val_as(p_user, 'aal1', format(
    $f$select coalesce(jsonb_object_agg(card_id, direct_contact), '{}')::text
       from public.search_workers(%L, '{"q": "Zyx72"}'::jsonb, null, 50)$f$, p_org))::jsonb;
  return (select string_agg(t.tag || ':' || coalesce(v_cards ->> w.card_id::text, '-'), ',' order by t.tag)
          from tags t join public.worker_profiles w on w.user_id = t.user_id);
end;
$$;

-- What private.direct_hiring_rule_for answers for p_org and each tagged worker's current country to p_destination.
create function pg_temp.rule_contact(p_org uuid, p_destination text default 'DE') returns text
language sql as $$
  select string_agg(t.tag || ':' || d.direct_contact, ',' order by t.tag)
  from tags t join public.worker_profiles w on w.user_id = t.user_id
  cross join lateral private.direct_hiring_rule_for(p_org, w.current_country, p_destination) d
$$;

-- private.assert_direct_hiring_allowed for p_org and each tagged worker: 'tag:ok' or 'tag:sqlstate|message|detail'.
create function pg_temp.assert_contact(p_org uuid, p_destination text default 'DE') returns text
language plpgsql as $$
declare
  v_row record;
  v_out text[] := '{}';
  v_state text;
  v_message text;
  v_detail text;
begin
  for v_row in select t.tag, w.current_country from tags t join public.worker_profiles w on w.user_id = t.user_id order by t.tag loop
    begin
      perform private.assert_direct_hiring_allowed(p_org, v_row.current_country, p_destination);
      v_out := v_out || (v_row.tag || ':ok');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
      v_out := v_out || format('%s:%s|%s|%s', v_row.tag, v_state, v_message, coalesce(v_detail, ''));
    end;
  end loop;
  return array_to_string(v_out, ',');
end;
$$;

-- send_contact_request as p_user for each tagged card: 'tag:ok' or 'tag:sqlstate|message|detail'.
create function pg_temp.send_all(p_user uuid, p_org uuid) returns text
language sql as $$
  select string_agg(t.tag || ':' || pg_temp.call_as(p_user, 'authenticated', format(
    $f$select public.send_contact_request(%L, %L, 'We would like to talk to you about welding work in Hamburg.', null, null)$f$,
    p_org, w.card_id), 'aal1'), ',' order by t.tag)
  from tags t join public.worker_profiles w on w.user_id = t.user_id
$$;

select pg_temp.worker('ng') as ng \gset
select pg_temp.worker('np', 'NP') as np \gset
select pg_temp.worker('ph', 'PH') as ph \gset

-- One rule for the cards, the refusals and invite to job -----------------------------------------------------------------

select is(pg_temp.search_contact(:'mem', current_setting('t.a')::uuid), 'ng:allowed,np:partner_required,ph:blocked',
  'AC5: an employer''s cards show allowed, partner required and blocked by the worker''s current country');
select is(pg_temp.rule_contact(current_setting('t.a')::uuid), pg_temp.search_contact(:'mem', current_setting('t.a')::uuid),
  'the shared rule answers what the employer''s cards show');
select is(pg_temp.search_contact(:'urb', current_setting('t.rb')::uuid), 'ng:allowed,np:allowed,ph:blocked',
  'a recruitment company licensed for DE may contact where a licensed partner is required, never where blocked');
select is(pg_temp.rule_contact(current_setting('t.rb')::uuid), pg_temp.search_contact(:'urb', current_setting('t.rb')::uuid),
  'the shared rule answers what the licensed company''s cards show');
select is(pg_temp.search_contact(:'upl', current_setting('t.pl')::uuid), 'ng:allowed,np:partner_required,ph:blocked',
  'a recruitment company without a licence is held to the rule like an employer');
select is(pg_temp.rule_contact(current_setting('t.pl')::uuid), pg_temp.search_contact(:'upl', current_setting('t.pl')::uuid),
  'the shared rule answers what the unlicensed company''s cards show');

select is(pg_temp.assert_contact(current_setting('t.a')::uuid),
  'ng:ok,np:42501|CHARA_FORBIDDEN|licensed_partner_required,ph:42501|CHARA_FORBIDDEN|direct_hiring_blocked',
  'the check of invite to job refuses the employer as the cards say');
select is(pg_temp.assert_contact(current_setting('t.rb')::uuid), 'ng:ok,np:ok,ph:42501|CHARA_FORBIDDEN|direct_hiring_blocked',
  'and lets the licensed company through where a licensed partner is required');
select is(pg_temp.send_all(:'mem', current_setting('t.a')::uuid), pg_temp.assert_contact(current_setting('t.a')::uuid),
  'send_contact_request refuses exactly as the shared check: employer');
select is(pg_temp.send_all(:'urb', current_setting('t.rb')::uuid), pg_temp.assert_contact(current_setting('t.rb')::uuid),
  'send_contact_request refuses exactly as the shared check: licensed company');
select is(pg_temp.send_all(:'upl', current_setting('t.pl')::uuid), pg_temp.assert_contact(current_setting('t.pl')::uuid),
  'send_contact_request refuses exactly as the shared check: unlicensed company');

-- An expired licence no longer opens the partner-required corridor.
update public.partner_licences set valid_until = current_date - 1 where organization_id = current_setting('t.rb')::uuid;
select is(pg_temp.rule_contact(current_setting('t.rb')::uuid), 'ng:allowed,np:partner_required,ph:blocked',
  'a licence valid until yesterday counts as none');
select is(pg_temp.search_contact(:'urb', current_setting('t.rb')::uuid), 'ng:allowed,np:partner_required,ph:blocked',
  'and the cards follow');
update public.partner_licences set valid_until = current_date where organization_id = current_setting('t.rb')::uuid;
select is(pg_temp.rule_contact(current_setting('t.rb')::uuid), 'ng:allowed,np:allowed,ph:blocked',
  'a licence valid until today counts');

-- The gate: the check refuses nothing while release_job_orders and release_find_workers are both off.
update private.settings set value = 'false' where key = 'release_find_workers';
select is(pg_temp.assert_contact(current_setting('t.a')::uuid), 'ng:ok,np:ok,ph:ok',
  'both switches off: the check refuses nothing');
update private.settings set value = 'true' where key = 'release_job_orders';
select is(pg_temp.assert_contact(current_setting('t.a')::uuid),
  'ng:ok,np:42501|CHARA_FORBIDDEN|licensed_partner_required,ph:42501|CHARA_FORBIDDEN|direct_hiring_blocked',
  'release_job_orders on: the check is enforced');
update private.settings set value = 'true' where key = 'release_find_workers';

-- AC9: a rule added later leaves existing requests alone ------------------------------------------------------------------

select pg_temp.worker('ng2') as ng2 \gset
select is(
  pg_temp.call_as(:'own2', 'authenticated', format(
    $f$select set_config('t.beta_req', public.send_contact_request(%L, %L, 'We would like to talk to you about welding work.', null, 'DE')::text, true)$f$,
    current_setting('t.b'), pg_temp.card('ng2')), 'aal1'),
  'ok', 'AC9: Beta sends the NG worker a request for DE before any NG rule'
);
insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref) values
  ('NG', 'DE', 'blocked', 'Direct hiring from Nigeria to Germany is not allowed.', 'LO-3');
select is(
  pg_temp.call_as(:'ng2', 'authenticated', format($f$select public.respond_to_contact_request(%L, 'accept')$f$,
    current_setting('t.beta_req')), 'aal1'),
  'ok', 'AC9: after NG to DE is blocked the worker can still accept Beta''s pending request'
);
select is(
  (select status::text from public.contact_requests where id = current_setting('t.beta_req')::uuid),
  'accepted', 'AC9: the request is accepted'
);
select is(
  pg_temp.call_as(:'mem', 'authenticated', format(
    $f$select public.send_contact_request(%L, %L, 'We would like to talk to you about welding work.', null, null)$f$,
    current_setting('t.a'), pg_temp.card('ng2')), 'aal1'),
  '42501|CHARA_FORBIDDEN|direct_hiring_blocked', 'AC9: a new request from Acme to the NG worker is refused'
);
select is(pg_temp.search_contact(:'mem', current_setting('t.a')::uuid),
  'ng:blocked,ng2:blocked,np:partner_required,ph:blocked', 'AC9: the cards show blocked from the next search');

-- FR-K1 AC8: the served countries a partner needs a licence for ------------------------------------------------------------

insert into public.organization_geographies (organization_id, scope, country_code) values
  (current_setting('t.rb')::uuid, 'sources_from', 'PH'),
  (current_setting('t.rb')::uuid, 'serves_market', 'DE'),
  (current_setting('t.rb')::uuid, 'serves_market', 'SA'),
  (current_setting('t.rb')::uuid, 'serves_market', 'AE'),
  (current_setting('t.pl')::uuid, 'serves_market', 'DE'),
  (current_setting('t.pl')::uuid, 'serves_market', 'SA'),
  (current_setting('t.pl')::uuid, 'serves_market', 'AE');
insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref) values
  ('PH', 'SA', 'licensed_partner_required', 'Hiring from the Philippines to Saudi Arabia needs a licensed recruitment partner.', 'LO-4');

create function pg_temp.prompts(p_user uuid, p_org uuid, p_role text default 'authenticated') returns text
language plpgsql as $$
declare
  v_result text;
begin
  v_result := pg_temp.call_as(p_user, p_role, format(
    $f$select set_config('t.prompts', coalesce((select string_agg(country_code, ',') from public.licence_required_destinations(%L)), ''), true)$f$,
    p_org), 'aal1');
  return case when v_result = 'ok' then current_setting('t.prompts') else v_result end;
end;
$$;

select is(pg_temp.prompts(:'urb', current_setting('t.rb')::uuid), 'SA',
  'AC8: Rekrut (sourcing from PH) is prompted for SA; DE has its licence, AE no rule');
select is(pg_temp.prompts(:'upl', current_setting('t.pl')::uuid), 'DE,SA',
  'AC8: Plain lists no source country, so any licensed-partner rule naming a destination counts (as in partner responses)');
insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until, confirmed_at,
  partner_terms_version)
values (current_setting('t.rb')::uuid, 'SA', 'Ministry of Human Resources', 'SA-9', current_date + 100, now(), 1);
select is(pg_temp.prompts(:'urb', current_setting('t.rb')::uuid), '', 'AC8: once Rekrut adds its SA licence no prompt remains');
select is(pg_temp.prompts(:'own1', current_setting('t.a')::uuid), '', 'an employer serves no country and gets no prompt');

-- NFR-S8: two employers, two partners, two candidates and anonymous.
select is(
  pg_temp.prompts(:'upl', current_setting('t.rb')::uuid) || ';' || pg_temp.prompts(:'own1', current_setting('t.rb')::uuid)
  || ';' || pg_temp.prompts(:'own2', current_setting('t.pl')::uuid) || ';' || pg_temp.prompts(:'urb', current_setting('t.pl')::uuid),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|',
  'NFR-S8: another partner and the employers are refused another organisation''s prompts'
);
select is(
  pg_temp.prompts(:'ng', current_setting('t.rb')::uuid) || ';' || pg_temp.prompts(:'np', current_setting('t.pl')::uuid),
  '42501|CHARA_FORBIDDEN|;42501|CHARA_FORBIDDEN|', 'NFR-S8: the two candidates are refused'
);
select is(pg_temp.prompts(null, current_setting('t.rb')::uuid, 'anon'),
  '42501|permission denied for function licence_required_destinations|', 'NFR-S8: anonymous callers have no EXECUTE');
update private.settings set value = 'false' where key in ('release_find_workers', 'release_job_orders');
select is(pg_temp.prompts(:'urb', current_setting('t.rb')::uuid), 'P0002|CHARA_NOT_FOUND|',
  'both switches off: the prompt is not found');

select * from finish();
rollback;
