"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { setLimitOverride } from "@/lib/actions/plan-editor";
import { overrideFormSchema, type OverrideForm } from "@/lib/validation/plan-editor";

const ids = {
  organizationId: "override-organization",
  limitKey: "override-limit",
  value: "override-value",
  expiresOn: "override-expires",
  reason: "override-reason",
} as const;

const FAILURE = "The override was not saved";

type OverrideFormProps = {
  organizations: readonly { id: string; label: string; orgType: string }[];
  limitKeys: Readonly<Record<string, readonly { key: string; label: string }[]>>;
};

const empty: OverrideForm = { organizationId: "", limitKey: "", value: "", expiresOn: "", reason: "" };

// An individual limit for an organisation on an Enterprise plan, until the start of a day after today (FR-R2 AC5). Saving
// it again for the same organisation and limit replaces the value and the expiry.
export function OverrideFormView({ organizations, limitKeys }: OverrideFormProps) {
  const router = useRouter();
  const form = useForm<OverrideForm>({ resolver: zodResolver(overrideFormSchema), defaultValues: empty, shouldFocusError: true });
  const { control, formState, handleSubmit, reset } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE });
  const organizationId = useWatch({ control, name: "organizationId" });
  const orgType = organizations.find((organization) => organization.id === organizationId)?.orgType;
  const keyOptions = (orgType ? (limitKeys[orgType] ?? []) : []).map(({ key, label }) => ({ value: key, label }));

  function onSubmit(values: OverrideForm) {
    return submit(
      () => setLimitOverride({ ...values, value: Number(values.value.trim()) }),
      (result) => {
        if (result.message) toastError(FAILURE, result.message);
        if (!result.done) return;
        reset(empty);
        toast({ title: "The override is saved" });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} ids={ids} />
      <SelectField
        control={control}
        name="organizationId"
        id={ids.organizationId}
        label="Organisation"
        description="Only organisations on an Enterprise plan are listed."
        placeholder="Choose an organisation"
        options={organizations.map(({ id, label }) => ({ value: id, label }))}
      />
      <SelectField
        control={control}
        name="limitKey"
        id={ids.limitKey}
        label="Limit"
        placeholder={orgType ? "Choose a limit" : "Choose an organisation first"}
        options={keyOptions}
      />
      <InputField control={control} name="value" id={ids.value} label="Value" description="A whole number from 0 to 1,000,000." inputMode="numeric" autoComplete="off" maxLength={7} />
      <InputField control={control} name="expiresOn" id={ids.expiresOn} label="Expires on" description="A date after today. The plan limit applies again from that day." type="date" />
      <TextareaField control={control} name="reason" id={ids.reason} label="Reason for the change" description="Required, 10 to 500 characters." />
      <div>
        <FormButton type="submit" busy={formState.isSubmitting} className="w-full sm:w-auto">
          Save override
        </FormButton>
      </div>
    </form>
  );
}
