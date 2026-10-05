import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { choose } from "./support/combobox";
import { createCommittedUser } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import {
  childRows,
  daysFromToday,
  insertExpiredAuthorization,
  passportAudit,
  profileRows,
} from "./support/passport";
import { execute, literal } from "./support/db";
import { captureActionRequests } from "./support/server-action";
import type { TestUser } from "./support/test-user";

async function signIn(page: Page, user: TestUser): Promise<void> {
  await logIn(page, user);
  await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
}

function country(page: Page) {
  return page.getByRole("combobox", { name: "Current country", exact: true });
}

test.describe("candidate passport: onboarding", () => {
  test("FR-B1 AC1: a new candidate creates the passport once, lands on the dashboard at 10 percent and cannot onboard again", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker", { passport: false });
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Your account type is Worker" })).toBeVisible();
    await expectNoAxeViolations(page);

    const calls = captureActionRequests(page);
    await page.getByLabel("First name", { exact: true }).fill("Amina");
    await page.getByLabel("Last name", { exact: true }).fill("Okafor");
    await choose(page, "Current country", "Nigeria");
    await page.getByRole("button", { name: "Create my passport" }).dblclick();

    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    await expect(page.getByText("10% complete")).toBeVisible();
    await expect(page.getByText("Next:")).toContainText("Occupation");
    expect(calls).toHaveLength(1);

    expect(profileRows(user.id)).toEqual([
      expect.objectContaining({ first_name: "Amina", last_name: "Okafor", current_country: "NG", searchable: false }),
    ]);
    const [audit, ...rest] = passportAudit(user.id);
    expect(rest).toEqual([]);
    expect(audit).toEqual({ actor_id: user.id, entity_type: "worker_profiles", entity_id: user.id, metadata: {} });

    await page.goto("/en/passport");
    await expect(page.getByLabel("First name", { exact: true })).toHaveValue("Amina");
    await expect(page.getByLabel("Last name", { exact: true })).toHaveValue("Okafor");
    await expect(country(page)).toHaveValue("Nigeria");

    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
  });

  test("FR-B1 AC1: the form asks for the missing values and keeps what was typed", async ({ page }) => {
    const user = await createCommittedUser("worker", { passport: false });
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await page.getByLabel("Last name", { exact: true }).fill("Okafor1");
    await page.getByRole("button", { name: "Create my passport" }).click();

    await expect(page.getByLabel("First name", { exact: true })).toBeFocused();
    await expect(page.getByText("Enter your first name.")).toBeVisible();
    await expect(page.getByText("Last name can only contain letters")).toBeVisible();
    await expect(page.getByText("Choose a country.")).toBeVisible();
    await expect(page.getByLabel("Last name", { exact: true })).toHaveValue("Okafor1");
    expect(profileRows(user.id)).toEqual([]);
  });

  test("FR-B1: a candidate without a passport is sent to onboarding and an employer cannot open the passport", async ({
    page,
    browser,
  }) => {
    const candidate = await createCommittedUser("worker", { passport: false });
    await logIn(page, candidate, "/en/passport");
    await expect(page).toHaveURL(/\/en\/onboarding$/);

    const employer = await createCommittedUser("company");
    const context = await browser.newContext();
    const employerPage = await context.newPage();
    await logIn(employerPage, employer);
    await expect(employerPage).toHaveURL(/\/en\/dashboard\/employer$/);
    await employerPage.goto("/en/passport");
    await expect(employerPage).toHaveURL(/\/en\/dashboard\/employer$/);
    await context.close();

    const visitor = await browser.newContext();
    const visitorPage = await visitor.newPage();
    await visitorPage.goto("/en/passport");
    await expect(visitorPage).toHaveURL(`/en/login?next=${encodeURIComponent("/en/passport")}`);
    await visitor.close();
  });
});

