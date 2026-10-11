import type { Browser } from "@playwright/test";
import budget from "../perf-budget.json";
import { newApplicant, seedApplication } from "./support/applications";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";
import type { TestUser } from "./support/test-user";

// The runtime half of the performance smoke (NFR-P1, NFR-P2): each key route is loaded once into an empty browser cache
// and the Performance API of the page gives the server time (request sent to first byte), the time to the load event and
// the bytes of JavaScript that crossed the network (compressed) until the network is idle, prefetches of the visible links
// included. The budgets are in tests/perf-budget.json, whose first-load sizes scripts/check-bundle-budget.mjs compares with
// the build. This is a regression smoke on the local stack, not the load test of NFR-P1 (docs/runbooks/release-checklist.md).
type Measured = { serverMs: number; loadMs: number; transferredJsBytes: number };
type Viewer = (typeof budget.routes)[number]["as"];

async function measure(browser: Browser, address: string, user: TestUser | null): Promise<Measured> {
  const context = await browser.newContext();
  if (user) await signInBrowser(context, user);
  // One request first, so that the time of loading the server code of a route is not counted.
  expect((await context.request.get(address)).status(), address).toBe(200);
  const page = await context.newPage();
  // Chunks that load after hydration may start before or after the load event; at network idle they are all counted.
  const response = await page.goto(address, { waitUntil: "networkidle" });
  expect(response?.status(), address).toBe(200);
  expect(new URL(page.url()).pathname, address).toBe(new URL(address, "http://localhost").pathname);
  const measured = await page.evaluate(() => {
    const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    const scripts = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((entry) =>
      new URL(entry.name).pathname.endsWith(".js"),
    );
    return {
      serverMs: Math.round(navigation.responseStart - navigation.requestStart),
      loadMs: Math.round(navigation.loadEventEnd - navigation.startTime),
      transferredJsBytes: scripts.reduce((sum, entry) => sum + entry.transferSize, 0),
    };
  });
  await context.close();
  return measured;
}

test("the key routes stay within their load time and JavaScript budgets", async ({ browser }, testInfo) => {
  const company = await newCompany();
  const jobId = seedJob(company, { title: "Budget welder", status: "open" });
  const candidate = await newApplicant();
  seedApplication(candidate.id, jobId, company.id);
  const member = await addCompanyUser(company, "member");
  const viewers: Record<Viewer, TestUser | null> = { visitor: null, candidate, member };
  const addresses: Record<string, string> = {
    "/[lang]": "/en",
    "/[lang]/jobs": "/en/jobs",
    "/[lang]/jobs/[id]": `/en/jobs/${jobId}`,
    "/[lang]/signup": "/en/signup",
    "/[lang]/dashboard/[kind]": "/en/dashboard/worker",
    "/[lang]/org/[slug]/applicants": `/en/org/${company.slug}/applicants?job=${jobId}`,
  };
  expect(budget.routes.map(({ route }) => route).sort()).toEqual(Object.keys(addresses).sort());

  const results = [];
  for (const { route, as, serverMs, loadMs, transferredJsBytes } of budget.routes) {
    const limits: Measured = { serverMs, loadMs, transferredJsBytes };
    results.push({ route, measured: await measure(browser, addresses[route], viewers[as]), limits });
  }
  await testInfo.attach("performance.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });

  const over = results.flatMap(({ route, measured, limits }) =>
    (Object.keys(limits) as (keyof Measured)[])
      .filter((metric) => measured[metric] > limits[metric])
      .map((metric) => `${route} ${metric} ${measured[metric]} > ${limits[metric]}`),
  );
  expect(over).toEqual([]);
});
