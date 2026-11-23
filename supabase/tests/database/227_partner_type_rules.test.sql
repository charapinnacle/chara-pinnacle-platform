-- What sets a recruitment company apart from a staffing company: the fee models each may quote, the term each fee needs,
-- and that a permanent hire is not a staffing type.
begin;
select plan(11);

create function pg_temp.org(p_type public.organization_type, p_staffing boolean default false) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
  values (v_id, p_type, 'kind-' || left(v_id::text, 8), 'Kind ' || left(v_id::text, 8), 'Kind ' || left(v_id::text, 8), 'PH');
  if p_staffing then
    insert into public.organization_service_types (organization_id, service) values (v_id, 'staffing');
  end if;
  return v_id;
end;
$$;

-- The error of inserting a response with this fee for this organisation: the kind check runs before any other.
create function pg_temp.fee(p_org uuid, p_fee public.fee_model) returns text
language plpgsql as $$
begin
  insert into public.partner_responses (organization_id, fee_model) values (p_org, p_fee);
  return 'inserted';
exception when others then
  return case when sqlerrm = 'CHARA_INVALID_INPUT' then 'refused' else 'passed' end;
end;
$$;

select pg_temp.org('recruitment_company') as rec \gset
select pg_temp.org('recruitment_company', true) as both \gset
select pg_temp.org('staffing_company') as staff \gset
select pg_temp.org('employer') as emp \gset

select is(
  private.partner_kind(:'rec') || ',' || private.partner_kind(:'both') || ',' || private.partner_kind(:'staff')
    || ',' || coalesce(private.partner_kind(:'emp'), 'null'),
  'recruitment,both,staffing,null',
  'a recruitment company, one that also supplies staff, a staffing company, and no kind for an employer'
);
select is(
  (select string_agg(f::text || '=' || pg_temp.fee(:'rec', f), ',' order by f) from unnest(enum_range(null::public.fee_model)) f),
  'fee_per_hire=passed,percent_first_year_salary=passed,hourly_rate=refused,monthly_rate=refused,on_request=passed',
  'a recruitment company quotes a placement fee or on request, never a rate'
);
select is(
  (select string_agg(f::text || '=' || pg_temp.fee(:'staff', f), ',' order by f) from unnest(enum_range(null::public.fee_model)) f),
  'fee_per_hire=refused,percent_first_year_salary=refused,hourly_rate=passed,monthly_rate=passed,on_request=passed',
  'a staffing company quotes a rate or on request, never a placement fee'
);
select is(
  (select string_agg(pg_temp.fee(:'both', f), ',' order by f) from unnest(enum_range(null::public.fee_model)) f),
  'passed,passed,passed,passed,passed',
  'a recruitment company that also supplies staff quotes any fee'
);
select is(
  private.response_terms_needed('both', 'fee_per_hire') || ',' || private.response_terms_needed('both', 'percent_first_year_salary')
    || ',' || private.response_terms_needed('both', 'hourly_rate') || ',' || private.response_terms_needed('both', 'monthly_rate'),
  'guarantee_days,guarantee_days,assignment_weeks,assignment_weeks',
  'a placement fee needs a guarantee period, a rate the assignment length'
);
select is(
  private.response_terms_needed('recruitment', 'on_request') || ',' || private.response_terms_needed('staffing', 'on_request')
    || ',' || coalesce(private.response_terms_needed('both', 'on_request'), 'none'),
  'guarantee_days,assignment_weeks,none',
  'on request needs the term of the partner''s kind, and none of a company that does both'
);
select ok(
  (select prosrc ~ 'response_terms_needed' and prosrc ~ 'p_assignment_weeks' from pg_proc
   where oid = 'public.set_response_terms(uuid, uuid, text, text, integer, text, text[], integer, integer, integer)'::regprocedure),
  'set_response_terms checks the needed term and stores the assignment length'
);
select ok(
  (select pg_get_constraintdef(oid) ~ '260' from pg_constraint
   where conrelid = 'public.response_terms'::regclass and pg_get_constraintdef(oid) ~ 'assignment_weeks'),
  'an assignment lasts 1 to 260 weeks'
);
select throws_ok(
  format('insert into public.organization_service_types (organization_id, service) values (%L, ''permanent'')', :'staff'),
  '23514', null, 'a permanent hire is not a staffing type'
);
select lives_ok(
  format('insert into public.organization_service_types (organization_id, service) values (%L, ''project'')', :'staff'),
  'a project is'
);
select is_empty(
  $$ select 1 from pg_proc where proname in ('partner_kind', 'partner_fee_models', 'response_terms_needed', 'partner_responses_fee_for_kind')
       and pronamespace = 'private'::regnamespace
       and (has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute')) $$,
  'no API role calls the private helpers'
);

select * from finish();
rollback;
