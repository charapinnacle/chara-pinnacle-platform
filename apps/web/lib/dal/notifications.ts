import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EmailDelivery } from "@/lib/validation/notifications";

export type PreferenceRefusal = "forbidden" | "failed";

// The row policy shows a user only their own row; no row means the default, immediate emails.
export async function getEmailDelivery(): Promise<EmailDelivery> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("notification_preferences").select("digest").maybeSingle();
  if (error) throw new Error("The notification settings could not be loaded", { cause: error });
  return data?.digest ? "daily_summary" : "immediate";
}

export async function saveEmailDelivery(delivery: EmailDelivery): Promise<PreferenceRefusal | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notification_preferences", { p_digest: delivery === "daily_summary" });
  if (!error) return null;
  if (error.message === "CHARA_FORBIDDEN") return "forbidden";
  console.error("Saving the notification settings failed", { code: error.code, message: error.message });
  return "failed";
}
