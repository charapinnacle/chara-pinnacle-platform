import type { Browser, Page, Response } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, literal, query } from "./support/db";
import { addCompanyUser, newCompany, seedJob, type Company } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { logIn } from "./support/login-page";
import { partnerWithCompany, setPartnerRelease, type PartnerType } from "./support/partners";
import { expect, test, visitorAddress } from "./support/test";
import type { TestUser } from "./support/test-user";

type Partner = { user: TestUser; id: string; slug: string; displayName: string };

const profileUrl = (slug: string) => `/en/partners/${slug}`;
const companyUrl = (slug: string) => `/en/companies/${slug}`;
const savedUrl = (slug: string) => `/en/org/${slug}/saved-partners`;
const SAVE_FN = "public.toggle_saved_partner(uuid, uuid, boolean)";
const LIST_FN = "public.list_saved_partners(uuid, text, integer)";

// A listed partner serving Germany with an occupation, so it appears in the recruitment directory searched for both.
async function listedPartner(type: PartnerType = "recruitment_company"): Promise<Partner> {
  const { user, id, slug } = await partnerWithCompany(type);
  execute(
    `insert into public.organization_geographies (organization_id, scope, country_code)
     values (${literal(id)}, 'serves_market', 'DE'), (${literal(id)}, 'sources_from', 'PH');
     insert into public.organization_occupations (organization_id, occupation_id) values (${literal(id)}, '7212');
     update public.organizations set review_status = 'listed', listed_at = now() - interval '1 day', submitted_at = now() - interval '2 days',
       workforce_profile_updated_at = now() + interval '2 days'
     where id = ${literal(id)}`,
  );
  const [row] = query<{ display_name: string }>(`select display_name from public.organizations where id = ${literal(id)}`);
  return { user, id, slug, displayName: row.display_name };
}

async function employerWithPage(): Promise<Company & { displayName: string }> {
  const company = await newCompany();
  execute(`update public.organizations set public_page_enabled = true where id = ${literal(company.id)}`);
  const [row] = query<{ display_name: string }>(`select display_name from public.organizations where id = ${literal(company.id)}`);
  return { ...company, displayName: row.display_name };
}

// The rows of a list page: list items with a heading, not those of the breadcrumb.
const listRows = (page: Page) => page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });

async function signedIn(browser: Browser, user: TestUser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": visitorAddress() } });
  const page = await context.newPage();
  await logIn(page, user);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  return { page, close: () => context.close() };
}

function savedRows(organizationId: string): string[] {
  return query<{ target: string }>(
    `select target_organization_id as target from public.saved_items where organization_id = ${literal(organizationId)} order by created_at`,
  ).map(({ target }) => target);
}

function follows(userId: string): string[] {
  return query<{ org: string }>(`select organization_id as org from public.follows where user_id = ${literal(userId)}`).map(({ org }) => org);
}

