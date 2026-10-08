import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  ADMIN_PAGE_SIZE,
  type AuditFilter,
  type NameCursor,
  type PlatformRole,
  type TimeCursor,
} from "@/lib/validation/admin";

type Enums = Database["public"]["Enums"];

export type Page<Row, Cursor> = { rows: Row[]; next: Cursor | null };

export type UserRow = {
  id: string;
  displayName: string | null;
  email: string;
  accountKind: Enums["account_kind"] | null;
  status: Enums["profile_status"];
  createdAt: string;
};

export type OrganizationRow = {
  id: string;
  displayName: string;
  legalName: string;
  slug: string;
  status: Enums["organization_status"];
};

export type AuditRow = {
  id: number;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  createdAt: string;
};

export type ModerationRow = {
  id: number;
  targetType: "profile" | "organization";
  targetId: string;
  targetName: string | null;
  action: string;
  reasons: string;
  actorId: string | null;
  createdAt: string;
};

export type StaffRow = {
  id: number;
  userId: string;
  displayName: string | null;
  email: string;
  role: PlatformRole;
  grantedBy: string | null;
  grantedByEmail: string | null;
  grantedAt: string;
  revokedAt: string | null;
  mfaEnrolled: boolean;
  lastSignInAt: string | null;
};

export type LegalDocumentRow = { slug: string; version: number; title: string; publishedAt: string };

const memberRole = z.enum(["owner", "admin", "member"]);
const membershipsSchema = z.array(z.object({ organization_id: z.uuid(), name: z.string(), role: memberRole }));
const membersSchema = z.array(
  z.object({ user_id: z.uuid(), display_name: z.string().nullable(), role: memberRole, accepted_at: z.string().nullable() }),
);
const vacanciesSchema = z.array(
  z.object({
    id: z.uuid(),
    title: z.string(),
    status: z.string(),
    moderation_state: z.enum(["visible", "hidden", "org_suspended"]),
  }),
);

export type UserDetail = UserRow & {
  memberships: { organizationId: string; name: string; role: z.infer<typeof memberRole> }[];
  applicationsSubmitted: number;
  vacanciesCreated: number;
};

export type OrganizationDetail = OrganizationRow & {
  members: { userId: string; displayName: string | null; role: z.infer<typeof memberRole>; acceptedAt: string | null }[];
  vacancies: { id: string; title: string; status: string; moderationState: z.infer<typeof vacanciesSchema>[number]["moderation_state"] }[];
};

export type StageCount = { status: Enums["application_status"]; count: number };

// The id of the request goes to the database with every call of the console, so that the audit row of an action names it.
export async function adminClient() {
  const requestId = (await headers()).get("x-request-id");
  return createClient(requestId ? { "x-request-id": requestId } : undefined);
}

function failure(what: string, cause: unknown): Error {
  return new Error(`${what} could not be loaded`, { cause });
}

// One row more than a page is read: its presence says there is a next page, and the last row shown is its cursor.
function paged<Row, Cursor>(rows: Row[], cursorOf: (row: Row) => Cursor): Page<Row, Cursor> {
  const shown = rows.slice(0, ADMIN_PAGE_SIZE);
  return { rows: shown, next: rows.length > ADMIN_PAGE_SIZE ? cursorOf(shown[shown.length - 1]) : null };
}

export async function searchUsers(term: string, after: NameCursor): Promise<Page<UserRow, NonNullable<NameCursor>>> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_search_users", {
    p_term: term,
    p_limit: ADMIN_PAGE_SIZE + 1,
    p_after_name: after?.name,
    p_after_id: after?.id,
  });
  if (error) throw failure("The users", error);
  const rows = data.map(
    (row): UserRow => ({
      id: row.id,
      displayName: row.display_name ?? null,
      email: row.email,
      accountKind: row.account_kind ?? null,
      status: row.status,
      createdAt: row.created_at,
    }),
  );
  return paged(rows, (row) => ({ name: row.displayName ?? "", id: row.id }));
}

export async function searchOrganizations(
  term: string,
  after: NameCursor,
): Promise<Page<OrganizationRow, NonNullable<NameCursor>>> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_search_organizations", {
    p_term: term,
    p_limit: ADMIN_PAGE_SIZE + 1,
    p_after_name: after?.name,
    p_after_id: after?.id,
  });
  if (error) throw failure("The organisations", error);
  const rows = data.map(
    (row): OrganizationRow => ({
      id: row.id,
      displayName: row.display_name,
      legalName: row.legal_name,
      slug: row.slug,
      status: row.status,
    }),
  );
  return paged(rows, (row) => ({ name: row.displayName, id: row.id }));
}

