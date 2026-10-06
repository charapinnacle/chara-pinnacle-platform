import { runAccountOps } from "./support/account-ops";
import { callAs } from "./support/accounts";
import {
  auditRowsNaming,
  backdateRequest,
  erasureJobs,
  profileState,
  queuedNotifications,
  runErasureJob,
} from "./support/closure";
import { execute, literal, query } from "./support/db";
import { documentRows, objectNames, seedDocument } from "./support/documents";
import { createCommittedUser } from "./support/login";
import { alertText, logIn } from "./support/login-page";
import { signIn } from "./support/passport";
import { newVisitor } from "./support/team";
import { adminRequest, type TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// account-ops takes every job in the queue, so these tests run in their own project, one after the other
// (playwright.config.ts).
test.describe.configure({ mode: "serial" });

function count(sql: string): number {
  return query<{ n: number }>(`select count(*)::int as n from (${sql}) t`)[0].n;
}

const authUsers = (userId: string) => count(`select 1 from auth.users where id = ${literal(userId)}`);
const profiles = (userId: string) => count(`select 1 from public.profiles where id = ${literal(userId)}`);
const erasedRows = () => count(`select 1 from audit.log where action = 'account.erased'`);

async function candidateWithFiles(): Promise<TestUser> {
  const user = await createCommittedUser("worker");
  await seedDocument(user.id, { title: "CV" });
  await seedDocument(user.id, { title: "Certificate", type: "certificate" });
  return user;
}

test.describe("account erasure by account-ops", () => {
  test("FR-B6 AC10: a due account loses its files and its sign-in, another browser is sent to the login page and the address can be registered again", async ({
    page,
    browser,
  }) => {
    const user = await candidateWithFiles();
    await signIn(page, user);
    await page.goto("/en/settings");
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Request deletion" }).click();
    await expect(page.getByRole("button", { name: "Cancel deletion" })).toBeVisible();
    const second = await newVisitor(browser);
    await logIn(second.page, user);
    await expect(second.page).toHaveURL(/\/en\/dashboard\/worker$/);
    expect(objectNames(user.id)).toHaveLength(2);

    runErasureJob();
    expect(erasureJobs(user.id)).toBe(0);
    backdateRequest(user.id, "29 days 23 hours");
    runErasureJob();
    expect(erasureJobs(user.id)).toBe(0);
    backdateRequest(user.id, "31 days");
    runErasureJob();
    expect(erasureJobs(user.id)).toBe(1);
    expect(profiles(user.id)).toBe(1);
    await runAccountOps();

    expect(erasureJobs(user.id)).toBe(0);
    expect(objectNames(user.id)).toEqual([]);
    expect(documentRows(user.id)).toEqual([]);
    expect(authUsers(user.id)).toBe(0);
    expect(profiles(user.id)).toBe(0);
    expect(auditRowsNaming(user.id)).toBe(0);

    await logIn(page, user);
    await expect(alertText(page)).toBeVisible();
    await expect(page).toHaveURL(/\/en\/login/);

    await second.page.goto("/en/dashboard/worker");
    await expect(second.page).toHaveURL(`/en/login?next=${encodeURIComponent("/en/dashboard/worker")}`);
    await second.context.close();

    await adminRequest("/users", {
      method: "POST",
      body: JSON.stringify({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { intended_account_kind: "worker" },
      }),
    });
    const [fresh] = query<{ id: string }>(`select id from auth.users where email = ${literal(user.email)}`);
    expect(fresh.id).not.toBe(user.id);
    expect(profileState(fresh.id)).toEqual({ status: "active", deleted_at: null, legal_hold: false });
    expect(documentRows(fresh.id)).toEqual([]);
    expect(count(`select 1 from public.worker_profiles where user_id = ${literal(fresh.id)}`)).toBe(0);
  });

  test("FR-B6 AC11: the completion email is queued once with the address, a retry changes nothing and the archive keeps no address", async () => {
    const user = await candidateWithFiles();
    await callAs(user, "request_account_deletion");
    backdateRequest(user.id, "31 days");
    const before = erasedRows();

    runErasureJob();
    await runAccountOps();
    expect(erasedRows()).toBe(before + 1);
    const completed = () =>
      queuedNotifications("deletion_completed").filter((message) => message.email === user.email);
    expect(completed()).toEqual([{ kind: "deletion_completed", email: user.email, mandatory: true }]);

    runErasureJob();
    execute(
      `select pgmq.send('account_ops', jsonb_build_object('action', 'erase_user', 'user_id', ${literal(user.id)}))`,
    );
    const { processed, failed } = await runAccountOps();
    expect({ processed, failed }).toEqual({ processed: 1, failed: 0 });
    expect(erasedRows()).toBe(before + 1);
    expect(completed()).toHaveLength(1);
    expect(authUsers(user.id)).toBe(0);
    expect(
      count(`select 1 from pgmq.a_notifications where message ->> 'email' = ${literal(user.email)}`),
    ).toBe(0);
    expect(auditRowsNaming(user.id)).toBe(0);
  });

  test("FR-B6 AC7: a legal hold keeps the account whole, and clearing it lets the next run erase it", async () => {
    const user = await candidateWithFiles();
    await callAs(user, "request_account_deletion");
    backdateRequest(user.id, "31 days");
    execute(
      `begin; select set_config('chara.audit_reason', 'Test hold, ticket 1', true);
       update public.profiles set legal_hold = true where id = ${literal(user.id)}; commit;`,
    );

    runErasureJob();
    expect(erasureJobs(user.id)).toBe(0);
    await runAccountOps();
    expect(profiles(user.id)).toBe(1);
    expect(authUsers(user.id)).toBe(1);
    expect(objectNames(user.id)).toHaveLength(2);
    expect(count(`select 1 from audit.log where action = 'account.erasure_paused' and entity_id = ${literal(user.id)}`)).toBe(1);

    execute(
      `begin; select set_config('chara.audit_reason', 'Test hold, ticket 1', true);
       update public.profiles set legal_hold = false where id = ${literal(user.id)}; commit;`,
    );
    runErasureJob();
    await runAccountOps();
    expect(profiles(user.id)).toBe(0);
    expect(authUsers(user.id)).toBe(0);
    expect(objectNames(user.id)).toEqual([]);
  });
});
