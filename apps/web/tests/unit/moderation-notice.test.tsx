import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModerationNotice } from "@/components/organization/moderation-notice";

// FR-S1 AC12 (badge and reasons): the partner reads that its profile was hidden by moderation, why, and how to appeal.
describe("the moderation notice of a partner", () => {
  it("shows the badge, the date, the statement of reasons and the appeal route while the profile is hidden", () => {
    const html = renderToStaticMarkup(
      <ModerationNotice
        lang="en"
        moderation={{ state: "hidden", decision: { id: 4, reasons: "Claims of placements never made.", decidedAt: "2026-10-20T09:00:00+00:00" } }}
      />,
    );
    expect(html).toContain("Hidden by moderation");
    expect(html).toContain('id="moderation-heading"');
    expect(html).toContain("20 October 2026");
    expect(html).toContain("Statement of reasons");
    expect(html).toContain("Claims of placements never made.");
    expect(html).toContain('href="/en/legal/complaints-and-dispute-process"');
  });

  it("shows nothing while the profile is visible or hidden with a suspension", () => {
    expect(renderToStaticMarkup(<ModerationNotice lang="en" moderation={{ state: "visible", decision: null }} />)).toBe("");
    expect(renderToStaticMarkup(<ModerationNotice lang="en" moderation={{ state: "org_suspended", decision: null }} />)).toBe("");
  });
});
