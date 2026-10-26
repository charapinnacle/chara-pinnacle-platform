# Runbook: account closure and erasure

FR-B6, design point D46 (OPEN_QUESTIONS.md). Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them and no staff role can read candidate rows through the application. The legal-hold statements need a ticket.

## 1. How an account is closed

1. The candidate asks on `/en/settings` (`request_account_deletion`): `profiles.deleted_at` is set, the audit row `account.deletion_requested` is written and the email `deletion_requested` is queued. Nothing else changes: the account stays active, the candidate can sign in and read their data, and organisations can no longer open their documents.
   The retention rule `inactive_worker_data` (730 days without a sign-in, a session refresh, an application or a stage change; D79) writes the same request for an inactive candidate, with `reason` `inactivity` in the audit row's metadata and without the email; the steps below are the same.
2. During the cooling-off period (setting `account_deletion_cooling_off_days`, 30) the candidate can cancel (`cancel_account_deletion`, audit row `account.deletion_cancelled`, no email).
3. The pg_cron job `queue-account-erasures` (daily, 02:30 UTC, `private.queue_account_erasures()`) takes every request whose period is over:
   - without a hold it queues one `erase_user` job in the pgmq queue `account_ops` (none while one waits);
   - with `profiles.legal_hold` it writes the audit row `account.erasure_paused` and queues the notification `erasure_paused` to the privacy contact, once per request; held accounts are selected apart, so they never take the places of the accounts that are due;
   - for an auth user that has no profile any more (an erasure that stopped after the database step) it queues the job again; `erase_user` then returns false and `account-ops` only purges the files and deletes the user.
4. `account-ops` (every minute while a job is visible) calls `erase_user`, which deletes the profile, documents and passport rows, replaces the user id by one random pseudonym in the audit log, consent ledger, document access log and shares, writes `account.erased` and queues the notification `deletion_completed`; it then removes the files under `passport-documents/{user_id}/` and any copy of the user's data under `dsar-exports/{user_id}/`, and the auth user. Every step is safe to repeat. The user's requests for a copy of their data (`public.data_export_requests`) go with the profile, and a build job still queued for them then builds nothing.

## 2. Settings

Both are rows of `private.settings`; until the administrator console exists a change is a migration or, for the privacy contact, a ticketed statement:

```sql
update private.settings set value = '"privacy@example.org"' where key = 'privacy_contact_email';
```

The privacy contact is empty until CHARA names the person (OPEN_QUESTIONS.md, L1). While it is empty a paused erasure is still audited, but nobody is told: check section 4 until it is set.

## 3. Legal hold

Set or clear it only with a ticket. The reason travels in the transaction and is audited by the trigger (`account.legal_hold_set`, `account.legal_hold_cleared`); a change without a reason is refused. An open dispute pauses the erasure in the same way: Phase 1 has no dispute table, so whoever learns of a dispute (a report, a complaint, a legal request) raises the hold by hand with the ticket of the dispute, and clears it when the dispute is closed:

```sql
begin;
select set_config('chara.audit_reason', 'Open dispute, ticket <TICKET>', true);
update public.profiles set legal_hold = true where id = '<user id>';
commit;
```

Clearing it is the same statement with `false`. The next daily run queues the erasure of a held account whose period is over. Reports and disputes are a later phase, so the hold is raised by hand when CHARA learns of a dispute or legal duty.

## 4. Monthly report (SOP step Report)

Requests, cancellations and completions per month, and how long a completed erasure took after the end of the cooling-off period. The audit rows keep their time after the pseudonymisation.

```sql
select
  date_trunc('month', created_at) as month,
  count(*) filter (where action = 'account.deletion_requested') as requests,
  count(*) filter (where action = 'account.deletion_requested' and metadata ->> 'reason' = 'inactivity') as of_them_for_inactivity,
  count(*) filter (where action = 'account.deletion_cancelled') as cancellations,
  count(*) filter (where action = 'account.erased') as completions,
  round(avg(extract(epoch from (
    (metadata ->> 'completed_at')::timestamptz - (metadata ->> 'requested_at')::timestamptz
  )) / 86400) filter (where action = 'account.erased'), 1) as average_days_request_to_completion
from audit.log
where action in ('account.deletion_requested', 'account.deletion_cancelled', 'account.erased')
group by 1 order by 1 desc;
```

Open requests, by age, and the paused ones:

```sql
select count(*) filter (where legal_hold) as on_hold,
       count(*) filter (where not legal_hold and deleted_at + make_interval(days => 30) > now()) as cooling_off,
       count(*) filter (where not legal_hold and deleted_at + make_interval(days => 30) <= now()) as due_not_yet_erased
from public.profiles where deleted_at is not null;
```

Replace `30` with the value of `account_deletion_cooling_off_days` if it was changed. `due_not_yet_erased` is normally 0 a minute after the daily run.

## 5. KPI: erasure within 30 days of the end of the cooling-off period (target 100 %)

