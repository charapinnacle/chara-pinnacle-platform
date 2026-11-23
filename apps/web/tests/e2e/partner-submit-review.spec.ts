import type { Page } from "@playwright/test";
import { callAs } from "./support/accounts";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { enrollTotp, sessionClaims } from "./support/login";
import { logIn } from "./support/login-page";
import { beginSetup, enterCode } from "./support/mfa";
import { currentStep, onboardingSteps } from "./support/onboarding";
import { organizationAudit } from "./support/organizations";
import {
  createCommittedPartner,
  openPartnerOnboarding,
  partnerWithCompany,
  setPartnerRelease,
  type PartnerType,
} from "./support/partners";
import { signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";
import type { TestUser } from "./support/test-user";

const COMMITMENT = "We charge workers no recruitment fees or related costs";
const WAITING = "Your company is waiting for review";
const CHECKS = ["Your company name and registration number", "Your website", "The licences you declare"];

type Partner = { user: TestUser; id: string; slug: string; type: PartnerType };

// A partner whose countries and offer are saved, so onboarding opens at Commitments; with accepted, the owner has
// accepted the commitment too.
async function partnerAtCommitments(type: PartnerType, { accepted = false } = {}): Promise<Partner> {
  const partner = await partnerWithCompany(type);
  await callAs(partner.user, "set_organization_geographies", { p_org: partner.id, p_sources_from: ["PH"], p_serves_market: ["DE"] });
  await callAs(partner.user, "set_organization_workforce_offer", {
    p_org: partner.id,
    p_occupations: ["7212"],
    p_industries: [],
    p_languages: [],
    p_recruitment_type: "international",
    p_service_types: type === "staffing_company" ? ["temporary"] : [],
  });
  if (accepted) await callAs(partner.user, "accept_employer_pays_commitment", { p_org: partner.id, p_version: 0 });
  return { ...partner, type };
}

async function addMember(partner: Partner, role: "admin" | "member"): Promise<TestUser> {
  const user = await createCommittedPartner(partner.type);
  execute(
    `insert into public.organization_members (organization_id, user_id, role, accepted_at)
     values (${literal(partner.id)}, ${literal(user.id)}, '${role}', now())`,
  );
  return user;
}

function reviewRow(organizationId: string) {
  const [row] = query<{ review_status: string; submitted: boolean; info_step: string | null }>(
    `select review_status::text, submitted_at is not null as submitted, info_step
     from public.organizations where id = ${literal(organizationId)}`,
  );
  return row;
}

function submissionAudits(organizationId: string) {
  return organizationAudit(organizationId).filter(({ action }) => action === "partner.submitted_for_review");
}

async function expectChecks(page: Page): Promise<void> {
  const list = page.getByRole("region", { name: "What our team checks" }).getByRole("listitem");
  await expect(list).toHaveText(CHECKS);
}

// Tabs from the top of the page until the link has the focus: it is reachable by keyboard.
async function tabTo(page: Page, name: string): Promise<void> {
  await page.locator("body").focus();
  for (let step = 0; step < 60; step++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    if (focused.startsWith(name)) return;
  }
  throw new Error(`${name} cannot be reached with the Tab key`);
}

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// other partner specs (playwright.config.ts), and the tests run one after the other.
test.describe("submission for review (FR-J1 AC8 to AC11)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("AC8, AC10, AC11: the owner resumes at Commitments, sets up two-step verification, submits and waits for review", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const { user, id, slug } = await partnerAtCommitments("recruitment_company");
    await openPartnerOnboarding(page, user);

    // AC8: onboarding opens at the first step not done, the completed ones announced as done.
    await expect(page.getByRole("heading", { name: "Commitments", exact: true, level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 4 of 6: Commitments");
    const steps = onboardingSteps(page).getByRole("listitem");
    await expect(steps).toHaveText([
      "Step 1 of 6: Company (done)Name, country and registration",
      "Step 2 of 6: Where you serve (done)The countries you work with",
      "Step 3 of 6: What you offer (done)Occupations and how you recruit",
      "4Step 4 of 6: CommitmentsThe employer-pays commitment",
      "5Step 5 of 6: SecurityTwo-step verification",
      "6Step 6 of 6: ReadySubmit for review",
    ]);
    // The address of Ready leads to the first step not done.
    await page.goto("/en/onboarding?step=ready");
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Commitments", exact: true, level: 1 })).toBeVisible();
    // Back to Where you serve, with the saved countries.
    await page.getByRole("link", { name: "Change where you serve" }).click();
    await expect(page.getByRole("heading", { name: "Where you serve", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Philippines" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Germany" })).toBeVisible();
    await page.goto("/en/onboarding");

    const box = page.getByRole("checkbox", { name: COMMITMENT, exact: true });
    await box.focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Accept and continue" }).click();

    // Security: the Phase 1 enrolment, as a step of partner onboarding.
    await expect(page.getByRole("heading", { name: "Secure your account", level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 5 of 6: Security");
    await expect(page.getByText(/^As the owner of Manila Skills .+ you will manage its team, billing, job orders and candidates/)).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterCode(page, await beginSetup(page));

    // Ready.
    await expect(page.getByRole("heading", { name: "Submit your company for review", level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    expect((await sessionClaims(page.context())).aal).toBe("aal2");
    await expect(currentStep(page)).toContainText("Step 6 of 6: Ready");
    await expect(page.getByText(/A review usually takes one working day\.$/)).toBeVisible();
    await expectChecks(page);
    await expect(page.getByRole("link", { name: "Add your licences" })).toHaveAttribute(
      "href",
      /\/en\/org\/[^/]+\/workforce-profile#licences-heading$/,
    );
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(reviewRow(id)).toEqual({ review_status: "onboarding", submitted: false, info_step: null });

    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("heading", { name: WAITING, level: 1 })).toBeVisible();
    await expect(page.getByText(/^Our team is reviewing Manila Skills .+\. A review usually takes one working day\./)).toBeVisible();
    await expectChecks(page);
    expect(reviewRow(id)).toEqual({ review_status: "pending_review", submitted: true, info_step: null });
    expect(submissionAudits(id)).toEqual([
      expect.objectContaining({ actor_id: user.id, metadata: { from: "onboarding", to: "pending_review", info_step: null } }),
    ]);
    await expect(page.getByRole("main")).not.toContainText(/approved|verified/i);
    await tabTo(page, "Complete your workforce profile");
    await expect(page.getByRole("link", { name: /^Complete your workforce profile/ })).toHaveAttribute(
      "href",
      `/en/org/${slug}/workforce-profile`,
    );
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // The dashboard of the company's type shows the pending state instead of sending the partner back to onboarding.
    await page.getByRole("link", { name: /^Go to your dashboard/ }).click();
    await expect(page).toHaveURL(new RegExp(`/en/dashboard/(recruitment|staffing)\\?org=${slug}$`));
    await expect(page.getByRole("heading", { name: WAITING, level: 2 })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(/approved|verified/i);
    await expectAccessibleAtBothWidths(page);

    // A reload of onboarding keeps the pending state; a repeated call writes nothing.
    await page.goto("/en/onboarding?step=where-you-serve");
    await expect(page.getByRole("heading", { name: WAITING, level: 1 })).toBeVisible();
    expect(submissionAudits(id)).toHaveLength(1);
  });

  test("AC9, AC10: Ready opens at aal1, the submission asks for the code first and names a missing field", async ({ page }) => {
    test.setTimeout(120_000);
    const { user, id } = await partnerAtCommitments("staffing_company", { accepted: true });
    const secret = await enrollTotp(user);
    await openPartnerOnboarding(page, user);
    await expect(page.getByRole("heading", { name: "Submit your company for review", level: 1 })).toBeVisible();
    expect((await sessionClaims(page.context())).aal).toBe("aal1");

    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/onboarding?step=ready")}`);
    await enterCode(page, secret);
    await expect(page).toHaveURL("/en/onboarding?step=ready");
    expect(reviewRow(id).review_status).toBe("onboarding");

    // The profile lost its staffing type meanwhile: the submission names what to complete, next to the button and in a toast.
    execute(`delete from public.organization_service_types where organization_id = ${literal(id)}`);
    await page.getByRole("button", { name: "Submit for review" }).click();
    const message = "Choose at least one staffing type, then submit again.";
    await expect(page.getByRole("alert").filter({ hasText: message }).first()).toBeVisible();
    await expect(page.getByText("Could not submit your company for review", { exact: true })).toBeVisible();
    expect(reviewRow(id).review_status).toBe("onboarding");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // Without the type the address of Ready leads back to What you offer.
    await page.goto("/en/onboarding?step=ready");
    await expect(page.getByRole("heading", { name: "What you offer", level: 1 })).toBeVisible();
    execute(
      `insert into public.organization_service_types (organization_id, service) values (${literal(id)}, 'temporary')`,
    );
    await page.goto("/en/onboarding?step=ready");
    await expect(page.getByText("A staffing company needs at least one current agency licence before it submits")).toBeVisible();
    // A staffing company names a current agency licence and lists available workers before review.
    await page.getByRole("button", { name: "Submit for review" }).click();
    const licenceMessage = "Add a current agency licence, such as a temporary agency work permit, then submit again.";
    await expect(page.getByRole("alert").filter({ hasText: licenceMessage }).first()).toBeVisible();
    execute(
      `insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until,
         confirmed_at, partner_terms_version)
       values (${literal(id)}, 'DE', 'Bundesagentur fuer Arbeit', 'AUEG-${id.slice(0, 8)}', current_date + 365, now(), 1)`,
    );
    await page.getByRole("button", { name: "Submit for review" }).click();
    const listingMessage = "List at least one group of workers you can supply, then submit again.";
    await expect(page.getByRole("alert").filter({ hasText: listingMessage }).first()).toBeVisible();
    execute(
      `insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity, available_from)
       values (${literal(id)}, '7212', 'PH', 40, 10, current_date)`,
    );
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("heading", { name: WAITING, level: 1 })).toBeVisible();
    expect(reviewRow(id)).toEqual({ review_status: "pending_review", submitted: true, info_step: null });
  });

  test("an admin sets up two-step verification too, a member is not asked and cannot submit", async ({ page }) => {
    test.setTimeout(120_000);
    const partner = await partnerAtCommitments("recruitment_company", { accepted: true });
    const admin = await addMember(partner, "admin");
    const member = await addMember(partner, "member");

    await openPartnerOnboarding(page, member);
    await expect(page.getByRole("heading", { name: "Submit your company for review", level: 1 })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /^The owner or an admin of Manila Skills .+ submits the company/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.context().clearCookies();

    await openPartnerOnboarding(page, admin);
    await expect(page.getByRole("heading", { name: "Secure your account", level: 1 })).toBeVisible();
    await expect(page.getByText(/^As an admin of Manila Skills/)).toBeVisible();
    await enterCode(page, await beginSetup(page));
    await expect(page.getByRole("heading", { name: "Submit your company for review", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("heading", { name: WAITING, level: 1 })).toBeVisible();
    expect(submissionAudits(partner.id)).toEqual([expect.objectContaining({ actor_id: admin.id })]);
  });

  test("FR-J4 AC7: after a request for information Ready names the step, which is reopened, and the partner resubmits", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const partner = await partnerAtCommitments("recruitment_company", { accepted: true });
    const secret = await enrollTotp(partner.user);
    execute(
      `update public.organizations set review_status = 'info_requested', info_step = 'company', submitted_at = now(),
         listed_at = now() - interval '30 days'
       where id = ${literal(partner.id)}`,
    );
    await signInAtAal2(page, partner.user, secret, "/en/onboarding?step=company");

    await expect(page.getByRole("heading", { name: "Your company details", level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 1 of 6: Company");
    await expect(page.getByLabel("Legal company name")).toHaveValue(/^Manila Skills .+ Inc\.$/);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("Website (optional)").fill("https://manila-skills.example");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to Ready" }).click();

    await expect(page.getByRole("heading", { name: "Submit your company again", level: 1 })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Our team asked for more information about your company details." })).toBeVisible();
    await expect(onboardingSteps(page).getByRole("listitem").first()).toHaveText("1Step 1 of 6: Company (more information requested)More information requested");
    await expect(page.getByRole("link", { name: "Change your company details" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Change your company details" })).toHaveAttribute("href", "/en/onboarding?step=company");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // The resubmission waits for the confirmation that the reopened step was updated or needs no change.
    await page.getByRole("button", { name: "Submit again for review" }).click();
    const confirmation = page.getByRole("checkbox", {
      name: "I have updated what our team asked about, or checked that nothing needs to change.",
    });
    await expect(page.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText(
      "Confirm that you have updated what our team asked about, or that nothing needs to change.",
    );
    expect(reviewRow(partner.id).review_status).toBe("info_requested");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await confirmation.check();
    await page.getByRole("button", { name: "Submit again for review" }).click();
    await expect(page.getByRole("heading", { name: WAITING, level: 1 })).toBeVisible();
    // Listed before, so it returns to re-review; the reopened step is answered.
    expect(reviewRow(partner.id)).toEqual({ review_status: "re_review", submitted: true, info_step: null });
    expect(submissionAudits(partner.id).map(({ metadata }) => metadata)).toEqual([
      { from: "info_requested", to: "re_review", info_step: "company" },
    ]);
  });

  test("FR-J1, FR-J4 AC9: a listed partner's owner edits the company details; only the identifier returns it to review", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const partner = await partnerAtCommitments("staffing_company", { accepted: true });
    const secret = await enrollTotp(partner.user);
    execute(
      `update public.organizations set review_status = 'listed', submitted_at = now() - interval '31 days',
         listed_at = now() - interval '30 days'
       where id = ${literal(partner.id)}`,
    );
    await signInAtAal2(page, partner.user, secret, `/en/org/${partner.slug}/profile`);
    await page.goto("/en/onboarding?step=company");
    await expect(page).toHaveURL(`/en/org/${partner.slug}/profile`);
    await expect(page.getByRole("heading", { name: "Company profile", level: 1 })).toBeVisible();
    await expect(page.getByText("Changing the legal name or the company identifier sends")).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByLabel("Display name (optional)").fill(`Manila Staffing ${partner.slug}`);
    await page.getByLabel("Website (optional)").fill("https://manila-staffing.example");
    await page.getByLabel(/^About your company/).fill("We supply welders and pipe fitters to employers in Germany and Poland.");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();
    expect(reviewRow(partner.id).review_status, "the display name, website and description keep it listed").toBe("listed");

    await page.getByLabel("Company registration number or VAT number").fill(`MSX${partner.id.slice(0, 8)}`);
    await page.getByRole("button", { name: "Save identifier" }).click();
    await expect(page.getByText("Identifier saved", { exact: true })).toBeVisible();
    expect(reviewRow(partner.id).review_status, "a new identifier returns it to review").toBe("re_review");
    expect(organizationAudit(partner.id).filter(({ action }) => action === "partner.returned_to_review").map(({ metadata }) => metadata)).toEqual([
      { fields: ["legal_entity_identifier"] },
    ]);

    await page.goto(`/en/dashboard/staffing`);
    await expect(page.getByRole("link", { name: "Company profile" })).toHaveAttribute("href", `/en/org/${partner.slug}/profile`);
  });

  test("the release switch closes Ready, the submission and the pending dashboard", async ({ page }) => {
    test.setTimeout(90_000);
    const partner = await partnerAtCommitments("recruitment_company", { accepted: true });
    execute(`update public.organizations set review_status = 'pending_review', submitted_at = now() where id = ${literal(partner.id)}`);
    setPartnerRelease(false);
    try {
      await logIn(page, partner.user);
      await page.waitForURL((url) => !url.pathname.endsWith("/login"));
      await page.goto("/en/dashboard/employer");
      await expect(page).toHaveURL(/\/en\/onboarding$/);
      await expect(page.getByRole("heading", { name: "Next: Where you serve", level: 1 })).toBeVisible();
      await expect(page.getByText(WAITING)).toHaveCount(0);
      await expect(callAs(partner.user, "submit_partner_for_review", { p_org: partner.id })).rejects.toThrow(/CHARA_FORBIDDEN/);
    } finally {
      setPartnerRelease(true);
    }
  });
});
