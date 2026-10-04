import { describe, expect, it } from "vitest";
import {
  inviteFormSchema,
  inviteInputSchema,
  invitationTokenSchema,
  memberLimitMessage,
  roleChangeSchema,
  transferFormSchema,
} from "@/lib/validation/team";

describe("inviteFormSchema", () => {
  it("trims and lower-cases the address and accepts the two invitable roles", () => {
    expect(inviteFormSchema.parse({ email: "  Bea@Example.COM ", role: "member" })).toEqual({
      email: "bea@example.com",
      role: "member",
    });
    expect(inviteFormSchema.parse({ email: "bea@example.com", role: "admin" }).role).toBe("admin");
  });

  it("refuses the owner role, an unknown role and a missing role: ownership moves only by transfer", () => {
    for (const role of ["owner", "superuser", "", undefined]) {
      const result = inviteFormSchema.safeParse({ email: "bea@example.com", role });
      expect(result.success, String(role)).toBe(false);
    }
  });

  it("names the field of an invalid address and refuses one of 255 characters", () => {
    const missingAt = inviteFormSchema.safeParse({ email: "not-an-email", role: "member" });
    expect(missingAt.error?.issues[0]).toMatchObject({ path: ["email"], message: "Enter a valid email address." });
    const local = "a".repeat(254 - "@example.com".length);
    expect(inviteFormSchema.safeParse({ email: `${local}@example.com`, role: "member" }).success).toBe(true);
    expect(inviteFormSchema.safeParse({ email: `a${local}@example.com`, role: "member" }).success).toBe(false);
  });

  it("needs a well-formed organization slug in the action input", () => {
    const base = { email: "bea@example.com", role: "member" };
    expect(inviteInputSchema.safeParse({ ...base, slug: "acme-bau" }).success).toBe(true);
    for (const slug of ["Acme", "-acme", "acme--bau", "", "a".repeat(61), "../x"]) {
      expect(inviteInputSchema.safeParse({ ...base, slug }).success, slug).toBe(false);
    }
  });
});

describe("invitationTokenSchema", () => {
  it("accepts 43 base64url characters, as 32 random bytes encode, and nothing else", () => {
    expect(invitationTokenSchema.safeParse("Ab-_".repeat(10) + "Ab3").success).toBe(true);
    for (const token of ["", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}=`, `${"A".repeat(42)}/`, undefined]) {
      expect(invitationTokenSchema.safeParse(token).success, String(token)).toBe(false);
    }
  });
});

describe("role change and transfer inputs", () => {
  const userId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

  it("allows admin and member as the new role and never owner", () => {
    expect(roleChangeSchema.safeParse({ slug: "acme", userId, role: "admin" }).success).toBe(true);
    expect(roleChangeSchema.safeParse({ slug: "acme", userId, role: "owner" }).success).toBe(false);
    expect(roleChangeSchema.safeParse({ slug: "acme", userId: "x", role: "admin" }).success).toBe(false);
  });

  it("asks for a new owner before anything is sent", () => {
    expect(transferFormSchema.safeParse({ userId: "" }).error?.issues[0].message).toBe("Choose who becomes the owner.");
    expect(transferFormSchema.safeParse({ userId }).success).toBe(true);
  });
});

describe("memberLimitMessage", () => {
  it("names the limit with the right number form, and says so when the limit is unknown", () => {
    expect(memberLimitMessage(1)).toBe("Your plan allows 1 team member. Upgrade to invite more.");
    expect(memberLimitMessage(5)).toBe("Your plan allows 5 team members. Upgrade to invite more.");
    expect(memberLimitMessage(null)).toBe("Your plan's team-member limit is reached. Upgrade to invite more.");
  });
});
