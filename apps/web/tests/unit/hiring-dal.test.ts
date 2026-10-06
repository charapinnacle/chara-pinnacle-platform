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
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: builder,
    rpc: (name: string, args: unknown) => {
      calls.push([`rpc.${name}`, args]);
      return Promise.resolve(result);
    },
  }),
}));
vi.mock("@/lib/jobs/search-log", () => ({ logSearch: vi.fn() }));

const { getEmployer, getJob, getJobLimit, getPublicJob, JOBS_PAGE_SIZE, listJobs, searchJobs } = await import(
  "@/lib/dal/hiring"
);
const { logSearch } = await import("@/lib/jobs/search-log");

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
  status_changed_at: "2026-10-06T10:00:00.123456+00:00",
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
  const publicRow = {
    id: row.id,
    title: row.title,
    description: row.description,
    occupation: "Welders and flame cutters",
    industry: "Manufacturing",
    country_code: "DE",
    country: "Germany",
    city: "Hamburg",
    employment_type: "full_time",
    salary_min: 2800,
    salary_max: null,
    salary_currency: "EUR",
    salary_period: "month",
    accommodation: true,
    visa_support: false,
    recruitment_preference: "both",
    published_at: "2026-10-06T10:00:00+00:00",
    employer_display_name: "Acme Bau",
    employer_country: "Germany",
    employer_industry: null,
    employer_website: "https://acme.example",
  };

  it("asks the public function for the vacancy and reads no table, so a member's session sees no more than a visitor's", async () => {
    result = { data: [publicRow], error: null };
    await getPublicJob(row.id);
    expect(calls).toEqual([["rpc.get_public_job", { p_id: row.id }]]);
  });

  it("maps the row to the vacancy, the date of publication and the public profile of the employer", async () => {
    result = { data: [publicRow], error: null };
    await expect(getPublicJob(row.id)).resolves.toEqual({
      id: row.id,
      title: row.title,
      description: row.description,
      occupation: "Welders and flame cutters",
      industry: "Manufacturing",
      country: "Germany",
      countryCode: "DE",
      city: "Hamburg",
      employmentType: "full_time",
      salaryMin: 2800,
      salaryMax: null,
      salaryCurrency: "EUR",
      salaryPeriod: "month",
      accommodation: true,
      visaSupport: false,
      recruitmentPreference: "both",
      publishedAt: "2026-10-06T10:00:00+00:00",
      employer: { displayName: "Acme Bau", country: "Germany", industry: null, website: "https://acme.example" },
    });
  });

  it("gives null when the function returns no row, whatever the reason", async () => {
    result = { data: [], error: null };
    await expect(getPublicJob(row.id)).resolves.toBeNull();
  });

  it("throws when the read fails, so the page is an error and never 'no longer available'", async () => {
    result = { data: null, error: { code: "42501", message: "permission denied for function get_public_job" } };
    await expect(getPublicJob(row.id)).rejects.toThrow("The vacancy could not be loaded");
  });
});

