import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { displayName, expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { createCommittedPartner, partnerWithCompany, setPartnerRelease } from "./support/partners";
import { newTeam, newVisitor, signInAtAal1, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// An outdated employer-pays commitment (V52; FR-J3 AC3, AC4; FR-S4 AC7; NFR-U3, NFR-U4): after a new version, an admin
// and a member read on the dashboard, the job order and the submission form that the owner must accept it, with Respond
// and Send request disabled and that reason as their description; the owner gets the dialog with what changed on the
// dashboard, accepts it by keyboard, and responding opens again. Publishing a version blocks every partner of the
// database, so this file is a project of its own after the submission pipeline, and its tests run one after the other.
// The requirements are in Estonia, which no other spec uses.

const ESTONIA = "EE";
const SLUG = "employer-pays-commitment";
const CHANGED = "Fees for travel and visas are named.";
const OWNER_REASON =
  "The employer-pays commitment has changed. Accept the updated version so that your company can respond to job orders and submit candidates again.";
const MEMBER_REASON = "Your owner needs to accept the updated commitment before you can respond to job orders or submit candidates.";

type Partner = { id: string; slug: string; displayName: string; owner: TestUser };

const dashboardUrl = (slug: string) => `/en/dashboard/recruitment?org=${slug}`;
const orderUrl = (slug: string, id: string) => `/en/org/${slug}/job-orders/${id}`;
const newSubmissionUrl = (slug: string, requirement: string) => `/en/org/${slug}/requirements/${requirement}/submissions/new`;

function setRelease(key: "release_job_orders" | "release_candidate_submissions", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

// A listed recruitment company serving Estonia with 7212 on the paid plan, whose owner accepted the current commitment.
async function eligiblePartner(): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code) values
       (${literal(id)}, 'serves_market', ${literal(ESTONIA)}), (${literal(id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)};
     insert into billing.subscriptions (organization_id, plan_code, status, provider)
     values (${literal(id)}, 'recruitment_partner', 'active', 'null');
     insert into public.consents (user_id, purpose, version, action)
     select ${literal(user.id)}, '${SLUG}', private.current_legal_version('${SLUG}'), 'granted'
     where not private.partner_commitment_current(${literal(id)});`,
  );
  return { id, slug, displayName: displayName(id), owner: user };
}

async function addMember(partner: Partner, role: "admin" | "member"): Promise<TestUser> {
  const user = await createCommittedPartner("recruitment_company");
  execute(
    `insert into public.organization_members (organization_id, user_id, role, accepted_at)
     values (${literal(partner.id)}, ${literal(user.id)}, '${role}', now())`,
  );
  return user;
}

// An open job order of the team in Tallinn, 20 welders (7212), without the company name.
function seedJobOrder(team: Pick<Team, "id" | "owner">, title: string): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 20, ${literal(ESTONIA)}, 'Tallinn', 'C', date '2027-03-01', 12,
       'full_time', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', 'job_order_marketplace', false, now(), date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 20);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(ESTONIA)})`,
  );
  return id;
}

// The partner's response as a selection leaves it: submissions are open to it.
function seedSelectedResponse(team: Pick<Team, "id" | "owner">, requirement: string, partner: string): void {
  execute(
    `insert into public.partner_responses (requirement_id, organization_id, employer_organization_id, status, capacity, available_from,
       experience_note, fee_model, decided_at, decided_by, submissions_allowed)
     values (${literal(requirement)}, ${literal(partner)}, ${literal(team.id)}, 'selected', 20, date '2027-01-10',
       'Welding crews placed in Tallinn for ten years', 'on_request', now(), ${literal(team.owner.id)}, true)`,
  );
}

function publishCommitment(): number {
  const version = execute(
    `insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
     select '${SLUG}', max(version) + 1, 'Employer-pays commitment', 'We charge workers no recruitment fees or related costs.',
       ${literal(CHANGED)}, now() - interval '1 minute', false
     from public.legal_documents where slug = '${SLUG}'
     returning version`,
  );
  return Number(version.trim());
}

function unpublishCommitment(version: number): void {
  execute(
    `alter table public.consents disable trigger user;
     delete from public.consents where purpose = '${SLUG}' and version = ${version};
     alter table public.consents enable trigger user;
     alter table public.legal_documents disable trigger user;
     delete from public.legal_documents where slug = '${SLUG}' and version = ${version};
     alter table public.legal_documents enable trigger user;`,
  );
}

function commitmentVersions(userId: string): number[] {
  return query<{ version: number }>(
    `select version from public.consents where user_id = ${literal(userId)} and purpose = '${SLUG}' and action = 'granted' order by id`,
  ).map(({ version }) => version);
}

async function expectBlocked(page: Page, partner: Partner, order: string, requirement: string, reason: string): Promise<void> {
  await page.goto(dashboardUrl(partner.slug));
  await expect(page.getByRole("status").filter({ hasText: reason })).toBeVisible();
  await expectAccessibleAtBothWidths(page);

  await page.goto(orderUrl(partner.slug, order));
  const panel = page.getByRole("region", { name: "Your eligibility to respond" });
  await expect(panel.getByRole("status").filter({ hasText: reason })).toBeVisible();
  const respond = panel.getByRole("button", { name: "Respond" });
  await expect(respond).toBeDisabled();
  await expect(respond).toHaveAccessibleDescription(reason);
  await expect(panel.getByRole("link", { name: "Respond" })).toHaveCount(0);
  await expectAccessibleAtBothWidths(page);

  await page.goto(newSubmissionUrl(partner.slug, requirement));
  await expect(page.getByRole("status").filter({ hasText: reason })).toBeVisible();
  const send = page.getByRole("button", { name: "Send request" });
  await expect(send).toBeDisabled();
  await expect(send).toHaveAccessibleDescription(reason);
  await expectAccessibleAtBothWidths(page);
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  execute(`delete from public.workforce_requirements where country_code = ${literal(ESTONIA)}`);
  setPartnerRelease(true);
  setRelease("release_job_orders", true);
  setRelease("release_candidate_submissions", true);
});
test.afterAll(() => {
  setRelease("release_candidate_submissions", false);
  setRelease("release_job_orders", false);
  setPartnerRelease(false);
});

