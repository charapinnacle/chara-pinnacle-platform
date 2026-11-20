import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { enrollTotp } from "./support/login";
import {
  chips,
  createCommittedPartner,
  lapseToFreePlan,
  partnerWithCompany,
  pickWithKeys,
  setPartnerRelease,
} from "./support/partners";
import { signInAtAal1, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

const SUPPLIES_FOR = "Where do you supply workers for?";

function prompts(organizationId: string): string[] {
  return query<{ key: string }>(
    `select metadata ->> 'limit_key' as key from audit.log
     where action = 'limit.prompt_shown' and entity_id = ${literal(organizationId)} order by id`,
  ).map((row) => row.key);
}

// A staffing company on its free plan (lapsed, so the limits apply without the global switch): Germany, the United Arab
// Emirates and Saudi Arabia served, workers from the Philippines, welders.
function seedProfile(organizationId: string, served: string[]): void {
  lapseToFreePlan(organizationId);
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code)
     select ${literal(organizationId)}, 'serves_market', c from unnest(${literal(`{${served.join(",")}}`)}::text[]) c;
     insert into public.organization_geographies (organization_id, scope, country_code)
     values (${literal(organizationId)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(organizationId)}, '7212');
     update public.organizations set recruitment_type = 'both' where id = ${literal(organizationId)};
     insert into public.organization_service_types (organization_id, service) values (${literal(organizationId)}, 'temporary')`,
  );
}

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// other partner specs (playwright.config.ts), and the tests run one after the other.
test.describe("Partner usage and the upgrade prompt (FR-R1)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("the owner at a limit sees the usage, the plan, the higher plans and the billing link, and each prompt is recorded", async ({ page }) => {
    test.setTimeout(90_000);
    const { user, id, slug } = await partnerWithCompany("staffing_company");
    seedProfile(id, ["DE", "AE", "SA"]);
    const secret = await enrollTotp(user);
    await signInAtAal2(page, user, secret, `/en/org/${slug}/workforce-profile`);

    // The free plan includes no listing: the section shows the prompt instead of the add button, and reports it.
    const availability = page.getByRole("region", { name: "Availability" });
    await expect(availability).toContainText("Workforce listings are not included in your Free plan.");
    await expect(availability).toContainText(
      "Basic includes 10 workforce listings; Professional includes 50 workforce listings; Enterprise has no limit.",
    );
    await expect(availability.getByRole("button", { name: "Add a listing" })).toHaveCount(0);
    await expect(availability.getByRole("link")).toHaveText(["Upgrade your plan"]);
    await expect(availability.getByRole("link")).toHaveAttribute("href", `/en/org/${slug}/billing`);
    await expect.poll(() => prompts(id)).toEqual(["workforce_listings"]);

    // A fourth served country is not added; the prompt in the live region names the usage and is reported.
    const serve = page.getByRole("region", { name: "Where you serve" });
    await expect(serve.getByText("3 of 3 countries", { exact: true })).toBeVisible();
    await pickWithKeys(page, SUPPLIES_FOR, "fran", "France");
    await expect(chips(page, SUPPLIES_FOR)).toHaveCount(3);
    const notice = serve.getByRole("status").filter({ hasText: "3 of 3 countries served on your Free plan." });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Professional includes 10 countries served; Enterprise has no limit.");
    await expect.poll(() => prompts(id)).toEqual(["workforce_listings", "markets"]);
    await expectAccessibleAtBothWidths(page);
  });

  test("a refusal from the database is worded for the limit and reported, and the chosen countries stay", async ({ page }) => {
    test.setTimeout(90_000);
    const { user, id, slug } = await partnerWithCompany("staffing_company");
    seedProfile(id, ["DE", "AE"]);
    const secret = await enrollTotp(user);
    await signInAtAal2(page, user, secret, `/en/org/${slug}/workforce-profile`);

    const serve = page.getByRole("region", { name: "Where you serve" });
    await expect(serve.getByText("2 of 3 countries", { exact: true })).toBeVisible();
    await pickWithKeys(page, SUPPLIES_FOR, "saudi", "Saudi Arabia");
    await expect(serve.getByText("3 of 3 countries", { exact: true })).toBeVisible();
    // The limit drops while the form is open: the free plan's limit is lowered for a moment (the tests of this file run one
    // after the other; an override would not do, as overrides apply on Enterprise plans only since FR-R2), and the
    // database refuses the third country.
    execute(`update billing.plan_limits set limit_value = 2 where plan_code = 'free_staffing_company' and limit_key = 'markets'`);
    try {
      await serve.getByRole("button", { name: "Save countries" }).click();
      await expect(page.locator("#geo-serves-market-error")).toContainText("Your plan's limit of countries served is reached.");
      await expect.poll(() => prompts(id)).toContain("markets");
    } finally {
      execute(`update billing.plan_limits set limit_value = 3 where plan_code = 'free_staffing_company' and limit_key = 'markets'`);
    }
    await expect(chips(page, SUPPLIES_FOR)).toHaveText(["United Arab Emirates", "Germany", "Saudi Arabia"]);
    await expect(serve.getByText(/markets|CHARA/)).toHaveCount(0);
    expect(
      query<{ count: number }>(
        `select count(*)::integer as count from public.organization_geographies
         where organization_id = ${literal(id)} and scope = 'serves_market'`,
      )[0].count,
    ).toBe(2);
    await expectAccessibleAtBothWidths(page);
  });

  test("a member reads the profile without a prompt and reports none", async ({ page }) => {
    test.setTimeout(90_000);
    const { id, slug } = await partnerWithCompany("staffing_company");
    seedProfile(id, ["DE", "AE", "SA"]);
    const member = await createCommittedPartner("staffing_company");
    execute(
      `insert into public.organization_members (organization_id, user_id, role, accepted_at)
       values (${literal(id)}, ${literal(member.id)}, 'member', now())`,
    );
    await signInAtAal1(page, member, `/en/org/${slug}/workforce-profile`);

    const availability = page.getByRole("region", { name: "Availability" });
    await expect(availability.getByRole("heading", { name: "No availability listed yet" })).toBeVisible();
    await expect(page.getByText("on your Free plan")).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    expect(prompts(id)).toEqual([]);
  });
});
