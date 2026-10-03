import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import RootLayout from "@/app/[lang]/layout";
import { SiteShell } from "@/components/layout/site-shell";
import { SkipLink } from "@/components/layout/skip-link";

vi.mock("next/server", () => ({ connection: async () => undefined }));

describe("root layout language attribute (NFR-U1)", () => {
  it("sets the html lang from the route segment", async () => {
    const tree = await RootLayout({
      children: null,
      params: Promise.resolve({ lang: "en" }),
    });
    expect(isValidElement<{ lang: string }>(tree) && tree.type).toBe("html");
    expect(isValidElement<{ lang: string }>(tree) && tree.props.lang).toBe("en");
  });
});

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
