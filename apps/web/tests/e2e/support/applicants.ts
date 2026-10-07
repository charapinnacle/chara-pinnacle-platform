import type { Locator, Page } from "@playwright/test";
import { execute, literal, query } from "./db";
import { seedApplication } from "./applications";
import { expect } from "./test";
import type { Company } from "./jobs";
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

export const stageValue = (page: Page): Locator => page.locator("div:has(> dt:text-is('Stage')) > dd");
export const changeStageButton = (page: Page): Locator => page.getByRole("button", { name: "Change stage" });
export const stageDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Change stage" });

// Opens the dialog with the keyboard, as a person who does not use a mouse does, and chooses a stage and a note.
export async function chooseStage(page: Page, stage: string, note: string): Promise<void> {
  await changeStageButton(page).focus();
  await page.keyboard.press("Enter");
  const dialog = stageDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("New stage").selectOption({ label: stage });
  if (note) await dialog.getByLabel("Visible to the candidate").fill(note);
  await dialog.getByRole("button", { name: "Review" }).click();
}
