import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const logMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/jobs/vacancy-log", () => ({ logVacancy: logMock }));

const { requireLogin } = await import("@/lib/actions/vacancy");

const id = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(null);
});

describe("requireLogin", () => {
  it("counts the press and sends the visitor to log in with the vacancy page as the way back", async () => {
    await expect(requireLogin("apply", id)).rejects.toThrow(
      `REDIRECT:/en/login?next=${encodeURIComponent(`/en/jobs/${id}`)}`,
    );
    expect(logMock).toHaveBeenCalledWith({ event: "vacancy_action", action: "apply", jobId: id, viewer: "visitor" });
  });

  it("counts a press of Save as such", async () => {
    await expect(requireLogin("save", id)).rejects.toThrow("REDIRECT:/en/login?next=");
    expect(logMock).toHaveBeenCalledWith({ event: "vacancy_action", action: "save", jobId: id, viewer: "visitor" });
  });

  it("names the kind of account that pressed it", async () => {
    getCurrentUserMock.mockResolvedValue({ accountKind: "company" });
    await expect(requireLogin("apply", id)).rejects.toThrow("REDIRECT:");
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ viewer: "company" }));
  });

  it("sends an id that is not a uuid to Find Jobs and counts nothing", async () => {
    await expect(requireLogin("apply", "not-an-id")).rejects.toThrow("REDIRECT:/en/jobs");
    await expect(requireLogin("apply", "../../x")).rejects.toThrow("REDIRECT:/en/jobs");
    expect(logMock).not.toHaveBeenCalled();
  });
});
