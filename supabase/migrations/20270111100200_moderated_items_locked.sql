-- The job order network items under moderation, second part (FR-S1 AC12 and step Effect; V57). A hidden requirement or
-- response is out of its owner's hands until a decision restores it, as a moderated vacancy is out of the employer's
-- (CHARA_INVALID_STATE with the state, the code of moderate_job and of every decision on a hidden item): its employer
-- neither edits, publishes, pauses, closes, fills, extends nor copies a hidden requirement nor sets its capacity
-- tolerance, and its partner neither changes nor withdraws a hidden response nor adds or removes its documents. The
-- page shows the statement of reasons and the appeal (item_moderation, list_my_appeals). The system's own moves (expiry
-- at the closing date, the pause on a lapsed plan) still run. An item of a suspended organisation needs no check: its
-- members are refused with organization_suspended already.
-- The partner dashboard (V55) and the employer dashboard (V56) count only visible items: a hidden or suspended
-- requirement, response or submission is left out of every figure, as it is left out of the lists those figures lead to.
-- The partner's list of submissions (list_partner_submissions, drop and recreate) adds the moderation state and, while a
-- submission is hidden, the decision an appeal names, for the badge.

-- Requirements --------------------------------------------------------------------------------------------------------------

-- private.lock_requirement of 20261216100000, used by publish_requirement, set_requirement_status, extend_requirement and
-- create_vacancies_from_requirement: a hidden requirement is refused before the stale check.
create or replace function private.lock_requirement(p_org uuid, p_requirement uuid, p_expected_updated_at timestamptz) returns public.workforce_requirements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
begin
  perform private.assert_requirement_manager(p_org);
  select * into v_row from public.workforce_requirements r
  where r.id = p_requirement and r.organization_id = p_org
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.moderation_state = 'hidden' then
    raise exception 'CHARA_INVALID_STATE' using detail = 'hidden';
  end if;
  if p_expected_updated_at is distinct from v_row.updated_at then
    raise exception 'CHARA_CONFLICT' using detail = 'stale';
  end if;
  return v_row;
end;
$$;

-- save_requirement of its latest version: a hidden requirement is not edited.
create or replace function public.save_requirement(p_org uuid, p_workers_needed integer, p_country_code text, p_city_region text, p_industry_code text, p_occupations jsonb, p_start_date date, p_employment_type public.employment_type, p_recruitment_preference public.recruitment_preference, p_partner_need public.partner_need, p_accommodation boolean, p_work_permit_support boolean, p_visa_support boolean, p_requirement uuid default null::uuid, p_title text default null::text, p_skills text default null::text, p_experience_years smallint default null::smallint, p_duration_months smallint default null::smallint, p_salary_min numeric default null::numeric, p_salary_max numeric default null::numeric, p_salary_currency text default null::text, p_salary_period public.salary_period default null::public.salary_period, p_expected_updated_at timestamptz default null::timestamp with time zone, p_additional_countries text[] default null::text[]) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_skills text := nullif(btrim(coalesce(p_skills, '')), '');
  v_city text := btrim(p_city_region);
  v_country text := upper(btrim(p_country_code));
  v_industry text := upper(btrim(p_industry_code));
  v_currency text := upper(nullif(btrim(coalesce(p_salary_currency, '')), ''));
  v_old public.workforce_requirements;
  v_new public.workforce_requirements;
  v_old_occupations jsonb := '[]'::jsonb;
  v_new_occupations jsonb;
  v_old_countries text[] := '{}'::text[];
  v_new_countries text[];
  v_additional text[];
  v_changed jsonb;
  v_criterion text;
  v_field text;
