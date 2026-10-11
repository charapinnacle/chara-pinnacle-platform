import type { Page } from "@playwright/test";
import { createCommittedUser, generateRecoveryPath } from "./support/login";
import { currentDocuments } from "./support/accounts";
import { expectNoAxeViolations } from "./support/axe";
import { waitForHydration } from "./support/hydration";
import { overflow } from "./support/login-page";
import { AGE_LABEL, ageBox, documentBox, EMPLOYER_LABEL, fillSignup, newEmail, PASSWORD, summary, WORKER_LABEL } from "./support/signup-page";
import { newTeam, seedInvitation } from "./support/team";
import { expect, test } from "./support/test";
import { displayTitle } from "@/lib/validation/consents";

const WIDTHS = [1280, 360] as const;

// A colour as the browser computes it, from a token of globals.css.
async function tokenColour(page: Page, property: "color" | "borderTopColor", token: string): Promise<string> {
  return page.evaluate(
    ([prop, name]) => {
      const probe = document.createElement("div");
      probe.style.setProperty(prop === "color" ? "color" : "border-top-color", `var(${name})`);
      probe.style.borderTopStyle = "solid";
      document.body.append(probe);
      const value = getComputedStyle(probe)[prop];
      probe.remove();
      return value;
    },
    [property, token] as const,
  );
}

test.describe("U67: the sign-up form", () => {
  test("FR-A8, FR-A9: each consent is its own required row with a plain title, a quiet version line and a Draft badge", async ({ page }) => {
    const documents = await currentDocuments("worker");
    await page.goto("/en/signup");
    await waitForHydration(page.getByLabel("Email address"));
    await page.getByRole("radio", { name: WORKER_LABEL }).check();
    const boxes = page.getByRole("checkbox");
    await expect(boxes).toHaveCount(documents.length);

    const names = new Set<string>();
    for (const { slug, title } of documents) {
      if (slug === "age-18-plus") {
        await expect(ageBox(page)).toBeVisible();
        names.add(AGE_LABEL);
        continue;
      }
      const box = documentBox(page, title);
      const plain = displayTitle(title);
      await expect(box).toHaveAccessibleName(new RegExp(`^I accept the ${plain}`));
      await expect(box).not.toHaveAccessibleName(/DRAFT/);
      await expect(box).toHaveAccessibleDescription(/^Version \d+ · \d{1,2} \w+ \d{4}/);
      names.add(plain);
      const row = page.locator("[data-slot=field]").filter({ has: box });
      await expect(row.getByText("Draft", { exact: true })).toBeVisible();
      await expect(row).not.toContainText("DRAFT");
    }
    expect(names.size).toBe(documents.length);
    expect(await boxes.evaluateAll((all) => new Set(all.map((box) => box.id)).size)).toBe(documents.length);
    await expect(page.getByRole("main")).not.toContainText("DRAFT:");
  });

  test("the whole row toggles the box, is at least 44 px high, and the title link still opens its document", async ({ page, context }) => {
    const [terms] = (await currentDocuments("worker")).filter((d) => d.slug === "terms-of-service");
    await page.goto("/en/signup");
    await waitForHydration(page.getByLabel("Email address"));
    await page.getByRole("radio", { name: WORKER_LABEL }).check();
    const box = documentBox(page, terms.title);
    const row = page.locator("[data-slot=field]").filter({ has: box });
    await row.scrollIntoViewIfNeeded();
    expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    const frame = (await row.boundingBox())!;
    await page.mouse.click(frame.x + frame.width - 8, frame.y + frame.height / 2);
    await expect(box).toBeChecked();
    await row.getByText(/^Version/).click({ force: true });
    await expect(box).not.toBeChecked();

    const link = row.getByRole("link");
    const opened = context.waitForEvent("page");
    await link.click();
    expect((await opened).url()).toContain("/en/legal/terms-of-service");
    await expect(box).not.toBeChecked();
  });

  test("the title link shows no underline until it is hovered or focused, and the checkbox is the near-black 20 px control", async ({ page }) => {
    const [terms] = (await currentDocuments("worker")).filter((d) => d.slug === "terms-of-service");
    await page.goto("/en/signup");
    await waitForHydration(page.getByLabel("Email address"));
    await page.getByRole("radio", { name: WORKER_LABEL }).check();
    const link = page.locator("[data-slot=field]").filter({ has: documentBox(page, terms.title) }).getByRole("link");
    const decoration = () => link.evaluate((element) => getComputedStyle(element).textDecorationColor);
    const transparent = "rgba(0, 0, 0, 0)";
    expect(await decoration()).toBe(transparent);
    await link.hover();
    await expect.poll(decoration).not.toBe(transparent);
    await page.mouse.move(0, 0);
    await expect.poll(decoration).toBe(transparent);
    await documentBox(page, terms.title).focus();
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    await expect.poll(decoration).not.toBe(transparent);

    const box = documentBox(page, terms.title);
    const style = () => box.evaluate((element) => {
      const css = getComputedStyle(element);
      return { width: css.width, height: css.height, radius: css.borderTopLeftRadius, border: css.borderTopWidth, background: css.backgroundColor };
    });
    expect(await style()).toMatchObject({ width: "20px", height: "20px", radius: "6px" });
    // 1.5 px in the style sheet; Chromium draws a border of 1.5 px as 1 px when it is not on a high-density screen.
    expect((await style()).border).toMatch(/^1(\.5)?px$/);
    expect(await box.evaluate((element) => element.className)).toContain("border-[1.5px]");
    await box.check();
    await expect.poll(async () => (await style()).background).toBe(await tokenColour(page, "color", "--primary"));
  });

  test("the focus of a field is one 2 px accent outline at a 2 px offset and a near-black border, with no glow", async ({ page }) => {
    await page.goto("/en/login");
    const email = page.getByLabel("Email", { exact: true });
    await waitForHydration(email);
    const focus = () => email.evaluate((element) => {
      const css = getComputedStyle(element);
      return {
        outlineWidth: css.outlineWidth, outlineStyle: css.outlineStyle, outlineOffset: css.outlineOffset, outlineColor: css.outlineColor,
        border: css.borderTopColor, shadow: css.boxShadow, height: css.height, radius: css.borderTopLeftRadius,
      };
    });
    expect(await focus()).toMatchObject({ height: "48px", radius: "12px" });
    await page.keyboard.press("Shift");
    await email.focus();
    await expect(email).toBeFocused();
    const focused = await focus();
    expect(focused).toMatchObject({ outlineWidth: "2px", outlineStyle: "solid", outlineOffset: "2px" });
    // The shadows that remain are the zero-width ones of the ring utilities: nothing is drawn.
    expect((focused.shadow.match(/-?\d+(\.\d+)?px/g) ?? []).every((length) => parseFloat(length) === 0)).toBe(true);
    expect(focused.outlineColor).toBe(await tokenColour(page, "color", "--ring"));
    await expect.poll(async () => (await focus()).border).toBe(await tokenColour(page, "borderTopColor", "--foreground"));
  });

  test("the account type is two equal cards of a radiogroup: arrow keys move the choice, the chosen card has a near-black border", async ({ page }) => {
    await page.goto("/en/signup?kind=company");
    await waitForHydration(page.getByLabel("Email address"));
    const group = page.getByRole("radiogroup", { name: "I want to register as" });
    await expect(group.getByRole("radio", { name: EMPLOYER_LABEL })).toBeChecked();
    const cards = group.locator(".group\\/option");
    const [first, second] = await cards.evaluateAll((all) => all.map((card) => card.getBoundingClientRect().width));
    expect(Math.abs(first - second)).toBeLessThan(1);
    await expect(cards.nth(0)).toContainText("Find work and apply to vacancies.");
    await expect(cards.nth(1)).toContainText("Publish vacancies and hire.");

    const border = (index: number) => cards.nth(index).evaluate((card) => getComputedStyle(card).borderTopColor);
    expect(await border(1)).toBe(await tokenColour(page, "borderTopColor", "--primary"));
    expect(await border(0)).not.toBe(await border(1));
    await group.getByRole("radio", { name: EMPLOYER_LABEL }).focus();
    await page.keyboard.press("ArrowUp");
    await expect(group.getByRole("radio", { name: WORKER_LABEL })).toBeChecked();
    await expect.poll(() => border(0)).toBe(await tokenColour(page, "borderTopColor", "--primary"));
  });
});

