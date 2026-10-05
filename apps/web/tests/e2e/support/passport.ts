import { execute, literal, query } from "./db";

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