begin
  perform private.assert_requirement_manager(p_org);

  if p_requirement is not null then
    select * into v_old from public.workforce_requirements r
    where r.id = p_requirement and r.organization_id = p_org
    for update;
    if not found then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_old.moderation_state = 'hidden' then
      raise exception 'CHARA_INVALID_STATE' using detail = 'hidden';
    end if;
    if v_old.status in ('closed', 'filled') then
      raise exception 'CHARA_INVALID_STATE' using detail = v_old.status::text;
    end if;
    if p_expected_updated_at is distinct from v_old.updated_at then
      raise exception 'CHARA_CONFLICT' using detail = 'stale';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('occupation_id', o.occupation_id, 'quantity', o.quantity)
             order by o.occupation_id), '[]')
    into v_old_occupations
    from public.requirement_occupations o where o.requirement_id = p_requirement;
    select coalesce(array_agg(c.country_code order by c.country_code), '{}') into v_old_countries
    from public.requirement_countries c where c.requirement_id = p_requirement;
  end if;

  if p_start_date is null
     or (p_start_date is distinct from v_old.start_date
         and (p_start_date < v_today or p_start_date > (v_today + interval '3 years')::date)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'start_date';
  end if;

  if p_occupations is null or jsonb_typeof(p_occupations) <> 'array'
     or jsonb_array_length(p_occupations) not between 1 and 10
     or exists (
       select 1 from jsonb_array_elements(p_occupations) e
       where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'occupation_id') <> 'string'
          or jsonb_typeof(e -> 'quantity') <> 'number' or (e ->> 'quantity') !~ '^\d{1,6}$'
     )
     or (select count(distinct btrim(e ->> 'occupation_id')) from jsonb_array_elements(p_occupations) e)
        <> jsonb_array_length(p_occupations) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupations';
  end if;
  select jsonb_agg(jsonb_build_object('occupation_id', btrim(e ->> 'occupation_id'), 'quantity', (e ->> 'quantity')::integer)
           order by btrim(e ->> 'occupation_id'))
  into v_new_occupations
  from jsonb_array_elements(p_occupations) e;

  if p_additional_countries is not null then
    if cardinality(p_additional_countries) > 9
       or exists (select 1 from unnest(p_additional_countries) c where c is null or btrim(c) !~ '^[A-Za-z]{2}$') then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'countries';
    end if;
    select coalesce(array_agg(distinct upper(btrim(c))), '{}') into v_additional
    from unnest(p_additional_countries) c
    where upper(btrim(c)) is distinct from v_country;
  end if;

  foreach v_field in array array['title', 'skills', 'city_region'] loop
    v_criterion := private.prohibited_criterion(case v_field
      when 'title' then case when v_title is distinct from v_old.title then v_title end
      when 'skills' then v_skills
      else v_city end);
    if v_criterion is not null then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'prohibited_criterion:' || v_field;
    end if;
  end loop;

  perform private.count_audited_write(p_org);

  if p_requirement is null then
    insert into public.workforce_requirements (
      organization_id, title, workers_needed, country_code, city_region, industry_code, skills, experience_years,
      start_date, duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, accommodation,
      work_permit_support, visa_support, recruitment_preference, partner_need
    ) values (
      p_org, coalesce(v_title, '-'), p_workers_needed, v_country, v_city, v_industry, v_skills, p_experience_years,
      p_start_date, p_duration_months, p_employment_type, p_salary_min, p_salary_max, v_currency, p_salary_period,
      coalesce(p_accommodation, false), coalesce(p_work_permit_support, false), coalesce(p_visa_support, false),
      p_recruitment_preference, p_partner_need
    )
    returning * into v_new;
  else
    update public.workforce_requirements r
    set title = coalesce(v_title, '-'), workers_needed = p_workers_needed, country_code = v_country,
        city_region = v_city, industry_code = v_industry, skills = v_skills, experience_years = p_experience_years,
        start_date = p_start_date, duration_months = p_duration_months, employment_type = p_employment_type,
        salary_min = p_salary_min, salary_max = p_salary_max, salary_currency = v_currency,
        salary_period = p_salary_period, accommodation = coalesce(p_accommodation, false),
        work_permit_support = coalesce(p_work_permit_support, false), visa_support = coalesce(p_visa_support, false),
        recruitment_preference = p_recruitment_preference, partner_need = p_partner_need,
        closes_on = case when r.closes_on is not null then greatest(r.closes_on, p_start_date) end
    where r.id = p_requirement
    returning * into v_new;
    delete from public.requirement_occupations o where o.requirement_id = p_requirement;
    if v_additional is not null then
      delete from public.requirement_countries c
      where c.requirement_id = p_requirement and c.country_code <> all (v_additional || v_new.country_code);
    elsif v_old.country_code <> v_new.country_code then
      delete from public.requirement_countries c
      where c.requirement_id = p_requirement and c.country_code = v_old.country_code;
    end if;
  end if;

  insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
  select v_new.id, e ->> 'occupation_id', (e ->> 'quantity')::integer
  from jsonb_array_elements(v_new_occupations) e;
  insert into public.requirement_countries (requirement_id, country_code) values (v_new.id, v_new.country_code)
  on conflict do nothing;
  if v_additional is not null then
    insert into public.requirement_countries (requirement_id, country_code)
    select v_new.id, c from unnest(v_additional) c order by c
    on conflict do nothing;
  end if;

  if (select sum((e ->> 'quantity')::integer) from jsonb_array_elements(v_new_occupations) e) <> v_new.workers_needed then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'occupation_quantities';
  end if;

  -- The title an employer left empty: the number of workers, the occupations by quantity and the place, cut to 120.
  if v_title is null then
    update public.workforce_requirements r
    set title = left(format('%s workers: %s, %s', v_new.workers_needed,
          (select string_agg(oc.label, ', ' order by o.quantity desc, oc.label)
           from public.requirement_occupations o join public.occupations oc on oc.code = o.occupation_id
           where o.requirement_id = v_new.id),
          v_new.city_region), 120)
    where r.id = v_new.id
    returning * into v_new;
  end if;

  if p_requirement is null then
    perform audit.record('requirement.created', 'requirement', v_new.id::text,
      jsonb_build_object('organization_id', p_org, 'partner_need', v_new.partner_need));
    return v_new.id;
  end if;

  select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
  from jsonb_each(to_jsonb(v_new) - 'updated_at') n
  where n.value is distinct from (to_jsonb(v_old) -> n.key);
  if v_new_occupations is distinct from v_old_occupations then
    v_changed := v_changed || '["occupations"]'::jsonb;
  end if;
  select coalesce(array_agg(c.country_code order by c.country_code), '{}') into v_new_countries
  from public.requirement_countries c where c.requirement_id = v_new.id;
  if v_new_countries is distinct from v_old_countries then
    v_changed := v_changed || '["countries"]'::jsonb;
  end if;
  if jsonb_array_length(v_changed) > 0 then
    update public.workforce_requirements r set updated_at = now() where r.id = v_new.id;
    perform audit.record('requirement.updated', 'requirement', v_new.id::text,
      jsonb_build_object('organization_id', p_org, 'changed_fields', v_changed, 'status', v_new.status));
    perform private.record_requirement_version(v_old, v_new, v_changed, v_old_occupations, v_new_occupations,
      v_old_countries, v_new_countries);
  end if;
  return v_new.id;
