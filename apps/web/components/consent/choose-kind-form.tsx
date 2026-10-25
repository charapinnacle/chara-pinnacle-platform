"use client";

import { useForm, useWatch } from "react-hook-form";
import { accountChoiceOptions, KIND_IS_FINAL } from "@/components/forms/account-kind-options";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { ConsentForm } from "@/components/consent/consent-form";
import { PartnerDraftNotice } from "@/components/consent/partner-draft-notice";
import { chooseAccountKind } from "@/lib/actions/consents";
import type { AccountChoice, SignUpDocuments } from "@/lib/validation/sign-up";
import { BRAND_NAME } from "@/lib/brand";

type ChooseKindFormProps = {
  documents: SignUpDocuments;
  attestationWording: string | null;
};

// The kind is only picked here; the consent form below is the form that submits, once its documents are accepted.
export function ChooseKindForm({ documents, attestationWording }: ChooseKindFormProps) {
  const { control } = useForm<{ kind?: AccountChoice }>({ defaultValues: {} });
  const kind = useWatch({ control, name: "kind" });
  const shown = (kind && documents[kind]) || [];
  return (
    <div className="grid gap-6">
      <RadioGroupField
        control={control}
        name="kind"
        id="onboarding-kind"
        legend={`I want to use ${BRAND_NAME} as`}
        description={KIND_IS_FINAL}
        options={accountChoiceOptions(documents)}
      />
      {kind ? (
        <>
          <PartnerDraftNotice choice={kind} documents={shown} />
          <ConsentForm
            key={kind}
            documents={shown}
            attestationWording={attestationWording}
            submitLabel="Create my account"
            onAccept={(entries) => chooseAccountKind(kind, entries)}
          />
        </>
      ) : null}
    </div>
  );
}
