import { describe, expect, it } from "vitest";
import { aboutLinks, footerGroups, guestLinks, legalSlugs, siteLinks } from "@/lib/public/navigation";

const headerLinks = [...siteLinks, ...guestLinks];
const footerLinks = footerGroups.flatMap(({ links }) => links);

describe("the navigation of the public pages (FR-H1 AC3)", () => {
  it("keeps the header to the two ways in and the account links, as the owner decided (OPEN_QUESTIONS.md, 2026-10-10)", () => {
    expect(headerLinks.map(({ label }) => label)).toEqual(["Find Jobs", "How CHARA Works", "Log in", "Sign up"]);
    expect(headerLinks.map(({ path }) => path)).toEqual(["jobs", "how-it-works", "login", "signup"]);
    expect(headerLinks.map(({ label }) => label)).not.toContain("Pricing");
  });

  it("splits the header into the links of everybody and the two that only a visitor needs", () => {
    expect(siteLinks.map(({ label }) => label)).toEqual(["Find Jobs", "How CHARA Works"]);
    expect(guestLinks.map(({ label }) => label)).toEqual(["Log in", "Sign up"]);
  });

  it("puts Pricing, How CHARA Works, Trust & Safety, About and Contact in the CHARA group of the footer", () => {
    expect(aboutLinks.map(({ label }) => label)).toEqual(["Pricing", "How CHARA Works", "Trust & Safety", "About", "Contact"]);
    expect(aboutLinks.map(({ path }) => path)).toEqual(["pricing", "how-it-works", "trust-safety", "about", "contact"]);
  });

  it("has the Imprint and the ten legal pages in the footer, in three short groups", () => {
    expect(footerLinks.map(({ label }) => label).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(footerGroups.map(({ title }) => title)).toEqual(["Legal", "Rules and disputes", "Billing and roles"]);
    expect(Math.max(...footerGroups.map(({ links }) => links.length))).toBeLessThanOrEqual(4);
  });

  it("links the legal pages by a lower-case slug, which is how the route looks them up", () => {
    const slugs = legalSlugs;
    expect(slugs).toHaveLength(10);
    expect(new Set(slugs).size).toBe(10);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
