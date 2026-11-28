-- The conversation context of an inquiry between two partner companies (decision 5.1 as extended, D91 in
-- docs/OPEN_QUESTIONS.md; DATA_MODEL.md section 5). A new enum value cannot be used in the transaction that adds it, so
-- it has a migration of its own; 20270303100100_partner_inquiries.sql opens it.

alter type public.conversation_context add value 'partner_inquiry';
