"use server";

import * as z from "zod";
import { logFault } from "@/lib/fault";
import { createClient } from "@/lib/supabase/server";

const promptSchema = z.object({ organizationId: z.uuid(), limitKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) });

// Reports an upgrade prompt shown to an owner or admin, for the KPI "limit prompts leading to upgrades" (FR-R1). The
// database records it only when the organisation really is at that limit, within its hourly ceilings; best effort, so a
// failure never changes what the person sees.
export async function recordLimitPrompt(organizationId: string, limitKey: string): Promise<void> {
  const parsed = promptSchema.safeParse({ organizationId, limitKey });
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_limit_prompt", {
    p_org: parsed.data.organizationId,
    p_limit_key: parsed.data.limitKey,
  });
  if (error) logFault("Recording the limit prompt", error);
}
