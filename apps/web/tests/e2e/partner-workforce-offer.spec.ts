import { callAs } from "./support/accounts";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, executeAsync, literal, query } from "./support/db";
import { enrollTotp } from "./support/login";
import { currentStep } from "./support/onboarding";
import { organizationAudit } from "./support/organizations";
import {
  chips,
  lapseToFreePlan,
  openPartnerOnboarding,
  partnerWithCompany,
  pickWithKeys,
  setPartnerRelease,
  type PartnerType,
} from "./support/partners";
import { signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";
import type { TestUser } from "./support/test-user";

const OCCUPATIONS = "Which occupations do you recruit or supply?";
const INDUSTRIES = "Which industries do you serve? (optional)";
const LANGUAGES = "Which languages do your candidates speak? (optional)";
const STAFFING_SERVICE = "We also supply staff (staffing)";
const STAFFING_TYPES = "Staffing types (choose at least one)";
const LIMIT_MESSAGE = "10 of 10 occupations listed on your Free plan.";
const COMPARISON = "Professional includes 30 occupations listed; Enterprise has no limit.";
const SET_OFFER =
  "public.set_organization_workforce_offer(uuid, text[], text[], text[], public.recruitment_preference, public.partner_service_type[], public.workforce_size_band, smallint)";

// A partner with a company whose countries are saved, so onboarding opens at What you offer.
async function partnerWithCountries(type: PartnerType): Promise<{ user: TestUser; id: string; slug: string }> {
  const partner = await partnerWithCompany(type);
  await callAs(partner.user, "set_organization_geographies", {
    p_org: partner.id,
    p_sources_from: ["PH"],
    p_serves_market: ["DE"],
  });
  return partner;
}

// The stored offer: 'occupations|industries|languages|services|recruitment type'.
function offer(organizationId: string): string {
  const [row] = query<{ text: string }>(
    `select concat_ws('|',
       (select coalesce(string_agg(occupation_id, ',' order by occupation_id), '') from public.organization_occupations where organization_id = ${literal(organizationId)}),
       (select coalesce(string_agg(industry_code, ',' order by industry_code), '') from public.organization_industries where organization_id = ${literal(organizationId)}),
       (select coalesce(string_agg(language_code, ',' order by language_code), '') from public.organization_languages where organization_id = ${literal(organizationId)}),
       (select coalesce(string_agg(service::text, ',' order by service), '') from public.organization_service_types where organization_id = ${literal(organizationId)}),
       (select coalesce(recruitment_type::text, '') from public.organizations where id = ${literal(organizationId)})) as text`,
  );
  return row.text;
}

function offerAudits(organizationId: string) {
  return organizationAudit(organizationId).filter(({ action }) => action === "organization.workforce_profile_changed");
}

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// others (playwright.config.ts), and the tests run one after the other.
test.describe("What you offer (FR-K2)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("AC1, AC2, AC7, AC10: a recruitment company records its offer with the keyboard during onboarding", async ({ page }) => {
    test.setTimeout(120_000);
    const { user, id } = await partnerWithCountries("recruitment_company");
    await openPartnerOnboarding(page, user);

    await expect(page.getByRole("heading", { name: "What you offer", level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 3 of 6: What you offer");
    await expect(page.getByText("No occupations chosen yet.")).toBeVisible();
    // AC7: a recruitment company sees the staffing checkbox, not the staffing types, and recruitment type as radios.
    const recruitmentType = page.getByRole("radiogroup", { name: "Recruitment type" });
    await expect(recruitmentType.getByRole("radio")).toHaveCount(3);
    for (const name of ["Local", "International", "Local and international"]) {
      await expect(recruitmentType.getByRole("radio", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("checkbox", { name: STAFFING_SERVICE })).not.toBeChecked();
    await expect(page.getByRole("group", { name: STAFFING_TYPES })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    // Nothing chosen: the summary lists the missing occupation and recruitment type.
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Choose at least one occupation.").first()).toBeVisible();
    await expect(page.getByText("Choose a recruitment type.").first()).toBeVisible();
    expect(offer(id)).toBe("||||");

    // AC2: "weld" lists Welders and flame cutters; arrows and Enter take it, and the chip has its own remove button.
    await pickWithKeys(page, OCCUPATIONS, "weld", "Welders and flame cutters");
    await expect(page.getByRole("combobox", { name: OCCUPATIONS, exact: true })).toHaveValue("");
    await expect(chips(page, OCCUPATIONS)).toHaveText(["Welders and flame cutters"]);
    await expect(page.getByRole("button", { name: "Remove Welders and flame cutters" })).toBeVisible();
    // AC2: a synonym finds its occupation ("pipefitter" is not in the label).
    await pickWithKeys(page, OCCUPATIONS, "pipefitter", "Plumbers and pipe fitters");
    await expect(chips(page, OCCUPATIONS)).toHaveText(["Welders and flame cutters", "Plumbers and pipe fitters"]);
    await expect(page.getByText("2 occupations", { exact: true })).toBeVisible();
    // AC2: typed text that matches no occupation offers nothing to choose and is never saved.
    await page.getByRole("combobox", { name: OCCUPATIONS, exact: true }).focus();
    await page.keyboard.type("xyz welding");
    await expect(page.getByRole("option", { name: "No matching occupation" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(chips(page, OCCUPATIONS)).toHaveCount(2);
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: OCCUPATIONS, exact: true }).fill("");

    await pickWithKeys(page, INDUSTRIES, "manuf", "Manufacturing");
    await pickWithKeys(page, INDUSTRIES, "constr", "Construction");
    await pickWithKeys(page, LANGUAGES, "engl", "English");
    await pickWithKeys(page, LANGUAGES, "tagal", "Filipino (Tagalog)");
    await pickWithKeys(page, LANGUAGES, "arab", "Arabic");
    await recruitmentType.getByRole("radio", { name: "International", exact: true }).check();

    // AC7: ticking the staffing service shows the staffing types and keeps the focus on the checkbox.
    const staffingService = page.getByRole("checkbox", { name: STAFFING_SERVICE });
    await staffingService.focus();
    await page.keyboard.press("Space");
    await expect(staffingService).toBeChecked();
    await expect(staffingService).toBeFocused();
    const staffingTypes = page.getByRole("group", { name: STAFFING_TYPES });
    await expect(staffingTypes.getByRole("checkbox")).toHaveCount(4);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Choose at least one staffing type.").first()).toBeVisible();
    await staffingTypes.getByRole("checkbox", { name: "Temporary" }).check();
    await expectAccessibleAtBothWidths(page);

    // AC10: the save fails: a toast, and the selection stays.
    execute(`revoke execute on function ${SET_OFFER} from authenticated`);
    try {
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Could not save what you offer", { exact: true })).toBeVisible();
    } finally {
      execute(`grant execute on function ${SET_OFFER} to authenticated`);
    }
    await expect(chips(page, OCCUPATIONS)).toHaveText(["Welders and flame cutters", "Plumbers and pipe fitters"]);
    await expect(chips(page, LANGUAGES)).toHaveText(["English", "Filipino (Tagalog)", "Arabic"]);
    await expect(staffingTypes.getByRole("checkbox", { name: "Temporary" })).toBeChecked();
    expect(offer(id)).toBe("||||");

    // AC1: the save stores the rows, audits them once, stamps the profile date and moves on to Commitments.
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Commitments", exact: true, level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 4 of 6: Commitments");
    expect(offer(id)).toBe("7126,7212|C,F|ar,en,tl|staffing,temporary|international");
    expect(offerAudits(id)).toEqual([
      expect.objectContaining({
        actor_id: user.id,
        metadata: {
          occupations: { added: ["7126", "7212"], removed: [] },
          industries: { added: ["C", "F"], removed: [] },
          languages: { added: ["ar", "en", "tl"], removed: [] },
          service_types: { added: ["staffing", "temporary"], removed: [] },
          recruitment_type: { old: null, new: "international" },
        },
      }),
    ]);
    const [stamp] = query<{ recent: boolean }>(
      `select workforce_profile_updated_at > now() - interval '5 minutes' as recent from public.organizations where id = ${literal(id)}`,
    );
    expect(stamp.recent).toBe(true);

    // The offer can be changed again from the next step; switching staffing off removes its rows.
    await page.getByRole("link", { name: "Change what you offer" }).click();
    await expect(page.getByRole("heading", { name: "What you offer", level: 1 })).toBeVisible();
    await expect(chips(page, OCCUPATIONS)).toHaveText(["Plumbers and pipe fitters", "Welders and flame cutters"]);
    await page.getByRole("checkbox", { name: STAFFING_SERVICE }).uncheck();
    await expect(page.getByRole("group", { name: STAFFING_TYPES })).toHaveCount(0);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Commitments", exact: true, level: 1 })).toBeVisible();
    expect(offer(id)).toBe("7126,7212|C,F|ar,en,tl||international");
  });

  test("AC10: a skeleton shows while the saved offer loads", async ({ page }) => {
    const { user } = await partnerWithCountries("recruitment_company");
    await openPartnerOnboarding(page, user);
    await expect(page.getByRole("heading", { name: "What you offer", level: 1 })).toBeVisible();

    const held = executeAsync(
      "begin; lock table public.organization_occupations in access exclusive mode; select pg_sleep(4); commit;",
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.goto("/en/onboarding", { waitUntil: "commit" });
    const skeleton = page.getByRole("status", { name: "Loading" });
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("heading", { name: "What you offer", level: 1 })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What you offer", level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(skeleton).toHaveCount(0);
    await held;
  });

  test("AC4, AC7, AC10: a staffing company at its occupation limit changes its offer on the workforce profile", async ({ page }) => {
    test.setTimeout(90_000);
    const { user, id, slug } = await partnerWithCountries("staffing_company");
    const [{ codes }] = query<{ codes: string[] }>(
      "select array_agg(code order by code) as codes from (select code from public.occupations order by code limit 11) o",
    );
    lapseToFreePlan(id);
    await callAs(user, "set_organization_workforce_offer", {
      p_org: id,
      p_occupations: codes.slice(0, 10),
      p_industries: ["F"],
      p_languages: ["en"],
      p_recruitment_type: "local",
      p_service_types: ["temporary"],
    });
    const secret = await enrollTotp(user);
    const path = `/en/org/${slug}/workforce-profile`;
    await signInAtAal2(page, user, secret, path);

    await expect(page.getByRole("heading", { name: "What you offer", level: 2 })).toBeVisible();
    await expect(chips(page, OCCUPATIONS)).toHaveCount(10);
    await expect(page.getByText("10 of 10 occupations")).toBeVisible();
    // AC7: a staffing company has no staffing checkbox; its staffing types are a group with a legend.
    await expect(page.getByRole("checkbox", { name: STAFFING_SERVICE })).toHaveCount(0);
    const staffingTypes = page.getByRole("group", { name: STAFFING_TYPES });
    await expect(staffingTypes.getByRole("checkbox", { name: "Temporary" })).toBeChecked();
    for (const name of ["Contract", "Project"]) {
      await expect(staffingTypes.getByRole("checkbox", { name })).not.toBeChecked();
    }
    await expect(page.getByRole("radio", { name: "Local", exact: true })).toBeChecked();
    await expectAccessibleAtBothWidths(page);

    // AC10: an eleventh occupation is not added; the limit is announced with the way to upgrade.
    const [{ label }] = query<{ label: string }>(`select label from public.occupations where code = ${literal(codes[10])}`);
    await pickWithKeys(page, OCCUPATIONS, label, label);
    await expect(chips(page, OCCUPATIONS)).toHaveCount(10);
    const notice = page.getByRole("status").filter({ hasText: LIMIT_MESSAGE });
    await expect(notice).toBeVisible();
    // The prompt compares the higher plans and links to the billing page that sells them (V15).
    await expect(notice).toContainText(COMPARISON);
    await expect(notice.getByRole("link", { name: "Upgrade your plan" })).toHaveAttribute("href", /\/en\/org\/[^/]+\/billing$/);
    await expectAccessibleAtBothWidths(page);

    // AC4: the database refuses an eleventh occupation as well and keeps the previous set.
    await expect(
      callAs(user, "set_organization_workforce_offer", {
        p_org: id,
        p_occupations: codes,
        p_industries: ["F"],
        p_languages: ["en"],
        p_recruitment_type: "local",
        p_service_types: ["temporary"],
      }),
    ).rejects.toThrow(/CHARA_LIMIT_REACHED/);

    // Removing one makes room; the staffing types change and the recruitment type too.
    const [{ first }] = query<{ first: string }>(`select label as first from public.occupations where code = ${literal(codes[0])}`);
    await page.getByRole("button", { name: `Remove ${first}` }).click();
    await pickWithKeys(page, OCCUPATIONS, label, label);
    await expect(chips(page, OCCUPATIONS)).toHaveCount(10);
    await staffingTypes.getByRole("checkbox", { name: "Temporary" }).uncheck();
    await page.getByRole("button", { name: "Save what you offer" }).click();
    await expect(page.getByText("Choose at least one staffing type.").first()).toBeVisible();
    await staffingTypes.getByRole("checkbox", { name: "Contract" }).check();
    await page.getByRole("radio", { name: "Local and international" }).check();
    await page.getByRole("button", { name: "Save what you offer" }).click();
    await expect(page.getByText("Workforce offer saved", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(path);
    expect(offer(id)).toBe(`${codes.slice(1).join(",")}|F|en|contract|both`);
    expect(offerAudits(id).at(-1)?.metadata).toEqual({
      occupations: { added: [codes[10]], removed: [codes[0]] },
      service_types: { added: ["contract"], removed: ["temporary"] },
      recruitment_type: { old: "local", new: "both" },
    });
  });
});
