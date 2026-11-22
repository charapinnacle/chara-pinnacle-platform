import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { logOut } from "./support/app-shell";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { chooseFromList } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { uniqueToken } from "./support/organizations";
import { captureActionRequests } from "./support/server-action";
import { summary } from "./support/signup-page";
import { addMember, newTeam, newVisitor, signInAtAal1, signInAtAal2, type Team } from "./support/team";
import { expect, test } from "./support/test";

const requirementsUrl = (slug: string) => `/en/org/${slug}/requirements`;
const newRequirementUrl = (slug: string) => `${requirementsUrl(slug)}/new`;
const requirementUrl = (slug: string, id: string) => `${requirementsUrl(slug)}/${id}`;

const PROHIBITED = "Requirements may not ask for gender, age, nationality or other personal characteristics.";

// The visible labels of the form of FR-M1 AC1, in their order, with one occupation row chosen as 7212.
const FIELD_LABELS = [
  "Title (optional)",
  "Number of workers",
  "Country",
  "City or region",
  "Industry",
  "Occupation 1",
  "Quantity of Welders and flame cutters",
  "Skills (optional)",
  "Experience in years (optional)",
  "Start date",
  "Project duration in months (optional)",
  "Employment type",
  "Salary minimum",
  "Salary maximum",
  "Currency",
  "Pay period",
  "Accommodation provided",
  "Work permit support offered",
  "Visa support offered",
  "Recruitment preference",
  "Need workforce partners?",
];

function draftKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.sessionStorage).filter((key) => key.startsWith("chara:requirement-draft:")));
}

function setRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

function startDate(daysAhead = 120): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

type RequirementRow = { id: string; status: string; created_by: string; visibility: string | null; workers_needed: number; title: string };

function requirementRows(organizationId: string): RequirementRow[] {
  return query<RequirementRow>(
    `select id, status, created_by, visibility, workers_needed, title from public.workforce_requirements
     where organization_id = ${literal(organizationId)} order by created_at`,
  );
}

function occupationRows(requirementId: string): string[] {
  return query<{ row: string }>(
    `select occupation_id || 'x' || quantity as row from public.requirement_occupations
     where requirement_id = ${literal(requirementId)} order by occupation_id`,
  ).map(({ row }) => row);
}

function audits(requirementId: string, action: string): number {
  return query<{ n: number }>(
    `select count(*)::int as n from audit.log where action = ${literal(action)} and entity_id = ${literal(requirementId)}`,
  )[0].n;
}

// The requirement of FR-M1 AC1 (the industry is the ISIC section C, DATA_MODEL.md section 2).
async function fillRequirement(page: Page, { skills = "MIG/MAG welding, blueprint reading" } = {}): Promise<void> {
  await waitForHydration(page.getByLabel("Number of workers", { exact: true }));
  await page.getByLabel("Number of workers", { exact: true }).fill("100");
  await chooseFromList(page, "Country", "Germany", /^Germany$/);
  await page.getByLabel("City or region", { exact: true }).fill("Hamburg");
  await chooseFromList(page, "Industry", "Manufacturing", "Manufacturing");
  await chooseFromList(page, "Occupation 1", "weld", "Welders and flame cutters");
  await page.getByLabel("Quantity of Welders and flame cutters", { exact: true }).fill("80");
  await page.getByRole("button", { name: "Add occupation" }).click();
  await chooseFromList(page, "Occupation 2", "7214", "Structural-metal preparers and erectors");
  await page.getByLabel("Quantity of Structural-metal preparers and erectors", { exact: true }).fill("20");
  await page.getByLabel("Skills (optional)", { exact: true }).fill(skills);
  await page.getByLabel("Experience in years (optional)", { exact: true }).fill("2");
  await page.getByLabel("Start date", { exact: true }).fill(startDate());
  await page.getByLabel("Project duration in months (optional)", { exact: true }).fill("12");
  await page.getByLabel("Employment type").selectOption({ value: "full_time" });
  await page.getByLabel("Salary minimum").fill("2800");
  await page.getByLabel("Salary maximum").fill("3400");
  await chooseFromList(page, "Currency", "EUR", /^EUR /);
  await page.getByLabel("Pay period").selectOption({ value: "month" });
  await page.getByLabel("Accommodation provided").check();
  await page.getByLabel("Work permit support offered").check();
  await page.getByLabel("Visa support offered").check();
  await page.getByLabel("Recruitment preference").selectOption({ value: "international" });
  await page.getByLabel("Need workforce partners?").selectOption({ value: "both" });
}

