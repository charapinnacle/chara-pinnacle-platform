import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/en" }));
vi.mock("@/lib/actions/responses", () => ({ respondToRequirement: vi.fn(), updateMyResponse: vi.fn(), startResponseDocumentUpload: vi.fn(), readResponseDocuments: vi.fn(), removeResponseDocument: vi.fn(), openResponseDocument: vi.fn() }));
vi.mock("@/lib/actions/limits", () => ({ recordLimitPrompt: vi.fn() }));

const { ResponseForm } = await import("@/components/responses/response-form");

describe("the response form", () => {
  it("opens empty for a new response with the skills and fee terms, nothing ticked", () => {
    const html = renderToStaticMarkup(
      <ResponseForm
        lang="en"
        slug="p1"
        requirementId="3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90"
        workersNeeded={50}
        maxCapacity={60}
        currencies={[{ code: "EUR", name: "Euro" }]}
        languages={[{ code: "de", name: "German" }]}
        documents={[]}
        documentsMax={5}
        organization={{ id: "o", type: "recruitment_company", canManage: true }}
        kind="recruitment"
        billingHref="/en/x"
      />,
    );
    expect(html).toContain("The workers&#x27; skills (optional)");
    expect(html).toContain("The fee includes (optional)");
    expect(html).toContain("Guarantee period (days, optional)");
    expect(html).toContain("Lead time (weeks, optional)");
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*\schecked=""/);
  });
});
