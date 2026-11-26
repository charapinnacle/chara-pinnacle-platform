import type { Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { enrollTotp } from "./support/login";
import { logIn } from "./support/login-page";
import { extractLinks, waitForMessage } from "./support/mailpit";
import { beginSetup, enterCode } from "./support/mfa";
import { createCommittedPartner, partnerDocuments, partnerWithCompany, setPartnerRelease, type PartnerType } from "./support/partners";
import { documentBox, newEmail, PASSWORD } from "./support/signup-page";
import {
  enforceLimits,
  invitationRows,
  joinTeam,
  memberRows,
  membersPath,
  newTeam,
  newVisitor,
  restoreLimits,
  seedInvitation,
  setName,
  signInAtAal1,
  signInAtAal2,
  teamAudit,
  type Team,
} from "./support/team";
import { expect, test } from "./support/test";

// A recruitment or staffing company with its owner, as a team of the team helpers. The owner has a factor unless told
// otherwise; the company is in the review queue, or listed, so that its dashboard is open.
async function partnerTeam(
  type: PartnerType,
  { enrolled = true, state = "pending_review" }: { enrolled?: boolean; state?: "onboarding" | "pending_review" | "listed" } = {},
): Promise<Team> {
  const partner = await partnerWithCompany(type);
  execute(
    `update public.organizations set review_status = ${literal(state)},
       submitted_at = case when ${literal(state)} <> 'onboarding' then now() - interval '1 day' end,
       listed_at = case when ${literal(state)} = 'listed' then now() end
     where id = ${literal(partner.id)}`,
  );
  return { id: partner.id, slug: partner.slug, owner: partner.user, ownerSecret: enrolled ? await enrollTotp(partner.user) : "" };
}

async function addPartnerMember(team: Team, type: PartnerType, role: "admin" | "member", { enrolled = false } = {}) {
  const user = await createCommittedPartner(type);
  joinTeam(team, user, role);
  return { user, secret: enrolled ? await enrollTotp(user) : null };
}

function row(page: Page, text: string) {
  return page.getByRole("main").getByRole("listitem").filter({ hasText: text });
}

const mfaUrl = (path: string) => `/en/mfa?next=${encodeURIComponent(path)}`;

function subscribePartner(team: Team, planCode: string, status = "active"): void {
  execute(
    `insert into billing.subscriptions (organization_id, plan_code, status, provider, trial_ends_at)
     values (${literal(team.id)}, ${literal(planCode)}, ${literal(status)}, 'null',
       case when ${literal(status)} = 'trialing' then now() + interval '20 days' end)`,
  );
}

// Release 2a is switched on for the whole database and the limits are enforced for a moment, so this file is a project
// of its own after the network statistics (playwright.config.ts), and its tests run one after the other.
test.describe("Partner team pages (FR-J1 AC9, AC11, release 2a)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => {
    restoreLimits();
    setPartnerRelease(false);
  });

  test("FR-J1 AC9: owners and admins at aal1 are sent to /mfa, the owner enrols and reaches the team, a member is not asked", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const team = await partnerTeam("recruitment_company", { enrolled: false, state: "onboarding" });
    const admin = await addPartnerMember(team, "recruitment_company", "admin");
    const member = await addPartnerMember(team, "recruitment_company", "member");
    setName(member.user.id, "Mia Member");
    const path = membersPath(team.slug);

    await logIn(page, team.owner, path);
    await expect(page).toHaveURL(mfaUrl(path));
    await page.goto(`/en/org/${team.slug}/billing`);
    await expect(page).toHaveURL(mfaUrl(`/en/org/${team.slug}/billing`));
    await page.goto(path);
    await expect(page).toHaveURL(mfaUrl(path));
    const secret = await beginSetup(page);
    await enterCode(page, secret);
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
    await expect(row(page, "Mia Member")).toContainText("Member");
    await expect(row(page, admin.user.email)).toContainText("Administrator");
    await expect(row(page, team.owner.email)).toContainText("Two-step verification: Enrolled");
    await expect(row(page, admin.user.email)).toContainText("Two-step verification: Not enrolled");
    await expect(page.getByRole("button", { name: "Invite member" })).toBeVisible();
    // The partner navigation (release 2a) has the team, marked as the current page.
    const navigation = page.getByRole("navigation", { name: "Main" }).first();
    await expect(navigation.getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page");
    await expect(navigation.getByRole("link", { name: "Workforce profile" })).toHaveAttribute(
      "href",
      `/en/org/${team.slug}/workforce-profile`,
    );
    await expect(navigation.getByRole("link", { name: "Vacancies" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    const adminVisitor = await newVisitor(browser);
    await logIn(adminVisitor.page, admin.user, path);
    await expect(adminVisitor.page).toHaveURL(mfaUrl(path));
    await adminVisitor.context.close();

    const memberVisitor = await newVisitor(browser);
    await signInAtAal1(memberVisitor.page, member.user, path);
    await expect(memberVisitor.page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
    await expect(memberVisitor.page.getByRole("button", { name: "Invite member" })).toHaveCount(0);
    await expect(memberVisitor.page.getByText("Two-step verification")).toHaveCount(0);
    await expectNoAxeViolations(memberVisitor.page);
    await memberVisitor.context.close();
  });

  test("FR-J1: the owner invites, the invitee signs up as a recruitment company from the link, confirms and joins", async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const team = await partnerTeam("recruitment_company", { state: "listed" });
    const [{ display_name: name }] = query<{ display_name: string }>(
      `select display_name from public.organizations where id = ${literal(team.id)}`,
    );
    const email = newEmail();
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    await expect(page.getByText("You are the only member")).toBeVisible();
    await expect(page.getByText("Invite colleagues to keep your workforce profile, listings and licences up to date with you.")).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    await page.getByRole("button", { name: "Invite member" }).click();
    const form = page.getByRole("dialog", { name: "Invite a team member" });
    await form.getByLabel("Email address").fill(email);
    await form.getByLabel("Role").selectOption({ label: "Administrator" });
    await expectNoAxeViolations(page);
    await form.getByRole("button", { name: "Create invitation" }).click();
    const shown = page.getByRole("dialog", { name: "Invitation link" });
    const link = await shown.getByLabel("Invitation link").inputValue();
    const token = /\/en\/invitations\/([A-Za-z0-9_-]{43})$/.exec(link)?.[1];
    if (!token) throw new Error(`Unexpected invitation link ${link}`);
    await shown.getByRole("button", { name: "Done" }).click();
    expect(invitationRows(team)).toMatchObject([{ email, role: "admin", accepted_at: null, invited_by: team.owner.id }]);
    const [{ org_type }] = query<{ org_type: string }>(
      `select payload ->> 'org_type' as org_type from public.notifications where kind = 'member_invitation'
         and payload ->> 'invitation_id' = (select id::text from public.organization_invitations
           where organization_id = ${literal(team.id)} and email = ${literal(email)})`,
    );
    expect(org_type).toBe("recruitment_company");

    const invitee = await newVisitor(browser);
    await invitee.page.goto(`/en/invitations/${token}`);
    await expect(invitee.page.getByRole("heading", { name: `Join ${name}` })).toBeVisible();
    await expect(invitee.page.getByRole("link", { name: "Create an employer account" })).toHaveCount(0);
    await expectNoAxeViolations(invitee.page);
    await invitee.page.getByRole("link", { name: "Create a recruitment company account" }).click();
    await expect(invitee.page).toHaveURL(`/en/signup?invitation=${token}`);
    await expect(invitee.page.getByText(`You are creating a recruitment company account to join ${name}.`)).toBeVisible();
    await expect(invitee.page.getByRole("radio")).toHaveCount(0);
    await expect(invitee.page.getByLabel("Email address")).toHaveValue(email);
    await expect(invitee.page.getByLabel("Email address")).toHaveAttribute("readonly", "");
    await invitee.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    for (const { title } of await partnerDocuments("recruitment_company")) await documentBox(invitee.page, title).check();
    await expectNoAxeViolations(invitee.page);
    await invitee.page.getByRole("button", { name: "Create account" }).click();
    await expect(invitee.page).toHaveURL(/\/en\/verify-email$/);
    const [profile] = query<{ intended_account_kind: string; intended_organization_type: string }>(
      `select p.intended_account_kind::text, p.intended_organization_type::text from public.profiles p
       join auth.users u on u.id = p.id where u.email = ${literal(email)}`,
    );
    expect(profile).toEqual({ intended_account_kind: "company", intended_organization_type: "recruitment_company" });

    const confirmation = extractLinks(await waitForMessage(email, { timeoutMs: 60_000 })).find((url) =>
      url.includes("/en/confirm-email?token_hash="),
    );
    if (!confirmation) throw new Error("The confirmation email has no link");
    const { pathname, search } = new URL(confirmation);
    await invitee.page.goto(`${pathname}${search}`);
    await invitee.page.getByRole("button", { name: "Confirm email address" }).click();
    await expect(invitee.page).toHaveURL(`/en/invitations/${token}`);
    await expect(invitee.page.getByLabel("Legal company name")).toHaveCount(0);
    await invitee.page.getByRole("button", { name: "Accept invitation" }).click();
    // The new administrator is at aal1, so the organisation sends them to set up two-step verification first (AC9).
    await expect(invitee.page).toHaveURL(mfaUrl(`/en/org/${team.slug}`));
    await invitee.context.close();

    expect(memberRows(team).map((entry) => [entry.role, entry.invited_by])).toEqual([
      ["owner", null],
      ["admin", team.owner.id],
    ]);
    expect([teamAudit(team, "member_invited").length, teamAudit(team, "invitation_accepted").length]).toEqual([1, 1]);
    await page.reload();
    await expect(row(page, email)).toContainText("Administrator");
  });

  test("FR-J1: a staffing company changes a role, removes a member and hands the ownership over", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const team = await partnerTeam("staffing_company");
    const admin = await addPartnerMember(team, "staffing_company", "admin", { enrolled: true });
    const member = await addPartnerMember(team, "staffing_company", "member");
    const leaver = await addPartnerMember(team, "staffing_company", "member");
    setName(admin.user.id, "Ada Admin");
    setName(member.user.id, "Max Member");
    setName(leaver.user.id, "Lea Leaver");
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));

    await row(page, "Max Member").getByRole("button", { name: /Make administrator/ }).click();
    await expect(page.getByText("Max Member is now an administrator", { exact: true })).toBeVisible();
    expect(memberRows(team).find((entry) => entry.user_id === member.user.id)?.role).toBe("admin");
    await row(page, "Lea Leaver").getByRole("button", { name: /Remove/ }).click();
    await page.getByRole("dialog", { name: "Remove Lea Leaver?" }).getByRole("button", { name: "Remove member" }).click();
    await expect(page.getByText("Lea Leaver was removed", { exact: true })).toBeVisible();
    expect(memberRows(team).map((entry) => entry.user_id)).not.toContain(leaver.user.id);

    await page.getByRole("button", { name: "Transfer ownership" }).click();
    const dialog = page.getByRole("dialog", { name: "Transfer ownership" });
    await dialog.getByLabel("New owner").selectOption({ label: "Ada Admin" });
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Start transfer" }).click();
    await expect(page.getByText("Waiting for Ada Admin to confirm", { exact: true })).toBeVisible();

    if (!admin.secret) throw new Error("The admin has no factor");
    const visitor = await newVisitor(browser);
    await signInAtAal2(visitor.page, admin.user, admin.secret, membersPath(team.slug));
    await visitor.page.getByRole("button", { name: "Become the owner" }).click();
    await expect(visitor.page.getByText("You are now the owner", { exact: true })).toBeVisible();
    await visitor.context.close();
    expect(memberRows(team).map((entry) => [entry.user_id, entry.role]).sort()).toEqual(
      [
        [team.owner.id, "admin"],
        [admin.user.id, "owner"],
        [member.user.id, "admin"],
      ].sort(),
    );
    expect(teamAudit(team, "member_role_changed")).toHaveLength(1);
    expect(teamAudit(team, "member_removed")).toHaveLength(1);
    expect(teamAudit(team, "ownership_transferred")).toHaveLength(1);
  });

  test("FR-R1: the members limit of the partner plans holds Basic to its owner and shows the upgrade prompt", async ({ page }) => {
    const basic = await partnerTeam("recruitment_company");
    subscribePartner(basic, "recruitment_partner");
    enforceLimits();
    try {
      await signInAtAal2(page, basic.owner, basic.ownerSecret, membersPath(basic.slug));
      await page.getByRole("button", { name: "Invite member" }).click();
      const dialog = page.getByRole("dialog", { name: "Invite a team member" });
      await expect(dialog.getByText("Your plan allows 1 team member. Upgrade to invite more.")).toBeVisible();
      await expect(dialog.getByRole("link", { name: "View plans" })).toHaveAttribute("href", `/en/org/${basic.slug}/billing`);
      await expect(dialog.getByRole("button", { name: "Create invitation" })).toBeDisabled();
      await expectNoAxeViolations(page);
      expect(invitationRows(basic)).toHaveLength(0);
    } finally {
      restoreLimits();
    }
  });

  test("FR-J1 AC11: Ready offers Invite your team, and the dashboard plan line says the members usage", async ({ page }) => {
    test.setTimeout(120_000);
    const team = await partnerTeam("recruitment_company", { state: "pending_review" });
    subscribePartner(team, "recruitment_partner", "trialing");
    await signInAtAal1(page, team.owner, "/en/onboarding");
    await expect(page.getByRole("heading", { name: "Your company is waiting for review", level: 1 })).toBeVisible();
    const invite = page.getByRole("link", { name: /^Invite your team/ });
    await expect(invite).toHaveAttribute("href", membersPath(team.slug));
    await expect(page.getByRole("link", { name: /^Choose a plan/ })).toHaveAttribute("href", `/en/org/${team.slug}/billing`);
    await expect(page.getByRole("link", { name: /^Complete your workforce profile/ })).toBeVisible();
    await invite.focus();
    await expect(invite).toBeFocused();
    expect(await page.locator("main").innerText()).not.toMatch(/approved|verified/i);
    await expectAccessibleAtBothWidths(page);
    await invite.click();
    await expect(page).toHaveURL(mfaUrl(membersPath(team.slug)));
    await enterCode(page, team.ownerSecret);
    await expect(page).toHaveURL(membersPath(team.slug));

    await page.goto(`/en/dashboard/recruitment?org=${team.slug}`);
    // The team is in the sidebar, so the dashboard has no team card; the plan line says the full limit.
    await expect(page.getByRole("region", { name: "Your team" })).toHaveCount(0);
    const plan = page.getByRole("region", { name: "Plan and usage" });
    await expect(plan).toContainText("1 of 1 team member · limit reached");
    await expect(plan.getByRole("link", { name: /^(Upgrade|Choose a plan)$/ }), "FR-R1: a full limit offers the upgrade").toHaveAttribute(
      "href",
      `/en/org/${team.slug}/billing`,
    );
    expect(await page.locator("main").innerText()).not.toMatch(/approved|verified/i);
    await expectAccessibleAtBothWidths(page);
  });

  test("release 2a off: the team page and the invitations of a partner are not found, an employer's are unchanged", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const team = await partnerTeam("staffing_company");
    const token = seedInvitation(team, newEmail());
    const employer = await newTeam();
    setPartnerRelease(false);
    try {
      await signInAtAal2(page, team.owner, team.ownerSecret, `/en/org/${team.slug}/billing`);
      // The page streams behind its loading skeleton, so the answer is the not-found page rather than a 404 status.
      await page.goto(membersPath(team.slug));
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Team" })).toHaveCount(0);

      const visitor = await newVisitor(browser);
      await visitor.page.goto(`/en/invitations/${token}`);
      await expect(visitor.page.getByText("This invitation is no longer valid.")).toBeVisible();
      await visitor.context.close();

      const employerPage = await newVisitor(browser);
      await signInAtAal2(employerPage.page, employer.owner, employer.ownerSecret, membersPath(employer.slug));
      await expect(employerPage.page.getByText("Invite colleagues to work on vacancies and applicants with you.")).toBeVisible();
      await employerPage.context.close();
    } finally {
      setPartnerRelease(true);
    }
  });
});
