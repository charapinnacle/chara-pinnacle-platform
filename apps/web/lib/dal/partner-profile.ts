import "server-only";
import { cache } from "react";
import { visitorProof } from "@/lib/dal/rate-limit";
import { getCurrentUser } from "@/lib/dal/session";
import { partnerProfileFrom, type PartnerProfile } from "@/lib/partners/profile";
import { createClient } from "@/lib/supabase/server";

export type PublicPartnerProfile =
  | { state: "found"; profile: PartnerProfile; viewerIsMember: boolean }
  | { state: "not_found" }
  | { state: "rate_limited" };

// The public profile of a listed partner (FR-K4), once per request for the page and its metadata. A visitor is counted
// under the keyed hash of the address with the proof of this minute; a signed-in reader is counted by the database. An
// unknown slug, a partner that is not public and a switched-off release are all not_found.
export const getPartnerProfile = cache(async (slug: string): Promise<PublicPartnerProfile> => {
  const visitor = (await getCurrentUser()) ? null : await visitorProof("partner_profile");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_partner_profile", {
    p_slug: slug,
    p_key: visitor?.key,
    p_proof: visitor?.proof,
  });
  if (error?.message === "CHARA_NOT_FOUND") return { state: "not_found" };
  if (error?.message === "CHARA_RATE_LIMITED") return { state: "rate_limited" };
  if (error) throw new Error("The partner profile could not be loaded", { cause: error });
  const [row] = data;
  if (!row) return { state: "not_found" };
  const { viewer_is_member: viewerIsMember, ...rest } = row;
  return { state: "found", profile: partnerProfileFrom(rest), viewerIsMember };
});

// The same profile for a member of the partner, public or not, with whether everyone sees it now.
export async function getPartnerProfilePreview(organizationId: string): Promise<{ profile: PartnerProfile; isPublic: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_partner_profile", { p_org: organizationId });
  if (error) throw new Error("The profile preview could not be loaded", { cause: error });
  const [row] = data;
  if (!row) throw new Error("The profile preview is empty");
  const { is_public: isPublic, ...rest } = row;
  return { profile: partnerProfileFrom(rest), isPublic };
}
