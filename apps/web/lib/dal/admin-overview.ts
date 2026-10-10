import "server-only";
import { adminClient, failure } from "@/lib/dal/admin";

type ModerationCounts = { suspendedUsers: number; suspendedOrganizations: number; hiddenVacancies: number };

// The people who hold an active platform staff role now (Platform Administrator only).
export async function staffCount(): Promise<number> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_staff_count");
  if (error) throw failure("The staff count", error);
  return data;
}

// What is suspended or hidden now (Trust & Safety Administrator only).
export async function moderationCounts(): Promise<ModerationCounts> {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc("admin_moderation_counts");
  if (error) throw failure("The moderation counts", error);
  const [row] = data;
  return { suspendedUsers: row.suspended_users, suspendedOrganizations: row.suspended_organizations, hiddenVacancies: row.hidden_vacancies };
}
