import "server-only";
import { cache } from "react";
import { reminderCutoff } from "@/lib/documents/presentation";
import { createClient } from "@/lib/supabase/server";
import { todayUtc } from "@/lib/validation/passport";

export type DocumentReminder = { id: string; title: string; expiresOn: string };

// Documents that are expired or expire within the reminder window, soonest first. Bounded by the API maximum; the owner's
// row policy and the partial index on (worker_user_id, expires_on) serve the query.
export const getDocumentReminders = cache(async (): Promise<DocumentReminder[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worker_documents")
    .select("id, title, expires_on")
    .not("expires_on", "is", null)
    .neq("scan_status", "rejected")
    .lte("expires_on", reminderCutoff(todayUtc()))
    .order("expires_on")
    .limit(100);
  if (error) throw new Error("The document reminders could not be loaded", { cause: error });
  return data.flatMap(({ id, title, expires_on }) => (expires_on === null ? [] : [{ id, title, expiresOn: expires_on }]));
});
