import { describe, expect, it, vi } from "vitest";
import { applicantsCsv, csvCell } from "@/lib/applicants/csv";
import type { ApplicantExportRow } from "@/lib/dal/applicant-list";

vi.mock("server-only", () => ({}));

const row = (over: Partial<ApplicantExportRow>): ApplicantExportRow => ({
  candidateName: "Ana Silva",
  status: "applied",
  appliedAt: "2026-09-04T23:30:00+00:00",
  completeness: 80,
  documents: 2,
  ...over,
});

describe("csvCell", () => {
  it.each(["=HYPERLINK('http://x')", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd"])("prefixes a single quote to a cell that starts with %j", (value) => {
    expect(csvCell(value).replace(/^"/, "")[0]).toBe("'");
  });

  it("quotes a cell with a comma, a double quote or a line break, doubling the quotes", () => {
    expect(csvCell("Smith, Jo")).toBe('"Smith, Jo"');
    expect(csvCell('Jo "JJ" Smith')).toBe('"Jo ""JJ"" Smith"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it("quotes a formula that also has a comma, quote first", () => {
    expect(csvCell("=A1,B1")).toBe(`"'=A1,B1"`);
  });

  it("leaves a plain cell as it is", () => {
    expect(csvCell("Ana Silva")).toBe("Ana Silva");
    expect(csvCell("80")).toBe("80");
    expect(csvCell("O'Brien = 1")).toBe("O'Brien = 1");
  });
});

describe("applicantsCsv", () => {
  it("writes the header of the list and one line per row, with the labels of the page and the UTC date", () => {
    const csv = applicantsCsv([row({}), row({ candidateName: "Ben Okoro", status: "rejected", appliedAt: "2026-09-03T00:00:00Z", completeness: 55, documents: 0 })]);
    expect(csv).toBe(
      "Candidate,Stage,Applied,Completeness (%),Documents\r\nAna Silva,Applied,2026-09-04,80,2\r\nBen Okoro,Not selected,2026-09-03,55,0\r\n",
    );
  });

  it("takes the date in UTC whatever the offset", () => {
    expect(applicantsCsv([row({ appliedAt: "2026-09-04T01:30:00+05:00" })])).toContain(",2026-09-03,");
  });

  it("names a candidate who was erased and writes the other columns as they are", () => {
    expect(applicantsCsv([row({ candidateName: null })])).toContain("\r\nFormer candidate,Applied,");
  });

  it("holds nothing but the five columns", () => {
    const [, line] = applicantsCsv([row({})]).split("\r\n");
    expect(line.split(",")).toHaveLength(5);
  });

  it("is the header alone for no row", () => {
    expect(applicantsCsv([])).toBe("Candidate,Stage,Applied,Completeness (%),Documents\r\n");
  });
});
