import { callAs } from "./support/accounts";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, executeAsync, literal, query } from "./support/db";
import { enrollTotp } from "./support/login";
import { currentStep } from "./support/onboarding";
import { organizationAudit, organizationRows } from "./support/organizations";
import {
  chips,
  lapseToFreePlan,
  openPartnerOnboarding,
  partnerWithCompany,
  pickWithKeys,
  setPartnerRelease,
} from "./support/partners";
import { signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

const SOURCES = "Where do you source workers from?";
const RECRUITS_FOR = "Where do you recruit for?";
const SUPPLIES_FOR = "Where do you supply workers for?";
const LIMIT_MESSAGE = "3 of 3 countries served on your Free plan.";
const COMPARISON = "Professional includes 10 countries served; Enterprise has no limit.";
const SET_GEOGRAPHIES = "public.set_organization_geographies(uuid, text[], text[])";

function geographies(organizationId: string): string {
  const [row] = query<{ text: string }>(
    `select coalesce(string_agg(country_code, ',' order by country_code) filter (where scope = 'sources_from'), '')
       || '|' || coalesce(string_agg(country_code, ',' order by country_code) filter (where scope = 'serves_market'), '') as text
     from public.organization_geographies where organization_id = ${literal(organizationId)}`,
  );
  return row.text;
}

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// others (playwright.config.ts), and the tests run one after the other.
test.describe("Where you serve (FR-K1)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("AC1, AC2, AC5, AC10: the owner chooses the countries with the keyboard, meets the limit and continues", async ({ page }) => {
    test.setTimeout(120_000);
    const { user, id } = await partnerWithCompany("recruitment_company");
    lapseToFreePlan(id);
    await openPartnerOnboarding(page, user);

    await expect(page.getByRole("heading", { name: "Where you serve", level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 2 of 5: Where you serve");
    await expect(page.getByRole("term").filter({ hasText: "Where are you based?" })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: /^Philippines$/ })).toBeVisible();
    await expect(page.getByText("No countries chosen yet.")).toHaveCount(2);
    await expect(page.getByText("0 of 3 countries")).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    // AC10: nothing chosen. The errors stand next to the fields and the focus moves to the first of them.
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Choose at least one country you source workers from")).toBeVisible();
    await expect(page.getByText("Choose at least one country you recruit for")).toBeVisible();
    await expect(page.getByRole("combobox", { name: SOURCES })).toBeFocused();

    await pickWithKeys(page, SOURCES, "phil", "Philippines");
    await pickWithKeys(page, SOURCES, "nep", "Nepal");
    await expect(chips(page, SOURCES)).toHaveText(["Philippines", "Nepal"]);
    await expect(page.getByText("2 countries", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Choose at least one country you recruit for")).toBeVisible();
    await expect(page.getByRole("combobox", { name: RECRUITS_FOR })).toBeFocused();
    expect(geographies(id)).toBe("|");

    // AC2: "ger" lists Germany; arrows and Enter take it, and the chip has its own remove button.
    await pickWithKeys(page, RECRUITS_FOR, "ger", "Germany");
    await expect(page.getByRole("combobox", { name: RECRUITS_FOR })).toHaveValue("");
    await pickWithKeys(page, RECRUITS_FOR, "united arab", "United Arab Emirates");
    await pickWithKeys(page, RECRUITS_FOR, "saudi", "Saudi Arabia");
    await expect(chips(page, RECRUITS_FOR)).toHaveText(["Germany", "United Arab Emirates", "Saudi Arabia"]);
    await expect(page.getByText("3 of 3 countries", { exact: true })).toBeVisible();
    await expect(page.getByText("Choose at least one country you recruit for")).toHaveCount(0);

    // AC5: a fourth country is not added; the limit is announced with the way to upgrade.
    await pickWithKeys(page, RECRUITS_FOR, "fran", "France");
    await expect(chips(page, RECRUITS_FOR)).toHaveCount(3);
    const notice = page.getByRole("status").filter({ hasText: LIMIT_MESSAGE });
    await expect(notice).toBeVisible();
    // The prompt compares the higher plans and links to the billing page that sells them (V15).
    await expect(notice).toContainText(COMPARISON);
    await expect(notice.getByRole("link", { name: "Upgrade your plan" })).toHaveAttribute("href", /\/en\/org\/[^/]+\/billing$/);
    await expect(page.getByText("3 of 3 countries", { exact: true })).toBeVisible();
    // A second blocked add replaces the notice in the live region, so it is announced again.
    await notice.locator(":scope > div").evaluate((element) => element.setAttribute("data-first", "true"));
    await pickWithKeys(page, RECRUITS_FOR, "ital", "Italy");
    await expect(chips(page, RECRUITS_FOR)).toHaveCount(3);
    await expect(notice).toBeVisible();
    await expect(notice.locator("[data-first]")).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    // AC2: Tab reaches the first chip's button; Backspace removes Germany and the focus returns to the field.
    await page.getByRole("combobox", { name: RECRUITS_FOR }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Remove Germany" })).toBeFocused();
    await page.keyboard.press("Backspace");
    await expect(chips(page, RECRUITS_FOR)).toHaveText(["United Arab Emirates", "Saudi Arabia"]);
    await expect(page.getByText("2 of 3 countries")).toBeVisible();
    await expect(notice).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: RECRUITS_FOR })).toBeFocused();

    // AC2: typed text that matches no country offers nothing to choose and is never saved.
    await page.keyboard.type("Atlantis");
    await expect(page.getByRole("option", { name: "No matching country" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(chips(page, RECRUITS_FOR)).toHaveCount(2);
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: RECRUITS_FOR }).fill("");
    await pickWithKeys(page, RECRUITS_FOR, "ger", "Germany");

    // AC10: the save fails: a toast, and the chosen countries stay.
    execute(`revoke execute on function ${SET_GEOGRAPHIES} from authenticated`);
    try {
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Could not save your countries", { exact: true })).toBeVisible();
    } finally {
      execute(`grant execute on function ${SET_GEOGRAPHIES} to authenticated`);
    }
    await expect(chips(page, RECRUITS_FOR)).toHaveText(["United Arab Emirates", "Saudi Arabia", "Germany"]);
    await expect(chips(page, SOURCES)).toHaveText(["Philippines", "Nepal"]);
    expect(geographies(id)).toBe("|");

    // AC1: the save stores the rows, audits them once and moves on to What you offer, still on step 2 (FR-K2); once the
    // offer is saved the partner continues with Commitments.
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "What you offer", level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 2 of 5: Where you serve");
    await callAs(user, "set_organization_workforce_offer", {
      p_org: id,
      p_occupations: ["7212"],
      p_industries: [],
      p_languages: [],
      p_recruitment_type: "international",
      p_service_types: [],
    });
    await page.goto("/en/onboarding");
    await expect(page.getByRole("heading", { name: "Commitments", exact: true, level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 3 of 5: Commitments");
    expect(geographies(id)).toBe("NP,PH|AE,DE,SA");
    const [organization] = organizationRows(user.id);
    expect(organization.based_in_country).toBe("PH");
    expect(organizationAudit(id).filter(({ action }) => action === "organization.geographies_changed")).toEqual([
      expect.objectContaining({
        actor_id: user.id,
        metadata: {
          sources_from: { added: ["NP", "PH"], removed: [] },
          serves_market: { added: ["AE", "DE", "SA"], removed: [] },
        },
      }),
    ]);
    await expectAccessibleAtBothWidths(page);

    // The countries can be changed again from the next step; the saved ones are the chips.
    await page.getByRole("link", { name: "Change where you serve" }).click();
    await expect(page.getByRole("heading", { name: "Where you serve", level: 1 })).toBeVisible();
    await expect(chips(page, RECRUITS_FOR)).toHaveText(["United Arab Emirates", "Germany", "Saudi Arabia"]);
    await page.getByRole("button", { name: "Remove Saudi Arabia" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Commitments", exact: true, level: 1 })).toBeVisible();
    expect(geographies(id)).toBe("NP,PH|AE,DE");
  });

  test("AC10: a skeleton shows while the saved countries load", async ({ page }) => {
    const { user } = await partnerWithCompany("recruitment_company");
    await openPartnerOnboarding(page, user);
    await expect(page.getByRole("heading", { name: "Where you serve", level: 1 })).toBeVisible();

    const held = executeAsync(
      "begin; lock table public.organization_geographies in access exclusive mode; select pg_sleep(4); commit;",
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.goto("/en/onboarding", { waitUntil: "commit" });
    const skeleton = page.getByRole("status", { name: "Loading" });
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("heading", { name: "Where you serve", level: 1 })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Where you serve", level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(skeleton).toHaveCount(0);
    await held;
  });

  test("a staffing company changes where it supplies workers on its workforce profile, behind the release switch", async ({ page }) => {
    test.setTimeout(60_000);
    const { user, id, slug } = await partnerWithCompany("staffing_company");
    await callAs(user, "set_organization_geographies", { p_org: id, p_sources_from: ["PH"], p_serves_market: ["DE"] });
    const secret = await enrollTotp(user);
    const path = `/en/org/${slug}/workforce-profile`;
    await signInAtAal2(page, user, secret, path);

    await expect(page.getByRole("heading", { name: "Workforce profile", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where you serve", level: 2 })).toBeVisible();
    await expect(page.getByRole("combobox", { name: SUPPLIES_FOR })).toBeVisible();
    await expect(page.getByRole("combobox", { name: RECRUITS_FOR })).toHaveCount(0);
    await expect(chips(page, SUPPLIES_FOR)).toHaveText(["Germany"]);
    await expectAccessibleAtBothWidths(page);

    await pickWithKeys(page, SUPPLIES_FOR, "austr", "Austria");
    await page.getByRole("button", { name: "Remove Germany" }).click();
    await page.getByRole("button", { name: "Save countries" }).click();
    await expect(page.getByText("Countries saved", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(path);
    expect(geographies(id)).toBe("PH|AT");
    expect(organizationAudit(id).filter(({ action }) => action === "organization.geographies_changed").at(-1)?.metadata).toEqual({
      sources_from: { added: [], removed: [] },
      serves_market: { added: ["AT"], removed: ["DE"] },
    });

    setPartnerRelease(false);
    try {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await expect(page.getByRole("combobox", { name: SUPPLIES_FOR })).toHaveCount(0);
    } finally {
      setPartnerRelease(true);
    }
  });
});
