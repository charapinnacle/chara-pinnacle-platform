"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { moderatePartnerProfile } from "@/lib/actions/admin-reports";
import { characters } from "@/lib/utils";
import { moderationFormSchema, type ModerationForm } from "@/lib/validation/admin";

const REASON_ID = "partner-profile-reason";

// Hide a visible partner profile, or show a hidden one again, on staff's own finding (FR-S1), with the statement of
// reasons that the owner and administrators are sent.
export function PartnerProfileModerationForm({ id, action }: { id: string; action: "hide" | "unhide" }) {
  const router = useRouter();
  const form = useForm<ModerationForm>({
    resolver: zodResolver(moderationFormSchema),
    defaultValues: { reason: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, reset } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The decision was not saved" });
  const count = characters((useWatch({ control, name: "reason" }) ?? "").trim());
  const hiding = action === "hide";

  function onSubmit(values: ModerationForm) {
    return submit(
      () => moderatePartnerProfile({ ...values, id, action }),
      (result) => {
        if (!result.done) return;
        reset();
        toast({ title: hiding ? "The partner profile is hidden" : "The partner profile is shown again" });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ reason: REASON_ID }} />
      <TextareaField
        control={control}
        name="reason"
        id={REASON_ID}
        label="Statement of reasons"
        description={`Required, 10 to 2000 characters. ${count} of 2000 characters used. The owner and administrators are sent it${hiding ? " with the appeal route" : ""}.`}
      />
      <div>
        <FormButton type="submit" variant={hiding ? "destructive" : "primary"} busy={formState.isSubmitting} className="w-full sm:w-auto">
          {hiding ? "Hide partner profile" : "Show partner profile again"}
        </FormButton>
      </div>
    </form>
  );
}
