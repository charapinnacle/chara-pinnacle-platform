import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { env } from "@/lib/env";
import { callAs } from "./support/accounts";
import { signInStaff } from "./support/admin";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { createCommittedUser, enrollTotp } from "./support/login";
import { logIn } from "./support/login-page";
import { createCommittedPartner, partnerWithCompany, pickWithKeys, setPartnerRelease } from "./support/partners";
import { newVisitor, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";
import { createTestUser, type TestUser } from "./support/test-user";

type Partner = { user: TestUser; id: string; slug: string; legalName: string; displayName: string; identifier: string };

const QUEUE = "/en/admin/partners";
const FORBIDDEN_WORDS = /approved|verified/i;

// A recruitment company with a complete profile, waiting in the queue since the time given (long ago, so that it comes
// before the partners other specs leave in the queue).
async function submittedPartner(submittedAt: string): Promise<Partner> {
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
  await callAs(user, "accept_employer_pays_commitment", { p_org: id, p_version: 0 });
  execute(
    `update public.organizations set review_status = 'pending_review', submitted_at = ${literal(submittedAt)},
       website = 'https://' || slug || '.example'
     where id = ${literal(id)}`,
  );
  const [row] = query<{ legal_name: string; display_name: string; legal_entity_identifier: string }>(
    `select legal_name, display_name, legal_entity_identifier from public.organizations where id = ${literal(id)}`,
  );
  return { user, id, slug, legalName: row.legal_name, displayName: row.display_name, identifier: row.legal_entity_identifier };
}

function reviewState(organizationId: string) {
  const [row] = query<{ review_status: string; listed: boolean; info_step: string | null }>(
    `select review_status::text, listed_at is not null as listed, info_step from public.organizations where id = ${literal(organizationId)}`,
  );
  return row;
}

function decisions(organizationId: string) {
  return query<{ decision: string; reason: string; info_step: string | null; decided_by: string }>(
    `select decision, reason, info_step, decided_by from public.partner_review_decisions
     where organization_id = ${literal(organizationId)} order by id`,
  );
}

function decisionAudits(organizationId: string) {
  return query<{ actor_id: string; decision: string; reason: string }>(
    `select actor_id, metadata ->> 'decision' as decision, metadata ->> 'reason' as reason from audit.log
     where action = 'partner.review_decided' and entity_id = ${literal(organizationId)} order by id`,
  );
}

// A licence whose evidence file is in the bucket and scanned clean, as after the upload of FR-J2.
async function licenceWithEvidence(organizationId: string): Promise<string> {
  const id = randomUUID();
  const path = `${organizationId}/${id}/${randomUUID()}`;
  const head = Buffer.from("%PDF-1.7\n");
  const bytes = Buffer.concat([head, Buffer.alloc(4096 - head.length, 0x20)]);
  execute(
    `insert into public.partner_licences (id, organization_id, country_code, issuing_authority, licence_number, valid_until,
       confirmed_at, partner_terms_version, evidence_path, evidence_mime, evidence_size_bytes, evidence_scan_status,
       evidence_requested_at)
     values (${literal(id)}, ${literal(organizationId)}, 'PH', 'Department of Migrant Workers', 'DMW-123-LB-031522-R',
       current_date + 400, now(), 1, ${literal(path)}, 'application/pdf', ${bytes.length}, 'pending', now())`,
  );
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/partner-documents/${path}`, {
    method: "POST",
    headers: { apikey: process.env.E2E_AUTH_ADMIN_KEY ?? "", "content-type": "application/pdf" },
    body: new Uint8Array(bytes),
  });
  if (!response.ok) throw new Error(`Storage answered ${response.status}`);
  execute(`update public.partner_licences set evidence_scan_status = 'clean' where id = ${literal(id)}`);
  return id;
}

const queueTable = (page: Page) => page.getByRole("region", { name: "Partners to review" });

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// other partner specs (playwright.config.ts), and the tests run one after the other.
test.describe("Partner reviews (FR-J4)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("AC1, AC2, AC3, AC10, AC11: Trust & Safety work the queue, open the evidence and decide; the partners read the outcome", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const first = await submittedPartner("2001-01-01T09:00:00Z");
    const second = await submittedPartner("2001-01-01T10:00:00Z");
    const third = await submittedPartner("2001-01-01T11:00:00Z");
    const onboarding = await partnerWithCompany("recruitment_company");
    const [onboardingName] = query<{ legal_name: string }>(
      `select legal_name from public.organizations where id = ${literal(onboarding.id)}`,
    );
    // A staff-only link: an employer that names the same identifier, and a member whose address must not be shown.
    const employerOwner = await createCommittedUser("company");
    execute(
      `with created as (
         insert into public.organizations (type, slug, legal_name, display_name, based_in_country, legal_entity_identifier,
           legal_entity_identifier_kind)
         values ('employer', ${literal(`linked-${first.slug}`)}, ${literal(`Linked Employer of ${first.displayName}`)}, 'Linked Employer', 'DE',
           ${literal(first.identifier)}, 'registration_number')
         returning id
       )
       insert into public.organization_members (organization_id, user_id, role, accepted_at)
       select id, ${literal(employerOwner.id)}, 'owner', now() from created`,
    );
    const member = await createCommittedPartner("recruitment_company");
    execute(
      `insert into public.organization_members (organization_id, user_id, role, accepted_at)
       values (${literal(first.id)}, ${literal(member.id)}, 'member', now())`,
    );
    const licenceId = await licenceWithEvidence(first.id);
    execute(
      `insert into public.partner_licences (organization_id, country_code, issuing_authority, licence_number, valid_until,
         confirmed_at, partner_terms_version)
       values (${literal(first.id)}, 'DE', 'Bundesagentur fur Arbeit', 'BA-2024-1', current_date + 200, now(), 1)`,
    );

    // AC1: the queue, oldest first, with the flag of the shared identifier; the onboarding partner is absent.
    const { user: trust } = await signInStaff(page, "trust_safety", QUEUE);
    await expect(page.getByRole("heading", { name: "Partners to review", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Partner reviews" })).toBeVisible();
    const text = await queueTable(page).innerText();
    const order = [first, second, third].map((partner) => text.indexOf(partner.legalName));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).not.toContain(onboardingName.legal_name);
    const firstRow = queueTable(page).getByRole("row").filter({ hasText: first.legalName });
    await expect(firstRow).toContainText("Same identifier as another company");
    await expect(firstRow).toContainText("Recruitment company");
    await expect(firstRow).toContainText("Philippines");
    await expect(firstRow).toContainText(first.identifier);
    await expect(firstRow).toContainText(`https://${first.slug}.example`);
    await expect(firstRow).toContainText("Overdue");
    await expect(queueTable(page).getByRole("row").filter({ hasText: second.legalName })).not.toContainText("Same identifier");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // AC2: the review page shows what staff check, and nothing about members but the owner's address.
    await firstRow.getByRole("link", { name: first.legalName }).click();
    await expect(page.getByRole("heading", { name: first.displayName, level: 1 })).toBeVisible();
    const company = page.locator("section#company");
    await expect(company).toContainText(first.legalName);
    await expect(company).toContainText(first.identifier);
    await expect(company).toContainText("Company registration number");
    await expect(company).toContainText(first.user.email);
    const website = company.getByRole("link", { name: new RegExp(`https://${first.slug}.example`) });
    await expect(website).toHaveAttribute("target", "_blank");
    await expect(website).toHaveAttribute("rel", "noopener noreferrer");
    const workforce = page.locator("section#workforce");
    await expect(workforce).toContainText("Philippines");
    await expect(workforce).toContainText("Germany");
    await expect(workforce).toContainText("Welders and flame cutters");
    await expect(page.locator("section#identifier-links")).toContainText(`Linked Employer of ${first.displayName}`);
    await expect(page.locator("section#identifier-links")).toContainText("Employer");
    const licences = page.getByRole("region", { name: "Licences" }).getByRole("row");
    await expect(licences).toHaveCount(3);
    for (const check of ["Legal entity matches public register", "Website belongs to the company", "Licences reviewed"]) {
      await expect(page.getByRole("checkbox", { name: check })).toBeVisible();
    }
    await expect(page.locator("section#commitment")).toContainText("The owner has accepted the current version");
    expect(await page.locator("main").innerText()).not.toContain(member.email);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // The evidence opens through the staff broker and the opening is logged with the role.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Open evidence for Philippines" }).click();
    expect((await download).suggestedFilename()).toBe("licence-ph.pdf");
    expect(
      query<{ accessed_by: string; staff_role: string; purpose: string }>(
        `select accessed_by, staff_role, purpose from audit.partner_document_access_log where licence_id = ${literal(licenceId)}`,
      ),
    ).toEqual([{ accessed_by: trust.id, staff_role: "trust_safety", purpose: "partner_review" }]);

    // AC3: approve with a reason; the reviewer lands on the queue with focus on the next partner.
    await page.getByRole("button", { name: "Approve and list" }).click();
    const approve = page.getByRole("dialog", { name: "List partner" });
    await approve.getByLabel("Reason").fill("Registry entry and website match");
    await expect(approve.getByText("32 of 2000 characters")).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await approve.getByRole("button", { name: "List partner" }).click();
    await expect(page).toHaveURL(`${QUEUE}?decided=1`);
    await expect(page.getByRole("status").filter({ hasText: "The decision is saved." })).toBeVisible();
    await expect(page.getByRole("link", { name: second.legalName })).toBeFocused();
    expect(reviewState(first.id)).toEqual({ review_status: "listed", listed: true, info_step: null });
    expect(decisions(first.id)).toEqual([
      { decision: "approve", reason: "Registry entry and website match", info_step: null, decided_by: trust.id },
    ]);
    expect(decisionAudits(first.id)).toEqual([{ actor_id: trust.id, decision: "approve", reason: "Registry entry and website match" }]);

    // AC11: decline by keyboard: the empty reason is an error with focus on the field, a failed call keeps the text and
    // shows a toast, and after success focus is on the next partner of the queue.
    await page.getByRole("link", { name: second.legalName }).press("Enter");
    await expect(page.getByRole("heading", { name: second.displayName, level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Decline", exact: true }).focus();
    await page.keyboard.press("Enter");
    const decline = page.getByRole("dialog", { name: "Decline partner" });
    await expect(decline).toBeVisible();
    await decline.getByRole("button", { name: "Decline partner" }).focus();
    await page.keyboard.press("Enter");
    await expect(decline.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText("Give a reason of at least 10 characters");
    await expect(decline.getByLabel("Reason")).toBeFocused();
    const reason = "The registry has no company with this registration number.";
    await page.keyboard.type(reason);
    await expect(decline.getByText(`${reason.length} of 2000 characters`)).toBeVisible();
    execute("revoke execute on function public.admin_decide_partner(uuid, text, text, text) from authenticated");
    try {
      await decline.getByRole("button", { name: "Decline partner" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("The decision was not saved", { exact: true })).toBeVisible();
      await expect(decline.getByLabel("Reason")).toHaveValue(reason);
      expect(reviewState(second.id).review_status).toBe("pending_review");
    } finally {
      execute("grant execute on function public.admin_decide_partner(uuid, text, text, text) to authenticated");
    }
    await decline.getByRole("button", { name: "Decline partner" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${QUEUE}?decided=1`);
    await expect(page.getByRole("link", { name: third.legalName })).toBeFocused();
    expect(reviewState(second.id)).toEqual({ review_status: "declined", listed: false, info_step: null });

    // Request information about the countries.
    await page.getByRole("link", { name: third.legalName }).click();
    await page.getByRole("button", { name: "Request information" }).click();
    const request = page.getByRole("dialog", { name: "Request information" });
    await request.getByRole("button", { name: "Send request" }).click();
    await expect(request.getByRole("alert").filter({ hasText: "There is a problem" })).toContainText("Choose the step to reopen");
    await expect(request.getByLabel("Step to reopen").getByRole("option")).toHaveText([
      "Choose a step",
      "Company details",
      "Where you serve and what you offer",
      "Employer-pays commitment",
      "Licences",
    ]);
    await request.getByLabel("Step to reopen").selectOption("where_you_serve");
    await request.getByLabel("Message to the company").fill("Please add every country you source workers from.");
    await request.getByRole("button", { name: "Send request" }).click();
    await expect(page).toHaveURL(`${QUEUE}?decided=1`);
    expect(reviewState(third.id)).toEqual({ review_status: "info_requested", listed: false, info_step: "where_you_serve" });

    // AC10 and NFR-C7: each owner reads the outcome on the dashboard, never as approved or verified.
    const owner = await newVisitor(browser);
    await logIn(owner.page, first.user, "/en/dashboard/employer");
    await expect(owner.page.getByRole("heading", { name: "Your company is listed", level: 2 })).toBeVisible();
    await expect(owner.page.getByRole("link", { name: "Complete your workforce profile" })).toHaveAttribute(
      "href",
      `/en/org/${first.slug}/workforce-profile`,
    );
    expect(await owner.page.locator("main").innerText()).not.toMatch(FORBIDDEN_WORDS);
    expect(await owner.page.locator("main").innerText()).not.toContain("Registry entry and website match");
    await expectAccessibleAtBothWidths(owner.page);
    await owner.context.close();

    const declined = await newVisitor(browser);
    await logIn(declined.page, second.user, "/en/dashboard/employer");
    await expect(declined.page.getByRole("heading", { name: "Your company is not listed", level: 2 })).toBeVisible();
    await expect(declined.page.getByText(reason)).toBeVisible();
    // NFR-C7: the decline names the same redress route as its email.
    await expect(declined.page.getByRole("link", { name: "How to appeal this decision" })).toHaveAttribute(
      "href",
      "/en/legal/complaints-and-dispute-process",
    );
    expect(await declined.page.locator("main").innerText()).not.toContain(trust.email);
    await expectAccessibleAtBothWidths(declined.page);
    await declined.context.close();

    const asked = await newVisitor(browser);
    await logIn(asked.page, third.user, "/en/dashboard/employer");
    await expect(asked.page.getByRole("heading", { name: "Our team asked for more information", level: 2 })).toBeVisible();
    await expect(asked.page.getByText("Please add every country you source workers from.")).toBeVisible();
    await asked.context.close();
  });

  test("AC7: the owner follows the request for information, changes the step and resubmits to the end of the queue", async ({ page }) => {
    test.setTimeout(150_000);
    const partner = await submittedPartner("2002-01-01T09:00:00Z");
    const staff = await createTestUser("company");
    execute(`insert into public.platform_staff (user_id, role) values (${literal(staff.id)}, 'trust_safety')`);
    execute(
      `update public.organizations set review_status = 'info_requested', info_step = 'where_you_serve' where id = ${literal(partner.id)};
       insert into public.partner_review_decisions (organization_id, decision, reason, info_step, from_status, to_status,
         submitted_at, decided_by)
       values (${literal(partner.id)}, 'request_info', 'Please add Nepal if you source workers there.', 'where_you_serve',
         'pending_review', 'info_requested', '2002-01-01T09:00:00Z', ${literal(staff.id)})`,
    );
    const secret = await enrollTotp(partner.user);
    // The company step asks for the code, so the session is at aal2 when Ready submits.
    await signInAtAal2(page, partner.user, secret, "/en/onboarding?step=company");
    await page.goto("/en/onboarding");

    await expect(page.getByRole("heading", { name: "Submit your company again", level: 1 })).toBeVisible();
    const banner = page.getByRole("status").filter({ hasText: "Our team asked for more information" });
    await expect(banner).toContainText("Please add Nepal if you source workers there.");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await banner.getByRole("link", { name: "Change where you serve" }).click();
    await expect(page.getByRole("heading", { name: "Where you serve", level: 1 })).toBeVisible();
    await pickWithKeys(page, "Where do you source workers from?", "nep", "Nepal");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Submit your company again", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Submit again for review" }).click();
    await expect(page.getByRole("heading", { name: "Your company is waiting for review", level: 1 })).toBeVisible();
    const [row] = query<{ review_status: string; fresh: boolean; info_step: string | null; last: boolean }>(
      `select review_status::text, submitted_at > now() - interval '5 minutes' as fresh, info_step,
         id = (select id from public.organizations where review_status in ('pending_review', 're_review')
               order by submitted_at desc, id desc limit 1) as last
       from public.organizations where id = ${literal(partner.id)}`,
    );
    expect(row).toEqual({ review_status: "pending_review", fresh: true, info_step: null, last: true });
    expect(
      query<{ country_code: string }>(
        `select country_code from public.organization_geographies where organization_id = ${literal(partner.id)} and scope = 'sources_from' order by 1`,
      ),
    ).toEqual([{ country_code: "NP" }, { country_code: "PH" }]);
  });

  test("a Verification Reviewer reads the queue and the review page without the decision; other accounts get not found", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const partner = await submittedPartner("2003-01-01T09:00:00Z");
    await signInStaff(page, "verification_reviewer", `${QUEUE}/${partner.id}`);
    await expect(page.getByRole("heading", { name: partner.displayName, level: 1 })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Read only. Trust & Safety decides on partners." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve and list" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Partner reviews" })).toBeVisible();

    const outsider = await newVisitor(browser);
    await logIn(outsider.page, partner.user, "/en/dashboard/employer");
    await outsider.page.waitForURL((url) => !url.pathname.endsWith("/login"));
    const response = await outsider.page.goto(QUEUE);
    expect(response?.status()).toBe(404);
    await outsider.context.close();

    setPartnerRelease(false);
    try {
      const closed = await page.goto(QUEUE);
      expect(closed?.status()).toBe(404);
      await page.goto("/en/admin");
      await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Partner reviews" })).toHaveCount(0);
    } finally {
      setPartnerRelease(true);
    }
  });
});
