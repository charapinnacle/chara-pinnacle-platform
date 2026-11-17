-- The report targets of release 2b (FR-S1, FR-J3 AC7 and AC8; docs/phase-2/DATA_MODEL.md sections 2 and 4): a
-- requirement (job order), a partner response and a candidate submission. A new enum value cannot be used in the
-- transaction that adds it, so they have a migration of their own; the next migration uses them.

alter type public.report_target_type add value 'requirement';
alter type public.report_target_type add value 'partner_response';
alter type public.report_target_type add value 'candidate_submission';
