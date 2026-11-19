import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { runAccountOps } from "./support/account-ops";
import { signInStaff } from "./support/admin";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, executeAsync, literal, query } from "./support/db";
import { seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser, jwtClaims } from "./support/login";
import { logIn } from "./support/login-page";
import { extractLinks, waitForMessage } from "./support/mailpit";
import { runNotify } from "./support/notify";
import { setPartnerRelease } from "./support/partners";
import { signIn } from "./support/passport";
import { expect, test } from "./support/test";

const PAGE = "/en/settings/data-export";
const REQUEST_FN = "public.request_data_export()";
const LIST_FN = "public.list_my_data_exports()";
const SUBJECT = "Your Chara Pinnacle data is ready to download";

// The switch of the data export (FR-S3), for the whole database: it goes live on its own, before or with release 2a.
function setExportRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_data_export'`);
}

type ExportRow = { id: string; status: string; storage_path: string | null };

function exportsOf(userId: string): ExportRow[] {
  return query<ExportRow>(
    `select id, status::text, storage_path from public.data_export_requests where user_id = ${literal(userId)} order by requested_at`,
  );
}

function auditCount(action: string, exportId: string): number {
  const [row] = query<{ n: number }>(
    `select count(*)::int as n from audit.log where action = ${literal(action)} and entity_id = ${literal(exportId)}`,
  );
  return row.n;
}

function objectExists(path: string): boolean {
  return query(`select 1 from storage.objects where bucket_id = 'dsar-exports' and name = ${literal(path)}`).length === 1;
}

// The entries of a zip, read through its central directory and inflated as an unzip tool would.
function unzip(archive: Buffer): Map<string, Buffer> {
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  const entries = new Map<string, Buffer>();
  let at = archive.readUInt32LE(end + 16);
  for (let i = 0; i < archive.readUInt16LE(end + 10); i++) {
    const method = archive.readUInt16LE(at + 10);
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const offset = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
    const body = archive.subarray(start, start + size);
    entries.set(name, method === 8 ? inflateRawSync(body) : body);
    at += 46 + nameLength;
  }
  return entries;
}

async function prepare(page: Page): Promise<void> {
  const open = page.getByRole("button", { name: "Download my data" });
  await waitForHydration(open);
  await open.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Prepare a copy of your data?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Prepare my data" }).focus();
  await page.keyboard.press("Enter");
}

