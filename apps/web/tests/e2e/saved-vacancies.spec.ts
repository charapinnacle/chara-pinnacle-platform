import type { Locator, Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { newCompany, seedJob, type Company } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import { uniqueToken } from "./support/organizations";
import { saveInSession, savedAuditCount, savedJobIds, SAVED_URL, seedSaved } from "./support/saved";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";
import { bodyOf, publicUrl } from "./support/vacancy-page";

const newMarker = () => `zq${uniqueToken()}`;

const rows = (page: Page): Locator => page.locator("ul > li");
const row = (page: Page, title: string): Locator => rows(page).filter({ hasText: title });
const saveButton = (scope: Page | Locator, title: string): Locator =>
  scope.getByRole("button", { name: `Save vacancy: ${title}` });

function openJob(company: Company, title: string, createdAt = "now()"): string {
  return seedJob(company, { title, status: "open", createdAt });
}

async function openSaved(page: Page): Promise<void> {
  await page.goto(SAVED_URL);
  await expect(page.getByRole("heading", { name: "Saved vacancies", level: 1 })).toBeVisible();
}

test.describe("saved vacancies", () => {
  test("FR-C5 AC1: Save on a result card and on the vacancy page, then the saved list shows both, newest first, after a reload", async ({
    page,
  }) => {
    const company = await newCompany();
    const marker = newMarker();
    const titleA = `Welder ${marker} A`;
    const titleB = `Welder ${marker} B`;
    const a = openJob(company, titleA);
    const b = openJob(company, titleB);
    const candidate = await createCommittedUser("worker");

    await logIn(page, candidate, `/en/jobs?q=${marker}`);
    await expect(page).toHaveURL(`/en/jobs?q=${marker}`);
    await expect(row(page, marker)).toHaveCount(2);
    const cardSave = saveButton(row(page, titleA), titleA);
    await expect(cardSave).toHaveAttribute("aria-pressed", "false");
    await expect(cardSave).toHaveText("Save");
    await waitForHydration(cardSave);
    await cardSave.click();
    await expect(cardSave).toHaveAttribute("aria-pressed", "true");
    await expect(cardSave).toHaveText("Saved");
    await expect(saveButton(row(page, titleB), titleB)).toHaveAttribute("aria-pressed", "false");

    await page.goto(publicUrl(b));
    const pageSave = saveButton(page, titleB);
    await expect(pageSave).toHaveAttribute("aria-pressed", "false");
    await waitForHydration(pageSave);
    await pageSave.click();
    await expect(pageSave).toHaveAttribute("aria-pressed", "true");
    await expect(pageSave).toHaveText("Saved");

    await page.reload();
    await expect(saveButton(page, titleB)).toHaveAttribute("aria-pressed", "true");
    await page.goto(`/en/jobs?q=${marker}`);
    await expect(saveButton(row(page, titleA), titleA)).toHaveAttribute("aria-pressed", "true");
    await expect(saveButton(row(page, titleB), titleB)).toHaveAttribute("aria-pressed", "true");

    await openSaved(page);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).getByRole("heading")).toHaveText([titleB, titleA]);
    expect(savedJobIds(candidate.id)).toEqual([b, a]);
    expect(savedAuditCount(candidate.id, a)).toBe(1);
    expect(savedAuditCount(candidate.id, b)).toBe(1);

    await page.reload();
    await expect(rows(page).getByRole("heading")).toHaveText([titleB, titleA]);
  });

  test("FR-C5 AC1: pressing Saved on a result card unsaves it and the row is removed", async ({ page }) => {
    const company = await newCompany();
    const marker = newMarker();
    const title = `Welder ${marker}`;
    const id = openJob(company, title);
    const candidate = await createCommittedUser("worker");
    seedSaved(candidate.id, id);

    await logIn(page, candidate, `/en/jobs?q=${marker}`);
    const button = saveButton(row(page, title), title);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await waitForHydration(button);
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(button).toHaveText("Save");
    expect(savedJobIds(candidate.id)).toEqual([]);
  });

  test("FR-C5 AC2: Unsave removes each row at once, deletes it and ends in the empty state with a link to Find Jobs", async ({
    page,
  }) => {
    const company = await newCompany();
    const marker = newMarker();
    const first = openJob(company, `Welder ${marker} first`);
    const second = openJob(company, `Welder ${marker} second`);
    const candidate = await createCommittedUser("worker");
    seedSaved(candidate.id, first, "now() - interval '2 minutes'");
    seedSaved(candidate.id, second, "now() - interval '1 minute'");
    await logIn(page, candidate, SAVED_URL);
    await expect(rows(page)).toHaveCount(2);

    let actionDelay = 2000;
    await page.route("**/en/saved", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, actionDelay));
      await route.continue();
    });
    const unsaveSecond = row(page, `Welder ${marker} second`).getByRole("button", { name: "Unsave" });
    await waitForHydration(unsaveSecond);
    await unsaveSecond.click();
    await expect(row(page, `Welder ${marker} second`)).toHaveCount(0, { timeout: 1000 });
    await expect(page.getByRole("heading", { name: "Saved vacancies", level: 1 })).toBeFocused();
    expect(savedJobIds(candidate.id)).toEqual([second, first]);
    await expect.poll(() => savedJobIds(candidate.id)).toEqual([first]);
    actionDelay = 0;
    await expect(rows(page)).toHaveCount(1);

    await row(page, `Welder ${marker} first`).getByRole("button", { name: "Unsave" }).click();
    await expect(page.getByRole("heading", { name: "No saved vacancies yet", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find Jobs" })).toHaveAttribute("href", "/en/jobs");
    await expect(rows(page)).toHaveCount(0);
    expect(savedJobIds(candidate.id)).toEqual([]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "No saved vacancies yet", level: 2 })).toBeVisible();
  });

  test("FR-C5 AC3: saves that arrive together leave one row, raise no error and the second unsave is a no-op", async () => {
    const company = await newCompany();
    const candidate = await createCommittedUser("worker");
    for (const round of [1, 2, 3]) {
      const id = openJob(company, `Race welder ${round} ${newMarker()}`);
      const outcomes = await Promise.allSettled([saveInSession(candidate.id, id), saveInSession(candidate.id, id)]);
      expect(outcomes.map(({ status }) => status)).toEqual(["fulfilled", "fulfilled"]);
      expect(savedJobIds(candidate.id)).toContain(id);
      expect(savedJobIds(candidate.id).filter((saved) => saved === id)).toHaveLength(1);
      expect(savedAuditCount(candidate.id, id)).toBe(1);
    }
    expect(savedJobIds(candidate.id)).toHaveLength(3);

    const [again] = savedJobIds(candidate.id);
    execute(`delete from public.saved_jobs where worker_user_id = ${literal(candidate.id)} and job_id = ${literal(again)}`);
    await saveInSession(candidate.id, again);
    expect(savedJobIds(candidate.id)).toContain(again);
    expect(savedAuditCount(candidate.id, again)).toBe(1);
  });

  test("FR-C5 AC7: the saved list flags each state, offers Apply only for an open vacancy and discloses nothing of a hidden one", async ({
    page,
  }) => {
    const company = await newCompany();
    const marker = newMarker();
    const candidate = await createCommittedUser("worker");
    const states = {
      open: { status: "open" },
      paused: { status: "paused" },
      closed: { status: "closed" },
      filled: { status: "filled" },
      hidden: { status: "open", moderation: "hidden" },
    } as const;
    const ids: Record<string, string> = {};
    let age = 5;
    for (const [state, options] of Object.entries(states)) {
      ids[state] = seedJob(company, { title: `Welder ${state} ${marker}`, ...options });
      seedSaved(candidate.id, ids[state], `now() - interval '${age--} minutes'`);
    }
    const [{ display_name }] = query<{ display_name: string }>(
      `select display_name from public.organizations where id = ${literal(company.id)}`,
    );

    await logIn(page, candidate, SAVED_URL);
    await expect(rows(page)).toHaveCount(5);

    const open = row(page, `Welder open ${marker}`);
    await expect(open).toContainText("Open");
    await expect(open).toContainText(display_name);
    await expect(open).not.toContainText("No longer open");
    await expect(open.getByRole("link", { name: /^Apply/ })).toHaveAttribute("href", `/en/jobs/${ids.open}`);

    for (const state of ["paused", "closed", "filled"]) {
      const closed = row(page, `Welder ${state} ${marker}`);
      await expect(closed, state).toContainText("No longer open");
      await expect(closed, state).toContainText(display_name);
      await expect(closed.getByRole("link"), state).toHaveCount(0);
    }

    const unavailable = rows(page).filter({ hasText: "This vacancy is no longer available" });
    await expect(unavailable).toHaveCount(1);
    await expect(unavailable).not.toContainText(display_name);
    await expect(unavailable).not.toContainText("No longer open");
    await expect(unavailable.getByRole("link")).toHaveCount(0);
    await expect(page.getByText(`Welder hidden ${marker}`)).toHaveCount(0);

    const { html } = await bodyOf(page, SAVED_URL);
    expect(html).not.toContain(`Welder hidden ${marker}`);
    expect(html).not.toContain("moderation");
    expect(html).toContain(`Welder paused ${marker}`);
  });

  test("FR-C5 AC10: a visitor is sent to log in for the saved page and for Save on a result card, a company user gets not found", async ({
    page,
    context,
  }) => {
    const company = await newCompany();
    const marker = newMarker();
    const title = `Welder ${marker}`;
    openJob(company, title);
    const candidate = await createCommittedUser("worker");

    await page.goto(SAVED_URL);
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(SAVED_URL)}`);

    const results = `/en/jobs?q=${marker}`;
    await page.goto(results);
    const visitorSave = saveButton(row(page, title), title);
    await visitorSave.click();
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(results)}`);
    await page.getByLabel("Email", { exact: true }).fill(candidate.email);
    await page.getByLabel("Password", { exact: true }).fill(candidate.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(results);
    await expect(saveButton(row(page, title), title)).toHaveAttribute("aria-pressed", "false");

    await context.clearCookies();
    await signInBrowser(context, company.owner);
    await page.goto(results);
    await expect(row(page, title)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
    await page.goto(SAVED_URL);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { name: "Saved vacancies" })).toHaveCount(0);
  });

  test("FR-C5 AC11: a skeleton while loading, 20 rows a page with a next page control, and the keyboard toggles Save", async ({
    page,
  }) => {
    const company = await newCompany();
    const candidate = await createCommittedUser("worker");
    const marker = newMarker();
    for (let n = 1; n <= 25; n++) {
      const id = openJob(company, `Welder ${marker} ${String(n).padStart(2, "0")}`);
      seedSaved(candidate.id, id, `now() - interval '${n} minutes'`);
    }
    await logIn(page, candidate);
    await expect(page).toHaveURL(/\/dashboard\/worker$/);

    let navigationDelay = 1500;
    await page.route(/\/en\/saved/, async (route) => {
      if (!route.request().headers()["next-router-prefetch"]) await new Promise((resolve) => setTimeout(resolve, navigationDelay));
      await route.continue();
    });
    await page.getByRole("link", { name: "Saved vacancies" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
    await expect(rows(page)).toHaveCount(20);
    navigationDelay = 0;
    await expect(rows(page).first()).toContainText(`Welder ${marker} 01`);
    await expect(page.getByRole("link", { name: "Back to the first page" })).toHaveCount(0);

    await page.getByRole("link", { name: "Next page" }).click();
    await expect(page).toHaveURL(/\/en\/saved\?cursor=/);
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).first()).toContainText(`Welder ${marker} 21`);
    await expect(page.getByRole("link", { name: "Next page" })).toHaveCount(0);
    await page.getByRole("link", { name: "Back to the first page" }).click();
    await expect(page).toHaveURL(SAVED_URL);
    await expect(rows(page)).toHaveCount(20);

    const title = `Welder ${marker} keyboard`;
    openJob(company, title);
    await page.goto(`/en/jobs?q=${marker}+keyboard`);
    const save = saveButton(page, title);
    await waitForHydration(save);
    await save.focus();
    await page.keyboard.press("Enter");
    await expect(save).toHaveAttribute("aria-pressed", "true");
    await expect(save).toBeEnabled();
    await page.keyboard.press("Space");
    await expect(save).toHaveAttribute("aria-pressed", "false");
  });

  test("FR-C5 AC11: no accessibility violation and no horizontal scroll on the saved page at 1280 px and 360 px, filled and empty", async ({
    page,
  }) => {
    const company = await newCompany();
    const candidate = await createCommittedUser("worker");
    const id = openJob(company, "Accessible welder");
    seedSaved(candidate.id, id);
    seedSaved(candidate.id, seedJob(company, { title: "Gone welder", status: "closed" }));
    seedSaved(candidate.id, seedJob(company, { title: "Hidden welder", status: "open", moderation: "hidden" }));
    await logIn(page, candidate, SAVED_URL);
    await expect(page).toHaveURL(SAVED_URL);

    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await openSaved(page);
      await expect(rows(page)).toHaveCount(3);
      await expectNoAxeViolations(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    }
    execute(`delete from public.saved_jobs where worker_user_id = ${literal(candidate.id)}`);
    await page.reload();
    await expect(page.getByRole("heading", { name: "No saved vacancies yet", level: 2 })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
