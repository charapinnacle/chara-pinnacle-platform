import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const { publishingOrganization } = await import("@/lib/dal/organizations");

const organization = (
  slug: string,
  role: "owner" | "admin" | "member",
  suspended = false,
  type: "employer" | "recruitment_company" | "staffing_company" = "employer",
) => ({
  id: slug,
  slug,
  displayName: slug,
  type,
  role,
  suspended,
});

describe("publishingOrganization (FR-C1: who may publish a vacancy)", () => {
  it("is the first organization in which the user is an owner or an admin and which is not suspended", () => {
    const found = publishingOrganization([
      organization("member-of", "member"),
      organization("suspended", "owner", true),
      organization("admin-of", "admin"),
      organization("owner-of", "owner"),
    ]);
    expect(found?.slug).toBe("admin-of");
  });

  it("FR-J1: is never a partner organisation, which has no vacancies", () => {
    expect(
      publishingOrganization([
        organization("agency", "owner", false, "recruitment_company"),
        organization("staffing", "admin", false, "staffing_company"),
      ]),
    ).toBeUndefined();
    expect(
      publishingOrganization([organization("agency", "owner", false, "recruitment_company"), organization("employer", "admin")])?.slug,
    ).toBe("employer");
  });

  it("is nothing for a member, for a suspended organization and for no organization", () => {
    expect(publishingOrganization([organization("a", "member")])).toBeUndefined();
    expect(publishingOrganization([organization("a", "owner", true)])).toBeUndefined();
    expect(publishingOrganization([])).toBeUndefined();
  });
});
