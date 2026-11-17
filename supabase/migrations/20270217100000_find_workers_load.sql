-- Find Workers at 100,000 visible profiles (NFR-P3, V80; docs/perf/release-2c.md). The load test of V80 found
-- search_workers of V69 (20270209100000_find_workers_search.sql) at 160 ms for a first page without a filter, about
-- 1.4 s for a keyword and 0.7 to 1.5 s for two skills: every listed card was read, scored and sorted, and the keyword's
-- skills and headline were matched card by card. Three indexes and a narrower first step bring every typical call under
-- 130 ms there; the result, the order, the cursor, the refusals and the search log are unchanged.

-- The cards in the order of a search without a keyword or skills (every card scores 0): the first page and the next
-- ones read the newest changed cards and stop.
create index worker_profiles_search_updated_idx on public.worker_profiles (updated_at desc, card_id) where searchable;

-- The keyword in a headline or a skill, any case and anywhere in the text (strpos of V69, as a like pattern).
create index worker_profiles_search_headline_trgm_idx on public.worker_profiles
  using gin (lower(headline) extensions.gin_trgm_ops) where searchable;
create index worker_skills_lower_skill_trgm_idx on public.worker_skills using gin (lower(skill) extensions.gin_trgm_ops);

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
-- V80: the cards the keyword can match (its occupations, the headlines and the skills that hold it) and the cards that
-- list a chosen skill, with how many, are read once through the indexes before the cards are read, so only those are
-- scored and sorted; every score term is a constant without its filter, so a search without a keyword or skills reads
-- the cards in the order of worker_profiles_search_updated_idx.
create or replace function public.search_workers(p_org uuid, p_filters jsonb default '{}', p_cursor text default null, p_limit integer default null)
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
  v_q_like text;
  v_q_headline uuid[];
  v_q_skill uuid[];
  v_skill_users uuid[];
  v_skill_hits jsonb;
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
    v_q_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_q_headline := array(
      select w.user_id from public.worker_profiles w where w.searchable and lower(w.headline) like v_q_like);
    v_q_skill := array(select distinct s.worker_user_id from public.worker_skills s where lower(s.skill) like v_q_like);
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
    select coalesce(array_agg(h.worker_user_id), '{}'), coalesce(jsonb_object_agg(h.worker_user_id, h.hits), '{}')
    into v_skill_users, v_skill_hits
    from (
      select s.worker_user_id, count(*)::integer as hits
      from public.worker_skills s
      where lower(s.skill) = any (v_skills)
      group by s.worker_user_id
    ) h;
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
      case when v_q is null then false else coalesce(c.occupation_id = any (v_q_occupations), false) end as q_occupation,
      case when v_q is null then false else c.user_id = any (v_q_headline) end as q_headline,
      case when v_q is null then false else c.user_id = any (v_q_skill) end as q_skills,
      case when v_skills is null then 0 else coalesce((v_skill_hits ->> c.user_id::text)::integer, 0) end as skill_hits
    from private.worker_cards c
    join public.worker_profiles w on w.user_id = c.user_id
    where c.listed
      and (v_q is null or c.occupation_id = any (v_q_occupations) or c.user_id = any (v_q_headline) or c.user_id = any (v_q_skill))
      and (v_skills is null or c.user_id = any (v_skill_users))
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
