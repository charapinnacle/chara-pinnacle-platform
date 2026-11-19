-- The report target of a public partner profile (FR-S1, FR-K4 AC10; docs/phase-2/DATA_MODEL.md sections 2 and 4). A new
-- enum value cannot be used in the transaction that adds it, so it has a migration of its own; the next migration uses it.

alter type public.report_target_type add value 'partner_profile';
