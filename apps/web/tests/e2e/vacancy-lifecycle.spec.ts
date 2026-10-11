import type { Page } from "@playwright/test";
import { mainNavigation } from "./support/app-shell";
import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { applicationsOf, newApplicant, seedApplication } from "./support/applications";
import { logIn } from "./support/login-page";
import { uniqueToken } from "./support/organizations";
import {
  addCompanyUser,
  jobStatus,
  jobsUrl,
  jobUrl,
  newCompany,
  seedJob,
  statusAudit,
} from "./support/jobs";

const ACTIONS = ["Publish", "Pause", "Reopen", "Close", "Mark as filled"];
const UNAVAILABLE = "This vacancy is no longer available";

async function offered(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (const name of ACTIONS) {
    if ((await page.getByRole("button", { name, exact: true }).count()) > 0) found.push(name);
  }
  return found;
}

const longDate = (daysAgo: number) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.now() - daysAgo * 86_400_000));

test.describe("vacancy lifecycle", () => {
  test("FR-C2 AC8: each state offers its actions to an admin and none to a member, and the badge says the state in words", async ({
    page,
    browser,
  }) => {
    const acme = await newCompany();
    const admin = await addCompanyUser(acme, "admin");
    const member = await addCompanyUser(acme, "member");
    const expected = [
      ["draft", "Draft - not public", ["Publish"]],
      ["open", "Open", ["Pause", "Close", "Mark as filled"]],
      ["paused", "Paused - not public", ["Reopen", "Close", "Mark as filled"]],
      ["closed", "Closed - not public", ["Reopen"]],
      ["filled", "Filled - not public", []],
    ] as const;
    const ids = expected.map(([status]) => seedJob(acme, { title: `State ${status}`, status }));

    await logIn(page, admin, jobUrl(acme.slug, ids[0]));
    await expect(page).toHaveURL(jobUrl(acme.slug, ids[0]));
    for (const [index, [, words, actions]] of expected.entries()) {
      await page.goto(jobUrl(acme.slug, ids[index]));
      await expect(page.getByRole("status").filter({ hasText: words })).toBeVisible();
      expect(await offered(page)).toEqual(actions);
    }

    const other = await browser.newContext();
    const memberPage = await other.newPage();
    await logIn(memberPage, member, jobUrl(acme.slug, ids[1]));
    await expect(memberPage.getByRole("status").filter({ hasText: "Open" })).toBeVisible();
    expect(await offered(memberPage)).toEqual([]);
    await other.close();
  });

  test("FR-C2 AC8: Close and Mark as filled are done by keyboard and ask first, and the Filled dialog says it is final", async ({ page }) => {
    const acme = await newCompany();
    const admin = await addCompanyUser(acme, "admin");
    const toClose = seedJob(acme, { title: "To close", status: "open" });
    const toFill = seedJob(acme, { title: "To fill", status: "open" });

    await logIn(page, admin, jobUrl(acme.slug, toClose));
    await page.getByRole("button", { name: "Close", exact: true }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Close this vacancy?" });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(jobStatus(toClose)).toBe("open");

    await page.getByRole("button", { name: "Close", exact: true }).focus();
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Close vacancy" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Closed - not public" })).toBeVisible();
    await expect(page.getByText("The vacancy is closed", { exact: true })).toBeVisible();
    expect(jobStatus(toClose)).toBe("closed");
    expect(await offered(page)).toEqual(["Reopen"]);
    expect(statusAudit(toClose)).toEqual([{ actor_id: admin.id, metadata: { from: "open", to: "closed" } }]);

    await page.goto(jobUrl(acme.slug, toFill));
    await page.getByRole("button", { name: "Mark as filled", exact: true }).focus();
    await page.keyboard.press("Enter");
    const filled = page.getByRole("dialog", { name: "Mark this vacancy as filled?" });
    await expect(filled.getByText("This is final.", { exact: false })).toBeVisible();
    await filled.getByRole("button", { name: "Cancel" }).click();
    await expect(filled).toBeHidden();
    expect(jobStatus(toFill)).toBe("open");

    await page.getByRole("button", { name: "Mark as filled", exact: true }).click();
    await filled.getByRole("button", { name: "Mark as filled", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Filled - not public" })).toBeVisible();
    expect(await offered(page)).toEqual([]);
    expect(jobStatus(toFill)).toBe("filled");
    expect(statusAudit(toFill)).toEqual([{ actor_id: admin.id, metadata: { from: "open", to: "filled" } }]);
    await page.reload();
    expect(await offered(page)).toEqual([]);
    await expect(page.getByRole("link", { name: "Edit vacancy" })).toHaveCount(0);
  });

  test("FR-C2 AC9: closing or filling with applications in progress names them and links to them first, and changes none of them", async ({
    page,
  }) => {
    const acme = await newCompany();
    const busy = seedJob(acme, { title: "Busy welder", status: "open" });
    const decided = seedJob(acme, { title: "Decided welder", status: "open" });
    const candidates = await Promise.all(Array.from({ length: 6 }, () => newApplicant()));
    ["applied", "applied", "interview", "offer", "hired", "rejected"].forEach((status, index) =>
      seedApplication(candidates[index].id, busy, acme.id, { status }),
    );
    seedApplication(candidates[0].id, decided, acme.id, { status: "hired" });
    seedApplication(candidates[1].id, decided, acme.id, { status: "rejected" });
    const stages = (jobId: string) => applicationsOf(jobId).map(({ status }) => status);
    const queued = () =>
      query<{ n: number }>(
        `select (select count(*) from pgmq.q_notifications where message ->> 'user_id' = any (${literal(`{${candidates.map(({ id }) => id).join(",")}}`)}))
              + (select count(*) from public.notifications where user_id = any (${literal(`{${candidates.map(({ id }) => id).join(",")}}`)}::uuid[])) as n`,
      )[0].n;
    const queuedBefore = queued();
    const applicantsLink = `/en/org/${acme.slug}/applicants?job=${busy}`;

    await logIn(page, acme.owner, jobUrl(acme.slug, busy));
    await page.getByRole("button", { name: "Mark as filled", exact: true }).click();
    const fillDialog = page.getByRole("dialog", { name: "Mark this vacancy as filled?" });
    await expect(fillDialog.getByText("4 applications are still in progress.", { exact: true })).toBeVisible();
    await expect(fillDialog.getByRole("link", { name: "Review the applicants of this vacancy" })).toHaveAttribute("href", applicantsLink);
    await fillDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(fillDialog).toBeHidden();

    await page.getByRole("button", { name: "Close", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Close this vacancy?" });
    await expect(dialog.getByText("4 applications are still in progress.", { exact: true })).toBeVisible();
    const link = dialog.getByRole("link", { name: "Review the applicants of this vacancy" });
    await expect(link).toHaveAttribute("href", applicantsLink);
    await expectNoAxeViolations(page);
    await link.click();
    await expect(page).toHaveURL(applicantsLink);
    await expect(page.getByRole("main").getByRole("link", { name: "Busy welder" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Applicants" }).locator("tbody tr")).toHaveCount(6);
    expect(jobStatus(busy)).toBe("open");

    await page.goto(jobUrl(acme.slug, busy));
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.getByRole("button", { name: "Close vacancy" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Closed - not public" })).toBeVisible();
    expect(jobStatus(busy)).toBe("closed");
    expect(stages(busy)).toEqual(["applied", "applied", "interview", "offer", "hired", "rejected"]);

    await page.goto(jobUrl(acme.slug, decided));
    await page.getByRole("button", { name: "Mark as filled", exact: true }).click();
    const filled = page.getByRole("dialog", { name: "Mark this vacancy as filled?" });
    await expect(filled.getByText("This is final.", { exact: false })).toBeVisible();
    await expect(filled.getByText("still in progress", { exact: false })).toHaveCount(0);
    await filled.getByRole("button", { name: "Mark as filled", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Filled - not public" })).toBeVisible();
    expect(stages(decided)).toEqual(["hired", "rejected"]);
    expect(queued()).toBe(queuedBefore);
  });

  test("FR-C2 AC9: a paused vacancy with one application in progress names it before it is marked as filled", async ({ page }) => {
    const acme = await newCompany();
    const paused = seedJob(acme, { title: "Paused welder", status: "paused" });
    seedApplication((await newApplicant()).id, paused, acme.id, { status: "applied" });

    await logIn(page, acme.owner, jobUrl(acme.slug, paused));
    await page.getByRole("button", { name: "Mark as filled", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Mark this vacancy as filled?" });
    await expect(dialog.getByText("1 application is still in progress.", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Review the applicants of this vacancy" })).toHaveAttribute(
      "href",
      `/en/org/${acme.slug}/applicants?job=${paused}`,
    );
    await dialog.getByRole("button", { name: "Mark as filled", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Filled - not public" })).toBeVisible();
    expect(applicationsOf(paused).map(({ status }) => status)).toEqual(["applied"]);
  });

  test("FR-C2 AC7, AC1: the owner publishes, pauses and reopens, and the public page and the search follow at the next request", async ({
    page,
    browser,
  }) => {
    const acme = await newCompany();
    const marker = `zq${uniqueToken()}`;
    const title = `Lifecycle welder ${marker}`;
    const id = seedJob(acme, { title });
    const visitor = await browser.newContext();
    const anonymous = await visitor.newPage();
    const publicUrl = `/en/jobs/${id}`;
    const searchUrl = `/en/jobs?q=${marker}`;
    const listed = async () => {
      await anonymous.goto(searchUrl);
      await expect(anonymous.getByRole("heading", { name: "Find jobs", level: 1 })).toBeVisible();
      return anonymous.locator("ul:not([aria-label='Active filters']) > li").filter({ hasText: marker });
    };

    await logIn(page, acme.owner, jobUrl(acme.slug, id));
    await expect(page).toHaveURL(jobUrl(acme.slug, id));
    expect((await anonymous.goto(publicUrl))?.status()).toBe(404);
    await expect(await listed()).toHaveCount(0);

    await page.getByRole("button", { name: "Publish", exact: true }).dblclick();
    await expect(page.getByRole("status").filter({ hasText: "Open" })).toBeVisible();
    await expect(page.getByText("The vacancy is published", { exact: true })).toBeVisible();
    const response = await anonymous.goto(publicUrl);
    expect(response?.status()).toBe(200);
    await expect(anonymous.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(await listed()).toHaveCount(1);
    expect(statusAudit(id)).toHaveLength(1);

    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Paused - not public" })).toBeVisible();
    expect((await anonymous.goto(publicUrl))?.status()).toBe(404);
    await expect(anonymous.getByRole("heading", { name: UNAVAILABLE })).toBeVisible();
    await expect(await listed()).toHaveCount(0);
    await expect(anonymous.getByRole("heading", { name: "No vacancies match your search" })).toBeVisible();

    await page.getByRole("button", { name: "Reopen", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Open/ })).toBeVisible();
    expect((await anonymous.goto(publicUrl))?.status()).toBe(200);
    await expect(anonymous.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(await listed()).toHaveCount(1);

    expect(statusAudit(id).map(({ actor_id, metadata }) => [actor_id, metadata.from, metadata.to])).toEqual([
      [acme.owner.id, "draft", "open"],
      [acme.owner.id, "open", "paused"],
      [acme.owner.id, "paused", "open"],
    ]);
    await expectNoAxeViolations(page);
    await visitor.close();
  });

  test("FR-C2 AC11: a change from a stale page is refused as an invalid transition and says what the vacancy is now", async ({
    page,
    browser,
  }) => {
    const acme = await newCompany();
    const admin = await addCompanyUser(acme, "admin");
    const id = seedJob(acme, { title: "Contested welder", status: "open" });

    await logIn(page, acme.owner, jobUrl(acme.slug, id));
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    const other = await browser.newContext();
    const second = await other.newPage();
    await logIn(second, admin, jobUrl(acme.slug, id));
    await expect(second.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close vacancy" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Closed - not public" })).toBeVisible();

    await second.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(second.getByText("This vacancy was changed by someone else, reload. It is now Closed.", { exact: true })).toBeVisible();
    await expect(second.getByRole("status").filter({ hasText: "Closed - not public" })).toBeVisible();
    expect(jobStatus(id)).toBe("closed");
    expect(statusAudit(id)).toEqual([{ actor_id: acme.owner.id, metadata: { from: "open", to: "closed" } }]);
    await other.close();
  });

  test("FR-C2 AC4: when the organisation lapses its open vacancies are paused by the system, audited, and leave the public pages", async ({
    page,
  }) => {
    const acme = await newCompany();
    const open = seedJob(acme, { title: "Lapse open", status: "open" });
    const hidden = seedJob(acme, { title: "Lapse hidden", status: "open", moderation: "hidden" });
    const draft = seedJob(acme, { title: "Lapse draft" });

    execute(`select private.pause_jobs_on_lapse(${literal(acme.id)})`);
    expect([jobStatus(open), jobStatus(hidden), jobStatus(draft)]).toEqual(["paused", "paused", "draft"]);
    expect(statusAudit(open)).toEqual([{ actor_id: null, metadata: { from: "open", to: "paused", actor_fn: "pause_jobs_on_lapse" } }]);
    expect(statusAudit(draft)).toEqual([]);

    expect((await page.goto(`/en/jobs/${open}`))?.status()).toBe(404);
    await logIn(page, acme.owner, jobUrl(acme.slug, open));
    await expect(page.getByRole("status").filter({ hasText: "Paused - not public" })).toBeVisible();
    expect(await offered(page)).toEqual(["Reopen", "Close", "Mark as filled"]);
  });

  test("FR-C2 AC12: the list shows a skeleton while loading, the empty state by role, the date of the last change and the stale flag", async ({
    page,
    browser,
  }) => {
    const acme = await newCompany();
    const member = await addCompanyUser(acme, "member");

    await logIn(page, acme.owner, jobsUrl(acme.slug));
    await expect(page.getByRole("heading", { name: "No vacancies yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create vacancy" })).toBeVisible();
    const other = await browser.newContext();
    const memberPage = await other.newPage();
    await logIn(memberPage, member, jobsUrl(acme.slug));
    await expect(memberPage.getByRole("heading", { name: "No vacancies yet" })).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Create vacancy" })).toHaveCount(0);

    const stale = seedJob(acme, { title: "Stale welder", status: "open", statusChangedAt: "now() - interval '91 days'" });
    seedJob(acme, { title: "Fresh welder", status: "open", statusChangedAt: "now() - interval '89 days'" });
    seedJob(acme, { title: "Old paused welder", status: "paused", statusChangedAt: "now() - interval '200 days'" });
    await page.goto(jobsUrl(acme.slug));
    const rows = page.getByRole("listitem");
    await expect(rows.filter({ hasText: "Stale welder" })).toContainText("Open for more than 90 days");
    await expect(rows.filter({ hasText: "Stale welder" })).toContainText(`Status changed ${longDate(91)}`);
    await expect(rows.filter({ hasText: "Fresh welder" })).not.toContainText("more than 90 days");
    await expect(rows.filter({ hasText: "Old paused welder" })).not.toContainText("more than 90 days");
    await expect(rows.filter({ hasText: "Old paused welder" })).toContainText("Paused - not public");
    await expectNoAxeViolations(page);

    await page.goto(jobUrl(acme.slug, stale));
    await expect(page.getByRole("status").filter({ hasText: "Open for more than 90 days" })).toBeVisible();

    let release: () => void = () => undefined;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    await memberPage.route(/\/jobs\?_rsc=/, async (route) => {
      if (!route.request().headers()["next-router-prefetch"]) await delayed;
      await route.continue();
    });
    const prefetched = memberPage.waitForResponse(
      (response) => /\/jobs\?_rsc=/.test(response.url()) && response.request().headers()["next-router-prefetch"] === "1",
    );
    await memberPage.goto(`/en/dashboard/employer?org=${acme.slug}`);
    await prefetched;
    await memberPage.waitForLoadState("networkidle");
    await mainNavigation(memberPage).getByRole("link", { name: "Vacancies" }).click();
    await expect(memberPage.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
    release();
    await expect(memberPage.getByRole("listitem").filter({ hasText: "Stale welder" })).toBeVisible();
    await other.close();
  });
});
