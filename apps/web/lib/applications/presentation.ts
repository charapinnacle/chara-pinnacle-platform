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

// The order of the pipeline, which is the order of the labels above and so of the enum: the type of the labels makes a new
// stage a compile error there, and the board columns follow.
export const pipelineStages = Object.keys(applicationStatusLabels) as ApplicationStatus[];

export const FORMER_CANDIDATE = "Former candidate";

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && Object.hasOwn(applicationStatusLabels, value);
}

export const applicationStageOptions = Object.entries(applicationStatusLabels).map(([value, label]) => ({ value, label }));

// What usually happens next at each stage, in plain words (FR-D3). At most 200 characters each; the text of a decline
// says "not selected" and never "rejected", and the withdrawn text says the employer lost access to the documents.
export const applicationNextSteps: Record<ApplicationStatus, string> = {
  applied: "The employer has received your application. Employers usually open new applications first, so yours should be looked at soon.",
  viewed: "The employer has opened your application. They may add you to a shortlist, invite you to an interview or decide not to continue.",
  shortlisted: "The employer has put you on their shortlist. They usually get in touch to arrange an interview or to ask for more information.",
  interview: "The employer wants to speak with you. Watch your email for the date and time, and prepare any questions you have for them.",
  offer: "The employer has made you an offer. Read it carefully and ask about anything that is unclear before you accept.",
  hired: "You have been hired for this vacancy. The employer will tell you about the next steps, such as paperwork and your start date.",
  rejected: "You were not selected for this vacancy. This does not affect your other applications, and you can still apply to other vacancies.",
  withdrawn: "You withdrew this application. The employer no longer has access to the shared documents.",
};

export const eventActorLabels = { you: "By you", employer: "By the employer", system: "Automatic" } as const;

export type EventActorRole = keyof typeof eventActorLabels;

export const eventNoteLabels: Record<EventActorRole, string> = {
  you: "Your note",
  employer: "Message from the employer",
  system: "Note",
};

export const CROSS_BORDER_NOTICE =
  "Cross-border hiring can be subject to legal requirements, such as work permits and visas. Check what applies to you and to the employer's country before you accept an offer.";

export const NOT_ACCEPTING = "This vacancy is no longer accepting applications";

// The keys are the field names in the detail of CHARA_PROFILE_INCOMPLETE.
export const profileFields: Record<string, { label: string; section: string }> = {
  first_name: { label: "First name", section: "basics" },
  last_name: { label: "Last name", section: "basics" },
  current_country: { label: "Current country", section: "basics" },
  occupation_id: { label: "Occupation", section: "occupation" },
};
