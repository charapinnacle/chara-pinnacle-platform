import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/connections", () => ({ setSavedPartner: vi.fn(), setFollowing: vi.fn() }));

const { ConnectionActions } = await import("@/components/connections/connection-actions");
const { connectionAccess, followerCountText, hasConnectionActions } = await import("@/lib/connections/access");
const { followedCompanyItem, savedPartnerItem } = await import("@/lib/connections/list");

const PARTNER = { id: "p-1", type: "recruitment_company" } as const;
const EMPLOYER = { id: "e-9", type: "employer" } as const;
const worker = { accountKind: "worker", suspended: false } as const;
const company = { accountKind: "company", suspended: false } as const;
const acme = { id: "e-1", type: "employer", suspended: false } as const;
const delta = { id: "p-1", type: "recruitment_company", suspended: false } as const;
const kappa = { id: "p-2", type: "staffing_company", suspended: false } as const;

// FR-L4 roles; FR-K4 AC4; FR-K5 AC8 and its open point (employers do not follow employers).
describe("who may save and follow a company (FR-L4)", () => {
  it.each([
    ["a visitor", null, [], PARTNER, { kind: "visitor" }],
    ["an account without a kind", { accountKind: null, suspended: false }, [], PARTNER, { kind: "visitor" }],
    ["a candidate on a partner", worker, [], PARTNER, { kind: "signed_in", saveFor: null, follow: true }],
    ["a candidate on an employer", worker, [], EMPLOYER, { kind: "signed_in", saveFor: null, follow: true }],
    ["an employer member on a partner", company, [acme], PARTNER, { kind: "signed_in", saveFor: "e-1", follow: true }],
    ["an employer member on another employer", company, [acme], EMPLOYER, { kind: "signed_in", saveFor: null, follow: false }],
    ["another partner on a partner", company, [kappa], PARTNER, { kind: "signed_in", saveFor: null, follow: true }],
    ["a partner on an employer", company, [kappa], EMPLOYER, { kind: "signed_in", saveFor: null, follow: true }],
    ["the partner's own member", company, [delta], PARTNER, { kind: "none" }],
    ["a suspended account", { accountKind: "company", suspended: true }, [acme], PARTNER, { kind: "none" }],
    ["a member of a suspended employer", company, [{ ...acme, suspended: true }], PARTNER, { kind: "signed_in", saveFor: null, follow: true }],
  ] as const)("%s", (_label, viewer, organizations, target, expected) => {
    expect(connectionAccess(viewer, organizations, target)).toEqual(expected);
  });

  it("saves for the first employer the viewer joined that is not suspended", () => {
    const second = { id: "e-2", type: "employer", suspended: false } as const;
    expect(connectionAccess(company, [{ ...acme, suspended: true }, second], PARTNER)).toEqual({ kind: "signed_in", saveFor: "e-2", follow: true });
  });

  it("saves for the employer a page names when the viewer is an active member of it (FR-M3 suggestions page)", () => {
    const second = { id: "e-2", type: "employer", suspended: false } as const;
    expect(connectionAccess(company, [acme, second], PARTNER, "e-2")).toEqual({ kind: "signed_in", saveFor: "e-2", follow: true });
    expect(connectionAccess(company, [acme, second], PARTNER, "e-7")).toEqual({ kind: "signed_in", saveFor: "e-1", follow: true });
    expect(connectionAccess(company, [acme, { ...second, suspended: true }], PARTNER, "e-2")).toEqual({ kind: "signed_in", saveFor: "e-1", follow: true });
    expect(connectionAccess(company, [acme, second], EMPLOYER, "e-2")).toEqual({ kind: "signed_in", saveFor: null, follow: false });
  });

  it("offers actions to a visitor and to a viewer who may save or follow, nothing otherwise", () => {
    expect(hasConnectionActions({ kind: "visitor" })).toBe(true);
    expect(hasConnectionActions({ kind: "none" })).toBe(false);
    expect(hasConnectionActions({ kind: "signed_in", saveFor: null, follow: false })).toBe(false);
    expect(hasConnectionActions({ kind: "signed_in", saveFor: null, follow: true })).toBe(true);
  });

  it("AC5, AC11: names the count from the minimum on and no number below it", () => {
    expect(followerCountText({ count: 7 })).toBe("Followers: 7");
    expect(followerCountText({ fewerThan: 5 })).toBe("Followers: fewer than 5");
  });
});

