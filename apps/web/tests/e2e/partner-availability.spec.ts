import { expectAccessibleAtBothWidths } from "./support/applications";
import { execute, executeAsync, literal, query } from "./support/db";
import { enrollTotp } from "./support/login";
import { createCommittedPartner, partnerWithCompany, pickWithKeys, setPartnerRelease } from "./support/partners";
import { signInAtAal1, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

interface ListingRow {
  id: string;
  occupation_id: string;
  source_country: string;
  available: number;
  monthly_capacity: number;
  available_from: string;
  confirmed_today: boolean;
  created_by: string;
}

function listings(organizationId: string): ListingRow[] {
  return query<ListingRow>(
    `select id, occupation_id, source_country, available, monthly_capacity, available_from::text,
            confirmed_at > now() - interval '5 minutes' as confirmed_today, created_by
     from public.workforce_availability where organization_id = ${literal(organizationId)} order by created_at`,
  );
}

// The profile a listing draws on: welders and plumbers, sourced from the Philippines and Nepal.
function seedProfile(organizationId: string): void {
  execute(
    `insert into public.organization_occupations (organization_id, occupation_id)
     values (${literal(organizationId)}, '7212'), (${literal(organizationId)}, '7126');
     insert into public.organization_geographies (organization_id, scope, country_code)
     values (${literal(organizationId)}, 'sources_from', 'PH'), (${literal(organizationId)}, 'sources_from', 'NP')`,
  );
}

function seedListing(organizationId: string, occupation: string, country: string, confirmedDaysAgo: number): void {
  execute(
    `insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
       available_from, confirmed_at)
     values (${literal(organizationId)}, ${literal(occupation)}, ${literal(country)}, 60, 30, current_date + 10,
       now() - make_interval(days => ${confirmedDaysAgo}))`,
  );
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// The release switch is set for the whole database while this file runs, so it is a project of its own that follows the
// other partner specs (playwright.config.ts), and the tests run one after the other.
test.describe("Workforce availability (FR-K3)", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => setPartnerRelease(true));
  test.afterAll(() => setPartnerRelease(false));

  test("AC1: the owner adds a listing by keyboard and the list says it was confirmed today", async ({ page }) => {
    test.setTimeout(90_000);
    const { user, id, slug } = await partnerWithCompany("staffing_company");
    seedProfile(id);
    const secret = await enrollTotp(user);
    await signInAtAal2(page, user, secret, `/en/org/${slug}/workforce-profile`);

    const section = page.getByRole("region", { name: "Availability" });
    await expect(section.getByRole("heading", { name: "No availability listed yet" })).toBeVisible();
    await expectAccessibleAtBothWidths(page);

    const add = section.getByRole("button", { name: "Add a listing" });
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add a listing" });
    await expect(dialog).toBeVisible();
    await pickWithKeys(page, "Occupation", "Weld", "Welders and flame cutters");
    await pickWithKeys(page, "Source country", "Phil", "Philippines");
    await dialog.getByLabel("Workers available now").fill("120");
    await dialog.getByLabel("Monthly capacity").fill("40");
    await dialog.getByLabel("Available from").fill("2027-03-01");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog.getByRole("button", { name: "Save listing" }).press("Enter");

    await expect(page.getByText("Listing saved", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    const item = section.getByRole("listitem");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("Welders and flame cutters, Philippines");
    await expect(item).toContainText("120 available, 40 per month, from 1 March 2027");
    await expect(item).toContainText("Confirmed today.");

    const [row] = listings(id);
    expect(row).toMatchObject({
      occupation_id: "7212",
      source_country: "PH",
      available: 120,
      monthly_capacity: 40,
      available_from: "2027-03-01",
      confirmed_today: true,
      created_by: user.id,
    });
    const audits = query<{ metadata: { new: Record<string, unknown> } }>(
      `select metadata from audit.log where action = 'workforce_availability.created' and entity_id = ${literal(row.id)}`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata.new).toMatchObject({ occupation_id: "7212", source_country: "PH", available: 120, monthly_capacity: 40 });

    // The same occupation and country again is refused at the field; a number out of range before anything is sent.
    await add.click();
    await pickWithKeys(page, "Occupation", "Weld", "Welders and flame cutters");
    await pickWithKeys(page, "Source country", "Phil", "Philippines");
    await dialog.getByLabel("Workers available now").fill("100001");
    await dialog.getByLabel("Monthly capacity").fill("40");
    await dialog.getByRole("button", { name: "Save listing" }).click();
    await expect(dialog.getByText("Enter a whole number from 1 to 100,000.").first()).toBeVisible();
    await dialog.getByLabel("Workers available now").fill("50");
    await dialog.getByRole("button", { name: "Save listing" }).click();
    await expect(dialog.getByText("You already list this occupation from this country.").first()).toBeVisible();
    expect(listings(id)).toHaveLength(1);
  });

  test("AC10: stale and due listings are marked; Confirm updates the label without a reload; edit, a failed save and delete", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { user, id, slug } = await partnerWithCompany("recruitment_company");
    seedProfile(id);
    seedListing(id, "7212", "PH", 50);
    seedListing(id, "7126", "NP", 65);
    const secret = await enrollTotp(user);
    await signInAtAal2(page, user, secret, `/en/org/${slug}/workforce-profile`);

    const section = page.getByRole("region", { name: "Availability" });
    const items = section.getByRole("listitem");
    await expect(items).toHaveCount(2);
    const stale = items.filter({ hasText: "Plumbers and pipe fitters, Nepal" });
    const due = items.filter({ hasText: "Welders and flame cutters, Philippines" });
    await expect(items.first()).toContainText("Plumbers and pipe fitters, Nepal");
    await expect(stale).toContainText("Hidden from search");
    await expect(stale).toContainText("Confirmed 65 days ago");
    await expect(due).not.toContainText("Hidden from search");
    await expect(due).toContainText("Confirm within 10 days to stay visible.");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // Confirming updates the label in place (no navigation) and is announced in a toast.
    await page.evaluate(() => {
      (window as Window & { untouched?: boolean }).untouched = true;
    });
    await stale.getByRole("button", { name: "Confirm the listing for Plumbers and pipe fitters from Nepal" }).click();
    await expect(page.getByText("Listing confirmed: Plumbers and pipe fitters from Nepal", { exact: true })).toBeVisible();
    await expect(section.getByText("Hidden from search")).toHaveCount(0);
    await expect(items.filter({ hasText: "Plumbers and pipe fitters, Nepal" })).toContainText("Confirmed today.");
    expect(await page.evaluate(() => (window as Window & { untouched?: boolean }).untouched)).toBe(true);
    const confirmed = query<{ count: number }>(
      `select count(*)::integer as count from audit.log a join public.workforce_availability w on a.entity_id = w.id::text
       where a.action = 'workforce_availability.confirmed' and w.organization_id = ${literal(id)}`,
    );
    expect(confirmed[0].count).toBe(1);

    // Edit keeps the occupation and country; a failed save keeps the dialog and its values.
    await due.getByRole("button", { name: "Edit the listing for Welders and flame cutters from Philippines" }).click();
    const edit = page.getByRole("dialog", { name: "Edit the listing" });
    await expect(edit).toContainText("Welders and flame cutters from Philippines");
    await expect(edit.getByLabel("Workers available now")).toHaveValue("60");
    await edit.getByLabel("Workers available now").fill("75");
    await edit.getByLabel("Available from").fill(inDays(800));
    await edit.getByRole("button", { name: "Save listing" }).click();
    await expect(edit.getByText("Choose a date up to 730 days ahead.").first()).toBeVisible();
    await edit.getByLabel("Available from").fill(inDays(30));
    execute(`revoke execute on function public.update_workforce_availability(uuid, integer, integer, date) from authenticated`);
    try {
      await edit.getByRole("button", { name: "Save listing" }).click();
      await expect(page.getByText("Could not save the listing", { exact: true })).toBeVisible();
    } finally {
      execute(`grant execute on function public.update_workforce_availability(uuid, integer, integer, date) to authenticated`);
    }
    await expect(edit).toBeVisible();
    await expect(edit.getByLabel("Workers available now")).toHaveValue("75");
    await edit.getByRole("button", { name: "Save listing" }).click();
    await expect(page.getByText("Listing saved", { exact: true })).toBeVisible();
    await expect(due).toContainText("75 available, 30 per month");
    await expect(due).toContainText("Confirmed today.");
    expect(listings(id).find((row) => row.source_country === "PH")).toMatchObject({ available: 75, available_from: inDays(30) });

    // Delete, after a confirmation.
    await stale.getByRole("button", { name: "Delete the listing for Plumbers and pipe fitters from Nepal" }).click();
    const remove = page.getByRole("dialog", { name: "Delete the listing for Plumbers and pipe fitters from Nepal?" });
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await remove.getByRole("button", { name: "Delete listing" }).click();
    await expect(page.getByText("Listing deleted", { exact: true })).toBeVisible();
    await expect(items).toHaveCount(1);
    expect(listings(id).map((row) => row.source_country)).toEqual(["PH"]);
  });

  test("AC4: a member reads the listings without changing them, and a skeleton shows while they load", async ({ page }) => {
    test.setTimeout(90_000);
    const { id, slug } = await partnerWithCompany("staffing_company");
    seedProfile(id);
    seedListing(id, "7212", "PH", 3);
    const member = await createCommittedPartner("staffing_company");
    execute(
      `insert into public.organization_members (organization_id, user_id, role, accepted_at)
       values (${literal(id)}, ${literal(member.id)}, 'member', now())`,
    );
    const path = `/en/org/${slug}/workforce-profile`;
    await signInAtAal1(page, member, path);

    const section = page.getByRole("region", { name: "Availability" });
    await expect(section.getByRole("listitem")).toContainText("Confirmed 3 days ago");
    await expect(section.getByRole("button")).toHaveCount(0);
    await expectAccessibleAtBothWidths(page);

    const held = executeAsync("begin; lock table public.workforce_availability in access exclusive mode; select pg_sleep(4); commit;");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.goto(path, { waitUntil: "commit" });
    await expect(section.getByRole("status", { name: "Loading" })).toBeVisible({ timeout: 15_000 });
    await expect(section.getByRole("listitem")).toContainText("Confirmed 3 days ago", { timeout: 15_000 });
    await expect(section.getByRole("status", { name: "Loading" })).toHaveCount(0);
    await held;
  });

  test("removing a source country or an occupation warns before Save and deletes its listings, audited", async ({ page }) => {
    test.setTimeout(90_000);
    const { user, id, slug } = await partnerWithCompany("recruitment_company");
    seedProfile(id);
    execute(
      `insert into public.organization_geographies (organization_id, scope, country_code) values (${literal(id)}, 'serves_market', 'DE');
       update public.organizations set recruitment_type = 'both' where id = ${literal(id)}`,
    );
    seedListing(id, "7212", "PH", 3);
    seedListing(id, "7126", "PH", 3);
    seedListing(id, "7212", "NP", 3);
    const secret = await enrollTotp(user);
    await signInAtAal2(page, user, secret, `/en/org/${slug}/workforce-profile`);

    const serve = page.getByRole("region", { name: "Where you serve" });
    await serve.getByRole("button", { name: "Remove Philippines" }).click();
    await expect(serve.getByRole("status")).toHaveText("Removing Philippines also deletes 2 availability listings.");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await serve.getByRole("button", { name: "Save countries" }).click();
    await expect(page.getByText("Countries saved", { exact: true })).toBeVisible();
    await expect(serve.getByText("Removing Philippines")).toHaveCount(0);
    expect(listings(id).map((row) => `${row.occupation_id}${row.source_country}`)).toEqual(["7212NP"]);

    const offer = page.getByRole("region", { name: "What you offer" });
    await offer.getByRole("button", { name: "Remove Welders and flame cutters" }).click();
    await expect(offer.getByRole("status")).toHaveText("Removing Welders and flame cutters also deletes 1 availability listing.");
    await offer.getByRole("button", { name: "Save what you offer" }).click();
    await expect(page.getByText("Workforce offer saved", { exact: true })).toBeVisible();
    expect(listings(id)).toHaveLength(0);
    expect(
      query<{ reason: string }>(
        `select metadata ->> 'reason' as reason from audit.log
         where action = 'workforce_availability.removed_with_profile' and metadata ->> 'organization_id' = ${literal(id)}
         order by id`,
      ).map((row) => row.reason),
    ).toEqual(["source_country_removed", "source_country_removed", "occupation_removed"]);
  });

  test("the owner is told to fill the profile first, and a plan without listings shows the upgrade prompt", async ({ page }) => {
    test.setTimeout(90_000);
    const { user, id, slug } = await partnerWithCompany("recruitment_company");
    const secret = await enrollTotp(user);
    await signInAtAal2(page, user, secret, `/en/org/${slug}/workforce-profile`);
    const section = page.getByRole("region", { name: "Availability" });
    await expect(section).toContainText("Add them above first.");
    await expect(section.getByRole("button", { name: "Add a listing" })).toHaveCount(0);

    // A lapsed partner falls back to its free plan, which includes no listing (AC3).
    seedProfile(id);
    execute(
      `insert into billing.subscriptions (organization_id, plan_code, status, provider)
       values (${literal(id)}, 'recruitment_partner', 'canceled', 'null')`,
    );
    await page.reload();
    await expect(section).toContainText("Workforce listings are not included in your Free plan.");
    await expect(section).toContainText(
      "Basic includes 10 workforce listings; Professional includes 50 workforce listings; Enterprise has no limit.",
    );
    await expect(section.getByRole("button", { name: "Add a listing" })).toHaveCount(0);
  });
});
