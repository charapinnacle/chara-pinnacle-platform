"use client";

import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { openPartnerEvidence } from "@/lib/actions/admin-partner-reviews";

// Opens the scanned evidence of a licence through the staff broker (FR-J2 AC6): a 60-second link the database logs as a
// partner review opening.
export function PartnerEvidenceButton({ licenceId, country }: { licenceId: string; country: string }) {
  const open = useActionCall("Could not open the file");
  return (
    <FormButton
      type="button"
      variant="secondary"
      className="w-auto"
      busy={open.pending}
      onClick={() =>
        open.run(async () => {
          const result = await openPartnerEvidence(licenceId);
          if (result.url) window.location.assign(result.url);
          return result;
        }, "The file is opening")
      }
    >
      Open evidence<span className="sr-only"> for {country}</span>
    </FormButton>
  );
}
