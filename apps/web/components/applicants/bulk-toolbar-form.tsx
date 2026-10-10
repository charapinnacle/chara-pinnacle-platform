"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { BulkResultSummary, BulkReviewBody, type BulkResult, type BulkReview } from "@/components/applicants/bulk-review";
import { useBulkSelection } from "@/components/applicants/bulk-selection";
import { toastError } from "@/components/feedback/toast-store";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { TextareaField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { Card } from "@/components/layout/card";
import { bulkChangeApplicantStage } from "@/lib/actions/applicants";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import {
  bulkSelectionSchema,
  declineReasonOptions,
  employerStages,
  stageChangeFormSchema,
  type StageChangeFormOutput,
  type StageChangeFormValues,
} from "@/lib/validation/applicant";

export type BulkToolbarProps = { slug: string; shortlisting: boolean; noteMaxChars: number };

const ids = { status: "bulk-status", reason: "bulk-reason", note: "bulk-note", selection: "bulk-selected" } as const;

const targets = employerStages.map((value) => ({
  value,
  label: value === "rejected" ? `Decline (${applicationStatusLabels[value]})` : `Move to ${applicationStatusLabels[value]}`,
}));

// Bulk change of stage or decline for the applicants ticked in the list or on the board. Review checks the form and opens
// the confirmation; only Confirm sends anything. The database judges every applicant on its own, so the summary reports
// the ones it refused, and those stay ticked.
export function BulkToolbarForm({ slug, shortlisting, noteMaxChars }: BulkToolbarProps) {
  const router = useRouter();
  const selection = useBulkSelection();
  const selected = selection?.selected ?? [];
  const schema = useMemo(() => stageChangeFormSchema(noteMaxChars), [noteMaxChars]);
  const form = useForm<StageChangeFormValues, undefined, StageChangeFormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { status: "", reason: "", note: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, setError } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The stage was not changed" });
  const [review, setReview] = useState<BulkReview | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const status = useWatch({ control, name: "status" });
  const reason = useWatch({ control, name: "reason" });
  const noteLength = useWatch({ control, name: "note" }).length;
  const declining = status === "rejected";

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
    else setError("root.selection", { message: check.error.issues[0].message });
  }

  async function confirm() {
    if (!review) return;
    const { values, rows } = review;
    setConfirming(true);
    await submit(
      () => bulkChangeApplicantStage(slug, { applicationIds: rows.map((row) => row.id), status: values.status, note: values.note }),
      (response) => {
        setReview(null);
        if (response.summary) {
          const names = new Map(rows.map((row) => [row.id, row.name]));
          selection?.deselect(response.summary.updated);
          setResult({
            updated: response.summary.updated.length,
            refused: response.summary.refused.map((item) => ({ ...item, name: names.get(item.id) ?? "Applicant" })),
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
            placeholder="Choose an action"
            options={targets.filter((target) => target.value !== "shortlisted" || shortlisting)}
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
            description={`${declining ? "" : "Optional. "}The candidates see this text. ${noteLength}/${noteMaxChars}`}
          />
        ) : null}
        <FormButton type="submit" className="w-full sm:w-auto sm:justify-self-start" disabled={selected.length === 0}>
          Review
        </FormButton>
      </form>
      {result ? <BulkResultSummary result={result} onDismiss={() => setResult(null)} /> : null}
      <ModalDialog open={review !== null} onClose={() => setReview(null)} title="Review the bulk action" closeOnBackdrop>
        {review ? (
          <BulkReviewBody review={review} busy={confirming} onCancel={() => setReview(null)} onConfirm={confirm} />
        ) : null}
      </ModalDialog>
    </Card>
  );
}
