import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import {
  BUCKET,
  announcements,
  FAKE_PDF,
  auditActions,
  documentRows,
  objectNames,
  openDocuments,
  openUploadForm,
  pdfBytes,
  row,
  runScanDocument,
} from "./support/documents";
import { execute, literal } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser } from "./support/login";
import { daysFromToday } from "./support/passport";

const today = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date());

async function fillUpload(
  page: Page,
  { type, title, file }: { type: "CV" | "Certificate"; title: string; file?: { name: string; mimeType: string; buffer: Buffer } },
) {
  const select = page.getByLabel("Type", { exact: true });
  const wanted = type === "CV" ? "cv" : "certificate";
  if (!(await select.isVisible()) || (await select.inputValue()) !== wanted) await openUploadForm(page, type === "CV" ? "Upload CV" : "Add certificate");
  await page.getByLabel("Title", { exact: true }).fill(title);
  if (file) await page.getByLabel("File", { exact: true }).setInputFiles(file);
}

const upload = (page: Page) => page.getByRole("button", { name: "Upload", exact: true });

test.describe("candidate documents: upload", () => {
  test("FR-B2 AC1: the row exists before the bytes, the bytes go straight to Storage and the scan makes the file Ready", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    await openDocuments(page, user);
    await expect(page.getByText("You have not uploaded any documents yet")).toBeVisible();

    const nextRequestBodies: number[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).origin === "http://localhost:3100") {
        nextRequestBodies.push((request.postData() ?? "").length);
      }
    });
    let rowsWhenSent: ReturnType<typeof documentRows> = [];
    let bytesSent = 0;
    await page.route("**/storage/v1/object/upload/sign/**", async (route) => {
      rowsWhenSent = documentRows(user.id);
      bytesSent = route.request().postDataBuffer()?.length ?? 0;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await fillUpload(page, {
      type: "CV",
      title: "Amina Okafor CV 2026",
      file: { name: "My CV (final).pdf", mimeType: "application/pdf", buffer: pdfBytes(1_258_291) },
    });
    await expect(announcements(page)).toHaveText("Selected file: My CV (final).pdf (1.2 MB)");
    await upload(page).click();
    await expect(page.getByRole("button", { name: /^Uploading/ })).toBeDisabled();
    await expect(page.getByText("Document uploaded", { exact: true })).toBeVisible();
    await expect(announcements(page)).toHaveText("Uploaded My CV (final).pdf. We are checking the file.");

    expect(rowsWhenSent).toHaveLength(1);
    expect(rowsWhenSent[0]).toMatchObject({ title: "Amina Okafor CV 2026", scan_status: "pending", size_bytes: 1_258_291 });
    expect(bytesSent).toBeGreaterThan(1_258_291);
    expect(Math.max(...nextRequestBodies)).toBeLessThan(5_000);

    const [document] = documentRows(user.id);
    const path = `${user.id}/${document.id}/My_CV__final_.pdf`;
    expect(objectNames(user.id)).toEqual([path]);
    expect(document).toMatchObject({
      bucket_id: BUCKET,
      storage_path: path,
      file_name: "My_CV__final_.pdf",
      mime: "application/pdf",
      size_bytes: 1_258_291,
      scan_status: "pending",
    });
    const listed = row(page, "Amina Okafor CV 2026");
    await expect(listed).toContainText("Checking the file");

    expect(await runScanDocument(path)).toEqual({ status: "skipped" });
    await expect(listed).toContainText("Ready", { timeout: 15_000 });
    await expect(listed.getByRole("cell").nth(0)).toHaveText("CV");
    await expect(listed.getByRole("cell").nth(1)).toHaveText("1.2 MB");
    await expect(listed.getByRole("cell").nth(2)).toHaveText(today);
    expect(documentRows(user.id)[0].scan_status).toBe("skipped");
    expect(auditActions(document.id)).toEqual(["document.created", "document.scanned"]);
    await expect(upload(page)).toBeEnabled();
  });

  test("FR-B2 AC1: the other button changes the type of the open form and keeps what was typed; Cancel closes the form", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await openDocuments(page, user);
    await openUploadForm(page, "Upload CV");
    await page.getByLabel("Title", { exact: true }).fill("Kept title");
    await page.getByLabel("File", { exact: true }).setInputFiles({ name: "kept.pdf", mimeType: "application/pdf", buffer: pdfBytes(2_048) });

    await page.getByRole("button", { name: "Add certificate", exact: true }).click();
    await expect(page.getByLabel("Type", { exact: true })).toHaveValue("certificate");
    await expect(page.getByLabel("Expiry date (optional)")).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Kept title");
    await expect(announcements(page)).toHaveText("Selected file: kept.pdf (2 KB)");

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add certificate", exact: true })).toBeFocused();
    expect(documentRows(user.id)).toHaveLength(0);
  });

  test("FR-B2 AC1: a certificate asks for an expiry date, a CV does not", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await openDocuments(page, user);
    await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
    await openUploadForm(page, "Upload CV");
    await expect(page.getByLabel("Expiry date (optional)")).toHaveCount(0);
    await page.getByLabel("Type", { exact: true }).selectOption({ label: "Certificate" });
    await expect(page.getByLabel("Expiry date (optional)")).toBeVisible();
    await page.getByLabel("Type", { exact: true }).selectOption({ label: "CV" });
    await expect(page.getByLabel("Expiry date (optional)")).toHaveCount(0);
    await openUploadForm(page, "Add certificate");
    await expect(page.getByLabel("Expiry date (optional)")).toBeVisible();

    await fillUpload(page, {
      type: "Certificate",
      title: "Welding certificate",
      file: { name: "weld.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) },
    });
    await page.getByLabel("Expiry date (optional)").fill(daysFromToday(20));
    await upload(page).click();
    await expect(page.getByText("Document uploaded", { exact: true })).toBeVisible();
    const [document] = documentRows(user.id);
    expect(document).toMatchObject({ type: "certificate", expires_on: daysFromToday(20), mime: "image/png" });
    await expect(row(page, "Welding certificate")).toContainText("Expires in 20 days");
  });

  test("FR-B2 AC2: the browser refuses a missing file, a wrong type and a file over 15 MB before any row is made", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await openDocuments(page, user);
    await openUploadForm(page, "Upload CV");
    await upload(page).click();
    for (const message of ["Enter a title.", "Choose a file."]) {
      await expect(page.getByText(message, { exact: true })).toBeVisible();
    }
    await page.getByLabel("Type", { exact: true }).selectOption("");
    await upload(page).click();
    await expect(page.getByText("Choose a type.", { exact: true })).toBeVisible();
    await page.getByLabel("Type", { exact: true }).selectOption({ label: "CV" });

    await fillUpload(page, {
      type: "CV",
      title: "Not a document",
      file: { name: "photo.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") },
    });
    await upload(page).click();
    await expect(page.getByText("Choose a PDF, JPG or PNG file.", { exact: true })).toBeVisible();

    await page.getByLabel("File", { exact: true }).setInputFiles({ name: "big.pdf", mimeType: "application/pdf", buffer: pdfBytes(15_728_641) });
    await upload(page).click();
    await expect(page.getByText("File is larger than 15 MB", { exact: true })).toBeVisible();
    await page.getByLabel("File", { exact: true }).setInputFiles({ name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) });
    await upload(page).click();
    await expect(page.getByText("The file is empty.", { exact: true })).toBeVisible();
    expect(documentRows(user.id)).toEqual([]);
  });

  test("SA-06: a candidate who keeps the most documents allowed is told so, and no row or file is added", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await openDocuments(page, user);
    execute(
      `insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes, scan_status)
       select d.id, ${literal(user.id)}, 'cv', 'Kept ' || d.i, ${literal(user.id)} || '/' || d.id || '/cv.pdf', 'cv.pdf', 'application/pdf', 1000, 'skipped'
       from (select gen_random_uuid() as id, i from generate_series(1, 50) i) d`,
    );
    await page.reload();
    await waitForHydration(page.getByRole("button", { name: "Upload CV", exact: true }));
    await fillUpload(page, {
      type: "CV",
      title: "One too many",
      file: { name: "cv.pdf", mimeType: "application/pdf", buffer: pdfBytes(1_000) },
    });
    await upload(page).click();
    await expect(announcements(page)).toHaveText("You have reached the maximum number of documents. Delete one before you add another.");
    expect(documentRows(user.id)).toHaveLength(50);
    expect(objectNames(user.id)).toEqual([]);
  });

  test("FR-B2 AC5: a text file declared as a PDF is rejected and one whose upload never finished stays pending, neither is usable", async ({
    page,
  }) => {
    const user = await createCommittedUser("worker");
    await openDocuments(page, user);

    await fillUpload(page, {
      type: "CV",
      title: "Fake CV",
      file: { name: "fake.pdf", mimeType: "application/pdf", buffer: FAKE_PDF },
    });
    await upload(page).click();
    await expect(page.getByText("Document uploaded", { exact: true })).toBeVisible();
    const [fake] = documentRows(user.id);
    expect(await runScanDocument(`${user.id}/${fake.id}/fake.pdf`)).toEqual({ status: "rejected" });
    const rejected = row(page, "Fake CV");
    await expect(rejected).toContainText("File rejected: not a valid PDF, JPG or PNG", { timeout: 15_000 });
    await expect(rejected.getByRole("button")).toHaveCount(1);
    await expect(rejected.getByRole("button", { name: "Delete Fake CV" })).toBeVisible();
    expect(documentRows(user.id)[0].scan_status).toBe("rejected");

    await page.route("**/storage/v1/object/upload/sign/**", (route) => route.abort());
    await fillUpload(page, {
      type: "CV",
      title: "Cut off",
      file: { name: "second.pdf", mimeType: "application/pdf", buffer: pdfBytes(5_000) },
    });
    await upload(page).click();
    await expect(page.getByText("Could not upload the document", { exact: true })).toBeVisible();
    const unfinished = row(page, "Cut off");
    await expect(unfinished).toContainText("Upload not finished");
    await expect(unfinished.getByRole("button")).toHaveCount(1);
    await expect(unfinished.getByRole("button", { name: "Delete Cut off" })).toBeVisible();
    expect(documentRows(user.id).map((document) => [document.title, document.scan_status])).toEqual([
      ["Fake CV", "rejected"],
      ["Cut off", "pending"],
    ]);
    expect(objectNames(user.id)).toEqual([`${user.id}/${fake.id}/fake.pdf`]);

    await page.goto("/en/dashboard/worker");
    await expect(page.getByText("10% complete")).toBeVisible();
  });
});
