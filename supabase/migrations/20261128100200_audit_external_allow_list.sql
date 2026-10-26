-- Rows appended from outside the database (FR-F2 AC6, reviewed with FR-R2): public.audit_record_external now accepts an
-- allow-list instead of refusing a list of reserved names. Its callers are the steps of account-ops jobs
-- (account_ops.*) and billing_record_worker_attempt (billing.worker_checkout_refused); every other name, the plan editor's
-- billing.plan_changed and setting.changed and the billing webhook's rows among them, is written by the database itself
-- and cannot be forged by a caller with the service role (replaces the version of the audited actions migration).
create or replace function public.audit_record_external(
  p_action text, p_entity_type text, p_entity_id text, p_actor_id uuid default null, p_metadata jsonb default '{}'
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action is null or char_length(p_action) > 100 or p_action !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
     or not (p_action ~ '^account_ops\.' or p_action = 'billing.worker_checkout_refused') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'action';
  end if;
  if p_entity_type is null or char_length(p_entity_type) not between 1 and 100 or char_length(p_entity_id) > 200 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'entity';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'metadata';
  end if;
  if p_action like 'account\_ops.%' and p_metadata ->> 'job_id' is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'job_id';
  end if;

  perform audit.record_as(
    (select p.id from public.profiles p where p.id = p_actor_id), p_action, p_entity_type, p_entity_id, p_metadata
  );
  return true;
exception when unique_violation then
  return false;
end;
$$;

revoke all on function public.audit_record_external(text, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.audit_record_external(text, text, text, uuid, jsonb) to service_role;
