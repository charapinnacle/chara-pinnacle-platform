import { beforeEach, describe, expect, it, vi } from "vitest";
import { openStages } from "@/lib/applications/stage-machine";
import { stageTotals, sumOf } from "@/lib/dashboard/stage-counts";
import { formatCount, formatRelative } from "@/lib/i18n/format";
import { lastThirtyDays } from "@/lib/validation/admin";

type Result = { data: unknown; error: unknown; count?: number | null };

const rpcResults = vi.hoisted(() => ({ value: {} as Record<string, Result> }));
const tableResult = vi.hoisted(() => ({ value: { data: null, error: null, count: 0 } as Result }));
const calls = vi.hoisted(() => [] as unknown[][]);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({ serverEnv: () => ({ TRUSTED_PROXY_HOPS: 1 }) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args?: unknown) => {
      calls.push(["rpc", name, args]);
      return Promise.resolve(rpcResults.value[name] ?? { data: [], error: null });
    },
    from: (table: string) => ({
      select: (columns: string, options: unknown) => {
        calls.push(["select", table, columns, options]);
        return Promise.resolve(tableResult.value);
      },
    }),
  }),
}));

const { getFirstSteps } = await import("@/lib/dal/dashboard");
const { getMyStageCounts, getRecentApplications } = await import("@/lib/dal/applications");
const { countSavedJobs } = await import("@/lib/dal/saved-jobs");
const { moderationCounts, staffCount } = await import("@/lib/dal/admin-overview");

const ORG = "0a1b2c3d-0000-4000-8000-0000000000aa";

beforeEach(() => {
  rpcResults.value = {};
  tableResult.value = { data: null, error: null, count: 0 };
  calls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("the stage counts of a dashboard", () => {
  it("gives every stage of the pipeline, a stage the rows do not name as 0, and sums any set of stages", () => {
    const totals = stageTotals([
      { status: "interview", total: 2 },
      { status: "applied", total: 3 },
      { status: "withdrawn", total: 1 },
    ]);
    expect(totals).toEqual({ applied: 3, viewed: 0, shortlisted: 0, interview: 2, offer: 0, hired: 0, rejected: 0, withdrawn: 1 });
    expect(sumOf(totals)).toBe(6);
    expect(sumOf(totals, openStages)).toBe(5);
    expect(openStages).toEqual(["applied", "viewed", "shortlisted", "interview", "offer"]);
  });
});

describe("the relative time beside a date (UX-03)", () => {
  const now = new Date("2026-10-10T12:00:00.000Z");
  it.each([
    ["2026-10-10T11:59:30.000Z", "just now"],
    ["2026-10-10T11:55:00.000Z", "5 minutes ago"],
    ["2026-10-10T09:00:00.000Z", "3 hours ago"],
    ["2026-10-09T12:00:00.000Z", "yesterday"],
    ["2026-10-07T12:00:00.000Z", "3 days ago"],
    ["2026-09-26T12:00:00.000Z", "2 weeks ago"],
    ["2026-07-10T12:00:00.000Z", "3 months ago"],
    ["2025-09-10T12:00:00.000Z", "last year"],
    ["2026-10-12T12:00:00.000Z", "in 2 days"],
  ])("%s is %s", (iso, text) => {
    expect(formatRelative(iso, now)).toBe(text);
  });
});

describe("a figure of a dashboard", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [45210, "45,210"],
    [1234567, "1,234,567"],
  ])("%d is shown as %s", (count, text) => {
    expect(formatCount(count)).toBe(text);
  });
});

describe("the range of the console statistics", () => {
  it("is the last 30 UTC days, today included", () => {
    expect(lastThirtyDays(new Date("2026-10-10T23:30:00.000Z"))).toEqual({ from: "2026-09-11", to: "2026-10-10" });
    expect(lastThirtyDays(new Date("2026-03-01T00:10:00.000Z"))).toEqual({ from: "2026-01-31", to: "2026-03-01" });
  });
});

