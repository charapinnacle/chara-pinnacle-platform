import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import type { StandardTerms, TrackRecord } from "@/lib/partners/terms-and-record";
import { createClient } from "@/lib/supabase/server";

type FeeModel = Database["public"]["Enums"]["fee_model"];

// The company's own standard terms and stated track record, as its members read them on the workforce profile (row level
// security lets only the members read them); null when none are set.
export async function getOwnStandardTerms(organizationId: string): Promise<StandardTerms | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("partner_standard_terms")
    .select("fee_model, fee_amount, fee_currency, guarantee_days, min_assignment_weeks, note")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error("The standard terms could not be loaded", { cause: error });
  return data
    ? {
        feeModel: data.fee_model,
        feeAmount: data.fee_amount,
        feeCurrency: data.fee_currency,
        guaranteeDays: data.guarantee_days,
        minAssignmentWeeks: data.min_assignment_weeks,
        note: data.note,
      }
    : null;
}

export async function getOwnTrackRecord(organizationId: string): Promise<{ placementsLastYear: number | null; countriesPlaced: string[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("partner_track_records")
    .select("placements_last_year, countries_placed")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error("The track record could not be loaded", { cause: error });
  return {
    placementsLastYear: data?.placements_last_year ?? null,
    countriesPlaced: data?.countries_placed ?? [],
  };
}

type PublicPayload = {
  terms: {
    fee_model: FeeModel;
    fee_amount: number | null;
    fee_currency: string | null;
    guarantee_days: number | null;
    min_assignment_weeks: number | null;
    note: string | null;
  } | null;
  record: {
    placements_last_year: number | null;
    countries_placed: { code: string; name: string }[];
    platform_hires: number;
  };
};

// The standard terms and track record the public profile of a partner shows (get_partner_terms_and_record), with the
// hires counted on the platform; null where the profile is not visible.
export async function getPublicTermsAndRecord(slug: string): Promise<{ terms: StandardTerms | null; record: TrackRecord } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_partner_terms_and_record", {
    p_slug: slug,
  });
  if (error)
    throw new Error("The standard terms and track record could not be loaded", {
      cause: error,
    });
  if (!data) return null;
  const payload = data as unknown as PublicPayload;
  return {
    terms: payload.terms
      ? {
          feeModel: payload.terms.fee_model,
          feeAmount: payload.terms.fee_amount === null ? null : Number(payload.terms.fee_amount),
          feeCurrency: payload.terms.fee_currency,
          guaranteeDays: payload.terms.guarantee_days,
          minAssignmentWeeks: payload.terms.min_assignment_weeks,
          note: payload.terms.note,
        }
      : null,
    record: {
      placementsLastYear: payload.record.placements_last_year,
      countriesPlaced: payload.record.countries_placed,
      platformHires: payload.record.platform_hires,
    },
  };
}
