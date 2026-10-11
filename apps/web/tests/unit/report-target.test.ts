import { describe, expect, it } from "vitest";
import { contentPathFrom, vacancyIdFrom } from "@/lib/reports/target";

const ID = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

describe("vacancyIdFrom", () => {
  it("reads the id from the address of a vacancy page, with or without the host, the language, a query or a fragment", () => {
    for (const link of [
      `https://chara.example/en/jobs/${ID}`,
      `http://localhost:3100/en/jobs/${ID}?utm_source=mail#apply`,
      `/en/jobs/${ID}/`,
      `en/jobs/${ID}`,
      `  /de/jobs/${ID.toUpperCase()}  `,
    ]) {
      expect(vacancyIdFrom(link)).toBe(ID);
    }
  });

  it("takes the id of a vacancy from any page address that has one, because the database decides what is public", () => {
    expect(vacancyIdFrom(`/en/org/acme/jobs/${ID}`)).toBe(ID);
  });

  it("accepts the bare id, in any case", () => {
    expect(vacancyIdFrom(ID)).toBe(ID);
    expect(vacancyIdFrom(ID.toUpperCase())).toBe(ID);
  });

  it("gives null for anything that is not a vacancy", () => {
    for (const text of ["", "welder", "/en/jobs", `/en/jobs/${ID}x`, `/en/jobs/${ID.slice(1)}`, "javascript:alert(1)"]) {
      expect(vacancyIdFrom(text)).toBeNull();
    }
  });
});

describe("contentPathFrom", () => {
  it("keeps a path of the site and drops the query, the fragment and a trailing slash", () => {
    expect(contentPathFrom("/en/pricing")).toBe("/en/pricing");
    expect(contentPathFrom(" /en/jobs?q=welder#top ")).toBe("/en/jobs");
    expect(contentPathFrom("/en/legal/privacy-policy/")).toBe("/en/legal/privacy-policy");
  });

  it("takes the path of an address, whatever its host", () => {
    expect(contentPathFrom("https://chara.example/en/about?x=1")).toBe("/en/about");
    expect(contentPathFrom("http://localhost:3100/en/trust-safety")).toBe("/en/trust-safety");
  });

  it("gives null for a second slash at the start, a step up, a relative path, a long path and text that is no address", () => {
    for (const text of ["", "/", "en/jobs", "//evil.example/x", "/en/../admin", "/a b", `/${"a".repeat(256)}`, "not an address", "/en/<script>"]) {
      expect(contentPathFrom(text)).toBeNull();
    }
    expect(contentPathFrom(`/${"a".repeat(255)}`)).toBe(`/${"a".repeat(255)}`);
  });
});
