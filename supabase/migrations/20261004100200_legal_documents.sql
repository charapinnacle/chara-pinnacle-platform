-- Legal documents (ARCHITECTURE.md sections 4, 12; OPEN_QUESTIONS.md D2, L5, L7): versioned texts, readable by
-- anyone once published; the current version of a slug is its highest published version. Version 0 is the DRAFT
-- placeholder seeded in seeds/ref; the first approved text published later becomes version 1. There are no write
-- grants: publishing is an administrator RPC added with the legal pages. A row dated in the future is not yet
-- published, so a pre-dated row can neither be seen nor become the current version early.

create table public.legal_documents (
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  version integer not null check (version >= 0),
  title text not null check (length(title) between 3 and 200),
  body text not null check (length(body) between 1 and 200000),
  change_summary text not null check (length(change_summary) between 10 and 1000),
  published_at timestamptz,
  primary key (slug, version)
);

create index legal_documents_published_idx
  on public.legal_documents (slug, version desc)
  where published_at is not null;

alter table public.legal_documents enable row level security;
alter table public.legal_documents force row level security;

grant select on public.legal_documents to anon, authenticated;

create policy legal_documents_select_published on public.legal_documents
  for select to anon, authenticated
  using (published_at <= now());

create function private.current_legal_version(p_slug text) returns integer
language sql
stable
set search_path = ''
as $$
  select max(d.version) from public.legal_documents d where d.slug = p_slug and d.published_at <= now()
$$;

revoke all on function private.current_legal_version(text) from public, anon, authenticated, service_role;
