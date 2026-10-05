import type { Page } from "@playwright/test";

export async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole("combobox", { name: label, exact: true }).fill(option);
  await page.getByRole("option", { name: option, exact: true }).click();
}