test.describe("U67: the password field", () => {
  test("a show and hide button with a name, aria-pressed and the keyboard, on sign-up, log in, reset and invitation", async ({ page }) => {
    const user = await createCommittedUser("worker");
    const team = await newTeam();
    const token = seedInvitation(team, newEmail());
    const pages: [string, string][] = [
      ["/en/signup", "Password"],
      ["/en/login", "Password"],
      [await generateRecoveryPath(user.email), "New password"],
      [`/en/signup?invitation=${token}`, "Password"],
    ];
    for (const [path, label] of pages) {
      await page.goto(path);
      const input = page.getByLabel(label, { exact: true });
      await waitForHydration(input);
      await input.fill(PASSWORD);
      const show = page.getByRole("button", { name: "Show password" });
      await expect(show).toHaveAttribute("aria-pressed", "false");
      await expect(input).toHaveAttribute("type", "password");

      await input.press("Tab");
      await expect(show).toBeFocused();
      await page.keyboard.press("Enter");
      const hide = page.getByRole("button", { name: "Hide password" });
      await expect(hide).toHaveAttribute("aria-pressed", "true");
      await expect(input).toHaveAttribute("type", "text");
      await expect(input).toHaveValue(PASSWORD);
      await expect(hide).toBeFocused();
      await page.keyboard.press("Space");
      await expect(page.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "false");
      await expect(input).toHaveAttribute("type", "password");
      await expect(input).toHaveValue(PASSWORD);
    }
  });

  test("a refused sign-up clears the password and hides it again", async ({ page }) => {
    const message = "We could not complete this request. Try again.";
    await page.route("**/en/signup", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 200,
            contentType: "text/x-component",
            body: `0:{"a":"$@1","f":"","b":"local"}\n1:${JSON.stringify({ message })}\n`,
          })
        : route.continue(),
    );
    await page.goto("/en/signup");
    const input = page.getByLabel("Password", { exact: true });
    await waitForHydration(input);
    await fillSignup(page, { kind: "worker", email: newEmail(), password: PASSWORD });
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(input).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(summary(page)).toContainText(message);
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "false");
  });

  test("the checklist turns to a check mark at 12 characters, is read out and goes back under 12", async ({ page }) => {
    await page.goto("/en/signup");
    const input = page.getByLabel("Password", { exact: true });
    await waitForHydration(input);
    const item = page.getByRole("listitem").filter({ hasText: "At least 12 characters" });
    const status = page.getByRole("status").filter({ hasText: "At least 12 characters" });
    await expect(item).toContainText("not met yet");
    await expect(item.locator("svg.lucide-check")).toHaveCount(0);
    await expect(input).toHaveAccessibleDescription(/At least 12 characters\s*: not met yet/);

    await input.fill("elevenchars");
    await expect(item.locator("svg.lucide-check")).toHaveCount(0);
    await input.fill("twelve chars");
    await expect(item.locator("svg.lucide-check")).toHaveCount(1);
    await expect(status).toHaveText(/^At least 12 characters\s*: met$/);
    await expect(input).toHaveAccessibleDescription(/At least 12 characters\s*: met/);
    await expect(status).toHaveAttribute("role", "status");
    await input.fill("short");
    await expect(item.locator("svg.lucide-check")).toHaveCount(0);
    await expect(status).toHaveText(/^At least 12 characters\s*: not met yet$/);
  });

  test("the reset form has the checklist and the toggle too", async ({ page }) => {
    const user = await createCommittedUser("worker");
    await page.goto(await generateRecoveryPath(user.email));
    const input = page.getByLabel("New password", { exact: true });
    await waitForHydration(input);
    await input.fill("password1234");
    await expect(page.getByRole("listitem").filter({ hasText: "At least 12 characters" }).locator("svg.lucide-check")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Show password" })).toBeVisible();
  });
});

