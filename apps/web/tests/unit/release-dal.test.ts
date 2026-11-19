import { beforeEach, describe, expect, it, vi } from "vitest";

const getPublicSettings = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/settings", () => ({ getPublicSettings }));

const { isReleased, releasedSwitches } = await import("@/lib/dal/release");

beforeEach(() => {
  getPublicSettings.mockReset();
});

describe("the release switches (FR-L5 AC2, AC4)", () => {
  it("lists the switches that are true, in the order of DATA_MODEL.md, and counts a missing or other value as off", async () => {
    getPublicSettings.mockResolvedValue({
      release_find_workers: "true",
      release_partner_directories: "true",
      release_job_orders: "false",
      release_messaging: "yes",
      legal_entity_name: "true",
    });
    expect(await releasedSwitches()).toEqual(["release_partner_directories", "release_find_workers"]);
    expect(await isReleased("release_job_orders")).toBe(false);
    expect(await isReleased("release_candidate_submissions")).toBe(false);
  });

  it("counts every switch as off when the settings cannot be read, so a page that adapts to a release is still served", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new Error("permission denied");
    getPublicSettings.mockRejectedValue(failure);
    expect(await releasedSwitches()).toEqual([]);
    expect(logged).toHaveBeenCalledWith("The release switches could not be read", failure);
    await expect(isReleased("release_partner_directories")).rejects.toThrow("permission denied");
  });
});
