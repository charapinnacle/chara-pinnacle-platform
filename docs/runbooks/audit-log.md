# Runbook: audited administrative actions

FR-F2, design point D67 (OPEN_QUESTIONS.md), ARCHITECTURE.md sections 8 and 12. The audit log is `audit.log`; the page to search it is `/[lang]/admin/audit` (Platform Administrator at aal2); the staff roles and account-ops are in `platform-staff.md`, the console in `admin-console.md`.

## 1. What is recorded

Every state-changing administrative function writes its audit row in the transaction of the change, so a change without its row cannot commit and a refused call leaves nothing. The reason is the statement of reasons of 10 to 2000 characters after trimming (the change summary of a legal document: 10 to 1000), refused with `CHARA_INVALID_INPUT` when missing, too short or too long. The request id is the `x-request-id` header the web tier sends (a UUID) or, when it is missing or not a UUID, one UUID generated for the transaction, so the rows of one call share it. `ip` is the leftmost `x-forwarded-for` entry the database sees, which the client controls: context, not evidence. The console client sends the address its own proxies wrote (`TRUSTED_PROXY_HOPS`, as for the visitor key) as that header, so the row of a console action names the administrator (an IPv6 address as its /64, like the visitor key); a deployment whose hop count is wrong stores a wrong address or none. Check it after the first deployment: do an action from a known address and read `ip` in the row.

| Function | Action | Entity type and id |
|---|---|---|
| `grant_platform_role`, `revoke_platform_role` | `platform_role.grant`, `platform_role.revoke` (written by the trigger of `platform_staff`, so the ticketed bootstrap insert of `platform-staff.md` is audited the same way, with no actor) | `platform_staff`, the person; the staff row is `metadata.staff_id` |
| `reset_mfa` | `mfa.reset` | `profile`, the person |
| `publish_legal_document` | `legal_document.publish` | `legal_document`, `slug:version` |
| `suspend_user`, `reinstate_user` | `user.suspend`, `user.reinstate` | `profile`, the person |
| `suspend_organization`, `reinstate_organization` | `organization.suspend`, `organization.reinstate`, and one `job.org_suspend` or `job.org_reinstate` per vacancy whose moderation state changed | `organization`, the organisation; `job`, the vacancy |
| `moderate_job` (FR-C7) | `job.hide`, `job.unhide` | `job` (arrives with U44; the guard below covers it from then on) |

Work done outside the database is recorded by `account-ops` through `audit_record_external` (service role only): the jobs an administrator queues carry `actor_id` and `request_id`, and each effect is a row with the actor, the request id and `job_id` (the queue message id): `account_ops.sign_out_global`, `account_ops.ban_user`, `account_ops.unban_user`, `account_ops.delete_factors`, `account_ops.sign_out_organization`, `account_ops.fan_out_legal_version`. A job read again after a crash adds no second row (unique on action and `job_id`). `audit_record_external` refuses the names the database writes for administrative acts (`user.`, `organization.`, `job.`, `mfa.`, `platform_role.`, `legal_document.`), so a service key cannot write a row that looks like one, and it refuses an `account_ops.` step without `job_id`. `reset_mfa` queues one job per person at a time: a second administrator who resets the same person while the job is still queued gets their own `mfa.reset` row (own request id) and no second job; the work (`account_ops.sign_out_global`, `account_ops.delete_factors`) is recorded under the request id of the first call. The older rows `account_ops_done` and `account_ops_abandoned` (system, no actor) stay: they say that the job finished or was given up and carry its counts.

Reads (search, detail pages, counts, the audit search) are not audited (team default; change it if the privacy contact wants lookups of personal data logged).

## 2. Who can do what to the log

Nobody updates, deletes or truncates it: the grants are revoked and the triggers `log_append_only` and `log_no_truncate` (ENABLE ALWAYS) refuse `postgres` and replica mode. Two narrow exceptions exist, both set by a function for its transaction only: `erase_user` replaces the id of an erased candidate by a pseudonym (FR-B6), and `private.apply_retention()` deletes rows past their period. Rows are added only by `audit.record` (the caller as actor) and `audit_record_external` (the actor the job carries); no API role can execute `audit.record` or `audit.record_as`. Only a Platform Administrator at aal2 reads, through `admin_search_audit` (columns id, actor, action, entity type, entity id, metadata, ip, time; 25 rows a page, newest first; the page shows the reason, the request id and the job id).

## 3. KPIs

- Administrative actions without an audit row (target 0): by construction (the pgTAP test 085 fails when a function gated on a platform role neither calls the audit function nor writes `platform_staff`, and the trigger of that table is ENABLE ALWAYS), and measured by reconciling the tables that hold the change with the log. Each query must return 0:

