import { expect, test } from "./support/test";
import { expectNoAxeViolations } from "./support/axe";
import { dataApiAs } from "./support/accounts";
import { createCommittedUser, enrollTotp, sessionClaims } from "./support/login";
import {
  organizationRows,
  registerOrganization,
  signInAsEmployer,
  uniqueName,
} from "./support/organizations";

test.describe("employer registration: after the organization exists", () => {
  test("FR-A2 AC11: an employer without an organization is sent to set it up, and one with an organization is sent to the dashboard", async ({
    page,
  }) => {
    const user = await createCommittedUser("company");
    await signInAsEmployer(page, user);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await page.getByRole("link", { name: "Set up your company" }).click();
    await expect(page).toHaveURL(/\/en\/onboarding$/);
    await expect(page.getByLabel("Legal company name")).toBeVisible();

    await registerOrganization(user, uniqueName("Redirect Bau GmbH"), "Redirect Bau");
    await signInAsEmployer(page, user);
    await page.goto("/en/onboarding");
    await expect(page).toHaveURL(/\/en\/dashboard\/employer$/);
  });

  test("FR-A2 AC11: the owner reaches the dashboard at aal1, sees the guided steps, and the first one is done after two-step setup", async ({
    page,
  }) => {
    const user = await createCommittedUser("company");
    await registerOrganization(user, uniqueName("Steps Bau GmbH"), "Steps Bau");
    await signInAsEmployer(page, user);
    expect((await sessionClaims(page.context())).aal).toBe("aal1");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Steps Bau", { exact: true })).toBeVisible();
    const steps = page.getByRole("main").getByRole("listitem");
    await expect(steps).toHaveText([
      "Set up two-step verification",
      "Start the free trial",
      "Post the first vacancy",
      "Invite a team member",
    ]);
    await expect(page.getByRole("link", { name: "Set up two-step verification" })).toHaveAttribute("href", "/en/mfa");
    await expectNoAxeViolations(page);

    await enrollTotp(user);
    await signInAsEmployer(page, user);
    await expect(steps.first()).toHaveText("Set up two-step verification (done)");
    await expect(page.getByRole("link", { name: "Set up two-step verification" })).toHaveCount(0);
  });

  test("FR-A2 AC10: another company's owner sees nothing of the organization and cannot change it through the Data API", async () => {
    const owner = await createCommittedUser("company");
    const other = await createCommittedUser("company");
    await registerOrganization(owner, uniqueName("Private Bau GmbH"), "Private Bau");
    const [organization] = organizationRows(owner.id);

    const organizations = await dataApiAs(other, `organizations?id=eq.${organization.id}&select=id,legal_name`);
    expect(organizations.status).toBe(200);
    expect(await organizations.json()).toEqual([]);
    const members = await dataApiAs(other, `organization_members?organization_id=eq.${organization.id}&select=user_id`);
    expect(members.status).toBe(200);
    expect(await members.json()).toEqual([]);

    const update = await dataApiAs(other, `organizations?id=eq.${organization.id}`, {
      method: "PATCH",
      body: { legal_entity_identifier: "ZZ999999", legal_entity_identifier_kind: "other" },
    });
    expect(update.status).toBe(403);
    expect(await update.json()).toMatchObject({ code: "42501" });

    const rpc = await dataApiAs(other, "rpc/set_legal_entity_identifier", {
      method: "POST",
      body: { p_org: organization.id, p_identifier: "DE123456789", p_kind: "vat_number" },
    });
    expect(rpc.status).toBe(400);
    expect(await rpc.json()).toMatchObject({ code: "P0001", message: "CHARA_FORBIDDEN", details: null });
    expect(organizationRows(owner.id)[0].legal_entity_identifier).toBeNull();
  });
});
