import "server-only";
import * as z from "zod";
import { reasonSchema, type MatchKind, type MatchReason, type MatchSummary } from "@/lib/chara-match/presentation";
import { workerCardSchema, type WorkerCardData } from "@/lib/find-workers/card";
import type { DirectContact } from "@/lib/find-workers/presentation";
import { createClient } from "@/lib/supabase/server";
import type { CharaMatchFormInput } from "@/lib/validation/chara-match";

const inputsSchema = z.object({
  destination: z.string(),
  industry: z.string(),
  occupation: z.string(),
  workers: z.number().int(),
  start: z.string(),
  recruitment: z.enum(["local", "international", "both"]),
});

const summarySchema = z.object({
  matching_workers: z.number().int().nullable(),
  workers_fewer_than: z.number().int().nullable(),
  recruitment_partners: z.number().int(),
  staffing_partners: z.number().int(),
  available_workforce: z.string(),
  source_countries: z.array(z.object({ code: z.string(), name: z.string() })),
});

export type MatchRun = { id: string; createdAt: string; inputs: CharaMatchFormInput; summary: MatchSummary };

// A run of the organisation (ARCHITECTURE.md section 9.3), read through the row policy of its members: what was asked, as
// the form's values, and the summary counted from it. Null for a run of another organisation, or one removed by
// retention.
export async function getMatchRun(organizationId: string, runId: string): Promise<MatchRun | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("match_runs")
    .select("id, inputs, summary, created_at")
    .eq("id", runId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error("The CHARA Match run could not be loaded", { cause: error });
  if (!data) return null;
  const inputs = inputsSchema.parse(data.inputs);
  const summary = summarySchema.parse(data.summary);
  return {
    id: data.id,
    createdAt: data.created_at,
    inputs: { ...inputs, workers: String(inputs.workers) },
    summary: {
      matchingWorkers: summary.matching_workers,
      workersFewerThan: summary.workers_fewer_than,
      recruitmentPartners: summary.recruitment_partners,
      staffingPartners: summary.staffing_partners,
      availableWorkforce: summary.available_workforce,
      sourceCountries: summary.source_countries,
    },
  };
}

const cardSchema = workerCardSchema.extend({
  direct_contact: z.enum(["allowed", "partner_required", "blocked"]),
  notice: z.string(),
});

const rowSchema = z.object({
  entity_id: z.uuid(),
  score: z.number().int(),
  reasons: z.array(reasonSchema),
  slug: z.string().nullable(),
  display_name: z.string().nullable(),
  organization_type: z.enum(["employer", "recruitment_company", "staffing_company"]).nullable(),
  card: cardSchema.nullable(),
  next_cursor: z.string().nullable(),
});

export type PartnerMatch = {
  kind: "partner";
  id: string;
  score: number;
  reasons: MatchReason[];
  slug: string;
  displayName: string;
  recruitmentCompany: boolean;
};
export type WorkerMatch = {
  kind: "worker";
  id: string;
  score: number;
  reasons: MatchReason[];
  card: WorkerCardData;
  directContact: DirectContact;
  notice: string;
};

export type MatchPage =
  | { state: "found"; matches: (PartnerMatch | WorkerMatch)[]; nextCursor: string | null }
  | { state: "rate_limited" }
  | { state: "unavailable" };

// One page of the matches of a kind (View matches), best first. A partner comes while it is public, a worker as the Find
// Workers card while it is listed; a refusal of the release or the plan is a state of the page, other errors reach the
// route's error boundary.
export async function listMatches(runId: string, kind: MatchKind, cursor: string | undefined): Promise<MatchPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chara_match_results", { p_run: runId, p_entity_type: kind, p_cursor: cursor });
  if (error) {
    if (error.message === "CHARA_RATE_LIMITED") return { state: "rate_limited" };
    if (error.message === "CHARA_INVALID_INPUT" && error.details === "p_cursor" && cursor !== undefined) {
      return listMatches(runId, kind, undefined);
    }
    if (["CHARA_NOT_FOUND", "CHARA_FORBIDDEN", "CHARA_FEATURE_NOT_IN_PLAN"].includes(error.message)) return { state: "unavailable" };
    throw new Error("The matches could not be loaded", { cause: error });
  }
  const rows = z.array(rowSchema).parse(data);
  return {
    state: "found",
    matches: rows.flatMap((row): (PartnerMatch | WorkerMatch)[] => {
      if (row.card) {
        const { direct_contact, notice, ...card } = row.card;
        return [{ kind: "worker", id: row.entity_id, score: row.score, reasons: row.reasons, card, directContact: direct_contact, notice }];
      }
      if (row.slug === null || row.display_name === null) return [];
      return [
        {
          kind: "partner",
          id: row.entity_id,
          score: row.score,
          reasons: row.reasons,
          slug: row.slug,
          displayName: row.display_name,
          recruitmentCompany: row.organization_type === "recruitment_company",
        },
      ];
    }),
    nextCursor: rows.at(-1)?.next_cursor ?? null,
  };
}
