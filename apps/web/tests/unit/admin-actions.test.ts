import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const rpcMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requirePlatformRole: requireRoleMock }));
vi.mock("@/lib/dal/admin", () => ({ adminClient: async () => ({ rpc: rpcMock }) }));

const { changeStanding } = await import("@/lib/actions/admin-moderation");
const { grantRole, publishLegalDocument, resetMfa, revokeRole } = await import("@/lib/actions/admin-staff");

const ID = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const OTHER = "0a1b2c3d-0000-4000-8000-000000000001";
const GENERIC = "We could not complete this request. Try again.";
const REASON = "Fake profile reported 3x.";

const failure = (message: string, details = "") => ({ data: null, error: { message, details, code: "P0001" } });

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["trust_safety"] });
  rpcMock.mockResolvedValue({ data: null, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("changeStanding", () => {
  it.each([
    ["user", "suspended", "suspend_user", { p_user_id: ID, p_reason: REASON }],
    ["user", "active", "reinstate_user", { p_user_id: ID, p_reason: REASON }],
    ["organization", "suspended", "suspend_organization", { p_org: ID, p_reason: REASON }],
    ["organization", "active", "reinstate_organization", { p_org: ID, p_reason: REASON }],
  ] as const)("calls the function for %s to %s with the trimmed reason and asks for the Trust & Safety role", async (target, to, name, args) => {
    const result = await changeStanding({ target, id: ID, to, reason: `  ${REASON}  ` });

    expect(result).toEqual({ done: true });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["trust_safety"]);
    expect(rpcMock).toHaveBeenCalledWith(name, args);
    expect(revalidateMock).toHaveBeenCalledWith(`/en/admin/${target === "user" ? "users" : "organizations"}/${ID}`);
  });

  it("refuses a short reason with the field error and calls nothing", async () => {
    const result = await changeStanding({ target: "user", id: ID, to: "suspended", reason: "short" });
    expect(result.errors).toEqual({ reason: "Give a reason of at least 10 characters" });
    expect(requireRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    ["user", "suspended", "This account is already suspended"],
    ["user", "active", "This account is already active"],
    ["organization", "suspended", "This organisation is already suspended"],
    ["organization", "active", "This organisation is already active"],
  ] as const)("says that a %s is already %s when the database finds it so", async (target, to, expected) => {
    rpcMock.mockResolvedValue(failure("CHARA_INVALID_STATE", to === "suspended" ? "suspended" : "active"));
    expect(await changeStanding({ target, id: ID, to, reason: REASON })).toEqual({ message: expected });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("explains a staff account, a missing record and a refusal without leaking the database text", async () => {
    rpcMock.mockResolvedValueOnce(failure("CHARA_FORBIDDEN", "staff_account"));
    expect((await changeStanding({ target: "user", id: ID, to: "suspended", reason: REASON })).message).toContain("platform role");
    rpcMock.mockResolvedValueOnce(failure("CHARA_NOT_FOUND"));
    expect(await changeStanding({ target: "user", id: ID, to: "suspended", reason: REASON })).toEqual({ message: "This record no longer exists." });
    rpcMock.mockResolvedValueOnce(failure("CHARA_FORBIDDEN"));
    expect(await changeStanding({ target: "user", id: ID, to: "suspended", reason: REASON })).toEqual({ message: "You are not allowed to do this." });
    rpcMock.mockResolvedValueOnce(failure("XX000: relation \"profiles\" does not exist"));
    expect(await changeStanding({ target: "user", id: ID, to: "suspended", reason: REASON })).toEqual({ message: GENERIC });
  });

  it("sends a person whose two-step verification lapsed to the MFA page and back to the same page", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "aal2_required"));
    await expect(changeStanding({ target: "user", id: ID, to: "suspended", reason: REASON })).rejects.toThrow(
      `REDIRECT:/en/mfa?next=${encodeURIComponent(`/en/admin/users/${ID}`)}`,
    );
  });

  it("lets the refusal of the role guard through before anything is called", async () => {
    requireRoleMock.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(changeStanding({ target: "user", id: ID, to: "suspended", reason: REASON })).rejects.toThrow("NOT_FOUND");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("grantRole", () => {
  const input = { email: " Nia@Example.TEST ", role: "trust_safety", reason: "New hire, ticket 4812" };

  beforeEach(() => {
    requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["admin"] });
    rpcMock.mockImplementation(async (name: string) =>
      name === "admin_search_users"
        ? { data: [{ id: OTHER, email: "nia.other@example.test" }, { id: ID, email: "nia@example.test" }], error: null }
        : { data: null, error: null },
    );
  });

  it("finds the person by the whole email address among the matches and grants the role", async () => {
    expect(await grantRole(input)).toEqual({ done: true });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["admin"]);
    expect(rpcMock).toHaveBeenCalledWith("admin_search_users", { p_term: "nia@example.test", p_limit: 5 });
    expect(rpcMock).toHaveBeenCalledWith("grant_platform_role", { p_user_id: ID, p_role: "trust_safety", p_reason: "New hire, ticket 4812" });
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/staff");
  });

  it("names an address nobody has and grants nothing", async () => {
    rpcMock.mockImplementation(async () => ({ data: [{ id: OTHER, email: "someone.else@example.test" }], error: null }));
    expect(await grantRole(input)).toEqual({ errors: { email: "No account has this email address" } });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [failure("CHARA_CONFLICT", "role_active"), { errors: { role: "This person already has this role" } }],
    [failure("CHARA_FORBIDDEN", "own_account"), { errors: { email: "You cannot give a role to yourself" } }],
    [failure("CHARA_INVALID_INPUT", "user"), { errors: { email: "This person has no active account with a confirmed email address" } }],
    [failure("CHARA_INVALID_INPUT", "reason"), { errors: { reason: "Give a reason of 10 to 500 characters" } }],
  ])("maps the refusal %# to the field", async (refusal, expected) => {
    rpcMock.mockImplementation(async (name: string) => (name === "admin_search_users" ? { data: [{ id: ID, email: "nia@example.test" }], error: null } : refusal));
    expect(await grantRole(input)).toEqual(expected);
  });

  it("refuses a role that is not one of the three before anything is called", async () => {
    expect((await grantRole({ ...input, role: "owner" })).errors).toEqual({ role: "Choose a role" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("revokeRole, resetMfa and publishLegalDocument", () => {
  beforeEach(() => requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["admin"] }));

  it("revoke a role and say why the last administrator stays", async () => {
    const input = { userId: ID, role: "admin", reason: "Left the team, ticket 4813" };
    expect(await revokeRole(input)).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("revoke_platform_role", { p_user_id: ID, p_role: "admin", p_reason: "Left the team, ticket 4813" });
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "last_administrator"));
    expect(await revokeRole(input)).toEqual({ message: "The last administrator cannot be revoked." });
    rpcMock.mockResolvedValue(failure("CHARA_CONFLICT", "role_revoked"));
    expect(await revokeRole(input)).toEqual({ message: "This role was already revoked." });
    expect((await revokeRole({ ...input, role: "king" })).errors).toEqual({ role: "Choose a role" });
  });

  it("reset two-step verification of another person only with the box ticked", async () => {
    const input = { userId: ID, identityChecked: true, reason: "Lost the phone, identity checked" };
    expect(await resetMfa(input)).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("reset_mfa", { p_user_id: ID, p_reason: "Lost the phone, identity checked" });
    rpcMock.mockClear();
    expect((await resetMfa({ ...input, identityChecked: false })).errors).toEqual({
      identityChecked: "Confirm that you verified this person's identity",
    });
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "own_account"));
    expect(await resetMfa(input)).toEqual({ message: "You cannot reset your own two-step verification." });
    rpcMock.mockResolvedValue(failure("CHARA_INVALID_INPUT", "user"));
    expect(await resetMfa(input)).toEqual({ errors: { userId: "No account has this user id" } });
  });

  it("publish a document and answer the version the database gave", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    const input = {
      expectedVersion: 2,
      slug: "privacy-policy",
      title: " Privacy policy ",
      body: "The text.",
      changeSummary: " Adds retention periods. ",
    };
    expect(await publishLegalDocument(input)).toEqual({ done: true, version: 3 });
    expect(rpcMock).toHaveBeenCalledWith("publish_legal_document", {
      p_slug: "privacy-policy",
      p_title: "Privacy policy",
      p_body: "The text.",
      p_change_summary: "Adds retention periods.",
      p_expected_version: 2,
    });
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/legal");
    expect((await publishLegalDocument({ ...input, slug: "Bad_Slug" })).errors?.slug).toBeDefined();
    expect((await publishLegalDocument({ ...input, expectedVersion: -1 })).errors).toBeDefined();
  });

  it("refuse a form that was submitted before, telling the person to open the document again", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_CONFLICT", "version"));
    const input = { expectedVersion: 2, slug: "privacy-policy", title: "Privacy policy", body: "The text.", changeSummary: "Adds retention periods." };
    expect(await publishLegalDocument(input)).toEqual({
      message: "This document has a different current version than the form showed. Open it from the list and try again.",
    });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe("an unlisted refusal", () => {
  beforeEach(() => requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["admin"] }));

  it("is logged with its code, and with its message only when the message is one of ours", async () => {
    const input = { userId: ID, role: "admin", reason: "Left the team, ticket 4813" };
    rpcMock.mockResolvedValue(failure("CHARA_UNLISTED"));
    expect(await revokeRole(input)).toEqual({ message: GENERIC });
    expect(console.error).toHaveBeenLastCalledWith("Administration action failed", { code: "P0001", message: "CHARA_UNLISTED" });
    rpcMock.mockResolvedValue(failure(`insert or update violates the key (user_id)=(${ID})`));
    expect(await revokeRole(input)).toEqual({ message: GENERIC });
    expect(console.error).toHaveBeenLastCalledWith("Administration action failed", { code: "P0001", message: undefined });
  });
});
