import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { emailSchema } from "@/lib/validation/sign-up";

export const INVITATION_INVALID =
  "This invitation is not valid for your account. It may have expired, been replaced, or been sent to another email address.";
export const WORKER_CANNOT_JOIN =
  "This invitation can only be accepted by an employer account. Use a different email address.";
export const TEAM_RATE_LIMITED = "You have sent many invitations in the last hour. Try again later.";
export const ALREADY_MEMBER = "This person is already a member of the team.";
export const TEAM_FAILURE = "We could not complete this request. Try again.";

export type MemberRole = Database["public"]["Enums"]["member_role"];
export type InvitableRole = Exclude<MemberRole, "owner">;

export const roleSchema = z.enum(["owner", "admin", "member"] as const satisfies readonly MemberRole[]);
export const invitableRoleSchema = roleSchema.exclude(["owner"], { error: "Choose a role." });

export const invitableRoles = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Administrator" },
] as const;

export const roleLabels = { owner: "Owner", admin: "Administrator", member: "Member" } as const satisfies Record<
  MemberRole,
  string
>;

export const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);

// 32 random bytes as base64url, as invite_member returns them.
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const inviteFormSchema = z.object({
  email: emailSchema,
  role: invitableRoleSchema,
});

export const inviteInputSchema = inviteFormSchema.extend({ slug: slugSchema });

export const roleChangeSchema = z.object({
  slug: slugSchema,
  userId: z.uuid(),
  role: invitableRoleSchema,
});

export const memberSchema = z.object({ slug: slugSchema, userId: z.uuid() });

export const transferFormSchema = z.object({ userId: z.uuid({ error: "Choose who becomes the owner." }) });

export type InviteFormInput = z.input<typeof inviteFormSchema>;
export type InviteFormOutput = z.output<typeof inviteFormSchema>;
export type TransferFormInput = z.input<typeof transferFormSchema>;

export function memberLimitMessage(limit: number | null): string {
  return limit === null
    ? "Your plan's team-member limit is reached. Upgrade to invite more."
    : `Your plan allows ${limit} team ${limit === 1 ? "member" : "members"}. Upgrade to invite more.`;
}
