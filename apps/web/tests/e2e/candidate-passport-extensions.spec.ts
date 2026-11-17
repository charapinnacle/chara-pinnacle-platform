import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { literal, query } from "./support/db";
import { createCommittedUser } from "./support/login";
import { overflow } from "./support/login-page";
import { signIn } from "./support/passport";

const SENSITIVE = "Do not enter ID numbers, date of birth, nationality, religion, health or other sensitive details.";

function extensionRows(userId: string) {
  const id = literal(userId);
  return {
    training: query<{ course: string; provider: string | null; year_completed: number }>(
      `select course, provider, year_completed from public.worker_training where worker_user_id = ${id} order by course`,
    ),
    history: query<{ role: string; employer_name: string | null; country_code: string; from_month: string; to_month: string | null }>(
      `select role, employer_name, country_code, from_month::text, to_month::text
       from public.worker_employment_history where worker_user_id = ${id} order by role`,
    ),
    industries: query<{ industry_code: string }>(
      `select industry_code from public.worker_preferred_industries where worker_user_id = ${id} order by industry_code`,
    ).map((row) => row.industry_code),
  };
}

const section = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

async function expectPercent(page: Page, percent: number): Promise<void> {
  await expect(page.getByText(`${percent}% complete`, { exact: true })).toBeVisible();
}

async function press(control: Locator, key = "Enter"): Promise<void> {
  await control.focus();
  await control.press(key);
}

async function chooseByKeyboard(page: Page, label: string, option: string): Promise<void> {
  const combobox = page.getByRole("combobox", { name: label, exact: true });
  await combobox.fill(option);
  const target = page.getByRole("option", { name: option, exact: true });
  await expect(target).toBeVisible();
  for (let step = 0; step < 8 && (await target.getAttribute("aria-selected")) !== "true"; step += 1) {
    await combobox.press("ArrowDown");
  }
  await combobox.press("Enter");
  await expect(combobox).toHaveValue(option);
}

