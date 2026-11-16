-- An outdated employer-pays commitment blocks the partner's responses and candidate submissions (FR-S4 AC7, FR-J3 AC3,
-- AC4; SOP P2-44 step Re-consent, P2-03 step Re-accept; NFR-C6; V52; release 2b).
--
-- A new version of employer-pays-commitment makes private.partner_commitment_current false until the organisation's owner
-- accepts it (accept_employer_pays_commitment of V08; an admin's or a member's consent never counts). respond_to_invitation
-- (through private.response_refusal) and submit_candidate already refuse it with CHARA_CONSENT_REQUIRED detail
-- employer-pays-commitment (DATA_MODEL.md section 2), in the order V51 left them: after the requirement, the plan and the
-- job order conditions, before the licence and the monthly limit. What this adds: the edit of a live response is refused
-- the same way, because it writes a new version of the offer. A withdrawal, the reads, browsing job orders and the
-- workforce profile stay possible.

-- public.update_response of 20261230100000_partner_responses.sql with one change: after the state checks, a partner
-- without a current employer-pays commitment is refused with CHARA_CONSENT_REQUIRED employer-pays-commitment and nothing is
-- written.
create or replace function public.update_response(
  p_org uuid,
  p_response uuid,
  p_capacity integer,
  p_available_from date,
  p_experience_note text,
  p_fee_model public.fee_model,
  p_fee_amount numeric default null,
  p_fee_currency text default null,
  p_timeline_note text default null,
  p_notes text default null,
  p_expected_version integer default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.partner_responses;
  v_row public.workforce_requirements;
  v_proposal jsonb;
  v_before jsonb;
  v_changed text[];
  v_version integer;
begin
  perform private.assert_responding_partner(p_org);
  select * into v_old from public.partner_responses p where p.id = p_response and p.organization_id = p_org for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.status not in ('submitted', 'updated') then
    raise exception 'CHARA_INVALID_STATE' using detail = v_old.status::text;
  end if;
  select * into v_row from public.workforce_requirements r where r.id = v_old.requirement_id for share;
  if v_row.status in ('closed', 'filled') then
    raise exception 'CHARA_INVALID_STATE' using detail = 'requirement_closed';
  end if;
  if not private.partner_commitment_current(p_org) then
    raise exception 'CHARA_CONSENT_REQUIRED' using detail = 'employer-pays-commitment';
  end if;
  if p_expected_version is not null and p_expected_version <> v_old.version then
    raise exception 'CHARA_CONFLICT' using detail = 'stale';
  end if;

  v_proposal := private.response_proposal(v_row, p_capacity, p_available_from, p_experience_note, p_fee_model, p_fee_amount,
    p_fee_currency, p_timeline_note, p_notes, v_old.available_from, v_old.capacity);
  v_before := private.response_payload(v_old);
  select coalesce(array_agg(f.name order by f.position), '{}') into v_changed
  from unnest(private.partner_response_fields()) with ordinality f(name, position)
  where (v_proposal -> f.name) is distinct from (v_before -> f.name);
  if cardinality(v_changed) = 0 then
    return v_old.version;
  end if;

  perform private.count_audited_write(p_org);
  v_version := v_old.version + 1;
  update public.partner_responses p
  set capacity = (v_proposal ->> 'capacity')::integer, available_from = (v_proposal ->> 'available_from')::date,
      timeline_note = v_proposal ->> 'timeline_note', experience_note = v_proposal ->> 'experience_note',
      fee_model = (v_proposal ->> 'fee_model')::public.fee_model, fee_amount = (v_proposal ->> 'fee_amount')::numeric,
      fee_currency = v_proposal ->> 'fee_currency', notes = v_proposal ->> 'notes',
      version = v_version, status = 'updated', updated_at = now()
  where p.id = v_old.id;
  insert into public.partner_response_versions (
    response_id, version, organization_id, employer_organization_id, payload, changed_fields, created_by
  )
  select p.id, v_version, p.organization_id, p.employer_organization_id, private.response_payload(p), v_changed,
    (select auth.uid())
  from public.partner_responses p where p.id = v_old.id;
  perform audit.record('response.updated', 'partner_response', v_old.id::text,
    jsonb_build_object('requirement_id', v_old.requirement_id, 'organization_id', p_org,
      'employer_organization_id', v_old.employer_organization_id, 'version', v_version, 'changed_fields', to_jsonb(v_changed)));
  return v_version;
end;
$$;

revoke all on function public.update_response(
  uuid, uuid, integer, date, text, public.fee_model, numeric, text, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.update_response(
  uuid, uuid, integer, date, text, public.fee_model, numeric, text, text, text, integer
) to authenticated;
