import type { Browser, Page } from "@playwright/test";
import { expectAccessibleAtBothWidths, newApplicant, seedApplication } from "./support/applications";
import { statusMessages } from "./support/applicants";
import {
  applicantsUrl,
  boardColumn,
  columnCounts,
  dragCard,
  eventCount,
  renameCandidate,
  seedListApplicant,
  statusOf,
  subscribe,
} from "./support/applicant-list";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany, seedJob, type Company } from "./support/jobs";
import { overflow } from "./support/login-page";
import { signInBrowser } from "./support/session";
import { runAs } from "./support/visibility";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

const AT = "2026-09-04T10:00:00Z";

// A browser context of a member of the company on the board of the vacancy.
async function openBoard(browser: Browser, company: Company, job: string, member?: TestUser): Promise<{ page: Page; user: TestUser }> {
  const user = member ?? (await addCompanyUser(company, "member"));
  const context = await browser.newContext();
  await signInBrowser(context, user);
  const page = await context.newPage();
  await page.goto(applicantsUrl(company.slug, `?job=${job}&view=board`));
  await waitForHydration(page.getByRole("region", { name: "Pipeline board" }));
  return { page, user };
}

// A page that never polls, so that a test decides when it sees another member's move.
async function neverPolls(page: Page): Promise<void> {
  await page.addInitScript(() => Object.defineProperty(document, "visibilityState", { get: () => "hidden" }));
}

