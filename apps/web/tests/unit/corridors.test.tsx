import type { Metadata } from "next";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Corridor, CorridorList, Network } from "@/lib/dal/corridors";

const rpcMock = vi.hoisted(() => vi.fn());
const isReleased = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("not-found");
  }),
);
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, permanentRedirect: redirectMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { getCorridor, getNetwork, listCorridors } = await import("@/lib/dal/corridors");
const presentation = await import("@/lib/corridors/presentation");
const { CorridorList: CorridorListView } = await import("@/components/corridors/corridor-list");
const { CorridorView } = await import("@/components/corridors/corridor-view");
const { NetworkView } = await import("@/components/corridors/network-view");
const { corridorPageMetadata, corridorsPageMetadata, networkPageMetadata } = await import("@/lib/seo/metadata");
const { default: CorridorsPage } = await import("@/app/[lang]/(public)/corridors/page");
const { default: CorridorPage } = await import("@/app/[lang]/(public)/corridors/[corridor]/page");
const { default: NetworkPage } = await import("@/app/[lang]/(public)/network/[destination]/page");

const textOf = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const phDe = {
  source_country: "PH",
  source_name: "Philippines",
  destination_country: "DE",
  destination_name: "Germany",
  recruitment_partners: 6,
  staffing_partners: null,
  workers_available: "100–249",
};
const plDe = { ...phDe, source_country: "PL", source_name: "Poland", recruitment_partners: null, staffing_partners: 5, workers_available: null };
const list: CorridorList = { min_count: 5, workforce_requires_sign_in: false, refreshed_at: "2026-11-28T10:30:00+00:00", corridors: [phDe, plDe] };
const corridor: Corridor = {
  ...phDe,
  listed: true,
  min_count: 5,
  workforce_requires_sign_in: false,
  refreshed_at: "2026-11-28T10:30:00+00:00",
  industries: [
    { code: "C", name: "Manufacturing" },
    { code: "F", name: "Construction" },
  ],
};
const suppressed: Corridor = {
  ...corridor,
  source_country: "RO",
  source_name: "Romania",
  listed: false,
  recruitment_partners: null,
  staffing_partners: null,
  workers_available: null,
  industries: [],
};
const network: Network = {
  destination_country: "DE",
  destination_name: "Germany",
  min_count: 5,
  workforce_requires_sign_in: false,
  refreshed_at: "2026-11-28T10:30:00+00:00",
  industries: [
    {
      code: "C",
      name: "Manufacturing",
      recruitment_partners: 6,
      staffing_partners: 9,
      workers_available: "100–249",
      occupations: [
        {
          code: "7212",
          label: "Welders and flame cutters",
          recruitment_partners: 6,
          staffing_partners: 9,
          workers_available: "100–249",
          recruitment_sources: [{ code: "PH", name: "Philippines", partners: 6 }],
          staffing_bases: [],
        },
      ],
    },
  ],
};

const corridorProps = (corridor: string) => ({ params: Promise.resolve({ lang: "en", corridor }), searchParams: Promise.resolve({}) });
const networkProps = (destination: string) => ({ params: Promise.resolve({ lang: "en", destination }), searchParams: Promise.resolve({}) });
const titleOf = (metadata: Metadata) => (metadata.title as { absolute: string }).absolute;

async function render(node: React.ReactNode): Promise<string> {
  const { prelude } = await prerender(node);
  return new Response(prelude).text();
}

beforeEach(() => {
  vi.clearAllMocks();
  isReleased.mockResolvedValue(true);
});

