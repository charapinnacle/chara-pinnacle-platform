-- The customer portal per organisation type (FR-R1, V15): Stripe shows in its portal the products of the configuration
-- the session names, so billing-checkout opens each type's own configuration and an employer is never offered a partner
-- plan, nor a partner another type's. billing_portal_start also returns the organisation's type for that choice; the
-- checks, the audit row and the grants are unchanged. The return type changes, so the function is dropped and created.
drop function public.billing_portal_start(uuid);

create function public.billing_portal_start(p_org uuid)
returns table (customer_ref text, slug text, organization_type public.organization_type)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text;
  v_slug text;
  v_type public.organization_type;
begin
  perform private.assert_billing_manager(p_org);
  select c.customer_ref, o.slug, o.type into v_ref, v_slug, v_type
  from billing.customers c join public.organizations o on o.id = c.organization_id
  where c.organization_id = p_org;
  if v_ref is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'no_customer';
  end if;

  perform audit.record('billing.portal_opened', 'organization', p_org::text);
  return query select v_ref, v_slug, v_type;
end;
$$;

revoke all on function public.billing_portal_start(uuid) from public, anon, authenticated, service_role;
grant execute on function public.billing_portal_start(uuid) to authenticated;
