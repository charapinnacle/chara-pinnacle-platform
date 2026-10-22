import type { Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, expectNotFound, newCompany } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

const LIST = "/en/notifications";
const SETTINGS = "/en/settings/notifications";

function setRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_partner_directories'`);
}

// count notifications of one kind for the user, the oldest first, one minute apart; the first `read` of them are read.
function seed(userId: string, kind: string, count: number, read = 0): void {
  execute(
    `select pgmq.send('notifications', jsonb_build_object('kind', ${literal(kind)}, 'user_id', ${literal(userId)}, 'mandatory', true))
     from generate_series(1, ${count});
     update public.notifications n set created_at = now() - make_interval(mins => r.position::integer)
     from (select id, row_number() over (order by msg_id desc) as position from public.notifications where user_id = ${literal(userId)}) r
     where n.id = r.id;
     update public.notifications set read_at = now()
     where id in (select id from public.notifications where user_id = ${literal(userId)} order by created_at limit ${read});`,
  );
}

function unreadOf(userId: string): number {
  const [row] = query<{ count: number }>(
    `select count(*)::int as count from public.notifications where user_id = ${literal(userId)} and read_at is null`,
  );
  return row.count;
}

function emailKinds(userId: string): Record<string, boolean> | undefined {
  const [row] = query<{ email_kinds: Record<string, boolean> }>(
    `select email_kinds from public.notification_preferences where user_id = ${literal(userId)}`,
  );
  return row?.email_kinds;
}

