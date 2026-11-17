import { describe, expect, it } from "vitest";
import {
  accountLinks,
  currentOrganization,
  isCurrent,
  isGatePage,
  organizationCrumb,
  organizationLinks,
  workerLinks,
  type NavOrganization,
} from "@/lib/app/navigation";

const labels = (links: readonly { label: string }[]) => links.map(({ label }) => label);

const acme: NavOrganization = { slug: "acme", displayName: "Acme Bau", role: "owner", roleLabel: "Owner", suspended: false };
const beta: NavOrganization = { slug: "beta", displayName: "Beta GmbH", role: "member", roleLabel: "Member", suspended: false };

describe("the header links of a candidate", () => {
  it("are the five pages of a candidate, in the order of the requirement", () => {
    expect(workerLinks("en").map(({ label, href }) => [label, href])).toEqual([
      ["Dashboard", "/en/dashboard/worker"],
      ["Find jobs", "/en/jobs"],
      ["Saved", "/en/saved"],
      ["Applications", "/en/applications"],
      ["Passport", "/en/passport"],
    ]);
  });

  it("FR-O4: add Submissions after Applications while candidate submissions are released", () => {
    expect(workerLinks("en", { submissions: true }).map(({ label }) => label)).toEqual([
      "Dashboard",
      "Find jobs",
      "Saved",
      "Applications",
      "Submissions",
      "Passport",
    ]);
    expect(workerLinks("en", { submissions: true }).find(({ label }) => label === "Submissions")?.href).toBe("/en/submissions");
  });
});

describe("the header links of an organisation", () => {
  it.each(["owner", "admin"] as const)("give an %s Billing as well as the four pages of every member", (role) => {
    expect(labels(organizationLinks("en", { slug: "acme", role, suspended: false }))).toEqual([
      "Organisation",
      "Vacancies",
      "Applicants",
      "Team",
      "Billing",
    ]);
  });

  it("give a member no Billing, because the page answers a member with the forbidden page", () => {
    expect(labels(organizationLinks("en", { slug: "acme", role: "member", suspended: false }))).toEqual([
      "Organisation",
      "Vacancies",
      "Applicants",
      "Team",
    ]);
  });

  it("address the pages of the organisation they are for", () => {
    const links = organizationLinks("en", { slug: "acme", role: "owner", suspended: false });
    expect(links.map(({ href }) => href)).toEqual([
      "/en/dashboard/employer?org=acme",
      "/en/org/acme/jobs",
      "/en/org/acme/applicants",
      "/en/org/acme/members",
      "/en/org/acme/billing",
    ]);
  });

  it("FR-J1: give a recruitment or staffing company its dashboard, workforce profile and team, and Billing to managers", () => {
    expect(
      organizationLinks("en", { slug: "manila", role: "admin", suspended: false, partnerSegment: "recruitment" }).map(
        ({ label, href, match }) => [label, href, match],
      ),
    ).toEqual([
      ["Organisation", "/en/dashboard/recruitment?org=manila", "/en/dashboard/recruitment"],
      ["Workforce profile", "/en/org/manila/workforce-profile", "/en/org/manila/workforce-profile"],
      ["Team", "/en/org/manila/members", "/en/org/manila/members"],
      ["Billing", "/en/org/manila/billing", "/en/org/manila/billing"],
    ]);
    expect(labels(organizationLinks("en", { slug: "staff", role: "member", suspended: false, partnerSegment: "staffing" }))).toEqual([
      "Organisation",
      "Workforce profile",
      "Team",
    ]);
    expect(organizationLinks("en", { slug: "staff", role: "owner", suspended: true, partnerSegment: "staffing" })).toEqual([]);
  });

  it("FR-O1, FR-O2: add Requirements for an employer, and Job orders, Find employers, Invitations and Responses for a partner while release 2b is on", () => {
    expect(
      organizationLinks("en", { slug: "acme", role: "member", suspended: false, jobOrders: true }).map(({ label, href }) => [label, href]),
    ).toEqual([
      ["Organisation", "/en/dashboard/employer?org=acme"],
      ["Vacancies", "/en/org/acme/jobs"],
      ["Applicants", "/en/org/acme/applicants"],
      ["Requirements", "/en/org/acme/requirements"],
      ["Team", "/en/org/acme/members"],
    ]);
    expect(
      organizationLinks("en", { slug: "manila", role: "member", suspended: false, partnerSegment: "recruitment", jobOrders: true }).map(
        ({ label, href }) => [label, href],
      ),
    ).toEqual([
      ["Organisation", "/en/dashboard/recruitment?org=manila"],
      ["Workforce profile", "/en/org/manila/workforce-profile"],
      ["Job orders", "/en/org/manila/job-orders"],
      ["Find employers", "/en/org/manila/find-employers"],
      ["Invitations", "/en/org/manila/invitations"],
      ["Responses", "/en/org/manila/responses"],
      ["Team", "/en/org/manila/members"],
    ]);
    expect(
      organizationLinks("en", {
        slug: "manila",
        role: "member",
        suspended: false,
        partnerSegment: "recruitment",
        jobOrders: true,
        candidateSubmissions: true,
      }).map(({ label, href }) => [label, href]),
    ).toContainEqual(["Submissions", "/en/org/manila/submissions"]);
    expect(labels(organizationLinks("en", { slug: "acme", role: "member", suspended: false, jobOrders: true, candidateSubmissions: true }))).not.toContain(
      "Submissions",
    );
    expect(labels(organizationLinks("en", { slug: "acme", role: "owner", suspended: false }))).not.toContain("Requirements");
    expect(organizationLinks("en", { slug: "manila", role: "owner", suspended: true, partnerSegment: "recruitment", jobOrders: true })).toEqual([]);
  });

  it("give a suspended organisation none, because each of its pages only says that it is suspended", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      expect(organizationLinks("en", { slug: "acme", role, suspended: true })).toEqual([]);
    }
  });
});

