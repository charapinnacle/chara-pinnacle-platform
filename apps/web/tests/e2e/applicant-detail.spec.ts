import { formatDate } from "@/lib/i18n/format";
import { eventRows, expectAccessibleAtBothWidths, newApplicant, seedEvent } from "./support/applications";
import {
  applicantUrl,
  changeStageButton,
  chooseStage,
  DETAIL,
  seedDetailedApplication,
  seedNamedApplication,
  setupApplicant,
  stageDialog,
  stageValue,
  statusMessages,
} from "./support/applicants";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, expectNotFound, newCompany, seedJob } from "./support/jobs";
import { logIn } from "./support/login-page";
import { staffUser } from "./support/mfa";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

const snapshotOf = (applicationId: string) =>
  query<{ profile_snapshot: unknown }>(`select profile_snapshot from public.job_applications where id = ${literal(applicationId)}`)[0].profile_snapshot;

const INDICATOR = "Profile changed since this application was submitted";

test.describe("the applicant detail page", () => {
  test("FR-E2 AC1: the page shows the profile as it was submitted, not the live one, and none of the attributes the platform does not hold", async ({ page }) => {
    const { company, member, applicationId } = await setupApplicant();
    const candidateId = query<{ id: string }>(`select worker_user_id as id from public.job_applications where id = ${literal(applicationId)}`)[0].id;
    execute(`update public.worker_profiles set headline = 'Senior welder' where user_id = ${literal(candidateId)}`);
    const before = snapshotOf(applicationId);

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(page.getByRole("heading", { name: "Ana Silva", level: 1 })).toBeVisible();
    const profile = page.getByRole("region", { name: "Profile as submitted" });
    await expect(profile.getByText(`Submitted ${DETAIL.submitted}`, { exact: true })).toBeVisible();
    const row = (label: string) => profile.locator(`div:has(> dt:text-is('${label}')) > dd`);
    await expect(row("Headline")).toHaveText("Welder");
    await expect(row("Occupation")).toHaveText("Welders and flame cutters");
    await expect(row("Country")).toHaveText("Portugal");
    await expect(row("Experience")).toHaveText("6 years");
    await expect(row("Availability")).toHaveText(`Available from ${formatDate(DETAIL.availableFrom)}`);
    await expect(row("Skills").getByRole("listitem")).toHaveText([...DETAIL.skills].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    await expect(row("Languages").getByRole("listitem")).toHaveText(["German, A2", "English, C1"]);
    await expect(row("Preferred countries")).toHaveText("Germany");
    await expect(row("Work authorization")).toHaveText(`Portugal, valid until ${formatDate(DETAIL.authorizationExpires)}`);
    await expect(profile.getByText(DETAIL.coverNote)).toBeVisible();
    await expect(stageValue(page)).toHaveText("Viewed");
    await expect(page.getByText("Senior welder")).toHaveCount(0);
    await expect(page.getByText(/date of birth|nationality|gender|religion|marital/i)).toHaveCount(0);
    expect(snapshotOf(applicationId)).toEqual(before);
    await expect(page.getByText(INDICATOR)).toBeVisible();
  });

  test("FR-E2 AC2: the indicator shows only when the live profile differs and the share still runs", async ({ page }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const open = async (title: string, status = "applied") => {
      const candidate = await newApplicant();
      return { candidate, id: seedDetailedApplication(candidate, seedJob(company, { title, status: "open" }), company, { status }) };
    };
    const changed = await open("Indicator vacancy 1");
    const saved = await open("Indicator vacancy 2");
    const withdrawn = await open("Indicator vacancy 3");
    const hired = await open("Indicator vacancy 4", "offer");
    const edit = (candidateId: string, set: string) => execute(`update public.worker_profiles set ${set} where user_id = ${literal(candidateId)}`);
    edit(changed.candidate.id, "headline = 'Senior welder'");
    edit(saved.candidate.id, "headline = headline, years_experience = years_experience");
    edit(withdrawn.candidate.id, "headline = 'Changed before withdrawing'");
    execute(`select set_config('chara.actor_fn', 'withdraw_application', true); update public.job_applications set status = 'withdrawn' where id = ${literal(withdrawn.id)};
             update public.passport_shares set revoked_at = now() where application_id = ${literal(withdrawn.id)}`);
    edit(hired.candidate.id, "headline = 'Changed after hiring'");
    execute(`select set_config('chara.actor_fn', 'set_application_status', true); update public.job_applications set status = 'hired' where id = ${literal(hired.id)};
             update public.passport_shares set expires_at = now() - interval '1 minute' where application_id = ${literal(hired.id)}`);

    await logIn(page, member, applicantUrl(company.slug, changed.id));
    await expect(page.getByText(INDICATOR)).toBeVisible();
    await expect(page.getByRole("region", { name: "Profile as submitted" }).getByText("Welder", { exact: true })).toBeVisible();
    await expect(page.getByText("Senior welder")).toHaveCount(0);
    for (const { id } of [saved, withdrawn, hired]) {
      await page.goto(applicantUrl(company.slug, id));
      await expect(page.getByRole("heading", { name: "Ana Silva", level: 1 })).toBeVisible();
      await expect(page.getByText(INDICATOR)).toHaveCount(0);
      await expect(page.getByText("Changed before withdrawing")).toHaveCount(0);
      await expect(page.getByText("Changed after hiring")).toHaveCount(0);
    }
    await page.goto(applicantUrl(company.slug, withdrawn.id));
    await expect(page.getByText("This document is no longer available.", { exact: false })).toBeVisible();
  });

  test("FR-E2 AC10, AC11: the history lists every event with its actor, and the stage changes and the decline are made from the page", async ({ page, browser }) => {
    const { company, member, candidate, jobId } = await setupApplicant();
    const colleague = await addCompanyUser(company, "member");
    const applicationId = seedDetailedApplication(candidate, seedJob(company, { title: "History welder", status: "open" }), company, { status: "shortlisted" });
    seedEvent(applicationId, { from: "applied", to: "viewed", at: new Date(Date.now() - 3 * 3_600_000).toISOString() });
    seedEvent(applicationId, {
      from: "viewed",
      to: "shortlisted",
      actorId: colleague.id,
      note: "Strong welding record",
      at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    });
    const bo = await newApplicant();
    const boId = seedNamedApplication(bo, jobId, company, "viewed");

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    const history = page.getByRole("region", { name: "History" });
    const entries = history.getByRole("listitem");
    await expect(entries).toHaveCount(3);
    await expect(entries.nth(0)).toContainText("Applied");
    await expect(entries.nth(0)).toContainText("Candidate");
    await expect(entries.nth(1)).toContainText("Applied to Viewed");
    await expect(entries.nth(1)).toContainText("System");
    await expect(entries.nth(2)).toContainText("Viewed to Shortlisted");
    await expect(entries.nth(2)).toContainText("Visible to the candidate");
    await expect(entries.nth(2)).toContainText("Strong welding record");
    await expect(history.getByRole("button")).toHaveCount(0);
    await expect(history.getByRole("link")).toHaveCount(0);

    await waitForHydration(changeStageButton(page));
    await changeStageButton(page).click();
    await expect(stageDialog(page).getByLabel("New stage").locator("option")).toHaveText(["Choose a stage", "Interview", "Offer", "Not selected"]);
    await expect(stageDialog(page).getByLabel("Note (visible to the candidate)", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await chooseStage(page, "Interview", "Interviews in week 41");
    await expect(stageDialog(page).getByText("Note (visible to the candidate)", { exact: true })).toBeVisible();
    await expect(stageDialog(page).getByText("The candidate is told by email.")).toBeVisible();
    await stageDialog(page).getByRole("button", { name: "Confirm" }).click();
    await expect(stageValue(page)).toHaveText("Interview");
    await expect(entries).toHaveCount(4);
    await expect(entries.nth(3)).toContainText("Shortlisted to Interview");
    await expect(entries.nth(3)).toContainText("Interviews in week 41");
    await chooseStage(page, "Offer", "");
    await stageDialog(page).getByRole("button", { name: "Confirm" }).click();
    await expect(stageValue(page)).toHaveText("Offer");
    expect(statusMessages(applicationId)).toEqual([
      { user_id: candidate.id, status: "interview", note: null },
      { user_id: candidate.id, status: "offer", note: null },
    ]);

    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.4.3.4" } });
    await signInBrowser(context, member);
    const second = await context.newPage();
    await second.goto(applicantUrl(company.slug, boId));
    await waitForHydration(changeStageButton(second));
    await changeStageButton(second).click();
    await stageDialog(second).getByLabel("New stage").selectOption({ label: "Not selected" });
    await stageDialog(second).getByRole("button", { name: "Review" }).click();
    await expect(stageDialog(second).getByRole("alert").first()).toContainText("Choose a reason");
    expect(eventRows(boId)).toHaveLength(1);
    await stageDialog(second).getByLabel("Reason (visible to the candidate)", { exact: true }).selectOption({ label: "Other" });
    await stageDialog(second).getByLabel("Other reason (visible to the candidate)").fill("   ");
    await stageDialog(second).getByRole("button", { name: "Review" }).click();
    await expect(stageDialog(second).getByRole("alert").first()).toContainText("Enter a reason");
    await stageDialog(second).getByLabel("Reason (visible to the candidate)", { exact: true }).selectOption({ label: "Position filled" });
    await stageDialog(second).getByRole("button", { name: "Review" }).click();
    await expect(stageDialog(second).getByText("Ana Silva", { exact: true })).toBeVisible();
    await expect(stageDialog(second).getByText("Not selected", { exact: true })).toBeVisible();
    await expect(stageDialog(second).getByText("Position filled", { exact: true })).toBeVisible();
    await expect(stageDialog(second).getByText("A decision of Not selected is final. The candidate is told by email.")).toBeVisible();
    expect(eventRows(boId)).toHaveLength(1);
    await stageDialog(second).getByRole("button", { name: "Confirm" }).click();
    await expect(stageValue(second)).toHaveText("Not selected");
    await expect(changeStageButton(second)).toHaveCount(0);
    await expect(second.getByText("Not selected is a final stage. No further stage can be chosen.")).toBeVisible();
    expect(eventRows(boId)[1]).toMatchObject({ from_status: "viewed", to_status: "rejected", actor_id: member.id, note: "Position filled" });
    expect(statusMessages(boId)).toEqual([{ user_id: bo.id, status: "rejected", note: null }]);
    await context.close();
  });

  test("FR-E2 AC10: a withdrawal by the candidate shows in the history in the same way, and the page offers no further stage", async ({ page }) => {
    const { company, member, candidate } = await setupApplicant();
    const applicationId = seedDetailedApplication(candidate, seedJob(company, { title: "Withdrawn welder", status: "open" }), company, { status: "withdrawn" });
    seedEvent(applicationId, { from: "applied", to: "shortlisted", actorId: member.id, at: new Date(Date.now() - 2 * 3_600_000).toISOString() });
    seedEvent(applicationId, { from: "shortlisted", to: "withdrawn", actorId: candidate.id, at: new Date(Date.now() - 3_600_000).toISOString() });

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    const entries = page.getByRole("region", { name: "History" }).getByRole("listitem");
    await expect(entries).toHaveCount(3);
    await expect(entries.last()).toContainText("Shortlisted to Withdrawn");
    await expect(entries.last()).toContainText("Candidate");
    await expect(stageValue(page)).toHaveText("Withdrawn");
    await expect(changeStageButton(page)).toHaveCount(0);
  });

  test("FR-E2 AC12: a visitor, a member of another organisation, the applicant, a platform administrator and an owner without two-step verification move nothing", async ({ page, browser }) => {
    const { company, candidate, applicationId } = await setupApplicant();
    const other = await newCompany();
    const outsider = await addCompanyUser(other, "member");
    const staff = await staffUser("admin");

    await page.goto(applicantUrl(company.slug, applicationId));
    await expect(page).toHaveURL(/\/en\/login\?next=/);
    for (const [index, user] of [outsider, staff].entries()) {
      const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.4.5.${index + 1}` } });
      await signInBrowser(context, user);
      const visit = await context.newPage();
      await expectNotFound(visit, applicantUrl(company.slug, applicationId));
      await expect(visit.getByText("Ana Silva")).toHaveCount(0);
      await context.close();
    }
    const candidateContext = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.4.5.9" } });
    await signInBrowser(candidateContext, candidate);
    const candidatePage = await candidateContext.newPage();
    await candidatePage.goto(applicantUrl(company.slug, applicationId));
    await expect(candidatePage).toHaveURL(/\/en\/dashboard\/worker$/);
    await expect(candidatePage.getByText("Ana Silva")).toHaveCount(0);
    await candidateContext.close();
    await logIn(page, company.owner, applicantUrl(company.slug, applicationId));
    await expect(page).toHaveURL(/\/en\/mfa/);
    expect(eventRows(applicationId)).toHaveLength(1);
  });

  test("FR-E2 NFR-U1, NFR-U2: the page has no serious accessibility violation at 1280 and 360 px", async ({ page }) => {
    const { company, member, applicationId } = await setupApplicant({ documents: true });
    execute(
      `insert into public.application_notes (application_id, organization_id, author_id, body)
       values (${literal(applicationId)}, ${literal(company.id)}, ${literal(member.id)}, 'A note for the check')`,
    );
    await logIn(page, member, applicantUrl(company.slug, applicationId));
    await expect(page.getByRole("heading", { name: "Ana Silva", level: 1 })).toBeVisible();
    await waitForHydration(changeStageButton(page));
    await expectAccessibleAtBothWidths(page);
    await changeStageButton(page).click();
    await stageDialog(page).getByLabel("New stage").selectOption({ label: "Not selected" });
    await expect(stageDialog(page).getByLabel("Reason (visible to the candidate)", { exact: true })).toBeVisible();
    await expectAccessibleAtBothWidths(page);
  });
});
