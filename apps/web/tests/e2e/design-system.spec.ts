import type { Page } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe";
import { seedApplication } from "./support/applications";
import { execute, literal } from "./support/db";
import { newCompany, newJobUrl, seedJob } from "./support/jobs";
import { createCommittedUser } from "./support/login";
import { logIn, overflow } from "./support/login-page";
import { signIn } from "./support/passport";
import { addMember, membersPath, newTeam, setName, signInAtAal2 } from "./support/team";
import { expect, test, visitorAddress } from "./support/test";

// The colour the browser computes for a token, in the form getComputedStyle returns, so that it can be compared.
function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, token);
}

const backgroundOf = (locator: ReturnType<Page["locator"]>) => locator.evaluate((element) => getComputedStyle(element).backgroundColor);

test.describe("design system (NFR-U1, DS-01 to DS-03, UX-07)", () => {
  test("UX-07: the button that removes a member is destructive, the one that opens the question is not, and the open dialog has no contrast violation", async ({ page }) => {
    const team = await newTeam();
    const member = await addMember(team, "member");
    setName(member.user.id, "Max Member");
    await signInAtAal2(page, team.owner, team.ownerSecret, membersPath(team.slug));

    const row = page.getByRole("main").getByRole("listitem").filter({ hasText: "Max Member" });
    const opener = row.getByRole("button", { name: /Remove/ });
    await expect.poll(() => backgroundOf(opener)).toBe(await tokenColour(page, "--card"));
    await opener.click();

    const dialog = page.getByRole("dialog", { name: "Remove Max Member?" });
    // The pointer is where the opener was; the dialog may open under it, and a hovered button has its own colour.
    await page.mouse.move(0, 0);
    const confirm = dialog.getByRole("button", { name: "Remove member" });
    await expect.poll(() => backgroundOf(confirm)).toBe(await tokenColour(page, "--destructive"));
    await expect
      .poll(() => confirm.evaluate((element) => getComputedStyle(element).color))
      .toBe(await tokenColour(page, "--destructive-foreground"));
    await expect.poll(() => backgroundOf(dialog.getByRole("button", { name: "Cancel" }))).toBe(await tokenColour(page, "--card"));
    await expectNoAxeViolations(page);
  });

  test("DS-03: a busy button shows a spinner that turns, and stands still when the person asks for reduced motion", async ({ browser }) => {
    for (const [reducedMotion, animation] of [
      ["no-preference", "spin"],
      ["reduce", "none"],
    ] as const) {
      const context = await browser.newContext({ reducedMotion, extraHTTPHeaders: { "x-forwarded-for": visitorAddress() } });
      const page = await context.newPage();
      await page.route("**/en/login", async (route) => {
        if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 2500));
        await route.continue();
      });
      await page.goto("/en/login");
      await page.getByLabel("Email", { exact: true }).fill("nobody@example.test");
      await page.getByLabel("Password", { exact: true }).fill("Valid-Passw0rd");
      await page.getByRole("button", { name: "Log in" }).click();

      const busy = page.getByRole("button", { name: "Logging in..." });
      await expect(busy).toHaveAttribute("aria-busy", "true");
      await expect(busy).toBeDisabled();
      expect(await busy.locator("svg").evaluate((icon) => getComputedStyle(icon).animationName), `reduced motion: ${reducedMotion}`).toBe(animation);
      await context.close();
    }
  });

  test("DS-02: the page title and the home title follow the type scale at desktop and phone width", async ({ page }) => {
    const sizeOf = (name: string) => page.getByRole("heading", { level: 1, name }).evaluate((heading) => getComputedStyle(heading).fontSize);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/en");
    expect(await sizeOf("The Global Workforce Network")).toBe("64px");
    await page.goto("/en/jobs");
    expect(await sizeOf("Find jobs")).toBe("32px");
    await page.goto("/en/pricing");
    expect(await sizeOf("Pricing")).toBe("48px");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/en");
    expect(await sizeOf("The Global Workforce Network")).toBe("40px");
    await page.goto("/en/jobs");
    expect(await sizeOf("Find jobs")).toBe("26px");
  });

  test("DS-01: the search of the hero is the primary action, the home links are secondary link-buttons of the button height, and a click follows the link", async ({ page }) => {
    await page.goto("/en");
    const search = page.getByRole("search", { name: "Search vacancies" }).getByRole("button", { name: "Search vacancies" });
    const browse = page.getByRole("link", { name: "Browse vacancies" });
    const create = page.getByRole("link", { name: "Create an account" });
    expect((await browse.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect((await create.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await backgroundOf(search)).toBe(await tokenColour(page, "--primary"));
    expect(await backgroundOf(browse)).toBe(await tokenColour(page, "--card"));
    expect(await backgroundOf(create)).toBe(await tokenColour(page, "--card"));
    await browse.click();
    await expect(page).toHaveURL("/en/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Find jobs" })).toBeVisible();
  });

  test("DS-02: the stage badges of a candidate's applications say the stage and colour it by status", async ({ page }) => {
    const company = await newCompany();
    const worker = await createCommittedUser("worker");
    execute(`update public.worker_profiles set occupation_id = '7212' where user_id = ${literal(worker.id)}`);
    const first = seedJob(company, { title: "Badge welder", status: "open" });
    const second = seedJob(company, { title: "Badge fitter", status: "open" });
    seedApplication(worker.id, first, company.id, { status: "applied" });
    seedApplication(worker.id, second, company.id, { status: "hired" });
    await signIn(page, worker);
    await page.goto("/en/applications");

    const badge = (title: string, stage: string) =>
      page.getByRole("main").getByRole("listitem").filter({ hasText: title }).getByText(stage, { exact: true });
    await expect(badge("Badge welder", "Applied")).toBeVisible();
    await expect(badge("Badge fitter", "Hired")).toBeVisible();
    expect(await backgroundOf(badge("Badge welder", "Applied"))).toBe(await tokenColour(page, "--info-background"));
    expect(await backgroundOf(badge("Badge fitter", "Hired"))).toBe(await tokenColour(page, "--success-background"));
    await expectNoAxeViolations(page);
  });

  test("NFR-U2: a vacancy form full of errors does not widen the page at 375 px, because the hidden hints stay one pixel wide", async ({ page }) => {
    const company = await newCompany();
    await logIn(page, company.owner, newJobUrl(company.slug));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "There is a problem" })).toBeVisible();
    const hint = page.locator("#job-occupation-description");
    expect((await hint.boundingBox())?.width).toBeLessThanOrEqual(1);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
