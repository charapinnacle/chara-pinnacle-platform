-- The job order metrics of company analytics (FR-R6, release 2b; docs/phase-2/DATA_MODEL.md section 7): invitations,
-- responses, selections, candidate submissions and hires. A new enum value cannot be used in the transaction that adds
-- it, so they have a migration of their own; 20270114100100_network_analytics.sql counts them.

alter type public.analytics_metric add value 'invitations';
alter type public.analytics_metric add value 'responses';
alter type public.analytics_metric add value 'selections';
alter type public.analytics_metric add value 'submissions';
alter type public.analytics_metric add value 'hires';
