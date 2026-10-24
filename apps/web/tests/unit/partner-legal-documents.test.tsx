import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImmigrationNotice } from "@/components/public/immigration-notice";
import { IMMIGRATION_DISCLAIMER_PATH, legalSlugs, partnerLegalGroups, partnerLegalSlugs } from "@/lib/public/navigation";

vi.mock("server-only", () => ({}));

const PARTNER_SLUGS = [
  "partner-terms",
  "recruitment-company-terms",
  "staffing-company-terms",
  "employer-pays-commitment",
  "partner-dpa",
  "worker-visibility-consent",
  "immigration-disclaimer",
];

const repoFile = (name: string) => readFileSync(path.join(import.meta.dirname, "../../../../", name), "utf8");

// The block of placeholder rows, from the first values row to the column list of the insert.
function partnerRows(sql: string): string {
  const start = sql.indexOf("('partner-terms'");
  const end = sql.indexOf(") as d (slug, title, scope)", start);
  expect(start, "the partner rows are missing").toBeGreaterThan(-1);
  return sql.slice(sql.lastIndexOf("insert into public.legal_documents", start), end);
}

describe("the partner legal documents (FR-S4)", () => {
  it("are the seven slugs of the data model, in two groups of at most four, apart from the Phase 1 pages", () => {
    expect([...partnerLegalSlugs].sort()).toEqual([...PARTNER_SLUGS].sort());
    expect(partnerLegalGroups.map(({ title }) => title)).toEqual(["Partner network", "Partner data and notices"]);
    expect(Math.max(...partnerLegalGroups.map(({ links }) => links.length))).toBeLessThanOrEqual(4);
    expect(partnerLegalSlugs.filter((slug) => legalSlugs.includes(slug))).toEqual([]);
    expect(IMMIGRATION_DISCLAIMER_PATH).toBe("legal/immigration-disclaimer");
  });

  it("are seeded locally and inserted on the hosted project with the same draft rows", () => {
    const seed = partnerRows(repoFile("supabase/seeds/ref/legal_documents.sql"));
    const migration = partnerRows(repoFile("supabase/migrations/20261116100000_partner_legal_documents.sql"));
    expect(migration).toBe(seed);
    for (const slug of PARTNER_SLUGS) expect(seed).toContain(`('${slug}'`);
    expect(seed).toContain("'DRAFT: ' || d.title");
    expect(seed).toContain("This text has not been approved and must not be relied on.");
  });
});

describe("the immigration notice (FR-S4 AC10)", () => {
  it("says that no immigration, visa or legal advice is given and links to the disclaimer, asking for nothing", () => {
    const html = renderToStaticMarkup(<ImmigrationNotice lang="de" />);
    expect(html).toContain("Chara Pinnacle gives no immigration, visa or legal advice.");
    expect(html).toContain('href="/de/legal/immigration-disclaimer"');
    expect(html).toContain('role="note"');
    expect(html).not.toMatch(/<input|<button|checkbox/);
  });
});
