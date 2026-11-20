import "server-only";
import * as z from "zod";
import { workerCardSchema, type WorkerCardData } from "@/lib/find-workers/card";
import type { DirectContact } from "@/lib/find-workers/presentation";
import { workerSearchFilters, type FindWorkersFilters } from "@/lib/find-workers/search-params";
import { createClient } from "@/lib/supabase/server";

// The refusals of private.assert_worker_searcher that a member of an organisation can meet, each a state of the page.
const refusalReasons = ["not_listed", "profile_hidden", "organization_suspended"] as const;
export type FindWorkersRefusal = (typeof refusalReasons)[number] | "plan_required";

type Failure = { message: string; details?: string | null };

type Refused = { state: "refused"; reason: FindWorkersRefusal } | { state: "rate_limited" } | { state: "advanced_required" };

function refusal(error: Failure): Refused | null {
  if (error.message === "CHARA_RATE_LIMITED") return { state: "rate_limited" };
  if (error.message === "CHARA_FEATURE_NOT_IN_PLAN") {
    return error.details === "worker_search" ? { state: "refused", reason: "plan_required" } : { state: "advanced_required" };
  }
  const reason = refusalReasons.find((value) => value === error.details);
  return error.message === "CHARA_FORBIDDEN" && reason ? { state: "refused", reason } : null;
}

export type WorkerSearchAccess =
  | { state: "allowed"; advanced: boolean; defaultDestination: string | null }
  | { state: "refused"; reason: FindWorkersRefusal };

// Whether the organisation may search and with which filters (FR-Q2 AC1, AC3, AC11), before the page shows its form.
export async function getWorkerSearchAccess(organizationId: string): Promise<WorkerSearchAccess> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("worker_search_access", { p_org: organizationId }).single();
  if (error) {
    const refused = refusal(error);
    if (refused?.state === "refused") return refused;
    throw new Error("Find Workers could not be loaded", { cause: error });
  }
  return { state: "allowed", advanced: data.advanced, defaultDestination: data.default_destination };
}

const contactSchema = z.object({
  direct_contact: z.enum(["allowed", "partner_required", "blocked"]),
  notice: z.string(),
});

// One card as search_workers returns it: the card columns of public.worker_search and nothing else of the worker
// (NFR-S9), with how the direct-hiring rules shape contact and what it matched.
export type WorkerResult = { card: WorkerCardData; directContact: DirectContact; notice: string; matchedOn: string[] };

const resultSchema = workerCardSchema.extend({ ...contactSchema.shape, matched_on: z.array(z.string()), next_cursor: z.string().nullable() });

export type WorkerSearch =
  | { state: "found"; results: WorkerResult[]; nextCursor: string | null; cursorIgnored: boolean }
  | Refused;

// One page of Find Workers for organizationId (FR-Q2). The page checks the filters first, so a refusal for its input is a
// failure here, for the route's error boundary, as any other error.
export async function searchWorkers(organizationId: string, filters: FindWorkersFilters): Promise<WorkerSearch> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_workers", {
    p_org: organizationId,
    p_filters: workerSearchFilters(filters),
    p_cursor: filters.cursor,
    p_limit: filters.limit,
  });
  if (error) {
    if (error.message === "CHARA_INVALID_INPUT" && error.details === "p_cursor" && filters.cursor !== undefined) {
      const firstPage = await searchWorkers(organizationId, { ...filters, cursor: undefined });
      return firstPage.state === "found" ? { ...firstPage, cursorIgnored: true } : firstPage;
    }
    const refused = refusal(error);
    if (refused) return refused;
    throw new Error("The workers could not be loaded", { cause: error });
  }
  const rows = z.array(resultSchema).parse(data);
  return {
    state: "found",
    results: rows.map((row) => ({
      card: workerCardSchema.parse(row),
      directContact: row.direct_contact,
      notice: row.notice,
      matchedOn: row.matched_on,
    })),
    nextCursor: rows.at(-1)?.next_cursor ?? null,
    cursorIgnored: false,
  };
}

export type SavedWorkerCard =
  | { cardId: string; visible: true; card: WorkerCardData; directContact: DirectContact; notice: string }
  | { cardId: string; visible: false };

const savedSchema = z.object({ card_id: z.uuid(), visible: z.boolean() }).loose();

// The cards the organisation saved for its requirement (or for itself when requirementId is null), newest first (FR-Q2
// AC12); a card whose worker is no longer visible comes back without any card field.
export async function listSavedWorkerCards(organizationId: string, requirementId: string | null): Promise<SavedWorkerCard[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_saved_worker_cards", {
    p_org: organizationId,
    ...(requirementId ? { p_requirement: requirementId } : {}),
  });
  if (error) throw new Error("The saved workers could not be loaded", { cause: error });
  return data.map((row) => {
    const { card_id, visible } = savedSchema.parse(row);
    if (!visible) return { cardId: card_id, visible: false };
    const contact = contactSchema.parse(row);
    return { cardId: card_id, visible: true, card: workerCardSchema.parse(row), directContact: contact.direct_contact, notice: contact.notice };
  });
}

// The cards of a page that the organisation saved for the same requirement, for the Save buttons' state.
export async function savedCardIds(organizationId: string, requirementId: string | null): Promise<Set<string>> {
  const supabase = await createClient();
  const query = supabase.from("saved_worker_cards").select("card_id").eq("organization_id", organizationId);
  const { data, error } = await (requirementId ? query.eq("requirement_id", requirementId) : query.is("requirement_id", null));
  if (error) throw new Error("The saved workers could not be loaded", { cause: error });
  return new Set(data.map(({ card_id }) => card_id));
}