end;
$$;

-- set_requirement_capacity_tolerance of 20261230100000: nor its tolerance set.
create or replace function public.set_requirement_capacity_tolerance(p_org uuid, p_requirement uuid, p_percent integer) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
begin
  perform private.assert_requirement_manager(p_org);
  if p_percent is null or p_percent not between 0 and 100 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_percent';
  end if;
  select * into v_row from public.workforce_requirements r
  where r.id = p_requirement and r.organization_id = p_org
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.moderation_state = 'hidden' then
    raise exception 'CHARA_INVALID_STATE' using detail = 'hidden';
  end if;
  if v_row.status in ('closed', 'filled') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_row.status::text;
  end if;
  if v_row.max_capacity_over_percent = p_percent then
    return false;
  end if;
  perform private.count_audited_write(p_org);
  update public.workforce_requirements r set max_capacity_over_percent = p_percent where r.id = v_row.id;
  perform audit.record('requirement.capacity_tolerance_set', 'requirement', v_row.id::text,
    jsonb_build_object('organization_id', p_org, 'from', v_row.max_capacity_over_percent, 'to', p_percent));
  return true;
end;
$$;

-- Responses ------------------------------------------------------------------------------------------------------------------

-- update_response and withdraw_response of 20261230100000: a hidden response is neither changed nor withdrawn.
create or replace function public.update_response(p_org uuid, p_response uuid, p_capacity integer, p_available_from date, p_experience_note text, p_fee_model public.fee_model, p_fee_amount numeric default null::numeric, p_fee_currency text default null::text, p_timeline_note text default null::text, p_notes text default null::text, p_expected_version integer default null::integer) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.partner_responses;
  v_row public.workforce_requirements;
  v_proposal jsonb;
  v_before jsonb;
  v_changed text[];
  v_version integer;
begin
  perform private.assert_responding_partner(p_org);
  select * into v_old from public.partner_responses p where p.id = p_response and p.organization_id = p_org for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.moderation_state = 'hidden' then
    raise exception 'CHARA_INVALID_STATE' using detail = 'hidden';
  end if;
  if v_old.status not in ('submitted', 'updated') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_old.status::text;
  end if;
  select * into v_row from public.workforce_requirements r where r.id = v_old.requirement_id for share;
  if v_row.status in ('closed', 'filled') then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_closed';
  end if;
  if not private.partner_commitment_current(p_org) then
    raise exception 'CHARA_CONSENT_REQUIRED' using detail = 'employer-pays-commitment';
  end if;
  if p_expected_version is not null and p_expected_version <> v_old.version then
    raise exception 'CHARA_CONFLICT' using detail = 'stale';
  end if;

  v_proposal := private.response_proposal(v_row, p_capacity, p_available_from, p_experience_note, p_fee_model, p_fee_amount,
    p_fee_currency, p_timeline_note, p_notes, v_old.available_from, v_old.capacity);
  v_before := private.response_payload(v_old);
  select coalesce(array_agg(f.name order by f.position), '{}') into v_changed
  from unnest(private.partner_response_fields()) with ordinality f(name, position)
  where (v_proposal -> f.name) is distinct from (v_before -> f.name);
  if cardinality(v_changed) = 0 then
    return v_old.version;
  end if;

  perform private.count_audited_write(p_org);
  v_version := v_old.version + 1;
  update public.partner_responses p
  set capacity = (v_proposal ->> 'capacity')::integer, available_from = (v_proposal ->> 'available_from')::date,
      timeline_note = v_proposal ->> 'timeline_note', experience_note = v_proposal ->> 'experience_note',
      fee_model = (v_proposal ->> 'fee_model')::public.fee_model, fee_amount = (v_proposal ->> 'fee_amount')::numeric,
      fee_currency = v_proposal ->> 'fee_currency', notes = v_proposal ->> 'notes',
      version = v_version, status = 'updated', updated_at = now()
  where p.id = v_old.id;
  insert into public.partner_response_versions (
    response_id, version, organization_id, employer_organization_id, payload, changed_fields, created_by
  )
  select p.id, v_version, p.organization_id, p.employer_organization_id, private.response_payload(p), v_changed,
    (select auth.uid())
  from public.partner_responses p where p.id = v_old.id;
  perform audit.record('response.updated', 'partner_response', v_old.id::text,
    jsonb_build_object('requirement_id', v_old.requirement_id, 'organization_id', p_org,
      'employer_organization_id', v_old.employer_organization_id, 'version', v_version, 'changed_fields', to_jsonb(v_changed)));
  return v_version;