describe("the corridor addresses and texts", () => {
  it("reads a corridor as two different country codes, lower case being the canonical address", () => {
    expect(presentation.parseCorridorSlug("ph-de")).toEqual({ source: "PH", destination: "DE", canonical: true });
    expect(presentation.parseCorridorSlug("PH-DE")).toEqual({ source: "PH", destination: "DE", canonical: false });
    for (const slug of ["de-de", "ph", "phl-de", "ph_de", "ph-de-x", ""]) expect(presentation.parseCorridorSlug(slug), slug).toBeNull();
    expect(presentation.parseNetworkSlug("de")).toEqual({ destination: "DE", canonical: true });
    expect(presentation.parseNetworkSlug("DE")).toEqual({ destination: "DE", canonical: false });
    expect(presentation.parseNetworkSlug("germany")).toBeNull();
    expect(presentation.corridorPath("en", "PH", "DE")).toBe("/en/corridors/ph-de");
    expect(presentation.networkPath("en", "DE")).toBe("/en/network/de");
  });

  it("says fewer than k for a count the database held back, never a number, and the workforce only as a range", () => {
    expect(presentation.countText(null, 5)).toBe("Fewer than 5");
    expect(presentation.countText(1250, 5)).toBe("1,250");
    expect(presentation.workforceText(null)).toBe("Not shown yet");
    expect(presentation.workforceText("100–249")).toBe("100–249");
  });

  it("pre-filters the recruitment directory by destination and source, the staffing directory by destination (it has no source filter)", () => {
    expect(presentation.corridorDirectoryPaths("en", "PH", "DE")).toEqual({
      recruitment: "/en/partners/recruitment?destination=DE&sources_from=PH",
      staffing: "/en/partners/staffing?destination=DE",
    });
  });

  it("keeps the two filters of the index when they are country codes and ignores anything else", () => {
    expect(presentation.parseCorridorFilters({ source: "ph", destination: ["DE", "NL"] })).toEqual({ source: "PH", destination: "DE" });
    expect(presentation.parseCorridorFilters({ source: "Philippines", destination: "" })).toEqual({ source: undefined, destination: undefined });
  });
});

describe("the corridor reads", () => {
  it("parse the answer of each function", async () => {
    rpcMock.mockResolvedValueOnce({ data: list, error: null });
    await expect(listCorridors()).resolves.toEqual(list);
    expect(rpcMock).toHaveBeenLastCalledWith("list_corridors");
    rpcMock.mockResolvedValueOnce({ data: corridor, error: null });
    await expect(getCorridor("PH", "DE")).resolves.toEqual(corridor);
    expect(rpcMock).toHaveBeenLastCalledWith("get_corridor", { p_source: "PH", p_destination: "DE" });
    rpcMock.mockResolvedValueOnce({ data: network, error: null });
    await expect(getNetwork("DE")).resolves.toEqual(network);
    expect(rpcMock).toHaveBeenLastCalledWith("get_network", { p_destination: "DE" });
  });

  it("answer null for CHARA_NOT_FOUND (release off, not a corridor) and throw on any other error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0002", message: "CHARA_NOT_FOUND" } });
    await expect(listCorridors()).resolves.toBeNull();
    await expect(getCorridor("ZZ", "DE")).resolves.toBeNull();
    await expect(getNetwork("ZZ")).resolves.toBeNull();
    rpcMock.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    await expect(listCorridors()).rejects.toThrow("The workforce corridors could not be loaded");
    await expect(getCorridor("PH", "DE")).rejects.toThrow("The workforce corridor could not be loaded");
    await expect(getNetwork("DE")).rejects.toThrow("The network could not be loaded");
  });

  it("refuse an exact workforce number, so a change of the function cannot put one on the page", async () => {
    rpcMock.mockResolvedValueOnce({ data: { ...list, corridors: [{ ...phDe, workers_available: 120 }] }, error: null });
    await expect(listCorridors()).rejects.toThrow();
  });
});