describe("Save partner and Follow buttons (FR-L4 AC9; FR-K5 AC8)", () => {
  const base = { lang: "en", organizationId: "p-1", name: "Gamma Staffing", saved: false, following: false, next: "/en/partners/gamma" };

  it("send a visitor to log in and back to the page, as Follow or Log in to follow", () => {
    const html = renderToStaticMarkup(<ConnectionActions {...base} organizationId={null} access={{ kind: "visitor" }} />);
    expect(html).toContain('href="/en/login?next=%2Fen%2Fpartners%2Fgamma"');
    expect(html).toContain("Follow<span class=\"sr-only\"> Gamma Staffing</span>");
    const page = renderToStaticMarkup(
      <ConnectionActions {...base} organizationId={null} access={{ kind: "visitor" }} visitorLabel="Log in to follow" />,
    );
    expect(page).toContain("Log in to follow");
  });

  it("are toggles with aria-pressed and the company's name, in their current state", () => {
    const html = renderToStaticMarkup(
      <ConnectionActions {...base} saved following={false} access={{ kind: "signed_in", saveFor: "e-1", follow: true }} />,
    );
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*aria-label="Saved: Gamma Staffing"/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*aria-label="Follow: Gamma Staffing"/);
    const following = renderToStaticMarkup(
      <ConnectionActions {...base} following access={{ kind: "signed_in", saveFor: null, follow: true }} />,
    );
    expect(following).toContain('aria-label="Following: Gamma Staffing"');
    expect(following).not.toContain("Save partner");
  });

  it("show nothing to the company's own members and to an employer on another employer's page", () => {
    expect(renderToStaticMarkup(<ConnectionActions {...base} access={{ kind: "none" }} />)).toBe("");
    expect(renderToStaticMarkup(<ConnectionActions {...base} access={{ kind: "signed_in", saveFor: null, follow: false }} />)).toBe("");
  });
});

describe("the rows of the lists (FR-L4 AC10)", () => {
  it("a saved partner shows its name, based in and the countries it serves, and links to its profile", () => {
    expect(
      savedPartnerItem("en", {
        id: "p-1", slug: "gamma", displayName: "Gamma", organizationType: "staffing_company", basedIn: "Philippines",
        servedCountries: ["Austria", "Germany"], savedAt: "2026-12-01T10:00:00Z",
      }),
    ).toEqual({
      id: "p-1", name: "Gamma", href: "/en/partners/gamma", at: "2026-12-01T10:00:00Z",
      details: ["Staffing company, based in Philippines", "Serves Austria, Germany"],
    });
  });

  it("a followed employer links to its company page, a followed partner to its profile, each worded for its type", () => {
    const row = { id: "o-1", slug: "beta", displayName: "Beta", basedIn: "Germany", followedAt: "2026-12-01T10:00:00Z" };
    expect(followedCompanyItem("en", { ...row, organizationType: "employer" })).toMatchObject({
      href: "/en/companies/beta",
      details: ["Employer, based in Germany", "You hear about its new vacancies, at most once a day."],
    });
    const partner = followedCompanyItem("en", { ...row, organizationType: "recruitment_company" });
    expect(partner.href).toBe("/en/partners/beta");
    expect(partner.details).toEqual(["Recruitment company, based in Germany", "Its profile stays at hand here."]);
    expect(partner.details.join(" ")).not.toMatch(/vacanc/i);
  });
});
