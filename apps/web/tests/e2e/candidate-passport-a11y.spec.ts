import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { createCommittedUser } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import {
  daysFromToday,
  expectTabOrderFollowsPage,
  insertExpiredAuthorization,
  profileRows,
} from "./support/passport";

test.describe("candidate passport: states and keyboard", () => {
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
        if (!route.request().headers()["next-router-prefetch"]) await new Promise((resolve) => setTimeout(resolve, 2000));
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

    await expectTabOrderFollowsPage(page);

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