describe("the stale flag", () => {
  const oldDay = (days: number) => new Date(Date.now() - days * 86_400_000 - 60_000).toISOString();

  it("is set on a vacancy that has been open for more than 90 days since its last status change", async () => {
    const changedAt = oldDay(90);
    result = { data: { ...row, status: "open", status_changed_at: changedAt }, error: null };
    await expect(getJob("org-1", row.id)).resolves.toMatchObject({ staleOpen: true, statusChangedAt: changedAt });
    result = { data: { ...row, status: "open", status_changed_at: oldDay(89) }, error: null };
    await expect(getJob("org-1", row.id)).resolves.toMatchObject({ staleOpen: false });
  });

  it("is set per row of the list, and only on an open vacancy", async () => {
    result = {
      data: [
        { ...row, id: "a", status: "open", status_changed_at: oldDay(91), countries: { name: "Germany" } },
        { ...row, id: "b", status: "paused", status_changed_at: oldDay(120), countries: { name: "Germany" } },
        { ...row, id: "c", status: "open", status_changed_at: oldDay(10), countries: { name: "Germany" } },
      ],
      error: null,
    };
    const { jobs } = await listJobs("org-1", null);
    expect(jobs.map((job) => [job.id, job.staleOpen])).toEqual([["a", true], ["b", false], ["c", false]]);
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
      status_changed_at: "2026-10-06T10:00:00.000000+00:00",
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
  it("reads the name, the country, the industry and the website of the organization", async () => {
    result = {
      data: {
        display_name: "Acme Bau",
        website: "https://acme.example",
        countries: { name: "Germany" },
        industries: { name: "Construction" },
      },
      error: null,
    };
    await expect(getEmployer("org-1")).resolves.toEqual({
      displayName: "Acme Bau",
      country: "Germany",
      industry: "Construction",
      website: "https://acme.example",
    });
  });
});

describe("getJobLimit", () => {
  it("reads the plan name, the limit and the open count of the organization from the member view", async () => {
    result = { data: { plan_name: "Basic", active_jobs_limit: 3, open_jobs: 3 }, error: null };
    await expect(getJobLimit("org-1")).resolves.toEqual({ planName: "Basic", limit: 3, used: 3 });
    expect(calls).toContainEqual(["v_org_limits.select", "plan_name, active_jobs_limit, open_jobs"]);
    expect(calls).toContainEqual(["v_org_limits.eq", "organization_id", "org-1"]);
  });

  it.each([
    ["an organization the caller is not a member of", null],
    ["an unlimited plan", { plan_name: "Enterprise", active_jobs_limit: null, open_jobs: 7 }],
    ["a plan that is not in billing.plans", { plan_name: null, active_jobs_limit: 0, open_jobs: 0 }],
  ])("has no prompt for %s", async (_, data) => {
    result = { data, error: null };
    await expect(getJobLimit("org-1")).resolves.toBeNull();
  });

  it("throws on a failed read, with the cause attached and no text for the caller", async () => {
    result = { data: null, error: { message: "secret detail" } };
    await expect(getJobLimit("org-1")).rejects.toThrow("The vacancy limit could not be loaded");
  });
});

describe("searchJobs", () => {
  const found = {
    id: row.id,
    title: "Welder MIG/MAG",
    employer_display_name: "Acme Bau",
    employer_slug: "acme-bau",
    country_code: "DE",
    city: "Hamburg",
    employment_type: "full_time",
    salary_min: null,
    salary_max: 3400,
    salary_currency: "EUR",
    salary_period: "month",
    accommodation: true,
    visa_support: false,
    recruitment_preference: "both",
    created_at: "2026-10-06T10:00:00.123456+00:00",
    next_cursor: null,
  };

  it("passes every filter, the cursor and the limit to the function as its parameters", async () => {
    result = { data: [], error: null };
    await searchJobs({
      q: "welder",
      country: "DE",
      city: "Hamburg",
      occupation: "7212",
      industry: "C",
      employment_type: "full_time",
      salary_min: 3000,
      salary_currency: "EUR",
      salary_period: "month",
      accommodation: true,
      visa_support: true,
      recruitment: "local",
      cursor: "0|2026-10-07T10:00:00.000000Z|6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11",
      limit: 10,
    });
    expect(calls).toEqual([
      [
        "rpc.search_jobs",
        {
          p_q: "welder",
          p_country: "DE",
          p_city: "Hamburg",
          p_occupation: "7212",
          p_industry: "C",
          p_employment_type: "full_time",
          p_salary_min: 3000,
          p_salary_currency: "EUR",
          p_salary_period: "month",
          p_accommodation: true,
          p_visa_support: true,
          p_recruitment: "local",
          p_cursor: "0|2026-10-07T10:00:00.000000Z|6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11",
          p_limit: 10,
        },
      ],
    ]);
  });

  it("maps the rows to cards with no person in them and a salary that may have no minimum", async () => {
    result = { data: [found], error: null };
    await expect(searchJobs({ limit: 20 })).resolves.toEqual({
      results: [
        {
          id: row.id,
          title: "Welder MIG/MAG",
          employerName: "Acme Bau",
          countryCode: "DE",
          city: "Hamburg",
          employmentType: "full_time",
          salaryMin: null,
          salaryMax: 3400,
          salaryCurrency: "EUR",
          salaryPeriod: "month",
          accommodation: true,
          visaSupport: false,
          createdAt: "2026-10-06T10:00:00.123456+00:00",
        },
      ],
      nextCursor: null,
    });
  });

  it("takes the cursor of the last row as the next page", async () => {
    result = { data: [found, { ...found, next_cursor: "0.5|2026-10-07T10:00:00.000000Z|x" }], error: null };
    await expect(searchJobs({ limit: 2 })).resolves.toMatchObject({ nextCursor: "0.5|2026-10-07T10:00:00.000000Z|x" });
  });

  it("logs the search with the count of the page", async () => {
    result = { data: [found], error: null };
    await searchJobs({ q: "welder", limit: 20 });
    expect(logSearch).toHaveBeenCalledWith({ q: "welder", limit: 20 }, expect.any(Number), 1, "ok");
  });

  it("throws on a failed call, with the cause attached and no text for the caller", async () => {
    result = { data: null, error: { message: "secret detail" } };
    await expect(searchJobs({ limit: 20 })).rejects.toThrow("The vacancies could not be searched");
  });

  it("logs a failed search too, with no results and the outcome error", async () => {
    result = { data: null, error: { message: "canceling statement due to statement timeout" } };
    await expect(searchJobs({ q: "welder", limit: 20 })).rejects.toThrow("The vacancies could not be searched");
    expect(logSearch).toHaveBeenLastCalledWith({ q: "welder", limit: 20 }, expect.any(Number), 0, "error");
  });
});
