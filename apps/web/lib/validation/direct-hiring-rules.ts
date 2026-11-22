import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { staffReasonSchema } from "@/lib/validation/admin";

// The direct-hiring rules editor (FR-Q5 AC3, AC10; NFR-O5). The bounds mirror admin_upsert_direct_hiring_rule, which checks
// them again: a notice of 20 to 1,000 characters on one paragraph, a legal opinion reference of 1 to 200 and a reason of 10
// to 500.

export type DirectHiringRuleValue = Database["public"]["Enums"]["direct_hiring_rule_value"];

export const NOTICE_MIN = 20;
export const NOTICE_MAX = 1000;
export const REFERENCE_MAX = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export const ruleLabels = {
  allowed: "Direct hiring allowed",
  licensed_partner_required: "Licensed partner required",
  blocked: "Direct hiring blocked",
} as const satisfies Record<DirectHiringRuleValue, string>;

export const ruleValues = Object.keys(ruleLabels) as [DirectHiringRuleValue, ...DirectHiringRuleValue[]];

export type DirectHiringRule = {
  id: string;
  sourceCountry: string;
  sourceName: string;
  destinationCountry: string | null;
  destinationName: string | null;
  rule: DirectHiringRuleValue;
  notice: string;
  legalOpinionRef: string;
  updatedByName: string | null;
  updatedAt: string;
  reviewDue: boolean;
};

export type DirectHiringRuleChange = {
  id: number;
  createdAt: string;
  actorName: string | null;
  action: "created" | "updated" | "deleted";
  before: RuleValues | null;
  after: RuleValues | null;
  reason: string | null;
};

// The audit row drops null values (private.audit_admin strips them), so a rule for all destinations has no
// destination_country there.
const ruleValuesSchema = z.object({
  source_country: z.string(),
  destination_country: z.string().nullable().default(null),
  rule: z.enum(ruleValues),
  notice: z.string(),
  legal_opinion_ref: z.string(),
});

export type RuleValues = z.infer<typeof ruleValuesSchema>;

// The values of an audit row, or null when the row has none (before a creation, after a deletion) or they are not
// the shape this editor writes.
export function parseRuleValues(value: unknown): RuleValues | null {
  const parsed = ruleValuesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const countrySchema = z.string().regex(/^[A-Z]{2}$/, "Choose a country");

const noticeSchema = z
  .string({ error: "Enter the notice." })
  .trim()
  .min(NOTICE_MIN, `Write a notice of at least ${NOTICE_MIN} characters`)
  .max(NOTICE_MAX, `The notice can have at most ${NOTICE_MAX.toLocaleString("en-GB")} characters`)
  .refine((value) => !/\p{Cc}/u.test(value), "Write the notice as one paragraph without line breaks.");

const referenceSchema = z
  .string({ error: "Enter the legal opinion reference." })
  .trim()
  .min(1, "Enter the legal opinion reference.")
  .max(REFERENCE_MAX, `The reference can have at most ${REFERENCE_MAX} characters`)
  .refine((value) => !/\p{Cc}/u.test(value), "Enter the reference on one line.");

export const ruleFormSchema = z
  .object({
    sourceCountry: countrySchema,
    destinationCountry: z.union([z.literal(""), countrySchema]),
    rule: z.string().pipe(z.enum(ruleValues, { error: "Choose a rule." })),
    notice: noticeSchema,
    legalOpinionRef: referenceSchema,
    reason: staffReasonSchema,
  })
  .refine((values) => values.destinationCountry === "" || values.destinationCountry !== values.sourceCountry, {
    path: ["destinationCountry"],
    message: "Choose a destination other than the source country, or all destinations.",
  });

export type RuleForm = z.input<typeof ruleFormSchema>;
export type RuleInput = z.output<typeof ruleFormSchema>;

export const deleteRuleFormSchema = z.object({ reason: staffReasonSchema });

export type DeleteRuleForm = z.input<typeof deleteRuleFormSchema>;

export const deleteRuleInputSchema = deleteRuleFormSchema.extend({ id: z.uuid() });

// What an editor save that changed nothing answers: a review is recorded by the new legal opinion reference.
export const RULE_UNCHANGED = "Nothing changed. To record a review, update the legal opinion reference.";

export function destinationText(name: string | null): string {
  return name ?? "All destinations";
}

// What applies once a rule is deleted (FR-Q5 AC10, AC12): a pair falls back to its source's rule for all destinations,
// a source rule to the default.
export function deleteConsequenceText(rule: Pick<DirectHiringRule, "sourceName" | "destinationCountry" | "destinationName">): string {
  if (rule.destinationCountry) {
    return `Workers in ${rule.sourceName} hired for ${rule.destinationName ?? rule.destinationCountry} then follow the rule for all destinations of ${rule.sourceName}, or the default if there is none: direct hiring allowed with the general notice.`;
  }
  return `${rule.sourceName} returns to the default: direct hiring allowed with the general notice, except where a rule for a single destination remains.`;
}

// The age of a rule in whole days since its last change, as the review of SOP P2-34 step 6 reads it.
export function ruleAgeText(updatedAt: string, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(updatedAt).getTime()) / DAY_MS));
  if (days === 0) return "Last changed today";
  return `Last changed ${days.toLocaleString("en-GB")} ${days === 1 ? "day" : "days"} ago`;
}

export function pairText(values: Pick<RuleValues, "source_country" | "destination_country">): string {
  return `${values.source_country} -> ${values.destination_country ?? "all destinations"}`;
}

// One line per change for the history: what the rule was and became, in the words of the list.
export function changeText(change: DirectHiringRuleChange): string {
  const { before, after } = change;
  if (change.action === "created" && after) return `Added ${pairText(after)}: ${ruleLabels[after.rule]}`;
  if (change.action === "deleted" && before) return `Deleted ${pairText(before)}: ${ruleLabels[before.rule]}`;
  if (change.action === "updated" && before && after) {
    const changed = [
      before.rule !== after.rule ? `rule ${ruleLabels[before.rule]} -> ${ruleLabels[after.rule]}` : null,
      before.notice !== after.notice ? "notice" : null,
      before.legal_opinion_ref !== after.legal_opinion_ref ? `legal opinion ${before.legal_opinion_ref} -> ${after.legal_opinion_ref}` : null,
    ].filter((part) => part !== null);
    return `Changed ${pairText(after)}: ${changed.join("; ")}`;
  }
  return "Changed a rule";
}

export function emptyRuleForm(): RuleForm {
  return { sourceCountry: "", destinationCountry: "", rule: "", notice: "", legalOpinionRef: "", reason: "" };
}

export function ruleFormFrom(rule: DirectHiringRule): RuleForm {
  return {
    sourceCountry: rule.sourceCountry,
    destinationCountry: rule.destinationCountry ?? "",
    rule: rule.rule,
    notice: rule.notice,
    legalOpinionRef: rule.legalOpinionRef,
    reason: "",
  };
}
