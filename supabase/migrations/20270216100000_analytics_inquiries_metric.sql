-- The inquiries metric of company analytics (FR-R6, release 2c; docs/phase-2/DATA_MODEL.md section 7). A new enum value
-- cannot be used in the transaction that adds it, so it has a migration of its own; 20270216100100_analytics_inquiries.sql
-- counts it. It follows the profile views, as FR-R6 lists the metrics.

alter type public.analytics_metric add value 'inquiries' after 'profile_views';
