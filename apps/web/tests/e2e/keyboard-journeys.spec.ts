import type { Locator, Page } from "@playwright/test";
import { accountRows, currentDocuments, userByEmail } from "./support/accounts";
import { applicantUrl, seedNamedApplication, stageValue, statusMessages } from "./support/applicants";
import { applicationRows, applyUrl, eventRows, newApplicant, shareOf } from "./support/applications";
import { seedDocument } from "./support/documents";
import { waitForHydration } from "./support/hydration";
import { addCompanyUser, jobRows, newCompany, newJobUrl, seedJob } from "./support/jobs";
import { signInBrowser } from "./support/session";
import { newEmail, PASSWORD } from "./support/signup-page";
import { expect, test } from "./support/test";

// NFR-U1 (WCAG 2.1.1 Keyboard): the four main journeys done with the keyboard alone. The focus moves with Tab from where it
// is, as it would for a person, text is typed key by key, boxes are ticked with Space, a list option is chosen by typing
// its first letters, and buttons are pressed with Enter. Nothing is clicked or filled.
const MAX_TABS = 120;

async function tabTo(page: Page, control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  for (let presses = 0; presses < MAX_TABS; presses += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${control}`);
}

async function typeInto(page: Page, control: Locator, text: string): Promise<void> {
  await tabTo(page, control);
  await page.keyboard.type(text);
}

async function press(page: Page, control: Locator, key: "Space" | "Enter"): Promise<void> {
  await tabTo(page, control);
  await page.keyboard.press(key);
}

// A combobox filters as the person types; Enter takes the first match.
async function chooseByTyping(page: Page, control: Locator, text: string): Promise<void> {
  await typeInto(page, control, text);
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Enter");
}

test.describe("the main journeys with the keyboard alone (NFR-U1)", () => {
  test("a worker signs up", async ({ page }) => {
    const email = newEmail();
    await page.goto("/en/signup");
    await waitForHydration(page.getByLabel("Email address"));

    await press(page, page.getByRole("radio", { name: "I'm a worker" }), "Space");
    await typeInto(page, page.getByLabel("Email address"), email);
    await typeInto(page, page.getByLabel("Password", { exact: true }), PASSWORD);
    for (const { slug, title } of await currentDocuments("worker")) {
      const name = slug === "age-18-plus" ? /I am 18 or older/ : new RegExp(`I accept the ${title}`);
      await press(page, page.getByRole("checkbox", { name }), "Space");
    }
    await press(page, page.getByRole("button", { name: "Create account" }), "Enter");

    await expect(page).toHaveURL(/\/en\/verify-email$/);
    const [user] = userByEmail(email);
    const { account } = accountRows(user.id);
    expect(account.intended_account_kind).toBe("worker");
    expect(account.pending_consents.map(({ purpose }) => purpose).sort()).toEqual(
      (await currentDocuments("worker")).map(({ slug }) => slug).sort(),
    );
  });

  test("a candidate applies with a note, one document and the consent", async ({ page, context }) => {
    const company = await newCompany();
    const jobId = seedJob(company, { title: "Keyboard welder", status: "open" });
    const candidate = await newApplicant();
    const cv = await seedDocument(candidate.id, { title: "Keyboard CV.pdf" });
    await signInBrowser(context, candidate);
    await page.goto(applyUrl(jobId));
    await waitForHydration(page.getByLabel("Cover note (optional)"));

    await typeInto(page, page.getByLabel("Cover note (optional)"), "I weld with MIG and TIG.");
    await press(page, page.getByLabel("Keyboard CV.pdf"), "Space");
    await press(page, page.getByLabel(/I agree to share the selected documents with/), "Space");
    await press(page, page.getByRole("button", { name: "Submit application" }), "Enter");

    await expect(page).toHaveURL(/\/en\/applications\/[0-9a-f-]{36}$/);
    const [application] = applicationRows(candidate.id);
    expect(application).toMatchObject({ job_id: jobId, status: "applied", cover_note: "I weld with MIG and TIG." });
    expect(shareOf(application.id)[0].scope).toEqual([cv.id]);
  });

  test("an owner posts a vacancy and publishes it", async ({ page, context }) => {
    const company = await newCompany();
    await signInBrowser(context, company.owner);
    await page.goto(newJobUrl(company.slug));
    await waitForHydration(page.getByLabel("Title", { exact: true }));

    await typeInto(page, page.getByLabel("Title", { exact: true }), "Keyboard welder");
    await typeInto(page, page.getByLabel("Description", { exact: true }), "We need an experienced MIG and MAG welder for our Hamburg workshop.");
    await chooseByTyping(page, page.getByRole("combobox", { name: "Occupation", exact: true }), "Welders and flame");
    await chooseByTyping(page, page.getByRole("combobox", { name: "Industry", exact: true }), "Manufacturing");
    await chooseByTyping(page, page.getByRole("combobox", { name: "Country", exact: true }), "Germany");
    await typeInto(page, page.getByLabel("City", { exact: true }), "Hamburg");
    await typeInto(page, page.getByLabel("Employment type"), "Full");
    await typeInto(page, page.getByLabel("Recruitment preference"), "Int");
    await press(page, page.getByRole("button", { name: "Save vacancy" }), "Enter");
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);

    await press(page, page.getByRole("button", { name: "Publish", exact: true }), "Enter");
    await expect(page.getByText("The vacancy is published", { exact: true })).toBeVisible();
    expect(jobRows(company.id)).toEqual([
      expect.objectContaining({
        title: "Keyboard welder",
        occupation_id: "7212",
        industry_code: "C",
        country_code: "DE",
        city: "Hamburg",
        employment_type: "full_time",
        recruitment_preference: "international",
        status: "open",
      }),
    ]);
  });

  test("a member moves an applicant to Shortlisted with a note and the candidate's email is queued", async ({ page, context }) => {
    const company = await newCompany();
    const member = await addCompanyUser(company, "member");
    const candidate = await newApplicant();
    const jobId = seedJob(company, { title: "Keyboard stage welder", status: "open" });
    const applicationId = seedNamedApplication(candidate, jobId, company, "viewed");
    await signInBrowser(context, member);
    await page.goto(applicantUrl(company.slug, applicationId));
    const changeStage = page.getByRole("button", { name: "Change stage" });
    await waitForHydration(changeStage);

    await press(page, changeStage, "Enter");
    const dialog = page.getByRole("dialog", { name: "Change stage" });
    await typeInto(page, dialog.getByLabel("New stage"), "Short");
    await typeInto(page, dialog.getByLabel("Note (visible to the candidate)", { exact: true }), "We would like to meet you.");
    await press(page, dialog.getByRole("button", { name: "Review" }), "Enter");
    await press(page, dialog.getByRole("button", { name: "Confirm" }), "Enter");

    await expect(page.getByText("Stage changed to Shortlisted", { exact: true })).toBeVisible();
    await expect(stageValue(page)).toHaveText("Shortlisted");
    expect(eventRows(applicationId).at(-1)).toMatchObject({
      from_status: "viewed",
      to_status: "shortlisted",
      actor_id: member.id,
      note: "We would like to meet you.",
    });
    expect(statusMessages(applicationId)).toEqual([{ user_id: candidate.id, status: "shortlisted", note: null }]);
  });
});
