import type { Page } from "@playwright/test";
import { callAs } from "./support/accounts";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { enrollTotp } from "./support/login";
import { logIn } from "./support/login-page";
import { extractLinks, waitForMessage } from "./support/mailpit";
import { runNotify } from "./support/notify";
import { createCommittedPartner, partnerWithCompany, setPartnerRelease } from "./support/partners";
import { newVisitor, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";
import { createTestUser, type TestUser } from "./support/test-user";

const SITE = "http://localhost:3100";
const FORBIDDEN_WORDS = /approved|verified/i;

type Partner = { user: TestUser; id: string; slug: string; displayName: string };

// A recruitment company with a profile (Philippines to Germany, welders), in the review state given.
async function partner(reviewStatus: "pending_review" | "listed"): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  await callAs(user, "set_organization_geographies", { p_org: id, p_sources_from: ["PH"], p_serves_market: ["DE"] });
  await callAs(user, "set_organization_workforce_offer", {
    p_org: id,
    p_occupations: ["7212"],
    p_industries: [],
    p_languages: [],
    p_recruitment_type: "international",
    p_service_types: [],
  });
  execute(
    `update public.organizations set review_status = ${literal(reviewStatus)}, submitted_at = now() - interval '1 day',
       listed_at = case when ${literal(reviewStatus)} = 'listed' then now() - interval '1 day' end
     where id = ${literal(id)}`,
  );
  const [row] = query<{ display_name: string }>(`select display_name from public.organizations where id = ${literal(id)}`);
  return { user, id, slug, displayName: row.display_name };
}

// admin_decide_partner as a Trust & Safety Administrator at aal2, through the database function the console calls.
function decide(staff: TestUser, organizationId: string, decision: string, reason: string, step: string | null = null): void {
  execute(
    `set role authenticated;
     select set_config('request.jwt.claims', '{"sub": "${staff.id}", "role": "authenticated", "aal": "aal2"}', false);
     select public.admin_decide_partner(${literal(organizationId)}, ${literal(decision)}, ${literal(reason)}, ${step ? literal(step) : "null"})`,
  );
}

function queued(kind: string, userIds: string[]): string[] {
  return query<{ user_id: string }>(
    `select user_id from public.notifications where kind = ${literal(kind)}
       and user_id in (${userIds.map(literal).join(", ")}) order by user_id`,
  ).map((row) => row.user_id);
}

const siteLinks = (mail: Parameters<typeof extractLinks>[0]) => extractLinks(mail).filter((link) => link.startsWith(SITE));
const bell = (page: Page) => page.getByRole("banner").getByRole("link", { name: /^Notifications/ });
const items = (page: Page) => page.getByRole("list", { name: "Notifications" }).getByRole("listitem");

