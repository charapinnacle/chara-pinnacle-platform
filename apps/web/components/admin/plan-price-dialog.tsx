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
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { changePlanPrice } from "@/lib/actions/plan-editor";
import { formatPrice } from "@/lib/billing/presentation";
import { amountMinor, priceFormSchema, type EditorPlan, type PriceForm } from "@/lib/validation/plan-editor";

const CONFIRM_ID = "plan-price-confirm";
const FAILURE = "The price was not changed";

// The price change of one paid plan (FR-R2 AC8, AC9): the new monthly amount and the reason, then a confirmation that
// names both amounts and says that existing subscribers keep their price. Nothing is sent before the confirmation; a
// failed change keeps the values entered.
export function PlanPriceDialog({ plan }: { plan: EditorPlan }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto whitespace-nowrap" onClick={() => setOpen(true)}>
        Change price<span className="sr-only"> of {plan.name} ({plan.code})</span>
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title={`Change the price of ${plan.name}`}>
        <PlanPriceForm plan={plan} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function PlanPriceForm({ plan, onClose }: { plan: EditorPlan; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<PriceForm>({
    resolver: zodResolver(priceFormSchema(plan.priceMinor)),
    defaultValues: { amount: "", reason: "" },
    shouldFocusError: true,
  });
  const { control, formState, handleSubmit, getValues } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE });
  const [pending, setPending] = useState<number | null>(null);
  const ids = { amount: `plan-${plan.code}-amount`, reason: `plan-${plan.code}-price-reason` };
  const current = formatPrice(plan.priceMinor, plan.currency);

  function onConfirm(priceMinor: number) {
    return submit(
      () => changePlanPrice({ code: plan.code, priceMinor, reason: getValues("reason") }),
      (result) => {
        if (result.done) {
          onClose();
          toast({ title: `The price of ${plan.name} is changed`, description: `${formatPrice(priceMinor, plan.currency)} per month for new subscriptions` });
          router.refresh();
          return;
        }
        setPending(null);
        if (result.message) toastError(FAILURE, result.message);
      },
    );
  }

  if (pending !== null) {
    return (
      <div className="grid gap-4">
        <FocusOnMount targetId={CONFIRM_ID} />
        <p id={CONFIRM_ID} tabIndex={-1} className="text-body font-medium focus:outline-none">
          Change the price of {plan.name}?
        </p>
        <p className="text-body">
          Price per month, excluding VAT: {current} -&gt; {formatPrice(pending, plan.currency)}
        </p>
        <p className="text-small text-muted-foreground">
          A new price is created at the payment provider and applies to new subscriptions. Existing subscribers keep their current price
          until they are moved at the payment provider. The change is recorded with your reason.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" onClick={() => setPending(null)}>
            Back
          </FormButton>
          <FormButton type="button" busy={formState.isSubmitting} onClick={() => void handleSubmit(() => onConfirm(pending))()}>
            Change price
          </FormButton>
        </div>
      </div>
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit((values) => setPending(amountMinor(values.amount)))}>
      <p className="text-small text-muted-foreground">Current price: {current} per month, excluding VAT.</p>
      <FormErrorSummary form={form} ids={ids} />
      <InputField
        control={control}
        name="amount"
        id={ids.amount}
        label={`New price per month (${plan.currency}, excluding VAT)`}
        description="1.00 to 100,000.00, for example 54.00"
        inputMode="decimal"
        autoComplete="off"
        maxLength={9}
      />
      <TextareaField
        control={control}
        name="reason"
        id={ids.reason}
        label="Reason for the change"
        description="Required, 10 to 500 characters. It is recorded with the old and new price."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit">Review change</FormButton>
      </div>
    </form>
  );
}
