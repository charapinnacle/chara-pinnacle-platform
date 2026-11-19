// What an applicant-review component acts on: a direct application (FR-E2) or a partner's submitted candidate (FR-O5),
// which share the stages, the notes and the documents but not the functions behind them.
export type ReviewSubject = { kind: "application" | "submission"; id: string };
