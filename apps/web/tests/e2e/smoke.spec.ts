import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { expectSecurityHeaders, parseCsp } from "./support/security-headers";

test("home page renders at /en", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });

  await page.goto("/en");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "The Global Workforce Network",
    }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  expect(problems).toEqual([]);
});

test("an unknown address shows the not-found page with no accessibility violations", async ({ page }) => {
  const response = await page.goto("/en/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("built server sends security headers and a nonce CSP (NFR-S5)", async ({ request }) => {
  const response = await request.get("/en");
  const headers = response.headers();

  expect(response.status()).toBe(200);
  expectSecurityHeaders(headers, "/en");
  const nonce = /'nonce-([^']+)'/.exec(parseCsp(headers["content-security-policy"])["script-src"] ?? "")?.[1];
  expect(await response.text()).toContain(`nonce="${nonce}"`);

  const other = await request.get("/en");
  const otherNonce = /'nonce-([^']+)'/.exec(
    parseCsp(other.headers()["content-security-policy"])["script-src"] ?? "",
  )?.[1];
  expect(otherNonce).toBeTruthy();
  expect(otherNonce).not.toBe(nonce);
});
