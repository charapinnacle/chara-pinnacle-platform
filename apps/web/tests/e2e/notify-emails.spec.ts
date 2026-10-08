import { applicationRows, applyUrl, displayName, newApplicant } from "./support/applications";
import { applicantUrl, changeStageButton, chooseStage, seedNamedApplication, stageDialog, stageValue } from "./support/applicants";
import { execute, literal, query } from "./support/db";
import { seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { extractLinks, messageCount, waitForMessage } from "./support/mailpit";
import { notificationsOf, runNotify, sendDeliveryEvent, undeliverableAt } from "./support/notify";
import { expect, test } from "./support/test";
import { publicUrl } from "./support/vacancy-page";

// notify takes every message in the queue, so these tests run in their own project after the others
// (playwright.config.ts) and one after the other. The first run also sends what the earlier tests left queued.
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const SITE = "http://localhost:3100";

test.describe("notify: transactional emails through the mail catcher", () => {
  test("FR-I2 AC2: after an application each member of the organisation has one email with the vacancy and a link, and none holds private data", async ({
    page,
  }) => {
    const company = await newCompany();
    const admin = await addCompanyUser(company, "admin");
    const member = await addCompanyUser(company, "member");
    const jobId = seedJob(company, { title: "Notify welder", status: "open" });
    const candidate = await newApplicant();
    await seedDocument(candidate.id, { title: "Confidential CV.pdf" });
    const note = "Private cover note 4711";

    await logIn(page, candidate, publicUrl(jobId));
    await page.getByRole("link", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(applyUrl(jobId));
    await waitForHydration(page.getByLabel("Cover note (optional)"));
    await page.getByLabel("Cover note (optional)").fill(note);
    await page.getByLabel("Confidential CV.pdf").check();
    await page.getByLabel(`I agree to share the selected documents with ${displayName(company.id)} for this application`).check();
    await page.getByRole("button", { name: "Submit application" }).click();
    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}$/);
    const [application] = applicationRows(candidate.id);

    const members = [company.owner, admin, member];
    const queued = query<{ user_id: string; status: string }>(
      `select user_id, status from public.notifications where kind = 'application_received' and payload ->> 'application_id' = ${literal(application.id)}`,
    );
    expect(queued.map((row) => row.user_id).sort()).toEqual(members.map((user) => user.id).sort());
    expect(queued.every((row) => row.status === "queued")).toBe(true);

    const run = await runNotify();
    expect(run.failed).toBe(0);
    expect(run.sent).toBeGreaterThanOrEqual(3);

    for (const user of members) {
      const mail = await waitForMessage(user.email, { subject: "New application for Notify welder" });
      expect(await messageCount(user.email)).toBe(1);
      expect(mail.Text).toContain("Notify welder");
      expect(extractLinks(mail)).toContain(`${SITE}/en/org/${company.slug}/applicants`);
      for (const private_ of [note, "Confidential CV", candidate.email]) {
        expect(mail.Text).not.toContain(private_);
        expect(mail.HTML).not.toContain(private_);
      }
      const [row] = notificationsOf(user.id);
      expect(row).toMatchObject({ kind: "application_received", status: "sent", attempts: 1, sent: true, last_error: null });
      expect(row.provider_message_id).toMatch(/^null-/);
    }
    expect(await messageCount(candidate.email)).toBe(0);

    await runNotify();
    for (const user of members) expect(await messageCount(user.email)).toBe(1);
  });

  test("FR-I2 AC3: the candidate gets one email for the move to Interview, none for Viewed, and it carries no note", async ({ page }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Notify stage welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, jobId, company, "applied");
    const note = "Bring your passport on Monday";

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(stageValue(page)).toHaveText("Viewed");
    await waitForHydration(changeStageButton(page));
    await chooseStage(page, "Interview", note);
    await stageDialog(page).getByRole("button", { name: "Confirm" }).click();
    await expect(stageValue(page)).toHaveText("Interview");

    await runNotify();
    const mail = await waitForMessage(candidate.email, { subject: "Notify stage welder" });
    expect(mail.Subject).toBe("Your application for Notify stage welder: update");
    expect(mail.Text).toContain("is now: Interview.");
    expect(extractLinks(mail)).toContain(`${SITE}/en/applications/${applicationId}`);
    expect(mail.Text).not.toContain(note);
    expect(mail.HTML).not.toContain(note);
    expect(await messageCount(candidate.email)).toBe(1);
    expect(notificationsOf(candidate.id).map(({ kind, status }) => `${kind}:${status}`)).toEqual(["status_changed:sent"]);
  });

  test("FR-I2 AC11 and AC12: a signed bounce marks the address undeliverable and later email is suppressed, a forged event changes nothing", async () => {
    const company = await newCompany();
    const owner = company.owner;
    const send = () =>
      execute(`select pgmq.send('notifications', jsonb_build_object('kind', 'mfa_reset', 'user_id', ${literal(owner.id)}::uuid))`);

    send();
    await runNotify();
    await waitForMessage(owner.email, { subject: "Two-step verification was reset" });
    const [first] = notificationsOf(owner.id);
    expect(first).toMatchObject({ status: "sent", delivery: null });
    const event = (type: string, data: Record<string, unknown> = {}) => ({
      type,
      data: { email_id: first.provider_message_id, ...data },
    });

    expect((await sendDeliveryEvent(event("email.bounced", { bounce: { type: "Permanent" } }), { key: "whsec_Zm9yZ2VyeQ==" })).status).toBe(401);
    expect((await sendDeliveryEvent(event("email.bounced"), { timestamp: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${process.env.NOTIFY_PORT}`, { method: "POST", body: JSON.stringify(event("email.bounced")) })).status).toBe(401);
    expect(notificationsOf(owner.id)[0].delivery).toBeNull();
    expect(undeliverableAt(owner.id)).toBeNull();

    const delivered = await sendDeliveryEvent(event("email.delivered"));
    expect(delivered.status).toBe(200);
    expect(await delivered.json()).toEqual({ recorded: true });
    expect(await (await sendDeliveryEvent(event("email.delivered"))).json()).toEqual({ recorded: false });
    expect(notificationsOf(owner.id)[0].delivery).toBe("delivered");

    expect((await sendDeliveryEvent(event("email.bounced", { bounce: { type: "Transient" } }))).status).toBe(200);
    expect(undeliverableAt(owner.id)).toBeNull();
    expect((await sendDeliveryEvent(event("email.bounced", { bounce: { type: "Permanent" } }))).status).toBe(200);
    expect(notificationsOf(owner.id)[0].delivery).toBe("bounced_permanent");
    expect(undeliverableAt(owner.id)).not.toBeNull();
    expect((await sendDeliveryEvent({ type: "email.delivered", data: { email_id: "re_unknown" } })).status).toBe(404);

    send();
    await runNotify();
    const [, second] = notificationsOf(owner.id);
    expect(second).toMatchObject({ status: "suppressed", provider_message_id: null, sent: false });
    expect(await messageCount(owner.email)).toBe(1);
  });
});
