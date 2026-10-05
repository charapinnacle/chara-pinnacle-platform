"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { RemoveButton } from "@/components/passport/remove-button";
import { addAuthorization, removeAuthorization } from "@/lib/actions/passport";
import type { ReferenceItem } from "@/lib/dal/reference";
import { formatDate } from "@/lib/i18n/format";
import { authorizationFormSchema, todayUtc } from "@/lib/validation/passport";

type AuthorizationsSectionProps = {
  authorizations: { country: string; expiresOn: string | null }[];
  countries: ReferenceItem[];
};

export function AuthorizationsSection({ authorizations, countries }: AuthorizationsSectionProps) {
  const today = todayUtc();
  const { form, onSubmit } = usePassportForm(
    authorizationFormSchema(today),
    { country: "", expiresOn: "" },
    addAuthorization,
    { failureTitle: "Could not add the work authorisation", saved: "Work authorisation added", resetOnSuccess: true },
  );
  const nameOf = (code: string) => countries.find((country) => country.code === code)?.name ?? code;
  const held = new Set(authorizations.map(({ country }) => country));

  return (
    <div className="grid gap-5">
      {authorizations.length === 0 ? (
        <p className="text-body text-muted-foreground">You have not added any work authorisations yet</p>
      ) : (
        <ul className="grid gap-2">
          {authorizations.map(({ country, expiresOn }) => {
            const expired = expiresOn !== null && expiresOn < today;
            return (
              <li key={country} className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-1.5">
                <span className="min-w-0 break-words">
                  {nameOf(country)}{" "}
                  <span className="text-muted-foreground">
                    {expiresOn === null ? "(no expiry date)" : `(until ${formatDate(expiresOn)})`}
                  </span>
                  {expired ? <strong className="ms-2 text-destructive">Expired</strong> : null}
                </span>
                <RemoveButton
                  name={`work authorisation for ${nameOf(country)}`}
                  removed="Work authorisation removed"
                  remove={() => removeAuthorization(country)}
                />
              </li>
            );
          })}
        </ul>
      )}
      <form noValidate className="grid gap-4" onSubmit={onSubmit}>
        <ComboboxField
          control={form.control}
          name="country"
          label="Country where you may work"
          placeholder="Choose a country"
          options={countries.filter(({ code }) => !held.has(code)).map(({ code, name }) => ({ value: code, label: name }))}
        />
        <InputField
          control={form.control}
          name="expiresOn"
          label="Expiry date"
          description="Leave empty if the right to work does not expire."
          type="date"
        />
        <FormButton type="submit" variant="secondary" busy={form.formState.isSubmitting}>
          Add work authorisation
        </FormButton>
      </form>
    </div>
  );
}
