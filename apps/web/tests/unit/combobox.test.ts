import { describe, expect, it } from "vitest";
import { COMBOBOX_LIMIT, listStart, matchOptions, moveActive, resultsAnnouncement } from "@/lib/combobox";

const countries = Array.from({ length: 255 }, (_, n) => ({ value: `C${n}`, label: `Country ${n}` }));
const occupations = [
  { value: "7212", label: "7212 · Welders and flame cutters", keywords: "mig mag welder" },
  { value: "7111", label: "7111 · House builders", keywords: "carpenter" },
];

describe("matchOptions", () => {
  it("lists at most the limit and reports how many match in all", () => {
    const { shown, total } = matchOptions(countries, "");
    expect(shown).toHaveLength(COMBOBOX_LIMIT);
    expect(shown[0].value).toBe("C0");
    expect(total).toBe(255);
  });

  it("filters the whole list, not the rows that are listed", () => {
    const { shown, total } = matchOptions(countries, "country 254");
    expect(shown.map(({ value }) => value)).toEqual(["C254"]);
    expect(total).toBe(1);
  });

  it("ignores case and surrounding spaces, and also searches the keywords", () => {
    expect(matchOptions(occupations, "  WELDER ").shown.map(({ value }) => value)).toEqual(["7212"]);
    expect(matchOptions(occupations, "house").shown.map(({ value }) => value)).toEqual(["7111"]);
    expect(matchOptions(occupations, "mag").total).toBe(1);
  });

  it("finds nothing for text that matches no option", () => {
    expect(matchOptions(occupations, "astronaut")).toEqual({ shown: [], total: 0 });
  });

  it("starts the list at a chosen option that lies beyond the limit, unless text is typed", () => {
    const { shown, total } = matchOptions(countries, "", 200);
    expect(shown).toHaveLength(COMBOBOX_LIMIT);
    expect(shown[0].value).toBe("C200");
    expect(total).toBe(255);
    expect(matchOptions(countries, "", 20).shown[0].value).toBe("C0");
    expect(matchOptions(countries, "", 250).shown).toHaveLength(COMBOBOX_LIMIT);
    expect(matchOptions(countries, "", 250).shown.map(({ value }) => value)).toContain("C250");
    expect(matchOptions(countries, "country 1", 200).shown[0].value).toBe("C1");
  });

  it("does not cut a list that is short enough", () => {
    expect(matchOptions(countries.slice(0, COMBOBOX_LIMIT), "")).toMatchObject({ total: COMBOBOX_LIMIT });
  });
});

describe("listStart", () => {
  it("starts at the top, at a chosen option beyond the limit, or as far down as still fills the list", () => {
    expect(listStart(255, -1)).toBe(0);
    expect(listStart(255, 49)).toBe(0);
    expect(listStart(255, 50)).toBe(50);
    expect(listStart(255, 254)).toBe(205);
  });
});

describe("moveActive", () => {
  it("moves one option and stops at the ends", () => {
    expect(moveActive("ArrowDown", -1, 3)).toBe(0);
    expect(moveActive("ArrowDown", 0, 3)).toBe(1);
    expect(moveActive("ArrowDown", 2, 3)).toBe(2);
    expect(moveActive("ArrowUp", 2, 3)).toBe(1);
    expect(moveActive("ArrowUp", 0, 3)).toBe(0);
  });

  it("jumps to the first and the last option", () => {
    expect(moveActive("Home", 2, 5)).toBe(0);
    expect(moveActive("End", 0, 5)).toBe(4);
  });

  it("has no active option in an empty list", () => {
    expect(moveActive("ArrowDown", 0, 0)).toBe(-1);
    expect(moveActive("End", -1, 0)).toBe(-1);
  });
});

describe("resultsAnnouncement", () => {
  it("counts the results and says so for one", () => {
    expect(resultsAnnouncement(matchOptions(occupations, ""), "No match")).toBe("2 results available");
    expect(resultsAnnouncement(matchOptions(occupations, "welder"), "No match")).toBe("1 result available");
  });

  it("says that the list is cut and asks to narrow it", () => {
    expect(resultsAnnouncement(matchOptions(countries, ""), "No match")).toBe(
      "255 results available, 50 are listed. Type to narrow the list.",
    );
  });

  it("gives the empty text when nothing matches", () => {
    expect(resultsAnnouncement(matchOptions(occupations, "zzz"), "No matching occupation")).toBe("No matching occupation");
  });
});
