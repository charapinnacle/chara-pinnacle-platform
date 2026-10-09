import { signInStaff, uniqueTag } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser } from "./support/login";
import { staffUser } from "./support/mfa";
import { expect, test } from "./support/test";

const REASON = "New hire of the support team, ticket 4812";

function roles(userId: string) {
  return query<{ role: string; revoked: boolean; granted_by: string | null }>(
    `select role::text, revoked_at is not null as revoked, granted_by from public.platform_staff where user_id = ${literal(userId)} order by id`,
  );
}

test.describe("the staff page, the legal documents, the statistics and the two-step reset", () => {
  test("FR-A7 AC10 and FR-F1 AC12: the staff list shows the columns, a role is granted with a reason and revoked with one, and refusals are named", async ({
    page,
  }) => {
    const admin = await signInStaff(page, "admin", "/en/admin/staff");
    const reviewer = await staffUser("trust_safety");
    const person = await createCommittedUser("company");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Staff", level: 1 })).toBeVisible();
    const table = page.getByRole("table", { name: "Platform staff roles" });
    await expect(table.getByRole("row", { name: new RegExp(reviewer.email) })).toContainText("Trust & Safety Administrator");
    await expect(table.getByRole("row", { name: new RegExp(admin.user.email) })).toContainText("Enrolled");
    await expect(table.getByRole("row", { name: new RegExp(reviewer.email) })).toContainText("Not enrolled");
    for (const column of ["Person", "Role", "Granted by", "Granted", "Revoked", "Two-step verification", "Last sign-in"]) {
      await expect(table.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
    }
    await expectNoAxeViolations(page);

    const open = page.getByRole("button", { name: "Grant a role" });
    await waitForHydration(open);
    await open.click();
    const dialog = page.getByRole("dialog", { name: "Grant a platform role" });
    await dialog.getByRole("button", { name: "Grant role" }).click();
    await expect(dialog.getByText("Choose a role").first()).toBeVisible();
    await dialog.getByLabel("Email address of the person").fill(admin.user.email);
    await dialog.getByLabel("Role").selectOption("trust_safety");
    await dialog.getByLabel("Reason").fill(REASON);
    await dialog.getByRole("button", { name: "Grant role" }).click();
    await expect(dialog.getByText("You cannot give a role to yourself").first()).toBeVisible();

    await dialog.getByLabel("Email address of the person").fill(`nobody-${uniqueTag()}@example.test`);
    await dialog.getByRole("button", { name: "Grant role" }).click();
    await expect(dialog.getByText("No account has this email address").first()).toBeVisible();

    await dialog.getByLabel("Email address of the person").fill(reviewer.email.toUpperCase());
    await dialog.getByRole("button", { name: "Grant role" }).click();
    await expect(dialog.getByText("This person already has this role").first()).toBeVisible();
    expect(roles(reviewer.id)).toHaveLength(1);

    await dialog.getByLabel("Email address of the person").fill(person.email);
    await dialog.getByLabel("Reason").fill("short");
    await dialog.getByRole("button", { name: "Grant role" }).click();
    await expect(dialog.getByText("Give a reason of at least 10 characters").first()).toBeVisible();
    await dialog.getByLabel("Reason").fill(REASON);
    await dialog.getByRole("button", { name: "Grant role" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("The role is granted. The person is signed out and signs in again.", { exact: true })).toBeVisible();
    expect(roles(person.id)).toEqual([{ role: "trust_safety", revoked: false, granted_by: admin.user.id }]);
    expect(query<{ metadata: { reason: string } }>(`select metadata from audit.log where action = 'platform_role.grant' and metadata ->> 'user_id' = ${literal(person.id)}`)[0].metadata.reason).toBe(REASON);
    expect(query<{ n: number }>(`select count(*)::int as n from pgmq.q_account_ops where message ->> 'user_id' = ${literal(person.id)}`)[0].n).toBe(1);
    await expect(table.getByRole("row", { name: new RegExp(person.email) })).toContainText(admin.user.email);

    await table.getByRole("row", { name: new RegExp(person.email) }).getByRole("button", { name: /Revoke/ }).click();
    const revoke = page.getByRole("dialog", { name: "Revoke a platform role" });
    await revoke.getByRole("button", { name: "Revoke role" }).click();
    await expect(revoke.getByText("Give a reason of at least 10 characters").first()).toBeVisible();
    await revoke.getByLabel("Reason").fill("Left the support team, ticket 4813");
    await revoke.getByRole("button", { name: "Revoke role" }).click();
    await expect(revoke).toBeHidden();
    expect(roles(person.id)).toEqual([{ role: "trust_safety", revoked: true, granted_by: admin.user.id }]);
    await expect(table.getByRole("row", { name: new RegExp(person.email) })).not.toContainText("Active");
    await expect(table.getByRole("row", { name: new RegExp(person.email) }).getByRole("button", { name: /Revoke/ })).toHaveCount(0);
  });

  test("FR-F1 AC12: the dialog is operated by keyboard and closes with Escape", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin/staff");
    const open = page.getByRole("button", { name: "Grant a role" });
    await waitForHydration(open);
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Grant a platform role" });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
  });

  test("FR-F1 AC11: a new version of a document is published from the form and the draft placeholder is listed first", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin/legal");
    const table = page.getByRole("table", { name: "Current versions of the legal documents" });
    await expect(table.getByRole("row", { name: /cookie-policy/ })).toContainText("0");
    await expectNoAxeViolations(page);
    const slug = page.getByLabel("Document name");
    await waitForHydration(slug);
    await page.getByRole("button", { name: "Publish new version" }).click();
    await expect(page.getByText("Enter a title of 3 to 200 characters").first()).toBeVisible();
    await expect(page.getByText("Enter the text of the document").first()).toBeVisible();
    await slug.fill("Bad_Slug");
    await page.getByLabel("Title").fill("Cookie policy");
    await page.getByLabel("Text of the document").fill("The text of the cookie policy.");
    await page.getByLabel("Change summary").fill("short");
    await page.getByRole("button", { name: "Publish new version" }).click();
    await expect(page.getByText("Describe the change in 10 to 1000 characters").first()).toBeVisible();
    await expect(page.getByText("Use lower-case letters, digits and single hyphens").first()).toBeVisible();

    const name = `e2e-${uniqueTag()}`;
    await slug.fill(name);
    await page.getByLabel("Change summary").fill("Adds retention periods for application data.");
    await page.getByRole("button", { name: "Publish new version" }).click();
    await expect(page.getByText(`Version 1 of ${name} is published`, { exact: true })).toBeVisible();
    expect(query(`select version from public.legal_documents where slug = ${literal(name)}`)).toEqual([{ version: 1 }]);
    expect(query<{ metadata: { reason: string } }>(`select metadata from audit.log where action = 'legal_document.publish' and entity_id = ${literal(`${name}:1`)}`)[0].metadata.reason).toBe(
      "Adds retention periods for application data.",
    );
    await expect(table.getByRole("row", { name: new RegExp(name) })).toContainText("1");
  });

  test("FR-F1 AC11: the same form submitted from a second tab publishes nothing more, and the person is told why", async ({ page }) => {
    const name = `e2e-${uniqueTag()}`;
    execute(
      `insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
       values (${literal(name)}, 1, 'Document for the tabs', 'The first text.', 'The first approved text.', now())`,
    );
    await signInStaff(page, "admin", `/en/admin/legal?slug=${name}`);
    const second = await page.context().newPage();
    await second.goto(`/en/admin/legal?slug=${name}`);
    for (const tab of [page, second]) {
      await waitForHydration(tab.getByLabel("Document name"));
      await expect(tab.getByLabel("Document name")).toHaveValue(name);
      await tab.getByLabel("Text of the document").fill("The second text.");
      await tab.getByLabel("Change summary").fill("Adds retention periods for application data.");
    }

    await page.getByRole("button", { name: "Publish new version" }).click();
    await expect(page.getByText(`Version 2 of ${name} is published`, { exact: true })).toBeVisible();
    await second.getByRole("button", { name: "Publish new version" }).click();
    await expect(second.getByText("This document has a different current version than the form showed.").first()).toBeVisible();
    expect(query(`select version from public.legal_documents where slug = ${literal(name)} order by version`)).toEqual([{ version: 1 }, { version: 2 }]);
    expect(query(`select 1 from audit.log where action = 'legal_document.publish' and entity_id like ${literal(`${name}:%`)}`)).toHaveLength(1);
    expect(query(`select 1 from pgmq.q_account_ops where message ->> 'document_slug' = ${literal(name)}`)).toHaveLength(1);
  });

  test("FR-F1: the statistics show eight stages for a range, name a wrong range and show no applicant", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin/statistics");
    const table = page.getByRole("table", { name: /Applications created from/ });
    await expect(table.getByRole("row")).toHaveCount(1 + 8 + 1);
    await expect(table).toContainText("Not selected");
    await expect(table).toContainText("All stages");
    await expectNoAxeViolations(page);

    await page.getByLabel("From").fill("2026-12-31");
    await page.getByLabel("To").fill("2026-01-01");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("The start date must not be after the end date");
    await page.goto("/en/admin/statistics?from=2024-01-01&to=2025-06-01");
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("Choose at most 366 days");
    await page.goto("/en/admin/statistics?from=2026-13-01&to=2026-13-02");
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("Enter a date as year-month-day");
  });

  test("FR-F1 AC10: the reset form refuses an unticked box, a short reason and a bad id, refuses the own account, and queues the reset and the email for another user", async ({
    page,
  }) => {
    const admin = await signInStaff(page, "admin", "/en/admin/mfa-reset");
    const target = await createCommittedUser("company");
    const userId = page.getByLabel("User id");
    await waitForHydration(userId);
    await expectNoAxeViolations(page);

    await userId.fill(target.id);
    await page.getByLabel("Reason").fill("123456789");
    await page.getByRole("button", { name: "Reset two-step verification" }).click();
    await expect(page.getByText("Confirm that you verified this person's identity").first()).toBeVisible();
    await expect(page.getByText("Give a reason of at least 10 characters").first()).toBeVisible();
    await userId.fill("not-an-id");
    await page.getByRole("button", { name: "Reset two-step verification" }).click();
    await expect(page.getByText("Enter a valid user id").first()).toBeVisible();
    await page.getByLabel("I have verified this person's identity").check();
    await page.getByLabel("Reason").fill("Lost the phone, identity checked");

    await userId.fill(admin.user.id);
    await page.getByRole("button", { name: "Reset two-step verification" }).click();
    await expect(page.getByRole("alert").getByText("You cannot reset your own two-step verification.")).toBeVisible();
    expect(query(`select 1 from pgmq.q_account_ops where message ->> 'user_id' = ${literal(admin.user.id)} and message ->> 'action' = 'reset_mfa'`)).toEqual([]);

    await userId.fill(`${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`);
    await page.getByRole("button", { name: "Reset two-step verification" }).click();
    await expect(page.getByText("No account has this user id").first()).toBeVisible();

    await userId.fill(target.id);
    await page.getByRole("button", { name: "Reset two-step verification" }).click();
    await expect(page.getByText("The reset is queued. The person is signed out and told by email.", { exact: true })).toBeVisible();
    expect(query<{ message: { action: string } }>(`select message from pgmq.q_account_ops where message ->> 'user_id' = ${literal(target.id)}`).map((row) => row.message.action)).toEqual(["reset_mfa"]);
    expect(query(`select 1 from public.notifications where user_id = ${literal(target.id)} and kind = 'mfa_reset'`)).toHaveLength(1);
    expect(query<{ metadata: { reason: string } }>(`select metadata from audit.log where action = 'mfa.reset' and entity_id = ${literal(target.id)}`)[0].metadata.reason).toBe("Lost the phone, identity checked");
    await expect(userId).toHaveValue("");
  });

  test("FR-F1: the reset form is prefilled from the user page of an administrator", async ({ page }) => {
    const target = await createCommittedUser("company");
    await signInStaff(page, "admin", `/en/admin/users/${target.id}`);
    await page.getByRole("link", { name: "Reset two-step verification of this user" }).click();
    await expect(page).toHaveURL(`/en/admin/mfa-reset?user=${target.id}`);
    await expect(page.getByLabel("User id")).toHaveValue(target.id);
  });

  test("FR-A7 AC10: a grant that fails shows an error toast and keeps the dialog and what was typed, and a retry then succeeds", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin/staff");
    const person = await createCommittedUser("company");
    const open = page.getByRole("button", { name: "Grant a role" });
    await waitForHydration(open);
    await open.click();
    const dialog = page.getByRole("dialog", { name: "Grant a platform role" });
    await dialog.getByLabel("Email address of the person").fill(person.email);
    await dialog.getByLabel("Role").selectOption("trust_safety");
    await dialog.getByLabel("Reason").fill(REASON);

    await page.route("**/en/admin/staff", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await dialog.getByRole("button", { name: "Grant role" }).click();
    await expect(page.getByText("The role was not granted", { exact: true })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.").first()).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Email address of the person")).toHaveValue(person.email);
    expect(roles(person.id)).toEqual([]);

    await page.unroute("**/en/admin/staff");
    await dialog.getByRole("button", { name: "Grant role" }).click();
    await expect(dialog).toBeHidden();
    expect(roles(person.id)).toHaveLength(1);
  });

  test("FR-A7 AC10: a revocation that fails shows an error toast and keeps the dialog, and the role stays active", async ({ page }) => {
    const person = await createCommittedUser("company");
    await signInStaff(page, "admin", "/en/admin/staff");
    execute(`insert into public.platform_staff (user_id, role) values (${literal(person.id)}, 'verification_reviewer')`);
    await page.reload();
    const row = page.getByRole("table", { name: "Platform staff roles" }).getByRole("row", { name: new RegExp(person.email) });
    const revokeButton = row.getByRole("button", { name: /Revoke/ });
    await waitForHydration(revokeButton);
    await revokeButton.click();
    const revoke = page.getByRole("dialog", { name: "Revoke a platform role" });
    await revoke.getByLabel("Reason").fill("Left the support team, ticket 4813");

    await page.route("**/en/admin/staff", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await revoke.getByRole("button", { name: "Revoke role" }).click();
    await expect(page.getByText("The role was not revoked", { exact: true })).toBeVisible();
    await expect(revoke).toBeVisible();
    expect(roles(person.id)).toEqual([{ role: "verification_reviewer", revoked: false, granted_by: null }]);
  });
});
