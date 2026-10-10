import { DAILY_SUMMARY_TIME_TEXT } from "@/lib/validation/notifications";
import { breadcrumbs } from "./support/app-shell";
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
  test("FR-I3 AC9 (FR-D6 AC5): the candidate page has no switch for status emails and says they are always sent", async ({ context, page }) => {
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

  test("FR-I3 AC2 (FR-D6 AC5): an employer user chooses Immediately or Daily summary, and the choice is kept after a reload", async ({ context, page }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    await signInBrowser(context, member);

    await page.goto(SETTINGS);
    const immediately = page.getByRole("radio", { name: "Immediately" });
    const summary = page.getByRole("radio", { name: "Daily summary" });
    await expect(page.getByRole("radiogroup", { name: "Emails about new applications" })).toBeVisible();
    await expect(immediately).toBeChecked();
    await expect(summary).not.toBeChecked();
    await expect(page.getByText(DAILY_SUMMARY_TIME_TEXT)).toBeVisible();
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

  test("FR-I3 AC2: the choice is a labelled radio group with a description for each option, operated by keyboard alone, and is kept after a reload", async ({
    context,
    page,
  }) => {
    const company = await newCompany();
    await signInBrowser(context, company.owner);

    await page.goto(SETTINGS);
    const immediately = page.getByRole("radio", { name: "Immediately" });
    const summary = page.getByRole("radio", { name: "Daily summary" });
    await expect(page.getByRole("radiogroup", { name: "Emails about new applications" })).toBeVisible();
    await expect(immediately).toBeChecked();
    await expect(immediately).toHaveAccessibleDescription("One email for each new application, as it arrives.");
    await expect(summary).toHaveAccessibleDescription(
      `One email a day at ${DAILY_SUMMARY_TIME_TEXT}, only when there are new applications.`,
    );

    await waitForHydration(immediately);
    await breadcrumbs(page).getByRole("link", { name: "Dashboard" }).focus();
    await page.keyboard.press("Tab");
    await expect(immediately).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect(summary).toBeFocused();
    await expect(summary).toBeChecked();
    await expect(summary.locator("xpath=..")).not.toHaveCSS("box-shadow", "none");

    await page.keyboard.press("Enter");
    await expect(page.getByText("Notification settings saved", { exact: true })).toBeVisible();
    expect(digestOf(company.owner.id)).toBe(true);

    await page.reload();
    await expect(page.getByRole("radio", { name: "Daily summary" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Immediately" })).not.toBeChecked();
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

  test("FR-I3 AC13: a save that fails shows a toast, keeps the last saved choice and saves nothing; while it runs the button is busy", async ({
    context,
    page,
  }) => {
    const company = await newCompany();
    await signInBrowser(context, company.owner);
    await page.goto(SETTINGS);
    const summary = page.getByRole("radio", { name: "Daily summary" });
    await waitForHydration(summary);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${SETTINGS}`, async (route) => {
      if (!route.request().headers()["next-action"]) return route.continue();
      await held;
      return route.abort();
    });

    await summary.check();
    const save = page.getByRole("button", { name: "Save" });
    await save.click();
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute("aria-busy", "true");
    release();
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

  test("FR-I3 NFR-U2: the employer page fits a 360 px screen, with each radio on the row of its label and the description below", async ({
    context,
    page,
  }) => {
    const company = await newCompany();
    await page.setViewportSize({ width: 360, height: 800 });
    await signInBrowser(context, company.owner);
    await page.goto(SETTINGS);
    await expect(page.getByRole("radiogroup", { name: "Emails about new applications" })).toBeVisible();

    for (const [name, description] of [
      ["Immediately", "One email for each new application, as it arrives."],
      ["Daily summary", `One email a day at ${DAILY_SUMMARY_TIME_TEXT}, only when there are new applications.`],
    ]) {
      const card = page.getByRole("radio", { name, exact: true }).locator("xpath=..");
      const label = await card.locator("label").boundingBox();
      const indicator = await card.locator("span[aria-hidden]").last().boundingBox();
      const text = page.getByText(description, { exact: true });
      await expect(text).toBeVisible();
      const textBox = await text.boundingBox();
      expect(label && indicator && textBox).toBeTruthy();
      expect(indicator!.y).toBeGreaterThanOrEqual(label!.y - 1);
      expect(indicator!.y + indicator!.height).toBeLessThanOrEqual(label!.y + label!.height + 1);
      expect(indicator!.x).toBeGreaterThan(label!.x + label!.width - 1);
      expect(indicator!.y + indicator!.height).toBeLessThanOrEqual(textBox!.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
  });

  test("FR-I3 NFR-U2: the candidate page fits a 360 px screen", async ({ context, page }) => {
    const candidate = await createCommittedUser("worker");
    await page.setViewportSize({ width: 360, height: 800 });
    await signInBrowser(context, candidate);
    await page.goto(SETTINGS);
    await expect(page.getByText("Application status emails are always sent. They cannot be switched off.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
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
