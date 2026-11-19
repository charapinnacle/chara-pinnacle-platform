-- Partner checkout (FR-R1 AC4, AC5; decisions 2.1, 2.3): reopens what 20261115100200 closed. A plan of another
-- organisation type is refused with plan_not_for_org_type before any other plan check, so a wrong plan is named as such
-- even when it is not sold either; then a plan is sold when it is public, priced and not for contact, whatever the type.
-- A partner organisation buys only while release 2a is on (release_off, after the plan checks, so the refusals of a
-- plan read the same in both states). The trial rule is unchanged: private.billing_trial_used reads billing.trial_grants
-- and the identifiers of every organisation, whatever its type, so one free trial is granted per legal entity across
-- employers, recruitment and staffing companies. Nothing here reads or writes anything that orders search results
-- (NFR-C8).
create or replace function public.billing_checkout_start(
  p_org uuid,
  p_plan_code text,
  p_billing_country text,
  p_vat_id text,
  p_registration_number text,
  p_terms_version integer,
  p_provider text default 'null',
  p_disclosed_trial_days integer default null
) returns table (price_ref text, customer_ref text, trial_days integer, slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
  v_plan billing.plans;
  v_country text := upper(btrim(p_billing_country));
  v_vat text := private.normalize_legal_identifier(p_vat_id);
  v_reg text := private.normalize_legal_identifier(p_registration_number);
  v_terms integer;
  v_price_ref text;
  v_customer_ref text;
  v_used boolean;
  v_trial integer;
  v_linked_provider text;
begin
  perform private.assert_company_account();
  perform private.assert_org_manager(p_org, 'admin');
  select * into v_org from public.organizations o where o.id = p_org;

  if p_provider is null or p_provider not in ('null', 'stripe') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'provider', errcode = '22023';
  end if;
  select * into v_plan from billing.plans p where p.code = p_plan_code;
  if not found then
    raise exception 'CHARA_FORBIDDEN' using detail = 'unknown_plan';
  end if;
  if v_plan.org_type <> v_org.type then
    raise exception 'CHARA_FORBIDDEN' using detail = 'plan_not_for_org_type', errcode = '42501';
  end if;
  if not v_plan.is_public or v_plan.price_minor <= 0 or v_plan.contact_sales then
    raise exception 'CHARA_FORBIDDEN' using detail = 'plan_not_sold';
  end if;
  if v_org.type <> 'employer' and not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;

  if v_country is null or v_country !~ '^[A-Z]{2}$' or not exists (select 1 from public.countries c where c.code = v_country) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'billing_country', errcode = '22023';
  end if;
  if v_vat is null and v_reg is null then
    if v_org.legal_entity_identifier is null then
      raise exception 'CHARA_FORBIDDEN' using detail = 'legal_entity_identifier_required';
    end if;
    raise exception 'CHARA_INVALID_INPUT' using detail = 'identifier', errcode = '22023';
  end if;
  if v_vat is not null and v_vat !~ '^[A-Z]{2}[A-Z0-9]{6,12}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'vat_id', errcode = '22023';
  end if;
  if v_reg is not null and v_reg !~ '^[A-Z0-9]{4,32}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'registration_number', errcode = '22023';
  end if;

  v_terms := private.current_legal_version('subscription-and-billing-terms');
  if v_terms is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'terms_not_published';
  end if;
  if p_terms_version is distinct from v_terms then
    raise exception 'CHARA_FORBIDDEN' using detail = 'terms_version_mismatch';
  end if;

  if exists (select 1 from billing.subscriptions s where s.organization_id = p_org and s.status <> 'canceled') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'already_subscribed';
  end if;

  select r.provider_price_ref into v_price_ref
  from billing.plan_provider_refs r where r.plan_code = p_plan_code and r.provider = p_provider;
  if p_provider = 'stripe' and v_price_ref is null then
    raise exception 'CHARA_UNAVAILABLE' using detail = 'plan_not_synced';
  end if;

  select c.provider into v_linked_provider
  from billing.customers c where c.organization_id = p_org and c.customer_ref is not null;
  if v_linked_provider is distinct from p_provider and v_linked_provider is not null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'provider_mismatch';
  end if;

  v_used := private.billing_trial_used(p_org, v_country, v_vat, v_reg);
  v_trial := case when v_used then 0 else v_plan.trial_days end;

  insert into billing.customers as c (organization_id, provider, billing_country, vat_id, registration_number)
  values (p_org, p_provider, v_country, v_vat, v_reg)
  on conflict (organization_id) do update
    set provider = excluded.provider,
        billing_country = excluded.billing_country,
        vat_id = excluded.vat_id,
        registration_number = excluded.registration_number
  returning c.customer_ref into v_customer_ref;

  if p_disclosed_trial_days is not null and p_disclosed_trial_days <> v_trial then
    return query select v_price_ref, v_customer_ref, v_trial, v_org.slug;
    return;
  end if;

  if not exists (
    select 1 from (
      select c.action, c.version from public.consents c
      where c.user_id = v_uid and c.purpose = 'subscription-and-billing-terms'
      order by c.id desc limit 1
    ) latest
    where latest.action = 'granted' and latest.version = v_terms
  ) then
    insert into public.consents (user_id, purpose, version, action)
    values (v_uid, 'subscription-and-billing-terms', v_terms, 'granted');
  end if;

  perform audit.record(
    'billing.checkout_started', 'organization', p_org::text,
    jsonb_build_object('plan_code', p_plan_code, 'trial_days', v_trial, 'legal_entity_trial_used', v_used)
  );
  return query select v_price_ref, v_customer_ref, v_trial, v_org.slug;
end;
$$;