// The release switch is set for the whole database, the save and list functions are withdrawn for a moment and the
// follower digest runs over the whole database, so this file is a project of its own after the company page spec
// (playwright.config.ts), and its tests run one after the other.
test.describe("Save partner and follow company (FR-L4)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => {
    execute(`grant execute on function ${SAVE_FN} to authenticated; grant execute on function ${LIST_FN} to authenticated`);
    setPartnerRelease(false);
  });

  test("AC9: Save partner and Follow toggle with the keyboard, a visitor logs in first and a failed save goes back", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gamma = await listedPartner("staffing_company");
    const acme = await newCompany();
    const member = await addCompanyUser(acme, "member");

    await page.goto(profileUrl(gamma.slug));
    await page.getByRole("link", { name: `Follow ${gamma.displayName}` }).click();
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent(profileUrl(gamma.slug))}`);

    const employer = await signedIn(browser, member);
    await employer.page.goto(profileUrl(gamma.slug));
    const save = employer.page.getByRole("button", { name: `Save partner: ${gamma.displayName}` });
    await expect(save).toHaveAttribute("aria-pressed", "false");
    await save.focus();
    await employer.page.keyboard.press("Enter");
    const saved = employer.page.getByRole("button", { name: `Saved: ${gamma.displayName}` });
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await expect(employer.page.getByText(`${gamma.displayName} saved`, { exact: true })).toBeVisible();
    await expect.poll(() => savedRows(acme.id)).toEqual([gamma.id]);
    await expect(saved).toBeFocused();
    await employer.page.keyboard.press("Space");
    await expect(employer.page.getByRole("button", { name: `Save partner: ${gamma.displayName}` })).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => savedRows(acme.id)).toEqual([]);
    expect(query<{ n: number }>(`select count(*)::int as n from audit.log where action like 'saved_partner.%' and entity_id = ${literal(acme.id)}`)[0].n).toBe(2);

    execute(`revoke execute on function ${SAVE_FN} from authenticated`);
    try {
      await employer.page.getByRole("button", { name: `Save partner: ${gamma.displayName}` }).click();
      await expect(employer.page.getByText("Your saved partners were not changed", { exact: true })).toBeVisible();
      await expect(employer.page.getByRole("button", { name: `Save partner: ${gamma.displayName}` })).toHaveAttribute("aria-pressed", "false");
      expect(savedRows(acme.id)).toEqual([]);
    } finally {
      execute(`grant execute on function ${SAVE_FN} to authenticated`);
    }
    await expectAccessibleAtBothWidths(employer.page);

    // The same buttons on a result card of the directory (FR-L1 AC9, FR-L2 AC9).
    await employer.page.setViewportSize({ width: 1280, height: 900 });
    await employer.page.goto("/en/partners/staffing?destination=DE&occupation=7212");
    const card = employer.page.getByRole("main").getByRole("listitem").filter({ hasText: gamma.displayName });
    await card.getByRole("button", { name: `Save partner: ${gamma.displayName}` }).click();
    await expect(card.getByRole("button", { name: `Saved: ${gamma.displayName}` })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => savedRows(acme.id)).toEqual([gamma.id]);
    await card.getByRole("button", { name: `Follow: ${gamma.displayName}` }).click();
    await expect(card.getByRole("button", { name: `Following: ${gamma.displayName}` })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => follows(member.id)).toEqual([gamma.id]);
    await employer.close();

    const candidate = await createCommittedUser("worker");
    const worker = await signedIn(browser, candidate);
    await worker.page.goto(profileUrl(gamma.slug));
    await expect(worker.page.getByRole("button", { name: /^Save partner/ })).toHaveCount(0);
    await worker.page.getByRole("button", { name: `Follow: ${gamma.displayName}` }).click();
    await expect(worker.page.getByRole("button", { name: `Following: ${gamma.displayName}` })).toHaveAttribute("aria-pressed", "true");
    await expect(worker.page.getByText(`You follow ${gamma.displayName}`, { exact: true })).toBeVisible();
    await expect.poll(() => follows(candidate.id)).toEqual([gamma.id]);
    await worker.page.reload();
    await expect(worker.page.getByRole("button", { name: `Following: ${gamma.displayName}` }), "the state survives a reload").toBeVisible();
    await worker.close();
  });

  test("FR-K5 AC7, AC8: a candidate follows a company page and hears about its next vacancy once", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const acme = await employerWithPage();
    await page.goto(companyUrl(acme.slug));
    await expect(page.getByRole("link", { name: `Log in to follow ${acme.displayName}` })).toHaveAttribute(
      "href",
      `/en/login?next=${encodeURIComponent(companyUrl(acme.slug))}`,
    );

    const candidate = await createCommittedUser("worker");
    const worker = await signedIn(browser, candidate);
    await worker.page.goto(companyUrl(acme.slug));
    const follow = worker.page.getByRole("button", { name: `Follow: ${acme.displayName}` });
    await follow.focus();
    await worker.page.keyboard.press("Enter");
    await expect(worker.page.getByRole("button", { name: `Following: ${acme.displayName}` })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => follows(candidate.id)).toEqual([acme.id]);
    await expectAccessibleAtBothWidths(worker.page);

    // The owner publishes a draft (the lifecycle guard sets published_at), and the hourly digest runs.
    execute(`update public.follows set created_at = now() - interval '1 hour' where user_id = ${literal(candidate.id)}`);
    const jobId = seedJob(acme, { title: "Followed welder", status: "draft" });
    execute(
      `select set_config('request.jwt.claims', json_build_object('sub', ${literal(acme.owner.id)}, 'role', 'authenticated')::text, true);
       update public.jobs set status = 'open' where id = ${literal(jobId)};
       select private.queue_follower_digests(now() + interval '1 minute')`,
    );
    const items = query<{ n: number }>(
      `select count(*)::int as n from public.notifications where user_id = ${literal(candidate.id)} and kind = 'followed_company_activity'`,
    );
    expect(items[0].n).toBe(1);
    await worker.page.goto("/en/notifications");
    const item = worker.page.getByRole("link", { name: new RegExp(`${acme.displayName} published a new vacancy: Followed welder`) });
    await expect(item).toHaveAttribute("href", companyUrl(acme.slug));

    execute(`update public.organizations set public_page_enabled = false where id = ${literal(acme.id)}`);
    expect(follows(candidate.id), "turning the page off keeps the follow").toEqual([acme.id]);
    execute(`update public.organizations set public_page_enabled = true where id = ${literal(acme.id)}`);
    await worker.close();
  });

  test("AC10: the saved partners and followed companies, Remove, the empty state and a failed load", async ({ browser }) => {
    test.setTimeout(150_000);
    const gamma = await listedPartner();
    const lambda = await listedPartner();
    const beta = await employerWithPage();
    const acme = await newCompany();
    const member = await addCompanyUser(acme, "member");
    execute(
      `insert into public.saved_items (organization_id, target_organization_id, saved_by)
       values (${literal(acme.id)}, ${literal(gamma.id)}, ${literal(member.id)}), (${literal(acme.id)}, ${literal(lambda.id)}, ${literal(member.id)});
       insert into public.follows (user_id, organization_id) values (${literal(member.id)}, ${literal(beta.id)});
       update public.organizations set status = 'suspended' where id = ${literal(lambda.id)}`,
    );

    const employer = await signedIn(browser, member);
    await employer.page.goto("/en/dashboard/employer");
    await expect(employer.page.getByRole("link", { name: "Saved partners: 1" })).toHaveAttribute("href", savedUrl(acme.slug));
    await expect(employer.page.getByRole("link", { name: "Followed companies: 1" })).toHaveAttribute("href", "/en/following");

    await employer.page.getByRole("link", { name: "Saved partners: 1" }).click();
    await expect(employer.page.getByRole("heading", { level: 1 })).toHaveText("Saved partners");
    const rows = listRows(employer.page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByRole("link", { name: gamma.displayName })).toHaveAttribute("href", profileUrl(gamma.slug));
    await expect(rows.first()).toContainText("Recruitment company, based in Philippines");
    await expect(rows.first()).toContainText("Serves Germany");
    await expect(employer.page.getByRole("main")).not.toContainText(lambda.displayName);
    await expectAccessibleAtBothWidths(employer.page);

    await employer.page.setViewportSize({ width: 1280, height: 900 });
    await rows.first().getByRole("button", { name: `Remove ${gamma.displayName}` }).click();
    await expect(employer.page.getByRole("status").filter({ hasText: `${gamma.displayName} removed from your saved partners.` })).toBeAttached();
    await expect(employer.page.getByRole("heading", { name: "No saved partners yet" })).toBeVisible();
    expect(savedRows(acme.id), "the suspended partner's row is kept").toEqual([lambda.id]);

    await employer.page.goto("/en/following");
    const followed = listRows(employer.page);
    await expect(followed).toHaveCount(1);
    await expect(followed.first().getByRole("link", { name: beta.displayName })).toHaveAttribute("href", companyUrl(beta.slug));
    await followed.first().getByRole("button", { name: `Unfollow ${beta.displayName}` }).click();
    await expect(employer.page.getByRole("status").filter({ hasText: `${beta.displayName} is no longer followed.` })).toBeAttached();
    await expect.poll(() => follows(member.id)).toEqual([]);

    execute(`revoke execute on function ${LIST_FN} from authenticated`);
    try {
      await employer.page.goto(savedUrl(acme.slug));
      await expect(employer.page.getByRole("heading", { name: "Your saved partners could not be loaded" })).toBeVisible();
      await expect(employer.page.getByText("Your saved partners could not be loaded").first()).toBeVisible();
      await expect(employer.page.getByRole("button", { name: "Try again" })).toBeVisible();
    } finally {
      execute(`grant execute on function ${LIST_FN} to authenticated`);
    }
    await employer.close();

    const candidate = await createCommittedUser("worker");
    const worker = await signedIn(browser, candidate);
    await worker.page.goto("/en/dashboard/worker");
    await expect(worker.page.getByRole("link", { name: "Followed companies: 0" })).toBeVisible();
    await worker.page.goto("/en/following");
    await expect(worker.page.getByRole("heading", { name: "You do not follow any companies yet" })).toBeVisible();
    await expect(worker.page.getByRole("link", { name: "Find jobs" }).last()).toHaveAttribute("href", "/en/jobs");
    await expectAccessibleAtBothWidths(worker.page);
    await worker.close();
  });

  test("AC11: the followed company reads a count, never who follows it", async ({ browser }) => {
    test.setTimeout(120_000);
    const gamma = await listedPartner();
    const followers = await Promise.all([createCommittedUser("worker"), createCommittedUser("worker"), createCommittedUser("worker")]);
    execute(
      `insert into public.follows (user_id, organization_id)
       select unnest(array[${followers.map(({ id }) => literal(id)).join(", ")}]::uuid[]), ${literal(gamma.id)}`,
    );

    const owner = await signedIn(browser, gamma.user);
    const responses: Response[] = [];
    owner.page.on("response", (response) => responses.push(response));
    await owner.page.goto("/en/dashboard/employer");
    await expect(owner.page.getByText("Followers: fewer than 5")).toBeVisible();
    await expectAccessibleAtBothWidths(owner.page);
    await owner.page.goto(profileUrl(gamma.slug));
    await expect(owner.page.getByRole("button", { name: /^Follow/ }), "no Follow of its own company").toHaveCount(0);
    const bodies = (await Promise.all(responses.map((response) => response.text().catch(() => "")))).join("\n");
    for (const follower of followers) {
      expect(bodies.includes(follower.id), "a follower id leaked").toBe(false);
      expect(bodies.includes(follower.email), "a follower email leaked").toBe(false);
    }

    execute(
      `insert into public.follows (user_id, organization_id)
       select id, ${literal(gamma.id)} from public.profiles where account_kind = 'worker' and status = 'active'
         and id not in (select user_id from public.follows where organization_id = ${literal(gamma.id)}) limit 2`,
    );
    await owner.page.goto("/en/dashboard/employer");
    await expect(owner.page.getByText("Followers: 5")).toBeVisible();
    await owner.close();
  });
});
