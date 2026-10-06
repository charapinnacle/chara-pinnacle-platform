import type { Page } from "@playwright/test";

export const publicUrl = (id: string) => `/en/jobs/${id}`;

export async function bodyOf(page: Page, path: string): Promise<{ status: number; html: string }> {
  const response = await page.request.get(path);
  return { status: response.status(), html: await response.text() };
}
