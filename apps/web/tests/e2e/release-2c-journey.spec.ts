import type { Locator, Page } from "@playwright/test";
import { displayName, expectAccessibleAtBothWidths } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser, enrollTotp } from "./support/login";
import { uniqueToken } from "./support/organizations";
import { partnerWithCompany } from "./support/partners";
import { seedAllButCv, signIn } from "./support/passport";
import { fillReport, sendReport } from "./support/reports";
import { addMember, newTeam, newVisitor, signInAtAal1, signInWithCode, subscribe, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// NFR-O4 (V80): the two journeys of release 2c, walked through the real pages, with the status and the next action of
// each page on the way (NFR-U4) and the time a message takes to reach the other side's open conversation (NFR-P4). (a) A
// member of an employer finds a worker in Find Workers and sends a contact request from the card; the worker opens it
// from the notification and accepts; the member reads the outcome with the worker's name and opens the conversation, and
// both write. (b) A member of an employer sends a listed partner an inquiry from its profile; the partner opens it from
// its notification and replies, which answers the inquiry; the partner reports a message, and the employer blocks the
// conversation, which closes it for both sides. Only the starting point is written to the database (a team on a paid plan
// with a member, a visible worker, a listed partner). Releases 2a and 2c (release_find_workers, release_messaging) are
// switched on for the whole database while this file runs, so it is a project of its own at the end of the release 2c
// chain (playwright.config.ts).
//
// NFR-P4: without the Realtime service (as on the local stack and possibly in CI) the open conversation reads new messages
// every 4 s (V64, THREAD_POLL_MS); each message must show on the other side within 5 s of the moment the sender's Send
// returned, that is of the moment it was stored. Each journey times every message it sends, both ways.

const FIRST = "Ilona";
const LAST = "Varga-Mbeki";
const DELIVERY_MS = 5_000;
const RELEASES = ["release_partner_directories", "release_find_workers", "release_messaging"] as const;

function setReleases(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key in (${RELEASES.map(literal).join(", ")})`);
}

// A worker in Nigeria who chose to be found, welder, whose headline holds p_token so that the search finds this worker
// only, as set_worker_visibility leaves the passport.
async function visibleWorker(token: string): Promise<TestUser> {
  const user = await createCommittedUser("worker");
  seedAllButCv(user.id);
  execute(
    `update public.worker_profiles set first_name = ${literal(FIRST)}, last_name = ${literal(LAST)}, occupation_id = '7212',
       current_country = 'NG', headline = ${literal(`TIG welder ${token}`)}
     where user_id = ${literal(user.id)};
     insert into public.consents (user_id, purpose, version, action)
       values (${literal(user.id)}, 'worker-visibility-consent', private.current_legal_version('worker-visibility-consent'), 'granted');
     update public.worker_profiles set searchable = true where user_id = ${literal(user.id)}`,
  );
  return user;
}

// A listed recruitment company serving Germany with welders, as the partner sign-up and review of release 2a leave it.
async function listedPartner(): Promise<{ id: string; slug: string; name: string; owner: TestUser }> {
  const { user, id, slug } = await partnerWithCompany("recruitment_company");
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code)
     values (${literal(id)}, 'serves_market', 'DE'), (${literal(id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
     where id = ${literal(id)}`,
  );
  return { id, slug, name: displayName(id), owner: user };
}

function composerOf(page: Page, recipient: string): Locator {
  return page.getByRole("textbox", { name: `Message to ${recipient}` });
}

function logOf(page: Page, counterpart: string): Locator {
  return page.getByRole("log", { name: `Messages with ${counterpart}` });
}

// Sends p_body from the sender's open conversation and answers how long after the send returned (the message stored, the
// composer emptied) it showed in the recipient's open conversation, without a reload. The polling of the assertion can
// only add to the time measured.
async function deliver(sender: Page, recipient: string, receiverLog: Locator, body: string): Promise<number> {
  const composer = composerOf(sender, recipient);
  await waitForHydration(composer);
  await composer.fill(body);
  await sender.getByRole("button", { name: "Send" }).click();
  await expect(composer).toHaveValue("");
  const started = Date.now();
  await expect(receiverLog.getByText(body, { exact: true })).toBeVisible({ timeout: 15_000 });
  return Date.now() - started;
}