describe("the corridor index", () => {
  it("lists each corridor as a card with its countries, counts and range, and filters by destination and source", () => {
    const text = textOf(renderToStaticMarkup(<CorridorListView lang="en" list={list} filters={{}} />));
    expect(text).toContain("Philippines → to Germany");
    expect(text).toContain("Workers available 100–249 Recruitment partners 6 Staffing partners Fewer than 5");
    expect(text).toContain("Poland → to Germany Workers available Not shown yet Recruitment partners Fewer than 5 Staffing partners 5");
    const filtered = renderToStaticMarkup(<CorridorListView lang="en" list={list} filters={{ source: "PL", destination: "DE" }} />);
    expect(textOf(filtered)).not.toContain("Philippines → to Germany");
    expect(filtered).toContain('href="/en/network/de"');
    expect(filtered).toContain('href="/en/corridors/pl-de"');
  });

  it("offers as filter options only the countries of the listed corridors", () => {
    const markup = renderToStaticMarkup(<CorridorListView lang="en" list={list} filters={{}} />);
    expect(markup).toContain('<option value="PH">Philippines</option>');
    expect(markup).toContain('<option value="PL">Poland</option>');
    expect(markup).toContain('<option value="DE">Germany</option>');
    expect(markup).not.toContain('<option value="FR">');
  });

  it("shows an empty state when nothing is listed, or nothing matches", () => {
    expect(textOf(renderToStaticMarkup(<CorridorListView lang="en" list={{ ...list, corridors: [] }} filters={{}} />))).toContain(
      "No corridors to show yet A corridor is shown once 5 or more listed partners work in it.",
    );
    expect(textOf(renderToStaticMarkup(<CorridorListView lang="en" list={list} filters={{ source: "NP" }} />))).toContain(
      "No corridors match these countries",
    );
  });

  it("is not found while release_corridors is off, and reads nothing then", async () => {
    isReleased.mockResolvedValue(false);
    await expect(CorridorsPage({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("renders the listed corridors and the rule of the threshold when released", async () => {
    rpcMock.mockResolvedValueOnce({ data: list, error: null });
    const text = textOf(await render(await CorridorsPage({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve({}) })));
    expect(text).toContain("Workforce corridors");
    expect(text).toContain("A corridor is listed once 5 or more partners work in it.");
  });
});

describe("a corridor page", () => {
  it("shows the four figures of the brief and the links into the pre-filtered directories with the immigration notice", () => {
    const markup = renderToStaticMarkup(<CorridorView lang="en" corridor={corridor} directories />);
    const text = textOf(markup);
    expect(text).toContain("Workers available 100–249 Recruitment partners 6 Staffing partners Fewer than 5");
    expect(text).toContain("Industries Manufacturing, Construction");
    expect(markup).toContain('href="/en/partners/recruitment?destination=DE&amp;sources_from=PH"');
    expect(markup).toContain('href="/en/partners/staffing?destination=DE"');
    expect(markup).toContain('href="/en/legal/immigration-disclaimer"');
    expect(markup).toContain('href="/en/network/de"');
  });

  it("shows no figure and no industry for a corridor below the threshold, and no directory link while release 2a is off", () => {
    const markup = renderToStaticMarkup(<CorridorView lang="en" corridor={suppressed} directories={false} />);
    expect(textOf(markup)).toContain("Fewer than 5 listed partners work in this corridor, so its figures are not shown yet.");
    expect(textOf(markup)).not.toContain("Industries");
    expect(markup).not.toContain("/partners/");
    expect(markup).not.toContain("immigration-disclaimer");
  });

  it("redirects the upper-case address, and is not found for a non-corridor or while the release is off", async () => {
    rpcMock.mockResolvedValue({ data: corridor, error: null });
    await expect(CorridorPage(corridorProps("PH-DE"))).rejects.toThrow("redirect:/en/corridors/ph-de");
    await expect(CorridorPage(corridorProps("de-de"))).rejects.toThrow("not-found");
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0002", message: "CHARA_NOT_FOUND" } });
    await expect(CorridorPage(corridorProps("zz-de"))).rejects.toThrow("not-found");
    isReleased.mockResolvedValue(false);
    await expect(CorridorPage(corridorProps("ph-de"))).rejects.toThrow("not-found");
  });

  it("keeps a corridor below the threshold out of the index of search engines", () => {
    expect(titleOf(corridorPageMetadata("en", corridor))).toBe("Philippines to Germany workforce corridor — Chara Pinnacle");
    expect(corridorPageMetadata("en", corridor).robots).toBeUndefined();
    expect(corridorPageMetadata("en", suppressed).robots).toEqual({ index: false, follow: true });
    expect(corridorPageMetadata("en", corridor).description).toContain("from the Philippines for employers in Germany");
    expect(corridorsPageMetadata("en").alternates?.canonical).toMatch(/\/en\/corridors$/);
  });
});

describe("the workers available for a visitor (OPEN_QUESTIONS.md P26)", () => {
  const visitorList: CorridorList = { ...list, workforce_requires_sign_in: true, corridors: list.corridors.map((row) => ({ ...row, workers_available: null })) };

  it("offers a sign-in link that returns to the page in place of the range, and keeps the partner counts public", () => {
    const index = renderToStaticMarkup(<CorridorListView lang="en" list={visitorList} filters={{}} />);
    expect(textOf(index)).toContain("Workers available Sign in to see available workers Recruitment partners 6");
    expect(index).toContain(`href="/en/login?next=${encodeURIComponent("/en/corridors")}"`);
    expect(textOf(index)).not.toContain("100–249");

    const page = renderToStaticMarkup(
      <CorridorView lang="en" corridor={{ ...corridor, workforce_requires_sign_in: true, workers_available: null }} directories />,
    );
    expect(textOf(page)).toContain("Sign in to see available workers");
    expect(textOf(page)).toContain("Industries Manufacturing, Construction");
    expect(page).toContain(`href="/en/login?next=${encodeURIComponent("/en/corridors/ph-de")}"`);

    const visitorNetwork: Network = {
      ...network,
      workforce_requires_sign_in: true,
      industries: network.industries.map((industry) => ({
        ...industry,
        workers_available: null,
        occupations: industry.occupations.map((occupation) => ({ ...occupation, workers_available: null })),
      })),
    };
    const networkMarkup = renderToStaticMarkup(<NetworkView lang="en" network={visitorNetwork} directories />);
    expect(networkMarkup.match(/Sign in to see available workers/g)).toHaveLength(2);
    expect(networkMarkup).toContain(`href="/en/login?next=${encodeURIComponent("/en/network/de")}"`);
  });

  it("shows a signed-in user the range and no sign-in link", () => {
    const index = renderToStaticMarkup(<CorridorListView lang="en" list={list} filters={{}} />);
    expect(index).not.toContain("Sign in to see available workers");
    expect(textOf(index)).toContain("Workers available 100–249");
  });
});

describe("the network page", () => {
  it("shows per industry and occupation the recruitment network by source country, the staffing network and the workers available", () => {
    const text = textOf(renderToStaticMarkup(<NetworkView lang="en" network={network} directories />));
    expect(text).toContain("Workforce network for Germany");
    expect(text).toContain("Manufacturing Workers available 100–249 Recruitment partners 6 Staffing partners 9");
    expect(text).toContain("Welders and flame cutters");
    expect(text).toContain("Recruitment companies by the country they source workers from Philippines: 6 companies");
    expect(text).toContain("Staffing companies by the country they are based in No country with 5 or more companies yet");
    expect(text).toContain("An interactive map of the network comes later.");
  });

  it("shows an empty state for a destination without a network", () => {
    const text = textOf(renderToStaticMarkup(<NetworkView lang="en" network={{ ...network, industries: [] }} directories={false} />));
    expect(text).toContain("No network to show for Germany yet");
  });

  it("redirects the upper-case address and is not found for a code that is not a country", async () => {
    rpcMock.mockResolvedValue({ data: network, error: null });
    await expect(NetworkPage(networkProps("DE"))).rejects.toThrow("redirect:/en/network/de");
    await expect(NetworkPage(networkProps("deu"))).rejects.toThrow("not-found");
    expect(titleOf(networkPageMetadata("en", network))).toBe("Workforce network for Germany — Chara Pinnacle");
  });
});
