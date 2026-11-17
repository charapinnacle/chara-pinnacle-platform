-- Find Workers search (FR-Q2 AC1 to AC6, AC8, AC9, AC12; SOP P2-31 steps Filter, Rules, Show, Act, Protect; decisions 4.3,
-- 4.5; NFR-S8, NFR-S9, NFR-C8, NFR-M3, NFR-O5; DATA_MODEL.md sections 6, 9 and 10; V69, release 2c). search_workers is
-- the only reader of the listed cards of V68 (private.worker_cards where listed, the rows of public.worker_search) for
-- organisations: the members of an employer on a paid plan, or of a listed, active, visible recruitment or staffing
-- company on a paid partner plan, with the feature worker_search (decision 4.3). It returns the card columns of
-- public.worker_search and nothing else of the worker (NFR-S9), plus how the direct-hiring rules (FR-Q5) shape contact
-- with each card for the searcher's destination, and the filters the card matched.
--
-- Filters are one JSON object of known keys (AC5: no sensitive characteristic is a key, an unknown key is refused by
-- name). Basic: q, occupation, current_country, destination, availability, available_by. Advanced, with
-- advanced_worker_search (Professional and Enterprise): skills, languages, min_experience, industry, employment_type,
-- work_authorization. Every filter narrows; the order is the match score (how many card fields the keyword matched, and
-- how many of the chosen skills the card holds), then the card's updated_at, newest first, then card_id. Nothing in it
-- reads billing.* (NFR-C8); the ranking page describes it.
--
-- Rules shape, they do not hide (FR-Q2 open point): a card whose current country has a blocked or a
-- licensed_partner_required rule for the searcher's destination (the destination filter, else the organisation's
-- based-in country) is listed with direct_contact blocked or partner_required and the rule's notice; a recruitment or
-- staffing company with a current licence for that destination is allowed where a licensed partner is required. V72
-- enforces the rules in send_contact_request and the other actions.
--
-- Protect: searches are counted per user (rate_limit_worker_search_max 30 per rate_limit_worker_search_seconds 60) and
-- the first page of each is logged in private.worker_search_log (organisation, user, filter names, results on the page;
-- never a card or a filter value), kept 90 days. No export of cards exists. Cards can be saved for an organisation or
-- one of its requirements (AC12): public.saved_worker_cards, read through list_saved_worker_cards only while the card is
-- listed. Everything here answers CHARA_NOT_FOUND while release_find_workers is off.

insert into private.settings (key, value) values
  ('rate_limit_worker_search_max', '30'),
  ('rate_limit_worker_search_seconds', '60')
on conflict (key) do nothing;

-- Indexes of the filters ----------------------------------------------------------------------------------------------------

create index worker_profiles_search_occupation_idx on public.worker_profiles (occupation_id) where searchable;
create index worker_profiles_search_country_idx on public.worker_profiles (current_country) where searchable;
create index worker_preferred_countries_country_idx on public.worker_preferred_countries (country_code);
create index worker_languages_language_idx on public.worker_languages (language_code, cefr_level);
create index worker_skills_lower_skill_idx on public.worker_skills (lower(skill));
create index worker_work_authorizations_country_idx on public.worker_work_authorizations (country_code);
create index worker_preferred_industries_industry_idx on public.worker_preferred_industries (industry_code);
create index worker_preferred_employment_types_type_idx on public.worker_preferred_employment_types (employment_type);

-- The search log (AC9) ------------------------------------------------------------------------------------------------------

create table private.worker_search_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  filter_names text[] not null check (
    filter_names <@ array['q', 'occupation', 'current_country', 'destination', 'availability', 'available_by', 'skills',
                          'languages', 'min_experience', 'industry', 'employment_type', 'work_authorization']
  ),
  result_count integer not null check (result_count between 0 and 50),
  created_at timestamptz not null default now()
);

comment on table private.worker_search_log is
  'One row per first page of a Find Workers search (FR-Q2 AC9, SOP P2-31 step Protect): organisation, user, the names of the filters used and the number of cards on the first page. Never a card id, a filter value or worker data. Written by search_workers, read by no API role, kept for worker_search_log days.';

create index worker_search_log_created_at_idx on private.worker_search_log (created_at);
create index worker_search_log_organization_idx on private.worker_search_log (organization_id);
create index worker_search_log_user_idx on private.worker_search_log (user_id);

alter table private.worker_search_log enable row level security;
alter table private.worker_search_log force row level security;
revoke all on table private.worker_search_log from public, anon, authenticated, service_role;

