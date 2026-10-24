-- Consents per organisation type (FR-J1 AC7, FR-S4; docs/phase-2/DATA_MODEL.md section 4). A company user who signs up as
-- a recruitment or staffing company accepts the documents of that type instead of the employer documents. The lists stay
-- in private.settings ('required_consents'), now keyed by account kind and by partner type; the partner documents
-- themselves are published by V04, and until then (and while release 2a is off) signup_documents refuses the partner
-- types, so no partner sign-up can start.

update private.settings
set value = value || '{
  "recruitment_company": ["terms-of-service", "privacy-policy", "partner-terms", "recruitment-company-terms"],
  "staffing_company": ["terms-of-service", "privacy-policy", "partner-terms", "staffing-company-terms"]
}'::jsonb
where key = 'required_consents';

-- The key of the list a user accepts: the partner type for a company user who signed up as a partner, else the kind.
create function private.consent_list_key(p_kind public.account_kind, p_org_type public.organization_type) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'company' and p_org_type in ('recruitment_company', 'staffing_company') then p_org_type::text
    else p_kind::text
  end
$$;

revoke all on function private.consent_list_key(public.account_kind, public.organization_type)
  from public, anon, authenticated, service_role;

create function private.required_consents(p_kind public.account_kind, p_org_type public.organization_type)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select array_agg(e) from private.settings s,
       jsonb_array_elements_text(s.value -> private.consent_list_key(p_kind, p_org_type)) e
     where s.key = 'required_consents'),
    '{}'
  )
$$;

revoke all on function private.required_consents(public.account_kind, public.organization_type)
  from public, anon, authenticated, service_role;

-- The documents that belong to some other list than the given one: a user cannot accept them.
create function private.other_consents(p_kind public.account_kind, p_org_type public.organization_type) returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct e), '{}')
  from private.settings s, jsonb_each(s.value) l, jsonb_array_elements_text(l.value) e
  where s.key = 'required_consents' and l.key <> private.consent_list_key(p_kind, p_org_type)
$$;

revoke all on function private.other_consents(public.account_kind, public.organization_type)
  from public, anon, authenticated, service_role;

-- signup_documents (20261004100500) with the organisation type: the partner types list their own documents, only for a
-- company and only while release 2a is on. Dropped and recreated because the signature changes; p_org_type defaults to
-- null, which (like 'employer') lists the documents of the kind.
drop function public.signup_documents(public.account_kind);

