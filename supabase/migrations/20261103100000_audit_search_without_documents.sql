-- No document access for platform staff (FR-F3). The audit search of the console listed the lifecycle events of candidate
-- documents (document.created, document.deleted, share.created and the like) with the document id, the candidate and the
-- time, which is a list and a count of documents. The rows stay in audit.log and in the monthly export; the search no
-- longer returns the entity types named in the setting, which the function reads so that its source names no document
-- table (the test of FR-F3 scans it). Only the filter is new (20261102110000).
insert into private.settings (key, value) values ('admin_audit_hidden_entity_types', '["worker_documents", "passport_shares"]');

drop function public.admin_search_audit(uuid, text, text, text, date, date, integer, timestamptz, bigint);

create function public.admin_search_audit(
  p_actor uuid default null, p_action text default null, p_entity_type text default null, p_entity_id text default null,
  p_from date default null, p_to date default null,
  p_limit integer default 25, p_after_at timestamptz default null, p_after_id bigint default null
) returns table (
  id bigint, actor_id uuid, action text, entity_type text, entity_id text, metadata jsonb, ip inet, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hidden text[] := array(
    select jsonb_array_elements_text(s.value) from private.settings s where s.key = 'admin_audit_hidden_entity_types'
  );
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if p_from > p_to
     or char_length(p_action) > 100 or char_length(p_entity_type) > 100 or char_length(p_entity_id) > 200 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'filter';
  end if;

  return query
  select l.id, l.actor_id, l.action, l.entity_type, l.entity_id, l.metadata, l.ip, l.created_at
  from audit.log l
  where l.entity_type <> all (v_hidden)
    and (p_actor is null or l.actor_id = p_actor)
    and (p_action is null or l.action = p_action)
    and (p_entity_type is null or l.entity_type = p_entity_type)
    and (p_entity_id is null or l.entity_id = p_entity_id)
    and (p_from is null or l.created_at >= p_from::timestamp at time zone 'UTC')
    and (p_to is null or l.created_at < (p_to + 1)::timestamp at time zone 'UTC')
    and (p_after_id is null or (l.created_at, l.id) < (p_after_at, p_after_id))
  order by l.created_at desc, l.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

revoke all on function public.admin_search_audit(uuid, text, text, text, date, date, integer, timestamptz, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_audit(uuid, text, text, text, date, date, integer, timestamptz, bigint) to authenticated;
