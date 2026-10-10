import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppLayout from "@/app/[lang]/(app)/layout";
import { AppNav } from "@/components/layout/app-nav";
import { FooterLinks } from "@/components/layout/footer-links";
import type { NavOrganization } from "@/lib/app/navigation";

const navigation = vi.hoisted(() => ({ pathname: "/en/dashboard/worker", org: null as string | null }));
const userMock = vi.hoisted(() => vi.fn());
const organizationsMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.org ? { org: navigation.org } : {}),
}));
vi.mock("@/lib/actions/login", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser: userMock }));
vi.mock("@/lib/dal/organizations", () => ({ getMyOrganizations: organizationsMock }));

const acme: NavOrganization = { slug: "acme", displayName: "Acme Bau", role: "owner", roleLabel: "Owner", suspended: false };
const beta: NavOrganization = { slug: "beta", displayName: "Beta GmbH", role: "member", roleLabel: "Member", suspended: false };

function nav(props: Partial<Parameters<typeof AppNav>[0]> = {}, pathname = "/en/dashboard/worker", org: string | null = null) {
  navigation.pathname = pathname;
  navigation.org = org;
  return renderToStaticMarkup(<AppNav lang="en" email="ana@example.test" accountKind="worker" organizations={[]} {...props} />);
}

