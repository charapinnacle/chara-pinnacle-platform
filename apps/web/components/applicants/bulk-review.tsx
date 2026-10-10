import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import type { SelectableRow } from "@/components/applicants/bulk-selection";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import type { StageChangeFormOutput } from "@/lib/validation/applicant";

export type BulkReview = { values: StageChangeFormOutput; rows: SelectableRow[] };

type BulkReviewBodyProps = { review: BulkReview; busy: boolean; onCancel: () => void; onConfirm: () => void };

// The confirmation step: every selected applicant with the stage they are in now, the target and the text the candidates
// will read. Nothing has been sent when this is shown.
export function BulkReviewBody({ review, busy, onCancel, onConfirm }: BulkReviewBodyProps) {
  const { values, rows } = review;
  const declining = values.status === "rejected";
  return (
    <>
      <div className="grid gap-1.5">
        <p className="text-small text-muted-foreground">
          {rows.length} {rows.length === 1 ? "applicant" : "applicants"}
        </p>
        <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-3">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap justify-between gap-x-3 text-body">
              <span className="font-medium wrap-anywhere">{row.name}</span>
              <span className="text-muted-foreground">{applicationStatusLabels[row.status]}</span>
            </li>
          ))}
        </ul>
      </div>
      <dl className="grid gap-3">
        <div className="grid gap-0.5">
          <dt className="text-small text-muted-foreground">New stage</dt>
          <dd className="font-medium">{applicationStatusLabels[values.status]}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-small text-muted-foreground">Visible to the candidate</dt>
          <dd className="wrap-anywhere whitespace-pre-line">{values.note === "" ? "No note" : values.note}</dd>
        </div>
      </dl>
      <Notice tone="info">
        {declining
          ? "A decision of Not selected is final. Each candidate is told by email, and this cannot be undone."
          : "Each candidate is told by email."}
      </Notice>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" className="w-full" onClick={onCancel}>
          Cancel
        </FormButton>
        <FormButton type="button" busy={busy} onClick={onConfirm}>
          Confirm
        </FormButton>
      </div>
    </>
  );
}

export type BulkResult = { updated: number; refused: { id: string; name: string; message: string }[] };

// The report: how many were changed and each refused applicant with the reason, until it is dismissed.
export function BulkResultSummary({ result, onDismiss }: { result: BulkResult; onDismiss: () => void }) {
  return (
    <Notice tone="info" role="status" className="grid gap-2">
      <p className="font-medium">
        {result.updated} updated, {result.refused.length} refused
      </p>
      {result.refused.length > 0 ? (
        <ul className="grid list-disc gap-1 ps-5">
          {result.refused.map((item) => (
            <li key={item.id} className="wrap-anywhere">
              {item.name}: {item.message}
            </li>
          ))}
        </ul>
      ) : null}
      <FormButton type="button" variant="secondary" className="w-auto justify-self-start" onClick={onDismiss}>
        Dismiss
      </FormButton>
    </Notice>
  );
}
