import { literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { extractLinks, messageCount, waitForMessage } from "./support/mailpit";
import { runNotify } from "./support/notify";
import { uniqueName } from "./support/organizations";
import { invitationRows, memberRows, membersPath, newTeam, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

// notify takes every message in the queue, so this spec runs in the notify project (playwright.config.ts), one test
// after the other.
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

function invitationNotice(organisation: string) {
  return query<{ status: string; user_id: string | null; has_token: boolean; payload: Record<string, string> }>(
    `select status, user_id, payload ? 'token' as has_token, payload from public.notifications
     where kind = 'member_invitation' and payload ->> 'org_name' = ${literal(organisation)} order by created_at`,
  );
}

test.describe("FR-I1: the invitation email", () => {
  test("FR-I1 AC7: the emailed link opens the accept flow once; opening it again shows the used-or-expired message and adds nobody", async ({
    page,
    browser,
  }) => {
    const name = uniqueName("Mail Bau");
    const team = await newTeam(name);
    const invitee = await createCommittedUser("company");

    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    await page.getByRole("button", { name: "Invite member" }).click();
    const form = page.getByRole("dialog", { name: "Invite a team member" });
    await form.getByLabel("Email address").fill(invitee.email.toUpperCase());
    await form.getByRole("button", { name: "Create invitation" }).click();
    await expect(page.getByRole("dialog", { name: "Invitation link" }).getByText(`We are emailing the invitation to ${invitee.email}`)).toBeVisible();
    expect(invitationNotice(name)).toMatchObject([{ status: "queued", user_id: null, has_token: true }]);

    await runNotify();
    const message = await waitForMessage(invitee.email, { timeoutMs: 60_000 });
    expect(await messageCount(invitee.email)).toBe(1);
    expect(message.Subject).toBe(`You are invited to join ${name} on CHARA`);
    expect(message.Text).toContain(`${name} invited you to join its team on CHARA as a member.`);
    expect(message.Text).toContain("It is valid until");
    const links = extractLinks(message).filter((url) => url.includes("/invitations/"));
    expect(links).toHaveLength(1);
    const { pathname } = new URL(links[0]);
    expect(pathname).toMatch(/^\/en\/invitations\/[A-Za-z0-9_-]{43}$/);
    expect(invitationNotice(name)).toMatchObject([{ status: "sent", has_token: false }]);
    expect(invitationNotice(name)[0].payload).toMatchObject({ org_name: name, role: "member" });

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await logIn(otherPage, invitee, pathname);
    await expect(otherPage.getByRole("heading", { name: `Join ${name}` })).toBeVisible();
    await otherPage.getByRole("button", { name: "Accept invitation" }).click();
    await expect(otherPage).toHaveURL(`/en/org/${team.slug}`);
    expect(memberRows(team).map((row) => [row.user_id, row.role])).toContainEqual([invitee.id, "member"]);
    expect(invitationRows(team)[0].accepted_at).not.toBeNull();

    await otherPage.goto(pathname);
    await expect(otherPage.getByText("This invitation is no longer valid.")).toBeVisible();
    await expect(otherPage.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
    expect(memberRows(team)).toHaveLength(2);
    await other.close();
  });

  test("FR-I1 AC6: inviting an address again stops the email of the first invitation", async ({ page }) => {
    const name = uniqueName("Again Bau");
    const team = await newTeam(name);
    const email = `again-${team.slug}@example.test`;
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    for (let invitation = 0; invitation < 2; invitation++) {
      const trigger = page.getByRole("button", { name: "Invite member" });
      await waitForHydration(trigger);
      await trigger.click();
      const form = page.getByRole("dialog", { name: "Invite a team member" });
      await form.getByLabel("Email address").fill(email);
      await form.getByRole("button", { name: "Create invitation" }).click();
      await page.getByRole("dialog", { name: "Invitation link" }).getByRole("button", { name: "Done" }).click();
    }
    expect(invitationNotice(name).map((row) => row.status).sort()).toEqual(["queued", "suppressed"]);
    await runNotify();
    await waitForMessage(email, { timeoutMs: 60_000 });
    await page.waitForTimeout(1_500);
    expect(await messageCount(email)).toBe(1);
    expect(invitationNotice(name).every((row) => !row.has_token)).toBe(true);
  });
});
