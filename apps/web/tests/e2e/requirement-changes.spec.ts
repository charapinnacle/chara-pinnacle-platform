import { randomUUID } from "node:crypto";
import { displayName, expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { waitForMessage } from "./support/mailpit";
import { runNotify } from "./support/notify";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { SITE } from "./support/seo";
import { addMember, newTeam, newVisitor, signInAtAal1, signInAtAal2, subscribe, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// Requirement versions and the notices to invited partners (V43, FR-M2 steps Edit and Expire, AC6 partner part, AC8,
// AC10 closing notice; NFR-U3, NFR-U4, NFR-S11): the owner edits a published requirement through the form and reads the
// change history on the requirement page; the invited partner lands on the changes of its invitation page from its
// notification and its email; a declined partner hears nothing; the closing reminder and the closing notice land on the
// invitation. Release 2b is switched on for the whole database, so this file is a project of its own after the
// invitation pages, and its tests run one after the other. The requirements are in Malta, which no other spec uses.

const MALTA = "MT";
const requirementUrl = (slug: string, id: string) => `/en/org/${slug}/requirements/${id}`;
const invitationUrl = (slug: string, id: string) => `/en/org/${slug}/invitations/${id}`;

type Partner = { id: string; slug: string; displayName: string; owner: TestUser };

function setJobOrderRelease(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = 'release_job_orders'`);
}

function setNoticeMinutes(minutes: number): void {
  execute(`update private.settings set value = '${minutes}' where key = 'requirement_change_notice_minutes'`);
}

async function listedPartner(): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)}`,
  );
  return { id, slug, displayName: displayName(id), owner: user };
}

// An open requirement of the team in Valletta: 100 welders (7212) from 1 March 2027, salary 2,500 to 3,400 EUR a month.
function seedRequirement(team: Pick<Team, "id" | "owner">, title: string, closesOn = "2027-03-31"): string {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, salary_min, salary_max, salary_currency, salary_period, recruitment_preference,
       partner_need, created_by, status, visibility, show_identity, published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, ${literal(title)}, 100, ${literal(MALTA)}, 'Valletta', 'C', date '2027-03-01', 12,
       'full_time', 2500, 3400, 'EUR', 'month', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', 'private', false,
       now(), ${literal(closesOn)}::date);
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 100);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(MALTA)})`,
  );
  return id;
}

function seedInvitation(team: Pick<Team, "id">, requirement: string, partner: string, status: "invited" | "declined"): string {
  const id = randomUUID();
  const answered = status === "declined" ? "now()" : "null::timestamptz";
  execute(
    `insert into public.requirement_invitations (id, requirement_id, organization_id, employer_organization_id, source, status, viewed_at, answered_at)
     values (${literal(id)}, ${literal(requirement)}, ${literal(partner)}, ${literal(team.id)}, 'directory',
       ${literal(status)}::public.invitation_status, ${answered}, ${answered})`,
  );
  return id;
}

function queued(userId: string, kind: string): number {
  return query<{ n: number }>(
    `select count(*)::integer as n from public.notifications where user_id = ${literal(userId)} and kind = ${literal(kind)}`,
  )[0].n;
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  execute(`delete from public.workforce_requirements where country_code = ${literal(MALTA)}`);
  setPartnerRelease(true);
  setJobOrderRelease(true);
});
test.afterAll(() => {
  setNoticeMinutes(15);
  setJobOrderRelease(false);
  setPartnerRelease(false);
});

test.describe("Changes to a published requirement (FR-M2 step Edit, AC8)", () => {
  test("AC8: the owner edits through the form and reads the history; the invited partner lands on the changes from its notification and email; a declined partner hears nothing", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    setNoticeMinutes(0);
    const team = await newTeam();
    subscribe(team, "employer_professional");
    const employer = displayName(team.id);
    const p1 = await listedPartner();
    const p3 = await listedPartner();
    const outsider = await listedPartner();
    const id = seedRequirement(team, "Valletta welders");
    const invitation = seedInvitation(team, id, p1.id, "invited");
    const declined = seedInvitation(team, id, p3.id, "declined");

    await signInAtAal2(page, team.owner, team.ownerSecret, requirementUrl(team.slug, id));
    const history = page.getByRole("region", { name: "Change history" });
    await expect(history).toContainText("No changes since publication.");

    await page.getByRole("link", { name: "Edit workforce requirement" }).click();
    await expect(page.getByText("the partners you invited are told which fields changed", { exact: false })).toBeVisible();
    const workers = page.getByLabel("Number of workers", { exact: true });
    await waitForHydration(workers);
    await workers.fill("120");
    await page.getByLabel("Quantity of Welders and flame cutters", { exact: true }).fill("120");
    await page.getByLabel("Salary maximum").fill("3600");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(requirementUrl(team.slug, id));

    const entries = history.getByRole("listitem");
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText("Changed on");
    for (const text of [
      "Number of workers",
      "Before: 100 workers",
      "After: 120 workers",
      "Occupations",
      "Before: 7212 · Welders and flame cutters: 100 workers",
      "After: 7212 · Welders and flame cutters: 120 workers",
      "Salary maximum",
      "Before: 3,400",
      "After: 3,600",
    ]) {
      await expect(entries.first()).toContainText(text);
    }
    expect(
      query<{ fields: string; by: string }>(
        `select changed_fields::text as fields, changed_by::text as by from public.requirement_versions where requirement_id = ${literal(id)}`,
      ),
    ).toEqual([{ fields: "{workers_needed,occupations,salary_max}", by: team.owner.id }]);
    await expectAccessibleAtBothWidths(page);

    // A member reads the same history.
    const member = await addMember(team, "member");
    const memberView = await newVisitor(browser);
    await signInAtAal1(memberView.page, member.user, requirementUrl(team.slug, id));
    await expect(memberView.page.getByRole("region", { name: "Change history" }).getByRole("listitem")).toHaveCount(1);
    await memberView.context.close();

    // The invited partner: one notice naming the fields, landing on the changes of the invitation.
    expect(queued(p1.owner.id, "requirement_changed")).toBe(1);
    expect(queued(p3.owner.id, "requirement_changed")).toBe(0);
    expect(queued(outsider.owner.id, "requirement_changed")).toBe(0);
    expect(queued(team.owner.id, "requirement_changed")).toBe(0);
    await runNotify();
    const email = await waitForMessage(p1.owner.email, { subject: "Workforce requirement changed: Valletta welders" });
    expect(email.Text).toContain(`${employer} changed "Valletta welders", which your company is invited to.`);
    expect(email.Text).toContain("Changed: Number of workers, Occupations and Salary maximum.");
    expect(email.Text).toContain(`${SITE}/en/org/${p1.slug}/invitations/${invitation}#changes`);
    for (const value of ["3600", "3,600"]) expect(`${email.Subject}\n${email.Text}\n${email.HTML}`).not.toContain(value);
    expect(`${email.Subject}\n${email.Text}\n${email.HTML}`).not.toContain(team.owner.email);

    const partner = await newVisitor(browser);
    await signInAtAal1(partner.page, p1.owner, "/en/notifications");
    const item = partner.page.getByRole("link", {
      name: `${employer} changed "Valletta welders": Number of workers, Occupations and Salary maximum`,
    });
    await waitForHydration(item);
    // An invited partner without a response files the change under Invitations; a responder under Responses.
    await expect(partner.page.getByRole("listitem").filter({ has: item })).toContainText("Invitations");
    await item.click();
    await expect(partner.page).toHaveURL(`${invitationUrl(p1.slug, invitation)}#changes`);
    const changes = partner.page.getByRole("region", { name: "Changes since you were invited" });
    await expect(changes).toBeFocused();
    await expect(changes.getByRole("listitem")).toHaveCount(1);
    await expect(changes).toContainText("Before: 100 workers");
    await expect(changes).toContainText("After: 120 workers");
    await expect(changes).not.toContainText(" by ");
    await expectAccessibleAtBothWidths(partner.page);
    await partner.context.close();

    // The declined partner reads no change on its invitation.
    const other = await newVisitor(browser);
    await signInAtAal1(other.page, p3.owner, invitationUrl(p3.slug, declined));
    await expect(other.page.getByRole("heading", { name: "Valletta welders", level: 1 })).toBeVisible();
    await expect(other.page.getByRole("region", { name: "Changes since you were invited" })).toHaveCount(0);
    await other.context.close();
  });
});

