# Runbook: backup and restore

NFR-A2 (daily backups with point-in-time recovery, a nightly copy of uploaded documents to a second EU location, a restore drill before launch, RPO at most 2 minutes for the database and 24 hours for documents, RTO at most 4 hours), NFR-S4 (encryption at rest), NFR-C3 (audit archive); decisions O1, O2 and O5 of OPEN_QUESTIONS.md; unit U55 (D80). Owner: Platform and Operations (the named person is recorded with the first drill, O6). Production is the hosted project `fikxmfveggwjoqzgzuke` in Frankfurt (`eu-central-1`).

## 1. What is protected, and how

| Data | Where it lives | Protection | RPO | Restored by |
|---|---|---|---|---|
| Database: every schema, `auth` (users, password hashes, factors), `storage.objects` (file metadata only), `audit`, `billing`, `vault`, the pgmq queues and the pg_cron jobs | Supabase Postgres | Pro plan daily backups (kept 7 days) and the point-in-time recovery add-on (write-ahead log shipped at least every 2 minutes; retention 7 days, raise to 14 or 28 in the add-on settings) | 2 minutes | section 3 or 4 |
| Candidate documents (bucket `passport-documents`) | Supabase Storage (S3) | Not in the database backups. Nightly copy to a second EU location: target and budget open (O5), a launch requirement (release checklist P0-3) | 24 hours once O5 runs; until then none | section 6 |
| Monthly audit export | S3-compatible archive bucket outside the platform, Object Lock in compliance mode, versioning | Write-once objects, locked for `AUDIT_ARCHIVE_RETAIN_DAYS` (at least 2191 days) (`audit-log.md` section 5) | one month (the live table is in the database backups) | section 7 |
| Edge Function code, migrations, `config.toml`, email templates, the web application | Git (`main`) | The repository; every deployment is a tag of `main` | none | `deploy.md` |
| Edge Function secrets, web host secrets, Auth dashboard settings, Stripe and Resend settings | The platforms | Not backed up by Supabase. Each value is kept in the team password manager under the environment's name; the names are in `supabase/functions/.env.example`, `apps/web/.env.example` and `deploy.md` | none | `deploy.md` sections 3 to 6 |

Encryption at rest of the database, its backups and Storage is provided by the platform (AES-256); check it once a year on the Supabase security page and record it with the drill (NFR-S4 is a hosting review, not a test).

## 2. Schedule

| When | What | Who records it |
|---|---|---|
| Continuously | Write-ahead log shipping (point-in-time recovery) | the platform; check Database, Backups shows the recovery window daily for the first month |
| Daily | Database backup (platform) | the platform |
| Nightly, once O5 is decided | Copy of `passport-documents` to the second EU location (section 6) | the job's log; an alert when a night is missed |
| 1st of each month, 03:00 and 15:00 UTC | `audit-export-monthly` and its retry (pg_cron) | the archive manifest; the alert `audit_export_failed` |
| Before launch, then each quarter and after any change of plan, region or add-on | Restore drill (section 4 and 5) | the drill record (section 5) |
| Each quarter | Restore test of one archived audit month (`audit-log.md` section 5) | the audit review record |

## 3. Point-in-time recovery of the production project (in place)

Use it only when data was lost or corrupted and a forward fix cannot repair it (a bad migration is corrected by a new migration, `deploy.md` section 8). It rewinds the whole database, every table of every user, to the chosen second.

1. Decide the restore point with the incident lead: the last second before the damage (from `audit.log`, the database log or the migration time in `supabase_migrations.schema_migrations`). Write down the reason, the point and the person in the incident record.
2. Put the web host into maintenance (or scale it to zero), so that no write lands between the restore point and the end of the restore. Pause the minute jobs: `select cron.alter_job(jobid, active := false) from cron.job;` (they come back with the restore in the state of the restore point; step 5 turns them on again).
3. Supabase dashboard, project `fikxmfveggwjoqzgzuke`: Database, Backups, Point in time; choose the date and time (UTC) and confirm. The project is unavailable while it runs; the time grows with the size of the database and of the log to replay.
4. Storage objects are not rewound. Files uploaded after the restore point remain without a row and rows of files deleted after it remain without a file: run the two reconciliation queries of `platform-staff.md` section 3 and queue the removals there.
5. Verify (section 5, steps 2 to 4), then `select cron.alter_job(jobid, active := true) from cron.job;` and take the web host out of maintenance.
6. Tell the people affected: everything written after the restore point is gone (applications, uploads, stage changes, consents). Emails already sent are not recalled; `notify` may send again a message that was queued before the restore point and sent after it (its idempotency key is the notification id, which the restore brings back as unsent).

## 4. Restore to a new project (drill and disaster recovery)

The drill restores production into a new, separate project and leaves production untouched; a disaster that loses the production project uses the same steps and then points the web host at the new project.

1. Supabase dashboard, production project: Database, Backups, Restore to a new project; choose the latest point (drill) or the last good point (disaster). The new project is created in the same region with a new reference, new API keys and a new database password; note them in the password manager, never in a ticket or chat.
2. Run the count query of section 5 on production at the chosen point (drill: immediately before step 1, with the time written down).
3. What the copy does not carry, set up in the order of `deploy.md` on the new reference: Edge Functions (section 2), their secrets (section 3), the Vault secrets (section 4; `project_url` and `anon_key` change with the project, `edge_shared_secret` and `rate_limit_proof_key` are set again with the production values, then check `select name from vault.decrypted_secrets order by name` returns four names and no decryption error), the Auth settings (section 5) and the documents (section 6 of this runbook).
4. Drill: build the web application against the new project on a staging host (`deploy.md` section 6, with the new URL and publishable key; never the production domain). Disaster: change the production web host's environment to the new project, rebuild, and move the Stripe and Resend webhook URLs to the new function addresses (`deploy.md` section 3).
5. Verify (section 5). The RTO is the time from the decision in step 1 to the last check of section 5 passing; it must stay under 4 hours.
6. Drill: delete the new project after the record is complete (its database holds production personal data; it may not outlive the drill by more than a day).

