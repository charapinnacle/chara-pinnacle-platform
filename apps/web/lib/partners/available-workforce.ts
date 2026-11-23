import * as z from "zod";

// The bounds repeat those of public.search_available_workforce, which stays the authority and refuses again.
const MAX_WORKERS = 100_000;
const MAX_WITHIN_DAYS = 365;

function wholeNumber(max: number, error: string) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, { error })
    .refine((value) => Number(value) >= 1 && Number(value) <= max, { error });
}

// Who can supply this many workers of one occupation for one destination within so many days (FR-K3 step Search). Every
// field is needed: the question is about one requirement.
export const availableWorkforceSchema = z.object({
  occupation: z.string().regex(/^\d{4}$/, { error: "Select an occupation from the list." }),
  destination: z.string().toUpperCase().regex(/^[A-Z]{2}$/, { error: "Select a destination country from the list." }),
  workers: wholeNumber(MAX_WORKERS, "Enter a number of workers from 1 to 100,000."),
  within_days: wholeNumber(MAX_WITHIN_DAYS, "Enter a number of days from 1 to 365."),
});

export type AvailableWorkforceInput = z.input<typeof availableWorkforceSchema>;

export type WorkforceListing = {
  sourceCountry: string;
  available: string;
  monthlyCapacity: string;
  availableFrom: string;
  confirmedAt: string;
};

export type WorkforceSupplier = {
  id: string;
  slug: string;
  displayName: string;
  recruitmentCompany: boolean;
  supply: string;
  availableNow: string;
  listings: WorkforceListing[];
};

export type AvailableWorkforcePage = { suppliers: WorkforceSupplier[]; nextCursor: string | null };
