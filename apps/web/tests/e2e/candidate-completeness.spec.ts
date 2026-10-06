import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { documentRows, openDocuments, pdfBytes, runScanDocument, seedDocument } from "./support/documents";
import { createCommittedUser } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import { messageCount } from "./support/mailpit";
import { seedAllButCv, seedOccupationAndSkills, signIn } from "./support/passport";
import { computeCompleteness } from "@/lib/passport/completeness";

const banner = (page: Page) => page.getByRole("note", { name: "Complete your passport" });
const meter = (page: Page) => page.getByRole("progressbar", { name: "Passport completeness" });

async function expectMeter(page: Page, percent: number, next: string | null): Promise<void> {
  await expect(page.getByText(`${percent}% complete`, { exact: true })).toBeVisible();
  await expect(meter(page)).toHaveAttribute("value", String(percent));
  if (next) await expect(page.getByText("Next:")).toContainText(next);
  else await expect(page.getByText("Next:")).toHaveCount(0);
}

test.describe("candidate passport: completeness", () => {
  test("FR-B4 AC8: the nudge shows below 60 percent on the passport and the dashboard, not from 60 percent", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    seedOccupationAndSkills(user.id);
    await seedDocument(user.id, { title: "My CV", object: false });
    await signIn(page, user);

    await expectMeter(page, 55, "Languages");
    await expect(banner(page)).toBeVisible();
    await expect(page.getByRole("link", { name: "Languages" })).toHaveAttribute("href", "/en/passport#languages");

    await page.goto("/en/passport");
    await expectMeter(page, 55, "Languages");
    await expect(banner(page)).toBeVisible();
    await page.getByRole("link", { name: "Languages" }).click();
    await expect(page).toHaveURL(/\/en\/passport#languages$/);

    await page.getByLabel("Headline", { exact: true }).fill("Electrician");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Your details were saved", { exact: true })).toBeVisible();
    await expectMeter(page, 60, "Languages");
    await expect(banner(page)).toHaveCount(0);

    await page.goto("/en/dashboard/worker");
    await expectMeter(page, 60, "Languages");
    await expect(banner(page)).toHaveCount(0);
  });

  test("FR-B4 AC9: the meter and the next item follow a save without a reload", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await signIn(page, user);
    await page.goto("/en/passport");
    await expectMeter(page, 10, "Occupation");
    await page.evaluate(() => {
      (window as unknown as { loadMarker: boolean }).loadMarker = true;
    });

    await page.getByRole("combobox", { name: "Occupation", exact: true }).fill("electrician");
    await page.getByRole("option", { name: /^7411 · Building and related electricians$/ }).click();
    await page.getByRole("button", { name: "Save occupation" }).click();
    await expectMeter(page, 25, "Skills");
    expect(await page.evaluate(() => (window as unknown as { loadMarker?: boolean }).loadMarker)).toBe(true);
  });

  test("FR-B4 AC10: the weights are listed, the meter is accessible and the card fits 360 px", async ({ page }) => {
    const user = await createCommittedUser("worker");
    seedOccupationAndSkills(user.id);
    await seedDocument(user.id, { title: "My CV", object: false });
    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page, user);
    await page.goto("/en/passport");

    await expect(page.getByText("55% complete", { exact: true })).toBeVisible();
    await expect(meter(page)).toHaveAttribute("max", "100");
    await expect(meter(page)).toHaveAttribute("value", "55");

    const summary = page.getByText("How is this calculated?", { exact: true });
    await summary.focus();
    await page.keyboard.press("Enter");
    const published = computeCompleteness(
      { headline: null, occupationId: null, yearsExperience: null, availability: null, skills: [], languages: [], authorizations: [], hasCv: false },
      "2026-10-03",
    ).items;
    expect(published).toHaveLength(9);
    for (const { label, weight, rule } of published) {
      await expect(page.getByText(`${label}: ${weight} points`, { exact: true })).toBeVisible();
      await expect(page.getByText(`. ${rule}.`, { exact: true })).toBeVisible();
    }

    expect(await overflow(page)).toBe(0);
    await expectNoAxeViolations(page);
    await page.goto("/en/dashboard/worker");
    await expect(page.getByText("55% complete", { exact: true })).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await expectNoAxeViolations(page);
  });

  test("FR-B4: a complete passport reads 100 percent, says so and shows no nudge", async ({ page }) => {
    const user = await createCommittedUser("worker");
    seedAllButCv(user.id);
    await seedDocument(user.id, { title: "My CV", scanStatus: "clean", object: false });
    await signIn(page, user);

    for (const path of ["/en/dashboard/worker", "/en/passport"]) {
      await page.goto(path);
      await expectMeter(page, 100, null);
      await expect(page.getByText("Profile complete", { exact: true })).toBeVisible();
      await expect(banner(page)).toHaveCount(0);
    }
  });

  test("FR-B4 AC5: only a clean or skipped CV that is not deleted counts, and the meter follows an upload, its scan and a delete", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    seedAllButCv(user.id);
    await seedDocument(user.id, { title: "Certificate", type: "certificate", scanStatus: "clean", object: false });
    await seedDocument(user.id, { title: "Old pending CV", scanStatus: "pending", createdAt: new Date(Date.now() - 86_400_000).toISOString(), object: false });
    await seedDocument(user.id, { title: "Rejected CV", scanStatus: "rejected", object: false });
    await openDocuments(page, user);
    await expectMeter(page, 85, "CV");
    await page.getByLabel("Type", { exact: true }).selectOption({ label: "CV" });
    await page.getByLabel("Title", { exact: true }).fill("Fresh CV");
    await page
      .getByLabel("File", { exact: true })
      .setInputFiles({ name: "fresh.pdf", mimeType: "application/pdf", buffer: pdfBytes(5_000) });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText("Document uploaded", { exact: true })).toBeVisible();
    await expectMeter(page, 85, "CV");

    const fresh = documentRows(user.id).find((document) => document.title === "Fresh CV");
    if (!fresh) throw new Error("The uploaded row is missing");
    expect((await runScanDocument(fresh.storage_path)).status).toBe("skipped");
    await expectMeter(page, 100, null);

    await page.getByRole("button", { name: "Delete Fresh CV" }).click();
    await page.getByRole("dialog", { name: "Delete Fresh CV?" }).getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByText("Document deleted", { exact: true })).toBeVisible();
    await expectMeter(page, 85, "CV");
  });

  test("FR-B4 AC11: no reminder email is sent and an employer page shows no completeness", async ({ page, browser }) => {
    const candidate = await createCommittedUser("worker");
    await signIn(page, candidate);
    await expectMeter(page, 10, "Occupation");
    await page.goto("/en/passport");
    await expectMeter(page, 10, "Occupation");
    expect(await messageCount(candidate.email)).toBe(0);

    const employer = await createCommittedUser("company");
    const context = await browser.newContext();
    const employerPage = await context.newPage();
    await logIn(employerPage, employer);
    await expect(employerPage).toHaveURL(/\/en\/dashboard\/employer$/);
    await expect(employerPage.getByText(/% complete/)).toHaveCount(0);
    await expect(employerPage.getByText("Passport completeness")).toHaveCount(0);
    await expect(employerPage.getByRole("progressbar")).toHaveCount(0);
    await employerPage.goto("/en/passport");
    await expect(employerPage).toHaveURL(/\/en\/dashboard\/employer$/);
    await context.close();
  });
});
