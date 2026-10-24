import { expectNoAxeViolations } from "./support/axe";
import { execute } from "./support/db";
import { expect, test } from "./support/test";

const DRAFT_BANNER = "Draft - not yet approved by legal counsel";

function setRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_partner_directories'`);
}

// FR-S4 AC2 needs an approved staffing-company-terms: the test publishes the next version and removes it again, so the
// seeded draft stays the current version for every other test (published versions are immutable, hence the triggers).
function publishApproved(slug: string): number {
  const version = execute(
    `insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
     select '${slug}', max(version) + 1, 'Staffing Company Terms', 'The text that counsel approved for staffing companies.',
       'The first text approved by legal counsel.', '2026-10-20T10:00:00Z', false
     from public.legal_documents where slug = '${slug}'
     returning version`,
  );
  return Number(version.trim());
}

function unpublish(slug: string, version: number): void {
  execute(
    `alter table public.legal_documents disable trigger user;
     delete from public.legal_documents where slug = '${slug}' and version = ${version};
     alter table public.legal_documents enable trigger user;`,
  );
}

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// others (playwright.config.ts), and the tests run one after the other.
test.describe("the partner legal pages (FR-S4)", () => {
  test.describe.configure({ mode: "serial" });
  test.afterAll(() => setRelease(false));

  test("while release 2a is off the partner documents have no page and no place in the index", async ({ page }) => {
    setRelease(false);
    for (const slug of ["partner-terms", "staffing-company-terms", "employer-pays-commitment", "partner-dpa", "worker-visibility-consent", "immigration-disclaimer"]) {
      expect((await page.goto(`/en/legal/${slug}`))?.status(), slug).toBe(404);
    }
    expect((await page.goto("/en/legal/terms-of-service"))?.status()).toBe(200);

    await page.goto("/en/legal");
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "Terms of Service" })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Partner network" })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Partner Terms" })).toHaveCount(0);
  });

  test("AC2: with release 2a on, a draft shows the banner above the text and an approved text shows none", async ({ page }) => {
    setRelease(true);
    const approved = publishApproved("staffing-company-terms");
    try {
      await page.goto("/en/legal");
      const index = page.getByRole("main");
      await expect(index.getByRole("heading", { name: "Partner network" })).toBeVisible();
      await expect(index.getByRole("heading", { name: "Partner data and notices" })).toBeVisible();
      await expect(index.getByRole("link", { name: "Immigration, Visa and Legal Advice Disclaimer" })).toBeVisible();
      await expectNoAxeViolations(page);

      const link = index.getByRole("link", { name: "Partner Terms", exact: true });
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/en\/legal\/partner-terms$/);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { name: "DRAFT: Partner Terms", level: 1 })).toBeVisible();
      await expect(main.getByText(/^Version 0 · Published \d{1,2} \w+ \d{4}$/)).toBeVisible();
      await expect(main.getByText("What changed: Draft placeholder pending approval by legal counsel.", { exact: true })).toBeVisible();
      const banner = main.getByText(DRAFT_BANNER, { exact: true });
      await expect(banner).toBeVisible();
      const bannerBox = await banner.boundingBox();
      const textBox = await main.getByText(/^DRAFT placeholder for review by legal counsel\./).boundingBox();
      expect(bannerBox?.y).toBeLessThan(textBox?.y ?? 0);
      await expect(main.getByRole("heading", { name: "What this document will cover", level: 2 })).toBeVisible();
      await expectNoAxeViolations(page);

      expect((await page.goto("/en/legal/staffing-company-terms"))?.status()).toBe(200);
      await expect(main.getByRole("heading", { name: "Staffing Company Terms", level: 1 })).toBeVisible();
      await expect(main.getByText(`Version ${approved} · Published 20 October 2026`, { exact: true })).toBeVisible();
      await expect(main.getByText("What changed: The first text approved by legal counsel.", { exact: true })).toBeVisible();
      await expect(main.getByText("The text that counsel approved for staffing companies.", { exact: true })).toBeVisible();
      await expect(main.getByText(DRAFT_BANNER)).toHaveCount(0);

      await page.goto("/en/legal/immigration-disclaimer");
      await expect(main.getByRole("heading", { name: "DRAFT: Immigration, visa and legal advice disclaimer", level: 1 })).toBeVisible();
      await expect(main.getByText(DRAFT_BANNER, { exact: true })).toBeVisible();
    } finally {
      unpublish("staffing-company-terms", approved);
    }
  });
});
