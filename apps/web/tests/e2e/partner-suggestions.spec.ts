import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { addMember, joinTeam, newTeam, signInAtAal1, signInAtAal2, type Team } from "./support/team";
import { expect, test } from "./support/test";

// Partner suggestions for a workforce requirement (FR-M3 steps Trigger to Explain, AC7, AC10, AC11; FR-M1 AC9): from the
// requirement page an owner opens Find partners for this requirement, reads each card's facts and criteria, saves a
// partner and opens its profile; a member reads the same cards; a draft gets a preview, a closed requirement none; a
// requirement nobody serves shows the empty state, and a failed read a toast and a retry. Releases 2a and 2b are switched
// on for the whole database, so this file is a project of its own after the vacancies from a requirement, and its tests
// run one after the other. Other specs leave listed partners serving Germany behind, so the partners made here have the
// newest profiles and the assertions name them.

const requirementUrl = (slug: string, id: string) => `/en/org/${slug}/requirements/${id}`;
const partnersUrl = (slug: string, id: string) => `${requirementUrl(slug, id)}/partners`;
const FUNCTION = "public.suggest_partners(uuid, uuid)";
const FIND = "Find partners for this requirement";

function setJobOrderRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

type Partner = { id: string; slug: string; displayName: string; ownerId: string };

// A listed recruitment company serving p_country with 7212, sourcing from the Philippines, with the industries, the
// recruitment type and one listing of 7212 given; its profile is the newest of the database.
async function listedPartner(
  country: string,
  options: { industries?: string[]; recruitment?: string; listing?: { available: number; from: string } } = {},
): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code)
       values (${literal(id)}, 'serves_market', ${literal(country)}), (${literal(id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     ${(options.industries ?? []).map((code) => `insert into public.organization_industries (organization_id, industry_code) values (${literal(id)}, ${literal(code)});`).join("\n")}
     ${
       options.listing
         ? `insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity, available_from, confirmed_at)
              values (${literal(id)}, '7212', 'PH', ${options.listing.available}, 10, ${literal(options.listing.from)}, now() - interval '10 days');`
         : ""
     }
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days',
       recruitment_type = ${options.recruitment ? `${literal(options.recruitment)}::public.recruitment_preference` : "null"},
       workforce_profile_updated_at = now() + interval '2 days'
     where id = ${literal(id)}`,
  );
  const [row] = query<{ display_name: string }>(`select display_name from public.organizations where id = ${literal(id)}`);
  return { id, slug, displayName: row.display_name, ownerId: user.id };
}

// A requirement of FR-M3 AC4 written as the database owner: 100 welders (7212) in Hamburg, p_country (DE unless given),
// industry C, international recruitment, starting 1 March 2027, with the partner need and status given.
function seedRequirement(
  team: Pick<Team, "id" | "owner">,
  { status = "open", need = "recruitment", country = "DE" }: { status?: string; need?: string; country?: string } = {},
): string {
  const id = randomUUID();
  const published = status !== "draft";
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, employment_type, recruitment_preference, partner_need, created_by, status, visibility, published_at, closes_on,
       close_reason)
     values (${literal(id)}, ${literal(team.id)}, 'Welders for the yard', 100, ${literal(country)}, 'Hamburg', 'C', date '2027-03-01',
       'full_time', 'international', ${literal(need)}, ${literal(team.owner.id)}, ${literal(status)},
       ${published ? "'private', now(), date '2027-03-31'" : "null, null, null"},
       ${status === "closed" ? "'cancelled'" : "null"});
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 100);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(country)})`,
  );
  return id;
}

function card(page: Page, name: string) {
  return page.getByRole("list", { name: "Suggested partners" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name, level: 2 }) });
}

function notifications(userId: string): number {
  return query<{ n: number }>(`select count(*)::integer as n from public.notifications where user_id = ${literal(userId)}`)[0].n;
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  setPartnerRelease(true);
  setJobOrderRelease(true);
});
test.afterAll(() => {
  execute(`grant execute on function ${FUNCTION} to authenticated`);
  setJobOrderRelease(false);
  setPartnerRelease(false);
});

