"use client";

import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { ListRow } from "@/components/passport/list-row";
import { addAuthorization, removeAuthorization } from "@/lib/actions/passport";
import type { ReferenceItem } from "@/lib/dal/reference";
import { formatDate } from "@/lib/i18n/format";
import { toOptions } from "@/lib/reference-options";
import { authorizationFormSchema, todayUtc } from "@/lib/validation/passport";

type AuthorizationsSectionProps = {
  authorizations: { country: string; expiresOn: string | null }[];
  countries: ReferenceItem[];
  expiryYears: number;
};

export function AuthorizationsSection({ authorizations, countries, expiryYears }: AuthorizationsSectionProps) {
  const today = todayUtc();
  const { form, onSubmit } = usePassportForm(
    authorizationFormSchema({ today, years: expiryYears }),
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
              <ListRow
                key={country}
                name={`work authorisation for ${nameOf(country)}`}
                removed="Work authorisation removed"
                remove={() => removeAuthorization(country)}
              >
                {nameOf(country)}{" "}
                <span className="text-muted-foreground">
                  {expiresOn === null ? "(no expiry date)" : `(until ${formatDate(expiresOn)})`}
                </span>
                {expired ? <strong className="ms-2 text-destructive">Expired</strong> : null}
              </ListRow>
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
          options={toOptions(countries.filter(({ code }) => !held.has(code)))}
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
