import type { Page } from "@playwright/test";

// The workforce profile shows one section at a time; its tab is named after the section, then its state.
export async function openProfileSection(page: Page, title: string): Promise<void> {
  await page.getByRole("tab", { name: new RegExp(`^${title} ?,`) }).click();
}
