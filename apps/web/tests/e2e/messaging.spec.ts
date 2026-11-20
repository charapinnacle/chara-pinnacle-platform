import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { callAs, dataApiAs } from "./support/accounts";
import { displayName, expectAccessibleAtBothWidths, newApplicant, seedApplication } from "./support/applications";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { signIn } from "./support/passport";
import { addMember, newTeam, newVisitor, signInAtAal1, type Team } from "./support/team";
import type { TestUser } from "./support/test-user";
import { expect, test } from "./support/test";

// The messaging pages (V65; FR-P1 AC1, AC6, AC8 to AC11, steps Open, Send, Read, Members, Context link; NFR-S8, NFR-S10,
// NFR-U3, NFR-U4, NFR-P4): a member opens the conversation of an application with Message, is held at 4,000 characters,
// sends markup with a line break by Ctrl+Enter and keeps the focus in the field; a dropped file is refused with the hint;
// the candidate finds it in the inbox with its unread count and answers, and the answer reaches the employer's open thread
// without a reload (by the poll of V64 where the stack runs without Realtime, as in CI); a partner opens the conversation
// of its accepted invitation and the employer finds it under Invitations; an empty inbox, an empty filter, a failed list
// with a retry and a failed send that keeps the text; a withdrawn application leaves both sides the history and the
// reason; another organisation and the switch off answer not found. Every page is checked with axe at 1280 and 360 px.
// Releases 2a, 2b and 2c are switched on for the whole database, so this file is a project of its own after the employer
// network dashboard, and its tests run one after the other. The requirements are in Luxembourg, which no other spec uses.

const LUXEMBOURG = "LU";
const LIST_FUNCTION = "public.list_conversations(uuid, timestamp with time zone, uuid, integer, public.conversation_context)";
const SEND_FUNCTION = "public.send_message(uuid, text)";
const INBOX_URL = "/en/messages";
const orgInboxUrl = (slug: string) => `/en/org/${slug}/messages`;
const applicantUrl = (slug: string, id: string) => `/en/org/${slug}/applicants/${id}`;
const CONVERSATION_URL = /\/messages\/([0-9a-f-]{36})$/;

function setRelease(key: "release_job_orders" | "release_messaging", on: boolean): void {
  execute(`update private.settings set value = '${on}' where key = ${literal(key)}`);
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function conversationIdOf(page: Page): string {
  return CONVERSATION_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
}

type ApplicantSetup = { team: Team; member: TestUser; candidate: TestUser; applicationId: string; candidateName: string; employerName: string };

// An employer with a plain member (no two-step verification asked), and a candidate who applied to its open vacancy, with
// the names of the application's snapshot.
async function applicantSetup(): Promise<ApplicantSetup> {
  const team = await newTeam();
  const { user: member } = await addMember(team, "member");
  const candidate = await newApplicant();
  const jobId = seedJob(team, { title: "Welder Luxembourg", status: "open" });
  const applicationId = seedApplication(candidate.id, jobId, team.id, { status: "viewed" });
  // query wraps its SQL in a subquery, which an update cannot be: the snapshot is written first, then read.
  execute(
    `update public.job_applications a set profile_snapshot = jsonb_build_object('first_name', w.first_name, 'last_name', w.last_name)
     from public.worker_profiles w where a.id = ${literal(applicationId)} and w.user_id = a.worker_user_id`,
  );
  const [{ name }] = query<{ name: string }>(
    `select w.first_name || ' ' || w.last_name as name from public.job_applications a
     join public.worker_profiles w on w.user_id = a.worker_user_id where a.id = ${literal(applicationId)}`,
  );
  return { team, member, candidate, applicationId, candidateName: name, employerName: displayName(team.id) };
}

async function openAs(user: TestUser, contextType: string, contextId: string): Promise<string> {
  const response = await dataApiAs(user, "rpc/open_conversation", { method: "POST", body: { p_context_type: contextType, p_context_id: contextId } });
  if (!response.ok) throw new Error(`open_conversation answered ${response.status}: ${await response.text()}`);
  return String(await response.json());
}

function storedBodies(conversationId: string): string[] {
  return query<{ body: string }>(`select body from public.messages where conversation_id = ${literal(conversationId)} order by created_at, id`).map(
    ({ body }) => body,
  );
}

function composerOf(page: Page, recipient: string) {
  return page.getByRole("textbox", { name: `Message to ${recipient}` });
}

function logOf(page: Page, recipient: string) {
  return page.getByRole("log", { name: `Messages with ${recipient}` });
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  execute(`delete from public.workforce_requirements where country_code = ${literal(LUXEMBOURG)}`);
  setPartnerRelease(true);
  setRelease("release_job_orders", true);
  setRelease("release_messaging", true);
});
test.afterAll(() => {
  execute(`grant execute on function ${LIST_FUNCTION} to authenticated; grant execute on function ${SEND_FUNCTION} to authenticated`);
  setRelease("release_messaging", false);
  setRelease("release_job_orders", false);
  setPartnerRelease(false);
});

