import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addMember, enforceLimits, newTeam, restoreLimits, signInAtAal1, signInAtAal2, subscribe, type Team } from "./support/team";
import { expect, test } from "./support/test";

// Draft vacancies from a workforce requirement (FR-M1 step Next steps, AC9 and AC10; decision 3.1): after publishing,
// an owner or admin copies the requirement into one draft vacancy per occupation, is asked before a further copy, and
// opens the drafts; members see the linked vacancies; a requirement that is not open offers no copy; the open-vacancies
// limit does not stop drafts. Release 2b and the plan limits are switched on for the whole database, so this file is a
// project of its own after the requirement limits and runs one test after the other.

const requirementUrl = (slug: string, id: string) => `/en/org/${slug}/requirements/${id}`;

function setRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

// A requirement written as the database owner, as save_requirement and publish_requirement leave it: 100 workers in
// Hamburg, 7212 x 80 and 7214 x 20, a draft or published today, with partner need none.
function seedRequirement(team: Pick<Team, "id" | "owner">, status: "draft" | "open" | "paused" = "draft"): string {
  const id = randomUUID();
  const published = status !== "draft";
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       skills, experience_years, start_date, duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period,
       accommodation, work_permit_support, visa_support, recruitment_preference, partner_need, created_by, status, visibility,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, 'Welders for the Hamburg yard', 100, 'DE', 'Hamburg', 'C',
       'MIG/MAG welding, blueprint reading', 2, current_date + 60, 12, 'full_time', 2800, 3400, 'EUR', 'month', true, true, true,
       'international', 'none', ${literal(team.owner.id)}, ${literal(status)},
       ${published ? "'private', now(), current_date + 80" : "null, null, null"});
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity)
       values (${literal(id)}, '7212', 80), (${literal(id)}, '7214', 20);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, 'DE')`,
  );
  return id;
}

function linked(requirementId: string) {
  return query<{ title: string; status: string; city: string; salary_min: string }>(
    `select title, status, city, salary_min::text from public.jobs where requirement_id = ${literal(requirementId)} order by created_at, title`,
  );
}

function section(page: Page) {
  return page.getByRole("region", { name: "Vacancies for direct applications" });
}

const CREATE = "Create vacancies for direct applications";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => setRelease(true));
test.afterAll(() => {
  restoreLimits();
  setRelease(false);
});

test.describe("Vacancies from a workforce requirement (FR-M1 AC9, AC10)", () => {
  test("AC9, AC10: after a private publish the owner creates one draft per occupation, is asked before a second copy and opens a draft", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    const id = seedRequirement(team);

    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, id));
    await expect(section(page)).toHaveCount(0);
    const actions = page.getByRole("region", { name: "Status actions" });
    await waitForHydration(actions.getByRole("button").first());
    await actions.getByRole("button", { name: "Publish", exact: true }).click();
    const publish = page.getByRole("dialog", { name: "Publish this requirement" });
    await publish.getByRole("radio", { name: "Only partners I invite", exact: true }).check();
    await publish.getByRole("button", { name: "Publish requirement" }).click();
    await expect(page.getByText("The requirement is published", { exact: true })).toBeVisible();

    await expect(section(page).getByRole("button", { name: CREATE })).toBeVisible();
    await expect(section(page)).toContainText("No vacancies have been created from this requirement yet.");
    // Partner need none: no suggestions (FR-M3, V36); partner-suggestions.spec.ts opens them for a requirement that needs partners.
    await expect(page.getByRole("region", { name: "Partners for this requirement" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Find partners for this requirement" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await waitForHydration(section(page).getByRole("button", { name: CREATE }));
    await section(page).getByRole("button", { name: CREATE }).click();
    await expect(page.getByText("2 draft vacancies created. Check and publish each one.", { exact: true })).toBeVisible();
    const list = section(page).getByRole("list", { name: "Linked vacancies" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByRole("link", { name: "Welders and flame cutters" })).toBeVisible();
    await expect(list.getByRole("link", { name: "Structural-metal preparers and erectors" })).toBeVisible();
    await expect(list.getByText("Draft - not public")).toHaveCount(2);
    expect(linked(id)).toEqual([
      { title: "Structural-metal preparers and erectors", status: "draft", city: "Hamburg", salary_min: "2800.00" },
      { title: "Welders and flame cutters", status: "draft", city: "Hamburg", salary_min: "2800.00" },
    ]);
    expect(query<{ status: string }>(`select status from public.workforce_requirements where id = ${literal(id)}`)[0].status).toBe("open");
    await expectNoAxeViolations(page);

    await section(page).getByRole("button", { name: CREATE }).click();
    const ask = page.getByRole("dialog", { name: "Create more vacancies?" });
    await expect(ask).toContainText("This requirement already has 2 linked vacancies. 2 draft vacancies will be added, one per occupation.");
    await expectNoAxeViolations(page);
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toBeHidden();
    expect(linked(id)).toHaveLength(2);

    await section(page).getByRole("button", { name: CREATE }).click();
    await ask.getByRole("button", { name: "Create vacancies" }).click();
    await expect(ask).toBeHidden();
    await expect(list.getByRole("listitem")).toHaveCount(4);
    expect(linked(id)).toHaveLength(4);

    await list.getByRole("link", { name: "Welders and flame cutters" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/en/org/${team.slug}/jobs/[0-9a-f-]{36}$`));
    await expect(page.getByRole("status").filter({ hasText: "Draft - not public" })).toBeVisible();
    await expect(page.getByText("Welders and flame cutters: 80 workers needed in Hamburg, Germany", { exact: false })).toBeVisible();
  });

  test("members see the linked vacancies without the action, a paused requirement offers no copy, and a stale page is refused with a toast", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    const id = seedRequirement(team, "open");
    const paused = seedRequirement(team, "paused");

    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, paused));
    await expect(section(page)).toHaveCount(0);

    await page.goto(requirementUrl(team.slug, id));
    await waitForHydration(section(page).getByRole("button", { name: CREATE }));
    execute(`update public.workforce_requirements set updated_at = now() where id = ${literal(id)}`);
    await section(page).getByRole("button", { name: CREATE }).click();
    await expect(page.getByText("This requirement was changed by someone else, reload.", { exact: true })).toBeVisible();
    expect(linked(id)).toHaveLength(0);
    await page.reload();
    await waitForHydration(section(page).getByRole("button", { name: CREATE }));
    await section(page).getByRole("button", { name: CREATE }).click();
    await expect(section(page).getByRole("list", { name: "Linked vacancies" }).getByRole("listitem")).toHaveCount(2);

    // Another admin's copy since the page was drawn: the confirmation names two linked vacancies, there are four.
    execute(
      `insert into public.jobs (organization_id, requirement_id, title, description, occupation_id, industry_code, country_code, city,
         employment_type, recruitment_preference)
       select organization_id, requirement_id, title, description, occupation_id, industry_code, country_code, city, employment_type,
         recruitment_preference
       from public.jobs where requirement_id = ${literal(id)}`,
    );
    await section(page).getByRole("button", { name: CREATE }).click();
    const ask = page.getByRole("dialog", { name: "Create more vacancies?" });
    await expect(ask).toContainText("This requirement already has 2 linked vacancies.");
    await ask.getByRole("button", { name: "Create vacancies" }).click();
    await expect(page.getByText("This requirement was changed by someone else, reload.", { exact: true })).toBeVisible();
    expect(linked(id)).toHaveLength(4);
    await page.reload();
    await expect(section(page).getByRole("list", { name: "Linked vacancies" }).getByRole("listitem")).toHaveCount(4);

    const member = await addMember(team, "member");
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await signInAtAal1(memberPage, member.user, requirementUrl(team.slug, id));
    await expect(section(memberPage).getByRole("list", { name: "Linked vacancies" }).getByRole("listitem")).toHaveCount(4);
    await expect(section(memberPage)).toContainText("These vacancies were created from it.");
    await expect(section(memberPage).getByRole("button", { name: CREATE })).toHaveCount(0);
    await expectAccessibleAtBothWidths(memberPage);
    await memberPage.goto(requirementUrl(team.slug, paused));
    await expect(section(memberPage)).toHaveCount(0);
    await memberContext.close();
  });

  test("NFR-S11: an anonymous job order warns that a published vacancy shows the company name and copies no identifying facts", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const team = await newTeam();
    const id = seedRequirement(team, "open");
    execute(`update public.workforce_requirements set visibility = 'job_order_marketplace', show_identity = false where id = ${literal(id)}`);

    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, id));
    const notice = section(page).getByRole("status").filter({ hasText: "without your company name" });
    await expect(notice).toContainText("A published vacancy shows your company name, so edit each vacancy before you publish it");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await waitForHydration(section(page).getByRole("button", { name: CREATE }));
    await section(page).getByRole("button", { name: CREATE }).click();
    await expect(page.getByText("2 draft vacancies created. Check and publish each one.", { exact: true })).toBeVisible();
    const descriptions = query<{ description: string }>(
      `select description from public.jobs where requirement_id = ${literal(id)} order by title`,
    ).map((row) => row.description);
    expect(descriptions).toHaveLength(2);
    for (const description of descriptions) {
      expect(description).not.toContain("MIG/MAG");
      expect(description).not.toMatch(/\b(80|20) workers\b/);
      expect(description).toContain("workers needed in Hamburg, Germany, from");
    }

    execute(`update public.workforce_requirements set show_identity = true where id = ${literal(id)}`);
    await page.reload();
    await expect(section(page).getByRole("list", { name: "Linked vacancies" })).toBeVisible();
    await expect(section(page).getByText("without your company name")).toHaveCount(0);
  });

  test("with the limits enforced, an employer at 3 of 3 open vacancies still gets the drafts and nothing opens", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    enforceLimits();
    const team = await newTeam();
    subscribe(team, "employer_starter");
    execute(
      `insert into public.jobs (organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type,
         recruitment_preference, status)
       select ${literal(team.id)}, 'Open vacancy ' || n, btrim(repeat('Weld steel frames in our Hamburg workshop. ', 2)), '7212', 'C', 'DE',
         'Hamburg', 'full_time', 'both', 'open'
       from generate_series(1, 3) n`,
    );
    const id = seedRequirement(team, "open");

    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, id));
    await waitForHydration(section(page).getByRole("button", { name: CREATE }));
    await section(page).getByRole("button", { name: CREATE }).click();
    await expect(page.getByText("2 draft vacancies created. Check and publish each one.", { exact: true })).toBeVisible();
    expect(linked(id).map((row) => row.status)).toEqual(["draft", "draft"]);
    expect(
      query<{ n: number }>(`select count(*)::int as n from public.jobs where organization_id = ${literal(team.id)} and status = 'open'`)[0].n,
    ).toBe(3);
    restoreLimits();
  });
});