// The release switch is set for the whole database and notify takes every queued message while this file runs, so it is a
// project of its own that follows the other partner specs (playwright.config.ts), and the tests run one after the other.
test.describe("Partner review, licence and availability notifications (FR-T1)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("FR-J4 AC6, FR-T1 AC1, AC8, AC9: each decision emails the owners and admins with one link; the in-app item opens its page", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const listed = await partner("pending_review");
    const asked = await partner("pending_review");
    const declined = await partner("pending_review");
    const admin = await createCommittedPartner("recruitment_company");
    const member = await createCommittedPartner("recruitment_company");
    execute(
      `insert into public.organization_members (organization_id, user_id, role, accepted_at)
       values (${literal(listed.id)}, ${literal(admin.id)}, 'admin', now()), (${literal(listed.id)}, ${literal(member.id)}, 'member', now())`,
    );
    const staff = await createTestUser("company");
    execute(`insert into public.platform_staff (user_id, role) values (${literal(staff.id)}, 'trust_safety')`);
    const askReason = "Please add every country you source workers from.";
    const declineReason = "The website does not belong to the company named.";

    decide(staff, listed.id, "approve", "Registry entry and website match");
    decide(staff, asked.id, "request_info", askReason, "where_you_serve");
    decide(staff, declined.id, "decline", declineReason);
    expect(queued("partner_approved", [listed.user.id, admin.id, member.id])).toEqual([listed.user.id, admin.id].sort());

    const run = await runNotify();
    expect(run.failed).toBe(0);

    for (const user of [listed.user, admin]) {
      const mail = await waitForMessage(user.email, { subject: `${listed.displayName} is now listed on Chara Pinnacle` });
      expect(siteLinks(mail)).toEqual([`${SITE}/en/dashboard/employer`]);
      expect(`${mail.Text}${mail.HTML}`).not.toMatch(FORBIDDEN_WORDS);
      expect(`${mail.Text}${mail.HTML}`).not.toContain(staff.email);
      expect(mail.Text).not.toContain("Registry entry and website match");
    }
    const askMail = await waitForMessage(asked.user.email, { subject: `Our team needs more information about ${asked.displayName}` });
    expect(askMail.Text).toContain(askReason);
    expect(siteLinks(askMail)).toEqual([`${SITE}/en/onboarding?step=where-you-serve`]);
    const declineMail = await waitForMessage(declined.user.email, { subject: `${declined.displayName} was not listed` });
    expect(declineMail.Text).toContain(declineReason);
    expect(siteLinks(declineMail)).toEqual([`${SITE}/en/dashboard/employer`]);
    expect(`${declineMail.Text}${askMail.Text}`).not.toContain(staff.email);

    await logIn(page, listed.user, "/en/notifications");
    await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
    await expect(items(page).first()).toContainText("Partner review");
    await expectAccessibleAtBothWidths(page);
    const item = items(page).first().getByRole("link", { name: `${listed.displayName} is now listed in the partner directories` });
    await waitForHydration(item);
    await item.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/en/dashboard/employer");
    await expect(page.getByRole("heading", { name: "Your company is listed", level: 2 })).toBeVisible();
    await expect(bell(page)).toHaveAccessibleName("Notifications");

    const askedVisitor = await newVisitor(browser);
    await logIn(askedVisitor.page, asked.user, "/en/notifications");
    const askItem = items(askedVisitor.page).first().getByRole("link", {
      name: "Our team needs more information about where you serve and what you offer",
    });
    await waitForHydration(askItem);
    await askItem.click();
    await expect(askedVisitor.page).toHaveURL("/en/onboarding?step=where-you-serve");
    await askedVisitor.context.close();
  });

  test("FR-J2 AC8, FR-K3 AC5: the daily jobs email the licence reminder and the confirmation reminder; the items open the sections", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const company = await partner("listed");
    execute(
      `insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until,
         confirmed_at, partner_terms_version)
       values (${literal(company.id)}, 'PH', 'Department of Migrant Workers', 'DMW-REMINDER-1', current_date + 10, now(), 1);
       insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
         available_from, confirmed_at)
       values (${literal(company.id)}, '7212', 'PH', 40, 10, current_date, now() - interval '40 days')`,
    );
    execute("select private.expire_partner_licences(); select private.mark_workforce_confirmations_due();");
    expect(queued("licence_expiring", [company.user.id])).toEqual([company.user.id]);
    expect(queued("listing_confirmation_due", [company.user.id])).toEqual([company.user.id]);

    const run = await runNotify();
    expect(run.failed).toBe(0);
    const licenceMail = await waitForMessage(company.user.email, { subject: "Your licence for Philippines expires on" });
    expect(siteLinks(licenceMail)).toEqual([`${SITE}/en/org/${company.slug}/workforce-profile#licences-heading`]);
    expect(licenceMail.Text).not.toContain("DMW-REMINDER-1");
    expect(`${licenceMail.Text}${licenceMail.HTML}`).not.toMatch(FORBIDDEN_WORDS);
    const listingMail = await waitForMessage(company.user.email, { subject: "Confirm your availability listings" });
    expect(listingMail.Text).toContain("Welders and flame cutters from Philippines");
    expect(siteLinks(listingMail)).toEqual([`${SITE}/en/org/${company.slug}/workforce-profile#availability-heading`]);

    execute("select private.expire_partner_licences(); select private.mark_workforce_confirmations_due();");
    expect(queued("licence_expiring", [company.user.id])).toHaveLength(1);
    expect(queued("listing_confirmation_due", [company.user.id])).toHaveLength(1);

    const secret = await enrollTotp(company.user);
    // The workforce profile asks an owner for the code, so the session is at aal2 when the items open it.
    await signInAtAal2(page, company.user, secret, `/en/org/${company.slug}/workforce-profile`);
    await page.goto("/en/notifications");
    await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread");
    await expectAccessibleAtBothWidths(page);
    const licenceItem = page.getByRole("link", { name: /^Your licence for Philippines expires on / });
    await waitForHydration(licenceItem);
    await licenceItem.click();
    await expect(page).toHaveURL(`/en/org/${company.slug}/workforce-profile#licences-heading`);
    await expect(page.getByRole("heading", { name: "Licences", level: 2 })).toBeVisible();

    await page.goto("/en/notifications");
    const listingItem = page.getByRole("link", { name: "1 availability listing needs confirming" });
    await waitForHydration(listingItem);
    await listingItem.click();
    await expect(page).toHaveURL(`/en/org/${company.slug}/workforce-profile#availability-heading`);
    await expect(page.getByRole("heading", { name: "Availability", level: 2 })).toBeVisible();
    await expect(bell(page)).toHaveAccessibleName("Notifications");

    // FR-T1 AC11: the partner kinds on the preferences page, the optional ones with a switch.
    await page.goto("/en/settings/notifications");
    const section = page.locator("#email-notifications");
    for (const label of ["Licence expiry reminders", "Expired licences", "Availability confirmation reminders"]) {
      await expect(section.getByRole("switch", { name: label })).toBeChecked();
    }
    for (const label of ["Company listed after review", "More information requested for the review", "Company not listed after review"]) {
      const row = section.getByRole("listitem").filter({ hasText: label });
      await expect(row).toContainText("Always sent");
      await expect(row.getByRole("switch")).toHaveCount(0);
    }
    await expectAccessibleAtBothWidths(page);
  });
});