test.describe("Conversations and messages (FR-P1)", () => {
  test("AC1, AC8 to AC11: Message opens the thread, text stays literal, the candidate answers and the employer sees it live", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const { team, member, candidate, applicationId, candidateName, employerName } = await applicantSetup();

    await signInAtAal1(page, member, applicantUrl(team.slug, applicationId));
    const message = page.getByRole("button", { name: `Message ${candidateName}` });
    await waitForHydration(message);
    await message.click();
    await expect(page).toHaveURL(CONVERSATION_URL);
    const conversationId = conversationIdOf(page);
    await expect(page).toHaveURL(`${orgInboxUrl(team.slug)}/${conversationId}`);
    await expect(page.getByRole("heading", { level: 1, name: candidateName })).toBeVisible();
    await expect(page.getByText("Application: Welder Luxembourg")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the application" })).toHaveAttribute("href", applicantUrl(team.slug, applicationId));
    await expect(page.getByText("No messages yet")).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const composer = composerOf(page, candidateName);
    await waitForHydration(composer);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await composer.fill("x".repeat(4001));
    await expect(composer).toHaveValue("x".repeat(4000));
    await expect(page.getByText("4,000 / 4,000 characters")).toBeVisible();
    await composer.fill("<img src=x onerror=alert(1)>");
    await composer.press("Enter");
    await composer.pressSequentially("second line");
    await composer.evaluate((element) => {
      const data = new DataTransfer();
      data.items.add(new File(["%PDF-1.4"], "passport.pdf", { type: "application/pdf" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
    });
    await expect(page.getByText("Documents are shared through the passport")).toBeVisible();
    await composer.press("Control+Enter");

    const log = logOf(page, candidateName);
    await expect(log.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
    await expect(log.getByText("second line")).toBeVisible();
    await expect(log.locator("img")).toHaveCount(0);
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("");
    expect(storedBodies(conversationId)).toEqual(["<img src=x onerror=alert(1)>\nsecond line"]);

    const other = await newVisitor(browser);
    try {
      await signIn(other.page, candidate);
      await other.page.goto(INBOX_URL);
      const row = other.page.getByRole("link", { name: new RegExp(`^${escaped(employerName)}, 1 unread$`) });
      await expect(row).toBeVisible();
      await expectAccessibleAtBothWidths(other.page);
      await other.page.setViewportSize({ width: 1280, height: 900 });
      await row.click();
      await expect(other.page).toHaveURL(`${INBOX_URL}/${conversationId}`);
      await expect(other.page.getByRole("heading", { level: 1, name: employerName })).toBeVisible();
      await expect(other.page.getByRole("link", { name: "Open the application" })).toHaveAttribute("href", `/en/applications/${applicationId}`);
      const reply = composerOf(other.page, employerName);
      await waitForHydration(reply);
      await reply.fill("Can I start in March? see https://example.com");
      await other.page.getByRole("button", { name: "Send" }).click();
      const candidateLog = logOf(other.page, employerName);
      await expect(candidateLog.getByText("Can I start in March? see https://example.com")).toBeVisible();
      await expect(candidateLog.getByRole("link")).toHaveCount(0);
      await expectAccessibleAtBothWidths(other.page);

      await expect(log.getByText("Can I start in March?")).toBeVisible({ timeout: 10_000 });
      await expect(log.getByRole("listitem").last()).toContainText("Can I start in March?");
      await expect(log.getByRole("link")).toHaveCount(0);
      await other.page.goto(INBOX_URL);
      await expect(other.page.getByRole("link", { name: employerName, exact: true })).toBeVisible();
    } finally {
      await other.context.close();
    }
    expect(dialogs).toEqual([]);

    await page.goto(orgInboxUrl(team.slug));
    await expect(page.getByRole("link", { name: new RegExp(`^${escaped(candidateName)}`) })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
  });

  test("AC1, AC11: a partner opens the conversation of its accepted invitation and the employer finds it under Invitations", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const team = await newTeam();
    const { user: employerMember } = await addMember(team, "member");
    const partner = await partnerWithCompany("recruitment_company");
    const partnerMember = await createCommittedUser("company");
    const requirement = randomUUID();
    const invitation = randomUUID();
    execute(
      `update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days'
       where id = ${literal(partner.id)};
       insert into public.organization_members (organization_id, user_id, role, accepted_at, invited_by)
       values (${literal(partner.id)}, ${literal(partnerMember.id)}, 'member', now(), ${literal(partner.user.id)});
       insert into public.workforce_requirements (id, organization_id, title, workers_needed, country_code, city_region, industry_code,
         start_date, duration_months, employment_type, recruitment_preference, partner_need, created_by, status, visibility, show_identity,
         published_at, closes_on)
       values (${literal(requirement)}, ${literal(team.id)}, 'Luxembourg pipe welders', 12, ${literal(LUXEMBOURG)}, 'Esch', 'C', date '2027-04-01', 12,
         'full_time', 'international', 'recruitment', ${literal(team.owner.id)}, 'open', 'private', false, now(), date '2027-04-30');
       insert into public.requirement_occupations (requirement_id, occupation_id, quantity) values (${literal(requirement)}, '7212', 12);
       insert into public.requirement_countries (requirement_id, country_code) values (${literal(requirement)}, ${literal(LUXEMBOURG)});
       insert into public.requirement_invitations (id, requirement_id, organization_id, employer_organization_id, source, status, viewed_at, answered_at)
       values (${literal(invitation)}, ${literal(requirement)}, ${literal(partner.id)}, ${literal(team.id)}, 'directory', 'accepted', now(), now());
       insert into private.requirement_reveals (requirement_id, organization_id, cause) values (${literal(requirement)}, ${literal(partner.id)}, 'invitation')
       on conflict do nothing`,
    );
    const employerName = displayName(team.id);
    const partnerName = displayName(partner.id);

    await signInAtAal1(page, partnerMember, `/en/org/${partner.slug}/invitations/${invitation}`);
    const message = page.getByRole("button", { name: `Message ${employerName}` });
    await waitForHydration(message);
    await message.click();
    await expect(page).toHaveURL(CONVERSATION_URL);
    const conversationId = conversationIdOf(page);
    await expect(page.getByRole("heading", { level: 1, name: employerName })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the invitation" })).toHaveAttribute("href", `/en/org/${partner.slug}/invitations/${invitation}`);
    const composer = composerOf(page, employerName);
    await waitForHydration(composer);
    await composer.fill("Twelve welders are ready for April.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(logOf(page, employerName).getByText("Twelve welders are ready for April.")).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    const other = await newVisitor(browser);
    try {
      await signInAtAal1(other.page, employerMember, `${orgInboxUrl(team.slug)}?context=requirement_invitation`);
      await expect(other.page.getByRole("link", { name: "Invitations", exact: true })).toHaveAttribute("aria-current", "page");
      const row = other.page.getByRole("link", { name: new RegExp(`^${escaped(partnerName)}, 1 unread$`) });
      await expect(row).toBeVisible();
      await expect(other.page.getByText("Luxembourg pipe welders")).toBeVisible();
      await expectAccessibleAtBothWidths(other.page);
      await other.page.setViewportSize({ width: 1280, height: 900 });
      await row.click();
      await expect(other.page).toHaveURL(`${orgInboxUrl(team.slug)}/${conversationId}`);
      await expect(other.page.getByRole("link", { name: "Open the requirement" })).toHaveAttribute("href", `/en/org/${team.slug}/requirements/${requirement}`);
      await other.page.goto(`${orgInboxUrl(team.slug)}?context=application`);
      await expect(other.page.getByText("No conversations about applications")).toBeVisible();
      await other.page.goto(`/en/org/${team.slug}/requirements/${requirement}/invitations`);
      await expect(other.page.getByRole("button", { name: `Message ${partnerName}` })).toBeVisible();
    } finally {
      await other.context.close();
    }
  });

  test("AC10: an empty inbox says when conversations start, a failed list retries, and a failed send keeps the text", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const newcomer = await newApplicant();
    await signIn(page, newcomer);
    await page.goto(INBOX_URL);
    await expect(page.getByRole("heading", { name: "No conversations yet" })).toBeVisible();
    await expect(page.getByText("A conversation starts when an employer writes to you")).toBeVisible();
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("link", { name: "Submissions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No conversations about submissions" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Show all conversations" })).toHaveAttribute("href", INBOX_URL);

    execute(`revoke execute on function ${LIST_FUNCTION} from authenticated`);
    try {
      await page.goto(INBOX_URL);
      await expect(page.getByText("Your conversations could not be loaded").first()).toBeVisible();
      await expectNoAxeViolations(page);
    } finally {
      execute(`grant execute on function ${LIST_FUNCTION} to authenticated`);
    }
    const retry = page.getByRole("button", { name: "Try again" });
    await waitForHydration(retry);
    await retry.click();
    await expect(page.getByRole("heading", { name: "No conversations yet" })).toBeVisible();

    const { team, member, applicationId, candidateName } = await applicantSetup();
    const conversationId = await openAs(member, "application", applicationId);
    const other = await newVisitor(browser);
    try {
      await signInAtAal1(other.page, member, `${orgInboxUrl(team.slug)}/${conversationId}`);
      const composer = composerOf(other.page, candidateName);
      await waitForHydration(composer);
      await composer.fill("Kept text");
      execute(`revoke execute on function ${SEND_FUNCTION} from authenticated`);
      try {
        await other.page.getByRole("button", { name: "Send" }).click();
        await expect(other.page.getByText("The message was not sent").first()).toBeVisible();
      } finally {
        execute(`grant execute on function ${SEND_FUNCTION} to authenticated`);
      }
      await expect(composer).toHaveValue("Kept text");
      expect(storedBodies(conversationId)).toEqual([]);
    } finally {
      await other.context.close();
    }
  });

  test("AC6, NFR-U4: once the candidate withdraws, both sides keep the history and read why no message can be sent", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { team, member, candidate, applicationId, candidateName, employerName } = await applicantSetup();
    const conversationId = await openAs(member, "application", applicationId);
    await callAs(member, "send_message", { p_conversation: conversationId, p_body: "When can you start?" });
    execute(`select set_config('chara.actor_fn', 'withdraw_application', true); update public.job_applications set status = 'withdrawn' where id = ${literal(applicationId)}`);

    await signInAtAal1(page, member, `${orgInboxUrl(team.slug)}/${conversationId}`);
    await expect(logOf(page, candidateName).getByText("When can you start?")).toBeVisible();
    await expect(page.getByText("This conversation is closed for new messages")).toBeVisible();
    await expect(page.getByText("You can still read the history.")).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    const other = await newVisitor(browser);
    try {
      await signIn(other.page, candidate);
      await other.page.goto(`${INBOX_URL}/${conversationId}`);
      await expect(logOf(other.page, employerName).getByText("When can you start?")).toBeVisible();
      await expect(other.page.getByText("Apply again to talk to the employer.", { exact: false })).toBeVisible();
      await expect(other.page.getByRole("textbox")).toHaveCount(0);
      await other.page.goto(`/en/applications/${applicationId}`);
      await expect(other.page.getByRole("button", { name: /^Message/ })).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  });

  test("NFR-S8: another organisation finds nothing, and every page is not found while release 2c is off", async ({ page }) => {
    test.setTimeout(180_000);
    const { team, member, applicationId } = await applicantSetup();
    const conversationId = await openAs(member, "application", applicationId);
    const outsider = await newTeam();
    const { user: outsiderMember } = await addMember(outsider, "member");

    await signInAtAal1(page, outsiderMember, orgInboxUrl(outsider.slug));
    await expect(page.getByRole("heading", { name: "No conversations yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Messages" }).first()).toBeVisible();
    for (const address of [`${orgInboxUrl(outsider.slug)}/${conversationId}`, `${orgInboxUrl(team.slug)}/${conversationId}`, orgInboxUrl(team.slug)]) {
      await page.goto(address);
      await expect(page.getByRole("heading", { name: "Page not found" }), address).toBeVisible();
    }

    setRelease("release_messaging", false);
    try {
      for (const address of [orgInboxUrl(outsider.slug), `${orgInboxUrl(outsider.slug)}/${conversationId}`, INBOX_URL, `${INBOX_URL}/${conversationId}`]) {
        await page.goto(address);
        await expect(page.getByRole("heading", { name: "Page not found" }), address).toBeVisible();
      }
      await page.goto(`/en/dashboard/employer?org=${outsider.slug}`);
      await expect(page.getByRole("link", { name: "Organisation" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Messages" })).toHaveCount(0);
    } finally {
      setRelease("release_messaging", true);
    }
  });
});
