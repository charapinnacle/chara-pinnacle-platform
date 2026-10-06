import { execute, literal, query } from "./support/db";
import { expectNoAxeViolations } from "./support/axe";
import { createCommittedUser } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import { newCompany, seedJob, type Company } from "./support/jobs";
import { uniqueToken } from "./support/organizations";
import { signInBrowser } from "./support/session";
import { staffUser } from "./support/mfa";
import { expect, test } from "./support/test";
import { bodyOf, publicUrl } from "./support/vacancy-page";

const WEBSITE = "https://acme.example";

function openJob(company: Company, title: string): string {
  const id = seedJob(company, {
    title,
    status: "open",
    salary: { min: 2800, max: 3400, currency: "EUR", period: "month" },
    accommodation: true,
    visaSupport: true,
  });
  execute(`update public.jobs set published_at = '2026-03-04T10:00:00Z' where id = ${literal(id)}`);
  return id;
}

function jsonLd(html: string): Record<string, unknown> {
  const match = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(html);
  if (!match) throw new Error("The page has no JobPosting markup");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

test.describe("the public vacancy page", () => {
  test("FR-C4 AC1, AC9: an anonymous visitor sees the vacancy, the employer card, the actions and the JobPosting markup", async ({
    page,
  }) => {
    const company = await newCompany();
    execute(`update public.organizations set website = ${literal(WEBSITE)} where id = ${literal(company.id)}`);
    const [{ display_name }] = query<{ display_name: string }>(
      `select display_name from public.organizations where id = ${literal(company.id)}`,
    );
    const id = openJob(company, "Welder MIG/MAG");

    const response = await page.goto(publicUrl(id));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Welder MIG/MAG", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(`Welder MIG/MAG - ${display_name} | CHARA`);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

    const description = page.getByText("Line one of the description.");
    await expect(description).toBeVisible();
    expect(await description.evaluate((element) => (element as HTMLElement).innerText)).toContain("\n");

    const details = page.locator("dl");
    for (const [term, value] of [
      ["Location", "Hamburg, Germany"],
      ["Occupation", "Welders and flame cutters"],
      ["Industry", "Manufacturing"],
      ["Employment type", "Full time"],
      ["Salary", "EUR 2,800 to 3,400, per month"],
      ["Accommodation", "Yes"],
      ["Visa support", "Yes"],
      ["Recruitment", "Local and international candidates"],
      ["Published", "March 4, 2026"],
    ]) {
      await expect(details.locator("div").filter({ has: page.getByText(term, { exact: true }) })).toContainText(value);
    }
    await expect(page.locator("time")).toHaveAttribute("datetime", "2026-03-04T10:00:00+00:00");

    const card = page.getByRole("region", { name: display_name });
    await expect(card).toContainText("Based in Germany");
    await expect(card).toContainText("Industry: Construction");
    const website = card.getByRole("link", { name: /acme\.example/ });
    await expect(website).toHaveAttribute("href", `${WEBSITE}/`);
    await expect(website).toHaveAttribute("target", "_blank");
    await expect(website).toHaveAttribute("rel", "nofollow noopener noreferrer");

    await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();

    const { html } = await bodyOf(page, publicUrl(id));
    expect(jsonLd(html)).toEqual({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Welder MIG/MAG",
      description: "Line one of the description.\nLine two of it, which is long enough to pass the limit.",
      datePosted: "2026-03-04T10:00:00.000Z",
      hiringOrganization: { "@type": "Organization", name: display_name },
      jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Hamburg", addressCountry: "DE" } },
      employmentType: "FULL_TIME",
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: "EUR",
        value: { "@type": "QuantitativeValue", minValue: 2800, maxValue: 3400, unitText: "MONTH" },
      },
    });
  });

  test("FR-C4 AC2: the employer card exposes only the public profile, and a website of another scheme cannot be stored", async ({
    page,
  }) => {
    const company = await newCompany();
    execute(`update public.organizations set website = ${literal(WEBSITE)} where id = ${literal(company.id)}`);
    const [organization] = query<{ legal_name: string; display_name: string }>(
      `select legal_name, display_name from public.organizations where id = ${literal(company.id)}`,
    );
    const id = openJob(company, "Public profile welder");

    const { status, html } = await bodyOf(page, publicUrl(id));
    expect(status).toBe(200);
    expect(html).toContain(organization.display_name);
    for (const secret of [organization.legal_name, company.owner.email, company.owner.id, company.id, "employer_starter", "trialing"]) {
      expect(html, secret).not.toContain(secret);
    }
    expect(html).not.toContain("javascript:");
    expect(html).toContain(`href="${WEBSITE}/"`);

    expect(() =>
      execute(`update public.organizations set website = 'javascript:alert(1)' where id = ${literal(company.id)}`),
    ).toThrow();
  });

  test("FR-C4 AC3: Apply and Save lead a visitor to log in and back to the vacancy; an absolute next is ignored", async ({ page }) => {
    const company = await newCompany();
    const id = openJob(company, "Login welder");
    const candidate = await createCommittedUser("worker");
    const next = `/en/jobs/${id}`;

    await page.goto(publicUrl(id));
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(next)}`);
    await page.goBack();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(next)}`);

    await page.getByLabel("Email", { exact: true }).fill(candidate.email);
    await page.getByLabel("Password", { exact: true }).fill(candidate.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(next);
    await expect(page.getByRole("heading", { name: "Login welder", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(page.getByText("Applying and saving open soon.")).toBeVisible();
    await expectNoAxeViolations(page);

    for (const hostile of ["//evil.example", "https://evil.example"]) {
      await page.context().clearCookies();
      await logIn(page, candidate, hostile);
      await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
    }
  });

  test("FR-C4 AC6: a company user and a platform administrator are not offered Apply or Save and are told why", async ({
    page,
    context,
  }) => {
    const company = await newCompany();
    const id = openJob(company, "Company welder");
    const administrator = await staffUser("admin");

    for (const user of [company.owner, administrator]) {
      await context.clearCookies();
      await signInBrowser(context, user);
      const response = await page.goto(publicUrl(id));
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Company welder", level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
      await expect(page.getByText("Only candidates can apply for vacancies or save them.")).toBeVisible();
    }
  });

  test("FR-C4 AC10: the text of a vacancy is never read as HTML on the page, the search card or the preview", async ({
    page,
    context,
  }) => {
    const company = await newCompany();
    const token = uniqueToken();
    const title = `<img src=x onerror=alert(1)> zq${token}`;
    const description = `<script>alert(1)</script> Apply at https://example.com/apply-${token} and bring documents.`;
    const id = seedJob(company, { title, description, status: "open" });
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await page.goto(publicUrl(id));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByText("<script>alert(1)</script>", { exact: false })).toBeVisible();
    await expect(page.locator("article img, article script")).toHaveCount(0);
    await expect(page.locator(`article a[href*="example.com"]`)).toHaveCount(0);

    await page.goto(`/en/jobs?q=zq${token}`);
    const card = page.locator("ul > li").filter({ hasText: `zq${token}` });
    await expect(card.getByRole("heading")).toHaveText(title);
    await expect(card.locator("img")).toHaveCount(0);

    await signInBrowser(context, company.owner);
    await page.goto(`/en/org/${company.slug}/jobs/${id}/preview`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.locator("article img, article script")).toHaveCount(0);
    await expect(page.locator(`article a[href*="example.com"]`)).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test("FR-C4 AC11: the HTML already holds the live data, and an edit shows at once", async ({ browser, page }) => {
    const company = await newCompany();
    const id = openJob(company, "Live welder");
    const nojs = await browser.newContext({ javaScriptEnabled: false });
    const plain = await nojs.newPage();

    await plain.goto(publicUrl(id));
    await expect(plain.getByRole("heading", { name: "Live welder", level: 1 })).toBeVisible();
    await expect(plain.getByText("Line one of the description.")).toBeVisible();
    await expect(plain.getByRole("region", { name: /Vacancy Bau/ })).toBeVisible();

    execute(`update public.jobs set title = 'Edited live welder' where id = ${literal(id)}`);
    const { html } = await bodyOf(page, publicUrl(id));
    expect(html).toContain("Edited live welder");
    expect(html).not.toContain("Live welder<");
    await plain.reload();
    await expect(plain.getByRole("heading", { name: "Edited live welder", level: 1 })).toBeVisible();
    await nojs.close();
  });

  test("FR-C4 AC12: no accessibility violation at 1280 px and 360 px, no horizontal scroll, and Apply and Save work by keyboard", async ({
    page,
  }) => {
    const company = await newCompany();
    execute(`update public.organizations set website = ${literal(WEBSITE)} where id = ${literal(company.id)}`);
    const [{ display_name }] = query<{ display_name: string }>(
      `select display_name from public.organizations where id = ${literal(company.id)}`,
    );
    const title = `Keyboard welder - ${display_name} | CHARA`;
    const id = openJob(company, "Keyboard welder");

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(publicUrl(id));
    await expect(page.getByRole("heading", { name: "Keyboard welder", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(title);
    await expectNoAxeViolations(page);

    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(publicUrl(id));
    await expect(page.getByRole("heading", { name: "Keyboard welder", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(title);
    await expectNoAxeViolations(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    const apply = page.getByRole("button", { name: "Apply" });
    const save = page.getByRole("button", { name: "Save", exact: true });
    await apply.focus();
    await expect(apply).toBeFocused();
    expect(await apply.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
    await page.keyboard.press("Tab");
    await expect(save).toBeFocused();
    expect(await save.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");

    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/\/en\/login\?next=/);
    await page.goBack();
    await page.getByRole("button", { name: "Apply" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/login\?next=/);
  });
});
