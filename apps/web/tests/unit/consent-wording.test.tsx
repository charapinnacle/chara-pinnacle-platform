import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/worker-visibility", () => ({ setCardSections: vi.fn(), setWorkerVisibility: vi.fn() }));

const { ConsentWording } = await import("@/components/passport/find-workers-section");

const render = async (element: React.ReactNode) => {
  const { prelude } = await prerender(element);
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
};

describe("the consent wording of the Find Workers dialog (FR-Q1)", () => {
  it("renders the document as the legal pages do: headings and paragraphs, no Markdown marks, nothing as markup", async () => {
    const html = await render(
      <ConsentWording body={"DRAFT placeholder.\n\n## What this document will cover\n\nThe consent of a worker <b>to be shown</b>."} />,
    );
    expect(html).toContain('<h3 class="font-semibold">What this document will cover</h3>');
    expect(html).toContain("<p");
    expect(html).toContain("DRAFT placeholder.");
    expect(html).not.toContain("##");
    expect(html).toContain("&lt;b&gt;to be shown&lt;/b&gt;");
  });
});
