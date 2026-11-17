"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toastError } from "@/components/feedback/toast-store";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { TextareaField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { Card } from "@/components/layout/card";
import type { PipelineRow } from "@/components/submissions/submission-pipeline";
import { bulkChangeSubmissionStage } from "@/lib/actions/submission-pipeline";
import { employerSubmissionLabels, submittedByLabel } from "@/lib/submissions/presentation";
import {
  bulkSelectionSchema,
  declineReasonOptions,
  employerStages,
  stageChangeFormSchema,
  type StageChangeFormOutput,
  type StageChangeFormValues,
} from "@/lib/validation/applicant";
import { SUBMISSION_REASON_MIN_CHARS } from "@/lib/validation/submission-pipeline";

export type SubmissionBulkActionsProps = {
  slug: string;
  shortlisting: boolean;
  noteMaxChars: number;
  selected: PipelineRow[];
  onMoved: (ids: ReadonlySet<string>) => void;
};

type Review = { values: StageChangeFormOutput; rows: PipelineRow[] };
type Result = { moved: number; skipped: { id: string; name: string; message: string }[] };

const ids = { status: "submission-bulk-status", reason: "submission-bulk-reason", note: "submission-bulk-note", selection: "submission-bulk-selected" } as const;

// The bulk action of FR-O5 AC8: every target is offered whatever the selected candidates' stages are, the confirmation
// lists each candidate with the partner and says that withdrawn candidates and moves the stage does not allow are
// skipped, and the summary counts the moved and the skipped.
export function SubmissionBulkActions({ slug, shortlisting, noteMaxChars, selected, onMoved }: SubmissionBulkActionsProps) {
  const router = useRouter();
  const [review, setReview] = useState<Review | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, setConfirming] = useState(false);
  const schema = useMemo(() => stageChangeFormSchema(noteMaxChars, SUBMISSION_REASON_MIN_CHARS), [noteMaxChars]);
  const form = useForm<StageChangeFormValues, undefined, StageChangeFormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { status: "", reason: "", note: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, setError } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The stage was not changed" });
  const status = useWatch({ control, name: "status" });
  const reason = useWatch({ control, name: "reason" });
  const noteLength = useWatch({ control, name: "note" }).length;
  const declining = status === "rejected";
  const options = employerStages
    .filter((value) => value !== "shortlisted" || shortlisting)
    .map((value) => ({
      value,
      label: value === "rejected" ? `Decline (${employerSubmissionLabels[value]})` : `Move to ${employerSubmissionLabels[value]}`,
    }));

  const items: ErrorSummaryItem[] = [
    ...(["status", "reason", "note"] as const).flatMap((name) => {
      const error = formState.errors[name];
      return error ? [{ key: name, message: String(error.message), targetId: ids[name] }] : [];
    }),
    ...(formState.errors.root?.selection?.message
      ? [{ key: "selection", message: formState.errors.root.selection.message, targetId: ids.selection }]
      : []),
  ];

  function startReview(values: StageChangeFormOutput) {
    const check = bulkSelectionSchema.safeParse(selected.map((row) => row.id));
    if (check.success) setReview({ values, rows: selected });
    else setError("root.selection", { message: check.error.issues[0].message.replace("applicants", "candidates") });
  }

  async function confirm() {
    if (!review) return;
    const { values, rows: chosen } = review;
    setConfirming(true);
    await submit(
      () => bulkChangeSubmissionStage(slug, { submissionIds: chosen.map((row) => row.id), status: values.status, note: values.note }),
      (response) => {
        setReview(null);
        if (response.summary) {
          const names = new Map(chosen.map((row) => [row.id, row.candidateName]));
          onMoved(new Set(response.summary.moved));
          setResult({
            moved: response.summary.moved.length,
            skipped: response.summary.skipped.map((item) => ({ ...item, name: names.get(item.id) ?? "Candidate" })),
          });
          router.refresh();
        } else if (response.message) {
          toastError("The stage was not changed", response.message);
        }
      },
    );
    setConfirming(false);
  }

  return (
    <Card as="section" aria-label="Bulk actions" className="gap-4">
      <form noValidate className="grid gap-4" onSubmit={handleSubmit(startReview)}>
        <ErrorSummary
          ref={summaryRef}
          items={items}
          onSelect={(key) => {
            if (key === "selection") document.getElementById(ids.selection)?.focus();
            else form.setFocus(key as FieldPath<StageChangeFormValues>);
          }}
        />
        <p id={ids.selection} tabIndex={-1} role="status" className="font-medium outline-none">
          {selected.length} selected
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={control}
            name="status"
            id={ids.status}
            label="Action"
            placeholder={selected.length === 0 ? "Select candidates first" : "Choose an action"}
            options={options}
          />
          {declining ? (
            <SelectField
              control={control}
              name="reason"
              id={ids.reason}
              label="Reason (visible to the candidate)"
              placeholder="Choose a reason"
              options={declineReasonOptions}
            />
          ) : null}
        </div>
        {!declining || reason === "other" ? (
          <TextareaField
            control={control}
            name="note"
            id={ids.note}
            label={declining ? "Other reason (visible to the candidate)" : "Note (visible to the candidate)"}
            description={`${declining ? `At least ${SUBMISSION_REASON_MIN_CHARS} characters. ` : "Optional. "}The candidates see this text, the partners do not. ${noteLength}/${noteMaxChars}`}
          />
        ) : null}
        <FormButton type="submit" className="w-full sm:w-auto sm:justify-self-start" disabled={selected.length === 0}>
          Review
        </FormButton>
      </form>
      {result ? (
        <Notice tone="info" role="status" className="grid gap-2">
          <p className="font-medium">
            {result.moved} moved, {result.skipped.length} skipped
          </p>
          {result.skipped.length > 0 ? (
            <ul className="grid list-disc gap-1 ps-5">
              {result.skipped.map((item) => (
                <li key={item.id} className="wrap-anywhere">
                  {item.name}: {item.message}
                </li>
              ))}
            </ul>
          ) : null}
          <FormButton type="button" variant="secondary" className="w-auto justify-self-start" onClick={() => setResult(null)}>
            Dismiss
          </FormButton>
        </Notice>
      ) : null}

      <ModalDialog open={review !== null} onClose={() => setReview(null)} title="Review the bulk action" closeOnBackdrop>
        {review ? (
          <>
            <div className="grid gap-1.5">
              <p className="text-small text-muted-foreground">
                {review.rows.length} {review.rows.length === 1 ? "candidate" : "candidates"}
              </p>
              <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-3">
                {review.rows.map((row) => (
                  <li key={row.id} className="flex flex-wrap justify-between gap-x-3 text-body">
                    <span className="font-medium wrap-anywhere">
                      {row.candidateName} <span className="font-normal text-muted-foreground">({submittedByLabel(row.partnerName)})</span>
                    </span>
                    <span className="text-muted-foreground">{employerSubmissionLabels[row.status]}</span>
                  </li>
                ))}
              </ul>
            </div>
            <dl className="grid gap-3">
              <div className="grid gap-0.5">
                <dt className="text-small text-muted-foreground">New stage</dt>
                <dd className="font-medium">{employerSubmissionLabels[review.values.status]}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-small text-muted-foreground">Visible to the candidate</dt>
                <dd className="wrap-anywhere whitespace-pre-line">{review.values.note === "" ? "No note" : review.values.note}</dd>
              </div>
            </dl>
            <Notice tone="info">
              Withdrawn candidates and moves their stage does not allow will be skipped. Each moved candidate is told by email; the
              partner sees the new stage but never the note.
            </Notice>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormButton type="button" variant="secondary" className="w-full" onClick={() => setReview(null)}>
                Cancel
              </FormButton>
              <FormButton type="button" busy={confirming} onClick={confirm}>
                Confirm
              </FormButton>
            </div>
          </>
        ) : null}
      </ModalDialog>
    </Card>
  );
}
