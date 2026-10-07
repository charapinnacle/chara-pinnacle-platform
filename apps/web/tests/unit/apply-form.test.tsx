import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApplyForm } from "@/components/applications/apply-form";
import { applicationStatusLabels } from "@/lib/applications/presentation";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/applications", () => ({ applyToVacancy: async () => undefined }));

const limits = { coverNoteMaxChars: 2000, documentsMax: 10 };
const documents = [
  { id: "0a1b2c3d-0000-4000-8000-0000000000d1", title: "CV.pdf", type: "cv" as const },
  { id: "0a1b2c3d-0000-4000-8000-0000000000d2", title: "Certificate.pdf", type: "certificate" as const },
];
const NOTICE = "Cross-border hiring can be subject to legal requirements";
const render = (docs = documents) =>
  renderToStaticMarkup(<ApplyForm jobId="j" lang="en" employerName="Nordic Build GmbH" limits={limits} documents={docs} />);

describe("ApplyForm", () => {
  it("lists the fields in the order of the criteria: note with its counter, one checkbox per document, consent, notice, Submit", () => {
    const html = render();
    const at = (text: string) => html.indexOf(text);
    expect(at("Cover note (optional)")).toBeGreaterThan(-1);
    expect(html).toContain("0/2000");
    const order = ["Cover note (optional)", "CV.pdf", "Certificate.pdf", "I agree to share the selected documents", NOTICE, "Submit application"].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((position) => position > -1)).toBe(true);
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
  });

  it("names the employer in the consent text and the title of each document on its checkbox", () => {
    const html = render();
    expect(html).toContain("I agree to share the selected documents with Nordic Build GmbH for this application");
    expect(html).toMatch(/<label[^>]*for="apply-documents-0a1b2c3d-0000-4000-8000-0000000000d1"[^>]*>CV\.pdf<\/label>/);
  });

  it("says there are no documents yet, links to the documents of the passport and keeps Submit enabled", () => {
    const html = render([]);
    expect(html).toContain("You have no documents yet. You can still apply, or ");
    expect(html).toContain('href="/en/passport#documents"');
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Submit application<\/button>/);
    expect(html).not.toContain('disabled=""');
    expect(html).toContain(NOTICE);
  });
});

describe("applicationStatusLabels", () => {
  it("shows the stored value rejected as Not selected and has a label for every stage", () => {
    expect(applicationStatusLabels.rejected).toBe("Not selected");
    expect(Object.keys(applicationStatusLabels).sort()).toEqual(
      ["applied", "hired", "interview", "offer", "rejected", "shortlisted", "viewed", "withdrawn"],
    );
  });
});
