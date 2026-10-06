export const COMPLAINTS_SLUG = "complaints-and-dispute-process";

export const DELETED_DOCUMENT = "Deleted document";

const purposeLabels: Record<string, string> = {
  application_review: "Application review",
};

export function purposeLabel(purpose: string): string {
  return purposeLabels[purpose] ?? "Opened";
}
