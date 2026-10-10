import { execute, literal } from "./support/db";
import { createCommittedUser } from "./support/login";
import { expectNoAxeViolations } from "./support/axe";
import { newCompany, seedJob } from "./support/jobs";
import { uniqueToken } from "./support/organizations";
import { signInBrowser } from "./support/session";
import { expect, test } from "./support/test";
import { bodyOf, publicUrl } from "./support/vacancy-page";

const UNAVAILABLE = "This vacancy is no longer available";

// What differs from one request to the next is the nonce of the content security policy (in the attributes of the
// scripts and again in the page data) and the id of the vacancy asked for, which the page data repeats from the address.
function normalised(html: string, id: string): string {
  const nonce = /nonce="([^"]+)"/.exec(html)?.[1];
  const withoutNonce = nonce ? html.replaceAll(nonce, "NONCE") : html;
  return withoutNonce.replaceAll(id, "ID");
}

// The header of a signed-in person differs from that of a visitor (Go to my area, Log out) and the page data repeats it, so
// the pages of a signed-in person are compared by what the page itself says: its title and its main area.
function pageOwnContent(html: string, id: string): string {
  const title = /<title>[^<]*<\/title>/.exec(html)?.[0] ?? "";
  const main = /<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? "";
  return normalised(title + main, id);
}

test.describe("the public vacancy page when a vacancy is not available", () => {
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
      expect(html, id).toContain("<title>Vacancy not available | CHARA</title>");
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
    await page.getByRole("main").getByRole("link", { name: "Find jobs" }).click();
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
    const anonymous = pageOwnContent((await bodyOf(page, publicUrl(ids[0]))).html, ids[0]);

    for (const user of [company.owner, member]) {
      await context.clearCookies();
      await signInBrowser(context, user);
      for (const id of ids) {
        const { status, html } = await bodyOf(page, publicUrl(id));
        expect(status, id).toBe(404);
        expect(html, id).not.toContain("Own ");
        expect(pageOwnContent(html, id), id).toBe(anonymous);
      }
    }
  });
});
