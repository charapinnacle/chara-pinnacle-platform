import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const WCAG_22_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

// NFR-U1: fails on a serious or critical WCAG 2.2 A/AA violation and names the rule, its impact and the elements.
export async function expectNoAxeViolations(page: Page): Promise<void> {
  // The title is streamed after the page content, and a client navigation changes the address before it arrives.
  await expect(page).toHaveTitle(/\S/);
  // A part that streams in rises from opacity 0, and axe would measure a text half faded in: wait until no part is still
  // loading, then for the animations that end (the shimmer of a skeleton never does).
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA_TAGS).analyze();
  const blocking = violations
    .filter(({ impact }) => impact && BLOCKING_IMPACTS.has(impact))
    .map(({ id, impact, nodes }) => `${id} (${impact}): ${nodes.map(({ target }) => target.join(" ")).join(", ")}`);
  expect(blocking, `Accessibility violations on ${page.url()}`).toEqual([]);
}
