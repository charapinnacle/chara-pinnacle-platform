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
  const vacancyPage = `/en/jobs/${id}`;
  const login = (next: string) => `REDIRECT:/en/login?next=${encodeURIComponent(next)}`;

  it("counts the press and sends the visitor to log in with the apply form of the vacancy as the way back", async () => {
    await expect(requireLogin("apply", id, vacancyPage)).rejects.toThrow(login(`/en/jobs/${id}/apply`));
    expect(logMock).toHaveBeenCalledWith({ event: "vacancy_action", action: "apply", jobId: id, viewer: "visitor" });
  });

  it("sends Apply to the apply form whatever way back the page names", async () => {
    for (const next of ["https://evil.example/", "//evil.example", "/en/jobs?q=welder", ""]) {
      await expect(requireLogin("apply", id, next)).rejects.toThrow(login(`/en/jobs/${id}/apply`));
    }
  });

  it("counts a press of Save as such", async () => {
    await expect(requireLogin("save", id, vacancyPage)).rejects.toThrow("REDIRECT:/en/login?next=");
    expect(logMock).toHaveBeenCalledWith({ event: "vacancy_action", action: "save", jobId: id, viewer: "visitor" });
  });

  it("brings the visitor back to the page of search results the press was on, with its filters", async () => {
    const results = "/en/jobs?q=welder&country=DE";
    await expect(requireLogin("save", id, results)).rejects.toThrow(login(results));
    await expect(requireLogin("save", id, "/en/jobs")).rejects.toThrow(login("/en/jobs"));
  });

  it("brings the visitor to the vacancy page when the way back is anywhere else", async () => {
    for (const next of ["https://evil.example/", "//evil.example", "/en/jobs/other", "/en/jobsx", "/en/saved", "", "/en/jobs\\@evil"]) {
      await expect(requireLogin("save", id, next)).rejects.toThrow(login(vacancyPage));
    }
  });

  it("names the kind of account that pressed it", async () => {
    getCurrentUserMock.mockResolvedValue({ accountKind: "company" });
    await expect(requireLogin("apply", id, vacancyPage)).rejects.toThrow("REDIRECT:");
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ viewer: "company" }));
  });

  it("sends an id that is not a uuid to Find Jobs and counts nothing", async () => {
    await expect(requireLogin("apply", "not-an-id", vacancyPage)).rejects.toThrow("REDIRECT:/en/jobs");
    await expect(requireLogin("apply", "../../x", vacancyPage)).rejects.toThrow("REDIRECT:/en/jobs");
    expect(logMock).not.toHaveBeenCalled();
  });

  it("sends an action that is neither apply nor save to Find Jobs and counts nothing", async () => {
    for (const action of ["x", "", "APPLY", "a".repeat(10_000)]) {
      await expect(requireLogin(action as "apply", id, vacancyPage)).rejects.toThrow("REDIRECT:/en/jobs");
    }
    expect(logMock).not.toHaveBeenCalled();
  });
});
