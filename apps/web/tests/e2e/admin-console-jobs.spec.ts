import type { Page } from "@playwright/test";
import { runAccountOps } from "./support/account-ops";
import { signInStaff, uniqueTag } from "./support/admin";
import { newApplicant, seedApplication } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, jobUrl, jobsUrl, newCompany, newJobUrl, previewUrl, seedJob } from "./support/jobs";
import { createCommittedUser, enrollTotp, expireAccessToken, sessionRows } from "./support/login";
import { logIn, SUSPENDED } from "./support/login-page";
import { messageCount, waitForMessage } from "./support/mailpit";
import { enterCode, factorRows, newOwner } from "./support/mfa";
import { runNotify } from "./support/notify";
import { organizationRows } from "./support/organizations";
import { membersPath } from "./support/team";
import { expect, test } from "./support/test";

// account-ops and notify take every job in their queues, so these tests run in a project of their own after the others
// (playwright.config.ts) and one after the other.
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const REASON = "Repeated fake profile reports";
const BACK = "Identity confirmed after complaint";

async function submit(page: Page, button: string, reason: string): Promise<void> {
  const field = page.getByLabel("Statement of reasons");
  await waitForHydration(field);
  await field.fill(reason);
  await page.getByRole("button", { name: button, exact: true }).click();
}

function auditRows(entityId: string) {
  return query<{ action: string; actor_id: string | null; metadata: Record<string, string> }>(
    `select action, actor_id, metadata from audit.log
     where entity_id = ${literal(entityId)} and (action like 'user.%' or action like 'mfa.%' or action like 'account_ops%') order by id`,
  );
}

function auditTable(page: Page) {
  return page.getByRole("table", { name: "Audit log, newest first" }).getByRole("row").filter({ has: page.getByRole("cell") });
}

async function findAudit(page: Page, entityId: string): Promise<void> {
  const field = page.getByLabel("Entity id");
  await waitForHydration(field);
  await field.fill(entityId);
  await field.press("Enter");
}

