import type { Page } from "@playwright/test";
import { execute, literal } from "./support/db";
import {
  APPLICATIONS_URL,
  applicationUrl,
  displayName,
  expectAccessibleAtBothWidths,
  newApplicant,
  seedApplication,
  seedEvent,
  seedManyApplications,
} from "./support/applications";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { enrollTotp } from "./support/login";
import { logIn } from "./support/login-page";
import { enterCode, staffUser } from "./support/mfa";
import { expect, test } from "./support/test";

const STAGES = [
  ["applied", "Applied"],
  ["viewed", "Viewed"],
  ["shortlisted", "Shortlisted"],
  ["interview", "Interview"],
  ["offer", "Offer"],
  ["hired", "Hired"],
  ["rejected", "Not selected"],
  ["withdrawn", "Withdrawn"],
] as const;

const rows = (page: Page) => page.locator("main ul > li");
const stageFilter = (page: Page) => page.getByLabel("Filter by stage");

async function hasFocusRing(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.activeElement ?? document.body);
    return style.outlineStyle !== "none" || style.boxShadow !== "none";
  });
}

async function applicantWithEveryStage() {
  const company = await newCompany();
  const candidate = await newApplicant();
  const ids: Record<string, string> = {};
  for (const [status, label] of STAGES) {
    const jobId = seedJob(company, { title: `Stage ${label} welder`, status: "open" });
    ids[status] = seedApplication(candidate.id, jobId, company.id, { status, createdAt: `now() - interval '${STAGES.length} days'` });
  }
  return { company, candidate, ids };
}

