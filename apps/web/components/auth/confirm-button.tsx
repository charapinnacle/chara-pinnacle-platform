"use client";

import { useFormStatus } from "react-dom";
import { FormButton } from "@/components/forms/form-button";

export function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <FormButton fullWidth type="submit" busy={pending}>
      {pending ? "Confirming..." : "Confirm email address"}
    </FormButton>
  );
}
