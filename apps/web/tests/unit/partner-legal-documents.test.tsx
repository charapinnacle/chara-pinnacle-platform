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

describe("the acceptance counts of the administration page (FR-S4 AC11)", () => {
  it("name each audience and filter the partner network documents", async () => {
    const { acceptanceLine, inLegalDocumentGroup, legalDocumentGroup } = await import("@/lib/admin/legal-acceptance");
    expect(acceptanceLine({ audience: "recruitment_company", accepted: 3, total: 4 })).toBe("Recruitment companies: 3 of 4");
    expect(acceptanceLine({ audience: "org:staffing_company", accepted: 1, total: 2 })).toBe("Staffing company organisations: 1 of 2");
    expect(acceptanceLine({ audience: "worker", accepted: 0, total: 0 })).toBe("Workers: 0 of 0");
    expect(legalDocumentGroup("partner")).toBe("partner");
    expect(legalDocumentGroup(["partner"])).toBe("all");
    expect(legalDocumentGroup(undefined)).toBe("all");
    expect(PARTNER_SLUGS.every((slug) => inLegalDocumentGroup(slug, "partner"))).toBe(true);
    expect(inLegalDocumentGroup("privacy-policy", "partner")).toBe(false);
    expect(inLegalDocumentGroup("privacy-policy", "all")).toBe(true);
  });
});
