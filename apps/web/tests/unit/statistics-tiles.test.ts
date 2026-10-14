import { describe, expect, it } from "vitest";
import { CREDIBLE_MINIMUM, statisticTiles } from "@/lib/statistics/tiles";

describe("the statistics tiles (FR-H4 AC12, D87)", () => {
  it("builds a tile for each value that is a number and none for the values the database holds back", () => {
    expect(statisticTiles({ active_jobs: 150, employers: null, workers: 1230, countries: null })).toEqual([
      { label: "Workers", value: "1,230" },
      { label: "Active jobs", value: "150" },
    ]);
  });

  it("lists the four tiles in the order workers, employers, active jobs, countries (the labels of the client's structure)", () => {
    expect(statisticTiles({ active_jobs: 150, employers: 120, workers: 3000, countries: 100 })).toEqual([
      { label: "Workers", value: "3,000" },
      { label: "Employers", value: "120" },
      { label: "Active jobs", value: "150" },
      { label: "Countries", value: "100" },
    ]);
  });

  it("builds no tile when every value is held back", () => {
    expect(statisticTiles({ active_jobs: null, employers: null, workers: null, countries: null })).toEqual([]);
  });

  it("puts a thousands separator from 1,000 upwards and none below", () => {
    const values = statisticTiles({ active_jobs: 999, employers: 1000, workers: 1234567, countries: 120 }).map((tile) => tile.value);
    expect(values).toEqual(["1,234,567", "1,000", "999", "120"]);
  });

  it("leaves out a value the database shows but that is below the credible minimum of 100, and keeps 100", () => {
    expect(CREDIBLE_MINIMUM).toBe(100);
    expect(statisticTiles({ active_jobs: 99, employers: 100, workers: 30, countries: 6 })).toEqual([{ label: "Employers", value: "100" }]);
    expect(statisticTiles({ active_jobs: 0, employers: 5, workers: 10, countries: 1 })).toEqual([]);
  });
});
