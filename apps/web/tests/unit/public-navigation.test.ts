import { describe, expect, it } from "vitest";
import {
  appFooterLinks,
  forAccountKind,
  guestLinks,
  headerLinks,
  releasedHeaderLinks,
  releasedPagePaths,
  laterPhaseFeatures,
  legalGroups,
  legalSlugs,
  networkFeatures,
  networkMenu,
  publicFooterColumns,
} from "@/lib/public/navigation";
import type { ReleaseSwitch } from "@/lib/release";

const footerLinks = legalGroups.flatMap(({ links }) => links);
const labelsOf = (links: readonly { label: string }[]) => links.map(({ label }) => label);

describe("the navigation of the public pages (FR-H1 AC3, D90)", () => {
  it("shows Find jobs, Employers and, while release 2a is on, both directories in the header, and only Sign in of the account links", () => {
    expect(headerLinks.map(({ label }) => label)).toEqual(["Find jobs", "Employers", "Recruitment companies", "Staffing companies"]);
    expect(headerLinks.map(({ path }) => path)).toEqual(["jobs", "employers", "partners/recruitment", "partners/staffing"]);
    expect(releasedHeaderLinks([]).map(({ label }) => label)).toEqual(["Find jobs", "Employers"]);
    expect(releasedHeaderLinks(["release_partner_directories"]).map(({ label }) => label)).toEqual(labelsOf(headerLinks));
    expect(releasedPagePaths([])).not.toContain("for-partners");
    expect(releasedPagePaths(["release_partner_directories"])).toContain("for-partners");
    expect(guestLinks).toEqual([
      { path: "login", label: "Sign in" },
      { path: "signup", label: "Sign up" },
    ]);
  });

  it("keeps How it works, Pricing, Trust & Safety, About and Contact out of the header (P18)", () => {
    const labels = headerLinks.map(({ label }) => label);
    for (const footerOnly of ["How it works", "Pricing", "Trust & Safety", "About", "Contact"]) {
      expect(labels).not.toContain(footerOnly);
    }
  });

  it("names the client's later-phase navigation, which the header, the menu links and the footer never name", () => {
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
    const labels = [...headerLinks, ...footer].map(({ label }) => label);
    for (const feature of laterPhaseFeatures) expect(labels).not.toContain(feature);
  });

  it("sets the public footer in three columns, Platform, Company and Legal, and ends it with the index of all legal documents (every document is two clicks away)", () => {
    expect(publicFooterColumns.map(({ title }) => title)).toEqual(["Platform", "Company", "Legal"]);
    expect(publicFooterColumns.map(({ links }) => links.map(({ label }) => label))).toEqual([
      ["Find jobs", "For employers", "How Chara Pinnacle works"],
      ["About", "Trust & Safety", "Contact"],
      ["Imprint", "Privacy Policy", "Terms of Service", "Cookie Policy", "All legal documents"],
    ]);
    expect(publicFooterColumns.flatMap(({ links }) => links.map(({ path }) => path))).toEqual([
      "jobs",
      "employers",
      "how-it-works",
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

  it("offers a worker no company's page, a company no job seeker's page, and everyone else every link", () => {
    expect(labels(forAccountKind(headerLinks, "worker"))).toEqual(["Find jobs"]);
    expect(labels(forAccountKind(headerLinks, "company"))).toEqual(["Employers", "Recruitment companies", "Staffing companies"]);
    expect(labels(forAccountKind(headerLinks, null))).toEqual(labels(headerLinks));
  });
});

describe("the network items of the menu (FR-L5 AC4)", () => {
  const order = ["Find workers", "Request workers", "Find companies", "Recruitment partners", "Staffing partners", "Workforce corridors", "Job orders"];
  const directories = [
    { path: "partners/recruitment", label: "Recruitment partners" },
    { path: "partners/staffing", label: "Staffing partners" },
  ];
  const jobOrders = { path: "job-orders", label: "Job orders" };
  const findCompanies = { path: "companies", label: "Find companies" };
  const findWorkers = { path: "find-workers", label: "Find workers" };
  const requestWorkers = { path: "request-workers", label: "Request workers" };
  const three = ["release_partner_directories", "release_job_orders", "release_find_workers"] as const;
  const combinations: ReleaseSwitch[][] = Array.from({ length: 8 }, (_, bits) => three.filter((_, index) => bits & (1 << index)));

  it("links the two partner directories exactly while release 2a is on, Find companies and Job orders while release 2b is on and Find workers while release 2c is on, for every combination of the three switches", () => {
    for (const released of combinations) {
      const { links, later } = networkMenu(released);
      const live = [
        ...(released.includes("release_find_workers") ? [findWorkers] : []),
        ...(released.includes("release_job_orders") ? [findCompanies] : []),
        ...(released.includes("release_partner_directories") ? directories : []),
        ...(released.includes("release_job_orders") ? [jobOrders] : []),
      ];
      expect(links, released.join()).toEqual(live);
      expect(later, released.join()).toEqual(order.filter((label) => !live.some((link) => link.label === label)));
    }
  });

  it("keeps the items whose pages do not exist yet as labels whatever their switch says, in the order of the client's structure", () => {
    expect(networkFeatures.map(({ label }) => label)).toEqual(order);
    expect(networkMenu([]).later).toEqual(order);
    const all = networkMenu([...three, "release_candidate_submissions", "release_messaging"]);
    expect(all.links).toEqual([findWorkers, requestWorkers, findCompanies, ...directories, jobOrders]);
    expect(all.later).toEqual(["Workforce corridors"]);
    expect(networkMenu(["release_messaging"]).links).toEqual([requestWorkers]);
    expect(networkFeatures.filter(({ path }) => path !== null).map(({ path }) => path)).toEqual(
      [findWorkers, requestWorkers, findCompanies, ...directories, jobOrders].map(({ path }) => path),
    );
  });

  it("offers a worker none of the network's pages, and a company and a visitor every released one", () => {
    const explore = networkMenu(["release_partner_directories"]).links;
    const labels = (links: readonly { label: string }[]) => links.map(({ label }) => label);
    expect(labels(forAccountKind(explore, "worker"))).toEqual([]);
    expect(labels(forAccountKind(explore, "company"))).toEqual(["Recruitment partners", "Staffing partners"]);
    expect(labels(forAccountKind(explore, null))).toEqual(labels(explore));
    const withJobOrders = [...networkMenu(["release_partner_directories", "release_job_orders"]).links];
    expect(labels(forAccountKind(withJobOrders, "worker"))).not.toContain("Job orders");
    expect(labels(forAccountKind(withJobOrders, "worker"))).not.toContain("Find companies");
    expect(labels(forAccountKind(withJobOrders, "company"))).toContain("Job orders");
    expect(labels(forAccountKind(withJobOrders, "company"))).toContain("Find companies");
    const withFindWorkers = [...networkMenu(["release_find_workers"]).links];
    expect(labels(forAccountKind(withFindWorkers, "worker"))).not.toContain("Find workers");
    expect(labels(forAccountKind(withFindWorkers, "company"))).toContain("Find workers");
    expect(labels(forAccountKind(withFindWorkers, null))).toContain("Find workers");
  });
});
