import type { Page } from "@playwright/test";
import { literal, query } from "./db";
import { waitForHydration } from "./hydration";
import { expect } from "./test";

export interface ReportRow {
  id: number;
  target_type: string;
  job_id: string | null;
  organization_id: string | null;
  application_id: string | null;
  content_path: string | null;
  category: string;
  details: string;
  reporter_user_id: string | null;
  reporter_email: string | null;
  status: string;
  resolution_note: string | null;
}

const COLUMNS = `id, target_type::text, job_id, organization_id, application_id, content_path, category::text, details,
  reporter_user_id, reporter_email, status::text, resolution_note`;

export function reportsOfJob(jobId: string): ReportRow[] {
  return query<ReportRow>(`select ${COLUMNS} from public.reports where job_id = ${literal(jobId)} order by id`);
}

export function reportsOfUser(userId: string): ReportRow[] {
  return query<ReportRow>(`select ${COLUMNS} from public.reports where reporter_user_id = ${literal(userId)} order by id`);
}

export function reportsOfApplication(applicationId: string): ReportRow[] {
  return query<ReportRow>(`select ${COLUMNS} from public.reports where application_id = ${literal(applicationId)} order by id`);
}

export function referenceOf(id: number): string {
  return `R-${String(id).padStart(6, "0")}`;
}

export const DETAILS = "The vacancy asks every worker for a fee before the first day of work.";
export const GOOD_FAITH = /I confirm that this report is accurate/;

// The fields every report form has, filled by label as a person would.
export async function fillReport(page: Page, { category = "fee_demanded_from_worker", details = DETAILS, email }: { category?: string; details?: string; email?: string } = {}): Promise<void> {
  await waitForHydration(page.getByLabel("What happened"));
  await page.getByLabel("What is wrong").selectOption(category);
  await page.getByLabel("What happened").fill(details);
  if (email !== undefined) await page.getByLabel("Your email (optional)").fill(email);
  await page.getByLabel(GOOD_FAITH).check();
}

export async function sendReport(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Send report" }).click();
  const received = page.getByRole("status").filter({ hasText: "Your report was received" });
  await expect(received).toBeVisible();
  const text = (await received.innerText()).match(/R-\d{6}/);
  if (!text) throw new Error("No reference number on the page");
  return text[0];
}