function kinds(userId: string): string[] {
  return query<{ kind: string }>(`select kind from public.notifications where user_id = ${literal(userId)} order by created_at`).map(
    ({ kind }) => kind,
  );
}

test.describe("release 2c journeys (NFR-O4, NFR-U4, NFR-P4)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setReleases(true));
  test.afterAll(() => setReleases(false));

  test("(a) Find Workers to a contact request, accepted by the worker, to a conversation with messages both ways", async ({ page, browser }) => {
    test.setTimeout(420_000);
    const team: Team = await newTeam();
    subscribe(team, "employer_starter");
    const { user: member } = await addMember(team, "member");
    const employer = displayName(team.id);
    const token = `lynx${uniqueToken()}`;
    const worker = await visibleWorker(token);
    const workerName = `${FIRST} ${LAST}`;

    // The member searches by keyword and finds the card, which names no one.
    await signInAtAal1(page, member, `/en/org/${team.slug}/find-workers`);
    const box = page.getByLabel("Search workers", { exact: true });
    await waitForHydration(box);
    await box.fill(token);
    await box.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "1 worker found." })).toBeVisible();
    const card = page.getByRole("list", { name: "Workers" }).locator(":scope > li");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`TIG welder ${token}`);
    await expect(card).not.toContainText(FIRST);
    // The end of this short page leaves the filters under the sticky header, which axe counts as a covered target.
    await expectAccessibleAtBothWidths(page, { from: "top" });
    await page.setViewportSize({ width: 1280, height: 900 });

    // It sends a contact request from the card; the card then says when and how it stands.
    const send = card.getByRole("button", { name: /^Send contact request: / });
    await waitForHydration(send);
    await send.click();
    const dialog = page.getByRole("dialog", { name: "Send a contact request" });
    await dialog.getByLabel("Message to the worker").fill("We build ships in Hamburg and need TIG welders from March. Would you like to talk?");
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Contact request sent", { exact: true })).toBeVisible();
    await page.reload();
    await expect(card).toContainText("Request sent on");
    await expect(card.getByRole("link", { name: "Waiting for the worker" })).toHaveAttribute("href", `/en/org/${team.slug}/contact-requests`);

    // The organisation's requests: waiting, with what happens next and Withdraw, still without the name.
    await card.getByRole("link", { name: "Waiting for the worker" }).click();
    await expect(page.getByRole("heading", { name: "Contact requests", level: 1 })).toBeVisible();
    const sent = page.getByRole("listitem").filter({ hasText: "We build ships in Hamburg" });
    await expect(sent).toContainText("Waiting for the worker");
    await expect(sent).toContainText("The worker decides whether to share their name with you. You can withdraw the request while it waits.");
    await expect(sent.getByRole("button", { name: /^Withdraw the contact request: / })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(FIRST);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    const [request] = query<{ id: string; status: string }>(
      `select id, status::text from public.contact_requests where organization_id = ${literal(team.id)} and worker_user_id = ${literal(worker.id)}`,
    );
    expect(request.status).toBe("pending");

    // The worker opens the request from the notification, reads what accepting shares and accepts.
    const workerView = await newVisitor(browser);
    const wp = workerView.page;
    await signIn(wp, worker);
    await wp.goto("/en/notifications");
    const item = wp.getByRole("link", { name: `${employer} would like to contact you` });
    await waitForHydration(item);
    await item.click();
    await expect(wp).toHaveURL("/en/contact-requests");
    const waiting = wp.getByRole("region", { name: "Waiting for your answer" }).getByRole("listitem").filter({ hasText: employer });
    await expect(waiting).toContainText("Waiting for your answer");
    await expect(waiting).toContainText(`Accepting shares your first and last name with ${employer} only and opens a conversation.`);
    await expect(waiting).toContainText("We build ships in Hamburg");
    await expectAccessibleAtBothWidths(wp);
    await wp.setViewportSize({ width: 1280, height: 900 });
    const accept = wp.getByRole("button", { name: `Accept the contact request from ${employer}` });
    await waitForHydration(accept);
    await accept.click();
    await expect(wp).toHaveURL(/\/en\/messages\/[0-9a-f-]{36}$/);
    const conversation = new URL(wp.url()).pathname.split("/").at(-1) ?? "";
    await expect(wp.getByRole("heading", { level: 1, name: employer })).toBeVisible();
    await expect(wp.getByText("No messages yet")).toBeVisible();
    await expectAccessibleAtBothWidths(wp);
    await wp.setViewportSize({ width: 1280, height: 900 });
    expect(query<{ status: string }>(`select status::text from public.contact_requests where id = ${literal(request.id)}`)).toEqual([{ status: "accepted" }]);

    // The member reads the outcome from the notification: accepted, the worker's name and the way to the conversation.
    await page.goto("/en/notifications");
    const decided = page.getByRole("link", { name: "A worker accepted your contact request" });
    await waitForHydration(decided);
    await decided.click();
    await expect(page).toHaveURL(`/en/org/${team.slug}/contact-requests`);
    await expect(page.getByRole("heading", { name: workerName, level: 2 })).toBeVisible();
    const accepted = page.getByRole("listitem").filter({ hasText: "We build ships in Hamburg" });
    await expect(accepted).toContainText("Accepted");
    await expect(accepted).toContainText("The worker shared their name with you. Continue in the conversation.");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await accepted.getByRole("link", { name: `Open the conversation with ${workerName}` }).click();
    await expect(page).toHaveURL(`/en/org/${team.slug}/messages/${conversation}`);
    await expect(page.getByRole("heading", { level: 1, name: workerName })).toBeVisible();

    // Messages both ways, each shown on the other side's open conversation within 5 s (NFR-P4).
    const memberLog = logOf(page, workerName);
    const workerLog = logOf(wp, employer);
    const times = [
      await deliver(page, workerName, workerLog, "Thank you for accepting. When could you travel to Hamburg?"),
      await deliver(wp, employer, memberLog, "I can travel from the first week of March."),
      await deliver(page, workerName, workerLog, "Good. We will send the contract in English this week."),
      await deliver(wp, employer, memberLog, "Thank you, I will read it and answer."),
    ];
    for (const time of times) expect(time, `a message took ${time} ms to show`).toBeLessThan(DELIVERY_MS);
    await expect(memberLog.getByRole("listitem")).toHaveCount(4);
    await expectAccessibleAtBothWidths(page);

    // The inbox lists the conversation under Contact requests with the worker's name.
    await page.goto(`/en/org/${team.slug}/messages?context=contact_request`);
    await expect(page.getByRole("link", { name: new RegExp(`^${workerName}`) })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    expect(kinds(worker.id)).toContain("contact_request_received");
    expect(kinds(member.id)).toContain("contact_request_decided");
    await workerView.context.close();
  });

  test("(b) an inquiry to a partner, its reply that answers it, a report and a block that closes it for both sides", async ({ page, browser }) => {
    test.setTimeout(420_000);
    const team: Team = await newTeam();
    subscribe(team, "employer_starter");
    const { user: member } = await addMember(team, "member");
    const employer = displayName(team.id);
    const partner = await listedPartner();
    const partnerSecret = await enrollTotp(partner.owner);
    const inquiry = "We need twenty TIG welders for our Hamburg yard from April. Can you recruit them in the Philippines?";

    // The member sends the inquiry from the partner's profile and lands in the conversation, waiting for an answer.
    await signInAtAal1(page, member, `/en/partners/${partner.slug}`);
    const open = page.getByRole("button", { name: `Send inquiry to ${partner.name}` });
    await waitForHydration(open);
    await open.click();
    const dialog = page.getByRole("dialog", { name: `Send an inquiry to ${partner.name}` });
    await dialog.getByLabel("Your inquiry").fill(inquiry);
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Send inquiry" }).click();
    await expect(page).toHaveURL(new RegExp(`/en/org/${team.slug}/messages/[0-9a-f-]{36}$`));
    const conversation = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    const memberLog = logOf(page, partner.name);
    await expect(memberLog).toContainText("Inquiry");
    await expect(memberLog).toContainText("Waiting for an answer");
    await expect(memberLog).toContainText(inquiry);
    await expect(memberLog.getByRole("button", { name: "Decline the inquiry" }), "only the receiving side declines").toHaveCount(0);
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // The partner's owner opens it from the notification: the typed card with its status and Decline as its next action.
    const partnerView = await newVisitor(browser);
    const pp = partnerView.page;
    await signInWithCode(pp, partner.owner, partnerSecret, "/en/notifications");
    const item = pp.getByRole("link", { name: `${employer} sent you an inquiry` });
    await waitForHydration(item);
    await item.click();
    await expect(pp).toHaveURL(`/en/org/${partner.slug}/messages/${conversation}`);
    await expect(pp.getByRole("heading", { level: 1, name: employer })).toBeVisible();
    const partnerLog = logOf(pp, employer);
    await expect(partnerLog).toContainText("Waiting for an answer");
    await expect(partnerLog.getByRole("button", { name: "Decline the inquiry" })).toBeVisible();
    await expectAccessibleAtBothWidths(pp);
    await pp.setViewportSize({ width: 1280, height: 900 });

    // The reply answers the inquiry; messages go both ways within 5 s (NFR-P4).
    const times = [
      await deliver(pp, employer, memberLog, "Yes, we can. Twenty welders with TIG certificates can start in April."),
      await deliver(page, partner.name, partnerLog, "Please send us the fee and the timeline."),
      await deliver(pp, employer, memberLog, "Our fee is one month's salary per hire; the first ten can travel in six weeks."),
    ];
    for (const time of times) expect(time, `a message took ${time} ms to show`).toBeLessThan(DELIVERY_MS);
    await expect(partnerLog.getByText("Answered", { exact: true })).toBeVisible();
    await expect(partnerLog.getByRole("button", { name: "Decline the inquiry" })).toHaveCount(0);
    await page.reload();
    await expect(memberLog.getByText("Answered", { exact: true })).toBeVisible();
    expect(
      query<{ status: string }>(
        `select status::text from public.connections where conversation_id = ${literal(conversation)} and kind = 'inquiry'`,
      ),
    ).toEqual([{ status: "answered" }]);

    // The partner reports the employer's second message.
    const [reported] = query<{ id: string }>(
      `select id from public.messages where conversation_id = ${literal(conversation)} and body = 'Please send us the fee and the timeline.'`,
    );
    const report = partnerLog.getByRole("listitem").filter({ hasText: "Please send us the fee and the timeline." }).getByRole("link", { name: /^Report/ });
    await expect(report).toHaveAttribute("href", `/en/report?type=message&message=${reported.id}`);
    await report.click();
    await expect(pp.getByRole("heading", { level: 1, name: "Report a message" })).toBeVisible();
    await expectAccessibleAtBothWidths(pp);
    await pp.setViewportSize({ width: 1280, height: 900 });
    await fillReport(pp, { category: "misleading_or_fraud", details: "The employer asks for our fee in a way we believe is a scam." });
    expect(await sendReport(pp)).toMatch(/^R-\d{6,}$/);
    expect(
      query<{ target_type: string; message_id: string }>(
        `select target_type::text, message_id from public.reports where reporter_user_id = ${literal(partner.owner.id)} order by id desc limit 1`,
      ),
    ).toEqual([{ target_type: "message", message_id: reported.id }]);

    // The member blocks the conversation: closed for both sides, the history kept, the blocker not named to the partner.
    const block = page.getByRole("button", { name: "Block conversation" });
    await waitForHydration(block);
    await block.click();
    await page.getByRole("dialog", { name: "Block this conversation?" }).getByRole("button", { name: "Block conversation" }).click();
    await expect(page.getByText("You blocked this conversation", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Unblock conversation" })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await pp.goto(`/en/org/${partner.slug}/messages/${conversation}`);
    await expect(pp.getByText("This conversation is closed for new messages")).toBeVisible();
    await expect(pp.getByText("A participant closed it. You can still read the history.")).toBeVisible();
    await expect(pp.getByRole("textbox")).toHaveCount(0);
    await expect(logOf(pp, employer).getByText("Please send us the fee and the timeline.")).toBeVisible();
    await expectAccessibleAtBothWidths(pp);

    // Both inboxes list it under Inquiries, closed for new messages.
    await page.goto(`/en/org/${team.slug}/messages?context=inquiry`);
    await expect(page.getByRole("link", { name: "Inquiries", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Closed for new messages").first()).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    expect(kinds(partner.owner.id)).toContain("inquiry_received");
    await partnerView.context.close();
  });
});
