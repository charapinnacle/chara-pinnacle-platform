-- A plan price change (FR-R2 AC8, AC9; SOP FR-R2 step Price; docs/phase-2/DATA_MODEL.md sections 4 Billing and 7 Plans and
-- editor; decisions 7.1, 7.3). The Edge Function billing-plan-price reads the plan with admin_get_plan_price, creates the
-- new price at the payment provider and then records it with admin_record_plan_price, both with the administrator's
-- token. The new price applies to new checkouts (billing_checkout_start reads plan_provider_refs); existing subscriptions
-- keep theirs until the provider moves them, so no subscription row is read or written here.

-- What the function needs before it calls the provider: the plan's price, currency and interval and its product and
-- current price at the provider (null while scripts/sync-stripe-plans.mjs has not mirrored the plan). Refuses every
-- caller but a Platform Administrator at aal2, so the function asks the database who may change a price.
create function public.admin_get_plan_price(p_code text)
returns table (
  code text, org_type public.organization_type, name text, price_minor integer, currency text, "interval" text,
  product_ref text, price_ref text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if not exists (select 1 from billing.plans p where p.code = p_code) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'plan_code';
  end if;
  return query
  select p.code, p.org_type, p.name, p.price_minor, p.currency, p.interval, r.provider_product_ref, r.provider_price_ref
  from billing.plans p
  left join billing.plan_provider_refs r on r.plan_code = p.code and r.provider = 'stripe'
  where p.code = p_code;
end;
$$;

revoke all on function public.admin_get_plan_price(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_plan_price(text) to authenticated;

-- Records a price the provider has created: plans.price_minor and the provider price of the plan's product change
-- together, with ONE billing.plan_changed row holding the old and new amount, both price references and the statement of
-- reasons. The row triggers of plans and plan_provider_refs are silenced with chara.billing_audit_suppress for these two
-- writes only (set_config(..., true) bounds it to the transaction, and it is reset at once, so a later billing write of
-- the same transaction is audited again).
--
-- p_price_ref is null only for the null provider, which holds no prices: a plan whose price is already held at the
-- provider changes only with a new provider price, so the amount at the provider and on the pricing page stay the same.
-- The product row is written by the sync script; without it a provider price cannot be recorded (plan_not_synced).
-- Free plans stay free: org_plan_code falls back to them without a subscription.
create function public.admin_record_plan_price(p_code text, p_price_ref text, p_price_minor integer, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_plan billing.plans;
  v_ref billing.plan_provider_refs;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  v_reason := private.plan_editor_reason(p_reason);
  v_plan := private.plan_editor_plan(p_code);
  if v_plan.price_minor = 0 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'free_plan';
  end if;
  if p_price_minor is null or p_price_minor not between 100 and 10000000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'price_minor';
  end if;
  if p_price_minor = v_plan.price_minor then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'price_unchanged';
  end if;
  if p_price_ref is not null and p_price_ref !~ '^price_[A-Za-z0-9_]{1,200}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'price_ref';
  end if;

  select * into v_ref from billing.plan_provider_refs r where r.plan_code = p_code and r.provider = 'stripe' for update;
  if p_price_ref is not null and v_ref.plan_code is null then
    raise exception 'CHARA_UNAVAILABLE' using detail = 'plan_not_synced';
  end if;
  if (p_price_ref is null and v_ref.provider_price_ref is not null) or p_price_ref = v_ref.provider_price_ref then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'price_ref';
  end if;

  perform set_config('chara.billing_audit_suppress', 'on', true);
  update billing.plans set price_minor = p_price_minor where code = p_code;
  if p_price_ref is not null then
    update billing.plan_provider_refs set provider_price_ref = p_price_ref where plan_code = p_code and provider = 'stripe';
  end if;
  perform set_config('chara.billing_audit_suppress', 'off', true);

  perform audit.record(
    'billing.plan_changed', 'plan', p_code,
    jsonb_build_object(
      'table', 'plans', 'plan_code', p_code, 'reason', v_reason, 'request_id', private.request_id(),
      'operation', 'update',
      'before', jsonb_build_object('price_minor', v_plan.price_minor, 'provider_price_ref', v_ref.provider_price_ref),
      'after', jsonb_build_object('price_minor', p_price_minor, 'provider_price_ref', p_price_ref)
    )
  );
  perform set_config('chara.audit_reason', '', true);
  return true;
end;
$$;

revoke all on function public.admin_record_plan_price(text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_record_plan_price(text, text, integer, text) to authenticated;

comment on table billing.plan_provider_refs is
  'The product and price of a plan at the provider: products and first prices written by scripts/sync-stripe-plans.mjs, later prices by admin_record_plan_price; never exposed through a view.';
