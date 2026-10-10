import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

describe("the breadcrumb", () => {
  const html = renderToStaticMarkup(
    <Breadcrumbs items={[{ label: "Acme Bau", href: "/en/dashboard/employer?org=acme" }, { label: "Vacancies", href: "/en/org/acme/jobs" }, { label: "Welder" }]} />,
  );

  it("is a navigation named Breadcrumb with an ordered list", () => {
    expect(html).toMatch(/^<nav aria-label="Breadcrumb"[^>]*><ol/);
  });

  it("links every item but the last and marks the last as the current page", () => {
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('href="/en/org/acme/jobs"');
    expect(html).toMatch(/<span aria-current="page"[^>]*>Welder<\/span>/);
  });
});
