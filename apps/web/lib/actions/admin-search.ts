"use server";

import {
  searchAudit,
  searchJobs,
  searchOrganizations,
  searchUsers,
  type AuditRow,
  type JobRow,
  type OrganizationRow,
  type Page,
  type UserRow,
} from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import {
  auditFilterSchema,
  jobCursorSchema,
  nameCursorSchema,
  searchTermSchema,
  timeCursorSchema,
  type AuditFilterForm,
  type JobCursor,
  type NameCursor,
  type TimeCursor,
} from "@/lib/validation/admin";

type Answer<Row, Cursor> = { ok: true; page: Page<Row, Cursor> } | { ok: false };

// A search the database refuses or cannot answer is a failure the page shows with a retry: only the code of the cause is
// logged, since its message and details can carry what was searched for, and nothing of it is sent.
async function answer<Row, Cursor>(what: string, read: () => Promise<Page<Row, Cursor>>): Promise<Answer<Row, Cursor>> {
  try {
    return { ok: true, page: await read() };
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    console.error(`${what} failed`, { code: typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined });
    return { ok: false };
  }
}

export async function searchUsersAction(term: string, after: NameCursor): Promise<Answer<UserRow, NonNullable<NameCursor>>> {
  await requirePlatformRole(defaultLocale, ["admin", "trust_safety"]);
  const parsed = searchTermSchema.safeParse(term);
  const cursor = nameCursorSchema.safeParse(after);
  if (!parsed.success || !cursor.success) return { ok: false };
  return answer("The user search", () => searchUsers(parsed.data, cursor.data));
}

export async function searchOrganizationsAction(
  term: string,
  after: NameCursor,
): Promise<Answer<OrganizationRow, NonNullable<NameCursor>>> {
  await requirePlatformRole(defaultLocale, ["admin", "trust_safety"]);
  const parsed = searchTermSchema.safeParse(term);
  const cursor = nameCursorSchema.safeParse(after);
  if (!parsed.success || !cursor.success) return { ok: false };
  return answer("The organisation search", () => searchOrganizations(parsed.data, cursor.data));
}

export async function searchJobsAction(term: string, after: JobCursor): Promise<Answer<JobRow, NonNullable<JobCursor>>> {
  await requirePlatformRole(defaultLocale, ["trust_safety"]);
  const parsed = searchTermSchema.safeParse(term);
  const cursor = jobCursorSchema.safeParse(after);
  if (!parsed.success || !cursor.success) return { ok: false };
  return answer("The vacancy search", () => searchJobs(parsed.data, cursor.data));
}

export async function searchAuditAction(
  filter: AuditFilterForm,
  after: TimeCursor,
): Promise<Answer<AuditRow, NonNullable<TimeCursor>>> {
  await requirePlatformRole(defaultLocale, ["admin"]);
  const parsed = auditFilterSchema.safeParse(filter);
  const cursor = timeCursorSchema.safeParse(after);
  if (!parsed.success || !cursor.success) return { ok: false };
  return answer("The audit search", () => searchAudit(parsed.data, cursor.data));
}