create function public.signup_documents(p_kind public.account_kind, p_org_type public.organization_type default null)
returns table (slug text, title text, version integer, published_at timestamptz, change_summary text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required text[];
  v_rows integer;
begin
  if p_org_type in ('recruitment_company', 'staffing_company') then
    if p_kind is distinct from 'company' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'organization_type';
    end if;
    if not private.release_on('release_partner_directories') then
      raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
    end if;
  end if;
  v_required := private.required_consents(p_kind, p_org_type);
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

revoke all on function public.signup_documents(public.account_kind, public.organization_type)
  from public, anon, authenticated, service_role;
grant execute on function public.signup_documents(public.account_kind, public.organization_type) to anon, authenticated;

-- accept_consents (20261005110000) with the list of the user's organisation type: a document listed only for another kind
-- or type (recruitment-company-terms for a staffing company, partner-terms for an employer) cannot be accepted.
create or replace function public.accept_consents(p_consents jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status public.profile_status;
  v_kind public.account_kind;
  v_org_type public.organization_type;
  v_own text[];
  v_other text[];
  v_entry jsonb;
  v_purpose text;
  v_version integer;
  v_recorded jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  -- The row lock serialises concurrent calls of one user, so the idempotency check below cannot race.
  select p.status, coalesce(p.account_kind, p.intended_account_kind), p.intended_organization_type
  into v_status, v_kind, v_org_type
  from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if v_status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;
  if v_kind is null then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind_not_chosen';
  end if;
  v_own := private.required_consents(v_kind, v_org_type);
  v_other := private.other_consents(v_kind, v_org_type);

  if jsonb_typeof(p_consents) is distinct from 'array'
     or jsonb_array_length(p_consents) > private.max_consent_entries() then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_consents must be an array of at most 20 entries';
  end if;

  for v_entry in select e from jsonb_array_elements(p_consents) e loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or jsonb_typeof(v_entry -> 'purpose') is distinct from 'string'
       or (v_entry ->> 'version') !~ '^[0-9]{1,9}$' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'each entry needs a purpose and an integer version';
    end if;
    v_purpose := v_entry ->> 'purpose';
    v_version := (v_entry ->> 'version')::integer;

    if v_purpose = any (v_other) and v_purpose <> all (v_own) then
      raise exception 'CHARA_INVALID_INPUT' using detail = v_purpose;
    end if;
    if v_version is distinct from private.current_legal_version(v_purpose) then
      if exists (
        select 1 from public.legal_documents d
        where d.slug = v_purpose and d.version = v_version and d.published_at <= now()
      ) then
        raise exception 'CHARA_CONSENT_REQUIRED' using detail = v_purpose;
      end if;
      raise exception 'CHARA_INVALID_INPUT' using detail = v_purpose;
    end if;

    if exists (
      select 1 from (
        select c.action, c.version from public.consents c
        where c.user_id = v_uid and c.purpose = v_purpose
        order by c.id desc limit 1
      ) latest
      where latest.action = 'granted' and latest.version = v_version
    ) then
      continue;
    end if;

    insert into public.consents (user_id, purpose, version, action)
    values (v_uid, v_purpose, v_version, 'granted');
    v_recorded := v_recorded || jsonb_build_object('purpose', v_purpose, 'version', v_version);
  end loop;

  if jsonb_array_length(v_recorded) > 0 then
    perform audit.record('consents_accepted', 'profile', v_uid::text, jsonb_build_object('consents', v_recorded));
  end if;
end;
$$;

-- set_account_kind (20261004100400) with the list of the intended organisation type.
create or replace function public.set_account_kind(p_consents jsonb default '[]') returns public.account_kind
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_required text[];
  v_entry jsonb;
  v_purpose text;
  v_accepted jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if v_profile.account_kind is not null then
    return v_profile.account_kind;
  end if;

  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'email_unconfirmed';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;

  if jsonb_typeof(p_consents) is distinct from 'array'
     or jsonb_array_length(p_consents) > private.max_consent_entries() then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_consents must be an array of at most 20 entries';
  end if;

  v_required := private.required_consents(v_profile.intended_account_kind, v_profile.intended_organization_type);
  if cardinality(v_required) = 0 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'no required consents are configured';
  end if;

  foreach v_purpose in array v_required loop
    select e.entry into v_entry
    from jsonb_array_elements(p_consents || v_profile.pending_consents) with ordinality e(entry, n)
    where e.entry ->> 'purpose' = v_purpose
    order by e.n limit 1;
    if v_entry is null then
      raise exception 'CHARA_CONSENT_REQUIRED' using detail = v_purpose;
    end if;
    v_accepted := v_accepted || v_entry;
  end loop;

  update public.profiles
  set account_kind = intended_account_kind, pending_consents = '[]'
  where id = v_uid;
  perform audit.record(
    'account_kind_set', 'profile', v_uid::text,
    jsonb_strip_nulls(jsonb_build_object(
      'kind', v_profile.intended_account_kind, 'organization_type', v_profile.intended_organization_type
    ))
  );
  perform public.accept_consents(v_accepted);

  return v_profile.intended_account_kind;
end;
$$;

-- choose_account_kind (20261005110000) with the organisation type: a Google sign-up may choose a partner type as well
-- (only for a company, only while release 2a is on). The same rules as for the kind apply to the type: a profile that
-- named it at sign-up may repeat it and nothing else unless a verified Google identity is linked; a committed profile
-- returns its kind for the same choice and refuses another. Dropped and recreated because the signature changes;
-- p_org_type defaults to null (an employer), so the web caller of Phase 1 is unchanged.
drop function public.choose_account_kind(public.account_kind, jsonb);

create function public.choose_account_kind(
  p_kind public.account_kind, p_consents jsonb default '[]', p_org_type public.organization_type default null
) returns public.account_kind
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_google boolean;
  v_type public.organization_type := nullif(p_org_type, 'employer');
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  if p_kind is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_kind is required';
  end if;
  if v_type is not null then
    if p_kind <> 'company' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'organization_type';
    end if;
    if not private.release_on('release_partner_directories') then
      raise exception 'CHARA_FORBIDDEN' using detail = 'organization_type_not_available';
    end if;
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  if v_profile.account_kind is not null then
    if v_profile.account_kind <> p_kind or v_profile.intended_organization_type is distinct from v_type then
      raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind is committed';
    end if;
    return v_profile.account_kind;
  end if;

  select exists (
    select 1 from auth.identities i
    where i.user_id = v_uid and i.provider = 'google' and i.identity_data ->> 'email_verified' = 'true'
  ) into v_google;
  if v_profile.intended_account_kind is not null and not v_google
     and (v_profile.intended_account_kind <> p_kind or v_profile.intended_organization_type is distinct from v_type) then
    raise exception 'CHARA_FORBIDDEN' using detail = 'intended_account_kind cannot be changed';
  end if;

  if v_profile.intended_account_kind is distinct from p_kind
     or v_profile.intended_organization_type is distinct from v_type then
    perform set_config('chara.replace_intended_kind', 'on', true);
    update public.profiles set intended_account_kind = p_kind, intended_organization_type = v_type where id = v_uid;
    perform set_config('chara.replace_intended_kind', 'off', true);
  end if;
  if v_google then
    update public.profiles set pending_consents = '[]' where id = v_uid;
  end if;
  return public.set_account_kind(p_consents);
end;
$$;

revoke all on function public.choose_account_kind(public.account_kind, jsonb, public.organization_type)
  from public, anon, authenticated, service_role;
grant execute on function public.choose_account_kind(public.account_kind, jsonb, public.organization_type) to authenticated;

-- pending_reconsents (20261004100500) with the list of the user's organisation type.
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

-- The fan-out of a new legal version (20261106100000) with the recipients of the organisation types: a user is affected
-- when the list of the user's kind and type names the slug (recruitment-company-terms reaches recruitment companies only).
create or replace function public.account_ops_fan_out_legal_version(
  p_slug text, p_version integer, p_after uuid default null, p_limit integer default 1000
) returns table (last_id uuid, queued integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lists text[];
  v_summary text;
  v_ids uuid[];
  v_messages jsonb[];
begin
  if p_slug = 'age-18-plus' then
    return;
  end if;
  select array_agg(l.key) into v_lists
  from private.settings s, jsonb_each(s.value) l
  where s.key = 'required_consents' and l.value ? p_slug;
  select d.change_summary into v_summary from public.legal_documents d where d.slug = p_slug and d.version = p_version;
  if v_lists is null or v_summary is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('legal_version_fan_out:' || p_slug || ':' || p_version, 0));
  select array_agg(p.id order by p.id) into v_ids
  from (
    select x.id from public.profiles x
    where x.account_kind is not null
      and private.consent_list_key(x.account_kind, x.intended_organization_type) = any (v_lists)
      and x.status = 'active' and x.deleted_at is null
      and (p_after is null or x.id > p_after)
    order by x.id
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
  ) p;
  if v_ids is null then
    return;
  end if;

  select array_agg(jsonb_build_object(
    'kind', 'legal_version', 'user_id', u.id, 'mandatory', true,
    'document_slug', p_slug, 'version', p_version, 'change_summary', v_summary
  ) order by u.id) into v_messages
  from unnest(v_ids) u (id)
  where exists (
    select 1 from (
      select c.action, c.version from public.consents c
      where c.user_id = u.id and c.purpose = p_slug
      order by c.id desc limit 1
    ) latest
    where latest.action = 'granted' and latest.version < p_version
  )
  and not exists (
    select 1 from public.notifications n
    where n.user_id = u.id and n.kind = 'legal_version'
      and n.payload ->> 'document_slug' = p_slug and n.payload -> 'version' = to_jsonb(p_version)
  );
  if v_messages is not null then
    perform pgmq.send_batch('notifications', v_messages);
  end if;
  last_id := v_ids[cardinality(v_ids)];
  queued := coalesce(cardinality(v_messages), 0);
  return next;
end;
$$;
