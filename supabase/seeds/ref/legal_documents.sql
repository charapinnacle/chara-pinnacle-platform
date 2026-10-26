-- Version 0 of every Phase 1 legal document is a DRAFT placeholder (OPEN_QUESTIONS.md L5, L7): the text is not
-- approved by legal counsel. The first approved text is published later as version 1 and becomes the current version.
-- sharing-notice is the text shown with the consent of an application: its version is stored with each consent to share (FR-D1).
-- age-18-plus holds the wording of the age attestation (FR-A9); its slug is the consent purpose.
-- Existing rows are never overwritten, so a text that was published afterwards is not touched by a re-seed.

insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
select
  d.slug,
  0,
  'DRAFT: ' || d.title,
  'DRAFT placeholder. This text has not been approved by legal counsel and must not be relied on.',
  'Draft placeholder pending approval by legal counsel.',
  now(),
  true
from (values
  ('terms-of-service', 'Terms of Service'),
  ('privacy-policy', 'Privacy Policy'),
  ('cookie-policy', 'Cookie Policy'),
  ('platform-rules', 'Platform Rules'),
  ('acceptable-use-policy', 'Acceptable Use Policy'),
  ('subscription-and-billing-terms', 'Subscription and Billing Terms'),
  ('employer-terms', 'Employer Terms'),
  ('worker-terms', 'Worker Terms'),
  ('complaints-and-dispute-process', 'Complaints and Dispute Process'),
  ('account-suspension-and-termination-rules', 'Account Suspension and Termination Rules'),
  ('sharing-notice', 'Sharing Notice')
) as d (slug, title)
on conflict (slug, version) do nothing;

insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
values (
  'age-18-plus',
  0,
  'DRAFT: Age confirmation',
  'I am 18 or older. (DRAFT wording, pending review by legal counsel.)',
  'Draft placeholder pending approval by legal counsel.',
  now(),
  true
)
on conflict (slug, version) do nothing;

-- The partner legal documents of Phase 2 (FR-S4): version 0 is a DRAFT placeholder that says only what the document will
-- cover, until counsel's approved text is published as the next version. The same rows are inserted by the migration
-- 20261116100000_partner_legal_documents.sql for the hosted project; keep both lists equal.
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
