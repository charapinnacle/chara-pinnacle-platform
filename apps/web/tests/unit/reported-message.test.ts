import { describe, expect, it, vi } from "vitest";
import type { ReportedMessage } from "@/lib/dal/admin-reports";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/admin-reports", () => ({ openReportedMessage: vi.fn() }));

const { reportedSenderLabel } = await import("@/components/admin/reported-message");

const base: ReportedMessage = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "2027-02-13T10:00:00+00:00",
  senderKind: "organization",
  senderName: "Mia Member",
  senderOrganizationName: "Acme Bau",
  senderFormer: false,
  body: "Please pay 500 euros.",
  reported: true,
};

describe("the sender of a reported message as staff read it (FR-P3 AC7)", () => {
  it("names a member by name and organisation", () => {
    expect(reportedSenderLabel(base)).toBe("Mia Member, Acme Bau");
  });

  it("names a member without a display name by the organisation, not as a former member", () => {
    expect(reportedSenderLabel({ ...base, senderName: null })).toBe("A member of Acme Bau");
  });

  it("calls a removed or erased sender a former member, whatever name is left", () => {
    expect(reportedSenderLabel({ ...base, senderFormer: true })).toBe("Former member, Acme Bau");
    expect(reportedSenderLabel({ ...base, senderName: null, senderFormer: true })).toBe("Former member, Acme Bau");
  });

  it("names every candidate Candidate", () => {
    expect(reportedSenderLabel({ ...base, senderKind: "worker", senderName: "Amina Okafor", senderOrganizationName: null })).toBe("Candidate");
  });
});
