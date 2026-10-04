import { createHash, randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { execute, literal, query } from "./db";
import { createCommittedUser, enrollTotp } from "./login";
import { logIn } from "./login-page";
import { enterCode } from "./mfa";
import { registerOrganization, organizationRows, uniqueName } from "./organizations";
import { expect, visitorAddress } from "./test";
import type { TestUser } from "./test-user";

export type Role = "owner" | "admin" | "member";

export interface Team {
  id: string;
  slug: string;
  owner: TestUser;
  ownerSecret: string;
}

// One browser with its own visitor address and cookies: a second person on a second machine.
export async function newVisitor(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": visitorAddress() } });
  return { context, page: await context.newPage() };
}

export function membersPath(slug: string): string {
  return `/en/org/${slug}/members`;
}

// An organization whose owner has enrolled a factor, so that the owner can reach the team page at aal2.
export async function newTeam(displayName = uniqueName("Team Bau")): Promise<Team> {
  const owner = await createCommittedUser("company");
  const ownerSecret = await enrollTotp(owner);
  await registerOrganization(owner, `${displayName} GmbH`, displayName);
  const [organization] = organizationRows(owner.id);
  return { id: organization.id, slug: organization.slug, owner, ownerSecret };
}

// As accept_invitation leaves a member.
export function joinTeam(team: Team, user: TestUser, role: "admin" | "member"): void {
  execute(
    `insert into public.organization_members (organization_id, user_id, role, accepted_at, invited_by)
     values (${literal(team.id)}, ${literal(user.id)}, ${literal(role)}, now(), ${literal(team.owner.id)})`,
  );
}

// A new company user who is already a member; an admin gets an enrolled factor unless told otherwise.
export async function addMember(team: Team, role: "admin" | "member", { enrolled = role === "admin" } = {}) {
  const user = await createCommittedUser("company");
  joinTeam(team, user, role);
  const secret = enrolled ? await enrollTotp(user) : null;
  return { user, secret };
}

export function setName(userId: string, name: string): void {
  execute(`update public.profiles set display_name = ${literal(name)} where id = ${literal(userId)}`);
}

export function setRole(team: Team, userId: string, role: Role): void {
  execute(
    `update public.organization_members set role = ${literal(role)}
     where organization_id = ${literal(team.id)} and user_id = ${literal(userId)}`,
  );
}

// What invite_member leaves, without the call (which needs a session at aal2): the hash of a token only the test knows.
export function seedInvitation(
  team: Team,
  email: string,
  role: "admin" | "member" = "member",
  { expired = false } = {},
): string {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  execute(
    `insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by, created_at, expires_at)
     values (${literal(team.id)}, ${literal(email)}, ${literal(role)}, ${literal(hash)}, ${literal(team.owner.id)},
       now() - interval ${literal(expired ? "8 days" : "1 hour")}, now() + interval ${literal(expired ? "-1 day" : "7 days")})`,
  );
  return token;
}

export function invitationRows(team: Team) {
  return query<{ email: string; role: string; accepted_at: string | null; invited_by: string; expires_at: string }>(
    `select email::text, role::text, accepted_at, invited_by, expires_at from public.organization_invitations
     where organization_id = ${literal(team.id)} order by created_at`,
  );
}

export function memberRows(team: Team) {
  return query<{ user_id: string; role: string; invited_by: string | null }>(
    `select user_id, role::text, invited_by from public.organization_members
     where organization_id = ${literal(team.id)} order by accepted_at, user_id`,
  );
}

export function teamAudit(team: Team, action: string) {
  return query<{ actor_id: string | null; entity_id: string; metadata: Record<string, unknown> }>(
    `select actor_id, entity_id, metadata from audit.log
     where action = ${literal(action)} and (entity_id = ${literal(team.id)} or metadata ->> 'organization_id' = ${literal(team.id)})
     order by id`,
  );
}

export function queuedSignOuts(userId: string): number {
  const [row] = query<{ n: number }>(
    `select count(*)::int as n from pgmq.q_account_ops
     where message ->> 'action' = 'sign_out' and message ->> 'user_id' = ${literal(userId)}`,
  );
  return row.n;
}

// Signs in and answers the two-step challenge of an enrolled user, ending on the page asked for.
export async function signInAtAal2(page: Page, user: TestUser, secret: string, path: string): Promise<void> {
  await logIn(page, user, path);
  await expect(page).toHaveURL(`/en/mfa?next=${encodeURIComponent(path)}`);
  await enterCode(page, secret);
  await expect(page).toHaveURL(path);
}

export async function signInAtAal1(page: Page, user: TestUser, path: string): Promise<void> {
  await logIn(page, user, path);
  await expect(page).toHaveURL(path);
}

// The limit the billing migration will read from the plans (FR-G1): until it exists, the browser tests give the
// organizations whose display name starts with "Basic" a limit of 1 and every other one a limit of 5, and switch the
// limits on. restoreLimits puts the placeholder of the team migration back.
export function enforceLimits(): void {
  execute(`
    create or replace function private.org_limit(p_org uuid, p_key text) returns integer
    language sql stable set search_path = '' as $f$
      select case p_key when 'members' then
        case when (select o.display_name from public.organizations o where o.id = p_org) like 'Basic%' then 1 else 5 end
      end
    $f$;
    update private.settings set value = 'true' where key = 'entitlements_enforced'`);
}

export function restoreLimits(): void {
  execute(`
    create or replace function private.org_limit(p_org uuid, p_key text) returns integer
    language sql stable set search_path = '' as $f$ select case p_key when 'members' then 1 end $f$;
    update private.settings set value = 'false' where key = 'entitlements_enforced'`);
}
