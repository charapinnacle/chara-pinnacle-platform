import { describe, expect, it } from "vitest";
import { renderEmail } from "@/emails/index";

// The moderation_decision email (V27, FR-S1 AC8 and step Inform; FR-J3 AC10): the affected company reads the decision,
// the statement of reasons and the appeal route; a reporter reads the outcome by reference and nothing about the reported
// party or the reasons.
const SITE = "https://chara.example";
const REASONS = "The profile claims placements that were never made.";
const affected = {
  target_type: "partner_profile",
  target_id: "11111111-1111-4111-8111-111111111111",
  title: "Manila Recruit",
  org_slug: "manila-recruit",
  reasons: REASONS,
  moderation_action_id: 42,
};

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
}

describe("moderation_decision email", () => {
  it("a hide names the profile, quotes the reasons and gives the appeal route and the workforce profile", async () => {
    const email = await renderEmail("moderation_decision", { ...affected, decision: "hide" }, SITE);
    expect(email.subject).toBe("Manila Recruit was hidden by moderation");
    expect(email.text).toContain(REASONS);
    expect(email.text).toContain("you can appeal");
    expect(hrefs(email.html)).toEqual([
      `${SITE}/en/legal/complaints-and-dispute-process`,
      `${SITE}/en/org/manila-recruit/workforce-profile#moderation-heading`,
    ]);
  });

  it("an unhide quotes the reasons and offers no appeal", async () => {
    const email = await renderEmail("moderation_decision", { ...affected, decision: "unhide" }, SITE);
    expect(email.subject).toBe("Manila Recruit is shown again");
    expect(email.text).toContain(REASONS);
    expect(email.text).not.toContain("appeal");
    expect(hrefs(email.html)).toEqual([`${SITE}/en/org/manila-recruit/workforce-profile`]);
  });

  it("a reporter reads the outcome by reference only, even if a payload carried more", async () => {
    const actioned = await renderEmail(
      "moderation_decision",
      { reference: "R-000123", outcome: "actioned", reasons_leak: REASONS, org_name_leak: "Manila Recruit" },
      SITE,
    );
    expect(actioned.subject).toBe("Your report R-000123 was closed");
    expect(actioned.text).toContain("They took action on what you reported.");
    expect(`${actioned.html}${actioned.text}`).not.toContain(REASONS);
    expect(`${actioned.html}${actioned.text}`).not.toContain("Manila Recruit");
    expect(hrefs(actioned.html)).toEqual([`${SITE}/en/reports`]);

    const dismissed = await renderEmail("moderation_decision", { reference: "R-000124", outcome: "dismissed" }, SITE);
    expect(dismissed.text).toContain("no action was needed");
  });
});