async function signedOutAtNextRefresh(page: Page, path: string): Promise<void> {
  await expireAccessToken(page.context());
  await page.goto(path);
  await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(path)}`);
}

function bannedUntil(userId: string): string | null {
  return query<{ banned_until: string | null }>(`select banned_until::text from auth.users where id = ${literal(userId)}`)[0].banned_until;
}

test.describe("the console with account-ops and notify running", () => {
  test("FR-F1 AC8: a suspended user is signed out and banned within a run of account-ops, is emailed the reason, and signs in again after the reinstatement", async ({
    page,
    browser,
  }) => {
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Suspension job", status: "open" });
    const user = await newApplicant();
    const application = seedApplication(user.id, jobId, company.id, { coverNote: "PRIVATE-COVER-NOTE" });
    const own = await browser.newContext();
    const ownPage = await own.newPage();
    await logIn(ownPage, user);
    await expect(ownPage).toHaveURL(/\/en\/dashboard\/worker$/);

    await signInStaff(page, "trust_safety", `/en/admin/users/${user.id}`);
    await submit(page, "Suspend user", REASON);
    await expect(page.getByText("The account is suspended", { exact: true })).toBeVisible();
    expect(sessionRows(user.id).length).toBeGreaterThan(0);

    await ownPage.goto("/en/passport");
    await expect(ownPage).toHaveURL(/\/en\/suspended$/);

    await runAccountOps();
    expect(sessionRows(user.id)).toEqual([]);
    expect(bannedUntil(user.id)).not.toBeNull();
    await signedOutAtNextRefresh(ownPage, "/en/passport");
    await logIn(ownPage, user);
    await expect(ownPage.getByText(SUSPENDED)).toBeVisible();
    await expect(ownPage).toHaveURL(/\/en\/login/);

    await runNotify();
    const mail = await waitForMessage(user.email, { subject: "Your CHARA account was suspended" });
    expect(mail.Text).toContain(REASON);
    expect(`${mail.Text}${mail.HTML}`).not.toMatch(/PRIVATE-COVER-NOTE|Suspension job|cv\.pdf/);
    expect(await messageCount(user.email)).toBe(1);
    expect(query<{ status: string }>(`select status::text from public.job_applications where id = ${literal(application)}`)).toEqual([{ status: "applied" }]);

    await submit(page, "Reinstate user", BACK);
    await expect(page.getByText("The account is reinstated", { exact: true })).toBeVisible();
    await runAccountOps();
    expect(bannedUntil(user.id)).toBeNull();
    await logIn(ownPage, user);
    await expect(ownPage).toHaveURL(/\/en\/dashboard\/worker$/);
    await runNotify();
    const back = await waitForMessage(user.email, { subject: "Your CHARA account was reinstated" });
    expect(back.Text).toContain(BACK);
    expect(await messageCount(user.email)).toBe(2);
    expect(query<{ status: string }>(`select status::text from public.job_applications where id = ${literal(application)}`)).toEqual([{ status: "applied" }]);
    await own.close();
  });

  test("FR-F1 AC9: the members of a suspended organisation are signed out and sign in again, and the owner and the administrator are emailed, the member is not", async ({
    page,
    browser,
  }) => {
    const company = await newCompany();
    const admin = await addCompanyUser(company, "admin");
    const member = await addCompanyUser(company, "member");
    const vacancy = seedJob(company, { title: "Suspended welder", status: "open" });
    const own = await browser.newContext();
    const memberPage = await own.newPage();
    await logIn(memberPage, member);
    await expect(memberPage).toHaveURL(/\/en\/dashboard\/employer$/);

    await signInStaff(page, "trust_safety", `/en/admin/organizations/${company.id}`);
    await submit(page, "Suspend organisation", REASON);
    await expect(page.getByText("The organisation is suspended", { exact: true })).toBeVisible();
    await runAccountOps();
    expect(sessionRows(member.id)).toEqual([]);
    expect(bannedUntil(member.id)).toBeNull();
    await signedOutAtNextRefresh(memberPage, `/en/org/${company.slug}`);
    await logIn(memberPage, member, `/en/org/${company.slug}`);
    await expect(memberPage.getByRole("heading", { name: "This organisation is suspended" })).toBeVisible();

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await logIn(adminPage, admin);
    await expect(adminPage).toHaveURL(/\/en\/dashboard\/employer$/);
    const pages = [
      { tab: memberPage, path: jobsUrl(company.slug) },
      { tab: memberPage, path: jobUrl(company.slug, vacancy) },
      { tab: memberPage, path: previewUrl(company.slug, vacancy) },
      { tab: memberPage, path: membersPath(company.slug) },
      { tab: adminPage, path: newJobUrl(company.slug) },
    ];
    for (const { tab, path } of pages) {
      await tab.goto(path);
      await expect(tab.getByRole("alert").filter({ hasText: "This organization is suspended, so its" })).toBeVisible();
      await expect(tab.getByText("Suspended welder")).toHaveCount(0);
      await expect(tab.getByText(company.owner.email)).toHaveCount(0);
      await expect(tab.getByRole("button", { name: /Create|Save|Invite/ })).toHaveCount(0);
    }
    await adminContext.close();

    await runNotify();
    for (const person of [company.owner, admin]) {
      const mail = await waitForMessage(person.email, { subject: "was suspended" });
      expect(mail.Text).toContain(REASON);
      expect(await messageCount(person.email)).toBe(1);
    }
    expect(await messageCount(member.email)).toBe(0);

    await submit(page, "Reinstate organisation", BACK);
    await expect(page.getByText("The organisation is reinstated", { exact: true })).toBeVisible();
    await runNotify();
    for (const person of [company.owner, admin]) {
      const mail = await waitForMessage(person.email, { subject: "was reinstated" });
      expect(mail.Text).toContain(BACK);
      expect(await messageCount(person.email)).toBe(2);
    }
    expect(await messageCount(member.email)).toBe(0);
    await memberPage.goto(`/en/org/${company.slug}`);
    await expect(memberPage.getByRole("heading", { name: "This organisation is suspended" })).toHaveCount(0);
    await own.close();
  });

  test("FR-F1 AC10: a reset from the form deletes the factors and signs the user out in both browsers, the user is emailed with no code and no secret, and signs in at aal1 and is sent to enrol again", async ({
    page,
    browser,
  }) => {
    const owner = await newOwner();
    const secret = await enrollTotp(owner);
    const own = await browser.newContext();
    const ownPage = await own.newPage();
    await logIn(ownPage, owner);
    await expect(ownPage).toHaveURL(/\/en\/dashboard\/employer$/);
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await logIn(otherPage, owner);
    await expect(otherPage).toHaveURL(/\/en\/dashboard\/employer$/);
    expect(factorRows(owner.id)).toHaveLength(1);
    expect(sessionRows(owner.id).length).toBeGreaterThanOrEqual(2);

    await signInStaff(page, "admin", `/en/admin/mfa-reset?user=${owner.id}`);
    await waitForHydration(page.getByLabel("User id"));
    await page.getByLabel("I have verified this person's identity").check();
    await page.getByLabel("Reason").fill("Lost the phone, identity checked");
    await page.getByRole("button", { name: "Reset two-step verification" }).click();
    await expect(page.getByText("The reset is queued. The person is signed out and told by email.", { exact: true })).toBeVisible();

    await runAccountOps();
    expect(factorRows(owner.id)).toEqual([]);
    expect(sessionRows(owner.id)).toEqual([]);
    await signedOutAtNextRefresh(ownPage, "/en/dashboard/employer");
    await signedOutAtNextRefresh(otherPage, "/en/dashboard/employer");
    await runNotify();
    const mail = await waitForMessage(owner.email, { subject: "Two-step verification was reset" });
    expect(`${mail.Text}${mail.HTML}`).not.toContain(secret);
    expect(mail.Text).not.toMatch(/\b\d{6}\b/);
    expect(await messageCount(owner.email)).toBe(1);

    await logIn(ownPage, owner);
    await expect(ownPage).toHaveURL(/\/en\/dashboard\/employer$/);
    const [organization] = organizationRows(owner.id);
    await ownPage.goto(membersPath(organization.slug));
    await expect(ownPage).toHaveURL(`/en/mfa?next=${encodeURIComponent(membersPath(organization.slug))}`);
    await expect(ownPage.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
    await own.close();
    await other.close();
  });

  test("FR-F1 AC12: a granted role signs the user out, the navigation appears after two-step verification, and a revoked role is refused at once", async ({
    page,
    browser,
  }) => {
    const person = await newOwner();
    const secret = await enrollTotp(person);
    await signInStaff(page, "admin", "/en/admin/staff");
    const own = await browser.newContext();
    const ownPage = await own.newPage();
    await logIn(ownPage, person);
    await expect(ownPage).toHaveURL(/\/en\/dashboard\/employer$/);

    const open = page.getByRole("button", { name: "Grant a role" });
    await waitForHydration(open);
    await open.click();
    const dialog = page.getByRole("dialog", { name: "Grant a platform role" });
    await dialog.getByLabel("Email address of the person").fill(person.email);
    await dialog.getByLabel("Role").selectOption("trust_safety");
    await dialog.getByLabel("Reason").fill("New hire of the support team, ticket 4812");
    await dialog.getByRole("button", { name: "Grant role" }).click();
    await expect(dialog).toBeHidden();
    await runAccountOps();
    await signedOutAtNextRefresh(ownPage, "/en/admin");

    await logIn(ownPage, person, "/en/admin");
    await expect(ownPage).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/admin")}`);
    await enterCode(ownPage, secret);
    await expect(ownPage).toHaveURL("/en/admin");
    await expect(ownPage.getByRole("navigation", { name: "Administration" }).getByRole("link")).toHaveCount(3);
    expect((await ownPage.goto("/en/admin/staff"))?.status()).toBe(404);

    await page.reload();
    const row = page.getByRole("table", { name: "Platform staff roles" }).getByRole("row", { name: new RegExp(person.email) });
    await row.getByRole("button", { name: /Revoke/ }).click();
    const revoke = page.getByRole("dialog", { name: "Revoke a platform role" });
    await revoke.getByLabel("Reason").fill("Left the support team, ticket 4813");
    await revoke.getByRole("button", { name: "Revoke role" }).click();
    await expect(revoke).toBeHidden();
    expect((await ownPage.goto("/en/admin"))?.status()).toBe(404);
    await runAccountOps();
    await signedOutAtNextRefresh(ownPage, "/en/admin");
    await own.close();
  });

  // The document is added to the ones a candidate has to accept for the length of the test and taken out again: a
  // required document that is published for good would ask every later test to accept it at sign-in.
  test("FR-F1 AC11: publishing a document that candidates must accept returns at once, and account-ops then queues one email for each active candidate, once", async ({
    page,
  }) => {
    const name = `e2e-accept-${uniqueTag()}`;
    const original = query<{ value: unknown }>(`select value from private.settings where key = 'required_consents'`)[0].value;
    const worker = await createCommittedUser("worker");
    execute(
      `update private.settings set value = jsonb_set(value, '{worker}', (value -> 'worker') || to_jsonb(${literal(name)}::text)) where key = 'required_consents'`,
    );
    try {
      await signInStaff(page, "admin", "/en/admin/legal");
      const slug = page.getByLabel("Document name");
      await waitForHydration(slug);
      await slug.fill(name);
      await page.getByLabel("Title").fill("Terms everyone accepts");
      await page.getByLabel("Text of the document").fill("The text of the terms.");
      await page.getByLabel("Change summary").fill("Adds retention periods for application data.");
      await page.getByRole("button", { name: "Publish new version" }).click();
      await expect(page.getByText(`Version 1 of ${name} is published`, { exact: true })).toBeVisible();

      const emails = () =>
        query<{ n: number }>(
          `select count(*)::int as n from public.notifications where kind = 'legal_version' and payload ->> 'document_slug' = ${literal(name)}`,
        )[0].n;
      const candidates = query<{ n: number }>(
        `select count(*)::int as n from public.profiles where account_kind = 'worker' and status = 'active' and deleted_at is null`,
      )[0].n;
      expect(emails()).toBe(0);
      expect(query(`select 1 from pgmq.q_account_ops where message ->> 'document_slug' = ${literal(name)}`)).toHaveLength(1);

      await runAccountOps();
      expect(candidates).toBeGreaterThan(0);
      expect(emails()).toBe(candidates);
      expect(
        query<{ payload: { version: number; change_summary: string } }>(
          `select payload from public.notifications where kind = 'legal_version' and user_id = ${literal(worker.id)} and payload ->> 'document_slug' = ${literal(name)}`,
        ),
      ).toEqual([{ payload: expect.objectContaining({ version: 1, change_summary: "Adds retention periods for application data." }) }]);
      expect(
        query<{ entity_type: string; emails: number }>(
          `select entity_type, (metadata ->> 'emails_queued')::int as emails from audit.log where action = 'account_ops_done' and entity_id = ${literal(`${name}:1`)}`,
        ),
      ).toEqual([{ entity_type: "legal_document", emails: candidates }]);

      execute(`select pgmq.send('account_ops', jsonb_build_object('action', 'fan_out_legal_version', 'document_slug', ${literal(name)}, 'version', 1))`);
      await runAccountOps();
      expect(emails()).toBe(candidates);
    } finally {
      execute(`update private.settings set value = ${literal(JSON.stringify(original))}::jsonb where key = 'required_consents'`);
    }
  });

  test("FR-F2 AC7: the audit search lists what account-ops did for a suspension and for a reset, against the request and the administrator, and a job delivered twice adds no row", async ({
    page,
    browser,
  }) => {
    const user = await newApplicant();
    const owner = await newOwner();
    await enrollTotp(owner);
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const trust = await signInStaff(page, "trust_safety", `/en/admin/users/${user.id}`);
    const admin = await signInStaff(adminPage, "admin", `/en/admin/mfa-reset?user=${owner.id}`);

    const field = page.getByLabel("Statement of reasons");
    await waitForHydration(field);
    await field.fill(REASON);
    const suspension = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes(`/admin/users/${user.id}`));
    await page.getByRole("button", { name: "Suspend user", exact: true }).click();
    const request = (await suspension).headers()["x-request-id"];
    await expect(page.getByText("The account is suspended", { exact: true })).toBeVisible();
    expect(request).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    await waitForHydration(adminPage.getByLabel("User id"));
    await adminPage.getByLabel("I have verified this person's identity").check();
    await adminPage.getByLabel("Reason").fill("Lost the phone, identity checked");
    const reset = adminPage.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/admin/mfa-reset"));
    await adminPage.getByRole("button", { name: "Reset two-step verification" }).click();
    const resetRequest = (await reset).headers()["x-request-id"];
    await expect(adminPage.getByText("The reset is queued. The person is signed out and told by email.", { exact: true })).toBeVisible();

    const suspendJob = query<{ msg_id: number; message: object }>(
      `select msg_id, message from pgmq.q_account_ops where message ->> 'user_id' = ${literal(user.id)}`,
    );
    expect(suspendJob).toHaveLength(1);
    expect(suspendJob[0].message).toMatchObject({ action: "suspend_user", actor_id: trust.user.id, request_id: request });
    expect(auditRows(user.id).map((row) => [row.action, row.actor_id, row.metadata.request_id])).toEqual([["user.suspend", trust.user.id, request]]);

    await runAccountOps();
    const jobId = String(suspendJob[0].msg_id);
    const steps = auditRows(user.id).slice(1);
    expect(steps.map((row) => row.action)).toEqual(["account_ops.sign_out_global", "account_ops.ban_user", "account_ops_done"]);
    for (const step of steps.slice(0, 2)) {
      expect(step.actor_id).toBe(trust.user.id);
      expect(step.metadata).toMatchObject({ request_id: request, job_id: jobId });
    }
    expect(auditRows(owner.id).map((row) => [row.action, row.actor_id, row.metadata.request_id])).toEqual([
      ["mfa.reset", admin.user.id, resetRequest],
      ["account_ops.sign_out_global", admin.user.id, resetRequest],
      ["account_ops.delete_factors", admin.user.id, resetRequest],
      ["account_ops_done", null, undefined],
    ]);
    expect(auditRows(owner.id)[2].metadata).toMatchObject({ factors_deleted: 1 });

    execute(
      `insert into pgmq.q_account_ops (msg_id, vt, message) overriding system value
       values (${suspendJob[0].msg_id}, now(), ${literal(JSON.stringify(suspendJob[0].message))}::jsonb)`,
    );
    expect(await runAccountOps()).toMatchObject({ processed: 1, failed: 0 });
    expect(auditRows(user.id).filter((row) => row.action.startsWith("account_ops.")).map((row) => row.action)).toEqual([
      "account_ops.sign_out_global",
      "account_ops.ban_user",
    ]);

    await adminPage.goto("/en/admin/audit");
    await findAudit(adminPage, user.id);
    const listed = auditTable(adminPage);
    await expect(listed.filter({ hasText: "user.suspend" })).toHaveCount(1);
    await expect(listed.filter({ hasText: "account_ops.sign_out_global" })).toHaveCount(1);
    await expect(listed.filter({ hasText: "account_ops.ban_user" })).toHaveCount(1);
    await expect(listed.filter({ hasText: `${request} (job ${jobId})` })).toHaveCount(2);
    await expect(listed.filter({ hasText: trust.user.id }).filter({ hasText: "account_ops.ban_user" })).toHaveCount(1);
    await expect(listed.filter({ hasText: "user.suspend" })).toContainText(request);
    await expect(listed.filter({ hasText: "user.suspend" })).toContainText(REASON);

    await findAudit(adminPage, owner.id);
    await expect(auditTable(adminPage).filter({ hasText: "account_ops.delete_factors" })).toHaveCount(1);
    await expect(auditTable(adminPage).filter({ hasText: `${resetRequest} (job ` })).toHaveCount(2);
    await adminContext.close();
  });
});
