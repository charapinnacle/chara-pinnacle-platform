import { expect, test } from "@playwright/test";

test("home page renders at /en", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });

  await page.goto("/en");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { level: 1, name: "The Global Workforce Network" }),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test("built server sends security headers and a nonce CSP (NFR-S5)", async ({
  request,
}) => {
  const response = await request.get("/en");
  const headers = response.headers();

  expect(response.status()).toBe(200);
  expect(headers["strict-transport-security"]).toContain("max-age=63072000");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-powered-by"]).toBeUndefined();

  const scriptSrc = headers["content-security-policy"]
    .split("; ")
    .find((directive) => directive.startsWith("script-src "));
  const nonce = /'nonce-([^']+)'/.exec(scriptSrc ?? "")?.[1];
  expect(nonce).toBeTruthy();
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).not.toContain("'unsafe-eval'");
  expect(await response.text()).toContain(`nonce="${nonce}"`);
});
