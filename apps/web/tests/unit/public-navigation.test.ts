import { describe, expect, it } from "vitest";
import { appFooterLinks, guestLinks, legalGroups, legalSlugs, publicFooterColumns, siteLinks } from "@/lib/public/navigation";

const headerLinks = [...siteLinks, ...guestLinks];
const footerLinks = legalGroups.flatMap(({ links }) => links);

describe("the navigation of the public pages (FR-H1 AC3)", () => {
  it("keeps the static header links to the two ways in and the account links, as the owner decided (OPEN_QUESTIONS.md, 2026-10-10); Post a Job sits between them (D81)", () => {
    expect(headerLinks.map(({ label }) => label)).toEqual(["Find Jobs", "How Chara Pinnacle works", "Login", "Sign up"]);
    expect(headerLinks.map(({ path }) => path)).toEqual(["jobs", "how-it-works", "login", "signup"]);
    expect(headerLinks.map(({ label }) => label)).not.toContain("Pricing");
  });

  it("splits the header into the links of everybody and the two that only a visitor needs", () => {
    expect(siteLinks.map(({ label }) => label)).toEqual(["Find Jobs", "How Chara Pinnacle works"]);
    expect(guestLinks.map(({ label }) => label)).toEqual(["Login", "Sign up"]);
  });

  it("sets the public footer in three columns, Platform, Company and Legal, and ends it with the index of all legal documents (every document is two clicks away)", () => {
    expect(publicFooterColumns.map(({ title }) => title)).toEqual(["Platform", "Company", "Legal"]);
    expect(publicFooterColumns.map(({ links }) => links.map(({ label }) => label))).toEqual([
      ["Find Jobs", "For employers", "How Chara Pinnacle works", "Pricing"],
      ["About", "Trust & Safety", "Contact"],
      ["Imprint", "Privacy Policy", "Terms of Service", "Cookie Policy", "All legal documents"],
    ]);
    expect(publicFooterColumns.flatMap(({ links }) => links.map(({ path }) => path))).toEqual([
      "jobs",
      "employers",
      "how-it-works",
      "pricing",
      "about",
      "trust-safety",
      "contact",
      "imprint",
      "legal/privacy-policy",
      "legal/terms-of-service",
      "legal/cookie-policy",
      "legal",
    ]);
    expect(publicFooterColumns[2].links.at(-1)?.path).toBe("legal");
  });

  it("gives the signed-in area one small line of four links", () => {
    expect(appFooterLinks.map(({ label }) => label)).toEqual(["Terms", "Privacy", "Imprint", "All legal documents"]);
  });

  it("has the Imprint and the ten legal pages in the index of legal documents, in three short groups", () => {
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
    expect(legalGroups.map(({ title }) => title)).toEqual(["Legal", "Rules and disputes", "Billing and roles"]);
    expect(Math.max(...legalGroups.map(({ links }) => links.length))).toBeLessThanOrEqual(4);
  });

  it("links the legal pages by a lower-case slug, which is how the route looks them up", () => {
    const slugs = legalSlugs;
    expect(slugs).toHaveLength(10);
    expect(new Set(slugs).size).toBe(10);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
