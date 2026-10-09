import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// A failed read throws so the error page shows, never a page with details silently left out.
export const getPublicSettings = cache(async (): Promise<Readonly<Record<string, string>>> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_settings");
  if (error) throw new Error("The public settings could not be loaded", { cause: error });
  return Object.fromEntries(data.map(({ key, value }) => [key, value]));
});
