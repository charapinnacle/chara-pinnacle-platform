import { randomUUID } from "node:crypto";
import { displayName, expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { choose } from "./support/combobox";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser } from "./support/login";
import { uniqueToken } from "./support/organizations";
import { seedAllButCv, signIn } from "./support/passport";
import { partnerWithCompany, type PartnerType } from "./support/partners";
import { addMember, newTeam, newVisitor, signInAtAal1, signInWithCode, subscribe, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";
import { pickDate } from "./support/date-picker";

// Structured connection actions (V71; FR-P2 AC1 to AC5, AC9, AC10; SOP P2-27 steps Send inquiry, Request workforce, Invite to
// job, Track; NFR-U3, NFR-U4): an employer member sends a listed partner an inquiry from its profile and lands in the
// conversation, a second inquiry points to the first; an owner at aal2 requests workforce from a staffing company; a
// visitor is asked to sign in; a member invites a worker of an accepted contact request to apply and the worker finds the
// Apply button, or the closed vacancy's notice; the Request workers page. Releases 2a, 2b and 2c's messaging are set for
// the whole database, so this file is a project of its own after the contact requests.

const RELEASES = ["release_partner_directories", "release_job_orders", "release_messaging"] as const;

function setReleases(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key in (${RELEASES.map(literal).join(", ")})`);
}

// A listed partner serving Germany, public on its profile; a recruitment company may list the staffing service.
async function listedPartner(type: PartnerType, services: string[] = []): Promise<{ id: string; slug: string; name: string }> {
  const { id, slug } = await partnerWithCompany(type);
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code)
     values (${literal(id)}, 'serves_market', 'DE'), (${literal(id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     ${services.map((service) => `insert into public.organization_service_types (organization_id, service) values (${literal(id)}, ${literal(service)});`).join("\n")}
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days',
       workforce_profile_updated_at = now() + interval '2 days'
     where id = ${literal(id)}`,
  );
  return { id, slug, name: displayName(id) };
}

function openVacancy(team: Team, title: string): string {
  return execute(
    `insert into public.jobs (organization_id, title, description, occupation_id, industry_code, country_code, city, employment_type,
                              recruitment_preference, status, created_by)
     values (${literal(team.id)}, ${literal(title)}, 'Line one of the description.' || chr(10) || 'Line two of it, which is long enough to pass the limit.',
             '7212', 'C', 'DE', 'Hamburg', 'full_time', 'both', 'open', ${literal(team.owner.id)})
     returning id`,
  ).trim();
}

// A worker in Nigeria who accepted a contact request of the team, and their conversation, as respond_to_contact_request
// leaves them.
async function acceptedWorker(team: Team): Promise<{ worker: TestUser; conversation: string; request: string }> {
  const worker = await createCommittedUser("worker");
  seedAllButCv(worker.id);
  const request = randomUUID();
  const conversation = randomUUID();
  execute(
    `update public.worker_profiles set first_name = 'Yusuf', last_name = 'Adeyemi', current_country = 'NG', occupation_id = '7212'
     where user_id = ${literal(worker.id)};
     insert into public.contact_requests (id, organization_id, worker_user_id, card_id, message, status, expires_at, responded_at)
     select ${literal(request)}, ${literal(team.id)}, w.user_id, w.card_id, 'Welding work in Hamburg.', 'accepted', now() + interval '30 days', now()
     from public.worker_profiles w where w.user_id = ${literal(worker.id)};
     insert into public.conversations (id, context_type, context_id) values (${literal(conversation)}, 'contact_request', ${literal(request)});
     insert into public.conversation_participants (conversation_id, organization_id, user_id)
     values (${literal(conversation)}, ${literal(team.id)}, null), (${literal(conversation)}, null, ${literal(worker.id)})`,
  );
  return { worker, conversation, request };
}

const profileUrl = (slug: string) => `/en/partners/${slug}`;

test.describe.configure({ mode: "serial" });
test.beforeAll(() => setReleases(true));
test.afterAll(() => setReleases(false));