test.describe("Partner suggestions for a workforce requirement (FR-M3)", () => {
  test("AC7: the owner opens the suggestions from the requirement, reads the reasons, saves a partner and opens its profile", async ({ page }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    const q1 = await listedPartner("DE", { industries: ["C"], recruitment: "both", listing: { available: 120, from: "2027-02-01" } });
    const q4 = await listedPartner("DE", { listing: { available: 120, from: "2027-04-01" } });
    const id = seedRequirement(team);

    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, id));
    const section = page.getByRole("region", { name: "Partners for this requirement" });
    await expect(section).toContainText("See the listed partners that serve Germany for these occupations");
    await section.getByRole("link", { name: FIND }).click();
    await expect(page).toHaveURL(partnersUrl(team.slug, id));
    await expect(page.getByRole("heading", { name: FIND, level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "How suggestions are ordered" })).toHaveAttribute("href", "/en/legal/ranking");
    // P2B article 5(3): the plan's part in the order is disclosed (decided, user delegated).
    await expect(page.getByText("Availability listings, which the capacity and start date criteria use, can be added only within the allowance of a partner's plan.", { exact: false })).toBeVisible();

    const count = page.getByRole("status").filter({ hasText: /partners? suggested/ });
    await expect(count).toHaveAttribute("aria-live", "polite");

    const first = card(page, q1.displayName);
    await expect(first).toContainText("Serves Germany, recruits Welders and flame cutters, 120 available from 1 February 2027");
    await expect(first).toContainText("Recruitment company");
    await expect(first.getByRole("list", { name: `Criteria met by ${q1.displayName}` }).getByRole("listitem")).toHaveText([
      "Works in your industry",
      "Offers the type of recruitment you need",
      "Current listings cover the number of workers you need for every occupation",
      "Enough workers for every occupation are available by your start date",
    ]);
    await expect(first.getByRole("list", { name: `Criteria not met by ${q1.displayName}` })).toHaveCount(0);
    // The profile link names the page's employer, so that Invite on the profile offers it first (V42).
    await expect(first.getByRole("link", { name: q1.displayName })).toHaveAttribute("href", `/en/partners/${q1.slug}?for=${team.slug}`);

    const fourth = card(page, q4.displayName);
    await expect(fourth.getByRole("list", { name: `Criteria met by ${q4.displayName}` }).getByRole("listitem")).toHaveText([
      "Current listings cover the number of workers you need for every occupation",
    ]);
    await expect(fourth.getByRole("list", { name: `Criteria not met by ${q4.displayName}` }).getByRole("listitem")).toHaveText([
      "Does not list your industry",
      "Does not offer the type of recruitment you need",
      "Not enough workers for every occupation are available by your start date",
    ]);
    // The partner with every criterion comes before the one with one, whatever else the database holds.
    const names = await page.getByRole("list", { name: "Suggested partners" }).getByRole("heading", { level: 2 }).allTextContents();
    expect(names.indexOf(q1.displayName)).toBeLessThan(names.indexOf(q4.displayName));
    await expect(page.getByRole("main")).not.toContainText(/verified|score|recommended|%/i);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const save = first.getByRole("button", { name: `Save partner: ${q1.displayName}` });
    await waitForHydration(save);
    await save.click();
    await expect(first.getByRole("button", { name: `Saved: ${q1.displayName}` })).toBeVisible();
    await expect
      .poll(() => query<{ n: number }>(`select count(*)::integer as n from public.saved_items where organization_id = ${literal(team.id)} and target_organization_id = ${literal(q1.id)}`)[0].n)
      .toBe(1);
    // NFR-S11: being suggested tells a partner nothing.
    expect(notifications(q1.ownerId)).toBe(0);
    expect(notifications(q4.ownerId)).toBe(0);

    await first.getByRole("link", { name: q1.displayName }).click();
    await expect(page).toHaveURL(`/en/partners/${q1.slug}?for=${team.slug}`);
    await expect(page.getByRole("heading", { name: q1.displayName, level: 1 })).toBeVisible();
  });

  test("a member reads the cards; a draft gets a preview; a closed requirement and one without partner need offer none", async ({ page }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    const q1 = await listedPartner("DE", { industries: ["C"], recruitment: "both", listing: { available: 120, from: "2027-02-01" } });
    const open = seedRequirement(team);
    const draft = seedRequirement(team, { status: "draft" });
    const closed = seedRequirement(team, { status: "closed" });
    const none = seedRequirement(team, { need: "none" });
    const { user: member } = await addMember(team, "member");

    await signInAtAal1(page, member, partnersUrl(team.slug, open));
    await expect(card(page, q1.displayName)).toContainText("Serves Germany, recruits Welders and flame cutters, 120 available from 1 February 2027");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expectNoAxeViolations(page);

    await page.goto(requirementUrl(team.slug, draft));
    const section = page.getByRole("region", { name: "Partners for this requirement" });
    await expect(section).toContainText("Preview the listed partners that serve Germany for these occupations. Publish the requirement to work with them.");
    await section.getByRole("link", { name: FIND }).click();
    await expect(page.getByText("This requirement is a draft. These suggestions are a preview; publish the requirement to work with partners.")).toBeVisible();
    await expect(card(page, q1.displayName)).toBeVisible();
    expect(query<{ n: number }>(`select count(*)::integer as n from stats.requirement_suggestions where requirement_id = ${literal(draft)}`)[0].n).toBe(0);
    expect(query<{ n: number }>(`select count(*)::integer as n from stats.requirement_suggestions where requirement_id = ${literal(open)}`)[0].n).toBe(1);

    for (const requirement of [closed, none]) {
      await page.goto(requirementUrl(team.slug, requirement));
      await expect(page.getByRole("heading", { name: "Welders for the yard", level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: FIND })).toHaveCount(0);
      await page.goto(partnersUrl(team.slug, requirement));
      await expect(page.getByText("Partners are suggested for requirements that need partners and are not closed or filled.")).toBeVisible();
      await expect(page.getByRole("list", { name: "Suggested partners" })).toHaveCount(0);
    }
    await expectNoAxeViolations(page);
  });

  test("AC10: a requirement nobody serves shows the empty state, and a failed read a toast and a retry", async ({ page }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    const id = seedRequirement(team, { country: "LI" });

    await signInAtAal2(page, team.owner, team.ownerSecret, partnersUrl(team.slug, id));
    const empty = page.getByRole("status").filter({ hasText: "No listed recruitment partners serve Liechtenstein for these occupations yet" });
    await expect(empty).toBeVisible();
    await expect(empty.getByRole("link", { name: "Recruitment Partners" })).toHaveAttribute("href", "/en/partners/recruitment");
    await expect(empty.getByRole("link", { name: "Staffing Partners" })).toHaveAttribute("href", "/en/partners/staffing");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    execute(`revoke execute on function ${FUNCTION} from authenticated`);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "The partner suggestions could not be loaded" })).toBeVisible();
      await expect(page.getByText("Check your connection and try again.", { exact: true })).toBeVisible();
      await expectNoAxeViolations(page);
    } finally {
      execute(`grant execute on function ${FUNCTION} to authenticated`);
    }
    const retry = page.getByRole("button", { name: "Try again" });
    await waitForHydration(retry);
    await retry.click();
    await expect(page.getByRole("status").filter({ hasText: "No listed recruitment partners serve Liechtenstein for these occupations yet" })).toBeVisible();
  });

  test("a person in two employers saves a suggested partner for the organisation of the page", async ({ page }) => {
    test.setTimeout(180_000);
    const first = await newTeam();
    const second = await newTeam();
    // The owner of the first team also joins the second: the first employer they joined is their own.
    joinTeam(second, first.owner, "member");
    const q1 = await listedPartner("DE", { industries: ["C"], recruitment: "both", listing: { available: 120, from: "2027-02-01" } });
    const id = seedRequirement(second);

    await signInAtAal1(page, first.owner, partnersUrl(second.slug, id));
    const save = card(page, q1.displayName).getByRole("button", { name: `Save partner: ${q1.displayName}` });
    await waitForHydration(save);
    await save.click();
    await expect(card(page, q1.displayName).getByRole("button", { name: `Saved: ${q1.displayName}` })).toBeVisible();
    const saved = (org: string) =>
      query<{ n: number }>(`select count(*)::integer as n from public.saved_items where organization_id = ${literal(org)} and target_organization_id = ${literal(q1.id)}`)[0].n;
    await expect.poll(() => saved(second.id)).toBe(1);
    expect(saved(first.id)).toBe(0);
    await page.reload();
    await expect(card(page, q1.displayName).getByRole("button", { name: `Saved: ${q1.displayName}` })).toBeVisible();
  });

  test("the ranking page describes the suggestions while release 2b is on", async ({ page }) => {
    await page.goto("/en/legal/ranking");
    const heading = page.getByRole("heading", { name: "Partner suggestions for a workforce requirement" });
    await expect(heading).toBeVisible();
    await expect(page.getByText("The number of criteria the company meets, most first.")).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    setJobOrderRelease(false);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "How search results are ranked", level: 1 })).toBeVisible();
      await expect(heading).toHaveCount(0);
    } finally {
      setJobOrderRelease(true);
    }
  });
});
