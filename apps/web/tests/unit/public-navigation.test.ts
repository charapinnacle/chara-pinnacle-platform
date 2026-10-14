import { describe, expect, it } from "vitest";
import {
  appFooterLinks,
  guestLinks,
  headerLinks,
  jobSeekersLink,
  laterPhaseFeatures,
  legalGroups,
  legalSlugs,
  menuLinks,
  publicFooterColumns,
} from "@/lib/public/navigation";

const footerLinks = legalGroups.flatMap(({ links }) => links);

describe("the navigation of the public pages (FR-H1 AC3, D90)", () => {
  it("shows Find Jobs and For employers in the header, For job seekers on the For employers page, and only Sign in of the account links", () => {
    expect(headerLinks.map(({ label }) => label)).toEqual(["Find Jobs", "For employers"]);
    expect(headerLinks.map(({ path }) => path)).toEqual(["jobs", "employers"]);
    expect(jobSeekersLink).toEqual({ path: "", label: "For job seekers" });
    expect(guestLinks).toEqual([
      { path: "login", label: "Sign in" },
      { path: "signup", label: "Sign up" },
    ]);
  });

  it("keeps Pricing, Trust & Safety, About and Contact out of the header and the menu (P18)", () => {
    const labels = [...headerLinks, ...menuLinks].map(({ label }) => label);
    for (const footerOnly of ["Pricing", "Trust & Safety", "About", "Contact"]) expect(labels).not.toContain(footerOnly);
  });

  it("explores Home, Find Jobs, For employers, For job seekers and How Chara Pinnacle works from the menu", () => {
    expect(menuLinks.map(({ label }) => label)).toEqual(["Home", "Find Jobs", "For employers", "For job seekers", "How Chara Pinnacle works"]);
    expect(menuLinks.map(({ path }) => path)).toEqual(["", "jobs", "employers", "", "how-it-works"]);
  });

  it("names the client's later-phase navigation as text only: none of it is a path of the site", () => {
    expect(laterPhaseFeatures).toEqual([
      "Find Workers",
      "Request Workers",
      "Find Companies",
      "Recruitment Partners",
      "Staffing Partners",
      "Workforce Corridors",
      "Job Orders",
    ]);
    const footer: readonly { label: string }[] = publicFooterColumns.flatMap(({ links }): readonly { label: string }[] => links);
    const labels = [...headerLinks, ...menuLinks, ...footer].map(({ label }) => label);
    for (const feature of laterPhaseFeatures) expect(labels).not.toContain(feature);
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
