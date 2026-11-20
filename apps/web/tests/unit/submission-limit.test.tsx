import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsagePrompt } from "@/lib/billing/limits";

const promptsMock = vi.hoisted(() => vi.fn());
const commitmentMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/submissions", () => ({ submitCandidate: async () => ({}) }));
vi.mock("@/lib/actions/limits", () => ({ recordLimitPrompt: async () => undefined }));
vi.mock("@/lib/dal/submissions", () => ({
  submissionsReleased: async () => true,
  getSubmissionTarget: async () => ({
    requirementId: "6c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f",
    responseId: "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a",
    title: "Welders for a shipyard",
    employerName: "Acme Bau",
    requirementStatus: "open",
    open: true,
  }),
}));
vi.mock("@/lib/dal/session", () => ({
  requireOrgRole: async () => ({
    organization: { id: "org-1", slug: "manila-skills", displayName: "Manila Skills", type: "recruitment_company", role: "owner", suspended: false },
  }),
}));
vi.mock("@/lib/dal/usage", () => ({ getUsagePrompts: promptsMock }));
vi.mock("@/lib/dal/commitment", () => ({ getCommitmentBlock: commitmentMock }));

const { default: NewSubmissionPage } = await import("@/app/[lang]/(app)/org/[slug]/requirements/[id]/submissions/new/page");

const usage = (used: number): UsagePrompt => ({
  limitKey: "candidate_submissions_per_month",
  used,
  limit: 25,
  resetsAt: "2026-12-01T00:00:00Z",
  planName: "Recruitment Partner",
  comparison: null,
});
const render = async () =>
  renderToStaticMarkup(
    await NewSubmissionPage({
      params: Promise.resolve({ lang: "en", slug: "manila-skills", id: "6c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f" }),
    } as Parameters<typeof NewSubmissionPage>[0]),
  );
const sendButton = (html: string) => /<button[^>]*>Send request<\/button>/.exec(html)?.[0] ?? "";

beforeEach(() => {
  commitmentMock.mockResolvedValue(null);
});

describe("the partner's Send request and the month's submission limit (FR-O4 AC12, FR-R1)", () => {
  it("is enabled under the limit, with the use of the month", async () => {
    promptsMock.mockResolvedValue({ candidate_submissions_per_month: usage(24) });
    const html = await render();
    expect(html).toContain("24 of 25 submissions used this month.");
    expect(sendButton(html)).not.toContain('disabled=""');
  });

  it("is disabled at the limit with the upgrade prompt as its description, and the prompt shows once", async () => {
    promptsMock.mockResolvedValue({ candidate_submissions_per_month: usage(25) });
    const html = await render();
    const button = sendButton(html);
    expect(button).toContain('disabled=""');
    expect(button).toContain('aria-describedby="submit-limit-reason"');
    expect(html).toMatch(/<p id="submit-limit-reason"[^>]*>25 of 25 [^<]*submissions/);
    expect(html.match(/Upgrade your plan/g)).toHaveLength(1);
  });
});
