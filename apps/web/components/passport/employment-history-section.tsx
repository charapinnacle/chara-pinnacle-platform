"use client";

import { useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { ComboboxField } from "@/components/forms/combobox-field";
import { controlClassName } from "@/components/forms/control-class";
import { FormButton } from "@/components/forms/form-button";
import { FormField, InputField } from "@/components/forms/form-field";
import { ConfirmRemoveButton } from "@/components/passport/confirm-remove-button";
import { usePassportForm } from "@/components/passport/use-passport-form";
import { Input } from "@/components/ui/input";
import { addEmployment, removeEmployment, updateEmployment } from "@/lib/actions/passport";
import type { Passport } from "@/lib/dal/passport";
import type { ReferenceItem } from "@/lib/dal/reference";
import { toOptions } from "@/lib/reference-options";
import { cn } from "@/lib/utils";
import { employmentFormSchema } from "@/lib/validation/passport-extensions";

type Entry = Passport["employmentHistory"][number];

const MONTH_HINT = "Month and year, for example 2019-03.";

type EmploymentHistorySectionProps = { entries: Entry[]; countries: ReferenceItem[]; max: number };

export function EmploymentHistorySection({ entries, countries, max }: EmploymentHistorySectionProps) {
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const close = () => setEditing(null);
  const nameOf = (code: string) => countries.find((country) => country.code === code)?.name ?? code;

  return (
    <div className="grid gap-5">
      {entries.length === 0 ? (
        <p className="text-body text-muted-foreground">No employment history added yet</p>
      ) : (
        <ul className="grid gap-2" aria-label="Employment history">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-1.5">
              <span className="min-w-0 break-words">
                {entry.role}
                {entry.employerName ? `, ${entry.employerName}` : ""}{" "}
                <span className="text-muted-foreground">
                  ({nameOf(entry.country)}, {entry.fromMonth} to {entry.toMonth ?? "now"})
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                <FormButton type="button" variant="secondary" onClick={() => setEditing(entry)}>
                  Edit<span className="sr-only normal-case"> {entry.role}</span>
                </FormButton>
                <ConfirmRemoveButton
                  name={entry.role}
                  removed="Employment history entry removed"
                  remove={() => removeEmployment(entry.id)}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid justify-items-start gap-2">
        <FormButton type="button" variant="secondary" onClick={() => setEditing("new")}>
          Add employment
        </FormButton>
        <p className="text-small text-muted-foreground">You can add up to {max} employment history entries.</p>
      </div>
      <ModalDialog
        open={editing !== null}
        onClose={close}
        title={editing === "new" ? "Add employment" : "Edit employment"}
      >
        {editing ? <EmploymentForm entry={editing === "new" ? null : editing} countries={countries} onClose={close} /> : null}
      </ModalDialog>
    </div>
  );
}

type EmploymentFormProps = { entry: Entry | null; countries: ReferenceItem[]; onClose: () => void };

function EmploymentForm({ entry, countries, onClose }: EmploymentFormProps) {
  const { form, onSubmit } = usePassportForm(
    employmentFormSchema(),
    {
      role: entry?.role ?? "",
      employerName: entry?.employerName ?? "",
      country: entry?.country ?? "",
      fromMonth: entry?.fromMonth ?? "",
      toMonth: entry?.toMonth ?? "",
      current: entry ? entry.toMonth === null : false,
    },
    (values) => (entry ? updateEmployment(entry.id, values) : addEmployment(values)),
    {
      failureTitle: "Could not save the employment",
      saved: entry ? "Employment saved" : "Employment added",
      onSaved: onClose,
    },
  );
  const current = form.watch("current");

  return (
    <form noValidate className="grid gap-4" onSubmit={onSubmit}>
      <InputField control={form.control} name="role" label="Role" maxLength={120} />
      <InputField control={form.control} name="employerName" label="Employer name (optional)" maxLength={120} />
      <ComboboxField
        control={form.control}
        name="country"
        label="Country"
        placeholder="Choose a country"
        options={toOptions(countries)}
      />
      <InputField control={form.control} name="fromMonth" label="From" description={MONTH_HINT} type="month" placeholder="YYYY-MM" />
      <FormField control={form.control} name="toMonth" label="To" description={MONTH_HINT}>
        {(controlProps) => (
          <Input
            type="month"
            placeholder="YYYY-MM"
            className={cn("h-12", controlClassName, current && "bg-muted")}
            {...controlProps}
            value={current ? "" : controlProps.value}
            disabled={current}
          />
        )}
      </FormField>
      <CheckboxField control={form.control} name="current">
        I still work here
      </CheckboxField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={form.formState.isSubmitting}>
          Save employment
        </FormButton>
      </div>
    </form>
  );
}
