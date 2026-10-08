-- The reads and the publication of the administration console (FR-F1; ARCHITECTURE.md sections 4, 8, 12; OPEN_QUESTIONS.md
-- D65). Every function re-checks the role of the caller and aal2 (private.assert_staff) and returns only the columns
-- the console shows: no cover note, snapshot, document or applicant identity. Lists are keyset pages of at most 100 rows.
-- The platform administrator and the Trust & Safety Administrator search and view; the rest is per function.

-- Search matches part of a name, so each searched expression has a trigram index. An email address must be given in full:
-- the Auth schema is not ours to index, and its unique index on the address (Auth stores it in lower case) serves the lookup.
create index profiles_display_name_trgm_idx on public.profiles using gin (lower(display_name) extensions.gin_trgm_ops);
create index organizations_display_name_trgm_idx on public.organizations using gin (lower(display_name) extensions.gin_trgm_ops);
create index organizations_legal_name_trgm_idx on public.organizations using gin (lower(legal_name) extensions.gin_trgm_ops);
create index organizations_slug_trgm_idx on public.organizations using gin (slug extensions.gin_trgm_ops);

-- The audit search filters on the actor and on the entity, newest first; log_actor_idx and log_entity_idx (account
-- closure) are not ordered by time.
create index log_actor_created_idx on audit.log (actor_id, created_at desc, id desc) where actor_id is not null;
create index log_entity_created_idx on audit.log (entity_type, entity_id, created_at desc, id desc);

-- Application statistics read the applications of a range of days, whatever their stage.
create index job_applications_created_status_idx on public.job_applications (created_at) include (status);

