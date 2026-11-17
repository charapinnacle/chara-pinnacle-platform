-- my_contact_request_counts of 20270215100000_messaging_dashboard_blocks.sql without the requests Trust & Safety hid
-- (V73): the worker no longer reads them in list_contact_requests_received, so the dashboard does not count them either.
-- Everything else is unchanged.
create or replace function public.my_contact_request_counts() returns table (pending integer, received integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.contact_request_caller();
begin
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.account_kind = 'worker') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required', errcode = '42501';
  end if;
  return query
  select
    (count(*) filter (where private.contact_request_status_now(r.status, r.expires_at) = 'pending'))::integer,
    count(*)::integer
  from public.contact_requests r
  where r.worker_user_id = v_uid and r.moderation_state = 'visible';
end;
$$;
