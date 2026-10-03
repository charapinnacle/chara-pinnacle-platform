-- Documents shown at sign-up and documents awaiting re-consent (FR-A1, FR-A8; OPEN_QUESTIONS.md L9).
-- Both read the per-kind list in private.settings ('required_consents') and the current published versions, so the
-- web tier holds no list of documents.

create function public.signup_documents(p_kind public.account_kind)
returns table (slug text, title text, version integer, published_at timestamptz, change_summary text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required text[] := private.required_consents(p_kind);
  v_rows integer;
begin
  if cardinality(v_required) = 0 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'no required consents are configured';
  end if;

  return query
  select d.slug, d.title, d.version, d.published_at, d.change_summary
  from unnest(v_required) with ordinality r (slug, n)
  join public.legal_documents d
    on d.slug = r.slug and d.version = private.current_legal_version(r.slug)
  order by r.n;

  get diagnostics v_rows = row_count;
  -- A required document without a published version would let a sign-up through that can never commit its kind.
  if v_rows <> cardinality(v_required) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'a required document has no published version';
  end if;
end;
$$;

revoke all on function public.signup_documents(public.account_kind) from public, anon, authenticated, service_role;
grant execute on function public.signup_documents(public.account_kind) to anon, authenticated;

-- Documents the caller must accept again before using the app. The age attestation is never asked again (FR-A9).
-- A change only gates a session that started after it: the session is read by its id (the only JWT claim used besides
-- sub), so a session opened before the publication or the withdrawal carries on until its next sign-in. A caller
-- without a session row is treated as a new session.
create function public.pending_reconsents()
returns table (slug text, title text, version integer, published_at timestamptz, change_summary text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind public.account_kind;
  v_session_started timestamptz;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  select p.account_kind into v_kind from public.profiles p where p.id = v_uid;
  if v_kind is null then
    return;
  end if;

  select s.created_at into v_session_started
  from auth.sessions s
  where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid and s.user_id = v_uid;

  return query
  select d.slug, d.title, d.version, d.published_at, d.change_summary
  from unnest(private.required_consents(v_kind)) with ordinality r (slug, n)
  join public.legal_documents d
    on d.slug = r.slug and d.version = private.current_legal_version(r.slug)
  left join lateral (
    select c.action, c.version, c.created_at
    from public.consents c
    where c.user_id = v_uid and c.purpose = r.slug
    order by c.id desc
    limit 1
  ) latest on true
  where r.slug <> 'age-18-plus'
    and (latest.action is distinct from 'granted' or latest.version is distinct from d.version)
    and (
      v_session_started is null
      or latest.action is null
      or case latest.action when 'withdrawn' then latest.created_at else d.published_at end <= v_session_started
    )
  order by r.n;
end;
$$;

revoke all on function public.pending_reconsents() from public, anon, authenticated, service_role;
grant execute on function public.pending_reconsents() to authenticated;
