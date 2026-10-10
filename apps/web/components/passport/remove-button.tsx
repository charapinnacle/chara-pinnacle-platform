"use client";

import { FormButton } from "@/components/forms/form-button";
import { useActionCall } from "@/components/feedback/use-action-call";
import type { PassportResult } from "@/lib/actions/passport";

type RemoveButtonProps = { name: string; removed: string; remove: () => Promise<PassportResult> };

export function RemoveButton({ name, removed, remove }: RemoveButtonProps) {
  const { pending, run } = useActionCall("Could not remove it");
  return (
    <FormButton type="button" variant="secondary" busy={pending} onClick={() => run(remove, removed)}>
      Remove<span className="sr-only"> {name}</span>
    </FormButton>
  );
}
