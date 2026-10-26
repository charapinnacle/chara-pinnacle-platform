"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FocusOnMount } from "@/components/admin/focus-on-mount";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { saveSetting } from "@/lib/actions/plan-editor";
import { releaseWarning, ruleText, settingFormSchema, settingValueText, type SettingForm, type SettingRule } from "@/lib/validation/plan-editor";

const FAILURE = "The setting was not saved";
const booleanOptions = [
  { value: "true", label: "On" },
  { value: "false", label: "Off" },
];

// Changes one allow-listed setting with a reason (FR-R2 AC7). The new value is confirmed before it is saved; turning a
// release switch on says that the release goes live for everyone, and is not offered while a legal document of the
// release is not approved (the database refuses it then too).
export function SettingDialog({ rule }: { rule: SettingRule }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto" onClick={() => setOpen(true)}>
        Change<span className="sr-only"> {rule.label}</span>
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title={rule.label}>
        <SettingForm rule={rule} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function SettingForm({ rule, onClose }: { rule: SettingRule; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<SettingForm>({
    resolver: zodResolver(settingFormSchema(rule)),
    defaultValues: { value: rule.value, reason: "" },
    shouldFocusError: true,
  });
  const { control, formState, handleSubmit, getValues, setError } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE });
  const [confirming, setConfirming] = useState<string | null>(null);
  const ids = { value: `setting-${rule.key}-value`, reason: `setting-${rule.key}-reason` };
  const confirmId = `setting-${rule.key}-confirm`;

  function onReview(values: SettingForm) {
    const next = values.value.trim();
    if (next === rule.value) {
      setError("root.server", { type: "server", message: "Nothing was changed. Enter a new value." });
      return;
    }
    setConfirming(next);
  }

  function onConfirm(next: string) {
    return submit(
      () => saveSetting({ key: rule.key, value: next, reason: getValues("reason") }),
      (result) => {
        if (result.done) {
          onClose();
          toast({ title: `${rule.label} is saved`, description: `Now ${settingValueText(rule, next)}` });
          router.refresh();
          return;
        }
        setConfirming(null);
        if (result.message) toastError(FAILURE, result.message);
      },
    );
  }

  if (confirming !== null) {
    const goesLive = rule.releaseFeature !== null && confirming === "true";
    const gaps = releaseWarning(rule, confirming);
    return (
      <div className="grid gap-4">
        <FocusOnMount targetId={confirmId} />
        <p id={confirmId} tabIndex={-1} className="text-body font-medium focus:outline-none">
          {rule.label}: {settingValueText(rule, rule.value)} -&gt; {settingValueText(rule, confirming)}
        </p>
        {goesLive && gaps.length > 0 ? (
          <Notice tone="error" role="alert">
            The release cannot go live until these legal documents are approved:
            <ul className="mt-2 list-disc ps-5">
              {gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </Notice>
        ) : goesLive ? (
          <Notice tone="warning" role="status">
            Switching this on puts the release live for every visitor and user at once. Run the go-live check before you switch it
            on.
          </Notice>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" onClick={() => setConfirming(null)}>
            Back
          </FormButton>
          {goesLive && gaps.length > 0 ? null : (
            <FormButton
              type="button"
              variant={goesLive ? "destructive" : "primary"}
              busy={formState.isSubmitting}
              onClick={() => void handleSubmit(() => onConfirm(confirming))()}
            >
              {goesLive ? "Switch the release on" : "Save setting"}
            </FormButton>
          )}
        </div>
      </div>
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onReview)}>
      <p className="text-small text-muted-foreground break-all">Setting {rule.key}</p>
      <FormErrorSummary form={form} ids={ids} />
      {rule.valueType === "boolean" ? (
        <SelectField control={control} name="value" id={ids.value} label="Value" placeholder="Choose on or off" options={booleanOptions} />
      ) : (
        <InputField
          control={control}
          name="value"
          id={ids.value}
          label="Value"
          description={ruleText(rule)}
          type={rule.valueType === "email" ? "email" : "text"}
          inputMode={rule.valueType === "integer" ? "numeric" : undefined}
          autoComplete="off"
        />
      )}
      <TextareaField control={control} name="reason" id={ids.reason} label="Reason for the change" description="Required, 10 to 500 characters." />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit">Review change</FormButton>
      </div>
    </form>
  );
}
