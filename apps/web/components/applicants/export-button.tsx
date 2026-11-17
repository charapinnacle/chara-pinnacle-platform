"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId } from "react";
import { FormButton } from "@/components/forms/form-button";
import { useActionCall } from "@/components/feedback/use-action-call";
import { GENERIC_FAILURE } from "@/lib/auth-errors";

// fields are sent with the request; fileName is used when the answer does not name its file.
type ExportButtonProps = {
  action: string;
  fields: Record<string, string>;
  disabled: boolean;
  hint: string | null;
  label?: string;
  fileName?: string;
};

// The export is a POST that answers a file, or a sentence when it refuses (a plan that changed after the page was read, a
// vacancy that is gone, too many rows). The file is saved from here so that a refusal is a toast and the list stays on
// the screen. A redirect means the session needs a step again: the page is read again and its guards take over.
export function ExportButton({ action, fields, disabled, hint, label = "Export CSV", fileName = "applicants.csv" }: ExportButtonProps) {
  const router = useRouter();
  const call = useActionCall("The export failed");
  const hintId = useId();

  function exportCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    call.run(async () => {
      const response = await fetch(action, { method: "POST", body, redirect: "manual" });
      if (response.type === "opaqueredirect") {
        router.refresh();
        return { silent: true };
      }
      if (!response.ok) return { message: (response.status < 500 ? await response.text() : "") || GENERIC_FAILURE };
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? fileName;
      link.click();
      URL.revokeObjectURL(url);
      return {};
    }, "The CSV file was downloaded");
  }

  return (
    <form method="post" action={action} onSubmit={exportCsv} className="grid gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormButton type="submit" variant="secondary" className="w-auto" disabled={disabled} busy={call.pending} aria-describedby={hint ? hintId : undefined}>
        {label}
      </FormButton>
      {hint ? (
        <p id={hintId} className="text-small text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </form>
  );
}
