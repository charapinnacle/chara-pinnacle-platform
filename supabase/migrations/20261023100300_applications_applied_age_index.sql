-- The KPI "applications left in Applied for more than 14 days" (FR-D2, docs/runbooks/application-status.md) filters on
-- status and the age of the application. Applications in Applied are the minority, so the index stays small and an
-- application leaves it with its first move.
create index job_applications_applied_created_idx on public.job_applications (created_at) where status = 'applied';
