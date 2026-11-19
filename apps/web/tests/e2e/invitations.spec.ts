import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { displayName, expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { waitForMessage } from "./support/mailpit";
import { runNotify } from "./support/notify";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { SITE } from "./support/seo";
import { addMember, enforceLimits, joinTeam, newTeam, newVisitor, restoreLimits, signInAtAal1, signInAtAal2, subscribe, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// The invitation pages (V42, FR-O1 AC8, AC9, AC11, AC12 and the pages of AC10; FR-M3 AC7 step Act; NFR-U3, NFR-U4,
// NFR-S11): an owner invites from the suggestions with checkboxes and Invite selected, and from a partner profile, and
// meets the upgrade prompt at the plan's limit; the employer follows each invitation's status and withdraws one; the
// invited partner reads its inbox, lands on an invitation from its notification and its email, accepts one and declines
// another with a reason; a competing partner gets the 404. Releases 2a and 2b and the plan limits are switched on for the
// whole database, so this file is a project of its own after the job orders, and its tests run one after the other. The
// requirements are in Cyprus, which no other spec uses, so the suggestions hold only the partners made here.

const CYPRUS = "CY";
const requirementUrl = (slug: string, id: string) => `/en/org/${slug}/requirements/${id}`;
const invitationsUrl = (slug: string, id: string) => `${requirementUrl(slug, id)}/invitations`;
const inboxUrl = (slug: string) => `/en/org/${slug}/invitations`;
const invitationUrl = (slug: string, id: string) => `${inboxUrl(slug)}/${id}`;
const LIST_FUNCTION = "public.list_requirement_invitations(uuid, uuid)";
const REASON = "No welders available before March";

function setJobOrderRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

type Partner = { id: string; slug: string; displayName: string; owner: TestUser };

// A listed recruitment company serving Cyprus with 7212, with the newest profile of the database.
async function listedPartner(): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code)
       values (${literal(id)}, 'serves_market', ${literal(CYPRUS)}), (${literal(id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days',
       workforce_profile_updated_at = now() + interval '3 days'
     where id = ${literal(id)}`,
  );
  return { id, slug, displayName: displayName(id), owner: user };
}

// An open requirement of the team in Limassol: 100 welders (7212) from 1 March 2027, published privately or on the
// marketplace without the company name.
function seedRequirement(team: Pick<Team, "id" | "owner">, title: string, visibility: "private" | "job_order_marketplace" = "private"): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, recruitment_preference,
       partner_need, created_by, status, visibility, show_identity, published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 100, ${literal(CYPRUS)}, 'Limassol', 'C', date '2027-03-01', 12,
       'full_time', 2500, 3000, 'EUR', 'month', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', ${literal(visibility)}, false,
       now(), date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 100);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(CYPRUS)})`,
  );
  return id;
}

// An invitation in the given state, as the functions of V41 leave it.
function seedInvitation(team: Pick<Team, "id">, requirement: string, partner: string, status: string, reason?: string): string {
  const id = randomUUID();
  const at = (states: string[], column: string) => (states.includes(status) ? "now()" : "null::timestamptz") + ` as ${column}`;
  execute(
    `insert into public.requirement_invitations (id, requirement_id, organization_id, employer_organization_id, source, status, viewed_at,
       answered_at, decline_reason, responded_at, withdrawn_at)
     select ${literal(id)}, ${literal(requirement)}, ${literal(partner)}, ${literal(team.id)}, 'directory', ${literal(status)}::public.invitation_status,
       v.viewed_at, v.answered_at, ${reason ? literal(reason) : "null"}, v.responded_at, v.withdrawn_at
     from (select ${at(["viewed", "accepted", "declined", "responded"], "viewed_at")}, ${at(["accepted", "declined", "responded"], "answered_at")},
       ${at(["responded"], "responded_at")}, ${at(["withdrawn"], "withdrawn_at")}) v`,
  );
  return id;
}

function invitationRows(requirement: string) {
  return query<{ organization_id: string; status: string; source: string; criteria: boolean; decline_reason: string | null }>(
    `select organization_id, status, source, suggestion_criteria is not null as criteria, decline_reason
     from public.requirement_invitations where requirement_id = ${literal(requirement)}`,
  );
}

function audits(action: string, entity: string): number {
  return query<{ n: number }>(`select count(*)::integer as n from audit.log where action = ${literal(action)} and entity_id = ${literal(entity)}`)[0].n;
}

function queued(userId: string, kind: string): number {
  return query<{ n: number }>(
    `select count(*)::integer as n from public.notifications where user_id = ${literal(userId)} and kind = ${literal(kind)}`,
  )[0].n;
}

function suggestionCard(page: Page, name: string) {
  return page.getByRole("list", { name: "Suggested partners" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name, level: 2 }) });
}

