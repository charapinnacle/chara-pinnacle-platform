import type { Page } from "@playwright/test";
import { mainNavigation } from "./support/app-shell";
import { expectNoAxeViolations } from "./support/axe";
import { literal, query } from "./support/db";
import { createCommittedUser } from "./support/login";
import { uniqueName } from "./support/organizations";
import {
  addMember,
  joinTeam,
  memberRows,
  membersPath,
  newTeam,
  newVisitor,
  queuedSignOuts,
  setName,
  setRole,
  signInAtAal1,
  signInAtAal2,
  teamAudit,
} from "./support/team";
import { logIn } from "./support/login-page";
import { enterCode } from "./support/mfa";
import { expect, test } from "./support/test";

function row(page: Page, text: string) {
  return page.getByRole("main").getByRole("listitem").filter({ hasText: text });
}

function transferRows(teamId: string) {
  return query<{ to_user_id: string; accepted_at: string | null; cancelled_at: string | null }>(
    `select to_user_id, accepted_at, cancelled_at from public.organization_ownership_transfers
     where organization_id = ${literal(teamId)} order by created_at`,
  );
}

test.describe("team membership: removing members and changing roles", () => {
  test("FR-A5 AC9: a removed member is refused on the very next request, before any sign-out job has run, and the other organization is untouched", async ({
    page,
    browser,
  }) => {
    const team = await newTeam();
    const second = await newTeam(uniqueName("Second Bau"));
    const member = await addMember(team, "member");
    joinTeam(second, member.user, "member");
    setName(member.user.id, "Max Member");
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    const visitor = await newVisitor(browser);
    await signInAtAal1(visitor.page, member.user, membersPath(team.slug));
    await expect(visitor.page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();

    await row(page, "Max Member").getByRole("button", { name: /Remove/ }).click();
    await page.getByRole("dialog", { name: "Remove Max Member?" }).getByRole("button", { name: "Remove member" }).click();
    await expect(page.getByText("Max Member was removed", { exact: true })).toBeVisible();
    await expect(row(page, "Max Member")).toHaveCount(0);

    await visitor.page.reload();
    await expect(visitor.page).toHaveURL(/\/en\/forbidden$/);
    await expect(visitor.page.getByRole("heading", { name: "You do not have access to this page" })).toBeVisible();
    expect(queuedSignOuts(member.user.id)).toBe(1);
    expect(memberRows(team).map((entry) => entry.user_id)).toEqual([team.owner.id]);
    expect(teamAudit(team, "member_removed")).toHaveLength(1);

    await visitor.page.goto(`/en/org/${second.slug}`);
    await expect(visitor.page).toHaveURL(`/en/dashboard/employer?org=${second.slug}`);
    expect(memberRows(second).map((entry) => entry.user_id)).toContain(member.user.id);
    await visitor.context.close();
  });

  test("FR-A5: an owner changes a member's role, an admin removes an admin, and the owner row has no controls", async ({
    page,
    browser,
  }) => {
    const team = await newTeam();
    const member = await addMember(team, "member");
    const admin = await addMember(team, "admin");
    const other = await addMember(team, "admin");
    setName(member.user.id, "Max Member");
    setName(admin.user.id, "Ada Admin");
    setName(other.user.id, "Otto Other");
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));

    await row(page, "Max Member").getByRole("button", { name: /Make administrator/ }).click();
    await expect(page.getByText("Max Member is now an administrator", { exact: true })).toBeVisible();
    await expect(row(page, "Max Member")).toContainText("Administrator");
    expect(memberRows(team).find((entry) => entry.user_id === member.user.id)?.role).toBe("admin");
    await row(page, "Max Member").getByRole("button", { name: /Make member/ }).click();
    await expect(page.getByText("Max Member is now a member", { exact: true })).toBeVisible();
    expect(teamAudit(team, "member_role_changed").map((entry) => entry.metadata)).toEqual([
      { user_id: member.user.id, from: "member", to: "admin" },
      { user_id: member.user.id, from: "admin", to: "member" },
    ]);
    await expect(row(page, team.owner.email).getByRole("button")).toHaveCount(0);

    if (!admin.secret) throw new Error("The admin has no factor");
    const visitor = await newVisitor(browser);
    await signInAtAal2(visitor.page, admin.user, admin.secret, membersPath(team.slug));
    await expect(visitor.page.getByRole("button", { name: "Transfer ownership" })).toHaveCount(0);
    await expect(row(visitor.page, team.owner.email).getByRole("button")).toHaveCount(0);
    await row(visitor.page, "Otto Other").getByRole("button", { name: /Remove/ }).click();
    await visitor.page.getByRole("dialog").getByRole("button", { name: "Remove member" }).click();
    await expect(visitor.page.getByText("Otto Other was removed", { exact: true })).toBeVisible();
    expect(memberRows(team).map((entry) => entry.user_id)).not.toContain(other.user.id);
    await visitor.context.close();
  });

  test("FR-A5 AC11: a failed request shows a toast and changes nothing", async ({ page }) => {
    const team = await newTeam();
    const member = await addMember(team, "member");
    setName(member.user.id, "Max Member");
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    await page.route(new RegExp(`${membersPath(team.slug)}$`), (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await row(page, "Max Member").getByRole("button", { name: /Make administrator/ }).click();
    await expect(page.getByText("Could not change the role", { exact: true })).toBeVisible();
    await expect(page.getByText("Check your connection and try again.", { exact: true })).toBeVisible();
    expect(memberRows(team).find((entry) => entry.user_id === member.user.id)?.role).toBe("member");
  });
});

test.describe("team membership: page guard and status", () => {
  test("FR-A4 AC3: owners, admins and a member just promoted are held at the MFA page, plain members and candidates are not", async ({
    page,
    browser,
  }) => {
    const team = await newTeam();
    const enrolledAdmin = await addMember(team, "admin");
    const bareAdmin = await addMember(team, "admin", { enrolled: false });
    const promoted = await addMember(team, "member");
    const plain = await addMember(team, "member");
    const candidate = await createCommittedUser("worker");
    const path = membersPath(team.slug);
    const next = `/en/mfa?next=${encodeURIComponent(path)}`;

    await logIn(page, team.owner, path);
    await expect(page).toHaveURL(next);
    await expect(page.getByRole("heading", { name: "Verify it is you" })).toBeVisible();
    await enterCode(page, team.ownerSecret);
    await expect(page).toHaveURL(path);

    await logIn(page, bareAdmin.user, path);
    await expect(page).toHaveURL(next);
    await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();

    const visitor = await newVisitor(browser);
    await logIn(visitor.page, enrolledAdmin.user, path);
    await expect(visitor.page).toHaveURL(next);

    await signInAtAal1(visitor.page, plain.user, path);
    await expect(visitor.page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
    await visitor.page.goto(`/en/org/${team.slug}`);
    await expect(visitor.page).toHaveURL(`/en/dashboard/employer?org=${team.slug}`);

    await signInAtAal1(visitor.page, promoted.user, path);
    await expect(visitor.page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
    setRole(team, promoted.user.id, "admin");
    await visitor.page.reload();
    await expect(visitor.page).toHaveURL(next);

    await logIn(visitor.page, candidate, path);
    await expect(visitor.page).toHaveURL(/\/en\/forbidden$/);
    await visitor.page.goto("/en/dashboard/worker");
    await expect(visitor.page).toHaveURL(/\/en\/dashboard\/worker$/);
    await visitor.context.close();
  });

  test("FR-A4 AC12: the team list shows Enrolled, Not enrolled and Not required, and a skeleton while it loads", async ({ page }) => {
    const team = await newTeam();
    const enrolled = await addMember(team, "admin");
    const bare = await addMember(team, "admin", { enrolled: false });
    const member = await addMember(team, "member", { enrolled: true });
    setName(enrolled.user.id, "Ena Enrolled");
    setName(bare.user.id, "Bo Bare");
    setName(member.user.id, "Max Member");
    await signInAtAal2(page, team.owner, team.ownerSecret, `/en/org/${team.slug}/billing`);
    await page.waitForLoadState("networkidle");

    await page.route(
      (url) => url.pathname === membersPath(team.slug) && url.searchParams.has("_rsc"),
      async (route) => {
        if (!route.request().headers()["next-router-prefetch"]) await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      },
    );
    await mainNavigation(page).getByRole("link", { name: "Team" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();

    await expect(row(page, team.owner.email)).toContainText("Two-step verification: Enrolled");
    await expect(row(page, "Ena Enrolled")).toContainText("Two-step verification: Enrolled");
    await expect(row(page, "Bo Bare")).toContainText("Two-step verification: Not enrolled");
    await expect(row(page, "Max Member")).toContainText("Two-step verification: Not required");
    await expect(row(page, "Max Member")).toContainText(member.user.email);
    await expectNoAxeViolations(page);
  });
});

test.describe("team membership: ownership transfer", () => {
  test("FR-A5 AC8: the owner designates an admin, nothing changes until the admin confirms, then they swap roles and the owner count stays one", async ({
    page,
    browser,
  }) => {
    const team = await newTeam();
    const admin = await addMember(team, "admin");
    setName(admin.user.id, "Ada Admin");
    if (!admin.secret) throw new Error("The admin has no factor");
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));

    await page.getByRole("button", { name: "Transfer ownership" }).click();
    const dialog = page.getByRole("dialog", { name: "Transfer ownership" });
    await dialog.getByRole("button", { name: "Start transfer" }).click();
    await expect(dialog.getByText("Choose who becomes the owner.").first()).toBeVisible();
    await dialog.getByLabel("New owner").selectOption({ label: "Ada Admin" });
    await dialog.getByRole("button", { name: "Start transfer" }).click();
    await expect(page.getByText("Waiting for Ada Admin to confirm", { exact: true })).toBeVisible();
    expect(memberRows(team).map((entry) => entry.role).sort()).toEqual(["admin", "owner"]);
    expect(transferRows(team.id)).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Cancel transfer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Transfer ownership" })).toHaveCount(0);

    const visitor = await newVisitor(browser);
    await signInAtAal2(visitor.page, admin.user, admin.secret, membersPath(team.slug));
    await expect(visitor.page.getByText(/asked you to become the owner/)).toBeVisible();
    await visitor.page.getByRole("button", { name: "Become the owner" }).click();
    await expect(visitor.page.getByText("You are now the owner", { exact: true })).toBeVisible();
    expect(memberRows(team).map((entry) => [entry.user_id, entry.role]).sort()).toEqual(
      [
        [team.owner.id, "admin"],
        [admin.user.id, "owner"],
      ].sort(),
    );
    expect(teamAudit(team, "ownership_transferred").map((entry) => entry.metadata)).toEqual([
      { from: team.owner.id, to: admin.user.id },
    ]);
    expect(teamAudit(team, "ownership_transfer_requested")).toHaveLength(1);

    await page.reload();
    await expect(page.getByRole("button", { name: "Transfer ownership" })).toHaveCount(0);
    await expect(row(page, "Ada Admin")).toContainText("Owner");
    await visitor.context.close();
  });

  test("FR-A5 AC8: the owner can cancel a transfer, and a designated member at aal1 is sent to two-step verification to confirm", async ({
    page,
    browser,
  }) => {
    const team = await newTeam();
    const member = await addMember(team, "member");
    setName(member.user.id, "Max Member");
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    await page.getByRole("button", { name: "Transfer ownership" }).click();
    await page.getByLabel("New owner").selectOption({ label: "Max Member" });
    await page.getByRole("button", { name: "Start transfer" }).click();
    await expect(page.getByText("Waiting for Max Member to confirm becoming the owner")).toBeVisible();

    const visitor = await newVisitor(browser);
    await signInAtAal1(visitor.page, member.user, membersPath(team.slug));
    await visitor.page.getByRole("button", { name: "Become the owner" }).click();
    await expect(visitor.page).toHaveURL(`/en/mfa?next=${encodeURIComponent(membersPath(team.slug))}`);
    await expect(visitor.page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
    expect(memberRows(team).find((entry) => entry.user_id === member.user.id)?.role).toBe("member");

    await page.getByRole("button", { name: "Cancel transfer" }).click();
    await expect(page.getByText("The transfer was cancelled", { exact: true })).toBeVisible();
    expect(transferRows(team.id).map((entry) => entry.cancelled_at !== null)).toEqual([true]);
    await expect(page.getByRole("button", { name: "Transfer ownership" })).toBeVisible();
    await visitor.context.close();
  });
});