const mainLabels = (html: string) => {
  const main = /<nav aria-label="Main">(.*?)<\/nav>/.exec(html)?.[1] ?? "";
  return [...main.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((match) => match[1]);
};

describe("the header of the signed-in area", () => {
  it("offers a candidate the five pages, marks the current one and shows the account with its role", () => {
    const html = nav({}, "/en/applications");
    expect(mainLabels(html)).toEqual(["Dashboard", "Find jobs", "Saved", "Applications", "Passport"]);
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*>Applications<\/a>/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain("ana@example.test");
    expect(html).toContain("Worker");
    expect(html).toContain("Notification settings");
    expect(html).toContain("Log out");
  });

  it("renders the links and the account items visible, and the Menu button hidden, until JavaScript takes over", () => {
    const html = nav();
    const button = /<button[^>]*aria-controls="([^"]*)"[^>]*class="([^"]*)"/.exec(html);
    const panel = new RegExp(`<div id="${button?.[1]}" class="([^"]*)"`).exec(html);
    expect(button?.[2].split(" ")).toContain("hidden");
    expect(panel?.[1].split(" ")).not.toContain("hidden");
    expect(html).toMatch(/>Settings<\/a>/);
  });

  it("offers an owner Billing and a member not, for the organisation in the address", () => {
    expect(mainLabels(nav({ accountKind: "company", organizations: [acme] }, "/en/org/acme/jobs"))).toEqual([
      "Organisation",
      "Vacancies",
      "Applicants",
      "Team",
      "Billing",
    ]);
    expect(mainLabels(nav({ accountKind: "company", organizations: [beta] }, "/en/org/beta/jobs"))).toEqual([
      "Organisation",
      "Vacancies",
      "Applicants",
      "Team",
    ]);
  });

  it("shows the switcher only for a person in more than one organisation, and the role of the organisation worked in", () => {
    const one = nav({ accountKind: "company", organizations: [acme] });
    expect(one).not.toContain("Your organisations");
    const two = nav({ accountKind: "company", organizations: [acme, beta] }, "/en/dashboard/employer", "beta");
    expect(two).toContain("Your organisations");
    expect(two).toMatch(/aria-current="true"[^>]*>Beta GmbH</);
    expect(two).toContain("Member");
    expect(mainLabels(two)).not.toContain("Billing");
  });

  it("offers an employer the notification settings only", () => {
    const html = nav({ accountKind: "company", organizations: [acme] });
    expect(html).toContain("Notification settings");
    expect(html).not.toMatch(/>Settings<\/a>/);
  });

  it("offers nothing to a suspended organisation, and no page link on the onboarding page or to an account without a kind", () => {
    expect(mainLabels(nav({ accountKind: "company", organizations: [{ ...acme, suspended: true }] }))).toEqual([]);
    expect(mainLabels(nav({}, "/en/onboarding"))).toEqual([]);
    expect(mainLabels(nav({}, "/en/consent"))).toEqual([]);
    const html = nav({ accountKind: null });
    expect(mainLabels(html)).toEqual([]);
    expect(html).toContain("Log out");
    expect(html).not.toContain("Settings");
  });
});

type ShellProps = {
  homeHref: string;
  headerActions: ReactElement<Parameters<typeof AppNav>[0]> | null;
  footerLinks: ReactElement;
};

async function shell(): Promise<ShellProps> {
  const tree = await AppLayout({ children: null, params: Promise.resolve({ lang: "en" }) });
  if (!isValidElement<ShellProps>(tree)) throw new Error("The layout did not return an element");
  return tree.props;
}

const user = { id: "u1", email: "ana@example.test", aal: "aal1", intendedAccountKind: null, suspended: false };

describe("the layout of the signed-in area", () => {
  beforeEach(() => {
    userMock.mockReset();
    organizationsMock.mockReset();
  });

  it("sends a candidate's logo to the worker dashboard and reads no organisations", async () => {
    userMock.mockResolvedValue({ ...user, accountKind: "worker" });
    const props = await shell();
    expect(props.homeHref).toBe("/en/dashboard/worker");
    expect(props.headerActions?.props).toMatchObject({ accountKind: "worker", organizations: [], email: "ana@example.test" });
    expect(organizationsMock).not.toHaveBeenCalled();
  });

  it("gives an employer the organisations with the label of their role and the employer dashboard as home", async () => {
    userMock.mockResolvedValue({ ...user, accountKind: "company" });
    organizationsMock.mockResolvedValue([
      { id: "o1", slug: "acme", displayName: "Acme Bau", role: "owner", suspended: false },
      { id: "o2", slug: "beta", displayName: "Beta GmbH", role: "admin", suspended: true },
    ]);
    const props = await shell();
    expect(props.homeHref).toBe("/en/dashboard/employer");
    expect(props.headerActions?.props.organizations).toEqual([
      { slug: "acme", displayName: "Acme Bau", role: "owner", roleLabel: "Owner", suspended: false },
      { slug: "beta", displayName: "Beta GmbH", role: "admin", roleLabel: "Administrator", suspended: true },
    ]);
    expect(organizationsMock).toHaveBeenCalledWith("u1");
  });

  it("gives a suspended account the way out and nothing else, and the public home as home", async () => {
    userMock.mockResolvedValue({ ...user, accountKind: "worker", suspended: true });
    const props = await shell();
    expect(props.homeHref).toBe("/");
    expect(props.headerActions?.props.accountKind).toBeNull();
    expect(organizationsMock).not.toHaveBeenCalled();
  });

  it("does the same for an account whose kind is not committed yet", async () => {
    userMock.mockResolvedValue({ ...user, accountKind: null });
    const props = await shell();
    expect(props.homeHref).toBe("/");
    expect(props.headerActions?.props.accountKind).toBeNull();
  });

  it("leaves the subscription terms out of the footer of a candidate (FR-G6 AC5) and keeps them for an employer", async () => {
    userMock.mockResolvedValue({ ...user, accountKind: "worker" });
    expect(renderToStaticMarkup((await shell()).footerLinks)).not.toContain("billing");
    userMock.mockResolvedValue({ ...user, accountKind: "company" });
    organizationsMock.mockResolvedValue([]);
    const employer = renderToStaticMarkup((await shell()).footerLinks);
    expect(employer).toContain('href="/en/legal/subscription-and-billing-terms"');
    expect(employer.match(/<a /g)).toHaveLength(11);
  });

  it("has no header actions for a visitor, and the legal links in the footer for everybody", async () => {
    userMock.mockResolvedValue(null);
    const props = await shell();
    expect(props.headerActions).toBeNull();
    expect(renderToStaticMarkup(props.footerLinks)).toContain('href="/en/imprint"');
  });
});

describe("the footer links", () => {
  const html = renderToStaticMarkup(<FooterLinks lang="en" />);

  it("are three named groups of the Imprint and the ten legal pages", () => {
    expect(html).toContain('aria-label="Legal"');
    for (const title of ["Legal", "Rules and disputes", "Billing and roles"]) expect(html).toContain(`>${title}<`);
    expect(html.match(/<a /g)).toHaveLength(11);
    expect(html).toContain('href="/en/legal/worker-terms"');
  });
});
