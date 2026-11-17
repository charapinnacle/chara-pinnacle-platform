import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ResponseEligibility } from "@/lib/dal/responses";
import type { CommitmentBlock } from "@/lib/validation/commitment";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/commitment", () => ({ acceptCommitment: vi.fn(), acceptUpdatedCommitment: vi.fn() }));
vi.mock("@/lib/actions/submissions", () => ({ submitCandidate: vi.fn() }));
vi.mock("@/lib/actions/limits", () => ({ recordLimitPrompt: vi.fn() }));
// The owner's form loads when the dialog opens; static markup renders it in place so the dialog's content is read whole.
vi.mock("next/dynamic", async () => {
  const { CommitmentForm } = await import("@/components/organization/commitment-form");
  return { default: (loader: () => unknown) => (String(loader).includes("commitment-form") ? CommitmentForm : () => null) };
});

const { CommitmentGate } = await import("@/components/organization/commitment-gate");
const { EligibilityPanel } = await import("@/components/responses/eligibility-panel");
const { SubmitCandidateForm } = await import("@/components/submissions/submit-candidate-form");

const block = (outdated: boolean, isDraft = false): CommitmentBlock => ({
  outdated,
  title: "Employer-pays commitment",
  version: 2,
  changeSummary: "Fees for travel are named.",
  publishedAt: "2026-11-10T00:00:00Z",
  isDraft,
});

const OWNER_OUTDATED =
  "The employer-pays commitment has changed. Accept the updated version so that your company can respond to job orders and submit candidates again.";
const MEMBER_OUTDATED = "Your owner needs to accept the updated commitment before you can respond to job orders or submit candidates.";

describe("the commitment gate (FR-J3 AC4, FR-S4 AC7, NFR-U4)", () => {
  it("tells an admin or a member, as a status message, that the owner must accept the updated version", () => {
    const html = renderToStaticMarkup(<CommitmentGate slug="manila-skills" owner={false} commitment={block(true)} reasonId="why" />);
    expect(html).toMatch(new RegExp(`<div[^>]*role="status"[^>]*>.*<p id="why"[^>]*>${MEMBER_OUTDATED}</p>`));
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain("Review and accept");
  });

  it("opens the owner's dialog at once after a new version, with what changed, the version, the full text and the box", () => {
    const html = renderToStaticMarkup(<CommitmentGate slug="manila-skills" owner commitment={block(true)} reasonId="why" />);
    expect(html).toMatch(new RegExp(`<p id="why"[^>]*>${OWNER_OUTDATED}</p>`));
    expect(html).toContain("Review and accept");
    expect(html).toMatch(/<dialog[^>]*>.*The employer-pays commitment has changed/);
    expect(html).toContain("Employer-pays commitment, version 2 · 10 November 2026");
    expect(html).toContain("What changed:</span> Fees for travel are named.");
    expect(html).toContain('href="/en/legal/employer-pays-commitment"');
    expect(html).toContain("We charge workers no recruitment fees or related costs");
    expect(html).toContain("Accept the commitment");
    expect(html).toContain("Not now");
  });

  it("leaves the dialog closed for a commitment never accepted and marks a draft", () => {
    const html = renderToStaticMarkup(<CommitmentGate slug="manila-skills" owner commitment={block(false, true)} reasonId="why" />);
    expect(html).toContain("Accept the employer-pays commitment so that your company can respond to job orders and submit candidates.");
    expect(html).not.toContain("Accept the commitment");
    expect(html).not.toContain("What changed:");
  });
});

const eligibility: ResponseEligibility = {
  requirementId: "6c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f",
  canRespond: false,
  refusal: "CHARA_CONSENT_REQUIRED",
  detail: "employer-pays-commitment",
  invited: false,
  responseId: null,
  responseStatus: null,
  used: 0,
  limit: 10,
  applies: false,
  resetsAt: null,
  maxCapacity: null,
  licenceMissing: [],
};

describe("Respond and Send request while the commitment is outdated (FR-J3 AC4)", () => {
  it("keeps Respond in the eligibility panel, disabled, with the reason as its description", () => {
    const html = renderToStaticMarkup(
      <EligibilityPanel
        lang="en"
        slug="manila-skills"
        organization={{ id: "org-1", type: "recruitment_company", canManage: true, owner: false }}
        eligibility={eligibility}
        countryName={(code) => code}
        destinationName="Germany"
        respondHref="/en/org/manila-skills/job-orders/x/respond"
        limitPrompt={null}
        commitment={block(true)}
      />,
    );
    expect(html).toContain(`<p id="respond-blocked-reason" class="font-medium">${MEMBER_OUTDATED}</p>`);
    const button = /<button[^>]*>Respond<\/button>/.exec(html)?.[0] ?? "";
    expect(button).toContain('disabled=""');
    expect(button).toContain('aria-describedby="respond-blocked-reason"');
    expect(html).not.toContain('href="/en/org/manila-skills/job-orders/x/respond"');
  });

  it("disables Send request with the reason as its description", () => {
    const html = renderToStaticMarkup(
      <SubmitCandidateForm
        slug="manila-skills"
        requirementId="6c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f"
        organization={{ id: "org-1", type: "recruitment_company", canManage: true }}
        billingHref="/en/org/manila-skills/billing"
        blockedBy="submit-blocked-reason"
      />,
    );
    const button = /<button[^>]*>Send request<\/button>/.exec(html)?.[0] ?? "";
    expect(button).toContain('disabled=""');
    expect(button).toContain('aria-describedby="submit-blocked-reason"');
  });
});
