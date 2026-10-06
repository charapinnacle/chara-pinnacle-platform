import type { Page } from "@playwright/test";
import { execute, literal, query } from "./db";
import { logIn } from "./login-page";
import { expect } from "./test";
import type { TestUser } from "./test-user";

export async function signIn(page: Page, user: TestUser): Promise<void> {
  await logIn(page, user);
  await expect(page).toHaveURL(/\/en\/dashboard\/worker$/);
}

export function daysFromToday(days: number): string {
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return new Date(today + days * 86_400_000).toISOString().slice(0, 10);
}

export function profileRows(userId: string) {
  return query<{
    first_name: string;
    last_name: string;
    headline: string | null;
    current_country: string;
    occupation_id: string | null;
    years_experience: number | null;
    availability: string | null;
    available_from: string | null;
    searchable: boolean;
  }>(
    `select first_name, last_name, headline, current_country, occupation_id, years_experience, availability,
            available_from::text, searchable
     from public.worker_profiles where user_id = ${literal(userId)}`,
  );
}

export function childRows(userId: string) {
  const id = literal(userId);
  return {
    skills: query<{ skill: string }>(`select skill from public.worker_skills where worker_user_id = ${id} order by skill`).map(
      (row) => row.skill,
    ),
    languages: query<{ language_code: string; cefr_level: string }>(
      `select language_code, cefr_level from public.worker_languages where worker_user_id = ${id} order by language_code`,
    ),
    preferred: query<{ country_code: string }>(
      `select country_code from public.worker_preferred_countries where worker_user_id = ${id} order by country_code`,
    ).map((row) => row.country_code),
    authorizations: query<{ country_code: string; expires_on: string | null }>(
      `select country_code, expires_on::text from public.worker_work_authorizations where worker_user_id = ${id} order by country_code`,
    ),
  };
}

// The expiry window is enforced by a trigger that also fires for the table owner, so a date that has "since passed" is
// seeded with the trigger off.
export function insertExpiredAuthorization(userId: string, country: string, expiresOn: string): void {
  execute(
    `alter table public.worker_work_authorizations disable trigger worker_authorizations_check_expiry;
     insert into public.worker_work_authorizations (worker_user_id, country_code, expires_on)
       values (${literal(userId)}, ${literal(country)}, ${literal(expiresOn)});
     alter table public.worker_work_authorizations enable always trigger worker_authorizations_check_expiry;`,
  );
}

export function passportAudit(userId: string) {
  return query<{ actor_id: string; entity_type: string; entity_id: string; metadata: Record<string, unknown> }>(
    `select actor_id, entity_type, entity_id, metadata from audit.log
     where entity_id = ${literal(userId)} and action = 'passport.created'`,
  );
}

// Tabs through every control of the page and expects the focus to follow the order in which the controls appear on the
// screen: from top to bottom, which at phone width is also the order of the markup.
export async function expectTabOrderFollowsPage(page: Page): Promise<void> {
  const controls = await page.evaluate(() => {
    const found = [...document.querySelectorAll<HTMLElement>("main a[href], main input, main select, main button, main summary")].filter(
      (element) => !element.matches(":disabled, [type=hidden]") && element.getClientRects().length > 0,
    );
    found.forEach((element, index) => element.setAttribute("data-tab-check", String(index)));
    return found.map((element) => ({
      top: element.getBoundingClientRect().top + window.scrollY,
      name:
        (element as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? element.textContent?.trim() ?? element.tagName,
    }));
  });
  expect(controls.length).toBeGreaterThan(20);
  expect(controls.map(({ top }) => top)).toEqual([...controls.map(({ top }) => top)].sort((a, b) => a - b));

  await page.locator('[data-tab-check="0"]').focus();
  for (const [index, { name }] of controls.entries()) {
    const focused = page.locator(":focus");
    await expect(focused, `${index}: ${name}`).toHaveAttribute("data-tab-check", String(index));
    // A date field holds several tab stops (day, month, year, picker).
    const stops = (await focused.getAttribute("type")) === "date" ? 4 : 1;
    for (let stop = 0; stop < stops; stop += 1) await page.keyboard.press("Tab");
  }
}

// Gives a candidate the first six items of the completeness meter (names and country, occupation, three skills) and,
// with seedDocument, a CV: 55 percent.
export function seedOccupationAndSkills(userId: string): void {
  const id = literal(userId);
  execute(
    `update public.worker_profiles set occupation_id = '7411' where user_id = ${id};
     insert into public.worker_skills (worker_user_id, skill) values (${id}, 'Welding'), (${id}, 'Wiring'), (${id}, 'Cabling')`,
  );
}

// Everything the meter asks for except the CV.
export function seedAllButCv(userId: string): void {
  const id = literal(userId);
  seedOccupationAndSkills(userId);
  execute(
    `update public.worker_profiles
       set headline = 'Electrician', years_experience = 6, availability = 'now' where user_id = ${id};
     insert into public.worker_languages (worker_user_id, language_code, cefr_level) values (${id}, 'en', 'B2');
     insert into public.worker_work_authorizations (worker_user_id, country_code) values (${id}, 'DE')`,
  );
}
