import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DirectHiringRule } from "@/lib/validation/direct-hiring-rules";

const rule: DirectHiringRule = {
  id: "00000000-0000-4000-8000-000000000001",
  sourceCountry: "NP",
  sourceName: "Nepal",
  destinationCountry: null,
  destinationName: null,
  rule: "licensed_partner_required",
  notice: "Hiring from Nepal needs a licensed recruitment partner.",
  legalOpinionRef: "LO-2025-09 NP",
  updatedByName: "Ada Admin",
  updatedAt: "2026-11-01T10:00:00Z",
  reviewDue: false,
};

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/direct-hiring-rules", () => ({ saveDirectHiringRule: vi.fn(), deleteDirectHiringRule: vi.fn() }));
vi.mock("@/lib/dal/direct-hiring-rules", () => ({ listDirectHiringRules: async () => [rule] }));
vi.mock("@/lib/dal/reference", () => ({ getCountries: async () => [{ code: "NP", name: "Nepal" }] }));

const { DirectHiringRuleList } = await import("@/components/admin/direct-hiring-rule-list");

describe("the direct-hiring rules table (FR-Q5 AC10)", () => {
  it("keeps every column at a readable width, so a narrow console scrolls the table instead of squeezing it", async () => {
    const html = renderToStaticMarkup(await DirectHiringRuleList());
    const cells = [...html.matchAll(/<td class="([^"]*)"/g)].map((match) => match[1]);
    expect(cells).toHaveLength(6);
    expect(cells.slice(0, 5).map((cell) => /min-w-\d+/.exec(cell)?.[0])).toEqual(["min-w-32", "min-w-36", "min-w-44", "min-w-28", "min-w-36"]);
    expect(html).toMatch(/role="region" aria-label="Direct-hiring rules"[^>]*>|aria-label="Direct-hiring rules" [^>]*role="region"/);
  });
});
