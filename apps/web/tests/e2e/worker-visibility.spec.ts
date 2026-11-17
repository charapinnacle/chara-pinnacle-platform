import type { Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, executeAsync, literal, query } from "./support/db";
import { createCommittedUser } from "./support/login";
import { seedAllButCv, signIn } from "./support/passport";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// The Find Workers opt-in on the passport and the dashboard (V68; FR-Q1 AC9, AC10; NFR-C4, NFR-S9, NFR-U3, NFR-U4): the
// section explains what companies see, previews the card without the name, and turns visibility on by keyboard through a
// dialog that quotes the consent; Cancel changes nothing; the sections can be shown once visible; withdrawal is at once;
// the dashboard shows the state with its next step, a skeleton while it is read, and a failed save returns the switch.
// release_find_workers is set for the whole database and a function is withdrawn from the API role, so this file is a
// project of its own after the messaging pages, and its tests run one after the other.

const SET_VISIBILITY = "public.set_worker_visibility(boolean, integer)";
const PASSPORT_URL = "/en/passport#find-workers";
const DASHBOARD_URL = "/en/dashboard/worker";

function setRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_find_workers'`);
}

function visibilityRows(userId: string) {
  return query<{ action: string; version: number }>(
    `select action, version from public.consents where user_id = ${literal(userId)} and purpose = 'worker-visibility-consent' order by id`,
  );
}

function profileState(userId: string) {
  return query<{ searchable: boolean; card_show_employment_history: boolean }>(
    `select searchable, card_show_employment_history from public.worker_profiles where user_id = ${literal(userId)}`,
  )[0];
}

// A worker with a complete passport but for the CV, named so that the page can be searched for the name.
async function worker(): Promise<TestUser> {
  const user = await createCommittedUser("worker");
  seedAllButCv(user.id);
  execute(`update public.worker_profiles set first_name = 'Zarina', last_name = 'Quillfeather' where user_id = ${literal(user.id)}`);
  return user;
}

function optIn(userId: string): void {
  execute(
    `insert into public.consents (user_id, purpose, version, action)
       values (${literal(userId)}, 'worker-visibility-consent', private.current_legal_version('worker-visibility-consent'), 'granted');
     update public.worker_profiles set searchable = true where user_id = ${literal(userId)}`,
  );
}

const section = (page: Page) => page.locator("section#find-workers");
const visibilitySwitch = (page: Page) => page.getByRole("switch", { name: "Show my card in Find Workers" });

