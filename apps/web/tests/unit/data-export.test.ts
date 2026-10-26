import { describe, expect, it } from "vitest";
import {
  EXPORT_PENDING,
  exportStateLabels,
  exportStates,
  exportStateTones,
  formatSize,
  isExportState,
  requestRefusal,
} from "@/lib/data-export/presentation";
import { dataExportPath } from "@/lib/routes";

// FR-S3 AC8 (V29): the export page's states and messages.
describe("data export presentation", () => {
  it("names every state of list_my_data_exports in words and with a tone", () => {
    expect([...exportStates].sort()).toEqual(["expired", "failed", "preparing", "ready"]);
    for (const state of exportStates) {
      expect(exportStateLabels[state].length).toBeGreaterThan(3);
      expect(exportStateTones[state]).toBeDefined();
    }
    expect(isExportState("ready")).toBe(true);
    expect(isExportState("queued")).toBe(false);
    expect(isExportState("constructor")).toBe(false);
  });

  it("says that an export is already being prepared, or from when a new one is accepted", () => {
    expect(requestRefusal("export_pending", undefined)).toBe(EXPORT_PENDING);
    expect(EXPORT_PENDING).toMatch(/^An export is already being prepared/);
    expect(requestRefusal("export_recent", "2026-12-11 08:30:00+00")).toBe(
      "You can ask for a new export from 11 December 2026 at 08:30 UTC.",
    );
    expect(requestRefusal("export_recent", "not a time")).toBe("You asked for an export recently. Try again later.");
    expect(requestRefusal(undefined, undefined)).toBeNull();
    expect(requestRefusal("release_off", undefined)).toBeNull();
  });

  it("writes file sizes in bytes, KB and MB", () => {
    expect(formatSize(512)).toBe("512 bytes");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(5_400_000)).toBe("5.1 MB");
  });

  it("lives under the account settings", () => {
    expect(dataExportPath("en")).toBe("/en/settings/data-export");
  });
});
