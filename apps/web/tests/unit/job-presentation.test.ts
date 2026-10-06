import { describe, expect, it } from "vitest";
import { formatSalary, jobStatusText, publicWebsite } from "@/lib/jobs/presentation";

const none = { salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null };

describe("formatSalary", () => {
  it("shows a range with its currency and pay period", () => {
    expect(formatSalary({ salaryMin: 2800, salaryMax: 3400, salaryCurrency: "EUR", salaryPeriod: "month" })).toBe(
      "EUR 2,800 to 3,400, per month",
    );
  });

  it("shows equal amounts once, and one amount with from or up to", () => {
    expect(formatSalary({ salaryMin: 3000, salaryMax: 3000, salaryCurrency: "EUR", salaryPeriod: "year" })).toBe("EUR 3,000, per year");
    expect(formatSalary({ salaryMin: 12.5, salaryMax: null, salaryCurrency: "USD", salaryPeriod: "hour" })).toBe("From USD 12.5, per hour");
    expect(formatSalary({ salaryMin: null, salaryMax: 0, salaryCurrency: "USD", salaryPeriod: "hour" })).toBe("Up to USD 0, per hour");
  });

  it("shows nothing without an amount, or without a currency or period", () => {
    expect(formatSalary(none)).toBeNull();
    expect(formatSalary({ ...none, salaryMin: 100 })).toBeNull();
    expect(formatSalary({ ...none, salaryMin: 100, salaryCurrency: "EUR" })).toBeNull();
  });
});

describe("jobStatusText", () => {
  it("says a draft is not public", () => {
    expect(jobStatusText("draft", "visible")).toBe("Draft - not public");
  });

  it.each([
    ["open", "Open"],
    ["paused", "Paused - not public"],
    ["closed", "Closed - not public"],
    ["filled", "Filled - not public"],
  ] as const)("describes a visible %s vacancy", (status, text) => {
    expect(jobStatusText(status, "visible")).toBe(text);
  });

  it("says hidden for a vacancy hidden by moderation whatever its status", () => {
    expect(jobStatusText("open", "hidden")).toBe("Hidden - not public");
    expect(jobStatusText("open", "org_suspended")).toBe("Hidden - not public");
  });
});

describe("publicWebsite", () => {
  it("links an http or https address by its host", () => {
    expect(publicWebsite("https://acme.example/careers?x=1")).toEqual({
      href: "https://acme.example/careers?x=1",
      label: "acme.example",
    });
    expect(publicWebsite("http://acme.example")).toEqual({ href: "http://acme.example/", label: "acme.example" });
  });

  it("links nothing for another scheme, for text that is no address, or for no value", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,x", "ftp://acme.example", "acme.example", "  ", "", null]) {
      expect(publicWebsite(value), String(value)).toBeNull();
    }
  });
});