-- A term of 3 to 100 characters, as a LIKE pattern in which nothing the administrator types is a wildcard.
create function private.search_pattern(p_term text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_term text := btrim(p_term, E' \t\r\n');
begin
  if v_term is null or char_length(v_term) not between 3 and 100 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'term';
  end if;
  return '%' || replace(replace(replace(lower(v_term), '\', '\\'), '%', '\%'), '_', '\_') || '%';
end;
$$;

revoke all on function private.search_pattern(text) from public, anon, authenticated, service_role;

-- Keyset pages in the order (display name, id): pass the name and id of the last row for the next page. A user without a
-- display name sorts first and is passed as the empty name. The term matches part of the display name, the whole email
-- address (any case) or the user id of an account.
create function public.admin_search_users(
  p_term text, p_limit integer default 25, p_after_name text default null, p_after_id uuid default null
) returns table (
  id uuid, display_name text, email text, account_kind public.account_kind, status public.profile_status, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_like text;
  v_id uuid := case when btrim(p_term) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then btrim(p_term)::uuid end;
begin
  perform private.assert_staff(array['admin', 'trust_safety']::public.platform_role[]);
  v_like := private.search_pattern(p_term);

  return query
  with hits as (
    select p.id from public.profiles p where lower(p.display_name) like v_like
    union
    select u.id from auth.users u where u.email = lower(btrim(p_term)) and not u.is_sso_user
    union
    select v_id where v_id is not null
  )
  select p.id, p.display_name, u.email::text, p.account_kind, p.status, p.created_at
  from hits h
  join public.profiles p on p.id = h.id
  join auth.users u on u.id = p.id
  where p_after_id is null or (coalesce(p.display_name, ''), p.id) > (coalesce(p_after_name, ''), p_after_id)
  order by coalesce(p.display_name, ''), p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

revoke all on function public.admin_search_users(text, integer, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_users(text, integer, text, uuid) to authenticated;

create function public.admin_search_organizations(
  p_term text, p_limit integer default 25, p_after_name text default null, p_after_id uuid default null
) returns table (id uuid, display_name text, legal_name text, slug text, status public.organization_status)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_like text;
  v_id uuid := case when btrim(p_term) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then btrim(p_term)::uuid end;
begin
  perform private.assert_staff(array['admin', 'trust_safety']::public.platform_role[]);
  v_like := private.search_pattern(p_term);

  return query
  with hits as (
    select o.id from public.organizations o where lower(o.display_name) like v_like
    union
    select o.id from public.organizations o where lower(o.legal_name) like v_like
    union
    select o.id from public.organizations o where o.slug like v_like
    union
    select v_id where v_id is not null
  )
  select o.id, o.display_name, o.legal_name, o.slug, o.status
  from hits h
  join public.organizations o on o.id = h.id
  where p_after_id is null or (o.display_name, o.id) > (coalesce(p_after_name, ''), p_after_id)
  order by o.display_name, o.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

revoke all on function public.admin_search_organizations(text, integer, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_organizations(text, integer, text, uuid) to authenticated;

-- One user: the memberships, and the activity counts (applications submitted, vacancies created) which are counts only.
create function public.admin_get_user(p_user_id uuid) returns table (
  id uuid, display_name text, email text, account_kind public.account_kind, status public.profile_status,
  created_at timestamptz, memberships jsonb, applications_submitted bigint, vacancies_created bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['admin', 'trust_safety']::public.platform_role[]);
  if p_user_id is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'user';
  end if;

  return query
  select
    p.id, p.display_name, u.email::text, p.account_kind, p.status, p.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('organization_id', o.id, 'name', o.display_name, 'role', m.role) order by o.display_name, o.id)
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = p.id and m.accepted_at is not null
    ), '[]'::jsonb),
    (select count(*) from public.job_applications a where a.worker_user_id = p.id),
    (select count(*) from public.jobs j where j.created_by = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_user_id;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_get_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_user(uuid) to authenticated;

-- One organisation: its members and its latest 100 vacancies (soft-deleted ones left out), with no applicant data.
create function public.admin_get_organization(p_org uuid) returns table (
  id uuid, display_name text, legal_name text, slug text, status public.organization_status,
  members jsonb, vacancies jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['admin', 'trust_safety']::public.platform_role[]);
  if p_org is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'organization';
  end if;

  return query
  select
    o.id, o.display_name, o.legal_name, o.slug, o.status,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'display_name', p.display_name, 'role', m.role, 'accepted_at', m.accepted_at
      ) order by private.role_rank(m.role) desc, m.user_id)
      from public.organization_members m
      join public.profiles p on p.id = m.user_id
      where m.organization_id = o.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'title', v.title, 'status', v.status, 'moderation_state', v.moderation_state
      ) order by v.created_at desc, v.id desc)
      from (
        select j.id, j.title, j.status, j.moderation_state, j.created_at
        from public.jobs j
        where j.organization_id = o.id and j.deleted_at is null
        order by j.created_at desc, j.id desc
        limit 100
      ) v
    ), '[]'::jsonb)
  from public.organizations o
  where o.id = p_org;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_get_organization(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_organization(uuid) to authenticated;

-- Applications created from the start of the first day to the end of the last day (UTC), one row per stage, zero filled.
-- The range is at most 366 days.
create function public.admin_application_counts(p_from date, p_to date) returns table (status public.application_status, count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'range';
  end if;

  return query
  select s.status, coalesce(c.n, 0)
  from unnest(enum_range(null::public.application_status)) with ordinality as s (status, pos)
  left join (
    select a.status, count(*) as n
    from public.job_applications a
    where a.created_at >= p_from::timestamp at time zone 'UTC' and a.created_at < (p_to + 1)::timestamp at time zone 'UTC'
    group by a.status
  ) c on c.status = s.status
  order by s.pos;
end;
$$;

revoke all on function public.admin_application_counts(date, date) from public, anon, authenticated, service_role;
grant execute on function public.admin_application_counts(date, date) to authenticated;

-- Newest first, in keyset pages of (created_at, id): pass the time and id of the last row for the next page. The filters
-- are exact matches combined with AND; the dates are days in UTC, both inclusive.
create function public.admin_search_audit(
  p_actor uuid default null, p_action text default null, p_entity_type text default null, p_entity_id text default null,
  p_from date default null, p_to date default null,
  p_limit integer default 25, p_after_at timestamptz default null, p_after_id bigint default null
) returns table (
  id bigint, actor_id uuid, action text, entity_type text, entity_id text, metadata jsonb, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if p_from > p_to
     or char_length(p_action) > 100 or char_length(p_entity_type) > 100 or char_length(p_entity_id) > 200 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'filter';
  end if;

  return query
  select l.id, l.actor_id, l.action, l.entity_type, l.entity_id, l.metadata, l.created_at
  from audit.log l
  where (p_actor is null or l.actor_id = p_actor)
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

-- The suspensions and reinstatements, newest first, in keyset pages by id.
create function public.admin_list_moderation_actions(p_limit integer default 25, p_after_id bigint default null)
returns table (
  id bigint, target_type text, target_id uuid, target_name text, action text, statement_of_reasons text,
  actor_id uuid, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);

  return query
  select
    a.id, a.target_type, a.target_id,
    case a.target_type
      when 'organization' then (select o.display_name from public.organizations o where o.id = a.target_id)
      else (select coalesce(p.display_name, u.email::text) from public.profiles p join auth.users u on u.id = p.id where p.id = a.target_id)
    end,
    a.action, a.statement_of_reasons, a.actor_id, a.created_at
  from public.moderation_actions a
  where p_after_id is null or a.id < p_after_id
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

revoke all on function public.admin_list_moderation_actions(integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_moderation_actions(integer, bigint) to authenticated;

-- 20261007100000 extended for the staff page: the rows of revoked roles stay in the list, with who granted the role and
-- when it was revoked, and each row has the name, the email address and the last sign-in. mfa_enrolled is a boolean only.
drop function public.list_platform_staff(integer, bigint);

create function public.list_platform_staff(p_limit integer default 50, p_after_id bigint default null)
returns table (
  id bigint, user_id uuid, display_name text, email text, role public.platform_role, granted_by uuid,
  granted_by_email text, granted_at timestamptz, revoked_at timestamptz, mfa_enrolled boolean, last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_platform_role('admin') then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if not private.is_aal2() then
    raise exception 'CHARA_FORBIDDEN' using detail = 'aal2_required';
  end if;

  return query
  select
    s.id,
    s.user_id,
    p.display_name,
    u.email::text,
    s.role,
    s.granted_by,
    g.email::text,
    s.granted_at,
    s.revoked_at,
    exists (
      select 1 from auth.mfa_factors f
      where f.user_id = s.user_id and f.factor_type = 'totp' and f.status = 'verified'
    ),
    u.last_sign_in_at
  from public.platform_staff s
  join public.profiles p on p.id = s.user_id
  join auth.users u on u.id = s.user_id
  left join auth.users g on g.id = s.granted_by
  where p_after_id is null or s.id > p_after_id
  order by s.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.list_platform_staff(integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.list_platform_staff(integer, bigint) to authenticated;

-- A new version of a legal document: the next version number of the slug (1 for a new slug), published now. The change
-- summary is the reason of the audit row. Every active user who has to accept the document gets a mandatory email; a user
-- re-consents at the next sign-in because the version is now ahead of the consent. The age attestation is never asked again.
create function public.publish_legal_document(p_slug text, p_title text, p_body text, p_change_summary text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(p_title, E' \t\r\n');
  v_summary text := btrim(p_change_summary, E' \t\r\n');
  v_version integer;
  v_kinds public.account_kind[];
  v_messages jsonb[];
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  if p_slug is null or char_length(p_slug) not between 3 and 60 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'slug';
  end if;
  if v_title is null or char_length(v_title) not between 3 and 200 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'title';
  end if;
  if p_body is null or btrim(p_body, E' \t\r\n') = '' or char_length(p_body) > 200000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'body';
  end if;
  if v_summary is null or char_length(v_summary) not between 10 and 1000 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'change_summary';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('legal_document:' || p_slug, 0));
  select coalesce(max(d.version), 0) + 1 into v_version from public.legal_documents d where d.slug = p_slug;
  insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
  values (p_slug, v_version, v_title, p_body, v_summary, now());
  perform audit.record(
    'legal_document.publish', 'legal_document', p_slug || ':' || v_version,
    jsonb_strip_nulls(jsonb_build_object('reason', v_summary, 'request_id', private.request_id()))
  );

  if p_slug <> 'age-18-plus' then
    select array_agg(k) into v_kinds
    from unnest(enum_range(null::public.account_kind)) k
    where p_slug = any (private.required_consents(k));
  end if;
  if v_kinds is not null then
    select array_agg(jsonb_build_object(
      'kind', 'legal_version', 'user_id', p.id, 'mandatory', true,
      'document_slug', p_slug, 'version', v_version, 'change_summary', v_summary
    )) into v_messages
    from public.profiles p
    where p.account_kind = any (v_kinds) and p.status = 'active' and p.deleted_at is null;
    if v_messages is not null then
      perform pgmq.send_batch('notifications', v_messages);
    end if;
  end if;
  return v_version;
end;
$$;

revoke all on function public.publish_legal_document(text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.publish_legal_document(text, text, text, text) to authenticated;
