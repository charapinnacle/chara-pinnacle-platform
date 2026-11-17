import { describe, expect, it } from "vitest";
import { renderEmail } from "@/emails/index";
import { presentNotification } from "@/lib/notifications/present";
import { appealPath, messagesPath, orgContactRequestsPath, reportPath } from "@/lib/routes";
import { appealableDecisionLabel, appealTargetLabels } from "@/lib/validation/appeal";
import {
  FEE_DEMAND,
  isParticipantReport,
  reportCategoryOptionsFor,
  reportDecisionLabel,
  reportDecisionsFor,
  reportTargetLabels,
} from "@/lib/validation/report";

// The moderation of messages and contact requests (V73, FR-S1 release 2c parts, FR-Q3 AC11): the report target, the
// decisions the console offers, the notice and the email of the decision, and the appeal labels.
const SITE = "https://chara.example";
const REASONS = "The message asks the candidate to pay a visa fee.";
const MESSAGE = "11111111-1111-4111-8111-111111111111";
const company = { lang: "en", accountKind: "company" } as const;
const worker = { lang: "en", accountKind: "worker" } as const;

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
}

describe("the contact request report target (FR-Q3 AC11)", () => {
  it("is reported by a signed-in participant from its page, with the worker's fee label", () => {
    expect(isParticipantReport("contact_request")).toBe(true);
    expect(reportTargetLabels.contact_request).toBe("Contact request");
    expect(reportPath("en", "contact_request", MESSAGE, FEE_DEMAND)).toBe(
      `/en/report?type=contact_request&request=${MESSAGE}&category=fee_demanded_from_worker`,
    );
    expect(reportCategoryOptionsFor("contact_request").find((option) => option.value === FEE_DEMAND)?.label).toBe(
      "The company asked me to pay a fee",
    );
  });
});

describe("the decisions on a message or a contact request (FR-S1 AC4, AC10)", () => {
  const active = { status: "active", moderationState: null } as const;

  it("offers a hide of a visible one, the suspension of the sending organisation and a dismissal", () => {
    expect(reportDecisionsFor({ targetType: "message", job: null, item: { moderationState: "visible" }, organization: active })).toEqual([
      "hide",
      "suspend_organization",
      "dismiss",
    ]);
    expect(reportDecisionsFor({ targetType: "contact_request", job: null, item: { moderationState: "visible" }, organization: active })).toEqual([
      "hide",
      "suspend_organization",
      "dismiss",
    ]);
  });

  it("offers no suspension for a candidate's message, and the hide in effect for a second report", () => {
    expect(reportDecisionsFor({ targetType: "message", job: null, item: { moderationState: "visible" }, organization: null })).toEqual([
      "hide",
      "dismiss",
    ]);
    expect(reportDecisionsFor({ targetType: "message", job: null, item: { moderationState: "hidden" }, organization: null })).toEqual([
      "hide_in_effect",
      "dismiss",
    ]);
  });

  it("names the decision by the kind of item", () => {
    expect(reportDecisionLabel("content_hidden", "message")).toBe("Message hidden");
    expect(reportDecisionLabel("content_hidden", "contact_request")).toBe("Contact request hidden");
    expect(appealableDecisionLabel("content_hidden", "message")).toBe("Message hidden");
    expect(appealTargetLabels.contact_request).toBe("Contact request");
  });
});

describe("the moderation_decision notice of a message or a contact request (FR-S1 AC8)", () => {
  it("names the kind, never the text, and links a hide to the decision and its appeal", () => {
    const hidden = presentNotification(
      { kind: "moderation_decision", payload: { target_type: "message", target_id: MESSAGE, decision: "hide", reasons: REASONS, moderation_action_id: 7 } },
      worker,
    );
    expect(hidden).toMatchObject({ title: "Your message was hidden by moderation", href: appealPath("en", 7) });
    const request = presentNotification(
      {
        kind: "moderation_decision",
        payload: { target_type: "contact_request", target_id: MESSAGE, decision: "hide", org_slug: "acme", moderation_action_id: 8 },
      },
      company,
    );
    expect(request).toMatchObject({ title: "Your contact request was hidden by moderation", href: appealPath("en", 8) });
  });

  it("links a message or request shown again to where it is read, and names the appeal by the kind", () => {
    const shown = { target_type: "message", target_id: MESSAGE, decision: "unhide", org_slug: "acme", moderation_action_id: 9 };
    expect(presentNotification({ kind: "moderation_decision", payload: shown }, company)).toMatchObject({
      title: "Your message is shown again",
      href: messagesPath("en", "acme"),
    });
    const request = { ...shown, target_type: "contact_request" };
    expect(presentNotification({ kind: "moderation_decision", payload: request }, company).href).toBe(orgContactRequestsPath("en", "acme"));
    const appeal = { target_type: "message", title: "Acme Bau", appeal_id: 3, appeal_outcome: "restored", moderation_action_id: 7 };
    expect(presentNotification({ kind: "moderation_decision", payload: appeal }, worker).title).toBe(
      "Your appeal about your message was decided: the decision was reversed",
    );
  });
});

describe("the moderation_decision email of a message or a contact request (FR-S1 AC8)", () => {
  it("quotes the reasons and links to the decision and its appeal, never the text of the message", async () => {
    const email = await renderEmail(
      "moderation_decision",
      { target_type: "message", target_id: MESSAGE, decision: "hide", reasons: REASONS, moderation_action_id: 7 },
      SITE,
    );
    expect(email.subject).toBe("Your message was hidden by moderation");
    expect(email.html).toContain(REASONS);
    expect(hrefs(email.html)).toEqual([`${SITE}${appealPath("en", 7)}`]);
  });

  it("names a contact request and an appeal outcome by their kind", async () => {
    const request = await renderEmail(
      "moderation_decision",
      { target_type: "contact_request", target_id: MESSAGE, decision: "hide", reasons: REASONS, org_slug: "acme", moderation_action_id: 8 },
      SITE,
    );
    expect(request.subject).toBe("Your contact request was hidden by moderation");
    const appeal = await renderEmail(
      "moderation_decision",
      { target_type: "message", title: "Acme Bau", appeal_id: 3, appeal_outcome: "upheld", reasons: REASONS, moderation_action_id: 7 },
      SITE,
    );
    expect(appeal.subject).toBe("Your appeal about your message was decided");
    expect(appeal.html).not.toContain("Acme Bau");
  });
});
