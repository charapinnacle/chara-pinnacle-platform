import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PartnerDraftNotice } from "@/components/consent/partner-draft-notice";
import { accountChoiceOptions, partnerTypeLabels } from "@/components/forms/account-kind-options";
import type { LegalDocumentSummary } from "@/lib/validation/consents";

const document = (slug: string, version: number, title = slug): LegalDocumentSummary => ({
  slug,
  title,
  version,
  publishedAt: "2026-10-20T10:00:00Z",
  changeSummary: "Changed.",
});

describe("the account choices of sign-up (FR-J1 AC2)", () => {
  it("are worker and employer while the partner documents are not loaded (release 2a off)", () => {
    expect(accountChoiceOptions({ worker: [], company: [] }).map(({ label }) => label)).toEqual([
      "Worker",
      "Employer",
    ]);
  });

  it("add the recruitment and the staffing company, in that order, when their documents are loaded", () => {
    const options = accountChoiceOptions({ worker: [], company: [], recruitment_company: [], staffing_company: [] });
    expect(options.map(({ value, label }) => `${value}:${label}`)).toEqual([
      "worker:Worker",
      "company:Employer",
      "recruitment_company:Recruitment company",
      "staffing_company:Staffing company",
    ]);
    for (const { description } of options) expect(description).not.toMatch(/verified|approved/i);
  });

  it("label the fixed type in sentence case", () => {
    expect(partnerTypeLabels).toEqual({ recruitment_company: "Recruitment company", staffing_company: "Staffing company" });
  });
});

describe("the draft notice of the partner documents (FR-S4, FR-J1)", () => {
  const drafts = [document("terms-of-service", 3), document("partner-terms", 0, "DRAFT: Partner Terms")];

  it("is shown above the boxes of a partner choice while one of its documents is a draft", () => {
    const html = renderToStaticMarkup(<PartnerDraftNotice choice="staffing_company" documents={drafts} />);
    expect(html).toContain('role="note"');
    expect(html).toContain("Draft - not yet approved by legal counsel.");
  });

  it("is not shown once every partner document is approved, nor for a worker or an employer", () => {
    const approved = [document("terms-of-service", 3), document("partner-terms", 1, "Partner Terms")];
    expect(renderToStaticMarkup(<PartnerDraftNotice choice="recruitment_company" documents={approved} />)).toBe("");
    expect(renderToStaticMarkup(<PartnerDraftNotice choice="company" documents={drafts} />)).toBe("");
    expect(renderToStaticMarkup(<PartnerDraftNotice choice="worker" documents={drafts} />)).toBe("");
  });
});
