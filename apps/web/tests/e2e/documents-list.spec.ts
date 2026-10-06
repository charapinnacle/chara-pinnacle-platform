import { execute, literal } from "./support/db";
import { expect, test } from "./support/test";
import { announcements, documentRows, openDocuments, removalJobs, row, auditActions, seedDocument } from "./support/documents";
import { createCommittedUser } from "./support/login";
import { messageCount } from "./support/mailpit";
import { daysFromToday } from "./support/passport";
import { expectNoAxeViolations } from "./support/axe";
import { overflow } from "./support/login-page";

const isoAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const listRequests = (url: URL) => url.pathname === "/rest/v1/worker_documents";
const passportPage = (url: URL) => url.pathname === "/en/passport";

test.describe("candidate documents: the list", () => {
  test("FR-B2 AC6: empty state, newest first with expiry labels and dashboard reminders, no email", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await openDocuments(page, user);
    await expect(page.getByText("You have not uploaded any documents yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();

    await seedDocument(user.id, { title: "Amina Okafor CV 2026", createdAt: isoAgo(0) });
    await seedDocument(user.id, { title: "Welding certificate", type: "certificate", expiresOn: daysFromToday(20), createdAt: isoAgo(1) });
    await seedDocument(user.id, { title: "Old certificate", type: "certificate", expiresOn: daysFromToday(-1), createdAt: isoAgo(2) });
    await seedDocument(user.id, { title: "Far certificate", type: "certificate", expiresOn: daysFromToday(200), createdAt: isoAgo(3) });
    await page.reload();

    await expect(page.getByRole("columnheader")).toHaveText(["Title", "Type", "Size", "Uploaded", "Expires", "Status", "Actions"]);
    await expect(page.getByRole("rowheader")).toHaveText([
      "Amina Okafor CV 2026",
      "Welding certificate",
      "Old certificate",
      "Far certificate",
    ]);
    await expect(row(page, "Welding certificate")).toContainText("Expires in 20 days");
    await expect(row(page, "Old certificate")).toContainText("Expired");
    await expect(row(page, "Far certificate")).not.toContainText(/Expire/);
    await expect(row(page, "Amina Okafor CV 2026")).toContainText("Ready");

    await page.goto("/en/dashboard/worker");
    const reminders = page.getByRole("region", { name: "Document reminders" });
    await expect(reminders.getByRole("listitem")).toHaveCount(2);
    await expect(reminders.getByRole("listitem").filter({ hasText: "Old certificate" })).toContainText("Expired");
    await expect(reminders.getByRole("listitem").filter({ hasText: "Welding certificate" })).toContainText("Expires in 20 days");
    await expect(reminders.getByRole("link", { name: "Welding certificate" })).toHaveAttribute("href", "/en/passport#documents");
    expect(await messageCount(user.email)).toBe(0);
  });

  test("FR-B2 AC6: a skeleton while loading, an error toast with Retry when the request fails", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await seedDocument(user.id, { title: "Amina Okafor CV 2026" });
    await openDocuments(page, user);

    await page.route(listRequests, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
    await expect(row(page, "Amina Okafor CV 2026")).toBeVisible();
    await page.unroute(listRequests);

    await page.route(listRequests, (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await page.reload();
    await expect(page.getByText("Could not load your documents", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.unroute(listRequests);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(row(page, "Amina Okafor CV 2026")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  });

  test("FR-B2 AC6: the keyboard opens the file control and downloads the CV through a 60-second attachment link", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await seedDocument(user.id, { title: "Amina Okafor CV 2026" });
    await openDocuments(page, user);
    await expect(row(page, "Amina Okafor CV 2026")).toBeVisible();

    const file = page.getByLabel("File", { exact: true });
    await expect(page.getByText("File", { exact: true })).toBeVisible();
    for (const key of ["Enter", "Space"]) {
      await file.focus();
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press(key)]);
      await chooser.setFiles({ name: "next.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
      await expect(announcements(page)).toHaveText("Selected file: next.pdf (8 B)");
    }

    const links: { disposition: string | undefined; token: string | null }[] = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname.includes("/object/sign/passport-documents/")) {
        links.push({ disposition: response.headers()["content-disposition"], token: url.searchParams.get("token") });
      }
    });
    await page.getByRole("button", { name: "Download Amina Okafor CV 2026" }).focus();
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    expect(download.suggestedFilename()).toBe("My_CV__final_.pdf");
    expect(links).toHaveLength(1);
    expect(links[0].disposition).toMatch(/^attachment/);
    const claims = JSON.parse(Buffer.from((links[0].token ?? "").split(".")[1], "base64url").toString()) as { exp: number; iat: number };
    expect(claims.exp - claims.iat).toBe(60);
  });

  test("FR-B2 AC6: the table has no accessibility violation and no horizontal scroll at 360 px", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await seedDocument(user.id, { title: "Amina Okafor CV 2026" });
    await seedDocument(user.id, { title: "Welding certificate", type: "certificate", expiresOn: daysFromToday(20) });
    await page.setViewportSize({ width: 360, height: 800 });
    await openDocuments(page, user);
    await expect(row(page, "Welding certificate")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
  });

  test("FR-B2 AC6: no sideways scroll and no clipped button at 320, 360, 768 and 1280 px, also while a title is renamed", async ({ page }) => {
    const user = await createCommittedUser("worker");
    const longTitle = "Amina_Okafor_Curriculum_Vitae_2026_final_version_v7_signed_BBBBBBBBBBBBBBBBBBBBBBBB";
    await seedDocument(user.id, { title: longTitle });
    await seedDocument(user.id, { title: "Welding certificate", type: "certificate", expiresOn: daysFromToday(20), createdAt: "2026-09-28T10:00:00Z" });
    await seedDocument(user.id, { title: "Still checking", scanStatus: "pending" });
    await openDocuments(page, user);

    const wrapper = page.getByRole("table", { name: "Your documents, newest first" }).locator("..");
    const controls = wrapper.getByRole("button").or(wrapper.getByRole("textbox"));
    const expectNothingClipped = async (width: number, count: number) => {
      await expect(controls).toHaveCount(count);
      expect(await wrapper.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      // The Experience form already makes the whole page wider than a 320 px screen: there the controls are checked
      // against the screen edge instead.
      if (width > 320) expect(await overflow(page)).toBeLessThanOrEqual(0);
      const frame = await wrapper.boundingBox();
      for (const control of await controls.all()) {
        const box = await control.boundingBox();
        const inside = box && frame && box.x >= frame.x && box.x + box.width <= Math.min(frame.x + frame.width, width);
        expect(inside, await control.innerText()).toBe(true);
      }
    };

    for (const width of [320, 360, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(row(page, "Welding certificate")).toBeVisible();
      await expect(page.getByRole("button", { name: "Download Welding certificate" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Rename Welding certificate" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete Still checking" })).toBeVisible();
      await expectNothingClipped(width, 7);
    }

    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("button", { name: `Rename ${longTitle}` }).click();
    await expect(page.getByRole("textbox", { name: `New title for ${longTitle}` })).toBeFocused();
    await expectNothingClipped(360, 8);
  });

  test("FR-B2 AC7: a rename keeps the file and the path, refuses an empty and an overlong title, and Escape cancels", async ({ page }) => {
    const user = await createCommittedUser("worker");
    const seeded = await seedDocument(user.id, { title: "Amina Okafor CV 2026" });
    await openDocuments(page, user);

    await page.getByRole("button", { name: "Rename Amina Okafor CV 2026" }).click();
    const title = page.getByRole("textbox", { name: "New title for Amina Okafor CV 2026" });
    await expect(title).toBeFocused();
    await title.fill("");
    await title.press("Enter");
    await expect(page.getByText("Enter a title.", { exact: true })).toBeVisible();
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await title.fill("x".repeat(121));
    await title.press("Enter");
    await expect(page.getByText("The title can have up to 120 characters.", { exact: true })).toBeVisible();
    expect(documentRows(user.id)[0].title).toBe("Amina Okafor CV 2026");

    await title.fill("CV English");
    await title.press("Escape");
    await expect(row(page, "Amina Okafor CV 2026")).toBeVisible();
    expect(documentRows(user.id)[0].title).toBe("Amina Okafor CV 2026");

    await page.getByRole("button", { name: "Rename Amina Okafor CV 2026" }).click();
    await page.getByRole("textbox", { name: "New title for Amina Okafor CV 2026" }).fill("CV English");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Document renamed", { exact: true })).toBeVisible();
    await expect(row(page, "CV English")).toBeVisible();
    await page.reload();
    await expect(row(page, "CV English")).toBeVisible();

    expect(documentRows(user.id)[0]).toMatchObject({
      title: "CV English",
      file_name: seeded.file_name,
      storage_path: seeded.storage_path,
      scan_status: "skipped",
    });
    expect(auditActions(seeded.id)).toEqual(["document.created", "document.renamed"]);
  });

  test("FR-B2 AC8: a delete asks first, Cancel and Escape change nothing, a failure keeps the document, a confirmation removes it", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    const seeded = await seedDocument(user.id, { title: "Amina Okafor CV 2026" });
    await seedDocument(user.id, { title: "Keep me" });
    await openDocuments(page, user);

    await page.getByRole("button", { name: "Delete Amina Okafor CV 2026" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete Amina Okafor CV 2026?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Delete Amina Okafor CV 2026" }).click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page, "Amina Okafor CV 2026")).toBeVisible();
    expect(documentRows(user.id).map((document) => document.deleted_at)).toEqual([null, null]);
    expect(removalJobs(seeded.storage_path)).toBe(0);

    await page.route(passportPage, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await page.getByRole("button", { name: "Delete Amina Okafor CV 2026" }).click();
    await dialog.getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByText("Could not delete the document", { exact: true })).toBeVisible();
    await expect(row(page, "Amina Okafor CV 2026")).toBeVisible();
    expect(removalJobs(seeded.storage_path)).toBe(0);
    await page.unroute(passportPage);

    await page.getByRole("button", { name: "Delete Amina Okafor CV 2026" }).click();
    await dialog.getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByText("Document deleted", { exact: true })).toBeVisible();
    await expect(row(page, "Amina Okafor CV 2026")).toHaveCount(0);
    await expect(row(page, "Keep me")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("rowheader")).toHaveText(["Keep me"]);

    const rows = documentRows(user.id);
    expect(rows.find((document) => document.id === seeded.id)?.deleted_at).not.toBeNull();
    expect(rows.find((document) => document.title === "Keep me")?.deleted_at).toBeNull();
    expect(removalJobs(seeded.storage_path)).toBe(1);
    expect(auditActions(seeded.id)).toEqual(["document.created", "document.deleted"]);
  });

  test("FR-B2: more than one page of documents is read page by page, newest first", async ({ page }) => {
    const user = await createCommittedUser("worker");
    for (let index = 1; index <= 27; index += 1) {
      await seedDocument(user.id, { title: `Document ${String(index).padStart(2, "0")}`, createdAt: isoAgo(100 - index), object: false });
    }
    await openDocuments(page, user);
    await expect(page.getByRole("rowheader")).toHaveCount(25);
    await expect(page.getByRole("rowheader").first()).toHaveText("Document 27");
    await page.getByRole("button", { name: "Show more documents" }).click();
    await expect(page.getByRole("rowheader")).toHaveCount(27);
    await expect(page.getByRole("rowheader").last()).toHaveText("Document 01");
    await expect(page.getByRole("button", { name: "Show more documents" })).toHaveCount(0);

    await page.getByRole("button", { name: "Delete Document 27" }).click();
    await page.getByRole("button", { name: "Delete document", exact: true }).click();
    await expect(page.getByText("Document deleted", { exact: true })).toBeVisible();
    await expect(row(page, "Document 27")).toHaveCount(0);
    await expect(page.getByRole("rowheader")).toHaveCount(26);
    await expect(page.getByRole("rowheader").last()).toHaveText("Document 01");
  });

  test("FR-B2: a recent pending upload reads as being checked, also after a reload, and an old one as not finished", async ({ page }) => {
    const user = await createCommittedUser("worker");
    const recent = await seedDocument(user.id, { title: "Just sent", scanStatus: "pending", createdAt: isoAgo(0) });
    await seedDocument(user.id, { title: "Long ago", scanStatus: "pending", createdAt: new Date(Date.now() - 600_000).toISOString() });
    await openDocuments(page, user);
    await expect(row(page, "Just sent")).toContainText("Checking the file");
    await expect(row(page, "Long ago")).toContainText("Upload not finished");

    execute(`update public.worker_documents set scan_status = 'skipped' where id = ${literal(recent.id)}`);
    await expect(row(page, "Just sent")).toContainText("Ready", { timeout: 15_000 });
    await expect(row(page, "Long ago")).toContainText("Upload not finished");
  });
});
