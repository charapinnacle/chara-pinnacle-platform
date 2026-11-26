import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal } from "./support/db";
import { createCommittedUser } from "./support/login";
import { createCommittedPartner, partnerWithCompany, setPartnerRelease } from "./support/partners";
import { seedAllButCv, signIn } from "./support/passport";
import { signInBrowser } from "./support/session";
import { addMember, newTeam, signInWithCode, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// The release 2c blocks of the dashboards (V75; FR-R3, FR-R4, FR-R5 release 2c parts, FR-Q1 AC10; NFR-U3, NFR-U4): the
// employer's matching workers, inquiries and unread messages, the free plan's notice, the recruitment company's partner
// requests and unread messages, and the worker's contact requests. Releases 2a and 2c are switched on for the whole
// database, so this file is a project of its own after the direct-hiring rules. The matching workers prefer
// Liechtenstein, which no other spec uses, so the counts are this file's own.

const LIECHTENSTEIN = "LI";
const QUESTION = "Who can help me fill my workforce requirement?";

function setRelease(key: "release_messaging" | "release_find_workers", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

// A welder visible in Find Workers who would work in Liechtenstein.
async function visibleWorker(): Promise<TestUser> {
  const user = await createCommittedUser("worker");
  seedAllButCv(user.id);
  execute(
    `update public.worker_profiles set occupation_id = '7212', current_country = 'NG' where user_id = ${literal(user.id)};
     insert into public.worker_preferred_countries (worker_user_id, country_code) values (${literal(user.id)}, ${literal(LIECHTENSTEIN)});
     insert into public.consents (user_id, purpose, version, action)
       values (${literal(user.id)}, 'worker-visibility-consent', private.current_legal_version('worker-visibility-consent'), 'granted');
     update public.worker_profiles set searchable = true where user_id = ${literal(user.id)}`,
  );
  return user;
}

function subscribe(organizationId: string, plan: string): void {
  execute(
    `insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(organizationId)}, ${literal(plan)}, 'active', 'null')`,
  );
}

// An open requirement of the team for welders in Liechtenstein, as publish_requirement leaves it.
function seedRequirement(team: Team): void {
  const id = randomUUID();
  execute(
    `insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
       start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
       published_at, closes_on)
     values (${literal(id)}, ${literal(team.id)}, 'Welders for Vaduz', 5, ${literal(LIECHTENSTEIN)}, 'Vaduz', 'C', date '2027-03-01', 12,
       'full_time', 'international', 'both', ${literal(team.owner.id)}, 'open', 'job_order_marketplace', false, now() - interval '1 hour',
       date '2027-03-31');
     insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(id)}, '7212', 5);
     insert into public.requirement_countries (requirement_id, country_code) values (${literal(id)}, ${literal(LIECHTENSTEIN)})`,
  );
}

// An inquiry of the employer to the partner, waiting, in its conversation with one message of the employer, as
// send_inquiry leaves it.
function seedInquiry(team: Team, partnerId: string): void {
  const conversation = randomUUID();
  const connection = randomUUID();
  execute(
    `insert into public.conversations (id, context_type, context_id, opened_by) values (${literal(conversation)}, 'inquiry', ${literal(connection)}, ${literal(team.owner.id)});
     insert into public.conversation_participants (conversation_id, organization_id)
       values (${literal(conversation)}, ${literal(team.id)}), (${literal(conversation)}, ${literal(partnerId)});
     insert into public.connections (id, kind, from_organization_id, to_organization_id, conversation_id, created_by)
       values (${literal(connection)}, 'inquiry', ${literal(team.id)}, ${literal(partnerId)}, ${literal(conversation)}, ${literal(team.owner.id)});
     insert into public.messages (conversation_id, sender_user_id, sender_organization_id, kind, body, connection_id)
       values (${literal(conversation)}, ${literal(team.owner.id)}, ${literal(team.id)}, 'inquiry',
         'We need twenty welders for Vaduz from March. Can you help?', ${literal(connection)})`,
  );
}

const region = (page: Page, name: string) => page.getByRole("region", { name });

async function signedIn(browser: Browser, user: TestUser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  await signInBrowser(context, user);
  return { page: await context.newPage(), close: () => context.close() };
}

test.describe("Dashboard blocks of release 2c (V75)", () => {
  test.describe.configure({ mode: "serial" });
  let acme: Team;
  let partner: { user: TestUser; id: string; slug: string };
  let partnerMember: TestUser;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    setPartnerRelease(true);
    setRelease("release_messaging", true);
    setRelease("release_find_workers", true);
    acme = await newTeam();
    subscribe(acme.id, "employer_professional");
    seedRequirement(acme);
    for (let index = 0; index < 5; index += 1) await visibleWorker();
    partner = await partnerWithCompany("recruitment_company");
    execute(
      `update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
       where id = ${literal(partner.id)}`,
    );
    subscribe(partner.id, "recruitment_partner");
    partnerMember = await createCommittedPartner("recruitment_company");
    execute(
      `insert into public.organization_members (organization_id, user_id, role, accepted_at) values (${literal(partner.id)}, ${literal(partnerMember.id)}, 'member', now())`,
    );
    seedInquiry(acme, partner.id);
  });

  test.afterAll(() => {
    execute(
      `update public.worker_profiles set searchable = false
       where user_id in (select worker_user_id from public.worker_preferred_countries where country_code = ${literal(LIECHTENSTEIN)})`,
    );
    setRelease("release_find_workers", false);
    setRelease("release_messaging", false);
    setPartnerRelease(false);
  });

  test("FR-R5 AC5, AC6: the employer reads the matching workers and its inquiry, each with its next action", async ({ page }) => {
    test.setTimeout(150_000);
    const url = `/en/dashboard/employer?org=${acme.slug}`;
    await signInWithCode(page, acme.owner, acme.ownerSecret, url);
    const network = region(page, QUESTION);
    const matching = network.getByRole("region", { name: "Matching workers" });
    await expect(matching).toContainText("5 workers who chose to be visible match your requirements.");
    await expect(matching.getByRole("link", { name: "Find workers" })).toHaveAttribute("href", `/en/org/${acme.slug}/find-workers`);
    await expect(matching).not.toContainText("Electrician");
    const requests = network.getByRole("region", { name: "Inquiries and workforce requests" });
    await expect(requests.getByRole("term").filter({ hasText: "Waiting for the partner's answer" }).locator("xpath=following-sibling::dd[1]")).toHaveText("1");
    await expect(requests.getByRole("link", { name: "See your conversations" })).toHaveAttribute("href", `/en/org/${acme.slug}/messages`);
    await expect(network.getByRole("region", { name: "Unread messages" })).toContainText("No unread messages.");
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-R5 AC6: an employer without Find Workers in its plan is offered the upgrade, not a count", async ({ page }) => {
    test.setTimeout(150_000);
    const free = await newTeam();
    seedRequirement(free);
    const url = `/en/dashboard/employer?org=${free.slug}`;
    await signInWithCode(page, free.owner, free.ownerSecret, url);
    const matching = region(page, "Matching workers");
    await expect(matching).toContainText("Find Workers is included in paid plans.");
    await expect(matching.getByRole("link", { name: "Upgrade your plan" })).toHaveAttribute("href", `/en/org/${free.slug}/billing`);
    await expect(matching).not.toContainText("workers who chose to be visible");
  });

  test("FR-R5 AC5: fewer than five matching workers are not counted out", async ({ browser }) => {
    test.setTimeout(150_000);
    execute(
      `update public.worker_profiles set searchable = false
       where user_id in (select worker_user_id from public.worker_preferred_countries where country_code = ${literal(LIECHTENSTEIN)}
                         order by worker_user_id limit 2)`,
    );
    const { user } = await addMember(acme, "member");
    const { page, close } = await signedIn(browser, user);
    await page.goto(`/en/dashboard/employer?org=${acme.slug}`);
    await expect(region(page, "Matching workers")).toContainText("Fewer than 5 workers match your requirements.");
    await close();
  });

  test("FR-R3, FR-R4 AC6: a member of the recruitment company reads the inquiry waiting and the unread message", async ({ browser }) => {
    test.setTimeout(150_000);
    const { page, close } = await signedIn(browser, partnerMember);
    await page.goto(`/en/dashboard/recruitment?org=${partner.slug}`);
    const activity = region(page, "Your activity");
    await expect(activity.getByRole("link", { name: /^1 Partner requests waiting/ })).toHaveAttribute(
      "href",
      `/en/org/${partner.slug}/messages?context=inquiry`,
    );
    await expect(activity.getByRole("link", { name: /^1 Unread messages/ })).toHaveAttribute("href", `/en/org/${partner.slug}/messages`);
    await expect(activity.getByRole("link", { name: /Matching workers/ })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await close();
  });

  test("the owner at aal1 is asked for the two-step check instead of the company's messages", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page, close } = await signedIn(browser, partner.user);
    await page.goto(`/en/dashboard/recruitment?org=${partner.slug}`);
    const unread = region(page, "Your activity").getByRole("link", { name: /Unread messages Complete the two-step check/ });
    await expect(unread).toHaveAttribute("href", /^\/en\/mfa\?next=/);
    await close();
  });

  test("FR-Q1 AC10: the worker's Find Workers card counts the contact requests, not a hidden one, and leads to them", async ({ page }) => {
    test.setTimeout(120_000);
    const worker = await visibleWorker();
    execute(
      `insert into public.contact_requests (organization_id, worker_user_id, card_id, sent_by, message, destination_country, expires_at)
       select ${literal(acme.id)}, w.user_id, w.card_id, ${literal(acme.owner.id)}, 'Welding work in Vaduz from March.', ${literal(LIECHTENSTEIN)},
              now() + interval '30 days'
       from public.worker_profiles w where w.user_id = ${literal(worker.id)};
       insert into public.contact_requests (organization_id, worker_user_id, card_id, sent_by, message, destination_country, expires_at,
                                            moderation_state)
       select ${literal(partner.id)}, w.user_id, w.card_id, ${literal(partner.user.id)}, 'Pay us and the job is yours.', ${literal(LIECHTENSTEIN)},
              now() + interval '30 days', 'hidden'
       from public.worker_profiles w where w.user_id = ${literal(worker.id)}`,
    );
    await signIn(page, worker);
    await page.goto("/en/dashboard/worker");
    const card = region(page, "Find Workers");
    await expect(card).toContainText("Visible in Find Workers");
    await expect(card).toContainText("1 contact request received, 1 waiting for your answer.");
    await expect(card.getByRole("link", { name: "Answer the contact requests" })).toHaveAttribute("href", "/en/contact-requests");
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-R3 AC6, FR-R5 AC7: the blocks leave with their releases", async ({ page }) => {
    test.setTimeout(120_000);
    setRelease("release_messaging", false);
    setRelease("release_find_workers", false);
    try {
      await signInWithCode(page, acme.owner, acme.ownerSecret, `/en/dashboard/employer?org=${acme.slug}`);
      await expect(page.getByRole("heading", { level: 2, name: QUESTION })).toBeVisible();
      for (const name of ["Matching workers", "Inquiries and workforce requests", "Unread messages"]) {
        await expect(region(page, name)).toHaveCount(0);
      }
    } finally {
      setRelease("release_messaging", true);
      setRelease("release_find_workers", true);
    }
  });
});
