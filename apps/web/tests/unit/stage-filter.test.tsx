import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StageFilter } from "@/components/applications/stage-filter";

const html = (props: Parameters<typeof StageFilter>[0]) => renderToStaticMarkup(<StageFilter {...props} />);

describe("StageFilter (A11Y-01)", () => {
  it("is a plain GET form to the list with a labelled select of every stage and an Apply button", () => {
    const markup = html({ basePath: "/en/applications", stage: null });
    expect(markup).toMatch(/<form[^>]*action="\/en\/applications" method="get"/);
    expect(markup).toMatch(/<label[^>]*for="stage-filter"[^>]*>Filter by stage<\/label>/);
    expect(markup).toMatch(/<select[^>]*id="stage-filter"[^>]*name="stage"/);
    expect(markup).toContain('<option value="" selected="">All stages</option>');
    for (const label of ["Applied", "Viewed", "Shortlisted", "Interview", "Offer", "Hired", "Not selected", "Withdrawn"]) {
      expect(markup).toContain(`>${label}</option>`);
    }
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>Apply filter<\/button>/);
  });

  it("has no script handler on the select, so that choosing a stage changes nothing by itself", () => {
    expect(html({ basePath: "/en/applications", stage: null })).not.toMatch(/onchange/i);
  });

  it("selects the stage of the address", () => {
    expect(html({ basePath: "/en/applications", stage: "interview" })).toContain('<option value="interview" selected="">Interview</option>');
  });

  it("sends the parameters of the base address along as hidden fields, without a stage or a page", () => {
    const markup = html({ basePath: "/en/org/acme/applicants?job=3f2a&sort=stage&dir=asc", stage: "offer" });
    expect(markup).toContain('action="/en/org/acme/applicants"');
    expect(markup).toContain('<input type="hidden" name="job" value="3f2a"/>');
    expect(markup).toContain('<input type="hidden" name="sort" value="stage"/>');
    expect(markup).toContain('<input type="hidden" name="dir" value="asc"/>');
    expect(markup).not.toContain('name="page"');
    expect(markup.match(/name="stage"/g)).toHaveLength(1);
  });
});
