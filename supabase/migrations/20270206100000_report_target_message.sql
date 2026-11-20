-- The report target message (FR-P3 AC6; docs/phase-2/DATA_MODEL.md sections 2 and 4). A new enum value cannot be used in
-- the transaction that adds it, so it has a migration of its own; 20270206100200_message_reports.sql uses it.

alter type public.report_target_type add value 'message';
