"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm, type FieldPath } from "react-hook-form";
import { summaryItems } from "@/components/admin/summary-items";
import { toast } from "@/components/feedback/toast-store";
import { ErrorSummary } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { changeStanding } from "@/lib/actions/admin-moderation";
import { moderationFormSchema, type ModerationForm as ModerationValues } from "@/lib/validation/admin";

type ModerationFormProps = { target: "user" | "organization"; id: string; standing: "active" | "suspended" };

const words = {
  user: { subject: "account", suspend: "Suspend user", reinstate: "Reinstate user" },
  organization: { subject: "organisation", suspend: "Suspend organisation", reinstate: "Reinstate organisation" },
} as const;

const REASON_ID = "moderation-reason";

export function ModerationForm({ target, id, standing }: ModerationFormProps) {
  const router = useRouter();
  const form = useForm<ModerationValues>({
    resolver: zodResolver(moderationFormSchema),
    defaultValues: { reason: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, reset } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The change was not saved" });
  const suspending = standing === "active";
  const label = suspending ? words[target].suspend : words[target].reinstate;

  function onSubmit(values: ModerationValues) {
    return submit(
      () => changeStanding({ ...values, target, id, to: suspending ? "suspended" : "active" }),
      (result) => {
        if (!result.done) return;
        reset();
        toast({ title: suspending ? `The ${words[target].subject} is suspended` : `The ${words[target].subject} is reinstated` });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <ErrorSummary
        ref={summaryRef}
        items={summaryItems(formState.errors, { reason: REASON_ID })}
        onSelect={(key) => form.setFocus(key as FieldPath<ModerationValues>)}
      />
      <TextareaField
        control={control}
        name="reason"
        id={REASON_ID}
        label="Statement of reasons"
        description={`Required, 10 to 2000 characters. ${suspending ? "The person is told the reasons by email." : "The reasons are sent by email."}`}
      />
      <div>
        <FormButton type="submit" busy={formState.isSubmitting} className="w-full sm:w-auto">
          {label}
        </FormButton>
      </div>
    </form>
  );
}
