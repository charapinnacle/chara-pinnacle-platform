import { afterEach, describe, expect, it, vi } from "vitest";
import { robotsDisallow } from "@/lib/seo/private-routes";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("robots (FR-H5 AC6)", () => {
  it("allows the site, disallows the private areas and names the sitemap of the configured site", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://chara.example");
    vi.resetModules();
    const { default: robots } = await import("../../app/robots");
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: robotsDisallow },
      sitemap: "https://chara.example/sitemap.xml",
    });
  });
});
