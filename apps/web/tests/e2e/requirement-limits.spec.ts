import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { signInStaff } from "./support/admin";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { chooseFromList } from "./support/jobs";
import { logIn } from "./support/login-page";
import { addMember, enforceLimits, newTeam, newVisitor, restoreLimits, signInAtAal2, subscribe, type Team } from "./support/team";
import { expect, test } from "./support/test";

// The plan limits of workforce requirements (FR-M4): the open-requirements limit at publish and reopen with its upgrade
// prompt, the usage on the requirements list, the dashboard and the billing page, further destination countries by plan,
// the pause on a lapse, and the limit and feature in the plan editor. Release 2b and the plan limits are switched on for
// the whole database, and a plan row is changed for a moment, so this file is a project of its own after the
// workforce requirements and runs one test after the other.

const requirementsUrl = (slug: string) => `/en/org/${slug}/requirements`;
const requirementUrl = (slug: string, id: string) => `${requirementsUrl(slug)}/${id}`;

function setRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

// A requirement written as the database owner, as save_requirement and publish_requirement leave it: a draft, or open or
// paused (published today and closing in 80 days), with the destinations given (the first is the main one).
function seedRequirement(
  team: Pick<Team, "id" | "owner">,
  title: string,
  { status = "draft", countries = ["DE"] }: { status?: "draft" | "open" | "paused"; countries?: string[] } = {},
): string {
  const id = randomUUID();
  const published = status !== "draft";
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, employment_type, recruitment_preference, partner_need, created_by, status, visibility, published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 10, ${literal(countries[0])}, 'Bremen', 'C', current_date + 60,
       'full_time', 'local', 'none', ${literal(team.owner.id)}, ${literal(status)},
       ${published ? "'private', now(), current_date + 80" : "null, null, null"});
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 10);
     insert into public.requirement_countries (requirement_id, country_code)
     select ${literal(id)}, unnest(array[${countries.map(literal).join(", ")}]::text[])`,
  );
  return id;
}

function seedOpen(team: Team, count: number): string[] {
  return Array.from({ length: count }, (_, index) => seedRequirement(team, `Open welders ${index + 1}`, { status: "open" }));
}

function statusOf(id: string): string {
  return query<{ status: string }>(`select status from public.workforce_requirements where id = ${literal(id)}`)[0].status;
}

function openCount(organizationId: string): number {
  return query<{ n: number }>(
    `select count(*)::int as n from public.workforce_requirements where organization_id = ${literal(organizationId)} and status = 'open'`,
  )[0].n;
}

function promptRows(organizationId: string) {
  return query<{ actor_id: string | null; metadata: Record<string, unknown> }>(
    `select actor_id, metadata from audit.log where action = 'limit.prompt_shown' and entity_id = ${literal(organizationId)} order by id`,
  );
}

function statusButtons(page: Page) {
  return page.getByRole("region", { name: "Status actions" }).getByRole("button");
}

async function publishPrivately(page: Page): Promise<void> {
  await waitForHydration(statusButtons(page).first());
  await page.getByRole("region", { name: "Status actions" }).getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publish this requirement" });
  await dialog.getByRole("radio", { name: "Only partners I invite", exact: true }).check();
  await dialog.getByRole("button", { name: "Publish requirement" }).click();
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  setRelease(true);
  enforceLimits();
});
test.afterAll(() => {
  restoreLimits();
  setRelease(false);
  execute(
    `update billing.plan_limits set limit_value = 3 where plan_code = 'employer_starter' and limit_key = 'active_requirements';
     delete from billing.plan_features where plan_code = 'employer_starter' and feature_key = 'multi_country_requirements';`,
  );
});

test.describe("Workforce requirement plan limits (FR-M4)", () => {
  test("AC9: at 3 of 3 the publish keeps the draft and shows the upgrade prompt once, a pause makes room, and a member has no Publish", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    subscribe(team, "employer_starter");
    const open = seedOpen(team, 3);
    const draft = seedRequirement(team, "Draft over the limit");
    const member = await addMember(team, "member");

    await signInAtAal2(page, team.owner, team.ownerSecret, requirementsUrl(team.slug));
    const usage = page.getByRole("status").filter({ hasText: "open workforce requirements" });
    await expect(usage).toContainText("3 of 3 open workforce requirements on your Basic plan.");
    await expect(usage.getByRole("link", { name: "Upgrade your plan" })).toHaveAttribute("href", `/en/org/${team.slug}/billing`);
    await expect(usage).toContainText("Pause or close an open requirement to make room.");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(requirementUrl(team.slug, draft));
    await publishPrivately(page);
    const prompt = page.getByRole("alert").filter({ hasText: "open workforce requirements" });
    await expect(prompt).toContainText("3 of 3 open workforce requirements on your Basic plan.");
    await expect(prompt).toContainText("This requirement was not opened. Pause or close an open requirement to make room.");
    await expect(prompt.getByRole("link", { name: "Upgrade your plan" })).toHaveAttribute("href", `/en/org/${team.slug}/billing`);
    await expect(page.getByRole("dialog", { name: "Publish this requirement" })).toBeHidden();
    await expect(page.getByText("The requirement is published", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Draft - not visible to partners" })).toBeVisible();
    await expectNoAxeViolations(page);
    expect(statusOf(draft)).toBe("draft");
    // The list and the refused publish both showed the prompt; it is recorded once per user and hour (AC9).
    await expect.poll(() => promptRows(team.id)).toEqual([
      { actor_id: team.owner.id, metadata: { limit_key: "active_requirements", plan_code: "employer_starter", limit: 3, used: 3 } },
    ]);

    await page.goto(requirementUrl(team.slug, open[0]));
    await waitForHydration(statusButtons(page).first());
    await statusButtons(page).filter({ hasText: "Pause" }).click();
    await expect(page.getByText("The requirement is paused", { exact: true })).toBeVisible();

    await page.goto(requirementsUrl(team.slug));
    await expect(page.getByText("2 of 3 open workforce requirements on your Basic plan.", { exact: true })).toBeVisible();
    await page.goto(requirementUrl(team.slug, draft));
    await publishPrivately(page);
    await expect(page.getByText("The requirement is published", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "open workforce requirements" })).toHaveCount(0);
    expect(statusOf(draft)).toBe("open");
    expect(openCount(team.id)).toBe(3);

    await page.goto(requirementUrl(team.slug, open[0]));
    await waitForHydration(statusButtons(page).first());
    await statusButtons(page).filter({ hasText: "Reopen" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "open workforce requirements" })).toContainText(
      "3 of 3 open workforce requirements on your Basic plan.",
    );
    expect(statusOf(open[0])).toBe("paused");

    const memberPage = await newVisitor(browser);
    await logIn(memberPage.page, member.user, requirementsUrl(team.slug));
    const memberUsage = memberPage.page.getByRole("status").filter({ hasText: "open workforce requirements" });
    await expect(memberUsage).toContainText("3 of 3 open workforce requirements on your Basic plan.");
    await expect(memberUsage.getByRole("link")).toHaveCount(0);
    await memberPage.page.goto(requirementUrl(team.slug, open[1]));
    await expect(memberPage.page.getByRole("region", { name: "Status actions" })).toHaveCount(0);
    await memberPage.context.close();
  });

  test("AC8: two admins publish at the same moment and exactly one succeeds at the limit", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    subscribe(team, "employer_starter");
    seedOpen(team, 2);
    const first = seedRequirement(team, "Concurrent draft one");
    const second = seedRequirement(team, "Concurrent draft two");
    const admin = await addMember(team, "admin");
    const other = await newVisitor(browser);
    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, first));
    await signInAtAal2(other.page, admin.user, admin.secret ?? "", requirementUrl(team.slug, second));

    const pages = [page, other.page];
    for (const person of pages) {
      await waitForHydration(statusButtons(person).first());
      await person.getByRole("region", { name: "Status actions" }).getByRole("button", { name: "Publish", exact: true }).click();
      await person.getByRole("dialog", { name: "Publish this requirement" }).getByRole("radio", { name: "Only partners I invite", exact: true }).check();
    }
    await Promise.all(
      pages.map((person) => person.getByRole("dialog", { name: "Publish this requirement" }).getByRole("button", { name: "Publish requirement" }).click()),
    );
    await expect
      .poll(async () => {
        const outcomes = await Promise.all(
          pages.map(async (person) =>
            (await person.getByText("The requirement is published", { exact: true }).count()) > 0
              ? "published"
              : (await person.getByRole("alert").filter({ hasText: "open workforce requirements" }).count()) > 0
                ? "prompt"
                : "waiting",
          ),
        );
        return outcomes.sort();
      })
      .toEqual(["prompt", "published"]);
    expect(openCount(team.id)).toBe(3);
    expect([statusOf(first), statusOf(second)].sort()).toEqual(["draft", "open"]);
    await other.context.close();
  });

  test("AC4, AC9: further destinations follow the plan feature, in the form and after a downgrade", async ({ page }) => {
    test.setTimeout(180_000);
    const basic = await newTeam();
    subscribe(basic, "employer_starter");
    const basicDraft = seedRequirement(basic, "Basic destinations");
    await signInAtAal2(page, basic.owner, basic.ownerSecret, `${requirementUrl(basic.slug, basicDraft)}/edit`);
    const destinations = page.getByRole("group", { name: "Further destination countries" });
    await expect(destinations).toContainText("Several destination countries are available on Professional.");
    await expect(destinations.getByRole("link", { name: "Upgrade" })).toHaveAttribute("href", `/en/org/${basic.slug}/billing`);
    await expect(destinations.getByRole("button", { name: "Add destination country" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.context().clearCookies();

    const professional = await newTeam();
    subscribe(professional, "employer_professional");
    const draft = seedRequirement(professional, "Professional destinations");
    await signInAtAal2(page, professional.owner, professional.ownerSecret, `${requirementUrl(professional.slug, draft)}/edit`);
    await waitForHydration(page.getByRole("button", { name: "Add destination country" }));
    await page.getByRole("button", { name: "Add destination country" }).click();
    await chooseFromList(page, "Destination country 2", "Netherlands", /^Netherlands$/);
    await page.getByRole("button", { name: "Add destination country" }).click();
    await chooseFromList(page, "Destination country 3", "Germany", /^Germany$/);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("#requirement-destination-1-error")).toHaveText("This country is already a destination.");
    await page.getByRole("button", { name: "Remove Germany" }).click();
    await expect(page.getByText("Removed Germany")).toBeAttached();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Workforce requirement saved", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(requirementUrl(professional.slug, draft));
    await expect(page.getByText("Netherlands", { exact: true })).toBeVisible();
    expect(
      query<{ c: string }>(`select string_agg(country_code, ',' order by country_code) as c from public.requirement_countries where requirement_id = ${literal(draft)}`)[0].c,
    ).toBe("DE,NL");
    await publishPrivately(page);
    await expect(page.getByText("The requirement is published", { exact: true })).toBeVisible();

    execute(`update billing.subscriptions set plan_code = 'employer_starter' where organization_id = ${literal(professional.id)}`);
    await page.reload();
    await waitForHydration(statusButtons(page).first());
    await statusButtons(page).filter({ hasText: "Pause" }).click();
    await expect(page.getByText("The requirement is paused", { exact: true })).toBeVisible();
    await statusButtons(page).filter({ hasText: "Reopen" }).click();
    const refusal = page.getByRole("alert").filter({ hasText: "Several destination countries" });
    await expect(refusal).toContainText("Several destination countries are available on Professional.");
    await expect(refusal.getByRole("link", { name: "upgrade your plan" })).toHaveAttribute("href", `/en/org/${professional.slug}/billing`);
    await expectNoAxeViolations(page);
    expect(statusOf(draft)).toBe("paused");

    await page.goto(`${requirementUrl(professional.slug, draft)}/edit`);
    const downgraded = page.getByRole("group", { name: "Further destination countries" });
    await expect(downgraded).toContainText("Remove the further destinations to reopen this requirement on your plan.");
    await waitForHydration(page.getByRole("button", { name: "Remove Netherlands" }));
    await page.getByRole("button", { name: "Remove Netherlands" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Workforce requirement saved", { exact: true })).toBeVisible();
    await waitForHydration(statusButtons(page).first());
    await statusButtons(page).filter({ hasText: "Reopen" }).click();
    await expect(page.getByText("The requirement is open again", { exact: true })).toBeVisible();
    expect(statusOf(draft)).toBe("open");
  });

  test("task item 2: a lapse pauses the requirements, the reopen is refused on the free plan and allowed after a new subscription", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const team = await newTeam();
    subscribe(team, "employer_starter");
    const [id] = seedOpen(team, 1);
    execute(
      `update billing.subscriptions set status = 'canceled' where organization_id = ${literal(team.id)};
       select private.pause_jobs_on_lapse(${literal(team.id)});`,
    );
    expect(statusOf(id)).toBe("paused");

    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, id));
    await waitForHydration(statusButtons(page).first());
    await statusButtons(page).filter({ hasText: "Reopen" }).click();
    const prompt = page.getByRole("alert").filter({ hasText: "open workforce requirements" });
    await expect(prompt).toContainText("0 of 0 open workforce requirements on your Free plan.");
    await expect(prompt).not.toContainText("Pause or close");
    expect(statusOf(id)).toBe("paused");

    subscribe(team, "employer_starter");
    await page.reload();
    await waitForHydration(statusButtons(page).first());
    await statusButtons(page).filter({ hasText: "Reopen" }).click();
    await expect(page.getByText("The requirement is open again", { exact: true })).toBeVisible();
    expect(statusOf(id)).toBe("open");
  });

  test("AC11: the dashboard plan card and the billing page show the open requirements next to the vacancies", async ({ page }) => {
    test.setTimeout(120_000);
    const team = await newTeam();
    subscribe(team, "employer_starter");
    seedOpen(team, 2);
    seedRequirement(team, "Paused welders", { status: "paused" });
    await signInAtAal2(page, team.owner, team.ownerSecret, `/en/org/${team.slug}/billing`);
    await page.goto(`/en/dashboard/employer?org=${team.slug}`);
    const plan = page.getByRole("region", { name: "Plan" });
    await expect(plan).toContainText("2 of 3 open workforce requirements on your Basic plan.");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(`/en/org/${team.slug}/billing`);
    const usage = page.getByRole("region", { name: "Usage" });
    await expect(usage.getByRole("listitem").filter({ hasText: "Open vacancies" })).toContainText("0 of 3");
    await expect(usage.getByRole("listitem").filter({ hasText: "Open workforce requirements" })).toContainText("2 of 3");
    await expect(usage.getByRole("progressbar", { name: "Open workforce requirements" })).toHaveAttribute("aria-valuenow", "2");
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-R2: the plan editor shows and changes active_requirements and multi_country_requirements, and the pages follow", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await signInStaff(page, "admin", "/en/admin/plans");
    const row = page.getByRole("region", { name: "Plans for employers" }).getByRole("row").filter({ hasText: "employer_starter" });
    await expect(row).toContainText("Active workforce requirements: 3");
    await expect(row).toContainText("Multi-country requirements: Off");
    await page.getByRole("button", { name: "Edit Basic (employer_starter)" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Basic" });
    await dialog.getByRole("textbox", { name: "Active workforce requirements" }).fill("4");
    await dialog.getByRole("checkbox", { name: "Multi-country requirements" }).check();
    await dialog.getByRole("textbox", { name: "Reason for the change" }).fill("Basic gets a fourth requirement and more countries");
    await dialog.getByRole("button", { name: "Review changes" }).click();
    await expect(dialog.getByRole("listitem")).toHaveText(["Active workforce requirements: 3 -> 4", "Multi-country requirements: Off -> On"]);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Basic is saved", { exact: true })).toBeVisible();
    await expect(row).toContainText("Active workforce requirements: 4");
    await expect(row).toContainText("Multi-country requirements: On");
    expect(
      query<{ n: number }>(
        `select count(*)::int as n from audit.log where action = 'billing.plan_changed' and entity_id = 'employer_starter'
           and (metadata ->> 'limit_key' = 'active_requirements' or metadata ->> 'feature_key' = 'multi_country_requirements')
           and actor_id is not null and created_at > now() - interval '1 minute'`,
      )[0].n,
    ).toBe(2);

    const team = await newTeam();
    subscribe(team, "employer_starter");
    seedOpen(team, 3);
    const draft = seedRequirement(team, "Fourth requirement");
    const owner = await newVisitor(browser);
    await signInAtAal2(owner.page, team.owner, team.ownerSecret, requirementsUrl(team.slug));
    await expect(owner.page.getByText("3 of 4 open workforce requirements on your Basic plan.", { exact: true })).toBeVisible();
    await owner.page.goto(`${requirementUrl(team.slug, draft)}/edit`);
    await expect(owner.page.getByRole("button", { name: "Add destination country" })).toBeVisible();
    await owner.context.close();
  });
});
