import "server-only";
import * as z from "zod";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

export type PartnerEvidenceLink = { url: string } | { refusal: "unavailable" | "not_scanned" | "rate_limited" | "failed" };

const linkSchema = z.object({ url: z.url({ protocol: /^https?$/ }) });

// A 60-second download link to the scanned evidence of a partner's licence, for a Verification Reviewer or a Trust & Safety
// Administrator at aal2 reviewing the partner (FR-J2 AC6, FR-J4 AC2). The broker runs the database check with the staff
// member's own token and logs the opening as partner_review. This is the only purpose the console sends: candidate
// documents stay out of its reach (FR-F3).
export async function requestPartnerReviewEvidence(licenceId: string): Promise<PartnerEvidenceLink> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { refusal: "failed" };
  const endpoint = serverEnv().DOCUMENT_URL_ENDPOINT ?? `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/document-url`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ licenceId, purpose: "partner_review" }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { refusal: "failed" };
  }
  if (response.status === 403 || response.status === 404) return { refusal: "unavailable" };
  if (response.status === 409) return { refusal: "not_scanned" };
  if (response.status === 429) return { refusal: "rate_limited" };
  const parsed = response.ok ? linkSchema.safeParse(await response.json().catch(() => null)) : null;
  return parsed?.success ? parsed.data : { refusal: "failed" };
}
