import { describe, expect, it } from "vitest";
import { statisticTiles } from "@/lib/statistics/tiles";

describe("the statistics tiles (FR-H4 AC12)", () => {
  it("builds a tile for each value that is a number and none for the values the database holds back", () => {
    expect(statisticTiles({ active_jobs: 15, employers: null, workers: 1230, countries: null })).toEqual([
      { label: "Vacancies", value: "15" },
      { label: "Candidates", value: "1,230" },
    ]);
  });

  it("lists the four tiles in the order vacancies, employers, candidates, countries", () => {
    expect(statisticTiles({ active_jobs: 15, employers: 8, workers: 30, countries: 6 })).toEqual([
      { label: "Vacancies", value: "15" },
      { label: "Employers", value: "8" },
      { label: "Candidates", value: "30" },
      { label: "Countries", value: "6" },
    ]);
  });

  it("builds no tile when every value is held back", () => {
    expect(statisticTiles({ active_jobs: null, employers: null, workers: null, countries: null })).toEqual([]);
  });

  it("puts a thousands separator from 1,000 upwards and none below", () => {
    const values = statisticTiles({ active_jobs: 999, employers: 1000, workers: 1234567, countries: 12 }).map((tile) => tile.value);
    expect(values).toEqual(["999", "1,000", "1,234,567", "12"]);
  });

  it("keeps a value of 0 as a tile, so that only the database decides what is hidden", () => {
    expect(statisticTiles({ active_jobs: 0, employers: null, workers: null, countries: null })).toEqual([{ label: "Vacancies", value: "0" }]);
  });
});
