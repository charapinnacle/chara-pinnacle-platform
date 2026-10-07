-- Bulk change of status (FR-D2 guard step; the page and the confirmation step are FR-E3). Each application goes through
-- the same function as set_application_status, so the transition guard, the plan gates, the event, the audit row and the
-- queue message are those of a single change, one transaction part per item: a refused item leaves no row and the others
-- still apply. The refusal of a restricted organisation is the whole call's, before any item is processed.

-- p_application_ids: 1 to 100 ids as sent (the Data API returns at most 100 rows, so the result fits one response),
-- duplicates are processed once. p_status is shortlisted, interview, offer, hired or rejected; a decline (rejected) needs a
-- reason, which is the note the candidate sees. The result has one row per distinct id, in id order (the order the rows are
-- locked in, so two calls never wait for each other); error_code is the CHARA_ code of a refused item (CHARA_NOT_FOUND
-- for an id of another organisation or an unknown id, the same answer). One audit row records the call: target, requested,
-- applied and the ids, never the note.
-- Errors of the whole call: CHARA_FORBIDDEN, CHARA_INVALID_INPUT (details p_application_ids, p_status, p_note),
-- CHARA_FEATURE_NOT_IN_PLAN (detail read_only_free_plan), CHARA_SETTING_MISSING.
create function public.bulk_set_application_status(
  p_application_ids uuid[], p_status public.application_status, p_note text default null
) returns table (application_id uuid, ok boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max constant integer := 100;
  v_note text;
  v_ids uuid[];
  v_org uuid;
  v_id uuid;
  v_applied integer := 0;
  v_message text;
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  if coalesce(cardinality(p_application_ids), 0) not between 1 and v_max
     or exists (select 1 from unnest(p_application_ids) i where i is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_application_ids';
  end if;
  if p_status not in ('shortlisted', 'interview', 'offer', 'hired', 'rejected') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_status';
  end if;
  v_note := private.normalize_status_note(p_note);
  if p_status = 'rejected' and v_note is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_note';
  end if;

  v_ids := array(select distinct i from unnest(p_application_ids) i order by i);
  for v_org in
    select distinct a.organization_id from public.job_applications a
    where a.id = any (v_ids) and a.organization_id in (select private.member_org_ids())
  loop
    perform private.assert_org_writable(v_org);
  end loop;

  foreach v_id in array v_ids loop
    begin
      perform private.change_application_status(v_id, p_status, v_note);
      application_id := v_id;
      ok := true;
      error_code := null;
      v_applied := v_applied + 1;
    exception when others then
      get stacked diagnostics v_message = message_text;
      if v_message not like 'CHARA\_%' then
        raise;
      end if;
      application_id := v_id;
      ok := false;
      error_code := v_message;
    end;
    return next;
  end loop;

  perform audit.record(
    'application.bulk_status_changed', 'job_application', null,
    jsonb_build_object('to', p_status, 'requested', cardinality(v_ids), 'applied', v_applied, 'ids', to_jsonb(v_ids))
  );
end;
$$;

revoke all on function public.bulk_set_application_status(uuid[], public.application_status, text) from public, anon, authenticated, service_role;
grant execute on function public.bulk_set_application_status(uuid[], public.application_status, text) to authenticated;
