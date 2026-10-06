import type { Page } from "@playwright/test";
import { userToken } from "./support/accounts";
import { expectNoAxeViolations } from "./support/axe";
import { seedDocument } from "./support/documents";
import { createCommittedUser } from "./support/login";
import { overflow } from "./support/login-page";
import { signIn } from "./support/passport";
import { accessLog, createEmployer, requestDocumentUrl, seedOpenings, seedShare } from "./support/privacy";
import { expect, test } from "./support/test";
import type { TestUser } from "./support/test-user";

const CV = "Amina Okafor CV 2026";
const CERTIFICATE = "Welding certificate";

const logRequests = (url: URL) => url.pathname === "/rest/v1/v_my_document_access_log";

async function openAccessLog(page: Page, user: TestUser) {
  await signIn(page, user);
  await page.goto("/en/passport");
  const section = page.locator("#access-log");
  await expect(section.getByRole("heading", { name: "Access log", level: 2 })).toBeVisible({ timeout: 15_000 });
  return section;
}

async function thirtyOpenings() {
  const worker = await createCommittedUser("worker");
  const cv = await seedDocument(worker.id, { title: CV });
  const certificate = await seedDocument(worker.id, { title: CERTIFICATE, type: "certificate" });
  const acme = await createEmployer("Acme Bau");
  const beta = await createEmployer("Beta Works");
  seedOpenings(worker.id, acme, seedShare(worker.id, acme.organizationId, [cv.id]), cv.id, Array.from({ length: 15 }, (_, i) => i + 1));
  seedOpenings(
    worker.id,
    beta,
    seedShare(worker.id, beta.organizationId, [certificate.id]),
    certificate.id,
    Array.from({ length: 15 }, (_, i) => i + 16),
  );
  return worker;
}

