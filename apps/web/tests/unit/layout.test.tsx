import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteShell } from "@/components/layout/site-shell";
import { SkipLink } from "@/components/layout/skip-link";

describe("skip link and landmarks (NFR-U1)", () => {
  it("points at the main landmark that can receive focus", () => {
    const html = renderToStaticMarkup(
      <>
        <SkipLink />
        <SiteShell>content</SiteShell>
      </>,
    );
    expect(html).toContain('href="#main-content"');
    expect(html).toMatch(/<main id="main-content" tabindex="-1"/);
    expect(html).toContain("<header");
    expect(html).toContain("<footer");
  });
});
