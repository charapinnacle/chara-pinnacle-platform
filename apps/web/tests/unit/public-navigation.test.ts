import { describe, expect, it } from "vitest";
import { footerLinks, headerLinks } from "@/lib/public/navigation";

describe("the navigation of the public pages (FR-H1 AC3)", () => {
  it("has the header links in the order of the requirement", () => {
    expect(headerLinks.map(({ label }) => label)).toEqual([
      "Find Jobs",
      "Pricing",
      "How CHARA Works",
      "Trust & Safety",
      "About",
      "Contact",
      "Log in",
      "Sign up",
    ]);
    expect(headerLinks.map(({ path }) => path)).toEqual([
      "jobs",
      "pricing",
      "how-it-works",
      "trust-safety",
      "about",
      "contact",
      "login",
      "signup",
    ]);
  });

  it("has the Imprint and the ten legal pages in the footer", () => {
    expect(footerLinks.map(({ label }) => label)).toEqual([
      "Imprint",
      "Terms of Service",
      "Privacy Policy",
      "Cookie Policy",
      "Platform Rules",
      "Acceptable Use Policy",
      "Subscription and Billing Terms",
      "Employer Terms",
      "Worker Terms",
      "Complaints and Dispute Process",
      "Account Suspension and Termination Rules",
    ]);
  });

  it("links the legal pages by a lower-case slug, which is how the route looks them up", () => {
    const slugs = footerLinks.flatMap(({ path }) => (path.startsWith("legal/") ? [path.slice("legal/".length)] : []));
    expect(slugs).toHaveLength(10);
    expect(new Set(slugs).size).toBe(10);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
