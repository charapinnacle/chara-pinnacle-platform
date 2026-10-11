import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { displayTitle } from "@/lib/validation/consents";
import { currentDocuments } from "./accounts";

export const PASSWORD = "Valid-Passw0rd";
export const WORKER_LABEL = "I'm a worker";
export const EMPLOYER_LABEL = "I'm an employer";

export function newEmail(): string {
  return `e2e-${randomUUID()}@example.test`;
}

export function summary(page: Page) {
  return page.getByRole("alert").filter({ hasText: "There is a problem" });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The stored title keeps its DRAFT: prefix; the form shows the plain title.
export function documentBox(page: Page, title: string) {
  return page.getByRole("checkbox", {
    name: new RegExp(`^I accept the ${escapeRegExp(displayTitle(title))}`),
  });
}

export const AGE_LABEL = "I confirm that I am at least 18 years old.";

export function ageBox(page: Page) {
  return page.getByRole("checkbox", { name: AGE_LABEL, exact: true });
}

export async function fillSignup(
  page: Page,
  {
    kind,
    email,
    password,
    skip = [],
  }: {
    kind: "worker" | "company";
    email: string;
    password: string;
    skip?: string[];
  },
): Promise<void> {
  await page
    .getByRole("radio", { name: kind === "worker" ? WORKER_LABEL : EMPLOYER_LABEL })
    .check();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  for (const { slug, title } of await currentDocuments(kind)) {
    if (skip.includes(slug)) continue;
    const box = slug === "age-18-plus" ? ageBox(page) : documentBox(page, title);
    await box.check();
  }
}
