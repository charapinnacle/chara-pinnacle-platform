import type { Database } from "@chara-pinnacle/db-types";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

// "Not selected" is what the candidate sees for the stored value rejected.
export const applicationStatusLabels: Record<ApplicationStatus, string> = {
  applied: "Applied",
  viewed: "Viewed",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Not selected",
  withdrawn: "Withdrawn",
};

export const CROSS_BORDER_NOTICE =
  "Cross-border hiring can be subject to legal requirements, such as work permits and visas. Check what applies to you and to the employer's country before you accept an offer.";

export const NOT_ACCEPTING = "This vacancy is no longer accepting applications";

// The fields apply_to_job names when a passport is incomplete, with the section of the passport page that holds each.
export const profileFields: Record<string, { label: string; section: string }> = {
  first_name: { label: "First name", section: "basics" },
  last_name: { label: "Last name", section: "basics" },
  current_country: { label: "Current country", section: "basics" },
  occupation_id: { label: "Occupation", section: "occupation" },
};
