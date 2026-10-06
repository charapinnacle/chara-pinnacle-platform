import type { Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { backdateRequest, closureAudit, profileState, queuedNotifications } from "./support/closure";
import { createCommittedUser } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import { daysFromToday, signIn } from "./support/passport";
import { expect, test } from "./support/test";

const deleteButton = (page: Page) => page.getByRole("button", { name: "Delete account", exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Delete your account?" });

test.describe("candidate account closure: settings page", () => {
  test("FR-B6 AC1: the request shows the dates and Cancel deletion, queues one email without content, and the candidate stays signed in", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    await signIn(page, user);
    await page.getByRole("link", { name: "Account settings" }).click();
    await expect(page).toHaveURL(/\/en\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel deletion" })).toHaveCount(0);

    await deleteButton(page).click();
    await dialog(page).getByRole("button", { name: "Request deletion" }).click();
    const banner = page.getByRole("status").filter({ hasText: "Deletion requested on" });
    await expect(banner).toHaveText(
      `Deletion requested on ${daysFromToday(0)}. Your data will be erased on ${daysFromToday(30)}.`,
    );
    await expect(page.getByRole("button", { name: "Cancel deletion" })).toBeVisible();
    await expect(deleteButton(page)).toHaveCount(0);
    await expect(banner).toBeFocused();

    const state = profileState(user.id);
    expect(state.status).toBe("active");
    expect(state.deleted_at?.slice(0, 10)).toBe(daysFromToday(0));
    const mails = queuedNotifications("deletion_requested", user.id);
    expect(mails).toHaveLength(1);
    expect(Object.keys(mails[0]).sort()).toEqual(["erases_on", "kind", "mandatory", "user_id"]);
    expect(String(mails[0].erases_on).slice(0, 10)).toBe(daysFromToday(30));
    expect(closureAudit(user.id, "account.deletion_requested")).toBe(1);

    await page.reload();
    await expect(banner).toBeVisible();
    await page.goto("/en/passport");
    await expect(page.getByRole("heading", { name: "Your passport" })).toBeVisible();
  });

  test("FR-B6 AC5: Cancel deletion clears the request, writes one audit row and queues no email; a new request starts again", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    await signIn(page, user);
    await page.goto("/en/settings");
    await deleteButton(page).click();
    await dialog(page).getByRole("button", { name: "Request deletion" }).click();
    await page.getByRole("button", { name: "Cancel deletion" }).click();
    await expect(page.getByText("Deletion cancelled", { exact: true })).toBeVisible();
    await expect(deleteButton(page)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Deletion requested on" })).toHaveCount(0);

    expect(profileState(user.id).deleted_at).toBeNull();
    expect(closureAudit(user.id, "account.deletion_cancelled")).toBe(1);
    expect(queuedNotifications("deletion_requested", user.id)).toHaveLength(1);

    await deleteButton(page).click();
    await dialog(page).getByRole("button", { name: "Request deletion" }).click();
    await expect(page.getByRole("button", { name: "Cancel deletion" })).toBeVisible();
    expect(closureAudit(user.id, "account.deletion_requested")).toBe(2);
  });

  test("FR-B6 AC12: at 360 px the dialog explains the effect, traps focus, closes on Escape and gives the focus back; a failed request shows an error toast and changes nothing; axe finds no violation", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page, user);
    await page.goto("/en/settings");
    await expect(deleteButton(page)).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await expectNoAxeViolations(page);

    await deleteButton(page).click();
    await expect(dialog(page)).toContainText("Your profile and documents will be erased in 30 days.");
    await expect(dialog(page)).toContainText("Your applications stay for employers, without your name.");
    await expect(dialog(page).getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await expectNoAxeViolations(page);
    // The page behind a modal dialog is inert: the focus stays in the dialog or leaves the page, and never lands on the
    // controls behind it.
    for (let presses = 0; presses < 6; presses += 1) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => document.activeElement === document.body || document.activeElement?.closest("dialog") != null),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(deleteButton(page)).toBeFocused();

    await deleteButton(page).click();
    await page.route("**/en/settings", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return route.abort();
    });
    const confirm = dialog(page).getByRole("button", { name: "Request deletion" });
    await confirm.click();
    await expect(confirm).toBeDisabled();
    await expect(page.getByText("Could not request the deletion", { exact: true })).toBeVisible();
    await expect(deleteButton(page)).toBeVisible();
    expect(profileState(user.id).deleted_at).toBeNull();
    expect(queuedNotifications("deletion_requested", user.id)).toEqual([]);
    await page.unroute("**/en/settings");

    await deleteButton(page).click();
    await dialog(page).getByRole("button", { name: "Request deletion" }).click();
    const cancel = page.getByRole("button", { name: "Cancel deletion" });
    await expect(cancel).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await expectNoAxeViolations(page);
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("Tab");
    for (let presses = 0; presses < 12 && !(await cancel.evaluate((element) => element === document.activeElement)); presses += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(cancel).toBeFocused();
  });

  test("FR-B6 AC6: once the time to cancel is over the banner says so and offers no cancel", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await signIn(page, user);
    await page.goto("/en/settings");
    await deleteButton(page).click();
    await dialog(page).getByRole("button", { name: "Request deletion" }).click();
    await expect(page.getByRole("button", { name: "Cancel deletion" })).toBeVisible();

    backdateRequest(user.id, "31 days");
    await page.reload();
    await expect(page.getByRole("status")).toHaveText(
      `Deletion requested on ${daysFromToday(-31)}. Your data will be erased on ${daysFromToday(-1)}. The time to cancel is over and the erasure is in progress.`,
    );
    await expect(page.getByRole("button", { name: "Cancel deletion" })).toHaveCount(0);
  });

  test("FR-B6 AC4: an employer is sent to the own dashboard and a visitor to the login page", async ({ page }) => {
    await page.goto("/en/settings");
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent("/en/settings")}`);

    const employer = await createCommittedUser("company");
    await logIn(page, employer, "/en/settings");
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await expect(page.getByRole("button", { name: "Delete account" })).toHaveCount(0);
  });
});
