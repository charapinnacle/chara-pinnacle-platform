import * as z from "zod";
import type { Database } from "@chara-pinnacle/db-types";
import type { Noun } from "@/lib/chips";
import type { PartnerType } from "@/lib/validation/sign-up";

type ServiceType = Database["public"]["Enums"]["partner_service_type"];
type RecruitmentType = Database["public"]["Enums"]["recruitment_preference"];
type SizeBand = Database["public"]["Enums"]["workforce_size_band"];

export const recruitmentTypes = ["local", "international", "both"] as const satisfies readonly RecruitmentType[];
export const staffingTypes = ["temporary", "contract", "project", "permanent"] as const satisfies readonly ServiceType[];
export const sizeBands = ["1_49", "50_249", "250_999", "1000_plus"] as const satisfies readonly SizeBand[];

export const recruitmentTypeLabels: Record<RecruitmentType, string> = {
  local: "Local",
  international: "International",
  both: "Both",
};

export const staffingTypeLabels: Record<(typeof staffingTypes)[number], string> = {
  temporary: "Temporary",
  contract: "Contract",
  project: "Project",
  permanent: "Permanent",
};

export const sizeBandLabels: Record<SizeBand, string> = {
  "1_49": "1 to 49 people",
  "50_249": "50 to 249 people",
  "250_999": "250 to 999 people",
  "1000_plus": "1,000 people or more",
};

export const occupationNoun: Noun = { one: "occupation", other: "occupations" };
export const industryNoun: Noun = { one: "industry", other: "industries" };
export const languageNoun: Noun = { one: "language", other: "languages" };

const FROM_LIST = "Choose from the list.";
const STAFFING_TYPE_REQUIRED = "Choose at least one staffing type";

const codeList = (pattern: RegExp, normalise: (code: string) => string) =>
  z
    .array(z.string().trim().transform(normalise).pipe(z.string().regex(pattern, { error: FROM_LIST })))
    .transform((codes) => [...new Set(codes)]);

// The founded year is typed; empty means not given.
const YEAR = /^\d{4}$/;
const foundedYear = z
  .string()
  .trim()
  .refine((value) => value === "" || YEAR.test(value), { error: "Enter a year, for example 2015." })
  .refine((value) => !YEAR.test(value) || (Number(value) >= 1800 && Number(value) <= new Date().getFullYear()), {
    error: () => `Enter a year between 1800 and ${new Date().getFullYear()}.`,
  });

// What you offer (FR-K2). A staffing company names at least one staffing type; a recruitment company ticks "We also
// supply staff" to name staffing types, and then at least one [d2.4].
export function workforceOfferSchema(type: PartnerType) {
  return z
    .object({
      occupations: codeList(/^\d{4}$/, (code) => code).refine((codes) => codes.length > 0, {
        error: "Choose at least one occupation",
      }),
      industries: codeList(/^[A-Z]$/, (code) => code.toUpperCase()),
      languages: codeList(/^[a-z]{2}$/, (code) => code.toLowerCase()),
      recruitmentType: z
        .string({ error: "Choose a recruitment type" })
        .pipe(z.enum(recruitmentTypes, { error: "Choose a recruitment type" })),
      staffingService: z.boolean(),
      staffingTypes: z.array(z.enum(staffingTypes, { error: FROM_LIST })).transform((codes) => [...new Set(codes)]),
      sizeBand: z.string().pipe(z.enum(["", ...sizeBands], { error: FROM_LIST })),
      foundedYear,
    })
    .superRefine((offer, context) => {
      const needsTypes = type === "staffing_company" || offer.staffingService;
      if (needsTypes && offer.staffingTypes.length === 0) {
        context.addIssue({ code: "custom", path: ["staffingTypes"], message: STAFFING_TYPE_REQUIRED });
      }
    });
}

export type WorkforceOfferInput = z.input<ReturnType<typeof workforceOfferSchema>>;
export type WorkforceOffer = z.output<ReturnType<typeof workforceOfferSchema>>;

// The service types the database stores: the staffing types of a staffing company; staffing and its types for a
// recruitment company that supplies staff, nothing otherwise (types left ticked while staffing is off are dropped).
export function toServiceTypes(type: PartnerType, offer: Pick<WorkforceOffer, "staffingService" | "staffingTypes">): ServiceType[] {
  if (type === "staffing_company") return offer.staffingTypes;
  return offer.staffingService ? ["staffing", ...offer.staffingTypes] : [];
}

export function fromServiceTypes(services: readonly ServiceType[]): Pick<WorkforceOfferInput, "staffingService" | "staffingTypes"> {
  return {
    staffingService: services.includes("staffing"),
    staffingTypes: staffingTypes.filter((service) => services.includes(service)),
  };
}

export function occupationsLimitMessage(limit: number): string {
  return `Your plan includes ${limit} ${limit === 1 ? "occupation" : "occupations"}.`;
}
