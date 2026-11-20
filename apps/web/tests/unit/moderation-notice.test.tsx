import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ItemModerationNotice } from "@/components/organization/item-moderation-notice";
import { ModerationNotice } from "@/components/organization/moderation-notice";
import type { AppealableDecision } from "@/lib/dal/appeals";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/appeals", () => ({ submitAppeal: vi.fn() }));

const hidden = { state: "hidden" as const, decision: { id: 4, reasons: "Claims of placements never made.", decidedAt: "2026-10-20T09:00:00+00:00" } };

function decision(over: Partial<AppealableDecision> = {}): AppealableDecision {
  return {
    id: 4,
    targetType: "partner_profile",
    targetId: "org-1",
    action: "content_hidden",
    title: "Alpha Recruit",
    organizationId: "org-1",
    organizationName: "Alpha Recruit",
    orgSlug: "alpha-recruit",
    reasons: "Claims of placements never made.",
    decidedAt: "2026-10-20T09:00:00+00:00",
    appealUntil: "2099-04-20T09:00:00+00:00",
    inEffect: true,
    canAppeal: true,
    targetDays: 7,
    appeal: null,
    ...over,
  };
}

// FR-S1 AC12 (badge, reasons and appeal): the partner reads that its profile was hidden by moderation, why, and where its
// appeal stands; the owner and admins appeal from the badge.
describe("the moderation notice of a partner", () => {
  it("shows the badge, the date, the statement of reasons and the Appeal button to an owner or admin", () => {
    const html = renderToStaticMarkup(<ModerationNotice lang="en" moderation={hidden} appeal={decision()} />);
    expect(html).toContain("Hidden by moderation");
    expect(html).toContain('id="moderation-heading"');
    expect(html).toContain("20 October 2026");
    expect(html).toContain("Statement of reasons");
    expect(html).toContain("Claims of placements never made.");
    expect(html).toContain(">Appeal</button>");
    expect(html).toContain("you can appeal until 20 April 2099");
    expect(html).not.toContain("complaints-and-dispute-process");
  });

  it("tells a member who can appeal, without the button", () => {
    const html = renderToStaticMarkup(<ModerationNotice lang="en" moderation={hidden} appeal={decision({ canAppeal: false })} />);
    expect(html).not.toContain(">Appeal</button>");
    expect(html).toContain("The owner or an admin of Alpha Recruit can appeal this decision until 20 April 2099.");
  });

  it("shows an appeal under review and a decided appeal with its reasons", () => {
    const open = renderToStaticMarkup(
      <ModerationNotice
        lang="en"
        moderation={hidden}
        appeal={decision({
          canAppeal: false,
          appeal: { id: 9, status: "open", grounds: "Every placement is documented.", lodgedAt: "2026-10-21T09:00:00+00:00", dueAt: "2026-10-28T09:00:00+00:00", reasons: null, decidedAt: null },
        })}
      />,
    );
    expect(open).toContain("Appeal under review");
    expect(open).toContain("28 October 2026");
    expect(open).toContain("Every placement is documented.");
    const upheld = renderToStaticMarkup(
      <ModerationNotice
        lang="en"
        moderation={hidden}
        appeal={decision({
          canAppeal: false,
          appeal: { id: 9, status: "upheld", grounds: "Every placement is documented.", lodgedAt: "2026-10-21T09:00:00+00:00", dueAt: "2026-10-28T09:00:00+00:00", reasons: "The documents do not match the claims.", decidedAt: "2026-10-24T09:00:00+00:00" },
        })}
      />,
    );
    expect(upheld).toContain("Decision upheld");
    expect(upheld).toContain("The documents do not match the claims.");
  });

  it("says when the time to appeal has ended", () => {
    const html = renderToStaticMarkup(
      <ModerationNotice lang="en" moderation={hidden} appeal={decision({ canAppeal: false, appealUntil: "2026-04-20T09:00:00+00:00" })} />,
    );
    expect(html).toContain("The time to appeal this decision ended on 20 April 2026.");
  });

  it("shows nothing while the profile is visible or hidden with a suspension", () => {
    expect(renderToStaticMarkup(<ModerationNotice lang="en" moderation={{ state: "visible", decision: null }} appeal={null} />)).toBe("");
    expect(renderToStaticMarkup(<ModerationNotice lang="en" moderation={{ state: "org_suspended", decision: null }} appeal={null} />)).toBe("");
  });
});

// V57: a hidden job order, response or submission shows the same badge, reasons and appeal to its organisation.
describe("the moderation notice of a job order, response or submission", () => {
  const response = decision({ targetType: "partner_response", targetId: "resp-1", title: "Germany, 10 Welders" });

  it("names the kind and what hiding does, quotes the reasons and offers the appeal to an owner or admin", () => {
    const html = renderToStaticMarkup(
      <ItemModerationNotice lang="en" kind="response" effect="The employer no longer sees it and cannot decide on it" moderation={hidden} appeal={response} />,
    );
    expect(html).toContain("Hidden by moderation");
    expect(html).toContain("This response is hidden");
    expect(html).toContain("The employer no longer sees it and cannot decide on it.");
    expect(html).toContain("Claims of placements never made.");
    expect(html).toContain(">Appeal</button>");
  });

  it("links the decisions when the appeal could not be read, and shows nothing while the item is visible or suspended", () => {
    const html = renderToStaticMarkup(<ItemModerationNotice lang="en" kind="requirement" effect="Partners no longer see it" moderation={hidden} appeal={null} />);
    expect(html).toContain('href="/en/appeals"');
    for (const state of ["visible", "org_suspended"] as const) {
      expect(renderToStaticMarkup(<ItemModerationNotice lang="en" kind="requirement" effect="x" moderation={{ state, decision: null }} appeal={null} />)).toBe("");
    }
    expect(renderToStaticMarkup(<ItemModerationNotice lang="en" kind="requirement" effect="x" moderation={null} appeal={null} />)).toBe("");
  });
});
