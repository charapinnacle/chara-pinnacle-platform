# Runbook: platform staff and account-ops

FR-A7, design points D1 and D11 (OPEN_QUESTIONS.md), ADR-0003. Steps marked "once" are part of the first production deployment (ARCHITECTURE.md section 15.2, steps 5, 7 and 13); the review is quarterly.

## 1. Rules

- Every staff member is a named individual supplied by CHARA, with their own email address, who signs up through the normal sign-up, confirms the address and enrols two-step verification. There is no shared or generic administrator account.
- Only a Platform Administrator at two-step level (aal2) grants or revokes a role, for another person, with a reason of 10 to 500 characters (`grant_platform_role`, `revoke_platform_role`; the staff page of the administration console, unit U41, calls them). Nobody grants a role to themselves, and the last active administrator cannot be revoked.
- Every grant and revocation writes one `audit.log` row (`platform_role_granted`, `platform_role_revoked`) with grantor, grantee, role and reason, and queues a sign-out of the affected person, which `account-ops` carries out within two minutes.
- A person may hold several roles. The Verification Reviewer role has no screens in Phase 1.

## 2. Bootstrap the first administrator (once per environment)

No administrator exists on an empty database, so the first one is created by a ticketed insert run by the database owner (SQL editor of the project, as `postgres`). The insert is audited by the row trigger of `platform_staff`: the audit row has no actor and carries the text of `chara.audit_reason`, so the ticket is part of the record.

Preconditions: the named person has signed up, confirmed their email address and enrolled a TOTP factor; a ticket exists with the approval of CHARA.

```sql
begin;
select set_config('chara.audit_reason', 'Bootstrap of the first administrator, ticket <TICKET>', true);
insert into public.platform_staff (user_id, role)
select id, 'admin' from auth.users
where email = '<named address>' and email_confirmed_at is not null;
commit;
```

Check that exactly one row was inserted and audited:

```sql
select id, actor_id, entity_id, metadata, created_at
from audit.log where action = 'platform_role_granted' order by id desc limit 1;
```

Record the bootstrap here in the pull request that deploys it (this table is the record the release owner checks):

| Environment | Ticket | Date | Executed by | Administrator (named individual) |
|---|---|---|---|---|
| production | | | | |

CHARA names at least two administrators before go-live (OPEN_QUESTIONS.md, O6). The first one grants the others through the staff page, never by further inserts. If the console is not yet deployed, a further administrator is added by the same statement under a new ticket.

## 3. Set up account-ops (once per environment)

