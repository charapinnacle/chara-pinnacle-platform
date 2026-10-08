import type { Locator, Page } from "@playwright/test";
import { newApplicant, seedApplication } from "./applications";
import { renameCandidate, subscribe } from "./applicant-list";
import { addCompanyUser, newCompany, seedJob } from "./jobs";
import { waitForHydration } from "./hydration";
import { signInBrowser } from "./session";
import { expect } from "./test";
import type { Browser } from "@playwright/test";
import type { TestUser } from "./test-user";

export const bulkToolbar = (page: Page): Locator => page.getByRole("region", { name: "Bulk actions" });
export const reviewButton = (page: Page): Locator => bulkToolbar(page).getByRole("button", { name: "Review", exact: true });
export const bulkDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Review the bulk action" });
export const selectBox = (page: Page, name: string): Locator => page.getByRole("checkbox", { name: `Select ${name}`, exact: true });

// A company on employer_starter with one open vacancy, a member, and applicants who are real accounts (so that the
// status messages are queued), each with the given name and stage.
export async function setupBulk(applicants: [name: string, status: string][]) {
  const company = await newCompany();
  subscribe(company, "employer_starter");
  const member = await addCompanyUser(company, "member");
  const jobId = seedJob(company, { title: "Bulk welder", status: "open" });
  const people: Record<string, { user: TestUser; id: string }> = {};
  for (const [index, [name, status]] of applicants.entries()) {
    const user = await newApplicant();
    const id = seedApplication(user.id, jobId, company.id, { status, createdAt: `now() - interval '${applicants.length - index} hours'` });
    renameCandidate(id, name);
    people[name.split(" ")[0]] = { user, id };
  }
  return { company, member, jobId, people };
}

export async function openApplicants(browser: Browser, member: TestUser, url: string, ready: Locator | ((page: Page) => Locator)) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.8.7" } });
  await signInBrowser(context, member);
  const page = await context.newPage();
  await page.goto(url);
  await waitForHydration(typeof ready === "function" ? ready(page) : ready);
  return page;
}

export async function chooseBulk(page: Page, action: string, reason?: string, note?: string): Promise<void> {
  const toolbar = bulkToolbar(page);
  await toolbar.getByLabel("Action", { exact: true }).selectOption({ label: action });
  if (reason) await toolbar.getByLabel("Reason (visible to the candidate)", { exact: true }).selectOption({ label: reason });
  if (note) await toolbar.getByLabel(/^(Other reason|Note) \(visible to the candidate\)/).fill(note);
}

// A modal dialog (the native :modal state) makes the rest of the page inert and keeps the focus inside it.
export async function expectModal(dialog: Locator): Promise<void> {
  expect(await dialog.evaluate((element) => element.matches(":modal") && element.contains(document.activeElement))).toBe(true);
}
