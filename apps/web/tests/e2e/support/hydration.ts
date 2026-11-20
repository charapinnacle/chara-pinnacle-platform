import type { Locator } from "@playwright/test";
import { expect } from "./test";

// A server-rendered control is visible before React attaches to it, and a value set in that window is reset when
// hydration finishes. React tags every element it has hydrated with a __reactFiber$ key. A page with many client parts
// (a conversation) can take longer than the default 10 s on a busy machine.
export async function waitForHydration(control: Locator): Promise<void> {
  await expect
    .poll(() => control.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactFiber$"))), { timeout: 30_000 })
    .toBe(true);
}
