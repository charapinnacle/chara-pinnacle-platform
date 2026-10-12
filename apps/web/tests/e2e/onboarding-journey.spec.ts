import type { Page } from "@playwright/test";
import { accountRows, pendingConsents } from "./support/accounts";
import { accountButton, logOut, mainNavigation } from "./support/app-shell";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { choose } from "./support/combobox";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser, sessionClaims } from "./support/login";
import { logIn } from "./support/login-page";
import { beginSetup, enterCode, factorRows } from "./support/mfa";
import { onboardingSteps } from "./support/onboarding";
import { fillCompany, organizationAudit, organizationRows, registerOrganization, uniqueName } from "./support/organizations";
import { passportAudit, profileRows } from "./support/passport";
import { expect, test } from "./support/test";
import { createTestUser } from "./support/test-user";

// U68: the focused onboarding of both account kinds (FR-A2, FR-A4, FR-A6, FR-A8, FR-B1): the steps that are left and
// their states, resuming half-way, the country chosen from the browser, the welcome screen shown once, axe at 1280 and
// 360 px on every screen.

async function expectSteps(page: Page, states: readonly ("done" | "current" | "upcoming")[], labels: readonly string[]) {
  const items = onboardingSteps(page).getByRole("listitem");
  await expect(items).toHaveCount(labels.length);
  for (const [index, state] of states.entries()) {
    const item = items.nth(index);
    const text = `Step ${index + 1} of ${labels.length}: ${labels[index]}`;
    // A done step shows a check instead of its number, which is decoration (aria-hidden) but part of the text content.
    await expect(item).toHaveText(state === "done" ? `${text} (done)` : `${index + 1}${text}`);
    if (state === "current") await expect(item).toHaveAttribute("aria-current", "step");
    else await expect(item).not.toHaveAttribute("aria-current");
  }
  await expect(onboardingSteps(page).locator('[aria-current="step"]')).toHaveCount(1);
}

const COMPANY_STEPS = ["Company", "Security", "Ready"];
const WORKER_STEPS = ["Your profile", "Ready"];

async function expectFocusedLayout(page: Page) {
  await expect(page.getByRole("link", { name: /CHARA/ }).first()).toHaveAttribute("href", "/en");
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(mainNavigation(page)).toHaveCount(0);
  await expect(accountButton(page)).toHaveCount(0);
}

