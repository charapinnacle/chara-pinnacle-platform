import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const WCAG_22_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = ["serious", "critical"];

// NFR-U1: fails on a serious or critical WCAG 2.2 A/AA violation and names the rule, its impact and the elements.
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA_TAGS).analyze();
  const blocking = violations
    .filter(({ impact }) => impact && BLOCKING_IMPACTS.includes(impact))
    .map(({ id, impact, nodes }) => `${id} (${impact}): ${nodes.map(({ target }) => target.join(" ")).join(", ")}`);
  expect(blocking, `Accessibility violations on ${page.url()}`).toEqual([]);
}
