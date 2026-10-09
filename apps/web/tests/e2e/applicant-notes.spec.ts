import { applicantUrl, setupApplicant } from "./support/applicants";
import { execute, literal, query } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser } from "./support/jobs";
import { logIn } from "./support/login-page";
import { enrollTotp } from "./support/login";
import { enterCode } from "./support/mfa";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";

test.describe("the internal notes of the applicant detail page", () => {
  test("FR-E2 AC7: a member adds internal notes, which are labelled, listed newest first and shown as plain text", async ({ page, browser }) => {
    const { company, member, applicationId } = await setupApplicant();
    const admin = await addCompanyUser(company, "admin");
    const secret = await enrollTotp(admin);

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    const notes = page.getByRole("region", { name: "Internal notes" });
    await expect(notes.getByText("Visible to your organization only. The candidate never sees them.")).toBeVisible();
    await expect(notes.getByText("No internal notes yet.")).toBeVisible();
    const field = notes.getByLabel("Add an internal note");
    await waitForHydration(field);
    const add = notes.getByRole("button", { name: "Add note" });

    await field.fill("Call on Monday");
    await add.click();
    await expect(page.getByText("Note added", { exact: true })).toBeVisible();
    await expect(notes.getByRole("listitem")).toHaveCount(1);
    await expect(field).toHaveValue("");

    await field.fill("   ");
    await add.click();
    await expect(notes.getByRole("alert").first()).toContainText("Enter a note");
    await field.fill("a".repeat(2001));
    await expect(notes.getByText("2001/2000")).toBeVisible();
    await add.click();
    await expect(notes.getByRole("alert").first()).toContainText("Note must be at most 2000 characters");
    await field.fill("b".repeat(2000));
    await add.click();
    await expect(notes.getByRole("listitem")).toHaveCount(2);
    await field.fill("<b>x</b>");
    await add.click();
    await expect(notes.getByRole("listitem")).toHaveCount(3);

    const items = notes.getByRole("listitem");
    await expect(items.first()).toContainText("<b>x</b>");
    await expect(items.first()).toContainText("Internal note");
    await expect(items.first().locator("b")).toHaveCount(0);
    await expect(items.last()).toContainText("Call on Monday");
    const rows = query<{ organization_id: string; author_id: string; length: number }>(
      `select organization_id, author_id, length(body)::int as length from public.application_notes where application_id = ${literal(applicationId)} order by id`,
    );
    expect(rows).toEqual([
      { organization_id: company.id, author_id: member.id, length: 14 },
      { organization_id: company.id, author_id: member.id, length: 2000 },
      { organization_id: company.id, author_id: member.id, length: 8 },
    ]);

    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.4.3.2" } });
    const adminPage = await context.newPage();
    await logIn(adminPage, admin, applicantUrl(company.slug, applicationId));
    await enterCode(adminPage, secret);
    await expect(adminPage.getByRole("region", { name: "Internal notes" }).getByText("Call on Monday")).toBeVisible();
    await context.close();
  });

  test("FR-E2 AC7, AC9: the candidate never sees a note, and a lapsed organisation reads its notes but cannot add one", async ({ page, browser }) => {
    const { company, member, candidate, applicationId } = await setupApplicant();
    execute(
      `insert into public.application_notes (application_id, organization_id, author_id, body)
       values (${literal(applicationId)}, ${literal(company.id)}, ${literal(member.id)}, 'Secret opinion of the team')`,
    );
    execute(
      `insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(company.id)}, 'employer_starter', 'canceled', 'null')`,
    );

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    const notes = page.getByRole("region", { name: "Internal notes" });
    await expect(notes.getByText("Secret opinion of the team")).toBeVisible();
    await expect(notes.getByText("Your organization has no active paid plan, so notes cannot be added.", { exact: false })).toBeVisible();
    await expect(notes.getByLabel("Add an internal note")).toHaveAttribute("aria-disabled", "true");
    await expect(notes.getByRole("button", { name: "Add note" })).toBeDisabled();
    await expect(page.getByRole("region", { name: "Profile as submitted" })).toBeVisible();

    const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.4.3.3" } });
    await signInBrowser(context, candidate);
    const candidatePage = await context.newPage();
    await candidatePage.goto(`/en/applications/${applicationId}`);
    await expect(candidatePage.getByText("Secret opinion of the team")).toHaveCount(0);
    await expect(candidatePage.getByText("Internal note")).toHaveCount(0);
    await context.close();
  });


  test("FR-E2 AC7: notes are listed 50 to a page, and older ones are reached from a link", async ({ page }) => {
    const { company, member, applicationId } = await setupApplicant();
    execute(
      `insert into public.application_notes (application_id, organization_id, author_id, body, created_at)
       select ${literal(applicationId)}, ${literal(company.id)}, ${literal(member.id)}, 'Paged note ' || n, now() - make_interval(mins => 100 - n)
       from generate_series(1, 55) n`,
    );

    await logIn(page, member, applicantUrl(company.slug, applicationId));
    const notes = page.getByRole("region", { name: "Internal notes" });
    const items = notes.getByRole("listitem");
    await expect(items).toHaveCount(50);
    await expect(items.first()).toContainText("Paged note 55");
    await expect(items.last()).toContainText("Paged note 6");
    await expect(notes.getByRole("link", { name: "Back to the newest notes" })).toHaveCount(0);

    await notes.getByRole("link", { name: "Show older notes" }).click();
    await expect(page).toHaveURL(/notesBefore=\d+/);
    await expect(items).toHaveCount(5);
    await expect(items.first()).toContainText("Paged note 5");
    await expect(items.last()).toContainText("Paged note 1");
    await expect(notes.getByRole("link", { name: "Show older notes" })).toHaveCount(0);

    await notes.getByRole("link", { name: "Back to the newest notes" }).click();
    await expect(items).toHaveCount(50);
    await expect(items.first()).toContainText("Paged note 55");
  });
});
