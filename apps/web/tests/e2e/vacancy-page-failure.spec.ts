import { execute } from "./support/db";
import { newCompany, seedJob } from "./support/jobs";
import { expect, test } from "./support/test";

const GET_PUBLIC_JOB = "public.get_public_job(uuid)";

// The function is made unavailable to the API roles for the whole database while this file runs, so it has a project of
// its own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  execute(`grant execute on function ${GET_PUBLIC_JOB} to anon, authenticated`);
});

test.describe("the public vacancy page when the database fails", () => {
  test("FR-C4 AC11: a failed read is a 5xx error page that leaks nothing, never 'no longer available'", async ({ page }) => {
    const company = await newCompany();
    const id = seedJob(company, { title: "Failing welder", status: "open" });
    execute(`revoke execute on function ${GET_PUBLIC_JOB} from anon, authenticated`);

    const response = await page.goto(`/en/jobs/${id}`);
    expect(response?.status()).toBeGreaterThanOrEqual(500);
    await expect(page.getByRole("heading", { name: "The vacancy could not be loaded" })).toBeVisible();
    await expect(page.getByText("This vacancy is no longer available")).toHaveCount(0);
    await expect(page.getByText("permission denied")).toHaveCount(0);
    await expect(page.getByText("get_public_job")).toHaveCount(0);

    execute(`grant execute on function ${GET_PUBLIC_JOB} to anon, authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Failing welder", level: 1 })).toBeVisible();
  });
});
