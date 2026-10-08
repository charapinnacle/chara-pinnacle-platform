import type { Locator, Page } from "@playwright/test";
import { execute, literal, query } from "./db";
import { newApplicant, seedApplication } from "./applications";
import { seedDocument } from "./documents";
import { addCompanyUser, newCompany, seedJob, type Company } from "./jobs";
import { expect } from "./test";
import type { TestUser } from "./test-user";

export const applicantUrl = (slug: string, id: string) => `/en/org/${slug}/applicants/${id}`;
export const ALREADY_MOVED = "This applicant was already moved. Reload to see the current stage";

// An application in any stage whose snapshot carries the name the applicant page shows.
export function seedNamedApplication(candidate: TestUser, jobId: string, company: Company, status: string, documentIds: string[] = []): string {
  const id = seedApplication(candidate.id, jobId, company.id, { status, documentIds });
  execute(
    `update public.job_applications set profile_snapshot = '{"first_name": "Ana", "last_name": "Silva"}' where id = ${literal(id)}`,
  );
  return id;
}

export function statusMessages(applicationId: string) {
  return query<{ user_id: string; status: string; note: string | null }>(
    `select message ->> 'user_id' as user_id, message ->> 'status' as status, message ->> 'note' as note
     from pgmq.q_notifications where message ->> 'kind' = 'status_changed' and message ->> 'application_id' = ${literal(applicationId)}`,
  );
}

const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export const DETAIL = {
  availableFrom: addDays(30),
  authorizationExpires: addDays(1100),
  skills: ["MIG welding", "TIG welding", "Pipe welding", "Plate cutting"],
  coverNote: "I have six years of experience.",
  submitted: "2026-09-01",
} as const;

// A candidate's passport as the page shows it: a headline, an occupation, four skills, two languages, a preferred country,
// a work authorization with an expiry date, six years of experience and an availability date.
export function fillPassport(candidate: TestUser): void {
  const id = literal(candidate.id);
  execute(
    `delete from public.worker_skills where worker_user_id = ${id};
     delete from public.worker_languages where worker_user_id = ${id};
     delete from public.worker_preferred_countries where worker_user_id = ${id};
     delete from public.worker_work_authorizations where worker_user_id = ${id};
     update public.worker_profiles set first_name = 'Ana', last_name = 'Silva', headline = 'Welder', current_country = 'PT',
       occupation_id = '7212', years_experience = 6, availability = 'from_date', available_from = ${literal(DETAIL.availableFrom)}
     where user_id = ${id};
     insert into public.worker_skills (worker_user_id, skill) select ${id}, s from unnest(${literal(`{${DETAIL.skills.join(",")}}`)}::text[]) s;
     insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (${id}, 'en', 'C1'), (${id}, 'de', 'A2');
     insert into public.worker_preferred_countries (worker_user_id, country_code) values (${id}, 'DE');
     insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on) values (${id}, 'PT', ${literal(DETAIL.authorizationExpires)})`,
  );
}

// An application of a candidate with a filled passport, submitted on 2026-09-01, whose snapshot is the passport as it is
// now (what apply_to_job would have stored), with a share of the given documents.
export function seedDetailedApplication(
  candidate: TestUser,
  jobId: string,
  company: Company,
  { status = "applied", documentIds = [] as string[] }: { status?: string; documentIds?: string[] } = {},
): string {
  fillPassport(candidate);
  const id = seedApplication(candidate.id, jobId, company.id, {
    status,
    documentIds,
    coverNote: DETAIL.coverNote,
    createdAt: `'${DETAIL.submitted}T10:00:00Z'`,
  });
  execute(
    `update public.job_applications set profile_snapshot = private.profile_snapshot(worker_user_id) where id = ${literal(id)}`,
  );
  return id;
}

export const stageValue = (page: Page): Locator => page.locator("div:has(> dt:text-is('Stage')) > dd");
export const changeStageButton = (page: Page): Locator => page.getByRole("button", { name: "Change stage" });
export const stageDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Change stage" });

export const DECLINE_TEMPLATES = ["Position filled", "Qualifications do not match the requirements of this role"];

// Opens the dialog with the keyboard, as a person who does not use a mouse does, and chooses a stage. A decline takes its
// reason from the templates when the text is one of them and from Other otherwise; any other stage takes the text as its note.
export async function chooseStage(page: Page, stage: string, note: string): Promise<void> {
  await changeStageButton(page).focus();
  await page.keyboard.press("Enter");
  const dialog = stageDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("New stage").selectOption({ label: stage });
  if (stage === "Not selected") {
    const template = DECLINE_TEMPLATES.find((text) => text === note.trim());
    await dialog.getByLabel("Reason (visible to the candidate)", { exact: true }).selectOption({ label: template ?? "Other" });
    if (!template) await dialog.getByLabel("Other reason (visible to the candidate)").fill(note);
  } else if (note) {
    await dialog.getByLabel("Note (visible to the candidate)", { exact: true }).fill(note);
  }
  await dialog.getByRole("button", { name: "Review" }).click();
}

// A company with a member, a candidate with a filled passport and an application to one open vacancy; with documents, a CV
// (skipped) and a certificate (clean), and with pending a third file that is still being checked.
export async function setupApplicant(options: { documents?: boolean; pending?: boolean } = {}) {
  const company = await newCompany();
  const member = await addCompanyUser(company, "member");
  const candidate = await newApplicant();
  const jobId = seedJob(company, { title: "Detail welder", status: "open" });
  const documents = options.documents
    ? [
        await seedDocument(candidate.id, { title: "Ana CV", fileName: "ana-cv.pdf", scanStatus: "skipped" }),
        await seedDocument(candidate.id, { title: "Welding certificate", type: "certificate", fileName: "weld.pdf", scanStatus: "clean", expiresOn: "2030-01-01" }),
        ...(options.pending ? [await seedDocument(candidate.id, { title: "Still scanning", scanStatus: "pending" })] : []),
      ]
    : [];
  const applicationId = seedDetailedApplication(candidate, jobId, company, { documentIds: documents.map((document) => document.id) });
  return { company, member, candidate, jobId, documents, applicationId };
}
