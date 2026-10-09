import { uniqueTag } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal } from "./support/db";
import { expect, test } from "./support/test";

// Every test works on slugs of its own: a legal document that other tests read is never changed.
function publish(slug: string, versions: { version: number; publishedAt: string; body: string; summary: string; draft?: boolean }[]): void {
  const rows = versions.map(
    (v) =>
      `(${literal(slug)}, ${v.version}, ${literal("Terms of the test")}, ${literal(v.body)}, ${literal(v.summary)}, ${literal(v.publishedAt)}, ${v.draft ?? false})`,
  );
  execute(`insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft) values ${rows.join(", ")}`);
}

test.describe("the legal pages", () => {
  test("FR-H3 AC1: the page shows the current version, its date and summary, and a change log of every version", async ({ page }) => {
    const slug = `e2e-terms-${uniqueTag()}`;
    publish(slug, [
      { version: 1, publishedAt: "2026-09-01T10:00:00Z", body: "Body of the first version.", summary: "The first approved text." },
      { version: 2, publishedAt: "2026-09-20T10:00:00Z", body: "Body of the second version.", summary: "Shortens the notice period." },
      {
        version: 3,
        publishedAt: "2026-10-01T23:30:00Z",
        body: "## Scope\n\nThe first paragraph of the scope.\n\nThe second paragraph of the scope.",
        summary: "Adds the scope of the service.",
      },
    ]);

    const response = await page.goto(`/en/legal/${slug}`);
    expect(response?.status()).toBe(200);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Terms of the test", level: 1 })).toBeVisible();
    await expect(main.getByText("Version 3 · Published 1 October 2026", { exact: true })).toBeVisible();
    await expect(main.getByText("What changed: Adds the scope of the service.", { exact: true })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Scope", level: 2 })).toBeVisible();
    await expect(main.locator("p", { hasText: /^The first paragraph of the scope\.$/ })).toHaveCount(1);
    await expect(main.locator("p", { hasText: /^The second paragraph of the scope\.$/ })).toHaveCount(1);
    await expect(main.getByText("Body of the first version.")).toHaveCount(0);
    await expect(main.getByText("Body of the second version.")).toHaveCount(0);

    const log = main.getByRole("region", { name: "Change log" }).getByRole("listitem");
    await expect(log).toHaveText([
      /Version 3 · 1 October 2026\s*Adds the scope of the service\./,
      /Version 2 · 20 September 2026\s*Shortens the notice period\./,
      /Version 1 · 1 September 2026\s*The first approved text\./,
    ]);
    await expect(main.getByText("Draft - not yet approved by legal counsel")).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("FR-H3 AC3: a draft shows a banner above the text and an approved text shows none", async ({ page }) => {
    const draft = `e2e-draft-${uniqueTag()}`;
    const approved = `e2e-approved-${uniqueTag()}`;
    publish(draft, [{ version: 1, publishedAt: "2026-10-01T10:00:00Z", body: "The text of the draft.", summary: "A text for review.", draft: true }]);
    publish(approved, [{ version: 1, publishedAt: "2026-10-01T10:00:00Z", body: "The text that counsel approved.", summary: "An approved text." }]);

    await page.goto(`/en/legal/${draft}`);
    const banner = page.getByRole("main").getByText("Draft - not yet approved by legal counsel", { exact: true });
    await expect(banner).toBeVisible();
    const bannerBox = await banner.boundingBox();
    const textBox = await page.getByText("The text of the draft.", { exact: true }).boundingBox();
    expect(bannerBox?.y).toBeLessThan(textBox?.y ?? 0);
    await expectNoAxeViolations(page);

    await page.goto(`/en/legal/${approved}`);
    await expect(page.getByText("The text that counsel approved.", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft - not yet approved by legal counsel")).toHaveCount(0);
  });

  test("FR-H3 AC3: the placeholders that start the Phase 1 documents are drafts", async ({ page }) => {
    await page.goto("/en/legal/cookie-policy");
    await expect(page.getByRole("main").getByText("Draft - not yet approved by legal counsel", { exact: true })).toBeVisible();
  });

  test("FR-H3 AC12: markup in the text is shown as text and nothing runs", async ({ page }) => {
    const slug = `e2e-escaped-${uniqueTag()}`;
    publish(slug, [
      {
        version: 1,
        publishedAt: "2026-10-01T10:00:00Z",
        body: "<script>window.hacked=1</script>\n\n<img src=x onerror=window.hacked=1>",
        summary: "A text with markup in it.",
      },
    ]);
    await page.addInitScript(() => {
      const violations: string[] = [];
      Object.assign(window, { violations });
      document.addEventListener("securitypolicyviolation", (event) => violations.push(event.violatedDirective));
    });

    await page.goto(`/en/legal/${slug}`);
    const main = page.getByRole("main");
    await expect(main.getByText("<script>window.hacked=1</script>", { exact: true })).toBeVisible();
    await expect(main.getByText("<img src=x onerror=window.hacked=1>", { exact: true })).toBeVisible();
    await expect(main.locator("script, img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined();
    expect(await page.evaluate(() => (window as unknown as { violations: string[] }).violations)).toEqual([]);
  });
});
