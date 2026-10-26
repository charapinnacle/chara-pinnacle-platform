import type { Metadata } from "next";
import { describe, expect, it } from "vitest";
import { countryInSentence } from "@/lib/i18n/format";
import { partnerProfileFrom, type PartnerProfile } from "@/lib/partners/profile";
import { robotsDisallow } from "@/lib/seo/private-routes";
import { partnerProfileMetadata } from "@/lib/seo/metadata";
import { sitemapEntries, vacancyCapacity } from "@/lib/seo/sitemap";

const SITE = "http://localhost:3100";

const row = {
  slug: "manila-skills",
  display_name: "Manila Skills",
  organization_type: "recruitment_company" as const,
  based_in_country: "PH",
  based_in_country_name: "Philippines",
  served_countries: [{ code: "DE", name: "Germany" }, { code: "NL", name: "Netherlands" }],
  source_countries: [{ code: "PH", name: "Philippines" }],
  industries: [{ code: "F", name: "Construction" }],
  occupations: [{ code: "7212", name: "Welders and flame cutters" }],
  languages: [],
  service_types: [],
  recruitment_type: "international" as const,
  workforce_size_band: "50_249" as const,
  founded_year: 2012,
  description: "We recruit skilled welders\n\nand electricians from the Philippines.",
  website: "https://manila-skills.example",
  commitment_current: true,
  workforce_profile_updated_at: "2026-10-20T08:00:00+00:00",
  listings: [
    {
      occupation_code: "7212",
      occupation: "Welders and flame cutters",
      source_country: "PH",
      source_country_name: "Philippines",
      available: 40,
      monthly_capacity: 15,
      available_from: "2026-11-09",
      confirmed_at: "2026-10-23T10:00:00+00:00",
    },
  ],
};

const profile: PartnerProfile = partnerProfileFrom(row);

const titleOf = (metadata: Metadata) => (metadata.title as { absolute: string }).absolute;

describe("partnerProfileFrom (FR-K4 AC3)", () => {
  it("maps the row of get_partner_profile to the profile the page shows", () => {
    expect(profile).toMatchObject({
      slug: "manila-skills",
      displayName: "Manila Skills",
      type: "recruitment_company",
      basedIn: { code: "PH", name: "Philippines" },
      foundedYear: 2012,
      commitmentCurrent: true,
      listings: [
        {
          occupation: "Welders and flame cutters",
          sourceCountry: "Philippines",
          available: 40,
          monthlyCapacity: 15,
          availableFrom: "2026-11-09",
          confirmedAt: "2026-10-23T10:00:00+00:00",
        },
      ],
    });
  });

  it("refuses a row whose lists do not have the expected shape", () => {
    expect(() => partnerProfileFrom({ ...row, served_countries: [{ code: "DE" }] })).toThrow();
    expect(() => partnerProfileFrom({ ...row, organization_type: "employer" })).toThrow();
  });
});

describe("partnerProfileMetadata (FR-K4 AC7)", () => {
  it("gives the title of the criterion, with the country's article", () => {
    expect(titleOf(partnerProfileMetadata("en", profile))).toBe("Manila Skills - Recruitment company in the Philippines | Chara Pinnacle");
    expect(titleOf(partnerProfileMetadata("en", { ...profile, type: "staffing_company", basedIn: { code: "IN", name: "India" } }))).toBe(
      "Manila Skills - Staffing company in India | Chara Pinnacle",
    );
  });

  it("cuts a long name before the product name, never the product name", () => {
    const title = titleOf(partnerProfileMetadata("en", { ...profile, displayName: "A".repeat(200) }));
    expect(title.endsWith(" | Chara Pinnacle")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(70 + " | Chara Pinnacle".length);
  });

  it("describes the partner from its own text in at most 160 characters", () => {
    const short = partnerProfileMetadata("en", profile);
    expect(short.description).toBe("We recruit skilled welders and electricians from the Philippines.");
    const long = partnerProfileMetadata("en", { ...profile, description: "word ".repeat(100) });
    expect(String(long.description).length).toBeLessThanOrEqual(160);
  });

  it("without a text of its own, describes it from its fields", () => {
    const metadata = partnerProfileMetadata("en", { ...profile, description: null });
    expect(metadata.description).toBe(
      "Manila Skills, recruitment company based in the Philippines, sources workers from the Philippines for employers in Germany, the Netherlands.",
    );
    const many = Array.from({ length: 40 }, (_, index) => ({ code: `C${index}`, name: `Country number ${index}` }));
    expect(String(partnerProfileMetadata("en", { ...profile, description: null, servedCountries: many }).description).length).toBeLessThanOrEqual(160);
  });

  it("names no verification and no platform figure", () => {
    const text = JSON.stringify(partnerProfileMetadata("en", { ...profile, description: null }));
    expect(text).not.toMatch(/verified|licensed|approved|rating|rank/i);
  });

  it("has the canonical address of the profile, without a query string", () => {
    expect(String(partnerProfileMetadata("en", profile).alternates?.canonical)).toBe(`${SITE}/en/partners/manila-skills`);
  });
});

describe("countryInSentence", () => {
  it("adds the article where English needs it", () => {
    expect(countryInSentence("PH", "Philippines")).toBe("the Philippines");
    expect(countryInSentence("NL", "Netherlands")).toBe("the Netherlands");
    expect(countryInSentence("DE", "Germany")).toBe("Germany");
  });
});

describe("the sitemap entries of the partner profiles (FR-K4 AC7)", () => {
  const partners = [
    { slug: "manila-skills", updatedAt: "2026-10-20T08:00:00+00:00" },
    { slug: "rival-staffing", updatedAt: "2026-09-01T23:59:59+00:00" },
  ];

  it("lists each given profile after the vacancies with the date of its last change", () => {
    const entries = sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs: [], vacancies: [], partners });
    expect(entries.slice(-2)).toEqual([
      { url: `${SITE}/en/partners/manila-skills`, lastModified: "2026-10-20" },
      { url: `${SITE}/en/partners/rival-staffing`, lastModified: "2026-09-01" },
    ]);
  });

  it("lists no profile when the database gives none (release off, or none listed)", () => {
    const entries = sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs: [], vacancies: [] });
    expect(entries.some((entry) => entry.url.includes("/partners/"))).toBe(false);
  });

  it("keeps the file under the limit of the protocol: the profiles fill what the vacancies leave", () => {
    const capacity = vacancyCapacity(0);
    const vacancies = Array.from({ length: capacity - 1 }, (_, index) => ({ id: `v${index}`, updatedAt: "2026-10-01T00:00:00Z" }));
    const entries = sitemapEntries({ siteUrl: SITE, lang: "en", legalSlugs: [], vacancies, partners });
    expect(entries).toHaveLength(50_000);
    expect(entries.at(-1)?.url).toBe(`${SITE}/en/partners/manila-skills`);
  });

  it("leaves the public profiles out of the robots disallow list", () => {
    expect(robotsDisallow.some((path) => "/en/partners/manila-skills".startsWith(path))).toBe(false);
  });
});