function invitedPartner(page: Page, name: string) {
  return page.getByRole("list", { name: "Invited partners" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name }) });
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  execute(`delete from public.workforce_requirements where country_code = ${literal(CYPRUS)}`);
  setPartnerRelease(true);
  setJobOrderRelease(true);
  enforceLimits();
});
test.afterAll(() => {
  execute(`grant execute on function ${LIST_FUNCTION} to authenticated`);
  restoreLimits();
  setJobOrderRelease(false);
  setPartnerRelease(false);
});

test.describe("Inviting partners to a requirement (FR-O1 AC12, FR-M3 AC7)", () => {
  test("AC12: the owner invites two suggested partners, then meets the upgrade prompt on a profile; a member sees no checkbox", async ({ page, browser }) => {
    test.setTimeout(300_000);
    const team = await newTeam();
    subscribe(team, "employer_starter");
    const x = await listedPartner();
    const q1 = await listedPartner();
    const q2 = await listedPartner();
    const q3 = await listedPartner();
    const id = seedRequirement(team, "Limassol welders");
    seedInvitation(team, id, x.id, "invited");

    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, id));
    const section = page.getByRole("region", { name: "Invitations" });
    await expect(section).toContainText("1 of 3 invitations used.");
    await expect(section.getByRole("link", { name: "See invitations" })).toHaveAttribute("href", invitationsUrl(team.slug, id));
    await page.getByRole("link", { name: "Find partners for this requirement" }).click();
    await expect(page.getByRole("heading", { name: "Find partners for this requirement", level: 1 })).toBeVisible();

    // A partner that already has an invitation shows its status instead of a checkbox.
    await expect(suggestionCard(page, x.displayName).getByText("Invited", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: `Invite ${x.displayName}` })).toHaveCount(0);
    const bar = page.getByText(/selected · /);
    await expect(bar).toHaveText("0 selected · 1 of 3 invitations used");
    const inviteSelected = page.getByRole("button", { name: /^Invite selected/ });
    await waitForHydration(inviteSelected);
    await inviteSelected.click();
    await expect(page.getByText("Select at least one partner to invite.", { exact: true })).toBeVisible();

    await page.getByRole("checkbox", { name: `Invite ${q1.displayName}` }).check();
    await page.getByRole("checkbox", { name: `Invite ${q2.displayName}` }).check();
    await expect(bar).toHaveText("2 selected · 1 of 3 invitations used");
    await expect(inviteSelected).toHaveText("Invite selected (2)");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await inviteSelected.click();
    const confirmation = page.getByRole("status").filter({ hasText: "Invitations sent to" });
    await expect(confirmation).toContainText(`Invitations sent to ${q1.displayName} and ${q2.displayName}.`);
    await expect(confirmation).toContainText("3 of 3 invitations used.");
    await expect(suggestionCard(page, q1.displayName).getByText("Invited", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: `Invite ${q1.displayName}` })).toHaveCount(0);
    const rows = invitationRows(id);
    expect(rows.filter((row) => row.source === "suggestions").map((row) => row.organization_id).sort()).toEqual([q1.id, q2.id].sort());
    expect(rows.filter((row) => row.source === "suggestions").every((row) => row.criteria && row.status === "invited")).toBe(true);
    expect(queued(q1.owner.id, "invitation_received")).toBe(1);
    await expectNoAxeViolations(page);

    // A member reads the cards and the statuses, without checkboxes or Invite (FR-M3 AC7).
    const member = await addMember(team, "member");
    const memberView = await newVisitor(browser);
    await signInAtAal1(memberView.page, member.user, `${requirementUrl(team.slug, id)}/partners`);
    await expect(suggestionCard(memberView.page, q1.displayName).getByText("Invited", { exact: true })).toBeVisible();
    await expect(memberView.page.getByRole("checkbox")).toHaveCount(0);
    await expect(memberView.page.getByRole("button", { name: /^Invite selected/ })).toHaveCount(0);
    await memberView.context.close();

    // The profile of a fourth partner: Invite, choose the requirement, and the upgrade prompt; nothing is written.
    await page.goto(`/en/partners/${q3.slug}`);
    const invite = page.getByRole("button", { name: `Invite ${q3.displayName}`, exact: true });
    await waitForHydration(invite);
    await invite.click();
    const dialog = page.getByRole("dialog", { name: `Invite ${q3.displayName} to a requirement` });
    await expect(dialog.getByRole("radio", { name: "Limassol welders" })).toBeChecked();
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    const prompt = dialog.getByRole("alert");
    await expect(prompt).toContainText("3 of 3 invitations on your Basic plan.");
    await expect(prompt).toContainText(`${q3.displayName} was not invited.`);
    await expect(prompt.getByRole("link", { name: "Upgrade your plan" })).toHaveAttribute("href", `/en/org/${team.slug}/billing`);
    expect(invitationRows(id).some((row) => row.organization_id === q3.id)).toBe(false);
    await expect
      .poll(() =>
        query<{ n: number }>(
          `select count(*)::integer as n from audit.log where action = 'limit.prompt_shown' and entity_id = ${literal(team.id)}
             and metadata ->> 'requirement_id' = ${literal(id)}`,
        )[0].n,
      )
      .toBe(1);
  });
});