```sql
select count(*) from public.moderation_actions m
where not exists (
  select 1 from audit.log l
  where l.entity_id = m.target_id::text and l.entity_type = m.target_type
    and l.action = case m.action when 'account_suspended' then 'user.suspend' when 'account_reinstated' then 'user.reinstate'
      when 'organization_suspended' then 'organization.suspend' else 'organization.reinstate' end);

select count(*) from public.platform_staff s
where not exists (select 1 from audit.log l where l.action = 'platform_role.grant' and (l.metadata ->> 'staff_id')::bigint = s.id)
   or (s.revoked_at is not null
       and not exists (select 1 from audit.log l where l.action = 'platform_role.revoke' and (l.metadata ->> 'staff_id')::bigint = s.id));
```

  A role granted before the unit FR-F2 was deployed has the old row (`platform_role_granted`, entity the staff row); count those separately and expect them only on the first deployment. A legal document is reconciled by hand: every version published through the console has `legal_document.publish` with `slug:version` as the entity id.
- Actions with a reason recorded (100 %): the query returns 0. Rows without an actor are the bootstrap of an administrator (the ticket is the reason) and system rows.

```sql
select count(*) from audit.log
where action in ('platform_role.grant', 'platform_role.revoke', 'mfa.reset', 'legal_document.publish', 'user.suspend',
                 'user.reinstate', 'organization.suspend', 'organization.reinstate', 'job.org_suspend', 'job.org_reinstate',
                 'job.hide', 'job.unhide')
  and actor_id is not null
  and char_length(coalesce(metadata ->> 'reason', '')) < 10;
```

## 4. Retention

`private.retention_policies` holds the period of the entity `audit_log` in days: 2191 (six years, OPEN_QUESTIONS.md L6, to be confirmed by CHARA). It is configuration: `update private.retention_policies set days = 3650 where entity = 'audit_log';` in a forward migration (no API role can write the table, and `days >= 1` is a constraint). `private.apply_retention()` runs daily at 03:17 UTC (pg_cron `apply-retention`), deletes the rows older than the period and writes one `retention.run` row for the entity with `days` and `removed`. The delete uses `log_created_at_id_idx`. The lock of the archive (`AUDIT_ARCHIVE_RETAIN_DAYS`, section 5) must be at least this period: change the two together (the function refuses a lock under 2191 days, but it does not read this table). A period is never shortened without the privacy contact's written approval; the archive of section 5 keeps the older months in any case.

## 5. Monthly export to the archive

The pg_cron jobs `audit-export-monthly` (03:00 UTC on the first day of each month) and `audit-export-monthly-retry` (15:00 UTC the same day) call the Edge Function `audit-export`; the second call is the retry of a month that failed (it finds the objects there otherwise and changes nothing). The answer to the call is not used (the database waits 30 seconds, the function may need longer and carries on after the caller has gone): the alert of the function is the signal. Verify on the hosted project that a run longer than 30 seconds completes and that the alert rule fires. The calls go through `private.call_edge_function`, so nothing is called while the Vault secrets of `platform-staff.md` section 3 do not exist. The function reads the previous calendar month (UTC) through `audit_export_month` in pages of 1,000 rows, checks the number of rows against `audit_export_count`, and writes two objects to the archive, the file first and the manifest last (a month with a manifest is complete):

- `audit-log/<year>/<YYYY-MM>.ndjson`, one JSON object per row, in the order of time and id;
- `audit-log/<year>/<YYYY-MM>.manifest.json`: `{"month", "rows", "sha256", "file"}`, and `"resumed": true` when the file already existed at the time the manifest was written.

The file holds the actor, the entity and the metadata of every row as they are, and the address only of platform staff (past or present): the lock lasts six years and the erasure of FR-B6 cannot reach it, so the address of a candidate or an employer is left out. Their ids stay (the archive is the evidence of the administrative acts of the period); this is recorded in OPEN_QUESTIONS.md D67 for the privacy contact.

The archive is an S3-compatible bucket outside the platform (default: a second EU region, OPEN_QUESTIONS.md O5; target and budget are not decided) with Object Lock enabled and versioning on. Each object is put in compliance mode with a retention of `AUDIT_ARCHIVE_RETAIN_DAYS` (at least 2191), with `If-None-Match: *` (an existing key is never overwritten) and the SHA-256 checksum of the body, which the store verifies. The access key may put objects and may neither read nor delete them (a restore uses another key).

