import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
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
