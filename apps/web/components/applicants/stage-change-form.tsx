"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { changeApplicantStage } from "@/lib/actions/applicants";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import type { Database } from "@chara-pinnacle/db-types";
import {
  declineReasonOptions,
  stageChangeFormSchema,
  type StageChangeFormOutput,
  type StageChangeFormValues,
} from "@/lib/validation/applicant";

export type StageChangeProps = {
  slug: string;
  applicationId: string;
  applicantName: string;
  targets: Database["public"]["Enums"]["application_status"][];
  noteMaxChars: number;
  initialStatus?: Database["public"]["Enums"]["application_status"];
};

const ids = { status: "stage-change-status", reason: "stage-change-reason", note: "stage-change-note" } as const;

// Two steps in one dialog: choose the stage and write the note, or for Not selected choose the reason, then check what
// will be sent. Nothing is applied before the second step is confirmed; a refusal closes the dialog and shows a toast,
// which a dialog would hide.
export function StageChangeForm({
  slug,
  applicationId,
  applicantName,
  targets,
  noteMaxChars,
  initialStatus,
  onClose,
}: StageChangeProps & { onClose: () => void }) {
  const schema = useMemo(() => stageChangeFormSchema(noteMaxChars), [noteMaxChars]);
  const form = useForm<StageChangeFormValues, undefined, StageChangeFormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { status: initialStatus ?? "", reason: "", note: "" },
    shouldFocusError: false,
  });
  const [review, setReview] = useState<StageChangeFormOutput | null>(null);
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The stage was not changed" });
  const noteLength = useWatch({ control, name: "note" }).length;
  const status = useWatch({ control, name: "status" });
  const reason = useWatch({ control, name: "reason" });
  const declining = status === "rejected";
  const noteLabel = declining ? "Other reason (visible to the candidate)" : "Note (visible to the candidate)";

  function confirm(values: StageChangeFormOutput) {
    return submit(
      () => changeApplicantStage(slug, applicationId, { status: values.status, note: values.note }),
      (result) => {
        if (result.done) {
          onClose();
          toast({ title: `Stage changed to ${applicationStatusLabels[values.status]}` });
        } else if (result.errors) {
          setReview(null);
        } else if (result.message) {
          onClose();
          toastError("The stage was not changed", result.message);
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-5" onSubmit={handleSubmit(review ? confirm : setReview)}>
      {review ? (
        <>
          <dl className="grid gap-3">
            <div className="grid gap-0.5">
              <dt className="text-small text-muted-foreground">Applicant</dt>
              <dd className="font-medium wrap-anywhere">{applicantName}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-small text-muted-foreground">New stage</dt>
              <dd className="font-medium">{applicationStatusLabels[review.status]}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-small text-muted-foreground">
                {review.status === "rejected" ? "Reason (visible to the candidate)" : "Note (visible to the candidate)"}
              </dt>
              <dd className="wrap-anywhere whitespace-pre-line">{review.note === "" ? "No note" : review.note}</dd>
            </div>
          </dl>
          {review.status === "rejected" ? (
            <Notice tone="info">A decision of Not selected is final. The candidate is told by email.</Notice>
          ) : (
            <Notice tone="info">The candidate is told by email.</Notice>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormButton type="button" variant="secondary" className="w-full" onClick={() => setReview(null)}>
              Back
            </FormButton>
            <FormButton type="submit" busy={formState.isSubmitting}>
              Confirm
            </FormButton>
          </div>
        </>
      ) : (
        <>
          <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
          <SelectField
            control={control}
            name="status"
            id={ids.status}
            label="New stage"
            placeholder="Choose a stage"
            options={targets.map((value) => ({ value, label: applicationStatusLabels[value] }))}
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
          {!declining || reason === "other" ? (
            <TextareaField
              control={control}
              name="note"
              id={ids.note}
              label={noteLabel}
              description={`${declining ? "" : "Optional. "}The candidate sees this text. ${noteLength}/${noteMaxChars}`}
            />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormButton type="button" variant="secondary" className="w-full" onClick={onClose}>
              Cancel
            </FormButton>
            <FormButton type="submit">Review</FormButton>
          </div>
        </>
      )}
    </form>
  );
}
