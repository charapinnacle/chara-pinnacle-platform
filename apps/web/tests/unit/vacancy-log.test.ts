import { afterEach, describe, expect, it, vi } from "vitest";
import { logVacancy } from "@/lib/jobs/vacancy-log";
import { viewerOf } from "@/lib/jobs/viewer";

afterEach(() => vi.restoreAllMocks());

describe("logVacancy", () => {
  it("writes one JSON line to the standard output", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    logVacancy({ event: "vacancy_view", outcome: "ok", jobId: "j1", viewer: "visitor" });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('{"event":"vacancy_view","outcome":"ok","jobId":"j1","viewer":"visitor"}\n');
  });
});

describe("viewerOf", () => {
  it("is a visitor without a session or without a chosen kind of account, a candidate or a company", () => {
    expect(viewerOf(null)).toBe("visitor");
    expect(viewerOf({ accountKind: null })).toBe("visitor");
    expect(viewerOf({ accountKind: "worker" })).toBe("candidate");
    expect(viewerOf({ accountKind: "company" })).toBe("company");
  });
});
