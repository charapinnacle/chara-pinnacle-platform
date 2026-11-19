import { signInStaff } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { expect, test } from "./support/test";

// A plan price change from the console (FR-R2 AC8, AC9; SOP FR-R2 step Price) through billing-plan-price with the null
// provider of the local stack. The test uses a plan of its own that is not public, so no pricing or checkout spec sees
// its price, and removes it afterwards.

const CODE = "staffing_price_check";
const NAME = "Price Check";
const REASON = "Price review after the first quarter";
let firstAudit = 0;

function price(): number {
  return query<{ p: number }>(`select price_minor as p from billing.plans where code = ${literal(CODE)}`)[0].p;
}

function priceAudits(): { before: unknown; after: unknown; reason: string }[] {
  return query<{ before: unknown; after: unknown; reason: string }>(
    `select metadata -> 'before' as before, metadata -> 'after' as after, metadata ->> 'reason' as reason from audit.log
     where id > ${firstAudit} and action = 'billing.plan_changed' and entity_id = ${literal(CODE)} and metadata -> 'after' ? 'price_minor'
     order by id`,
  );
}

test.describe("the price change of the plan editor (FR-R2 AC8, AC9)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    execute(
      `insert into billing.plans (code, org_type, name, price_minor, currency, interval, trial_days, is_public, sort)
       values (${literal(CODE)}, 'staffing_company', ${literal(NAME)}, 1000, 'EUR', 'month', 0, false, 990)
       on conflict (code) do update set price_minor = 1000;
       delete from billing.plan_provider_refs where plan_code = ${literal(CODE)};`,
    );
    firstAudit = query<{ id: number }>("select coalesce(max(id), 0)::bigint as id from audit.log")[0].id;
  });

  test.afterAll(() => {
    execute(
      `delete from billing.plan_provider_refs where plan_code = ${literal(CODE)};
       delete from billing.plans where code = ${literal(CODE)};`,
    );
  });

  test("the administrator changes a paid plan's price after a confirmation that existing subscribers keep theirs", async ({ page }) => {
    test.setTimeout(120_000);
    await signInStaff(page, "admin", "/en/admin/plans");
    const staffing = page.getByRole("region", { name: "Plans for staffing companies" });
    await expect(staffing.getByRole("row").filter({ hasText: "free_staffing_company" }).getByRole("button", { name: /Change price/ })).toHaveCount(0);
    const row = staffing.getByRole("row").filter({ hasText: CODE });
    await expect(row).toContainText("EUR 10.00");

    const open = page.getByRole("button", { name: `Change price of ${NAME} (${CODE})` });
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `Change the price of ${NAME}` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Current price: EUR 10.00 per month, excluding VAT.");
    const amount = dialog.getByRole("textbox", { name: "New price per month (EUR, excluding VAT)" });
    const reason = dialog.getByRole("textbox", { name: "Reason for the change" });

    await dialog.getByRole("button", { name: "Review change" }).click();
    await expect(dialog.getByText("Enter an amount from 1.00 to 100,000.00, for example 54.00.").first()).toBeVisible();
    await expect(dialog.getByText("Give a reason of at least 10 characters.").first()).toBeVisible();
    await amount.fill("10.00");
    await reason.fill(REASON);
    await dialog.getByRole("button", { name: "Review change" }).click();
    await expect(dialog.getByText("Enter a price other than the current one.").first()).toBeVisible();

    await amount.fill("12.50");
    await dialog.getByRole("button", { name: "Review change" }).click();
    await expect(dialog).toContainText("Price per month, excluding VAT: EUR 10.00 -> EUR 12.50");
    await expect(dialog).toContainText("Existing subscribers keep their current price until they are moved at the payment provider.");
    expect(price()).toBe(1000);
    await expectNoAxeViolations(page);

    await dialog.getByRole("button", { name: "Change price" }).dblclick();
    await expect(page.getByText(`The price of ${NAME} is changed`, { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("EUR 12.50");
    expect(price()).toBe(1250);
    expect(priceAudits()).toEqual([
      { before: { price_minor: 1000, provider_price_ref: null }, after: { price_minor: 1250, provider_price_ref: null }, reason: REASON },
    ]);

    await page.getByRole("link", { name: `History of ${NAME} (${CODE})` }).click();
    const newest = page.getByRole("region", { name: `Changes of ${CODE}, newest first` }).getByRole("row").nth(1);
    await expect(newest).toContainText("Price, Provider price");
    await expect(newest).toContainText(REASON);
  });

  test("a refused change keeps the values entered, shows an error toast and changes nothing", async ({ page }) => {
    test.setTimeout(120_000);
    // A plan whose price is already held at Stripe cannot change without a Stripe price, which the null provider never
    // creates: the database refuses the record after the function ran.
    execute(
      `insert into billing.plan_provider_refs (plan_code, provider, provider_product_ref, provider_price_ref)
       values (${literal(CODE)}, 'stripe', 'prod_price_check', 'price_price_check')`,
    );
    const before = price();
    await signInStaff(page, "admin", "/en/admin/plans");
    await page.getByRole("button", { name: `Change price of ${NAME} (${CODE})` }).click();
    const dialog = page.getByRole("dialog", { name: `Change the price of ${NAME}` });
    await dialog.getByRole("textbox", { name: "New price per month (EUR, excluding VAT)" }).fill("15");
    await dialog.getByRole("textbox", { name: "Reason for the change" }).fill("A change the database refuses");
    await dialog.getByRole("button", { name: "Review change" }).click();
    await dialog.getByRole("button", { name: "Change price" }).click();
    await expect(page.getByText("The price was not changed", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "New price per month (EUR, excluding VAT)" })).toHaveValue("15");
    await expect(dialog.getByRole("textbox", { name: "Reason for the change" })).toHaveValue("A change the database refuses");
    expect(price()).toBe(before);
    expect(priceAudits()).toHaveLength(1);
  });
});
