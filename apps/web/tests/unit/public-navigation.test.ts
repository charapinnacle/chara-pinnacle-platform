import { describe, expect, it } from "vitest";
import {
  appFooterLinks,
  forAccountKind,
  guestLinks,
  headerLinks,
  howItWorksLink,
  jobSeekersLink,
  laterPhaseFeatures,
  legalGroups,
  legalSlugs,
  menuLinks,
  networkFeatures,
  networkMenu,
  publicFooterColumns,
} from "@/lib/public/navigation";
import type { ReleaseSwitch } from "@/lib/release";

const footerLinks = legalGroups.flatMap(({ links }) => links);

describe("the navigation of the public pages (FR-H1 AC3, D90)", () => {
  it("shows Find Jobs and For employers in the header, For job seekers on the For employers page, and only Sign in of the account links", () => {
    expect(headerLinks.map(({ label }) => label)).toEqual(["Find jobs", "For employers"]);
    expect(headerLinks.map(({ path }) => path)).toEqual(["jobs", "employers"]);
    expect(jobSeekersLink).toEqual({ path: "", label: "For job seekers" });
    expect(howItWorksLink).toEqual({ path: "how-it-works", label: "How it works" });
    expect(guestLinks).toEqual([
      { path: "login", label: "Sign in" },
      { path: "signup", label: "Sign up" },
    ]);
  });

  it("keeps Pricing, Trust & Safety, About and Contact out of the header and the menu (P18)", () => {
    const labels = [...headerLinks, howItWorksLink, ...menuLinks].map(({ label }) => label);
    for (const footerOnly of ["Pricing", "Trust & Safety", "About", "Contact"]) expect(labels).not.toContain(footerOnly);
  });

  it("explores Find Jobs, For employers, For job seekers and How Chara Pinnacle works from the menu (the logo leads home)", () => {
    expect(menuLinks.map(({ label }) => label)).toEqual(["Find jobs", "For employers", "For job seekers", "How Chara Pinnacle works"]);
    expect(menuLinks.map(({ path }) => path)).toEqual(["jobs", "employers", "", "how-it-works"]);
  });

  it("names the client's later-phase navigation as text only: none of it is a path of the site", () => {
    expect(laterPhaseFeatures).toEqual([
      "Find workers",
      "Request workers",
      "Find companies",
      "Recruitment partners",
      "Staffing partners",
      "Workforce corridors",
      "Job orders",
    ]);
    const footer: readonly { label: string }[] = publicFooterColumns.flatMap(({ links }): readonly { label: string }[] => links);
    const labels = [...headerLinks, ...menuLinks, ...footer].map(({ label }) => label);
    for (const feature of laterPhaseFeatures) expect(labels).not.toContain(feature);
  });

  it("sets the public footer in three columns, Platform, Company and Legal, and ends it with the index of all legal documents (every document is two clicks away)", () => {
    expect(publicFooterColumns.map(({ title }) => title)).toEqual(["Platform", "Company", "Legal"]);
    expect(publicFooterColumns.map(({ links }) => links.map(({ label }) => label))).toEqual([
      ["Find jobs", "For employers", "How Chara Pinnacle works", "Pricing"],
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

describe("the links for an account kind", () => {
  const labels = (links: readonly { label: string }[]) => links.map(({ label }) => label);

  it("offers a worker no employer's page, a company no job seeker's page, and everyone else every link", () => {
    expect(labels(forAccountKind(menuLinks, "worker"))).toEqual(["Find jobs", "For job seekers", "How Chara Pinnacle works"]);
    expect(labels(forAccountKind(menuLinks, "company"))).toEqual(["For employers", "How Chara Pinnacle works"]);
    expect(labels(forAccountKind(menuLinks, null))).toEqual(labels(menuLinks));
    expect(labels(forAccountKind(headerLinks, undefined))).toEqual(labels(headerLinks));
  });
});

describe("the network items of the menu (FR-L5 AC4)", () => {
  const order = ["Find workers", "Request workers", "Find companies", "Recruitment partners", "Staffing partners", "Workforce corridors", "Job orders"];
  const paths: Record<string, string> = {
    "Find workers": "find-workers",
    "Request workers": "request-workers",
    "Find companies": "companies",
    "Recruitment partners": "partners/recruitment",
    "Staffing partners": "partners/staffing",
    "Job orders": "job-orders",
  };
  const follows: Record<string, ReleaseSwitch | null> = {
    "Find workers": "release_find_workers",
    "Request workers": "release_find_workers",
    "Find companies": "release_job_orders",
    "Recruitment partners": "release_partner_directories",
    "Staffing partners": "release_partner_directories",
    "Workforce corridors": null,
    "Job orders": "release_job_orders",
  };
  const three = ["release_partner_directories", "release_job_orders", "release_find_workers"] as const;
  const combinations: ReleaseSwitch[][] = Array.from({ length: 8 }, (_, bits) => three.filter((_, index) => bits & (1 << index)));

  it("makes each released item a link with its path and keeps every other one a label, for every combination of the three switches", () => {
    for (const released of combinations) {
      const { links, later } = networkMenu(released);
      const live = order.filter((label) => {
        const release = follows[label];
        return release !== null && released.includes(release);
      });
      expect(links, released.join()).toEqual(live.map((label) => ({ path: paths[label], label })));
      expect(later, released.join()).toEqual(order.filter((label) => !live.includes(label)));
    }
  });

  it("keeps the order of the client's structure, Workforce Corridors always a label, and a missing switch counts as off", () => {
    expect(networkFeatures.map(({ label }) => label)).toEqual(order);
    expect(networkMenu([]).later).toEqual(order);
    expect(networkMenu(["release_candidate_submissions", "release_messaging"]).links).toEqual([]);
    const all = networkMenu([...three, "release_candidate_submissions", "release_messaging"]);
    expect(all.later).toEqual(["Workforce corridors"]);
    expect(all.links.map(({ label }) => label)).toEqual(order.filter((label) => label !== "Workforce corridors"));
  });

  it("offers a worker none of the network's pages, and a company and a visitor every released one", () => {
    const explore = [...menuLinks, ...networkMenu(["release_partner_directories", "release_job_orders", "release_find_workers"]).links];
    const labels = (links: readonly { label: string }[]) => links.map(({ label }) => label);
    expect(labels(forAccountKind(explore, "worker"))).toEqual(["Find jobs", "For job seekers", "How Chara Pinnacle works"]);
    expect(labels(forAccountKind(explore, "company"))).toEqual([
      "For employers",
      "How Chara Pinnacle works",
      ...order.filter((label) => label !== "Workforce corridors"),
    ]);
    expect(labels(forAccountKind(explore, null))).toEqual(labels(explore));
  });
});
