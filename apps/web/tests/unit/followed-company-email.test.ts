import { describe, expect, it } from "vitest";
import { renderEmail } from "@/emails/index";

// The follower digest (FR-L4 AC6, AC8): the company, the titles of its new vacancies and one link to its company page;
// never anything but ids, titles and names.
const SITE = "https://chara.example";
const titles = Array.from({ length: 12 }, (_, index) => `Welder ${index + 1}`);
const payload = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  org_name: "Acme Bau",
  org_slug: "acme-bau",
  total: 12,
  vacancies: titles.slice(0, 10).map((title, index) => ({ job_id: `00000000-0000-4000-8000-0000000000${10 + index}`, job_title: title })),
};

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

describe("followed_company_activity email", () => {
  it("names the company and how many vacancies it published, with one link to its page", async () => {
    const email = await renderEmail("followed_company_activity", payload, SITE);
    expect(email.subject).toBe("Acme Bau published 12 new vacancies");
    expect(hrefs(email.html)).toEqual([`${SITE}/en/companies/acme-bau`]);
    for (const title of titles.slice(0, 10)) expect(email.text).toContain(title);
    expect(email.text).not.toContain("Welder 11");
    expect(email.text).toContain("And 2 new vacancies more.");
    expect(email.text).toContain("at most once a day");
    expect(email.text).toContain("notification settings");
  });

  it("reads well for one vacancy and shows nothing it was not given", async () => {
    const email = await renderEmail(
      "followed_company_activity",
      { ...payload, total: 1, vacancies: payload.vacancies.slice(0, 1), salary: "€4,000", email: "follower@example.test", follower_id: "u-1" },
      SITE,
    );
    expect(email.subject).toBe("Acme Bau published 1 new vacancy");
    const all = `${email.html}\n${email.text}`;
    for (const leak of ["€4,000", "follower@example.test", "u-1"]) expect(all).not.toContain(leak);
  });
});
