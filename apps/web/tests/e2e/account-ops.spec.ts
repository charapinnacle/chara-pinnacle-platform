import type { Page } from "@playwright/test";
import { runAccountOps } from "./support/account-ops";
import { execute, literal, query } from "./support/db";
import { enrollTotp, expireAccessToken, sessionRows } from "./support/login";
import { logIn } from "./support/login-page";
import { addTwoDevices, enterCode, factorRows, newOwner, staffUser } from "./support/mfa";
import { organizationRows, signInAsEmployer } from "./support/organizations";
import { aal2Token, callRpc } from "./support/staff";
import { addMember, membersPath, newTeam, newVisitor, queuedSignOuts, setName, signInAtAal1, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";
import type { TestUser } from "./support/test-user";

// The tests call account-ops, which takes every job in the queue, so they run in their own project after the others
// (playwright.config.ts) and one after the other.
test.describe.configure({ mode: "serial" });

const REASON = "Browser test of the staff roles, ticket 4900";

function jobs(userId: string, reason: string): number {
  const [row] = query<{ n: number }>(
    `select count(*)::int as n from pgmq.q_account_ops
     where message ->> 'user_id' = ${literal(userId)} and message ->> 'reason' = ${literal(reason)}`,
  );
  return row.n;
}

function doneRows(userId: string) {
  return query<{ actor_id: string | null; metadata: Record<string, unknown> }>(
    `select actor_id, metadata from audit.log
     where action = 'account_ops_done' and entity_id = ${literal(userId)} order by id`,
  );
}

function activeRoles(userId: string): string[] {
  return query<{ role: string }>(
    `select role::text from public.platform_staff where user_id = ${literal(userId)} and revoked_at is null order by role`,
  ).map((row) => row.role);
}

async function enrolledStaff(role: "admin" | "verification_reviewer" | "trust_safety") {
  const user = await staffUser(role);
  return { user, secret: await enrollTotp(user) };
}

async function adminToken(admin: { user: TestUser; secret: string }): Promise<string> {
  return aal2Token(admin.user, admin.secret);
}

async function signedOutAtNextRefresh(page: Page, path: string): Promise<void> {
  await expireAccessToken(page.context());
  await page.goto(path);
  await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(path)}`);
}

test.describe("account-ops: sessions after a role change, a removal and a two-step reset", () => {
  test("FR-A7 AC5: a granted role signs the user out at the next refresh and the new roles apply after login", async ({
    page,
  }) => {
    const admin = await enrolledStaff("admin");
    const staff = await enrolledStaff("trust_safety");
    await signInAtAal2(page, staff.user, staff.secret, "/en/admin");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

    const grant = await callRpc(await adminToken(admin), "grant_platform_role", {
      p_user_id: staff.user.id,
      p_role: "verification_reviewer",
      p_reason: REASON,
    });
    expect(grant.status).toBe(204);
    expect(activeRoles(staff.user.id)).toEqual(["trust_safety", "verification_reviewer"]);
    expect(jobs(staff.user.id, "platform_role_granted")).toBe(1);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

    await runAccountOps();
    expect(sessionRows(staff.user.id)).toEqual([]);
    expect(jobs(staff.user.id, "platform_role_granted")).toBe(0);
    expect(doneRows(staff.user.id).map((row) => row.metadata.action)).toEqual(["sign_out"]);
    expect(doneRows(staff.user.id)[0].actor_id).toBeNull();
    await signedOutAtNextRefresh(page, "/en/admin");

    await logIn(page, staff.user, "/en/admin");
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/admin")}`);
    await enterCode(page, staff.secret);
    await expect(page).toHaveURL(/\/en\/admin$/);
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    expect(activeRoles(staff.user.id)).toEqual(["trust_safety", "verification_reviewer"]);
  });

  test("FR-A7 AC5: a revoked role is refused at once, the sign-out follows and the next login stays refused", async ({
    page,
  }) => {
    const admin = await enrolledStaff("admin");
    const staff = await enrolledStaff("trust_safety");
    await signInAtAal2(page, staff.user, staff.secret, "/en/admin");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

    const revoke = await callRpc(await adminToken(admin), "revoke_platform_role", {
      p_user_id: staff.user.id,
      p_role: "trust_safety",
      p_reason: REASON,
    });
    expect(revoke.status).toBe(204);
    expect(jobs(staff.user.id, "platform_role_revoked")).toBe(1);
    expect(sessionRows(staff.user.id).length).toBeGreaterThan(0);
    await page.reload();
    await expect(page).toHaveURL(/\/en\/forbidden$/);

    await runAccountOps();
    expect(sessionRows(staff.user.id)).toEqual([]);
    await signedOutAtNextRefresh(page, "/en/admin");
    await logIn(page, staff.user, "/en/admin");
    await expect(page).toHaveURL(/\/en\/forbidden$/);
    expect(activeRoles(staff.user.id)).toEqual([]);
  });

  test("FR-A4 AC10: a reset deletes both factors and ends both sessions, a second run changes nothing and enrolment starts again", async ({
    page,
    browser,
  }) => {
    const admin = await enrolledStaff("admin");
    const owner = await newOwner();
    await signInAsEmployer(page, owner);
    await addTwoDevices(page);
    const second = await newVisitor(browser);
    await logIn(second.page, owner);
    await expect(second.page).toHaveURL(/\/en\/dashboard\/employer$/);
    expect(factorRows(owner.id)).toHaveLength(2);

    const reset = await callRpc(await adminToken(admin), "reset_mfa", {
      p_user_id: owner.id,
      p_reason: "Identity checked by video call, ticket 4711",
    });
    expect(reset.status).toBe(204);
    expect(factorRows(owner.id)).toHaveLength(2);
    await runAccountOps();
    expect(factorRows(owner.id)).toEqual([]);
    expect(sessionRows(owner.id)).toEqual([]);
    expect(doneRows(owner.id).map((row) => row.metadata)).toEqual([
      expect.objectContaining({ action: "reset_mfa", factors_deleted: 2 }),
    ]);

    execute(
      `select pgmq.send('account_ops', jsonb_build_object('action', 'reset_mfa', 'user_id', ${literal(owner.id)}))`,
    );
    await runAccountOps();
    expect(doneRows(owner.id).map((row) => [row.metadata.factors_deleted, row.metadata.sessions_ended])).toEqual([
      [2, expect.any(Number)],
      [0, 0],
    ]);
    expect(factorRows(owner.id)).toEqual([]);
    await signedOutAtNextRefresh(page, "/en/dashboard/employer");
    await second.context.close();

    await logIn(page, owner);
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
    const [organization] = organizationRows(owner.id);
    await page.goto(membersPath(organization.slug));
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent(membersPath(organization.slug))}`);
    await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
  });

  test("FR-A5 AC9: the sign-out job of a removed member ends their sessions within the minute", async ({
    page,
    browser,
  }) => {
    const team = await newTeam();
    const member = await addMember(team, "member");
    setName(member.user.id, "Max Member");
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    const visitor = await newVisitor(browser);
    await signInAtAal1(visitor.page, member.user, membersPath(team.slug));

    await page.getByRole("main").getByRole("listitem").filter({ hasText: "Max Member" }).getByRole("button", { name: /Remove/ }).click();
    await page.getByRole("dialog", { name: "Remove Max Member?" }).getByRole("button", { name: "Remove member" }).click();
    await expect(page.getByText("Max Member was removed", { exact: true })).toBeVisible();
    expect(queuedSignOuts(member.user.id)).toBe(1);
    expect(sessionRows(member.user.id).length).toBeGreaterThan(0);

    await runAccountOps();
    expect(queuedSignOuts(member.user.id)).toBe(0);
    expect(sessionRows(member.user.id)).toEqual([]);
    await signedOutAtNextRefresh(visitor.page, "/en/dashboard/employer");
    await visitor.context.close();
  });
});
