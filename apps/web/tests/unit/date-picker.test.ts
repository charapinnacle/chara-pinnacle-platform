import { describe, expect, it } from "vitest";
import { addDays, addMonths, isoDate, monthGrid, parseIsoDate, todayIso } from "@/lib/date-picker";

describe("the calendar arithmetic of the date picker", () => {
  it("reads only real ISO dates", () => {
    expect(parseIsoDate("2027-03-12")).toEqual({ y: 2027, m: 3, d: 12 });
    expect(parseIsoDate("2027-02-29")).toBeNull();
    expect(parseIsoDate("2028-02-29")).toEqual({ y: 2028, m: 2, d: 29 });
    expect(parseIsoDate("12/03/2027")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
  });

  it("moves across months and years, keeping the day or the month's last day", () => {
    expect(isoDate(addDays({ y: 2026, m: 12, d: 31 }, 1))).toBe("2027-01-01");
    expect(isoDate(addDays({ y: 2027, m: 3, d: 1 }, -1))).toBe("2027-02-28");
    expect(isoDate(addMonths({ y: 2027, m: 1, d: 31 }, 1))).toBe("2027-02-28");
    expect(isoDate(addMonths({ y: 2027, m: 1, d: 15 }, -1))).toBe("2026-12-15");
  });

  it("lays a month out in weeks from Monday", () => {
    const march = monthGrid(2027, 3);
    expect(march[0][0]).toEqual({ y: 2027, m: 3, d: 1 });
    expect(march.flat().filter(Boolean)).toHaveLength(31);
    const november = monthGrid(2026, 11);
    expect(november[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(november[0][6]).toEqual({ y: 2026, m: 11, d: 1 });
  });

  it("takes today from the local calendar", () => {
    expect(todayIso(new Date(2026, 10, 22, 23, 30))).toBe("2026-11-22");
  });
});
