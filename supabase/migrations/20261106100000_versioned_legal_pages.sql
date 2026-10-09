-- Versioned legal pages (FR-H3; OPEN_QUESTIONS.md L5, L7, L9, D67): the draft mark of a version, the view of the current
-- version, the export of every version, the publication without the form's version check and the recipients of the
-- email about a new version.

-- A text that legal counsel has not approved is published as a draft and shown with a banner (L5). A change, including
-- the approval of a draft, is always a new version. Version 0 is the placeholder every Phase 1 document starts with.
alter table public.legal_documents add column is_draft boolean not null default false;
update public.legal_documents set is_draft = true where version = 0;

-- One row per slug: the highest published version. The invoker's own policy decides which rows are published.
create view public.v_legal_current with (security_invoker = true) as
select distinct on (d.slug) d.slug, d.version, d.title, d.body, d.change_summary, d.published_at, d.is_draft
from public.legal_documents d
where d.published_at <= now()
order by d.slug, d.version desc;

revoke all on public.v_legal_current from public, anon, authenticated, service_role;
grant select on public.v_legal_current to anon, authenticated;

-- The next version number of the slug (1 for a new slug), published now, as a draft or as approved. The number is taken
-- under a lock of the slug, so two administrators who publish at the same moment get two consecutive versions and
-- neither fails. A repeat of the version that is already current, word for word (a second click, a retry after a
-- timeout), is refused with CHARA_CONFLICT and publishes nothing. The change summary is the reason of the audit row,
-- which also names the slug, the version and the draft mark. The emails to the users who accepted the document are the
-- job of account-ops (account_ops_fan_out_legal_version), queued here; a user is asked to accept the version at the
-- next sign-in because the version is ahead of the consent. The age attestation is never asked again.
drop function public.publish_legal_document(text, text, text, text, integer);

create function public.publish_legal_document(
  p_slug text, p_title text, p_body text, p_change_summary text, p_is_draft boolean default false
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(p_title, E' \t\r\n');
  v_summary text := btrim(p_change_summary, E' \t\r\n');
  v_version integer;
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
  if p_is_draft is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'is_draft';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('legal_document:' || p_slug, 0));
  select d.version into v_version from public.legal_documents d where d.slug = p_slug order by d.version desc limit 1;
  if exists (
    select 1 from public.legal_documents d
    where d.slug = p_slug and d.version = v_version
      and d.title = v_title and d.body = p_body and d.change_summary = v_summary and d.is_draft = p_is_draft
  ) then
    raise exception 'CHARA_CONFLICT' using detail = 'unchanged';
  end if;
  v_version := coalesce(v_version, 0) + 1;
  insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
  values (p_slug, v_version, v_title, p_body, v_summary, now(), p_is_draft);
  perform private.audit_admin(
    'legal_document.publish', 'legal_document', p_slug || ':' || v_version, v_summary,
    jsonb_build_object('slug', p_slug, 'version', v_version, 'is_draft', p_is_draft)
  );
  perform private.queue_account_op(jsonb_build_object('action', 'fan_out_legal_version', 'document_slug', p_slug, 'version', v_version));
  return v_version;
end;
$$;

revoke all on function public.publish_legal_document(text, text, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.publish_legal_document(text, text, text, text, boolean) to authenticated;

-- The console list of the current versions also says which of them is a draft (U41 returned no draft mark).
drop function public.admin_list_legal_documents();

create function public.admin_list_legal_documents()
returns table (slug text, version integer, title text, published_at timestamptz, is_draft boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);

  return query
  select c.slug, c.version, c.title, c.published_at, c.is_draft
  from public.v_legal_current c
  order by c.slug
  limit 100;
end;
$$;

revoke all on function public.admin_list_legal_documents() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_legal_documents() to authenticated;

-- Every published version of every document, for the audit archive, in keyset pages of (slug, version). Page size 25 by
-- default and 100 at most, because a body can be 200,000 characters.
create function public.admin_export_legal_documents(
  p_after_slug text default null, p_after_version integer default null, p_limit integer default 25
) returns table (slug text, version integer, title text, body text, change_summary text, is_draft boolean, published_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);

  return query
  select d.slug, d.version, d.title, d.body, d.change_summary, d.is_draft, d.published_at
  from public.legal_documents d
  where d.published_at <= now()
    and (p_after_slug is null or (d.slug, d.version) > (p_after_slug, coalesce(p_after_version, -1)))
  order by d.slug, d.version
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

revoke all on function public.admin_export_legal_documents(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_export_legal_documents(text, integer, integer) to authenticated;

-- One page of the fan-out of a legal version (U41, D66): the mandatory email to the users the new version affects, after
-- p_after in the order of their id. A user is affected when the account kind has to accept the slug (none for the age
-- attestation or a document nobody has to accept), the profile is active and not marked for deletion, and the latest row
-- of the user's consent ledger for the slug is a grant of an older version: a user who never accepted the document or
-- has withdrawn the consent is not told, because there is nothing to accept again (FR-H3 AC10). It returns the last id
-- of the page and the emails queued, and no row once the users are used up, so the job calls it until then. A user who
-- already has the email of this version is skipped, so a job that runs again queues nothing twice.
create or replace function public.account_ops_fan_out_legal_version(
  p_slug text, p_version integer, p_after uuid default null, p_limit integer default 1000
) returns table (last_id uuid, queued integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kinds public.account_kind[];
  v_summary text;
  v_ids uuid[];
  v_messages jsonb[];
begin
  if p_slug = 'age-18-plus' then
    return;
  end if;
  select array_agg(k) into v_kinds
  from unnest(enum_range(null::public.account_kind)) k
  where p_slug = any (private.required_consents(k));
  select d.change_summary into v_summary from public.legal_documents d where d.slug = p_slug and d.version = p_version;
  if v_kinds is null or v_summary is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('legal_version_fan_out:' || p_slug || ':' || p_version, 0));
  select array_agg(p.id order by p.id) into v_ids
  from (
    select x.id from public.profiles x
    where x.account_kind = any (v_kinds) and x.status = 'active' and x.deleted_at is null
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