// A draft written as the database owner, as save_requirement leaves it; with closesInDays, an open private requirement
// as publish_requirement leaves it, published today and closing that many days ahead.
function seedRequirement(team: Pick<Team, "id" | "owner">, title = "Seeded welders", closesInDays?: number): string {
  const id = randomUUID();
  const open = closesInDays !== undefined;
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, employment_type, recruitment_preference, partner_need, created_by, status, visibility, published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 10, 'DE', 'Bremen', 'C', current_date + 60, 'full_time', 'local',
       'none', ${literal(team.owner.id)}, ${open ? "'open', 'private', now()" : "'draft', null, null"},
       ${open ? `current_date + ${closesInDays}` : "null"});
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 10);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, 'DE')`,
  );
  return id;
}

// The release switch of 2b is set for the whole database, so this file is a project of its own after the release 2a
// projects (playwright.config.ts), and all its tests, the lifecycle ones too, run one after the other.
test.describe.configure({ mode: "serial" });
test.beforeAll(() => setRelease(true));
test.afterAll(() => setRelease(false));

test.describe("Workforce requirements (FR-M1)", () => {

  test("AC1: an owner at aal2 posts a complete draft, lands on it with the draft banner and edits it", async ({ page }) => {
    test.setTimeout(120_000);
    const team = await newTeam();
    await signInAtAal2(page, team.owner, team.ownerSecret, requirementsUrl(team.slug));
    await expect(page.getByRole("heading", { name: "No workforce requirements yet" })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("link", { name: "Post workforce requirement" }).click();
    await expect(page).toHaveURL(newRequirementUrl(team.slug));
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await fillRequirement(page);
    await expect(page.getByText("Total: 100 of 100 workers", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/requirements\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("status").filter({ hasText: "Draft - not visible to partners" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "100 workers: Welders and flame cutters, Structural-metal preparers and erectors, Hamburg",
    );

    const rows = requirementRows(team.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "draft", created_by: team.owner.id, visibility: null, workers_needed: 100 });
    expect(occupationRows(rows[0].id)).toEqual(["7212x80", "7214x20"]);
    expect(audits(rows[0].id, "requirement.created")).toBe(1);
    await expect(page.getByText("7212 · Welders and flame cutters")).toBeVisible();
    await expect(page.getByText("Yes, recruitment and staffing companies")).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("link", { name: "Edit workforce requirement" }).click();
    await expect(page.getByLabel("Quantity of Welders and flame cutters", { exact: true })).toHaveValue("80");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("Number of workers", { exact: true }).fill("120");
    await page.getByLabel("Quantity of Welders and flame cutters", { exact: true }).fill("100");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(requirementUrl(team.slug, rows[0].id));
    await expect(page.getByText("120 workers", { exact: true })).toBeVisible();
    expect(occupationRows(rows[0].id)).toEqual(["7212x100", "7214x20"]);
    expect(audits(rows[0].id, "requirement.updated")).toBe(1);

    await page.goto(requirementsUrl(team.slug));
    await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: "120 workers" })).toHaveCount(1);
    await expect(page.getByRole("main").getByText("Draft", { exact: true })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
  });

  test("AC8: the form has the fields of AC1 with labels and none for a personal characteristic; refused wording is explained at the field", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const team = await newTeam();
    const admin = await addMember(team, "admin");
    await signInAtAal2(page, admin.user, admin.secret!, newRequirementUrl(team.slug));
    await fillRequirement(page, { skills: "male only" });

    const labels = page.locator("main form label");
    await expect(labels).toHaveText(FIELD_LABELS.slice(0, 7).concat(["Occupation 2", "Quantity of Structural-metal preparers and erectors"], FIELD_LABELS.slice(7)));
    for (const forbidden of [/gender/i, /\bage\b/i, /nationality/i, /religion/i, /marital/i, /photo/i]) {
      await expect(page.locator("main form").getByLabel(forbidden)).toHaveCount(0);
    }

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.locator("#requirement-skills-error")).toHaveText(PROHIBITED);
    await expect(summary(page)).toContainText(PROHIBITED);
    await expect(page.getByLabel("Skills (optional)", { exact: true })).toBeFocused();
    await expect(page.getByLabel("City or region", { exact: true })).toHaveValue("Hamburg");
    await expect(page.getByLabel("Quantity of Welders and flame cutters", { exact: true })).toHaveValue("80");
    expect(requirementRows(team.id)).toEqual([]);

    // The second Platform Rules link of the form is the one that explains the refusal under the skills.
    const rules = page.locator("main form").getByRole("link", { name: /^Platform Rules/ }).nth(1);
    await expect(rules).toHaveAttribute("href", "/en/legal/platform-rules");
    await expect(rules).toHaveAttribute("target", "_blank");
    const popup = context.waitForEvent("page");
    await rules.click();
    const opened = await popup;
    await expect(opened).toHaveURL(/\/en\/legal\/platform-rules$/);
    await opened.close();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByLabel("Skills (optional)", { exact: true }).fill("MIG/MAG welding, 2 years, English B1");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/requirements\/[0-9a-f-]{36}$/);
    expect(requirementRows(team.id)).toHaveLength(1);
  });

  test("AC12: a half-filled form is kept, the keyboard adds and removes occupations, a double click saves once and a server error keeps the values", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const team = await newTeam();
    await signInAtAal2(page, team.owner, team.ownerSecret, newRequirementUrl(team.slug));
    await waitForHydration(page.getByLabel("Number of workers", { exact: true }));

    await page.getByLabel("Number of workers", { exact: true }).fill("50");
    await page.getByLabel("City or region", { exact: true }).fill("Kiel");
    await page.goto(requirementsUrl(team.slug));
    await page.goto(newRequirementUrl(team.slug));
    await expect(page.getByLabel("Number of workers", { exact: true })).toHaveValue("50");
    await expect(page.getByLabel("City or region", { exact: true })).toHaveValue("Kiel");
    expect(requirementRows(team.id)).toEqual([]);
    await page.getByRole("button", { name: "Clear the form" }).click();
    await expect(page.getByLabel("Number of workers", { exact: true })).toHaveValue("");

    // The occupation rows by keyboard: add, choose, label, remove.
    await page.getByRole("combobox", { name: "Occupation 1", exact: true }).focus();
    await page.keyboard.type("weld");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Quantity of Welders and flame cutters", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add occupation" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("combobox", { name: "Occupation 2", exact: true }).focus();
    await page.keyboard.type("7214");
    await page.keyboard.press("Enter");
    const removeSecond = page.getByRole("button", { name: "Remove Structural-metal preparers and erectors" });
    await removeSecond.focus();
    await page.keyboard.press("Enter");
    await expect(removeSecond).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Occupation 1", exact: true })).toBeFocused();
    await expect(page.getByText("Removed Structural-metal preparers and erectors", { exact: true })).toBeAttached();
    await expect(page.getByRole("combobox", { name: "Occupation 2", exact: true })).toHaveCount(0);
    await page.reload();

    await fillRequirement(page);
    const calls = captureActionRequests(page);
    await page.route(`**${newRequirementUrl(team.slug)}`, async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.continue();
    });
    await page.getByRole("button", { name: "Save draft" }).dblclick();
    await expect(page.getByRole("button", { name: "Saving..." })).toBeDisabled();
    await expect(page).toHaveURL(/\/requirements\/[0-9a-f-]{36}$/);
    expect(calls).toHaveLength(1);
    expect(requirementRows(team.id)).toHaveLength(1);
    await page.unroute(`**${newRequirementUrl(team.slug)}`);

    await page.goto(newRequirementUrl(team.slug));
    await expect(page.getByLabel("Number of workers", { exact: true })).toHaveValue("");
    await fillRequirement(page);
    await page.route(`**${newRequirementUrl(team.slug)}`, (route) =>
      route.request().method() === "POST" ? route.fulfill({ status: 500, body: "boom" }) : route.continue(),
    );
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Could not save the workforce requirement", { exact: true })).toBeVisible();
    await expect(page.getByLabel("City or region", { exact: true })).toHaveValue("Hamburg");
    await expect(page.getByLabel("Quantity of Structural-metal preparers and erectors", { exact: true })).toHaveValue("20");
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
    expect(requirementRows(team.id)).toHaveLength(1);

    // The kept values belong to this user and organisation, and log out removes them from the tab.
    await page.unroute(`**${newRequirementUrl(team.slug)}`);
    expect(await draftKeys(page)).toEqual([`chara:requirement-draft:${team.owner.id}:${team.slug}`]);
    await logOut(page);
    await expect(page).not.toHaveURL(newRequirementUrl(team.slug));
    expect(await draftKeys(page)).toEqual([]);
  });

  test("AC2, AC3: quantities that do not add up are named at the occupations before anything is sent", async ({ page }) => {
    const team = await newTeam();
    await signInAtAal2(page, team.owner, team.ownerSecret, newRequirementUrl(team.slug));
    await fillRequirement(page);
    await page.getByLabel("Quantity of Structural-metal preparers and erectors", { exact: true }).fill("10");
    const calls = captureActionRequests(page);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.locator("#requirement-occupations-error")).toHaveText("Quantities must add up to 100.");
    await summary(page).getByRole("link", { name: "Quantities must add up to 100." }).click();
    await expect(page.getByRole("combobox", { name: "Occupation 1", exact: true })).toBeFocused();
    expect(calls).toHaveLength(0);
    expect(requirementRows(team.id)).toEqual([]);
  });

  test("roles: a member reads without actions, an owner at aal1 is asked for the code, partners and outsiders find nothing", async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const team = await newTeam();
    const id = seedRequirement(team);
    const member = await addMember(team, "member");

    await signInAtAal1(page, member.user, requirementsUrl(team.slug));
    await expect(page.getByRole("link", { name: "Seeded welders" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Post workforce requirement" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Edit/ })).toHaveCount(0);
    await page.getByRole("link", { name: "Seeded welders" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Draft - not visible to partners" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit workforce requirement" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.goto(newRequirementUrl(team.slug));
    await expect(page).toHaveURL("/en/forbidden");
    await page.goto(`/en/dashboard/employer?org=${team.slug}`);
    await expect(page.getByRole("link", { name: "Workforce requirements" })).toHaveAttribute("href", requirementsUrl(team.slug));

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await logIn(ownerPage, team.owner, requirementUrl(team.slug, id));
    await expect(ownerPage).toHaveURL(`/en/mfa?next=${encodeURIComponent(requirementUrl(team.slug, id))}`);
    await ownerContext.close();

    const outsider = await newTeam();
    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    await signInAtAal2(outsiderPage, outsider.owner, outsider.ownerSecret, requirementsUrl(outsider.slug));
    for (const path of [requirementsUrl(team.slug), requirementUrl(team.slug, id), `${requirementUrl(team.slug, id)}/edit`]) {
      await outsiderPage.goto(path);
      await expect(outsiderPage.getByRole("heading", { name: "Page not found" }), path).toBeVisible();
    }
    await outsiderPage.goto(requirementUrl(outsider.slug, id));
    await expect(outsiderPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await outsiderContext.close();

    const partnerOwner = await createCommittedUser("company");
    const partnerUser = await createCommittedUser("company");
    const partnerSlug = `delta-${uniqueToken()}`;
    execute(
      `with o as (
         insert into public.organizations (type, slug, legal_name, display_name, based_in_country)
         values ('recruitment_company', ${literal(partnerSlug)}, 'Delta Recruit Ltd', 'Delta Recruit', 'PH') returning id)
       insert into public.organization_members (organization_id, user_id, role, accepted_at)
       select id, ${literal(partnerOwner.id)}::uuid, 'owner'::public.member_role, now() from o
       union all select id, ${literal(partnerUser.id)}::uuid, 'member'::public.member_role, now() from o`,
    );
    const partnerContext = await browser.newContext();
    const partnerPage = await partnerContext.newPage();
    await logIn(partnerPage, partnerUser, requirementsUrl(partnerSlug));
    await expect(partnerPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await partnerContext.close();

    setRelease(false);
    try {
      await page.goto(requirementsUrl(team.slug));
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await page.goto(`/en/dashboard/employer?org=${team.slug}`);
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Workforce requirements" })).toHaveCount(0);
    } finally {
      setRelease(true);
    }
  });
});

const DAY_MS = 86_400_000;
const longDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });
const daysAhead = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
const shownDate = (days: number) => longDate.format(new Date(`${daysAhead(days)}T00:00:00Z`));

type LifecycleRow = { status: string; visibility: string | null; show_identity: boolean; closes_on: string | null; close_reason: string | null };

function lifecycleRow(id: string): LifecycleRow {
  return query<LifecycleRow>(
    `select status, visibility, show_identity, closes_on::text, close_reason from public.workforce_requirements where id = ${literal(id)}`,
  )[0];
}

function statusButtons(page: Page) {
  return page.getByRole("region", { name: "Status actions" }).getByRole("button");
}

test.describe("Workforce requirement lifecycle (FR-M2)", () => {

  test("AC12: Publish asks for the channel, Open and Paused offer their actions, Close asks for a reason by keyboard and the member only reads", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const team = await newTeam();
    const id = seedRequirement(team, "Lifecycle welders");
    const member = await addMember(team, "member");
    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, id));
    await expect(page.getByRole("status").filter({ hasText: "Draft - not visible to partners" })).toBeVisible();
    await expect(statusButtons(page)).toHaveText(["Publish"]);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await waitForHydration(statusButtons(page).first());
    await statusButtons(page).first().click();
    const publish = page.getByRole("dialog", { name: "Publish this requirement" });
    await expect(publish.getByRole("radio")).toHaveCount(2);
    await expect(publish.getByRole("radio", { name: "Only partners I invite", exact: true })).toBeVisible();
    await expect(publish.getByRole("checkbox", { name: "Show our company name" })).toHaveCount(0);
    await expect(publish.getByText(`Published today, it closes on ${shownDate(90)} unless you extend it by 30 days at a time.`)).toBeVisible();
    await publish.getByRole("button", { name: "Publish requirement" }).click();
    await expect(summary(page)).toContainText("Choose who can see this requirement.");
    await publish.getByRole("radio", { name: "Job order marketplace", exact: true }).check();
    await expect(publish.getByRole("checkbox", { name: "Show our company name" })).not.toBeChecked();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await publish.getByRole("button", { name: "Publish requirement" }).click();
    await expect(publish).toBeHidden();
    await expect(page.getByText("The requirement is published", { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Open - partners can respond" })).toBeVisible();
    await expect(page.getByText(`Closes on ${shownDate(90)}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Job order marketplace, without your company name", { exact: true })).toBeVisible();
    expect(lifecycleRow(id)).toEqual({
      status: "open",
      visibility: "job_order_marketplace",
      show_identity: false,
      closes_on: daysAhead(90),
      close_reason: null,
    });
    expect(audits(id, "requirement.status_changed")).toBe(1);
    await expect(statusButtons(page)).toHaveText(["Pause", "Close", "Mark as filled", "Extend by 30 days"]);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await statusButtons(page).filter({ hasText: "Extend by 30 days" }).click();
    await expect(page.getByText(`Closes on ${shownDate(120)}`, { exact: true })).toBeVisible();
    expect(audits(id, "requirement.extended")).toBe(1);

    await statusButtons(page).filter({ hasText: "Pause" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Paused - partners cannot respond" })).toBeVisible();
    await expect(statusButtons(page)).toHaveText(["Reopen", "Close", "Extend by 30 days"]);
    await statusButtons(page).filter({ hasText: "Reopen" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Open - partners can respond" })).toBeVisible();

    const memberView = await newVisitor(browser);
    await signInAtAal1(memberView.page, member.user, requirementUrl(team.slug, id));
    await expect(memberView.page.getByRole("status").filter({ hasText: "Open - partners can respond" })).toBeVisible();
    await expect(memberView.page.getByText(`Closes on ${shownDate(120)}`, { exact: true })).toBeVisible();
    await expect(memberView.page.getByRole("region", { name: "Status actions" })).toHaveCount(0);
    await memberView.context.close();

    await statusButtons(page).filter({ hasText: /^Close$/ }).focus();
    await page.keyboard.press("Enter");
    const close = page.getByRole("dialog", { name: "Close this requirement" });
    await expect(close.getByRole("radio")).toHaveCount(2);
    await expect(close.getByRole("radio", { name: "Filled", exact: true })).toBeVisible();
    await expect(close.getByRole("radio", { name: "Cancelled", exact: true })).toBeVisible();
    await close.getByRole("button", { name: "Close requirement" }).focus();
    await page.keyboard.press("Enter");
    await expect(summary(page)).toContainText("Choose why you close this requirement.");
    await close.getByRole("radio", { name: "Cancelled", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(close.getByRole("radio", { name: "Cancelled", exact: true })).toBeChecked();
    await close.getByRole("button", { name: "Close requirement" }).focus();
    await page.keyboard.press("Enter");
    await expect(close).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Closed - final" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Closed by your company on" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Status actions" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit workforce requirement" })).toHaveCount(0);
    expect(lifecycleRow(id)).toMatchObject({ status: "closed", close_reason: "cancelled" });
    await expectAccessibleAtBothWidths(page);
  });

  test("AC12: Mark as filled says it is final; a second admin on a stale page is told to reload and it stays filled", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const team = await newTeam();
    const id = seedRequirement(team, "Stale welders", 80);
    const admin = await addMember(team, "admin");
    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, id));
    const second = await newVisitor(browser);
    await signInAtAal2(second.page, admin.user, admin.secret!, requirementUrl(team.slug, id));
    await expect(second.page.getByText(`Closes on ${shownDate(80)}`, { exact: true })).toBeVisible();
    await waitForHydration(statusButtons(second.page).first());

    await waitForHydration(statusButtons(page).first());
    await statusButtons(page).filter({ hasText: "Mark as filled" }).click();
    const fill = page.getByRole("dialog", { name: "Mark this requirement as filled?" });
    await expect(fill.getByText(/^This is final\./)).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await fill.getByRole("button", { name: "Mark as filled" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Filled - final" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Marked as filled on" })).toBeVisible();

    await statusButtons(second.page).filter({ hasText: "Pause" }).click();
    await expect(second.page.getByText("This requirement was changed by someone else, reload.", { exact: true })).toBeVisible();
    await expect(second.page.getByRole("status").filter({ hasText: "Filled - final" })).toBeVisible();
    expect(lifecycleRow(id)).toMatchObject({ status: "filled", close_reason: "filled" });
    expect(audits(id, "requirement.status_changed")).toBe(1);
    await second.context.close();
  });

  test("AC6: a requirement closing soon warns on its page, and the reminder job puts it in the notifications with a link", async ({ page }) => {
    test.setTimeout(120_000);
    const team = await newTeam();
    const id = seedRequirement(team, `Closing welders ${uniqueToken()}`, 5);
    const title = query<{ title: string }>(`select title from public.workforce_requirements where id = ${literal(id)}`)[0].title;
    execute(`update private.settings set value = 'true' where key = 'release_partner_directories'`);
    try {
      await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, id));
      await expect(page.getByRole("status").filter({ hasText: "Extend it if you still need workers" })).toBeVisible();
      await expectAccessibleAtBothWidths(page);
      await page.setViewportSize({ width: 1280, height: 900 });

      execute("select private.remind_closing_requirements()");
      expect(
        query<{ n: number }>(
          `select count(*)::int as n from public.notifications where kind = 'requirement_closing_soon' and user_id = ${literal(team.owner.id)}`,
        )[0].n,
      ).toBe(1);
      await page.goto("/en/notifications");
      const item = page.getByRole("link", { name: `"${title}" closes on ${shownDate(5)}` });
      await expect(item).toBeVisible();
      await item.click();
      await expect(page).toHaveURL(requirementUrl(team.slug, id));
    } finally {
      execute(`update private.settings set value = 'false' where key = 'release_partner_directories'`);
    }
  });
});