test.describe("Find Workers visibility (FR-Q1)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setRelease(true));
  test.afterAll(() => setRelease(false));
  test.afterEach(() => {
    execute(`grant execute on function ${SET_VISIBILITY} to authenticated`);
  });

  test("AC9: the passport explains Find Workers, previews the card without the name, and the worker opts in by keyboard after the dialog", async ({ page }) => {
    const user = await worker();
    await signIn(page, user);
    await page.goto(PASSPORT_URL);

    const findWorkers = section(page);
    await expect(findWorkers.getByRole("heading", { name: "Companies will see" })).toBeVisible();
    await expect(findWorkers.getByRole("heading", { name: "Companies will never see" })).toBeVisible();
    await expect(findWorkers.getByText("Your name or photo")).toBeVisible();
    const card = findWorkers.getByTestId("worker-card");
    await expect(card).toContainText("Electrician");
    await expect(card).toContainText("6 years of experience");
    await expect(card).not.toContainText("Zarina");
    await expect(card).not.toContainText("Quillfeather");
    await expect(visibilitySwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(findWorkers.getByText("Not visible: companies cannot find you")).toBeVisible();
    await expect(findWorkers.getByRole("switch", { name: "Training" })).toHaveCount(0);

    await visibilitySwitch(page).focus();
    await page.keyboard.press("Space");
    const dialog = page.getByRole("dialog", { name: "Show your card in Find Workers?" });
    await expect(dialog).toBeVisible();
    const wording = dialog.getByRole("region", { name: "Consent wording" });
    await expect(wording).toContainText("worker search");
    await expect(wording).not.toContainText("##");
    await expect(wording.getByRole("heading", { name: "What this document will cover", level: 3 })).toBeVisible();
    await expect(dialog.getByRole("link", { name: /Worker visibility consent, version \d+/ })).toHaveAttribute(
      "href",
      "/en/legal/worker-visibility-consent",
    );
    await expectAccessibleAtBothWidths(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(visibilitySwitch(page)).toHaveAttribute("aria-checked", "false");
    expect(visibilityRows(user.id)).toEqual([]);

    await visibilitySwitch(page).focus();
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Confirm" }).press("Enter");
    await expect(page.getByRole("listitem").filter({ hasText: "Your card is visible in Find Workers" })).toBeVisible();
    await expect(visibilitySwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(findWorkers.getByText(/^Visible since \d{1,2} \w+ \d{4}$/)).toBeVisible();
    for (const name of ["Training", "Employment history", "Preferred industries"]) {
      await expect(findWorkers.getByRole("switch", { name })).toHaveAttribute("aria-checked", "false");
    }
    expect(visibilityRows(user.id).map((row) => row.action)).toEqual(["granted"]);
    expect(profileState(user.id).searchable).toBe(true);

    await findWorkers.getByRole("switch", { name: "Employment history" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Your card sections were saved" })).toBeVisible();
    await expect.poll(() => profileState(user.id).card_show_employment_history).toBe(true);

    await page.reload();
    await expect(visibilitySwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(section(page).getByRole("switch", { name: "Employment history" })).toHaveAttribute("aria-checked", "true");
    await expect(section(page)).not.toContainText("Zarina");
    await expectAccessibleAtBothWidths(page);
  });

  test("NFR-C4: turning the card off hides it at once with a withdrawn consent row", async ({ page }) => {
    const user = await worker();
    optIn(user.id);
    await signIn(page, user);
    await page.goto(PASSPORT_URL);

    await expect(visibilitySwitch(page)).toHaveAttribute("aria-checked", "true");
    await visibilitySwitch(page).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Your card is hidden from Find Workers" })).toBeVisible();
    await expect(visibilitySwitch(page)).toHaveAttribute("aria-checked", "false");
    expect(visibilityRows(user.id).map((row) => row.action)).toEqual(["granted", "withdrawn"]);
    expect(profileState(user.id).searchable).toBe(false);
  });

  test("AC10: the dashboard shows the state and the next step, a skeleton while it is read, and a failed save returns the switch", async ({ browser }) => {
    const visible = await worker();
    optIn(visible.id);
    const hidden = await worker();

    const visibleContext = await browser.newContext();
    const visiblePage = await visibleContext.newPage();
    await signIn(visiblePage, visible);
    const held = executeAsync("begin; lock table public.consents in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await visiblePage.goto(DASHBOARD_URL, { waitUntil: "commit" });
    await expect(visiblePage.getByRole("status", { name: "Loading" }).first()).toBeVisible();
    await held;
    const findWorkers = visiblePage.locator("section").filter({ has: visiblePage.getByRole("heading", { name: "Find Workers", level: 2 }) });
    await expect(findWorkers.getByText("Visible in Find Workers", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(findWorkers.getByRole("link", { name: "Turn off" })).toHaveAttribute("href", PASSPORT_URL);
    await expectAccessibleAtBothWidths(visiblePage);

    const hiddenContext = await browser.newContext();
    const hiddenPage = await hiddenContext.newPage();
    await signIn(hiddenPage, hidden);
    const hiddenCard = hiddenPage.locator("section").filter({ has: hiddenPage.getByRole("heading", { name: "Find Workers", level: 2 }) });
    await expect(hiddenCard.getByText("Not visible in Find Workers", { exact: true })).toBeVisible();
    await expect(hiddenCard.getByRole("link", { name: "Learn more about Find Workers" })).toHaveAttribute("href", PASSPORT_URL);
    await hiddenContext.close();

    execute(`revoke execute on function ${SET_VISIBILITY} from authenticated`);
    await visiblePage.goto(PASSPORT_URL);
    await expect(visibilitySwitch(visiblePage)).toHaveAttribute("aria-checked", "true");
    await visibilitySwitch(visiblePage).click();
    await expect(visiblePage.getByRole("listitem").filter({ hasText: "Your Find Workers card was not changed" })).toBeVisible();
    await expect(visibilitySwitch(visiblePage)).toHaveAttribute("aria-checked", "true");
    expect(profileState(visible.id).searchable).toBe(true);
    await visibleContext.close();
  });

  test("the section and the dashboard card are not shown while release_find_workers is off", async ({ page }) => {
    const user = await worker();
    await signIn(page, user);
    setRelease(false);
    try {
      await page.goto("/en/passport");
      await expect(page.getByRole("heading", { name: "Manage documents" })).toBeVisible();
      await expect(section(page)).toHaveCount(0);
      await page.goto(DASHBOARD_URL);
      await expect(page.getByRole("heading", { name: "Profile completion" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Find Workers", level: 2 })).toHaveCount(0);
    } finally {
      setRelease(true);
    }
  });
});
