"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { kindOptions, KIND_IS_FINAL, type Kind } from "@/components/forms/account-kind-options";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { ConsentPanel } from "@/components/forms/consent-panel";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { LegalLink } from "@/components/forms/text-link";
import { signUp } from "@/lib/actions/auth";
import { formatDate } from "@/lib/i18n/format";
import { AGE_ATTESTATION_SLUG, type LegalDocumentSummary } from "@/lib/validation/consents";
import {
  signUpFormSchema,
  type SignUpFormInput,
  type SignUpFormOutput,
} from "@/lib/validation/sign-up";

type SignUpFormProps = {
  documents: Record<Kind, LegalDocumentSummary[]>;
  attestationWording: string | null;
  invitation?: { token: string; email: string; organizationName: string };
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

export function SignupForm({ documents, attestationWording, invitation }: SignUpFormProps) {
  const form = useForm<SignUpFormInput, undefined, SignUpFormOutput>({
    resolver: (values, context, options) =>
      zodResolver(signUpFormSchema(values.kind ? documents[values.kind] : []))(
        values,
        context,
        options,
      ),
    defaultValues: invitation
      ? { kind: "company", email: invitation.email, password: "", accepted: acceptedDefaults(documents.company) }
      : { email: "", password: "", accepted: {} },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, setValue } = form;
  const kind = useWatch({ control, name: "kind" });
  const shown = kind ? documents[kind] : [];
  const { summaryRef, submit } = useServerFormSubmit(form, {
    failureTitle: "Could not create the account",
    clearOnFailure: "password",
  });

  const errors = formState.errors;
  const items: ErrorSummaryItem[] = [
    errors.kind && { key: "kind", message: String(errors.kind.message), targetId: ids.kind },
    errors.email && { key: "email", message: String(errors.email.message), targetId: ids.email },
    errors.password && {
      key: "password",
      message: String(errors.password.message),
      targetId: ids.password,
    },
    ...shown.flatMap((document) => {
      const error = errors.accepted?.[document.slug];
      return error
        ? [
            {
              key: `accepted.${document.slug}`,
              message: String(error.message),
              targetId: ids.accepted(document.slug),
            },
          ]
        : [];
    }),
    errors.root?.server && { key: "root", message: String(errors.root.server.message) },
  ].filter((item): item is ErrorSummaryItem => Boolean(item));

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
      <ErrorSummary
        ref={summaryRef}
        items={items}
        onSelect={(key) => form.setFocus(key as FieldPath<SignUpFormInput>)}
      />
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
      <InputField
        control={control}
        name="password"
        id={ids.password}
        label="Password"
        description="At least 12 characters."
        type="password"
        autoComplete="new-password"
      />
      {shown.length > 0 ? (
        <ConsentPanel>
          {shown.map((document) => (
            <CheckboxField
              key={document.slug}
              control={control}
              name={`accepted.${document.slug}`}
              id={ids.accepted(document.slug)}
            >
              {document.slug === AGE_ATTESTATION_SLUG ? (
                (attestationWording ?? "I am 18 or older")
              ) : (
                <span>
                  I accept the{" "}
                  <LegalLink
                    slug={document.slug}
                    newTabLabel="(opens in a new tab)"
                    className="relative z-10"
                  >
                    {document.title}
                  </LegalLink>
                  <span className="block text-sm text-muted-foreground">
                    (version {document.version}, published {formatDate(document.publishedAt)})
                  </span>
                </span>
              )}
            </CheckboxField>
          ))}
        </ConsentPanel>
      ) : null}
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Creating account..." : "Create account"}
      </FormButton>
    </form>
  );
}
