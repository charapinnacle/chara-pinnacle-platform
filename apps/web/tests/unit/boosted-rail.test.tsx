import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoostedPartner } from "@/lib/dal/boosts";

const boostedMock = vi.hoisted(() => vi.fn());
const countriesMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/boosts", () => ({ getBoostedPartners: boostedMock }));
vi.mock("@/lib/dal/reference", () => ({ getCountries: countriesMock }));

const { BoostedRail } = await import("@/components/boosts/boosted-rail");
const { railNote } = await import("@/lib/boosts/presentation");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const partner = (over: Partial<BoostedPartner>): BoostedPartner => ({
  id: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11",
  slug: "manila-welders",
  displayName: "Manila Welders",
  basedInCountry: "PH",
  servedCountries: [{ code: "DE", name: "Germany" }],
  mainOccupations: [{ code: "7212", name: "Welders and flame cutters" }],
  staffingTypes: [],
  ...over,
});

async function render(kind: "recruitment" | "staffing" = "recruitment") {
  return renderToStaticMarkup(await BoostedRail({ lang: "en", kind, filters: { occupation: "7212", limit: 20 } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  countriesMock.mockResolvedValue([{ code: "PH", name: "Philippines" }]);
});

describe("the Boosted rail of a directory (ARCHITECTURE.md section 10.5)", () => {
  it("is a region of its own with the paid placement line, and labels every card Boosted", async () => {
    boostedMock.mockResolvedValue([
      partner({}),
      partner({ id: "7a0b6a53-2d2c-4a43-9b3b-0f5a3f4a1e12", slug: "cebu-crew", displayName: "Cebu Crew" }),
    ]);
    const html = await render();
    expect(boostedMock).toHaveBeenCalledWith("recruitment", { occupation: "7212", limit: 20 });
    expect(html).toContain('<section aria-labelledby="boosted-heading"');
    expect(text(html)).toContain(`Boosted companies ${railNote}`);
    expect(railNote).toBe(
      "Paid placement. Boosted companies that match your search appear here, apart from the results; paying never changes the order of the results.",
    );
    expect(html.match(/>Boosted<\/span>/g)).toHaveLength(2);
    expect(html).toContain('href="/en/partners/manila-welders"');
    expect(text(html)).toContain("Based in Philippines");
    expect(text(html)).toContain("Recruits for Germany");
    expect(text(html)).toContain("Occupations: Welders and flame cutters");
  });

  it("names the staffing types on a staffing card", async () => {
    boostedMock.mockResolvedValue([partner({ staffingTypes: ["temporary", "staffing"] })]);
    const html = text(await render("staffing"));
    expect(html).toContain("Markets served: Germany");
    expect(html).toContain("Staffing types: Temporary");
  });

  it("shows nothing when no boosted company matches, and nothing when the boosts cannot be read", async () => {
    boostedMock.mockResolvedValue([]);
    expect(await render()).toBe("");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    boostedMock.mockRejectedValue(new Error("unavailable"));
    expect(await render()).toBe("");
    expect(logged).toHaveBeenCalledOnce();
  });

  it("never reads or shows a trust signal: the rail imports no verification code and says nothing about verification", async () => {
    const source = readFileSync(new URL("../../components/boosts/boosted-rail.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/verif|badge\/verified|VerifiedBadge/i);
    boostedMock.mockResolvedValue([partner({})]);
    expect(await render()).not.toMatch(/verified/i);
  });
});
