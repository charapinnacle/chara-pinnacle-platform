import { callAs } from "./support/accounts";
import { applicationRows, applyUrl, displayName, expectAccessibleAtBothWidths, newApplicant } from "./support/applications";
import { execute, literal } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { enrollTotp } from "./support/login";
import { chips, partnerWithCompany, pickWithKeys, setPartnerRelease } from "./support/partners";
import { signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";
import type { TestUser } from "./support/test-user";

// The direct-hiring rules in force (V72; FR-Q5 AC7; FR-K1 AC8; NFR-U3): the apply step shows the rule of the candidate's
// country for the vacancy's country in the region "Hiring rules for your country" (a blocked pair without Submit and with
// the way to licensed partners, a partner-required pair above Submit, the general notice otherwise), and saving a served
// country whose rule needs a licensed partner offers to add the licence. release_find_workers, release 2a and the rules
// are set for the whole database, so this file is a project of its own after the contact requests.

const REGION = "Hiring rules for your country";
const BLOCKED = "Direct hiring from the Philippines to Germany is not allowed.";
const PARTNER = "Hiring from Nepal to Germany needs a licensed recruitment partner.";
const SAUDI = "Hiring from the Philippines to Saudi Arabia needs a licensed recruitment partner.";
const RECRUITS_FOR = "Where do you recruit for?";

function setRelease(key: "release_find_workers", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

function generalNotice(): string {
  return execute("select value #>> '{}' from private.settings where key = 'direct_hiring_general_notice'").trim();
}

async function candidateFrom(country: string): Promise<TestUser> {
  const user = await newApplicant();
  execute(`update public.worker_profiles set current_country = ${literal(country)} where user_id = ${literal(user.id)}`);
  return user;
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  setRelease("release_find_workers", true);
  setPartnerRelease(true);
  execute(`insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref) values
    ('PH', 'DE', 'blocked', ${literal(BLOCKED)}, 'LO-E2E-1'),
    ('NP', 'DE', 'licensed_partner_required', ${literal(PARTNER)}, 'LO-E2E-2'),
    ('PH', 'SA', 'licensed_partner_required', ${literal(SAUDI)}, 'LO-E2E-3')
    on conflict on constraint direct_hiring_rules_pair_key do update set rule = excluded.rule, notice = excluded.notice`);
});
test.afterAll(() => {
  execute("delete from public.direct_hiring_rules where legal_opinion_ref like 'LO-E2E-%'");
  setPartnerRelease(false);
  setRelease("release_find_workers", false);
});

test.describe("Direct-hiring rules in applications (FR-Q5 AC7)", () => {
  test("the PH candidate sees the blocked notice and the way to partners, without Submit", async ({ page }) => {
    test.setTimeout(90_000);
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Welder Hamburg", status: "open", country: "DE" });
    const candidate = await candidateFrom("PH");

    await logIn(page, candidate, applyUrl(jobId));
    const region = page.getByRole("region", { name: REGION });
    await expect(region).toContainText("Direct applications are not possible from your country");
    await expect(region).toContainText(BLOCKED);
    await expect(region.getByRole("link", { name: "Find licensed recruitment partners" })).toHaveAttribute(
      "href",
      "/en/partners/recruitment?sources_from=PH&destination=DE",
    );
    await expect(page.getByRole("button", { name: "Submit application" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    expect(applicationRows(candidate.id)).toEqual([]);
  });

  test("the NP candidate sees the partner-required notice above Submit and applies", async ({ page }) => {
    test.setTimeout(90_000);
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Welder Bremen", status: "open", country: "DE" });
    const candidate = await candidateFrom("NP");

    await logIn(page, candidate, `/en/jobs/${jobId}`);
    const vacancyRegion = page.getByRole("region", { name: REGION });
    await expect(vacancyRegion, "the vacancy page shows the rule next to Apply now").toContainText("Apply through a licensed recruitment partner");
    await expect(page.getByRole("link", { name: "Apply now: Welder Bremen" })).toBeVisible();

    await page.goto(applyUrl(jobId));
    const region = page.getByRole("region", { name: REGION });
    await expect(region).toContainText("Apply through a licensed recruitment partner");
    await expect(region).toContainText(PARTNER);
    const submit = page.getByRole("button", { name: "Submit application" });
    const [regionBox, submitBox] = await Promise.all([region.boundingBox(), submit.boundingBox()]);
    expect(regionBox && submitBox && regionBox.y < submitBox.y).toBe(true);
    await expectAccessibleAtBothWidths(page);

    await waitForHydration(page.getByLabel("Cover note (optional)"));
    await page.getByLabel(`I agree to share the selected documents with ${displayName(company.id)} for this application`).check();
    await submit.click();
    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}$/);
    expect(applicationRows(candidate.id)).toHaveLength(1);
  });

  test("the NG candidate sees the general notice and applies", async ({ page }) => {
    test.setTimeout(90_000);
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Welder Kiel", status: "open", country: "DE" });
    const candidate = await candidateFrom("NG");

    await logIn(page, candidate, applyUrl(jobId));
    const region = page.getByRole("region", { name: REGION });
    await expect(region).toContainText(generalNotice());
    await expect(region.getByRole("link", { name: "Find licensed recruitment partners" })).toHaveCount(0);
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    await page.getByLabel(`I agree to share the selected documents with ${displayName(company.id)} for this application`).check();
    await page.getByRole("button", { name: "Submit application" }).click();
    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}$/);
  });

  test("a rule added while the form is open refuses the application with the way to partners", async ({ page }) => {
    test.setTimeout(90_000);
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Welder Lübeck", status: "open", country: "DE" });
    const candidate = await candidateFrom("NG");

    await logIn(page, candidate, applyUrl(jobId));
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    execute(`update public.worker_profiles set current_country = 'PH' where user_id = ${literal(candidate.id)}`);
    await page.getByLabel(`I agree to share the selected documents with ${displayName(company.id)} for this application`).check();
    await page.getByRole("button", { name: "Submit application" }).click();
    await expect(page.getByText("Direct hiring from your country to the country of this vacancy is not allowed")).toBeVisible();
    await expect(page.getByRole("link", { name: "Find licensed recruitment partners" })).toHaveAttribute("href", "/en/partners/recruitment");
    expect(applicationRows(candidate.id)).toEqual([]);
  });
});

