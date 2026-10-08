import { beforeEach, describe, expect, it, vi } from "vitest";
import { pipelineStages } from "@/lib/applications/presentation";

type Result = { data: unknown; error: unknown; count?: number | null };

let tableResults: Result[] = [];
let rpcResults: Record<string, Result> = {};
const calls: [string, unknown[]][] = [];
const rpcCalls: unknown[][] = [];
const logMock = vi.hoisted(() => vi.fn());

function builder(): unknown {
  const self: unknown = new Proxy(
    {},
    {
      get: (_target, name: string) =>
        name === "then"
          ? (resolve: (value: Result) => void) => resolve(tableResults.shift() ?? { data: [], error: null, count: 0 })
          : (...args: unknown[]) => {
              calls.push([name, args]);
              return self;
            },
    },
  );
  return self;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboard/load-log", () => ({ logDashboardLoad: logMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      calls.push(["from", [table]]);
      return builder();
    },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return Promise.resolve(rpcResults[name] ?? { data: [], error: null });
    },
  }),
}));

const { startDashboardLoad } = await import("@/lib/dal/dashboard");

const applicationsOf = (org: string) => startDashboardLoad(org).applications;
const vacanciesOf = (org: string) => startDashboardLoad(org).vacancies;
const planOf = (org: string) => startDashboardLoad(org).plan;

const org = "0a1b2c3d-0000-4000-8000-0000000000aa";
const planRow = {
  plan_name: "Basic",
  status: "trialing",
  trial_ends_at: "2026-12-01T10:00:00+00:00",
  current_period_end: null,
  past_due_since: null,
  subscription_ended: false,
};
const named = (name: string) => calls.filter(([call]) => call === name).map(([, args]) => args);

beforeEach(() => {
  calls.length = 0;
  rpcCalls.length = 0;
  tableResults = [];
  rpcResults = {};
  logMock.mockClear();
});

