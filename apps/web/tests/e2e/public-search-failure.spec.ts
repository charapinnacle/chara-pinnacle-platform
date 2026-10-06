import { execute } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { expect, test } from "./support/test";

const SEARCH_JOBS =
  "public.search_jobs(text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean, public.recruitment_preference, text, integer)";

// The function is made unavailable to the API roles for the whole database while this file runs, so it has a project of
// its own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  execute(`grant execute on function ${SEARCH_JOBS} to anon, authenticated`);
});

test.describe("public vacancy search failure", () => {
  test("FR-C3 AC9: a failed search shows a toast and a retry action, and retrying shows the results", async ({ page }) => {
    execute(`revoke execute on function ${SEARCH_JOBS} from anon, authenticated`);
    await page.goto("/en/jobs");

    await expect(page.getByRole("heading", { name: "The vacancies could not be loaded" })).toBeVisible();
    await expect(page.getByRole("region", { name: /Notification/ }).getByText("The vacancies could not be loaded")).toBeVisible();
    await expect(page.getByText("permission denied")).toHaveCount(0);
    await expect(page.getByText("search_jobs")).toHaveCount(0);

    execute(`grant execute on function ${SEARCH_JOBS} to anon, authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Find jobs" })).toBeVisible();
    await waitForHydration(page.getByLabel("Keyword", { exact: true }));
    await expect(page.getByRole("heading", { name: "The vacancies could not be loaded" })).toHaveCount(0);
  });
});