test.describe("Inviting a saved partner (FR-O1 AC12, FR-L4)", () => {
  test("the owner invites a saved partner from the saved partners, and the dialog then names the invitation", async ({ page }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    subscribe(team, "employer_professional");
    const saved = await listedPartner();
    const id = seedRequirement(team, "Kyrenia welders");
    execute(
      `insert into public.saved_items (organization_id, target_organization_id, saved_by)
       values (${literal(team.id)}, ${literal(saved.id)}, ${literal(team.owner.id)})`,
    );

    await signInAtAal2(page, team.owner, team.ownerSecret, `/en/org/${team.slug}/saved-partners`);
    const invite = page.getByRole("button", { name: `Invite ${saved.displayName}`, exact: true });
    await waitForHydration(invite);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await invite.click();
    const dialog = page.getByRole("dialog", { name: `Invite ${saved.displayName} to a requirement` });
    await expect(dialog.getByRole("radio", { name: "Kyrenia welders" })).toBeChecked();
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`${saved.displayName} is invited by ${displayName(team.id)}`, { exact: true })).toBeVisible();
    await expect(page.getByText("1 of 10 invitations used.", { exact: true })).toBeVisible();
    expect(invitationRows(id)).toMatchObject([{ organization_id: saved.id, status: "invited", source: "saved" }]);

    await page.reload();
    await page.getByRole("button", { name: `Invite ${saved.displayName}`, exact: true }).click();
    const again = page.getByRole("dialog", { name: `Invite ${saved.displayName} to a requirement` });
    await expect(again.getByRole("list", { name: "Requirements this partner is invited to" })).toHaveText("Kyrenia welders: Invited");
    await expect(again).toContainText(`${saved.displayName} already has an invitation to each of your open requirements.`);
    await expect(again.getByRole("radio")).toHaveCount(0);
  });
});

