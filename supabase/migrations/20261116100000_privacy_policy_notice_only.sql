-- GDPR: the Privacy Policy is information (Articles 13 and 14), not a contract the user agrees to. A new version is told
-- to the users who had it (the legal_version email and notification of account_ops_fan_out_legal_version, unchanged), and
-- no longer holds them at the consent page. A user who never read any version (or withdrew) is still asked once. The
-- contracts (terms of service, the terms of the kind or partner type) are still accepted again.

create or replace function public.pending_reconsents()
returns table (slug text, title text, version integer, published_at timestamptz, change_summary text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind public.account_kind;
  v_org_type public.organization_type;
  v_status public.profile_status;
  v_session_started timestamptz;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  select p.account_kind, p.intended_organization_type, p.status into v_kind, v_org_type, v_status
  from public.profiles p where p.id = v_uid;
  if v_kind is null or v_status <> 'active' then
    return;
  end if;

  select s.created_at into v_session_started
  from auth.sessions s
  where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid and s.user_id = v_uid;

  return query
  select d.slug, d.title, d.version, d.published_at, d.change_summary
  from unnest(private.required_consents(v_kind, v_org_type)) with ordinality r (slug, n)
  join public.legal_documents d
    on d.slug = r.slug and d.version = private.current_legal_version(r.slug)
  left join lateral (
    select c.action, c.version, c.created_at
    from public.consents c
    where c.user_id = v_uid and c.purpose = r.slug
    order by c.id desc
    limit 1
  ) latest on true
  cross join lateral (
    select case latest.action when 'withdrawn' then latest.created_at else d.published_at end as changed_at
  ) change
  where r.slug <> 'age-18-plus'
    and not (r.slug = 'privacy-policy' and latest.action is not distinct from 'granted')
    and (latest.action is distinct from 'granted' or latest.version is distinct from d.version)
    and (
      v_session_started is null
      or latest.action is null
      or change.changed_at <= v_session_started
      or change.changed_at <= now() - interval '7 days'
    )
  order by r.n;
end;
$$;
