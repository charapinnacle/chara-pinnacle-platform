import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApproveRequestForm } from "@/components/submissions/approve-request-form";
import { SubmitCandidateForm } from "@/components/submissions/submit-candidate-form";
import { SubmissionStatusBadge } from "@/components/submissions/submission-status";
import { WorkersNeverPay } from "@/components/submissions/workers-never-pay";

const releasedMock = vi.hoisted(() => vi.fn());
const getMySubmissionMock = vi.hoisted(() => vi.fn());
const listEventsMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/submissions", () => ({
  approveSubmission: async () => ({}),
  declineSubmission: async () => ({}),
  submitCandidate: async () => ({}),
  withdrawSubmission: async () => ({}),
}));
vi.mock("@/lib/actions/limits", () => ({ recordLimitPrompt: async () => undefined }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/session", () => ({ requireCandidate: async () => ({ id: "w", accountKind: "worker" }) }));
vi.mock("@/lib/dal/submissions", () => ({ getMySubmission: getMySubmissionMock }));
vi.mock("@/lib/dal/submission-pipeline", () => ({ listSubmissionEvents: listEventsMock }));
vi.mock("@/lib/dal/applications", () => ({
  getApplyDocuments: async () => [{ id: "0a1b2c3d-0000-4000-8000-0000000000d1", title: "Welding certificate", type: "certificate" }],
  getApplyLimits: async () => ({ coverNoteMaxChars: 2000, documentsMax: 10 }),
}));

const { default: SubmissionPage } = await import("@/app/[lang]/(app)/submissions/[id]/page");

const ID = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";
const request = {
  id: ID,
  partnerName: "Manila Recruit",
  partnerSlug: "manila-recruit",
  title: "Welders for a shipyard",
  countryCode: "MC",
  countryName: "Monaco",
  cityRegion: null,
  startDate: "2027-03-01",
  workersNeeded: 100,
  employerName: null,
  note: "We placed you before.",
  createdAt: "2026-11-10T00:00:00Z",
  expiresAt: "2026-11-24T00:00:00Z",
  submittedByPartner: null,
};
const render = async (id = ID) =>
  renderToStaticMarkup(await SubmissionPage({ params: Promise.resolve({ lang: "en", id }) } as Parameters<typeof SubmissionPage>[0]));

beforeEach(() => {
  releasedMock.mockResolvedValue(true);
  listEventsMock.mockReset().mockResolvedValue([]);
  notFoundMock.mockClear();
});

describe("the candidate's request page (FR-O4 AC5, AC8, AC11)", () => {
  it("names the partner, the requirement, destination and start, what will be shared, and Approve and Decline", async () => {
    getMySubmissionMock.mockResolvedValue({ kind: "request", request });
    const html = await render();
    for (const text of [
      "Welders for a shipyard",
      "Manila Recruit would like to submit you",
      "Monaco",
      "1 March 2027",
      "Not named by the employer",
      "We placed you before.",
      "What will be shared",
      "Welding certificate",
      "Approve and share",
      "Decline request",
      "Workers never pay fees to get a job through Chara Pinnacle",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('href="/en/report?type=partner_profile&amp;partner=manila-recruit&amp;category=fee_demanded_from_worker"');
  });

  it("offers only Decline when another company already submitted the candidate (AC8)", async () => {
    getMySubmissionMock.mockResolvedValue({ kind: "request", request: { ...request, submittedByPartner: "Cebu Staffing" } });
    const html = await render();
    expect(html).toContain("You have already been proposed for this requirement by Cebu Staffing");
    expect(html).not.toContain("Approve and share");
    expect(html).toContain("Decline request");
  });

  it("offers Withdraw on an approved submission, and not on a declined one (AC9)", async () => {
    const submission = {
      id: ID,
      status: "interview",
      partnerName: "Manila Recruit",
      partnerSlug: "manila-recruit",
      title: "Welders for a shipyard",
      countryCode: "MC",
      countryName: "Monaco",
      employerName: "Acme Bau",
      createdAt: "2026-11-10T00:00:00Z",
      decidedAt: "2026-11-11T00:00:00Z",
      approvedAt: "2026-11-11T00:00:00Z",
      withdrawnAt: null,
    };
    getMySubmissionMock.mockResolvedValue({ kind: "answered", submission });
    let html = await render();
    expect(html).toContain("Interview");
    expect(html).toContain("Withdraw submission");
    expect(html).toContain("Workers never pay");
    getMySubmissionMock.mockResolvedValue({ kind: "answered", submission: { ...submission, status: "declined_by_candidate", approvedAt: null } });
    html = await render();
    expect(html).toContain("You declined this request.");
    expect(html).not.toContain("Withdraw submission");
    expect(listEventsMock).toHaveBeenCalledTimes(1);
  });

  it("shows the stage history with the employer's reason of a decline (FR-O5 AC3, AC9)", async () => {
    getMySubmissionMock.mockResolvedValue({
      kind: "answered",
      submission: {
        id: ID,
        status: "rejected",
        partnerName: "Manila Recruit",
        partnerSlug: "manila-recruit",
        title: "Welders for a shipyard",
        countryCode: "MC",
        countryName: "Monaco",
        employerName: null,
        createdAt: "2026-11-10T00:00:00Z",
        decidedAt: "2026-11-11T00:00:00Z",
        approvedAt: "2026-11-11T00:00:00Z",
        withdrawnAt: null,
      },
    });
    listEventsMock.mockResolvedValue([
      { fromStatus: null, toStatus: "submitted", actorRole: "candidate", note: null, createdAt: "2026-11-11T00:00:00Z" },
      { fromStatus: "submitted", toStatus: "viewed", actorRole: "system", note: null, createdAt: "2026-11-12T00:00:00Z" },
      { fromStatus: "viewed", toStatus: "rejected", actorRole: "employer", note: "The position was filled.", createdAt: "2026-11-13T00:00:00Z" },
    ]);
    const html = await render();
    expect(listEventsMock).toHaveBeenCalledWith(ID);
    expect(html).toContain("Timeline");
    expect(html).toContain("Viewed by the employer");
    expect(html).toContain("Reason from the employer");
    expect(html).toContain("The position was filled.");
    expect(html).toContain("By the employer");
  });

  it("is not found while the release is off, for an id that is not a uuid, and for another person's id", async () => {
    releasedMock.mockResolvedValue(false);
    await expect(render()).rejects.toThrow("NOT_FOUND");
    releasedMock.mockResolvedValue(true);
    await expect(render("abc")).rejects.toThrow("NOT_FOUND");
    getMySubmissionMock.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NOT_FOUND");
  });
});

describe("the submission components", () => {
  it("the approval form lists the documents, the consent with the sharing notice and the button", () => {
    const html = renderToStaticMarkup(
      <ApproveRequestForm
        lang="en"
        submissionId={ID}
        recipient="Acme Bau"
        documents={[{ id: "0a1b2c3d-0000-4000-8000-0000000000d1", title: "Passport scan", type: "certificate" }]}
        documentsMax={10}
      />,
    );
    expect(html).toContain("Documents to share (optional)");
    expect(html).toContain("Passport scan");
    expect(html).toContain("I agree to share my profile and the selected documents with Acme Bau for this submission");
    expect(html).toContain('href="/en/legal/sharing-notice"');
    expect(html).toMatch(
      /<label[^>]*><span>I agree to share my profile and the selected documents with Acme Bau for this submission, as the <a [^>]*class="[^"]*relative z-10[^"]*"[^>]*>sharing notice<\/a> describes<\/span><\/label>/,
    );
    expect(html).toContain(
      'aria-label="I agree to share my profile and the selected documents with Acme Bau for this submission, as the sharing notice describes"',
    );
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  });

  it("the approval form without documents still approves", () => {
    const html = renderToStaticMarkup(<ApproveRequestForm lang="en" submissionId={ID} recipient="the employer" documents={[]} documentsMax={10} />);
    expect(html).toContain("You have no documents yet. You can still approve");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Approve and share<\/button>/);
  });

  it("the partner's form asks for the address and an optional note with its counter (AC12)", () => {
    const html = renderToStaticMarkup(
      <SubmitCandidateForm
        slug="s1"
        requirementId={ID}
        organization={{ id: "o", type: "recruitment_company", canManage: false }}
        billingHref="/en/org/s1/billing"
      />,
    );
    expect(html).toContain("Candidate&#x27;s email address");
    expect(html).toContain("Note to the candidate (optional)");
    expect(html).toContain("0/1,000");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Send request<\/button>/);
  });

  it("the badge says the status in the reader's words", () => {
    expect(renderToStaticMarkup(<SubmissionStatusBadge status="awaiting_candidate" view="partner" />)).toContain("Awaiting candidate");
    expect(renderToStaticMarkup(<SubmissionStatusBadge status="awaiting_candidate" view="candidate" />)).toContain("Waiting for your answer");
  });

  it("the fee demand link needs the partner's profile", () => {
    expect(renderToStaticMarkup(<WorkersNeverPay lang="en" partnerName="P" partnerSlug={null} />)).not.toContain("Report a fee demand");
  });
});
