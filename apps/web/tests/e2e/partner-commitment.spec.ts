import { callAs } from "./support/accounts";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { enrollTotp } from "./support/login";
import { logIn } from "./support/login-page";
import { currentStep } from "./support/onboarding";
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

const SLUG = "employer-pays-commitment";
const COMMITMENT = "We charge workers no recruitment fees or related costs";
const REQUIRED = "Please confirm the commitment to continue.";
const DRAFT_NOTICE = "Draft - not yet approved by legal counsel. The commitment below is a draft; you accept the version shown.";
const OUTDATED_FOR_MEMBERS =
  "Your owner needs to accept the updated commitment before you can respond to job orders or submit candidates.";

type Partner = { user: TestUser; id: string; slug: string; type: PartnerType };

// A partner whose countries and offer are saved, so onboarding opens at Commitments.
async function partnerAtCommitments(type: PartnerType): Promise<Partner> {
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

function commitmentRows(userId: string) {
  return query<{ purpose: string; version: number; action: string; user_id: string }>(
    `select purpose, version, action, user_id from public.consents
     where user_id = ${literal(userId)} and purpose = '${SLUG}' order by id`,
  );
}

function acceptanceAudits(organizationId: string) {
  return organizationAudit(organizationId).filter(({ action }) => action === "partner.commitment_accepted");
}

// Counsel's text as the next version, removed again afterwards with the acceptances of it, so the seeded draft stays the
// current version for every other test (published versions and consents are immutable, hence the triggers).
function publishCommitment(): number {
  const version = execute(
    `insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
     select '${SLUG}', max(version) + 1, 'Employer-pays commitment',
       E'We charge workers no recruitment fees or related costs.\\n\\n## Reporting a fee demand\\n\\nA worker reports a fee demand to Trust & Safety.',
       'The text approved by legal counsel replaces the draft.', now() - interval '1 minute', false
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

// The release switch is set for the whole database while this file runs, and one test publishes a version of the
// commitment, so it is a project of its own that follows the others (playwright.config.ts), and the tests run one after
// the other.
test.describe("the employer-pays commitment (FR-J3)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("AC1: the owner confirms the commitment by keyboard as a separate step of onboarding", async ({ page }) => {
    test.setTimeout(90_000);
    const { user, id } = await partnerAtCommitments("recruitment_company");
    await openPartnerOnboarding(page, user);

    await expect(page.getByRole("heading", { name: "Commitments", exact: true, level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 4 of 6: Commitments");
    await expect(page.getByText("Workers never pay fees to get a job through Chara Pinnacle.").first()).toBeVisible();
    await expect(page.getByRole("note").filter({ hasText: DRAFT_NOTICE })).toBeVisible();
    const document = page.getByRole("region", { name: /^Employer-pays commitment/ });
    await expect(document.getByText(/^Version 0 · \d{1,2} \w+ \d{4}$/)).toBeVisible();
    await expect(document.getByRole("heading", { name: "What this document will cover", level: 3 })).toBeVisible();
    await expect(document.getByRole("link", { name: /^Read the full text/ })).toHaveAttribute("href", `/en/legal/${SLUG}`);
    // The box is one of its own, not ticked in advance, and is the only one on the step.
    const box = page.getByRole("checkbox", { name: COMMITMENT, exact: true });
    await expect(box).not.toBeChecked();
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await expectAccessibleAtBothWidths(page);

    // Continuing without the box is refused next to it, and the focus moves to it.
    await page.getByRole("button", { name: "Accept and continue" }).click();
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await expect(box).toHaveAccessibleDescription(REQUIRED);
    expect(commitmentRows(user.id)).toEqual([]);
    await expectAccessibleAtBothWidths(page);

    await box.focus();
    await page.keyboard.press("Space");
    await expect(box).toBeChecked();
    await page.getByRole("button", { name: "Accept and continue" }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", { name: "Secure your account", level: 1 })).toBeVisible();
    await expect(currentStep(page)).toContainText("Step 5 of 6: Security");
    expect(commitmentRows(user.id)).toEqual([{ purpose: SLUG, version: 0, action: "granted", user_id: user.id }]);
    expect(acceptanceAudits(id)).toEqual([expect.objectContaining({ actor_id: user.id, metadata: { version: 0 } })]);
    await expectAccessibleAtBothWidths(page);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Secure your account", level: 1 })).toBeVisible();
  });

  test("AC2: an admin and a member read the commitment and learn that only the owner accepts it", async ({ page }) => {
    test.setTimeout(90_000);
    const partner = await partnerAtCommitments("staffing_company");
    const admin = await addMember(partner, "admin");
    const member = await addMember(partner, "member");

    for (const [user, changeLinks] of [[admin, 1], [member, 0]] as const) {
      await logIn(page, user);
      await page.waitForURL((url) => !url.pathname.endsWith("/login"));
      await page.goto("/en/onboarding");
      await expect(page.getByRole("heading", { name: "Commitments", exact: true, level: 1 })).toBeVisible();
      await expect(
        page.getByRole("status").filter({ hasText: /^Only the owner of Manila Skills .+ can accept the commitment\./ }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "What this document will cover", level: 3 })).toBeVisible();
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Accept and continue" })).toHaveCount(0);
      await expect(page.getByRole("list", { name: "Setting up your account" }).getByRole("link", { name: "What you offer" })).toHaveCount(
        changeLinks,
      );
      await expectAccessibleAtBothWidths(page);
      await page.context().clearCookies();
    }
    await expect(
      callAs(admin, "accept_employer_pays_commitment", { p_org: partner.id, p_version: 0 }),
    ).rejects.toThrow(/CHARA_FORBIDDEN/);
    expect(commitmentRows(admin.id)).toEqual([]);
    expect(acceptanceAudits(partner.id)).toEqual([]);
  });

  test("a new version: members see that the owner must accept it, and the owner accepts it in the dialog of the workforce profile", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const partner = await partnerAtCommitments("recruitment_company");
    const member = await addMember(partner, "member");
    await callAs(partner.user, "accept_employer_pays_commitment", { p_org: partner.id, p_version: 0 });
    const profilePath = `/en/org/${partner.slug}/workforce-profile`;

    await logIn(page, member);
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    await page.goto(profilePath);
    await expect(page.getByRole("heading", { name: "Workforce profile", level: 1 })).toBeVisible();
    await expect(page.getByText(/commitment/)).toHaveCount(0);

    const version = publishCommitment();
    try {
      await page.reload();
      await expect(page.getByRole("status").filter({ hasText: OUTDATED_FOR_MEMBERS })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expectAccessibleAtBothWidths(page);
      await page.context().clearCookies();

      const secret = await enrollTotp(partner.user);
      await signInAtAal2(page, partner.user, secret, profilePath);
      // V52: the dialog opens at once; the notice behind it says the same and opens it again.
      const dialog = page.getByRole("dialog", { name: "The employer-pays commitment has changed" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("What changed: The text approved by legal counsel replaces the draft.", { exact: true })).toBeVisible();
      await expect(dialog.getByText(new RegExp(`version ${version} · `))).toBeVisible();
      await expect(dialog.getByText(/Draft - not yet approved/)).toHaveCount(0);
      await expectAccessibleAtBothWidths(page);
      await dialog.getByRole("button", { name: "Not now" }).click();
      const notice = page.getByRole("status").filter({ hasText: "The employer-pays commitment has changed." });
      await expect(notice).toBeVisible();
      await notice.getByRole("button", { name: "Review and accept" }).click();
      const box = dialog.getByRole("checkbox", { name: COMMITMENT, exact: true });
      await box.focus();
      await page.keyboard.press("Space");
      await expect(box).toBeChecked();
      await dialog.getByRole("button", { name: "Accept the commitment" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Commitment accepted", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Workforce profile", level: 1 })).toBeVisible();
      const rows = commitmentRows(partner.user.id);
      expect(rows.map((row) => row.version)).toEqual([0, version]);
      expect(rows.at(-1)).toEqual({ purpose: SLUG, version, action: "granted", user_id: partner.user.id });
      expect(acceptanceAudits(partner.id).map(({ metadata }) => metadata)).toEqual([{ version: 0 }, { version }]);

      await page.reload();
      await expect(page.getByRole("heading", { name: "Workforce profile", level: 1 })).toBeVisible();
      await expect(page.getByText(/commitment/)).toHaveCount(0);
    } finally {
      unpublishCommitment(version);
    }
  });
});
