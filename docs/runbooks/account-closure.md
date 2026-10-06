# Runbook: account closure and erasure

FR-B6, design point D46 (OPEN_QUESTIONS.md). Queries are run by CHARA staff as the database owner (SQL editor of the project); no screen shows them and no staff role can read candidate rows through the application. The legal-hold statements need a ticket.

## 1. How an account is closed

1. The candidate asks on `/en/settings` (`request_account_deletion`): `profiles.deleted_at` is set, the audit row `account.deletion_requested` is written and the email `deletion_requested` is queued. Nothing else changes: the account stays active, the candidate can sign in and read their data, and organisations can no longer open their documents.
2. During the cooling-off period (setting `account_deletion_cooling_off_days`, 30) the candidate can cancel (`cancel_account_deletion`, audit row `account.deletion_cancelled`, no email).
3. The pg_cron job `queue-account-erasures` (daily, 02:30 UTC, `private.queue_account_erasures()`) takes every request whose period is over:
   - without a hold it queues one `erase_user` job in the pgmq queue `account_ops` (none while one waits);
   - with `profiles.legal_hold` it writes the audit row `account.erasure_paused` and queues the notification `erasure_paused` to the privacy contact, once per request.
4. `account-ops` (every minute while a job is visible) calls `erase_user`, which deletes the profile, documents and passport rows, replaces the user id by one random pseudonym in the audit log, consent ledger, document access log and shares, writes `account.erased` and queues the notification `deletion_completed`; it then removes the files under `passport-documents/{user_id}/` and the auth user. Every step is safe to repeat.

## 2. Settings

Both are rows of `private.settings`; until the administrator console exists a change is a migration or, for the privacy contact, a ticketed statement:

```sql
update private.settings set value = '"privacy@example.org"' where key = 'privacy_contact_email';
```

The privacy contact is empty until CHARA names the person (OPEN_QUESTIONS.md, L1). While it is empty a paused erasure is still audited, but nobody is told: check section 4 until it is set.

## 3. Legal hold

Set or clear it only with a ticket. The reason travels in the transaction and is audited by the trigger (`account.legal_hold_set`, `account.legal_hold_cleared`):

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

An erasure counts as in time when it completed no later than 30 days after the period ended, that is within period plus 30 days of the request. The list of the late ones is the second query. Accounts under a legal hold are not late.

```sql
select
  date_trunc('month', created_at) as month,
  count(*) as erasures,
  round(100.0 * count(*) filter (where (metadata ->> 'completed_at')::timestamptz
    <= (metadata ->> 'requested_at')::timestamptz + make_interval(days => 30 + 30)) / count(*), 1) as in_time_percent
from audit.log where action = 'account.erased' group by 1 order by 1 desc;
```

```sql
select id as user_id, deleted_at from public.profiles
where deleted_at is not null and not legal_hold and deleted_at + make_interval(days => 30 + 30) < now();
```

The first 30 is the cooling-off period (see the setting), the second the 30 days allowed.

## 6. When an erasure fails

`account-ops` leaves a job it could not finish in the queue; after 8 reads the database removes it and writes `account_ops_abandoned`. The next daily run queues the account again, so a repair is usually enough. To look:

```sql
select created_at, entity_id, metadata from audit.log
where action = 'account_ops_abandoned' and metadata ->> 'action' = 'erase_user' order by id desc limit 20;
```

Causes seen in testing: the user holds a platform role (`erase_user` refuses with `platform_staff`: revoke the role first), a hold was set after the job was queued (refused with `legal_hold`), the Storage or Auth API was down.

## 7. Quarterly review (SOP frequency)

Each query should return 0 rows:

```sql
-- files of an account that no longer exists
select o.name from storage.objects o
where o.bucket_id = 'passport-documents' and not exists (select 1 from public.profiles p where p.id::text = split_part(o.name, '/', 1));

-- auth users without a profile (a crash between the two steps, repaired by the next read of the job)
select u.id from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);
```

Then read the list of paused accounts with the privacy contact (`on_hold` of section 4, with `account.legal_hold_set` rows for the reasons) and decide which holds can be cleared, and check that `privacy_contact_email` is set.
