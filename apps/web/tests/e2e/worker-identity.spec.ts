import type { Page, Response as PageResponse } from "@playwright/test";
import { dataApiAs } from "./support/accounts";
import { execute, literal, query } from "./support/db";
import { seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { createCommittedUser } from "./support/login";
import { waitForMessage } from "./support/mailpit";
import { runNotify } from "./support/notify";
import { uniqueToken } from "./support/organizations";
import { seedAllButCv } from "./support/passport";
import { addMember, newTeam, newVisitor, signInAtAal1, subscribe, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// NFR-S9 (V80): until a worker accepts a contact request, a company sees the short card only. Nothing that reaches the
// browser of a member of an employer on a paid plan (the HTML, the React Server Component payloads and every other text
// or JSON response, their addresses and headers, the title and the meta tags) nor what the Data API answers it
// (search_workers, card_contact_requests, list_contact_requests_sent, list_saved_worker_cards, the tables) nor its
// notification (the bell, the queued payload and the email of the worker's answer) holds the worker's first or last name,
// account address, user id or a document (its title, file name or storage path), on Find Workers, the card in the results
// and among the saved workers, the contact request dialog, the organisation's contact requests, the dashboard and the
// public Find Workers page; a declined request reveals nothing either. Passports have no photo field and no telephone
// (DATA_MODEL.md), so there is no photo or number to leak; the account address is the contact detail. As a control, the
// member reads the name of a worker who accepted, on the contact requests page only. Releases 2a and 2c are switched on
// for the whole database, so this file is a project of its own after the release 2c journeys.

const RELEASES = ["release_partner_directories", "release_find_workers", "release_messaging"] as const;

function setReleases(on: boolean): void {
  execute(`update private.settings set value = '${on}' where key in (${RELEASES.map(literal).join(", ")})`);
}

type Worker = { user: TestUser; first: string; last: string; secrets: string[] };

// A worker in Ghana who chose to be found, with a certificate in the passport; the headline holds p_token so that the
// search finds this file's workers only, and the names are this worker's own.
async function visibleWorker(token: string, first: string, last: string): Promise<Worker> {
  const user = await createCommittedUser("worker");
  seedAllButCv(user.id);
  execute(
    `update public.worker_profiles set first_name = ${literal(first)}, last_name = ${literal(last)}, occupation_id = '7212',
       current_country = 'GH', headline = ${literal(`Pipe welder ${token}`)}
     where user_id = ${literal(user.id)};
     insert into public.consents (user_id, purpose, version, action)
       values (${literal(user.id)}, 'worker-visibility-consent', private.current_legal_version('worker-visibility-consent'), 'granted');
     update public.worker_profiles set searchable = true where user_id = ${literal(user.id)}`,
  );
  const document = await seedDocument(user.id, {
    title: `Welding certificate of ${last}`,
    type: "certificate",
    scanStatus: "clean",
    fileName: `${first}_${last}_certificate.pdf`,
  });
  return { user, first, last, secrets: [first, last, user.id, user.email, document.id, document.title, document.file_name, document.storage_path] };
}

// Every text the browser receives while p_visit runs: the bodies of the document, the RSC payloads and the JSON and
// text responses (the build's static chunks hold no data and are left out), their addresses and headers, and then the
// page's address, title and HTML.
async function received(page: Page, visit: () => Promise<void>): Promise<string> {
  const bodies: Promise<string>[] = [];
  const listener = (response: PageResponse) => {
    const type = response.headers()["content-type"] ?? "";
    if (response.url().includes("/_next/static/") || !/text|json|x-component/.test(type)) return;
    bodies.push(response.text().then((body) => `${response.url()}\n${JSON.stringify(response.headers())}\n${body}`, () => response.url()));
  };
  page.on("response", listener);
  try {
    await visit();
  } finally {
    page.off("response", listener);
  }
  return [...(await Promise.all(bodies)), page.url(), await page.title(), await page.content()].join("\n");
}

function expectNoneOf(text: string, secrets: string[], where: string): void {
  for (const secret of secrets) expect(text.includes(secret), `${where}: "${secret}" reached the company`).toBe(false);
}

async function rpc(user: TestUser, name: string, body: Record<string, unknown>): Promise<string> {
  const response = await dataApiAs(user, `rpc/${name}`, { method: "POST", body });
  expect(response.status, name).toBe(200);
  return response.text();
}

const cards = (page: Page) => page.getByRole("list", { name: "Workers" }).locator(":scope > li");

let team: Team;
let member: TestUser;
let token: string;
let declining: Worker;
let accepting: Worker;

test.describe("worker identity before a contact request is accepted (NFR-S9)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async () => {
    setReleases(true);
    team = await newTeam();
    subscribe(team, "employer_starter");
    ({ user: member } = await addMember(team, "member"));
    token = `ibis${uniqueToken()}`;
    declining = await visibleWorker(token, "Abenaqua", `Osei${uniqueToken()}`);
    accepting = await visibleWorker(token, "Kwabenor", `Mensah${uniqueToken()}`);
  });
  test.afterAll(() => setReleases(false));

  test("Find Workers, the cards, the request and the organisation's pages hold nothing of the worker", async ({ page, browser }) => {
    test.setTimeout(360_000);
    const secrets = [...declining.secrets, ...accepting.secrets];

    await signInAtAal1(page, member, `/en/org/${team.slug}/find-workers`);
    const search = await received(page, async () => {
      await page.goto(`/en/org/${team.slug}/find-workers?q=${token}`);
      await expect(cards(page)).toHaveCount(2);
    });
    expectNoneOf(search, secrets, "Find Workers");
    for (const meta of await page.locator("head meta").evaluateAll((tags) => tags.map((tag) => tag.outerHTML))) {
      expectNoneOf(meta, secrets, "the meta tags");
    }

    // A card saved and listed among the saved workers.
    const saved = await received(page, async () => {
      const save = cards(page).first().getByRole("button", { name: /^Save: / });
      await waitForHydration(save);
      await save.click();
      await expect(page.getByText("Worker saved", { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("list", { name: "Saved workers" }).getByTestId("worker-card")).toHaveCount(1);
    });
    expectNoneOf(saved, secrets, "the saved workers");

    // A contact request to each worker, from the card's dialog; the card then shows when it was sent.
    const requested = await received(page, async () => {
      for (let sent = 0; sent < 2; sent += 1) {
        const send = cards(page).filter({ hasNotText: "Request sent on" }).first().getByRole("button", { name: /^Send contact request: / });
        await waitForHydration(send);
        await send.click();
        const dialog = page.getByRole("dialog", { name: "Send a contact request" });
        await dialog.getByLabel("Message to the worker").fill("We are hiring pipe welders for a refinery in Rotterdam. Would you like to talk?");
        await dialog.getByRole("button", { name: "Send request" }).click();
        await expect(page.getByText("Contact request sent", { exact: true }).first()).toBeVisible();
        await expect(dialog).toHaveCount(0);
        await page.reload();
      }
      await expect(cards(page).filter({ hasText: "Request sent on" })).toHaveCount(2);
    });
    expectNoneOf(requested, secrets, "the contact request dialog and the cards");

    const requests = await received(page, async () => {
      await page.goto(`/en/org/${team.slug}/contact-requests`);
      await expect(page.getByRole("listitem").filter({ hasText: "Waiting for the worker" })).toHaveCount(2);
    });
    expectNoneOf(requests, secrets, "the organisation's contact requests");

    const dashboard = await received(page, async () => {
      await page.goto(`/en/dashboard/employer?org=${team.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
    expectNoneOf(dashboard, secrets, "the employer dashboard");

    const visitor = await newVisitor(browser);
    const publicPage = await received(visitor.page, async () => {
      await visitor.page.goto("/en/find-workers");
      await expect(visitor.page.getByRole("heading", { name: "Find workers", level: 1 })).toBeVisible();
    });
    expectNoneOf(publicPage, [...secrets, token], "the public Find Workers page");
    await visitor.context.close();

    // What the Data API answers the member.
    const [{ cards: cardIds }] = query<{ cards: string[] }>(
      `select array_agg(card_id) as cards from public.worker_profiles where user_id in (${literal(declining.user.id)}, ${literal(accepting.user.id)})`,
    );
    expectNoneOf(await rpc(member, "search_workers", { p_org: team.id, p_filters: { q: token } }), secrets, "search_workers");
    expectNoneOf(await rpc(member, "card_contact_requests", { p_org: team.id, p_cards: cardIds }), secrets, "card_contact_requests");
    expectNoneOf(await rpc(member, "list_contact_requests_sent", { p_org: team.id }), secrets, "list_contact_requests_sent");
    expectNoneOf(await rpc(member, "list_saved_worker_cards", { p_org: team.id }), secrets, "list_saved_worker_cards");
    for (const path of [
      `worker_profiles?user_id=in.(${declining.user.id},${accepting.user.id})`,
      `worker_documents?worker_user_id=in.(${declining.user.id},${accepting.user.id})`,
      `profiles?id=in.(${declining.user.id},${accepting.user.id})`,
      `worker_skills?worker_user_id=in.(${declining.user.id},${accepting.user.id})`,
    ]) {
      const answer = await dataApiAs(member, path);
      expect(await answer.json(), path).toEqual([]);
    }
    const own = await dataApiAs(member, `contact_requests?organization_id=eq.${team.id}&select=id,status,message`);
    expect(await own.json()).toHaveLength(2);
    expect((await dataApiAs(member, `contact_requests?organization_id=eq.${team.id}&select=worker_user_id`)).ok).toBe(false);
    expectNoneOf(await (await dataApiAs(member, `saved_worker_cards?organization_id=eq.${team.id}`)).text(), secrets, "saved_worker_cards");
  });

  test("the worker's answers notify the organisation without the name; a declined request reveals nothing, an accepted one the name", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const requestOf = (worker: Worker) =>
      query<{ id: string }>(
        `select id from public.contact_requests where organization_id = ${literal(team.id)} and worker_user_id = ${literal(worker.user.id)}`,
      )[0].id;
    for (const [worker, answer] of [
      [declining, "decline"],
      [accepting, "accept"],
    ] as const) {
      const response = await dataApiAs(worker.user, "rpc/respond_to_contact_request", {
        method: "POST",
        body: { p_request: requestOf(worker), p_decision: answer },
      });
      expect(response.ok, await response.text()).toBe(true);
    }

    // The queued payloads, the bell and the emails of both answers.
    const payloads = query<{ payload: string }>(
      `select payload::text from public.notifications where user_id = ${literal(member.id)} and kind = 'contact_request_decided'`,
    );
    expect(payloads).toHaveLength(2);
    for (const { payload } of payloads) expectNoneOf(payload, [...declining.secrets, ...accepting.secrets], "the queued notification");
    await signInAtAal1(page, member, "/en/notifications");
    const bell = await received(page, async () => {
      await page.reload();
      await expect(page.getByRole("link", { name: "A worker declined your contact request" })).toBeVisible();
      await expect(page.getByRole("link", { name: "A worker accepted your contact request" })).toBeVisible();
    });
    expectNoneOf(bell, [...declining.secrets, ...accepting.secrets], "the notifications page");
    await runNotify();
    for (const subject of ["A worker declined your contact request", "A worker accepted your contact request"]) {
      const email = await waitForMessage(member.email, { subject });
      expectNoneOf(`${email.Subject}\n${email.Text}\n${email.HTML}`, [...declining.secrets, ...accepting.secrets], subject);
    }

    // The declined worker stays unnamed everywhere; the accepted one is named on the contact requests page only, never
    // with a document.
    const requests = await received(page, async () => {
      await page.goto(`/en/org/${team.slug}/contact-requests`);
      await expect(page.getByRole("heading", { name: `${accepting.first} ${accepting.last}`, level: 2 })).toBeVisible();
    });
    expectNoneOf(requests, declining.secrets, "the contact requests after a decline");
    expectNoneOf(requests, accepting.secrets.slice(2), "the contact requests after an acceptance");
    const search = await received(page, async () => {
      await page.goto(`/en/org/${team.slug}/find-workers?q=${token}`);
      await expect(cards(page)).toHaveCount(2);
    });
    expectNoneOf(search, declining.secrets, "Find Workers after a decline");
    expectNoneOf(await rpc(member, "search_workers", { p_org: team.id, p_filters: { q: token } }), [...declining.secrets, ...accepting.secrets],
      "search_workers after the answers");
  });
});
