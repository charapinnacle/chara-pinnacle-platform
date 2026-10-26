-- Limit overrides with an expiry and plan audit rows with the reason of the change (FR-R2; docs/phase-2/DATA_MODEL.md
-- section 4 Billing; decisions 1.3, 7.1). Both objects are shared: private.org_limit is read by every limit check and
-- private.billing_plan_audit is the row trigger of plans, plan_limits, plan_features, organization_limit_overrides and
-- plan_provider_refs.

-- An override ends at expires_at; null is an override without an end (the rows written before the plan editor). The
-- editor always sets a future expiry.
alter table billing.organization_limit_overrides add column expires_at timestamptz;

comment on column billing.organization_limit_overrides.expires_at is
  'The override stops applying at this time (private.org_limit ignores it); null means no expiry.';

-- The override first while it has not expired and the organisation is still on an Enterprise plan (a plan sold on
-- request, or an *_enterprise code: overrides are granted only there), then the plan row; null is unlimited; 0 for a plan
-- code with no row in billing.plans. An organisation that lapses or moves down to another plan reads that plan's limits
-- and gets its override back if it returns to Enterprise before the expiry (replaces the version of the plans migration).
create or replace function private.org_limit(p_org uuid, p_key text) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from billing.plans p where p.code = private.org_plan_code(p_org)) then coalesce(
      (select o.limit_value from billing.organization_limit_overrides o
       where o.organization_id = p_org and o.limit_key = p_key and (o.expires_at is null or o.expires_at > now())
         and exists (
           select 1 from billing.plans p
           where p.code = private.org_plan_code(p_org) and (p.contact_sales or p.code like '%\_enterprise')
         )),
      (select l.limit_value from billing.plan_limits l where l.plan_code = private.org_plan_code(p_org) and l.limit_key = p_key)
    )
    else 0
  end
$$;

revoke all on function private.org_limit(uuid, text) from public, anon, authenticated, service_role;

-- One audit row per changed row, as before, now with the statement of reasons and the request id of the editor RPC that
-- made the change (transaction setting chara.audit_reason, empty outside the editor). The setting
-- chara.billing_audit_suppress = 'on' skips the row: an RPC that writes several rows for one change (a price change
-- touches plans and plan_provider_refs) writes its single row itself. Only definer code can set it, because no API role
-- can write these tables. V17 (admin_record_plan_price) must set it with set_config(..., true), so that it lasts at most
-- until the end of the transaction, and reset it to 'off' right after its own writes, before anything else in the call
-- writes a billing row (replaces the version of the plans migration).
create or replace function private.billing_plan_audit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_code text := case tg_table_name when 'plans' then v_row ->> 'code' else v_row ->> 'plan_code' end;
  v_entity_type text := case tg_table_name when 'organization_limit_overrides' then 'organization' else 'plan' end;
  v_entity_id text := coalesce(v_code, v_row ->> 'organization_id');
  v_reason text := nullif(current_setting('chara.audit_reason', true), '');
begin
  if current_setting('chara.billing_audit_suppress', true) = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if v_old = v_new then
      return null;
    end if;
    select jsonb_object_agg(n.key, o.value), jsonb_object_agg(n.key, n.value)
    into v_old, v_new
    from jsonb_each(v_new) n
    join jsonb_each(v_old) o on o.key = n.key
    where n.value is distinct from o.value;
  end if;

  perform audit.record(
    'billing.plan_changed', v_entity_type, v_entity_id,
    jsonb_strip_nulls(jsonb_build_object(
      'table', tg_table_name, 'plan_code', v_code, 'organization_id', v_row ->> 'organization_id',
      'limit_key', v_row ->> 'limit_key', 'feature_key', v_row ->> 'feature_key',
      'reason', v_reason, 'request_id', case when v_reason is not null then private.request_id() end
    )) || jsonb_build_object('operation', lower(tg_op), 'before', v_old, 'after', v_new)
  );
  return null;
end;
$$;

revoke all on function private.billing_plan_audit() from public, anon, authenticated, service_role;
