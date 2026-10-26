import { describe, expect, it } from "vitest";
import { availableWorkforceSchema } from "@/lib/partners/available-workforce";

const valid = { occupation: "7212", destination: "de", workers: "100", within_days: "60" };

// FR-K3 AC9: the Available workforce form checks what search_available_workforce checks again.
describe("the available workforce form", () => {
  it("accepts an occupation, a destination, 1 to 100,000 workers and 1 to 365 days", () => {
    expect(availableWorkforceSchema.parse(valid)).toEqual({ occupation: "7212", destination: "DE", workers: "100", within_days: "60" });
    for (const [workers, within_days] of [["1", "1"], ["100000", "365"], [" 50 ", " 30 "]]) {
      expect(availableWorkforceSchema.safeParse({ ...valid, workers, within_days }).success).toBe(true);
    }
  });

  it("names each refused field", () => {
    const cases: [Partial<typeof valid>, string][] = [
      [{ occupation: "" }, "occupation"],
      [{ occupation: "721" }, "occupation"],
      [{ destination: "" }, "destination"],
      [{ destination: "deu" }, "destination"],
      [{ workers: "0" }, "workers"],
      [{ workers: "100001" }, "workers"],
      [{ workers: "12.5" }, "workers"],
      [{ within_days: "" }, "within_days"],
      [{ within_days: "366" }, "within_days"],
    ];
    for (const [change, field] of cases) {
      const result = availableWorkforceSchema.safeParse({ ...valid, ...change });
      expect(result.success, JSON.stringify(change)).toBe(false);
      expect([...new Set(result.error?.issues.map((issue) => issue.path[0]))]).toEqual([field]);
    }
  });
});
