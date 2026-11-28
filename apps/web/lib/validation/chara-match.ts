import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { formatCount } from "@/lib/i18n/format";
import { recruitmentPreferences } from "@/lib/validation/job";
import { dateWithin, parseDate, todayUtc } from "@/lib/validation/passport";
import { WORKERS_MAX } from "@/lib/validation/requirement";

type MatchArgs = Database["public"]["Functions"]["chara_match"]["Args"];

// The arguments the form decides; the organisation comes from the address.
export type CharaMatchArgs = Omit<MatchArgs, "p_org">;

const START_MONTHS_AHEAD = 36;

function code(pattern: RegExp, message: string) {
  return z.string({ error: message }).trim().toUpperCase().regex(pattern, { error: message });
}

// The form's own schema (ARCHITECTURE.md section 9.3): numbers and dates stay strings so the form can use it as its resolver;
// toCharaMatchArgs converts them. The same bounds as chara_match, which stays the authority. today is the UTC date the
// start is compared with, as chara_match compares it.
export function charaMatchFormSchema(today: string = todayUtc()) {
  return z.object({
    destination: code(/^[A-Z]{2}$/, "Select a country from the list."),
    industry: code(/^[A-Z]$/, "Select an industry from the list."),
    occupation: z
      .string({ error: "Select an occupation from the list." })
      .trim()
      .regex(/^\d{4}$/, { error: "Select an occupation from the list." }),
    workers: z
      .string({ error: "Enter the number of workers." })
      .trim()
      .min(1, { error: "Enter the number of workers.", abort: true })
      .refine((value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= WORKERS_MAX, {
        error: `Enter a whole number from 1 to ${formatCount(WORKERS_MAX)}.`,
      }),
    start: z
      .string({ error: "Enter the start date." })
      .trim()
      .superRefine((value, context) => {
        const message =
          value === ""
            ? "Enter the start date."
            : parseDate(value) === null
              ? "Choose a valid date."
              : value < today
                ? "The start date cannot be in the past."
                : !dateWithin(value, today, START_MONTHS_AHEAD)
                  ? "Choose a start date within the next 3 years."
                  : null;
        if (message) context.addIssue({ code: "custom", message });
      }),
    recruitment: z
      .string({ error: "Select a recruitment type." })
      .pipe(z.enum(recruitmentPreferences, { error: "Select a recruitment type." })),
  });
}

export type CharaMatchFormInput = z.input<ReturnType<typeof charaMatchFormSchema>>;
export type CharaMatchFormValues = z.output<ReturnType<typeof charaMatchFormSchema>>;

export const emptyCharaMatchForm: CharaMatchFormInput = {
  destination: "",
  industry: "",
  occupation: "",
  workers: "",
  start: "",
  recruitment: "",
};

export function toCharaMatchArgs(values: CharaMatchFormValues): CharaMatchArgs {
  return {
    p_destination: values.destination,
    p_industry: values.industry,
    p_occupation: values.occupation,
    p_workers: Number(values.workers),
    p_start: values.start,
    p_recruitment: values.recruitment,
  };
}

// The values a link may prefill (a workforce requirement's "Find matches", or a run shown again): each kept only when it
// has the shape of its field, so a hand-edited address never reaches the form as something else.
export function charaMatchPrefill(params: Record<string, string | string[] | undefined>): CharaMatchFormInput {
  const value = (key: keyof CharaMatchFormInput, pattern: RegExp) => {
    const raw = params[key];
    return typeof raw === "string" && pattern.test(raw) ? raw : "";
  };
  return {
    destination: value("destination", /^[A-Z]{2}$/),
    industry: value("industry", /^[A-Z]$/),
    occupation: value("occupation", /^\d{4}$/),
    workers: value("workers", /^\d{1,6}$/),
    start: value("start", /^\d{4}-\d{2}-\d{2}$/),
    recruitment: value("recruitment", /^(local|international|both)$/),
  };
}

export function charaMatchQuery(values: Partial<CharaMatchFormInput>): string {
  const query = new URLSearchParams();
  for (const [key, entry] of Object.entries(values)) if (entry) query.set(key, entry);
  return query.toString();
}