test.describe("candidate passport: sections", () => {
  test("FR-B1 AC5: a candidate completes each section, the values persist and the meter follows", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await signIn(page, user);
    await page.goto("/en/passport");

    const occupation = page.getByRole("combobox", { name: "Occupation", exact: true });
    await occupation.fill("electrician");
    const electricians = page.getByRole("option", { name: /^7411 · Building and related electricians$/ });
    await expect(electricians).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Occupation" }).getByRole("option")).toHaveCount(2);
    await occupation.press("ArrowDown");
    await occupation.press("ArrowUp");
    await expect(electricians).toHaveAttribute("aria-selected", "true");
    await occupation.press("Enter");
    await page.getByRole("button", { name: "Save occupation" }).click();
    await expect(page.getByText("Your occupation was saved", { exact: true })).toBeVisible();
    expect(profileRows(user.id)[0].occupation_id).toBe("7411");

    const skills = page.getByRole("combobox", { name: "Skills", exact: true });
    await skills.fill("wel");
    for (let step = 0; step < 6; step += 1) {
      if ((await page.getByRole("option", { name: "Welding", exact: true }).getAttribute("aria-selected")) === "true") break;
      await skills.press("ArrowDown");
    }
    await skills.press("Enter");
    await expect(skills).toHaveValue("Welding");
    await page.getByRole("button", { name: "Add skill" }).click();
    await expect(page.getByText("Skill added", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Welding" })).toBeVisible();

    await choose(page, "Language", "English");
    await page.getByLabel("CEFR level", { exact: true }).selectOption("B2");
    await page.getByRole("button", { name: "Add language" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "English (B2)" })).toBeVisible();

    const from = daysFromToday(30);
    await page.getByLabel("Years of experience", { exact: true }).fill("6");
    await page.getByLabel("Availability", { exact: true }).selectOption({ label: "From a date" });
    await page.getByLabel("Available from", { exact: true }).fill(from);
    await page.getByRole("button", { name: "Save experience and availability" }).click();
    await expect(page.getByText("Your experience and availability were saved", { exact: true })).toBeVisible();

    await choose(page, "Preferred countries", "Germany");
    await page.getByRole("button", { name: "Add country" }).click();
    await expect(page.getByRole("button", { name: "Remove Germany" })).toBeVisible();

    const expiry = daysFromToday(365);
    await choose(page, "Country where you may work", "Germany");
    await page.getByLabel("Expiry date", { exact: true }).fill(expiry);
    await page.getByRole("button", { name: "Add work authorisation" }).click();
    await expect(page.getByRole("button", { name: "Remove work authorisation for Germany" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Occupation", exact: true })).toHaveValue(
      "7411 · Building and related electricians",
    );
    await expect(page.getByRole("button", { name: "Remove Welding" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "English (B2)" })).toBeVisible();
    await expect(page.getByLabel("Years of experience", { exact: true })).toHaveValue("6");
    await expect(page.getByLabel("Availability", { exact: true })).toHaveValue("from_date");
    await expect(page.getByLabel("Available from", { exact: true })).toHaveValue(from);
    await expect(page.getByRole("button", { name: "Remove Germany" })).toBeVisible();
    await expect(page.getByText(/\(until .+\)/)).toBeVisible();

    expect(profileRows(user.id)[0]).toMatchObject({
      occupation_id: "7411",
      years_experience: 6,
      availability: "from_date",
      available_from: from,
    });
    expect(childRows(user.id)).toEqual({
      skills: ["Welding"],
      languages: [{ language_code: "en", cefr_level: "B2" }],
      preferred: ["DE"],
      authorizations: [{ country_code: "DE", expires_on: expiry }],
    });

    await occupation.fill("xyzzy");
    await expect(page.getByRole("option", { name: "No matching occupation" })).toBeVisible();
    await page.getByRole("heading", { name: "Skills" }).click();
    await expect(occupation).toHaveValue("7411 · Building and related electricians");
    expect(profileRows(user.id)[0].occupation_id).toBe("7411");

    await page.goto("/en/dashboard/worker");
    await expect(page.getByText("65% complete")).toBeVisible();
    await expect(page.getByText("Next:")).toContainText("Skills");
  });

  test("FR-B1: a candidate removes an item and can add it again, and the same item twice is refused", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await signIn(page, user);
    await page.goto("/en/passport");

    const skills = page.getByRole("combobox", { name: "Skills", exact: true });
    await skills.fill("Pipe fitting");
    await page.getByRole("button", { name: "Add skill" }).click();
    await expect(page.getByRole("button", { name: "Remove Pipe fitting" })).toBeVisible();
    await skills.fill("pipe FITTING");
    await page.getByRole("button", { name: "Add skill" }).click();
    await expect(page.getByText("You have already added this skill.")).toBeVisible();
    expect(childRows(user.id).skills).toEqual(["Pipe fitting"]);
    await page.getByRole("button", { name: "Remove Pipe fitting" }).click();
    await expect(page.getByText("You have not added any skills yet")).toBeVisible();
    expect(childRows(user.id).skills).toEqual([]);

    await choose(page, "Preferred countries", "Germany");
    await page.getByRole("button", { name: "Add country" }).click();
    await expect(page.getByRole("button", { name: "Remove Germany" })).toBeVisible();
    await page.getByRole("combobox", { name: "Preferred countries", exact: true }).fill("Germany");
    await expect(page.getByRole("option", { name: "No match" })).toBeVisible();

    await choose(page, "Language", "French");
    await page.getByLabel("CEFR level", { exact: true }).selectOption("C1");
    await page.getByRole("button", { name: "Add language" }).click();
    await expect(page.getByText("Language added", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Language", exact: true })).toHaveValue("");
    expect(childRows(user.id).languages).toEqual([{ language_code: "fr", cefr_level: "C1" }]);
  });

  test("FR-B1: the work authorisation and the start date must lie in the allowed window", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await signIn(page, user);
    await page.goto("/en/passport");

    await choose(page, "Country where you may work", "Spain");
    await page.getByLabel("Expiry date", { exact: true }).fill(daysFromToday(-1));
    await page.getByRole("button", { name: "Add work authorisation" }).click();
    await expect(page.getByText("Choose today or a later date, up to 50 years ahead.")).toBeVisible();
    expect(childRows(user.id).authorizations).toEqual([]);

    await page.getByLabel("Availability", { exact: true }).selectOption({ label: "From a date" });
    await page.getByLabel("Available from", { exact: true }).fill(daysFromToday(900));
    await page.getByRole("button", { name: "Save experience and availability" }).click();
    await expect(page.getByText("Choose a date from today to 24 months ahead.")).toBeVisible();
    expect(profileRows(user.id)[0].availability).toBeNull();

    await page.getByLabel("Availability", { exact: true }).selectOption({ label: "Available now" });
    await expect(page.getByLabel("Available from", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Save experience and availability" }).click();
    await expect(page.getByText("Your experience and availability were saved", { exact: true })).toBeVisible();
    expect(profileRows(user.id)[0]).toMatchObject({ availability: "now", available_from: null });
  });

  test("FR-B1 AC12: labels, guidance, states and keyboard use at 360 px", async ({ page }) => {
    const user = await createCommittedUser("worker");
    insertExpiredAuthorization(user.id, "FR", daysFromToday(-10));
    await page.setViewportSize({ width: 360, height: 800 });
    await logIn(page, user);
    await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    await page.waitForLoadState("networkidle");

    await page.route(
      (url) => url.pathname === "/en/passport" && url.searchParams.has("_rsc"),
      async (route) => {
        if (!route.request().headers()["next-router-prefetch"]) await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      },
    );
    await page.getByRole("link", { name: "Open your passport" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your passport", level: 1 })).toBeVisible();

    for (const name of ["First name", "Last name", "Headline", "Years of experience"]) {
      await expect(page.getByRole("textbox", { name, exact: true }), name).toBeVisible();
    }
    for (const name of ["Current country", "Occupation", "Skills", "Language", "Preferred countries", "Country where you may work"]) {
      await expect(page.getByRole("combobox", { name, exact: true }), name).toBeVisible();
    }
    await expect(page.getByLabel("CEFR level", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Availability", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Expiry date", { exact: true })).toBeVisible();
    await page.getByLabel("Availability", { exact: true }).selectOption({ label: "From a date" });
    await expect(page.getByLabel("Available from", { exact: true })).toBeVisible();
    await page.getByLabel("Availability", { exact: true }).selectOption({ label: "Not available" });

    await expect(
      page.getByText("Do not enter ID numbers, date of birth, religion, health or other sensitive details."),
    ).toBeVisible();
    await expect(page.getByText("You have not added any skills yet")).toBeVisible();
    await expect(page.getByText("Expired")).toBeVisible();

    await page.getByLabel("First name", { exact: true }).focus();
    for (const name of ["Last name", "Headline"]) {
      await page.keyboard.press("Tab");
      await expect(page.getByRole("textbox", { name, exact: true }), name).toBeFocused();
    }
    await page.keyboard.press("Tab");
    await expect(page.getByRole("combobox", { name: "Current country", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Save details" })).toBeFocused();

    const first = page.getByLabel("First name", { exact: true });
    await first.fill("");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(first).toBeFocused();
    const message = page.getByText("Enter your first name.");
    await expect(message).toBeVisible();
    const describedBy = await first.getAttribute("aria-describedby");
    expect(describedBy).toContain((await message.getAttribute("id")) ?? "missing");
    await expect(first).toHaveAttribute("aria-invalid", "true");

    const skills = page.getByRole("combobox", { name: "Skills", exact: true });
    await skills.fill("wel");
    await skills.press("ArrowDown");
    await expect(page.getByRole("option", { name: "Arc welding" })).toHaveAttribute("aria-selected", "true");
    await skills.press("Enter");
    await expect(skills).toHaveValue("Arc welding");

    await first.fill("Zed");
    await page.route(
      (url) => url.pathname === "/en/passport",
      (route) => (route.request().method() === "POST" ? route.abort() : route.continue()),
    );
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Could not save your details", { exact: true })).toBeVisible();
    await expect(first).toHaveValue("Zed");
    expect(profileRows(user.id)[0].first_name).toBe("Test");

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
  });
});

test.describe("candidate passport: isolation", () => {
  test("FR-B1 AC10: a candidate sees only the own passport", async ({ browser }) => {
    const first = await createCommittedUser("worker");
    const second = await createCommittedUser("worker");
    execute(
      `update public.worker_profiles set first_name = 'Firstly', headline = 'Only for the first' where user_id = ${literal(first.id)};
       update public.worker_profiles set first_name = 'Secondly' where user_id = ${literal(second.id)}`,
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, second);
    await page.goto("/en/passport");
    await expect(page.getByLabel("First name", { exact: true })).toHaveValue("Secondly");
    await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("");
    await expect(page.locator("body")).not.toContainText("Firstly");
    await context.close();
  });
});
