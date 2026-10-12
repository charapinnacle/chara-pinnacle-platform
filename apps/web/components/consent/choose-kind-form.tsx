"use client";

import { useForm, useWatch } from "react-hook-form";
import { kindOptions, KIND_IS_FINAL, type Kind } from "@/components/forms/account-kind-options";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { ConsentForm } from "@/components/consent/consent-form";
import { chooseAccountKind } from "@/lib/actions/consents";
import type { LegalDocumentSummary } from "@/lib/validation/consents";
import { BRAND_NAME } from "@/lib/brand";

type ChooseKindFormProps = {
  documents: Record<Kind, LegalDocumentSummary[]>;
  attestationWording: string | null;
};

// The kind is only picked here; the consent form below is the form that submits, once its documents are accepted.
export function ChooseKindForm({ documents, attestationWording }: ChooseKindFormProps) {
  const { control } = useForm<{ kind?: Kind }>({ defaultValues: {} });
  const kind = useWatch({ control, name: "kind" });
  return (
    <div className="grid gap-6">
      <RadioGroupField
        control={control}
        name="kind"
        id="onboarding-kind"
        legend={`I want to use ${BRAND_NAME} as`}
        description={KIND_IS_FINAL}
        options={kindOptions}
      />
      {kind ? (
        <ConsentForm
          key={kind}
          documents={documents[kind]}
          attestationWording={attestationWording}
          submitLabel="Create my account"
          onAccept={(entries) => chooseAccountKind(kind, entries)}
        />
      ) : null}
    </div>
  );
}
