import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const requestMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/billing", () => ({ requestHostedSession: requestMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { openPortal, saveLegalEntityIdentifier, startCheckout } = await import("@/lib/actions/billing");

const ORG = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const input = {
  slug: "acme",
  planCode: "employer_starter",
  billingCountry: "de",
  vatId: "DE123456789",
  registrationNumber: "",
  termsVersion: 2,
  disclosedTrialDays: 30,
};
const refusal = (status: number, reason: string | null = null, field: string | null = null) => ({
  refusal: { status, reason, field },
});

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgRoleMock.mockResolvedValue({ organization: { id: ORG } });
  requestMock.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_1" });
  rpcMock.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("startCheckout", () => {
  it("checks the role in the database, sends the shown terms and trial to the function and goes to the hosted page", async () => {
    await expect(startCheckout(input)).rejects.toThrow("REDIRECT:https://checkout.stripe.com/c/pay/cs_1");
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme", "admin");
    expect(requestMock).toHaveBeenCalledWith({
      action: "checkout",
      orgId: ORG,
      planCode: "employer_starter",
      billingCountry: "DE",
      vatId: "DE123456789",
      registrationNumber: null,
      termsVersion: 2,
      disclosedTrialDays: 30,
    });
  });

  it("returns field messages and calls nothing for an invalid input", async () => {
    const result = await startCheckout({ ...input, billingCountry: "DEU", slug: "Bad Slug" });
    expect(Object.keys(result?.errors ?? {}).sort()).toEqual(["billingCountry", "slug"]);
    expect(requestMock).not.toHaveBeenCalled();
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
  });

  it.each([
    [refusal(403, "terms_version_mismatch"), "The Subscription and Billing Terms changed. Reload this page to read the current version."],
    [refusal(409, "trial_changed"), "The free trial that applies to your company changed. Read the updated terms above, accept them again and continue."],
    [refusal(403, "already_subscribed"), "Your organization already has a subscription. Use Manage billing to change it."],
    [refusal(403, "plan_not_sold"), "This plan cannot be bought online."],
    [refusal(403, "organization_suspended"), "This organization is suspended, so it cannot start a subscription."],
    [refusal(502), "We could not start the checkout. Nothing was charged. Try again."],
    [refusal(0), "We could not start the checkout. Nothing was charged. Try again."],
    [refusal(403, "something the page does not know"), "We could not start the checkout. Nothing was charged. Try again."],
  ])("says in words what the function refused (%j)", async (answer, message) => {
    requestMock.mockResolvedValue(answer);
    await expect(startCheckout(input)).resolves.toEqual({ message });
  });

  it("refreshes the confirmation page after a trial that changed, and after no other refusal", async () => {
    revalidateMock.mockClear();
    requestMock.mockResolvedValue(refusal(409, "trial_changed"));
    await startCheckout(input);
    expect(revalidateMock).toHaveBeenCalledExactlyOnceWith("/en/org/acme/billing/checkout");
    revalidateMock.mockClear();
    requestMock.mockResolvedValue(refusal(403, "already_subscribed"));
    await startCheckout(input);
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it.each([
    ["billing_country", { billingCountry: "Choose the billing country." }],
    ["vat_id", { vatId: "Check the VAT ID." }],
    ["registration_number", { registrationNumber: "Check the company registration number." }],
    [
      "identifier",
      { vatId: "Enter a VAT ID or a company registration number.", registrationNumber: "Enter a VAT ID or a company registration number." },
    ],
  ])("puts a refused %s next to its field", async (field, errors) => {
    requestMock.mockResolvedValue(refusal(400, null, field));
    await expect(startCheckout(input)).resolves.toEqual({ errors });
  });

  it("asks for the identifier on both fields when the database says it is required", async () => {
    requestMock.mockResolvedValue(refusal(403, "legal_entity_identifier_required"));
    const result = await startCheckout(input);
    expect(Object.keys(result?.errors ?? {})).toEqual(["vatId", "registrationNumber"]);
  });

  it.each([[refusal(401)], [refusal(403, "aal2_required")]])("sends a lapsed second step to confirm it and come back (%j)", async (answer) => {
    requestMock.mockResolvedValue(answer);
    await expect(startCheckout(input)).rejects.toThrow("REDIRECT:/en/mfa?next=%2Fen%2Forg%2Facme%2Fbilling");
  });
});

describe("openPortal", () => {
  it("opens the portal of the organization the role was checked for", async () => {
    requestMock.mockResolvedValue({ url: "https://billing.stripe.com/p/session/s_1" });
    await expect(openPortal("acme")).rejects.toThrow("REDIRECT:https://billing.stripe.com/p/session/s_1");
    expect(requestMock).toHaveBeenCalledWith({ action: "portal", orgId: ORG });
  });

  it("refuses a slug that is not one, and says when there is no billing account", async () => {
    await expect(openPortal("../x")).resolves.toEqual({ message: "We could not start the checkout. Nothing was charged. Try again." });
    expect(requestMock).not.toHaveBeenCalled();
    requestMock.mockResolvedValue(refusal(403, "no_customer"));
    await expect(openPortal("acme")).resolves.toEqual({ message: "There is no billing account to manage yet." });
  });
});

describe("saveLegalEntityIdentifier", () => {
  const values = { identifier: "de 123 456 789", identifierKind: "vat_number" };

  it("is the owner's: the role is checked, and the database normalises and locks", async () => {
    await expect(saveLegalEntityIdentifier("acme", values)).resolves.toEqual({});
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme", "owner");
    expect(rpcMock).toHaveBeenCalledWith("set_legal_entity_identifier", {
      p_org: ORG,
      p_identifier: "de 123 456 789",
      p_kind: "vat_number",
    });
    expect(revalidateMock).toHaveBeenCalledWith("/en/org/acme/billing");
  });

  it("returns field messages and calls nothing for an invalid input", async () => {
    const result = await saveLegalEntityIdentifier("acme", { identifier: "x1", identifierKind: "" });
    expect(Object.keys(result?.errors ?? {}).sort()).toEqual(["identifier", "identifierKind"]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ message: "CHARA_FORBIDDEN", details: "legal_entity_identifier_locked", code: "P0001" }, { message: "The identifier cannot be changed once a payment has been started for the company." }],
    [{ message: "CHARA_INVALID_INPUT", details: "legal_entity_identifier", code: "P0001" }, { errors: { identifier: "Check the identifier." } }],
    [{ message: "boom", details: null, code: "XX000" }, { message: "We could not save the identifier. Try again." }],
  ])("answers a refusal of the database in words (%j)", async (error, expected) => {
    rpcMock.mockResolvedValue({ error });
    await expect(saveLegalEntityIdentifier("acme", values)).resolves.toEqual(expected);
  });

  it("sends a lapsed second step to confirm it", async () => {
    rpcMock.mockResolvedValue({ error: { message: "CHARA_FORBIDDEN", details: "aal2_required", code: "P0001" } });
    await expect(saveLegalEntityIdentifier("acme", values)).rejects.toThrow("REDIRECT:/en/mfa?next=%2Fen%2Forg%2Facme%2Fbilling");
  });
});
