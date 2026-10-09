import type { Page } from "@playwright/test";
import { enrolledStaff, seedAudit, signInStaff, uniqueTag, type StaffRole } from "./support/admin";
import { userToken } from "./support/accounts";
import { newApplicant, seedApplication } from "./support/applications";
import { query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { seedDocument } from "./support/documents";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { accessLog, requestDocumentUrl } from "./support/privacy";
import { aal2Token } from "./support/staff";
import { expect, test } from "./support/test";
import { env } from "@/lib/env";

const ROLES: StaffRole[] = ["admin", "trust_safety", "verification_reviewer"];
const FILE_NAMES = ["passport-scan.pdf", "diploma.pdf"];
const TITLES = ["Passport scan", "Diploma"];

// A candidate with two documents that an organisation received with an application, and a vacancy that was hidden.
async function seedWorld() {
  const company = await newCompany();
  const member = await addCompanyUser(company, "member");
  const candidate = await newApplicant();
  const passport = await seedDocument(candidate.id, { title: TITLES[0], fileName: FILE_NAMES[0] });
  const diploma = await seedDocument(candidate.id, { title: TITLES[1], type: "certificate", fileName: FILE_NAMES[1], scanStatus: "clean" });
  const hidden = seedJob(company, { title: "Hidden welder", status: "open", moderation: "hidden" });
  seedApplication(candidate.id, hidden, company.id, { documentIds: [passport.id, diploma.id] });
  return { company, member, candidate, passport, diploma };
}

async function expectNoDocumentOnPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const text = await page.locator("body").innerText();
  const html = await page.content();
  for (const name of [...FILE_NAMES, ...TITLES]) {
    expect(text, `${path} shows ${name}`).not.toContain(name);
    expect(html, `${path} carries ${name}`).not.toContain(name);
  }
  expect(text, `${path} shows a document event`).not.toMatch(/document\.(created|renamed|deleted|scanned)|share\.(created|revoked)/);
  expect(text, `${path} shows a document count`).not.toMatch(/\b\d+ documents?\b|\bdocuments?:? \d+\b/i);
  await expect(page.getByRole("button", { name: /download|open .*\.pdf/i }), `${path} has a download button`).toHaveCount(0);
  await expect(page.locator('a[href*="storage"], a[href*="document-url"], a[href$=".pdf"]'), `${path} links a file`).toHaveCount(0);
}

test.describe("no platform staff role has a way to documents", () => {
  for (const role of ROLES) {
    test(`FR-F3 AC8: the ${role} role finds no document function on any page of the console`, async ({ page }) => {
      const world = await seedWorld();
      const traffic: string[] = [];
      page.on("request", (request) => traffic.push(request.url()));

      await signInStaff(page, role, "/en/admin");
      await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();
      const nav = page.getByRole("navigation", { name: "Administration" });
      const entries = await nav.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
      expect(entries.length > 0, "the entries of the role").toBe(role !== "verification_reviewer");
      await expect(page.getByRole("link", { name: /documents/i }).filter({ hasNotText: "Legal documents" })).toHaveCount(0);

      for (const path of ["/en/admin", ...entries, `/en/admin/users/${world.candidate.id}`, `/en/admin/organizations/${world.company.id}`]) {
        if (role === "verification_reviewer" && path !== "/en/admin") {
          const response = await page.goto(path);
          expect(response?.status(), path).toBe(404);
        } else {
          await expectNoDocumentOnPage(page, path);
        }
      }

      for (const path of ["/en/admin/documents", `/en/admin/users/${world.candidate.id}/documents`]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(404);
        await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      }

      expect(traffic.filter((url) => /document-url|\/storage\/v1\//.test(url))).toEqual([]);
      expect(accessLog(world.passport.id)).toEqual([]);
    });
  }

  test("FR-F3 AC8: the audit search lists no event of the documents of the candidate", async ({ page }) => {
    const world = await seedWorld();
    const tag = uniqueTag();
    seedAudit(tag, 3);
    const [{ n }] = query<{ n: number }>(`select count(*)::int as n from audit.log where entity_type = 'worker_documents' and entity_id = '${world.passport.id}'`);
    expect(n).toBeGreaterThan(0);

    await signInStaff(page, "admin", "/en/admin/audit");
    await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
    const rows = page.getByRole("table", { name: "Audit log, newest first" }).getByRole("row").filter({ has: page.getByRole("cell") });
    const action = page.getByLabel("Action", { exact: true });
    await waitForHydration(action);
    await action.fill(`e2e.${tag}`);
    await action.press("Enter");
    await expect(rows, "the search lists events of other entities").toHaveCount(3);
    await action.fill("");
    const entity = page.getByLabel("Entity id");
    await entity.fill(world.passport.id);
    await entity.press("Enter");
    await expect(page.getByRole("heading", { name: "No audit entries match", level: 2 })).toBeVisible();
    await page.getByLabel("Entity id").fill("");
    await page.getByLabel("Entity type").fill("worker_documents");
    await page.getByLabel("Entity type").press("Enter");
    await expect(page.getByRole("heading", { name: "No audit entries match", level: 2 })).toBeVisible();
  });

  test("FR-F3 AC7: document-url and the Storage API refuse the tokens of every staff role and write no log row", async () => {
    const world = await seedWorld();
    const { passport } = world;
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1`;
    const storage = (token: string, path: string, init?: RequestInit) =>
      fetch(`${url}/${path}`, {
        ...init,
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
      });
    const object = `object/authenticated/passport-documents/${passport.storage_path}`;
    const sign = `object/sign/passport-documents/${passport.storage_path}`;

    for (const role of ROLES) {
      const staff = await enrolledStaff(role);
      for (const [level, token] of [
        ["aal1", await userToken(staff.user)],
        ["aal2", await aal2Token(staff.user, staff.secret)],
      ] as const) {
        const asked = await requestDocumentUrl(token, passport.id);
        expect([role, level, asked.status, asked.body], "document-url").toEqual([role, level, 403, { error: "forbidden" }]);

        const read = await storage(token, object);
        expect([role, level, [400, 404].includes(read.status)], "the object").toEqual([role, level, true]);
        expect(await read.text()).not.toContain("%PDF");

        const signed = await storage(token, sign, { method: "POST", body: JSON.stringify({ expiresIn: 60 }) });
        expect([role, level, [400, 404].includes(signed.status)], "a signed link").toEqual([role, level, true]);
      }
    }
    const nobody = await requestDocumentUrl(null, passport.id);
    expect([nobody.status, nobody.body]).toEqual([401, { error: "unauthorized" }]);
    expect(accessLog(passport.id)).toEqual([]);

    // The same requests succeed for the people who may make them, so the refusals above are the rules and not the setup.
    const owner = await storage(await userToken(world.candidate), object);
    expect(owner.status).toBe(200);
    expect((await owner.text()).startsWith("%PDF")).toBe(true);
    const member = await requestDocumentUrl(await userToken(world.member), passport.id);
    expect(member.status).toBe(200);
    expect(accessLog(passport.id)).toHaveLength(1);
  });
});

