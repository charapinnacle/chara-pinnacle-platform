import { describe, expect, it } from "vitest";
import { applicationsPath, dashboardSegments, homePath, isDashboardSegment, jobsPath, mfaPath } from "@/lib/routes";

describe("homePath", () => {
  it("sends each account kind to its own dashboard", () => {
    expect(homePath("en", "worker")).toBe("/en/dashboard/worker");
    expect(homePath("en", "company")).toBe("/en/dashboard/employer");
  });

  it("keeps an account whose kind is not committed on onboarding", () => {
    expect(homePath("en", null)).toBe("/en/onboarding");
  });
});

describe("dashboard segments", () => {
  it("maps each URL segment to its account kind", () => {
    expect(dashboardSegments).toEqual({ worker: "worker", employer: "company" });
  });

  it("accepts only its own segments", () => {
    expect(isDashboardSegment("worker")).toBe(true);
    expect(isDashboardSegment("employer")).toBe(true);
    expect(isDashboardSegment("company")).toBe(false);
    expect(isDashboardSegment("constructor")).toBe(false);
  });
});

describe("mfaPath", () => {
  it("is the MFA page, with the page to return to when there is one", () => {
    expect(mfaPath("en")).toBe("/en/mfa");
    expect(mfaPath("en", "/")).toBe("/en/mfa");
    expect(mfaPath("en", "/en/org/acme-bau/billing?tab=a&b=c")).toBe(
      `/en/mfa?next=${encodeURIComponent("/en/org/acme-bau/billing?tab=a&b=c")}`,
    );
  });
});

describe("applicationsPath", () => {
  it("is the plain address for the first page of every stage", () => {
    expect(applicationsPath("en")).toBe("/en/applications");
    expect(applicationsPath("en", { stage: null, page: 1 })).toBe("/en/applications");
  });

  it("carries the stage and the page from the second on", () => {
    expect(applicationsPath("en", { stage: "interview" })).toBe("/en/applications?stage=interview");
    expect(applicationsPath("en", { page: 2 })).toBe("/en/applications?page=2");
    expect(applicationsPath("en", { stage: "rejected", page: 3 })).toBe("/en/applications?stage=rejected&page=3");
  });
});

describe("jobsPath", () => {
  it("is the plain address without a filter", () => {
    expect(jobsPath("en", "acme")).toBe("/en/org/acme/jobs");
    expect(jobsPath("en", "acme", { status: null })).toBe("/en/org/acme/jobs");
  });

  it("carries the status and the cursor, encoded", () => {
    expect(jobsPath("en", "acme", { status: "open" })).toBe("/en/org/acme/jobs?status=open");
    expect(jobsPath("en", "acme", { status: "open", after: "2026-10-06T10:00:00.000000+00:00|id" })).toBe(
      "/en/org/acme/jobs?status=open&after=2026-10-06T10%3A00%3A00.000000%2B00%3A00%7Cid",
    );
  });
});