test.describe("the candidate's journey tracker", () => {
  test("FR-D3 AC1, AC6: the list and the page show the stage, the events oldest first, the employer's message and the next step, and no employer identity", async ({
    page,
  }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    execute(`update public.profiles set display_name = 'Hidden Recruiter Name' where id = ${literal(member.id)}`);
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Welder", status: "open" });
    const id = seedApplication(candidate.id, jobId, company.id, { status: "shortlisted", createdAt: "'2026-10-28T09:00:00Z'" });
    seedEvent(id, { from: "viewed", to: "shortlisted", actorId: member.id, note: "We will call you next week", at: "2026-11-01T09:00:00Z" });
    seedEvent(id, { from: "applied", to: "viewed", at: "2026-10-29T09:00:00Z" });

    const seen: string[] = [];
    page.on("response", async (response) => {
      if (response.url().includes("/en/applications")) seen.push(await response.text().catch(() => ""));
    });
    await logIn(page, candidate, APPLICATIONS_URL);

    const row = rows(page).filter({ hasText: "Welder" });
    await expect(row).toContainText("Welder");
    await expect(row).toContainText(displayName(company.id));
    await expect(row).toContainText("Shortlisted");
    await expect(row).toContainText("Applied 28 Oct 2026");
    await expect(row).toContainText("Last update 1 Nov 2026");
    await row.getByRole("link", { name: "Welder" }).click();

    await expect(page).toHaveURL(applicationUrl(id));
    await expect(page.locator("div:has(> dt:text-is('Stage')) > dd")).toHaveText("Shortlisted");
    const events = page.getByRole("region", { name: "Timeline" }).getByRole("listitem");
    await expect(events).toHaveCount(3);
    await expect(events.nth(0)).toContainText("Applied 28 Oct 2026");
    await expect(events.nth(0)).toContainText("By you");
    await expect(events.nth(1)).toContainText("Viewed 29 Oct 2026");
    await expect(events.nth(1)).toContainText("Automatic");
    await expect(events.nth(2)).toContainText("Shortlisted 1 Nov 2026");
    await expect(events.nth(2)).toContainText("By the employer");
    await expect(events.nth(2).getByText("Message from the employer")).toBeVisible();
    await expect(events.nth(2)).toContainText("We will call you next week");
    const next = page.getByRole("region", { name: "What usually happens next" });
    await expect(next).toContainText("The employer has put you on their shortlist.");

    const html = await page.content();
    const payload = await (await page.request.get(applicationUrl(id), { headers: { rsc: "1" } })).text();
    for (const text of [html, payload, ...seen]) {
      expect(text).not.toContain(member.id);
      expect(text).not.toContain(member.email);
      expect(text).not.toContain("Hidden Recruiter Name");
    }
    expect(html).toContain(displayName(company.id));
    expect(html).not.toContain(company.owner.id);
  });

  test("FR-D3 AC2: the stage filter writes the address, survives a reload, offers every stage and works with the keyboard", async ({ page }) => {
    const { candidate } = await applicantWithEveryStage();
    await logIn(page, candidate, APPLICATIONS_URL);
    await expect(rows(page)).toHaveCount(8);
    await waitForHydration(stageFilter(page));
    await expect(stageFilter(page).locator("option")).toHaveText(["All stages", ...STAGES.map(([, label]) => label)]);

    await stageFilter(page).selectOption({ label: "Interview" });
    await expect(page).toHaveURL(`${APPLICATIONS_URL}?stage=interview`);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("Stage Interview welder");
    await page.reload();
    await expect(page).toHaveURL(`${APPLICATIONS_URL}?stage=interview`);
    await expect(rows(page)).toHaveCount(1);
    await expect(stageFilter(page)).toHaveValue("interview");

    await stageFilter(page).selectOption({ label: "All stages" });
    await expect(page).toHaveURL(APPLICATIONS_URL);
    await expect(rows(page)).toHaveCount(8);

    await page.goto(`${APPLICATIONS_URL}?stage=foo`);
    await expect(rows(page)).toHaveCount(8);
    await expect(stageFilter(page)).toHaveValue("");

    await page.goto(APPLICATIONS_URL);
    await waitForHydration(stageFilter(page));
    await stageFilter(page).focus();
    await page.keyboard.type("Hired");
    await expect(page).toHaveURL(`${APPLICATIONS_URL}?stage=hired`);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("Hired");
  });

  test("FR-D3 AC3: the empty states, and a skeleton that the server sends before the list", async ({ page }) => {
    const fresh = await newApplicant();
    await logIn(page, fresh, APPLICATIONS_URL);
    await expect(page.getByRole("heading", { name: "You have not applied to any vacancy yet", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find vacancies" })).toHaveAttribute("href", "/en/jobs");
    await expect(stageFilter(page)).toHaveCount(0);

    const company = await newCompany();
    const candidate = await newApplicant();
    seedApplication(candidate.id, seedJob(company, { title: "Streamed welder", status: "open" }), company.id);
    await page.context().clearCookies();
    await logIn(page, candidate, APPLICATIONS_URL);
    await expect(rows(page)).toHaveCount(1);
    const html = await (await page.request.get(APPLICATIONS_URL)).text();
    const skeleton = html.indexOf('<span class="sr-only">Loading</span>');
    expect(skeleton).toBeGreaterThan(-1);
    expect(html.indexOf("Streamed welder")).toBeGreaterThan(skeleton);

    await page.goto(`${APPLICATIONS_URL}?stage=hired`);
    await expect(page.getByRole("heading", { name: "No applications in this stage", level: 2 })).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filter" }).click();
    await expect(page).toHaveURL(APPLICATIONS_URL);
    await expect(rows(page)).toHaveCount(1);
  });

  test("FR-D3 AC9: Withdraw application is offered for the five open stages only, and the vacancy link only for an open vacancy", async ({
    page,
  }) => {
    const { company, candidate, ids } = await applicantWithEveryStage();
    const paused = seedApplication(candidate.id, seedJob(company, { title: "Paused welder", status: "paused" }), company.id);
    await logIn(page, candidate, APPLICATIONS_URL);
    await expect(rows(page)).toHaveCount(9);

    for (const [status, label] of STAGES) {
      await page.goto(applicationUrl(ids[status]));
      await expect(page.locator("div:has(> dt:text-is('Stage')) > dd")).toHaveText(label);
      const offered = ["applied", "viewed", "shortlisted", "interview", "offer"].includes(status);
      await expect(page.getByRole("button", { name: "Withdraw application" }), status).toHaveCount(offered ? 1 : 0);
      await expect(page.getByRole("link", { name: "View the vacancy" }), status).toHaveCount(1);
    }
    await page.goto(applicationUrl(paused));
    await expect(page.getByRole("heading", { name: "Paused welder", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "View the vacancy" })).toHaveCount(0);
    const withdraw = page.getByRole("button", { name: "Withdraw application" });
    await expect(withdraw).toHaveCount(1);
    await expect(withdraw).toBeDisabled();
    await expect(withdraw).toHaveAccessibleDescription("Withdrawing will be available soon.");
  });

  test("FR-D3 AC1: a decline shows the employer's reason on the Not selected event", async ({ page }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Declined welder", status: "open" });
    const id = seedApplication(candidate.id, jobId, company.id, { status: "rejected", createdAt: "'2026-10-28T09:00:00Z'" });
    seedEvent(id, { from: "applied", to: "rejected", actorId: member.id, note: "Position filled", at: "2026-10-30T09:00:00Z" });
    await logIn(page, candidate, applicationUrl(id));

    const declined = page.getByRole("region", { name: "Timeline" }).getByRole("listitem").nth(1);
    await expect(declined).toContainText("Not selected 30 Oct 2026");
    await expect(declined.getByText("Message from the employer")).toBeVisible();
    await expect(declined).toContainText("Position filled");
    await expect(page.getByRole("region", { name: "What usually happens next" })).toContainText("You were not selected");
  });

  test("FR-D3 AC10: the list pages by 20, 20 and 5, ordered by the latest event, with a labelled pager", async ({ page }) => {
    const company = await newCompany();
    const candidate = await newApplicant();
    seedManyApplications(candidate.id, company, 45);
    await logIn(page, candidate, APPLICATIONS_URL);

    await expect(rows(page)).toHaveCount(20);
    await expect(rows(page).first()).toContainText("Listed welder 1");
    await expect(rows(page).last()).toContainText("Listed welder 20");
    const pager = page.getByRole("navigation", { name: "Pagination" });
    await expect(pager).toContainText("Page 1");
    await expect(pager.getByRole("link", { name: "Previous page" })).toHaveCount(0);

    await pager.getByRole("link", { name: "Next page" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${APPLICATIONS_URL}?page=2`);
    await expect(rows(page)).toHaveCount(20);
    await expect(rows(page).first()).toContainText("Listed welder 21");
    await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Next page" }).click();
    await expect(page).toHaveURL(`${APPLICATIONS_URL}?page=3`);
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).last()).toContainText("Listed welder 45");
    await expect(page.getByRole("link", { name: "Next page" })).toHaveCount(0);
    await page.getByRole("link", { name: "Previous page" }).click();
    await expect(page).toHaveURL(`${APPLICATIONS_URL}?page=2`);

    await page.goto(`${APPLICATIONS_URL}?page=9`);
    await expect(page.getByRole("heading", { name: "No more applications on this page", level: 2 })).toBeVisible();
    await page.goto(`${APPLICATIONS_URL}?page=0`);
    await expect(rows(page)).toHaveCount(20);
    await expect(rows(page).first()).toContainText("Listed welder 1");
  });

  test("FR-D3 AC11: a visitor is sent to log in, an employer to the employer dashboard and platform staff to the administration", async ({
    page,
  }) => {
    const company = await newCompany();
    const candidate = await newApplicant();
    const id = seedApplication(candidate.id, seedJob(company, { title: "Guarded welder", status: "open" }), company.id);
    const paths = [APPLICATIONS_URL, applicationUrl(id), applicationUrl("6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11")];

    for (const path of paths) {
      await page.goto(path);
      await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(path)}`);
    }

    await logIn(page, await addCompanyUser(company, "member"));
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    for (const path of paths) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
      await expect(page.getByText("Guarded welder")).toHaveCount(0);
    }

    await page.context().clearCookies();
    const staff = await staffUser("trust_safety");
    const secret = await enrollTotp(staff);
    await logIn(page, staff);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    for (const path of paths) {
      await page.goto(path);
      await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/admin")}`);
      await expect(page.getByText("Guarded welder")).toHaveCount(0);
    }
    await enterCode(page, secret);
    await expect(page).toHaveURL(/\/en\/admin$/);
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    await expect(page.getByText("Guarded welder")).toHaveCount(0);
  });

  test("FR-D3 AC12: the list and the page have no accessibility violation and no horizontal scroll at 360 px, and the keyboard reaches the controls", async ({
    page,
  }) => {
    const { candidate, ids } = await applicantWithEveryStage();
    await logIn(page, candidate, APPLICATIONS_URL);
    await expect(rows(page)).toHaveCount(8);
    await waitForHydration(stageFilter(page));
    for (const [, label] of STAGES) await expect(rows(page).filter({ hasText: label }).first()).toContainText(label);
    await expectAccessibleAtBothWidths(page);

    const focused = async (selector: string): Promise<boolean> => {
      for (let press = 0; press < 30; press += 1) {
        await page.keyboard.press("Tab");
        if (await page.evaluate((css) => document.activeElement?.matches(css) ?? false, selector)) return true;
      }
      return false;
    };
    expect(await focused("select")).toBe(true);
    expect(await hasFocusRing(page)).toBe(true);
    expect(await focused("main ul > li a")).toBe(true);
    expect(await hasFocusRing(page)).toBe(true);

    await page.goto(applicationUrl(ids.interview));
    await expect(page.getByRole("heading", { name: "What usually happens next", level: 2 })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
  });
});
