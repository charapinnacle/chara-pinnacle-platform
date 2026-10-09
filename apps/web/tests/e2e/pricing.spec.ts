import { expectNoAxeViolations } from "./support/axe";
import { billingPath, checkoutPath } from "./support/billing";
import { execute, literal } from "./support/db";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { uniqueName } from "./support/organizations";
import { planCard, planCards, priceText, publicPlanRecords, restorePlans, setPlan, workersSection } from "./support/pricing";
import { addMember, newTeam, newVisitor, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

// The plan records are changed for the whole database while this file runs, so it has a project of its own that follows
// the others and runs in one worker (playwright.config.ts); the seeded values are put back when it ends.
test.describe.configure({ mode: "serial" });
test.beforeEach(() => restorePlans());
test.afterAll(() => restorePlans());

const VERIFIED_SENTENCE = "A paid plan does not make an organisation verified or move its vacancies up in search results.";

test.describe("the cards (FR-H2 AC1, AC2, AC3, AC10)", () => {
  test("AC1, AC2, AC10: one card per public plan in order, the worker statement and no claim that payment buys visibility", async ({ page }) => {
    const response = await page.goto("/en/pricing");
    expect(response?.status()).toBe(200);

    await expect(planCards(page)).toHaveCount(2);
    await expect(planCards(page).getByRole("heading")).toHaveText(["Basic", "Professional"]);
    const basic = planCard(page, "Basic");
    await expect(basic).toContainText("EUR 39.00");
    await expect(basic).toContainText("per month excl. VAT");
    await expect(basic).toContainText("30-day free trial");
    await expect(basic).toContainText("Then EUR 39.00 per month excl. VAT.");
    await expect(basic).toContainText("The trial converts automatically to the paid Basic plan.");
    await expect(basic).toContainText("One free trial is granted per legal entity.");
    await expect(planCard(page, "Professional")).toContainText("EUR 79.00");
    await expect(page.getByRole("main").getByText("Free", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("main").getByText("Enterprise")).toHaveCount(0);

    const workers = workersSection(page);
    await expect(workers).toContainText("Workers never pay");
    await expect(workers).not.toContainText("EUR");
    await expect(workers.getByRole("link")).toHaveCount(0);

    const text = await page.getByRole("main").innerText();
    expect(text).toContain(VERIFIED_SENTENCE);
    expect(text).not.toMatch(/boost|badge|corridor|messaging|CHARA Match/i);
    await expectNoAxeViolations(page);
  });

  test("AC3: the trial text follows trial_days of the record, and 0 days shows none", async ({ page }) => {
    await page.goto("/en/pricing");
    await expect(planCard(page, "Basic")).toContainText("30-day free trial");

    setPlan("employer_starter", "trial_days = 14");
    await page.reload();
    await expect(planCard(page, "Basic")).toContainText("14-day free trial");
    await expect(planCard(page, "Basic")).not.toContainText("30-day");

    setPlan("employer_starter", "trial_days = 0");
    await page.reload();
    await expect(planCard(page, "Basic")).toContainText("EUR 39.00");
    await expect(planCard(page, "Basic")).not.toContainText(/trial|Then EUR/);
    await expect(planCard(page, "Professional")).toContainText("30-day free trial");
  });
});

test.describe("price changes (FR-H2 AC4, AC8)", () => {
  test("AC4: a new price and name appear on the next request, and no other card changes", async ({ page }) => {
    await page.goto("/en/pricing");
    await expect(planCard(page, "Basic")).toContainText("EUR 39.00");

    setPlan("employer_starter", "price_minor = 4900, name = 'Starter'");
    await page.reload();

    await expect(planCard(page, "Starter")).toContainText("EUR 49.00");
    await expect(planCard(page, "Starter")).toContainText("Then EUR 49.00 per month excl. VAT.");
    await expect(page.getByRole("heading", { name: "Basic", exact: true })).toHaveCount(0);
    await expect(planCard(page, "Professional")).toContainText("EUR 79.00");
  });

  test("AC8: every card equals its plan record, and the checkout of the owner shows the same name, price and trial", async ({ page }) => {
    const team = await newTeam(uniqueName("Pricing Bau"));
    const records = publicPlanRecords();
    expect(records.map((record) => record.code)).toEqual(["employer_starter", "employer_professional"]);

    await signInAtAal2(page, team.owner, team.ownerSecret, billingPath(team.slug));
    await page.goto("/en/pricing");
    for (const record of records) {
      const card = planCard(page, record.name);
      await expect(card).toContainText(priceText(record.price_minor, record.currency));
      await expect(card).toContainText(`per ${record.interval} excl. VAT`);
      await expect(card).toContainText(`${record.trial_days}-day free trial`);
    }

    await page.getByRole("link", { name: "Choose Basic" }).click();
    await expect(page).toHaveURL(billingPath(team.slug));
    await page.getByRole("link", { name: "Choose Basic" }).click();
    await expect(page).toHaveURL(checkoutPath(team.slug));
    const [basic] = records;
    const disclosures = page.getByRole("region", { name: "Before you continue" });
    await expect(page.getByText(`Basic, ${priceText(basic.price_minor, basic.currency)} per ${basic.interval}`)).toBeVisible();
    await expect(disclosures).toContainText(`${basic.trial_days} days free`);
    await expect(disclosures).toContainText(`${priceText(basic.price_minor, basic.currency)} per ${basic.interval}, excluding VAT`);
  });
});

test.describe("which plans and what they list (FR-H2 AC5, AC6, AC11)", () => {
  test("AC5: a plan that is not public is hidden, a public one shows its price, a contact-sales one shows a link and no price", async ({ page }) => {
    await page.goto("/en/pricing");
    await expect(planCards(page)).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Enterprise" })).toHaveCount(0);

    setPlan("employer_enterprise", "is_public = true, contact_sales = false, price_minor = 19900");
    await page.reload();
    await expect(planCards(page)).toHaveCount(3);
    await expect(planCard(page, "Enterprise")).toContainText("EUR 199.00");

    setPlan("employer_enterprise", "contact_sales = true");
    await page.reload();
    const enterprise = planCard(page, "Enterprise");
    await expect(enterprise).not.toContainText("EUR");
    await expect(enterprise).not.toContainText("trial");
    await expect(enterprise.getByRole("link", { name: "Contact sales about Enterprise" })).toHaveAttribute("href", "/en/contact");
  });

  test("AC6: each card lists the limits of its own rows and the features that have a label, and nothing of a later phase", async ({ page }) => {
    setPlan("employer_enterprise", "is_public = true, contact_sales = false, price_minor = 19900");
    execute(`
      insert into billing.plan_features (plan_code, feature_key)
      values ('employer_starter', 'chara_match'), ('employer_starter', 'corridors'), ('employer_starter', 'advanced_worker_search');
      insert into billing.plan_limits (plan_code, limit_key, limit_value) values ('employer_starter', 'active_requirements', null);
    `);

    await page.goto("/en/pricing");

    for (const [name, vacancies, members] of [
      ["Basic", "3 active vacancies", "1 team member"],
      ["Professional", "15 active vacancies", "5 team members"],
      ["Enterprise", "50 active vacancies", "15 team members"],
    ]) {
      const card = planCard(page, name);
      await expect(card.getByRole("listitem").filter({ hasText: vacancies })).toHaveCount(1);
      await expect(card.getByRole("listitem").filter({ hasText: members })).toHaveCount(1);
      await expect(card.getByText("Shortlisting of applicants")).toBeVisible();
    }
    const basic = await planCard(page, "Basic").innerText();
    expect(basic).not.toMatch(/match|corridor|worker search|requirement|analytics/i);
    await expect(planCard(page, "Basic").getByRole("listitem")).toHaveCount(4);
  });

  test("AC11: no public plan shows the unavailable notice and the worker statement, a failed read shows the error page", async ({ page }) => {
    execute("update billing.plans set is_public = false where code in ('employer_starter', 'employer_professional')");
    const response = await page.goto("/en/pricing");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Pricing is currently unavailable" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/en/contact");
    await expect(workersSection(page)).toContainText("Workers never pay");
    await expect(planCards(page)).toHaveCount(0);

    execute("revoke select on public.v_plans from anon, authenticated");
    const failed = await page.request.get("/en/pricing");
    expect(failed.status()).toBe(500);
    const html = await failed.text();
    expect(html).not.toContain("permission denied");
    expect(html).not.toContain("v_plans");
    expect(html).not.toContain("EUR");

    await page.goto("/en/pricing");
    await expect(page.getByRole("heading", { name: "This page could not be loaded" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find Jobs" })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/permission denied|v_plans|^\s+at /m);
  });
});

test.describe("the link of a card by who reads the page (FR-H2 AC12)", () => {
  test("a visitor is led to the sign-up, once per paid plan", async ({ page }) => {
    await page.goto("/en/pricing");
    const links = planCards(page).getByRole("link");
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveAccessibleName("Sign up for Basic");
    await expect(links.nth(1)).toHaveAccessibleName("Sign up for Professional");
    await expect(links.nth(0)).toHaveAttribute("href", "/en/signup");
  });

  test("a worker, an owner, an admin, a member and a company user without an organisation each see what applies to them", async ({ browser }) => {
    const team = await newTeam(uniqueName("Roles Pricing"));
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");
    const worker = await createCommittedUser("worker");
    const unfinished = await createCommittedUser("company");

    const read = async (user: Parameters<typeof logIn>[1]) => {
      const { context, page } = await newVisitor(browser);
      await logIn(page, user);
      await page.waitForURL((url) => !url.pathname.endsWith("/login"));
      await page.goto("/en/pricing");
      await expect(planCards(page)).toHaveCount(2);
      return { context, page };
    };

    const owner = await read(team.owner);
    await expect(planCard(owner.page, "Basic").getByRole("link", { name: "Choose Basic" })).toHaveAttribute("href", billingPath(team.slug));
    await expect(planCard(owner.page, "Professional").getByRole("link")).toHaveAccessibleName("Choose Professional");
    await expect(owner.page.getByRole("main").getByText("Free", { exact: true })).toHaveCount(0);
    await expectNoAxeViolations(owner.page);
    await owner.context.close();

    const administrator = await read(admin.user);
    await expect(planCard(administrator.page, "Basic").getByRole("link", { name: "Choose Basic" })).toHaveAttribute("href", billingPath(team.slug));
    await administrator.context.close();

    const plain = await read(member.user);
    await expect(planCards(plain.page).getByRole("link")).toHaveCount(0);
    await expect(plain.page.getByText("The owner or an admin of your organisation manages its plan.")).toBeVisible();
    await plain.context.close();

    const candidate = await read(worker);
    await expect(candidate.page.getByRole("main").getByRole("link", { name: /Sign up|Choose/ })).toHaveCount(0);
    await expect(candidate.page.getByText("Plans are for employers. Workers never pay.")).toBeVisible();
    await candidate.context.close();

    const setup = await read(unfinished);
    await expect(planCards(setup.page).getByRole("link")).toHaveCount(0);
    await expect(setup.page.getByRole("link", { name: "Continue setting up" })).toHaveAttribute("href", "/en/onboarding");
    await setup.context.close();
  });

  test("an owner of an organisation on a plan that is not public still sees the public plans only", async ({ page }) => {
    const team = await newTeam(uniqueName("Lapsed Pricing"));
    execute(`
      insert into billing.subscriptions (organization_id, plan_code, status, provider)
      values (${literal(team.id)}, 'employer_enterprise', 'active', 'null')
    `);
    await logIn(page, team.owner);
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    await page.goto("/en/pricing");

    await expect(planCards(page).getByRole("heading")).toHaveText(["Basic", "Professional"]);
    await expect(page.getByRole("main").getByText("Enterprise")).toHaveCount(0);
  });
});