`account-ops` reads the queue `account_ops` (jobs from `grant_platform_role`, `revoke_platform_role`, `reset_mfa`, `remove_member`) and ends sessions and deletes two-step factors. A job runs within a minute of being queued: the job `account-ops-run` (every minute) calls the function when a job is visible. One call reads batches of up to 100 jobs and runs 5 at a time until the queue is empty or its time budget of 100 s is spent (the platform's wall clock is 150 s); what is left runs in the next minute's call, so the ceiling is what one call finishes in 100 s (measure it on the hosted project: with about 100 ms per job it is in the thousands). A job that fails is read again after 60 s, then after 60 s times the number of reads, and is given up after 8 reads, about half an hour of failures. The two-minute promise therefore holds when the first run succeeds or the first retry does; it is not guaranteed through a longer outage.

1. Function secret (never in the repository): `EDGE_SHARED_SECRET`, a random value of at least 32 characters, set with `npx supabase secrets set --env-file <uncommitted file>`. `SUPABASE_URL` and the service key are provided by the platform.
2. The same value, the project URL and the project's public (anon) key in Vault, as `postgres`:

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<anon key>', 'anon_key');
   select vault.create_secret('<EDGE_SHARED_SECRET value>', 'edge_shared_secret');
   ```

3. Deploy with `npx supabase functions deploy account-ops --use-api` (`verify_jwt = true` from `config.toml`). The platform's JWT check is not an identity check, because the scheduler sends the project's public anon key; the shared secret in `x-edge-secret`, which the function compares itself, is the authentication (D39). If a project disables the legacy JWT keys (or moves to `sb_publishable_` keys that are not JWTs), the gateway rejects the scheduler's call: set `verify_jwt = false` for `account-ops` in `config.toml`, redeploy, and keep the shared secret as the only gate.
4. Verify: queue a harmless job by granting and revoking a role for a test account, then within two minutes `select * from pgmq.q_account_ops` is empty, `audit.log` has `account_ops_done` rows, and `cron.job_run_details` for `account-ops-run` shows `succeeded`. Then call the function by hand with `curl -X POST https://<project-ref>.supabase.co/functions/v1/account-ops -H "Authorization: Bearer <anon key>"`: without `x-edge-secret` it answers 401 `unauthorized` from the function; with a wrong bearer token the gateway answers 401 before the function runs, and the legacy anon key is still accepted by the gateway (check this again after the project's signing keys change). While none of the three Vault secrets exists the minute job does nothing and logs nothing; with only some of them it writes a warning to the database log and calls nothing.
5. Rotate the shared secret (when a holder of database access leaves, and yearly): the call's headers sit in `net.http_request_queue`, which every database role can read while a request is pending, so treat the secret as rotatable. Set a new `EDGE_SHARED_SECRET` with `npx supabase secrets set`, then `select vault.update_secret((select id from vault.secrets where name = 'edge_shared_secret'), '<new value>');` in the same minute; a call in between answers 401 and runs again in the next minute.

Monitoring (daily; an administrator who ran a `reset_mfa`, `grant` or `revoke` also confirms the job's `account_ops_done` row, because the `mfa_reset` audit row records the request, not the result): jobs that wait longer than five minutes, and jobs the database gave up on after eight attempts. An `account_ops_abandoned` row means the action did not happen (the factor is still enrolled, the sessions are still open).

```sql
select msg_id, read_ct, enqueued_at, message from pgmq.q_account_ops where enqueued_at < now() - interval '5 minutes';
select created_at, entity_id, metadata from audit.log where action = 'account_ops_abandoned' order by id desc limit 50;
```

An abandoned job is run again by queueing a message with the action and user id from the audit row: `select pgmq.send('account_ops', jsonb_build_object('action', '<action>', 'user_id', '<entity_id>', 'reason', 'requeue, ticket <TICKET>'));` (every job is idempotent). The queue keeps no archive of finished jobs, so `audit.log` (`account_ops_done`, `account_ops_abandoned`) is the whole record.

### scan-document (candidate documents)

`scan-document` (`verify_jwt = false`, authenticated by the same `x-edge-secret`) checks the first bytes of every object that lands in the bucket `passport-documents`. It is called by a trigger on `storage.objects` through pg_net and uses the Vault secrets `project_url` and `edge_shared_secret` of section 3; deploy it with `npx supabase functions deploy scan-document --no-verify-jwt --use-api`. pg_net does not retry, so the job `scan-document-rescan` (every minute) announces the objects of rows that are still `pending` two minutes after their upload again, for one day, at most 100 per run; the function is idempotent. Monitoring (daily): `select id, created_at from public.worker_documents where scan_status = 'pending' and deleted_at is null and created_at < now() - interval '1 day'` lists uploads that never finished or whose scan kept failing; the candidate sees "Upload not finished" and can delete the row.

### document-url (candidate documents)

`document-url` (`verify_jwt = true`) is the only way a third party gets a link to a candidate document: it runs `document_access_grant` with the caller's own token and signs a 60-second, download-only link for the path the grant returns. It has no shared secret and no Vault entry; the platform provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Deploy it with `npx supabase functions deploy document-url --use-api`. Verify on each environment: a request without `Authorization` answers 401; a member of an organisation with a share, for a document in its scope, answers 200 with a `url` and one new `audit.document_access_log` row; the same member for a document outside the scope answers 403 with no `url` and no new row.

Quarterly privacy review (KPI "privacy incidents", target 0; FR-B3): the following lists every opening that fell outside its share at the time; it must return no row. Any row is a privacy incident to report to the Platform Administrator, and so is any complaint received through the complaints and dispute process.

```sql
select l.id, l.accessed_at, l.document_id, l.share_id
from audit.document_access_log l
join public.passport_shares s on s.id = l.share_id
where not s.scope ? l.document_id::text
   or l.accessed_at >= s.revoked_at
   or l.accessed_at >= s.expires_at
   or s.organization_id is distinct from l.organization_id
   or s.worker_user_id is distinct from l.worker_user_id;
```

## 4. Quarterly access review

Run by the Platform Administrator with the release owner. The list covers every active and revoked role, who granted it, the two-step status and the last sign-in; `dormant` flags an active role whose holder has not signed in for 90 days (or never, since the grant). Each dormant account is revoked or confirmed in the sign-off.

```sql
select s.id, u.email, p.display_name, s.role, s.granted_at, g.email as granted_by, s.revoked_at,
  u.last_sign_in_at,
  s.revoked_at is null and coalesce(u.last_sign_in_at, s.granted_at) < now() - interval '90 days' as dormant,
  exists (
    select 1 from auth.mfa_factors f
    where f.user_id = s.user_id and f.factor_type = 'totp' and f.status = 'verified'
  ) as two_step_enrolled
from public.platform_staff s
join auth.users u on u.id = s.user_id
left join public.profiles p on p.id = s.user_id
left join auth.users g on g.id = s.granted_by
order by s.revoked_at is not null, u.email, s.role;
```

KPI "staff with two-step verification" (target 100 %): the share of active rows with `two_step_enrolled`:

```sql
select count(*) filter (where e) * 100.0 / nullif(count(*), 0) as percent_enrolled
from (
  select exists (
    select 1 from auth.mfa_factors f
    where f.user_id = s.user_id and f.factor_type = 'totp' and f.status = 'verified'
  ) as e
  from public.platform_staff s where s.revoked_at is null
) t;
```

KPI "quarterly review completed on time": the sign-off below, dated within the quarter.

| Quarter | Reviewed on | Reviewer | Release owner | Dormant accounts and decision |
|---|---|---|---|---|
| | | | | |