describe("getDashboardApplications", () => {
  it("asks for the organization, fills the stages without a row with 0 and adds up the totals", async () => {
    rpcResults.get_dashboard_applications = {
      data: [
        { status: "applied", total: 3, recent: 2 },
        { status: "hired", total: 1, recent: 0 },
        { status: "withdrawn", total: 1, recent: 1 },
      ],
      error: null,
    };
    const result = await applicationsOf(org);
    expect(rpcCalls).toContainEqual(["get_dashboard_applications", { p_organization_id: org }]);
    expect(result.byStage).toEqual({
      applied: 3, viewed: 0, shortlisted: 0, interview: 0, offer: 0, hired: 1, rejected: 0, withdrawn: 1,
    });
    expect(Object.keys(result.byStage)).toEqual([...pipelineStages]);
    expect(result.total).toBe(5);
    expect(result.recent).toBe(3);
  });

  it("gives zeros for an organization without applications", async () => {
    const result = await applicationsOf(org);
    expect(result.total).toBe(0);
    expect(result.recent).toBe(0);
    expect(Object.values(result.byStage)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("fails with a message that holds no detail when the read fails", async () => {
    rpcResults.get_dashboard_applications = { data: null, error: { message: "secret detail" } };
    await expect(applicationsOf(org)).rejects.toThrow("The applications could not be counted");
  });
});

describe("getVacancySummary", () => {
  it("counts the open vacancies that are not deleted and checks for any vacancy that is not deleted", async () => {
    tableResults = [{ data: null, error: null, count: 2 }, { data: [{ id: "a" }], error: null }];
    await expect(vacanciesOf(org)).resolves.toEqual({ open: 2, any: true });
    expect(named("eq")).toContainEqual(["status", "open"]);
    expect(named("eq")).toContainEqual(["organization_id", org]);
    expect(named("is")).toEqual([["deleted_at", null], ["deleted_at", null]]);
    expect(named("select")).toContainEqual(["id", { count: "exact", head: true }]);
    expect(named("limit")).toEqual([[1]]);
  });

  it("says there is no vacancy for an empty organization", async () => {
    tableResults = [{ data: null, error: null, count: 0 }, { data: [], error: null }];
    await expect(vacanciesOf(org)).resolves.toEqual({ open: 0, any: false });
  });

  it("fails when either read fails or the count is missing", async () => {
    tableResults = [{ data: null, error: { message: "x" }, count: null }, { data: [], error: null }];
    await expect(vacanciesOf(org)).rejects.toThrow("The vacancies could not be counted");
    tableResults = [{ data: null, error: null, count: 1 }, { data: null, error: { message: "x" } }];
    await expect(vacanciesOf(org)).rejects.toThrow("The vacancies could not be counted");
    tableResults = [{ data: null, error: null, count: null }, { data: [], error: null }];
    await expect(vacanciesOf(org)).rejects.toThrow("The vacancies could not be counted");
  });
});

describe("getDashboardPlan", () => {
  it("turns the dates into dates and keeps the missing ones missing", async () => {
    rpcResults.get_dashboard_plan = { data: [planRow], error: null };
    await expect(planOf(org)).resolves.toEqual({
      planName: "Basic",
      status: "trialing",
      trialEndsAt: new Date("2026-12-01T10:00:00Z"),
      currentPeriodEnd: null,
      pastDueSince: null,
      subscriptionEnded: false,
    });
    expect(rpcCalls).toContainEqual(["get_dashboard_plan", { p_organization_id: org }]);
  });

  it("refuses a status it does not know, a missing row and an error", async () => {
    rpcResults.get_dashboard_plan = { data: [{ ...planRow, status: "paused" }], error: null };
    await expect(planOf(org)).rejects.toThrow();
    rpcResults.get_dashboard_plan = { data: [], error: null };
    await expect(planOf(org)).rejects.toThrow();
    rpcResults.get_dashboard_plan = { data: null, error: { message: "CHARA_FORBIDDEN" } };
    await expect(planOf(org)).rejects.toThrow("The plan could not be loaded");
  });
});

describe("startDashboardLoad", () => {
  it("logs one line with the outcome ok when every read is done", async () => {
    rpcResults.get_dashboard_plan = { data: [planRow], error: null };
    tableResults = [{ data: null, error: null, count: 0 }, { data: [], error: null }];
    const load = startDashboardLoad(org);
    await Promise.all([load.applications, load.vacancies, load.plan]);
    await vi.waitFor(() => expect(logMock).toHaveBeenCalledTimes(1));
    expect(logMock).toHaveBeenCalledWith(expect.any(Number), "ok");
  });

  it("logs the outcome error when one read fails, and the others still resolve", async () => {
    rpcResults.get_dashboard_plan = { data: null, error: { message: "x" } };
    tableResults = [{ data: null, error: null, count: 1 }, { data: [{ id: "a" }], error: null }];
    const load = startDashboardLoad(org);
    await expect(load.vacancies).resolves.toEqual({ open: 1, any: true });
    await expect(load.applications).resolves.toMatchObject({ total: 0 });
    await expect(load.plan).rejects.toThrow();
    await vi.waitFor(() => expect(logMock).toHaveBeenCalledWith(expect.any(Number), "error"));
    expect(logMock).toHaveBeenCalledTimes(1);
  });

  it("says the organization is empty only with no vacancy and no application, and not empty when a read fails", async () => {
    tableResults = [{ data: null, error: null, count: 0 }, { data: [], error: null }];
    await expect(startDashboardLoad(org).empty).resolves.toBe(true);

    rpcResults.get_dashboard_applications = { data: [{ status: "applied", total: 1, recent: 0 }], error: null };
    tableResults = [{ data: null, error: null, count: 0 }, { data: [], error: null }];
    await expect(startDashboardLoad(org).empty).resolves.toBe(false);

    rpcResults = {};
    tableResults = [{ data: null, error: null, count: 0 }, { data: [{ id: "a" }], error: null }];
    await expect(startDashboardLoad(org).empty).resolves.toBe(false);

    rpcResults.get_dashboard_applications = { data: null, error: { message: "x" } };
    tableResults = [{ data: null, error: null, count: 0 }, { data: [], error: null }];
    await expect(startDashboardLoad(org).empty).resolves.toBe(false);
  });
});
