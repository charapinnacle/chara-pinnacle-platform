import { expect, test } from "@playwright/test";
import { createUnconfirmedUser, userByEmail } from "./support/accounts";
import { captureActionRequests } from "./support/server-action";
import {
  EMPLOYER_LABEL,
  fillSignup,
  newEmail,
  PASSWORD,
  summary,
  WORKER_LABEL,
} from "./support/signup-page";

test.describe("sign-up form states", () => {
  test("FR-A1 AC12: the form is usable by keyboard, marks pending and survives a network failure", async ({
    page,
    context,
  }) => {
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/en/signup");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }

    await page.goto("/en/signup");
    await page.getByRole("radio").first().focus();
    await expect(page.getByRole("radio").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: EMPLOYER_LABEL })).toBeChecked();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("radio", { name: WORKER_LABEL })).toBeChecked();
    await expect(page.getByLabel("Email address")).toHaveAttribute("autocomplete", "email");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "new-password");

    await page.keyboard.press("Enter");
    await expect(summary(page)).toBeFocused();
    await summary(page).getByRole("link", { name: "Enter a valid email address." }).click();
    await expect(page.getByLabel("Email address")).toBeFocused();

    await page.getByLabel("Password", { exact: true }).press("Tab");
    await expect(page.getByRole("checkbox").first()).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByRole("checkbox").first()).toBeChecked();
    await page.keyboard.press("Space");
    await expect(page.getByRole("checkbox").first()).not.toBeChecked();

    const email = newEmail();
    await fillSignup(page, { kind: "worker", email, password: PASSWORD });
    await context.setOffline(true);
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await expect(page.getByText("Could not create the account", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue(email);
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    expect(userByEmail(email)).toEqual([]);
    await context.setOffline(false);
  });

  test("FR-A1 AC12: while the request is pending the button says so and is disabled, and a double click sends one request", async ({
    page,
  }) => {
    const email = newEmail();
    const calls = captureActionRequests(page);
    await page.route("**/en/signup", async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });
    await page.goto("/en/signup");
    await fillSignup(page, { kind: "worker", email, password: PASSWORD });
    await page.getByRole("button", { name: "Create account" }).dblclick();

    const pending = page.getByRole("button", { name: "Creating account..." });
    await expect(pending).toBeVisible();
    await expect(pending).toBeDisabled();
    await expect(page).toHaveURL(/\/en\/verify-email$/);
    expect(calls).toHaveLength(1);
    expect(userByEmail(email)).toHaveLength(1);
  });

  test("FR-A1 AC10: the resend button says Sending and is disabled while the request is pending", async ({
    page,
  }) => {
    const waiting = await createUnconfirmedUser();
    await page.route("**/en/verify-email*", async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });
    await page.goto("/en/verify-email?error=invalid_link");
    await page.getByLabel("Email address").fill(waiting.email);
    await page.getByRole("button", { name: "Send a new link" }).click();
    const pending = page.getByRole("button", { name: "Sending..." });
    await expect(pending).toBeVisible();
    await expect(pending).toBeDisabled();
    await expect(page.getByRole("status")).toBeVisible();
  });
});