test.describe("Inviting for the right employer (FR-O1 AC12)", () => {
  test("a user managing two employers invites for the one with an open requirement, and ?for= puts the page's employer first", async ({ page }) => {
    test.setTimeout(240_000);
    const first = await newTeam();
    const second = await newTeam();
    joinTeam(second, first.owner, "admin");
    subscribe(second, "employer_professional");
    subscribe(first, "employer_professional");
    const secondName = displayName(second.id);
    const p1 = await listedPartner();
    const p2 = await listedPartner();
    const secondRequirement = seedRequirement(second, "Famagusta welders");

    // The first employer joined has no open requirement: Invite is still offered, for the second one.
    await signInAtAal2(page, first.owner, first.ownerSecret, requirementUrl(second.slug, secondRequirement));
    await page.goto(`/en/partners/${p1.slug}`);
    const invite = page.getByRole("button", { name: `Invite ${p1.displayName}`, exact: true });
    await waitForHydration(invite);
    await invite.click();
    const dialog = page.getByRole("dialog", { name: `Invite ${p1.displayName} to a requirement` });
    const group = dialog.getByRole("radiogroup", { name: `Open requirements of ${secondName}` });
    await expect(group.getByRole("radio", { name: "Famagusta welders" })).toBeChecked();
    await expect(group).toContainText("0 of 10 invitations used");
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`${p1.displayName} is invited by ${secondName}`, { exact: true })).toBeVisible();
    expect(
      query<{ employer: string; source: string }>(
        `select employer_organization_id as employer, source from public.requirement_invitations where organization_id = ${literal(p1.id)}`,
      ),
    ).toEqual([{ employer: second.id, source: "profile" }]);

    // With open requirements at both, the employer named by ?for= comes first and its only requirement is chosen.
    seedRequirement(first, "Kantara welders");
    await page.goto(`/en/partners/${p2.slug}?for=${second.slug}`);
    const again = page.getByRole("button", { name: `Invite ${p2.displayName}`, exact: true });
    await waitForHydration(again);
    await again.click();
    const groups = page.getByRole("dialog", { name: `Invite ${p2.displayName} to a requirement` }).getByRole("radiogroup");
    await expect(groups).toHaveCount(2);
    await expect(groups.first()).toHaveAccessibleName(`Open requirements of ${secondName}`);
    await expect(page.getByRole("radio", { name: "Famagusta welders" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Kantara welders" })).not.toBeChecked();
    await expectNoAxeViolations(page);
  });
});

test.describe("Following and withdrawing invitations (FR-O1 AC9, AC10)", () => {
  test("AC9: a member reads each status and the counter; the owner withdraws one after a confirmation; an empty requirement leads to partners", async ({ page, browser }) => {
    test.setTimeout(300_000);
    const team = await newTeam();
    subscribe(team, "employer_professional");
    const partners = await Promise.all(Array.from({ length: 6 }, () => listedPartner()));
    const [invited, viewed, accepted, declined, responded, withdrawn] = partners;
    const id = seedRequirement(team, "Paphos welders");
    const invitedId = seedInvitation(team, id, invited.id, "invited");
    seedInvitation(team, id, viewed.id, "viewed");
    seedInvitation(team, id, accepted.id, "accepted");
    seedInvitation(team, id, declined.id, "declined", REASON);
    seedInvitation(team, id, responded.id, "responded");
    seedInvitation(team, id, withdrawn.id, "withdrawn");
    const empty = seedRequirement(team, "Nicosia welders");

    const member = await addMember(team, "member");
    await signInAtAal1(page, member.user, invitationsUrl(team.slug, id));
    await expect(page.getByRole("heading", { name: "Invitations", level: 1 })).toBeVisible();
    await expect(page.getByText("5 of 10 invitations used on your Professional plan.", { exact: true })).toBeVisible();
    for (const [partner, label] of [
      [invited, "Invited"],
      [viewed, "Invited (seen)"],
      [accepted, "Accepted"],
      [declined, "Declined"],
      [responded, "Responded"],
      [withdrawn, "Withdrawn"],
    ] as const) {
      await expect(invitedPartner(page, partner.displayName).getByText(label, { exact: true })).toBeVisible();
    }
    await expect(invitedPartner(page, declined.displayName)).toContainText(`Reason: ${REASON}`);
    await expect(invitedPartner(page, invited.displayName).getByRole("link", { name: invited.displayName })).toHaveAttribute(
      "href",
      `/en/partners/${invited.slug}?for=${team.slug}`,
    );
    await expect(page.getByRole("button", { name: /^Withdraw/ })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    const owner = await newVisitor(browser);
    await signInAtAal2(owner.page, team.owner, team.ownerSecret, invitationsUrl(team.slug, id));
    await expect(owner.page.getByRole("button", { name: /^Withdraw the invitation of/ })).toHaveCount(3);
    const withdraw = owner.page.getByRole("button", { name: `Withdraw the invitation of ${invited.displayName}` });
    await waitForHydration(withdraw);
    await withdraw.click();
    const dialog = owner.page.getByRole("dialog", { name: `Withdraw the invitation of ${invited.displayName}?` });
    await expectNoAxeViolations(owner.page);
    await dialog.getByRole("button", { name: "Withdraw invitation" }).click();
    await expect(owner.page.getByText(`The invitation of ${invited.displayName} is withdrawn`, { exact: true })).toBeVisible();
    await expect(invitedPartner(owner.page, invited.displayName).getByText("Withdrawn", { exact: true })).toBeVisible();
    await expect(owner.page.getByRole("heading", { name: "Invitations", level: 1 })).toBeFocused();
    await expect(owner.page.getByText("4 of 10 invitations used on your Professional plan.", { exact: true })).toBeVisible();
    await expect(owner.page.getByRole("button", { name: /^Withdraw the invitation of/ })).toHaveCount(2);
    expect(query<{ status: string }>(`select status from public.requirement_invitations where id = ${literal(invitedId)}`)[0].status).toBe("withdrawn");
    expect(audits("requirement.invitation_withdrawn", invitedId)).toBe(1);
    expect(queued(invited.owner.id, "invitation_withdrawn")).toBe(1);

    await owner.page.goto(invitationsUrl(team.slug, empty));
    const none = owner.page.getByRole("heading", { name: "No partners invited yet" });
    await expect(none).toBeVisible();
    await expect(owner.page.getByRole("link", { name: "Find partners" })).toHaveAttribute("href", "/en/partners/recruitment");
    await expect(owner.page.getByRole("link", { name: "Suggested partners" })).toHaveAttribute("href", `${requirementUrl(team.slug, empty)}/partners`);
    await expectNoAxeViolations(owner.page);
    await owner.context.close();

    // A failed read: the toast, the message and a retry.
    execute(`revoke execute on function ${LIST_FUNCTION} from authenticated`);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "The invitations could not be loaded" })).toBeVisible();
      await expect(page.getByText("Check your connection and try again.", { exact: true })).toBeVisible();
      await expectNoAxeViolations(page);
    } finally {
      execute(`grant execute on function ${LIST_FUNCTION} to authenticated`);
    }
    const retry = page.getByRole("button", { name: "Try again" });
    await waitForHydration(retry);
    await retry.click();
    await expect(page.getByRole("heading", { name: "Invitations", level: 1 })).toBeVisible();
  });
});

