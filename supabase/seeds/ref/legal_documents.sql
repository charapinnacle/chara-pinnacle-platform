-- Version 0 of every Phase 1 legal document is a DRAFT placeholder (OPEN_QUESTIONS.md L5, L7): the text is not
-- approved by legal counsel. The first approved text is published later as version 1 and becomes the current version.
-- sharing-notice is the text shown with the consent of an application: its version is stored with each consent to share (FR-D1).
-- age-18-plus holds the wording of the age attestation (FR-A9); its slug is the consent purpose.
-- Existing rows are never overwritten, so a text that was published afterwards is not touched by a re-seed.

insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
select
  d.slug,
  0,
  'DRAFT: ' || d.title,
  'DRAFT placeholder. This text has not been approved by legal counsel and must not be relied on.',
  'Draft placeholder pending approval by legal counsel.',
  now()
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
  ('imprint', 'Imprint'),
  ('sharing-notice', 'Sharing Notice')
) as d (slug, title)
on conflict (slug, version) do nothing;

insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
values (
  'age-18-plus',
  0,
  'DRAFT: Age confirmation',
  'I am 18 or older. (DRAFT wording, pending review by legal counsel.)',
  'Draft placeholder pending approval by legal counsel.',
  now()
)
on conflict (slug, version) do nothing;