export async function searchAudit(filter: AuditFilter, after: TimeCursor): Promise<Page<AuditRow, NonNullable<TimeCursor>>> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_search_audit", {
    p_actor: filter.actor || undefined,
    p_action: filter.action || undefined,
    p_entity_type: filter.entityType || undefined,
    p_entity_id: filter.entityId || undefined,
    p_from: filter.from || undefined,
    p_to: filter.to || undefined,
    p_limit: ADMIN_PAGE_SIZE + 1,
    p_after_at: after?.at,
    p_after_id: after?.id,
  });
  if (error) throw failure("The audit log", error);
  const rows = data.map((row): AuditRow => {
    const reason = z.object({ reason: z.string() }).safeParse(row.metadata);
    return {
      id: row.id,
      actorId: row.actor_id ?? null,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id ?? null,
      reason: reason.success ? reason.data.reason : null,
      createdAt: row.created_at,
    };
  });
  return paged(rows, (row) => ({ at: row.createdAt, id: row.id }));
}

export async function getUser(id: string): Promise<UserDetail | null> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_get_user", { p_user_id: id });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return null;
    throw failure("The user", error);
  }
  const [row] = data;
  return {
    id: row.id,
    displayName: row.display_name ?? null,
    email: row.email,
    accountKind: row.account_kind ?? null,
    status: row.status,
    createdAt: row.created_at,
    memberships: membershipsSchema
      .parse(row.memberships)
      .map((membership) => ({ organizationId: membership.organization_id, name: membership.name, role: membership.role })),
    applicationsSubmitted: row.applications_submitted,
    vacanciesCreated: row.vacancies_created,
  };
}

export async function getOrganization(id: string): Promise<OrganizationDetail | null> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_get_organization", { p_org: id });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return null;
    throw failure("The organisation", error);
  }
  const [row] = data;
  return {
    id: row.id,
    displayName: row.display_name,
    legalName: row.legal_name,
    slug: row.slug,
    status: row.status,
    members: membersSchema
      .parse(row.members)
      .map((member) => ({ userId: member.user_id, displayName: member.display_name, role: member.role, acceptedAt: member.accepted_at })),
    vacancies: vacanciesSchema
      .parse(row.vacancies)
      .map((vacancy) => ({ id: vacancy.id, title: vacancy.title, status: vacancy.status, moderationState: vacancy.moderation_state })),
  };
}

export async function applicationCounts(from: string, to: string): Promise<StageCount[]> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_application_counts", { p_from: from, p_to: to });
  if (error) throw failure("The statistics", error);
  return data;
}

export async function listModerationActions(after: number | null): Promise<Page<ModerationRow, number>> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_list_moderation_actions", {
    p_limit: ADMIN_PAGE_SIZE + 1,
    p_after_id: after ?? undefined,
  });
  if (error) throw failure("The suspensions", error);
  const rows = data.map(
    (row): ModerationRow => ({
      id: row.id,
      targetType: row.target_type === "organization" ? "organization" : "profile",
      targetId: row.target_id,
      targetName: row.target_name ?? null,
      action: row.action,
      reasons: row.statement_of_reasons,
      actorId: row.actor_id ?? null,
      createdAt: row.created_at,
    }),
  );
  return paged(rows, (row) => row.id);
}

export async function listStaff(): Promise<StaffRow[]> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("list_platform_staff", { p_limit: 100 });
  if (error) throw failure("The staff", error);
  return data.map(
    (row): StaffRow => ({
      id: row.id,
      userId: row.user_id,
      displayName: row.display_name ?? null,
      email: row.email,
      role: row.role,
      grantedBy: row.granted_by ?? null,
      grantedByEmail: row.granted_by_email ?? null,
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at ?? null,
      mfaEnrolled: row.mfa_enrolled,
      lastSignInAt: row.last_sign_in_at ?? null,
    }),
  );
}

// The current version of every document: legal_documents is public, so the table is read as the caller. A document is
// listed once, with the highest version published.
export async function listLegalDocuments(): Promise<LegalDocumentRow[]> {
  const supabase = await adminClient();
  const { data, error } = await supabase
    .from("legal_documents")
    .select("slug, version, title, published_at")
    .order("slug")
    .order("version", { ascending: false })
    .limit(500);
  if (error) throw failure("The legal documents", error);
  const current = new Map<string, LegalDocumentRow>();
  for (const row of data) {
    if (!current.has(row.slug) && row.published_at) {
      current.set(row.slug, { slug: row.slug, version: row.version, title: row.title, publishedAt: row.published_at });
    }
  }
  return [...current.values()];
}
