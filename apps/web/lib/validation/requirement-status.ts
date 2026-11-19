import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";

type Enums = Database["public"]["Enums"];

// The two publishing channels of decision 3.1, with the words of FR-M1 AC9.
export const requirementVisibilityLabels = {
  private: "Only partners I invite",
  job_order_marketplace: "Job order marketplace",
} as const satisfies Record<Enums["requirement_visibility"], string>;

export const publishFormSchema = z.object({
  visibility: z.enum(["private", "job_order_marketplace"] as const satisfies readonly Enums["requirement_visibility"][], {
    error: "Choose who can see this requirement.",
  }),
  showIdentity: z.boolean(),
});

export type PublishFormInput = z.input<typeof publishFormSchema>;

// A close names why: filled (the workers were found) makes the status filled, cancelled closes it; expired is the daily
// job's reason only.
export const closeReasons = ["filled", "cancelled"] as const;
export type CloseReason = (typeof closeReasons)[number];

export const closeFormSchema = z.object({
  reason: z.enum(closeReasons, { error: "Choose why you close this requirement." }),
});

export type CloseFormInput = z.input<typeof closeFormSchema>;

