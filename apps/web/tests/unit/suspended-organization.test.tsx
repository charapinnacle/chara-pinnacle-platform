import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

const releasedMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));

const { SuspendedOrganization } = await import("@/components/layout/suspended-organization");

async function html(): Promise<string> {
  const { prelude } = await prerender(<SuspendedOrganization title="Vacancies" subject="vacancies" />);
  return (await new Response(prelude).text()).replaceAll("<!-- -->", "");
}

beforeEach(() => vi.clearAllMocks());

// FR-S1 AC12: the pages of a suspended organisation lead to the decision and its appeal once release 2a is on.
describe("the page of a suspended organisation", () => {
  it("links to the decision and appeal while release 2a is on", async () => {
    releasedMock.mockResolvedValue(true);
    const page = await html();
    expect(page).toContain("This organization is suspended, so its vacancies are not available.");
    expect(page).toContain('href="/en/appeals"');
    expect(page).toContain("See the decision and appeal");
    expect(releasedMock).toHaveBeenCalledWith("release_partner_directories");
  });

  it("stays as in Phase 1 before it", async () => {
    releasedMock.mockResolvedValue(false);
    const page = await html();
    expect(page).toContain("This organization is suspended");
    expect(page).not.toContain("/en/appeals");
  });
});
