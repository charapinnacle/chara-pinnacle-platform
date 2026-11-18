import { signInStaff } from "./support/admin";
import { confirmFromLink, userByEmail } from "./support/accounts";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { extractLinks, waitForMessage } from "./support/mailpit";
import { beginSetup, enterCode } from "./support/mfa";
import { currentStep } from "./support/onboarding";
import { notificationsOf } from "./support/notify";
import { uniqueToken } from "./support/organizations";
import { fillPartnerCompany, fillPartnerSignup, pickWithKeys, setPartnerRelease } from "./support/partners";
import { newVisitor } from "./support/team";
import { expect, test } from "./support/test";

const OCCUPATIONS = "Which occupations do you recruit or supply?";
const COMMITMENT = "We charge workers no recruitment fees or related costs";
const FORBIDDEN_WORDS = /\b(approved|verified)\b/i;

function organizationOf(userId: string) {
  const [row] = query<{ id: string; slug: string; review_status: string; listed: boolean }>(
    `select o.id, o.slug, o.review_status::text, o.listed_at is not null as listed
     from public.organizations o join public.organization_members m on m.organization_id = o.id
     where m.user_id = ${literal(userId)}`,
  );
  return row;
}

// NFR-O4 (V78): the release 2a journey from partner sign-up to the public profile, walked through the real pages with no
// shortcut in the database: a recruitment company signs up and confirms its address from the email, onboards, accepts
// its documents and the employer-pays commitment, completes its workforce profile with a licence and a listing and
// submits; a Verification Reviewer reads the review and Trust & Safety list it; then a visitor finds it in Find Partners
// and opens its profile. The release switch is set for the whole database while this file runs, so it is a project of its
// own at the end of the release 2a chain (playwright.config.ts).
test.describe("release 2a journey (NFR-O4)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("a recruitment company signs up, is listed after review and appears in Find Partners and on its profile", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const email = `e2e-journey-${uniqueToken()}@example.test`;
    const token = uniqueToken();
    const legalName = `Journey Recruitment ${token} Inc.`;
    const displayName = `Journey Skills ${token}`;

    // Sign-up with the four partner documents, and the address confirmed from the email of the local mail catcher.
    await page.goto("/en/signup");
    await waitForHydration(page.getByRole("button", { name: "Create account" }));
    await fillPartnerSignup(page, "recruitment_company", email);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/en\/verify-email$/);
    const [user] = userByEmail(email);
    const message = await waitForMessage(email, { timeoutMs: 60_000 });
    const link = extractLinks(message).find((url) => url.includes("/en/confirm-email?token_hash="));
    if (!link) throw new Error("The confirmation email has no link");
    const { pathname, search } = new URL(link);
    await confirmFromLink(page, `${pathname}${search}`);

    // Company.
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(currentStep(page)).toContainText("Step 1 of 5: Company");
    await fillPartnerCompany(page, {
      legalName,
      displayName,
      identifier: `JR ${token}`,
      description: "We place welders and electricians with employers in Iceland and Germany.",
    });
    await page.getByRole("button", { name: "Continue" }).click();

    // Where you serve, then What you offer.
    await expect(page.getByRole("heading", { name: "Where you serve", level: 1 })).toBeVisible();
    await pickWithKeys(page, "Where do you source workers from?", "phil", "Philippines");
    await pickWithKeys(page, "Where do you recruit for?", "icel", "Iceland");
    await pickWithKeys(page, "Where do you recruit for?", "ger", "Germany");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "What you offer", level: 1 })).toBeVisible();
    await pickWithKeys(page, OCCUPATIONS, "weld", "7212 · Welders and flame cutters");
    await pickWithKeys(page, OCCUPATIONS, "electricians", "7411 · Building and related electricians");
    await pickWithKeys(page, "Which languages do your candidates speak? (optional)", "engl", "English");
    await page.getByRole("radiogroup", { name: "Recruitment type" }).getByRole("radio", { name: "International" }).check();
    await page.getByRole("button", { name: "Continue" }).click();

    // Commitments: the employer-pays commitment, accepted by the owner.
    await expect(page.getByRole("heading", { name: "Commitments", exact: true, level: 1 })).toBeVisible();
    await page.getByRole("checkbox", { name: COMMITMENT, exact: true }).check();
    await page.getByRole("button", { name: "Accept and continue" }).click();

    // Security: two-step verification, so the session reaches aal2 for the workforce profile and the submission.
    await expect(page.getByRole("heading", { name: "Secure your account", level: 1 })).toBeVisible();
    await enterCode(page, await beginSetup(page));
    await expect(page.getByRole("heading", { name: "Submit your company for review", level: 1 })).toBeVisible();
    const organization = organizationOf(user.id);
    expect(organization.review_status).toBe("onboarding");

    // The workforce profile: a licence and an availability listing before the submission.
    await page.goto(`/en/org/${organization.slug}/workforce-profile`);
    const licences = page.getByRole("region", { name: "Licences" });
    await licences.getByRole("button", { name: "Add a licence" }).click();
    const licence = page.getByRole("dialog", { name: "Add a licence" });
    await pickWithKeys(page, "Country", "Philipp", "Philippines");
    await licence.getByLabel("Issuing authority").fill("Department of Migrant Workers");
    await licence.getByLabel("Licence or registration number").fill(`DMW-${token}`);
    await licence.getByLabel("Valid until").fill("2029-06-30");
    await licence.getByRole("checkbox", { name: "I confirm that this entry is accurate" }).check();
    await licence.getByRole("button", { name: "Save licence" }).click();
    await expect(page.getByText("Licence saved", { exact: true })).toBeVisible();
    await expect(licences.getByRole("listitem").filter({ hasText: "Philippines" })).toContainText(`DMW-${token}`);

    const availability = page.getByRole("region", { name: "Availability" });
    await availability.getByRole("button", { name: "Add a listing" }).click();
    const listing = page.getByRole("dialog", { name: "Add a listing" });
    await pickWithKeys(page, "Occupation", "Electric", "Building and related electricians");
    await pickWithKeys(page, "Source country", "Phil", "Philippines");
    await listing.getByLabel("Workers available now").fill("60");
    await listing.getByLabel("Monthly capacity").fill("15");
    await listing.getByLabel("Available from").fill(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
    await listing.getByRole("button", { name: "Save listing" }).click();
    await expect(page.getByText("Listing saved", { exact: true })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // Ready: the submission.
    await page.goto("/en/onboarding");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("heading", { name: "Your company is waiting for review", level: 1 })).toBeVisible();
    expect(organizationOf(user.id).review_status).toBe("pending_review");

    // Nothing public before the decision.
    const early = await newVisitor(browser);
    expect((await early.page.goto(`/en/partners/${organization.slug}`))?.status()).toBe(404);
    await early.context.close();

    // A Verification Reviewer reads the review page with the licence; the decision is not theirs.
    const reviewer = await newVisitor(browser);
    await signInStaff(reviewer.page, "verification_reviewer", `/en/admin/partners/${organization.id}`);
    await expect(reviewer.page.getByRole("heading", { name: displayName, level: 1 })).toBeVisible();
    await expect(reviewer.page.locator("section#company")).toContainText(legalName);
    await expect(reviewer.page.getByRole("region", { name: "Licences" })).toContainText(`DMW-${token}`);
    await expect(reviewer.page.locator("section#commitment")).toContainText("The owner has accepted the current version");
    await expect(reviewer.page.getByRole("button", { name: "Approve and list" })).toHaveCount(0);
    await reviewer.context.close();

    // Trust & Safety list the partner with a statement of reasons.
    const staff = await newVisitor(browser);
    const { user: trust } = await signInStaff(staff.page, "trust_safety", `/en/admin/partners/${organization.id}`);
    await staff.page.getByRole("button", { name: "Approve and list" }).click();
    const approve = staff.page.getByRole("dialog", { name: "List partner" });
    await approve.getByLabel("Reason").fill("Registry entry, website and licence match");
    await approve.getByRole("button", { name: "List partner" }).click();
    await expect(staff.page).toHaveURL("/en/admin/partners?decided=1");
    await staff.context.close();
    expect(organizationOf(user.id)).toMatchObject({ review_status: "listed", listed: true });
    expect(
      query<{ decided_by: string; reason: string }>(
        `select decided_by, reason from public.partner_review_decisions where organization_id = ${literal(organization.id)}`,
      ),
    ).toEqual([{ decided_by: trust.id, reason: "Registry entry, website and licence match" }]);
    expect(notificationsOf(user.id).map(({ kind }) => kind)).toContain("partner_approved");

    // The owner reads the outcome, never as approved or verified.
    await page.goto("/en/dashboard/employer");
    await expect(page.getByRole("heading", { name: "Your company is listed", level: 2 })).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(FORBIDDEN_WORDS);

    // A visitor finds the partner in Find Partners and opens its public profile.
    const visitor = await newVisitor(browser);
    await visitor.page.goto("/en/partners/recruitment");
    const destination = visitor.page.getByRole("combobox", { name: "Destination country" });
    await waitForHydration(destination);
    await destination.fill("Iceland");
    await visitor.page.getByRole("option", { name: "Iceland", exact: true }).click();
    await visitor.page.getByRole("combobox", { name: "Occupation", exact: true }).fill("electricians");
    await visitor.page.getByRole("option", { name: /^7411 · Building and related electricians$/ }).click();
    await visitor.page.getByRole("button", { name: "Search partners" }).click();
    await expect(visitor.page).toHaveURL("/en/partners/recruitment?destination=IS&occupation=7411");
    // The card is found by the token of this run's name; on a database that earlier runs left partners for Iceland and
    // 7411 in, it is followed through the next pages until it shows.
    const card = visitor.page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ has: visitor.page.getByRole("heading", { name: new RegExp(`\\b${token}$`), level: 2 }) });
    for (let pageNumber = 1; pageNumber < 10; pageNumber++) {
      await expect(visitor.page.getByRole("status").filter({ hasText: "shown" })).toBeVisible();
      if ((await card.count()) > 0) break;
      const before = visitor.page.url();
      await visitor.page.getByRole("link", { name: "Show more partners" }).click();
      await visitor.page.waitForURL((url) => url.toString() !== before);
    }
    await expect(card.getByRole("heading", { level: 2 })).toHaveText(displayName);
    await expect(card).toContainText("Based in Philippines");
    await expect(card).toContainText("Recruits for Germany, Iceland");
    await expect(card).toContainText("Matches: destination, occupation");
    await expectNoAxeViolations(visitor.page);
    expect(await visitor.page.content()).not.toContain(legalName);

    await card.getByRole("link", { name: displayName, exact: true }).click();
    await expect(visitor.page).toHaveURL(`/en/partners/${organization.slug}`);
    await expect(visitor.page.getByRole("heading", { level: 1 })).toHaveText(displayName);
    const where = visitor.page.getByRole("region", { name: "Where we serve" });
    await expect(where.getByRole("definition")).toHaveText(["Philippines", "Philippines", "Germany, Iceland"]);
    const capacity = visitor.page.getByRole("region", { name: "Workforce capacity" });
    await expect(capacity.getByRole("listitem"), "FR-K3 AC4: a visitor reads no listing").toHaveCount(0);
    await expect(capacity).toContainText("Sign in to see the workers available");
    await expect(capacity.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/en/login?next=${encodeURIComponent(`/en/partners/${organization.slug}`)}`,
    );
    await expect(visitor.page.getByRole("region", { name: "Languages" })).toContainText("English");
    const text = await visitor.page.locator("main").innerText();
    for (const secret of [legalName, `DMW-${token}`, email, "Registry entry"]) {
      expect(text.includes(secret), `"${secret}" leaked`).toBe(false);
    }
    expect(text).not.toMatch(FORBIDDEN_WORDS);
    await expectAccessibleAtBothWidths(visitor.page);
    await visitor.context.close();
  });
});
