"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { refreshAppShell } from "@/lib/app/refresh-shell";
import { getOrganizationSlug } from "@/lib/dal/organizations";
import { getAllowance } from "@/lib/dal/team";
import { requireOrgRole, requireUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { forgetInvitation } from "@/lib/invitation-cookie";
import { homePath, mfaPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";
import {
  ALREADY_MEMBER,
  INVITATION_INVALID,
  inviteInputSchema,
  invitationTokenSchema,
  memberSchema,
  roleChangeSchema,
  slugSchema,
  TEAM_FAILURE,
  TEAM_RATE_LIMITED,
  WORKER_CANNOT_JOIN,
  type InviteFormInput,
  type MemberRole,
} from "@/lib/validation/team";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type TeamResult = { message?: string; errors?: FieldErrors };
export type InviteResult = TeamResult & {
  limitReached?: { limit: number | null };
  invitation?: { path: string; expiresAt: string };
};

const REFUSALS: Record<string, string> = {
  use_transfer_ownership: "The owner cannot be changed here. Transfer ownership instead.",
  cannot_remove_owner: "The owner cannot be removed. Transfer ownership first.",
  not_a_member: "This person is no longer a member of the team.",
  new_owner: "Choose another member of the team as the new owner.",
  no_pending_transfer: "No ownership transfer is waiting. It may have expired or been cancelled.",
  organization_suspended: "This organization is suspended, so its team cannot be changed.",
};

function membersPath(slug: string): string {
  return `/${defaultLocale}/org/${slug}/members`;
}

// Two-step verification can lapse between loading the page and acting on it; the person is sent to confirm it again.
function refusal(error: PostgrestError, slug: string): TeamResult {
  if (error.message === "CHARA_FORBIDDEN" && error.details === "aal2_required") {
    redirect(mfaPath(defaultLocale, membersPath(slug)));
  }
  const known = error.details ? REFUSALS[error.details] : undefined;
  if (known) return { message: known };
  console.error("Team action failed", { code: error.code, message: error.message });
  return { message: TEAM_FAILURE };
}

async function runTeamAction(
  slug: string,
  minRole: MemberRole,
  call: (supabase: Supabase, organizationId: string) => PromiseLike<{ error: PostgrestError | null }>,
): Promise<TeamResult> {
  const { organization } = await requireOrgRole(defaultLocale, slug, minRole);
  const { error } = await call(await createClient(), organization.id);
  if (error) return refusal(error, slug);
  revalidatePath(membersPath(slug));
  return {};
}

async function inviteRefusal(error: PostgrestError, slug: string, organizationId: string): Promise<InviteResult> {
  if (error.message === "CHARA_LIMIT_REACHED") {
    const allowance = await getAllowance(organizationId).catch(() => null);
    return { limitReached: { limit: allowance?.limit ?? null } };
  }
  if (error.message === "CHARA_RATE_LIMITED") return { message: TEAM_RATE_LIMITED };
  if (error.message === "CHARA_CONFLICT") return { errors: { email: ALREADY_MEMBER } };
  if (error.message === "CHARA_INVALID_INPUT" && error.details === "email") {
    return { errors: { email: "Enter a valid email address." } };
  }
  return refusal(error, slug);
}

// The token reaches the browser once, in the path of the link; the database keeps only its hash. The page is not
// revalidated here: the dialog showing the link lives in a part of the page that the new invitation changes, and it
// refreshes the page when it is closed.
export async function inviteMember(input: InviteFormInput & { slug: string }): Promise<InviteResult> {
  const parsed = inviteInputSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { slug, email, role } = parsed.data;
  const { organization } = await requireOrgRole(defaultLocale, slug, "admin");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_member", {
    p_org: organization.id,
    p_email: email,
    p_role: role,
  });
  if (error) return inviteRefusal(error, slug, organization.id);
  const [{ token, expires_at }] = data;
  return { invitation: { path: `/${defaultLocale}/invitations/${token}`, expiresAt: expires_at } };
}

export async function changeMemberRole(input: { slug: string; userId: string; role: string }): Promise<TeamResult> {
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return { message: TEAM_FAILURE };
  const { slug, userId, role } = parsed.data;
  return runTeamAction(slug, "admin", (supabase, organizationId) =>
    supabase.rpc("change_member_role", { p_org: organizationId, p_user: userId, p_role: role }),
  );
}

export async function removeMember(input: { slug: string; userId: string }): Promise<TeamResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return { message: TEAM_FAILURE };
  const { slug, userId } = parsed.data;
  return runTeamAction(slug, "admin", (supabase, organizationId) =>
    supabase.rpc("remove_member", { p_org: organizationId, p_user: userId }),
  );
}

export async function transferOwnership(input: { slug: string; userId: string }): Promise<TeamResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return { message: TEAM_FAILURE };
  const { slug, userId } = parsed.data;
  return runTeamAction(slug, "owner", (supabase, organizationId) =>
    supabase.rpc("transfer_ownership", { p_org: organizationId, p_new_owner: userId }),
  );
}

export async function cancelOwnershipTransfer(slug: string): Promise<TeamResult> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return { message: TEAM_FAILURE };
  return runTeamAction(parsed.data, "owner", (supabase, organizationId) =>
    supabase.rpc("cancel_ownership_transfer", { p_org: organizationId }),
  );
}

// The designated person may be a plain member, who is not held at the two-step page by the page guard; the database
// asks for aal2 and refusal() then sends them there.
export async function acceptOwnershipTransfer(slug: string): Promise<TeamResult> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return { message: TEAM_FAILURE };
  return runTeamAction(parsed.data, "member", (supabase, organizationId) =>
    supabase.rpc("accept_ownership_transfer", { p_org: organizationId }),
  );
}

function invitationRefusal(error: PostgrestError): string {
  if (error.message === "CHARA_FORBIDDEN" && error.details === "workers_cannot_join_organizations") {
    return WORKER_CANNOT_JOIN;
  }
  if (error.message === "CHARA_FORBIDDEN" && error.details === "email_unconfirmed") {
    return "Confirm your email address first, then open the invitation link again.";
  }
  if (error.message === "CHARA_CONFLICT") return "You are already a member of this team.";
  if (error.message === "CHARA_INVITATION_INVALID") return INVITATION_INVALID;
  console.error("Accept invitation failed", { code: error.code, message: error.message });
  return TEAM_FAILURE;
}

export async function acceptInvitation(token: string): Promise<{ message: string } | undefined> {
  await requireUser(defaultLocale);
  const parsed = invitationTokenSchema.safeParse(token);
  if (!parsed.success) return { message: INVITATION_INVALID };

  const supabase = await createClient();
  const { data: organizationId, error } = await supabase.rpc("accept_invitation", { p_token: parsed.data });
  if (error) return { message: invitationRefusal(error) };

  await forgetInvitation();
  refreshAppShell();
  const slug = await getOrganizationSlug(organizationId).catch(() => null);
  redirect(slug ? `/${defaultLocale}/org/${slug}` : homePath(defaultLocale, "company"));
}
