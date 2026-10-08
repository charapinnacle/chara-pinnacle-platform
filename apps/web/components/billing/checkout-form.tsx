"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { ConsentPanel } from "@/components/forms/consent-panel";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { LegalLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { startCheckout } from "@/lib/actions/billing";
import { formatDate } from "@/lib/i18n/format";
import { checkoutFormSchema, type CheckoutFormInput } from "@/lib/validation/billing";

type CheckoutFormProps = {
  slug: string;
  planCode: string;
  termsVersion: number;
  termsTitle: string;
  termsPublishedAt: string;
  disclosedTrialDays: number;
  countries: readonly { value: string; label: string }[];
  defaults: Pick<CheckoutFormInput, "billingCountry" | "vatId" | "registrationNumber">;
};

const ids = {
  billingCountry: "checkout-billing-country",
  vatId: "checkout-vat-id",
  registrationNumber: "checkout-registration-number",
  termsAccepted: "checkout-terms",
} as const satisfies Record<keyof CheckoutFormInput, string>;

export function CheckoutForm({
  slug,
  planCode,
  termsVersion,
  termsTitle,
  termsPublishedAt,
  disclosedTrialDays,
  countries,
  defaults,
}: CheckoutFormProps) {
  const form = useForm<CheckoutFormInput>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: { ...defaults, termsAccepted: false },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const accepted = useWatch({ control, name: "termsAccepted" });
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "Could not start the checkout" });

  const items: ErrorSummaryItem[] = [
    ...(Object.keys(ids) as (keyof typeof ids)[]).flatMap((name) => {
      const error = formState.errors[name];
      return error ? [{ key: name, message: String(error.message), targetId: ids[name] }] : [];
    }),
    ...(formState.errors.root?.server ? [{ key: "root", message: String(formState.errors.root.server.message) }] : []),
  ];

  function onSubmit(values: CheckoutFormInput) {
    return submit(
      () => startCheckout({ ...values, slug, planCode, termsVersion, disclosedTrialDays }),
      (result) => {
        if (result.message) toast({ variant: "error", title: "Could not start the checkout", description: result.message });
      },
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onSubmit)}>
      <ErrorSummary
        ref={summaryRef}
        items={items}
        onSelect={(key) => form.setFocus(key as FieldPath<CheckoutFormInput>)}
      />
      <SelectField
        control={control}
        name="billingCountry"
        id={ids.billingCountry}
        label="Billing country"
        placeholder="Choose a country"
        options={countries}
      />
      <InputField
        control={control}
        name="vatId"
        id={ids.vatId}
        label="VAT ID"
        description="For example DE123456789. Enter it, or the registration number, or both."
        autoComplete="off"
      />
      <InputField
        control={control}
        name="registrationNumber"
        id={ids.registrationNumber}
        label="Company registration number"
        description="One free trial is granted for each company."
        autoComplete="off"
      />
      <ConsentPanel>
        <div className="grid gap-1.5 px-2.5 pt-2.5 pb-1 sm:px-3 sm:pt-3">
          <h2 className="text-base font-semibold tracking-tight">{termsTitle}</h2>
          <p className="text-sm text-muted-foreground">
            Version {termsVersion}, published {formatDate(termsPublishedAt)}
          </p>
          <LegalLink
            slug="subscription-and-billing-terms"
            newTabLabel={`of the ${termsTitle} (opens in a new tab)`}
            standalone
            className="-mt-1.5 -mb-2.5"
          >
            Read the full text
          </LegalLink>
        </div>
        <CheckboxField control={control} name="termsAccepted" id={ids.termsAccepted}>
          I accept the {termsTitle}
        </CheckboxField>
      </ConsentPanel>
      <FormButton type="submit" busy={formState.isSubmitting} disabled={!accepted}>
        {formState.isSubmitting ? "Continuing to payment..." : "Continue to payment"}
      </FormButton>
    </form>
  );
}
