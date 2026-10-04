import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";

function parseCsp(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split("; ").map((directive) => {
      const [name, ...values] = directive.split(" ");
      return [name, values.join(" ")];
    }),
  );
}

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
  expect(headers["strict-transport-security"]).toContain("includeSubDomains");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-powered-by"]).toBeUndefined();

  const csp = parseCsp(headers["content-security-policy"]);
  const nonce = /'nonce-([^']+)'/.exec(csp["script-src"] ?? "")?.[1];
  expect(nonce).toBeTruthy();
  expect(csp["script-src"]).toContain("'strict-dynamic'");
  expect(csp["script-src"]).not.toContain("'unsafe-inline'");
  expect(csp["script-src"]).not.toContain("'unsafe-eval'");
  expect(csp["style-src"]).toContain(`'nonce-${nonce}'`);
  expect(csp["default-src"]).toBe("'self'");
  expect(csp["object-src"]).toBe("'none'");
  expect(csp["base-uri"]).toBe("'self'");
  expect(csp["frame-ancestors"]).toBe("'none'");
  expect(await response.text()).toContain(`nonce="${nonce}"`);

  const other = await request.get("/en");
  const otherNonce = /'nonce-([^']+)'/.exec(
    parseCsp(other.headers()["content-security-policy"])["script-src"] ?? "",
  )?.[1];
  expect(otherNonce).toBeTruthy();
  expect(otherNonce).not.toBe(nonce);
});
