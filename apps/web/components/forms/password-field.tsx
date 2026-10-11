"use client";

import { Check, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useWatch, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { controlClassName } from "@/components/forms/control-class";
import { FormField } from "@/components/forms/form-field";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/sign-up";
import { cn } from "@/lib/utils";

type PasswordFieldProps<T extends FieldValues, N extends FieldPath<T>> = {
  control: Control<T>;
  name: N;
  id: string;
  label: string;
  autoComplete: "new-password" | "current-password";
  // The checklist of what the password must meet, for a field where a new password is chosen.
  checklist?: boolean;
};

// The breached-password check stays on the server (Auth refuses a password found in a breach list); only the length is
// known here, so it is the one line of the checklist.
function PasswordChecklist({ id, length }: { id: string; length: number }) {
  const met = length >= PASSWORD_MIN_LENGTH;
  const requirement = `At least ${PASSWORD_MIN_LENGTH} characters`;
  return (
    <>
      <ul id={id} className="grid gap-1.5 text-small">
        <li className={cn("flex items-center gap-2 transition-colors duration-120", met ? "text-foreground" : "text-muted-foreground")}>
          <span
            aria-hidden
            className={cn(
              "grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-120",
              met ? "border-success-foreground bg-success-foreground text-card" : "border-input",
            )}
          >
            {met ? <Check strokeWidth={3.5} className="size-2.5" /> : null}
          </span>
          <span aria-hidden>{requirement}</span>
          <span className="sr-only">{`${requirement}: ${met ? "met" : "not met yet"}`}</span>
        </li>
      </ul>
      <p role="status" className="sr-only">
        {`${requirement}: ${met ? "met" : "not met yet"}`}
      </p>
    </>
  );
}

export function PasswordField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  id,
  label,
  autoComplete,
  checklist = false,
}: PasswordFieldProps<T, N>) {
  const [visible, setVisible] = useState(false);
  const value: unknown = useWatch({ control, name });
  const checklistId = `${id}-checklist`;
  return (
    <FormField control={control} name={name} id={id} label={label}>
      {(controlProps) => (
        <>
          <div className="relative">
            <Input
              type={visible ? "text" : "password"}
              autoComplete={autoComplete}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={cn(controlClassName, "h-12 pe-14")}
              {...controlProps}
              aria-describedby={[controlProps["aria-describedby"], checklist ? checklistId : null].filter(Boolean).join(" ") || undefined}
            />
            <button
              type="button"
              aria-label={visible ? "Hide password" : "Show password"}
              aria-pressed={visible}
              onClick={() => setVisible((current) => !current)}
              className="absolute end-0.5 top-0.5 grid size-11 place-items-center rounded-control text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            >
              {visible ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
            </button>
          </div>
          {checklist ? <PasswordChecklist id={checklistId} length={typeof value === "string" ? value.length : 0} /> : null}
        </>
      )}
    </FormField>
  );
}
