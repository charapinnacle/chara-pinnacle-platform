import { execute } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { expect, test } from "./support/test";

const GET_PUBLIC_SETTINGS = "public.get_public_settings()";

// The accessor is withdrawn from the API roles for the whole database while this file runs, so it has a project of its
// own that follows the others (playwright.config.ts).
test.describe.configure({ mode: "serial" });
test.afterEach(() => {
  execute(`grant execute on function ${GET_PUBLIC_SETTINGS} to anon, authenticated`);
});

test.describe("the public pages when the settings cannot be read", () => {
  test("FR-H1 AC8: the pages that show them answer 500 with the error page, no details and a retry that works", async ({
    page,
  }) => {
    execute(`revoke execute on function ${GET_PUBLIC_SETTINGS} from anon, authenticated`);

    for (const path of ["/en/imprint", "/en/contact", "/en/legal/privacy-policy"]) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(500);
      const html = await response.text();
      expect(html, path).not.toContain("permission denied");
      expect(html, path).not.toContain("get_public_settings");
    }

    await page.goto("/en/imprint");
    await expect(page.getByRole("heading", { name: "This page could not be loaded" })).toBeVisible();
    await expect(page.getByRole("region", { name: /Notification/ }).getByText("This page could not be loaded")).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/permission denied|get_public_settings|^\s+at /m);
    await expect(page.getByRole("link", { name: "Find Jobs" })).toBeVisible();

    execute(`grant execute on function ${GET_PUBLIC_SETTINGS} to anon, authenticated`);
    const retry = page.getByRole("button", { name: "Try again" });
    await waitForHydration(retry);
    await retry.click();
    await expect(page.getByRole("heading", { name: "Imprint", level: 1 })).toBeVisible();
  });

  test("FR-H1 AC8: a page that does not show the settings is not affected", async ({ page }) => {
    execute(`revoke execute on function ${GET_PUBLIC_SETTINGS} from anon, authenticated`);
    for (const path of ["/en", "/en/pricing", "/en/legal/terms-of-service"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
  });
});