test.describe("onboarding journey (U68)", () => {
  test("an employer goes Company, Security, Ready with honest step states, two-step verification before billing, and a welcome", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const user = await createTestUser("company", await pendingConsents("company"));
    const display = uniqueName("Journey Bau");
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/onboarding$/);

    await expect(page.getByRole("heading", { name: "Tell us about your company", level: 1 })).toBeVisible();
    await expectSteps(page, ["current", "upcoming", "upcoming"], COMPANY_STEPS);
    await expectFocusedLayout(page);
    expect(accountRows(user.id).account.account_kind).toBe("company");
    expect(accountRows(user.id).audit.filter((row) => row.action === "account_kind_set")).toHaveLength(1);
    await expect(page.getByRole("group", { name: "Company" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Registration" })).toContainText(
      "We use it to give each company one free trial. 4 to 32 letters and digits, for example DE123456789 (VAT) or HRB12345 (company register)",
    );
    await expect(page.getByRole("main").locator('button[type="submit"]')).toHaveText(["Continue"]);
    await expectAccessibleAtBothWidths(page);

    await page.setViewportSize({ width: 1280, height: 900 });
    await fillCompany(page, { legalName: `${display} GmbH`, displayName: display, country: "Germany", industry: "Construction" });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/en\/onboarding\/security$/);
    const [organization] = organizationRows(user.id);
    expect(organization).toMatchObject({ role: "owner", display_name: display, based_in_country: "DE" });
    expect(organizationAudit(organization.id).map((row) => row.action)).toContain("organization_created");

    await expect(page.getByRole("heading", { name: "Secure your account", level: 1 })).toBeVisible();
    await expect(
      page.getByText(
        "As the owner you can see applicants' documents and your company's billing, so CHARA asks for a code from an authenticator app before you open them.",
      ),
    ).toBeVisible();
    await expectSteps(page, ["done", "current", "upcoming"], COMPANY_STEPS);
    await expectFocusedLayout(page);
    await expectAccessibleAtBothWidths(page);

    const billing = `/en/org/${organization.slug}/billing`;
    const team = `/en/org/${organization.slug}/members`;
    for (const guarded of [billing, team, `/en/org/${organization.slug}/applicants`]) {
      await page.goto(guarded);
      await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent(guarded)}`);
    }

    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(/\/en\/onboarding\/security$/);
    await page.setViewportSize({ width: 1280, height: 900 });
    const secret = await beginSetup(page);
    await expectAccessibleAtBothWidths(page);
    await enterCode(page, secret);

    await expect(page).toHaveURL(/\/en\/onboarding\/welcome$/);
    expect(factorRows(user.id)).toEqual([expect.objectContaining({ status: "verified", factor_type: "totp" })]);
    expect((await sessionClaims(page.context())).aal).toBe("aal2");
    await expect(page.getByRole("heading", { name: `Welcome to CHARA Pinnacle, ${display}`, level: 1 })).toBeVisible();
    await expectSteps(page, ["done", "done", "current"], COMPANY_STEPS);
    await expectFocusedLayout(page);
    const tiles = page.getByRole("main").getByRole("listitem").getByRole("link");
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(0)).toHaveAccessibleName(/^Post your first job/);
    await expect(tiles.nth(0)).toHaveAttribute("href", `/en/org/${organization.slug}/jobs/new`);
    await expect(tiles.nth(1)).toHaveAccessibleName(/^Invite your team/);
    await expect(tiles.nth(1)).toHaveAttribute("href", team);
    await expect(tiles.nth(2)).toHaveAccessibleName(/^Review your plan/);
    await expect(tiles.nth(2)).toHaveAttribute("href", billing);
    await expectAccessibleAtBothWidths(page);

    await tiles.nth(2).click();
    await expect(page).toHaveURL(billing);
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
  });

  test("a worker goes Your profile, Ready and is welcomed by the first name", async ({ page }) => {
    const user = await createTestUser("worker", await pendingConsents("worker"));
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Create your CHARA Passport", level: 1 })).toBeVisible();
    await expect(page.getByText("One profile for every application.")).toBeVisible();
    await expectSteps(page, ["current", "upcoming"], WORKER_STEPS);
    await expectFocusedLayout(page);
    await expectAccessibleAtBothWidths(page);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("First name", { exact: true }).fill("Amira");
    await page.getByLabel("Last name", { exact: true }).fill("Haddad");
    await choose(page, "Current country", "Germany");
    await page.getByRole("button", { name: "Create CHARA Passport" }).click();

    await expect(page).toHaveURL(/\/en\/onboarding\/welcome$/);
    expect(profileRows(user.id)).toEqual([expect.objectContaining({ first_name: "Amira", current_country: "DE", searchable: false })]);
    expect(passportAudit(user.id)).toHaveLength(1);
    await expect(page.getByRole("heading", { name: "Welcome to CHARA Pinnacle, Amira", level: 1 })).toBeVisible();
    await expectSteps(page, ["done", "current"], WORKER_STEPS);
    const tiles = page.getByRole("main").getByRole("listitem").getByRole("link");
    await expect(tiles).toHaveCount(3);
    for (const [index, [name, href]] of [
      ["Search jobs", "/en/jobs"],
      ["Complete your passport", "/en/passport"],
      ["Set availability", "/en/passport#experience"],
    ].entries()) {
      await expect(tiles.nth(index)).toHaveAccessibleName(new RegExp(`^${name}`));
      await expect(tiles.nth(index)).toHaveAttribute("href", href);
    }
    await expectAccessibleAtBothWidths(page);

    await tiles.nth(0).click();
    await expect(page).toHaveURL("/en/jobs");
  });

  test("the welcome screen is shown once: a reload, a direct visit and a later sign-in land on the dashboard", async ({ page }) => {
    const user = await createCommittedUser("worker", { passport: false });
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await page.getByLabel("First name", { exact: true }).fill("Lena");
    await page.getByLabel("Last name", { exact: true }).fill("Berg");
    await choose(page, "Current country", "Austria");
    const created = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/en/onboarding",
    );
    await page.getByRole("button", { name: "Create CHARA Passport" }).click();
    const welcomeCookie = (await (await created).headerValues("set-cookie")).find((value) => value.startsWith("chara_welcome="));
    expect(welcomeCookie).toMatch(new RegExp(`^chara_welcome=${user.id}; Path=/;`));
    expect(welcomeCookie).toContain("; Max-Age=600");
    expect(welcomeCookie).toContain("; HttpOnly");
    expect(welcomeCookie).toMatch(/; SameSite=lax/i);
    await expect(page).toHaveURL(/\/en\/onboarding\/welcome$/);
    await expect(page.getByRole("heading", { name: "Welcome to CHARA Pinnacle, Lena", level: 1 })).toBeVisible();

    // The first request after the welcome screen (here the prefetch of its tiles) takes the cookie away.
    const welcomeCookies = async () => (await page.context().cookies()).filter(({ name }) => name === "chara_welcome");
    await expect.poll(welcomeCookies).toEqual([]);
    await page.reload();
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    await page.goto("/en/onboarding/welcome");
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);

    await logOut(page);
    await expect(page).toHaveURL(/\/en\/login$/);
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    await page.goto("/en/onboarding/welcome");
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
  });

  test("a worker who left half-way is put back on the step by signing in; an owner is resumed at Security by /onboarding", async ({
    page,
    browser,
  }) => {
    const worker = await createCommittedUser("worker", { passport: false });
    await logIn(page, worker);
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expectSteps(page, ["current", "upcoming"], WORKER_STEPS);

    const owner = await createCommittedUser("company");
    await registerOrganization(owner, uniqueName("Halfway Bau GmbH"));
    const context = await browser.newContext();
    const ownerPage = await context.newPage();
    await logIn(ownerPage, owner);
    await expect(ownerPage).toHaveURL(/\/en\/dashboard\/employer$/);
    await ownerPage.goto("/en/onboarding");
    await expect(ownerPage).toHaveURL(/\/en\/onboarding\/security$/);
    await expectSteps(ownerPage, ["done", "current", "upcoming"], COMPANY_STEPS);
    await enterCode(ownerPage, await beginSetup(ownerPage));
    await expect(ownerPage).toHaveURL(/\/en\/onboarding\/welcome$/);
    await expectSteps(ownerPage, ["done", "done", "current"], COMPANY_STEPS);
    await context.close();
  });

  test("on a phone the steps say Step 1 of 3 and the primary button stays at the foot of the screen", async ({ page }) => {
    await logIn(page, await createCommittedUser("company"));
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto("/en/onboarding");
    const button = page.getByRole("button", { name: "Continue" });
    await waitForHydration(button);
    const position = () => button.evaluate((element) => getComputedStyle(element).position);
    const phoneLine = page.getByText("Step 1 of 3", { exact: true });

    await page.setViewportSize({ width: 375, height: 700 });
    await expect(phoneLine).toBeVisible();
    expect(await position()).toBe("sticky");
    const box = await button.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(700);
    expect(box!.y + box!.height).toBeGreaterThan(700 - 40);
    // Tabbing down the form never leaves the field in focus under the button (WCAG 2.4.11).
    await page.getByLabel("Legal company name").focus();
    for (let presses = 0; presses < 5; presses += 1) await page.keyboard.press("Tab");
    const identifier = page.getByRole("textbox", { name: /^Company registration number or VAT number/ });
    await expect(identifier).toBeFocused();
    const field = await identifier.boundingBox();
    const stuck = await button.boundingBox();
    expect(field!.y + field!.height).toBeLessThanOrEqual(stuck!.y);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(phoneLine).toBeHidden();
    expect(await position()).toBe("static");
  });

  test("on a phone the primary button of the passport and the security steps is sticky too and on screen", async ({ page, browser }) => {
    const expectStickyOnScreen = async (target: Page, name: string) => {
      const button = target.getByRole("button", { name });
      await waitForHydration(button);
      await target.setViewportSize({ width: 375, height: 700 });
      expect(await button.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
      const box = await button.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(700);
    };

    await logIn(page, await createCommittedUser("worker", { passport: false }));
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expectStickyOnScreen(page, "Create CHARA Passport");

    const owner = await createCommittedUser("company");
    await registerOrganization(owner, uniqueName("Phone Bau GmbH"));
    const context = await browser.newContext();
    const ownerPage = await context.newPage();
    await logIn(ownerPage, owner);
    await expect(ownerPage).toHaveURL(/\/en\/dashboard\/employer$/);
    await ownerPage.goto("/en/onboarding/security");
    await expectStickyOnScreen(ownerPage, "Show the QR code");
    await context.close();
  });
});

test.describe("the country of the company step", () => {
  test.use({ locale: "de-AT" });

  test("is chosen from the browser's region, and the whole list stays reachable by keyboard", async ({ page }) => {
    await logIn(page, await createCommittedUser("company"));
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto("/en/onboarding");
    const country = page.getByRole("combobox", { name: "Country", exact: true });
    await waitForHydration(country);
    await expect(country).toHaveValue("Austria");

    await country.focus();
    await page.keyboard.press("ArrowDown");
    const list = page.getByRole("listbox", { name: "Country" });
    await expect(list.getByRole("option")).toHaveCount(50);
    await expect(page.getByText(/^Showing 50 of 2\d\d\. Type to narrow the list\.$/)).toBeVisible();
    await expect(list.getByRole("option", { name: "Austria", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");

    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("switz");
    await expect(list.getByRole("option")).toHaveText(["Switzerland"]);
    await page.keyboard.press("ArrowDown");
    await expect(country).toHaveAttribute("aria-activedescendant", /.+/);
    await page.keyboard.press("Enter");
    await expect(country).toHaveValue("Switzerland");
    await expect(list).toBeHidden();
  });
});

test.describe("the country of the company step without a region", () => {
  test.use({ locale: "en" });

  test("is left for the person to choose", async ({ page }) => {
    await logIn(page, await createCommittedUser("company"));
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto("/en/onboarding");
    await expect(page.getByRole("combobox", { name: "Country", exact: true })).toHaveValue("");
  });
});
