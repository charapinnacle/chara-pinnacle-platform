import { expectNoAxeViolations } from "./support/axe";
import { execute, executeAsync, literal, query } from "./support/db";
import { addCompanyUser, jobStatus, jobUrl, newCompany, seedJob, statusAudit } from "./support/jobs";
import { logIn } from "./support/login-page";
import { enforceLimits, newVisitor, restoreLimits, subscribe } from "./support/team";
import { expect, test } from "./support/test";

// The limits are switched on for the whole database while this file runs, so it has a project of its own that follows
// the others (playwright.config.ts) and runs in one worker.
test.describe.configure({ mode: "serial" });
test.beforeAll(enforceLimits);
test.afterAll(restoreLimits);

const PUBLISHED = "The vacancy is published";

function promptRows(organizationId: string) {
  return query<{ actor_id: string | null; metadata: Record<string, unknown> }>(
    `select actor_id, metadata from audit.log where action = 'limit.prompt_shown' and entity_id = ${literal(organizationId)} order by id`,
  );
}

test.describe("vacancy plan limits", () => {
  test("FR-C6 AC10: at the limit Publish keeps the draft and shows the upgrade prompt, closing a vacancy lets the publish through, and a member has no Publish", async ({
    page,
    browser,
  }) => {
    const acme = await newCompany();
    subscribe(acme, "employer_starter");
    const admin = await addCompanyUser(acme, "admin");
    const member = await addCompanyUser(acme, "member");
    const open = ["Open one", "Open two", "Open three"].map((title) => seedJob(acme, { title, status: "open" }));
    const draft = seedJob(acme, { title: "Draft over the limit" });

    await logIn(page, admin, jobUrl(acme.slug, draft));
    await expect(page).toHaveURL(jobUrl(acme.slug, draft));
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const prompt = page.getByRole("alert").filter({ hasText: "open vacancies" });
    await expect(prompt).toContainText("Your Basic plan has 3 of 3 open vacancies in use.");
    await expect(prompt).toContainText("Pause or close another vacancy to make room");
    await expect(prompt.getByRole("link", { name: /upgrade your plan/i })).toHaveAttribute("href", `/en/org/${acme.slug}/billing`);
    await expect(page.getByText(PUBLISHED, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Draft - not public" })).toBeVisible();
    expect(jobStatus(draft)).toBe("draft");
    expect(statusAudit(draft)).toEqual([]);
    await expectNoAxeViolations(page);
    expect(promptRows(acme.id)).toEqual([
      { actor_id: admin.id, metadata: { limit_key: "active_jobs", plan_code: "employer_starter", limit: 3, open_jobs: 3 } },
    ]);

    await page.goto(jobUrl(acme.slug, open[0]));
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("dialog", { name: "Close this vacancy?" }).getByRole("button", { name: "Close vacancy" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Closed - not public" })).toBeVisible();

    await page.goto(jobUrl(acme.slug, draft));
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText(PUBLISHED, { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /^Open/ })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "open vacancies" })).toHaveCount(0);
    expect(jobStatus(draft)).toBe("open");
    expect(promptRows(acme.id)).toHaveLength(1);

    const other = await newVisitor(browser);
    const second = seedJob(acme, { title: "Another draft" });
    await logIn(other.page, member, jobUrl(acme.slug, second));
    await expect(other.page.getByRole("status").filter({ hasText: "Draft - not public" })).toBeVisible();
    await expect(other.page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
    await other.context.close();
  });

  test("FR-C6 AC10: a Free organization is told it has 0 of 0 open vacancies in use, and reopening a paused vacancy is checked the same way", async ({
    page,
  }) => {
    const acme = await newCompany();
    const draft = seedJob(acme, { title: "Free draft" });
    await logIn(page, acme.owner, jobUrl(acme.slug, draft));
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const free = page.getByRole("alert").filter({ hasText: "open vacancies" });
    await expect(free).toContainText("Your Free plan has 0 of 0 open vacancies in use.");
    await expect(free).not.toContainText("Pause or close");
    await expect(free.getByRole("link", { name: /upgrade your plan/i })).toHaveAttribute("href", `/en/org/${acme.slug}/billing`);
    expect(jobStatus(draft)).toBe("draft");

    subscribe(acme, "employer_starter");
    const [first, second, third] = ["Open vacancy one", "Open vacancy two", "Open vacancy three"].map((title) => seedJob(acme, { title, status: "open" }));
    const paused = seedJob(acme, { title: "Paused", status: "paused" });
    await page.goto(jobUrl(acme.slug, paused));
    await page.getByRole("button", { name: "Reopen", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "open vacancies" })).toContainText("3 of 3 open vacancies in use");
    expect(jobStatus(paused)).toBe("paused");
    expect([first, second, third].map(jobStatus)).toEqual(["open", "open", "open"]);
  });

  test("FR-C6 AC9: two admins pressing Publish at the same moment publish exactly one vacancy and the other sees the upgrade prompt", async ({
    page,
    browser,
  }) => {
    const acme = await newCompany();
    subscribe(acme, "employer_starter");
    const second = await addCompanyUser(acme, "admin");
    seedJob(acme, { title: "Open one", status: "open" });
    seedJob(acme, { title: "Open two", status: "open" });
    const draftA = seedJob(acme, { title: "Draft of the owner" });
    const draftB = seedJob(acme, { title: "Draft of the admin" });
    const visitor = await newVisitor(browser);

    await logIn(page, acme.owner, jobUrl(acme.slug, draftA));
    await expect(page).toHaveURL(jobUrl(acme.slug, draftA));
    await logIn(visitor.page, second, jobUrl(acme.slug, draftB));
    await expect(visitor.page).toHaveURL(jobUrl(acme.slug, draftB));

    const pages = [page, visitor.page];
    await Promise.all(pages.map((person) => person.getByRole("button", { name: "Publish", exact: true }).click()));
    const outcome = (person: typeof page) =>
      person.getByText(PUBLISHED, { exact: true }).or(person.getByRole("alert").filter({ hasText: "open vacancies" }));
    for (const person of pages) await expect(outcome(person)).toBeVisible();

    const published = await Promise.all(pages.map((person) => person.getByText(PUBLISHED, { exact: true }).count()));
    const prompts = await Promise.all(
      pages.map((person) => person.getByRole("alert").filter({ hasText: "3 of 3 open vacancies" }).count()),
    );
    expect([published.reduce((a, b) => a + b), prompts.reduce((a, b) => a + b)]).toEqual([1, 1]);
    expect([draftA, draftB].map(jobStatus).sort()).toEqual(["draft", "open"]);
    expect(query<{ n: number }>(`select count(*)::int as n from public.jobs where organization_id = ${literal(acme.id)} and status = 'open'`)).toEqual([{ n: 3 }]);
    await visitor.context.close();
  });

  test("FR-C6 AC9: a publish that starts while another is still uncommitted waits for it and is then refused", async () => {
    const acme = await newCompany();
    subscribe(acme, "employer_starter");
    seedJob(acme, { title: "Open one", status: "open" });
    seedJob(acme, { title: "Open two", status: "open" });
    const draftA = seedJob(acme, { title: "Held draft" });
    const draftB = seedJob(acme, { title: "Waiting draft" });
    const publish = (jobId: string, hold: string) =>
      `begin; select set_config('request.jwt.claims', ${literal(JSON.stringify({ sub: acme.owner.id, role: "authenticated", aal: "aal1" }))}, true);
       update public.jobs set status = 'open' where id = ${literal(jobId)}; ${hold} commit;`;

    const holding = executeAsync(publish(draftA, "select pg_sleep(2.5);"));
    await expect
      .poll(() =>
        query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity where state = 'active' and query like '%pg_sleep(2.5)%' and pid <> pg_backend_pid()`,
        )[0].n,
      )
      .toBe(1);
    await expect(executeAsync(publish(draftB, ""))).rejects.toMatchObject({ stderr: expect.stringContaining("CHARA_LIMIT_REACHED") });
    await holding;

    expect(jobStatus(draftA)).toBe("open");
    expect(jobStatus(draftB)).toBe("draft");
    expect(execute(`select count(*) from public.jobs where organization_id = ${literal(acme.id)} and status = 'open'`).trim()).toBe("3");
  });
});
