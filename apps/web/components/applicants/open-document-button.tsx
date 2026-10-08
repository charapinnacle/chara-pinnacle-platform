"use client";

import { FormButton } from "@/components/forms/form-button";
import { useTeamCall } from "@/components/team/use-team-call";
import { openApplicantDocument } from "@/lib/actions/applicant-review";

type OpenDocumentButtonProps = { slug: string; applicationId: string; documentId: string; title: string };

// Each press asks for a new link that lives 60 seconds and makes the browser save the file; the press is logged for
// the candidate by the database.
export function OpenDocumentButton({ slug, applicationId, documentId, title }: OpenDocumentButtonProps) {
  const open = useTeamCall("The document was not opened");
  return (
    <FormButton
      type="button"
      variant="secondary"
      busy={open.pending}
      onClick={() =>
        open.run(async () => {
          const result = await openApplicantDocument(slug, applicationId, documentId);
          if (result.url) window.location.assign(result.url);
          return result;
        }, "Your download is starting")
      }
    >
      Open<span className="sr-only"> {title}</span>
    </FormButton>
  );
}