test.describe("U67: layout and accessibility of the changed pages", () => {
  for (const width of WIDTHS) {
    test(`axe, no horizontal scroll and a card clear of the edge at ${width} px`, async ({ page }) => {
      const user = await createCommittedUser("worker");
      const team = await newTeam();
      const token = seedInvitation(team, newEmail());
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        "/en/signup",
        "/en/signup?kind=company",
        `/en/signup?invitation=${token}`,
        "/en/login",
        "/en/forgot-password",
        "/en/verify-email",
        await generateRecoveryPath(user.email),
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (path.startsWith("/en/signup")) {
          for (const box of await page.getByRole("checkbox").all()) await box.check();
        }
        await expectNoAxeViolations(page);
        expect(await overflow(page), path).toBeLessThanOrEqual(0);
        const left = await page.locator("main h1").evaluate((heading) => heading.getBoundingClientRect().left);
        expect(left, path).toBeGreaterThanOrEqual(16);
      }
      await page.goto("/en/signup");
      await page.getByRole("radio", { name: WORKER_LABEL }).check();
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(summary(page)).toBeFocused();
      await expectNoAxeViolations(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("the auth card is 16 px round with 40 px of padding on a desktop and 24 px on a phone, and the button is 48 px", async ({ page }) => {
    const card = () =>
      page.locator("main h1").evaluate((heading) => {
        const element = heading.closest("[class*=rounded-card]")!;
        const css = getComputedStyle(element);
        return { radius: css.borderTopLeftRadius, padding: css.paddingLeft, shadow: css.boxShadow !== "none" };
      });
    await page.goto("/en/login");
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await card()).toEqual({ radius: "16px", padding: "40px", shadow: true });
    expect((await page.getByRole("button", { name: "Log in" }).boundingBox())?.height).toBe(48);
    await page.setViewportSize({ width: 375, height: 800 });
    expect(await card()).toMatchObject({ padding: "24px" });
  });

  test("the error summary has a left border in the error colour, an icon and links that move focus to the fields", async ({ page }) => {
    await page.goto("/en/login");
    await waitForHydration(page.getByLabel("Email", { exact: true }));
    await page.getByRole("button", { name: "Log in" }).click();
    const box = summary(page);
    await expect(box).toBeFocused();
    expect(await box.evaluate((element) => getComputedStyle(element).borderLeftWidth)).toBe("4px");
    expect(await box.evaluate((element) => getComputedStyle(element).borderLeftColor)).toBe(await tokenColour(page, "borderTopColor", "--destructive"));
    await expect(box.locator("svg")).toHaveCount(1);
    await box.getByRole("link", { name: "Enter your password." }).click();
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAccessibleDescription("Enter your password.");
  });
});