test.describe("The invited partner (FR-O1 AC8, AC11, NFR-S11)", () => {
  test("AC8, AC11: invited from the profile, the partner lands from its notification and email, accepts one, declines the other with a reason; a competitor gets the 404", async ({ page, browser }) => {
    test.setTimeout(360_000);
    const team = await newTeam();
    subscribe(team, "employer_professional");
    const employer = displayName(team.id);
    const p1 = await listedPartner();
    const p2 = await listedPartner();
    const privateId = seedRequirement(team, "Private Larnaca welders");
    const anonymousId = seedRequirement(team, "Anonymous Larnaca welders", "job_order_marketplace");

    // The owner invites P1 from its profile to both requirements; the second dialog names the first invitation.
    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, privateId));
    await page.goto(`/en/partners/${p1.slug}`);
    const invite = page.getByRole("button", { name: `Invite ${p1.displayName}`, exact: true });
    await waitForHydration(invite);
    await invite.click();
    let dialog = page.getByRole("dialog", { name: `Invite ${p1.displayName} to a requirement` });
    await dialog.getByRole("radio", { name: "Private Larnaca welders" }).check();
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`${p1.displayName} is invited by ${employer}`, { exact: true })).toBeVisible();
    await invite.click();
    dialog = page.getByRole("dialog", { name: `Invite ${p1.displayName} to a requirement` });
    await expect(dialog.getByRole("list", { name: "Requirements this partner is invited to" })).toHaveText("Private Larnaca welders: Invited");
    await expect(dialog.getByRole("radio")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`${p1.displayName} is invited by ${employer}`, { exact: true }).last()).toBeVisible();
    const [privateInvitation] = query<{ id: string; source: string }>(
      `select id, source from public.requirement_invitations where requirement_id = ${literal(privateId)} and organization_id = ${literal(p1.id)}`,
    );
    const [anonymousInvitation] = query<{ id: string }>(
      `select id from public.requirement_invitations where requirement_id = ${literal(anonymousId)} and organization_id = ${literal(p1.id)}`,
    );
    expect(privateInvitation.source).toBe("profile");

    // AC11: one English email per owner, naming the requirement and the employer, linking the invitation, no member of Acme.
    await runNotify();
    const email = await waitForMessage(p1.owner.email, { subject: "Invitation to a workforce requirement: Anonymous Larnaca welders" });
    expect(email.Text).toContain(`${employer} invited your company to "Anonymous Larnaca welders" in Cyprus.`);
    expect(email.Text).toContain("Workers needed: 100. Start: 1 March 2027.");
    expect(email.Text).toContain(`${SITE}/en/org/${p1.slug}/invitations/${anonymousInvitation.id}`);
    expect(`${email.Subject}\n${email.Text}\n${email.HTML}`).not.toContain(team.owner.email);
    expect(
      query<{ status: string }>(
        `select status from public.notifications where user_id = ${literal(p1.owner.id)} and kind = 'invitation_received' and payload ->> 'invitation_id' = ${literal(anonymousInvitation.id)}`,
      )[0].status,
    ).toBe("sent");

    // The notification of the owner lands on the invitation, which the first open marks seen.
    const partnerOwner = await newVisitor(browser);
    await signInAtAal1(partnerOwner.page, p1.owner, "/en/notifications");
    const item = partnerOwner.page.getByRole("link", { name: `${employer} invited your company to "Private Larnaca welders"` });
    await waitForHydration(item);
    await item.click();
    await expect(partnerOwner.page).toHaveURL(invitationUrl(p1.slug, privateInvitation.id));
    await expect(partnerOwner.page.getByRole("heading", { name: "Private Larnaca welders", level: 1 })).toBeVisible();
    expect(query<{ status: string }>(`select status from public.requirement_invitations where id = ${literal(privateInvitation.id)}`)[0].status).toBe("viewed");
    await partnerOwner.context.close();

    // A member of P1 reads the inbox and filters it.
    const member = await addMember({ id: p1.id, slug: p1.slug, owner: p1.owner, ownerSecret: "" }, "member");
    const partner = await newVisitor(browser);
    const pp = partner.page;
    await signInAtAal1(pp, member.user, inboxUrl(p1.slug));
    await expect(pp.getByRole("heading", { name: "Invitations", level: 1 })).toBeVisible();
    const inbox = pp.getByRole("list", { name: "Invitations" });
    await expect(inbox.getByRole("heading", { level: 2 })).toHaveText(["Anonymous Larnaca welders", "Private Larnaca welders"]);
    const anonymousRow = inbox.getByRole("listitem").filter({ hasText: "Anonymous Larnaca welders" });
    await expect(anonymousRow.getByText("New", { exact: true })).toBeVisible();
    await expect(anonymousRow).toContainText(employer);
    await expect(anonymousRow).toContainText("Cyprus · 100 workers · Starts 1 March 2027");
    await expect(inbox.getByRole("listitem").filter({ hasText: "Private Larnaca welders" }).getByText("Not answered", { exact: true })).toBeVisible();
    await expectAccessibleAtBothWidths(pp);
    await pp.setViewportSize({ width: 1280, height: 900 });
    await pp.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: "New", exact: true }).click();
    await expect(pp).toHaveURL(`${inboxUrl(p1.slug)}?status=invited`);
    await expect(inbox.getByRole("heading", { level: 2 })).toHaveText(["Anonymous Larnaca welders"]);

    // AC8: the private requirement in full with the employer, accepted by keyboard.
    await pp.goto(invitationUrl(p1.slug, privateInvitation.id));
    const main = pp.getByRole("main");
    await expect(main).toContainText(`${employer} invited your company on`);
    await expect(main).toContainText("7212 · Welders and flame cutters");
    await expect(main).toContainText("Limassol, Cyprus");
    await expect(main).toContainText("Salary or budget");
    await expect(main).toContainText("Read the requirement, then accept or decline the invitation.");
    await expectAccessibleAtBothWidths(pp);
    await pp.setViewportSize({ width: 1280, height: 900 });
    const accept = pp.getByRole("button", { name: "Accept", exact: true });
    await waitForHydration(accept);
    await accept.focus();
    await pp.keyboard.press("Enter");
    // Accept opens the response form of FR-O2 (V46); the invitation page then shows the new status.
    await expect(pp).toHaveURL(`${invitationUrl(p1.slug, privateInvitation.id)}/respond`);
    await expect(pp.getByRole("heading", { name: "Respond to this invitation", level: 1 })).toBeVisible();
    await pp.goto(invitationUrl(p1.slug, privateInvitation.id));
    await expect(pp.getByRole("region", { name: "Status" }).getByText("Accepted", { exact: true })).toBeVisible();
    await expect(pp.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    expect(query<{ status: string }>(`select status from public.requirement_invitations where id = ${literal(privateInvitation.id)}`)[0].status).toBe("accepted");
    expect(audits("requirement.invitation_accepted", privateInvitation.id)).toBe(1);

    // AC8: the second invitation declined with a reason after the confirmation; afterwards only its title shows.
    await pp.goto(invitationUrl(p1.slug, anonymousInvitation.id));
    const decline = pp.getByRole("button", { name: "Decline", exact: true });
    await waitForHydration(decline);
    await decline.click();
    const declineDialog = pp.getByRole("dialog", { name: "Decline this invitation?" });
    await declineDialog.getByLabel("Reason (optional)").fill(REASON);
    await expectNoAxeViolations(pp);
    await declineDialog.getByRole("button", { name: "Decline invitation" }).click();
    await expect(pp.getByText("You declined the invitation", { exact: true })).toBeVisible();
    const status = pp.getByRole("region", { name: "Status" });
    await expect(status.getByText("Declined", { exact: true })).toBeVisible();
    await expect(pp.getByRole("heading", { name: "Status", level: 2 })).toBeFocused();
    await expect(status).toContainText(`Your reason: ${REASON}`);
    await expect(pp.getByText("This invitation is closed, so only its title and the employer are shown.", { exact: true })).toBeVisible();
    await pp.reload();
    await expect(main).not.toContainText("Welders and flame cutters");
    await expect(main).not.toContainText("Limassol");
    await expect(main).toContainText(employer);
    await expectAccessibleAtBothWidths(pp);
    const [declinedRow] = invitationRows(anonymousId);
    expect(declinedRow).toMatchObject({ status: "declined", decline_reason: REASON });
    expect(audits("requirement.invitation_declined", anonymousInvitation.id)).toBe(1);
    await partner.context.close();

    // The employer reads both answers (AC9).
    await page.goto(invitationsUrl(team.slug, anonymousId));
    await expect(invitedPartner(page, p1.displayName)).toContainText(`Reason: ${REASON}`);

    // A competing partner: the neutral 404 for the address, an empty inbox, nothing of the requirement (NFR-S11).
    const competitor = await newVisitor(browser);
    await signInAtAal1(competitor.page, p2.owner, invitationUrl(p2.slug, privateInvitation.id));
    await expect(competitor.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(competitor.page.getByRole("main")).not.toContainText("Larnaca");
    await expect(competitor.page.getByRole("main")).not.toContainText(employer);
    expect(await competitor.page.content()).not.toContain(employer);
    await competitor.page.goto(inboxUrl(p2.slug));
    await expect(competitor.page.getByRole("heading", { name: "No invitations yet" })).toBeVisible();
    await expect(competitor.page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Invitations" })).toHaveAttribute(
      "href",
      inboxUrl(p2.slug),
    );
    await expectNoAxeViolations(competitor.page);

    // Release 2b off: the pages and the link are gone.
    setJobOrderRelease(false);
    try {
      await competitor.page.reload();
      await expect(competitor.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await expect(competitor.page.getByRole("link", { name: "Invitations" })).toHaveCount(0);
    } finally {
      setJobOrderRelease(true);
    }
    await competitor.context.close();
  });
});
