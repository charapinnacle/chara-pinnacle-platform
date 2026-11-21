-- A report on a message or a contact request is decided only by the administrator who has it in review (20270220100000),
-- so one left in review by an administrator who is away could not be closed by anyone. Another Trust & Safety
-- administrator now takes it over by putting it in review again (audited as report.in_review, from in_review); the same
-- administrator still cannot. Such a report is also closed only through moderation_decide, after reading, never by
-- setting its status. public.admin_set_report_status of 20261110110000_reporting.sql with those two changes; grants kept.
create or replace function public.admin_set_report_status(p_id bigint, p_status public.report_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_note text;
  v_old public.report_status;
  v_type public.report_target_type;
  v_handler uuid;
begin
  if p_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'report';
  end if;
  if p_status is null or p_status = 'new' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'status';
  end if;
  v_note := private.statement_of_reasons(p_note);

  select r.status, r.target_type, r.handled_by into v_old, v_type, v_handler
  from public.reports r where r.id = p_id for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old in ('actioned', 'dismissed')
     or (v_old = p_status and not (p_status = 'in_review' and v_handler is distinct from v_uid)) then
    raise exception 'CHARA_INVALID_STATE' using detail = v_old::text;
  end if;
  if p_status <> 'in_review' and v_type in ('message', 'contact_request') then
    raise exception 'CHARA_INVALID_STATE' using detail = 'not_in_review';
  end if;

  update public.reports
  set status = p_status, handled_by = v_uid, handled_at = now(),
      resolution_note = case when p_status = 'in_review' then null else v_note end
  where id = p_id;
  perform private.audit_admin(
    'report.' || p_status::text, 'report', p_id::text, v_note,
    jsonb_build_object('from', v_old, 'to', p_status, 'target_type', v_type)
  );
end;
$$;

-- Whether the calling Trust & Safety administrator has the report p_report in review: the console offers the decisions on
-- a message or a contact request only to them, and a take-over to anyone else.
create function public.admin_report_in_my_review(p_report bigint) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reports r
    where r.id = p_report and r.status = 'in_review'
      and r.handled_by = private.assert_staff(array['trust_safety']::public.platform_role[])
  )
$$;

revoke all on function public.admin_report_in_my_review(bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_report_in_my_review(bigint) to authenticated;