test.describe("Structured connection actions (FR-P2)", () => {
  let acme: Team;
  let member: TestUser;
  let rekrut: { id: string; slug: string; name: string };
  let staffit: { id: string; slug: string; name: string };

  test.beforeAll(async () => {
    acme = await newTeam(`Acme Connect ${uniqueToken()}`);
    subscribe(acme, "employer_starter");
    ({ user: member } = await addMember(acme, "member"));
    rekrut = await listedPartner("recruitment_company");
    staffit = await listedPartner("staffing_company");
  });

  test("AC1, AC2, AC9: a member sends an inquiry from the profile, lands in the conversation and is pointed to it the second time", async ({ page }) => {
    test.setTimeout(240_000);
    await signInAtAal1(page, member, profileUrl(rekrut.slug));
    await expect(page.getByRole("button", { name: /^Save partner/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Request workforce/ }), "AC9: owners and admins only").toHaveCount(0);
    const send = page.getByRole("button", { name: `Send inquiry to ${rekrut.name}` });
    await waitForHydration(send);
    await send.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `Send an inquiry to ${rekrut.name}` });
    const body = dialog.getByLabel("Your inquiry");
    await expect(dialog).toContainText("0 of 2,000 characters");
    await body.fill("Too short");
    await dialog.getByRole("button", { name: "Send inquiry" }).click();
    await expect(dialog.locator("#inquiry-body-error")).toContainText("Write at least 20 characters");
    await expectNoAxeViolations(page);
    const text = "We need twenty welders for our Hamburg yard from April. Can you help?";
    await body.fill(text);
    await expect(dialog).toContainText(`${text.length}/2,000 characters`);
    await dialog.getByRole("button", { name: "Send inquiry" }).click();
    await expect(page).toHaveURL(new RegExp(`/en/org/${acme.slug}/messages/[0-9a-f-]{36}$`));
    const conversationUrl = new URL(page.url()).pathname;
    const thread = page.getByRole("log", { name: `Messages with ${rekrut.name}` });
    await expect(thread).toContainText("Inquiry");
    await expect(thread).toContainText("Waiting for an answer");
    await expect(thread).toContainText(text);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const [row] = query<{ kind: string; status: string }>(
      `select kind::text, status::text from public.connections where from_organization_id = ${literal(acme.id)} and to_organization_id = ${literal(rekrut.id)}`,
    );
    expect(row).toEqual({ kind: "inquiry", status: "sent" });

    // While the first inquiry waits, a second one is refused and points to the conversation.
    await page.goto(profileUrl(rekrut.slug));
    const again = page.getByRole("button", { name: `Send inquiry to ${rekrut.name}` });
    await waitForHydration(again);
    await again.click();
    const second = page.getByRole("dialog", { name: `Send an inquiry to ${rekrut.name}` });
    await second.getByLabel("Your inquiry").fill("A second question about the same welders, while the first waits.");
    await second.getByRole("button", { name: "Send inquiry" }).click();
    await expect(second.getByRole("alert").first()).toContainText("still waiting for an answer");
    await expect(second.getByRole("link", { name: `Open the conversation with ${rekrut.name}` })).toHaveAttribute("href", conversationUrl);
    await expect(second.getByLabel("Your inquiry")).toHaveValue("A second question about the same welders, while the first waits.");

    // Once the partner answers, the inquiry reads Answered in the conversation.
    await page.goto(conversationUrl);
    const reply = "Yes, we can send twenty welders from April.";
    execute(
      `insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body)
       select c.conversation_id, m.user_id, c.to_organization_id, ${literal(reply)}
       from public.connections c join public.organization_members m on m.organization_id = c.to_organization_id and m.role = 'owner'
       where c.from_organization_id = ${literal(acme.id)} and c.to_organization_id = ${literal(rekrut.id)}`,
    );
    await expect(thread).toContainText(reply);
    await expect(thread).toContainText("Answered");
    await expect(thread).not.toContainText("Waiting for an answer");
  });

  test("AC3, AC9: an owner at aal2 requests workforce from a staffing company and finds the request in the conversation", async ({ page }) => {
    test.setTimeout(240_000);
    await signInWithCode(page, acme.owner, acme.ownerSecret, profileUrl(staffit.slug));
    const request = page.getByRole("button", { name: `Request workforce from ${staffit.name}` });
    await waitForHydration(request);
    await request.click();
    const dialog = page.getByRole("dialog", { name: `Request workforce from ${staffit.name}` });
    await choose(page, "Occupation", "Welders and flame cutters");
    await dialog.getByLabel("Number of workers").fill("25");
    await expect(dialog.getByLabel("Country of work"), "the employer's country comes preselected").toHaveValue("Germany");
    await dialog.getByLabel("City or region").fill("Hamburg");
    const start = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    await pickDate(dialog.getByLabel("Start date"), start);
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(page).toHaveURL(new RegExp(`/en/org/${acme.slug}/messages/[0-9a-f-]{36}$`));
    const thread = page.getByRole("log", { name: `Messages with ${staffit.name}` });
    await expect(thread).toContainText("Workforce request");
    await expect(thread).toContainText("25 × Welders and flame cutters");
    const [requirement] = query<{ status: string; workers_needed: number }>(
      `select r.status::text, r.workers_needed from public.workforce_requirements r
       join public.connections c on c.requirement_id = r.id where c.to_organization_id = ${literal(staffit.id)}`,
    );
    expect(requirement).toEqual({ status: "draft", workers_needed: 25 });
    await expectAccessibleAtBothWidths(page);
  });

  test("AC9: a visitor is asked to sign in to contact, with the profile as the next page", async ({ browser }) => {
    const visitor = await newVisitor(browser);
    await visitor.page.goto(profileUrl(staffit.slug));
    await expect(visitor.page.getByRole("link", { name: "Sign in to contact" })).toHaveAttribute(
      "href",
      `/en/login?next=${encodeURIComponent(profileUrl(staffit.slug))}`,
    );
    await expect(visitor.page.getByRole("button", { name: /^Send inquiry/ })).toHaveCount(0);
    await visitor.context.close();
  });

  test("AC4, AC5, AC10: a member invites a worker to apply; the worker reads the invitation with Apply, or the closed vacancy's notice", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const welder = openVacancy(acme, "Welder MIG/MAG");
    const fitter = openVacancy(acme, "Pipe fitter");
    const { worker, conversation } = await acceptedWorker(acme);

    await signInAtAal1(page, member, `/en/org/${acme.slug}/messages/${conversation}`);
    const invite = page.getByRole("button", { name: "Invite to job: Yusuf Adeyemi" });
    await waitForHydration(invite);
    await invite.click();
    const dialog = page.getByRole("dialog", { name: "Invite to apply to a vacancy" });
    await expect(dialog.getByLabel("Vacancy").locator("option")).toHaveText(["Select an open vacancy", "Pipe fitter", "Welder MIG/MAG"]);
    await expectNoAxeViolations(page);
    await dialog.getByLabel("Vacancy").selectOption({ label: "Welder MIG/MAG" });
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("Invitation sent", { exact: true })).toBeVisible();
    await expect(page.getByRole("log")).toContainText("Invitation to apply");
    await expect(page.getByRole("log")).toContainText("Not applied yet");

    const workerContext = await browser.newContext();
    const workerPage = await workerContext.newPage();
    await signIn(workerPage, worker);
    await workerPage.goto(`/en/messages/${conversation}`);
    const apply = workerPage.getByRole("link", { name: "Apply to Welder MIG/MAG" });
    await expect(apply).toHaveAttribute("href", `/en/jobs/${welder}/apply`);
    await expect(apply.getByText("Welder MIG/MAG", { exact: true })).toHaveCSS("text-transform", "none");
    await expect(workerPage.getByRole("log")).toContainText("Hamburg, Germany");
    await expectAccessibleAtBothWidths(workerPage);
    await workerPage.setViewportSize({ width: 1280, height: 900 });
    const decline = workerPage.getByRole("button", { name: "Decline the invitation to apply" });
    await waitForHydration(decline);
    await decline.click();
    const confirmDecline = workerPage.getByRole("dialog", { name: "Decline the invitation to apply?" });
    await expect(confirmDecline).toContainText("This cannot be undone.");
    await expectNoAxeViolations(workerPage);
    await confirmDecline.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmDecline).toHaveCount(0);
    await expect(workerPage.getByRole("log")).toContainText("Not applied yet");

    execute(
      `insert into public.connections (kind, from_organization_id, to_user_id, conversation_id, job_id)
       values ('invite_to_job', ${literal(acme.id)}, ${literal(worker.id)}, ${literal(conversation)}, ${literal(fitter)});
       insert into public.messages (conversation_id, sender_organization_id, kind, body, connection_id)
       select ${literal(conversation)}, ${literal(acme.id)}, 'invite_to_job', 'Invitation to apply: Pipe fitter', id
       from public.connections where job_id = ${literal(fitter)};
       select set_config('request.jwt.claims', json_build_object('sub', ${literal(acme.owner.id)}, 'role', 'authenticated')::text, true);
       update public.jobs set status = 'closed' where id = ${literal(fitter)}`,
    );
    await workerPage.reload();
    await expect(workerPage.getByRole("link", { name: "Apply to Pipe fitter" })).toHaveCount(0);
    await expect(workerPage.getByRole("log")).toContainText("This vacancy is no longer accepting applications");
    await workerContext.close();
  });

  test("FR-L5 AC3, AC10: the Request workers page explains the request and leads to the staffing partners", async ({ page }) => {
    await page.goto("/en/request-workers");
    await expect(page.getByRole("heading", { name: "Request workers", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find staffing partners" })).toHaveAttribute("href", "/en/partners/staffing");
    await expectAccessibleAtBothWidths(page);
  });
});
