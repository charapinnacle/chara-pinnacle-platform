import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { execute, literal } from "./db";
import { enrollTotp } from "./login";
import { staffUser } from "./mfa";
import { signInAtAal2 } from "./team";
import type { TestUser } from "./test-user";

export type StaffRole = "admin" | "verification_reviewer" | "trust_safety";

// A short lower-case token that makes the rows of one test distinct from those of every other test in the database.
export function uniqueTag(): string {
  return randomBytes(4).toString("hex");
}

export async function enrolledStaff(role: StaffRole): Promise<{ user: TestUser; secret: string }> {
  const user = await staffUser(role);
  return { user, secret: await enrollTotp(user) };
}

// Signs in as a new staff member with the role and answers the two-step challenge, ending on the page asked for.
export async function signInStaff(page: Page, role: StaffRole, path = "/en/admin") {
  const staff = await enrolledStaff(role);
  await signInAtAal2(page, staff.user, staff.secret, path);
  return staff;
}

export function revokeRole(userId: string): void {
  execute(`update public.platform_staff set revoked_at = now() where user_id = ${literal(userId)} and revoked_at is null`);
}

// Confirmed candidate accounts named "Test User <tag> 01" and so on, as an account is after onboarding.
export function seedUsers(tag: string, count: number): void {
  execute(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     select gen_random_uuid(), ${literal(`seed-${tag}-`)} || n || '@search.test', now(), jsonb_build_object('intended_account_kind', 'worker')
     from generate_series(1, ${count}) n;
     update public.profiles p set account_kind = 'worker', display_name = 'Test User ${tag} ' || lpad(split_part(split_part(u.email::text, '-', 3), '@', 1), 2, '0')
     from auth.users u where u.id = p.id and u.email like ${literal(`seed-${tag}-%@search.test`)}`,
  );
}

// Organisations named "Test Org <tag> 01" and so on, all owned by the given user (the database wants one owner for each).
export function seedOrganizations(tag: string, count: number, ownerId: string): void {
  execute(
    `with created as (
       insert into public.organizations (type, slug, legal_name, display_name, based_in_country)
       select 'employer', ${literal(`test-org-${tag}-`)} || n, 'Legal Name ' || n || ' GmbH', 'Test Org ${tag} ' || lpad(n::text, 2, '0'), 'DE'
       from generate_series(1, ${count}) n
       returning id
     )
     insert into public.organization_members (organization_id, user_id, role, accepted_at)
     select id, ${literal(ownerId)}, 'owner', now() from created`,
  );
}

// Rows of the audit log with the action e2e.<tag>, entity-1 the newest.
export function seedAudit(tag: string, count: number): void {
  execute(
    `insert into audit.log (action, entity_type, entity_id, metadata, created_at)
     select ${literal(`e2e.${tag}`)}, 'e2e', 'entity-' || n, jsonb_build_object('reason', 'Reason number ' || n), now() - n * interval '1 minute'
     from generate_series(1, ${count}) n`,
  );
}
