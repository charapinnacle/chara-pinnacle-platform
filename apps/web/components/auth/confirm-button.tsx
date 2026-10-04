"use client";

import { useFormStatus } from "react-dom";
import { FormButton } from "@/components/forms/form-button";

export function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <FormButton type="submit" busy={pending}>
      {pending ? "Confirming..." : "Confirm email address"}
    </FormButton>
  );
}