insert into private.retention_policies (entity, days, label, description) values
  ('worker_search_log', 90, 'Find Workers search log',
   'Days the record of a Find Workers search (organisation, user, the names of the filters used and the number of results; no worker data) is kept.');

-- Saved cards (AC12) ---------------------------------------------------------------------------------------------------------

-- A card an organisation keeps, for one of its requirements or (requirement_id null) for the organisation. The card id is
-- the pseudonym of V68 and goes with the passport; a card that is no longer listed stays saved and shows nothing.
create table public.saved_worker_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  card_id uuid not null references public.worker_profiles (card_id) on delete cascade,
  requirement_id uuid references public.workforce_requirements (id) on delete cascade,
  saved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint saved_worker_cards_key unique nulls not distinct (organization_id, requirement_id, card_id)
);

comment on table public.saved_worker_cards is
  'The Find Workers cards an organisation saved (FR-Q2 AC12), for one of its workforce requirements or for the organisation, shared by its members. Written only by toggle_saved_worker_card; the card fields are read only through list_saved_worker_cards while the card is listed.';

create index saved_worker_cards_list_idx on public.saved_worker_cards (organization_id, requirement_id, created_at desc);
create index saved_worker_cards_card_idx on public.saved_worker_cards (card_id);
create index saved_worker_cards_requirement_idx on public.saved_worker_cards (requirement_id);
create index saved_worker_cards_saved_by_idx on public.saved_worker_cards (saved_by);

alter table public.saved_worker_cards enable row level security;
alter table public.saved_worker_cards force row level security;
revoke all on table public.saved_worker_cards from public, anon, authenticated, service_role;
grant select on public.saved_worker_cards to authenticated;

create policy saved_worker_cards_select_member on public.saved_worker_cards
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- Helpers ------------------------------------------------------------------------------------------------------------------------

-- The checks every Find Workers call starts with (AC1). CHARA_NOT_FOUND while release_find_workers is off; CHARA_FORBIDDEN
-- (42501) without a session or for a caller who is not an accepted member of p_org (workers, other organisations), then
-- organization_suspended, and for a recruitment or staffing company not_listed (not approved yet, or declined) and
-- profile_hidden; CHARA_FEATURE_NOT_IN_PLAN worker_search for a free plan code (a lapsed subscription falls back to it)
-- or a plan without the feature. Answers the organisation.
create function private.assert_worker_searcher(p_org uuid) returns public.organizations
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if not private.release_on('release_find_workers') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is null or p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_org from public.organizations o where o.id = p_org;
  if v_org.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'organization_suspended', errcode = '42501';
  end if;
  if v_org.type <> 'employer' then
    if not private.is_listed_partner(p_org) then
      raise exception 'CHARA_FORBIDDEN' using detail = 'not_listed', errcode = '42501';
    end if;
    if v_org.moderation_state <> 'visible' then
      raise exception 'CHARA_FORBIDDEN' using detail = 'profile_hidden', errcode = '42501';
    end if;
  end if;
  if private.org_plan_code(p_org) like 'free\_%' or not private.has_feature(p_org, 'worker_search') then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'worker_search';
  end if;
  return v_org;
end;
$$;

revoke all on function private.assert_worker_searcher(uuid) from public, anon, authenticated, service_role;