test.describe("document access log", () => {
  test("FR-B5 AC5: the passport page lists 25 openings newest first, the keyboard reaches page 2 with 5, and axe is clean", async ({ page }) => {
    const worker = await thirtyOpenings();
    const section = await openAccessLog(page, worker);

    await expect(section.getByRole("columnheader")).toHaveText(["Organisation", "Document", "Date and time", "Purpose", "Report"]);
    await expect(section.getByRole("rowheader")).toHaveCount(25);
    const firstPage = await section.getByRole("rowheader").allTextContents();
    expect(firstPage.slice(0, 15)).toEqual(Array(15).fill("Acme Bau"));
    expect(firstPage.slice(15)).toEqual(Array(10).fill("Beta Works"));
    const documents = await section.locator("tbody tr td:nth-child(2)").allTextContents();
    expect(documents).toEqual([...Array(15).fill(CV), ...Array(10).fill(CERTIFICATE)]);
    await expect(section.locator("tbody tr td:nth-child(4)").first()).toHaveText("Application review");

    const times = await section.locator("tbody time").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime") ?? ""));
    expect(times).toHaveLength(25);
    expect(times.map((time) => Date.parse(time))).toEqual([...times.map((time) => Date.parse(time))].sort((a, b) => b - a));
    await expect(section.locator("tbody time").first()).toHaveText(/^[A-Z][a-z]+ \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M UTC$/);
    await expectNoAxeViolations(page);

    await section.getByRole("button", { name: "Next page" }).focus();
    await page.keyboard.press("Enter");
    await expect(section.getByRole("rowheader")).toHaveCount(5);
    await expect(section.getByRole("rowheader")).toHaveText(Array(5).fill("Beta Works"));
    await expect(section.getByText("Page 2", { exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: "Next page" })).toHaveCount(0);
    await expect(section.locator('[tabindex="-1"]')).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(section.getByRole("link", { name: /^Report suspicious access/ }).first()).toBeFocused();
    await expectNoAxeViolations(page);

    await section.getByRole("button", { name: "Previous page" }).focus();
    await page.keyboard.press("Enter");
    await expect(section.getByRole("rowheader")).toHaveCount(25);
    await expect(section.getByText("Page 1", { exact: true })).toBeVisible();
  });

  test("FR-B5: the table has no horizontal scroll and no accessibility violation at 360 px", async ({ page }) => {
    const worker = await thirtyOpenings();
    await page.setViewportSize({ width: 360, height: 800 });
    const section = await openAccessLog(page, worker);
    await expect(section.getByRole("rowheader")).toHaveCount(25);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
  });

  test("FR-B5 AC6: the empty state, a skeleton while loading, and a toast with Retry when the request fails", async ({ page }) => {
    const worker = await createCommittedUser("worker");
    let release: () => void = () => undefined;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(logRequests, async (route) => {
      await delayed;
      await route.continue();
    });
    await signIn(page, worker);
    await page.goto("/en/passport");
    const section = page.locator("#access-log");
    await expect(section.getByRole("status")).toHaveText("Loading");
    release();
    await expect(section.getByRole("heading", { name: "No organisation has opened your documents yet" })).toBeVisible();
    await expect(section.getByRole("status")).toHaveCount(0);
    await expect(section.getByRole("table")).toHaveCount(0);
    await page.unroute(logRequests);

    await page.route(logRequests, (route) => route.abort());
    await page.reload();
    await expect(page.getByText("Could not load the access log", { exact: true })).toBeVisible();
    await expect(section.getByRole("heading", { name: "Your access log could not be loaded" })).toBeVisible();
    await page.unroute(logRequests);
    await section.getByRole("button", { name: "Retry" }).click();
    await expect(section.getByRole("heading", { name: "No organisation has opened your documents yet" })).toBeVisible();
  });

  test("FR-B5 AC7: the entry of a document the candidate deleted stays, shown as Deleted document", async ({ page }) => {
    const worker = await createCommittedUser("worker");
    const cv = await seedDocument(worker.id, { title: CV });
    const employer = await createEmployer("Acme Bau");
    seedOpenings(worker.id, employer, seedShare(worker.id, employer.organizationId, [cv.id]), cv.id, [5]);
    const section = await openAccessLog(page, worker);
    await expect(section.getByRole("rowheader")).toHaveText(["Acme Bau"]);
    await expect(section.locator("tbody td").first()).toHaveText(CV);

    await page.goto("/en/passport");
    await page.getByRole("button", { name: `Delete ${CV}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByText("Document deleted", { exact: true })).toBeVisible();
    await page.reload();
    await expect(section.getByRole("rowheader")).toHaveText(["Acme Bau"]);
    await expect(section.locator("tbody td").first()).toHaveText("Deleted document");
  });

  test("FR-B5 AC10: Report suspicious access opens the complaints page and sends nothing that writes", async ({ page, context }) => {
    const worker = await createCommittedUser("worker");
    const cv = await seedDocument(worker.id, { title: CV });
    const employer = await createEmployer("Acme Bau");
    seedOpenings(worker.id, employer, seedShare(worker.id, employer.organizationId, [cv.id]), cv.id, [5]);
    const section = await openAccessLog(page, worker);

    const writes: string[] = [];
    context.on("request", (request) => {
      if (request.method() !== "GET") writes.push(`${request.method()} ${request.url()}`);
    });
    const link = section.getByRole("link", { name: `Report suspicious access to ${CV} by Acme Bau (opens in a new tab)` });
    await expect(link).toHaveAttribute("href", "/en/legal/complaints-and-dispute-process");
    const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
    await popup.waitForLoadState();
    expect(new URL(popup.url()).pathname).toBe("/en/legal/complaints-and-dispute-process");
    await expect(popup.getByRole("heading", { level: 1 })).toHaveText(/Complaints and Dispute Process/i);
    expect((await page.request.get("/en/legal/complaints-and-dispute-process")).status()).toBe(200);
    expect(writes).toEqual([]);
  });

  test("FR-B5 AC8 and the download KPI: an organisation's opening appears on the page, the owner's own download is logged but not listed", async ({ page }) => {
    const worker = await createCommittedUser("worker");
    const cv = await seedDocument(worker.id, { title: CV });
    const employer = await createEmployer("Acme Bau");
    const stranger = await createEmployer("Beta Works");
    const share = seedShare(worker.id, employer.organizationId, [cv.id]);

    expect((await requestDocumentUrl(await userToken(employer.member), cv.id)).status).toBe(200);
    expect((await requestDocumentUrl(await userToken(employer.owner), cv.id)).status).toBe(200);
    expect((await requestDocumentUrl(await userToken(stranger.member), cv.id)).status).toBe(403);
    expect(accessLog(cv.id).map((row) => [row.share_id, row.organization_id, row.purpose])).toEqual([
      [share, employer.organizationId, "application_review"],
      [share, employer.organizationId, "application_review"],
    ]);

    const section = await openAccessLog(page, worker);
    await expect(section.getByRole("rowheader")).toHaveText(["Acme Bau", "Acme Bau"]);
    await expect(section.locator("tbody td:nth-child(2)")).toHaveText([CV, CV]);

    await page.getByRole("button", { name: `Download ${CV}` }).focus();
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    expect(download.suggestedFilename()).toBe("My_CV__final_.pdf");
    expect(accessLog(cv.id).map((row) => [row.share_id, row.organization_id, row.accessed_by, row.purpose])).toEqual([
      [share, employer.organizationId, employer.member.id, "application_review"],
      [share, employer.organizationId, employer.owner.id, "application_review"],
      [null, null, worker.id, "owner_download"],
    ]);
    await page.reload();
    await expect(section.getByRole("rowheader")).toHaveText(["Acme Bau", "Acme Bau"]);
  });
});
