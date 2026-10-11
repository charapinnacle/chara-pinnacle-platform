import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { choose } from "./support/combobox";
import { execute, literal } from "./support/db";
import { waitForHydration } from "./support/hydration";
import { expectNotFound, seedJob } from "./support/jobs";
import { alertText, logIn } from "./support/login-page";
import { enterCode } from "./support/mfa";
import { organizationAudit, organizationRows, SIMILAR_NAME_NOTICE } from "./support/organizations";
import { captureActionRequests } from "./support/server-action";
import { addMember, newTeam, signInAtAal2, subscribe } from "./support/team";
import { publicUrl } from "./support/vacancy-page";

const profileUrl = (slug: string) => `/en/org/${slug}/profile`;

const updates = (organizationId: string) => organizationAudit(organizationId).filter(({ action }) => action === "organization.updated");

test.describe("organisation profile", () => {
  test("FR-A2: the owner corrects the company details at aal2, the change is audited and the public vacancy shows it", async ({ page }) => {
    const team = await newTeam();
    const job = seedJob({ id: team.id, slug: team.slug, owner: team.owner }, { title: "Profile welder", status: "open" });
    const dashboard = `/en/dashboard/employer?org=${team.slug}`;

    await logIn(page, team.owner, dashboard);
    await page.getByRole("link", { name: "Enter your code" }).click();
    await enterCode(page, team.ownerSecret);
    await expect(page).toHaveURL(dashboard);
    await page.getByRole("region", { name: "Quick actions" }).getByRole("link", { name: "Edit company profile" }).click();
    await expect(page).toHaveURL(profileUrl(team.slug));
    const [before] = organizationRows(team.owner.id);
    await expect(page.getByLabel("Legal company name")).toHaveValue(before.legal_name);
    await expect(page.getByLabel("Display name (optional)")).toHaveValue(before.display_name);
    await expect(page.getByRole("combobox", { name: "Country", exact: true })).toHaveValue("Germany");
    await expect(page.getByRole("combobox", { name: "Industry", exact: true })).toHaveValue("Construction");
    await expect(page.getByText("No company registration number or VAT number is recorded yet.", { exact: false })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByLabel("Display name (optional)").fill("Nordbau Hamburg");
    await choose(page, "Country", "Austria");
    await choose(page, "Industry", "Manufacturing");
    await page.getByLabel("Website (optional)").fill("https://nordbau.example");
    await page.getByRole("button", { name: "Save profile" }).click();

    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();
    const [after] = organizationRows(team.owner.id);
    expect(after).toMatchObject({
      slug: team.slug,
      legal_name: before.legal_name,
      display_name: "Nordbau Hamburg",
      based_in_country: "AT",
      industry_code: "C",
      website: "https://nordbau.example",
    });
    expect(updates(team.id)).toEqual([
      {
        actor_id: team.owner.id,
        action: "organization.updated",
        entity_type: "organization",
        metadata: { changed_fields: ["based_in_country", "display_name", "industry_code", "website"], duplicate_legal_name: false },
      },
    ]);
    await page.reload();
    await expect(page.getByLabel("Display name (optional)")).toHaveValue("Nordbau Hamburg");
    await expect(page.getByRole("link", { name: "Nordbau Hamburg" }).first()).toBeVisible();

    await page.goto(publicUrl(job));
    const card = page.getByRole("region", { name: "Nordbau Hamburg" });
    await expect(card).toContainText("Based in Austria");
    await expect(card).toContainText("Industry: Manufacturing");
    await expect(card.getByRole("link", { name: /nordbau\.example/ })).toHaveAttribute("href", "https://nordbau.example/");
  });

  test("FR-A2 AC3: invalid values are refused next to their fields and nothing is saved", async ({ page }) => {
    const team = await newTeam();
    await signInAtAal2(page, team.owner, team.ownerSecret, profileUrl(team.slug));
    const [before] = organizationRows(team.owner.id);

    await page.getByLabel("Legal company name").fill("A");
    await page.getByLabel("Website (optional)").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(alertText(page)).toBeVisible();
    await expect(page.locator("#org-legal-name-error")).toHaveText("Legal name must be at least 2 characters.");
    await expect(page.locator("#org-website-error")).toHaveText("Enter a web address that starts with http:// or https://.");
    await expect(page.getByLabel("Legal company name")).toHaveAttribute("aria-invalid", "true");
    await expectNoAxeViolations(page);
    expect(organizationRows(team.owner.id)[0]).toMatchObject({ legal_name: before.legal_name, website: before.website });
    expect(updates(team.id)).toEqual([]);
  });

  test("FR-A2, FR-A5 roles: an admin at aal2 edits; an admin at aal1 is asked for a code; a member is refused; another owner gets not found", async ({
    page,
    browser,
  }) => {
    const team = await newTeam();
    const other = await newTeam();
    const admin = await addMember(team, "admin");
    const member = await addMember(team, "member");

    await signInAtAal2(page, admin.user, admin.secret ?? "", profileUrl(team.slug));
    await page.getByLabel("Display name (optional)").fill("Admin Bau");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();
    await expect(page.getByText("The owner records or corrects it on the billing page.", { exact: false })).toBeVisible();
    expect(updates(team.id)).toEqual([expect.objectContaining({ actor_id: admin.user.id })]);

    for (const [user, expected] of [
      [admin.user, `/en/mfa?next=${encodeURIComponent(profileUrl(team.slug))}`],
      [member.user, "/en/forbidden"],
    ] as const) {
      const context = await browser.newContext();
      const visitor = await context.newPage();
      await logIn(visitor, user, profileUrl(team.slug));
      await expect(visitor).toHaveURL(expected);
      await context.close();
    }
    const outsider = await browser.newContext();
    const outsiderPage = await outsider.newPage();
    await signInAtAal2(outsiderPage, other.owner, other.ownerSecret, profileUrl(other.slug));
    await expectNotFound(outsiderPage, profileUrl(team.slug));
    await outsider.close();
    expect(organizationRows(team.owner.id)[0].display_name).toBe("Admin Bau");
    expect(updates(team.id)).toHaveLength(1);
  });

  test("FR-A2: once a payment has started the legal name is locked while the other details stay editable; a duplicate name is reported", async ({
    page,
  }) => {
    const team = await newTeam();
    const rival = await newTeam();
    const [rivalRow] = organizationRows(rival.owner.id);
    await signInAtAal2(page, team.owner, team.ownerSecret, profileUrl(team.slug));

    await page.getByLabel("Legal company name").fill(`  ${rivalRow.legal_name.toUpperCase()} `);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("status").filter({ hasText: SIMILAR_NAME_NOTICE })).toBeVisible();
    expect(organizationRows(team.owner.id)[0].legal_name).toBe(rivalRow.legal_name.toUpperCase());
    expect(updates(team.id).at(-1)?.metadata).toEqual({ changed_fields: ["legal_name"], duplicate_legal_name: true });

    subscribe(team, "employer_starter");
    execute(`update public.organizations set legal_entity_identifier = 'DE123456789', legal_entity_identifier_kind = 'vat_number' where id = ${literal(team.id)}`);
    await page.reload();
    const legalName = page.getByLabel("Legal company name");
    await expect(legalName).toHaveAttribute("readonly", "");
    await expect(page.getByText("It cannot be changed once a payment has been started for the company.").first()).toBeVisible();
    await expect(page.getByText("VAT number: DE123456789.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to billing" })).toHaveCount(0);

    await page.getByLabel("Display name (optional)").fill("Locked Bau");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();
    expect(organizationRows(team.owner.id)[0]).toMatchObject({ legal_name: rivalRow.legal_name.toUpperCase(), display_name: "Locked Bau" });
    await expectNoAxeViolations(page);
  });

  test("FR-A2 AC12: a failed save keeps the values with a toast, a double click saves once, and a suspended organisation gets a notice", async ({
    page,
  }) => {
    const team = await newTeam();
    await signInAtAal2(page, team.owner, team.ownerSecret, profileUrl(team.slug));
    const [before] = organizationRows(team.owner.id);
    const save = page.getByRole("button", { name: "Save profile" });
    await waitForHydration(save);

    await page.route(`**${profileUrl(team.slug)}`, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await page.getByLabel("Display name (optional)").fill("Offline Bau");
    await save.click();
    await expect(page.getByText("Could not save the company profile", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Display name (optional)")).toHaveValue("Offline Bau");
    expect(organizationRows(team.owner.id)[0].display_name).toBe(before.display_name);
    expect(updates(team.id)).toEqual([]);

    await page.unroute(`**${profileUrl(team.slug)}`);
    const calls = captureActionRequests(page);
    await page.route(`**${profileUrl(team.slug)}`, async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await save.dblclick();
    await expect(page.getByRole("button", { name: "Saving..." })).toBeDisabled();
    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(updates(team.id)).toHaveLength(1);
    expect(organizationRows(team.owner.id)[0].display_name).toBe("Offline Bau");

    execute(`update public.organizations set status = 'suspended' where id = ${literal(team.id)}`);
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "This organization is suspended, so its details are not available." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save profile" })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("FR-A2: an emptied display name is saved as the legal name, and the form shows the stored value", async ({ page }) => {
    const team = await newTeam();
    await signInAtAal2(page, team.owner, team.ownerSecret, profileUrl(team.slug));
    const [before] = organizationRows(team.owner.id);
    await waitForHydration(page.getByRole("button", { name: "Save profile" }));

    await page.getByLabel("Display name (optional)").fill("");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Display name (optional)")).toHaveValue(before.legal_name);
    expect(organizationRows(team.owner.id)[0].display_name).toBe(before.legal_name);
  });
});
