import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

// The screenshots of unit U65 for the review of the design (the folder is not committed).
const DIRECTORY = path.join(__dirname, "../../../../../docs/phase-1/client/evidence/U65");

export async function evidence(page: Page, name: string): Promise<void> {
  mkdirSync(DIRECTORY, { recursive: true });
  await page.screenshot({ path: path.join(DIRECTORY, `${name}.png`), fullPage: true });
}
