import { execute } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { newCompany, seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { savedJobIds, SAVED_URL, seedSaved } from "./support/saved";
import { expect, test } from "./support/test";
import { publicUrl } from "./support/vacancy-page";

const LIST = "public.list_saved_jobs(text, integer)";
const INSERT = "insert (worker_user_id, job_id) on public.saved_jobs";

// The list function and the insert privilege are withdrawn from the API role for the whole database while this file
// runs, so it has a project of its own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  execute(`grant execute on function ${LIST} to authenticated`);
  execute(`grant ${INSERT} to authenticated`);
});

test.describe("saved vacancies when the database fails", () => {
  test("FR-C5 AC11: a failed read of the saved list shows a toast and a retry that works once the database answers", async ({ page }) => {
    const company = await newCompany();
    const candidate = await createCommittedUser("worker");
    seedSaved(candidate.id, seedJob(company, { title: "Retry welder", status: "open" }));
    await logIn(page, candidate);
    await expect(page).toHaveURL(/\/dashboard\/worker$/);
    execute(`revoke execute on function ${LIST} from authenticated`);

    await page.goto(SAVED_URL);
    await expect(page.getByRole("heading", { name: "Your saved vacancies could not be loaded", level: 2 })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.", { exact: true })).toBeVisible();
    await expect(page.getByText("This vacancy is no longer available")).toHaveCount(0);
    await expect(page.getByText("permission denied")).toHaveCount(0);
    await expect(page.getByText("list_saved_jobs")).toHaveCount(0);

    execute(`grant execute on function ${LIST} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Retry welder" })).toBeVisible();
  });

  test("FR-C5 AC11: a failed Save shows a toast, leaves the button unpressed and saves nothing", async ({ page }) => {
    const company = await newCompany();
    const candidate = await createCommittedUser("worker");
    const id = seedJob(company, { title: "Failing save welder", status: "open" });
    await logIn(page, candidate, publicUrl(id));
    const save = page.getByRole("button", { name: "Save vacancy: Failing save welder" });
    await waitForHydration(save);
    execute(`revoke ${INSERT} from authenticated`);

    await save.click();
    await expect(page.getByText("Your saved vacancies were not changed", { exact: true })).toBeVisible();
    await expect(page.getByText("We could not complete this request. Try again.", { exact: true })).toBeVisible();
    await expect(save).toHaveAttribute("aria-pressed", "false");
    await expect(save).toBeEnabled();
    expect(savedJobIds(candidate.id)).toEqual([]);
    await expect(page.getByText("permission denied")).toHaveCount(0);

    execute(`grant ${INSERT} to authenticated`);
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", "true");
    expect(savedJobIds(candidate.id)).toEqual([id]);
  });
});
