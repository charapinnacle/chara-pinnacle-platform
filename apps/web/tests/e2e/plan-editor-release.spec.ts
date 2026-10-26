import { signInStaff } from "./support/admin";
import { billingPath, expectPlan } from "./support/billing";
import { execute, literal, query } from "./support/db";
import { enrollTotp } from "./support/login";
import { partnerWithCompany, setPartnerRelease } from "./support/partners";
import { newVisitor, signInAtAal2 } from "./support/team";
import { expect, test } from "./support/test";

// The settings editor refuses release 2a while its legal texts are drafts (the go-live gate), and with the release on the
// partner pricing and billing pages follow a plan change at the next request (FR-R2 AC7, AC12). The switch and
// the plan rows are changed for the whole database, so this file is a project of its own after the other partner specs.
test.describe("the go-live gate of the settings editor and the public pages after a plan change (FR-R2)", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    execute(
      `update billing.plans set name = 'Professional' where code = 'recruitment_professional';
       update billing.plan_limits set limit_value = 10 where plan_code = 'recruitment_professional' and limit_key = 'markets';`,
    );
    setPartnerRelease(false);
  });

  test("AC7: the release switch is refused while its legal texts are drafts, and AC12: pricing and billing pages show the renamed plan and its new limit", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    setPartnerRelease(false);
    await signInStaff(page, "admin", "/en/admin/settings");
    const release = page.getByRole("region", { name: "Release switches" }).getByRole("row").filter({ hasText: "release_partner_directories" });
    await expect(release).toContainText("not approved");
    await release.getByRole("button", { name: /^Change/ }).click();
    const dialog = page.getByRole("dialog", { name: /Release 2a/ });
    await dialog.getByLabel("Value", { exact: true }).selectOption("true");
    await dialog.getByRole("textbox", { name: "Reason for the change" }).fill("Release 2a accepted by the client");
    await dialog.getByRole("button", { name: "Review change" }).click();
    // The seeded legal texts of release 2a are drafts (privacy-policy among them, which every account has accepted, so a
    // spec cannot publish approved versions without asking everyone to accept them again): the gate refuses the switch,
    // and 135_plan_editor.test.sql proves it goes on once the texts are approved.
    await expect(dialog.getByText("The release cannot go live until these legal documents are approved:")).toBeVisible();
    await expect(dialog.getByText("partner-terms: still a draft")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Switch the release on" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Back" }).click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(query<{ v: string }>(`select value #>> '{}' as v from private.settings where key = 'release_partner_directories'`)[0].v).toBe("false");

    setPartnerRelease(true);
    await page.reload();
    await expect(release).toContainText("Live");
    await expect(page.getByRole("navigation", { name: "Administration" }).first().getByRole("link", { name: "Partner reviews" })).toBeVisible();

    const { user, id, slug } = await partnerWithCompany("recruitment_company");
    execute(`insert into billing.subscriptions (organization_id, plan_code, status, provider) values (${literal(id)}, 'recruitment_professional', 'active', 'null')`);
    const owner = await newVisitor(browser);
    await signInAtAal2(owner.page, user, await enrollTotp(user), billingPath(slug));
    await expectPlan(owner.page, "Professional", "Active");
    await expect(owner.page.getByRole("progressbar", { name: "Countries served" })).toHaveAttribute("aria-valuemax", "10");
    const visitor = await newVisitor(browser);
    await visitor.page.goto("/en/pricing");
    await visitor.page.getByRole("tab", { name: "Recruitment companies" }).click();
    const panel = visitor.page.getByRole("tabpanel", { name: "Recruitment companies" });
    await expect(panel.getByRole("heading", { level: 3 })).toHaveText(["Basic", "Professional", "Enterprise"]);
    await expect(panel).toContainText("10 countries served");

    await page.goto("/en/admin/plans");
    await page.getByRole("button", { name: "Edit Professional (recruitment_professional)" }).click();
    const edit = page.getByRole("dialog", { name: "Edit Professional" });
    await edit.getByRole("textbox", { name: "Name" }).fill("Professional Plus");
    await edit.getByRole("textbox", { name: "Countries served" }).fill("12");
    await edit.getByRole("textbox", { name: "Reason for the change" }).fill("New name and more markets for 2027");
    await edit.getByRole("button", { name: "Review changes" }).click();
    await expect(edit.getByRole("listitem")).toHaveText(["Name: Professional -> Professional Plus", "Countries served: 10 -> 12"]);
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Professional Plus is saved", { exact: true })).toBeVisible();

    await visitor.page.reload();
    await visitor.page.getByRole("tab", { name: "Recruitment companies" }).click();
    await expect(panel.getByRole("heading", { level: 3 })).toHaveText(["Basic", "Professional Plus", "Enterprise"]);
    await expect(panel.getByRole("listitem").filter({ has: visitor.page.getByRole("heading", { name: "Professional Plus" }) })).toContainText(
      "12 countries served",
    );
    await owner.page.reload();
    await expectPlan(owner.page, "Professional Plus", "Active");
    await expect(owner.page.getByRole("progressbar", { name: "Countries served" })).toHaveAttribute("aria-valuemax", "12");
    await owner.context.close();
    await visitor.context.close();
  });
});
