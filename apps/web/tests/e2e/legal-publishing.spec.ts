import { enrolledStaff, signInStaff, uniqueTag } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { logIn } from "./support/login-page";
import { staffUser } from "./support/mfa";
import { signInAtAal2, newVisitor } from "./support/team";
import { expect, test } from "./support/test";

// Documents of a test's own: publishing a version of a document that other tests read would change their page.
function seedDocument(slug: string, versions: number): void {
  const rows = Array.from(
    { length: versions },
    (_, i) =>
      `(${literal(slug)}, ${i + 1}, 'Terms of the test', ${literal(`Body of version ${i + 1}.`)}, ${literal(`Summary of version ${i + 1}.`)}, now() - interval '${versions - i} days')`,
  );
  execute(`insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values ${rows.join(", ")}`);
}

function versionsOf(slug: string) {
  return query<{ version: number; body: string; is_draft: boolean }>(
    `select version, body, is_draft from public.legal_documents where slug = ${literal(slug)} order by version`,
  );
}

test.describe("publishing and exporting legal documents", () => {
  test("FR-H3 AC11: the administrator publishes through the form, an empty text is refused, and the export holds every version", async ({ page }) => {
    const tag = uniqueTag();
    const terms = `e2e-terms-${tag}`;
    const privacy = `e2e-privacy-${tag}`;
    seedDocument(terms, 3);
    seedDocument(privacy, 1);

    await signInStaff(page, "admin", `/en/admin/legal?slug=${terms}`);
    await expect(page.getByRole("heading", { name: "Legal documents", level: 1 })).toBeVisible();
    const row = page.getByRole("table", { name: "Current versions of the legal documents" }).getByRole("row", { name: new RegExp(terms) });
    await expect(row).toContainText("Approved");
    await expectNoAxeViolations(page);

    const slug = page.getByLabel("Document name");
    await waitForHydration(slug);
    await expect(slug).toHaveValue(terms);
    await page.getByLabel("Change summary").fill("Adds the scope of the service.");
    await page.getByRole("button", { name: "Publish new version" }).click();
    await expect(page.getByText("Enter the text of the document").first()).toBeVisible();
    expect(versionsOf(terms)).toHaveLength(3);

    await page.getByLabel("Text of the document").fill("## Scope\n\nThe new text.");
    await page.getByLabel(/This text is a draft/).check();
    await page.getByRole("button", { name: "Publish new version" }).click();
    await expect(page.getByText("Published version 4", { exact: true })).toBeVisible();
    expect(versionsOf(terms).at(-1)).toEqual({ version: 4, body: "## Scope\n\nThe new text.", is_draft: true });
    expect(query(`select 1 from audit.log where action = 'legal_document.publish' and entity_id = ${literal(`${terms}:4`)}`)).toHaveLength(1);
    await expect(row).toContainText("Draft");

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export all versions" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^legal-documents-\d{4}-\d{2}-\d{2}\.json$/);
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const entries = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>[]).filter(
      (entry) => entry.slug === terms || entry.slug === privacy,
    );
    expect(entries).toHaveLength(5);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(["body", "change_summary", "is_draft", "published_at", "slug", "title", "version"]);
    }
    expect(entries.filter((entry) => entry.slug === terms).map((entry) => entry.version)).toEqual([1, 2, 3, 4]);
    expect(entries.find((entry) => entry.slug === terms && entry.version === 4)).toMatchObject({
      body: "## Scope\n\nThe new text.",
      change_summary: "Adds the scope of the service.",
      is_draft: true,
    });

    await page.goto(`/en/legal/${terms}`);
    await expect(page.getByText("Version 4", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Draft - not yet approved by legal counsel", { exact: true })).toBeVisible();
  });

  test("FR-H3 AC11: an administrator at the first step is sent to the two-step page, and Trust & Safety gets no form and no file", async ({ page, browser }) => {
    const unverified = await staffUser("admin");
    await logIn(page, unverified);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    await page.goto("/en/admin/legal");
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/admin/legal")}`);
    await expect(page.getByLabel("Document name")).toHaveCount(0);
    const refused = await page.request.get("/en/admin/legal/export", { maxRedirects: 0 });
    expect(refused.status()).toBeGreaterThanOrEqual(300);
    expect(refused.status()).toBeLessThan(400);
    expect(refused.headers().location).toContain("/en/mfa");
    expect(refused.headers()["content-type"] ?? "").not.toContain("json");

    const other = await newVisitor(browser);
    const trust = await enrolledStaff("trust_safety");
    await signInAtAal2(other.page, trust.user, trust.secret, "/en/admin/legal");
    await expect(other.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(other.page.getByLabel("Document name")).toHaveCount(0);
    await expect(other.page.getByRole("button", { name: "Export all versions" })).toHaveCount(0);
    const notFound = await other.page.request.get("/en/admin/legal/export", { maxRedirects: 0 });
    expect(notFound.status()).toBe(404);
    expect(notFound.headers()["content-type"] ?? "").not.toContain("json");
  });

  test("FR-H3 AC8: two administrators who publish the same document at the same moment get two consecutive versions", async ({ page, browser }) => {
    const slug = `e2e-concurrent-${uniqueTag()}`;
    seedDocument(slug, 1);
    await signInStaff(page, "admin", `/en/admin/legal?slug=${slug}`);
    const second = await newVisitor(browser);
    const other = await enrolledStaff("admin");
    await signInAtAal2(second.page, other.user, other.secret, `/en/admin/legal?slug=${slug}`);

    const texts = ["The body that the first administrator wrote.", "The body that the second administrator wrote."];
    for (const [index, tab] of [page, second.page].entries()) {
      await waitForHydration(tab.getByLabel("Document name"));
      await expect(tab.getByLabel("Document name")).toHaveValue(slug);
      await tab.getByLabel("Text of the document").fill(texts[index]);
      await tab.getByLabel("Change summary").fill(`Change number ${index + 1} of the concurrent test.`);
    }
    await Promise.all([page, second.page].map((tab) => tab.getByRole("button", { name: "Publish new version" }).click()));

    const published = await Promise.all(
      [page, second.page].map(async (tab) => (await tab.getByText(/^Published version \d+$/).textContent()) ?? ""),
    );
    expect(published.sort()).toEqual(["Published version 2", "Published version 3"]);
    const versions = versionsOf(slug);
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3]);
    expect(versions.slice(1).map((row) => row.body).sort()).toEqual([...texts].sort());
    expect(query(`select 1 from audit.log where action = 'legal_document.publish' and entity_id like ${literal(`${slug}:%`)}`)).toHaveLength(2);
  });
});
