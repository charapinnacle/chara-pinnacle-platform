import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const MEMBERS_PAGE_SIZE = 50;
const INVITATIONS_LIMIT = 50;

const roleSchema = z.enum(["owner", "admin", "member"]);
const invitationRoleSchema = z.enum(["admin", "member"]);

// The database types declare every returned column as not null; the nullable ones are stated here, where the rows enter.
const memberRowSchema = z.object({
  user_id: z.uuid(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  role: roleSchema,
  mfa_enrolled: z.boolean().nullable(),
});
const allowanceSchema = z.object({ member_limit: z.number().int().nullable(), used: z.number().int() });
const previewSchema = z.object({
  organization_name: z.string(),
  role: roleSchema,
  email: z.string(),
  expires_at: z.string(),
});

export type TeamMember = {
  userId: string;
  name: string | null;
  email: string | null;
  role: z.infer<typeof roleSchema>;
  mfaEnrolled: boolean | null;
};

type MemberPage = { members: TeamMember[]; nextCursor: string | null };
type PendingInvitation = {
  id: string;
  email: string;
  role: z.infer<typeof invitationRoleSchema>;
  expiresAt: string;
  expired: boolean;
};
type PendingTransfer = { fromUserId: string; toUserId: string; expiresAt: string };
type InvitationPreview = { organizationName: string; role: z.infer<typeof roleSchema>; email: string; expiresAt: string };

// Keyset page of the team in user id order, one row over the page size to know whether a next page exists.
export async function getMembers(organizationId: string, after: string | null): Promise<MemberPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_organization_members", {
    p_org: organizationId,
    p_limit: MEMBERS_PAGE_SIZE + 1,
    p_after_user: after ?? undefined,
  });
  if (error) throw new Error("The team could not be loaded", { cause: error });
  const rows = z.array(memberRowSchema).parse(data);
  const page = rows.slice(0, MEMBERS_PAGE_SIZE);
  return {
    members: page.map((row) => ({
      userId: row.user_id,
      name: row.display_name,
      email: row.email,
      role: row.role,
      mfaEnrolled: row.mfa_enrolled,
    })),
    nextCursor: rows.length > MEMBERS_PAGE_SIZE ? page[page.length - 1].user_id : null,
  };
}

// Invitations that have not been accepted, newest first. An address has one live invitation (a new one replaces it),
// so the list is bounded by the addresses invited, and the query by the limit.
export async function getInvitations(organizationId: string): Promise<PendingInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_invitations")
    .select("id, email, role, expires_at")
    .eq("organization_id", organizationId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false })
    .limit(INVITATIONS_LIMIT);
  if (error) throw new Error("The invitations could not be loaded", { cause: error });
  const now = Date.now();
  return data.map((row) => ({
    id: row.id,
    email: row.email,
    role: invitationRoleSchema.parse(row.role),
    expiresAt: row.expires_at,
    expired: new Date(row.expires_at).getTime() <= now,
  }));
}

export async function getAllowance(organizationId: string): Promise<{ limit: number | null; used: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_member_allowance", { p_org: organizationId });
  if (error) throw new Error("The team size could not be loaded", { cause: error });
  const [row] = z.array(allowanceSchema).length(1).parse(data);
  return { limit: row.member_limit, used: row.used };
}

// Row level security shows the open transfer to the owner and to the member it designates, and to nobody else.
export async function getPendingTransfer(organizationId: string): Promise<PendingTransfer | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_ownership_transfers")
    .select("from_user_id, to_user_id, expires_at")
    .eq("organization_id", organizationId)
    .is("accepted_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error("The ownership transfer could not be loaded", { cause: error });
  return data ? { fromUserId: data.from_user_id, toUserId: data.to_user_id, expiresAt: data.expires_at } : null;
}

export async function getInvitationPreview(token: string): Promise<InvitationPreview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invitation_preview", { p_token: token });
  if (error) throw new Error("The invitation could not be loaded", { cause: error });
  const [row] = z.array(previewSchema).parse(data);
  return row
    ? { organizationName: row.organization_name, role: row.role, email: row.email, expiresAt: row.expires_at }
    : null;
}
