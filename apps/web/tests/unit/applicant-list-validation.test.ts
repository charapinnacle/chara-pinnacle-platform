import { describe, expect, it } from "vitest";
import { applicationStatusLabels, pipelineStages } from "@/lib/applications/presentation";
import { applicantsPath } from "@/lib/routes";
import { parseApplicantListParams } from "@/lib/validation/applicant-list";

const job = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

describe("parseApplicantListParams", () => {
  it("defaults to the list of every vacancy, newest first, every stage, the first page", () => {
    expect(parseApplicantListParams({})).toEqual({ job: null, view: "list", sort: "applied", dir: "desc", stage: null, page: 1 });
  });

  it("falls back to the defaults for values the page does not offer", () => {
    expect(parseApplicantListParams({ page: "0", sort: "password", dir: "sideways", stage: "hacked", job: "1; drop table", view: "grid" })).toEqual({
      job: null, view: "list", sort: "applied", dir: "desc", stage: null, page: 1,
    });
    expect(parseApplicantListParams({ page: ["2", "3"], sort: ["stage"], stage: ["applied"], job: [job] })).toMatchObject({
      page: 1, sort: "applied", stage: null, job: null,
    });
    expect(parseApplicantListParams({ page: "-3" }).page).toBe(1);
    expect(parseApplicantListParams({ page: "abc" }).page).toBe(1);
    expect(parseApplicantListParams({ page: "1000000" }).page).toBe(1);
  });

  it("keeps the values the page does offer", () => {
    expect(parseApplicantListParams({ job, view: "board", sort: "documents", dir: "asc", stage: "rejected", page: "9" })).toEqual({
      job, view: "board", sort: "documents", dir: "asc", stage: "rejected", page: 9,
    });
    for (const sort of ["applied", "stage", "completeness", "documents"]) expect(parseApplicantListParams({ job, sort }).sort).toBe(sort);
    for (const stage of pipelineStages) expect(parseApplicantListParams({ stage }).stage).toBe(stage);
  });

  it("accepts a page far past the last one, which the read answers with the last page", () => {
    expect(parseApplicantListParams({ page: "1000" }).page).toBe(1000);
    expect(parseApplicantListParams({ page: "999999" }).page).toBe(999999);
  });

  it("sorts all the vacancies by applied date or stage only, because the other sorts read every application", () => {
    expect(parseApplicantListParams({ sort: "stage", dir: "asc" })).toMatchObject({ sort: "stage", dir: "asc" });
    expect(parseApplicantListParams({ sort: "completeness", dir: "asc" })).toMatchObject({ sort: "applied", dir: "asc" });
    expect(parseApplicantListParams({ sort: "documents" }).sort).toBe("applied");
  });

  it("offers the board for one vacancy only", () => {
    expect(parseApplicantListParams({ view: "board" }).view).toBe("list");
    expect(parseApplicantListParams({ job: "not-a-uuid", view: "board" }).view).toBe("list");
    expect(parseApplicantListParams({ job, view: "board" }).view).toBe("board");
  });
});

describe("the pipeline order", () => {
  it("is the order of the enum, with a column for every label", () => {
    expect(pipelineStages).toEqual(["applied", "viewed", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"]);
    expect([...pipelineStages].sort()).toEqual(Object.keys(applicationStatusLabels).sort());
  });
});

describe("applicantsPath", () => {
  it("leaves out every value that is the default of the page", () => {
    expect(applicantsPath("en", "acme")).toBe("/en/org/acme/applicants");
    expect(applicantsPath("en", "acme", { job: null, view: "list", sort: "applied", dir: "desc", stage: null, page: 1 })).toBe("/en/org/acme/applicants");
  });

  it("writes the state of the page", () => {
    expect(applicantsPath("en", "acme", { job, view: "board" })).toBe(`/en/org/acme/applicants?job=${job}&view=board`);
    expect(applicantsPath("en", "acme", { job, sort: "stage", dir: "asc", stage: "shortlisted", page: 2 })).toBe(
      `/en/org/acme/applicants?job=${job}&sort=stage&dir=asc&stage=shortlisted&page=2`,
    );
    expect(applicantsPath("en", "acme", { sort: "applied", dir: "asc" })).toBe("/en/org/acme/applicants?sort=applied&dir=asc");
  });

  it("round-trips through the parser", () => {
    const params = { job, view: "list", sort: "completeness", dir: "asc", stage: "interview", page: 3 } as const;
    const query = Object.fromEntries(new URL(applicantsPath("en", "acme", params), "http://x").searchParams);
    expect(parseApplicantListParams(query)).toEqual(params);
  });
});
