import { expectNoAxeViolations } from "./support/axe";
import { currentDocuments } from "./support/accounts";
import { createCommittedUser } from "./support/login";
import { waitForHydration } from "./support/hydration";
import { extractLinks, waitForMessage } from "./support/mailpit";
import { uniqueName } from "./support/organizations";
import { ageBox, documentBox, newEmail, PASSWORD } from "./support/signup-page";
import {
  addMember,
  invitationRows,
  memberRows,
  membersPath,
  newTeam,
  newVisitor,
  seedInvitation,
  setName,
  signInAtAal1,
  signInAtAal2,
  teamAudit,
} from "./support/team";
import { logIn } from "./support/login-page";
import { execute, literal, query } from "./support/db";
import { expect, test } from "./support/test";
import { formatDate } from "@/lib/i18n/format";

const WORKER_MESSAGE = "This invitation can only be accepted by an employer account. Use a different email address.";

test.describe("team membership: invitations", () => {
  test("FR-A5 AC10: an owner invites by email, the invitee registers from the link, confirms and joins without creating a company", async ({
    page,
    browser,
  }) => {
    const name = uniqueName("Link Bau");
    const team = await newTeam(name);
    const email = newEmail();
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));

    await page.getByRole("button", { name: "Invite member" }).click();
    const form = page.getByRole("dialog", { name: "Invite a team member" });
    await form.getByLabel("Email address").fill(email);
    await form.getByRole("button", { name: "Create invitation" }).click();
    const shown = page.getByRole("dialog", { name: "Invitation link" });
    const link = await shown.getByLabel("Invitation link").inputValue();
    const token = /\/en\/invitations\/([A-Za-z0-9_-]{43})$/.exec(link)?.[1];
    if (!token) throw new Error(`Unexpected invitation link ${link}`);
    const [invitation] = invitationRows(team);
    expect(invitation).toMatchObject({ email, role: "member", accepted_at: null, invited_by: team.owner.id });
    await expect(shown.getByText("Member", { exact: true })).toBeVisible();
    await expect(shown.getByText("Expires on")).toBeVisible();
    await expect(shown.getByText(formatDate(invitation.expires_at))).toBeVisible();
    await shown.getByRole("button", { name: "Done" }).click();

    await page.reload();
    await expect(page.getByText(`Pending, expires on ${formatDate(invitation.expires_at)}`)).toBeVisible();
    expect(await page.content()).not.toContain(token);

    const invitee = await newVisitor(browser);
    await invitee.page.goto(`/en/invitations/${token}`);
    await expect(invitee.page.getByRole("heading", { name: `Join ${name}` })).toBeVisible();
    await invitee.page.getByRole("link", { name: "Create an employer account" }).click();
    await expect(invitee.page).toHaveURL(`/en/signup?invitation=${token}`);
    await expect(invitee.page.getByRole("radio")).toHaveCount(0);
    await expect(invitee.page.getByLabel("Email address")).toHaveValue(email);
    await expect(invitee.page.getByLabel("Email address")).toHaveAttribute("readonly", "");
    await invitee.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    for (const { slug, title } of await currentDocuments("company")) {
      await (slug === "age-18-plus" ? ageBox(invitee.page) : documentBox(invitee.page, title)).check();
    }
    await invitee.page.getByRole("button", { name: "Create account" }).click();
    await expect(invitee.page).toHaveURL(/\/en\/verify-email$/);

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
    await expect(invitee.page).toHaveURL(`/en/org/${team.slug}`);

    expect(memberRows(team).map((row) => [row.role, row.invited_by])).toEqual([
      ["owner", null],
      ["member", team.owner.id],
    ]);
    expect(invitationRows(team)[0].accepted_at).not.toBeNull();
    const invited = teamAudit(team, "member_invited");
    const accepted = teamAudit(team, "invitation_accepted");
    expect([invited.length, accepted.length]).toEqual([1, 1]);
    expect(accepted[0].entity_id).toBe(invited[0].entity_id);
    const [{ leaked }] = query<{ leaked: number }>(
      `select count(*)::int as leaked from audit.log where metadata::text like ${literal(`%${token}%`)}`,
    );
    expect(leaked).toBe(0);
    await invitee.context.close();
  });

  test("FR-A5 AC10: a candidate who opens an invitation link is told it needs an employer account and joins nothing", async ({
    page,
  }) => {
    const team = await newTeam();
    const worker = await createCommittedUser("worker");
    const token = seedInvitation(team, worker.email);
    await logIn(page, worker, `/en/invitations/${token}`);
    await expect(page).toHaveURL(`/en/invitations/${token}`);
    await expect(page.getByText(WORKER_MESSAGE)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
    expect(memberRows(team)).toHaveLength(1);
    expect(invitationRows(team)[0].accepted_at).toBeNull();
    await expectNoAxeViolations(page);
  });

  test("FR-A5 AC10: a link for another address is refused with one message that names no cause, and links that do not work show the same page", async ({
    page,
    browser,
  }) => {
    const team = await newTeam();
    const stranger = await createCommittedUser("company");
    const token = seedInvitation(team, newEmail());
    await logIn(page, stranger, `/en/invitations/${token}`);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByRole("alert").getByText(/not valid for your account/)).toBeVisible();
    expect(memberRows(team)).toHaveLength(1);

    const visitor = await newVisitor(browser);
    for (const dead of ["x".repeat(43), "not-a-token", seedInvitation(team, newEmail(), "member", { expired: true })]) {
      await visitor.page.goto(`/en/invitations/${dead}`);
      await expect(visitor.page.getByText("This invitation is no longer valid.")).toBeVisible();
      await expect(visitor.page.getByRole("link", { name: "Create an employer account" })).toHaveCount(0);
    }
    await visitor.context.close();
  });

  test("FR-A5 AC10: an existing employer logs in from the link and joins a second organization while keeping the first", async ({
    page,
  }) => {
    const firstName = uniqueName("First Bau");
    const secondName = uniqueName("Second Bau");
    const first = await newTeam(firstName);
    const second = await newTeam(secondName);
    const token = seedInvitation(second, first.owner.email, "admin");
    await logIn(page, first.owner, `/en/invitations/${token}`);
    await expect(page).toHaveURL(`/en/invitations/${token}`);
    await expect(page.getByRole("heading", { name: `Join ${secondName}` })).toBeVisible();
    await page.getByRole("button", { name: "Accept invitation" }).click();
    // An admin of the new organization is asked for two-step verification at once (FR-A4).
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent(`/en/org/${second.slug}`)}`);

    expect(memberRows(second).map((row) => [row.user_id, row.role])).toContainEqual([first.owner.id, "admin"]);
    expect(memberRows(first).map((row) => [row.user_id, row.role])).toContainEqual([first.owner.id, "owner"]);
    await page.goto("/en/dashboard/employer");
    await expect(page.getByText(firstName, { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Your organizations" }).getByRole("link", { name: secondName })).toBeVisible();
  });

  test("FR-A5 AC11: with only the owner the page says so, and the dialog is keyboard operable and axe clean at 360 px and 1280 px", async ({
    page,
  }) => {
    const team = await newTeam(uniqueName("Solo Bau"));
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    await expect(page.getByRole("heading", { name: "You are the only member" })).toBeVisible();
    await expectNoAxeViolations(page);

    const email = newEmail();
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(membersPath(team.slug));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      const trigger = page.getByRole("button", { name: "Invite member" });
      await waitForHydration(trigger);
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Invite a team member" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Email address")).toBeFocused();
      await expectNoAxeViolations(page);
      for (let tab = 0; tab < 6; tab++) {
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(() => document.activeElement === document.body || document.activeElement?.closest("dialog")),
        ).toBeTruthy();
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }

    await page.getByRole("button", { name: "Invite member" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Invite a team member" })).toBeVisible();
    await page.getByLabel("Email address").fill(email);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Invitation link" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Invitation link" })).toBeFocused();
    expect(invitationRows(team).map((row) => row.email)).toEqual([email]);
  });

  test("FR-A5 AC11: an invalid address is refused in the dialog before any request, and a failed request shows a toast", async ({
    page,
  }) => {
    const team = await newTeam();
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    await page.getByRole("button", { name: "Invite member" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite a team member" });
    await dialog.getByLabel("Email address").fill("not-an-email");
    await dialog.getByRole("button", { name: "Create invitation" }).click();
    await expect(dialog.getByText("Enter a valid email address.").first()).toBeVisible();
    expect(invitationRows(team)).toHaveLength(0);

    await page.route(new RegExp(`${membersPath(team.slug)}$`), (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await dialog.getByLabel("Email address").fill(newEmail());
    await dialog.getByRole("button", { name: "Create invitation" }).click();
    await expect(page.getByText("Could not create the invitation", { exact: true })).toBeVisible();
    expect(invitationRows(team)).toHaveLength(0);
  });

  test("FR-A5 AC11: an expired invitation shows Expired with Resend, which replaces it with a new link", async ({ page, browser }) => {
    const team = await newTeam();
    const email = newEmail();
    const oldToken = seedInvitation(team, email, "admin", { expired: true });
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    const row = page.getByRole("main").getByRole("listitem").filter({ hasText: email });
    await expect(row).toContainText("Expired");
    await row.getByRole("button", { name: /Resend/ }).click();
    const shown = page.getByRole("dialog", { name: "Invitation link" });
    const link = await shown.getByLabel("Invitation link").inputValue();
    expect(link).not.toContain(oldToken);
    await shown.getByRole("button", { name: "Done" }).click();
    await page.reload();
    await expect(row).toContainText("Pending, expires on");
    await expect(row.getByRole("button", { name: /Resend/ })).toHaveCount(0);
    expect(invitationRows(team)).toHaveLength(1);

    const visitor = await newVisitor(browser);
    await visitor.page.goto(`/en/invitations/${oldToken}`);
    await expect(visitor.page.getByText("This invitation is no longer valid.")).toBeVisible();
    await visitor.context.close();
  });

  test("FR-A5 AC11: an invitation whose sender was removed shows as no longer valid with Resend and cannot be opened", async ({
    page,
    browser,
  }) => {
    const team = await newTeam();
    const sender = await addMember(team, "admin");
    const email = newEmail();
    const token = seedInvitation(team, email);
    execute(`update public.organization_invitations set invited_by = ${literal(sender.user.id)} where organization_id = ${literal(team.id)}`);
    execute(
      `delete from public.organization_members where organization_id = ${literal(team.id)} and user_id = ${literal(sender.user.id)}`,
    );
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));
    const row = page.getByRole("main").getByRole("listitem").filter({ hasText: email });
    await expect(row).toContainText("No longer valid");
    await expect(row.getByRole("button", { name: /Resend/ })).toBeVisible();

    const visitor = await newVisitor(browser);
    await visitor.page.goto(`/en/invitations/${token}`);
    await expect(visitor.page.getByText("This invitation is no longer valid.")).toBeVisible();
    await visitor.context.close();
  });

  test("FR-A5 AC10: a remembered invitation for another address does not hold a new employer away from the company form", async ({
    page,
  }) => {
    const team = await newTeam();
    const newcomer = await createCommittedUser("company");
    const foreign = seedInvitation(team, newEmail());
    await page.context().addCookies([{ name: "chara_invitation", value: foreign, url: "http://localhost:3100" }]);
    await logIn(page, newcomer, "/en/onboarding");
    await expect(page.getByLabel("Legal company name")).toBeVisible();

    const own = seedInvitation(team, newcomer.email);
    await page.context().addCookies([{ name: "chara_invitation", value: own, url: "http://localhost:3100" }]);
    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(`/en/invitations/${own}`);
  });

  test("FR-A5 AC11: a plain member sees names and roles but no email address and no controls", async ({ page }) => {
    const team = await newTeam();
    const viewer = await addMember(team, "member");
    const other = await addMember(team, "member");
    setName(team.owner.id, "Olga Owner");
    setName(other.user.id, "Otto Other");
    seedInvitation(team, newEmail());
    await signInAtAal1(page, viewer.user, membersPath(team.slug));
    await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
    const list = page.getByRole("list").first();
    await expect(list).toContainText("Olga Owner");
    await expect(list).toContainText("Owner");
    await expect(list).toContainText("Otto Other");
    const html = await page.content();
    for (const user of [team.owner, other.user, viewer.user]) expect(html).not.toContain(user.email);
    await expect(page.getByRole("button", { name: /Invite|Remove|Make|Resend|Transfer/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Invitations" })).toHaveCount(0);
    await expect(page.getByText(/Two-step verification/)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});
