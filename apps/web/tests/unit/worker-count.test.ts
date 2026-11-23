import { describe, expect, it } from "vitest";
import { workerCount } from "@/lib/i18n/format";

describe("a number of workers", () => {
  it("formats the company's own exact count and keeps a range from the database as it is", () => {
    expect(workerCount(1200)).toBe("1,200");
    expect(workerCount(0)).toBe("0");
    expect(workerCount("10–24")).toBe("10–24");
    expect(workerCount("250+")).toBe("250+");
  });
});
