import type { Page } from "@playwright/test";
import { expectAccessibleAtBothWidths } from "./support/applications";
import { enrolledStaff, signInStaff } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { execute, literal, query } from "./support/db";
import { createCommittedUser, enrollTotp } from "./support/login";
import { logIn } from "./support/login-page";
import { newOwner, staffUser } from "./support/mfa";
import { uniqueName } from "./support/organizations";
import { newTeam, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

// The plan, limit, feature, override and settings editor (FR-R2 AC1, AC5, AC7, AC10, AC11). The tests change plan rows and
// settings of the whole database that no spec of this project reads (the partner plans, staffing_professional and an
// upgrade-prompt ceiling) and put each value back; they run one after the other.

const REASON = "Raise after first month of usage review";

function limitValue(plan: string, key: string): number | null {
  return query<{ v: number | null }>(`select limit_value as v from billing.plan_limits where plan_code = ${literal(plan)} and limit_key = ${literal(key)}`)[0].v;
}

function auditCount(plan: string, key: string): number {
  return query<{ n: number }>(
    `select count(*)::int as n from audit.log where action = 'billing.plan_changed' and entity_id = ${literal(plan)} and metadata ->> 'limit_key' = ${literal(key)}`,
  )[0].n;
}

// An editor RPC called in the database as the administrator at aal2, as PostgREST would call it.
function callAsAdmin(userId: string, sql: string): void {
  execute(
    `select set_config('request.jwt.claims', json_build_object('sub', ${literal(userId)}, 'role', 'authenticated', 'aal', 'aal2')::text, true); ${sql}`,
  );
}

function planRow(page: Page, section: string, code: string) {
  return page.getByRole("region", { name: `Plans for ${section}` }).getByRole("row").filter({ hasText: code });
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test.describe("the plan and settings editor of the console (FR-R2)", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    execute(
      `update billing.plan_limits set limit_value = 10 where plan_code = 'recruitment_partner' and limit_key = 'job_order_responses_per_month';
       update billing.plan_limits set limit_value = 5 where plan_code = 'staffing_professional' and limit_key = 'members';
       update billing.plans set trial_days = 30 where code = 'staffing_professional';
       update private.settings set value = '10' where key = 'limit_prompt_per_org_key_hour_max';
       grant execute on function public.admin_set_plan_limit(text, text, integer, text) to authenticated;`,
    );
  });

  test("AC1: the administrator at aal2 reads every plan by type; aal1 is sent to two-step verification; others are refused", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/en/admin/plans");
    await expect(page).toHaveURL(`/en/login?next=${encodeURIComponent("/en/admin/plans")}`);

    await logIn(page, await newOwner());
    await expect(page).not.toHaveURL(/\/en\/login/);
    expect((await page.goto("/en/admin/plans"))?.status()).toBe(404);
    await page.context().clearCookies();

    await signInStaff(page, "trust_safety");
    expect((await page.goto("/en/admin/plans"))?.status()).toBe(404);
    expect((await page.goto("/en/admin/settings"))?.status()).toBe(404);
    await page.context().clearCookies();

    const aal1 = await staffUser("admin");
    await enrollTotp(aal1);
    await logIn(page, aal1);
    await expect(page).not.toHaveURL(/\/en\/login/);
    await page.goto("/en/admin/plans");
    await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent("/en/admin/plans")}`);
    await page.context().clearCookies();

    await signInStaff(page, "admin", "/en/admin/plans");
    await expect(page.getByRole("heading", { name: "Plans and limits", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Employers", "Recruitment companies", "Staffing companies"]);
    const basic = planRow(page, "recruitment companies", "recruitment_partner");
    await expect(basic).toContainText("Basic");
    await expect(basic).toContainText("EUR 49.00");
    await expect(basic).toContainText("Public");
    await expect(basic).toContainText("Job order responses per month: 10");
    await expect(basic).toContainText("Job order access: On");
    await expect(basic).toContainText("Enterprise analytics: Off");
    const enterprise = planRow(page, "recruitment companies", "recruitment_enterprise");
    await expect(enterprise).toContainText("Countries served: Unlimited");
    await expect(enterprise.getByRole("cell").nth(4)).toHaveText("Yes");
    await expect(planRow(page, "staffing companies", "free_staffing_company")).toContainText("Not public");
    await expect(planRow(page, "employers", "employer_starter")).toContainText("Open vacancies");
    await expect(page.getByRole("navigation", { name: "Plans and limits" }).getByRole("link", { name: "Plans" })).toHaveAttribute("aria-current", "page");
    await expectAccessibleAtBothWidths(page);
  });

  test("AC10: the edit dialog asks for a reason, confirms the change before saving, saves once and keeps the values on an error", async ({ page }) => {
    test.setTimeout(120_000);
    await signInStaff(page, "admin", "/en/admin/plans");
    const edit = page.getByRole("button", { name: "Edit Basic (recruitment_partner)" });
    await edit.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Edit Basic" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Basic");
    const reason = dialog.getByRole("textbox", { name: "Reason for the change" });
    await expect(reason).toHaveValue("");

    await dialog.getByRole("button", { name: "Review changes" }).click();
    await expect(dialog.getByText("Give a reason of at least 10 characters").first()).toBeVisible();
    await expect(reason).toBeFocused();

    await dialog.getByRole("textbox", { name: "Job order responses per month" }).fill("12");
    await reason.fill(REASON);
    await dialog.getByRole("button", { name: "Review changes" }).click();
    await expect(dialog.getByRole("listitem")).toHaveText(["Job order responses per month: 10 -> 12"]);
    expect(limitValue("recruitment_partner", "job_order_responses_per_month")).toBe(10);
    await expectNoAxeViolations(page);

    const before = auditCount("recruitment_partner", "job_order_responses_per_month");
    await dialog.getByRole("button", { name: "Save changes" }).dblclick();
    await expect(page.getByText("Basic is saved", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(planRow(page, "recruitment companies", "recruitment_partner")).toContainText("Job order responses per month: 12");
    expect(limitValue("recruitment_partner", "job_order_responses_per_month")).toBe(12);
    expect(auditCount("recruitment_partner", "job_order_responses_per_month")).toBe(before + 1);

    execute("revoke execute on function public.admin_set_plan_limit(text, text, integer, text) from authenticated");
    try {
      await edit.click();
      await dialog.getByRole("textbox", { name: "Job order responses per month" }).fill("13");
      await dialog.getByRole("textbox", { name: "Reason for the change" }).fill("Another raise that fails");
      await dialog.getByRole("button", { name: "Review changes" }).click();
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("The changes were not saved", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("textbox", { name: "Job order responses per month" })).toHaveValue("13");
      await expect(dialog.getByRole("textbox", { name: "Reason for the change" })).toHaveValue("Another raise that fails");
      expect(limitValue("recruitment_partner", "job_order_responses_per_month")).toBe(12);
    } finally {
      execute("grant execute on function public.admin_set_plan_limit(text, text, integer, text) to authenticated");
    }
  });

  test("AC11: the history lists the changes newest first, and the overrides tab sets, lists, marks and removes overrides", async ({ page }) => {
    test.setTimeout(180_000);
    const other = await enrolledStaff("admin");
    execute(`update public.profiles set display_name = 'Second Administrator' where id = ${literal(other.user.id)}`);
    const admin = await signInStaff(page, "admin", "/en/admin/plans");
    execute(`update public.profiles set display_name = 'First Administrator' where id = ${literal(admin.user.id)}`);
    callAsAdmin(admin.user.id, `select public.admin_set_plan_limit('staffing_professional', 'members', 6, 'First change of the members')`);
    callAsAdmin(other.user.id, `select public.admin_set_plan_limit('staffing_professional', 'members', 7, 'Second change of the members')`);
    callAsAdmin(admin.user.id, `select public.admin_update_plan('staffing_professional', 'Professional', true, 21, 'Third change, a shorter trial')`);

    await page.getByRole("link", { name: "History of Professional (staffing_professional)" }).click();
    await expect(page.getByRole("heading", { name: "History of Professional", level: 1 })).toBeVisible();
    const rows = page.getByRole("region", { name: "Changes of staffing_professional, newest first" }).getByRole("row");
    await expect(rows.nth(1)).toContainText("First Administrator");
    await expect(rows.nth(1)).toContainText("Trial days");
    await expect(rows.nth(1)).toContainText("Third change, a shorter trial");
    await expect(rows.nth(1).getByRole("cell").nth(3)).toHaveText("30");
    await expect(rows.nth(1).getByRole("cell").nth(4)).toHaveText("21");
    await expect(rows.nth(2)).toContainText("Second Administrator");
    await expect(rows.nth(2).getByRole("cell").nth(2)).toHaveText("Team members");
    await expect(rows.nth(2).getByRole("cell").nth(3)).toHaveText("6");
    await expect(rows.nth(2).getByRole("cell").nth(4)).toHaveText("7");
    await expect(rows.nth(3)).toContainText("First change of the members");
    await expect(page.getByRole("main")).not.toContainText(/customer|card|subscription/i);
    await expectAccessibleAtBothWidths(page);

    const team = await newTeam(uniqueName("Enterprise Bau"));
    execute(`insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(team.id)}, 'employer_enterprise', 'active', 'null')`);
    await page.getByRole("navigation", { name: "Plans and limits" }).getByRole("link", { name: "Overrides" }).click();
    await expect(page.getByRole("heading", { name: "Limit overrides", level: 1 })).toBeVisible();
    const name = query<{ display_name: string }>(`select display_name from public.organizations where id = ${literal(team.id)}`)[0].display_name;
    await page.getByLabel("Organisation", { exact: true }).selectOption({ label: `${name} (employer_enterprise)` });
    await page.getByLabel("Limit", { exact: true }).selectOption({ label: "Team members" });
    await page.getByLabel("Value", { exact: true }).fill("40");
    await page.getByLabel("Expires on", { exact: true }).fill(inDays(90));
    await page.getByLabel("Reason for the change", { exact: true }).fill("Fair-use raise agreed in the contract");
    await page.getByRole("button", { name: "Save override" }).click();
    await expect(page.getByText("The override is saved", { exact: true })).toBeVisible();
    const row = page.getByRole("region", { name: "Limit overrides" }).getByRole("row").filter({ hasText: name }).filter({ hasText: "Team members" });
    await expect(row).toContainText("40");
    await expect(row).toContainText("15");
    await expect(row).toContainText("Fair-use raise agreed in the contract");
    await expect(row).not.toContainText("Expired");
    expect(query<{ v: number }>(`select private.org_limit(${literal(team.id)}, 'members') as v`)[0].v).toBe(40);

    execute(
      `insert into billing.organization_limit_overrides (organization_id, limit_key, limit_value, expires_at)
       values (${literal(team.id)}, 'active_jobs', 80, now() - interval '1 day')`,
    );
    await page.reload();
    const expired = page.getByRole("region", { name: "Limit overrides" }).getByRole("row").filter({ hasText: name }).filter({ hasText: "Open vacancies" });
    await expect(expired).toContainText("Expired");
    await expectAccessibleAtBothWidths(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await row.getByRole("button", { name: /^Remove/ }).click();
    const remove = page.getByRole("dialog", { name: "Remove an override" });
    await remove.getByRole("textbox", { name: "Reason for the change" }).fill("Contract ended early");
    await remove.getByRole("button", { name: "Remove override" }).click();
    await expect(page.getByText("The override is removed", { exact: true })).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(query<{ v: number }>(`select private.org_limit(${literal(team.id)}, 'members') as v`)[0].v).toBe(15);
  });

  test("AC7: settings are changed within their rules after a confirmation; a release switch is refused while its legal documents are drafts", async ({ page }) => {
    test.setTimeout(120_000);
    await signInStaff(page, "admin", "/en/admin/settings");
    await expect(page.getByRole("heading", { name: "Platform settings", level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("entitlements_enforced");
    await expect(page.getByRole("main")).not.toContainText("audit_retention_years");

    const release = page.getByRole("region", { name: "Release switches" }).getByRole("row").filter({ hasText: "release_partner_directories" });
    await expect(release).toContainText("Off");
    await release.getByRole("button", { name: /^Change/ }).click();
    const releaseDialog = page.getByRole("dialog", { name: /Release 2a/ });
    await releaseDialog.getByLabel("Value", { exact: true }).selectOption("true");
    await releaseDialog.getByRole("textbox", { name: "Reason for the change" }).fill("Go live with release 2a now");
    await releaseDialog.getByRole("button", { name: "Review change" }).click();
    await expect(releaseDialog.getByText("The release cannot go live until these legal documents are approved:")).toBeVisible();
    await expect(releaseDialog.getByText("privacy-policy: still a draft")).toBeVisible();
    await expect(releaseDialog.getByRole("button", { name: "Switch the release on" })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await releaseDialog.getByRole("button", { name: "Back" }).click();
    await releaseDialog.getByRole("button", { name: "Cancel" }).click();
    expect(query<{ v: string }>(`select value #>> '{}' as v from private.settings where key = 'release_partner_directories'`)[0].v).toBe("false");

    const prompt = page.getByRole("region", { name: "Platform settings" }).getByRole("row").filter({ hasText: "limit_prompt_per_org_key_hour_max" });
    await expect(prompt.getByRole("cell").nth(1)).toHaveText("10");
    await prompt.getByRole("button", { name: /^Change/ }).click();
    const dialog = page.getByRole("dialog", { name: "Upgrade prompts recorded per organisation, limit and hour" });
    const value = dialog.getByRole("textbox", { name: "Value" });
    await value.fill("0");
    await dialog.getByRole("textbox", { name: "Reason for the change" }).fill("Allow more prompts per hour");
    await dialog.getByRole("button", { name: "Review change" }).click();
    await expect(dialog.getByText("Enter a whole number from 1 to 1000").first()).toBeVisible();
    await value.fill("11");
    await dialog.getByRole("button", { name: "Review change" }).click();
    await expect(dialog.getByText("Upgrade prompts recorded per organisation, limit and hour: 10 -> 11")).toBeVisible();
    await dialog.getByRole("button", { name: "Save setting" }).click();
    await expect(page.getByText("Upgrade prompts recorded per organisation, limit and hour is saved", { exact: true })).toBeVisible();
    await expect(prompt.getByRole("cell").nth(1)).toHaveText("11");
    expect(
      query<{ before: string; after: string; reason: string }>(
        `select metadata ->> 'before' as before, metadata ->> 'after' as after, metadata ->> 'reason' as reason from audit.log
         where action = 'setting.changed' and entity_id = 'limit_prompt_per_org_key_hour_max' order by id desc limit 1`,
      ),
    ).toEqual([{ before: "10", after: "11", reason: "Allow more prompts per hour" }]);
    await expectAccessibleAtBothWidths(page);
  });

  test("a candidate is refused the settings page", async ({ page }) => {
    await logIn(page, await createCommittedUser("worker"));
    await expect(page).not.toHaveURL(/\/en\/login/);
    expect((await page.goto("/en/admin/settings"))?.status()).toBe(404);
    expect((await page.goto("/en/admin/plans/overrides"))?.status()).toBe(404);
  });
});

test("the history of an unknown plan is not found", async ({ page }) => {
  const admin = await enrolledStaff("admin");
  await signInAtAal2(page, admin.user, admin.secret, "/en/admin/plans");
  expect((await page.goto("/en/admin/plans/recruitment_gold"))?.status()).toBe(404);
});
