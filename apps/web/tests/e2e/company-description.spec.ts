import { expectAccessibleAtBothWidths } from "./support/applications";
import { query, literal } from "./support/db";
import { evidence } from "./support/evidence";
import { waitForHydration } from "./support/hydration";
import { seedJob } from "./support/jobs";
import { organizationAudit, organizationRows } from "./support/organizations";
import { signInAtAal2, newTeam } from "./support/team";
import { expect, test } from "./support/test";
import { publicUrl } from "./support/vacancy-page";

const profileUrl = (slug: string) => `/en/org/${slug}/profile`;
const LABEL = "About your company (optional)";

function stored(organizationId: string): string | null {
  return query<{ description: string | null }>(`select description from public.organizations where id = ${literal(organizationId)}`)[0].description;
}

test.describe("the company description", () => {
  test("FR-A2, FR-C4: an owner writes it with a count, the vacancy page shows it as plain text with its line breaks, and the audit row names the field only", async ({ page }) => {
    const team = await newTeam();
    const job = seedJob({ id: team.id, slug: team.slug, owner: team.owner }, { title: "Description welder", status: "open" });
    const text = "We build steel halls and bridges.\n\n  Founded in 1999 in Hamburg.\n<b>Not bold</b> <script>alert(1)</script>";

    await signInAtAal2(page, team.owner, team.ownerSecret, profileUrl(team.slug));
    const field = page.getByLabel(LABEL);
    await waitForHydration(field);
    await expect(field).toHaveValue("");
    await expect(page.getByText("0/2000")).toBeVisible();
    await evidence(page, "company-profile-description");
    await expectAccessibleAtBothWidths(page);

    await page.setViewportSize({ width: 1280, height: 900 });
    await field.fill(text);
    await expect(page.getByText(`${text.length}/2000`)).toBeVisible();
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();
    expect(stored(team.id)).toBe(text);

    const updates = organizationAudit(team.id).filter(({ action }) => action === "organization.updated");
    expect(updates).toHaveLength(1);
    expect(updates[0].metadata).toEqual({ changed_fields: ["description"], duplicate_legal_name: false });
    const audit = query<{ n: number }>(`select count(*)::int as n from audit.log where metadata::text like '%steel halls%'`)[0].n;
    expect(audit).toBe(0);

    await page.reload();
    await expect(page.getByLabel(LABEL)).toHaveValue(text);

    await page.goto(publicUrl(job));
    const [organization] = organizationRows(team.owner.id);
    const card = page.getByRole("region", { name: organization.display_name });
    const description = card.getByText("We build steel halls and bridges.");
    await expect(description).toBeVisible();
    await expect(description).toHaveCSS("white-space", "pre-wrap");
    expect(await description.innerText()).toBe(text);
    await expect(card.locator("b, script")).toHaveCount(0);
    await evidence(page, "vacancy-employer-description");
    await expectAccessibleAtBothWidths(page);
  });

  test("FR-A2: 2001 characters are refused next to the field and nothing is saved, and an empty description clears it", async ({ page }) => {
    const team = await newTeam();
    const job = seedJob({ id: team.id, slug: team.slug, owner: team.owner }, { title: "Short description welder", status: "open" });
    await signInAtAal2(page, team.owner, team.ownerSecret, profileUrl(team.slug));
    const field = page.getByLabel(LABEL);
    await waitForHydration(field);

    await field.fill("d".repeat(2001));
    await expect(page.getByText("2001/2000")).toBeVisible();
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("The description can have at most 2000 characters.").first()).toBeVisible();
    expect(stored(team.id)).toBeNull();

    await field.fill("d".repeat(2000));
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();
    expect(stored(team.id)).toBe("d".repeat(2000));

    await field.fill("  \n ");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Company profile saved", { exact: true })).toBeVisible();
    expect(stored(team.id)).toBeNull();
    await page.goto(publicUrl(job));
    await expect(page.getByText("d".repeat(40))).toHaveCount(0);
  });
});
