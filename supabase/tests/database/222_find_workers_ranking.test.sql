begin;
select plan(6);

\ir organizations_fixture.inc

-- Ranking transparency of Find Workers (V80, NFR-C8; extends 154 and 190): nothing the ranking page says never counts
-- changes the order of the cards. Identical cards, two of which list the keyword as a skill too, come back in the order
-- the page describes (the match score, the card's last change, the card id) for employers on Starter, Professional and
-- Enterprise and for recruitment and staffing companies on Basic, Professional and Enterprise; the same after the plans
-- are turned around, after one organisation saved a card and sent a contact request to another, and after a
-- direct-hiring rule makes the cards' country need a licensed partner (the rule shapes the contact, never the place). The
-- keyword is a word no other test uses.

update private.settings set value = 'true' where key = 'release_find_workers';

create function pg_temp.searcher(p_slug text, p_type text, p_plan text) returns uuid
language plpgsql as $$
declare
  v_owner uuid := gen_random_uuid();
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.new_user(v_owner);
  update public.profiles set account_kind = intended_account_kind where id = v_owner;
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type::public.organization_type, p_slug, 'Legal ' || p_slug, initcap(replace(p_slug, '-', ' ')), 'DE');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, v_owner, 'owner', now());
  if p_type <> 'employer' then
    update public.organizations set review_status = 'listed', listed_at = now() - interval '30 days',
      submitted_at = now() - interval '31 days'
    where id = v_id;
  end if;
  insert into billing.subscriptions (organization_id, plan_code, status, provider) values (v_id, p_plan, 'active', 'null');
  return v_id;
end;
$$;

create temp table rank_searchers (n integer primary key, org uuid, owner uuid);
insert into rank_searchers (n, org)
select n, pg_temp.searcher(slug, type, plan)
from (values
  (1, 'rank-fw-starter', 'employer', 'employer_starter'),
  (2, 'rank-fw-professional', 'employer', 'employer_professional'),
  (3, 'rank-fw-enterprise', 'employer', 'employer_enterprise'),
  (4, 'rank-fw-recruitment-basic', 'recruitment_company', 'recruitment_partner'),
  (5, 'rank-fw-recruitment-professional', 'recruitment_company', 'recruitment_professional'),
  (6, 'rank-fw-staffing-enterprise', 'staffing_company', 'staffing_enterprise')
) s (n, slug, type, plan);
update rank_searchers r set owner = m.user_id from public.organization_members m where m.organization_id = r.org;

-- Eight identical listed cards in Nigeria, changed at the same moment; the last two also list the keyword as a skill.
create temp table rank_cards (n integer primary key, user_id uuid);
insert into rank_cards select n, gen_random_uuid() from generate_series(1, 8) n;
select pg_temp.new_user(user_id, 'worker') from rank_cards;
update public.profiles set account_kind = 'worker' where id in (select user_id from rank_cards);
insert into public.worker_profiles (user_id, first_name, last_name, headline, current_country, occupation_id, availability,
  searchable, updated_at)
select user_id, 'Rank', 'Worker', 'Welder quoxumbra', 'NG', '7212', 'now', true, timestamptz '2027-01-04 09:00:00+00'
from rank_cards;
insert into public.worker_skills (worker_user_id, skill) select user_id, 'Quoxumbra welding' from rank_cards where n > 6;
update public.worker_profiles set updated_at = timestamptz '2027-01-04 09:00:00+00'
where user_id in (select user_id from rank_cards);

-- The card ids of the search for the keyword by the owner of searcher p_n, in the order of the answer.
create function pg_temp.order_for(p_n integer) returns text
language plpgsql as $$
declare
  v_searcher rank_searchers;
  v_order text;
begin
  select * into v_searcher from rank_searchers where n = p_n;
  delete from private.rate_limit_hits;
  perform set_config('request.jwt.claims', json_build_object('sub', v_searcher.owner, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select string_agg(s.card_id::text, ',' order by s.n) into v_order
  from (select w.card_id, row_number() over () as n from public.search_workers(v_searcher.org, '{"q": "quoxumbra"}') w) s;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_order;
end;
$$;

-- The order the ranking page describes: the score (the headline, and the skill of the last two), then the last change
-- (the same for all), then the card id.
create function pg_temp.described() returns text
language sql as $$
  select string_agg(w.card_id::text, ',' order by (c.n > 6) desc, w.updated_at desc, w.card_id)
  from rank_cards c join public.worker_profiles w on w.user_id = c.user_id
$$;

create function pg_temp.orders() returns text[]
language sql as $$
  select array_agg(pg_temp.order_for(n) order by n) from rank_searchers
$$;

select is(pg_temp.order_for(1), pg_temp.described(),
  'NFR-C8: the cards come in the order the ranking page describes: match score, last change, card id');
select is(pg_temp.orders(), array_fill(pg_temp.described(), array[6]),
  'NFR-C8: employers on Starter, Professional and Enterprise and partners on Basic, Professional and Enterprise read the same order');

update billing.subscriptions s set plan_code = case s.plan_code
    when 'employer_starter' then 'employer_enterprise' when 'employer_enterprise' then 'employer_starter'
    when 'recruitment_partner' then 'recruitment_professional' when 'recruitment_professional' then 'recruitment_partner'
    else s.plan_code end
where s.organization_id in (select org from rank_searchers);
select is(pg_temp.orders(), array_fill(pg_temp.described(), array[6]), 'NFR-C8: turning the plans around changes no order');

insert into public.saved_worker_cards (organization_id, card_id)
select r.org, w.card_id from rank_searchers r, rank_cards c join public.worker_profiles w on w.user_id = c.user_id
where r.n = 1 and c.n = 8;
insert into public.contact_requests (organization_id, worker_user_id, card_id, message, destination_country, expires_at)
select r.org, w.user_id, w.card_id, 'Would you like to weld in Hamburg?', 'DE', now() + interval '30 days'
from rank_searchers r, rank_cards c join public.worker_profiles w on w.user_id = c.user_id
where r.n = 1 and c.n = 5;
select is(pg_temp.orders(), array_fill(pg_temp.described(), array[6]),
  'NFR-C8: a saved card and a contact request change no order, for the organisation that made them or any other');

insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref)
values ('NG', 'DE', 'licensed_partner_required', 'Hiring from Nigeria to Germany needs a licensed recruitment partner.', 'RANK-V80');
select is(pg_temp.orders(), array_fill(pg_temp.described(), array[6]),
  'NFR-C8: a direct-hiring rule of the cards'' country shapes the contact, never the order');
select is(
  (select count(*)::integer from public.worker_profiles w join rank_cards c on c.user_id = w.user_id where w.updated_at <> timestamptz '2027-01-04 09:00:00+00'),
  0,
  'the cards were changed at the same moment throughout, so only the score and the card id order them'
);

select * from finish();
rollback;