// The export switch is set for the whole database (release 2a stays off: the export goes live on its own), account-ops
// and notify run over the whole queue and the retention job over the whole database, so this file is a project of its
// own (playwright.config.ts) and its tests run in order.
test.describe("Download my data (FR-S3 AC7, AC8)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setExportRelease(true));
  test.afterAll(() => {
    execute(`grant execute on function ${REQUEST_FN} to authenticated; grant execute on function ${LIST_FN} to authenticated`);
    setExportRelease(false);
  });

  test("AC8: a candidate asks by keyboard, is told when one is being prepared, gets the email and downloads the zip", async ({ page }) => {
    test.setTimeout(120_000);
    const candidate = await createCommittedUser("worker");
    const cv = await seedDocument(candidate.id, { title: "Welding CV", fileName: "welding-cv.pdf", sizeBytes: 2048 });
    await seedDocument(candidate.id, { title: "New certificate", type: "certificate", fileName: "cert.pdf", scanStatus: "pending" });

    await signIn(page, candidate);
    await page.goto("/en/settings");
    await page.getByRole("link", { name: "Download my data" }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.getByRole("heading", { name: "Download my data", level: 1 })).toBeVisible();
    await expect(page.getByText("No exports yet")).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    await prepare(page);
    await expect(page.getByText("We are preparing your data", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Being prepared", { exact: true })).toBeVisible();
    const [request] = exportsOf(candidate.id);
    expect(request.status).toBe("queued");
    expect(auditCount("data_export.requested", request.id)).toBe(1);
    expect(
      query(`select 1 from pgmq.q_account_ops where message ->> 'action' = 'build_data_export' and message ->> 'export_id' = ${literal(request.id)}`),
    ).toHaveLength(1);
    await expectAccessibleAtBothWidths(page);

    await prepare(page);
    await expect(page.getByText("An export is already being prepared. We will email you when it is ready.").first()).toBeVisible();
    expect(exportsOf(candidate.id)).toHaveLength(1);

    // account-ops builds the zip; the page, which reads the state again while one is being prepared, shows it ready.
    expect((await runAccountOps()).failed).toBe(0);
    await expect(page.getByText("Ready to download", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status").filter({ hasText: "Your data is ready to download." })).toHaveCount(1);
    await expect(page.getByText(/1 document was not included \(see README\.txt\)/)).toBeVisible();
    const [ready] = exportsOf(candidate.id);
    expect(ready).toEqual({ id: request.id, status: "ready", storage_path: `${candidate.id}/${request.id}.zip` });
    expect(objectExists(`${candidate.id}/${request.id}.zip`)).toBe(true);
    await expect(page.getByText(/^You can ask for a new export from /)).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    // The mandatory email leads to the export page, never to the file.
    await runNotify();
    const email = await waitForMessage(candidate.email, { subject: SUBJECT });
    const links = extractLinks(email);
    expect(links).toContain(`http://localhost:3100${PAGE}`);
    expect(links.some((link) => link.includes("dsar-exports"))).toBe(false);
    await page.goto(`http://localhost:3100${PAGE}`);

    const download = page.getByRole("button", { name: /^Download the export of / });
    await waitForHydration(download);
    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    expect(file.suggestedFilename()).toMatch(/^chara-pinnacle-data-\d{4}-\d{2}-\d{2}\.zip$/);
    const link = new URL(file.url());
    expect(link.pathname).toBe(`/storage/v1/object/sign/dsar-exports/${candidate.id}/${request.id}.zip`);
    const claims = jwtClaims(link.searchParams.get("token") as string) as { iat: number; exp: number };
    expect(claims.exp - claims.iat, "AC8: the link is valid for 10 minutes").toBe(600);
    expect(auditCount("data_export.downloaded", request.id)).toBe(1);

    // AC7: UTF-8 JSON files with readable keys, and the candidate's own document.
    const entries = unzip(readFileSync((await file.path()) as string));
    expect([...entries.keys()]).toEqual(expect.arrayContaining(["account.json", "passport.json", "documents.json", "applications.json", "consents.json"]));
    expect(entries.has(`documents/${cv.id}/welding-cv.pdf`)).toBe(true);
    expect(entries.get(`documents/${cv.id}/welding-cv.pdf`)?.subarray(0, 5).toString()).toBe("%PDF-");
    const account = JSON.parse(entries.get("account.json")?.toString("utf8") ?? "null") as { email: string; account_kind: string };
    expect(account).toMatchObject({ email: candidate.email, account_kind: "worker" });
    const passport = JSON.parse(entries.get("passport.json")?.toString("utf8") ?? "null") as { first_name: string };
    expect(passport.first_name).toBe("Test");
    const documents = JSON.parse(entries.get("documents.json")?.toString("utf8") ?? "[]") as { title: string; file: string }[];
    expect(documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Welding CV", file: `documents/${cv.id}/welding-cv.pdf` }),
      expect.objectContaining({ title: "New certificate", file: null, note: "Not included because the file has not passed its check." }),
    ]));
    expect(entries.get("README.txt")?.toString("utf8")).toContain("1 document was not included; documents.json says why.");

    // The in-app notice leads to the same page (the notification list itself belongs to release 2a).
    setPartnerRelease(true);
    try {
      await page.goto("/en/notifications");
      await page.getByRole("link", { name: /^Your data is ready to download until / }).click();
      await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    } finally {
      setPartnerRelease(false);
    }

    // Once expired, the link is refused; the retention job then deletes the request and account-ops the file.
    execute(`update public.data_export_requests set expires_at = now() - interval '1 second' where id = ${literal(request.id)}`);
    await page.reload();
    await expect(page.getByText("Expired", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Download the export of / })).toHaveCount(0);
    execute("select private.apply_retention()");
    expect(exportsOf(candidate.id)).toEqual([]);
    expect((await runAccountOps()).failed).toBe(0);
    expect(objectExists(`${candidate.id}/${request.id}.zip`)).toBe(false);
    await page.reload();
    await expect(page.getByText("No exports yet")).toBeVisible();
  });

  test("AC8: a link asked for after the export expired is refused with a toast", async ({ page }) => {
    const candidate = await createCommittedUser("worker");
    await signIn(page, candidate);
    await page.goto(PAGE);
    await prepare(page);
    await expect(page.getByText("We are preparing your data", { exact: true })).toBeVisible();
    expect((await runAccountOps()).failed).toBe(0);
    await page.reload();
    const download = page.getByRole("button", { name: /^Download the export of / });
    await waitForHydration(download);
    const [request] = exportsOf(candidate.id);
    execute(`update public.data_export_requests set expires_at = now() - interval '1 second' where id = ${literal(request.id)}`);
    await download.click();
    await expect(page.getByText("This export is no longer available. Ask for a new one.").first()).toBeVisible();
    expect(auditCount("data_export.downloaded", request.id)).toBe(0);
  });

  test("a company user reaches the page from the notification settings; without the export switch the page and link are gone", async ({ page }) => {
    const member = await createCommittedUser("company");
    await logIn(page, member);
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    await page.goto("/en/settings/notifications");
    await page.getByRole("link", { name: "Download my data" }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    const trail = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(trail).toHaveText(/^Dashboard.*Settings.*Download my data$/);
    await expect(trail.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("href", "/en/settings/notifications");
    await expectAccessibleAtBothWidths(page);

    setExportRelease(false);
    try {
      await page.goto(PAGE);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await page.goto("/en/settings/notifications");
      await expect(page.getByRole("link", { name: "Download my data" })).toHaveCount(0);
    } finally {
      setExportRelease(true);
    }
  });

  test("the console lists the export switch among the releases, needing no legal document", async ({ page }) => {
    await signInStaff(page, "admin", "/en/admin/settings");
    const row = page.getByRole("region", { name: "Release switches" }).getByRole("row").filter({ hasText: "release_data_export" });
    await expect(row).toContainText("Data export: a user exports a copy of their own data");
    await expect(row).toContainText("Live");
    await expect(row).toContainText("None needed");
  });

  test("a skeleton shows while the exports load; a failed load offers Try again; a failed request is a toast", async ({ page }) => {
    const candidate = await createCommittedUser("worker");
    await signIn(page, candidate);

    const held = executeAsync("begin; lock table public.data_export_requests in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.goto(PAGE, { waitUntil: "commit" });
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Download my data", level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
    await held;

    execute(`revoke execute on function ${LIST_FN} from authenticated`);
    await page.goto(PAGE);
    await expect(page.getByRole("heading", { name: "This page could not be loaded" })).toBeVisible();
    await expect(page.getByText(/permission denied|list_my_data_exports/)).toHaveCount(0);
    execute(`grant execute on function ${LIST_FN} to authenticated`);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Download my data", level: 1 })).toBeVisible();

    execute(`revoke execute on function ${REQUEST_FN} from authenticated`);
    await prepare(page);
    await expect(page.getByText("Could not request your data", { exact: true })).toBeVisible();
    execute(`grant execute on function ${REQUEST_FN} to authenticated`);
    expect(exportsOf(candidate.id)).toEqual([]);
  });
});
