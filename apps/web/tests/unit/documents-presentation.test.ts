import { describe, expect, it } from "vitest";
import {
  documentStatus,
  expiryLabel,
  formatFileSize,
  isAwaitingScan,
  isUsableScanStatus,
  reminderCutoff,
  shareWarning,
} from "@/lib/documents/presentation";

describe("expiryLabel", () => {
  const today = "2026-10-03";

  it.each([
    [null, null],
    ["2026-10-02", "Expired"],
    ["2026-10-03", "Expires today"],
    ["2026-10-04", "Expires in 1 day"],
    ["2026-10-23", "Expires in 20 days"],
    ["2026-11-02", "Expires in 30 days"],
    ["2026-11-03", null],
    ["2025-01-01", "Expired"],
    ["2031-01-01", null],
  ])("%s gives %s", (expiresOn, label) => {
    expect(expiryLabel(expiresOn, today)).toBe(label);
  });

  it("counts calendar days across a month and a year end", () => {
    expect(expiryLabel("2027-01-01", "2026-12-31")).toBe("Expires in 1 day");
    expect(expiryLabel("2026-03-01", "2026-02-28")).toBe("Expires in 1 day");
    expect(expiryLabel("2028-03-01", "2028-02-28")).toBe("Expires in 2 days");
  });
});

describe("reminderCutoff", () => {
  it("is 30 days after today, the last day that carries a label", () => {
    expect(reminderCutoff("2026-10-03")).toBe("2026-11-02");
    expect(expiryLabel(reminderCutoff("2026-10-03"), "2026-10-03")).toBe("Expires in 30 days");
    expect(reminderCutoff("2026-12-15")).toBe("2027-01-14");
  });
});

describe("formatFileSize", () => {
  it.each([
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [1_258_291, "1.2 MB"],
    [1_048_576, "1 MB"],
    [15_728_640, "15 MB"],
  ])("%i bytes read %s", (bytes, text) => {
    expect(formatFileSize(bytes)).toBe(text);
  });
});

describe("isUsableScanStatus", () => {
  it("accepts clean and skipped and nothing else", () => {
    expect(["clean", "skipped", "pending", "rejected", ""].map(isUsableScanStatus)).toEqual([true, true, false, false, false]);
  });
});

describe("documentStatus", () => {
  it("is Ready for a checked file and usable", () => {
    expect(documentStatus("skipped", false)).toEqual({ label: "Ready", usable: true });
    expect(documentStatus("clean", false)).toEqual({ label: "Ready", usable: true });
  });

  it("says why a rejected file is not usable", () => {
    expect(documentStatus("rejected", false)).toEqual({
      label: "File rejected: not a valid PDF, JPG or PNG",
      usable: false,
    });
  });

  it("tells a pending upload that is being checked from one that never finished", () => {
    expect(documentStatus("pending", true)).toEqual({ label: "Checking the file", usable: false });
    expect(documentStatus("pending", false)).toEqual({ label: "Upload not finished", usable: false });
    expect(documentStatus("unexpected", false).usable).toBe(false);
  });
});

describe("isAwaitingScan", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");

  it.each([
    ["pending", "2026-10-03T12:00:00Z", true],
    ["pending", "2026-10-03T11:55:01Z", true],
    ["pending", "2026-10-03T11:55:00Z", false],
    ["pending", "2026-10-02T12:00:00Z", false],
    ["skipped", "2026-10-03T11:59:00Z", false],
    ["rejected", "2026-10-03T11:59:00Z", false],
  ])("a %s row created %s is being checked: %s", (status, createdAt, expected) => {
    expect(isAwaitingScan(status, createdAt, now)).toBe(expected);
  });
});

describe("shareWarning", () => {
  it("says nothing for a document that no active share holds", () => {
    expect(shareWarning(0)).toBeNull();
  });

  it("says the share state is unknown when the count could not be read", () => {
    expect(shareWarning(null)).toBe(
      "We could not check whether this document is shared. If it is, deleting it ends the employers' access to all documents shared with it.",
    );
  });

  it("names the number of applications and that all documents shared in them lose access", () => {
    expect(shareWarning(1)).toBe(
      "This document is shared with 1 application. Deleting it ends the employers' access to all documents shared in it.",
    );
    expect(shareWarning(2)).toBe(
      "This document is shared with 2 applications. Deleting it ends the employers' access to all documents shared in them.",
    );
  });
});
