import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PricingTabs } from "@/components/public/pricing-tabs";

const tabs = [
  { key: "employer", label: "Employers", panel: <p>employer plans</p> },
  { key: "recruitment_company", label: "Recruitment companies", panel: <p>recruitment plans</p> },
  { key: "staffing_company", label: "Staffing companies", panel: <p>staffing plans</p> },
];

const selected = (html: string) => [...html.matchAll(/aria-selected="true"[^>]*>([^<]+)</g)].map((match) => match[1]);

describe("PricingTabs (FR-R1 AC3, FR-L5)", () => {
  it("opens on the tab of the viewer's own type of company", () => {
    expect(selected(renderToStaticMarkup(<PricingTabs label="Plans" tabs={tabs} initial="staffing_company" />))).toEqual(["Staffing companies"]);
    expect(selected(renderToStaticMarkup(<PricingTabs label="Plans" tabs={tabs} initial="recruitment_company" />))).toEqual([
      "Recruitment companies",
    ]);
  });

  it("opens on the first tab without a type, or with one it does not have", () => {
    expect(selected(renderToStaticMarkup(<PricingTabs label="Plans" tabs={tabs} />))).toEqual(["Employers"]);
    expect(selected(renderToStaticMarkup(<PricingTabs label="Plans" tabs={tabs} initial="worker" />))).toEqual(["Employers"]);
  });
});