test.describe("Closing notices to invited partners (FR-M2 step Expire, AC6, AC10)", () => {
  test("AC6, AC10: the closing reminder and then the closing notice land on the partner's invitation", async ({ page }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    subscribe(team, "employer_professional");
    const p1 = await listedPartner();
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const id = seedRequirement(team, "Valletta fitters", soon);
    const invitation = seedInvitation(team, id, p1.id, "invited");

    execute("select private.remind_closing_requirements()");
    expect(queued(p1.owner.id, "requirement_closing_soon")).toBe(1);
    await signInAtAal1(page, p1.owner, "/en/notifications");
    const reminder = page.getByRole("link", { name: /^"Valletta fitters" closes on / });
    await waitForHydration(reminder);
    await expectNoAxeViolations(page);
    await reminder.click();
    await expect(page).toHaveURL(invitationUrl(p1.slug, invitation));
    await expect(page.getByRole("heading", { name: "Valletta fitters", level: 1 })).toBeVisible();

    execute(`update public.workforce_requirements set closes_on = (now() at time zone 'utc')::date - 1 where id = ${literal(id)}`);
    execute("select private.close_expired_requirements()");
    expect(query<{ status: string }>(`select status from public.requirement_invitations where id = ${literal(invitation)}`)[0].status).toBe("expired");
    expect(queued(p1.owner.id, "requirement_closed")).toBe(1);
    await page.goto("/en/notifications");
    const closed = page.getByRole("link", { name: '"Valletta fitters" is closed' });
    await waitForHydration(closed);
    await closed.click();
    await expect(page).toHaveURL(invitationUrl(p1.slug, invitation));
    await expect(page.getByText("This invitation is closed, so only its title and the employer are shown.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Changes since you were invited" })).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
  });
});