An erasure counts as in time when it completed no later than 30 days after the period ended, that is within period plus 30 days of the request. Erasures of accounts that had a legal hold between the request and the completion are counted apart (`held`) and left out of the percentage: the hold, not the job, set their date. The query reads the period from the setting; it uses the current value for every month.

The time measured is that of the database step (`completed_at`). The files and the auth user follow within minutes, and a failure there is repaired by the daily job (section 6); the orphan check of section 7 shows what is still missing.

```sql
with erased as (
  select a.entity_id, a.created_at,
         (a.metadata ->> 'requested_at')::timestamptz as requested_at,
         (a.metadata ->> 'completed_at')::timestamptz as completed_at,
         exists (select 1 from audit.log h where h.action = 'account.legal_hold_set' and h.entity_id = a.entity_id) as held
  from audit.log a where a.action = 'account.erased'
)
select
  date_trunc('month', created_at) as month,
  count(*) as erasures,
  count(*) filter (where held) as held,
  round(100.0 * count(*) filter (where not held and completed_at <= requested_at
    + make_interval(days => 2 * (select (value #>> '{}')::integer from private.settings where key = 'account_deletion_cooling_off_days')))
    / nullif(count(*) filter (where not held), 0), 1) as in_time_percent
from erased group by 1 order by 1 desc;
```

The accounts that are late and not held, with the days of the setting (the second 30 is the time allowed after the period):

```sql
select id as user_id, deleted_at from public.profiles
where deleted_at is not null and not legal_hold
  and deleted_at + make_interval(days => 30 + (select (value #>> '{}')::integer from private.settings where key = 'account_deletion_cooling_off_days')) < now();
```

## 6. When an erasure fails

`erase_user` commits first (the profile is gone), then `account-ops` removes the files and the auth user. If Storage or Auth is down for longer than the 8 attempts (about half an hour), the database removes the job and writes `account_ops_abandoned` (it names nobody once the profile is gone, so the audit log never holds the old user id). The profile no longer exists, so the daily run finds the account as an auth user without a profile and queues the job again; `erase_user` then returns false and the job purges the files and deletes the user. A repair is therefore usually only to fix the cause (Storage, Auth) and wait for the next run, or to run `select private.queue_account_erasures();` after it. To look:

```sql
select created_at, entity_id, metadata from audit.log
where action = 'account_ops_abandoned' and metadata ->> 'action' = 'erase_user' order by id desc limit 20;
```

Causes seen in testing: the user holds a platform role (`erase_user` refuses with `platform_staff`: revoke the role first), a hold was set after the job was queued (refused with `legal_hold`), the Storage or Auth API was down. A candidate may ask for deletion at most `account_deletion_requests_per_day_max` times in 24 hours (5); beyond that the request is refused with `rate_limited`.

## 7. Quarterly review (SOP frequency)

Each query should return 0 rows:

```sql
-- files of an account that no longer exists
select o.name from storage.objects o
where o.bucket_id in ('passport-documents', 'dsar-exports') and not exists (select 1 from public.profiles p where p.id::text = split_part(o.name, '/', 1));

-- auth users without a profile (an erasure that stopped after the database step; the daily job queues them again, so a row that stays for more than a day needs a look at Auth)
select u.id from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);
```

Then read the list of paused accounts with the privacy contact (`on_hold` of section 4, with `account.legal_hold_set` rows for the reasons) and decide which holds can be cleared, and check that `privacy_contact_email` is set.

## 8. Copies of a user's data (FR-S3, GDPR Art. 15 and 20)

Behind its own switch `release_data_export` (settings editor, Releases; CHARA may turn it on before release 2a, it needs no legal document). A signed-in user asks on `/en/settings/data-export` (`request_data_export`, audit row `data_export.requested`), at most once per `data_export_interval_hours` (24, settings editor). `account-ops` builds the zip in `dsar-exports/{user_id}/{request_id}.zip` (audit rows `data_export.ready` and `account_ops_done` with `export_built`, `files_included`, `files_left_out`, `size_bytes`; only document files that passed their check go in, and README.txt says how many were left out) and the mandatory email `data_export_ready` leads to the page, where each download is audited as `data_export.downloaded`. The file is kept for the `data_exports` period (7 days, retention editor), then deleted by the retention job (`retention.run` row `data_exports`) through a `delete_object` job.

- Requests that did not finish (state "Could not be prepared" on the page; the job was abandoned and is a dead letter in `pgmq.a_account_ops`): `select id, user_id, requested_at from public.data_export_requests where status = 'queued' and requested_at < now() - interval '1 day';` The user can ask again at once; to retry the same request, queue the archived message again (`docs/runbooks/platform-staff.md` section 3, dead letters).
- Time to answer an access request (GDPR: one month): `select percentile_disc(0.95) within group (order by ready_at - requested_at) from public.data_export_requests where status = 'ready';`
- The export holds Phase 1 data and the Phase 2 tables built so far; submissions join with V58 and messages and contact requests with V74.
