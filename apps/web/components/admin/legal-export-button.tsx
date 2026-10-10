"use client";

import { useRouter } from "next/navigation";
import { FormButton } from "@/components/forms/form-button";
import { useActionCall } from "@/components/feedback/use-action-call";
import { GENERIC_FAILURE } from "@/lib/auth-errors";

// The file is saved from here so that a refusal is a toast and the page stays on the screen. A redirect means the
// session needs a step again: the page is read again and its guards take over.
export function LegalExportButton({ href }: { href: string }) {
  const router = useRouter();
  const call = useActionCall("The export failed");

  function exportVersions() {
    call.run(async () => {
      const response = await fetch(href, { redirect: "manual" });
      if (response.type === "opaqueredirect") {
        router.refresh();
        return { silent: true };
      }
      if (!response.ok) return { message: GENERIC_FAILURE };
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "legal-documents.json";
      link.click();
      URL.revokeObjectURL(url);
      return {};
    }, "The export was downloaded");
  }

  return (
    <FormButton type="button" variant="secondary" className="w-auto" busy={call.pending} onClick={exportVersions}>
      Export all versions
    </FormButton>
  );
}
