-- Occupations (ARCHITECTURE.md section 4; FR-B1): the ISCO-08 unit groups, the only values a candidate or a vacancy can
-- name as an occupation (NFR-M1). Rows come from supabase/seeds/ref (scripts/gen-ref-seeds.mjs). Readable by everyone,
-- writable by nobody through the API. The code is the key, as in the other reference tables; columns that refer to an
-- occupation are named occupation_id.

create table public.occupations (
  code text primary key check (code ~ '^[0-9]{4}$'),
  label text not null check (label <> ''),
  synonyms text[] not null default '{}'
);

comment on table public.occupations is 'ISCO-08 unit groups (International Labour Organization); synonyms are CHARA additions for search.';

create index occupations_label_trgm on public.occupations using gin (label extensions.gin_trgm_ops);

alter table public.occupations enable row level security;
alter table public.occupations force row level security;

grant select on public.occupations to anon, authenticated;

create policy occupations_select on public.occupations for select to anon, authenticated using (true);