describe("the account links", () => {
  it("give a candidate Edit profile, which is the passport, Settings and My reports", () => {
    expect(accountLinks("en", "worker").map(({ label, href }) => [label, href])).toEqual([
      ["Edit profile", "/en/passport"],
      ["Settings", "/en/settings"],
      ["My reports", "/en/reports"],
    ]);
  });

  it("give an employer Settings, which are the notification settings, and My reports, because the settings page sends an employer away", () => {
    expect(accountLinks("en", "company").map(({ label, href }) => [label, href])).toEqual([
      ["Settings", "/en/settings/notifications"],
      ["My reports", "/en/reports"],
    ]);
  });

  it("carry the organisation to the notification settings, so that a person in several organisations keeps the one they work in", () => {
    const [notifications] = accountLinks("en", "company", "acme");
    expect(notifications.href).toBe("/en/settings/notifications?org=acme");
    expect(isCurrent("/en/settings/notifications", notifications)).toBe(true);
  });
});

describe("the current page", () => {
  const vacancies = { label: "Vacancies", href: "/en/org/acme/jobs", match: "/en/org/acme/jobs" };

  it("is the page and everything below it", () => {
    expect(isCurrent("/en/org/acme/jobs", vacancies)).toBe(true);
    expect(isCurrent("/en/org/acme/jobs/9f2/preview", vacancies)).toBe(true);
  });

  it("is not a page whose address only starts the same way", () => {
    expect(isCurrent("/en/org/acme/jobsite", vacancies)).toBe(false);
    expect(isCurrent("/en/org/acme-two/jobs", vacancies)).toBe(false);
  });

  it("is only the page itself when the link is exact, so Settings is not current on the notification settings", () => {
    const [, settings] = accountLinks("en", "worker");
    expect(isCurrent("/en/settings", settings)).toBe(true);
    expect(isCurrent("/en/settings/notifications", settings)).toBe(false);
  });
});

describe("the organisation a person is working in", () => {
  const both = [acme, beta];

  it("is the one in the address of an organisation page", () => {
    expect(currentOrganization("en", "/en/org/beta/members", null, both)).toBe(beta);
  });

  it("is the one named by ?org= on the dashboard", () => {
    expect(currentOrganization("en", "/en/dashboard/employer", "beta", both)).toBe(beta);
  });

  it("is the first organisation on any other page, and when the address names one that is not the person's", () => {
    expect(currentOrganization("en", "/en/settings/notifications", null, both)).toBe(acme);
    expect(currentOrganization("en", "/en/org/other/jobs", null, both)).toBe(acme);
    expect(currentOrganization("en", "/en/dashboard/employer", "other", both)).toBe(acme);
  });

  it("is none for a person without an organisation", () => {
    expect(currentOrganization("en", "/en/dashboard/employer", null, [])).toBeUndefined();
  });
});

describe("the pages that finish a step", () => {
  it("are the consent page, which has no links in the header; onboarding has a layout without the header", () => {
    expect(isGatePage("en", "/en/consent")).toBe(true);
    expect(isGatePage("en", "/en/onboarding")).toBe(false);
    expect(isGatePage("en", "/en/dashboard/worker")).toBe(false);
    expect(isGatePage("en", "/en/mfa")).toBe(false);
  });
});

describe("the first item of a breadcrumb in an organisation", () => {
  it("is the name of the organisation, which leads to its dashboard", () => {
    expect(organizationCrumb("en", acme)).toEqual({ label: "Acme Bau", href: "/en/dashboard/employer?org=acme" });
  });
});
