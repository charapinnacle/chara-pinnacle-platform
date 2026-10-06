import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [method: string, ...args: unknown[]];

const calls: Call[] = [];
let result: { data: unknown; error: unknown } = { data: null, error: null };

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit", "or"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([`${table}.${method}`, ...args]);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: builder }) }));

const { getEmployer, getJob, getPublicJob, JOBS_PAGE_SIZE, listJobs } = await import("@/lib/dal/hiring");

const row = {
  id: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11",
  title: "Welder MIG/MAG",
  description: "d".repeat(60),
  occupation_id: "7212",
  industry_code: "C",
  country_code: "DE",
  city: "Hamburg",
  employment_type: "full_time",
  salary_min: 2800,
  salary_max: 3400,
  salary_currency: "EUR",
  salary_period: "month",
  accommodation: true,
  visa_support: false,
  recruitment_preference: "both",
  status: "draft",
  moderation_state: "visible",
  created_at: "2026-10-06T10:00:00.123456+00:00",
  occupations: { label: "Welders and flame cutters" },
  industries: { name: "Manufacturing" },
  countries: { name: "Germany" },
};

beforeEach(() => {
  calls.length = 0;
  result = { data: null, error: null };
});

describe("getJob", () => {
  it("reads one vacancy of the organization that is not deleted and maps the labels of the lists", async () => {
    result = { data: row, error: null };
    await expect(getJob("org-1", row.id)).resolves.toMatchObject({
      id: row.id,
      occupation: "Welders and flame cutters",
      industry: "Manufacturing",
      country: "Germany",
      employmentType: "full_time",
      visaSupport: false,
      status: "draft",
    });
    expect(calls).toContainEqual(["jobs.eq", "id", row.id]);
    expect(calls).toContainEqual(["jobs.eq", "organization_id", "org-1"]);
    expect(calls).toContainEqual(["jobs.is", "deleted_at", null]);
  });

  it("falls back to the codes when a label is missing and returns null for no row", async () => {
    result = { data: { ...row, occupations: null, industries: null, countries: null }, error: null };
    await expect(getJob("org-1", row.id)).resolves.toMatchObject({ occupation: "7212", industry: "C", country: "DE" });
    result = { data: null, error: null };
    await expect(getJob("org-1", row.id)).resolves.toBeNull();
  });

  it("fails loudly, without the database text, when the vacancy cannot be read", async () => {
    result = { data: null, error: { message: "secret detail" } };
    await expect(getJob("org-1", row.id)).rejects.toThrow("The vacancy could not be loaded");
  });
});

describe("getPublicJob", () => {
  it("repeats the public conditions so that a member's session does not read a draft", async () => {
    result = { data: row, error: null };
    await getPublicJob(row.id);
    expect(calls).toContainEqual(["jobs.eq", "status", "open"]);
    expect(calls).toContainEqual(["jobs.eq", "moderation_state", "visible"]);
    expect(calls).toContainEqual(["jobs.is", "deleted_at", null]);
  });
});

describe("listJobs", () => {
  function rows(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: `Vacancy ${index}`,
      city: "Hamburg",
      status: "draft",
      moderation_state: "visible",
      created_at: `2026-10-06T10:00:${String(59 - index).padStart(2, "0")}.000000+00:00`,
      countries: { name: "Germany" },
    }));
  }

  it("reads one row more than a page, newest first, and says there is a next page", async () => {
    result = { data: rows(JOBS_PAGE_SIZE + 1), error: null };
    const page = await listJobs("org-1", null);
    expect(calls).toContainEqual(["jobs.limit", JOBS_PAGE_SIZE + 1]);
    expect(calls).toContainEqual(["jobs.order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["jobs.order", "id", { ascending: false }]);
    expect(page.jobs).toHaveLength(JOBS_PAGE_SIZE);
    const last = page.jobs[JOBS_PAGE_SIZE - 1];
    expect(page.nextCursor).toBe(`${last.createdAt}|${last.id}`);
    expect(calls.some(([method]) => method === "jobs.or")).toBe(false);
  });

  it("has no next page for a full page that is the last, and continues after the cursor with a tie on the time", async () => {
    result = { data: rows(JOBS_PAGE_SIZE), error: null };
    expect((await listJobs("org-1", null)).nextCursor).toBeNull();
    const cursor = { createdAt: "2026-10-06T10:00:30.000000+00:00", id: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11" };
    await listJobs("org-1", cursor);
    expect(calls).toContainEqual([
      "jobs.or",
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    ]);
  });

  it("returns an empty page for an organization without vacancies", async () => {
    result = { data: [], error: null };
    await expect(listJobs("org-1", null)).resolves.toEqual({ jobs: [], nextCursor: null });
  });

  it("fails loudly when the list cannot be read", async () => {
    result = { data: null, error: { message: "secret detail" } };
    await expect(listJobs("org-1", null)).rejects.toThrow("The vacancies could not be loaded");
  });
});

describe("getEmployer", () => {
  it("reads the name, the country and the website of the organization", async () => {
    result = { data: { display_name: "Acme Bau", website: "https://acme.example", countries: { name: "Germany" } }, error: null };
    await expect(getEmployer("org-1")).resolves.toEqual({
      displayName: "Acme Bau",
      country: "Germany",
      website: "https://acme.example",
    });
  });
});
