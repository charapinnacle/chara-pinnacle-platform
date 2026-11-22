import { expect, type Locator } from "@playwright/test";

const longDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

// The text the date picker shows for an ISO date, as 12 March 2027.
export function shownDate(iso: string): string {
  return longDate.format(new Date(iso));
}

// Picks an ISO date (or clears the field with "") in the date picker whose field is given, through its calendar: the
// month and year lists, then the day, as a person does.
export async function pickDate(field: Locator, iso: string): Promise<void> {
  await field.click();
  const calendar = field.locator("xpath=..").getByRole("dialog", { name: "Choose a date" });
  await expect(calendar).toBeVisible();
  if (iso === "") {
    await calendar.getByRole("button", { name: "Clear" }).click();
    return;
  }
  const [year, month] = iso.split("-").map(Number);
  await calendar.getByRole("combobox", { name: "Year" }).selectOption(String(year));
  await calendar.getByRole("combobox", { name: "Month" }).selectOption(String(month));
  await calendar.getByRole("button", { name: shownDate(iso), exact: true }).click();
  await expect(calendar).toBeHidden();
}