Setup, once per environment: create the bucket with Object Lock, versioning and a default retention of at least six years; create the key; `npx supabase secrets set` the names of `supabase/functions/.env.example` (`AUDIT_ARCHIVE_*`); `npx supabase functions deploy audit-export --use-api` (`verify_jwt = true`, the shared secret in `x-edge-secret` is the authentication); then run the first month by hand (below) and compare.

Failure: the function answers 500 and logs a JSON line with the key `alert` (`audit_export_failed` with the month and the status or code, `audit_export_count_mismatch`, or `audit_export_misconfigured` when an `AUDIT_ARCHIVE_*` setting is missing or the lock is under 2191 days); operations route that key to an alert, and the export is run again the same day (the second scheduled call, or by hand).

Resumed: the alert `audit_export_resumed` means the file was already in the archive when its manifest was written (a run that failed between the two objects). The manifest then describes the table as it is now, which differs from the file if a candidate was erased in between. Compare the `sha256` of the manifest with the checksum the store holds for the file (`x-amz-checksum-sha256`, shown by the store's console or by `head-object` with the restore key); if they differ, write down the incident and keep the file as the record of the month (the manifest is locked and cannot be replaced; write a note beside it with the SHA-256 of the file).

Run a month by hand (it is safe to repeat: an object that exists is kept, and a missing manifest is written):

```sh
curl -X POST https://<project-ref>.supabase.co/functions/v1/audit-export \
  -H "Authorization: Bearer <anon key>" -H "x-edge-secret: <shared secret>" -d '{"month":"2026-09"}'
```

Restore test (each quarter, with the review): download the file and the manifest of one month with the restore key, check `sha256sum` against the manifest, count the lines against the rows, and compare with `select count(*) from audit.log where created_at >= '<month>-01' and created_at < '<next month>-01'` while the month is inside the retention period. Rows of an erased candidate carry the pseudonym and no address in the table from the moment of the erasure; an export made before it keeps the id, the entity and the metadata as they were, without the address (see above and D67). Compare the rows of a month with the file only for the fields the file holds, and expect the ids of erased candidates to differ.

Limits: the month is one object built in memory (the pages and the file together, about twice its size). Measured with 513-byte rows: 50,000 rows make a 26 MB file and 156 MB of process memory, 200,000 rows a 103 MB file and 410 MB, over the 256 MB of an Edge Function. When a month approaches 50,000 rows, split the file by day (`audit-log/<year>/<YYYY-MM>/<DD>.ndjson`, one manifest listing the parts and their SHA-256) or stream a multipart upload before it does. The `rows` of each manifest show how the months grow. A transaction that started in the previous month and commits after the export (hours, not days) would be missing from the file; the count check is made at the time of the run, so the 03:00 start leaves that window closed in practice.

## 6. Quarterly sample review (operational)

At the end of each quarter the designated privacy contact (`private.settings` key `privacy_contact_email`; not named yet, L1) asks a Platform Administrator to open the audit search for the quarter, or to take the month files of the archive, and reviews a random sample of at least 25 administrative rows (all of them when there are fewer). For each row: the reason is present and plausible; the change exists (the `moderation_actions` row, the status, the role in `platform_staff`, the `legal_documents` version); and the actor held the right role on that day (`platform_staff.granted_at` and `revoked_at`). The result and every finding go into the review record (date, reviewer, rows seen, findings, incident numbers); a gap is raised as an incident. The SQL to draw the sample:

```sql
select id, actor_id, action, entity_type, entity_id, created_at, metadata ->> 'reason' as reason, metadata ->> 'request_id' as request_id
from audit.log
where created_at >= date_trunc('quarter', now()) - interval '3 months' and created_at < date_trunc('quarter', now())
  and action ~ '^(platform_role|mfa|legal_document|user|organization|job)\.(grant|revoke|reset|publish|suspend|reinstate|org_suspend|org_reinstate|hide|unhide)$'
order by random() limit 25;
```

## 7. Measured

EXPLAIN ANALYZE in a rolled-back transaction with 600,000 audit rows (nine months, six actions, 50,000 entities): the first page of the audit search 0.15 ms (backward scan of `log_created_at_id_idx`), a filter on the action 0.09 ms (`log_action_created_at_idx`, incremental sort), on the entity 0.05 ms (`log_entity_created_idx`), on a range of days 0.04 ms, a page of the export 0.4 ms (keyset on time and id in the same index), the count of a month of 80,000 rows 72 ms, the lookup of a job step 0.04 ms, and the retention delete of rows past the period 0.1 ms.

## 8. Not verified

The archive against a real bucket (the signature is checked against the published AWS example and the tests use a stub), the object lock and the key policy, the monthly job and the alert rule on the hosted project, and the first monthly run.
