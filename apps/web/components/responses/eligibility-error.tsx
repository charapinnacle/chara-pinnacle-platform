"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";

const TITLE = "Whether your company can respond could not be checked";

// The eligibility panel when its read failed (FR-N2 AC12): a toast, the panel without Respond, and a retry that renders
// the page afresh.
export function EligibilityError() {
  const router = useRouter();
  useEffect(() => {
    toastNetworkError(TITLE);
  }, []);
  return (
    <Notice tone="warning" role="status">
      <p className="font-semibold">{TITLE}</p>
      <p>Nothing was changed. Try again in a moment.</p>
      <FormButton type="button" variant="secondary" className="mt-3 w-auto" onClick={() => router.refresh()}>
        Try again
      </FormButton>
    </Notice>
  );
}