test.describe("candidate passport: training, employment history and preferences", () => {
  test("FR-Q4 AC8: the worker adds, edits and removes entries by keyboard, and a failed save keeps the values", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await signIn(page, user);
    await page.goto("/en/passport");
    // Release 2c is off here: the entries are kept but weigh nothing until it goes live (partner-network-pages.spec.ts).
    await expectPercent(page, 10);

    await expect(section(page, "Training").getByText("No training added yet", { exact: true })).toBeVisible();
    await expect(section(page, "Employment history").getByText("No employment history added yet", { exact: true })).toBeVisible();
    await expect(section(page, "Preferred industries").getByText("No preferred industries yet", { exact: true })).toBeVisible();
    await expect(section(page, "Training").getByText(SENSITIVE)).toBeVisible();
    await expect(section(page, "Employment history").getByText(SENSITIVE)).toBeVisible();

    await press(page.getByRole("button", { name: "Add training" }));
    const addTraining = page.getByRole("dialog", { name: "Add training" });
    await expect(addTraining).toBeVisible();
    for (const label of ["Course", "Provider", "Year completed"]) {
      await expect(addTraining.getByRole("textbox", { name: label, exact: true }), label).toBeVisible();
    }
    await addTraining.getByLabel("Course", { exact: true }).fill("Welding MIG/MAG level 2");
    await addTraining.getByLabel("Provider", { exact: true }).fill("TÜV Nord");
    await addTraining.getByLabel("Year completed", { exact: true }).fill("2021");
    await addTraining.getByLabel("Year completed", { exact: true }).press("Enter");
    await expect(page.getByText("Training added", { exact: true })).toBeVisible();
    await expect(addTraining).toBeHidden();
    await expect(section(page, "Training").getByRole("listitem").filter({ hasText: "Welding MIG/MAG level 2" })).toContainText(
      "(TÜV Nord, 2021)",
    );
    await expectPercent(page, 10);

    await press(page.getByRole("button", { name: "Add employment" }));
    const addEmployment = page.getByRole("dialog", { name: "Add employment" });
    await expect(addEmployment).toBeVisible();
    for (const label of ["Role", "Employer name (optional)", "From", "To", "I still work here"]) {
      await expect(addEmployment.getByLabel(label, { exact: true }), label).toBeVisible();
    }
    await addEmployment.getByLabel("Role", { exact: true }).fill("Pipe welder");
    await chooseByKeyboard(page, "Country", "Germany");
    await addEmployment.getByLabel("From", { exact: true }).fill("2019-03");
    const to = addEmployment.getByLabel("To", { exact: true });
    await expect(to).toBeEnabled();
    await press(addEmployment.getByLabel("I still work here", { exact: true }), "Space");
    await expect(to).toBeDisabled();
    await press(addEmployment.getByRole("button", { name: "Save employment" }));
    await expect(page.getByText("Employment added", { exact: true })).toBeVisible();
    await expect(section(page, "Employment history").getByRole("listitem")).toContainText("Pipe welder (Germany, 2019-03 to now)");
    await expectPercent(page, 10);

    await press(page.getByRole("button", { name: "Edit Pipe welder" }));
    const editEmployment = page.getByRole("dialog", { name: "Edit employment" });
    await expect(editEmployment.getByLabel("I still work here", { exact: true })).toBeChecked();
    await expect(editEmployment.getByLabel("To", { exact: true })).toBeDisabled();
    await editEmployment.getByLabel("Role", { exact: true }).fill("Senior pipe welder");
    await editEmployment.getByLabel("Role", { exact: true }).press("Enter");
    await expect(page.getByText("Employment saved", { exact: true })).toBeVisible();
    await expect(section(page, "Employment history").getByRole("listitem")).toContainText("Senior pipe welder");

    await press(page.getByRole("button", { name: "Remove Welding MIG/MAG level 2" }));
    const confirm = page.getByRole("dialog", { name: "Remove Welding MIG/MAG level 2?" });
    await expect(confirm).toBeVisible();
    await press(confirm.getByRole("button", { name: "Remove", exact: true }));
    await expect(page.getByText("Training removed", { exact: true })).toBeVisible();
    await expect(section(page, "Training").getByText("No training added yet", { exact: true })).toBeVisible();
    await expectPercent(page, 10);

    await chooseByKeyboard(page, "Preferred industry", "Manufacturing");
    await press(page.getByRole("button", { name: "Add industry" }));
    await expect(page.getByText("Industry added", { exact: true })).toBeVisible();
    await expect(section(page, "Preferred industries").getByRole("listitem")).toContainText("Manufacturing");
    await expectPercent(page, 10);

    await page.reload();
    await expect(section(page, "Employment history").getByRole("listitem")).toContainText("Senior pipe welder (Germany, 2019-03 to now)");
    await expect(section(page, "Preferred industries").getByRole("listitem")).toContainText("Manufacturing");
    await expectPercent(page, 10);
    expect(extensionRows(user.id)).toEqual({
      training: [],
      history: [{ role: "Senior pipe welder", employer_name: null, country_code: "DE", from_month: "2019-03-01", to_month: null }],
      industries: ["C"],
    });

    const passportPage = (url: URL) => url.pathname === "/en/passport";
    await page.route(passportPage, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await press(page.getByRole("button", { name: "Add training" }));
    const failing = page.getByRole("dialog", { name: "Add training" });
    await failing.getByLabel("Course", { exact: true }).fill("Pipe fitting");
    await failing.getByLabel("Year completed", { exact: true }).fill("2020");
    await failing.getByLabel("Year completed", { exact: true }).press("Enter");
    await expect(page.getByText("Could not save the training", { exact: true })).toBeVisible();
    await expect(failing.getByLabel("Course", { exact: true })).toHaveValue("Pipe fitting");
    await expect(failing.getByLabel("Year completed", { exact: true })).toHaveValue("2020");
    expect(extensionRows(user.id).training).toEqual([]);
    await page.unroute(passportPage);
  });

  test("FR-Q4 AC8: the new sections pass axe and fit 360 px, with a dialog open as well", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await signIn(page, user);
    await page.goto("/en/passport");
    await expect(page.getByRole("heading", { name: "Employment history", exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.setViewportSize({ width: 360, height: 800 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Preferred employment types", exact: true })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: "Add employment" }).click();
    await expect(page.getByRole("dialog", { name: "Add employment" })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
  });
});