test.describe("an outdated employer-pays commitment (FR-J3 AC3, AC4; FR-S4 AC7)", () => {
  test("blocks responses and submissions with the reason until the owner accepts the new version in the dialog", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const team = await newTeam();
    const order = seedJobOrder(team, "Tallinn welders");
    const requirement = seedJobOrder(team, "Tallinn shipyard welders");
    const partner = await eligiblePartner();
    seedSelectedResponse(team, requirement, partner.id);
    const admin = await addMember(partner, "admin");
    const member = await addMember(partner, "member");

    const version = publishCommitment();
    try {
      await signInAtAal1(page, admin, dashboardUrl(partner.slug));
      await expectBlocked(page, partner, order, requirement, MEMBER_REASON);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.context().clearCookies();

      const second = await newVisitor(browser);
      await signInAtAal1(second.page, member, newSubmissionUrl(partner.slug, requirement));
      await expect(second.page.getByRole("status").filter({ hasText: MEMBER_REASON })).toBeVisible();
      await expect(second.page.getByRole("button", { name: "Send request" })).toBeDisabled();
      await second.context.close();

      await signInAtAal1(page, partner.owner, dashboardUrl(partner.slug));
      const dialog = page.getByRole("dialog", { name: "The employer-pays commitment has changed" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(`What changed: ${CHANGED}`, { exact: true })).toBeVisible();
      await expect(dialog.getByText(new RegExp(`version ${version} · `))).toBeVisible();
      await expect(dialog.getByRole("link", { name: /Read the full text/ })).toHaveAttribute("href", `/en/legal/${SLUG}`);
      const box = dialog.getByRole("checkbox", { name: "We charge workers no recruitment fees or related costs", exact: true });
      await expect(box).not.toBeChecked();
      await expectAccessibleAtBothWidths(page);

      // The focus never reaches the page behind the dialog (the browser's own controls count as leaving the document).
      for (let press = 0; press < 6; press += 1) {
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(() => document.activeElement === document.body || document.activeElement?.closest("dialog") != null),
        ).toBe(true);
      }

      await dialog.getByRole("button", { name: "Accept the commitment" }).focus();
      await page.keyboard.press("Enter");
      await expect(dialog.getByText("Please confirm the commitment to continue").first()).toBeVisible();
      expect(commitmentVersions(partner.owner.id)).not.toContain(version);

      await dialog.getByRole("button", { name: "Not now" }).click();
      await expect(dialog).toBeHidden();
      const notice = page.getByRole("status").filter({ hasText: OWNER_REASON });
      await expect(notice).toBeVisible();
      await notice.getByRole("button", { name: "Review and accept" }).click();
      await expect(dialog).toBeVisible();

      await box.focus();
      await page.keyboard.press("Space");
      await expect(box).toBeChecked();
      await dialog.getByRole("button", { name: "Accept the commitment" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Commitment accepted", { exact: true })).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("status").filter({ hasText: OWNER_REASON })).toHaveCount(0);
      expect(commitmentVersions(partner.owner.id).at(-1)).toBe(version);

      await page.goto(orderUrl(partner.slug, order));
      await expect(page.getByRole("region", { name: "Your eligibility to respond" }).getByRole("link", { name: "Respond" })).toBeVisible();
      await page.goto(newSubmissionUrl(partner.slug, requirement));
      await expect(page.getByRole("button", { name: "Send request" })).toBeEnabled();
    } finally {
      unpublishCommitment(version);
    }
  });
});
