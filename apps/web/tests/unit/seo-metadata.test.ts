import { describe, expect, it } from "vitest";
import { legalSlugs } from "@/lib/public/navigation";
import { legalPageMetadata, staticPageMetadata, vacancyMetadata } from "@/lib/seo/metadata";
import { staticPages, type StaticPageKey } from "@/lib/seo/pages";

const SITE = "http://localhost:3100";
const keys = Object.keys(staticPages) as StaticPageKey[];

const titleOf = (metadata: { title?: unknown }) => String(metadata.title);
const canonicalOf = (metadata: { alternates?: { canonical?: unknown } | null }) => String(metadata.alternates?.canonical);

describe("the metadata of the static pages (FR-H5 AC1)", () => {
  it("has a title of at most 60 characters and a description of 50 to 160 on each of the eight pages", () => {
    expect(keys).toHaveLength(8);
    for (const key of keys) {
      const { title, description } = staticPageMetadata(key, "en");
      expect(titleOf({ title }).length, key).toBeGreaterThan(0);
      expect(titleOf({ title }).length, key).toBeLessThanOrEqual(60);
      expect(String(description).length, key).toBeGreaterThanOrEqual(50);
      expect(String(description).length, key).toBeLessThanOrEqual(160);
    }
  });

  it("has a different description and a different title on each page", () => {
    const metadata = keys.map((key) => staticPageMetadata(key, "en"));
    expect(new Set(metadata.map((entry) => entry.description)).size).toBe(keys.length);
    expect(new Set(metadata.map((entry) => entry.title)).size).toBe(keys.length);
  });

  it("has an absolute canonical address on the site, without a query string, of the page itself", () => {
    expect(keys.map((key) => canonicalOf(staticPageMetadata(key, "en")))).toEqual([
      `${SITE}/en`,
      `${SITE}/en/jobs`,
      `${SITE}/en/pricing`,
      `${SITE}/en/how-it-works`,
      `${SITE}/en/trust-safety`,
      `${SITE}/en/about`,
      `${SITE}/en/contact`,
      `${SITE}/en/imprint`,
    ]);
  });

  it("repeats the title and the description in the Open Graph tags", () => {
    for (const key of keys) {
      const { title, description, openGraph } = staticPageMetadata(key, "en");
      expect(openGraph?.title, key).toBe(title);
      expect(openGraph?.description, key).toBe(description);
    }
  });
});

describe("the metadata of the legal pages (FR-H5 AC1)", () => {
  const document = (title: string) => ({ title, version: 3, publishedAt: "2026-10-06T10:00:00Z" });

  it("takes the title from the current version and a description that holds the title, the version and the date", () => {
    const metadata = legalPageMetadata("en", "terms-of-service", document("Terms of Service"));
    expect(metadata.title).toBe("Terms of Service — CHARA");
    expect(metadata.description).toBe("Read the Terms of Service of CHARA: version 3, published 6 October 2026.");
    expect(canonicalOf(metadata)).toBe(`${SITE}/en/legal/terms-of-service`);
    expect(metadata.openGraph?.title).toBe(metadata.title);
    expect(metadata.openGraph?.description).toBe(metadata.description);
  });

  it("gives each of the legal pages a description of 50 to 160 characters that no other has", () => {
    const titles = legalSlugs.map((slug) =>
      slug
        .split("-")
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(" "),
    );
    const metadata = legalSlugs.map((slug, index) => legalPageMetadata("en", slug, document(titles[index])));
    expect(metadata).toHaveLength(10);
    for (const entry of metadata) {
      expect(String(entry.description).length).toBeGreaterThanOrEqual(50);
      expect(String(entry.description).length).toBeLessThanOrEqual(160);
    }
    expect(new Set(metadata.map((entry) => entry.description)).size).toBe(10);
  });

  it("cuts a title and a description of a very long document title to the limits", () => {
    const metadata = legalPageMetadata("en", "long", document("A".repeat(200)));
    expect(titleOf(metadata).length).toBe(60);
    expect(String(metadata.description).length).toBe(160);
  });
});

describe("the metadata of a vacancy (FR-H5 AC2)", () => {
  const job = (overrides: { title?: string; description?: string; displayName?: string } = {}) => ({
    id: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11",
    title: overrides.title ?? "Warehouse Operator",
    description: overrides.description ?? "x".repeat(400),
    employer: { displayName: overrides.displayName ?? "Example Logistics", country: "Germany", industry: null, website: null },
  });

  it("names the vacancy and the employer, and has the canonical address of the vacancy without a query string", () => {
    const metadata = vacancyMetadata("en", job());
    expect(metadata.title).toBe("Warehouse Operator - Example Logistics | CHARA");
    expect(canonicalOf(metadata)).toBe(`${SITE}/en/jobs/6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11`);
    expect(metadata.openGraph?.title).toBe(metadata.title);
    expect(metadata.openGraph?.description).toBe(metadata.description);
  });

  it("cuts the title to 60 characters when it is longer, and keeps the one that fits", () => {
    const long = vacancyMetadata("en", job({ title: "Senior Warehouse Operator and Forklift Driver", displayName: "Example Logistics and Freight" }));
    expect(titleOf(long)).toHaveLength(60);
    expect(titleOf(long).endsWith("…")).toBe(true);
    expect(titleOf(long).startsWith("Senior Warehouse Operator and Forklift Driver - Example")).toBe(true);
  });

  it("does not leave half of a surrogate pair at the end of a cut title", () => {
    const emoji = vacancyMetadata("en", job({ title: `${"a".repeat(40)}${"😀".repeat(10)}` }));
    expect(titleOf(emoji).length).toBeLessThanOrEqual(60);
    expect(titleOf(emoji)).not.toMatch(/[\ud800-\udbff]…$/);
  });

  it("makes the description the first 155 characters of the text", () => {
    const text = `${"a".repeat(100)}${"b".repeat(100)}${"c".repeat(200)}`;
    expect(vacancyMetadata("en", job({ description: text })).description).toBe(text.slice(0, 155));
  });

  it("turns line breaks and runs of spaces into single spaces before it counts", () => {
    const metadata = vacancyMetadata("en", job({ description: "Line one.\n\nLine   two.\n" + "y".repeat(300) }));
    expect(String(metadata.description).startsWith("Line one. Line two. yyy")).toBe(true);
    expect(String(metadata.description)).toHaveLength(155);
  });

  it("keeps a short description whole and treats markup as text", () => {
    expect(vacancyMetadata("en", job({ description: "Drive a forklift <b>safely</b> in our hall." })).description).toBe(
      "Drive a forklift <b>safely</b> in our hall.",
    );
  });
});
