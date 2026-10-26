import { describe, expect, it } from "vitest";
import { renderEmail } from "@/emails/index";
import { appealPath } from "@/lib/routes";

// The moderation_decision email (V27, FR-S1 AC8 and step Inform; FR-J3 AC10): the affected company reads the decision,
// the statement of reasons and the appeal (V28, the decision page); a reporter reads the outcome by reference and nothing
// about the reported party or the reasons; the appellant reads the outcome of the appeal (AC9).
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
  it("a hide names the profile, quotes the reasons and links to the appeal of the decision and the workforce profile", async () => {
    const email = await renderEmail("moderation_decision", { ...affected, decision: "hide" }, SITE);
    expect(email.subject).toBe("Manila Recruit was hidden by moderation");
    expect(email.text).toContain(REASONS);
    expect(email.text).toContain("the owner or an admin can appeal");
    expect(hrefs(email.html)).toEqual([`${SITE}${appealPath("en", 42)}`, `${SITE}/en/org/manila-recruit/workforce-profile#moderation-heading`]);
    expect(email.html).not.toContain("complaints-and-dispute-process");
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

  it("the appellant reads that the decision was reversed, with the reasons and the decision page", async () => {
    const email = await renderEmail(
      "moderation_decision",
      { ...affected, appeal_id: 7, appeal_outcome: "restored", reasons: "The placements are documented after all." },
      SITE,
    );
    expect(email.subject).toBe("Your appeal about Manila Recruit was decided");
    expect(email.text).toContain("WE REVERSED THE DECISION");
    expect(email.text).toContain("The placements are documented after all.");
    expect(email.text).toContain("the partner profile Manila Recruit");
    expect(hrefs(email.html)).toEqual([`${SITE}${appealPath("en", 42)}`]);
  });

  it("the appellant reads that the decision was upheld, for a vacancy", async () => {
    const email = await renderEmail(
      "moderation_decision",
      { target_type: "job", title: "Welder MIG/MAG", appeal_id: 7, appeal_outcome: "upheld", reasons: "The vacancy asks for a fee.", moderation_action_id: 9 },
      SITE,
    );
    expect(email.text).toContain("WE UPHELD THE DECISION");
    expect(email.text).toContain("the vacancy Welder MIG/MAG");
    expect(email.text).not.toContain("reversed");
  });
});

// The notices of Phase 1 link to the appeal of the decision once release 2a gives them its id (FR-S1); before it they keep
// the Complaints and Dispute Process.
describe("vacancy_hidden and account_suspended emails", () => {
  it("link to the appeal when the notice names the decision", async () => {
    const hidden = await renderEmail("vacancy_hidden", { job_title: "Welder", reasons: REASONS, moderation_action_id: 5 }, SITE);
    expect(hrefs(hidden.html)).toContain(`${SITE}${appealPath("en", 5)}`);
    expect(hidden.html).not.toContain("complaints-and-dispute-process");
    const suspended = await renderEmail("account_suspended", { org_name: "Acme Bau", reasons: REASONS, moderation_action_id: 6 }, SITE);
    expect(hrefs(suspended.html)).toEqual([`${SITE}${appealPath("en", 6)}`]);
    expect(suspended.text).toContain("Appeal this decision");
  });

  it("keep the Complaints and Dispute Process without it", async () => {
    const hidden = await renderEmail("vacancy_hidden", { job_title: "Welder", reasons: REASONS }, SITE);
    expect(hrefs(hidden.html)).toContain(`${SITE}/en/legal/complaints-and-dispute-process`);
    const suspended = await renderEmail("account_suspended", { reasons: REASONS }, SITE);
    expect(hrefs(suspended.html)).toEqual([`${SITE}/en/legal/complaints-and-dispute-process`]);
  });
});
