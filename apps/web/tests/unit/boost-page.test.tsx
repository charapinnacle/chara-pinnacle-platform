import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const productsMock = vi.hoisted(() => vi.fn());
const statusMock = vi.hoisted(() => vi.fn());
const reviewMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/boosts", () => ({ listBoostProducts: productsMock, getBoostStatus: statusMock }));
vi.mock("@/lib/dal/partner-review", () => ({ getPartnerReview: reviewMock }));
vi.mock("@/lib/actions/boosts", () => ({ startBoostCheckout: vi.fn() }));

const { default: BoostPage } = await import("@/app/[lang]/(app)/org/[slug]/boost/page");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function render() {
  const page = await BoostPage({
    params: Promise.resolve({ lang: "en", slug: "manila-skills" }),
    searchParams: Promise.resolve({}),
  });
  const { prelude } = await prerender(page);
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}

const organization = (role: string, suspended = false) => ({
  organization: { id: "org-1", slug: "manila-skills", displayName: "Manila Skills", type: "recruitment_company", role, suspended },
});
const review = (status: string, listedAt: string | null) => ({ status, submittedAt: null, infoStep: null, listedAt });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue(organization("owner"));
  productsMock.mockResolvedValue([
    { sku: "boost_recruitment_7d", days: 7, priceMinor: 5900, currency: "EUR" },
    { sku: "boost_recruitment_14d", days: 14, priceMinor: 10900, currency: "EUR" },
    { sku: "boost_recruitment_30d", days: 30, priceMinor: 19900, currency: "EUR" },
  ]);
  statusMock.mockResolvedValue(null);
  reviewMock.mockResolvedValue(review("listed", "2026-11-01T10:00:00Z"));
});

describe("the boost page (ARCHITECTURE.md section 10.1)", () => {
  it("does not exist while the boosts or release 2a are off", async () => {
    for (const off of ["release_boosts", "release_partner_directories"]) {
      releasedMock.mockImplementation((key: string) => Promise.resolve(key !== off));
      await expect(render()).rejects.toThrow("NOT_FOUND");
    }
  });

  it("opens to the members of a partner only, the owner and admins at aal2", async () => {
    await render();
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "member", { hideFromOutsiders: true, partner: true });
    expect(productsMock).toHaveBeenCalledWith("recruitment_company");
  });

  it("lists the products of the own type with the price excl. VAT and a Boost profile button each", async () => {
    const html = await render();
    expect(html).toContain(">Boost profile</h1>");
    expect(text(html)).toContain("Your profile is not boosted.");
    expect(text(html)).toContain("EUR 59.00 for 7 days, excl. VAT");
    expect(text(html)).toContain("EUR 109.00 for 14 days, excl. VAT");
    expect(text(html)).toContain("EUR 199.00 for 30 days, excl. VAT");
    expect(html.match(/<button[^>]*type="submit"/g)).toHaveLength(3);
    expect(text(html)).toContain("Boost profile for 14 days");
    expect(text(html)).toContain("labelled Boosted, in a separate area above the results");
    expect(text(html)).toContain("Paying never changes the order of the results.");
    expect(html).toContain('href="/en/legal/ranking"');
  });

  it("shows the running boost and its end, and that a new one follows it", async () => {
    statusMock.mockResolvedValue({ running: true, endsAt: "2026-12-11T10:00:00Z" });
    const html = text(await render());
    expect(html).toContain("Your profile is boosted until 11 December 2026");
    expect(html).toContain("A boost you buy now starts when the current one ends.");
  });

  it("says a paid boost that has not started yet runs until its end", async () => {
    statusMock.mockResolvedValue({ running: false, endsAt: "2026-12-11T10:00:00Z" });
    expect(text(await render())).toContain("Your boost is paid and runs until 11 December 2026");
  });

  it("shows a member the state and the products without a button", async () => {
    requireOrgRoleMock.mockResolvedValue(organization("member"));
    statusMock.mockResolvedValue({ running: true, endsAt: "2026-12-11T10:00:00Z" });
    const html = await render();
    expect(text(html)).toContain("Your profile is boosted until 11 December 2026");
    expect(text(html)).toContain("Only the owner and the admins of your company can buy a boost.");
    expect(html).not.toContain("<button");
  });

  it("offers no boost before the profile is listed, or to a declined or suspended company", async () => {
    reviewMock.mockResolvedValue(review("pending_review", null));
    const unlisted = await render();
    expect(text(unlisted)).toContain("Your company can buy a boost once its profile is listed.");
    expect(unlisted).not.toContain("<button");
    reviewMock.mockResolvedValue(review("declined", "2026-11-01T10:00:00Z"));
    expect(await render()).not.toContain("<button");
    reviewMock.mockResolvedValue(review("listed", "2026-11-01T10:00:00Z"));
    requireOrgRoleMock.mockResolvedValue(organization("owner", true));
    expect(await render()).not.toContain("<button");
  });
});
