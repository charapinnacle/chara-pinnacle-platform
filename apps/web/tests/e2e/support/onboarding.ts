import type { Page } from "@playwright/test";

export function onboardingSteps(page: Page) {
  return page.getByRole("list", { name: "Setting up your account" });
}

export function currentStep(page: Page) {
  return onboardingSteps(page).locator('[aria-current="step"]');
}
