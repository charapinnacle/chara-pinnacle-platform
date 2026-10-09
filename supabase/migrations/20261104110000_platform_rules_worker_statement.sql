-- FR-G6 AC8: the Platform Rules state that a worker never pays and where to report a request for a fee. This is a
-- DRAFT for legal counsel to review (OPEN_QUESTIONS.md L5): version 1 is the working text, and the version that counsel
-- approves is published through the administration console as the next version. The placeholder version 0 is not touched.

insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
values (
  'platform-rules',
  1,
  'DRAFT: Platform Rules',
  E'DRAFT for review by legal counsel. This text has not been approved and must not be relied on.\n\n'
  'Workers never pay. A worker never pays CHARA, an employer, a recruitment company, a staffing company or anyone else '
  'a fee, a deposit or any other payment for finding work, for applying for a vacancy or for using CHARA. CHARA does '
  'not offer a paid plan to workers.\n\n'
  'Reporting a request for a fee. If anyone asks you for money in connection with finding work, applying or using '
  'CHARA, do not pay. Report the request to the Trust & Safety Administrator of CHARA through the complaints and '
  'dispute process. CHARA reviews the report and may restrict the account of the person who made the request.',
  'Draft statement that workers never pay and where to report a fee request, pending approval by legal counsel.',
  now()
)
on conflict (slug, version) do nothing;
