// The states of a partner licence and of its evidence file (FR-J2), apart from the licence form so that the staff review
// reads them without the upload rules.
export type LicenceStatus = "current" | "expired";
export type EvidenceStatus = "pending" | "skipped" | "clean" | "rejected";

export const evidenceStatusLabels: Record<EvidenceStatus, string> = {
  pending: "Checking the file",
  skipped: "File received",
  clean: "File received",
  rejected: "The file was refused. Upload it again.",
};