end;
$$;

create or replace function public.withdraw_response(p_org uuid, p_response uuid, p_reason text default null::text) returns public.response_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.partner_responses;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.assert_invitation_partner(p_org);
  if char_length(v_reason) > 500 or v_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_reason';
  end if;
  select * into v_old from public.partner_responses p where p.id = p_response and p.organization_id = p_org for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.moderation_state = 'hidden' then
    raise exception 'CHARA_INVALID_STATE' using detail = 'hidden';
  end if;
  if v_old.status not in ('submitted', 'updated') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_old.status::text;
  end if;
  perform private.count_audited_write(p_org);
  update public.partner_responses p
  set status = 'withdrawn', withdrawn_at = now(), withdrawal_reason = v_reason, updated_at = now()
  where p.id = v_old.id;
  perform audit.record('response.withdrawn', 'partner_response', v_old.id::text,
    jsonb_strip_nulls(jsonb_build_object('requirement_id', v_old.requirement_id, 'organization_id', p_org,
      'employer_organization_id', v_old.employer_organization_id, 'from', v_old.status,
      'with_reason', case when v_reason is not null then true end)));
  perform private.queue_response_employer_event(v_old.id, 'response_withdrawn');
  return 'withdrawn'::public.response_status;
end;
$$;

-- register_response_document and remove_response_document of 20261231100000: nor are its documents.
create or replace function public.register_response_document(p_org uuid, p_requirement uuid, p_file_name text, p_mime text, p_size bigint) returns table (bucket_id text, object_path text, file_name text, document_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_requirements;
  v_response public.partner_responses;
  v_check record;
  v_name text := btrim(coalesce(p_file_name, ''));
  v_max integer := coalesce(
    (select case when s.value #>> '{}' ~ '^[0-9]{1,6}$' then (s.value #>> '{}')::integer end
     from private.settings s where s.key = 'response_documents_max'), 5);
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  perform private.assert_responding_partner(p_org);
  perform private.check_rate_limit('document_access', (select auth.uid()));
  if p_mime is distinct from 'application/pdf' or p_size is null or p_size not between 1 and 15728640
     or char_length(v_name) not between 5 and 120 or v_name !~* '\.pdf$' or v_name ~ '[\x01-\x1f\x7f/\\]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'file';
  end if;

  select * into v_row from public.workforce_requirements r where r.id = p_requirement for share;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('partner_responses:' || p_org::text, 0));

  select * into v_response from public.partner_responses p
  where p.requirement_id = v_row.id and p.organization_id = p_org
  for share;
  if v_response.id is null then
    select * into v_check from private.response_refusal(p_org, v_row);
    if v_check.message is not null then
      perform private.raise_response_refusal(v_check.message, v_check.detail);
    end if;
  else
    if v_response.moderation_state = 'hidden' then
      raise exception 'CHARA_INVALID_STATE' using detail = 'hidden';
    end if;
    if v_response.status not in ('submitted', 'updated') then
      raise exception 'CHARA_INVALID_STATE' using detail = v_response.status::text;
    end if;
    if v_row.status in ('closed', 'filled') then
      raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_closed';
    end if;
  end if;

  if (select count(*) from public.partner_response_documents d
      where d.organization_id = p_org and d.requirement_id = v_row.id and d.scan_status <> 'rejected'
        and not private.response_document_stranded(d)) >= v_max then
    raise exception 'CHARA_LIMIT_REACHED' using detail = 'response_documents_max';
  end if;
  perform private.count_audited_write(p_org);

  v_path := p_org::text || '/' || v_id::text || '/' || gen_random_uuid()::text;
  insert into public.partner_response_documents (
    id, organization_id, requirement_id, employer_organization_id, response_id, storage_path, file_name, size_bytes,
    uploaded_by
  ) values (
    v_id, p_org, v_row.id, v_row.organization_id, v_response.id, v_path, v_name, p_size, (select auth.uid())
  );
  perform audit.record('response_document.added', 'partner_response_document', v_id::text,
    jsonb_strip_nulls(jsonb_build_object('organization_id', p_org, 'requirement_id', v_row.id,
      'response_id', v_response.id, 'size_bytes', p_size)));
  return query select 'partner-response-documents'::text, v_path, v_name, v_id;
