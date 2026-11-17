-- The report target contact_request (FR-S1, FR-Q3 AC11; docs/phase-2/DATA_MODEL.md sections 2 and 4). A new enum value
-- cannot be used in the transaction that adds it, so it has a migration of its own; 20270213100100_moderation_messages.sql
-- uses it.

alter type public.report_target_type add value 'contact_request';