test.describe("Licence prompt of Where you serve (FR-K1 AC8)", () => {
  test("adding a served country whose rule needs a licensed partner offers to add the licence", async ({ page }) => {
    test.setTimeout(120_000);
    const { user, id, slug } = await partnerWithCompany("recruitment_company");
    await callAs(user, "set_organization_geographies", { p_org: id, p_sources_from: ["PH"], p_serves_market: ["AE"] });
    const secret = await enrollTotp(user);
    const path = `/en/org/${slug}/workforce-profile`;
    await signInAtAal2(page, user, secret, path);
    const prompt = page.getByRole("status").filter({ hasText: "requires a licence for responses to job orders" });

    await pickWithKeys(page, RECRUITS_FOR, "germ", "Germany");
    await page.getByRole("button", { name: "Save countries" }).click();
    await expect(page.getByText("Countries saved", { exact: true })).toBeVisible();
    await expect(prompt).toHaveCount(0);

    await pickWithKeys(page, RECRUITS_FOR, "saudi", "Saudi Arabia");
    await page.getByRole("button", { name: "Save countries" }).click();
    await expect(chips(page, RECRUITS_FOR)).toHaveCount(3);
    await expect(prompt).toContainText("Saudi Arabia requires a licence for responses to job orders. Add your licence now?");
    await expect(prompt).not.toContainText("Germany");
    await expectAccessibleAtBothWidths(page);

    await prompt.getByRole("button", { name: /^Later/ }).click();
    await expect(prompt).toHaveCount(0);

    // The notice of the save before must be gone, or it would stand for this save before the removal is stored.
    await expect(page.getByText("Countries saved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("button", { name: "Remove Saudi Arabia" }).click();
    await page.getByRole("button", { name: "Save countries" }).click();
    await expect(page.getByText("Countries saved", { exact: true })).toBeVisible();
    await pickWithKeys(page, RECRUITS_FOR, "saudi", "Saudi Arabia");
    await page.getByRole("button", { name: "Save countries" }).click();
    await prompt.getByRole("button", { name: /^Add licence/ }).click();
    await expect(page).toHaveURL(`${path}?licence=SA`);
    const dialog = page.getByRole("dialog", { name: "Add a licence" });
    await expect(dialog.getByRole("combobox", { name: "Country" })).toHaveValue("Saudi Arabia");
    await expectAccessibleAtBothWidths(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(path);
  });
});
