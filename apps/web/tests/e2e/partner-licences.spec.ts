import { env } from "@/lib/env";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, executeAsync, literal, query } from "./support/db";
import { enrollTotp } from "./support/login";
import { createCommittedPartner, partnerWithCompany, pickWithKeys, setPartnerRelease } from "./support/partners";
import { aal2Token } from "./support/staff";
import { signInAtAal1, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";
import { createTestUser } from "./support/test-user";

const STAFF_ONLY = "Seen only by Chara Pinnacle staff until verification is available";
const ADD_GRANT = "public.add_partner_licence(uuid, text, text, text, date, boolean)";

interface LicenceRow {
  id: string;
  country_code: string;
  issuing_authority: string;
  licence_number: string;
  valid_until: string;
  status: string;
  confirmed: boolean;
  terms_current: boolean;
  created_by: string;
  evidence_path: string | null;
  evidence_scan_status: string | null;
}

function licences(organizationId: string): LicenceRow[] {
  return query<LicenceRow>(
    `select id, country_code, issuing_authority, licence_number, valid_until::text, status, confirmed_at is not null as confirmed,
            partner_terms_version = private.current_legal_version('partner-terms') as terms_current, created_by,
            evidence_path, evidence_scan_status
     from public.partner_licences where organization_id = ${literal(organizationId)} order by created_at`,
  );
}

function seedLicence(organizationId: string, country: string, number: string, validUntil: string, status = "current"): void {
  execute(
    `insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until, status,
       confirmed_at, partner_terms_version)
     values (${literal(organizationId)}, ${literal(country)}, 'National Labour Office', ${literal(number)}, ${literal(validUntil)},
       ${literal(status)}, now(), 1)`,
  );
}

const daysFromToday = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// A PDF of 2 MB: the first bytes are what scan-document checks.
function pdf(): Buffer {
  const head = Buffer.from("%PDF-1.7\n");
  return Buffer.concat([head, Buffer.alloc(2 * 1024 * 1024 - head.length, 0x20)]);
}

// The test plays the database webhook, as for candidate documents (supabase/functions/serve-local.sh runs the function).
async function runScan(path: string): Promise<string> {
  const [object] = query<{ id: string; metadata: Record<string, unknown> }>(
    `select id, metadata from storage.objects where bucket_id = 'partner-documents' and name = ${literal(path)}`,
  );
  const response = await fetch(`http://127.0.0.1:${process.env.SCAN_DOCUMENT_PORT}`, {
    method: "POST",
    headers: { "x-edge-secret": process.env.EDGE_SHARED_SECRET ?? "", "content-type": "application/json" },
    body: JSON.stringify({
      type: "INSERT",
      schema: "storage",
      table: "objects",
      record: { id: object.id, bucket_id: "partner-documents", name: path, metadata: object.metadata },
    }),
  });
  return ((await response.json()) as { status: string }).status;
}

async function openEvidence(bearer: string, licenceId: string): Promise<{ status: number; body: { url?: string; error?: string } }> {
  const response = await fetch(`http://127.0.0.1:${process.env.DOCUMENT_URL_PORT}/`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ licenceId, purpose: "partner_review" }),
  });
  return { status: response.status, body: (await response.json()) as { url?: string; error?: string } };
}

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// other partner specs (playwright.config.ts), and the tests run one after the other.
test.describe("Licences (FR-J2)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("AC1, AC5, AC6, AC11: the owner adds a licence with a document by keyboard; staff and the owner open it, logged", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { user, id, slug } = await partnerWithCompany("recruitment_company");
    const secret = await enrollTotp(user);
    const path = `/en/org/${slug}/workforce-profile`;
    await signInAtAal2(page, user, secret, path);

    const section = page.getByRole("region", { name: "Licences" });
    await expect(section.getByRole("heading", { name: "No licences added yet" })).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    const add = section.getByRole("button", { name: "Add a licence" });
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add a licence" });
    await expect(dialog).toBeVisible();
    await pickWithKeys(page, "Country", "Philipp", "Philippines");
    await dialog.getByLabel("Issuing authority").fill("Department of Migrant Workers");
    await dialog.getByLabel("Licence or registration number").fill("DMW-123-LB-031522-R");
    await dialog.getByLabel("Valid until").fill("2028-03-15");
    await dialog.getByLabel("Supporting document (optional)").setInputFiles({
      name: "licence.pdf",
      mimeType: "application/pdf",
      buffer: pdf(),
    });
    await dialog.getByRole("checkbox", { name: "I confirm that this entry is accurate" }).focus();
    await page.keyboard.press("Space");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog.getByRole("button", { name: "Save licence" }).press("Enter");

    await expect(page.getByText("Licence saved", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toBeHidden();
    const item = section.getByRole("listitem").filter({ hasText: "Philippines" });
    await expect(item).toContainText("Department of Migrant Workers");
    await expect(item).toContainText("DMW-123-LB-031522-R");
    await expect(item).toContainText("15 March 2028");
    await expect(item).toContainText(STAFF_ONLY);

    const [row] = licences(id);
    expect(row).toMatchObject({
      country_code: "PH",
      issuing_authority: "Department of Migrant Workers",
      licence_number: "DMW-123-LB-031522-R",
      valid_until: "2028-03-15",
      status: "current",
      confirmed: true,
      terms_current: true,
      created_by: user.id,
      evidence_scan_status: "pending",
    });
    expect(row.evidence_path).toMatch(new RegExp(`^${id}/${row.id}/[0-9a-f-]{36}$`));
    const [stored] = query<{ size: number }>(
      `select (metadata ->> 'size')::integer as size from storage.objects
       where bucket_id = 'partner-documents' and name = ${literal(row.evidence_path ?? "")}`,
    );
    expect(stored.size).toBe(2 * 1024 * 1024);
    const [audit] = query<{ metadata: Record<string, unknown> }>(
      `select metadata from audit.log where action = 'partner_licence.created' and entity_id = ${literal(row.id)}`,
    );
    expect(JSON.stringify(audit.metadata)).not.toContain("DMW-123");

    // AC5: staff cannot open the file before it is scanned; the scan clears it.
    const reviewer = await createTestUser("company");
    execute(`insert into public.platform_staff (user_id, role) values (${literal(reviewer.id)}, 'verification_reviewer')`);
    const reviewerToken = await aal2Token(reviewer, await enrollTotp(reviewer));
    expect((await openEvidence(reviewerToken, row.id)).status).toBe(409);
    expect(await runScan(row.evidence_path ?? "")).toBe("skipped");

    // AC6: the Verification Reviewer at aal2 gets a 60-second link and the opening is logged; the owner, an employer and
    // anonymous do not.
    const opened = await openEvidence(reviewerToken, row.id);
    expect(opened.status).toBe(200);
    expect(opened.body.url).toContain("/storage/v1/object/sign/partner-documents/");
    const file = await fetch(opened.body.url ?? "");
    expect(file.ok).toBe(true);
    expect(Buffer.from(await file.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect(
      query<{ role: string; purpose: string }>(
        `select staff_role as role, purpose from audit.partner_document_access_log where licence_id = ${literal(row.id)}`,
      ),
    ).toEqual([{ role: "verification_reviewer", purpose: "partner_review" }]);
    expect((await openEvidence(await aal2Token(user, secret), row.id)).status).toBe(404);
    const employer = await createTestUser("company");
    expect((await openEvidence(await aal2Token(employer, await enrollTotp(employer)), row.id)).status).toBe(404);
    expect((await openEvidence(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, row.id)).status).toBe(401);

    await page.reload();
    await expect(item).toContainText("2 MB - File received");

    // The owner downloads the own file through a 60-second link; the opening is logged without a staff role.
    const download = page.waitForEvent("download");
    await item.getByRole("button", { name: "Download the document for Philippines" }).click();
    expect((await download).suggestedFilename()).toBe("licence-ph.pdf");
    expect(
      query<{ role: string | null; purpose: string }>(
        `select staff_role as role, purpose from audit.partner_document_access_log
         where licence_id = ${literal(row.id)} order by id`,
      ),
    ).toEqual([
      { role: "verification_reviewer", purpose: "partner_review" },
      { role: null, purpose: "evidence_owner" },
    ]);
  });

  test("AC11: expired entries come first; the dialog keeps focus and values when a save fails; edit and delete", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { user, id, slug } = await partnerWithCompany("staffing_company");
    seedLicence(id, "PH", "DMW-555-LB-R", daysFromToday(400));
    seedLicence(id, "DE", "BA-2026-17", daysFromToday(-3), "expired");
    seedLicence(id, "GB", "GLAA-0042", daysFromToday(90));
    const secret = await enrollTotp(user);
    await signInAtAal2(page, user, secret, `/en/org/${slug}/workforce-profile`);

    const section = page.getByRole("region", { name: "Licences" });
    const items = section.getByRole("listitem");
    await expect(items).toHaveCount(3);
    await expect(items.first()).toContainText("Germany");
    await expect(items.first()).toContainText("Expired");
    await expect(items.nth(1)).not.toContainText("Expired");

    // The dialog returns focus to the button that opened it.
    const add = section.getByRole("button", { name: "Add a licence" });
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add a licence" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(add).toBeFocused();

    // A save that fails keeps the dialog and every value, and says so in a toast.
    await page.keyboard.press("Enter");
    await pickWithKeys(page, "Country", "Neth", "Netherlands");
    await dialog.getByLabel("Issuing authority").fill("Inspectorate SZW");
    await dialog.getByLabel("Licence or registration number").fill("NL-UZB-778");
    await dialog.getByLabel("Valid until").fill(daysFromToday(200));
    await dialog.getByRole("checkbox", { name: "I confirm that this entry is accurate" }).check();
    execute(`revoke execute on function ${ADD_GRANT} from authenticated`);
    try {
      await dialog.getByRole("button", { name: "Save licence" }).click();
      await expect(page.getByText("Could not save the licence", { exact: true })).toBeVisible();
    } finally {
      execute(`grant execute on function ${ADD_GRANT} to authenticated`);
    }
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Issuing authority")).toHaveValue("Inspectorate SZW");
    await expect(dialog.getByLabel("Licence or registration number")).toHaveValue("NL-UZB-778");
    await expect(dialog.getByRole("checkbox", { name: "I confirm that this entry is accurate" })).toBeChecked();
    await dialog.getByRole("button", { name: "Save licence" }).click();
    await expect(page.getByText("Licence saved", { exact: true })).toBeVisible();
    await expect(items).toHaveCount(4);

    // The same number for the same country is refused at its field.
    await add.click();
    await pickWithKeys(page, "Country", "Neth", "Netherlands");
    await dialog.getByLabel("Issuing authority").fill("Inspectorate SZW");
    await dialog.getByLabel("Licence or registration number").fill("NL-UZB-778");
    await dialog.getByLabel("Valid until").fill(daysFromToday(200));
    await dialog.getByRole("checkbox", { name: "I confirm that this entry is accurate" }).check();
    await dialog.getByRole("button", { name: "Save licence" }).click();
    await expect(dialog.getByText("You have already added this number for this country.").first()).toBeVisible();
    await page.keyboard.press("Escape");

    // Expired -> Current: a new date with a new statement.
    await items.first().getByRole("button", { name: "Edit the licence for Germany" }).click();
    const edit = page.getByRole("dialog", { name: "Edit the licence" });
    await expect(edit.getByLabel("Licence or registration number")).toHaveValue("BA-2026-17");
    await edit.getByLabel("Valid until").fill(daysFromToday(365));
    await edit.getByRole("button", { name: "Save licence" }).click();
    await expect(edit.getByText("Confirm that this entry is accurate.").first()).toBeVisible();
    await edit.getByRole("checkbox", { name: "I confirm that this entry is accurate" }).check();
    await edit.getByRole("button", { name: "Save licence" }).click();
    await expect(page.getByText("Licence saved", { exact: true })).toBeVisible();
    await expect(section).not.toContainText("Expired");
    expect(licences(id).find((row) => row.licence_number === "BA-2026-17")?.status).toBe("current");

    // Delete, after a confirmation.
    await section.getByRole("button", { name: "Delete the licence for United Kingdom" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete the licence for United Kingdom?" });
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await confirm.getByRole("button", { name: "Delete licence" }).click();
    await expect(page.getByText("Licence deleted", { exact: true })).toBeVisible();
    await expect(items).toHaveCount(3);
    expect(licences(id).map((row) => row.country_code).sort()).toEqual(["DE", "NL", "PH"]);
  });

  test("AC4, AC11: a member reads the licences without changing them, and a skeleton shows while they load", async ({ page }) => {
    test.setTimeout(90_000);
    const { id, slug } = await partnerWithCompany("recruitment_company");
    seedLicence(id, "PH", "DMW-777-LB-R", daysFromToday(300));
    const member = await createCommittedPartner("recruitment_company");
    execute(
      `insert into public.organization_members (organization_id, user_id, role, accepted_at)
       values (${literal(id)}, ${literal(member.id)}, 'member', now())`,
    );
    const path = `/en/org/${slug}/workforce-profile`;
    await signInAtAal1(page, member, path);

    const section = page.getByRole("region", { name: "Licences" });
    await expect(section.getByRole("listitem")).toContainText("DMW-777-LB-R");
    await expect(section.getByRole("button")).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    const held = executeAsync("begin; lock table public.partner_licences in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.goto(path, { waitUntil: "commit" });
    await expect(section.getByRole("status", { name: "Loading" })).toBeVisible({ timeout: 15_000 });
    await expect(section.getByRole("listitem")).toContainText("DMW-777-LB-R", { timeout: 15_000 });
    await expect(section.getByRole("status", { name: "Loading" })).toHaveCount(0);
    await held;
  });
});
