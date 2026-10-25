import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const currentUserMock = vi.hoisted(() => vi.fn());
const previewMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser: currentUserMock, requireUser: currentUserMock }));
vi.mock("@/lib/dal/team", () => ({ getInvitationPreview: previewMock }));
vi.mock("@/lib/actions/team", () => ({ acceptInvitation: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const { default: InvitationPage } = await import("@/app/[lang]/(app)/invitations/[token]/page");
const { getPostJobHref } = await import("@/lib/dal/organizations");

const token = "A".repeat(43);
const company = { id: "user-1", email: "rita@example.test", accountKind: "company", suspended: false };

async function invitationPage(): Promise<string> {
  return renderToStaticMarkup(
    await InvitationPage({ params: Promise.resolve({ lang: "en", token }), searchParams: Promise.resolve({}) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  previewMock.mockResolvedValue({
    organizationName: "Acme Bau",
    role: "member",
    email: "rita@example.test",
    expiresAt: "2026-11-01T00:00:00Z",
  });
});

describe("the boundaries of a recruitment or staffing company account (FR-J1)", () => {
  it.each(["recruitment_company", "staffing_company"])(
    "the team invitation page refuses a %s account and offers no accept button",
    async (type) => {
      currentUserMock.mockResolvedValue({ ...company, intendedOrganizationType: type });
      const html = await invitationPage();
      expect(html).toContain("This invitation is for a different type of company account than yours.");
      expect(html).toContain('role="alert"');
      expect(html).not.toContain("Join Acme Bau");
      expect(html).not.toMatch(/<button/);
    },
  );

  it("the team invitation page still offers an employer account the invitation", async () => {
    currentUserMock.mockResolvedValue({ ...company, intendedOrganizationType: null });
    const html = await invitationPage();
    expect(html).toContain("Join Acme Bau");
    expect(html).not.toContain("different type of company account");
  });

  it("Post a job is not offered to a partner account", async () => {
    currentUserMock.mockResolvedValue({ ...company, intendedOrganizationType: "recruitment_company" });
    await expect(getPostJobHref("en")).resolves.toBeNull();
  });
});
