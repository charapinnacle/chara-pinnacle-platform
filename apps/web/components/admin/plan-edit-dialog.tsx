"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { FocusOnMount } from "@/components/admin/focus-on-mount";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast, toastError } from "@/components/feedback/toast-store";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { savePlan } from "@/lib/actions/plan-editor";
import {
  changeLine,
  planChanges,
  planFormSchema,
  planFormValues,
  type EditorLimit,
  type EditorPlan,
  type PlanChanges,
  type PlanForm,
  type PlanFormOutput,
} from "@/lib/validation/plan-editor";

const CONFIRM_ID = "plan-edit-confirm";
const FAILURE = "The changes were not saved";

// The edit dialog of one plan (FR-R2 AC10): name, visibility, trial length, every limit and feature of its type and the
// reason for the change. A submit first lists every change ("Members: 1 -> 2"); nothing is saved before the
// confirmation. A failed save keeps the values entered.
export function PlanEditDialog({ plan }: { plan: EditorPlan }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto" onClick={() => setOpen(true)}>
        Edit<span className="sr-only"> {plan.name} ({plan.code})</span>
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title={`Edit ${plan.name}`}>
        <PlanEditForm plan={plan} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function fieldId(code: string, name: string): string {
  return `plan-${code}-${name.replaceAll(".", "-")}`;
}

function PlanEditForm({ plan, onClose }: { plan: EditorPlan; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<PlanForm, unknown, PlanFormOutput>({
    resolver: zodResolver(planFormSchema),
    defaultValues: planFormValues(plan),
    shouldFocusError: true,
  });
  const { control, formState, handleSubmit, getValues, setError } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE });
  const [pending, setPending] = useState<PlanChanges | null>(null);
  const ids = {
    name: fieldId(plan.code, "name"),
    isPublic: fieldId(plan.code, "isPublic"),
    trialDays: fieldId(plan.code, "trialDays"),
    ...Object.fromEntries(plan.limits.map((limit) => [`limits.${limit.key}.value`, fieldId(plan.code, `limits.${limit.key}.value`)])),
    reason: fieldId(plan.code, "reason"),
  };

  function onReview(values: PlanFormOutput) {
    const changes = planChanges(plan, values);
    if (changes.lines.length === 0) {
      setError("root.server", { type: "server", message: "Nothing was changed. Change at least one value." });
      return;
    }
    setPending(changes);
  }

  function onConfirm(changes: PlanChanges) {
    return submit(
      () =>
        savePlan({
          code: plan.code,
          plan: changes.plan,
          limits: changes.limits,
          features: changes.features,
          reason: getValues("reason"),
        }),
      (result) => {
        if (result.done) {
          onClose();
          toast({ title: `${changes.plan?.name ?? plan.name} is saved`, description: `${changes.lines.length} ${changes.lines.length === 1 ? "change" : "changes"}` });
          router.refresh();
          return;
        }
        setPending(null);
        if (result.message) toastError(FAILURE, result.message);
      },
    );
  }

  if (pending) {
    return (
      <div className="grid gap-4">
        <FocusOnMount targetId={CONFIRM_ID} />
        <p id={CONFIRM_ID} tabIndex={-1} className="text-body font-medium focus:outline-none">
          Save these changes to {plan.name}?
        </p>
        <ul className="grid gap-1 text-body">
          {pending.lines.map((line) => (
            <li key={line.label} className="break-words">
              {changeLine(line)}
            </li>
          ))}
        </ul>
        <p className="text-small text-muted-foreground">They apply at once to every organisation on this plan and are recorded with your reason.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" onClick={() => setPending(null)}>
            Back
          </FormButton>
          <FormButton type="button" busy={formState.isSubmitting} onClick={() => void handleSubmit(() => onConfirm(pending))()}>
            Save changes
          </FormButton>
        </div>
      </div>
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onReview)}>
      <p className="text-small text-muted-foreground break-all">Plan code {plan.code}. Codes never change.</p>
      <FormErrorSummary form={form} ids={ids} />
      <InputField control={control} name="name" id={ids.name} label="Name" autoComplete="off" maxLength={60} />
      {plan.priceMinor > 0 ? (
        <CheckboxField control={control} name="isPublic" id={ids.isPublic}>
          Public: shown on the pricing page and sold
        </CheckboxField>
      ) : (
        <p className="text-small text-muted-foreground">A free plan is never public.</p>
      )}
      <InputField control={control} name="trialDays" id={ids.trialDays} label="Trial days" description="0 to 365" inputMode="numeric" autoComplete="off" maxLength={3} />
      <fieldset className="grid gap-4">
        <legend className="mb-2 text-body font-semibold">Limits</legend>
        {plan.limits.map((limit) => (
          <LimitField key={limit.key} control={control} code={plan.code} limit={limit} />
        ))}
      </fieldset>
      <fieldset className="grid gap-1">
        <legend className="mb-2 text-body font-semibold">Features</legend>
        {plan.features.map((feature) => (
          <CheckboxField key={feature.key} control={control} name={`features.${feature.key}`} id={fieldId(plan.code, `features.${feature.key}`)} compact>
            {feature.label}
          </CheckboxField>
        ))}
      </fieldset>
      <TextareaField
        control={control}
        name="reason"
        id={ids.reason}
        label="Reason for the change"
        description="Required, 10 to 500 characters. It is recorded with the old and new values."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit">Review changes</FormButton>
      </div>
    </form>
  );
}

function LimitField({ control, code, limit }: { control: Control<PlanForm, unknown, PlanFormOutput>; code: string; limit: EditorLimit }) {
  const unlimited = useWatch({ control, name: `limits.${limit.key}.unlimited` });
  return (
    <div className="grid gap-1">
      {unlimited ? (
        <p className="text-small">
          <span className="font-medium">{limit.label}</span>: Unlimited
        </p>
      ) : (
        <InputField
          control={control}
          name={`limits.${limit.key}.value`}
          id={fieldId(code, `limits.${limit.key}.value`)}
          label={limit.label}
          inputMode="numeric"
          autoComplete="off"
          maxLength={7}
        />
      )}
      <CheckboxField control={control} name={`limits.${limit.key}.unlimited`} id={fieldId(code, `limits.${limit.key}.unlimited`)} compact>
        Unlimited<span className="sr-only"> {limit.label.toLowerCase()}</span>
      </CheckboxField>
    </div>
  );
}
