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

`account-ops` reads the queue `account_ops` (jobs from `grant_platform_role`, `revoke_platform_role`, `reset_mfa`, `remove_member`) and ends sessions and deletes two-step factors. A job runs within a minute of being queued: the job `account-ops-run` (every minute) calls the function when a job is visible.

1. Function secret (never in the repository): `EDGE_SHARED_SECRET`, a random value of at least 32 characters, set with `npx supabase secrets set --env-file <uncommitted file>`. `SUPABASE_URL` and the service key are provided by the platform.
2. The same value, the project URL and the project's public (anon) key in Vault, as `postgres`:

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<anon key>', 'anon_key');
   select vault.create_secret('<EDGE_SHARED_SECRET value>', 'edge_shared_secret');
   ```

3. Deploy with `npx supabase functions deploy account-ops --use-api` (`verify_jwt = true` from `config.toml`: the platform checks the JWT, the function checks the shared secret itself).
4. Verify: queue a harmless job by granting and revoking a role for a test account, then within two minutes `select * from pgmq.q_account_ops` is empty, `audit.log` has `account_ops_done` rows, and `cron.job_run_details` for `account-ops-run` shows `succeeded`. If the Vault secrets are missing the minute job writes a warning to the database log and calls nothing.

Monitoring (weekly with the Supabase advisors): jobs that wait longer than five minutes, and jobs the database gave up on after five attempts.

```sql
select msg_id, read_ct, enqueued_at, message from pgmq.q_account_ops where enqueued_at < now() - interval '5 minutes';
select created_at, entity_id, metadata from audit.log where action = 'account_ops_abandoned' order by id desc limit 50;
```

An abandoned job is run again by queueing the same message: `select pgmq.send('account_ops', '<message json>'::jsonb);` (every job is idempotent).

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
