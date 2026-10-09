import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// The public settings of the platform by key (the legal entity and the two contacts); a key the database does not
// return is absent. A failed read throws: the error page, never a page with details left out.
export const getPublicSettings = cache(async (): Promise<Readonly<Record<string, string>>> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_settings");
  if (error) throw new Error("The public settings could not be loaded", { cause: error });
  return Object.fromEntries(data.map(({ key, value }) => [key, value]));
});