-- Whether p_org holds a current licence for p_destination (FR-J2): an entry for the country valid until today (UTC) or
-- later, as the licence check of partner responses reads it. An employer holds none.
create function private.holds_licence_for(p_org uuid, p_destination text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_destination is not null and exists (
    select 1 from public.partner_licences l
    where l.organization_id = p_org and l.country_code = p_destination
      and l.valid_until >= (now() at time zone 'utc')::date
  )
$$;

revoke all on function private.holds_licence_for(uuid, text) from public, anon, authenticated, service_role;

-- How the direct-hiring rule of a card's current country (p_source, never a nationality) for the searcher's destination
-- shapes contact (AC6): allowed, partner_required or blocked, with the rule's notice (the general notice by default).
-- A searcher licensed for the destination is allowed where a licensed partner is required.
create function private.worker_card_contact(p_source text, p_destination text, p_licensed boolean)
returns table (direct_contact text, notice text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case d.rule
      when 'blocked' then 'blocked'
      when 'licensed_partner_required' then case when p_licensed then 'allowed' else 'partner_required' end
      else 'allowed'
    end,
    d.notice
  from private.direct_hiring_rule(p_source, p_destination) d
$$;

revoke all on function private.worker_card_contact(text, text, boolean) from public, anon, authenticated, service_role;

-- What the page needs before it shows the form: the checks of private.assert_worker_searcher (whose refusals the page
-- shows instead of the form), whether the advanced filters are open, and the destination the rules are read for when
-- no destination is chosen (the organisation's based-in country). Not counted against the search allowance.
create function public.worker_search_access(p_org uuid) returns table (advanced boolean, default_destination text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations := private.assert_worker_searcher(p_org);
begin
  return query select private.has_feature(p_org, 'advanced_worker_search'), v_org.based_in_country;
end;
$$;

revoke all on function public.worker_search_access(uuid) from public, anon, authenticated, service_role;
grant execute on function public.worker_search_access(uuid) to authenticated;

-- The search ----------------------------------------------------------------------------------------------------------------------

-- Find Workers for the organisation p_org (AC1 to AC6, AC8, AC9). p_filters, keys all optional and combined with AND:
--   q                   1 to 100 characters, in the occupation's label or synonyms, the headline or a skill (any case)
--   occupation          an ISCO-08 unit group code (4 digits)
--   current_country     an ISO 3166-1 alpha-2 code, the country the worker lives in
--   destination         an ISO code among the worker's preferred countries; also the destination of the rules
--   availability        'now'
--   available_by        a date: available now or from a date not after it
--   skills              1 to 10 skills (1 to 50 characters); a card holding at least one, ranked by how many
--   languages           1 to 5 objects {code, min_level}: the card holds each language at that CEFR level or above
--   min_experience      0 to 60 years of experience at least
--   industry            an ISIC Rev.4 section letter among the preferred industries the worker shows
--   employment_type     a public.employment_type among the preferred employment types the worker shows
--   work_authorization  an ISO code of an unexpired work authorisation
-- Codes are checked for their shape only: an unknown code answers no rows. Pages of 20 by default and at most 50; the
-- last row of a page with a next one carries next_cursor, an opaque keyset cursor (score, updated_at, card_id), so a
-- card listed while someone pages neither repeats nor pushes a card out (AC8). Refusals in order: those of
-- private.assert_worker_searcher, CHARA_RATE_LIMITED, CHARA_INVALID_INPUT naming the key (p_filters when it is no object,
-- p_cursor), CHARA_FEATURE_NOT_IN_PLAN advanced_worker_search for an advanced key.
create function public.search_workers(p_org uuid, p_filters jsonb default '{}', p_cursor text default null, p_limit integer default null)
returns table (
  card_id uuid,
  headline text,
  occupation_id text,
  skills text[],
  years_experience smallint,
  languages jsonb,
  availability public.worker_availability,
  available_from date,
  current_country text,
  preferred_countries text[],
  work_authorization_countries text[],
  training jsonb,
  employment_history jsonb,
  preferred_industries text[],
  preferred_employment_types text[],
  updated_at timestamptz,
  direct_contact text,
  notice text,
  matched_on text[],
  next_cursor text
)
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations := private.assert_worker_searcher(p_org);
  v_filters jsonb := jsonb_strip_nulls(coalesce(p_filters, '{}'::jsonb));
  v_keys constant text[] := array['q', 'occupation', 'current_country', 'destination', 'availability', 'available_by',
    'skills', 'languages', 'min_experience', 'industry', 'employment_type', 'work_authorization'];
  v_advanced constant text[] := array['skills', 'languages', 'min_experience', 'industry', 'employment_type',
    'work_authorization'];
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_today date := (now() at time zone 'utc')::date;
  v_key text;
  v_q text;
  v_q_occupations text[];
  v_occupation text;
  v_current text;
  v_destination text;
  v_availability text;
  v_by date;
  v_skills text[];
  v_lang_codes text[];
  v_lang_levels public.cefr_level[];
  v_min_exp integer;
  v_industry text;
  v_type public.employment_type;
  v_auth text;
  v_rule_destination text;
  v_licensed boolean;
  v_after_score integer;
  v_after_updated timestamptz;
  v_after_card uuid;
  v_count integer;
begin
  perform private.check_rate_limit('worker_search', v_uid);

  if jsonb_typeof(v_filters) <> 'object' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_filters';
  end if;
  select k into v_key from jsonb_object_keys(v_filters) k where k <> all (v_keys) order by k limit 1;
  if v_key is not null then
    raise exception 'CHARA_INVALID_INPUT' using detail = v_key;
  end if;

  if v_filters ? 'q' then
    v_q := btrim(v_filters ->> 'q');
    if jsonb_typeof(v_filters -> 'q') <> 'string' or length(v_q) not between 1 and 100 then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'q';
    end if;
    v_q := lower(v_q);
    v_q_occupations := array(
      select o.code from public.occupations o
      where strpos(lower(o.label), v_q) > 0 or exists (select 1 from unnest(o.synonyms) y where strpos(lower(y), v_q) > 0));
  end if;
  foreach v_key in array array['occupation', 'current_country', 'destination', 'work_authorization', 'industry',
    'availability', 'available_by', 'employment_type', 'min_experience'] loop
    if v_filters ? v_key and jsonb_typeof(v_filters -> v_key) <> (case when v_key = 'min_experience' then 'number' else 'string' end) then
      raise exception 'CHARA_INVALID_INPUT' using detail = v_key;
    end if;
  end loop;
  v_occupation := v_filters ->> 'occupation';
  if v_occupation !~ '^[0-9]{4}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupation';
  end if;
  v_current := upper(v_filters ->> 'current_country');
  if v_current !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'current_country';
  end if;
  v_destination := upper(v_filters ->> 'destination');
  if v_destination !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'destination';
  end if;
  v_auth := upper(v_filters ->> 'work_authorization');
  if v_auth !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'work_authorization';
  end if;
  v_industry := upper(v_filters ->> 'industry');
  if v_industry !~ '^[A-Z]$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'industry';
  end if;
  v_availability := v_filters ->> 'availability';
  if v_availability <> 'now' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'availability';
  end if;
  if v_filters ? 'available_by' then
    begin
      if v_filters ->> 'available_by' !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'invalid';
      end if;
      v_by := (v_filters ->> 'available_by')::date;
    exception when others then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'available_by';
    end;
  end if;
  if v_filters ? 'employment_type' then
    if not (v_filters ->> 'employment_type') = any (enum_range(null::public.employment_type)::text[]) then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'employment_type';
    end if;
    v_type := (v_filters ->> 'employment_type')::public.employment_type;
  end if;
  if v_filters ? 'min_experience' then
    if (v_filters ->> 'min_experience') !~ '^[0-9]{1,2}$' or (v_filters ->> 'min_experience')::integer > 60 then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'min_experience';
    end if;
    v_min_exp := (v_filters ->> 'min_experience')::integer;
  end if;
  if v_filters ? 'skills' then
    if jsonb_typeof(v_filters -> 'skills') <> 'array' or jsonb_array_length(v_filters -> 'skills') not between 1 and 10
       or exists (
         select 1 from jsonb_array_elements(v_filters -> 'skills') e
         where jsonb_typeof(e) <> 'string' or length(btrim(e #>> '{}')) not between 1 and 50) then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'skills';
    end if;
    v_skills := array(select distinct lower(btrim(e #>> '{}')) from jsonb_array_elements(v_filters -> 'skills') e);
  end if;
  if v_filters ? 'languages' then
    if jsonb_typeof(v_filters -> 'languages') <> 'array' or jsonb_array_length(v_filters -> 'languages') not between 1 and 5
       or exists (
         select 1 from jsonb_array_elements(v_filters -> 'languages') e
         where jsonb_typeof(e) <> 'object' or (select count(*) from jsonb_object_keys(e)) <> 2
           or e ->> 'code' is null or e ->> 'code' !~ '^[a-z]{2}$'
           or e ->> 'min_level' is null or not (e ->> 'min_level') = any (enum_range(null::public.cefr_level)::text[])) then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'languages';
    end if;
    select array_agg(e ->> 'code' order by n), array_agg((e ->> 'min_level')::public.cefr_level order by n)
    into v_lang_codes, v_lang_levels
    from jsonb_array_elements(v_filters -> 'languages') with ordinality x (e, n);
  end if;

  if p_cursor is not null then
    begin
      select split_part(t, '|', 1)::integer, split_part(t, '|', 2)::timestamp at time zone 'UTC', split_part(t, '|', 3)::uuid
      into strict v_after_score, v_after_updated, v_after_card
      from convert_from(decode(p_cursor, 'hex'), 'UTF8') t
      where t ~ '^[0-9]{1,3}\|[0-9: .-]+\|[0-9a-f-]{36}$';
    exception when others then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end;
  end if;

  if v_filters ?| v_advanced and not private.has_feature(p_org, 'advanced_worker_search') then
    raise exception 'CHARA_FEATURE_NOT_IN_PLAN' using detail = 'advanced_worker_search';
  end if;

  v_rule_destination := coalesce(v_destination, v_org.based_in_country);
  v_licensed := v_org.type <> 'employer' and private.holds_licence_for(p_org, v_rule_destination);

  return query
  with found as (
    select c.user_id, c.card_id, c.updated_at,
      coalesce(c.occupation_id = any (v_q_occupations), false) as q_occupation,
      v_q is not null and strpos(lower(coalesce(c.headline, '')), v_q) > 0 as q_headline,
      v_q is not null and exists (
        select 1 from public.worker_skills s where s.worker_user_id = c.user_id and strpos(lower(s.skill), v_q) > 0
      ) as q_skills,
      case when v_skills is null then 0 else (
        select count(*)::integer from public.worker_skills s where s.worker_user_id = c.user_id and lower(s.skill) = any (v_skills)
      ) end as skill_hits
    from private.worker_cards c
    join public.worker_profiles w on w.user_id = c.user_id
    where c.listed
      and (v_occupation is null or c.occupation_id = v_occupation)
      and (v_current is null or c.current_country = v_current)
      and (v_destination is null or exists (
        select 1 from public.worker_preferred_countries pc where pc.worker_user_id = c.user_id and pc.country_code = v_destination))
      and (v_availability is null or c.availability = 'now')
      and (v_by is null or c.availability = 'now' or (c.availability = 'from_date' and c.available_from <= v_by))
      and (v_min_exp is null or c.years_experience >= v_min_exp)
      and (v_lang_codes is null or not exists (
        select 1 from unnest(v_lang_codes, v_lang_levels) f (code, level)
        where not exists (
          select 1 from public.worker_languages l
          where l.worker_user_id = c.user_id and l.language_code = f.code and l.cefr_level >= f.level)))
      and (v_industry is null or (w.card_show_industries and exists (
        select 1 from public.worker_preferred_industries i where i.worker_user_id = c.user_id and i.industry_code = v_industry)))
      and (v_type is null or (w.card_show_industries and exists (
        select 1 from public.worker_preferred_employment_types et
        where et.worker_user_id = c.user_id and et.employment_type = v_type)))
      and (v_auth is null or exists (
        select 1 from public.worker_work_authorizations a
        where a.worker_user_id = c.user_id and a.country_code = v_auth and (a.expires_on is null or a.expires_on >= v_today)))
  ),
  r as (
    select f.*, f.q_occupation::integer + f.q_headline::integer + f.q_skills::integer + f.skill_hits as score
    from found f
    where (v_q is null or f.q_occupation or f.q_headline or f.q_skills)
      and (v_skills is null or f.skill_hits > 0)
  ),
  page as (
    select x.*, row_number() over (order by x.score desc, x.updated_at desc, x.card_id) as n
    from (
      select r.* from r
      where v_after_card is null
         or r.score < v_after_score
         or (r.score = v_after_score and r.updated_at < v_after_updated)
         or (r.score = v_after_score and r.updated_at = v_after_updated and r.card_id > v_after_card)
      order by r.score desc, r.updated_at desc, r.card_id
      limit v_limit + 1
    ) x
  )
  select c.card_id, c.headline, c.occupation_id, c.skills, c.years_experience, c.languages, c.availability, c.available_from,
    c.current_country, c.preferred_countries, c.work_authorization_countries, c.training, c.employment_history,
    c.preferred_industries, c.preferred_employment_types, c.updated_at,
    dc.direct_contact, dc.notice,
    array_remove(array[
        case when v_occupation is not null or p.q_occupation then 'occupation' end,
        case when p.q_headline then 'headline' end,
        case when p.q_skills or p.skill_hits > 0 then 'skills' end,
        case when v_current is not null then 'current_country' end,
        case when v_destination is not null then 'destination' end,
        case when v_availability is not null or v_by is not null then 'availability' end,
        case when v_min_exp is not null then 'experience' end
      ], null)
      || array(
        select 'language:' || l.language_code || ':' || l.cefr_level
        from unnest(v_lang_codes) with ordinality f (code, n)
        join public.worker_languages l on l.worker_user_id = p.user_id and l.language_code = f.code
        order by f.n)
      || array_remove(array[
        case when v_industry is not null then 'industry' end,
        case when v_type is not null then 'employment_type' end,
        case when v_auth is not null then 'work_authorization' end
      ], null),
    case when p.n = v_limit and exists (select 1 from page m where m.n > v_limit) then
      encode(convert_to(p.score || '|' || (p.updated_at at time zone 'UTC')::text || '|' || p.card_id, 'UTF8'), 'hex')
    end
  from page p
  join private.worker_cards c on c.user_id = p.user_id
  cross join lateral private.worker_card_contact(c.current_country, v_rule_destination, v_licensed) dc
  where p.n <= v_limit
  order by p.n;

  get diagnostics v_count = row_count;
  if p_cursor is null then
    insert into private.worker_search_log (organization_id, user_id, filter_names, result_count)
    values (p_org, v_uid, array(select k from jsonb_object_keys(v_filters) k order by array_position(v_keys, k)), v_count);
  end if;
end;
$$;

revoke all on function public.search_workers(uuid, jsonb, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_workers(uuid, jsonb, text, integer) to authenticated;

-- Saving a card (AC12) ---------------------------------------------------------------------------------------------------------

-- The requirement p_requirement of p_org that a card may be saved for: CHARA_NOT_FOUND for another organisation's or an
-- unknown one, CHARA_INVALID_STATE requirement_closed once it is closed or filled. Null passes (saved for the
-- organisation).
create function private.assert_saved_card_requirement(p_org uuid, p_requirement uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status public.requirement_status;
begin
  if p_requirement is null then
    return;
  end if;
  select r.status into v_status from public.workforce_requirements r where r.id = p_requirement and r.organization_id = p_org;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status in ('closed', 'filled') then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_closed';
  end if;
end;
$$;

revoke all on function private.assert_saved_card_requirement(uuid, uuid) from public, anon, authenticated, service_role;

-- Saves or unsaves the card p_card for p_org, for its requirement p_requirement or for the organisation (null), and answers
-- whether it is saved now. p_saved null toggles; true or false sets the state, so a repeated press changes nothing. Any
-- member may save, with the right to search (private.assert_worker_searcher), a card that is listed now (CHARA_NOT_FOUND
-- otherwise, so a saved card reveals nothing a search would not); unsaving needs membership only, whatever the plan or the
-- card's state, so a lapsed organisation can still clear its list. A change writes one audit row,
-- saved_worker_card.added or saved_worker_card.removed, on the organisation. Serialised per organisation.
create function public.toggle_saved_worker_card(
  p_org uuid, p_card uuid, p_requirement uuid default null, p_saved boolean default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_want boolean;
begin
  if not private.release_on('release_find_workers') then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is null or p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if p_card is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_card';
  end if;
  perform private.assert_saved_card_requirement(p_org, p_requirement);
  perform pg_advisory_xact_lock(hashtextextended('saved_worker_cards:' || p_org::text, 0));

  v_exists := exists (
    select 1 from public.saved_worker_cards s
    where s.organization_id = p_org and s.card_id = p_card and s.requirement_id is not distinct from p_requirement);
  v_want := coalesce(p_saved, not v_exists);
  if v_want = v_exists then
    return v_want;
  end if;

  if v_want then
    perform private.assert_worker_searcher(p_org);
    if not exists (select 1 from private.worker_cards c where c.card_id = p_card and c.listed) then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    insert into public.saved_worker_cards (organization_id, card_id, requirement_id, saved_by)
    values (p_org, p_card, p_requirement, (select auth.uid()));
  else
    delete from public.saved_worker_cards s
    where s.organization_id = p_org and s.card_id = p_card and s.requirement_id is not distinct from p_requirement;
  end if;
  perform audit.record(
    case when v_want then 'saved_worker_card.added' else 'saved_worker_card.removed' end, 'organization', p_org::text,
    jsonb_strip_nulls(jsonb_build_object('card_id', p_card, 'requirement_id', p_requirement)));
  return v_want;
end;
$$;

revoke all on function public.toggle_saved_worker_card(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.toggle_saved_worker_card(uuid, uuid, uuid, boolean) to authenticated;

-- The cards p_org saved for its requirement p_requirement (or for the organisation, null), newest first, at most 100
-- (AC12): a listed card with its card columns and how the rules shape contact for the requirement's main destination
-- (else the organisation's based-in country); a card that is no longer listed with visible false and no card field.
-- Needs the right to search, as reading a card does.
create function public.list_saved_worker_cards(p_org uuid, p_requirement uuid default null)
returns table (
  card_id uuid,
  requirement_id uuid,
  saved_at timestamptz,
  visible boolean,
  headline text,
  occupation_id text,
  skills text[],
  years_experience smallint,
  languages jsonb,
  availability public.worker_availability,
  available_from date,
  current_country text,
  preferred_countries text[],
  work_authorization_countries text[],
  training jsonb,
  employment_history jsonb,
  preferred_industries text[],
  preferred_employment_types text[],
  updated_at timestamptz,
  direct_contact text,
  notice text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations := private.assert_worker_searcher(p_org);
  v_destination text;
  v_licensed boolean;
begin
  perform private.assert_saved_card_requirement(p_org, p_requirement);
  v_destination := coalesce(
    (select r.country_code from public.workforce_requirements r where r.id = p_requirement), v_org.based_in_country);
  v_licensed := v_org.type <> 'employer' and private.holds_licence_for(p_org, v_destination);

  return query
  select s.card_id, s.requirement_id, s.created_at, c.card_id is not null,
    c.headline, c.occupation_id, c.skills, c.years_experience, c.languages, c.availability, c.available_from,
    c.current_country, c.preferred_countries, c.work_authorization_countries, c.training, c.employment_history,
    c.preferred_industries, c.preferred_employment_types, c.updated_at,
    dc.direct_contact, dc.notice
  from public.saved_worker_cards s
  left join private.worker_cards c on c.card_id = s.card_id and c.listed
  left join lateral private.worker_card_contact(c.current_country, v_destination, v_licensed) dc on c.card_id is not null
  where s.organization_id = p_org and s.requirement_id is not distinct from p_requirement
  order by s.created_at desc, s.card_id
  limit 100;
end;
$$;

revoke all on function public.list_saved_worker_cards(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_saved_worker_cards(uuid, uuid) to authenticated;

-- Retention --------------------------------------------------------------------------------------------------------------------

-- private.apply_retention of 20270112100000 with one rule added after the partner search log: the Find Workers search
-- log, by creation time.
create or replace function private.apply_retention() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_removed bigint;
  v_file record;
  v_req_days integer;
  v_requirements uuid[] := '{}'::uuid[];
  v_more bigint;
begin
  select p.days into v_days from private.retention_policies p where p.entity = 'document_access_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.document_access_log where accessed_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform private.record_retention('document_access_log', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'notifications';
  if found then
    delete from pgmq.a_notifications where archived_at < now() - make_interval(days => v_days);
    delete from public.notifications where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('notifications', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'billing_provider_events';
  if found then
    delete from billing.provider_events where received_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('billing_provider_events', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'security_events';
  if found then
    delete from private.security_events where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('security_events', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'audit_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.log where created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform private.record_retention('audit_log', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'organization_invitations';
  if found then
    delete from public.organization_invitations i where coalesce(i.accepted_at, i.expires_at) < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('organization_invitations', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'deleted_worker_documents';
  if found then
    delete from public.worker_documents d
    where d.deleted_at < now() - make_interval(days => v_days)
      and not exists (select 1 from storage.objects o where o.bucket_id = d.bucket_id and o.name = d.storage_path);
    get diagnostics v_removed = row_count;
    perform private.record_retention('deleted_worker_documents', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'login_failures';
  if found then
    delete from private.login_failures f where f.window_started_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('login_failures', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'cron_job_run_details';
  if found then
    delete from cron.job_run_details r where r.end_time < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('cron_job_run_details', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'account_ops_archive';
  if found then
    delete from pgmq.a_account_ops a where a.archived_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('account_ops_archive', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'closed_reports';
  if found then
    delete from public.reports r where r.status in ('actioned', 'dismissed') and r.handled_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('closed_reports', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'partner_document_access_log';
  if found then
    perform set_config('chara.retention_run', 'on', true);
    delete from audit.partner_document_access_log where accessed_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform set_config('chara.retention_run', 'off', true);
    perform private.record_retention('partner_document_access_log', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'licence_evidence';
  if found then
    v_removed := 0;
    for v_file in
      delete from private.retired_licence_evidence r where r.retired_at < now() - make_interval(days => v_days)
      returning r.organization_id, r.storage_path
    loop
      perform private.queue_evidence_removal(v_file.organization_id, v_file.storage_path);
      v_removed := v_removed + 1;
    end loop;
    perform private.record_retention('licence_evidence', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'profile_view_events';
  if found then
    delete from private.profile_view_events e where e.viewed_on < (now() at time zone 'utc')::date - v_days;
    get diagnostics v_removed = row_count;
    perform private.record_retention('profile_view_events', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'org_analytics';
  if found then
    delete from private.org_analytics_daily d where d.day < (now() at time zone 'utc')::date - v_days;
    get diagnostics v_removed = row_count;
    perform private.record_retention('org_analytics', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'partner_searches';
  if found then
    delete from stats.partner_searches s where s.created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('partner_searches', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'worker_search_log';
  if found then
    delete from private.worker_search_log s where s.created_at < now() - make_interval(days => v_days);
    get diagnostics v_removed = row_count;
    perform private.record_retention('worker_search_log', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'closed_appeals';
  if found then
    -- The decision must also be older than the longest appeal window the settings editor allows (24 months), so that a
    -- shortened period never deletes an appeal whose decision could be appealed again once its row is gone.
    delete from public.appeals a
    where a.status <> 'open' and a.decided_at < now() - make_interval(days => v_days)
      and exists (select 1 from public.moderation_actions m
                  where m.id = a.moderation_action_id and m.created_at < now() - make_interval(months => 24));
    get diagnostics v_removed = row_count;
    perform private.record_retention('closed_appeals', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'data_exports';
  if found then
    v_removed := 0;
    for v_file in
      delete from public.data_export_requests r
      where (r.status = 'ready' and r.expires_at <= now())
         or (r.status = 'queued' and r.requested_at < now() - make_interval(days => v_days))
      returning r.user_id, r.storage_path
    loop
      if v_file.storage_path is not null then
        perform pgmq.send('account_ops', jsonb_build_object(
          'action', 'delete_object', 'user_id', v_file.user_id, 'bucket_id', 'dsar-exports', 'path', v_file.storage_path
        ));
      end if;
      v_removed := v_removed + 1;
    end loop;
    perform private.record_retention('data_exports', v_days, v_removed);
  end if;

  -- The job order network. The submissions and responses of an ended requirement go before it, so that a decision on one
  -- of them keeps its title (private.keep_moderated_item); an item under a report that is not closed waits for it.
  select p.days into v_req_days from private.retention_policies p where p.entity = 'closed_requirements';
  if v_req_days is not null then
    select coalesce(array_agg(r.id), '{}') into v_requirements
    from public.workforce_requirements r
    where r.status in ('closed', 'filled') and r.status_changed_at < now() - make_interval(days => v_req_days)
      and not exists (
        select 1 from public.reports x
        where x.status in ('new', 'in_review')
          and (x.requirement_id = r.id
            or x.partner_response_id in (select pr.id from public.partner_responses pr where pr.requirement_id = r.id)
            or x.candidate_submission_id in (select cs.id from public.candidate_submissions cs where cs.requirement_id = r.id))
      );
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'candidate_submissions';
  if found then
    delete from public.candidate_submissions s
    where (s.requirement_id = any (v_requirements)
        or (s.status = 'withdrawn' and s.withdrawn_at < now() - make_interval(days => v_days))
        or (s.status in ('declined_by_candidate', 'expired') and s.decided_at < now() - make_interval(days => v_days))
        or exists (select 1 from public.workforce_requirements r
                   where r.id = s.requirement_id and r.status in ('closed', 'filled')
                     and r.status_changed_at < now() - make_interval(days => v_days)))
      and not exists (select 1 from public.reports x
                      where x.candidate_submission_id = s.id and x.status in ('new', 'in_review'));
    get diagnostics v_removed = row_count;
    perform private.record_retention('candidate_submissions', v_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'partner_responses';
  if found then
    delete from public.partner_responses pr
    where (pr.requirement_id = any (v_requirements)
        or exists (select 1 from public.workforce_requirements r
                   where r.id = pr.requirement_id and r.status in ('closed', 'filled')
                     and r.status_changed_at < now() - make_interval(days => v_days)))
      and not exists (select 1 from public.reports x
                      where x.partner_response_id = pr.id and x.status in ('new', 'in_review'));
    get diagnostics v_removed = row_count;
    perform private.record_retention('partner_responses', v_days, v_removed);
  end if;

  if v_req_days is not null then
    delete from public.workforce_requirements r where r.id = any (v_requirements);
    get diagnostics v_removed = row_count;
    perform private.record_retention('closed_requirements', v_req_days, v_removed);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'job_order_metrics';
  if found then
    delete from stats.job_order_partner_weeks w where w.week_start < (now() at time zone 'utc')::date - v_days;
    get diagnostics v_removed = row_count;
    delete from stats.job_order_response_refusals f where f.last_seen_at < now() - make_interval(days => v_days);
    get diagnostics v_more = row_count;
    perform private.record_retention('job_order_metrics', v_days, v_removed + v_more);
  end if;

  select p.days into v_days from private.retention_policies p where p.entity = 'inactive_worker_data';
  if found then
    perform private.record_retention('inactive_worker_data', v_days, private.request_inactive_erasures(v_days));
  end if;
end;
$$;

revoke all on function private.apply_retention() from public, anon, authenticated, service_role;