describe("the first steps of an organisation (UX-04)", () => {
  it("maps the three facts of the function", async () => {
    rpcResults.value.get_dashboard_first_steps = { data: [{ vacancy_published: true, team_invited: false, plan_chosen: true }], error: null };
    await expect(getFirstSteps(ORG)).resolves.toEqual({ vacancyPublished: true, teamInvited: false, planChosen: true });
    expect(calls).toContainEqual(["rpc", "get_dashboard_first_steps", { p_organization_id: ORG }]);
  });

  it("treats no row (not a member) as nothing done, and a failed read as an error that names no detail", async () => {
    await expect(getFirstSteps(ORG)).resolves.toEqual({ vacancyPublished: false, teamInvited: false, planChosen: false });
    rpcResults.value.get_dashboard_first_steps = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(getFirstSteps(ORG)).rejects.toThrow("The first steps could not be loaded");
  });
});

describe("the reads of the candidate dashboard (UX-03)", () => {
  it("asks for the three latest applications and maps them as the list does", async () => {
    rpcResults.value.my_applications = {
      data: [
        {
          id: "a1",
          job_title: "Welder",
          employer_display_name: "Acme Bau",
          status: "interview",
          applied_at: "2026-10-01T10:00:00+00:00",
          last_event_at: "2026-10-09T10:00:00+00:00",
          job_status: "open",
          moderation_state: "visible",
        },
      ],
      error: null,
    };
    await expect(getRecentApplications()).resolves.toEqual([
      { id: "a1", jobTitle: "Welder", employerName: "Acme Bau", status: "interview", appliedAt: "2026-10-01T10:00:00+00:00", lastEventAt: "2026-10-09T10:00:00+00:00" },
    ]);
    expect(calls).toContainEqual(["rpc", "my_applications", { p_limit: 3 }]);
  });

  it("zero-fills the stage counts and fails without leaking the database error", async () => {
    rpcResults.value.my_application_stage_counts = { data: [{ status: "applied", total: 4 }], error: null };
    const totals = await getMyStageCounts();
    expect(totals.applied).toBe(4);
    expect(sumOf(totals)).toBe(4);
    rpcResults.value.my_application_stage_counts = { data: null, error: { message: "CHARA_FORBIDDEN" } };
    await expect(getMyStageCounts()).rejects.toThrow("The applications could not be counted");
  });

  it("counts the saved vacancies with a head request, and refuses a missing count", async () => {
    tableResult.value = { data: null, error: null, count: 7 };
    await expect(countSavedJobs()).resolves.toBe(7);
    expect(calls).toContainEqual(["select", "saved_jobs", "job_id", { count: "exact", head: true }]);
    tableResult.value = { data: null, error: null, count: null };
    await expect(countSavedJobs()).rejects.toThrow("The saved vacancies could not be counted");
  });
});

describe("the reads of the console landing (UX-10)", () => {
  it("returns the staff members and the moderation counts", async () => {
    rpcResults.value.admin_staff_count = { data: 4, error: null };
    rpcResults.value.admin_moderation_counts = { data: [{ suspended_users: 2, suspended_organizations: 1, hidden_vacancies: 3 }], error: null };
    await expect(staffCount()).resolves.toBe(4);
    await expect(moderationCounts()).resolves.toEqual({ suspendedUsers: 2, suspendedOrganizations: 1, hiddenVacancies: 3 });
  });

  it("fails with a message that names what could not be loaded", async () => {
    rpcResults.value.admin_staff_count = { data: null, error: { message: "CHARA_FORBIDDEN" } };
    rpcResults.value.admin_moderation_counts = { data: null, error: { message: "CHARA_FORBIDDEN" } };
    await expect(staffCount()).rejects.toThrow("The staff count could not be loaded");
    await expect(moderationCounts()).rejects.toThrow("The moderation counts could not be loaded");
  });
});