const move = async (page: Page, name: string, target: string) => {
  await page.getByRole("button", { name: `Move ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: target, exact: true }).click();
};

const eventsOf = (id: string) =>
  query<{ from_status: string | null; to_status: string; actor_id: string | null }>(
    `select from_status::text, to_status::text, actor_id from public.application_events where application_id = ${literal(id)} order by id`,
  );

const messagesOf = (id: string) =>
  query<{ user_id: string; status: string }>(
    `select message ->> 'user_id' as user_id, message ->> 'status' as status from pgmq.q_notifications
     where message ->> 'kind' = 'status_changed' and message ->> 'application_id' = ${literal(id)}`,
  );

test.describe("the pipeline board", () => {
  test("FR-E1 AC3: eight columns with the count of each, and another member's move arrives without a reload", async ({ browser }) => {
    test.setTimeout(90_000);
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const job = seedJob(company, { title: "Board welder", status: "open" });
    const stages = ["applied", "applied", "viewed", "shortlisted", "shortlisted", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"];
    const ids = stages.map((status, index) =>
      seedListApplicant(company, job, { name: `Cand ${index + 1}`, status, appliedAt: `2026-09-0${(index % 9) + 1}T10:00:00Z`, completeness: 50 + index }),
    );
    const m1 = await openBoard(browser, company, job);
    const m2 = await openBoard(browser, company, job);

    const headings = m1.page.getByRole("region", { name: "Pipeline board" }).getByRole("heading", { level: 2 });
    await expect(headings).toHaveText(["Applied2", "Viewed1", "Shortlisted3", "Interview1", "Offer1", "Hired1", "Not selected1", "Withdrawn1"]);
    for (const [stage, count] of [["Applied", 2], ["Shortlisted", 3], ["Hired", 1]] as const) {
      await expect(boardColumn(m1.page, stage).getByRole("listitem")).toHaveCount(count);
    }
    await m1.page.goto(applicantsUrl(company.slug, `?job=${job}&stage=shortlisted`));
    await expect(m1.page.getByRole("table").locator("tbody tr")).toHaveCount(3);
    await m1.page.goto(applicantsUrl(company.slug, `?job=${job}&view=board`));
    await waitForHydration(m1.page.getByRole("region", { name: "Pipeline board" }));
    await m1.page.evaluate(() => Object.assign(window, { sameDocument: true }));

    await move(m2.page, "Cand 1", "Interview");
    await expect(boardColumn(m2.page, "Interview").getByRole("listitem")).toHaveCount(2);
    await expect.poll(() => columnCounts(m1.page), { timeout: 10_000 }).toMatchObject({ Applied: "1", Interview: "2" });
    await expect(boardColumn(m1.page, "Interview").getByRole("link", { name: "Cand 1" })).toBeVisible();
    expect(await m1.page.evaluate(() => "sameDocument" in window)).toBe(true);
    expect(statusOf(ids[0])).toBe("interview");
  });

  test("FR-E1 AC4: a move from the menu or by dragging records one event, tells the candidate and works on a paused vacancy", async ({ browser }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const job = seedJob(company, { title: "Paused welder", status: "paused" });
    const ana = await newApplicant();
    const ben = await newApplicant();
    const chi = await newApplicant();
    const anaId = seedApplication(ana.id, job, company.id, { createdAt: "now() - interval '3 hours'" });
    const benId = seedApplication(ben.id, job, company.id, { createdAt: "now() - interval '2 hours'" });
    const chiId = seedApplication(chi.id, job, company.id, { createdAt: "now() - interval '1 hour'" });
    renameCandidate(anaId, "Ana Silva");
    renameCandidate(benId, "Ben Okoro");
    renameCandidate(chiId, "Chi Wei");
    const { page, user: m1 } = await openBoard(browser, company, job);
    await neverPolls(page);
    await page.reload();
    await waitForHydration(page.getByRole("region", { name: "Pipeline board" }));

    await expect(boardColumn(page, "Applied").getByText("New", { exact: true })).toHaveCount(3);
    await page.getByRole("button", { name: "Move Ana Silva", exact: true }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Shortlisted", "Interview", "Not selected"]);
    await page.getByRole("menuitem", { name: "Interview", exact: true }).click();

    await expect(boardColumn(page, "Interview").getByRole("link", { name: "Ana Silva" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Ana Silva moved to Interview" })).toBeAttached();
    expect(await columnCounts(page)).toMatchObject({ Applied: "2", Interview: "1" });
    await expect(boardColumn(page, "Interview").getByText("New", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Stage changed to Interview", { exact: true })).toBeVisible();
    await page.reload();
    expect(await columnCounts(page)).toMatchObject({ Applied: "2", Interview: "1" });
    expect(eventsOf(anaId)).toEqual([
      { from_status: null, to_status: "applied", actor_id: ana.id },
      { from_status: "applied", to_status: "interview", actor_id: m1.id },
    ]);
    expect(messagesOf(anaId)).toEqual([{ user_id: ana.id, status: "interview" }]);
    expect(statusMessages(anaId).every((message) => message.user_id === ana.id)).toBe(true);

    await waitForHydration(page.getByRole("region", { name: "Pipeline board" }));
    await dragCard(page, "Ben Okoro", "Interview");
    await expect(boardColumn(page, "Interview").getByRole("link", { name: "Ben Okoro" })).toBeVisible();
    await expect.poll(() => statusOf(benId)).toBe("interview");
    expect(eventsOf(benId).map((event) => event.to_status)).toEqual(["applied", "interview"]);
    expect(messagesOf(benId)).toEqual([{ user_id: ben.id, status: "interview" }]);

    await move(page, "Chi Wei", "Not selected");
    const dialog = page.getByRole("dialog", { name: "Not selected" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("New stage")).toHaveValue("rejected");
    expect(statusOf(chiId)).toBe("applied");
    expect(eventCount(chiId)).toBe(1);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(statusOf(chiId)).toBe("applied");

    await dragCard(page, "Chi Wei", "Not selected");
    await expect(dialog).toBeVisible();
    expect(statusOf(chiId)).toBe("applied");
    await dialog.getByRole("button", { name: "Review" }).click();
    await expect(dialog.getByRole("alert").first()).toContainText("Choose a reason");
    expect(statusOf(chiId)).toBe("applied");
    await dialog.getByLabel("Reason (visible to the candidate)", { exact: true }).selectOption({ label: "Position filled" });
    await dialog.getByRole("button", { name: "Review" }).click();
    await expect(dialog.getByText("Position filled", { exact: true })).toBeVisible();
    expect(statusOf(chiId)).toBe("applied");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(boardColumn(page, "Not selected").getByRole("link", { name: "Chi Wei" })).toBeVisible();
    expect(statusOf(chiId)).toBe("rejected");
    expect(messagesOf(chiId)).toEqual([{ user_id: chi.id, status: "rejected" }]);
  });

  test("FR-E1 AC5: a stale move is refused, final cards stay put and columns that do not accept a card ignore it", async ({ browser }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const job = seedJob(company, { title: "Stale welder", status: "open" });
    const ben = await newApplicant();
    const benId = seedApplication(ben.id, job, company.id, { createdAt: "now() - interval '2 hours'" });
    renameCandidate(benId, "Ben Okoro");
    const dev = seedListApplicant(company, job, { name: "Dev Rao", status: "hired", appliedAt: AT, completeness: 90 });
    const eve = seedListApplicant(company, job, { name: "Eve Ng", status: "rejected", appliedAt: AT, completeness: 60 });
    const fay = seedListApplicant(company, job, { name: "Fay Lo", status: "withdrawn", appliedAt: AT, completeness: 40 });
    const gus = seedListApplicant(company, job, { name: "Gus Ode", status: "applied", appliedAt: AT, completeness: 40 });
    const first = await openBoard(browser, company, job);
    await neverPolls(first.page);
    await first.page.reload();
    await waitForHydration(first.page.getByRole("region", { name: "Pipeline board" }));
    const second = await openBoard(browser, company, job);
    await move(second.page, "Ben Okoro", "Interview");
    await expect.poll(() => statusOf(benId)).toBe("interview");
    const eventsBefore = eventsOf(benId);
    const messagesBefore = messagesOf(benId);

    await expect(boardColumn(first.page, "Applied").getByRole("link", { name: "Ben Okoro" })).toBeVisible();
    await dragCard(first.page, "Ben Okoro", "Shortlisted");
    await expect(first.page.getByText("The stage was not changed", { exact: true })).toBeVisible();
    await expect(first.page.getByText("This applicant was already moved. Reload to see the current stage", { exact: true })).toBeVisible();
    await expect(boardColumn(first.page, "Interview").getByRole("link", { name: "Ben Okoro" })).toBeVisible();
    await expect(boardColumn(first.page, "Shortlisted").getByRole("link", { name: "Ben Okoro" })).toHaveCount(0);
    expect(statusOf(benId)).toBe("interview");
    expect(eventsOf(benId)).toEqual(eventsBefore);
    expect(messagesOf(benId)).toEqual(messagesBefore);

    for (const name of ["Dev Rao", "Eve Ng", "Fay Lo"]) {
      const card = first.page.getByRole("listitem").filter({ hasText: name });
      await expect(card).toHaveAttribute("draggable", "false");
      await expect(card.getByRole("button", { name: `Move ${name}` })).toHaveCount(0);
    }
    await dragCard(first.page, "Dev Rao", "Interview");
    await dragCard(first.page, "Gus Ode", "Viewed");
    await dragCard(first.page, "Gus Ode", "Withdrawn");
    await dragCard(first.page, "Gus Ode", "Hired");
    await first.page.waitForTimeout(500);
    await expect(boardColumn(first.page, "Applied").getByRole("link", { name: "Gus Ode" })).toBeVisible();
    for (const [id, status] of [[dev, "hired"], [eve, "rejected"], [fay, "withdrawn"], [gus, "applied"]] as const) {
      expect(statusOf(id)).toBe(status);
      expect(eventCount(id)).toBe(1);
      expect(messagesOf(id)).toEqual([]);
    }
  });

  test("FR-E1 AC6: the board works with the keyboard at 360 px, announces a move and keeps focus on the card", async ({ browser }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const job = seedJob(company, { title: "Keyboard welder", status: "open" });
    const ana = seedListApplicant(company, job, { name: "Ana Silva", status: "applied", appliedAt: AT, completeness: 80, documents: 1 });
    seedListApplicant(company, job, { name: "Ben Okoro", status: "shortlisted", appliedAt: "2026-09-03T10:00:00Z", completeness: 55 });
    const { page } = await openBoard(browser, company, job);
    await neverPolls(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.reload();
    const region = page.getByRole("region", { name: "Pipeline board" });
    await waitForHydration(region);

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect(page.getByRole("navigation", { name: "View" })).toBeVisible();
    await expect(page.getByRole("link", { name: "List", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move Ben Okoro", exact: true })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 360, height: 800 });

    const trigger = page.getByRole("button", { name: "Move Ana Silva", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Move Ana Silva to" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Shortlisted" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(statusOf(ana)).toBe("applied");

    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Interview" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Shortlisted" })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("menuitem", { name: "Interview" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(boardColumn(page, "Interview").getByRole("link", { name: "Ana Silva" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Ana Silva moved to Interview" })).toBeAttached();
    await expect(page.getByRole("button", { name: "Move Ana Silva", exact: true })).toBeFocused();
    expect(statusOf(ana)).toBe("interview");
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-E1 AC12: a lapsed organisation reads the board and the list, a move made on an old page is refused and nothing changes", async ({ browser }) => {
    const company = await newCompany();
    subscribe(company, "employer_starter");
    const job = seedJob(company, { title: "Lapsed welder", status: "paused" });
    const ids = [
      seedListApplicant(company, job, { name: "Ana Silva", status: "applied", appliedAt: AT, completeness: 80 }),
      seedListApplicant(company, job, { name: "Ben Okoro", status: "shortlisted", appliedAt: AT, completeness: 55 }),
      seedListApplicant(company, job, { name: "Chi Wei", status: "interview", appliedAt: AT, completeness: 70 }),
      seedListApplicant(company, job, { name: "Dev Rao", status: "hired", appliedAt: AT, completeness: 90 }),
      seedListApplicant(company, job, { name: "Eve Ng", status: "rejected", appliedAt: AT, completeness: 60 }),
    ];
    const { page, user } = await openBoard(browser, company, job);
    await neverPolls(page);
    await page.reload();
    await waitForHydration(page.getByRole("region", { name: "Pipeline board" }));
    const banner = page.getByRole("status").filter({ hasText: "Applicant changes and the CSV export are disabled until a plan is chosen." });
    await expect(banner).toHaveCount(0);

    execute(`update billing.subscriptions set status = 'canceled' where organization_id = ${literal(company.id)}`);
    await move(page, "Ana Silva", "Interview");
    await expect(page.getByText("Your organization has no active paid plan, so stages cannot be changed.", { exact: true })).toBeVisible();
    await expect(banner).toBeVisible();
    await expect(boardColumn(page, "Applied").getByRole("link", { name: "Ana Silva" })).toBeVisible();
    expect(statusOf(ids[0])).toBe("applied");
    expect(eventCount(ids[0])).toBe(1);
    expect(messagesOf(ids[0])).toEqual([]);

    expect(await columnCounts(page)).toMatchObject({ Applied: "1", Shortlisted: "1", Interview: "1", Hired: "1", "Not selected": "1" });
    await expect(boardColumn(page, "Applied").getByText("New", { exact: true })).toBeVisible();
    for (const name of ["Ana Silva", "Ben Okoro", "Chi Wei"]) {
      await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveAttribute("draggable", "false");
      await expect(page.getByRole("button", { name: `Move ${name}`, exact: true })).toBeDisabled();
    }
    await dragCard(page, "Ana Silva", "Interview");
    await page.waitForTimeout(500);
    expect(statusOf(ids[0])).toBe("applied");
    expect(runAs(user.id, `select public.set_application_status(${literal(ids[0])}, 'interview');`)).toContain("CHARA_FEATURE_NOT_IN_PLAN");
    expect(eventCount(ids[0])).toBe(1);

    await page.goto(applicantsUrl(company.slug, `?job=${job}`));
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(5);
    await expect(banner).toBeVisible();
    await expect(page.getByText("New", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });
});
