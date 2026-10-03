-- Reference data (ARCHITECTURE.md section 4): countries, languages, currencies, industries.
-- Rows come from supabase/seeds/ref (scripts/gen-ref-seeds.mjs). Readable by everyone, writable by nobody
-- through the API; there is no insert, update or delete grant or policy.

create table public.countries (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  name text not null check (name <> '')
);

create table public.languages (
  code text primary key check (code ~ '^[a-z]{2}$'),
  name text not null check (name <> '')
);

create table public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null check (name <> '')
);

create table public.industries (
  code text primary key check (code ~ '^[A-Z]$'),
  name text not null check (name <> '')
);

comment on table public.countries is 'ISO 3166-1 alpha-2 codes; XK (Kosovo) is user-assigned.';
comment on table public.languages is 'ISO 639-1 codes.';
comment on table public.currencies is 'ISO 4217 active codes; withdrawn codes are excluded, XDR and XSU are kept.';
comment on table public.industries is 'ISIC Rev.4 sections A to U.';

alter table public.countries enable row level security;
alter table public.countries force row level security;
alter table public.languages enable row level security;
alter table public.languages force row level security;
alter table public.currencies enable row level security;
alter table public.currencies force row level security;
alter table public.industries enable row level security;
alter table public.industries force row level security;

grant select on public.countries, public.languages, public.currencies, public.industries
  to anon, authenticated;

create policy countries_select on public.countries for select to anon, authenticated using (true);
create policy languages_select on public.languages for select to anon, authenticated using (true);
create policy currencies_select on public.currencies for select to anon, authenticated using (true);
create policy industries_select on public.industries for select to anon, authenticated using (true);
