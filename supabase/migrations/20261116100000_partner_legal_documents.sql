-- Partner legal documents (FR-S4; docs/phase-2/DATA_MODEL.md sections 1, 4 and 10; decision 6.2). Release 2a needs the
-- Partner Terms, the Recruitment Company Terms, the Staffing Company Terms and the employer-pays commitment; releases 2b
-- and 2c add the Data Processing Agreement for partners where counsel requires one, the worker visibility consent and
-- the disclaimer on immigration, visa and legal advice.
--
-- Each document starts as version 0, a DRAFT placeholder that says only what the document will cover: counsel writes
-- and approves the text, which is then published through the administration console as the next version (FR-H3). The
-- rows are the same as in supabase/seeds/ref/legal_documents.sql; they are inserted here as well because the hosted
-- project ran the seed only on its first deployment. Existing rows are never overwritten.
--
-- The release gate: private.legal_release_gaps(feature) names each document of a release feature that has no published
-- version or whose current version is a draft; scripts/check-go-live.mjs refuses a switched-on release while it returns a
-- row. The Phase 2 slugs are deliberately not added to private.missing_reference_data: a missing Phase 2 document stops
-- its release, not the Phase 1 deployment, which goes on while counsel works on the texts.

insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
select
  d.slug,
  0,
  'DRAFT: ' || d.title,
  E'DRAFT placeholder for review by legal counsel. This text has not been approved and must not be relied on.\n\n'
    || E'## What this document will cover\n\n' || d.scope || E'\n\n'
    || E'## Status\n\nLegal counsel prepares and approves the text. Until then this page shows this placeholder only.',
  'Draft placeholder pending approval by legal counsel.',
  now(),
  true
from (values
  ('partner-terms', 'Partner Terms',
    'The terms for recruitment companies and staffing companies that use the partner network.'),
  ('recruitment-company-terms', 'Recruitment Company Terms',
    'The additional terms for recruitment companies.'),
  ('staffing-company-terms', 'Staffing Company Terms',
    'The additional terms for staffing companies.'),
  ('employer-pays-commitment', 'Employer-pays commitment',
    'The commitment that a partner company gives about recruitment fees and related costs for workers.'),
  ('partner-dpa', 'Data Processing Agreement for partners',
    'The data processing agreement with partner companies, where legal counsel decides that one is required.'),
  ('worker-visibility-consent', 'Worker visibility consent',
    'The consent of a worker to be shown in the worker search, and how to withdraw it.'),
  ('immigration-disclaimer', 'Immigration, visa and legal advice disclaimer',
    'The disclaimer on immigration, visa and legal advice.')
) as d (slug, title, scope)
on conflict (slug, version) do nothing;

-- Whether counsel requires the Data Processing Agreement for partners (decision 6.3); while false it is no gate.
insert into private.settings (key, value) values ('partner_dpa_required', 'false') on conflict (key) do nothing;

-- The documents each release feature needs before it goes live (FR-S4 AC9; decisions 6.1 and 7.1): partner accounts and
-- Find Partners (release 2a) may go live before the legal opinion, the job orders board with candidate submissions
-- (2b) and Find Workers (2c) wait for it. The immigration disclaimer is also part of 2a because the public partner
-- profile links to it (AC10). partner-dpa joins job_orders and find_workers while partner_dpa_required is true.
insert into private.settings (key, value) values (
  'legal_release_documents',
  '{
    "partner_accounts": ["privacy-policy", "acceptable-use-policy", "partner-terms", "recruitment-company-terms",
      "staffing-company-terms", "employer-pays-commitment", "immigration-disclaimer"],
    "job_orders": ["worker-terms", "immigration-disclaimer"],
    "find_workers": ["worker-terms", "worker-visibility-consent", "immigration-disclaimer"]
  }'
) on conflict (key) do nothing;

-- One row per document of the feature that cannot go live: 'missing' (no published version) or 'draft' (the current
-- version is a draft, also when an older version was approved, because the draft is what users read). No row means the
-- feature's documents are approved.
create function private.legal_release_gaps(p_feature text)
returns table (slug text, state text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lists jsonb;
  v_dpa boolean;
  v_slugs text[];
begin
  select s.value into v_lists from private.settings s where s.key = 'legal_release_documents';
  select (s.value #>> '{}')::boolean into v_dpa from private.settings s where s.key = 'partner_dpa_required';
  if v_lists is null or v_dpa is null then
    raise exception 'CHARA_SETTING_MISSING' using detail = 'legal_release_gaps';
  end if;
  if p_feature is null or jsonb_typeof(v_lists -> p_feature) is distinct from 'array' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'feature';
  end if;

  select array_agg(e.slug order by e.n) into v_slugs
  from jsonb_array_elements_text(v_lists -> p_feature) with ordinality e (slug, n);
  if v_dpa and p_feature in ('job_orders', 'find_workers') and 'partner-dpa' <> all (coalesce(v_slugs, '{}')) then
    v_slugs := array_append(v_slugs, 'partner-dpa');
  end if;

  return query
  select r.slug, case when c.slug is null then 'missing' else 'draft' end
  from unnest(v_slugs) with ordinality r (slug, n)
  left join public.v_legal_current c on c.slug = r.slug
  where c.slug is null or c.is_draft
  order by r.n;
end;
$$;

revoke all on function private.legal_release_gaps(text) from public, anon, authenticated, service_role;

-- Whether an organisation has accepted the current version of an organisation-level document (the employer-pays
-- commitment, the partner DPA): only the latest consent of its accepted owner counts, so an admin's or a member's
-- acceptance does not, a withdrawal or an older version does not, and after a transfer of ownership the new owner must
-- accept again (DATA_MODEL.md section 11, point 2). A slug without a published version is never accepted.
create function private.org_consent_current(p_org uuid, p_slug text) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select latest.action = 'granted' and latest.version = private.current_legal_version(p_slug)
    from public.organization_members m
    cross join lateral (
      select c.action, c.version
      from public.consents c
      where c.user_id = m.user_id and c.purpose = p_slug
      order by c.id desc
      limit 1
    ) latest
    where m.organization_id = p_org and m.role = 'owner' and m.accepted_at is not null
  ), false)
$$;

revoke all on function private.org_consent_current(uuid, text) from public, anon, authenticated, service_role;
