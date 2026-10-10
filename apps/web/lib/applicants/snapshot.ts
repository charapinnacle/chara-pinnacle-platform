import * as z from "@/lib/zod";

// The profile as the application stored it (private.profile_snapshot in the database). Every key can be missing: an
// application of a candidate who was erased has lost the name and the headline, and a snapshot is never rewritten.
const snapshotSchema = z.object({
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  headline: z.string().nullish(),
  current_country: z.string().nullish(),
  occupation: z.string().nullish(),
  years_experience: z.number().nullish(),
  availability: z.enum(["now", "from_date", "unavailable"]).nullish(),
  available_from: z.string().nullish(),
  skills: z.array(z.string()).default([]),
  languages: z.array(z.object({ code: z.string(), level: z.string() })).default([]),
  preferred_countries: z.array(z.string()).default([]),
  work_authorizations: z.array(z.object({ country: z.string(), expires_on: z.string().nullable() })).default([]),
});

export type ApplicantSnapshot = z.output<typeof snapshotSchema>;

export function parseSnapshot(value: unknown): ApplicantSnapshot {
  return snapshotSchema.parse(value);
}
