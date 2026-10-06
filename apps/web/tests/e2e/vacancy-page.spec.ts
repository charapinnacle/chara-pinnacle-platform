import type { Page } from "@playwright/test";
import { execute, literal, query } from "./support/db";
import { expectNoAxeViolations } from "./support/axe";
import { createCommittedUser } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import { newCompany, seedJob, type Company } from "./support/jobs";
import { uniqueToken } from "./support/organizations";
import { signInBrowser } from "./support/session";
import { staffUser } from "./support/mfa";
import { expect, test } from "./support/test";

const UNAVAILABLE = "This vacancy is no longer available";
const WEBSITE = "https://acme.example";

const publicUrl = (id: string) => `/en/jobs/${id}`;

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

async function bodyOf(page: Page, path: string): Promise<{ status: number; html: string }> {
  const response = await page.request.get(path);
  return { status: response.status(), html: await response.text() };
}

// What differs from one request to the next is the nonce of the content security policy (in the attributes of the
// scripts and again in the page data) and the id of the vacancy asked for, which the page data repeats from the address.
function normalised(html: string, id: string): string {
  const nonce = /nonce="([^"]+)"/.exec(html)?.[1];
  const withoutNonce = nonce ? html.replaceAll(nonce, "NONCE") : html;
  return withoutNonce.replaceAll(id, "ID");
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

  test("FR-C4 AC7: every vacancy that is not available gives the same 404 page, without a field, a name or a reason", async ({
    page,
  }) => {
    const company = await newCompany();
    const token = uniqueToken();
    const title = `Secret welder ${token}`;
    const deleted = seedJob(company, { title, status: "open" });
    execute(`update public.jobs set deleted_at = now() where id = ${literal(deleted)}`);
    const ids = [
      seedJob(company, { title, status: "draft" }),
      seedJob(company, { title, status: "paused" }),
      seedJob(company, { title, status: "closed" }),
      seedJob(company, { title, status: "filled" }),
      seedJob(company, { title, status: "open", moderation: "hidden" }),
      seedJob(company, { title, status: "open", moderation: "org_suspended" }),
      deleted,
      "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11",
      "abc",
    ];

    // The page as the browser renders it must be the same for every id. The raw payload of an id that is not a uuid
    // numbers its chunks differently, because it never waits for the database, so the raw bytes are not compared.
    const pages = new Set<string>();
    for (const id of ids) {
      const { status, html } = await bodyOf(page, publicUrl(id));
      expect(status, id).toBe(404);
      expect(html, id).toContain(UNAVAILABLE);
      expect(html, id).toMatch(/<meta name="robots" content="[^"]*noindex/);
      for (const leak of [token, company.slug, "application/ld+json", "Welders", "Hamburg"]) {
        expect(html, `${id} ${leak}`).not.toContain(leak);
      }
      await page.goto(publicUrl(id));
      await expect(page.getByRole("heading", { name: UNAVAILABLE })).toBeVisible();
      pages.add(
        JSON.stringify([
          await page.title(),
          await page.locator('meta[name="robots"]').evaluateAll((tags) => tags.map((tag) => tag.getAttribute("content"))),
          await page.locator("main").innerHTML(),
        ]),
      );
    }
    expect(pages.size, "the rendered pages are identical").toBe(1);

    await page.goto(publicUrl(ids[0]));
    await expect(page.getByRole("heading", { name: UNAVAILABLE })).toBeVisible();
    await page.getByRole("link", { name: "Find jobs" }).click();
    await expect(page).toHaveURL("/en/jobs");
    await expectNoAxeViolations(page);
  });

  test("FR-C4 AC8: an owner and a member get the neutral page on the public address of their own draft, paused and hidden vacancies", async ({
    page,
    context,
  }) => {
    const company = await newCompany();
    const member = await createCommittedUser("company");
    execute(
      `insert into public.organization_members (organization_id, user_id, role, accepted_at, invited_by)
       values (${literal(company.id)}, ${literal(member.id)}, 'member', now(), ${literal(company.owner.id)})`,
    );
    const ids = [
      seedJob(company, { title: "Own draft", status: "draft" }),
      seedJob(company, { title: "Own paused", status: "paused" }),
      seedJob(company, { title: "Own hidden", status: "open", moderation: "hidden" }),
    ];
    const anonymous = normalised((await bodyOf(page, publicUrl(ids[0]))).html, ids[0]);

    for (const user of [company.owner, member]) {
      await context.clearCookies();
      await signInBrowser(context, user);
      for (const id of ids) {
        const { status, html } = await bodyOf(page, publicUrl(id));
        expect(status, id).toBe(404);
        expect(html, id).not.toContain("Own ");
        expect(normalised(html, id), id).toBe(anonymous);
      }
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
    const id = openJob(company, "Keyboard welder");

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(publicUrl(id));
    await expect(page.getByRole("heading", { name: "Keyboard welder", level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(publicUrl(id));
    await expect(page.getByRole("heading", { name: "Keyboard welder", level: 1 })).toBeVisible();
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
