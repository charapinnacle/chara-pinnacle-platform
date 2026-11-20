import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkerCard, type CardNames } from "@/components/find-workers/worker-card";
import { experienceText, periodText, workerCardSchema, type WorkerCardData } from "@/lib/find-workers/card";

const NAMES: CardNames = {
  countries: { DE: "Germany", NG: "Nigeria", PL: "Poland" },
  occupations: { "7212": "Welders and flame cutters" },
  languages: { en: "English", de: "German" },
  industries: { C: "Manufacturing", F: "Construction" },
};

// A row of my_card_preview as PostgREST returns it, with the state columns the card schema ignores.
const ROW = {
  card_id: "8f1c3a52-27d4-4e57-9c0e-2a8f2d7c1b11",
  headline: "MIG/MAG welder, 6 years in shipyards",
  occupation_id: "7212",
  skills: ["MIG welding", "TIG welding"],
  years_experience: 6,
  languages: [
    { code: "de", level: "A2" },
    { code: "en", level: "B2" },
  ],
  availability: "from_date",
  available_from: "2027-03-01",
  current_country: "NG",
  preferred_countries: ["DE", "PL"],
  work_authorization_countries: ["PL"],
  training: null,
  employment_history: [
    { role: "Welder", country_code: "DE", from_month: "2020-01", to_month: "2022-06" },
    { role: "Fitter", country_code: "NG", from_month: "2022-07", to_month: null },
  ],
  preferred_industries: null,
  preferred_employment_types: null,
  updated_at: "2026-11-17T08:00:00+00:00",
  visible: true,
  opted_in: true,
};

const card = (over: Partial<WorkerCardData> = {}): WorkerCardData => ({ ...workerCardSchema.parse(ROW), ...over });

describe("the Find Workers card (FR-Q1)", () => {
  it("reads the card columns of a preview row and nothing else", () => {
    const parsed = workerCardSchema.parse({ ...ROW, first_name: "Amina", last_name: "Okafor", email: "amina@example.test" });
    expect(Object.keys(parsed).sort()).toEqual([
      "availability",
      "available_from",
      "card_id",
      "current_country",
      "employment_history",
      "headline",
      "languages",
      "occupation_id",
      "preferred_countries",
      "preferred_employment_types",
      "preferred_industries",
      "skills",
      "training",
      "updated_at",
      "work_authorization_countries",
      "years_experience",
    ]);
  });

  it("refuses an employment month that is not YYYY-MM", () => {
    expect(workerCardSchema.safeParse({ ...ROW, employment_history: [{ role: "Welder", country_code: "DE", from_month: "2020-01-01", to_month: null }] }).success).toBe(false);
  });

  it("says the years of experience and the months of a job in words", () => {
    expect(experienceText(null)).toBeNull();
    expect(experienceText(0)).toBe("No experience yet");
    expect(experienceText(1)).toBe("1 year of experience");
    expect(experienceText(6)).toBe("6 years of experience");
    expect(periodText("2020-01", "2022-06")).toBe("Jan 2020 to Jun 2022");
    expect(periodText("2022-07", null)).toBe("since Jul 2022");
  });

  it("shows the card fields with their names, and the optional sections only when the data carries them", () => {
    const html = renderToStaticMarkup(<WorkerCard card={card()} names={NAMES} />);
    expect(html).toContain("Welders and flame cutters");
    expect(html).toContain("MIG/MAG welder, 6 years in shipyards");
    expect(html).toContain("6 years of experience");
    expect(html).toContain("Available from 1 March 2027");
    expect(html).toContain("Nigeria");
    expect(html).toContain("German (A2), English (B2)");
    expect(html).toContain("Germany, Poland");
    expect(html).toContain("Welder in Germany, Jan 2020 to Jun 2022");
    expect(html).toContain("Fitter in Nigeria, since Jul 2022");
    expect(html).not.toContain("Training");
    expect(html).not.toContain("Preferred industries");

    const all = renderToStaticMarkup(
      <WorkerCard
        card={card({ training: [], employment_history: null, preferred_industries: ["C"], preferred_employment_types: ["seasonal"] })}
        names={NAMES}
      />,
    );
    expect(all).toContain("Training");
    expect(all).toContain("None added");
    expect(all).not.toContain("Employment history");
    expect(all).toContain("Manufacturing");
    expect(all).toContain("Seasonal");
  });

  it("is drawn by one component for the preview and the search, which has no field for a name, a contact or a document (NFR-S9)", () => {
    const source = readFileSync(path.join(import.meta.dirname, "../../components/find-workers/worker-card.tsx"), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(source).not.toMatch(/first_name|last_name|email|phone|photo|document|employer_name/);
  });
});
