import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const requestMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/boosts", () => ({ requestBoostCheckout: requestMock }));

const { startBoostCheckout } = await import("@/lib/actions/boosts");

const ORG = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const FAILURE = "We could not start the payment. Nothing was charged. Try again.";
const refusal = (status: number, reason: string | null = null) => ({ refusal: { status, reason, field: null } });

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgRoleMock.mockResolvedValue({ organization: { id: ORG } });
  requestMock.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_boost" });
});

describe("startBoostCheckout", () => {
  it("checks the owner or admin of a partner and goes to the provider's page for the product", async () => {
    await expect(startBoostCheckout("manila-skills", "boost_recruitment_14d")).rejects.toThrow(
      "REDIRECT:https://checkout.stripe.com/c/pay/cs_boost",
    );
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "admin", { partner: true });
    expect(requestMock).toHaveBeenCalledWith(ORG, "boost_recruitment_14d");
  });

  it("calls nothing for a slug or a product that cannot be one", async () => {
    for (const [slug, sku] of [["Bad Slug", "boost_recruitment_7d"], ["manila-skills", "Boost 7"], ["manila-skills", ""]]) {
      await expect(startBoostCheckout(slug, sku)).resolves.toEqual({ message: FAILURE });
    }
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("sends a lapsed second step back to confirm it, returning to the boost page", async () => {
    for (const answer of [refusal(401), refusal(403, "aal2_required")]) {
      requestMock.mockResolvedValue(answer);
      await expect(startBoostCheckout("manila-skills", "boost_recruitment_7d")).rejects.toThrow(
        "REDIRECT:/en/mfa?next=%2Fen%2Forg%2Fmanila-skills%2Fboost",
      );
    }
  });

  it.each([
    [refusal(403, "not_listed"), "Your company can buy a boost once its profile is listed."],
    [refusal(403, "boosts_off"), "Boosts cannot be bought at the moment."],
    [refusal(403, "product_not_for_org_type"), "This boost is for another type of company."],
    [refusal(403, "product_not_sold"), "This boost cannot be bought online. Reload the page to see the boosts on sale."],
    [refusal(502), FAILURE],
    [refusal(0), FAILURE],
    [refusal(403, "something the page does not know"), FAILURE],
  ])("says in words what the function refused (%j)", async (answer, message) => {
    requestMock.mockResolvedValue(answer);
    await expect(startBoostCheckout("manila-skills", "boost_recruitment_7d")).resolves.toEqual({ message });
  });
});