Fallback when the dashboard offers no restore to a new project (for example on a plan without it), not yet drilled: a logical copy with the pinned CLI into a new empty project of the same Postgres major version (17). 41 triggers of the schema are `ENABLE ALWAYS` (audit rows, quotas, plan limits, date checks such as the expiry of a work authorisation), so they fire even with `session_replication_role = replica`: a plain load would write a second audit row for every document, vacancy and share, and refuse rows whose date has passed since they were written. They are switched off for the load and switched back on as `ALWAYS` after it, from a list taken before:

```sh
npx supabase db dump --db-url "$SOURCE_DATABASE_URL" --role-only -f roles.sql
npx supabase db dump --db-url "$SOURCE_DATABASE_URL" -f schema.sql
npx supabase db dump --db-url "$SOURCE_DATABASE_URL" --data-only --use-copy -f data.sql
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f roles.sql -f schema.sql
psql "$TARGET_DATABASE_URL" -Atc "select format('alter table %I.%I disable trigger %I;', n.nspname, c.relname, t.tgname)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where t.tgenabled = 'A' and not t.tgisinternal" > triggers-off.sql
sed 's/ disable trigger / enable always trigger /' triggers-off.sql > triggers-on.sql
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f triggers-off.sql \
  -c "set session_replication_role = replica" -f data.sql -f triggers-on.sql
```

Check afterwards that `select count(*) from pg_trigger where tgenabled = 'A' and not tgisinternal` is the same on both sides, then delete the five files: `data.sql` holds personal data.

## 5. Verify a restore

1. Counts. Run on the source at the restore point and on the restored project, and compare row by row; every figure must be equal, except rows created after the restore point on the source (compare `audit.log` with `where created_at <= '<restore point>'` when activity continued):

   ```sql
   select 'auth.users' as relation, count(*) from auth.users
   union all select 'public.profiles', count(*) from public.profiles
   union all select 'public.organizations', count(*) from public.organizations
   union all select 'public.jobs', count(*) from public.jobs
   union all select 'public.job_applications', count(*) from public.job_applications
   union all select 'public.worker_documents', count(*) from public.worker_documents
   union all select 'public.consents', count(*) from public.consents
   union all select 'public.legal_documents', count(*) from public.legal_documents
   union all select 'billing.subscriptions', count(*) from billing.subscriptions
   union all select 'audit.log', count(*) from audit.log
   union all select 'storage.objects', count(*) from storage.objects
   union all select 'supabase_migrations.schema_migrations', count(*) from supabase_migrations.schema_migrations
   union all select 'cron.job (active)', count(*) from cron.job where active
   order by relation;
   ```

   `schema_migrations` must equal the number of files in `supabase/migrations` of the deployed tag, and the active cron jobs the 15 jobs of the migrations (`select jobname from cron.job order by 1`).
2. Smoke login through Auth, with the drill account (a candidate account named `restore-drill` created before the first drill; its password is in the password manager): `curl -s -X POST "https://<ref>.supabase.co/auth/v1/token?grant_type=password" -H "apikey: <publishable key>" -H "content-type: application/json" -d '{"email":"<drill address>","password":"<drill password>"}'` returns an `access_token`; with it, `curl -s "https://<ref>.supabase.co/rest/v1/profiles?select=account_kind,status" -H "apikey: <publishable key>" -H "authorization: Bearer <access_token>"` returns exactly one row, `worker` and `active`.
3. Smoke login through the web application on the restored project: sign in as the drill account, open the passport, download one of its documents (a 60-second link and one new row in the access log, which shows that Storage and `document-url` work); sign in as a platform administrator with the authenticator code and open the audit search.
4. The security advisor of the restored project lists only the warnings expected in `security-checklist.md` item 11.
5. Record: date, person, source and target project, restore point, start and end time (RTO), the age of the restore point when the restore started (RPO), the count table of both sides, the result of steps 2 to 4, and every deviation. Keep the record with the release checklist; NFR-A2's "restore drill record" is this record.

## 6. Candidate documents (O5)

The database copy restores `storage.objects` (the metadata) but not the files. Until O5 names the target and the budget, there is no second copy and a lost bucket loses every document; this is release checklist item P0-3. The intended job, to be confirmed with O5: each night, an S3 sync from the Storage S3 endpoint of the project (Project Settings, Storage, S3 connection; a dedicated access key with read access only) to a bucket of a second EU region with versioning on, run by a scheduler outside the project; an alert when a night is missed; restore is the reverse sync of the prefix of the account or of the whole bucket into the restored project, after which the first reconciliation query of `platform-staff.md` section 3 lists no row.

## 7. Audit archive bucket

The monthly files of `audit.log` (`audit-log.md` section 5) live outside Supabase, so neither a point-in-time recovery nor a lost project touches them. A restore of the database to a point before an export leaves that month's file in the archive; the next scheduled run finds the objects there and changes nothing. The key the export uses may only put objects; reading the archive for a restore test uses a separate restore key kept by the owner of this runbook.
