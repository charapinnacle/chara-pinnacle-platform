import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

const SETTINGS = "/en/settings/notifications";

function digestOf(userId: string): boolean | undefined {
  const [row] = query<{ digest: boolean }>(`select digest from public.notification_preferences where user_id = ${literal(userId)}`);
  return row?.digest;
}

function changes(userId: string): { metadata: { from: string; to: string } }[] {
  return query(
    `select metadata from audit.log where action = 'notification_preferences.changed' and actor_id = ${literal(userId)} order by id`,
  );
}

test.describe("notification settings", () => {
  test("FR-D6 AC5: the candidate page has no switch for status emails and says they are always sent", async ({ context, page }) => {
    const candidate = await createCommittedUser("worker");
    await signInBrowser(context, candidate);

    await page.goto(SETTINGS);
    await expect(page.getByRole("heading", { name: "Notification settings", level: 1 })).toBeVisible();
    await expect(page.getByText("Application status emails are always sent. They cannot be switched off.")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(page.getByText("Daily summary")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("FR-D6 AC5: an employer user chooses Immediately or Daily summary, and the choice is kept after a reload", async ({ context, page }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    await signInBrowser(context, member);

    await page.goto(SETTINGS);
    const immediately = page.getByRole("radio", { name: "Immediately" });
    const summary = page.getByRole("radio", { name: "Daily summary" });
    await expect(page.getByRole("radiogroup", { name: "Emails about new applications" })).toBeVisible();
    await expect(immediately).toBeChecked();
    await expect(summary).not.toBeChecked();
    await expect(page.getByText("08:00 Central European time")).toBeVisible();
    await expectNoAxeViolations(page);

    await waitForHydration(summary);
    await summary.check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Notification settings saved", { exact: true })).toBeVisible();
    expect(digestOf(member.id)).toBe(true);

    await page.reload();
    await expect(page.getByRole("radio", { name: "Daily summary" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Immediately" })).not.toBeChecked();
    await expectNoAxeViolations(page);

    await waitForHydration(page.getByRole("radio", { name: "Immediately" }));
    await page.getByRole("radio", { name: "Immediately" }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Notification settings saved", { exact: true })).toBeVisible();
    expect(digestOf(member.id)).toBe(false);
    expect(changes(member.id).map(({ metadata }) => `${metadata.from}>${metadata.to}`)).toEqual([
      "immediate>daily_summary",
      "daily_summary>immediate",
    ]);
    expect(digestOf(company.owner.id)).toBeUndefined();
  });

  test("FR-D6 AC5: a visitor goes to log in and the page of an employer is reached from the dashboard", async ({ context, page }) => {
    await page.goto(SETTINGS);
    await expect(page).toHaveURL(/\/en\/login\?next=%2Fen%2Fsettings%2Fnotifications$/);

    const company = await newCompany();
    await signInBrowser(context, await addCompanyUser(company, "member"));
    await page.goto(`/en/dashboard/employer?org=${company.slug}`);
    await page.getByRole("link", { name: "Notification settings" }).click();
    await expect(page).toHaveURL(SETTINGS);
    await expect(page.getByRole("radio", { name: "Immediately" })).toBeChecked();
  });

  test("FR-D6 AC5: a skeleton shows while the page loads", async ({ context, page }) => {
    const company = await newCompany();
    await signInBrowser(context, await addCompanyUser(company, "member"));
    let prefetched = false;
    page.on("request", (request) => {
      if (request.url().includes("/settings/notifications")) prefetched = true;
    });
    await page.goto(`/en/dashboard/employer?org=${company.slug}`);
    const link = page.getByRole("link", { name: "Notification settings" });
    await waitForHydration(link);
    // The loading screen of a route is fetched when its link comes into view; only then can it show at once.
    await link.scrollIntoViewIfNeeded();
    await expect.poll(() => prefetched).toBe(true);
    await page.route("**/en/settings/notifications*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await link.click();
    await expect(page.getByRole("status").getByText("Loading")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Immediately" })).toBeChecked();
    await expect(page.getByRole("status").getByText("Loading")).toHaveCount(0);
  });

  test("FR-D6 AC5: a save that fails shows a toast, keeps the last saved choice and saves nothing", async ({ context, page }) => {
    const company = await newCompany();
    await signInBrowser(context, company.owner);
    await page.goto(SETTINGS);
    const summary = page.getByRole("radio", { name: "Daily summary" });
    await waitForHydration(summary);
    await page.route(`**${SETTINGS}`, async (route) => {
      if (route.request().headers()["next-action"]) await route.abort();
      else await route.continue();
    });

    await summary.check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("The settings were not saved", { exact: true })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.", { exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Immediately" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(digestOf(company.owner.id)).toBeUndefined();

    await page.unroute(`**${SETTINGS}`);
    await summary.check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Notification settings saved", { exact: true })).toBeVisible();
    expect(digestOf(company.owner.id)).toBe(true);
  });

  test("FR-D6 AC12: a candidate who calls the function directly is refused and no row is written", async () => {
    const candidate = await createCommittedUser("worker");
    expect(() =>
      execute(
        `set role authenticated; select set_config('request.jwt.claims', '{"sub": "${candidate.id}", "role": "authenticated", "aal": "aal1"}', false);
         select public.set_notification_preferences(true)`,
      ),
    ).toThrow(/CHARA_FORBIDDEN/);
    expect(digestOf(candidate.id)).toBeUndefined();
  });
});