end;
$$;

create or replace function public.remove_response_document(p_org uuid, p_document uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.partner_response_documents;
  v_response public.partner_responses;
begin
  perform private.assert_responding_partner(p_org);
  perform pg_advisory_xact_lock(hashtextextended('partner_responses:' || p_org::text, 0));
  select * into v_doc from public.partner_response_documents d
  where d.id = p_document and d.organization_id = p_org
  for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_doc.response_id is not null then
    select * into v_response from public.partner_responses p where p.id = v_doc.response_id for share;
    if v_response.moderation_state = 'hidden' then
      raise exception 'CHARA_INVALID_STATE' using detail = 'hidden';
    end if;
    if v_response.status not in ('submitted', 'updated') then
      raise exception 'CHARA_INVALID_STATE' using detail = v_response.status::text;
    end if;
    if exists (select 1 from public.workforce_requirements r where r.id = v_doc.requirement_id and r.status in ('closed', 'filled')) then
      raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_closed';
    end if;
  end if;
  perform private.count_audited_write(p_org);
  delete from public.partner_response_documents d where d.id = v_doc.id;
  perform audit.record('response_document.removed', 'partner_response_document', v_doc.id::text,
    jsonb_strip_nulls(jsonb_build_object('organization_id', p_org, 'requirement_id', v_doc.requirement_id,
      'response_id', v_doc.response_id)));
end;
$$;

-- Dashboards -----------------------------------------------------------------------------------------------------------------

-- get_partner_dashboard and list_partner_submission_outcomes of 20270109100000: fitting job orders, invitations awaiting
-- an answer, responses and submission stages count visible items only.
create or replace function public.get_partner_dashboard(p_org uuid) returns table (organization_type public.organization_type, review_status partner_review_status, listed boolean, profile_hidden boolean, profile_missing text, profile_updated_at timestamptz, listings_total integer, listings_due integer, listings_stale integer, oldest_listing_confirmed_at timestamptz, licences_current integer, licences_expiring integer, licences_expired integer, next_licence_expiry date, profile_views_30d integer, profile_views_suppressed boolean, profile_views_fewer_than integer, profile_views_in_plan boolean, fitting_job_orders integer, matching_employers integer, invitations_awaiting integer, responses_open integer, responses_shortlisted integer, responses_selected integer, responses_declined integer, submission_stages jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type public.organization_type;
  v_today date := (now() at time zone 'utc')::date;
  v_fresh_since timestamptz := private.workforce_fresh_since();
  v_due_since timestamptz := now() - make_interval(days => coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'workforce_confirm_reminder_days'), 30));
  v_licence_days integer := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'licence_expiry_reminder_days'), 30);
  v_in_plan boolean;
  v_views integer;
  v_suppressed boolean;
  v_job_orders boolean;
  v_submissions boolean;
  v_fitting integer;
  v_employers integer;
  v_awaiting integer;
  v_open integer;
  v_shortlisted integer;
  v_selected integer;
  v_declined integer;
  v_stages jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required', errcode = '42501';
  end if;
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  v_type := private.org_type(p_org);
  if v_type not in ('recruitment_company', 'staffing_company') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'wrong_org_type', errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  v_job_orders := private.release_on('release_job_orders');
  v_submissions := v_job_orders and private.release_on('release_candidate_submissions');

  v_in_plan := private.analytics_level(p_org) >= 1;
  if v_in_plan then
    select f.value, f.suppressed into v_views, v_suppressed
    from private.org_analytics_figures(p_org, '30d', 'total') f
    where f.metric = 'profile_views';
    -- No view at all is 0, so the page can say what brings views (FR-R3 AC7); only 1 to stats_min_count - 1 is hidden.
    if v_suppressed and not exists (
      select 1 from private.org_analytics_daily d
      where d.organization_id = p_org and d.metric = 'profile_views' and d.day between v_today - 30 and v_today - 1
    ) then
      v_views := 0;
      v_suppressed := false;
    end if;
  end if;

  if v_job_orders then
    with profile as (
      select
        array(select g.country_code from public.organization_geographies g
              where g.organization_id = p_org and g.scope = 'serves_market') as served,
        array(select oo.occupation_id from public.organization_occupations oo where oo.organization_id = p_org) as occupations
    ),
    candidates as (
      select r.id, r.organization_id,
        r.visibility = 'job_order_marketplace'
          and exists (
            select 1 from public.requirement_countries rc where rc.requirement_id = r.id and rc.country_code = any (p.served))
          and exists (
            select 1 from public.requirement_occupations ro where ro.requirement_id = r.id and ro.occupation_id = any (p.occupations))
          as on_marketplace,
        exists (
          select 1 from public.requirement_invitations i
          where i.requirement_id = r.id and i.organization_id = p_org and i.status in ('invited', 'viewed', 'accepted')
        ) as invited
      from public.workforce_requirements r
      join public.organizations e on e.id = r.organization_id
      cross join profile p
      where r.status = 'open' and e.status = 'active' and r.moderation_state = 'visible'
        and (r.visibility = 'job_order_marketplace' or exists (
          select 1 from public.requirement_invitations i where i.requirement_id = r.id and i.organization_id = p_org))
    )
    select
      (count(*) filter (where c.on_marketplace or c.invited))::integer,
      (count(distinct c.organization_id) filter (where c.on_marketplace))::integer
    into v_fitting, v_employers
    from candidates c;

    select count(*)::integer into v_awaiting
    from public.requirement_invitations i
    join public.workforce_requirements r on r.id = i.requirement_id
    where i.organization_id = p_org and i.status in ('invited', 'viewed') and r.status = 'open' and r.moderation_state = 'visible';

    select
      (count(*) filter (where pr.status in ('submitted', 'updated')))::integer,
      (count(*) filter (where pr.status = 'shortlisted'))::integer,
      (count(*) filter (where pr.status = 'selected'))::integer,
      (count(*) filter (where pr.status = 'declined'))::integer
    into v_open, v_shortlisted, v_selected, v_declined
    from public.partner_responses pr
    where pr.organization_id = p_org and pr.moderation_state = 'visible';
  end if;

  if v_submissions then
    select jsonb_object_agg(st.status, coalesce(n.total, 0) order by st.ord) into v_stages
    from unnest(enum_range(null::public.submission_status)) with ordinality as st (status, ord)
    left join (
      select s.status, count(*)::integer as total
      from public.candidate_submissions s
      where s.organization_id = p_org and s.moderation_state = 'visible'
      group by s.status
    ) n on n.status = st.status;
  end if;

  return query
  select
    o.type,
    o.review_status,
    private.is_listed_partner(o.id),
    o.moderation_state = 'hidden',
    private.partner_profile_missing(o.id),
    o.workforce_profile_updated_at,
    w.total,
    w.due,
    w.stale,
    w.oldest,
    l.current_count,
    l.expiring,
    l.expired,
    l.next_expiry,
    case when v_in_plan then v_views end,
    coalesce(v_in_plan and v_suppressed, false),
    case when v_in_plan and v_suppressed then private.stats_min_count() end,
    v_in_plan,
    v_fitting,
    v_employers,
    v_awaiting,
    v_open,
    v_shortlisted,
    v_selected,
    v_declined,
    v_stages
  from public.organizations o
  cross join lateral (
    select
      count(*)::integer as total,
      (count(*) filter (where a.confirmed_at <= v_due_since and a.confirmed_at > v_fresh_since))::integer as due,
      (count(*) filter (where a.confirmed_at <= v_fresh_since))::integer as stale,
      min(a.confirmed_at) as oldest
    from public.workforce_availability a
    where a.organization_id = o.id
  ) w
  cross join lateral (
    select
      (count(*) filter (where x.status = 'current'))::integer as current_count,
      (count(*) filter (where x.status = 'current' and x.valid_until <= v_today + v_licence_days))::integer as expiring,
      (count(*) filter (where x.status = 'expired'))::integer as expired,
      min(x.valid_until) filter (where x.status = 'current') as next_expiry
    from public.partner_licences x
    where x.organization_id = o.id
  ) l
  where o.id = p_org;
