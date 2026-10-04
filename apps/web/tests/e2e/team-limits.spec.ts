import { expectNoAxeViolations } from "./support/axe";
import { newEmail } from "./support/signup-page";
import { uniqueName } from "./support/organizations";
import {
  addMember,
  enforceLimits,
  invitationRows,
  membersPath,
  newTeam,
  newVisitor,
  restoreLimits,
  seedInvitation,
  signInAtAal2,
  teamAudit,
} from "./support/team";
import { expect, test } from "./support/test";

// The limits are switched on for this file only and the file runs in one worker, so that no other worker sees a
// limit that was set for these organizations.
test.describe.configure({ mode: "serial" });
test.beforeAll(enforceLimits);
test.afterAll(restoreLimits);

const BASIC_PROMPT = "Your plan allows 1 team member. Upgrade to invite more.";
const PRO_PROMPT = "Your plan allows 5 team members. Upgrade to invite more.";

test.describe("team membership: member limit", () => {
  test("FR-A5 AC11: at the limit the dialog shows the upgrade prompt with a link to the plans and the submit is disabled", async ({
    page,
  }) => {
    const team = await newTeam(uniqueName("Basic Bau"));
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    await page.getByRole("button", { name: "Invite member" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite a team member" });
    await expect(dialog.getByText(BASIC_PROMPT)).toBeVisible();
    await expect(dialog.getByRole("link", { name: "View plans" })).toHaveAttribute("href", `/en/org/${team.slug}/billing`);
    await expect(dialog.getByRole("button", { name: "Create invitation" })).toBeDisabled();
    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");
    expect(invitationRows(team)).toHaveLength(0);
  });

  test("FR-A5 AC11: below the limit nothing is said about it, and a pending invitation counts toward it", async ({ page }) => {
    const team = await newTeam(uniqueName("Pro Bau"));
    await addMember(team, "member");
    seedInvitation(team, newEmail());
    seedInvitation(team, newEmail());
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    await page.getByRole("button", { name: "Invite member" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite a team member" });
    await expect(dialog.getByText(PRO_PROMPT)).toHaveCount(0);
    await dialog.getByLabel("Email address").fill(newEmail());
    await dialog.getByRole("button", { name: "Create invitation" }).click();
    await expect(page.getByRole("dialog", { name: "Invitation link" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: "Invite member" }).click();
    await expect(page.getByRole("dialog").getByText(PRO_PROMPT)).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Create invitation" })).toBeDisabled();
  });

  test("FR-A5 AC12: two people inviting at the same moment cannot pass the limit: one invitation is created, the other sees the upgrade prompt", async ({
    page,
    browser,
  }) => {
    const team = await newTeam(uniqueName("Race Bau"));
    const admin = await addMember(team, "admin");
    await addMember(team, "member");
    await addMember(team, "member");
    expect(invitationRows(team)).toHaveLength(0);
    const adminVisitor = await newVisitor(browser);
    if (!admin.secret) throw new Error("The admin has no factor");
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    await signInAtAal2(adminVisitor.page, admin.user, admin.secret, membersPath(team.slug));

    const pages = [page, adminVisitor.page];
    for (const person of pages) {
      await person.getByRole("button", { name: "Invite member" }).click();
      await person.getByRole("dialog").getByLabel("Email address").fill(newEmail());
    }
    await Promise.all(
      pages.map((person) => person.getByRole("dialog").getByRole("button", { name: "Create invitation" }).click()),
    );
    for (const person of pages) {
      await expect(person.getByRole("dialog").getByText(/Invitation created for|Your plan allows 5 team members/)).toBeVisible();
    }
    const created = await Promise.all(pages.map((person) => person.getByText(/Invitation created for/).count()));
    const refused = await Promise.all(pages.map((person) => person.getByText(PRO_PROMPT).count()));
    expect([created.reduce((a, b) => a + b), refused.reduce((a, b) => a + b)]).toEqual([1, 1]);
    expect(invitationRows(team)).toHaveLength(1);
    expect(teamAudit(team, "member_invited")).toHaveLength(1);
    await adminVisitor.context.close();
  });
});
