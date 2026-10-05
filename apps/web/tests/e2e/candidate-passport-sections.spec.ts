import { expect, test } from "./support/test";
import { choose } from "./support/combobox";
import { createCommittedUser } from "./support/login";
import { childRows, daysFromToday, profileRows, signIn } from "./support/passport";

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
});
