"use server";

import * as z from "zod";
import { logFault } from "@/lib/fault";
import { createClient } from "@/lib/supabase/server";

const promptSchema = z.object({
  organizationId: z.uuid(),
  limitKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  requirement: z.object({ id: z.uuid(), attempted: z.number().int().min(1).max(25) }).optional(),
});

// Reports an upgrade prompt shown to an owner or admin, for the KPI "limit prompts leading to upgrades" (FR-R1). The
// database records it only when the organisation really is at that limit, within its hourly ceilings; best effort, so a
// failure never changes what the person sees. The invitation limit counts per requirement, so its prompt names the
// requirement and the number of partners the person tried to invite (FR-O1 AC12).
export async function recordLimitPrompt(
  organizationId: string,
  limitKey: string,
  requirement?: { id: string; attempted: number },
): Promise<void> {
  const parsed = promptSchema.safeParse({ organizationId, limitKey, requirement });
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = parsed.data.requirement
    ? await supabase.rpc("record_invitation_limit_prompt", {
        p_org: parsed.data.organizationId,
        p_requirement: parsed.data.requirement.id,
        p_attempted: parsed.data.requirement.attempted,
      })
    : await supabase.rpc("record_limit_prompt", {
        p_org: parsed.data.organizationId,
        p_limit_key: parsed.data.limitKey,
      });
  if (error) logFault("Recording the limit prompt", error);
}
