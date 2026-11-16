import * as z from "zod";
import type { Noun } from "@/lib/chips";
import type { PartnerType } from "@/lib/validation/sign-up";

// The number of reference countries: no list can name more (FR-K1).
const MAX_COUNTRIES = 250;

// The served countries are worded after the partner type (FR-K1 AC9): a staffing company supplies workers.
export const servedQuestion: Record<PartnerType, string> = {
  recruitment_company: "Where do you recruit for?",
  staffing_company: "Where do you supply workers for?",
};

const servedRequired: Record<PartnerType, string> = {
  recruitment_company: "Choose at least one country you recruit for",
  staffing_company: "Choose at least one country you supply workers for",
};

const countryList = (required: string) =>
  z
    .array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, { error: "Choose countries from the list." }))
    .min(1, { error: required })
    .max(MAX_COUNTRIES, { error: "Choose countries from the list." })
    .transform((codes) => [...new Set(codes)]);

export function geographiesSchema(type: PartnerType) {
  return z.object({
    sourcesFrom: countryList("Choose at least one country you source workers from"),
    servesMarket: countryList(servedRequired[type]),
  });
}

export type GeographiesInput = z.input<ReturnType<typeof geographiesSchema>>;

export function marketsLimitMessage(limit: number): string {
  return `Your plan includes ${limit} ${limit === 1 ? "country" : "countries"} served.`;
}

export const countryNoun: Noun = { one: "country", other: "countries" };