end;
$$;

create or replace function public.list_partner_submission_outcomes(p_org uuid) returns table (requirement_id uuid, title text, requirement_status public.requirement_status, submitted integer, in_progress integer, hired integer, not_selected integer, withdrawn integer, last_change_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_invitation_partner(p_org);
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  return query
  with approved as (
    select s.requirement_id, s.status,
      coalesce((select max(e.created_at) from public.submission_events e where e.submission_id = s.id), s.worker_approved_at)
        as changed_at
    from public.candidate_submissions s
    where s.organization_id = p_org and s.worker_approved_at is not null and s.moderation_state = 'visible'
  ),
  per_requirement as (
    select a.requirement_id,
      count(*)::integer as submitted,
      (count(*) filter (where a.status in ('submitted', 'viewed', 'shortlisted', 'interview', 'offer')))::integer as in_progress,
      (count(*) filter (where a.status = 'hired'))::integer as hired,
      (count(*) filter (where a.status = 'rejected'))::integer as not_selected,
      (count(*) filter (where a.status = 'withdrawn'))::integer as withdrawn,
      max(a.changed_at) as last_change_at
    from approved a
    group by a.requirement_id
    order by max(a.changed_at) desc, a.requirement_id
    limit 10
  )
  select p.requirement_id,
    case when private.requirement_named_to(r.id, p_org) then r.title else private.job_order_neutral_title(r.id) end,
    r.status, p.submitted, p.in_progress, p.hired, p.not_selected, p.withdrawn, p.last_change_at
  from per_requirement p
  join public.workforce_requirements r on r.id = p.requirement_id
  order by p.last_change_at desc, p.requirement_id;
end;
$$;

-- get_employer_network_dashboard of 20270110100000: the requirements, their responses, the invitations, the partners and
-- the submission stages count visible items only.
create or replace function public.get_employer_network_dashboard(p_org uuid)
returns table (
  saved_partners integer,
  followed_companies integer,
  open_requirements integer,
  paused_requirements integer,
  draft_requirements integer,
  requirements jsonb,
  invited_partners integer,
  invited_recruitment integer,
  invited_staffing integer,
  invitations_waiting integer,
  invitations_accepted integer,
  invitations_responded integer,
  invitations_declined integer,
  responses_waiting integer,
  responses_updated integer,
  responses_shortlisted integer,
  selected_partners integer,
  submission_stages jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_job_orders boolean;
  v_submissions boolean;
  v_saved integer;
  v_followed integer;
  v_open integer;
  v_paused integer;
  v_draft integer;
  v_requirements jsonb;
  v_invited integer;
  v_invited_recruitment integer;
  v_invited_staffing integer;
  v_waiting integer;
  v_accepted integer;
  v_responded integer;
  v_declined integer;
  v_responses_waiting integer;
  v_responses_updated integer;
  v_shortlisted integer;
  v_selected integer;
  v_stages jsonb;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required', errcode = '42501';
  end if;
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if private.org_type(p_org) <> 'employer' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'employer_only', errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.assert_member_aal2(p_org);
  v_job_orders := private.release_on('release_job_orders');
  v_submissions := v_job_orders and private.release_on('release_candidate_submissions');

  select count(*)::integer into v_saved
  from public.saved_items s
  where s.organization_id = p_org and private.is_public_partner(s.target_organization_id);

  select count(*)::integer into v_followed
  from public.follows f
  where f.user_id = v_uid and private.is_followable(f.organization_id);

  if v_job_orders then
    select
      (count(*) filter (where r.status = 'open'))::integer,
      (count(*) filter (where r.status = 'paused'))::integer,
      (count(*) filter (where r.status = 'draft'))::integer
    into v_open, v_paused, v_draft
    from public.workforce_requirements r
    where r.organization_id = p_org and r.moderation_state = 'visible';

    select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb) into v_requirements
    from (
      select
        row_number() over (order by r.published_at desc nulls last, r.id) as ord,
        r.id, r.title, r.status, r.closes_on,
        (select count(*) from public.partner_responses p
         where p.requirement_id = r.id and p.status <> 'withdrawn' and p.moderation_state = 'visible')::integer
          as responses,
        (select count(*) from public.partner_responses p
         where p.requirement_id = r.id and p.status = 'selected' and p.moderation_state = 'visible')::integer
          as selected,
        (select count(*) from public.partner_responses p
         where p.requirement_id = r.id and p.status in ('submitted', 'updated') and p.moderation_state = 'visible')::integer
          as awaiting_decision,
        (select count(*) from public.partner_responses p
         where p.requirement_id = r.id and p.status = 'updated' and p.employer_seen_version < p.version
           and p.moderation_state = 'visible')::integer
          as updated_unseen,
        (select count(*) from public.requirement_invitations i
         where i.requirement_id = r.id and i.status in ('invited', 'viewed'))::integer as invitations_waiting
      from public.workforce_requirements r
      where r.organization_id = p_org and r.status in ('open', 'paused') and r.moderation_state = 'visible'
      order by r.published_at desc nulls last, r.id
      limit 10
    ) x;

    select
      (count(distinct i.organization_id))::integer,
      (count(distinct i.organization_id) filter (where o.type = 'recruitment_company'))::integer,
      (count(distinct i.organization_id) filter (where o.type = 'staffing_company'))::integer,
      (count(*) filter (where i.status in ('invited', 'viewed')))::integer,
      (count(*) filter (where i.status = 'accepted'))::integer,
      (count(*) filter (where i.status = 'responded'))::integer,
      (count(*) filter (where i.status = 'declined'))::integer
    into v_invited, v_invited_recruitment, v_invited_staffing, v_waiting, v_accepted, v_responded, v_declined
    from public.requirement_invitations i
    join public.workforce_requirements r on r.id = i.requirement_id
    join public.organizations o on o.id = i.organization_id
    where r.organization_id = p_org and r.status in ('open', 'paused') and r.moderation_state = 'visible'
      and i.status not in ('withdrawn', 'expired');

    select
      (count(*) filter (where p.status in ('submitted', 'updated') and r.status in ('open', 'paused')))::integer,
      (count(*) filter (where p.status = 'updated' and p.employer_seen_version < p.version and r.status in ('open', 'paused')))::integer,
      (count(*) filter (where p.status = 'shortlisted' and r.status in ('open', 'paused')))::integer,
      (count(distinct p.organization_id) filter (where p.status = 'selected'))::integer
    into v_responses_waiting, v_responses_updated, v_shortlisted, v_selected
    from public.partner_responses p
    join public.workforce_requirements r on r.id = p.requirement_id
    where r.organization_id = p_org and r.status in ('open', 'paused', 'filled') and r.moderation_state = 'visible'
      and p.moderation_state = 'visible';
  end if;

  if v_submissions then
    select jsonb_object_agg(st.status, coalesce(n.total, 0) order by st.ord) into v_stages
    from unnest(array['submitted', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']::public.submission_status[])
      with ordinality as st (status, ord)
    left join (
      select s.status, count(*)::integer as total
      from public.candidate_submissions s
      where s.employer_organization_id = p_org and s.worker_approved_at is not null and s.moderation_state = 'visible'
      group by s.status
    ) n on n.status = st.status;
  end if;

  return query
  select v_saved, v_followed, v_open, v_paused, v_draft, v_requirements, v_invited, v_invited_recruitment, v_invited_staffing,
    v_waiting, v_accepted, v_responded, v_declined, v_responses_waiting, v_responses_updated, v_shortlisted, v_selected,
    v_stages;
end;
$$;

-- The partner's submissions ----------------------------------------------------------------------------------------------------

-- list_partner_submissions of 20270104100000 with moderation_state and, while hidden, the decision id. Everything else is
-- unchanged.
drop function public.list_partner_submissions(uuid, uuid, uuid, integer);

create function public.list_partner_submissions(p_org uuid, p_requirement uuid default null::uuid, p_cursor uuid default null::uuid, p_limit integer default null::integer) returns table (id uuid, requirement_id uuid, title text, status public.submission_status, invited_email text, candidate_name text, note text, created_at timestamptz, decided_at timestamptz, worker_approved_at timestamptz, withdrawn_at timestamptz, stage_changed_at timestamptz, stages jsonb, next_cursor uuid, moderation_state public.job_moderation_state, moderation_action_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_cursor public.candidate_submissions;
begin
  perform private.assert_invitation_partner(p_org);
  if not private.release_on('release_candidate_submissions') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  perform private.check_rate_limit('job_orders', (select auth.uid()));
  if p_cursor is not null then
    select * into v_cursor from public.candidate_submissions s where s.id = p_cursor and s.organization_id = p_org;
    if not found then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end if;
  end if;
  return query
  with page as (
    select s.*, row_number() over (order by s.created_at desc, s.id) as n
    from public.candidate_submissions s
    where s.organization_id = p_org and (p_requirement is null or s.requirement_id = p_requirement)
      and (p_cursor is null or s.created_at < v_cursor.created_at or (s.created_at = v_cursor.created_at and s.id > p_cursor))
    order by s.created_at desc, s.id
    limit v_limit + 1
  )
  select s.id, s.requirement_id,
    case when private.requirement_named_to(r.id, p_org) then r.title else private.job_order_neutral_title(r.id) end,
    s.status,
    case when s.worker_approved_at is null then s.invited_email end,
    case when s.worker_approved_at is not null
      then nullif(concat_ws(' ', s.profile_snapshot ->> 'first_name', s.profile_snapshot ->> 'last_name'), '') end,
    s.note, s.created_at, s.decided_at, s.worker_approved_at, s.withdrawn_at,
    (select max(e.created_at) from public.submission_events e where e.submission_id = s.id),
    coalesce((
      select jsonb_agg(jsonb_build_object('status', e.to_status, 'at', e.created_at) order by e.created_at, e.id)
      from public.submission_events e
      where e.submission_id = s.id and e.to_status not in ('awaiting_candidate', 'declined_by_candidate', 'expired')
    ), '[]'::jsonb),
    case when s.n = v_limit and exists (select 1 from page x where x.n = v_limit + 1) then s.id end,
    s.moderation_state,
    case when s.moderation_state = 'hidden' then (
      select a.id from public.moderation_actions a
      where a.target_type = 'candidate_submission' and a.target_id = s.id and a.action = 'content_hidden'
      order by a.id desc limit 1) end
  from page s
  join public.workforce_requirements r on r.id = s.requirement_id
  where s.n <= v_limit
  order by s.n;
end;
$$;

revoke all on function public.list_partner_submissions(uuid, uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_partner_submissions(uuid, uuid, uuid, integer) to authenticated;
