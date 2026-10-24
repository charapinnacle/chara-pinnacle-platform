import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { NOTIFICATIONS_PAGE_SIZE, type NotificationItem } from "@/lib/notifications/present";
import { createClient } from "@/lib/supabase/server";
import type { EmailDelivery } from "@/lib/validation/notifications";

// The row policy shows a user only their own row; no row means the default, immediate emails.
export async function getEmailDelivery(): Promise<EmailDelivery> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("notification_preferences").select("digest").maybeSingle();
  if (error) throw new Error("The notification settings could not be loaded", { cause: error });
  return data?.digest ? "daily_summary" : "immediate";
}

export async function saveEmailDelivery(delivery: EmailDelivery): Promise<PostgrestError | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notification_preferences", { p_digest: delivery === "daily_summary" });
  return error;
}

export type NotificationKindSetting = { kind: string; label: string; mandatory: boolean; emailEnabled: boolean };

// The kinds the user can receive with their email state; only while the in-app notifications are released.
export async function getNotificationKinds(): Promise<NotificationKindSetting[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notification_kind_catalogue");
  if (error) throw new Error("The notification kinds could not be loaded", { cause: error });
  return data.map(({ kind, label, mandatory, email_enabled: emailEnabled }) => ({ kind, label, mandatory, emailEnabled }));
}

export async function saveEmailKinds(kinds: Record<string, boolean>): Promise<PostgrestError | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notification_preferences", { p_kinds: kinds });
  return error;
}

// Set after a permanent bounce or a complaint, cleared when the address changes; the row policy shows the user only theirs.
export async function getEmailUndeliverable(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("notification_preferences").select("email_undeliverable_at").maybeSingle();
  if (error) throw new Error("The email delivery state could not be loaded", { cause: error });
  return Boolean(data?.email_undeliverable_at);
}

export async function listMyNotifications(cursor: string | null): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_notifications", { p_cursor: cursor ?? undefined, p_limit: NOTIFICATIONS_PAGE_SIZE });
  if (error) throw new Error("The notifications could not be loaded", { cause: error });
  return {
    items: data.map(({ id, kind, payload, read_at: readAt, created_at: createdAt }) => ({
      id,
      kind,
      payload: payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload : {},
      readAt,
      createdAt,
    })),
    nextCursor: data.at(-1)?.next_cursor ?? null,
  };
}

export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unread_notification_count");
  if (error) throw new Error("The unread notifications could not be counted", { cause: error });
  return data;
}

// null marks every item read. Ids of other users change nothing.
export async function markNotificationsRead(ids: string[] | null): Promise<PostgrestError | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", ids ? { p_ids: ids } : {});
  return error;
}
