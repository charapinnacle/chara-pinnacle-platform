import type { Page } from "@playwright/test";
import { runAccountOps } from "./support/account-ops";
import { signInStaff } from "./support/admin";
import { newApplicant, seedApplication } from "./support/applications";
import { literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { enrollTotp, expireAccessToken, sessionRows } from "./support/login";
import { logIn, SUSPENDED } from "./support/login-page";
import { messageCount, waitForMessage } from "./support/mailpit";
import { enterCode, factorRows, newOwner } from "./support/mfa";
import { runNotify } from "./support/notify";
import { signInAtAal2 } from "./support/team";
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

  test("FR-F1 AC10: a reset from the form deletes the factors and signs the user out, and the user is emailed with no code and no secret", async ({
    page,
    browser,
  }) => {
    const owner = await newOwner();
    const secret = await enrollTotp(owner);
    const own = await browser.newContext();
    const ownPage = await own.newPage();
    await logIn(ownPage, owner);
    await expect(ownPage).toHaveURL(/\/en\/dashboard\/employer$/);
    expect(factorRows(owner.id)).toHaveLength(1);

    await signInStaff(page, "admin", `/en/admin/mfa-reset?user=${owner.id}`);
    await waitForHydration(page.getByLabel("User id"));
    await page.getByLabel("I have verified this person's identity").check();
    await page.getByLabel("Reason").fill("Lost the phone, identity checked");
    await page.getByRole("button", { name: "Reset two-step verification" }).click();
    await expect(page.getByText("The reset is queued. The person is signed out and told by email.", { exact: true })).toBeVisible();

    await runAccountOps();
    expect(factorRows(owner.id)).toEqual([]);
    await signedOutAtNextRefresh(ownPage, "/en/dashboard/employer");
    await runNotify();
    const mail = await waitForMessage(owner.email, { subject: "Two-step verification was reset" });
    expect(`${mail.Text}${mail.HTML}`).not.toContain(secret);
    expect(mail.Text).not.toMatch(/\b\d{6}\b/);
    expect(await messageCount(owner.email)).toBe(1);
    await own.close();
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
});
