"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { setCapacityTolerance } from "@/lib/actions/responses";
import { formatCount } from "@/lib/i18n/format";
import { toleranceFormSchema, type ToleranceFormInput } from "@/lib/validation/response";

const PERCENT_ID = "capacity-tolerance";

type CapacityToleranceFormProps = { slug: string; requirementId: string; percent: number; workersNeeded: number };

// How many per cent above the workers needed partners may offer (FR-O2 AC4, data: set by the employer, 0 to 100, 0 by
// default), for an owner or admin while the requirement is not closed or filled. Responses already sent keep their
// capacity.
export function CapacityToleranceForm({ slug, requirementId, percent, workersNeeded }: CapacityToleranceFormProps) {
  const form = useForm<ToleranceFormInput>({ resolver: zodResolver(toleranceFormSchema), defaultValues: { percent: String(percent) } });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: "The tolerance was not saved" });
  const maximum = Math.floor((workersNeeded * (100 + percent)) / 100);

  function onSubmit(values: ToleranceFormInput) {
    return submit(
      () => setCapacityTolerance(slug, requirementId, values),
      (result) => {
        if (result.changed !== undefined) toast({ title: result.changed ? "Tolerance saved" : "Nothing changed" });
      },
    );
  }

  return (
    <section aria-labelledby="capacity-tolerance-heading" className="grid gap-3">
      <h2 id="capacity-tolerance-heading" className="text-h2">
        Workers partners may offer
      </h2>
      <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
        Partners can offer up to {formatCount(maximum)} workers now. Allow a few per cent more than you need if a partner may
        offer extra workers to cover drop-outs.
      </p>
      <form noValidate className="grid max-w-sm gap-4" onSubmit={handleSubmit(onSubmit)}>
        <FormErrorSummary form={form} ids={{ percent: PERCENT_ID }} />
        <InputField
          control={control}
          name="percent"
          id={PERCENT_ID}
          label="Per cent above the workers needed"
          inputMode="numeric"
          description="A whole number from 0 to 100."
        />
        <FormButton type="submit" variant="secondary" className="w-auto" busy={formState.isSubmitting}>
          Save tolerance
        </FormButton>
      </form>
    </section>
  );
}
