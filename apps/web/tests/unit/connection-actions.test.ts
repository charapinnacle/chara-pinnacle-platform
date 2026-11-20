import { describe, expect, it } from "vitest";
import { offersStaffing } from "@/lib/connections/contact-actions";
import { connectionKindLabels, typedMessageCard, type ConnectionKind, type ConnectionStatus, type ConversationConnection } from "@/lib/connections/typed-messages";
import { inquiryFormSchema, jobInvitationFormSchema, workforceRequestFormSchema } from "@/lib/validation/connection-actions";

const JOB = "22222222-2222-4222-8222-222222222222";

function connection(kind: ConnectionKind, status: ConnectionStatus, over: Partial<ConversationConnection> = {}): ConversationConnection {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    messageId: "33333333-3333-4333-8333-333333333333",
    kind,
    status,
    sentByMe: false,
    jobId: kind === "invite_to_job" ? JOB : null,
    jobTitle: kind === "invite_to_job" ? "Welder MIG/MAG" : null,
    jobPlace: kind === "invite_to_job" ? "Hamburg, Germany" : null,
    jobOpen: kind === "invite_to_job",
    requirementTitle: null,
    occupation: kind === "request_workforce" ? "Welders and flame cutters" : null,
    quantity: kind === "request_workforce" ? 25 : null,
    destination: kind === "request_workforce" ? "Germany" : null,
    startDate: kind === "request_workforce" ? "2027-03-01" : null,
    ...over,
  };
}

const kinds: ConnectionKind[] = ["inquiry", "request_workforce", "invite_to_job", "submit_candidate"];
const statuses: ConnectionStatus[] = ["sent", "answered", "accepted", "declined"];

describe("typed message cards (FR-P2 AC10)", () => {
  it("gives each kind its fixed label and each status a chip text with a cue that is not colour", () => {
    expect(connectionKindLabels).toEqual({
      inquiry: "Inquiry",
      request_workforce: "Workforce request",
      invite_to_job: "Invitation to apply",
      submit_candidate: "Candidate submission",
    });
    for (const kind of kinds) {
      for (const status of statuses) {
        const card = typedMessageCard(kind, connection(kind, status), "organization");
        if (card.kind === "text") throw new Error(`${kind} ${status} rendered as text`);
        expect(card.label).toBe(connectionKindLabels[kind]);
        expect(card.chip.text.length, `${kind} ${status}`).toBeGreaterThan(0);
        expect(["waiting", "replied", "done", "declined"]).toContain(card.chip.cue);
      }
    }
    const applied = typedMessageCard("invite_to_job", connection("invite_to_job", "accepted"), "worker");
    expect(applied.kind !== "text" && applied.chip.text).toBe("Applied");
  });

  it("offers Apply on a waiting invitation to the worker only, named after the vacancy", () => {
    const worker = typedMessageCard("invite_to_job", connection("invite_to_job", "sent"), "worker");
    expect(worker.kind !== "text" && worker.actions[0]).toEqual({ type: "apply", jobId: JOB, vacancy: "Welder MIG/MAG" });
    const company = typedMessageCard("invite_to_job", connection("invite_to_job", "sent", { sentByMe: true }), "organization");
    expect(company.kind !== "text" && company.actions).toEqual([]);
    for (const status of ["answered", "accepted", "declined"] as const) {
      const card = typedMessageCard("invite_to_job", connection("invite_to_job", status), "worker");
      expect(card.kind !== "text" && card.actions.some(({ type }) => type === "apply"), status).toBe(false);
    }
  });

  it("says a closed vacancy no longer takes applications instead of offering Apply (AC5)", () => {
    const card = typedMessageCard("invite_to_job", connection("invite_to_job", "sent", { jobOpen: false }), "worker");
    if (card.kind === "text") throw new Error("rendered as text");
    expect(card.actions.some(({ type }) => type === "apply")).toBe(false);
    expect(card.note).toBe("This vacancy is no longer accepting applications");
  });

  it("asks to confirm a decline, saying what the other side reads and that it cannot be undone", () => {
    const request = typedMessageCard("request_workforce", connection("request_workforce", "sent"), "organization");
    expect(request.kind !== "text" && request.actions).toEqual([
      {
        type: "decline",
        label: "Decline the workforce request",
        confirm:
          "The employer reads Declined, without a reason, and your invitation to its requirement is declined too. This cannot be undone.",
      },
    ]);
  });

  it("lets the receiving side decline what waits for its answer, never the sender", () => {
    const received = typedMessageCard("inquiry", connection("inquiry", "sent"), "organization");
    expect(received.kind !== "text" && received.actions.map(({ type }) => type)).toEqual(["decline"]);
    const sent = typedMessageCard("inquiry", connection("inquiry", "sent", { sentByMe: true }), "organization");
    expect(sent.kind !== "text" && sent.actions).toEqual([]);
    const answered = typedMessageCard("inquiry", connection("inquiry", "answered"), "organization");
    expect(answered.kind !== "text" && answered.actions).toEqual([]);
  });

  it("names what a workforce request asks for", () => {
    const card = typedMessageCard("request_workforce", connection("request_workforce", "sent"), "organization");
    expect(card.kind !== "text" && card.details).toEqual(["25 × Welders and flame cutters", "Germany", "From 1 March 2027"]);
  });

  it("renders an unknown kind, a text message and a message without its connection as plain text", () => {
    expect(typedMessageCard("poll", connection("inquiry", "sent"), "organization")).toEqual({ kind: "text" });
    expect(typedMessageCard("text", undefined, "worker")).toEqual({ kind: "text" });
    expect(typedMessageCard("inquiry", undefined, "organization")).toEqual({ kind: "text" });
  });
});

describe("the forms of the connection actions (FR-P2 Data and validation)", () => {
  it("takes inquiries of 20 to 2,000 characters", () => {
    expect(inquiryFormSchema.safeParse({ body: "a".repeat(19) }).success).toBe(false);
    expect(inquiryFormSchema.safeParse({ body: "a".repeat(20) }).success).toBe(true);
    expect(inquiryFormSchema.safeParse({ body: "a".repeat(2000) }).success).toBe(true);
    expect(inquiryFormSchema.safeParse({ body: "a".repeat(2001) }).success).toBe(false);
  });

  it("takes 1 to 10,000 workers from today on", () => {
    const schema = workforceRequestFormSchema("2027-01-10");
    const valid = { occupation: "7212", quantity: "25", destination: "de", cityRegion: "Hamburg", startDate: "2027-03-01", body: "" };
    expect(schema.parse(valid).destination).toBe("DE");
    for (const quantity of ["0", "10001", "2.5", ""]) expect(schema.safeParse({ ...valid, quantity }).success, quantity).toBe(false);
    expect(schema.safeParse({ ...valid, startDate: "2027-01-09" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, occupation: "xxxx" }).success).toBe(false);
  });

  it("needs a vacancy to invite to", () => {
    expect(jobInvitationFormSchema.safeParse({ jobId: "", body: "" }).success).toBe(false);
    expect(jobInvitationFormSchema.safeParse({ jobId: JOB, body: "" }).success).toBe(true);
  });

  it("offers Request workforce for staffing companies and recruitment companies that list staffing (AC3, AC9)", () => {
    expect(offersStaffing("staffing_company", [])).toBe(true);
    expect(offersStaffing("recruitment_company", ["staffing", "permanent"])).toBe(true);
    expect(offersStaffing("recruitment_company", ["permanent"])).toBe(false);
    expect(offersStaffing("employer", ["staffing"])).toBe(false);
  });
});
