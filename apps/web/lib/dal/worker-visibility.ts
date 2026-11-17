import "server-only";
import { cache } from "react";
import * as z from "zod";
import { workerCardSchema, type WorkerCardData } from "@/lib/find-workers/card";
import { createClient } from "@/lib/supabase/server";

export const VISIBILITY_CONSENT_SLUG = "worker-visibility-consent";

export type CardSections = { training: boolean; employmentHistory: boolean; industries: boolean };

// The worker's own Find Workers card and the state of its opt-in (FR-Q1 AC9, AC10). visible: listed now; optedIn: the
// worker's choice, which a suspension or a deletion request does not change; confirmBy: the end of the answer period while
// the yearly reminder waits (AC8).
export type MyCard = {
  card: WorkerCardData;
  visible: boolean;
  optedIn: boolean;
  visibleSince: string | null;
  consentVersion: number | null;
  currentVersion: number | null;
  confirmBy: string | null;
  sections: CardSections;
};

const stateSchema = z.object({
  visible: z.boolean(),
  opted_in: z.boolean(),
  visible_since: z.string().nullable(),
  consent_version: z.number().int().nullable(),
  current_version: z.number().int().nullable(),
  confirm_by: z.string().nullable(),
  show_training: z.boolean(),
  show_employment_history: z.boolean(),
  show_industries: z.boolean(),
});

// Null for a worker without a passport. Release 2c must be on (the caller checks isReleased first).
export const getMyCard = cache(async (): Promise<MyCard | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_card_preview").maybeSingle();
  if (error) throw new Error("The Find Workers card could not be loaded", { cause: error });
  if (!data) return null;
  const state = stateSchema.parse(data);
  return {
    card: workerCardSchema.parse(data),
    visible: state.visible,
    optedIn: state.opted_in,
    visibleSince: state.visible_since,
    consentVersion: state.consent_version,
    currentVersion: state.current_version,
    confirmBy: state.confirm_by,
    sections: {
      training: state.show_training,
      employmentHistory: state.show_employment_history,
      industries: state.show_industries,
    },
  };
});
