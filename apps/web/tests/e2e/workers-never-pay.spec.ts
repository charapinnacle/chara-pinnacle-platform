import type { Page } from "@playwright/test";
import { applicationUrl, newApplicant, seedApplication } from "./support/applications";
import { billingPath, checkoutPath } from "./support/billing";
import { query, literal } from "./support/db";
import { expectNotFound, newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { uniqueName } from "./support/organizations";
import { newTeam, signInAtAal2 } from "./support/team";
import { userToken } from "./support/accounts";
import { expect, test } from "./support/test";

const STRIPE = /stripe/i;

// What a candidate must never see: a link to pricing, billing or checkout, a button that sells, a Stripe script or
// frame, a price of CHARA. The same scan runs on an employer's billing page as the control that shows it can find them.
async function paymentElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const link of document.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") ?? "";
      if (/pricing|billing|checkout|subscri/i.test(href)) found.push(`link ${href}`);
    }
    for (const control of document.querySelectorAll("a, button, [role=button], input[type=submit]")) {
      const label = (control.textContent || (control as HTMLInputElement).value || "").trim();
      if (/^(subscribe|upgrade|start (your )?(free )?trial|pay\b|choose\b|continue to payment)/i.test(label)) {
        found.push(`control ${label}`);
      }
    }
    for (const element of document.querySelectorAll("script[src], iframe[src]")) {
      if (/stripe/i.test(element.getAttribute("src") ?? "")) found.push(`embed ${element.getAttribute("src")}`);
    }
    const price = document.body.innerText.match(/(€|EUR)\s?\d|\d\s?(€|EUR)|(excl\.?|exclusive of) VAT/i);
    if (price) found.push(`price ${price[0]}`);
    return found;
  });
}

function stripeRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (STRIPE.test(new URL(request.url()).hostname)) seen.push(request.url());
  });
  return seen;
}

test.describe("FR-G6: no pricing or payment element in the candidate area", () => {
  test("AC5: the pages of a signed-in candidate hold no link to pricing, billing or checkout, no selling button, no Stripe and no price", async ({ page }) => {
    const candidate = await newApplicant();
    const company = await newCompany();
    const job = seedJob(company, { title: "Welder for the FR-G6 scan", status: "open" });
    const application = seedApplication(candidate.id, job, company.id);
    const stripe = stripeRequests(page);

    await logIn(page, candidate, "/en/dashboard/worker");
    await expect(page).toHaveURL("/en/dashboard/worker");
    const pages: [string, string][] = [
      ["/en/dashboard/worker", "Dashboard"],
      ["/en/passport", "Your passport"],
      ["/en/applications", "My applications"],
      [applicationUrl(application), "Welder for the FR-G6 scan"],
      ["/en/settings", "Settings"],
      ["/en/settings/notifications", "Notification settings"],
      ["/en/saved", "Saved vacancies"],
    ];
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading }).first(), path).toBeVisible();
      expect(await paymentElements(page), path).toEqual([]);
    }
    expect(stripe).toEqual([]);
  });

  test("AC5 control: the scan finds the plan choice and the prices on an employer's billing page", async ({ page }) => {
    const team = await newTeam(uniqueName("Scan Bau"));
    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    const found = await paymentElements(page);
    expect(found).toContain(`link ${checkoutPath(team.slug)}`);
    expect(found.some((entry) => entry.startsWith("control Choose"))).toBe(true);
    expect(found.some((entry) => entry.startsWith("price "))).toBe(true);
  });

  test("AC6: the billing and checkout addresses answer a candidate with the page of an unknown address, whether or not the organisation exists", async ({ page }) => {
    const candidate = await newApplicant();
    const name = uniqueName("Hidden Bau");
    const team = await newTeam(name);
    const stripe = stripeRequests(page);
    await logIn(page, candidate, "/en/dashboard/worker");
    await expect(page).toHaveURL("/en/dashboard/worker");

    const bodies: string[] = [];
    for (const path of [billingPath(team.slug), billingPath("unknown-org"), checkoutPath(team.slug), checkoutPath("unknown-org")]) {
      await expectNotFound(page, path);
      await expect(page, path).toHaveURL(path);
      const text = await page.locator("main").innerText();
      expect(text).not.toContain(name);
      bodies.push(text);
    }
    expect(new Set(bodies).size).toBe(1);
    expect(stripe).toEqual([]);
  });
});

test.describe("FR-G6: the billing-checkout function refuses a candidate and records the attempt", () => {
  const endpoint = () => {
    const url = process.env.BILLING_CHECKOUT_ENDPOINT;
    if (!url) throw new Error("BILLING_CHECKOUT_ENDPOINT is not set");
    return url;
  };

  async function call(token: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  const refusals = (userId: string) =>
    query<{ actor_id: string; entity_type: string; entity_id: string; metadata: unknown }>(
      `select actor_id, entity_type, entity_id, metadata from audit.log
       where action = 'billing.worker_checkout_refused' and actor_id = ${literal(userId)} order by id`,
    );

  const billingRows = (organizationId: string, userId: string) =>
    query<{ table: string; n: number }>(
      `select 'customers' as table, count(*)::int as n from billing.customers where organization_id = ${literal(organizationId)}
       union all select 'subscriptions', count(*)::int from billing.subscriptions where organization_id = ${literal(organizationId)}
       union all select 'starts', count(*)::int from audit.log where entity_id = ${literal(organizationId)} and action like 'billing.%'
       union all select 'consents', count(*)::int from public.consents where user_id = ${literal(userId)} and purpose = 'subscription-and-billing-terms'`,
    );

  test("AC1, AC7 and the SOP test: a candidate's checkout and portal are refused with a generic answer, create nothing and are each counted", async () => {
    const candidate = await newApplicant();
    const team = await newTeam(uniqueName("Refuse Bau"));
    const token = await userToken(candidate);
    const checkout = {
      action: "checkout",
      orgId: team.id,
      planCode: "employer_starter",
      billingCountry: "DE",
      vatId: "DE123456789",
      registrationNumber: null,
      termsVersion: 0,
      disclosedTrialDays: null,
    };

    expect(await call(token, checkout)).toEqual({ status: 403, body: { error: "forbidden", reason: null } });
    expect(await call(token, { action: "portal", orgId: team.id })).toEqual({
      status: 403,
      body: { error: "forbidden", reason: null },
    });
    expect(await call(token, { ...checkout, orgId: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11" })).toEqual({
      status: 403,
      body: { error: "forbidden", reason: null },
    });

    expect(refusals(candidate.id)).toEqual(
      Array.from({ length: 3 }, () => ({
        actor_id: candidate.id,
        entity_type: "profile",
        entity_id: candidate.id,
        metadata: {},
      })),
    );
    expect(billingRows(team.id, candidate.id)).toEqual([
      { table: "customers", n: 0 },
      { table: "subscriptions", n: 0 },
      { table: "starts", n: 0 },
      { table: "consents", n: 0 },
    ]);
  });

  test("a company user that is refused for another reason is not recorded as a candidate attempt", async () => {
    const team = await newTeam(uniqueName("Other Bau"));
    const token = await userToken(team.owner);
    expect(await call(token, { action: "portal", orgId: team.id })).toEqual({
      status: 403,
      body: { error: "forbidden", reason: "aal2_required" },
    });
    expect(refusals(team.owner.id)).toEqual([]);
  });
});
