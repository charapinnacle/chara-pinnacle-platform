import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgencyWorkNotice } from "@/components/compliance/agency-work-notice";
import { agencyWorkRulesFor, outsideFreeMovement, type AgencyWorkRule } from "@/lib/compliance/agency-work";

const rule = (over: Partial<AgencyWorkRule>): AgencyWorkRule => ({
  id: 1,
  destination: "DE",
  nonEuWorkersOnly: false,
  title: "German agency work needs a permit and has limits",
  notice: "A staffing company that leases workers to you in Germany needs a permit.",
  sourceUrl: "https://www.gesetze-im-internet.de/a_g/",
  reviewedOn: "2026-11-23",
  ...over,
});
const rules = [rule({ id: 1 }), rule({ id: 2, nonEuWorkersOnly: true, title: "Non-EU workers cannot usually be leased in Germany" }), rule({ id: 3, destination: "NL" })];

describe("the agency-work rules of a destination", () => {
  it("tells free movement from the rest", () => {
    expect(["DE", "pl", "NO", "CH"].map(outsideFreeMovement)).toEqual([false, false, false, false]);
    expect(["PH", "IN", "NP", "UA", "GB"].map(outsideFreeMovement)).toEqual([true, true, true, true, true]);
  });

  it("returns the destination's rules, the non-EU ones only when such workers may be involved", () => {
    expect(agencyWorkRulesFor(rules, "de").map(({ id }) => id)).toEqual([1, 2]);
    expect(agencyWorkRulesFor(rules, "DE", false).map(({ id }) => id)).toEqual([1]);
    expect(agencyWorkRulesFor(rules, "NL").map(({ id }) => id)).toEqual([3]);
    expect(agencyWorkRulesFor(rules, "FR")).toEqual([]);
    expect(agencyWorkRulesFor(rules, "")).toEqual([]);
    expect(agencyWorkRulesFor(rules, undefined)).toEqual([]);
  });

  it("shows each rule with its source and the date it was checked, as general information only", () => {
    const html = renderToStaticMarkup(<AgencyWorkNotice rules={agencyWorkRulesFor(rules, "DE")} />);
    expect(html).toContain("Before you use a staffing company here");
    expect(html).toContain("Non-EU workers cannot usually be leased in Germany");
    expect(html).toMatch(/target="_blank" rel="noopener noreferrer" href="https:\/\/www\.gesetze-im-internet\.de\/a_g\/"/);
    expect(html).toContain("checked 23 November 2026");
    expect(html).toContain("General information, not legal advice.");
    expect(renderToStaticMarkup(<AgencyWorkNotice rules={[]} />)).toBe("");
  });
});
