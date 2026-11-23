-- What a destination country's law says about leased agency work (temporary staffing), shown to an employer where it asks
-- a staffing company for workers: the Request workforce dialog, the workforce requirement form and the staffing directory.
-- The research of November 2026 found rules that commonly surprise employers: Germany refuses work permits for non-EU
-- workers leased by an agency (§ 40 AufenthG) and bans agency work in manual construction work (§ 1b AÜG), the Netherlands
-- admits labour suppliers from 2027 (Wtta), Poland requires an agency certificate (KRAZ). The rows are data, each with its
-- official source and the date it was last checked, so a change of law is a new row or an edited one, not new code.
-- They are general information, never legal advice: the page says so.
create table public.agency_work_rules (
  id bigint generated always as identity primary key,
  destination_country text not null references public.countries (code),
  -- True when the rule concerns workers from outside the EU and the EEA only; the page then shows it only when such
  -- workers may be involved.
  non_eu_workers_only boolean not null default false,
  title text not null check (char_length(title) between 3 and 120),
  notice text not null check (char_length(notice) between 20 and 1000),
  source_url text not null check (source_url ~ '^https://[^\s]+$' and char_length(source_url) <= 500),
  reviewed_on date not null,
  created_at timestamptz not null default now()
);

create index agency_work_rules_destination_idx on public.agency_work_rules (destination_country);

alter table public.agency_work_rules enable row level security;
alter table public.agency_work_rules force row level security;
-- Public law, read like the reference lists: the staffing directory shows it to visitors too.
create policy agency_work_rules_select on public.agency_work_rules for select to anon, authenticated using (true);
revoke all on public.agency_work_rules from public, anon, authenticated, service_role;
grant select on public.agency_work_rules to anon, authenticated;

insert into public.agency_work_rules (destination_country, non_eu_workers_only, title, notice, source_url, reviewed_on) values
  ('DE', true, 'Non-EU workers cannot usually be leased in Germany',
   'For workers from outside the EU, the Federal Employment Agency must refuse approval of the work permit when they would '
   || 'work for you as leased agency workers (§ 40(1) no. 2 Residence Act), with narrow exceptions such as the EU Blue Card. '
   || 'The usual route is to employ them directly, with a recruitment company finding them.',
   'https://www.gesetze-im-internet.de/aufenthg_2004/__40.html', date '2026-11-23'),
  ('DE', false, 'No agency work in German construction trades',
   'Agency work is prohibited in construction businesses for work usually done by manual workers (§ 1b Agency Work Act), '
   || 'with narrow exceptions. Check this before you ask a staffing company for construction workers.',
   'https://www.gesetze-im-internet.de/a_g/__1b.html', date '2026-11-23'),
  ('DE', false, 'German agency work needs a permit and has limits',
   'A staffing company that leases workers to you in Germany needs a permit from the Federal Employment Agency (Agency '
   || 'Work Act, AÜG). A worker may be leased to the same client for at most 18 months, and equal pay generally applies '
   || 'after 9 months.',
   'https://www.gesetze-im-internet.de/a_g/', date '2026-11-23'),
  ('NL', false, 'Dutch labour suppliers must be admitted from 2027',
   'From 1 January 2027 a company that supplies workers in the Netherlands must be admitted by the Netherlands Labour '
   || 'Market Authority (NAU), foreign suppliers included. A client that uses a supplier that is not admitted can be fined.',
   'https://www.rijksoverheid.nl/onderwerpen/hervormingen-arbeidsmarkt/aanpak-missstanden-bij-uitzendbureaus-en-andere-uitleners',
   date '2026-11-23'),
  ('PL', false, 'Polish agencies need a certificate',
   'A temporary employment agency in Poland must hold an agency certificate, which you can check in the KRAZ register. '
   || 'Workers from outside the EU also need a work permit or a registered declaration.',
   'https://zielonalinia.gov.pl/work-permit-34911', date '2026-11-23');
