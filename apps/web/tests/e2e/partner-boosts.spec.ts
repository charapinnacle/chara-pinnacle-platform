import { randomUUID } from "node:crypto";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { deliverBillingEvent, HOSTED_ORIGIN, stubHostedPages } from "./support/billing";
import { execute, literal, query } from "./support/db";
import { enrollTotp } from "./support/login";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

const DIRECTORY = "/en/partners/recruitment";
const NOTE =
  "Paid placement. Boosted companies that match your search appear here, apart from the results; paying never changes the order of the results.";

function setBoostRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_boosts'`);
}

const boostPath = (slug: string) => `/en/org/${slug}/boost`;

// A listed recruitment company that serves Germany with welders (occupation 7212), as the review leaves it.
async function listedWelders(): Promise<Awaited<ReturnType<typeof partnerWithCompany>>> {
  const partner = await partnerWithCompany("recruitment_company");
  execute(
    `update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day',
       submitted_at = now() - interval '2 days' where id = ${literal(partner.id)};
     insert into public.organization_geographies (organization_id, scope, country_code)
     values (${literal(partner.id)}, 'serves_market', 'DE'), (${literal(partner.id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(partner.id)}, '7212')`,
  );
  return partner;
}

const boostCount = (organizationId: string) =>
  query<{ n: number }>(`select count(*)::int as n from billing.boosts where organization_id = ${literal(organizationId)}`)[0].n;

// Release 2a and the boosts are set for the whole database while this file runs, so it is a project of its own that
// follows the other release projects (playwright.config.ts), one test after the other. The order of the organic results
// with and without a boost is proved in supabase/tests/database/229_partner_boosts.test.sql.
test.describe("boosted partner profiles (ARCHITECTURE.md section 10.1)", () => {
  test.describe.configure({ mode: "serial" });
  const created: string[] = [];
  test.beforeAll(() => {
    setPartnerRelease(true);
    setBoostRelease(true);
  });
  test.afterAll(() => {
    if (created.length > 0) {
      execute(`delete from billing.boosts where organization_id in (${created.map(literal).join(", ")})`);
    }
    setBoostRelease(false);
    setPartnerRelease(false);
  });

  test("the owner buys a boost from the workforce profile and the profile is boosted once the payment arrives", async ({ page }) => {
    test.setTimeout(120_000);
    const partner = await listedWelders();
    created.push(partner.id);
    const secret = await enrollTotp(partner.user);
    const hosted = await stubHostedPages(page);
    const workforce = `/en/org/${partner.slug}/workforce-profile`;
    await signInAtAal2(page, partner.user, secret, workforce);

    await page.getByRole("link", { name: "Boost your profile" }).click();
    await expect(page).toHaveURL(boostPath(partner.slug));
    await expect(page.getByRole("heading", { level: 1, name: "Boost profile" })).toBeVisible();
    await expect(page.getByText("Your profile is not boosted.")).toBeVisible();
    const products = page.getByRole("region", { name: "Boosts" });
    await expect(products.getByRole("heading", { level: 3 })).toHaveText(["7 days", "14 days", "30 days"]);
    await expect(products).toContainText("EUR 109.00 for 14 days, excl. VAT");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await products.getByRole("button", { name: "Boost profile for 14 days" }).click();
    await expect(page).toHaveURL(new RegExp(`^${HOSTED_ORIGIN}/checkout/`));
    expect(hosted.visits[0].searchParams.get("success_url")).toMatch(new RegExp(`/en/org/${partner.slug}/boost$`));
    expect(boostCount(partner.id), "no boost before the payment is reported").toBe(0);

    const delivery = await deliverBillingEvent({
      kind: "boost.paid",
      orgId: partner.id,
      sku: "boost_recruitment_14d",
      providerPaymentRef: `pi_${randomUUID().slice(0, 8)}`,
      amountMinor: 12971,
      taxMinor: 2071,
      currency: "EUR",
    });
    expect(delivery.status).toBe(200);
    expect(boostCount(partner.id)).toBe(1);

    await page.getByRole("link", { name: "success_url" }).click();
    await expect(page).toHaveURL(boostPath(partner.slug));
    await expect(page.getByText(/Your profile is boosted until/)).toBeVisible();
    await expect(page.getByText("A boost you buy now starts when the current one ends.")).toBeVisible();
  });

  test("a visitor sees the boosted company in the rail only when it matches the search, labelled Boosted", async ({ page }) => {
    const partner = await listedWelders();
    created.push(partner.id);
    execute(
      `insert into billing.boosts (organization_id, sku, target_type, target_id, starts_at, ends_at, provider, provider_payment_ref)
       values (${literal(partner.id)}, 'boost_recruitment_7d', 'organization', ${literal(partner.id)}, now() - interval '1 hour',
         now() + interval '7 days', 'null', ${literal(`pi_${randomUUID().slice(0, 8)}`)})`,
    );
    const [{ display_name: name }] = query<{ display_name: string }>(
      `select display_name from public.organizations where id = ${literal(partner.id)}`,
    );

    await page.goto(`${DIRECTORY}?occupation=7212&destination=DE`);
    const rail = page.getByRole("region", { name: "Boosted companies" });
    await expect(rail).toBeVisible();
    await expect(rail.getByText(NOTE)).toBeVisible();
    const card = rail.getByRole("listitem").filter({ hasText: name });
    await expect(card.getByText("Boosted", { exact: true })).toBeVisible();
    await expect(card.getByRole("link", { name })).toHaveAttribute("href", `/en/partners/${partner.slug}`);
    expect(await rail.getByRole("listitem").count()).toBeLessThanOrEqual(3);
    await expectAccessibleAtBothWidths(page);

    await page.goto(`${DIRECTORY}?occupation=5120&destination=DE`);
    await expect(page.getByRole("region", { name: "Boosted companies" }).getByText(name)).toHaveCount(0);

    setBoostRelease(false);
    await page.goto(`${DIRECTORY}?occupation=7212&destination=DE`);
    await expect(page.getByRole("region", { name: "Boosted companies" })).toHaveCount(0);
    setBoostRelease(true);
  });

  test("the boost page does not exist while the boosts are off, and the ranking page names the rail while they are on", async ({ page, request }) => {
    const partner = await listedWelders();
    created.push(partner.id);
    setBoostRelease(false);
    const secret = await enrollTotp(partner.user);
    await signInAtAal2(page, partner.user, secret, `/en/org/${partner.slug}/workforce-profile`);
    await expect(page.getByRole("link", { name: "Boost your profile" })).toHaveCount(0);
    expect((await page.goto(boostPath(partner.slug)))?.status()).toBe(404);
    expect(await (await request.get("/en/legal/ranking")).text()).not.toContain("Boosted companies");

    setBoostRelease(true);
    await page.goto("/en/legal/ranking");
    await expect(page.getByRole("heading", { level: 2, name: "Boosted companies" })).toBeVisible();
    await expect(page.getByText("A boost never changes the order of the results", { exact: false })).toBeVisible();
  });
});
