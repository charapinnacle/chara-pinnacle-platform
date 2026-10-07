-- Bulk change of status (FR-D2 guard step; the page and the confirmation step are FR-E3). Each application goes through
-- the same function as set_application_status, so the transition guard, the plan gates, the event, the audit row and the
-- queue message are those of a single change, one transaction part per item: a refused item leaves no row and the others
-- still apply. The refusal of a restricted organisation is the whole call's, before any item is processed.

-- p_application_ids: 1 to 100 ids as sent (the Data API returns at most 100 rows, so the result fits one response),
-- duplicates are processed once. p_status is shortlisted, interview, offer, hired or rejected; a decline (rejected) needs a
-- reason, which is the note the candidate sees. The result has one row per distinct id, in id order (the order the rows are
-- locked in, so two calls never wait for each other); error_code is the CHARA_ code of a refused item (CHARA_NOT_FOUND
-- for an id of another organisation or an unknown id, the same answer). One audit row records the call per organisation of
-- the applied items (one row in the usual case; one with a null organisation_id when nothing was applied): organization_id,
-- target, requested (the count of distinct ids sent), applied and the ids applied in that organisation, never the note.
-- A call of 100 items runs 100 subtransactions that write, which is more than the 64 subtransaction ids a backend caches:
-- readers that overlap the call consult pg_subtrans until it ends, and the row locks are held until then. The cost is
-- bounded by the 100 of FR-E3 AC10 and the per-item isolation of FR-D2 AC9 needs the subtransactions, so both stay.
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
  v_orgs uuid[];
  v_id uuid;
  v_applied_ids uuid[] := array[]::uuid[];
  v_org_ids uuid[];
  v_message text;
begin
  if (select auth.uid()) is null or private.account_kind() is distinct from 'company' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'company_account_required';
  end if;
  if coalesce(cardinality(p_application_ids), 0) not between 1 and v_max
     or exists (select 1 from unnest(p_application_ids) i where i is null) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_application_ids';
  end if;
  if p_status is null or p_status not in ('shortlisted', 'interview', 'offer', 'hired', 'rejected') then
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
      v_applied_ids := v_applied_ids || v_id;
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

  v_orgs := array(select distinct a.organization_id from public.job_applications a where a.id = any (v_applied_ids));
  if cardinality(v_orgs) = 0 then
    v_orgs := array[null::uuid];
  end if;
  foreach v_org in array v_orgs loop
    v_org_ids := array(
      select a.id from public.job_applications a
      where a.id = any (v_applied_ids) and a.organization_id is not distinct from v_org order by a.id
    );
    perform audit.record(
      'application.bulk_status_changed', 'job_application', null,
      jsonb_build_object(
        'organization_id', v_org, 'to', p_status, 'requested', cardinality(v_ids),
        'applied', cardinality(v_org_ids), 'ids', to_jsonb(v_org_ids)
      )
    );
  end loop;
end;
$$;

revoke all on function public.bulk_set_application_status(uuid[], public.application_status, text) from public, anon, authenticated, service_role;
grant execute on function public.bulk_set_application_status(uuid[], public.application_status, text) to authenticated;
