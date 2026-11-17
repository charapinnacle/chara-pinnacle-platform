import type { Page, Response } from "@playwright/test";
import { signInStaff } from "./support/admin";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser } from "./support/login";
import { uniqueToken } from "./support/organizations";
import { setPartnerRelease } from "./support/partners";
import { seedAllButCv, signIn } from "./support/passport";
import { fillReport, sendReport } from "./support/reports";
import { addMember, newTeam, newVisitor, signInAtAal1, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// Contact requests (V70; FR-Q3 AC7, AC8, AC10 to AC12; NFR-S9, NFR-U3, NFR-U4): a member of an employer on a paid plan
// sends a request from a Find Workers card with a message and a vacancy, the card then shows the date it was sent, a
// refused send keeps the typed message; the worker reads the requests, accepts one by keyboard (and lands in the new
// conversation) and declines another after the 90-day warning; the organisation reads the outcome, with the worker's name
// only after acceptance. release_find_workers and release_messaging are set for the whole database, so this file is a
// project of its own after Find Workers.

const FIRST = "Zarina";
const LAST = "Quillfeather";

function setRelease(key: "release_find_workers" | "release_messaging", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

function setDailyLimit(value: number): void {
  execute(`update private.settings set value = '${value}' where key = 'contact_requests_per_org_day_max'`);
}

// A visible worker in Nigeria, welder, whose headline holds p_token so that a search finds only the workers of one test,
// with a name that must never appear before acceptance.
async function visibleWorker(token: string): Promise<TestUser> {
  const user = await createCommittedUser("worker");
  seedAllButCv(user.id);
  execute(
    `update public.worker_profiles set first_name = ${literal(FIRST)}, last_name = ${literal(LAST)}, occupation_id = '7212',
       current_country = 'NG', headline = ${literal(`MIG welder ${token}`)}
     where user_id = ${literal(user.id)};
     insert into public.consents (user_id, purpose, version, action)
       values (${literal(user.id)}, 'worker-visibility-consent', private.current_legal_version('worker-visibility-consent'), 'granted');
     update public.worker_profiles set searchable = true where user_id = ${literal(user.id)}`,
  );
  return user;
}

function subscribe(team: Pick<Team, "id">, plan: string): void {
  execute(`insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(team.id)}, ${literal(plan)}, 'active', 'null')`);
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

// A pending request of p_team to p_worker, as send_contact_request leaves it.
function seedRequest(team: Team, worker: TestUser, jobId: string | null, message: string): string {
  return execute(
    `insert into public.contact_requests (organization_id, worker_user_id, card_id, sent_by, message, job_id, destination_country, expires_at)
     select ${literal(team.id)}, w.user_id, w.card_id, ${literal(team.owner.id)}, ${literal(message)},
            ${jobId ? literal(jobId) : "null"}, 'DE', now() + interval '30 days'
     from public.worker_profiles w where w.user_id = ${literal(worker.id)}
     returning id`,
  ).trim();
}

const searchUrl = (slug: string, token: string) => `/en/org/${slug}/find-workers?q=${token}`;
const cards = (page: Page) => page.getByRole("list", { name: "Workers" }).locator(":scope > li");

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  setRelease("release_find_workers", true);
  setRelease("release_messaging", true);
});
test.afterAll(() => {
  setDailyLimit(25);
  setRelease("release_messaging", false);
  setRelease("release_find_workers", false);
});

test.describe("Contact requests (FR-Q3)", () => {
  let acme: Team;
  let beta: Team;
  const acmeName = `Acme Contact ${uniqueToken()}`;
  const betaName = `Beta Contact ${uniqueToken()}`;
  let member: TestUser;
  let welder: string;

  test.beforeAll(async () => {
    acme = await newTeam(acmeName);
    beta = await newTeam(betaName);
    subscribe(acme, "employer_starter");
    subscribe(beta, "employer_starter");
    ({ user: member } = await addMember(acme, "member"));
    welder = openVacancy(acme, "Welder MIG/MAG");
    openVacancy(acme, "Pipe fitter");
  });

  test("AC12, NFR-S9: a member sends a request with a message and a vacancy; the card shows the date; a refusal keeps the message", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const token = `osprey${uniqueToken()}`;
    const first = await visibleWorker(token);
    const second = await visibleWorker(token);
    const responses: Response[] = [];
    page.on("response", (response) => {
      if (baseURL && response.url().startsWith(baseURL)) responses.push(response);
    });

    await signInAtAal1(page, member, searchUrl(acme.slug, token));
    await expect(cards(page)).toHaveCount(2);
    const send = cards(page).first().getByRole("button", { name: /^Send contact request: / });
    await waitForHydration(send);
    await send.click();
    const dialog = page.getByRole("dialog", { name: "Send a contact request" });
    const message = dialog.getByLabel("Message to the worker");
    await expect(dialog).toContainText("0/1,000 characters");
    const vacancy = dialog.getByLabel("Invite to apply to a vacancy (optional)");
    await expect(vacancy.locator("option")).toHaveText(["No vacancy", "Pipe fitter", "Welder MIG/MAG"]);
    await expectNoAxeViolations(page);
    const text = "We are hiring welders for our Hamburg yard and would like to talk to you.";
    await message.fill(text);
    await expect(dialog).toContainText(`${text.length}/1,000 characters`);
    await vacancy.selectOption({ label: "Welder MIG/MAG" });
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Contact request sent")).toBeVisible();
    await expect(dialog).toHaveCount(0);

    await page.reload();
    const sentCard = cards(page).filter({ hasText: "Request sent on" });
    await expect(sentCard).toHaveCount(1);
    await expect(sentCard.getByRole("button", { name: /^Send contact request: / })).toHaveCount(0);
    await expect(sentCard.getByRole("link", { name: "Waiting for the worker" })).toHaveAttribute("href", `/en/org/${acme.slug}/contact-requests`);
    const [row] = query<{ job_id: string; status: string }>(
      `select job_id, status::text from public.contact_requests where organization_id = ${literal(acme.id)}
         and worker_user_id in (${literal(first.id)}, ${literal(second.id)})`,
    );
    expect(row).toEqual({ job_id: welder, status: "pending" });

    setDailyLimit(1);
    try {
      const other = cards(page).filter({ hasNotText: "Request sent on" }).getByRole("button", { name: /^Send contact request: / });
      await waitForHydration(other);
      await other.click();
      await dialog.getByLabel("Message to the worker").fill("A second request on the same day.");
      await dialog.getByRole("button", { name: "Send request" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Your organisation reached its contact requests for today.");
      await expect(dialog.getByLabel("Message to the worker")).toHaveValue("A second request on the same day.");
      await expectNoAxeViolations(page);
      await dialog.getByRole("button", { name: "Cancel" }).click();
    } finally {
      setDailyLimit(25);
    }

    const html = await page.content();
    for (const hidden of [FIRST, LAST, first.id, second.id, first.email, second.email]) expect(html).not.toContain(hidden);
    for (const response of responses) {
      const body = await response.text().catch(() => "");
      for (const hidden of [FIRST, LAST, first.id, second.id, first.email]) expect(body, response.url()).not.toContain(hidden);
    }
    await expectAccessibleAtBothWidths(page);
  });

  test("AC6, AC12: a request sent from a search with a Destination filter is checked for that destination", async ({ page }) => {
    test.setTimeout(180_000);
    const token = `egret${uniqueToken()}`;
    const worker = await visibleWorker(token);
    execute(`insert into public.worker_preferred_countries (worker_user_id, country_code) values (${literal(worker.id)}, 'AT')`);

    await signInAtAal1(page, member, `${searchUrl(acme.slug, token)}&destination=AT`);
    await expect(cards(page)).toHaveCount(1);
    const send = cards(page).first().getByRole("button", { name: /^Send contact request: / });
    await waitForHydration(send);
    await send.click();
    const dialog = page.getByRole("dialog", { name: "Send a contact request" });
    await dialog.getByLabel("Message to the worker").fill("We are hiring welders for our Vienna yard.");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Contact request sent")).toBeVisible();
    const [row] = query<{ destination_country: string }>(
      `select destination_country from public.contact_requests where organization_id = ${literal(acme.id)} and worker_user_id = ${literal(worker.id)}`,
    );
    expect(row).toEqual({ destination_country: "AT" });
  });

  test("AC11, NFR-U4: the worker reads two requests, accepts one by keyboard and declines the other after the warning", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const worker = await visibleWorker(`heron${uniqueToken()}`);
    const fromAcme = seedRequest(acme, worker, welder, "Would you like to weld for us in Hamburg?");
    seedRequest(beta, worker, null, "We have work in Manchester.");

    await signIn(page, worker);
    await page.goto("/en/contact-requests");
    await expect(page.getByRole("heading", { name: "Contact requests", level: 1 })).toBeVisible();
    const waiting = page.getByRole("region", { name: "Waiting for your answer" });
    await expect(waiting.getByRole("listitem")).toHaveCount(2);
    const acmeItem = waiting.getByRole("listitem").filter({ hasText: acmeName });
    await expect(acmeItem).toContainText("Would you like to weld for us in Hamburg?");
    await expect(acmeItem.getByRole("link", { name: "Welder MIG/MAG" })).toHaveAttribute("href", `/en/jobs/${welder}`);
    await expect(acmeItem).toContainText(`Accepting shares your first and last name with ${acmeName} only`);
    await expect(acmeItem).toContainText("Waiting for your answer");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const decline = waiting.getByRole("button", { name: `Decline the contact request from ${betaName}` });
    await waitForHydration(decline);
    await decline.click();
    const confirm = page.getByRole("dialog", { name: `Decline the request from ${betaName}?` });
    await expect(confirm).toContainText("cannot contact you again for 90 days");
    await expectNoAxeViolations(page);
    await confirm.getByRole("button", { name: "Decline request" }).click();
    await expect(page.getByText("Request declined")).toBeVisible();
    const earlier = page.getByRole("region", { name: "Earlier requests" });
    await expect(earlier.getByRole("listitem").filter({ hasText: betaName })).toContainText("Declined");

    const accept = page.getByRole("button", { name: `Accept the contact request from ${acmeName}` });
    await accept.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/messages\/[0-9a-f-]{36}$/);
    const [conversation] = query<{ context_type: string }>(
      `select context_type::text from public.conversations where context_id = ${literal(fromAcme)}`,
    );
    expect(conversation).toEqual({ context_type: "contact_request" });

    const outsider = await newVisitor(browser);
    expect((await outsider.page.goto(`/en/org/${acme.slug}/contact-requests`))?.status()).toBe(404);
    await outsider.context.close();
  });

  test("AC7, AC8: the organisation reads the outcome, the worker's name only after acceptance, and withdraws a waiting request", async ({ page }) => {
    test.setTimeout(240_000);
    const accepted = await visibleWorker(`plover${uniqueToken()}`);
    const waiting = await visibleWorker(`wren${uniqueToken()}`);
    const acceptedId = seedRequest(acme, accepted, null, "Accepted request.");
    execute(`update public.contact_requests set status = 'accepted', responded_at = now() where id = ${literal(acceptedId)}`);
    seedRequest(acme, waiting, null, "Waiting request.");

    await signInAtAal1(page, member, `/en/org/${acme.slug}/contact-requests`);
    await expect(page.getByRole("heading", { name: "Contact requests", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: `${FIRST} ${LAST}`, level: 2 })).toHaveCount(1);
    const waitingItem = page.getByRole("listitem").filter({ hasText: "Waiting request." });
    await expect(waitingItem).toContainText("Waiting for the worker");
    await expect(waitingItem).not.toContainText(FIRST);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const withdraw = waitingItem.getByRole("button", { name: /^Withdraw the contact request: / });
    await waitForHydration(withdraw);
    await withdraw.click();
    await expect(page.getByText("Contact request withdrawn")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Waiting request." })).toContainText("Withdrawn");
    await expect(page.getByRole("listitem").filter({ hasText: "Waiting request." })).toContainText(
      "You withdrew this request. Your organisation can send this worker a new request from",
    );

    await page.goto(`/en/org/${acme.slug}/contact-requests?status=expired`);
    await expect(page.getByText("No contact requests with this status")).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("AC11, FR-S1 AC4, AC8 (V73): the worker reports a request; Trust & Safety hide it; the worker no longer reads it and the organisation reads it hidden", async ({ page, browser }) => {
    test.setTimeout(240_000);
    setPartnerRelease(true);
    try {
      const worker = await visibleWorker(`gull${uniqueToken()}`);
      const request = seedRequest(acme, worker, null, "Pay us 300 euros and the job is yours.");
      await signIn(page, worker);
      await page.goto("/en/contact-requests");
      const report = page.getByRole("link", { name: `Report this request from ${acmeName}` });
      await expect(report).toHaveAttribute("href", `/en/report?type=contact_request&request=${request}`);
      await report.click();
      await expect(page.getByRole("heading", { name: "Report a contact request", level: 1 })).toBeVisible();
      await expectAccessibleAtBothWidths(page);
      await page.setViewportSize({ width: 1280, height: 900 });
      await fillReport(page, { details: "The company asked me for 300 euros to get the job." });
      await sendReport(page);
      const [stored] = query<{ id: number; target_type: string; organization_id: string | null }>(
        `select id, target_type::text, organization_id from public.reports where contact_request_id = ${literal(request)}`,
      );
      expect(stored).toMatchObject({ target_type: "contact_request", organization_id: null });

      const staff = await newVisitor(browser);
      await signInStaff(staff.page, "trust_safety", `/en/admin/reports/${stored.id}`);
      const target = staff.page.locator("#target");
      await expect(target).toContainText(acmeName);
      await expect(target).not.toContainText("300 euros");
      const hide = staff.page.getByRole("button", { name: "Hide", exact: true });
      await waitForHydration(hide);
      await hide.click();
      const dialog = staff.page.getByRole("dialog", { name: "Hide the contact request" });
      await dialog.getByLabel("Statement of reasons").fill("The request asks the worker to pay for the job, against the platform rules.");
      await dialog.getByRole("button", { name: "Hide" }).click();
      await expect(staff.page.getByText("Hidden. The report is actioned", { exact: true })).toBeVisible();
      await expect(staff.page.locator("#decision")).toContainText("Contact request hidden");
      await staff.context.close();

      await page.goto("/en/contact-requests");
      await expect(page.getByText("Pay us 300 euros and the job is yours.")).toHaveCount(0);

      const [decision] = query<{ id: number }>(
        `select id from public.moderation_actions where target_type = 'contact_request' and target_id = ${literal(request)}`,
      );
      const team = await newVisitor(browser);
      await signInAtAal1(team.page, member, `/en/org/${acme.slug}/contact-requests`);
      const item = team.page.getByRole("listitem").filter({ hasText: "Pay us 300 euros and the job is yours." });
      await expect(item).toContainText("Hidden by moderation.");
      await expect(item.getByRole("link", { name: "See the reasons and how to appeal" })).toHaveAttribute("href", `/en/appeals/${decision.id}`);
      await expectAccessibleAtBothWidths(team.page);
      await team.context.close();
    } finally {
      setPartnerRelease(false);
    }
  });

  test("AC11: a worker without requests reads No contact requests", async ({ page }) => {
    test.setTimeout(120_000);
    const worker = await visibleWorker(`finch${uniqueToken()}`);
    await signIn(page, worker);
    await page.goto("/en/contact-requests");
    await expect(page.getByRole("heading", { name: "No contact requests" })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
  });
});
