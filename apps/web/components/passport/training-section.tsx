"use client";

import { useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { ConfirmRemoveButton } from "@/components/passport/confirm-remove-button";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { addTraining, removeTraining, updateTraining } from "@/lib/actions/passport";
import type { Passport } from "@/lib/dal/passport";
import { FIRST_TRAINING_YEAR, trainingFormSchema } from "@/lib/validation/passport-extensions";

type Entry = Passport["training"][number];

export function TrainingSection({ entries, max }: { entries: Entry[]; max: number }) {
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const close = () => setEditing(null);

  return (
    <div className="grid gap-5">
      {entries.length === 0 ? (
        <p className="text-body text-muted-foreground">No training added yet</p>
      ) : (
        <ul className="grid gap-2" aria-label="Training">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-1.5">
              <span className="min-w-0 break-words">
                {entry.course}{" "}
                <span className="text-muted-foreground">
                  ({entry.provider ? `${entry.provider}, ` : ""}
                  {entry.yearCompleted})
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                <FormButton type="button" variant="secondary" onClick={() => setEditing(entry)}>
                  Edit<span className="sr-only"> {entry.course}</span>
                </FormButton>
                <ConfirmRemoveButton name={entry.course} removed="Training removed" remove={() => removeTraining(entry.id)} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid justify-items-start gap-2">
        <FormButton type="button" variant="secondary" onClick={() => setEditing("new")}>
          Add training
        </FormButton>
        <p className="text-small text-muted-foreground">You can add up to {max} training entries.</p>
      </div>
      <ModalDialog open={editing !== null} onClose={close} title={editing === "new" ? "Add training" : "Edit training"}>
        {editing ? <TrainingForm entry={editing === "new" ? null : editing} onClose={close} /> : null}
      </ModalDialog>
    </div>
  );
}

function TrainingForm({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  const { form, onSubmit } = usePassportForm(
    trainingFormSchema(),
    {
      course: entry?.course ?? "",
      provider: entry?.provider ?? "",
      yearCompleted: entry ? String(entry.yearCompleted) : "",
    },
    (values) => (entry ? updateTraining(entry.id, values) : addTraining(values)),
    { failureTitle: "Could not save the training", saved: entry ? "Training saved" : "Training added", onSaved: onClose },
  );

  return (
    <form noValidate className="grid gap-4" onSubmit={onSubmit}>
      <InputField control={form.control} name="course" label="Course" maxLength={120} />
      <InputField control={form.control} name="provider" label="Provider" description="Optional." maxLength={120} />
      <InputField
        control={form.control}
        name="yearCompleted"
        label="Year completed"
        description={`From ${FIRST_TRAINING_YEAR} to this year.`}
        inputMode="numeric"
        maxLength={4}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={form.formState.isSubmitting}>
          Save training
        </FormButton>
      </div>
    </form>
  );
}
