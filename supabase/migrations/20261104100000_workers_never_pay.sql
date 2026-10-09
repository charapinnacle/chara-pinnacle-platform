-- Workers never pay (FR-G6; ILO Convention C181). The structure already cannot hold a worker: no billing table has a
-- column for a person, organization_members refuses a worker (trigger and accept_invitation) and the account kind is
-- committed once. What was missing is the explicit refusal of the billing calls themselves: a worker was turned away
-- only as a non-member, after the organization had been looked up, so the answer depended on the organization id. The
-- account kind is now the first check of the checkout, the portal and the page state, before the organization is
-- touched, so the answer is the same for any id and a refused call writes nothing. The refusal rolls back, so the
-- billing-checkout function records worker attempts (audit action billing.worker_checkout_refused) to make the KPI
-- countable, up to an allowance per person and window so that a loop cannot grow the log without bound.

insert into private.settings (key, value) values
  ('worker_checkout_refused_audit_max', '60'),
  ('worker_checkout_refused_audit_seconds', '3600');

create function private.assert_company_account() returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_kind public.account_kind := private.account_kind();
begin
  if v_kind is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind_unset';
  end if;
  if v_kind <> 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account';
  end if;
end;
$$;

revoke all on function private.assert_company_account() from public, anon, authenticated, service_role;

-- Adds the account-kind check in front of the role and second-step checks (replaces the version of the checkout
-- migration); the portal and the page state share it.
create or replace function private.assert_billing_manager(p_org uuid) returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_company_account();
  if not private.is_org_member(p_org, 'admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;
end;
$$;

-- Only the first statement differs from the version of the checkout migration: the account-kind check.
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
  if not v_plan.is_public or v_plan.price_minor <= 0 or v_plan.contact_sales or v_plan.org_type <> v_org.type then
    raise exception 'CHARA_FORBIDDEN' using detail = 'plan_not_sold';
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

-- Records one refused worker attempt. It writes nothing for a person who is no worker account and, once the allowance
-- of the window is used (counted from the audit rows of the person, which log_actor_created_idx serves), no further
-- row: the refusal itself never depends on this record. Returns whether a row was written.
create function public.billing_record_worker_attempt(p_user uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'worker_checkout_refused_audit_max');
  v_seconds integer := (select (value #>> '{}')::integer from private.settings where key = 'worker_checkout_refused_audit_seconds');
begin
  if not exists (select 1 from public.profiles p where p.id = p_user and p.account_kind = 'worker') then
    return false;
  end if;
  if (
    select count(*) from audit.log l
    where l.actor_id = p_user and l.created_at > now() - make_interval(secs => v_seconds)
      and l.action = 'billing.worker_checkout_refused'
  ) >= v_max then
    return false;
  end if;
  perform public.audit_record_external('billing.worker_checkout_refused', 'profile', p_user::text, p_user);
  return true;
end;
$$;

revoke all on function public.billing_record_worker_attempt(uuid) from public, anon, authenticated, service_role;
grant execute on function public.billing_record_worker_attempt(uuid) to service_role;
