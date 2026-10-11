"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { kindOptions, KIND_IS_FINAL, type Kind } from "@/components/forms/account-kind-options";
import { ConsentCheckbox } from "@/components/forms/consent-checkbox";
import { ConsentList } from "@/components/forms/consent-list";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { PasswordField } from "@/components/forms/password-field";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { signUp } from "@/lib/actions/auth";
import type { LegalDocumentSummary } from "@/lib/validation/consents";
import {
  signUpFormSchema,
  type SignUpFormInput,
  type SignUpFormOutput,
} from "@/lib/validation/sign-up";

type SignUpFormProps = {
  documents: Record<Kind, LegalDocumentSummary[]>;
  attestationWording: string | null;
  invitation?: { token: string; email: string; organizationName: string };
  preselectedKind?: Kind;
  defaultEmail?: string;
};

const ids = {
  kind: "signup-kind",
  email: "signup-email",
  password: "signup-password",
  accepted: (slug: string) => `signup-accepted-${slug}`,
};

function acceptedDefaults(documents: readonly LegalDocumentSummary[]) {
  return Object.fromEntries(documents.map((document) => [document.slug, false]));
}

export function SignupForm({ documents, attestationWording, invitation, preselectedKind, defaultEmail = "" }: SignUpFormProps) {
  const form = useForm<SignUpFormInput, undefined, SignUpFormOutput>({
    resolver: (values, context, options) =>
      zodResolver(signUpFormSchema(values.kind ? documents[values.kind] : []))(
        values,
        context,
        options,
      ),
    defaultValues: invitation
      ? { kind: "company", email: invitation.email, password: "", accepted: acceptedDefaults(documents.company) }
      : preselectedKind
        ? { kind: preselectedKind, email: defaultEmail, password: "", accepted: acceptedDefaults(documents[preselectedKind]) }
        : { email: defaultEmail, password: "", accepted: {} },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, setValue } = form;
  const kind = useWatch({ control, name: "kind" });
  const shown = kind ? documents[kind] : [];
  const { summaryRef, submit } = useServerFormSubmit(form, {
    failureTitle: "Could not create the account",
    clearOnFailure: "password",
  });

  const summaryIds = {
    kind: ids.kind,
    email: ids.email,
    password: ids.password,
    ...Object.fromEntries(shown.map((document) => [`accepted.${document.slug}`, ids.accepted(document.slug)])),
  };

  function onSubmit(values: SignUpFormOutput) {
    return submit(() =>
      signUp(
        {
          kind: values.kind,
          email: values.email,
          password: values.password,
          consents: shown
            .filter((document) => values.accepted[document.slug])
            .map((document) => ({ purpose: document.slug, version: document.version })),
        },
        invitation?.token,
      ),
    );
  }

  return (
    <form
      noValidate
      className="grid gap-6"
      onSubmit={(event) => handleSubmit(onSubmit)(event)}
    >
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={summaryIds} />
      {invitation ? (
        <p className="text-body leading-relaxed">
          You are creating an employer account to join {invitation.organizationName}. Use the address the invitation was
          sent to.
        </p>
      ) : (
        <RadioGroupField
          control={control}
          name="kind"
          id={ids.kind}
          legend="I want to register as"
          description={KIND_IS_FINAL}
          options={kindOptions}
          onValueChange={(value) => {
            setValue("accepted", acceptedDefaults(documents[value as Kind]));
            form.clearErrors("accepted");
          }}
        />
      )}
      <InputField
        control={control}
        name="email"
        id={ids.email}
        label="Email address"
        type="email"
        autoComplete="email"
        readOnly={invitation !== undefined}
      />
      <PasswordField
        control={control}
        name="password"
        id={ids.password}
        label="Password"
        autoComplete="new-password"
        checklist
      />
      {shown.length > 0 ? (
        <ConsentList>
          {shown.map((document) => (
            <ConsentCheckbox
              key={document.slug}
              control={control}
              name={`accepted.${document.slug}`}
              id={ids.accepted(document.slug)}
              document={document}
              attestationWording={attestationWording}
            />
          ))}
        </ConsentList>
      ) : null}
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Creating account..." : "Create account"}
      </FormButton>
    </form>
  );
}
