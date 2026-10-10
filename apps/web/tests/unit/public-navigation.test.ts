import { describe, expect, it } from "vitest";
import { footerGroups, guestLinks, legalSlugs, siteLinks } from "@/lib/public/navigation";

const headerLinks = [...siteLinks, ...guestLinks];
const footerLinks = footerGroups.flatMap(({ links }) => links);

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

  it("splits the header into the links of everybody and the two that only a visitor needs", () => {
    expect(siteLinks.map(({ label }) => label)).toEqual(["Find Jobs", "Pricing", "How CHARA Works", "Trust & Safety", "About", "Contact"]);
    expect(guestLinks.map(({ label }) => label)).toEqual(["Log in", "Sign up"]);
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