const bell = (page: Page) => page.getByRole("banner").getByRole("link", { name: /^Notifications/ });

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// others (playwright.config.ts), and the tests run one after the other.
test.describe("in-app notifications (FR-T1)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setRelease(true));
  test.afterAll(() => setRelease(false));

  test("AC9: the bell shows 4 unread, the list shows the items newest first, opening one by keyboard and Mark all as read lower the count", async ({
    context,
    page,
  }) => {
    const company = await newCompany();
    seed(company.owner.id, "payment_failed", 6, 3);
    seed(company.owner.id, "mfa_reset", 1);
    expect(unreadOf(company.owner.id)).toBe(4);
    await signInBrowser(context, company.owner);

    await page.goto(`/en/dashboard/employer?org=${company.slug}`);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 4 unread");
    await expect(bell(page)).toHaveText("4");

    await waitForHydration(bell(page));
    await bell(page).click();
    await expect(page).toHaveURL(LIST);
    await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
    const items = page.getByRole("list", { name: "Notifications" }).getByRole("listitem");
    await expect(items).toHaveCount(7);
    await expect(items.first()).toContainText("Your two-step verification was reset");
    await expect(items.first()).toContainText("Security");
    await expect(items.first().locator("time")).toHaveText(/ago|just now/);
    await expect(items.nth(1)).toContainText("A payment for your subscription failed");
    await expect(page.getByText("Unread:", { exact: true })).toHaveCount(4);
    await expect(items.first().locator("p.font-semibold")).toHaveCount(1);
    await expect(items.last().locator("p.font-semibold")).toHaveCount(0);
    await expectNoAxeViolations(page);

    const first = items.first().getByRole("link", { name: "Your two-step verification was reset" });
    await waitForHydration(first);
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/mfa/);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 3 unread");
    expect(unreadOf(company.owner.id)).toBe(3);

    await page.goto(LIST);
    const markAll = page.getByRole("button", { name: "Mark all as read" });
    await waitForHydration(markAll);
    await markAll.click();
    await expect(page.getByText("All notifications marked as read", { exact: true })).toBeVisible();
    await expect(bell(page)).toHaveAccessibleName("Notifications");
    await expect(page.getByText("Unread:", { exact: true })).toHaveCount(0);
    expect(unreadOf(company.owner.id)).toBe(0);
    await expectNoAxeViolations(page);
  });

  test("AC9: without the Realtime channel the bell asks every minute, and shows a new notification without a reload", async ({ context, page }) => {
    const candidate = await createCommittedUser("worker");
    await signInBrowser(context, candidate);
    await page.clock.install();
    await page.goto("/en/dashboard/worker");
    await expect(bell(page)).toHaveAccessibleName("Notifications");
    await waitForHydration(bell(page));

    seed(candidate.id, "legal_version", 1);
    await page.clock.fastForward(30_000);
    await expect(bell(page)).toHaveAccessibleName("Notifications");
    await page.clock.fastForward(31_000);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
    await expect(bell(page)).toHaveText("1");
  });

  test("an account without notifications sees the empty state, and the list pages by 20", async ({ context, page }) => {
    const candidate = await createCommittedUser("worker");
    await signInBrowser(context, candidate);
    await page.goto(LIST);
    await expect(page.getByRole("heading", { name: "No notifications yet" })).toBeVisible();
    await expect(bell(page)).toHaveAccessibleName("Notifications");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    seed(candidate.id, "legal_version", 25);
    await page.goto(LIST);
    const items = page.getByRole("list", { name: "Notifications" }).getByRole("listitem");
    await expect(items).toHaveCount(20);
    await page.getByRole("link", { name: "Older notifications" }).click();
    await expect(items).toHaveCount(5);
    await expect(page.getByRole("link", { name: "Older notifications" })).toHaveCount(0);
    await page.getByRole("link", { name: "Back to the first page" }).click();
    await expect(items).toHaveCount(20);
  });

  test("AC12: an owner whose address bounced sees a banner and the items that were not emailed", async ({ context, page }) => {
    const company = await newCompany();
    execute(`insert into public.notification_preferences (user_id, email_undeliverable_at) values (${literal(company.owner.id)}, now())`);
    seed(company.owner.id, "vacancy_hidden", 1);
    await signInBrowser(context, company.owner);
    await page.goto(LIST);
    await expect(page.getByRole("status").filter({ hasText: "We could not deliver email to your address" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Notifications" }).getByRole("listitem")).toHaveCount(1);
    await expectAccessibleAtBothWidths(page);
  });

  test("a skeleton shows while the list loads", async ({ context, page }) => {
    const candidate = await createCommittedUser("worker");
    await signInBrowser(context, candidate);
    let prefetched = false;
    page.on("request", (request) => {
      if (request.url().includes("/en/notifications")) prefetched = true;
    });
    await page.goto("/en/dashboard/worker");
    const link = bell(page);
    await waitForHydration(link);
    // The loading screen of a route is fetched when its link comes into view; only then can it show at once.
    await expect.poll(() => prefetched).toBe(true);
    await page.route("**/en/notifications*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await link.click();
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No notifications yet" })).toBeVisible();
  });

  test("AC11: a company admin switches an optional email off by keyboard, mandatory kinds say Always sent, a failed save keeps the choice", async ({
    context,
    page,
  }) => {
    const company = await newCompany();
    const admin = await addCompanyUser(company, "admin");
    await signInBrowser(context, admin);
    await page.goto(SETTINGS);

    const section = page.locator("#email-notifications");
    const applications = section.getByRole("switch", { name: "New applications" });
    await expect(applications).toBeChecked();
    await expect(section.getByRole("switch")).toHaveCount(1);
    for (const label of ["Vacancy hidden by moderation", "Failed payments", "Team invitations", "New versions of legal documents"]) {
      const row = section.getByRole("listitem").filter({ hasText: label });
      await expect(row).toContainText("Always sent");
      await expect(row.getByRole("switch")).toHaveCount(0);
    }
    await expect(section.getByText("Application updates")).toHaveCount(0);
    await expectNoAxeViolations(page);

    await waitForHydration(applications);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${SETTINGS}`, async (route) => {
      if (!route.request().headers()["next-action"]) return route.continue();
      await held;
      return route.abort();
    });
    await applications.focus();
    await page.keyboard.press("Space");
    await expect(applications).not.toBeChecked();
    await page.keyboard.press("Tab");
    await expect(section.getByRole("button", { name: "Save email choices" })).toBeFocused();
    await page.keyboard.press("Enter");
    release();
    await expect(page.getByText("The email choices were not saved", { exact: true })).toBeVisible();
    await expect(applications).not.toBeChecked();
    expect(emailKinds(admin.id)).toBeUndefined();

    await page.unroute(`**${SETTINGS}`);
    await section.getByRole("button", { name: "Save email choices" }).click();
    await expect(page.getByText("Email choices saved", { exact: true })).toBeVisible();
    expect(emailKinds(admin.id)).toEqual({ application_received: false });

    await page.reload();
    await expect(page.locator("#email-notifications").getByRole("switch", { name: "New applications" })).not.toBeChecked();
    await expect(page.getByRole("radio", { name: "Immediately" })).toBeChecked();
  });

  test("a worker has no switch: every email of a worker is always sent", async ({ context, page }) => {
    const candidate = await createCommittedUser("worker");
    await signInBrowser(context, candidate);
    await page.goto(SETTINGS);
    const section = page.locator("#email-notifications");
    await expect(section.getByRole("listitem").filter({ hasText: "Application updates" })).toContainText("Always sent");
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save email choices" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
  });

  test("NFR-S8: the list shows only the user's own notifications", async ({ context, page }) => {
    const [mine, other] = [await createCommittedUser("worker"), await createCommittedUser("worker")];
    seed(mine.id, "legal_version", 2);
    seed(other.id, "mfa_reset", 3);
    await signInBrowser(context, mine);
    await page.goto(LIST);
    await expect(page.getByRole("list", { name: "Notifications" }).getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText("Your two-step verification was reset")).toHaveCount(0);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread");
  });

  test("the bell stays in the bar next to the menu on a 360 px screen", async ({ context, page }) => {
    const candidate = await createCommittedUser("worker");
    await page.setViewportSize({ width: 360, height: 800 });
    await signInBrowser(context, candidate);
    await page.goto("/en/dashboard/worker");
    await expect(bell(page)).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "Menu" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("release off: no bell, the page does not exist and the settings have no per-kind section", async ({ context, page }) => {
    setRelease(false);
    try {
      const company = await newCompany();
      await signInBrowser(context, company.owner);
      await page.goto(`/en/dashboard/employer?org=${company.slug}`);
      await expect(page.getByRole("banner").getByRole("button", { name: "Account" })).toBeVisible();
      await expect(bell(page)).toHaveCount(0);
      await expectNotFound(page, LIST);
      await page.goto(SETTINGS);
      await expect(page.getByRole("radio", { name: "Immediately" })).toBeVisible();
      await expect(page.locator("#email-notifications")).toHaveCount(0);
    } finally {
      setRelease(true);
    }
  });
});
