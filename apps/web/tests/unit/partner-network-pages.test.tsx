import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PartnerBand } from "@/components/home/partner-band";
import { partnerNetworkCopy, partnerSteps } from "@/lib/public/partner-network";
import { employerSteps, workerSteps } from "@/lib/public/steps";

const releasedSwitches = vi.hoisted(() => vi.fn());
const getCurrentUser = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/release", () => ({ releasedSwitches }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser }));

const { default: HowItWorksPage } = await import("@/app/[lang]/(public)/how-it-works/page");

const textOf = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
// The number of a step is drawn for the eye only (aria-hidden): it is the one number these pages may hold.
const withoutStepNumbers = (markup: string) => markup.replace(/<span aria-hidden="true"[^>]*>\d+<\/span>/g, "");

// The keys of the strings that hold a number (FR-L5 AC8).
function keysWithNumbers(strings: Record<string, string>): string[] {
  return Object.entries(strings).flatMap(([key, text]) => (/\d/.test(text) ? [key] : []));
}

const stepStrings = (name: string, steps: readonly { title: string; text: string }[]) =>
  Object.fromEntries(steps.flatMap(({ title, text }, index) => [[`${name}.${index}.title`, title], [`${name}.${index}.text`, text]]));

async function renderHowItWorks(): Promise<string> {
  const page = await HowItWorksPage({ params: Promise.resolve({ lang: "en" }) } as Parameters<typeof HowItWorksPage>[0]);
  const { prelude } = await prerender(page);
  return new Response(prelude).text();
}

beforeEach(() => {
  releasedSwitches.mockResolvedValue([]);
  getCurrentUser.mockResolvedValue(null);
});

describe("the content check of the partner network pages (FR-L5 AC8)", () => {
  it("names the key of a string with a number, so copy such as 500+ partners cannot be released", () => {
    expect(keysWithNumbers({ fine: "Find recruitment partners", partners: "500+ partners", countries: "Active in 30 countries" })).toEqual([
      "partners",
      "countries",
    ]);
  });

  it("finds no number in the copy of the home section, How it works and the partner sections of For employers", () => {
    expect(
      keysWithNumbers({
        ...partnerNetworkCopy,
        ...stepStrings("partnerSteps", partnerSteps),
        ...stepStrings("workerSteps", workerSteps),
        ...stepStrings("employerSteps", employerSteps),
      }),
    ).toEqual([]);
  });

  it("renders no number on the home section or on How it works, other than the numbers of the steps", async () => {
    releasedSwitches.mockResolvedValue(["release_partner_directories"]);
    for (const markup of [renderToStaticMarkup(<PartnerBand lang="en" visitor />), await renderHowItWorks()]) {
      expect(textOf(withoutStepNumbers(markup))).not.toMatch(/\d/);
    }
  });
});

describe("How Chara Pinnacle works (FR-L5 AC9)", () => {
  it("explains only workers and employers while release 2a is off", async () => {
    const html = await renderHowItWorks();
    expect(textOf(html).toLowerCase()).not.toMatch(/recruitment|staffing|job order/);
    expect(html.match(/<h2/g)).toHaveLength(2);
  });

  it("adds a section on partners, workforce requirements and job orders, the job orders without a link while their release is off", async () => {
    releasedSwitches.mockResolvedValue(["release_partner_directories"]);
    const html = await renderHowItWorks();
    expect(html).toMatch(/<h2[^>]*>For recruitment and staffing companies<\/h2>/);
    expect(textOf(html)).toContain("Create a company account as a recruitment company or a staffing company.");
    expect(html).toMatch(/<a [^>]*href="\/en\/partners\/recruitment"[^>]*>Recruitment partners<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/en\/partners\/staffing"[^>]*>Staffing partners<\/a>/);
    expect(textOf(html)).toContain("Workforce requirements and job orders come in a later phase.");
    expect(html).not.toContain("job-orders");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("shows a signed-in worker nothing of it, and a signed-in company all of it", async () => {
    releasedSwitches.mockResolvedValue(["release_partner_directories"]);
    getCurrentUser.mockResolvedValue({ accountKind: "worker" });
    expect(await renderHowItWorks()).not.toContain("/en/partners/");
    getCurrentUser.mockResolvedValue({ accountKind: "company" });
    expect(await renderHowItWorks()).toContain('href="/en/partners/staffing"');
  });

  it("links the job orders page instead of calling it a later phase once their release is on (AC9)", async () => {
    releasedSwitches.mockResolvedValue(["release_partner_directories"]);
    expect(await renderHowItWorks()).not.toContain('href="/en/job-orders"');
    releasedSwitches.mockResolvedValue(["release_partner_directories", "release_job_orders"]);
    const html = await renderHowItWorks();
    expect(textOf(html)).not.toContain("later phase");
    expect(html).toContain('href="/en/job-orders"');
    expect(textOf(html)).toContain("Employers publish workforce requirements, and listed companies find them as job orders");
  });
});

describe("the partner band of the home page (FR-L5 AC9)", () => {
  it("offers a visitor the sign-up as either partner type and both directories, and a signed-in company the directories only", () => {
    const visitor = renderToStaticMarkup(<PartnerBand lang="en" visitor />);
    expect(visitor).toContain('href="/en/signup?kind=recruitment_company"');
    expect(visitor).toContain('href="/en/signup?kind=staffing_company"');
    const company = renderToStaticMarkup(<PartnerBand lang="en" visitor={false} />);
    expect(company).not.toContain("/en/signup");
    expect(company).toContain('href="/en/partners/recruitment"');
    expect(company).toContain('href="/en/partners/staffing"');
    expect(company).not.toMatch(/<(img|picture)\b|\sstyle=/);
  });
});
